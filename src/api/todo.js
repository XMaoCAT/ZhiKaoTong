// 待办计数统一端点（2026-11-03 批二 S6；口径对齐 mod-landing C4 五角色徽标——前端徽标待迁移消费）
// ---------------------------------------------------------------------------
// GET /api/todo/summary → { ok, items: [{ moduleId, label, count }], total }
// 口径（与 landing C4 / workflow.js GET / leaves.js GET 完全一致，后端单源）：
//   学生   ：本人 leaves pending+editing → student-leave（请假申请进行中）
//   导员   ：绑定班学生 leaves pending+editing（D8 收窄）→ counselor-verify（请假待审批）
//   学生处 ：workflow_requests pending 且 type ∈ class-*（audience=学生处）→ student-affairs
//   教务处 ：workflow_requests pending 且 type ∈ 调课三类（audience=教务处）→ lesson-review
//   教师   ：workflow_requests pending 且 type=record-modify 且本人课堂 → classroom
//   IT管理员：无待办（items 空）
import { db } from '../core/db.js';
import { readRole, readName } from '../core/http-utils.js';

const CLASS_REQUEST_TYPES = ['class-create', 'class-edit', 'class-dissolve', 'class-rename'];
const LESSON_REQUEST_TYPES = ['add-lesson', 'teacher-leave', 'absence-cancel'];

export function registerTodoRoutes(app) {
  app.get('/api/todo/summary', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    if (!role) return res.code(403).send({ ok: false, message: '未登录' });
    const items = [];

    if (role === '学生') {
      const n = db.prepare("SELECT COUNT(*) AS n FROM leaves WHERE student_id = ? AND status IN ('pending', 'editing')").get(name)?.n || 0;
      if (n) items.push({ moduleId: 'student-leave', label: '请假申请进行中', count: n });
    } else if (role === '导员') {
      // D8：审批范围按 counselor_classes 绑定班级收窄（未绑定视为 0，与 leaves.js GET 口径一致）
      const cids = db.prepare('SELECT class_id FROM counselor_classes WHERE counselor_name = ?').all(name).map((r) => r.class_id);
      let n = 0;
      if (cids.length) {
        const ph = cids.map(() => '?').join(',');
        const sids = db.prepare(`SELECT id FROM students WHERE class_id IN (${ph})`).all(...cids).map((r) => r.id);
        if (sids.length) {
          const ph2 = sids.map(() => '?').join(',');
          n = db.prepare(`SELECT COUNT(*) AS n FROM leaves WHERE student_id IN (${ph2}) AND status IN ('pending', 'editing')`).get(...sids)?.n || 0;
        }
      }
      if (n) items.push({ moduleId: 'counselor-verify', label: '请假待审批', count: n });
    } else if (role === '学生处') {
      const ph = CLASS_REQUEST_TYPES.map(() => '?').join(',');
      const n = db.prepare(`SELECT COUNT(*) AS n FROM workflow_requests WHERE status = 'pending' AND audience = '学生处' AND type IN (${ph})`).get(...CLASS_REQUEST_TYPES)?.n || 0;
      if (n) items.push({ moduleId: 'student-affairs', label: '班级变更申请待审批', count: n });
    } else if (role === '教务处') {
      const ph = LESSON_REQUEST_TYPES.map(() => '?').join(',');
      const n = db.prepare(`SELECT COUNT(*) AS n FROM workflow_requests WHERE status = 'pending' AND audience = '教务处' AND type IN (${ph})`).get(...LESSON_REQUEST_TYPES)?.n || 0;
      if (n) items.push({ moduleId: 'lesson-review', label: '调课申请待审批', count: n });
    } else if (role === '教师') {
      // record-modify 确认制：仅统计本人课堂的待确认修改（与 workflow.js GET 教师分支同过滤）
      const rows = db.prepare("SELECT payload FROM workflow_requests WHERE status = 'pending' AND audience = '教师' AND type = 'record-modify'").all();
      let n = 0;
      for (const r of rows) {
        try {
          const p = JSON.parse(r.payload);
          const s = db.prepare('SELECT teacher_name FROM lesson_sessions WHERE id = ?').get(Number(p.sessionId));
          if (s && s.teacher_name === name) n++;
        } catch { /* 忽略脏数据 */ }
      }
      if (n) items.push({ moduleId: 'classroom', label: '课堂记录修改待确认', count: n });
    }
    // IT管理员：无待办口径，items 为空数组

    return { ok: true, items, total: items.reduce((s, i) => s + i.count, 0) };
  });
}
