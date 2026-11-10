import { db, now } from '../core/db.js';
import { readRole, readName } from '../core/http-utils.js';
import { pub } from '../core/pub.js';

/**
 * 课堂管理 API（开发计划 §8.1）
 * ---------------------------------------------------------------------------
 * 三表：lesson_sessions（open/ended）/ sign_records（signed/absent/leave/signed_by_teacher，UNIQUE(session,student)）/
 * classroom_events（score/absence/pick/absence-cancelled/status-override 事件流）。
 *
 * 端点（写限教师本人 session + IT；读：教师本人/教务处/学生[本班 open]）：
 *   POST   /api/classroom/sessions                       → 发起课堂（事务：INSERT open + 预置请假 sign_records(leave) + publishToClass）
 *   POST   /api/classroom/sessions/:id/sign              → 学生签到（code 模式口令校验 400）
 *   GET    /api/classroom/sessions/:id                   → 详情（三类名单+事件流+计数；教师面板 3s 轮询）
 *   POST   /api/classroom/sessions/:id/end               → 结束（publishToRole 导员+教务处）
 *   POST   /api/classroom/sessions/:id/proxy-sign        → 教师代签（signed_by_teacher/proxy）
 *   POST   /api/classroom/sessions/:id/score             → 加减分（delta ∈ ±1/±2）
 *   POST   /api/classroom/sessions/:id/pick              → 随人批量（studentIds[]）
 *   POST   /api/classroom/sessions/:id/absence           → 记旷课（事务：violation + 扣分 + sign_records(absent) + event）
 *   DELETE /api/classroom/sessions/:id/absence/:studentId → open 期撤销还分；ended 期 409 引导走审批
 *   GET    /api/classroom/sessions?teacher=&date=&all=   → 历史列表（教师本人/教务/IT）
 *   GET    /api/classroom/sessions?classId=&open=1       → 学生进行中签到卡（本班 open session + 本人签到态）
 */

db.exec(`
CREATE TABLE IF NOT EXISTS lesson_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id INTEGER,                  -- 可空（手动发起无关联课）
  class_id INTEGER NOT NULL,
  teacher_name TEXT NOT NULL,
  course_name TEXT,
  date TEXT NOT NULL,                 -- YYYY-MM-DD
  start_time TEXT, end_time TEXT,     -- 手动发起默认 now+45min 可改
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','ended')),
  sign_mode TEXT CHECK (sign_mode IN ('code','click')),
  sign_code TEXT,                     -- code 模式 4 位口令
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  ended_at TEXT
);
CREATE TABLE IF NOT EXISTS sign_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  student_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('signed','absent','leave','signed_by_teacher')),
  method TEXT,                        -- 'code'|'click'|'proxy'|'leave-auto'|'absent-mark'
  signed_at TEXT,
  UNIQUE (session_id, student_id)
);
CREATE TABLE IF NOT EXISTS classroom_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  student_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('score','absence','pick','absence-cancelled','status-override')),
  delta INTEGER, note TEXT, operator TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_cs_session ON classroom_events (session_id);
`);

const className = (id) => { const r = db.prepare('SELECT name FROM classes WHERE id = ?').get(id); return r ? r.name : `#${id}`; };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const pad2 = (n) => String(n).padStart(2, '0');

/** 行输出契约 */
const sessionOut = (s) => ({
  id: s.id,
  lessonId: s.lesson_id || null,
  classId: s.class_id,
  className: s._class_name || className(s.class_id),
  teacherName: s.teacher_name,
  courseName: s.course_name || '',
  date: s.date,
  start: s.start_time || '',
  end: s.end_time || '',
  status: s.status,
  signMode: s.sign_mode || '',
  createdAt: s.created_at,
  endedAt: s.ended_at || '',
});
const eventOut = (e) => ({ id: e.id, studentId: e.student_id, kind: e.kind, delta: e.delta, note: e.note || '', operator: e.operator || '', createdAt: e.created_at });

