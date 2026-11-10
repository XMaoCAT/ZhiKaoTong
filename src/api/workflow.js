import { db, now } from '../core/db.js';
import { readRole, readName } from '../core/http-utils.js';
import { pub } from '../core/pub.js';
import { REQUEST_ROLES, REVIEW_ROLES } from '../core/consts.js';
import { checkConflict } from './timetable.js';
import { revokeViolation } from './violations.js';

/**
 * 审批工作流 API（开发计划 §5 策略表驱动）
 * ---------------------------------------------------------------------------
 * 八类申请（workflow_requests.type）：
 *   class-create / class-edit / class-dissolve / class-rename —— 教务处→学生处（一期，C1：教务处写操作走申请）
 *   add-lesson / teacher-leave / absence-cancel —— 教师→教务处（二期调课）
 *   record-modify —— 教务处→教师（确认制：教师 review=approve 即生效）
 *
 * 端点：
 *   POST /api/workflow/requests                → 提交（validator 预检 → INSERT pending → 通知+publishTo 审批方）
 *   GET  /api/workflow/requests?status=&mine=  → 列表（审批方视角；mine=发起人视角）
 *   POST /api/workflow/requests/:id/review     → 审批（409 并发互斥；approve 事务内 execute+通知+回填 result；reject 必填原因）
 *   POST /api/workflow/requests/:id/withdraw   → 撤回（发起人 + pending）
 *   GET  /api/notifications?unread=1           → 通知列表（按当前身份受众过滤；离线补弹）
 *   POST /api/notifications/read               → 标记已读 { ids: [] }
 *
 * 角色头：x-zkt-role / x-zkt-name（URI 编码）；守卫常量单源 core/consts.js。
 */

/* ================= 通知底座（notifications 表 + SSE 发布） ================= */

