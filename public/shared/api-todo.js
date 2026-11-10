// 待办计数与全局搜索 API 客户端（后端 src/api/todo.js + src/api/search.js，2026-11-03 批二）
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

/** 待办计数 → { items: [{ moduleId, label, count }], total }（口径：后端单源，对齐 landing C4） */
export async function fetchTodoSummary() {
  const d = await json(fetch('/api/todo/summary', { headers: headers() }));
  return { items: d.items || [], total: d.total || 0 };
}

/** 全局搜索 → { q, groups: { students, classes, teachers, lessons } }（按角色范围过滤） */
export async function searchAll(q) {
  const d = await json(fetch(`/api/search?q=${encodeURIComponent(q)}`, { headers: headers() }));
  return d.groups || { students: [], classes: [], teachers: [], lessons: [] };
}
