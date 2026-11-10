import { db, now } from '../core/db.js';
import { readRole, readName } from '../core/http-utils.js';
import { pub } from '../core/pub.js';

/**
 * 课表 API（开发计划 §7.2 / §10.1）
 * ---------------------------------------------------------------------------
 * timetable_lessons：base（每周重复，single_date=NULL）+ add（单次加课，single_date 必填）双源一表；
 * teacher-leave 审批通过置 cancelled=1（停课留痕，D4 停课不补）。
 *
 * P3 已实现：
 *   GET /api/timetable/affected?studentId=&dateFrom=&timeFrom=&dateTo=&timeTo=
 *     → 请假耽误课程清单（D8；学生本人或教职工可查；affectedLessons 单源计算，防前端时区/跨日分叉）
 * 导出（供 workflow.js add-lesson 校验器/执行器共用，单源）：
 *   checkConflict({classId, teacherName, weekday, start, end, singleDate}) → { conflict: bool, with: row|null }
 *   affectedLessons(studentId, dateFrom, timeFrom, dateTo, timeTo) → [{courseName, teacherName, date, start, end, source}]
 *
 * P6 待实现：GET /api/timetable?classId= / ?teacher= / ?majorId= 三查询端点。
 */

db.exec(`
CREATE TABLE IF NOT EXISTS timetable_lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL,
  teacher_name TEXT NOT NULL,
  course_name TEXT NOT NULL,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time TEXT NOT NULL,           -- 'HH:MM'，约束 06:00–22:00
  end_time TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'base' CHECK (source IN ('base','add')),
  single_date TEXT,                   -- source=add 必填 YYYY-MM-DD；base 为 NULL（每周重复）
  cancelled INTEGER DEFAULT 0,        -- teacher-leave 审批通过置 1（停课留痕）
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_tt_class ON timetable_lessons (class_id, weekday);
CREATE INDEX IF NOT EXISTS idx_tt_teacher ON timetable_lessons (teacher_name, weekday);
`);

/* ---------- 基础课表种子（开发计划 §3.8；条件幂等：该班无 base 课才插入） ---------- */
{
  const cls = db.prepare("SELECT id FROM classes WHERE name = '计算机2301'").get();
  if (cls && db.prepare("SELECT COUNT(*) c FROM timetable_lessons WHERE class_id = ? AND source = 'base'").get(cls.id).c === 0) {
    const ins = db.prepare(`INSERT INTO timetable_lessons (class_id, teacher_name, course_name, weekday, start_time, end_time, source, created_by)
      VALUES (?, ?, ?, ?, ?, ?, 'base', 'seed')`);
    const tx = db.transaction(() => {
      for (let wd = 1; wd <= 5; wd++) {
        ins.run(cls.id, '教师01', '高等数学', wd, '08:00', '09:40'); // 上午 2 节连排
        ins.run(cls.id, '教师02', '程序设计', wd, '14:00', '15:40'); // 下午 2 节连排
      }
    });
    tx();
  }
}

/* ---------- 工具 ---------- */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 冲突校验（单源，add-lesson validator 与 executor 共用）：
 * 同班或同教师，在指定 weekday（base 课）/ single_date（add 课， weekday 同时匹配）且时段相交即冲突。
 * cancelled=1 的停课课不参与冲突。
 */
export function checkConflict({ classId, teacherName, weekday, start, end, singleDate, excludeId }) {
  const rows = db.prepare(`
    SELECT * FROM timetable_lessons
    WHERE cancelled = 0 AND weekday = ?
      AND (class_id = ? OR teacher_name = ?)
      AND (source = 'base' OR single_date = ?)
  `).all(weekday, classId, teacherName, singleDate || null);
  const s = toMin(start);
  const e = toMin(end);
  for (const r of rows) {
    if (excludeId && r.id === excludeId) continue;
    const rs = toMin(r.start_time);
    const re = toMin(r.end_time);
    if (s < re && rs < e) return { conflict: true, with: r };
  }
  return { conflict: false, with: null };
}

