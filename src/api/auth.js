import crypto from 'node:crypto';
import { db, now } from '../core/db.js';
import { readRole, readName } from '../core/http-utils.js';
import { listTeacherNames, MANAGEMENT_ACCOUNTS } from './academic.js';

/**
 * 账号认证 API（2026-10-29 密码体系上线；2026-11-03 增登录限流+图形验证码）
 * ---------------------------------------------------------------------------
 * 端点：
 *   GET  /api/auth/captcha          → {token, svg}（自绘 SVG 图形验证码，零外部依赖；token 5 分钟过期+一次性消费）
 *   POST /api/auth/login            { account, password, captchaToken, captchaInput } → 校验验证码与密码并返回登录群组（公开）
 *   POST /api/auth/password         { oldPassword, newPassword } → 当前登录账号修改自身密码（校验会话身份头）
 *
 * 密码策略：
 *   - 默认密码 123456：账号在 account_credentials 表无自定义行时即用默认密码（覆盖全部学生/教师/管理账号，零种子成本）
 *   - 修改密码后存 scrypt 摘要（16 字节随机盐 + 32 字节输出），明文不落库
 *   - IT管理员重置密码走 admin-data.js 的 POST /api/admin/account-reset-password（删除自定义行 → 恢复默认密码）
 * 账号 → 群组判定（服务端镜像 roles.js staffAccountToGroup，含学生）：
 *   students 表命中 → 学生；teachers 表命中 → 教师；MANAGEMENT_ACCOUNTS → 同名群组；否则账号不存在。
 * 角色头：x-zkt-role / x-zkt-name（均 URI 编码，见 http-utils.js 单源）。
 *
 * 登录限流（2026-11-03 用户口径：仅计失败，单 IP 半小时窗口累计 5 次）：
 *   - 内存 Map<ip, 时间戳[]>，仅「账号不存在/密码错误」（401）记一次；成功登录不计不清零；验证码错误不计（防脚本刷爆计数锁死真人）
 *   - 超限后直接 429「尝试过于频繁，请半小时后再试」；内存实现不落库，重启即清零（内网演示可接受，见 mod-login DEV_LOG）
 * 图形验证码（每次登录必填）：4 位大写字母数字（去除易混淆 0O1lI）+干扰线+噪点 SVG；比对忽略大小写
 */

/** 默认密码（账号未设置自定义密码时生效；前端登录页 placeholder 同步提示） */
export const DEFAULT_PASSWORD = '123456';

