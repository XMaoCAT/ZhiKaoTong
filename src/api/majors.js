import { db, now } from '../core/db.js';
import { readRole, readName } from '../core/http-utils.js';
import { REQUEST_ROLES, REVIEW_ROLES } from '../core/consts.js';
import { listTeacherNames } from './academic.js';

/**
 * 专业部管理 API（开发计划 §6.1；P4 先实现 GET 供建班归属 chips（D1a），写端点群属 P5）
 * ---------------------------------------------------------------------------
 * 表结构：major_departments（专业部）/ teacher_majors（教师↔专业部多对多，
 * 账号名字符串外键沿用 teacher_classes 模式——教师账号体系扩容是既有待办，届时统一迁移）/
 * counselor_classes（导员→班级绑定，D7：教务处维护；导员审批与课堂状态均按此收窄 D8）。
 *
 * 端点：
 *   GET  /api/majors（P4）                      → 专业部列表（含 teachers/classIds/unassignedTeachers）；读：学生处/教务处/IT
 *   POST /api/majors { name }（P5）             → 新建专业部（唯一 400）；TEACHER_ADMIN
 *   POST /api/majors/:id/members（P5）          → 编辑部内教师（removeNames/addNames 多对多）；TEACHER_ADMIN
 *   POST /api/majors/:id/dissolve { reason }（P5） → 解散专业部（班级归属置 NULL）；TEACHER_ADMIN
 *   POST /api/majors/counselor/:name/classes（P5） → 导员班级绑定（整体替换，D7）；TEACHER_ADMIN
 *
 * 班级归属（classes.major_id，D1a）：学生处建班时指定、教务处申请建班 payload 同带；NULL=未归属。
 */

db.exec(`
CREATE TABLE IF NOT EXISTS major_departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS teacher_majors (
  teacher_name TEXT NOT NULL,
  major_id INTEGER NOT NULL,
  PRIMARY KEY (teacher_name, major_id)
);
-- 导员→班级绑定（D7：教务处维护；导员审批与课堂状态均按此收窄，D8）
CREATE TABLE IF NOT EXISTS counselor_classes (
  counselor_name TEXT NOT NULL,
  class_id INTEGER NOT NULL,
  PRIMARY KEY (counselor_name, class_id)
);
`);

/* ---------- 种子数据（开发计划 §3.8；全部幂等，重复启动零副作用） ---------- */
// 专业部：计算机系 + 外语系（外语系无班级，演示空部）
db.exec(`
INSERT OR IGNORE INTO major_departments (name) VALUES ('计算机系'), ('外语系');
`);

// 教师归属：教师01+教师02 → 计算机系；教师02 → 外语系（验证一人多部）
{
  const cs = db.prepare('SELECT id FROM major_departments WHERE name = ?').get('计算机系');
  const fl = db.prepare('SELECT id FROM major_departments WHERE name = ?').get('外语系');
  if (cs && fl) {
    const ins = db.prepare('INSERT OR IGNORE INTO teacher_majors (teacher_name, major_id) VALUES (?, ?)');
    ins.run('教师01', cs.id);
    ins.run('教师02', cs.id);
    ins.run('教师02', fl.id); // 一人多部
  }
}

// 班级归属：计算机2301 → 计算机系（仅未归属时写入，不覆盖用户后续调整）
{
  const cs = db.prepare('SELECT id FROM major_departments WHERE name = ?').get('计算机系');
  if (cs) db.prepare("UPDATE classes SET major_id = ? WHERE name = '计算机2301' AND major_id IS NULL").run(cs.id);
}

// 导员绑定：导员 → 计算机2301 班（D7/D8 审批收窄验证）
{
  const cls = db.prepare("SELECT id FROM classes WHERE name = '计算机2301'").get();
  if (cls) db.prepare('INSERT OR IGNORE INTO counselor_classes (counselor_name, class_id) VALUES (?, ?)').run('导员', cls.id);
}

