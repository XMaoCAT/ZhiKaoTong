/**
 * SSE 全角色发布池（服务端内存态，开发计划 §4.1）
 * ---------------------------------------------------------------------------
 * 频道寻址三级：
 *   role:<角色名>    —— 按角色广播（如 role:教务处 / role:学生处 / role:导员）
 *   class:<classId>  —— 按班级广播（学生按其 students.class_id 自动挂入）
 *   teacher:<账号名> —— 按教师账号点对点（教师连接 = role:教师 + teacher:教师01 双频道）
 *
 * 生命周期：连接经 register() 挂入频道并启动 15s 心跳（': ping\n\n'，与 src/api/events.js 样板同款）；
 *   req.raw.on('close') 时调用 unregister() 清心跳并退出全部频道；发布时写流已断则静默移除该连接。
 *
 * 不复用 src/core/events.js 的 taskEvents 单例——那是任务级一次性流（done/error 即终结），
 * 与本池「长期在线 + 多频道订阅」语义不同；连接写法逐行参照 src/api/events.js L17-47 样板。
 */

const HEARTBEAT_MS = 15000;

/** 连接记录：res -> { hbTimer, channels } */
const connections = new Map();

/** 频道索引：channel -> Set<res>（与 connections.channels 双向维护） */
const channelIndex = new Map();

const channelKey = {
  role: (role) => `role:${role}`,
  class: (classId) => `class:${classId}`,
  teacher: (name) => `teacher:${name}`,
};

function joinChannel(channel, res) {
  let set = channelIndex.get(channel);
  if (!set) { set = new Set(); channelIndex.set(channel, set); }
  set.add(res);
}

function leaveChannel(channel, res) {
  const set = channelIndex.get(channel);
  if (!set) return;
  set.delete(res);
  if (!set.size) channelIndex.delete(channel); // 空频道即时回收
}

/**
 * 注册一个 SSE 连接到若干频道（幂等：重复注册同一 res 先注销旧记录）
 * @param {import('http').ServerResponse} res - hijack 后的 raw response（已 writeHead 完毕）
 * @param {string[]} channels - 频道全名数组（如 ['role:教师', 'teacher:教师01']）
 */
function register(res, channels = []) {
  if (connections.has(res)) unregister(res); // 幂等保护
  const list = [...new Set(channels.filter(Boolean))];
  connections.set(res, { hbTimer: null, channels: new Set(list) });
  const conn = connections.get(res);
  conn.hbTimer = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { unregister(res); }
  }, HEARTBEAT_MS);
  list.forEach((ch) => joinChannel(ch, res));
}

/** 注销连接：清心跳 + 退出全部频道（close 事件与写失败都会走到这里） */
function unregister(res) {
  const conn = connections.get(res);
  if (!conn) return;
  if (conn.hbTimer) clearInterval(conn.hbTimer);
  conn.channels.forEach((ch) => leaveChannel(ch, res));
  connections.delete(res);
}

/**
 * 向单频道推送命名事件（SSE 帧：`event: <name>\ndata: <json>\n\n`）
 * 写失败的连接静默移除（客户端已断，等 close 事件是兜底）
 */
function publish(channel, event, data) {
  const set = channelIndex.get(channel);
  if (!set || !set.size) return 0;
  const frame = `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
  let delivered = 0;
  for (const res of [...set]) {
    try {
      res.write(frame);
      delivered += 1;
    } catch {
      unregister(res);
    }
  }
  return delivered;
}

const publishToRole = (role, event, data) => publish(channelKey.role(role), event, data);
const publishToClass = (classId, event, data) => publish(channelKey.class(classId), event, data);
const publishToTeacher = (name, event, data) => publish(channelKey.teacher(name), event, data);

/** 自检/调试：某频道的当前连接数；不传 channel 返回总连接数 */
function connectionCount(channel) {
  if (channel == null) return connections.size;
  const set = channelIndex.get(String(channel));
  return set ? set.size : 0;
}

export const pub = {
  register,
  unregister,
  publish,
  publishToRole,
  publishToClass,
  publishToTeacher,
  connectionCount,
  channelKey,
};
