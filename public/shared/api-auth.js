// 账号认证 API 客户端（后端 src/api/auth.js + admin-data.js 用户与角色管理端点）
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

/** 获取图形验证码 → { token, svg }（公开端点；登录时随账号密码一并提交，见 loginAccount） */
export function fetchCaptcha() {
  return json(fetch('/api/auth/captcha'));
}

/** 登录 { account, password, captchaToken, captchaInput } → { account, group }（公开端点；验证码/密码错误抛 Error(message)；限流 429） */
export function loginAccount(account, password, captchaToken, captchaInput) {
  return json(fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account, password, captchaToken, captchaInput }) }));
}

/** 修改当前登录账号自身密码 { oldPassword, newPassword } */
export function changePassword(oldPassword, newPassword) {
  return json(fetch('/api/auth/password', { method: 'POST', headers: headers(), body: JSON.stringify({ oldPassword, newPassword }) }));
}

/** 用户与角色管理：全部账号清单 → { students, teachers, management }（IT管理员） */
export async function fetchAdminAccounts() {
  const d = await json(fetch('/api/admin/accounts', { headers: headers() }));
  return { students: d.students || [], teachers: d.teachers || [], management: d.management || [] };
}

/** 重置指定账号密码为默认密码（IT管理员） */
export function resetAccountPassword(account) {
  return json(fetch('/api/admin/account-reset-password', { method: 'POST', headers: headers(), body: JSON.stringify({ account }) }));
}