/** 专业部写端点群（P5，TEACHER_ADMIN=['教务处','IT管理员'] 守卫，C2：教师阵营管理留教务处直改） */
export function registerMajorsRoutes(app) {
  const TEACHER_ADMIN = ['教务处', 'IT管理员'];
  const guard = (req, res) => {
    if (!TEACHER_ADMIN.includes(readRole(req))) {
      res.code(403).send({ ok: false, message: '仅教务处/IT管理员可管理专业部数据' });
      return false;
    }
    return true;
  };

  // 专业部列表（P4：建班归属 chips 数据源；读：学生处/教务处/IT）+ 导员绑定（P5：教师 pane 导员绑定区数据）
  app.get('/api/majors', async (req, res) => {
    const role = readRole(req);
    if (!['学生处', '教务处', 'IT管理员'].includes(role)) {
      return res.code(403).send({ ok: false, message: '仅学生处/教务处/IT管理员可查看专业部数据' });
    }
    const majors = db.prepare('SELECT * FROM major_departments ORDER BY id').all().map((m) => ({
      id: m.id,
      name: m.name,
      teachers: db.prepare('SELECT teacher_name FROM teacher_majors WHERE major_id = ? ORDER BY teacher_name').all(m.id).map((r) => r.teacher_name),
      classIds: db.prepare('SELECT id FROM classes WHERE major_id = ? ORDER BY id').all(m.id).map((r) => r.id),
    }));
    const assigned = new Set(db.prepare('SELECT teacher_name FROM teacher_majors').all().map((r) => r.teacher_name));
    // 导员绑定列表（P5：教师 pane 导员绑定区数据源；导员账号固定单一，空绑定也返回供编辑）
    const teachers = listTeacherNames(); // 动态教师（teachers 表单源，踩坑 #05：严禁硬编码副本）
    const counselors = ['导员'].map((name) => ({
      name,
      classIds: db.prepare('SELECT class_id FROM counselor_classes WHERE counselor_name = ? ORDER BY class_id').all(name).map((r) => r.class_id),
    }));
    return { ok: true, majors, unassignedTeachers: teachers.filter((t) => !assigned.has(t)), counselors };
  });

  // 新建专业部（唯一 400）
  app.post('/api/majors', async (req, res) => {
    if (!guard(req, res)) return;
    const name = String((req.body || {}).name || '').trim().slice(0, 30);
    if (!name) return res.code(400).send({ ok: false, message: '请填写专业部名称' });
    if (db.prepare('SELECT id FROM major_departments WHERE name = ?').get(name)) return res.code(400).send({ ok: false, message: '专业部名称已存在' });
    const info = db.prepare('INSERT INTO major_departments (name, created_at) VALUES (?, ?)').run(name, now());
    console.log(`[majors] 新建专业部「${name}」#${info.lastInsertRowid}；操作者：${readName(req)} @ ${now()}`);
    return { ok: true, id: Number(info.lastInsertRowid), name };
  });

  // 编辑部内教师（多对多：removeNames/addNames，事务统一提交；addNames 含他部教师合法）
  app.post('/api/majors/:id/members', async (req, res) => {
    if (!guard(req, res)) return;
    const mid = Number(req.params.id);
    const major = db.prepare('SELECT id, name FROM major_departments WHERE id = ?').get(mid);
    if (!major) return res.code(404).send({ ok: false, message: '专业部不存在' });
    const removeNames = [...new Set((Array.isArray((req.body || {}).removeNames) ? req.body.removeNames : []).map(String))];
    const addNames = [...new Set((Array.isArray((req.body || {}).addNames) ? req.body.addNames : []).map(String))];
    if (!removeNames.length && !addNames.length) return res.code(400).send({ ok: false, message: '未做任何勾选更改' });
    const inMajor = new Set(db.prepare('SELECT teacher_name FROM teacher_majors WHERE major_id = ?').all(mid).map((r) => r.teacher_name));
    const badRemove = removeNames.filter((n) => !inMajor.has(n));
    if (badRemove.length) return res.code(400).send({ ok: false, message: `以下教师不在该专业部：${badRemove.join('、')}` });
    const badAdd = addNames.filter((n) => !listTeacherNames().includes(n));
    if (badAdd.length) return res.code(400).send({ ok: false, message: `教师账号无效：${badAdd.join('、')}` });
    const tx = db.transaction(() => {
      removeNames.forEach((n) => db.prepare('DELETE FROM teacher_majors WHERE teacher_name = ? AND major_id = ?').run(n, mid));
      addNames.forEach((n) => db.prepare('INSERT OR IGNORE INTO teacher_majors (teacher_name, major_id) VALUES (?, ?)').run(n, mid));
    });
    tx();
    console.log(`[majors] 编辑专业部「${major.name}」#${mid}：移出 ${removeNames.length} 人、加入 ${addNames.length} 人；操作者：${readName(req)} @ ${now()}`);
    return { ok: true, removed: removeNames.length, added: addNames.length };
  });

  // 解散专业部（删部+清教师关联+班级归属置 NULL，事务+原因留痕）
  app.post('/api/majors/:id/dissolve', async (req, res) => {
    if (!guard(req, res)) return;
    const mid = Number(req.params.id);
    const major = db.prepare('SELECT id, name FROM major_departments WHERE id = ?').get(mid);
    if (!major) return res.code(404).send({ ok: false, message: '专业部不存在' });
    const reason = String((req.body || {}).reason || '').trim().slice(0, 200);
    if (!reason) return res.code(400).send({ ok: false, message: '请填写解散原因' });
    let releasedClasses = 0;
    const tx = db.transaction(() => {
      releasedClasses = db.prepare('UPDATE classes SET major_id = NULL WHERE major_id = ?').run(mid).changes;
      db.prepare('DELETE FROM teacher_majors WHERE major_id = ?').run(mid);
      db.prepare('DELETE FROM major_departments WHERE id = ?').run(mid);
    });
    tx();
    console.log(`[majors] 解散专业部「${major.name}」#${mid}：${releasedClasses} 个班级归属置空；原因：${reason}；操作者：${readName(req)} @ ${now()}`);
    return { ok: true, releasedClasses, reason };
  });

  // 导员班级绑定（D7：整体替换，复用 teacher_classes 同模式；教师 pane 导员绑定区调用）
  app.post('/api/majors/counselor/:name/classes', async (req, res) => {
    if (!guard(req, res)) return;
    const name = String(req.params.name || '');
    if (name !== '导员') return res.code(404).send({ ok: false, message: '导员账号不存在' });
    const classIds = [...new Set((Array.isArray((req.body || {}).classIds) ? req.body.classIds : []).map(Number))];
    for (const cid of classIds) {
      if (!db.prepare('SELECT id FROM classes WHERE id = ?').get(cid)) return res.code(400).send({ ok: false, message: `班级不存在（id=${cid}）` });
    }
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM counselor_classes WHERE counselor_name = ?').run(name);
      const ins = db.prepare('INSERT INTO counselor_classes (counselor_name, class_id) VALUES (?, ?)');
      classIds.forEach((cid) => ins.run(name, cid));
    });
    tx();
    console.log(`[majors] 导员绑定更新：${name} → 班级 ${classIds.join(',') || '（清空）'}；操作者：${readName(req)} @ ${now()}`);
    return { ok: true, counselor: name, classIds };
  });
  void now;
}