db.exec(`
CREATE TABLE IF NOT EXISTS account_credentials (
  account TEXT PRIMARY KEY,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);

/** 账号 → 登录群组（学生=9 位学号；教师=teachers 表动态账号；管理账号与群组同名）；不存在返回 null */
export function groupForAccount(account) {
  if (db.prepare('SELECT 1 FROM students WHERE id = ?').get(account)) return '学生';
  if (db.prepare('SELECT 1 FROM teachers WHERE name = ?').get(account)) return '教师';
  if (MANAGEMENT_ACCOUNTS.includes(account)) return account;
  return null;
}

function scryptHex(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}

/** 校验密码：无自定义行 → 与默认密码比对；有行 → 与存储摘要比对（恒时比较防时序侧信道） */
export function verifyPassword(account, password) {
  const row = db.prepare('SELECT salt, hash FROM account_credentials WHERE account = ?').get(account);
  if (!row) return String(password) === DEFAULT_PASSWORD; // 默认密码公开于登录页提示，无需摘要比对
  // ⚠ 两边都必须从 hex 解码为 32 字节二进制再比较：一侧 Buffer.from(hexStr)（UTF-8 字节）另一侧 from(hex)
  // 会得到 64 vs 32 字节长度不等而恒假（2026-10-29 实测踩坑）
  const a = Buffer.from(scryptHex(password, row.salt), 'hex');
  const b = Buffer.from(row.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** 写入/覆盖自定义密码（scrypt + 随机盐） */
export function setPassword(account, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare(`
    INSERT INTO account_credentials (account, salt, hash, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(account) DO UPDATE SET salt = excluded.salt, hash = excluded.hash, updated_at = excluded.updated_at
  `).run(account, salt, scryptHex(password, salt), now());
}

/** 删除自定义密码行（恢复默认密码；IT 重置用；返回是否存在该行） */
export function clearPassword(account) {
  return db.prepare('DELETE FROM account_credentials WHERE account = ?').run(account).changes > 0;
}

/** 账号是否已设置自定义密码（用户与角色管理列表展示用） */
export function hasCustomPassword(account) {
  return !!db.prepare('SELECT 1 FROM account_credentials WHERE account = ?').get(account);
}

/* ==================== 登录限流（仅计失败·滑动窗口） ==================== */

/** 单 IP 半小时窗口内允许的登录失败上限（用户口径 2026-11-03：仅计失败次数） */
const LOGIN_FAIL_WINDOW_MS = 30 * 60 * 1000;
const LOGIN_FAIL_MAX = 5;
/** ip → 失败时间戳数组（内存态；重启清零，不落库） */
const loginFailures = new Map();

function pruneFailures(list, windowStart) {
  return list.filter((t) => t > windowStart);
}

/** 当前 IP 是否已被限流（顺带滑出过期时间戳） */
function isLoginRateLimited(ip) {
  const list = loginFailures.get(ip);
  if (!list || list.length === 0) return false;
  const alive = pruneFailures(list, Date.now() - LOGIN_FAIL_WINDOW_MS);
  if (alive.length !== list.length) {
    if (alive.length === 0) loginFailures.delete(ip);
    else loginFailures.set(ip, alive);
  }
  return alive.length >= LOGIN_FAIL_MAX;
}

/** 记一次登录失败（仅 401 账号不存在/密码错误时调用） */
function recordLoginFailure(ip) {
  const list = loginFailures.get(ip) || [];
  const alive = pruneFailures(list, Date.now() - LOGIN_FAIL_WINDOW_MS);
  alive.push(Date.now());
  loginFailures.set(ip, alive);
  // 上限保护：极端多 IP 场景直接清空（演示环境 IP 极少，防御性兜底）
  if (loginFailures.size > 10000) loginFailures.clear();
}

/* ==================== 图形验证码（自绘 SVG·零依赖） ==================== */

/** 验证码字符集：大写字母数字，去除易混淆 I O 0 1（无小写故无 l） */
const CAPTCHA_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CAPTCHA_TTL_MS = 5 * 60 * 1000;
/** token → { answer, expireAt }（内存态；一次性消费） */
const captchaStore = new Map();

/** 生成 4 位随机验证码文本 + 唯一 token（顺带清理过期项） */
function issueCaptcha() {
  let text = '';
  for (let i = 0; i < 4; i++) text += CAPTCHA_CHARS[Math.floor(Math.random() * CAPTCHA_CHARS.length)];
  const token = crypto.randomBytes(16).toString('hex');
  captchaStore.set(token, { answer: text, expireAt: Date.now() + CAPTCHA_TTL_MS });
  if (captchaStore.size > 500) {
    const t = Date.now();
    for (const [k, v] of captchaStore) if (v.expireAt < t) captchaStore.delete(k);
  }
  return { token, text };
}

/** 渲染验证码 SVG：4 字符随机旋转/偏移/颜色 + 4 条干扰线 + 30 噪点（字符集 A-Z2-9 无需 XML 转义；116×42 与登录页输入框同高） */
function makeCaptchaSvg(text) {
  const W = 116, H = 42;
  const palette = ['#1A73E8', '#D93025', '#188038', '#7627bb', '#0F172A'];
  const pick = () => palette[Math.floor(Math.random() * palette.length)];
  let chars = '';
  for (let i = 0; i < text.length; i++) {
    const x = 17 + i * 27;
    const y = 28 + (Math.random() * 8 - 4);
    const rot = Math.round(Math.random() * 24 - 12);
    const size = 22 + Math.round(Math.random() * 4);
    chars += `<text x="${x}" y="${y.toFixed(1)}" font-family="Georgia, 'Times New Roman', serif" font-size="${size}" font-weight="700" fill="${pick()}" text-anchor="middle" transform="rotate(${rot} ${x} ${y.toFixed(1)})">${text[i]}</text>`;
  }
  let lines = '';
  for (let i = 0; i < 4; i++) {
    lines += `<line x1="${(Math.random() * W).toFixed(1)}" y1="${(Math.random() * H).toFixed(1)}" x2="${(Math.random() * W).toFixed(1)}" y2="${(Math.random() * H).toFixed(1)}" stroke="${pick()}" stroke-width="1" opacity="0.45"/>`;
  }
  let dots = '';
  for (let i = 0; i < 30; i++) {
    dots += `<circle cx="${(Math.random() * W).toFixed(1)}" cy="${(Math.random() * H).toFixed(1)}" r="1" fill="#64748B" opacity="0.5"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="captcha"><rect width="${W}" height="${H}" fill="#F1F5F9" rx="8"/>${dots}${lines}${chars}</svg>`;
}

export function registerAuthRoutes(app) {
  /* ---------- 验证码：前端登录页挂载/刷新时获取（公开） ---------- */
  app.get('/api/auth/captcha', async () => {
    const { token, text } = issueCaptcha();
    return { ok: true, token, svg: makeCaptchaSvg(text) };
  });

  /* ---------- 登录：验证码 + 账号 + 密码 → 群组（公开） ---------- */
  app.post('/api/auth/login', async (req, res) => {
    const ip = req.ip || 'unknown';
    // 限流前置：超限直接拒绝（不消费验证码，提示语引导稍后再试）
    if (isLoginRateLimited(ip)) {
      return res.code(429).send({ ok: false, message: '尝试过于频繁，请半小时后再试' });
    }
    const account = String((req.body || {}).account || '').trim();
    const password = String((req.body || {}).password || '');
    // 验证码校验（一次性消费：读取即删除，防同一验证码多次试密码）
    const captchaToken = String((req.body || {}).captchaToken || '');
    const captchaInput = String((req.body || {}).captchaInput || '').trim().toUpperCase();
    if (!captchaToken || !captchaInput) {
      return res.code(400).send({ ok: false, message: '请输入验证码' });
    }
    const cap = captchaStore.get(captchaToken);
    captchaStore.delete(captchaToken);
    if (!cap || cap.expireAt < Date.now()) {
      return res.code(400).send({ ok: false, message: '验证码已过期，请点击图片刷新后重试' });
    }
    if (cap.answer !== captchaInput) {
      return res.code(400).send({ ok: false, message: '验证码错误' });
    }
    if (!account || !password) return res.code(400).send({ ok: false, message: '请输入账号与密码' });
    const group = groupForAccount(account);
    if (!group) { recordLoginFailure(ip); return res.code(401).send({ ok: false, message: '账号不存在' }); }
    if (!verifyPassword(account, password)) { recordLoginFailure(ip); return res.code(401).send({ ok: false, message: '密码错误' }); }
    // 成功登录：不计数也不清零（用户口径：仅计失败）
    return { ok: true, account, group, name: account };
  });

  /* ---------- 修改自身密码：校验会话身份头与账号一致（防改他人） ---------- */
  app.post('/api/auth/password', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    if (!role || !name) return res.code(403).send({ ok: false, message: '请先登录' });
    const group = groupForAccount(name);
    if (!group || group !== role) return res.code(403).send({ ok: false, message: '当前会话身份与账号不匹配' });
    const oldPassword = String((req.body || {}).oldPassword || '');
    const newPassword = String((req.body || {}).newPassword || '');
    if (!verifyPassword(name, oldPassword)) return res.code(400).send({ ok: false, message: '原密码错误' });
    if (newPassword.length < 6 || newPassword.length > 32) return res.code(400).send({ ok: false, message: '新密码需 6–32 位' });
    if (newPassword === oldPassword) return res.code(400).send({ ok: false, message: '新密码不能与原密码相同' });
    setPassword(name, newPassword);
    console.log(`[auth] 账号「${name}」修改了自身密码 @ ${now()}`);
    return { ok: true };
  });
}
