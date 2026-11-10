// 教务管理 API 客户端（后端 src/api/academic.js）
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

/** 全部学生（姓名+学号+班级） */
export async function fetchStudents() {
  const d = await json(fetch('/api/academic/students', { headers: headers() }));
  return d.students || [];
}

/** 班级列表 + 未分配人数 */
export async function fetchClasses() {
  const d = await json(fetch('/api/academic/classes', { headers: headers() }));
  return { classes: d.classes || [], unassigned: d.unassigned || 0 };
}

/** 新建班级（majorId 可选：专业部归属 D1a；不传=未归属） */
export function createClass(name, majorId = null) {
  return json(fetch('/api/academic/classes', { method: 'POST', headers: headers(), body: JSON.stringify({ name, majorId }) }));
}

/** 把学生划入班级（ids 为 9 位学号数组；单个/批量添加共用） */
export function addStudentsToClass(classId, ids) {
  return json(fetch(`/api/academic/classes/${classId}/students`, { method: 'POST', headers: headers(), body: JSON.stringify({ ids }) }));
}

/** 编辑班级成员：移出（回未分配）+加入 统一提交（2026-10-22） */
export function updateClassMembers(classId, removeIds, addIds) {
  return json(fetch(`/api/academic/classes/${classId}/members`, { method: 'POST', headers: headers(), body: JSON.stringify({ removeIds, addIds }) }));
}

/** 解散班级（学生还原未分配+清教师关联+删班级；原因必填）（2026-10-22） */
export function dissolveClass(classId, reason) {
  return json(fetch(`/api/academic/classes/${classId}/dissolve`, { method: 'POST', headers: headers(), body: JSON.stringify({ reason }) }));
}

/** 班级重命名（学生处/IT 直改；教务处走 class-rename 申请）（2026-10-29 C1） */
export function renameClass(classId, name) {
  return json(fetch(`/api/academic/classes/${classId}/rename`, { method: 'POST', headers: headers(), body: JSON.stringify({ name }) }));
}

/** 教师列表（含授课班级 id；teachers 表动态账号） */
export async function fetchTeachers() {
  const d = await json(fetch('/api/academic/teachers', { headers: headers() }));
  return d.teachers || [];
}

/** 添加教师（教务处/IT 直改；姓名唯一、禁与管理账号重名；2026-10-24 用户需求） */
export function addTeacher(name) {
  return json(fetch('/api/academic/teachers', { method: 'POST', headers: headers(), body: JSON.stringify({ name }) }));
}

/** 设置教师授课班级（整体替换） */
export function setTeacherClasses(teacherName, classIds) {
  return json(fetch(`/api/academic/teachers/${encodeURIComponent(teacherName)}/classes`, { method: 'POST', headers: headers(), body: JSON.stringify({ classIds }) }));
}

/** 教师视角：授课班级 + 学生名册 + 各自请假记录 */
export async function fetchMyClasses() {
  const d = await json(fetch('/api/academic/my-classes', { headers: headers() }));
  return d.classes || [];
}
