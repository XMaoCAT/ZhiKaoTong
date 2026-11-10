// 全局搜索端点（2026-11-03 批二 S9；顶栏搜索框/移动端首页搜索共用）
// ---------------------------------------------------------------------------
// GET /api/search?q=关键词 → { ok, q, groups: { students[], classes[], teachers[], lessons[] } }
// 角色范围（与既有权限矩阵一致，前端零额外收窄）：
//   学生           ：本班学生 + 本班课程（未停课）
//   教师           ：授课班学生 + 本人课程（未停课）
//   教务处/学生处/导员/IT：全校学生 + 班级 + 教师 + 课程（未停课）
// 匹配规则（与 shared/pinyin-util 同款逻辑，后端单源）：
//   学生：学号 / 姓名 / 拼音全拼 / 拼音首字母 包含（大小写不敏感）
//   班级：班名包含；教师：姓名+拼音；课程：课名+教师名+班名包含
// 各组 LIMIT 10；q 为空直接返回空组。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../core/db.js';
import { readRole, readName } from '../core/http-utils.js';

// 拼音库复用前端 vendor 副本（纯 ESM，Node 20 原生可 import——2026-11-03 实测通过；
// 路径锚定本文件位置，与 public/shared/pinyin-util.js 同源零漂移）
const VENDOR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'shared', 'vendor', 'pinyin-pro', 'index.mjs');
const { pinyin } = await import(`file:///${VENDOR.replace(/\\/g, '/')}`);

/** 姓名 → { full: 'zhangsan', first: 'zs' }（与 shared/pinyin-util.pinyinKeys 完全同款实现） */
function pinyinKeys(name) {
  try {
    const s = String(name || '');
    const full = pinyin(s, { toneType: 'none', type: 'string', nonZh: 'consecutive' }).replace(/\s+/g, '').toLowerCase();
    const first = pinyin(s, { pattern: 'first', toneType: 'none', type: 'string', nonZh: 'consecutive' }).replace(/\s+/g, '').toLowerCase();
    return { full, first };
  } catch { return { full: '', first: '' }; }
}

/** 学生匹配：学号 / 姓名 / 拼音全拼 / 拼音首字母（q 已 lower */
function studentMatch(id, name, q) {
  if (String(id || '').includes(q)) return true;
  const n = String(name || '').toLowerCase();
  if (n.includes(q)) return true;
  const k = pinyinKeys(name);
  return k.full.includes(q) || k.first.includes(q);
}

/** 普通文本匹配（班名/课名/教师名）：原文或拼音包含 */
function textMatch(text, q) {
  const s = String(text || '').toLowerCase();
  if (s.includes(q)) return true;
  const k = pinyinKeys(text);
  return k.full.includes(q) || k.first.includes(q);
}

const WEEKDAYS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function registerSearchRoutes(app) {
  app.get('/api/search', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    if (!role) return res.code(403).send({ ok: false, message: '未登录' });
    const q = String((req.query || {}).q || '').trim().toLowerCase();
    if (!q) return { ok: true, q, groups: { students: [], classes: [], teachers: [], lessons: [] } };

    const students = [];
    const classes = [];
    const teachers = [];
    const lessons = [];
    const classNameOf = (id) => db.prepare('SELECT name FROM classes WHERE id = ?').get(id)?.name || '未分配';

    /* ---- 学生：学生=本班；教师=授课班；管理角色=全校 ---- */
    let studentRows = [];
    if (role === '学生') {
      const my = db.prepare('SELECT class_id FROM students WHERE id = ?').get(name);
      if (my && my.class_id != null) studentRows = db.prepare('SELECT id, name, class_id FROM students WHERE class_id = ?').all(my.class_id);
    } else if (role === '教师') {
      const cids = db.prepare('SELECT class_id FROM teacher_classes WHERE teacher_name = ?').all(name).map((r) => r.class_id);
      if (cids.length) {
        const ph = cids.map(() => '?').join(',');
        studentRows = db.prepare(`SELECT id, name, class_id FROM students WHERE class_id IN (${ph})`).all(...cids);
      }
    } else {
      studentRows = db.prepare('SELECT id, name, class_id FROM students').all();
    }
    for (const s of studentRows) {
      if (students.length >= 10) break;
      if (studentMatch(s.id, s.name, q)) students.push({ id: s.id, name: s.name, className: classNameOf(s.class_id) });
    }

    /* ---- 班级 / 教师 / 课程：仅管理角色（教务处/学生处/导员/IT）---- */
    const isManager = ['教务处', '学生处', '导员', 'IT管理员'].includes(role);
    if (isManager) {
      for (const c of db.prepare('SELECT c.id, c.name, COUNT(s.id) AS cnt FROM classes c LEFT JOIN students s ON s.class_id = c.id GROUP BY c.id ORDER BY c.id').all()) {
        if (classes.length >= 10) break;
        if (textMatch(c.name, q)) classes.push({ id: c.id, name: c.name, studentCount: c.cnt });
      }
      for (const t of db.prepare('SELECT t.name, COUNT(tc.class_id) AS cnt FROM teachers t LEFT JOIN teacher_classes tc ON tc.teacher_name = t.name GROUP BY t.name').all()) {
        if (teachers.length >= 10) break;
        if (textMatch(t.name, q)) teachers.push({ name: t.name, classCount: t.cnt });
      }
    }

    /* ---- 课程：学生=本班；教师=本人；管理角色=全校（未停课，含单次加课）---- */
    let lessonRows = [];
    if (role === '学生') {
      const my = db.prepare('SELECT class_id FROM students WHERE id = ?').get(name);
      if (my && my.class_id != null) lessonRows = db.prepare('SELECT * FROM timetable_lessons WHERE class_id = ? AND cancelled = 0').all(my.class_id);
    } else if (role === '教师') {
      lessonRows = db.prepare('SELECT * FROM timetable_lessons WHERE teacher_name = ? AND cancelled = 0').all(name);
    } else if (isManager) {
      lessonRows = db.prepare('SELECT * FROM timetable_lessons WHERE cancelled = 0').all();
    }
    const seenLesson = new Set();
    for (const l of lessonRows) {
      if (lessons.length >= 10) break;
      // 课程组去重键：课名+教师+班（周课同课多日只显示首个）
      const key = `${l.course_name}|${l.teacher_name}|${l.class_id}`;
      if (seenLesson.has(key)) continue;
      const hit = textMatch(l.course_name, q) || textMatch(l.teacher_name, q) || textMatch(classNameOf(l.class_id), q);
      if (!hit) continue;
      seenLesson.add(key);
      lessons.push({
        courseName: l.course_name,
        teacherName: l.teacher_name,
        className: classNameOf(l.class_id),
        weekday: WEEKDAYS[l.weekday] || '',
        startTime: l.start_time,
        endTime: l.end_time,
        source: l.source,
        singleDate: l.single_date || '',
      });
    }

    return { ok: true, q, groups: { students, classes, teachers, lessons } };
  });
}
