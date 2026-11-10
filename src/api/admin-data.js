import fs from 'node:fs';
import path from 'node:path';
import { db, now } from '../core/db.js';
import { readRole, readName } from '../core/http-utils.js';
import { ROOT } from '../core/config.js';
import { listTeacherNames, MANAGEMENT_ACCOUNTS } from './academic.js';
import { groupForAccount, hasCustomPassword, clearPassword } from './auth.js';
import { getAttendanceRules, setAttendanceRules, pointsMap } from './violations.js';

/**
 * 系统数据管理 API（IT管理员专属；2026-10-24 用户需求：初始化 + 生成模拟数据；2026-10-29 新增用户与角色管理）
 * ---------------------------------------------------------------------------
 * 端点：
 *   GET  /api/staff-accounts   → 登录页教职工账号列表（公开只读：动态教师 + 固定管理账号；账号名非敏感）
 *   GET  /api/admin/data-status → 各业务表记录数汇总（初始化前让 IT 看到将清掉的数据规模）
 *   POST /api/admin/reset       → 初始化：全部信息记录清零（业务表+上传记录+storage 文件，回到空库；不可逆）
 *   POST /api/admin/seed        → 生成模拟数据：教师01–05 共 5 名教师 + 学生001–学生100 共 100 名学生
 *                                  （学号 000000001–000000100，未分配班级；幂等 INSERT OR IGNORE）
 *   GET  /api/admin/accounts    → 用户与角色管理：全部账号清单（学生/教师/管理账号，含是否已设自定义密码）
 *   POST /api/admin/account-reset-password { account } → 重置指定账号密码为默认密码 123456
 *
 * 守卫：reset/seed/data-status/accounts/account-reset-password 仅 IT管理员（系统管理模块属地）；staff-accounts 无守卫（登录页无会话时拉取）。
 * 角色头：x-zkt-role / x-zkt-name（URI 编码）。
 */

/** 初始化清零的全部数据表（业务 + 上传任务记录；app_versions/settings 为系统配置不清） */
const RESET_TABLES = [
  'leaves', 'students', 'classes', 'teacher_classes', 'teachers',
  'workflow_requests', 'notifications',
  'major_departments', 'teacher_majors', 'counselor_classes',
  'timetable_lessons', 'lesson_sessions', 'sign_records', 'classroom_events',
  'violation_records',
  'uploads', 'tasks',
  'account_credentials',
  'surveys', 'survey_responses', 'survey_ballots',
];

/** storage 上传目录（reset 时清空内容保留目录结构） */
const STORAGE_SUBDIRS = ['uploads', 'files', 'results'];

function guardAdmin(req, res) {
  if (readRole(req) !== 'IT管理员') {
    res.code(403).send({ ok: false, message: '仅IT管理员可执行系统数据管理操作' });
    return false;
  }
  return true;
}

