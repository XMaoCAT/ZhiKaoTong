// 专业部 API 客户端（后端 src/api/majors.js）
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

/** 专业部列表（含 teachers/classIds/unassignedTeachers/counselors） */
export async function fetchMajors() {
  const d = await json(fetch('/api/majors', { headers: headers() }));
  return { majors: d.majors || [], unassignedTeachers: d.unassignedTeachers || [], counselors: d.counselors || [] };
}

/** 新建专业部（TEACHER_ADMIN：教务处/IT） */
export function createMajor(name) {
  return json(fetch('/api/majors', { method: 'POST', headers: headers(), body: JSON.stringify({ name }) }));
}

/** 编辑专业部教师（多对多：removeNames/addNames 统一提交） */
export function updateMajorMembers(majorId, removeNames, addNames) {
  return json(fetch(`/api/majors/${majorId}/members`, { method: 'POST', headers: headers(), body: JSON.stringify({ removeNames, addNames }) }));
}

/** 解散专业部（班级归属置 NULL；原因必填） */
export function dissolveMajor(majorId, reason) {
  return json(fetch(`/api/majors/${majorId}/dissolve`, { method: 'POST', headers: headers(), body: JSON.stringify({ reason }) }));
}

/** 导员班级绑定（整体替换，D7） */
export function setCounselorClasses(counselorName, classIds) {
  return json(fetch(`/api/majors/counselor/${encodeURIComponent(counselorName)}/classes`, { method: 'POST', headers: headers(), body: JSON.stringify({ classIds }) }));
}
