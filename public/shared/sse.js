// 全局 SSE 转发件（开发计划 §4.3）：宿主级单连接 + eventBus 分发
// ---------------------------------------------------------------------------
// 为什么在宿主连而不是各模块连：模块随 switchMain 频繁 mount/unmount，
// 连接放模块会反复建断；宿主级单连接（main.js enterWorkspace 成功路径末尾调用）+ eventBus 分发最稳。
// EventSource 无法携带自定义头 → 身份走 query 通道（?role=&name=，服务端 http-utils 双通道兼容）。
// 收到命名事件 → eventBus.emit('sse:' + camel 化名, data)；onopen 且非首次 → 'sse:reconnected'（离线补拉依据）。
import { currentRole, currentName } from './roles.js';
import { eventBus } from '../core/event-bus.js';

let source = null;
let opened = false;

/** 事件名 → EventBus 名（workflow:request-new → sse:workflowRequestNew） */
const busName = (name) => 'sse:' + name.replace(/[:-]([a-z])/g, (m, c) => c.toUpperCase());

const NAMED_EVENTS = [
  'workflow:request-new',
  'workflow:request-reviewed',
  'timetable:lesson-added',
  'timetable:lesson-cancelled',
  'classroom:session-opened',
  'classroom:session-ended',
  'academic:students-changed',
  'survey:published',
  'survey:closed',
  'survey:reminded',
];

/** 连接全局事件流（幂等：已连接则返回现有句柄） */
export function connectGlobalSSE() {
  if (source) return { close, reconnect };
  const role = currentRole();
  if (!role) return { close: () => {}, reconnect: () => {} }; // 未登录不连接
  const q = new URLSearchParams({ role, name: currentName() || role });
  source = new EventSource(`/api/events/global?${q.toString()}`);

  source.addEventListener('hello', (e) => {
    opened = true;
    try { eventBus.emit('sse:hello', JSON.parse(e.data)); } catch { /* ignore */ }
  });
  source.onopen = () => {
    if (opened) eventBus.emit('sse:reconnected', {}); // 重连（非首次 open）
  };
  source.onerror = () => { /* EventSource 原生自动重连；无需处理 */ };
  NAMED_EVENTS.forEach((name) => {
    source.addEventListener(name, (e) => {
      let data = {};
      try { data = JSON.parse(e.data); } catch { /* ignore */ }
      eventBus.emit(busName(name), data);
    });
  });
  return { close, reconnect };
}

function close() {
  if (source) { source.close(); source = null; opened = false; }
}

function reconnect() {
  close();
  return connectGlobalSSE();
}
