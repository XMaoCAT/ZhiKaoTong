// 课堂管理 API 客户端（后端 src/api/classroom.js）
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

/** 发起课堂 { classId, lessonId?, courseName?, startTime?, endTime?, signMode('code'|'click'), signCode? } */
export function startSession(payload) {
  return json(fetch('/api/classroom/sessions', { method: 'POST', headers: headers(), body: JSON.stringify(payload) }));
}

/** 学生签到 { code? }（code 模式必填 4 位口令） */
export function signSession(sessionId, code = '') {
  return json(fetch(`/api/classroom/sessions/${sessionId}/sign`, { method: 'POST', headers: headers(), body: JSON.stringify({ code }) }));
}

/** 会话详情（三类名单+事件流+计数；学生端含 mySign 且剥离口令） */
export async function fetchSession(sessionId) {
  const d = await json(fetch(`/api/classroom/sessions/${sessionId}`, { headers: headers() }));
  return d.session || null;
}

/** 历史列表（教师本人；{ teacher?, date?, all? } 教务/IT 可查全部） */
export async function fetchSessions(opts = {}) {
  const q = new URLSearchParams();
  if (opts.teacher) q.set('teacher', opts.teacher);
  if (opts.date) q.set('date', opts.date);
  if (opts.all) q.set('all', '1');
  const d = await json(fetch(`/api/classroom/sessions${q.toString() ? '?' + q.toString() : ''}`, { headers: headers() }));
  return d.sessions || [];
}

/** 学生进行中签到卡（本班 open + 本人签到态；离线兜底补拉） */
export async function fetchOpenSessions(classId) {
  const d = await json(fetch(`/api/classroom/sessions?classId=${Number(classId)}&open=1`, { headers: headers() }));
  return d.sessions || [];
}

/** 结束课堂（未签到未请假学生快照为 absent） */
export function endSession(sessionId) {
  return json(fetch(`/api/classroom/sessions/${sessionId}/end`, { method: 'POST', headers: headers(), body: '{}' }));
}

/** 教师代签 */
export function proxySign(sessionId, studentId) {
  return json(fetch(`/api/classroom/sessions/${sessionId}/proxy-sign`, { method: 'POST', headers: headers(), body: JSON.stringify({ studentId }) }));
}

/** 加减分（delta ∈ ±1/±2，可带 note） */
export function scoreStudent(sessionId, studentId, delta, note = '') {
  return json(fetch(`/api/classroom/sessions/${sessionId}/score`, { method: 'POST', headers: headers(), body: JSON.stringify({ studentId, delta, note }) }));
}

/** 随人批量（studentIds[]） */
export function pickStudents(sessionId, studentIds, note = '') {
  return json(fetch(`/api/classroom/sessions/${sessionId}/pick`, { method: 'POST', headers: headers(), body: JSON.stringify({ studentIds, note }) }));
}

/** 记旷课（事务扣分 -5） */
export function markAbsence(sessionId, studentId, note = '') {
  return json(fetch(`/api/classroom/sessions/${sessionId}/absence`, { method: 'POST', headers: headers(), body: JSON.stringify({ studentId, note }) }));
}

/** 撤销旷课（open 期还分；ended 期 409 引导走审批） */
export function cancelAbsence(sessionId, studentId) {
  return json(fetch(`/api/classroom/sessions/${sessionId}/absence/${encodeURIComponent(studentId)}`, { method: 'DELETE', headers: headers() }));
}
