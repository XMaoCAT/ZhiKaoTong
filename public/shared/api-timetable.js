// 课表 API 客户端（后端 src/api/timetable.js）
// 角色头沿用 encodeURIComponent 约定（坑：HTTP 头禁直写非 ASCII）
import { currentRole, currentName } from './roles.js';

function headers() {
  const h = { 'x-zkt-role': encodeURIComponent(currentRole() || '') };
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

/** 班级课表（学生仅可查本班；教职工放行） */
export async function fetchClassTimetable(classId) {
  const d = await json(fetch(`/api/timetable?classId=${Number(classId)}`, { headers: headers() }));
  return d.lessons || [];
}

/** 教师课表（本人或教务处/IT；每条含 className；scope=all 返回授课班完整课表含他人课程） */
export async function fetchTeacherTimetable(teacherName, scope = '') {
  const q = scope ? `&scope=${scope}` : '';
  const d = await json(fetch(`/api/timetable?teacher=${encodeURIComponent(teacherName)}${q}`, { headers: headers() }));
  return d.lessons || [];
}

/** 专业部课表（该部下属班级课程集合，每条含 className——D1b 班级切换式数据源） */
export async function fetchMajorTimetable(majorId) {
  const d = await json(fetch(`/api/timetable?majorId=${Number(majorId)}`, { headers: headers() }));
  return d.lessons || [];
}

/** 学生自助：本班课表（按登录学号，无需传 classId） */
export async function fetchMyTimetable() {
  const d = await json(fetch('/api/timetable/mine', { headers: headers() }));
  return d.lessons || [];
}

/** 学生自助：本班课表 + 班级 id（签到卡离线补拉用） */
export async function fetchMyTimetableEx() {
  const d = await json(fetch('/api/timetable/mine', { headers: headers() }));
  return { lessons: d.lessons || [], classId: d.classId ?? null };
}