/** 会话详情（三类名单+事件流+计数；学生附本人签到态） */
function sessionDetail(s, viewerStudentId) {
  const signs = db.prepare('SELECT sr.*, s.name AS student_name FROM sign_records sr JOIN students s ON s.id = sr.student_id WHERE sr.session_id = ? ORDER BY sr.student_id').all(s.id);
  const by = (st) => signs.filter((r) => r.status === st).map((r) => ({ studentId: r.student_id, studentName: r.student_name, status: r.status, method: r.method, signedAt: r.signed_at }));
  const events = db.prepare('SELECT * FROM classroom_events WHERE session_id = ? ORDER BY id DESC LIMIT 100').all(s.id).map(eventOut);
  const classTotal = db.prepare('SELECT COUNT(*) c FROM students WHERE class_id = ?').get(s.class_id).c; // 应到=班级学生数（非签到记录数）
  return {
    ...sessionOut(s),
    signCode: s.sign_mode === 'code' ? s.sign_code : null, // 仅教师/教务端返回；学生端剥离
    lists: { signed: by('signed').concat(by('signed_by_teacher')), absent: by('absent'), leave: by('leave') },
    counts: {
      signed: by('signed').length + by('signed_by_teacher').length,
      absent: by('absent').length,
      leave: by('leave').length,
      total: classTotal,
    },
    events,
    mySign: viewerStudentId ? (signs.find((r) => r.student_id === viewerStudentId) || null) : null,
  };
}

