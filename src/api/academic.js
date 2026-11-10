import { db, now } from '../core/db.js';
import { parseRow } from './leaves.js';
import { readRole, readName } from '../core/http-utils.js';
import { REQUEST_ROLES, REVIEW_ROLES } from '../core/consts.js';
import { notifyStudentsChanged } from './workflow.js';

/**
 * 教务管理 API（学号系统 / 班级分类夹 / 教师账号与授课班级）：
 * - GET  /api/academic/students            → 全部学生（姓名+9位学号+班级）；教务处/学生处/IT管理员
 * - GET  /api/academic/classes              → 班级列表（含人数）；教务处/学生处/IT管理员
 * - POST /api/academic/classes  { name }    → 新建班级（名称唯一；学生处直改通道，教务处走申请）；学生处/IT管理员（majorId 入参属 P5，见开发计划 §6.1 D1a）
 * - POST /api/academic/classes/:id/students { ids: [] } → 批量把学生划入班级；学生处/IT管理员
 * - POST /api/academic/classes/:id/members { removeIds, addIds } → 编辑班级成员统一提交；学生处/IT管理员
 * - POST /api/academic/classes/:id/dissolve { reason } → 解散班级（原因必填）；学生处/IT管理员
 * - POST /api/academic/classes/:id/rename { name }   → 班级重命名（学生处/IT 直改；教务处走 class-rename 申请）；学生处/IT管理员
 * - GET  /api/academic/teachers             → 教师列表（teachers 表动态账号 + 授课班级 id）；教务处/学生处/IT管理员（2026-10-24 账号动态化）
 * - POST /api/academic/teachers  { name }   → 添加教师（姓名唯一，禁与管理账号重名）；教务处/IT管理员（C2 直改）
 * - POST /api/academic/teachers/:name/classes { classIds: [] } → 设置教师授课班级（整体替换）；教务处/IT管理员
 * - GET  /api/academic/my-classes           → 教师视角：授课班级 + 学生名册 + 各自请假记录；仅教师
 *
 * 权限模型（2026-10-23 P2 守卫矩阵，开发计划 §5.1；C1 口径：教务处写操作全部走申请）：
 *   READ_ROLES（读）= 教务处/学生处/IT管理员；WRITE_ROLES（学生数据写）= 学生处/IT管理员；
 *   TEACHER_ADMIN（教师阵营管理：添加教师/授课分配）= 教务处/IT管理员；REQUEST/REVIEW_ROLES 见 consts.js（P3 消费）。
 * 教师只能看到自己授课班级的请假信息（/api/leaves 对教师按 teacher_classes 过滤）。
 * 角色头：x-zkt-role / x-zkt-name（均 URI 编码；SSE 场景兼容 query，见 http-utils.js）
 */

