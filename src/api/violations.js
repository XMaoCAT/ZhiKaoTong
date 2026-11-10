import { db, now } from '../core/db.js';
import { readRole, readName } from '../core/http-utils.js';

/**
 * 违规积分 API（开发计划 §9.1；D2 口径：旷课 -5 / 旷寝 -10，预警线 60；D6：学生处+导员均可登记）
 * ---------------------------------------------------------------------------
 * violation_records：违规流水（auto=课堂自动 / manual=学生处·导员登记）；学生当前分存 students.score。
 * 扣分/还分必须与 violation 行同事务——统一走本文件导出的 applyViolation/revokeViolation 单源函数
 * （跨文件事务接缝：better-sqlite3 db.transaction 支持嵌套调用子函数，传同一 tx 上下文；
 * workflow.js 的 absence-cancel 与 record-modify 执行器一律调用 revokeViolation，严禁内联复制——踩坑 #05 禁令）。
 *
 * 考勤规则（2026-10-29 A3 可配置化）：单源存 settings 表 key='attendance_rules'
 * （{ absencePoints, dormPoints, warnBelow }，IT 管理员在系统管理修改；缺省/非法回落 D2 原口径 5/10/60）。
 * 前端不再复制 POINTS/WARN_BELOW 常量——一律从 GET 响应的 points/warnBelow 字段动态取值。
 *
 * 端点：
 *   POST /api/violations                     → 手动登记（旷寝主入口，旷课亦可补登；写：学生处/导员/IT）
 *   GET  /api/violations?studentId=&type=&low=1 → 流水 / 低分名单（score < warnBelow；响应含 points/warnBelow）
 *   GET  /api/violations/summary             → 各班汇总（导员仅见绑定班级 D8；学生处/教务处/IT 全量）
 *   GET  /api/violations/rules               → 当前考勤规则（非学生登录角色；登记弹窗/预警展示动态取值）
 * 角色头：x-zkt-role / x-zkt-name（URI 编码）
 */

/** 考勤规则默认值（D2 原口径；settings 表无配置/配置非法时兑底） */
export const DEFAULT_RULES = { absencePoints: 5, dormPoints: 10, warnBelow: 60 };

/** 当前考勤规则（单源：settings 表 attendance_rules 行；每次直查——SQLite 快且免缓存失效问题） */
export function getAttendanceRules() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'attendance_rules'").get();
    if (row) {
      const v = JSON.parse(row.value);
      const r = { absencePoints: Math.round(Number(v.absencePoints)), dormPoints: Math.round(Number(v.dormPoints)), warnBelow: Math.round(Number(v.warnBelow)) };
      if (Object.values(r).every((n) => Number.isFinite(n) && n >= 1 && n <= 100)) return r;
    }
  } catch { /* 兑底默认 */ }
  return { ...DEFAULT_RULES };
}

