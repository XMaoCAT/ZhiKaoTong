// 系统数据管理 API 客户端（后端 src/api/admin-data.js；IT管理员专属 + 登录页公开账号列表）
import { currentRole, currentName, STAFF_ACCOUNTS } from './roles.js';

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

/** 登录页教职工账号列表（公开端点；失败回落固定常量）→ { teachers, management, all } */
export async function fetchStaffAccounts() {
  try {
    const d = await json(fetch('/api/staff-accounts'));
    return { teachers: d.teachers || [], management: d.management || [], all: [...(d.teachers || []), ...(d.management || [])] };
  } catch {
    // 网络异常回落：固定常量（教师01/02 + 管理账号）
    return { teachers: STAFF_ACCOUNTS.filter((a) => a.startsWith('教师')), management: STAFF_ACCOUNTS.filter((a) => !a.startsWith('教师')), all: STAFF_ACCOUNTS.slice() };
  }
}

/** 各业务表记录数汇总（初始化前查看数据规模） */
export async function fetchAdminDataStatus() {
  const d = await json(fetch('/api/admin/data-status', { headers: headers() }));
  return d.counts || {};
}

/** 初始化：全部信息记录清零（不可逆） */
export function adminReset() {
  return json(fetch('/api/admin/reset', { method: 'POST', headers: headers(), body: '{}' }));
}

/** 生成模拟数据：5 教师（教师01-05）+ 100 学生（学号 000000001-000000100） */
export function adminSeed() {
  return json(fetch('/api/admin/seed', { method: 'POST', headers: headers(), body: '{}' }));
}

/** 考勤规则读取（2026-10-29 A3：旷课/旷寝扣分与预警线，settings 单源）→ { rules, points } */
export async function fetchAttendanceRules() {
  const d = await json(fetch('/api/admin/attendance-rules', { headers: headers() }));
  return { rules: d.rules || { absencePoints: 5, dormPoints: 10, warnBelow: 60 }, points: d.points || { '旷课': -5, '旷寝': -10 } };
}

/** 考勤规则保存 { absencePoints, dormPoints, warnBelow }（各项 1–100 整数，即时生效） */
export function saveAttendanceRules(rules) {
  return json(fetch('/api/admin/attendance-rules', { method: 'POST', headers: headers(), body: JSON.stringify(rules) }));
}

/** 数据归档查询（2026-10-29 A4）{ dataset: leaves|violations|sessions, from?, to? } → { cols, rows } */
export async function fetchAdminArchive({ dataset, from = '', to = '' }) {
  const q = new URLSearchParams({ dataset });
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  const d = await json(fetch(`/api/admin/archive?${q.toString()}`, { headers: headers() }));
  return { cols: d.cols || [], rows: d.rows || [] };
}
