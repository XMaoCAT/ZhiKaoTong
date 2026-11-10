// 违规积分 API 客户端（后端 src/api/violations.js）
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

/** 手动登记违规（学生处/导员/IT——D6；旷寝主入口） { studentId, type, note } */
export function registerViolation({ studentId, type, note = '' }) {
  return json(fetch('/api/violations', { method: 'POST', headers: headers(), body: JSON.stringify({ studentId, type, note }) }));
}

/** 违规流水 / 低分名单（{ studentId?, type?, low }；导员按绑定班级 D8；unbound=未绑定标记；
 *  2026-10-29 A3：响应动态携带 points/warnBelow（考勤规则可配置，严禁再复制常量副本） */
export async function fetchViolations(opts = {}) {
  const q = new URLSearchParams();
  if (opts.studentId) q.set('studentId', opts.studentId);
  if (opts.type) q.set('type', opts.type);
  if (opts.low) q.set('low', '1');
  const d = await json(fetch(`/api/violations${q.toString() ? '?' + q.toString() : ''}`, { headers: headers() }));
  return { violations: d.violations || [], students: d.students || [], unbound: !!d.unbound, warnBelow: d.warnBelow || 60, points: d.points || { '旷课': -5, '旷寝': -10 } };
}

/** 各班汇总（导员仅绑定班级 D8；unbound=未绑定标记） */
export async function fetchViolationSummary() {
  const d = await json(fetch('/api/violations/summary', { headers: headers() }));
  return { summary: d.summary || [], unbound: !!d.unbound, warnBelow: d.warnBelow || 60, points: d.points || { '旷课': -5, '旷寝': -10 } };
}

/** 当前考勤规则（非学生登录角色；登记弹窗分值/预警展示动态取值）→ { rules: {absencePoints,dormPoints,warnBelow}, points: {旷课,旷寝} } */
export async function fetchViolationRules() {
  const d = await json(fetch('/api/violations/rules', { headers: headers() }));
  return { rules: d.rules || { absencePoints: 5, dormPoints: 10, warnBelow: 60 }, points: d.points || { '旷课': -5, '旷寝': -10 } };
}