/**
 * 请假耽误课程计算（D8，§10.1 单源后端函数）：
 * 查学生班级 → 该班未停课课程 → 逐日展开请假区间：
 *   base 课按 weekday 命中且时段相交；add 课按 single_date 命中且时段相交；跨日请假逐日累计。
 */
export function affectedLessons(studentId, dateFrom, timeFrom, dateTo, timeTo) {
  const stu = db.prepare('SELECT class_id FROM students WHERE id = ?').get(studentId);
  if (!stu || stu.class_id == null) return [];
  const lessons = db.prepare('SELECT * FROM timetable_lessons WHERE class_id = ? AND cancelled = 0').all(stu.class_id);
  if (!lessons.length) return [];

  const pad2 = (n) => String(n).padStart(2, '0');
  const out = [];
  // 逐日展开（含首尾日）；同日内时段取 [max(from), min(to)] 相交
  // ⚠ dateStr 必须用本地时区格式化（P12 实测 bug：toISOString 走 UTC 会比本地日期早一天，
  //   与 weekday 的本地 getDay() 错位——周一申请显示成"前一天（周日）"却命中周一课）
  const cursor = new Date(`${dateFrom}T00:00:00`);
  const last = new Date(`${dateTo}T00:00:00`);
  let guard = 0;
  while (cursor <= last && guard < 400) {
    guard += 1;
    const dateStr = `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}-${pad2(cursor.getDate())}`;
    const weekday = cursor.getDay() === 0 ? 7 : cursor.getDay();
    const dayStart = dateStr === dateFrom ? toMin(timeFrom) : 0;    // 首日从请假开始时刻起
    const dayEnd = dateStr === dateTo ? toMin(timeTo) : 24 * 60;    // 末日到请假结束时刻止
    for (const l of lessons) {
      const ls = toMin(l.start_time);
      const le = toMin(l.end_time);
      const hit = l.source === 'base' ? l.weekday === weekday : l.single_date === dateStr;
      if (hit && dayStart < le && ls < dayEnd) {
        out.push({
          lessonId: l.id,
          courseName: l.course_name,
          teacherName: l.teacher_name,
          date: dateStr,
          weekday,
          start: l.start_time,
          end: l.end_time,
          source: l.source,
        });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export function registerTimetableRoutes(app) {
  /* ---------- 学生自助：本班课表（按登录学号查 students.class_id，无需前端知 classId） ---------- */
  app.get('/api/timetable/mine', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    if (role !== '学生') return res.code(403).send({ ok: false, message: '仅学生可使用本班课表端点' });
    const stu = db.prepare('SELECT class_id FROM students WHERE id = ?').get(name);
    if (!stu || stu.class_id == null) return res.code(404).send({ ok: false, message: '尚未分配班级，暂无课表' });
    const rows = db.prepare('SELECT * FROM timetable_lessons WHERE class_id = ? ORDER BY weekday, start_time').all(stu.class_id);
    void pub; void now;
    return { ok: true, lessons: rows.map(rowOut), classId: stu.class_id };
  });

  /* ---------- 课表查询（P5：classId/teacher/majorId 三通道；cancelled=1 仍返回供前端置灰标"停课"） ---------- */
  const rowOut = (r) => ({
    id: r.id,
    classId: r.class_id,
    className: r._class_name || undefined,
    teacherName: r.teacher_name,
    courseName: r.course_name,
    weekday: r.weekday,
    start: r.start_time,
    end: r.end_time,
    source: r.source,
    singleDate: r.single_date || null,
    cancelled: !!r.cancelled,
  });

  app.get('/api/timetable', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    if (!role) return res.code(403).send({ ok: false, message: '未登录' });
    const q = req.query || {};

    if (q.classId != null) {
      const cid = Number(q.classId);
      if (!db.prepare('SELECT id FROM classes WHERE id = ?').get(cid)) return res.code(404).send({ ok: false, message: '班级不存在' });
      // 学生只能查本班课表（教职工放行）
      if (role === '学生') {
        const stu = db.prepare('SELECT class_id FROM students WHERE id = ?').get(name);
        if (!stu || stu.class_id !== cid) return res.code(403).send({ ok: false, message: '仅可查询本班课表' });
      }
      const rows = db.prepare('SELECT * FROM timetable_lessons WHERE class_id = ? ORDER BY weekday, start_time').all(cid);
      return { ok: true, lessons: rows.map(rowOut) };
    }

    if (q.teacher != null) {
      const teacher = String(q.teacher);
      if (role !== 'IT管理员' && role !== '教务处' && name !== teacher) {
        return res.code(403).send({ ok: false, message: '仅可查询本人课表' });
      }
      // scope=all：该教师授课班级的完整课表（含其他教师课程——「全部课程」开关数据源）
      if (String(q.scope || '') === 'all') {
        const cids = db.prepare('SELECT class_id FROM teacher_classes WHERE teacher_name = ?').all(teacher).map((r) => r.class_id);
        if (!cids.length) return { ok: true, lessons: [] };
        const ph = cids.map(() => '?').join(',');
        const rows = db.prepare(`SELECT t.*, c.name AS _class_name FROM timetable_lessons t LEFT JOIN classes c ON c.id = t.class_id
          WHERE t.class_id IN (${ph}) ORDER BY t.weekday, t.start_time`).all(...cids);
        return { ok: true, lessons: rows.map(rowOut) };
      }
      const rows = db.prepare(`SELECT t.*, c.name AS _class_name FROM timetable_lessons t LEFT JOIN classes c ON c.id = t.class_id
        WHERE t.teacher_name = ? ORDER BY t.weekday, t.start_time`).all(teacher);
      return { ok: true, lessons: rows.map(rowOut) };
    }

    if (q.majorId != null) {
      const mid = Number(q.majorId);
      if (!['教务处', 'IT管理员', '学生处'].includes(role)) return res.code(403).send({ ok: false, message: '仅教务处/学生处/IT管理员可查看专业部课表' });
      if (!db.prepare('SELECT id FROM major_departments WHERE id = ?').get(mid)) return res.code(404).send({ ok: false, message: '专业部不存在' });
      // D1b 班级切换式数据源：该部下属班级的课程集合（每条含 className，前端按班级分组渲染）
      const rows = db.prepare(`SELECT t.*, c.name AS _class_name FROM timetable_lessons t
        LEFT JOIN classes c ON c.id = t.class_id
        WHERE t.class_id IN (SELECT id FROM classes WHERE major_id = ?)
        ORDER BY t.class_id, t.weekday, t.start_time`).all(mid);
      return { ok: true, lessons: rows.map(rowOut) };
    }

    return res.code(400).send({ ok: false, message: '缺少查询参数（classId / teacher / majorId）' });
  });

  // 请假耽误课程清单（D8）：学生查本人（studentId 必须等于登录名）；教职工可查任意
  app.get('/api/timetable/affected', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    const q = req.query || {};
    const studentId = String(q.studentId || '');
    if (!role) return res.code(403).send({ ok: false, message: '未登录' });
    if (role === '学生' && studentId !== name) return res.code(403).send({ ok: false, message: '仅可查询本人请假耽误课程' });
    if (!/^\d{9}$/.test(studentId)) return res.code(400).send({ ok: false, message: '学号格式错误' });
    if (!DATE.test(String(q.dateFrom || '')) || !DATE.test(String(q.dateTo || '')) || !HHMM.test(String(q.timeFrom || '')) || !HHMM.test(String(q.timeTo || ''))) {
      return res.code(400).send({ ok: false, message: '起止日期时间格式错误（YYYY-MM-DD / HH:MM）' });
    }
    if (String(q.dateFrom) > String(q.dateTo)) return res.code(400).send({ ok: false, message: '开始日期不能晚于结束日期' });
    if (q.dateFrom === q.dateTo && String(q.timeFrom) >= String(q.timeTo)) return res.code(400).send({ ok: false, message: '同日开始时刻须早于结束时刻' });
    const lessons = affectedLessons(studentId, String(q.dateFrom), String(q.timeFrom), String(q.dateTo), String(q.timeTo));
    void pub; void now;
    return { ok: true, lessons, count: lessons.length };
  });
}
