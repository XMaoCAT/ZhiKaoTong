import { db, now } from '../core/db.js';
import { readRole, readName } from '../core/http-utils.js';

/**
 * 请假业务 API：
 * - GET    /api/leaves                       → 列表（学生=本人记录；教职工=全部）
 * - POST   /api/leaves                       → 学生提交新申请（status=pending）
 * - PATCH  /api/leaves/:id  action=start-edit  → pending/rejected → editing（学生开始编辑，快照 base）
 * - PATCH  /api/leaves/:id  action=save         → editing 保持，保存草稿（挂起，可继续编辑）
 * - PATCH  /api/leaves/:id  action=submit       → editing → pending（覆盖为草稿数据，重新进入审批）
 * - PATCH  /api/leaves/:id  action=cancel-edit  → editing → pending（恢复 base 快照，放弃修改）
 * - PATCH  /api/leaves/:id  action=delete       → editing → 删除（学生重写申请时清除旧编辑）
 * - PATCH  /api/leaves/:id  action=revoke       → pending → revoked + revoke_reason（撤销理由同步导员）
 * - PATCH  /api/leaves/:id  action=approve      → pending → approved（导员同意；可选 requireReturn { photo, sign } 要求学生销假）
 * - PATCH  /api/leaves/:id  action=reject       → pending → rejected + reject_reason（导员拒绝，理由返回学生）
 * - PATCH  /api/leaves/:id  action=return       → approved → completed（学生销假：按导员要求提交 returnPhoto / returnSignature）
 *
 * 状态机：pending 待审批 → editing 编辑中 → pending 重审 → approved 已同意（可带销假要求）→ completed 已销假
 *         pending → revoked 已撤销（学生撤销，理由同步导员）
 *
 * 角色头：x-zkt-role（URI 编码）；学生身份：x-zkt-name（学号，URI 编码）
 */

db.exec(`
CREATE TABLE IF NOT EXISTS leaves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  type TEXT NOT NULL,
  date_from TEXT NOT NULL,
  time_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  time_to TEXT NOT NULL,
  reason TEXT NOT NULL,
  images TEXT DEFAULT '[]',
  signature TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reject_reason TEXT,
  revoke_reason TEXT,
  base_snapshot TEXT,
  draft_snapshot TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_leaves_student ON leaves (student_id);
CREATE INDEX IF NOT EXISTS idx_leaves_status ON leaves (status);
`);

// 旧库迁移：销假相关列（新库 CREATE TABLE 已含；ALTER 冲突时吞错）
for (const col of ['return_required TEXT', 'return_photo TEXT', 'return_signature TEXT', 'return_at TEXT', 'return_note TEXT']) {
  try { db.exec(`ALTER TABLE leaves ADD COLUMN ${col}`); } catch { /* 列已存在 */ }
}

const STAFF = ['教师', '教务处', '学生处', '导员', 'IT管理员'];
// ⚠ 与 public/shared/leave-wizard.js TYPES 同步（踩坑 #05：字典双处漂移；历史行 type='其他' 原样返回不映射）
const TYPES = ['病假', '事假', '公假'];

/** 行 → 前端契约（camelCase）；academic.js my-classes 复用，保证双 API 数据结构一致 */
export function parseRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    studentId: r.student_id,
    studentName: r.student_name,
    type: r.type,
    dateFrom: r.date_from,
    timeFrom: r.time_from,
    dateTo: r.date_to,
    timeTo: r.time_to,
    reason: r.reason,
    images: JSON.parse(r.images || '[]'),
    signature: r.signature,
    status: r.status,
    rejectReason: r.reject_reason || '',
    revokeReason: r.revoke_reason || '',
    returnRequired: r.return_required ? JSON.parse(r.return_required) : null,
    returnNote: r.return_note || '',
    returnPhoto: r.return_photo || '',
    returnSignature: r.return_signature || '',
    returnAt: r.return_at || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** 表单字段合法性校验（提交/重新提交共用） */