/** 写入考勤规则（admin-data.js 系统管理属地调用；单源 setter） */
export function setAttendanceRules(rules) {
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('attendance_rules', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(JSON.stringify(rules), now());
}

/** 规则 → 前端展示用分值映射（存负值与 D2 历史一致） */
export const pointsMap = (rules) => ({ '旷课': -rules.absencePoints, '旷寝': -rules.dormPoints });

/** 违规类型 → 当前分值（未知类型返回 null） */
function pointsFor(type, rules = getAttendanceRules()) {
  if (type === '旷课') return -rules.absencePoints;
  if (type === '旷寝') return -rules.dormPoints;
  return null;
}

db.exec(`
CREATE TABLE IF NOT EXISTS violation_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('旷课','旷寝')),
  points INTEGER NOT NULL,            -- 存负值（当前值由考勤规则 settings 动态决定）
  source TEXT NOT NULL CHECK (source IN ('auto','manual')),
  session_id INTEGER,                 -- auto 关联课堂
  note TEXT, operator TEXT,
  cancelled INTEGER DEFAULT 0,        -- absence-cancel 审批通过置 1（留痕不计分）
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_vr_student ON violation_records (student_id);
`);

/** 登记违规并扣分（单源事务；manual 登记与课堂 auto 登记共用） */
export function applyViolation({ studentId, type, source = 'manual', sessionId = null, note = '', operator = '' }) {
  const points = pointsFor(type);
  if (points == null) throw new Error(`未知违规类型：${type}`);
  const stu = db.prepare('SELECT id FROM students WHERE id = ?').get(studentId);
  if (!stu) throw new Error(`学生不存在：${studentId}`);
  let violationId = null;
  const tx = db.transaction(() => {
    const info = db.prepare(`INSERT INTO violation_records (student_id, type, points, source, session_id, note, operator, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(studentId, type, points, source, sessionId, note || null, operator || null, now());
    violationId = Number(info.lastInsertRowid);
    db.prepare('UPDATE students SET score = score + ? WHERE id = ?').run(points, studentId); // points 为负即扣分
  });
  tx();
  return { violationId, points };
}

/** 撤销违规并还分（单源事务；absence-cancel 审批与 record-modify 确认共用；幂等：已撤销返回 null） */
export function revokeViolation(violationId, operator = '', note = '') {
  const v = db.prepare('SELECT * FROM violation_records WHERE id = ?').get(Number(violationId));
  if (!v || v.cancelled) return null;
  const tx = db.transaction(() => {
    db.prepare('UPDATE violation_records SET cancelled = 1 WHERE id = ?').run(v.id);
    db.prepare('UPDATE students SET score = score - ? WHERE id = ?').run(v.points, v.student_id); // 减负数=还分
    void operator; void note;
  });
  tx();
  return { violationId: v.id, restored: -v.points };
}

/** 导员绑定班级（D8 收窄；单源查询：返回导员绑定的 class_id 数组） */
export function counselorBoundClasses(counselorName) {
  return db.prepare('SELECT class_id FROM counselor_classes WHERE counselor_name = ? ORDER BY class_id').all(counselorName).map((r) => r.class_id);
}

const rowOut = (r) => ({
  id: r.id,
  studentId: r.student_id,
  studentName: r.student_name || undefined,
  className: r.class_name || undefined,
  type: r.type,
  points: r.points,
  source: r.source,
  sessionId: r.session_id,
  note: r.note || '',
  operator: r.operator || '',
  cancelled: !!r.cancelled,
  createdAt: r.created_at,
});

export function registerViolationRoutes(app) {
  const READ_ROLES = ['学生处', '教务处', 'IT管理员']; // 导员按绑定班级收窄（D8）；学生不开放（不做边界：自查积分属"不做"清单 §17）
  const WRITE_ROLES = ['学生处', '导员', 'IT管理员'];  // D6：学生处 + 导员均可登记

  /* 手动登记（旷寝主入口；旷课亦可补登） */
  app.post('/api/violations', async (req, res) => {
    const role = readRole(req);
    if (!WRITE_ROLES.includes(role)) return res.code(403).send({ ok: false, message: '仅学生处/导员/IT管理员可登记违规' });
    const b = req.body || {};
    const studentId = String(b.studentId || '');
    const type = String(b.type || '');
    const note = String(b.note || '').trim().slice(0, 200);
    if (!/^\d{9}$/.test(studentId) || !db.prepare('SELECT id FROM students WHERE id = ?').get(studentId)) {
      return res.code(400).send({ ok: false, message: '学号无效或不存在' });
    }
    if (pointsFor(type) == null) return res.code(400).send({ ok: false, message: '违规类型须为 旷课/旷寝' });
    // 导员只能登记绑定班级学生（D8）
    if (role === '导员') {
      const stu = db.prepare('SELECT class_id FROM students WHERE id = ?').get(studentId);
      const bound = stu && db.prepare('SELECT 1 FROM counselor_classes WHERE counselor_name = ? AND class_id = ?').get(readName(req), stu.class_id);
      if (!bound) return res.code(403).send({ ok: false, message: '该学生不在您绑定的班级内（请联系教务处调整绑定）' });
    }
    try {
      const r = applyViolation({ studentId, type, source: 'manual', note, operator: readName(req) });
      console.log(`[violations] 手动登记：${studentId} ${type}（${r.points} 分）；操作者：${readName(req)} @ ${now()}`);
      return { ok: true, ...r };
    } catch (ex) {
      return res.code(400).send({ ok: false, message: ex.message });
    }
  });

  /* 流水 / 低分名单（导员按绑定班级过滤 D8） */
  app.get('/api/violations', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    if (!role) return res.code(403).send({ ok: false, message: '未登录' });
    if (role === '学生') return res.code(403).send({ ok: false, message: '积分自查暂未开放' });
    const q = req.query || {};
    const rules = getAttendanceRules();
    let scopeSql = '';
    let scopeArgs = [];
    if (role === '导员') {
      const cids = counselorBoundClasses(name);
      if (!cids.length) return { ok: true, violations: [], unbound: true, students: [], warnBelow: rules.warnBelow, points: pointsMap(rules) };
      const ph = cids.map(() => '?').join(',');
      scopeSql = `WHERE s.class_id IN (${ph})`;
      scopeArgs = cids;
    }
    // 流水（附学生名与班级名）
    let rows = [];
    const filters = [];
    const fArgs = [];
    if (q.studentId) { filters.push('v.student_id = ?'); fArgs.push(String(q.studentId)); }
    if (q.type === '旷课' || q.type === '旷寝') { filters.push('v.type = ? AND v.cancelled = 0'); fArgs.push(String(q.type)); }
    const base = `FROM violation_records v JOIN students s ON s.id = v.student_id LEFT JOIN classes c ON c.id = s.class_id ${scopeSql ? scopeSql.replace('s.class_id', 's.class_id') : ''}`;
    // scope 与 filter 组合（scope 用 s. 前缀列，与 JOIN 兼容）
    let where = scopeSql ? `${scopeSql.replace(/^WHERE/, '').trim()} ` : '';
    if (filters.length) where += (where ? 'AND ' : '') + filters.join(' AND ');
    rows = db.prepare(`SELECT v.*, s.name AS student_name, c.name AS class_name ${scopeSql ? base : 'FROM violation_records v JOIN students s ON s.id = v.student_id LEFT JOIN classes c ON c.id = s.class_id'} ${where ? 'WHERE ' + where : ''} ORDER BY v.id DESC LIMIT 300`).all(...scopeArgs, ...fArgs);

    // 低分名单（score < 预警线）
    let lowStudents = [];
    if (String(q.low || '') === '1') {
      const lowWhere = role === '导员' ? `s.score < ${rules.warnBelow} AND s.class_id IN (${counselorBoundClasses(name).map(() => '?').join(',') || 'NULL'})` : `s.score < ${rules.warnBelow}`;
      const lowArgs = role === '导员' ? counselorBoundClasses(name) : [];
      lowStudents = db.prepare(`SELECT s.id, s.name, s.score, c.name AS class_name,
          (SELECT COUNT(*) FROM violation_records vr WHERE vr.student_id = s.id AND vr.cancelled = 0) AS violation_count
        FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE ${lowWhere} ORDER BY s.score ASC`).all(...lowArgs)
        .map((s) => ({ id: s.id, name: s.name, className: s.class_name || '', score: s.score, violationCount: s.violation_count }));
    }
    return { ok: true, violations: rows.map(rowOut), students: lowStudents, warnBelow: rules.warnBelow, points: pointsMap(rules) };
  });

  /* 各班汇总（导员仅绑定班级 D8；学生处/教务处/IT 全量） */
  app.get('/api/violations/summary', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    if (!READ_ROLES.includes(role) && role !== '导员') return res.code(403).send({ ok: false, message: '仅学生处/教务处/导员/IT管理员可查看汇总' });
    const rules = getAttendanceRules();
    let classScope = '';
    const args = [];
    if (role === '导员') {
      const cids = counselorBoundClasses(name);
      if (!cids.length) return { ok: true, summary: [], unbound: true, warnBelow: rules.warnBelow, points: pointsMap(rules) };
      classScope = `WHERE c.id IN (${cids.map(() => '?').join(',')})`;
      args.push(...cids);
    }
    const summary = db.prepare(`SELECT c.id AS class_id, c.name AS class_name,
        COUNT(DISTINCT s.id) AS student_count,
        SUM(CASE WHEN s.score < ${rules.warnBelow} THEN 1 ELSE 0 END) AS low_count,
        ROUND(AVG(s.score), 1) AS avg_score,
        (SELECT COUNT(*) FROM violation_records vr JOIN students s2 ON s2.id = vr.student_id WHERE s2.class_id = c.id AND vr.cancelled = 0) AS violation_count
      FROM classes c LEFT JOIN students s ON s.class_id = c.id ${classScope}
      GROUP BY c.id ORDER BY c.id`).all(...args)
      .map((r) => ({ classId: r.class_id, className: r.class_name, studentCount: r.student_count, lowCount: r.low_count || 0, avgScore: r.avg_score, violationCount: r.violation_count || 0 }));
    return { ok: true, summary, warnBelow: rules.warnBelow, points: pointsMap(rules) };
  });

  /* 当前考勤规则（2026-10-29 A3：登记弹窗/预警展示动态取值；非学生登录角色可读） */
  app.get('/api/violations/rules', async (req, res) => {
    const role = readRole(req);
    if (!role) return res.code(403).send({ ok: false, message: '未登录' });
    if (role === '学生') return res.code(403).send({ ok: false, message: '积分自查暂未开放' });
    const rules = getAttendanceRules();
    return { ok: true, rules, points: pointsMap(rules) };
  });
}