db.exec(`
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  class_id INTEGER,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS teacher_classes (
  teacher_name TEXT NOT NULL,
  class_id INTEGER NOT NULL,
  created_at TEXT,
  UNIQUE (teacher_name, class_id)
);
-- 教师账号表（2026-10-24 动态化：替代 consts.js TEACHERS 硬编码——支持教务管理添加教师/系统管理模拟数据生成）
CREATE TABLE IF NOT EXISTS teachers (
  name TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);

/* ---------- 种子（幂等）：空表时插入 ---------- */
// 教师：内置教师01/教师02（与登录回落常量一致；「生成模拟数据」可扩展至教师01-05）
if (db.prepare('SELECT COUNT(*) c FROM teachers').get().c === 0) {
  const ins = db.prepare('INSERT OR IGNORE INTO teachers (name) VALUES (?)');
  ins.run('教师01');
  ins.run('教师02');
}
// 学生：100 名（9 位学号 000000001–000000100，未分配班级）
if (db.prepare('SELECT COUNT(*) c FROM students').get().c === 0) {
  const ins = db.prepare('INSERT INTO students (id, name, class_id, created_at) VALUES (?, ?, NULL, ?)');
  const ts = now();
  for (let i = 1; i <= 100; i++) ins.run(String(i).padStart(9, '0'), `学生${String(i).padStart(3, '0')}`, ts);
}

// 旧数据迁移：leaves 表 3 位学号 → 9 位
db.exec("UPDATE leaves SET student_id = printf('%09d', CAST(student_id AS INTEGER)) WHERE length(student_id) < 9");

// 新列迁移（开发计划 §3.2，ALTER 吞错循环同 leaves.js 既有模式）：
// students.score 违规积分当前分（默认 100，预警线 60 见 violations.js）；classes.major_id 班级→专业部归属（D1，NULL=未归属）
for (const col of ['score INTEGER DEFAULT 100']) {
  try { db.exec(`ALTER TABLE students ADD COLUMN ${col}`); } catch { /* 列已存在 */ }
}
for (const col of ['major_id INTEGER']) {
  try { db.exec(`ALTER TABLE classes ADD COLUMN ${col}`); } catch { /* 列已存在 */ }
}

// ---- 守卫矩阵（开发计划 §5.1；C1 口径：教务处写操作全部走申请，直改仅学生处/IT） ----
const READ_ROLES = ['教务处', '学生处', 'IT管理员'];       // GET students/classes/teachers
const WRITE_ROLES = ['学生处', 'IT管理员'];                 // POST classes/students/members/dissolve
const TEACHER_ADMIN = ['教务处', 'IT管理员'];               // POST teachers（添加教师）/teachers/:name/classes（C2：教师阵营留教务处直改）
// REQUEST_ROLES=['教务处'] / REVIEW_ROLES=['学生处','IT管理员'] 定义于 core/consts.js（P3 workflow.js 消费）

/** 教师账号清单（单源：teachers 表；majors.js/admin-data.js 消费，踩坑 #05 禁令：严禁再硬编码副本） */
export function listTeacherNames() {
  return db.prepare('SELECT name FROM teachers ORDER BY rowid').all().map((r) => r.name);
}

/** 管理账号名（与登录群组同名；添加教师时禁与之重名——否则 staffAccountToGroup 群组映射歧义） */
export const MANAGEMENT_ACCOUNTS = ['教务处', '学生处', '导员', 'IT管理员'];

const className = (id) => { const r = db.prepare('SELECT name FROM classes WHERE id = ?').get(id); return r ? r.name : null; };

export function registerAcademicRoutes(app) {
  const guardRead = (req, res) => {
    if (!READ_ROLES.includes(readRole(req))) {
      res.code(403).send({ ok: false, message: '仅教务处/学生处/IT管理员可查看教务数据' });
      return false;
    }
    return true;
  };
  const guardWrite = (req, res) => {
    if (!WRITE_ROLES.includes(readRole(req))) {
      res.code(403).send({ ok: false, message: '仅学生处/IT管理员可直接修改学生数据，教务处请提交申请' });
      return false;
    }
    return true;
  };
  const guardTeacher = (req, res) => {
    if (!TEACHER_ADMIN.includes(readRole(req))) {
      res.code(403).send({ ok: false, message: '仅教务处/IT管理员可管理教师授课数据' });
      return false;
    }
    return true;
  };

  app.get('/api/academic/students', async (req, res) => {
    if (!guardRead(req, res)) return;
    const rows = db.prepare('SELECT s.id, s.name, s.class_id, c.name AS class_name FROM students s LEFT JOIN classes c ON c.id = s.class_id ORDER BY s.id').all();
    return { ok: true, students: rows.map((r) => ({ id: r.id, name: r.name, classId: r.class_id, className: r.class_name || '' })) };
  });

  app.get('/api/academic/classes', async (req, res) => {
    if (!guardRead(req, res)) return;
    const rows = db.prepare('SELECT c.id, c.name, COUNT(s.id) AS cnt FROM classes c LEFT JOIN students s ON s.class_id = c.id GROUP BY c.id ORDER BY c.id').all();
    const unassigned = db.prepare('SELECT COUNT(*) c FROM students WHERE class_id IS NULL').get().c;
    return { ok: true, classes: rows.map((r) => ({ id: r.id, name: r.name, count: r.cnt })), unassigned };
  });

  app.post('/api/academic/classes', async (req, res) => {
    if (!guardWrite(req, res)) return;
    const name = String((req.body || {}).name || '').trim().slice(0, 30);
    if (!name) return res.code(400).send({ ok: false, message: '请填写班级名称' });
    if (db.prepare('SELECT id FROM classes WHERE name = ?').get(name)) return res.code(400).send({ ok: false, message: '班级名称已存在' });
    // 专业部归属（D1a）：majorId 可选；非法 id 400 拦截（NULL=未归属）
    const majorId = (req.body || {}).majorId;
    if (majorId != null) {
      if (!Number.isInteger(Number(majorId)) || !db.prepare('SELECT id FROM major_departments WHERE id = ?').get(Number(majorId))) {
        return res.code(400).send({ ok: false, message: '归属专业部不存在' });
      }
    }
    const info = db.prepare('INSERT INTO classes (name, major_id, created_at) VALUES (?, ?, ?)').run(name, majorId != null ? Number(majorId) : null, now());
    notifyStudentsChanged('class-created', `新建班级「${name}」`, `${readName(req)} 直改（学生处通道）`);
    return { ok: true, id: Number(info.lastInsertRowid), name };
  });

  app.post('/api/academic/classes/:id/students', async (req, res) => {
    if (!guardWrite(req, res)) return;
    const cid = Number(req.params.id);
    if (!db.prepare('SELECT id FROM classes WHERE id = ?').get(cid)) return res.code(404).send({ ok: false, message: '班级不存在' });
    const ids = Array.isArray((req.body || {}).ids) ? [...new Set((req.body.ids).map(String))] : [];
    if (!ids.length) return res.code(400).send({ ok: false, message: '未选择学生' });
    const invalid = ids.filter((id) => !/^\d{9}$/.test(id) || !db.prepare('SELECT id FROM students WHERE id = ?').get(id));
    if (invalid.length) return res.code(400).send({ ok: false, message: `学号无效或不存在：${invalid.slice(0, 5).join('、')}${invalid.length > 5 ? '…' : ''}` });
    const upd = db.prepare('UPDATE students SET class_id = ? WHERE id = ?');
    for (const id of ids) upd.run(cid, id);
    notifyStudentsChanged('students-changed', `班级「${className(cid)}」加入 ${ids.length} 名学生`, `${readName(req)} 直改（学生处通道）`);
    return { ok: true, added: ids.length };
  });

  // 编辑班级成员：移出（勾选→还原未分配）与加入（勾选未分配→划入）统一提交（2026-10-22 用户需求）
  app.post('/api/academic/classes/:id/members', async (req, res) => {
    if (!guardWrite(req, res)) return;
    const cid = Number(req.params.id);
    const cls = db.prepare('SELECT id, name FROM classes WHERE id = ?').get(cid);
    if (!cls) return res.code(404).send({ ok: false, message: '班级不存在' });
    const removeIds = [...new Set((Array.isArray((req.body || {}).removeIds) ? req.body.removeIds : []).map(String))];
    const addIds = [...new Set((Array.isArray((req.body || {}).addIds) ? req.body.addIds : []).map(String))];
    if (!removeIds.length && !addIds.length) return res.code(400).send({ ok: false, message: '未做任何勾选更改' });
    // 移出仅对当前班级内学生生效；加入需学号有效
    const inClass = new Set(db.prepare('SELECT id FROM students WHERE class_id = ?').all(cid).map((r) => r.id));
    const badRemove = removeIds.filter((id) => !inClass.has(id));
    if (badRemove.length) return res.code(400).send({ ok: false, message: `以下学生不在该班级：${badRemove.slice(0, 5).join('、')}${badRemove.length > 5 ? '…' : ''}` });
    const badAdd = addIds.filter((id) => !/^\d{9}$/.test(id) || !db.prepare('SELECT id FROM students WHERE id = ?').get(id));
    if (badAdd.length) return res.code(400).send({ ok: false, message: `学号无效或不存在：${badAdd.slice(0, 5).join('、')}${badAdd.length > 5 ? '…' : ''}` });
    const clear = db.prepare('UPDATE students SET class_id = NULL WHERE id = ? AND class_id = ?');
    const join = db.prepare('UPDATE students SET class_id = ? WHERE id = ?');
    const tx = db.transaction(() => {
      removeIds.forEach((id) => clear.run(id, cid));
      addIds.forEach((id) => join.run(cid, id));
    });
    tx();
    console.log(`[academic] 编辑班级「${cls.name}」#${cid}：移出 ${removeIds.length} 人、加入 ${addIds.length} 人`);
    notifyStudentsChanged('students-changed', `班级「${cls.name}」成员变更：移出 ${removeIds.length} 人、加入 ${addIds.length} 人`, `${readName(req)} 直改（学生处通道）`);
    return { ok: true, removed: removeIds.length, added: addIds.length };
  });

  // 解散班级：学生全部还原未分配 + 清除教师授课关联 + 删除班级；解散原因必填（2026-10-22 用户需求）
  app.post('/api/academic/classes/:id/dissolve', async (req, res) => {    if (!guardWrite(req, res)) return;
    const cid = Number(req.params.id);
    const cls = db.prepare('SELECT id, name FROM classes WHERE id = ?').get(cid);
    if (!cls) return res.code(404).send({ ok: false, message: '班级不存在' });
    const reason = String((req.body || {}).reason || '').trim().slice(0, 200);
    if (!reason) return res.code(400).send({ ok: false, message: '请填写解散原因' });
    let released = 0;
    const tx = db.transaction(() => {
      const info = db.prepare('UPDATE students SET class_id = NULL WHERE class_id = ?').run(cid);
      released = info.changes;
      db.prepare('DELETE FROM teacher_classes WHERE class_id = ?').run(cid);
      db.prepare('DELETE FROM classes WHERE id = ?').run(cid);
    });
    tx();
    console.log(`[academic] 解散班级「${cls.name}」#${cid}：还原 ${released} 名学生至未分配；原因：${reason}；操作者：${readName(req)} @ ${now()}`);
    notifyStudentsChanged('class-dissolved', `解散班级「${cls.name}」（${released} 名学生还原未分配）`, `原因：${reason}；${readName(req)} 直改（学生处通道）`);
    return { ok: true, released, reason };
  });

  // 班级重命名（2026-10-29 C1：学生处/IT 直改；教务处走 class-rename 申请→学生处审批）
  app.post('/api/academic/classes/:id/rename', async (req, res) => {
    if (!guardWrite(req, res)) return;
    const cid = Number(req.params.id);
    const cls = db.prepare('SELECT id, name FROM classes WHERE id = ?').get(cid);
    if (!cls) return res.code(404).send({ ok: false, message: '班级不存在' });
    const name = String((req.body || {}).name || '').trim().slice(0, 30);
    if (!name) return res.code(400).send({ ok: false, message: '请填写新班级名称' });
    if (name === cls.name) return res.code(400).send({ ok: false, message: '新名称与原名称相同' });
    if (db.prepare('SELECT id FROM classes WHERE name = ?').get(name)) return res.code(400).send({ ok: false, message: '班级名称已存在' });
    db.prepare('UPDATE classes SET name = ? WHERE id = ?').run(name, cid);
    console.log(`[academic] 重命名班级「${cls.name}」#${cid} →「${name}」；操作者：${readName(req)} @ ${now()}`);
    notifyStudentsChanged('class-renamed', `班级「${cls.name}」更名为「${name}」`, `${readName(req)} 直改（学生处通道）`);
    return { ok: true, id: cid, from: cls.name, name };
  });

  app.get('/api/academic/teachers', async (req, res) => {
    if (!guardRead(req, res)) return;
    const teachers = listTeacherNames().map((name) => ({
      name,
      classIds: db.prepare('SELECT class_id FROM teacher_classes WHERE teacher_name = ? ORDER BY class_id').all(name).map((r) => r.class_id),
    }));
    return { ok: true, teachers };
  });

  // 添加教师（2026-10-24 用户需求：教务管理→教师管理支持添加教师；姓名唯一，禁与管理账号重名）
  app.post('/api/academic/teachers', async (req, res) => {
    if (!guardTeacher(req, res)) return;
    const name = String((req.body || {}).name || '').trim().slice(0, 30);
    if (!name || name.length < 2) return res.code(400).send({ ok: false, message: '教师姓名至少 2 个字' });
    if (MANAGEMENT_ACCOUNTS.includes(name)) return res.code(400).send({ ok: false, message: '该名称为管理账号，不可用作教师姓名' });
    if (db.prepare('SELECT 1 FROM teachers WHERE name = ?').get(name)) return res.code(400).send({ ok: false, message: `教师「${name}」已存在` });
    db.prepare('INSERT INTO teachers (name) VALUES (?)').run(name);
    console.log(`[academic] 添加教师「${name}」；操作者：${readName(req)} @ ${now()}`);
    return { ok: true, name };
  });

  app.post('/api/academic/teachers/:name/classes', async (req, res) => {
    if (!guardTeacher(req, res)) return;
    const name = String(req.params.name || '');
    if (!db.prepare('SELECT 1 FROM teachers WHERE name = ?').get(name)) return res.code(404).send({ ok: false, message: '教师不存在' });
    const classIds = [...new Set((Array.isArray((req.body || {}).classIds) ? req.body.classIds : []).map(Number))];
    for (const cid of classIds) {
      if (!db.prepare('SELECT id FROM classes WHERE id = ?').get(cid)) return res.code(400).send({ ok: false, message: `班级不存在（id=${cid}）` });
    }
    db.prepare('DELETE FROM teacher_classes WHERE teacher_name = ?').run(name);
    const ins = db.prepare('INSERT INTO teacher_classes (teacher_name, class_id, created_at) VALUES (?, ?, ?)');
    for (const cid of classIds) ins.run(name, cid, now());
    return { ok: true, teacher: name, classIds };
  });

  // 教师视角：授课班级 + 学生名册 + 各自请假记录
  app.get('/api/academic/my-classes', async (req, res) => {
    const role = readRole(req);
    if (role !== '教师') return res.code(403).send({ ok: false, message: '仅教师可查看授课班级' });
    const name = readName(req);
    const cids = db.prepare('SELECT class_id FROM teacher_classes WHERE teacher_name = ? ORDER BY class_id').all(name).map((r) => r.class_id);
    const classes = cids.map((cid) => {
      const students = db.prepare('SELECT id, name FROM students WHERE class_id = ? ORDER BY id').all(cid)
        .map((s) => ({ id: s.id, name: s.name, leaves: db.prepare('SELECT * FROM leaves WHERE student_id = ? ORDER BY id DESC').all(s.id).map(parseRow) }));
      return { classId: cid, className: className(cid), students };
    });
    return { ok: true, classes };
  });
}
