// 问卷与投票 API 客户端（后端 src/api/surveys.js）
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

/** 创建问卷/投票（草稿）payload：{ kind, title, description?, anonymous?, audience, targetClassIds?, targetTeacherNames?, deadline?, questions?|voteConfig?, visibility? } */
export function createSurvey(payload) {
  return json(fetch('/api/surveys', { method: 'POST', headers: headers(), body: JSON.stringify(payload) }));
}

/** 列表（按角色分支：学生/教师=可填含我的状态；导员=我创建+可见统计[响应含 boundClassIds 供创建表单用]；学生处/教务处/IT=全部） */
export async function fetchSurveys() {
  const d = await json(fetch('/api/surveys', { headers: headers() }));
  return { surveys: d.surveys || [], boundClassIds: d.boundClassIds || null };
}

/** 详情（含 questions/voteConfig/我的作答或选票/投票结果可见性） */
export async function fetchSurvey(id) {
  const d = await json(fetch(`/api/surveys/${id}`, { headers: headers() }));
  return d.survey;
}

/** 发布（发起人/IT；draft → published，通知受众） */
export function publishSurvey(id) {
  return json(fetch(`/api/surveys/${id}/publish`, { method: 'POST', headers: headers(), body: '{}' }));
}

/** 关闭（发起人/IT；published → closed，通知受众） */
export function closeSurvey(id) {
  return json(fetch(`/api/surveys/${id}/close`, { method: 'POST', headers: headers(), body: '{}' }));
}

/** 问卷作答 { answers: [{questionId, value}] }（受众；一卷一填） */
export function submitSurvey(id, answers) {
  return json(fetch(`/api/surveys/${id}/submit`, { method: 'POST', headers: headers(), body: JSON.stringify({ answers }) }));
}

/** 投票 { choices: [{optionId, count}] }（票数规则服务端校验；改票=整体覆盖） */
export function voteSurvey(id, choices) {
  return json(fetch(`/api/surveys/${id}/vote`, { method: 'POST', headers: headers(), body: JSON.stringify({ choices }) }));
}

/** 催填提醒（发起人/导员/IT → 未填者所在频道） */
export function remindSurvey(id) {
  return json(fetch(`/api/surveys/${id}/remind`, { method: 'POST', headers: headers(), body: '{}' }));
}

/** 统计（canViewStats；含填写率/未填名单/分布或票数/实名明细） */
export async function fetchSurveyStats(id) {
  const d = await json(fetch(`/api/surveys/${id}/stats`, { headers: headers() }));
  return d.stats;
}

/** 删除（发起人/IT；连带清作答/选票，前端需 danger 确认） */
export function deleteSurvey(id) {
  return json(fetch(`/api/surveys/${id}`, { method: 'DELETE', headers: headers() }));
}

/** 状态中文（胶囊用） */
export const SURVEY_STATUS = { draft: '草稿', published: '进行中', closed: '已结束' };
/** 受众中文 */
export const AUDIENCE_LABEL = { students: '学生', teachers: '教师', all: '师生' };
