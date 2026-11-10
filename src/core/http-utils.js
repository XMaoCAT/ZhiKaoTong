/**
 * HTTP 身份头读取工具（单源，踩坑 #05 禁令：readRole/readName 严禁再复制第四份副本）
 * 契约：身份经 `x-zkt-role` / `x-zkt-name` 请求头传输，值必须 URI 编码（HTTP 头仅允许 ASCII，
 * 见 mod-login DEV_LOG 踩坑 #02）；SSE EventSource 无法携带自定义头，兼容 query 传参
 * （?role=&name=，由调用方传入 decoded 对象时直接使用）。
 */

function decodeHeader(value) {
  const raw = String(value || '');
  try { return decodeURIComponent(raw); } catch { return raw; }
}

/** 读请求角色（header 优先，query 兜底），返回解码后字符串（未传为 ''） */
export function readRole(req) {
  const header = req.headers ? req.headers['x-zkt-role'] : null;
  if (header != null && header !== '') return decodeHeader(header);
  const q = (req.query && (req.query.role || req.query.r)) || '';
  return decodeHeader(String(q));
}

/** 读请求姓名/账号（header 优先，query 兜底），返回解码后字符串（未传为 ''） */
export function readName(req) {
  const header = req.headers ? req.headers['x-zkt-name'] : null;
  if (header != null && header !== '') return decodeHeader(header);
  const q = (req.query && (req.query.name || req.query.n)) || '';
  return decodeHeader(String(q));
}