function addNotification({ audienceType, key, kind, requestId, title, detail }) {
  const info = db.prepare(`INSERT INTO notifications (audience_type, audience_key, kind, request_id, title, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(audienceType, String(key), kind, requestId ?? null, title, detail ?? null, now());
  return Number(info.lastInsertRowid);
}

/** 按受众类型推 SSE（role→publishToRole / class→publishToClass / teacher→publishToTeacher） */
function publishForAudience(audienceType, key, event, data) {
  if (audienceType === 'role') pub.publishToRole(key, event, data);
  else if (audienceType === 'class') pub.publishToClass(Number(key), event, data);
  else if (audienceType === 'teacher') pub.publishToTeacher(key, event, data);
}

/** 发起人所在频道（教师→teacher:<账号>；教务处/学生处→role:<角色>） */
const requesterChannel = (row) => (row.requested_role === '教师'
  ? { audienceType: 'teacher', key: row.requested_by }
  : { audienceType: 'role', key: row.requested_role });

/* ================= 校验工具 ================= */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const className = (id) => { const r = db.prepare('SELECT name FROM classes WHERE id = ?').get(id); return r ? r.name : `#${id}`; };
const isTeacherOfClass = (teacher, classId) => !!db.prepare('SELECT 1 FROM teacher_classes WHERE teacher_name = ? AND class_id = ?').get(teacher, classId);

class VError extends Error {} // 校验失败（400）
class CError extends Error {} // 并发/冲突（409）

/* ================= 表结构（notifications + workflow_requests；幂等建表 + CHECK 扩展迁移） =================
 * 2026-10-29 C1 班级重命名：type 新增 'class-rename'（教务处→学生处，第八类）。
 * ⚠ 历史：P2 的建表语句在后续重构中意外丢失（源码已无 CREATE，仅存量库有表）——新库会缺表导致 INSERT 崩溃；
 *   本块恢复幂等建表，并对旧库做 CHECK 约束重建迁移（SQLite 无法 ALTER CHECK，需建新表搬数据再改名）。
 * ⚠ 严禁再删除本建表块（同 leaves.js/academic.js 顶层幂等建表模式）。 */
db.exec(`
CREATE TABLE IF NOT EXISTS workflow_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN
    ('class-create','class-edit','class-dissolve','class-rename',  -- 教务处→学生处（C1 申请化）
     'add-lesson','teacher-leave','absence-cancel',                -- 教师→教务处（二期调课）
     'record-modify')),                                            -- 教务处→教师（确认制）
  title TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','rejected','withdrawn')),
  requested_by TEXT NOT NULL,
  requested_role TEXT NOT NULL,
  audience TEXT NOT NULL,
  reviewed_by TEXT, reject_reason TEXT, result TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  reviewed_at TEXT
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audience_type TEXT NOT NULL CHECK (audience_type IN ('role','class','teacher')),
  audience_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  request_id INTEGER, title TEXT NOT NULL, detail TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_wf_status ON workflow_requests (status, created_at);
CREATE INDEX IF NOT EXISTS idx_wf_audience ON workflow_requests (audience, status);
CREATE INDEX IF NOT EXISTS idx_ntf_audience ON notifications (audience_type, audience_key, read_at);
`);

/* 旧库迁移：CHECK 不含 class-rename 时重建 workflow_requests（保数据搬行） */
(function migrateWorkflowTypeCheck() {
  try {
    const sql = String(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'workflow_requests'").get()?.sql || '');
    if (!sql || sql.includes("'class-rename'")) return; // 已是新版结构（或表刚由上方建出）
    const tx = db.transaction(() => {
      db.exec(`
        CREATE TABLE workflow_requests_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL CHECK (type IN
            ('class-create','class-edit','class-dissolve','class-rename',
             'add-lesson','teacher-leave','absence-cancel','record-modify')),
          title TEXT NOT NULL,
          payload TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','withdrawn')),
          requested_by TEXT NOT NULL,
          requested_role TEXT NOT NULL,
          audience TEXT NOT NULL,
          reviewed_by TEXT, reject_reason TEXT, result TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          reviewed_at TEXT
        );
        INSERT INTO workflow_requests_new (id, type, title, payload, status, requested_by, requested_role, audience, reviewed_by, reject_reason, result, created_at, reviewed_at)
          SELECT id, type, title, payload, status, requested_by, requested_role, audience, reviewed_by, reject_reason, result, created_at, reviewed_at FROM workflow_requests;
        DROP TABLE workflow_requests;
        ALTER TABLE workflow_requests_new RENAME TO workflow_requests;
        CREATE INDEX IF NOT EXISTS idx_wf_status ON workflow_requests (status, created_at);
        CREATE INDEX IF NOT EXISTS idx_wf_audience ON workflow_requests (audience, status);
      `);
    });
    tx();
    console.log('[workflow] 迁移完成：workflow_requests.type CHECK 已扩展 class-rename（第八类申请）');
  } catch (err) {
    console.warn('[workflow] CHECK 扩展迁移失败（继续以旧约束运行，class-rename 提交将被拦截）：', err.message);
  }
})();

/* ================= TYPE_HANDLERS 策略表（八类型） ================= */

const TYPE_HANDLERS = {

  /* ---------- 一期：教务处 → 学生处（C1：教务处写操作走申请） ---------- */

  'class-create': {
    approverRole: '学生处',
    submitterRoles: REQUEST_ROLES,
    title: (p) => `新建班级「${p.name}」`,
    detail: (p) => [
      { label: '班级名称', value: String(p.name) },
      { label: '归属专业部', value: p.majorId ? (db.prepare('SELECT name FROM major_departments WHERE id = ?').get(p.majorId)?.name || `#${p.majorId}`) : '未归属' },
    ],
    validate: (p) => {
      const errors = [];
      const name = String(p.name || '').trim();
      if (!name || name.length > 30) errors.push('班级名称必填且不超过 30 字');
      else if (db.prepare('SELECT id FROM classes WHERE name = ?').get(name)) errors.push(`班级名称「${name}」已存在`);
      if (p.majorId != null && !db.prepare('SELECT id FROM major_departments WHERE id = ?').get(Number(p.majorId))) errors.push('归属专业部不存在');
      return errors;
    },
    execute: (p, req) => {
      const name = String(p.name || '').trim();
      if (db.prepare('SELECT id FROM classes WHERE name = ?').get(name)) throw new CError(`审批期间班级名称「${name}」已被占用，建议驳回`);
      const info = db.prepare('INSERT INTO classes (name, major_id, created_at) VALUES (?, ?, ?)')
        .run(name, p.majorId != null ? Number(p.majorId) : null, now());
      console.log(`[workflow] class-create 执行：新建「${name}」#${info.lastInsertRowid}；审批操作者：${readName(req)} @ ${now()}`);
      return { classId: Number(info.lastInsertRowid), className: name };
    },
    notifyApproved: (result) => [], // 结果窗由通用 request-reviewed 承载
  },

  'class-edit': {
    approverRole: '学生处',
    submitterRoles: REQUEST_ROLES,
    title: (p) => `编辑班级「${className(p.classId)}」成员`,
    detail: (p) => [
      { label: '班级', value: className(p.classId) },
      { label: '移出学生', value: (p.removeIds || []).join('、') || '无' },
      { label: '加入学生', value: (p.addIds || []).join('、') || '无' },
    ],
    validate: (p) => {
      const errors = [];
      const cid = Number(p.classId);
      if (!db.prepare('SELECT id FROM classes WHERE id = ?').get(cid)) return ['班级不存在'];
      const removeIds = [...new Set((Array.isArray(p.removeIds) ? p.removeIds : []).map(String))];
      const addIds = [...new Set((Array.isArray(p.addIds) ? p.addIds : []).map(String))];
      if (!removeIds.length && !addIds.length) errors.push('未做任何成员变更');
      const inClass = new Set(db.prepare('SELECT id FROM students WHERE class_id = ?').all(cid).map((r) => r.id));
      const badRemove = removeIds.filter((id) => !inClass.has(id));
      if (badRemove.length) errors.push(`以下学生不在该班级：${badRemove.slice(0, 5).join('、')}`);
      const badAdd = addIds.filter((id) => !/^\d{9}$/.test(id) || !db.prepare('SELECT id FROM students WHERE id = ?').get(id));
      if (badAdd.length) errors.push(`学号无效或不存在：${badAdd.slice(0, 5).join('、')}`);
      const assigned = addIds.filter((id) => db.prepare('SELECT class_id FROM students WHERE id = ?').get(id)?.class_id != null);
      if (assigned.length) errors.push(`以下学生已属于其他班级：${assigned.slice(0, 5).join('、')}`);
      return errors;
    },
    execute: (p, req) => {
      const cid = Number(p.classId);
      const removeIds = [...new Set((Array.isArray(p.removeIds) ? p.removeIds : []).map(String))];
      const addIds = [...new Set((Array.isArray(p.addIds) ? p.addIds : []).map(String))];
      // 复检（pending 期间数据可能变化）
      const inClass = new Set(db.prepare('SELECT id FROM students WHERE class_id = ?').all(cid).map((r) => r.id));
      const badRemove = removeIds.filter((id) => !inClass.has(id));
      if (badRemove.length) throw new CError(`审批期间学生已不在该班：${badRemove.join('、')}，建议驳回`);
      const badAdd = addIds.filter((id) => db.prepare('SELECT class_id FROM students WHERE id = ?').get(id)?.class_id != null);
      if (badAdd.length) throw new CError(`审批期间学生已被划入其他班级：${badAdd.join('、')}，建议驳回`);
      const clear = db.prepare('UPDATE students SET class_id = NULL WHERE id = ? AND class_id = ?');
      const join = db.prepare('UPDATE students SET class_id = ? WHERE id = ?');
      removeIds.forEach((id) => clear.run(id, cid));
      addIds.forEach((id) => join.run(cid, id));
      console.log(`[workflow] class-edit 执行：「${className(cid)}」移出 ${removeIds.length} 人、加入 ${addIds.length} 人；审批操作者：${readName(req)} @ ${now()}`);
      return { removed: removeIds.length, added: addIds.length };
    },
    notifyApproved: () => [],
  },

  'class-dissolve': {
    approverRole: '学生处',
    submitterRoles: REQUEST_ROLES,
    title: (p) => `解散班级「${className(p.classId)}」`,
    detail: (p) => [
      { label: '班级', value: className(p.classId) },
      { label: '解散原因', value: String(p.reason || '') },
      { label: '影响', value: '班内学生还原未分配、教师授课关联清除、班级删除（不可恢复）' },
    ],
    validate: (p) => {
      const errors = [];
      if (!db.prepare('SELECT id FROM classes WHERE id = ?').get(Number(p.classId))) return ['班级不存在'];
      const reason = String(p.reason || '').trim();
      if (!reason || reason.length > 200) errors.push('解散原因必填且不超过 200 字');
      return errors;
    },
    execute: (p, req) => {
      const cid = Number(p.classId);
      if (!db.prepare('SELECT id FROM classes WHERE id = ?').get(cid)) throw new CError('审批期间班级已被解散，建议驳回');
      const name = className(cid);
      let released = 0;
      const tx = db.transaction(() => {
        released = db.prepare('UPDATE students SET class_id = NULL WHERE class_id = ?').run(cid).changes;
        db.prepare('DELETE FROM teacher_classes WHERE class_id = ?').run(cid);
        db.prepare('DELETE FROM classes WHERE id = ?').run(cid);
      });
      tx();
      console.log(`[workflow] class-dissolve 执行：解散「${name}」#${cid}，还原 ${released} 名学生；原因：${p.reason}；审批操作者：${readName(req)} @ ${now()}`);
      return { released };
    },
    notifyApproved: () => [],
  },

  'class-rename': {
    approverRole: '学生处',
    submitterRoles: REQUEST_ROLES,
    title: (p) => `重命名班级「${className(p.classId)}」→「${p.name}」`,
    detail: (p) => [
      { label: '原班级名', value: className(p.classId) },
      { label: '新班级名', value: String(p.name) },
    ],
    validate: (p) => {
      const errors = [];
      const old = db.prepare('SELECT name FROM classes WHERE id = ?').get(Number(p.classId));
      if (!old) return ['班级不存在'];
      const name = String(p.name || '').trim();
      if (!name || name.length > 30) errors.push('新班级名称必填且不超过 30 字');
      else if (name === old.name) errors.push('新名称与原名称相同');
      else if (db.prepare('SELECT id FROM classes WHERE name = ?').get(name)) errors.push(`班级名称「${name}」已存在`);
      return errors;
    },
    execute: (p, req) => {
      const cid = Number(p.classId);
      const old = db.prepare('SELECT name FROM classes WHERE id = ?').get(cid);
      if (!old) throw new CError('审批期间班级已被解散，建议驳回');
      const name = String(p.name || '').trim();
      if (db.prepare('SELECT id FROM classes WHERE name = ?').get(name)) throw new CError(`审批期间班级名称「${name}」已被占用，建议驳回`);
      db.prepare('UPDATE classes SET name = ? WHERE id = ?').run(name, cid);
      console.log(`[workflow] class-rename 执行：「${old.name}」#${cid} →「${name}」；审批操作者：${readName(req)} @ ${now()}`);
      return { classId: cid, from: old.name, className: name };
    },
    notifyApproved: () => [],
  },

  /* ---------- 二期：教师 → 教务处（调课审批） ---------- */

  'add-lesson': {
    approverRole: '教务处',
    submitterRoles: ['教师'],
    title: (p) => `加课：${p.courseName} · ${className(p.classId)}`,
    detail: (p) => [
      { label: '课程', value: String(p.courseName) },
      { label: '班级', value: className(p.classId) },
      { label: '日期', value: `${p.singleDate}（周${'日一二三四五六'[Number(p.weekday) % 7]}）` },
      { label: '时段', value: `${p.start} – ${p.end}` },
    ],
    validate: (p, req) => {
      const errors = [];
      const cid = Number(p.classId);
      if (!isTeacherOfClass(readName(req), cid)) errors.push('只能为本人授课班级申请加课');
      if (!String(p.courseName || '').trim() || String(p.courseName).length > 40) errors.push('课程名称必填且不超过 40 字');
      const wd = Number(p.weekday);
      if (!Number.isInteger(wd) || wd < 1 || wd > 7) errors.push('星期参数无效（1–7）');
      if (!HHMM.test(String(p.start || '')) || !HHMM.test(String(p.end || ''))) errors.push('起止时间格式应为 HH:MM');
      if (toMin(String(p.start || '00:00')) < 360 || toMin(String(p.end || '00:00')) > 1320) errors.push('上课时间须在 06:00–22:00 之间');
      if (HHMM.test(String(p.start || '')) && HHMM.test(String(p.end || '')) && String(p.start) >= String(p.end)) errors.push('开始时间须早于结束时间');
      if (!DATE.test(String(p.singleDate || ''))) errors.push('单次课日期必填（YYYY-MM-DD）');
      if (DATE.test(String(p.singleDate || '')) && new Date(`${p.singleDate}T00:00:00`) < new Date(new Date().toDateString())) errors.push('加课日期不能早于今天');
      if (!errors.length) {
        const { conflict, with: hit } = checkConflict({ classId: cid, teacherName: readName(req), weekday: wd, start: String(p.start), end: String(p.end), singleDate: String(p.singleDate) });
        if (conflict) errors.push(`时段冲突：与「${hit.course_name}」（${hit.start_time}-${hit.end_time}，${hit.source === 'base' ? '每周课' : hit.single_date}）重叠`);
      }
      return errors;
    },
    execute: (p, req, requester) => {
      // 冲突复检（pending 期间可能被占）→ 409 建议驳回；教师名取提交者（requester），非审批请求 req
      const { conflict, with: hit } = checkConflict({ classId: Number(p.classId), teacherName: requester, weekday: Number(p.weekday), start: String(p.start), end: String(p.end), singleDate: String(p.singleDate) });
      if (conflict) throw new CError(`审批期间时段已被占用（${hit.course_name} ${hit.start_time}-${hit.end_time}），建议驳回`);
      const info = db.prepare(`INSERT INTO timetable_lessons (class_id, teacher_name, course_name, weekday, start_time, end_time, source, single_date, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'add', ?, ?, ?)`)
        .run(Number(p.classId), requester, String(p.courseName).trim(), Number(p.weekday), String(p.start), String(p.end), String(p.singleDate), requester, now());
      return { lessonId: Number(info.lastInsertRowid) };
    },
    notifyApproved: (result, p, req, requester) => [
      { audienceType: 'class', key: p.classId, kind: 'lesson-added', title: `新课通知：${p.courseName}`, detail: `${p.singleDate} ${p.start}-${p.end}（教师 ${requester}）` },
    ],
  },

  'teacher-leave': {
    approverRole: '教务处',
    submitterRoles: ['教师'],
    title: (p) => `教师请假停课：${lessonBrief(p.lessonId)}`,
    detail: (p) => [
      { label: '课程', value: lessonBrief(p.lessonId) },
      { label: '请假备注', value: String(p.note || '') },
      { label: '处理方式', value: '停课不补（D4 口径）' },
      { label: '签名', value: p.signature ? '已签名（见附件）' : '未签名' },
      { label: '图片材料', value: `${(p.images || []).length} 张` },
    ],
    validate: (p, req) => {
      const errors = [];
      const lesson = db.prepare('SELECT * FROM timetable_lessons WHERE id = ?').get(Number(p.lessonId));
      if (!lesson) return ['课程不存在'];
      if (lesson.teacher_name !== readName(req)) errors.push('只能为本人的课程申请停课');
      if (lesson.cancelled) errors.push('该课程已停课');
      if (!String(p.note || '').trim() || String(p.note).length > 300) errors.push('请假备注必填且不超过 300 字');
      if (!p.signature || !/^data:image\/png;base64,/.test(String(p.signature))) errors.push('需提交 PNG 签名');
      const imgs = Array.isArray(p.images) ? p.images : [];
      if (imgs.length > 6) errors.push('图片材料最多 6 张');
      if (imgs.some((x) => !/^data:image\//.test(String(x)))) errors.push('图片材料格式无效');
      return errors;
    },
    execute: (p, req) => {
      const lesson = db.prepare('SELECT * FROM timetable_lessons WHERE id = ?').get(Number(p.lessonId));
      if (!lesson) throw new CError('课程已不存在，建议驳回');
      if (lesson.cancelled) throw new CError('该课程已停课，无需重复审批');
      db.prepare('UPDATE timetable_lessons SET cancelled = 1 WHERE id = ?').run(Number(p.lessonId));
      return { lessonId: lesson.id };
    },
    notifyApproved: (result, p) => {
      const lesson = db.prepare('SELECT * FROM timetable_lessons WHERE id = ?').get(Number(p.lessonId));
      if (!lesson) return [];
      const when = lesson.source === 'base' ? `每周${'日一二三四五六'[lesson.weekday % 7]} ${lesson.start_time}-${lesson.end_time}` : `${lesson.single_date} ${lesson.start_time}-${lesson.end_time}`;
      return [{ audienceType: 'class', key: lesson.class_id, kind: 'lesson-cancelled', title: `停课通知：${lesson.course_name}`, detail: `${when}（教师 ${lesson.teacher_name} 请假，停课不补）` }];
    },
  },

  'absence-cancel': {
    approverRole: '教务处',
    submitterRoles: ['教师'],
    title: (p) => `旷课撤销：学生${(violationOf(p.violationId) || {}).student_id || ''}`,
    detail: (p) => {
      const v = violationOf(p.violationId);
      return [
        { label: '学生', value: v ? `${v.student_id}` : '未知' },
        { label: '违规类型', value: v ? `${v.type}（${v.points} 分）` : '未知' },
        { label: '登记时间', value: v ? String(v.created_at || '') : '' },
        { label: '处理', value: '撤销旷课记录并归还积分' },
      ];
    },
    validate: (p, req) => {
      const errors = [];
      const v = db.prepare('SELECT * FROM violation_records WHERE id = ?').get(Number(p.violationId));
      if (!v) return ['违规记录不存在'];
      if (v.cancelled) errors.push('该违规记录已被撤销');
      if (!v.session_id) errors.push('仅课堂自动登记的旷课可申请撤销');
      else {
        const session = db.prepare('SELECT * FROM lesson_sessions WHERE id = ?').get(v.session_id);
        if (!session || session.teacher_name !== readName(req)) errors.push('仅该课堂的授课教师可申请撤销');
      }
      return errors;
    },
    execute: (p, req) => {
      const v = db.prepare('SELECT * FROM violation_records WHERE id = ?').get(Number(p.violationId));
      if (!v) throw new CError('违规记录已不存在，建议驳回');
      if (v.cancelled) throw new CError('该违规记录已被撤销，建议驳回');
      // 还分与违规行同事务（单源：violations.js revokeViolation，§9.1 禁令：严禁内联复制）
      const r = revokeViolation(v.id, readName(req), '旷课撤销审批通过');
      if (!r) throw new CError('该违规记录已被撤销，建议驳回');
      db.prepare(`INSERT INTO classroom_events (session_id, student_id, kind, delta, note, operator, created_at)
        VALUES (?, ?, 'absence-cancelled', ?, ?, ?, ?)`).run(v.session_id, v.student_id, -v.points, '旷课撤销审批通过', readName(req), now());
      return { violationId: v.id, restored: -v.points };
    },
    notifyApproved: () => [],
  },

  /* ---------- 二期：教务处 → 教师（确认制） ---------- */

  'record-modify': {
    approverRole: '教师', // 确认制：audience=教师（payload 里的 session 教师）
    submitterRoles: REQUEST_ROLES,
    title: (p) => `课堂记录修改确认：${sessionBrief(p.sessionId)}`,
    detail: (p) => [
      { label: '课堂', value: sessionBrief(p.sessionId) },
      ...(Array.isArray(p.changes) ? p.changes.map((c) => ({
        label: `学生 ${c.studentId} · ${fieldLabel(c.field)}`,
        value: `${formatFromTo(c.field, c.from)} → ${formatFromTo(c.field, c.to)}`,
      })) : []),
    ],
    validate: (p) => {
      const errors = [];
      const session = db.prepare('SELECT * FROM lesson_sessions WHERE id = ?').get(Number(p.sessionId));
      if (!session) return ['课堂不存在'];
      const changes = Array.isArray(p.changes) ? p.changes : [];
      if (!changes.length) errors.push('未包含任何修改项');
      const seen = new Set();
      for (const c of changes) {
        if (!c || !/^\d{9}$/.test(String(c.studentId || ''))) { errors.push('修改项学生学号无效'); break; }
        if (!['sign', 'score', 'absence'].includes(c.field)) { errors.push(`修改字段无效：${c.field}`); break; }
        const key = `${c.studentId}:${c.field}`;
        if (seen.has(key)) { errors.push('同一学生的同一字段重复修改'); break; }
        seen.add(key);
        // from 与库内现状一致性校验（防陈旧修改）
        if (c.field === 'sign') {
          const cur = db.prepare('SELECT status FROM sign_records WHERE session_id = ? AND student_id = ?').get(Number(p.sessionId), String(c.studentId));
          if (!cur) { errors.push(`学生 ${c.studentId} 无签到记录，无法改签到状态`); break; }
          if (cur.status !== c.from) { errors.push(`学生 ${c.studentId} 签到状态当前为「${cur.status}」与提交快照「${c.from}」不一致（数据已变化）`); break; }
          if (!['signed', 'absent', 'leave', 'signed_by_teacher'].includes(c.to)) { errors.push('目标签到状态无效'); break; }
        } else if (c.field === 'score') {
          const cur = latestScoreEvent(Number(p.sessionId), String(c.studentId));
          if ((cur ? cur.delta : 0) !== Number(c.from)) { errors.push(`学生 ${c.studentId} 分值快照不一致（数据已变化）`); break; }
          if (![-2, -1, 1, 2].includes(Number(c.to))) { errors.push('目标分值须在 ±1/±2'); break; }
        } else if (c.field === 'absence') {
          const v = db.prepare('SELECT * FROM violation_records WHERE session_id = ? AND student_id = ? AND type = ?').get(Number(p.sessionId), String(c.studentId), '旷课');
          if (!v || v.cancelled) { errors.push(`学生 ${c.studentId} 无有效旷课记录可撤销`); break; }
          if (c.to !== false) { errors.push('旷课修改仅支持撤销（to=false）'); break; }
        }
      }
      return errors;
    },
    execute: (p, req) => {
      const sid = Number(p.sessionId);
      const session = db.prepare('SELECT * FROM lesson_sessions WHERE id = ?').get(sid);
      if (!session) throw new CError('课堂已不存在，建议驳回');
      const applied = [];
      for (const c of p.changes) {
        if (c.field === 'sign') {
          db.prepare('UPDATE sign_records SET status = ?, method = ? WHERE session_id = ? AND student_id = ?')
            .run(String(c.to), 'status-override', sid, String(c.studentId));
          db.prepare(`INSERT INTO classroom_events (session_id, student_id, kind, note, operator, created_at)
            VALUES (?, ?, 'status-override', ?, ?, ?)`).run(sid, String(c.studentId), `签到状态 ${c.from}→${c.to}`, readName(req), now());
        } else if (c.field === 'score') {
          const cur = latestScoreEvent(sid, String(c.studentId));
          if (cur) db.prepare('UPDATE classroom_events SET delta = ?, note = ?, operator = ? WHERE id = ?')
            .run(Number(c.to), `教务处修改分值 ${cur.delta}→${c.to}`, readName(req), cur.id);
          else db.prepare(`INSERT INTO classroom_events (session_id, student_id, kind, delta, note, operator, created_at)
            VALUES (?, ?, 'score', ?, ?, ?, ?)`).run(sid, String(c.studentId), Number(c.to), '教务处补录分值', readName(req), now());
        } else if (c.field === 'absence') {
          const v = db.prepare('SELECT * FROM violation_records WHERE session_id = ? AND student_id = ? AND type = ? AND cancelled = 0').get(sid, String(c.studentId), '旷课');
          if (!v) throw new CError(`学生 ${c.studentId} 旷课记录已变化，建议驳回`);
          // 还分单源（violations.js revokeViolation）
          if (!revokeViolation(v.id, readName(req), '教务处修改确认撤销旷课')) throw new CError(`学生 ${c.studentId} 旷课记录已变化，建议驳回`);
          db.prepare(`INSERT INTO classroom_events (session_id, student_id, kind, delta, note, operator, created_at)
            VALUES (?, ?, 'absence-cancelled', ?, ?, ?, ?)`).run(sid, String(c.studentId), -v.points, '教务处修改确认撤销旷课', readName(req), now());
        }
        applied.push(c);
      }
      return { applied: applied.length };
    },
    notifyApproved: () => [], // 结果窗走通用 request-reviewed（回发起人=教务处）
  },
};

/* ---------- handler 辅助（供 detail/通知构造） ---------- */
function lessonBrief(id) { const l = db.prepare('SELECT * FROM timetable_lessons WHERE id = ?').get(Number(id)); return l ? `${l.course_name}（${l.source === 'base' ? `每周${'日一二三四五六'[l.weekday % 7]} ${l.start_time}` : l.single_date} ${l.start_time}-${l.end_time}）` : `#${id}`; }
function sessionBrief(id) { const s = db.prepare('SELECT * FROM lesson_sessions WHERE id = ?').get(Number(id)); return s ? `${s.date} ${s.course_name || ''}（${s.teacher_name}）` : `#${id}`; }
function violationOf(id) { return db.prepare('SELECT * FROM violation_records WHERE id = ?').get(Number(id)); }
function latestScoreEvent(sessionId, studentId) { return db.prepare(`SELECT * FROM classroom_events WHERE session_id = ? AND student_id = ? AND kind = 'score' ORDER BY id DESC LIMIT 1`).get(sessionId, studentId); }
function fieldLabel(f) { return f === 'sign' ? '签到状态' : f === 'score' ? '加减分' : '旷课'; }
function formatFromTo(field, v) { return field === 'absence' ? (v ? '旷课中' : '已撤销') : String(v); }

/* ================= 端点 ================= */

export function registerWorkflowRoutes(app) {

  /* ---------- 提交申请 ---------- */
  app.post('/api/workflow/requests', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    const b = req.body || {};
    const type = String(b.type || '');
    const handler = TYPE_HANDLERS[type];
    if (!handler) return res.code(400).send({ ok: false, message: `未知申请类型：${type}` });
    if (!handler.submitterRoles.includes(role)) {
      return res.code(403).send({ ok: false, message: `仅 ${handler.submitterRoles.join('/')} 可提交「${type}」申请` });
    }
    const payload = b.payload || {};
    const errors = handler.validate(payload, req);
    if (errors.length) return res.code(400).send({ ok: false, message: errors.join('；') });

    const title = handler.title(payload);
    const info = db.prepare(`INSERT INTO workflow_requests (type, title, payload, status, requested_by, requested_role, audience, created_at)
      VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`)
      .run(type, title, JSON.stringify(payload), name, role, handler.approverRole, now());
    const id = Number(info.lastInsertRowid);
    const row = rowOut(db.prepare('SELECT * FROM workflow_requests WHERE id = ?').get(id));

    // 通知审批方（SSE 实时 + 通知表离线补弹）
    const approverAudience = type === 'record-modify'
      ? { audienceType: 'teacher', key: db.prepare('SELECT teacher_name FROM lesson_sessions WHERE id = ?').get(Number(payload.sessionId))?.teacher_name || '' }
      : { audienceType: 'role', key: handler.approverRole };
    if (approverAudience.key) {
      addNotification({ ...approverAudience, kind: 'workflow-request-new', requestId: id, title: `新申请：${title}` });
      publishForAudience(approverAudience.audienceType, approverAudience.key, 'workflow:request-new', row);
    }
    return { ok: true, id, title, status: 'pending' };
  });

  /* ---------- 申请列表 ---------- */
  app.get('/api/workflow/requests', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    if (!role) return res.code(403).send({ ok: false, message: '未登录' });
    const q = req.query || {};
    const mine = String(q.mine || '') === '1';
    const status = ['pending', 'approved', 'rejected', 'withdrawn'].includes(String(q.status || '')) ? String(q.status) : null;

    if (mine) {
      const rows = status
        ? db.prepare('SELECT * FROM workflow_requests WHERE requested_by = ? AND status = ? ORDER BY id DESC').all(name, status)
        : db.prepare('SELECT * FROM workflow_requests WHERE requested_by = ? ORDER BY id DESC').all(name);
      return { ok: true, requests: rows.map(rowOut) };
    }

    // 审批方视角：学生处/IT 看 audience=学生处；教务处/IT 看 audience=教务处；教师看 audience=教师（本人课堂）
    if (role === 'IT管理员') {
      const rows = status
        ? db.prepare('SELECT * FROM workflow_requests WHERE status = ? ORDER BY id DESC').all(status)
        : db.prepare('SELECT * FROM workflow_requests ORDER BY id DESC').all();
      return { ok: true, requests: rows.map(rowOut) };
    }
    if (role === '学生处' || role === '教务处') {
      const rows = status
        ? db.prepare('SELECT * FROM workflow_requests WHERE audience = ? AND status = ? ORDER BY id DESC').all(role, status)
        : db.prepare('SELECT * FROM workflow_requests WHERE audience = ? ORDER BY id DESC').all(role);
      return { ok: true, requests: rows.map(rowOut) };
    }
    if (role === '教师') {
      const rows = db.prepare("SELECT * FROM workflow_requests WHERE audience = '教师' ORDER BY id DESC").all();
      const mine1 = rows.filter((r) => {
        try { const p = JSON.parse(r.payload); const s = db.prepare('SELECT teacher_name FROM lesson_sessions WHERE id = ?').get(Number(p.sessionId)); return s && s.teacher_name === name; } catch { return false; }
      });
      return { ok: true, requests: (status ? mine1.filter((r) => r.status === status) : mine1).map(rowOut) };
    }
    return res.code(403).send({ ok: false, message: '当前角色无审批视角' });
  });

  /* ---------- 审批（409 并发互斥 + 事务执行器） ---------- */
  app.post('/api/workflow/requests/:id/review', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    const id = Number(req.params.id);
    const raw = db.prepare('SELECT * FROM workflow_requests WHERE id = ?').get(id);
    if (!raw) return res.code(404).send({ ok: false, message: '申请不存在' });
    const handler = TYPE_HANDLERS[raw.type];
    if (!handler) return res.code(400).send({ ok: false, message: '申请类型失效' });

    // 审批方守卫：audience=学生处→REVIEW_ROLES；教务处→教务处/IT；教师→本人（record-modify）
    if (raw.audience === '学生处' && !REVIEW_ROLES.includes(role)) {
      return res.code(403).send({ ok: false, message: '仅学生处/IT管理员可审批该申请' });
    }
    if (raw.audience === '教务处' && !['教务处', 'IT管理员'].includes(role)) {
      return res.code(403).send({ ok: false, message: '仅教务处/IT管理员可审批该申请' });
    }
    if (raw.audience === '教师') {
      let teacher = null;
      try { teacher = db.prepare('SELECT teacher_name FROM lesson_sessions WHERE id = ?').get(Number(JSON.parse(raw.payload).sessionId))?.teacher_name; } catch { /* ignore */ }
      if (role !== 'IT管理员' && (role !== '教师' || name !== teacher)) {
        return res.code(403).send({ ok: false, message: '仅该课堂授课教师可确认该修改' });
      }
    }

    const action = String((req.body || {}).action || '');
    const reason = String((req.body || {}).reason || '').trim().slice(0, 300);
    if (!['approve', 'reject'].includes(action)) return res.code(400).send({ ok: false, message: 'action 须为 approve / reject' });
    if (action === 'reject' && !reason) return res.code(400).send({ ok: false, message: '驳回必须填写原因' });
    if (raw.status !== 'pending') return res.code(409).send({ ok: false, message: `该申请已处于「${raw.status}」状态，不可重复处理` });

    let result = null;
    try {
      if (action === 'approve') {
        const payload = JSON.parse(raw.payload);
        const tx = db.transaction(() => {
          // ① 并发互斥占位（事务内，异常自动回滚）
          const upd = db.prepare(`UPDATE workflow_requests SET status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'`)
            .run(name, now(), id);
          if (upd.changes === 0) throw new CError('该申请已被处理（并发冲突）');
          // ② 业务执行（requester=提交者账号，供教师类执行器落库留痕；req 仍为审批请求，日志记审批操作者）
          result = handler.execute(payload, req, raw.requested_by);
          // ③ 类型特定通知（add-lesson→班级新课 / teacher-leave→班级停课）
          for (const n of handler.notifyApproved ? handler.notifyApproved(result, payload, req, raw.requested_by) : []) {
            addNotification({ ...n, requestId: id });
          }
          // ④ 回填 result
          db.prepare('UPDATE workflow_requests SET result = ? WHERE id = ?').run(JSON.stringify(result), id);
        });
        tx();
      } else {
        const upd = db.prepare(`UPDATE workflow_requests SET status = 'rejected', reviewed_by = ?, reject_reason = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'`)
          .run(name, reason, now(), id);
        if (upd.changes === 0) return res.code(409).send({ ok: false, message: '该申请已被处理（并发冲突）' });
      }
    } catch (err) {
      if (err instanceof CError) return res.code(409).send({ ok: false, message: err.message });
      if (err instanceof VError) return res.code(400).send({ ok: false, message: err.message });
      console.error('[workflow] review 异常:', err);
      return res.code(500).send({ ok: false, message: '审批执行异常，已回滚' });
    }

    // ⑤ 事务成功后：SSE 通知（发起人结果窗 + 类型特定事件）
    const fresh = db.prepare('SELECT * FROM workflow_requests WHERE id = ?').get(id);
    const requester = requesterChannel(fresh);
    addNotification({ ...requester, kind: 'workflow-request-reviewed', requestId: id, title: `申请${action === 'approve' ? '已通过' : '已驳回'}：${fresh.title}`, detail: action === 'reject' ? reason : (result ? JSON.stringify(result) : null) });
    publishForAudience(requester.audienceType, requester.key, 'workflow:request-reviewed', rowOut(fresh));
    if (action === 'approve') {
      const payload = JSON.parse(raw.payload);
      for (const n of handler.notifyApproved ? handler.notifyApproved(result, payload, req, raw.requested_by) : []) {
        publishForAudience(n.audienceType, n.key, n.kind === 'lesson-added' ? 'timetable:lesson-added' : n.kind === 'lesson-cancelled' ? 'timetable:lesson-cancelled' : 'workflow:request-new', { requestId: id, ...n });
      }
    }
    return { ok: true, id, status: action === 'approve' ? 'approved' : 'rejected', result };
  });

  /* ---------- 撤回 ---------- */
  app.post('/api/workflow/requests/:id/withdraw', async (req, res) => {
    const name = readName(req);
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM workflow_requests WHERE id = ?').get(id);
    if (!row) return res.code(404).send({ ok: false, message: '申请不存在' });
    if (row.requested_by !== name) return res.code(403).send({ ok: false, message: '仅发起人可撤回' });
    if (row.status !== 'pending') return res.code(409).send({ ok: false, message: `仅待审批的申请可撤回（当前：${row.status}）` });
    db.prepare(`UPDATE workflow_requests SET status = 'withdrawn', reviewed_at = ? WHERE id = ? AND status = 'pending'`).run(now(), id);
    return { ok: true, id, status: 'withdrawn' };
  });

  /* ---------- 通知列表（离线补弹） + 标记已读 ---------- */
  app.get('/api/notifications', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    if (!role) return res.code(403).send({ ok: false, message: '未登录' });
    const unreadOnly = String((req.query || {}).unread || '') === '1';
    let rows = [];
    if (role === '学生') {
      const stu = db.prepare('SELECT class_id FROM students WHERE id = ?').get(name);
      const conds = ["(audience_type = 'role' AND audience_key = ?)"];
      const args = [role];
      if (stu && stu.class_id != null) { conds.push("(audience_type = 'class' AND audience_key = ?)"); args.push(String(stu.class_id)); }
      rows = db.prepare(`SELECT * FROM notifications WHERE ${conds.join(' OR ')} ORDER BY id DESC LIMIT 100`).all(...args);
    } else if (role === '教师') {
      rows = db.prepare(`SELECT * FROM notifications WHERE (audience_type = 'role' AND audience_key = ?) OR (audience_type = 'teacher' AND audience_key = ?) ORDER BY id DESC LIMIT 100`).all(role, name);
    } else {
      rows = db.prepare('SELECT * FROM notifications WHERE audience_type = ? AND audience_key = ? ORDER BY id DESC LIMIT 100').all('role', role);
    }
    if (unreadOnly) rows = rows.filter((r) => !r.read_at);
    return { ok: true, notifications: rows.map(ntfOut) };
  });

  app.post('/api/notifications/read', async (req, res) => {
    const role = readRole(req);
    if (!role) return res.code(403).send({ ok: false, message: '未登录' });
    const ids = (Array.isArray((req.body || {}).ids) ? req.body.ids : []).map(Number).filter(Number.isInteger);
    if (!ids.length) return res.code(400).send({ ok: false, message: '未指定通知 id' });
    const upd = db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL');
    let changed = 0;
    for (const id of ids) changed += upd.run(now(), id).changes;
    return { ok: true, marked: changed };
  });
}

/* ---------- 行输出契约 ---------- */
function rowOut(r) {
  if (!r) return null;
  let payload = {};
  try { payload = JSON.parse(r.payload); } catch { /* ignore */ }
  const handler = TYPE_HANDLERS[r.type];
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    payload,
    status: r.status,
    requestedBy: r.requested_by,
    requestedRole: r.requested_role,
    audience: r.audience,
    reviewedBy: r.reviewed_by || '',
    rejectReason: r.reject_reason || '',
    result: r.result ? safeJSON(r.result) : null,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at || '',
    detail: handler && handler.detail ? handler.detail(payload) : [],
  };
}
const safeJSON = (s) => { try { return JSON.parse(s); } catch { return s; } };

function ntfOut(n) {
  return { id: n.id, audienceType: n.audience_type, audienceKey: String(n.audience_key), kind: n.kind, requestId: n.request_id, title: n.title, detail: n.detail || '', readAt: n.read_at || '', createdAt: n.created_at };
}

/* ================= academic.js 四写端点通知内嵌（§5.4） ================= */

/** 学生处/IT 直改学生数据后：通知教务处（SSE + 通知表），供 mod-academic 教务端弹通知窗+reload */
export function notifyStudentsChanged(kind, title, detail) {
  addNotification({ audienceType: 'role', key: '教务处', kind: 'students-changed', title, detail });
  pub.publishToRole('教务处', 'academic:students-changed', { kind, title, detail });
}