function validForm(b) {
  if (!b || typeof b !== 'object') return false;
  if (!TYPES.includes(b.type)) return false;
  const d = /^\d{4}-\d{2}-\d{2}$/;
  const t = /^\d{2}:\d{2}$/;
  if (!d.test(b.dateFrom) || !d.test(b.dateTo) || !t.test(b.timeFrom) || !t.test(b.timeTo)) return false;
  if (b.dateFrom > b.dateTo) return false;
  if (b.dateFrom === b.dateTo && b.timeFrom >= b.timeTo) return false;
  if (!String(b.reason || '').trim()) return false;
  if (b.signature && !/^data:image\/png;base64,/.test(b.signature)) return false;
  if (Array.isArray(b.images) && b.images.some((x) => !/^data:image\//.test(String(x)))) return false;
  return true;
}

function formData(b) {
  return {
    type: TYPES.includes(b.type) ? b.type : '',
    dateFrom: /^\d{4}-\d{2}-\d{2}$/.test(b.dateFrom) ? b.dateFrom : '',
    timeFrom: /^\d{2}:\d{2}$/.test(b.timeFrom) ? b.timeFrom : '',
    dateTo: /^\d{4}-\d{2}-\d{2}$/.test(b.dateTo) ? b.dateTo : '',
    timeTo: /^\d{2}:\d{2}$/.test(b.timeTo) ? b.timeTo : '',
    reason: String(b.reason || '').trim().slice(0, 500),
    images: JSON.stringify((Array.isArray(b.images) ? b.images : []).slice(0, 6)),
    signature: b.signature || null,
  };
}

export function registerLeaveRoutes(app) {
  app.get('/api/leaves', async (req) => {
    const role = readRole(req);
    const name = readName(req);
    if (!role) return { ok: false, message: '未登录' };
    let rows;
    if (role === '教师') {
      // 权限：教师仅能看到自己授课班级学生的请假信息
      const cids = db.prepare('SELECT class_id FROM teacher_classes WHERE teacher_name = ?').all(name).map((r) => r.class_id);
      if (!cids.length) return { ok: true, leaves: [] };
      const ph = cids.map(() => '?').join(',');
      const sids = db.prepare(`SELECT id FROM students WHERE class_id IN (${ph})`).all(...cids).map((r) => r.id);
      if (!sids.length) return { ok: true, leaves: [] };
      const ph2 = sids.map(() => '?').join(',');
      rows = db.prepare(`SELECT * FROM leaves WHERE student_id IN (${ph2}) ORDER BY id DESC`).all(...sids);
    } else if (role === '导员') {
      // D8（2026-10-24 P8）：导员审批范围按 counselor_classes 绑定班级收窄；未绑定时返回空+标记（前端空态提示）
      const cids = db.prepare('SELECT class_id FROM counselor_classes WHERE counselor_name = ?').all(name).map((r) => r.class_id);
      if (!cids.length) return { ok: true, leaves: [], unbound: true };
      const ph = cids.map(() => '?').join(',');
      const sids = db.prepare(`SELECT id FROM students WHERE class_id IN (${ph})`).all(...cids).map((r) => r.id);
      if (!sids.length) return { ok: true, leaves: [] };
      const ph2 = sids.map(() => '?').join(',');
      rows = db.prepare(`SELECT * FROM leaves WHERE student_id IN (${ph2}) ORDER BY id DESC`).all(...sids);
    } else if (STAFF.includes(role)) {
      rows = db.prepare('SELECT * FROM leaves ORDER BY id DESC').all();
    } else {
      rows = db.prepare('SELECT * FROM leaves WHERE student_id = ? ORDER BY id DESC').all(name);
    }
    return { ok: true, leaves: rows.map(parseRow) };
  });

  // 学生提交新申请（draft=true 为挂起保存：状态 editing，可继续编辑后提交）
  app.post('/api/leaves', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    if (role !== '学生' || !name) return res.code(403).send({ ok: false, message: '仅学生可提交请假申请' });
    const b = req.body || {};
    // 挂起草稿宽松校验（仅要求签名）；正式提交走完整校验
    if (b.draft) {
      if (!b.signature || !/^data:image\/png;base64,/.test(b.signature)) return res.code(400).send({ ok: false, message: '缺少签名' });
    } else if (!validForm(b)) {
      return res.code(400).send({ ok: false, message: '表单字段不完整或格式错误' });
    }
    const f = formData(b);
    const stu = db.prepare('SELECT name FROM students WHERE id = ?').get(name);
    const status = b.draft ? 'editing' : 'pending';
    const info = db.prepare(`INSERT INTO leaves (student_id, student_name, type, date_from, time_from, date_to, time_to, reason, images, signature, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(name, stu ? stu.name : `学生${name}`, f.type, f.dateFrom, f.timeFrom, f.dateTo, f.timeTo, f.reason, f.images, f.signature, status, now(), now());
    return { ok: true, id: Number(info.lastInsertRowid), draft: !!b.draft };
  });

  app.patch('/api/leaves/:id', async (req, res) => {
    const id = Number(req.params.id);
    const role = readRole(req);
    const name = readName(req);
    const row = db.prepare('SELECT * FROM leaves WHERE id = ?').get(id);
    if (!row) return res.code(404).send({ ok: false, message: '请假记录不存在' });
    const b = req.body || {};
    const action = String(b.action || '');

    const studentGuard = () => (role === '学生' && row.student_id === name);
    const isPending = row.status === 'pending';

    if (action === 'start-edit') {
      if (!studentGuard() || !['pending', 'rejected'].includes(row.status)) return res.code(403).send({ ok: false, message: '当前状态不可编辑' });
      db.prepare('UPDATE leaves SET status = ?, base_snapshot = ?, draft_snapshot = NULL, updated_at = ? WHERE id = ?')
        .run('editing', JSON.stringify(parseRow(row)), now(), id);
      return { ok: true, leave: parseRow(db.prepare('SELECT * FROM leaves WHERE id = ?').get(id)) };
    }

    if (action === 'save') {
      if (!studentGuard() || row.status !== 'editing') return res.code(403).send({ ok: false, message: '仅编辑中的申请可保存' });
      const f = formData(b); // 挂起保存同样宽松，不跑 validForm
      db.prepare('UPDATE leaves SET type=?, date_from=?, time_from=?, date_to=?, time_to=?, reason=?, images=?, signature=?, draft_snapshot=?, updated_at=? WHERE id=?')
        .run(f.type, f.dateFrom, f.timeFrom, f.dateTo, f.timeTo, f.reason, f.images, f.signature, JSON.stringify(f), now(), id);
      return { ok: true, saved: true };
    }

    if (action === 'submit') {
      if (!studentGuard() || row.status !== 'editing') return res.code(403).send({ ok: false, message: '仅编辑中的申请可重新提交' });
      if (!validForm(b)) return res.code(400).send({ ok: false, message: '表单字段不完整或格式错误' });
      const f = formData(b);
      db.prepare(`UPDATE leaves SET type=?, date_from=?, time_from=?, date_to=?, time_to=?, reason=?, images=?, signature=?,
        status='pending', reject_reason=NULL, base_snapshot=NULL, draft_snapshot=NULL, updated_at=? WHERE id=?`)
        .run(f.type, f.dateFrom, f.timeFrom, f.dateTo, f.timeTo, f.reason, f.images, f.signature, now(), id);
      return { ok: true, resubmitted: true };
    }

    if (action === 'cancel-edit') {
      if (!studentGuard() || row.status !== 'editing') return res.code(403).send({ ok: false, message: '仅编辑中的申请可放弃修改' });
      const base = row.base_snapshot ? JSON.parse(row.base_snapshot) : parseRow(row);
      db.prepare(`UPDATE leaves SET type=?, date_from=?, time_from=?, date_to=?, time_to=?, reason=?, images=?, signature=?,
        status='pending', base_snapshot=NULL, draft_snapshot=NULL, updated_at=? WHERE id=?`)
        .run(base.type, base.dateFrom, base.timeFrom, base.dateTo, base.timeTo, base.reason, JSON.stringify(base.images || []), base.signature, now(), id);
      return { ok: true, restored: true };
    }

    if (action === 'delete') {
      if (!studentGuard() || row.status !== 'editing') return res.code(403).send({ ok: false, message: '仅编辑中的挂起申请可删除' });
      db.prepare('DELETE FROM leaves WHERE id = ?').run(id);
      return { ok: true, deleted: true };
    }

    if (action === 'revoke') {
      if (!studentGuard() || !isPending) return res.code(403).send({ ok: false, message: '仅待审批的申请可撤销' });
      const reason = String(b.reason || '').trim().slice(0, 300);
      if (!reason) return res.code(400).send({ ok: false, message: '请填写撤销理由' });
      db.prepare("UPDATE leaves SET status='revoked', revoke_reason=?, updated_at=? WHERE id=?").run(reason, now(), id);
      return { ok: true, revoked: true };
    }

    if (action === 'approve') {
      if (role !== '导员' && role !== 'IT管理员') return res.code(403).send({ ok: false, message: '仅导员可审批' });
      if (role === '导员') {
        // D8：导员仅可审批绑定班级学生的申请（未绑定/非绑定班 → 403 引导）
        const stu = db.prepare('SELECT class_id FROM students WHERE id = ?').get(row.student_id);
        const bound = stu && db.prepare('SELECT 1 FROM counselor_classes WHERE counselor_name = ? AND class_id = ?').get(name, stu.class_id);
        if (!bound) return res.code(403).send({ ok: false, message: '该学生不在您绑定的班级内（请联系教务处在教务管理→教师管理中分配所带班级）' });
      }
      if (!isPending) return res.code(403).send({ ok: false, message: '仅待审批的申请可同意' });
      // 销假要求：requireReturn { photo: bool, sign: bool }（至少勾选一项才生效；缺省/空 = 不要求销假）；returnNote 备注（选填，展示给学生）
      let rr = null;
      if (b.requireReturn && typeof b.requireReturn === 'object') {
        const photo = !!b.requireReturn.photo;
        const sign = !!b.requireReturn.sign;
        if (photo || sign) rr = JSON.stringify({ photo, sign });
      }
      const note = String(b.returnNote || '').trim().slice(0, 300) || null;
      db.prepare("UPDATE leaves SET status='approved', return_required=?, return_note=?, updated_at=? WHERE id=?").run(rr, note, now(), id);
      return { ok: true, approved: true, returnRequired: rr ? JSON.parse(rr) : null, returnNote: note || '' };
    }

    if (action === 'return') {
      // 学生销假：仅 approved 且带销假要求的申请；按导员勾选校验照片/签名
      if (!studentGuard() || row.status !== 'approved') return res.code(403).send({ ok: false, message: '仅已同意的申请可销假' });
      const req = row.return_required ? JSON.parse(row.return_required) : null;
      if (!req) return res.code(403).send({ ok: false, message: '该申请无需销假' });
      const photo = String(b.returnPhoto || '');
      const sign = String(b.returnSignature || '');
      if (req.photo && !/^data:image\//.test(photo)) return res.code(400).send({ ok: false, message: '按要求需提交销假照片' });
      if (req.sign && !/^data:image\/png;base64,/.test(sign)) return res.code(400).send({ ok: false, message: '按要求需提交销假签名' });
      db.prepare("UPDATE leaves SET status='completed', return_photo=?, return_signature=?, return_at=?, updated_at=? WHERE id=?")
        .run(req.photo ? photo : null, req.sign ? sign : null, now(), now(), id);
      return { ok: true, returned: true };
    }

    if (action === 'reject') {
      if (role !== '导员' && role !== 'IT管理员') return res.code(403).send({ ok: false, message: '仅导员可审批' });
      if (role === '导员') {
        // D8：导员仅可驳回绑定班级学生的申请
        const stu = db.prepare('SELECT class_id FROM students WHERE id = ?').get(row.student_id);
        const bound = stu && db.prepare('SELECT 1 FROM counselor_classes WHERE counselor_name = ? AND class_id = ?').get(name, stu.class_id);
        if (!bound) return res.code(403).send({ ok: false, message: '该学生不在您绑定的班级内' });
      }
      if (!isPending) return res.code(403).send({ ok: false, message: '仅待审批的申请可拒绝' });
      const reason = String(b.reason || '').trim().slice(0, 300);
      if (!reason) return res.code(400).send({ ok: false, message: '请填写拒绝理由' });
      db.prepare("UPDATE leaves SET status='rejected', reject_reason=?, updated_at=? WHERE id=?").run(reason, now(), id);
      return { ok: true, rejected: true };
    }

    return res.code(400).send({ ok: false, message: '未知操作' });
  });
}
