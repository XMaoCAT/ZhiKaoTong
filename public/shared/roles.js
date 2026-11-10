// 角色与权限分级：群组 × 账号 × 权限等级 × 模块可见性矩阵
// 群组（鉴权用）：学生 / 教师 / 教务处 / 学生处 / 导员 / IT管理员（2026-10-23 P1：教务科→教务处更名 + 新增学生处）
// 账号（登录用）：学生=9位学号（000000001–000000100，students 表）；教职工=教师01 / 教师02 / 教务处 / 学生处 / 导员 / IT管理员

/** 教职工登录账号（登录页下拉；固定账号回落常量——动态教师账号由 GET /api/staff-accounts 拉取，拉取失败时用本列表兑底） */
export const STAFF_ACCOUNTS = ['教师01', '教师02', '教务处', '学生处', '导员', 'IT管理员'];

/** 账号 → 群组映射（教师01/教师02 同为教师级权限） */
export const ACCOUNT_TO_GROUP = {
  '教师01': '教师',
  '教师02': '教师',
  '教务处': '教务处',
  '学生处': '学生处',
  '导员': '导员',
  'IT管理员': 'IT管理员',
};

/** 固定管理账号（与群组同名；动态教师账号不得与之重名，后端已校验） */
export const MANAGEMENT_ACCOUNTS = ['教务处', '学生处', '导员', 'IT管理员'];

/** 教职工账号 → 登录群组（2026-10-24 动态教师：固定账号查表，其余账号一律归教师群组；
 *  供登录页对动态下拉账号判定，严禁对动态教师名直查 ACCOUNT_TO_GROUP——会得到 undefined 被误当群组） */
export function staffAccountToGroup(account) {
  if (ACCOUNT_TO_GROUP[account]) return ACCOUNT_TO_GROUP[account];
  if (MANAGEMENT_ACCOUNTS.includes(account)) return account;
  return '教师';
}

export const ALL_ROLES = ['学生', '教师', '教务处', '学生处', '导员', 'IT管理员'];

/** 学生学号校验：9 位数字（现有 100 名学生：000000001–000000100） */
export function validStudentId(id) {
  const s = String(id).trim();
  return /^\d{9}$/.test(s) && +s >= 1 && +s <= 100;
}

/** 权限等级（数字越小权限越高）：IT管理员 0 > 教务处/学生处 1 > 导员/教师 2 > 学生 3 */
export const ROLE_LEVEL = {
  'IT管理员': 0,
  '教务处': 1,
  '学生处': 1,
  '导员': 2,
  '教师': 2,
  '学生': 3,
};

/** 取角色权限等级；未登录视为无等级权限 */
export const roleLevel = (role) => (role && ROLE_LEVEL[role] != null ? ROLE_LEVEL[role] : null);

/** 判断当前角色权限等级是否不高于（即权限不低于）指定等级 */
export const levelAtMost = (level) => {
  const lv = roleLevel(currentRole());
  return lv != null && lv <= level;
};

/** 各角色可见模块（分级制度；新模块 id 随各阶段 registry 注册后自动出现在侧栏，未注册时侧栏自动隐藏） */
export const ROLE_ACCESS = {
  '学生': ['landing', 'student-leave', 'courses', 'survey'],
  '教师': ['landing', 'student-leave', 'courses', 'classroom', 'survey'],
  '教务处': ['landing', 'student-leave', 'academic', 'lesson-review', 'class-records', 'survey'],
  '学生处': ['landing', 'student-leave', 'student-affairs', 'survey'],
  '导员': ['landing', 'student-leave', 'counselor-verify', 'survey'],
  'IT管理员': ['landing', 'student-leave', 'counselor-verify', 'admin-console', 'academic', 'student-affairs', 'courses', 'classroom', 'lesson-review', 'class-records', 'survey'],
};

/** 登录后默认进入的模块（模块未注册时宿主自动回落 landing） */
export const ROLE_HOME = {
  '学生': 'student-leave',
  '教师': 'landing',
  '教务处': 'landing',
  '学生处': 'student-affairs',
  '导员': 'counselor-verify',
  'IT管理员': 'admin-console',
};

/** 各角色职责说明（用于界面展示） */
export const ROLE_NOTE = {
  '学生': '发起请假申请、上传凭证、查看审批进度',
  '教师': '查看班级请假汇总与考勤情况（只读）',
  '教务处': '排课与授课班级分配（学生班级变更走申请）',
  '学生处': '学生班级管理与变更审批、违规与积分',
  '导员': '核实请假与考勤记录，完成核销与留痕',
  'IT管理员': '维护考勤规则、用户角色与系统数据',
};

/** 路由模式：''（普通）/ devN（PC 多角色调试）/ m-devN（手机多角色调试） */
export function routeMode(pathname = location.pathname) {
  const m = String(pathname).match(/^\/(m-)?dev(\d+)$/i);
  if (!m) return { type: 'normal', id: null, mobile: false, label: '' };
  return { type: m[1] ? 'm-dev' : 'dev', id: m[2], mobile: !!m[1], label: `${m[1] ? 'm-' : ''}dev${m[2]}` };
}

/** 会话存储键（群组/姓名分键；每个调试端点独立登录态） */
function sessionKey(field) {
  const mode = routeMode();
  const base = mode.type === 'normal' ? 'zkt' : `zkt.${mode.label}`;
  return `${base}.${field}`;
}

export const currentRole = () => localStorage.getItem(sessionKey('role')) || null;
export const currentName = () => localStorage.getItem(sessionKey('name')) || null;

/** 保存登录身份：群组 + 显示姓名（学号/账号名） */
export function saveIdentity(role, name) {
  if (!ALL_ROLES.includes(role)) return;
  localStorage.setItem(sessionKey('role'), role);
  localStorage.setItem(sessionKey('name'), name || role);
}

/** 兼容旧调用：仅存群组 */
export const saveRole = (role) => saveIdentity(role, role);

export function logout() {
  localStorage.removeItem(sessionKey('role'));
  localStorage.removeItem(sessionKey('name'));
  location.reload();
}

export function canAccess(moduleId) {
  const role = currentRole();
  if (!role) return moduleId === 'landing';
  const list = ROLE_ACCESS[role];
  return Array.isArray(list) ? list.includes(moduleId) : moduleId === 'landing';
}
