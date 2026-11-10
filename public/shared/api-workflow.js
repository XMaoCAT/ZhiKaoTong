// 审批工作流 API 客户端（后端 src/api/workflow.js）
// 角色头沿用 encodeURIComponent 约定（坑：HTTP 头禁直写非 ASCII）
import { currentRole, currentName } from './roles.js';

function headers() {
  const h = { 'Content-Type': 'application/json', 'x-zkt-role': encodeURIComponent(currentRole() || '') };
  const name = currentName();
  if (name) h['x-zkt-name'] = encodeURIComponent(name);
  return h;
}

async function json(promise) {
  const res = await promise;
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.message || `请求失败（${res.status}）`);
  return data;
}

/** 提交申请 { type, payload } → { id, title, status } */
export function submitRequest(type, payload) {
  return json(fetch('/api/workflow/requests', { method: 'POST', headers: headers(), body: JSON.stringify({ type, payload }) }));
}

/** 申请列表（审批方视角；{ status?, mine? }；mine=1 为发起人视角） */
export async function fetchRequests(opts = {}) {
  const q = new URLSearchParams();
  if (opts.status) q.set('status', opts.status);
  if (opts.mine) q.set('mine', '1');
  const d = await json(fetch(`/api/workflow/requests${q.toString() ? '?' + q.toString() : ''}`, { headers: headers() }));
  return d.requests || [];
}

/** 审批 { action: 'approve'|'reject', reason }（reject 必填原因） */
export function reviewRequest(id, action, reason = '') {
  return json(fetch(`/api/workflow/requests/${id}/review`, { method: 'POST', headers: headers(), body: JSON.stringify({ action, reason }) }));
}

/** 撤回申请（发起人 + pending） */
export function withdrawRequest(id) {
  return json(fetch(`/api/workflow/requests/${id}/withdraw`, { method: 'POST', headers: headers() }));
}

/** 通知列表（按当前身份受众过滤；unread=1 仅未读） */
export async function fetchNotifications(opts = {}) {
  const d = await json(fetch(`/api/notifications${opts.unread ? '?unread=1' : ''}`, { headers: headers() }));
  return d.notifications || [];
}

/** 标记通知已读 */
export function markNotificationsRead(ids) {
  return json(fetch('/api/notifications/read', { method: 'POST', headers: headers(), body: JSON.stringify({ ids }) }));
}

/** 请假耽误课程清单（D8：向导 Step2 / 审批弹窗展示） */
export async function fetchAffectedLessons({ studentId, dateFrom, timeFrom, dateTo, timeTo }) {
  const q = new URLSearchParams({ studentId, dateFrom, timeFrom, dateTo, timeTo });
  const d = await json(fetch(`/api/timetable/affected?${q.toString()}`, { headers: headers() }));
  return d.lessons || [];
}

/** 申请状态中文（胶囊用） */
export const REQ_STATUS = { pending: '待审批', approved: '已通过', rejected: '已驳回', withdrawn: '已撤回' };