export function registerAdminDataRoutes(app) {
  /* ---------- 登录页教职工账号列表（公开只读） ---------- */
  app.get('/api/staff-accounts', async () => {
    return { ok: true, teachers: listTeacherNames(), management: MANAGEMENT_ACCOUNTS };
  });

  /* ---------- 数据状态汇总 ---------- */
  app.get('/api/admin/data-status', async (req, res) => {
    if (!guardAdmin(req, res)) return;
    const counts = {};
    for (const t of RESET_TABLES) counts[t] = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
    return { ok: true, counts };
  });

  /* ---------- 初始化：全部信息记录清零（不可逆；前端已做输入"清空"强确认） ---------- */
  app.post('/api/admin/reset', async (req, res) => {
    if (!guardAdmin(req, res)) return;
    const tx = db.transaction(() => {
      for (const t of RESET_TABLES) db.prepare(`DELETE FROM ${t}`).run();
    });
    tx();
    // 清空 storage 上传内容（保留目录）；失败不阻断（库已清为主）
    let storageCleared = true;
    for (const dir of STORAGE_SUBDIRS) {
      const p = path.join(ROOT, 'storage', dir);
      try {
        fs.rmSync(p, { recursive: true, force: true });
        fs.mkdirSync(p, { recursive: true });
      } catch { storageCleared = false; }
    }
    // WAL 收缩（大量 dataURL 凭证删除后回收空间）
    try { db.pragma('wal_checkpoint(TRUNCATE)'); db.exec('VACUUM'); } catch { /* 并发占用时跳过 */ }
    console.log(`[admin] 初始化完成：${RESET_TABLES.length} 张表清零${storageCleared ? ' + storage 已清空' : '（storage 清理部分失败）'}；操作者：${readName(req)} @ ${now()}`);
    return { ok: true, reset: true, tables: RESET_TABLES.length, storageCleared };
  });

  /* ---------- 生成模拟数据：5 教师 + 100 学生（幂等） ---------- */
  app.post('/api/admin/seed', async (req, res) => {
    if (!guardAdmin(req, res)) return;
    let teachersAdded = 0;
    let studentsAdded = 0;
    const tx = db.transaction(() => {
      const insT = db.prepare('INSERT OR IGNORE INTO teachers (name) VALUES (?)');
      for (let i = 1; i <= 5; i++) { if (insT.run(`教师${String(i).padStart(2, '0')}`).changes) teachersAdded += 1; }
      const insS = db.prepare('INSERT OR IGNORE INTO students (id, name, class_id, created_at) VALUES (?, ?, NULL, ?)');
      const ts = now();
      for (let i = 1; i <= 100; i++) {
        if (insS.run(String(i).padStart(9, '0'), `学生${String(i).padStart(3, '0')}`, ts).changes) studentsAdded += 1;
      }
    });
    tx();
    console.log(`[admin] 生成模拟数据：新增教师 ${teachersAdded} 名、学生 ${studentsAdded} 名；操作者：${readName(req)} @ ${now()}`);
    return { ok: true, teachersAdded, studentsAdded };
  });

  /* ---------- 用户与角色管理：全部账号清单（2026-10-29） ---------- */
  app.get('/api/admin/accounts', async (req, res) => {
    if (!guardAdmin(req, res)) return;
    const students = db.prepare('SELECT s.id, s.name, c.name AS class_name FROM students s LEFT JOIN classes c ON c.id = s.class_id ORDER BY s.id').all()
      .map((r) => ({ account: r.id, name: r.name, group: '学生', className: r.class_name || '未分配', custom: hasCustomPassword(r.id) }));
    const teachers = listTeacherNames().map((name) => ({ account: name, name, group: '教师', custom: hasCustomPassword(name) }));
    const management = MANAGEMENT_ACCOUNTS.map((name) => ({ account: name, name, group: groupForAccount(name), custom: hasCustomPassword(name) }));
    return { ok: true, students, teachers, management };
  });

  /* ---------- 重置账号密码为默认密码 123456（2026-10-29） ---------- */
  app.post('/api/admin/account-reset-password', async (req, res) => {
    if (!guardAdmin(req, res)) return;
    const account = String((req.body || {}).account || '').trim();
    if (!account) return res.code(400).send({ ok: false, message: '请指定账号' });
    if (!groupForAccount(account)) return res.code(404).send({ ok: false, message: `账号「${account}」不存在` });
    const hadCustom = clearPassword(account);
    console.log(`[admin] 重置账号「${account}」密码为默认密码${hadCustom ? '（原为自定义密码）' : '（本就为默认密码）'}；操作者：${readName(req)} @ ${now()}`);
    return { ok: true, account, reset: true };
  });

  /* ---------- 考勤规则配置（2026-10-29 A3：单源 settings 表 attendance_rules，violations.js 动态消费） ---------- */
  app.get('/api/admin/attendance-rules', async (req, res) => {
    if (!guardAdmin(req, res)) return;
    const rules = getAttendanceRules();
    return { ok: true, rules, points: pointsMap(rules) };
  });

  app.post('/api/admin/attendance-rules', async (req, res) => {
    if (!guardAdmin(req, res)) return;
    const b = req.body || {};
    const rules = {
      absencePoints: Math.round(Number(b.absencePoints)),
      dormPoints: Math.round(Number(b.dormPoints)),
      warnBelow: Math.round(Number(b.warnBelow)),
    };
    if (!Object.values(rules).every((n) => Number.isFinite(n) && n >= 1 && n <= 100)) {
      return res.code(400).send({ ok: false, message: '各项须为 1–100 的整数' });
    }
    setAttendanceRules(rules);
    console.log(`[admin] 考勤规则已更新：旷课 -${rules.absencePoints} / 旷寝 -${rules.dormPoints} / 预警线 ${rules.warnBelow}；操作者：${readName(req)} @ ${now()}`);
    return { ok: true, rules, points: pointsMap(rules) };
  });

  /* ---------- 数据归档查询与导出（2026-10-29 A4：请假/违规/课堂三数据集，日期范围筛选；CSV 由前端组包） ---------- */
  app.get('/api/admin/archive', async (req, res) => {
    if (!guardAdmin(req, res)) return;
    const dataset = String(req.query.dataset || 'leaves');
    const from = String(req.query.from || '');
    const to = String(req.query.to || '');
    if (!['leaves', 'violations', 'sessions'].includes(dataset)) {
      return res.code(400).send({ ok: false, message: '未知数据集（支持 leaves/violations/sessions）' });
    }
    for (const d of [from, to]) {
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.code(400).send({ ok: false, message: '日期格式须为 YYYY-MM-DD' });
    }
    const conds = [];
    const args = [];
    const addRange = (col) => {
      if (from) { conds.push(`date(${col}) >= date(?)`); args.push(from); }
      if (to) { conds.push(`date(${col}) <= date(?)`); args.push(to); }
    };
    const where = () => (conds.length ? 'WHERE ' + conds.join(' AND ') : '');
    const fmtTime = (t) => (t || '').slice(0, 16).replace('T', ' ');
    let cols = [];
    let rows = [];
    if (dataset === 'leaves') {
      addRange('l.date_from');
      cols = ['编号', '学生', '类型', '开始', '结束', '状态', '事由', '提交时间'];
      rows = db.prepare(`SELECT l.id, l.student_name, l.type,
          l.date_from || ' ' || l.time_from AS range_from, l.date_to || ' ' || l.time_to AS range_to,
          l.status, l.reason, l.created_at
        FROM leaves l ${where()} ORDER BY l.id DESC LIMIT 5000`).all(...args)
        .map((r) => [r.id, r.student_name, r.type, r.range_from, r.range_to, r.status, r.reason || '', fmtTime(r.created_at)]);
    } else if (dataset === 'violations') {
      addRange('date(v.created_at)');
      cols = ['编号', '学生', '班级', '类型', '分值', '来源', '状态', '操作人', '备注', '登记时间'];
      rows = db.prepare(`SELECT v.id, s.name AS student_name, c.name AS class_name, v.type, v.points, v.source, v.cancelled, v.operator, v.note, v.created_at
        FROM violation_records v JOIN students s ON s.id = v.student_id LEFT JOIN classes c ON c.id = s.class_id
        ${where()} ORDER BY v.id DESC LIMIT 5000`).all(...args)
        .map((r) => [r.id, r.student_name, r.class_name || '未分配', r.type, r.points, r.source === 'auto' ? '课堂自动' : '手动登记', r.cancelled ? '已撤销' : '生效', r.operator || '', r.note || '', fmtTime(r.created_at)]);
    } else {
      addRange('s.date');
      cols = ['编号', '班级', '教师', '课程', '日期', '时段', '状态', '已签到', '请假', '旷课'];
      rows = db.prepare(`SELECT s.id, c.name AS class_name, s.teacher_name, s.course_name, s.date,
          s.start_time || '-' || s.end_time AS time_range, s.status,
          (SELECT COUNT(*) FROM sign_records r WHERE r.session_id = s.id AND r.status IN ('signed','signed_by_teacher')) AS signed_cnt,
          (SELECT COUNT(*) FROM sign_records r WHERE r.session_id = s.id AND r.status = 'leave') AS leave_cnt,
          (SELECT COUNT(*) FROM sign_records r WHERE r.session_id = s.id AND r.status = 'absent') AS absent_cnt
        FROM lesson_sessions s LEFT JOIN classes c ON c.id = s.class_id
        ${where()} ORDER BY s.id DESC LIMIT 5000`).all(...args)
        .map((r) => [r.id, r.class_name || '—', r.teacher_name, r.course_name || '—', r.date, r.time_range, r.status === 'open' ? '进行中' : '已结束', r.signed_cnt, r.leave_cnt, r.absent_cnt]);
    }
    return { ok: true, dataset, cols, rows };
  });
}
