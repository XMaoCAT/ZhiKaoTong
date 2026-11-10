// 请假业务 API 客户端（后端 src/api/leaves.js）
// 角色头沿用 encodeURIComponent 约定（坑：HTTP 头禁直写非 ASCII）
import { currentRole, currentName } from './roles.js';

function headers() {
  const h = { 'Content-Type': 'application/json', 'x-zkt-role': encodeURIComponent(currentRole() || '') };
  const name = currentName();
  if (name) h['x-zkt-name'] = encodeURIComponent(name);
  return h;
}

async function json(promise) {
  const res = await promise; // ⚠ 必须先 await 得到 Response，直接对 Promise 调 .json() 会报 res.json is not a function
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.message || `请求失败（${res.status}）`);
  return data;
}

/** 列表：学生=本人记录；教师=授课班；导员=绑定班级（D8，unbound=未绑定标记）；其他教职工=全部 */
export async function fetchLeaves() {
  const data = await json(fetch('/api/leaves', { headers: headers() }));
  return data.leaves || [];
}

/** 列表（含 unbound 标记，D8 导员未绑定班级时空态提示用） */
export async function fetchLeavesEx() {
  const data = await json(fetch('/api/leaves', { headers: headers() }));
  return { leaves: data.leaves || [], unbound: !!data.unbound };
}

/** 学生提交新申请（draft=true 为挂起保存） */
export function submitLeave(form) {
  return json(fetch('/api/leaves', { method: 'POST', headers: headers(), body: JSON.stringify(form) }));
}

/** 状态机操作：start-edit / save / submit / cancel-edit / delete / revoke / approve / reject */
export function leaveAction(id, action, extra = {}) {
  return json(fetch(`/api/leaves/${id}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ action, ...extra }),
  }));
}