export function registerClassroomRoutes(app) {
  const isOwner = (s, req) => s.teacher_name === readName(req) || readRole(req) === 'IT管理员';
  const canRead = (s, req) => {
    const role = readRole(req);
    if (role === '教务处' || role === 'IT管理员') return true;
    if (role === '教师') return s.teacher_name === readName(req);
    return false;
  };

  /* ---------- 发起课堂（预置请假 + 实时推送） ---------- */
  app.post('/api/classroom/sessions', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    if (role !== '教师' && role !== 'IT管理员') return res.code(403).send({ ok: false, message: '仅教师可发起课堂' });
    const b = req.body || {};
    const classId = Number(b.classId);
    if (!db.prepare('SELECT id FROM classes WHERE id = ?').get(classId)) return res.code(400).send({ ok: false, message: '班级不存在' });
    if (role === '教师' && !db.prepare('SELECT 1 FROM teacher_classes WHERE teacher_name = ? AND class_id = ?').get(name, classId)) {
      return res.code(403).send({ ok: false, message: '只能为本人授课班级发起课堂' });
    }
    let lesson = null;
    if (b.lessonId != null) {
      lesson = db.prepare('SELECT * FROM timetable_lessons WHERE id = ?').get(Number(b.lessonId));
      if (!lesson || lesson.class_id !== classId) return res.code(400).send({ ok: false, message: '关联课程与班级不符' });
      if (lesson.cancelled) return res.code(400).send({ ok: false, message: '该课程已停课' });
      if (role === '教师' && lesson.teacher_name !== name) return res.code(403).send({ ok: false, message: '只能关联本人课程' });
    }
    const signMode = ['code', 'click'].includes(String(b.signMode || '')) ? String(b.signMode) : 'code';
    const signCode = signMode === 'code'
      ? (b.signCode && /^\d{4}$/.test(String(b.signCode)) ? String(b.signCode) : String(Math.floor(1000 + Math.random() * 9000)))
      : null;
    const date = new Date();
    const dateStr = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    const nowMin = date.getHours() * 60 + date.getMinutes();
    const start = HHMM.test(String(b.startTime || '')) ? String(b.startTime) : `${pad2(Math.floor(nowMin / 60))}:${pad2(nowMin % 60)}`;
    const endMin = Math.min(nowMin + 45, 1320);
    const end = HHMM.test(String(b.endTime || '')) ? String(b.endTime) : `${pad2(Math.floor(endMin / 60))}:${pad2(endMin % 60)}`;
    const courseName = lesson ? lesson.course_name : (String(b.courseName || '').trim().slice(0, 40) || '课堂');

    let sessionId = null;
    const tx = db.transaction(() => {
      const info = db.prepare(`INSERT INTO lesson_sessions (lesson_id, class_id, teacher_name, course_name, date, start_time, end_time, status, sign_mode, sign_code, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`).run(lesson ? lesson.id : null, classId, name, courseName, dateStr, start, end, signMode, signCode, now());
      sessionId = Number(info.lastInsertRowid);
      // 预置请假：本班学生 approved/completed 且当日时段相交 → sign_records(leave, leave-auto)
      const students = db.prepare('SELECT id FROM students WHERE class_id = ?').all(classId).map((r) => r.id);
      const insLeave = db.prepare('INSERT OR IGNORE INTO sign_records (session_id, student_id, status, method) VALUES (?, ?, ?, ?)');
      for (const sid of students) {
        const leaves = db.prepare(`SELECT * FROM leaves WHERE student_id = ? AND status IN ('approved','completed') AND date_from <= ? AND date_to >= ?`).all(sid, dateStr, dateStr);
        const hit = leaves.some((l) => (l.date_from < l.date_to) || (l.time_from <= start && l.time_to >= start) || (l.time_from <= end && l.time_to >= end) || (l.time_from <= start && end <= l.time_to));
        if (hit) insLeave.run(sessionId, sid, 'leave', 'leave-auto');
      }
    });
    tx();
    const s = db.prepare('SELECT * FROM lesson_sessions WHERE id = ?').get(sessionId);
    // 实时推送：本班学生签到卡出现
    pub.publishToClass(classId, 'classroom:session-opened', {
      sessionId: s.id, classId, courseName, teacherName: name, date: dateStr, start, end, signMode,
    });
    console.log(`[classroom] 发起课堂 #${sessionId}：「${courseName}」${className(classId)}（${signMode} 模式）；教师：${name} @ ${now()}`);
    return { ok: true, session: sessionDetail(s, null) };
  });

  /* ---------- 学生签到 ---------- */
  app.post('/api/classroom/sessions/:id/sign', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    if (role !== '学生') return res.code(403).send({ ok: false, message: '仅学生可签到' });
    const s = db.prepare('SELECT * FROM lesson_sessions WHERE id = ?').get(Number(req.params.id));
    if (!s) return res.code(404).send({ ok: false, message: '课堂不存在' });
    if (s.status !== 'open') return res.code(409).send({ ok: false, message: '课堂已结束，无法签到' });
    const stu = db.prepare('SELECT class_id FROM students WHERE id = ?').get(name);
    if (!stu || stu.class_id !== s.class_id) return res.code(403).send({ ok: false, message: '该课堂不属于您的班级' });
    const cur = db.prepare('SELECT * FROM sign_records WHERE session_id = ? AND student_id = ?').get(s.id, name);
    if (cur) {
      if (cur.status === 'leave') return res.code(409).send({ ok: false, message: '您在该时段已请假（无需签到）' });
      if (cur.status === 'signed' || cur.status === 'signed_by_teacher') return res.code(409).send({ ok: false, message: '已签到，无需重复签到' });
      if (cur.status === 'absent') return res.code(409).send({ ok: false, message: '已被记为旷课，请联系教师处理' });
    }
    if (s.sign_mode === 'code') {
      const code = String((req.body || {}).code || '');
      if (!/^\d{4}$/.test(code)) return res.code(400).send({ ok: false, message: '请输入 4 位签到口令' });
      if (code !== s.sign_code) return res.code(400).send({ ok: false, message: '签到口令错误' });
    }
    db.prepare(`INSERT INTO sign_records (session_id, student_id, status, method, signed_at)
      VALUES (?, ?, 'signed', ?, ?)
      ON CONFLICT(session_id, student_id) DO UPDATE SET status = 'signed', method = excluded.method, signed_at = excluded.signed_at`)
      .run(s.id, name, s.sign_mode === 'code' ? 'code' : 'click', now());
    return { ok: true, signed: true };
  });

  /* ---------- 会话详情（教师面板轮询 / 学生签到卡 / 导员绑定班查看） ---------- */
  app.get('/api/classroom/sessions/:id', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    const s = db.prepare('SELECT * FROM lesson_sessions WHERE id = ?').get(Number(req.params.id));
    if (!s) return res.code(404).send({ ok: false, message: '课堂不存在' });
    if (role === '学生') {
      const stu = db.prepare('SELECT class_id FROM students WHERE id = ?').get(name);
      if (!stu || stu.class_id !== s.class_id) return res.code(403).send({ ok: false, message: '该课堂不属于您的班级' });
      const d = sessionDetail(s, name);
      delete d.signCode; // 学生端剥离口令
      return { ok: true, session: d };
    }
    if (role === '导员') {
      // D8：仅可查看绑定班级的课堂详情
      const bound = db.prepare('SELECT 1 FROM counselor_classes WHERE counselor_name = ? AND class_id = ?').get(name, s.class_id);
      if (!bound) return res.code(403).send({ ok: false, message: '该课堂不属于您绑定的班级' });
      return { ok: true, session: sessionDetail(s, null) };
    }
    if (!canRead(s, req)) return res.code(403).send({ ok: false, message: '仅课堂教师/教务处/IT管理员可查看' });
    return { ok: true, session: sessionDetail(s, null) };
  });

  /* ---------- 学生进行中签到卡（本班 open + 本人态；离线兜底补拉） ---------- */
  app.get('/api/classroom/sessions', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    const q = req.query || {};
    if (role === '学生' && q.classId != null && String(q.open || '') === '1') {
      const stu = db.prepare('SELECT class_id FROM students WHERE id = ?').get(name);
      if (!stu || stu.class_id !== Number(q.classId)) return res.code(403).send({ ok: false, message: '仅可查询本班进行中课堂' });
      const rows = db.prepare("SELECT * FROM lesson_sessions WHERE class_id = ? AND status = 'open' ORDER BY id DESC").all(Number(q.classId));
      return { ok: true, sessions: rows.map((s) => sessionDetail(s, name)) };
    }
    // 导员：按绑定班级（D8）查历史课堂（课堂状态 Tab 数据源）
    if (role === '导员') {
      const cids = db.prepare('SELECT class_id FROM counselor_classes WHERE counselor_name = ?').all(name).map((r) => r.class_id);
      if (!cids.length) return { ok: true, sessions: [], unbound: true };
      const ph = cids.map(() => '?').join(',');
      let rows = db.prepare(`SELECT * FROM lesson_sessions WHERE class_id IN (${ph}) ORDER BY id DESC LIMIT 100`).all(...cids);
      if (q.date) rows = rows.filter((r) => r.date === String(q.date));
      return { ok: true, sessions: rows.map(sessionOut) };
    }
    if (role !== '教师' && role !== '教务处' && role !== 'IT管理员') return res.code(403).send({ ok: false, message: '无权限' });
    let rows = [];
    if (String(q.all || '') === '1' && (role === '教务处' || role === 'IT管理员')) {
      rows = db.prepare('SELECT * FROM lesson_sessions ORDER BY id DESC LIMIT 200').all();
    } else if (q.teacher != null && (role === '教务处' || role === 'IT管理员' || String(q.teacher) === name)) {
      rows = db.prepare('SELECT * FROM lesson_sessions WHERE teacher_name = ? ORDER BY id DESC LIMIT 200').all(String(q.teacher));
    } else {
      rows = db.prepare('SELECT * FROM lesson_sessions WHERE teacher_name = ? ORDER BY id DESC LIMIT 200').all(name);
    }
    if (q.date) rows = rows.filter((r) => r.date === String(q.date));
    return { ok: true, sessions: rows.map(sessionOut) };
  });

  /* ---------- 结束课堂 ---------- */
  app.post('/api/classroom/sessions/:id/end', async (req, res) => {
    const s = db.prepare('SELECT * FROM lesson_sessions WHERE id = ?').get(Number(req.params.id));
    if (!s) return res.code(404).send({ ok: false, message: '课堂不存在' });
    if (!isOwner(s, req)) return res.code(403).send({ ok: false, message: '仅课堂教师本人可结束课堂' });
    if (s.status !== 'open') return res.code(409).send({ ok: false, message: '课堂已结束' });
    db.prepare("UPDATE lesson_sessions SET status = 'ended', ended_at = ? WHERE id = ?").run(now(), s.id);
    // 未签到且未请假的学生标记 absent（结束时结算旷课快照——teacher 仍可事后单独记旷课/代签）
    const students = db.prepare('SELECT id FROM students WHERE class_id = ?').all(s.class_id).map((r) => r.id);
    const insAbsent = db.prepare("INSERT OR IGNORE INTO sign_records (session_id, student_id, status, method) VALUES (?, ?, 'absent', 'absent-mark')");
    students.forEach((sid) => insAbsent.run(s.id, sid));
    pub.publishToRole('导员', 'classroom:session-ended', { sessionId: s.id, classId: s.class_id, className: className(s.class_id), courseName: s.course_name, teacherName: s.teacher_name, date: s.date });
    pub.publishToRole('教务处', 'classroom:session-ended', { sessionId: s.id, classId: s.class_id, className: className(s.class_id), courseName: s.course_name, teacherName: s.teacher_name, date: s.date });
    console.log(`[classroom] 结束课堂 #${s.id}：「${s.course_name}」${className(s.class_id)}；教师：${readName(req)} @ ${now()}`);
    return { ok: true, ended: true };
  });

  /* ---------- 教师课堂操作（代签/加减分/随人/旷课） ---------- */
  const teacherAction = (req, res, fn) => {
    const s = db.prepare('SELECT * FROM lesson_sessions WHERE id = ?').get(Number(req.params.id));
    if (!s) return res.code(404).send({ ok: false, message: '课堂不存在' });
    if (!isOwner(s, req)) return res.code(403).send({ ok: false, message: '仅课堂教师本人可操作该课堂' });
    return fn(s);
  };

  app.post('/api/classroom/sessions/:id/proxy-sign', async (req, res) => {
    teacherAction(req, res, (s) => {
      const sid = String((req.body || {}).studentId || '');
      if (!db.prepare('SELECT 1 FROM students WHERE id = ? AND class_id = ?').get(sid, s.class_id)) return res.code(400).send({ ok: false, message: '学生不在该班级' });
      db.prepare(`INSERT INTO sign_records (session_id, student_id, status, method, signed_at) VALUES (?, ?, 'signed_by_teacher', 'proxy', ?)
        ON CONFLICT(session_id, student_id) DO UPDATE SET status = 'signed_by_teacher', method = 'proxy', signed_at = excluded.signed_at`).run(s.id, sid, now());
      return { ok: true, proxy: true, studentId: sid };
    });
  });

  app.post('/api/classroom/sessions/:id/score', async (req, res) => {
    teacherAction(req, res, (s) => {
      const b = req.body || {};
      const sid = String(b.studentId || '');
      const delta = Number(b.delta);
      if (!db.prepare('SELECT 1 FROM students WHERE id = ? AND class_id = ?').get(sid, s.class_id)) return res.code(400).send({ ok: false, message: '学生不在该班级' });
      if (![1, 2, -1, -2].includes(delta)) return res.code(400).send({ ok: false, message: '分值须为 ±1 / ±2' });
      db.prepare(`INSERT INTO classroom_events (session_id, student_id, kind, delta, note, operator, created_at) VALUES (?, ?, 'score', ?, ?, ?, ?)`)
        .run(s.id, sid, delta, String(b.note || '').slice(0, 100), readName(req), now());
      return { ok: true, studentId: sid, delta };
    });
  });

  app.post('/api/classroom/sessions/:id/pick', async (req, res) => {
    teacherAction(req, res, (s) => {
      const ids = [...new Set((Array.isArray((req.body || {}).studentIds) ? req.body.studentIds : []).map(String))];
      if (!ids.length) return res.code(400).send({ ok: false, message: '未指定学生' });
      const inClass = db.prepare('SELECT id FROM students WHERE class_id = ?').all(s.class_id).map((r) => r.id);
      const bad = ids.filter((id) => !inClass.includes(id));
      if (bad.length) return res.code(400).send({ ok: false, message: `学生不在该班级：${bad.slice(0, 5).join('、')}` });
      const ins = db.prepare(`INSERT INTO classroom_events (session_id, student_id, kind, note, operator, created_at) VALUES (?, ?, 'pick', ?, ?, ?)`);
      ids.forEach((id) => ins.run(s.id, id, String((req.body || {}).note || '随人').slice(0, 100), readName(req), now()));
      return { ok: true, picked: ids.length };
    });
  });

  app.post('/api/classroom/sessions/:id/absence', async (req, res) => {
    teacherAction(req, res, (s) => {
      const sid = String((req.body || {}).studentId || '');
      if (!db.prepare('SELECT 1 FROM students WHERE id = ? AND class_id = ?').get(sid, s.class_id)) return res.code(400).send({ ok: false, message: '学生不在该班级' });
      if (db.prepare('SELECT 1 FROM violation_records WHERE session_id = ? AND student_id = ? AND type = ? AND cancelled = 0').get(s.id, sid, '旷课')) {
        return res.code(409).send({ ok: false, message: '该学生本课堂已记旷课' });
      }
      const tx = db.transaction(() => {
        db.prepare(`INSERT INTO violation_records (student_id, type, points, source, session_id, note, operator, created_at)
          VALUES (?, '旷课', -5, 'auto', ?, ?, ?, ?)`).run(sid, s.id, String((req.body || {}).note || '').slice(0, 100) || null, readName(req), now());
        db.prepare('UPDATE students SET score = score - 5 WHERE id = ?').run(sid);
        db.prepare(`INSERT INTO sign_records (session_id, student_id, status, method) VALUES (?, ?, 'absent', 'absent-mark')
          ON CONFLICT(session_id, student_id) DO UPDATE SET status = 'absent', method = 'absent-mark'`).run(s.id, sid);
        db.prepare(`INSERT INTO classroom_events (session_id, student_id, kind, delta, operator, created_at) VALUES (?, ?, 'absence', -5, ?, ?)`).run(s.id, sid, readName(req), now());
      });
      tx();
      return { ok: true, studentId: sid, points: -5 };
    });
  });

  app.delete('/api/classroom/sessions/:id/absence/:studentId', async (req, res) => {
    const s = db.prepare('SELECT * FROM lesson_sessions WHERE id = ?').get(Number(req.params.id));
    if (!s) return res.code(404).send({ ok: false, message: '课堂不存在' });
    if (!isOwner(s, req)) return res.code(403).send({ ok: false, message: '仅课堂教师本人可撤销旷课' });
    if (s.status !== 'open') {
      return res.code(409).send({ ok: false, message: '课堂已结束，课后撤销需提交申请至教务处（调课审批 → 旷课撤销）' });
    }
    const sid = String(req.params.studentId || '');
    const v = db.prepare('SELECT * FROM violation_records WHERE session_id = ? AND student_id = ? AND type = ? AND cancelled = 0').get(s.id, sid, '旷课');
    if (!v) return res.code(404).send({ ok: false, message: '该学生本课堂无有效旷课记录' });
    const tx = db.transaction(() => {
      db.prepare('UPDATE violation_records SET cancelled = 1 WHERE id = ?').run(v.id);
      db.prepare('UPDATE students SET score = score - ? WHERE id = ?').run(v.points, v.student_id);
      db.prepare(`INSERT INTO classroom_events (session_id, student_id, kind, delta, note, operator, created_at) VALUES (?, ?, 'absence-cancelled', ?, '课堂内撤销旷课', ?, ?)`).run(s.id, sid, -v.points, readName(req), now());
      db.prepare(`UPDATE sign_records SET status = 'signed', method = 'proxy' WHERE session_id = ? AND student_id = ? AND status = 'absent'`).run(s.id, sid);
    });
    tx();
    return { ok: true, restored: -v.points };
  });
}
