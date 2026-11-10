// 宿主启动入口：装配全局组件、解析会话与端口、驱动插件加载器
// 宪章 §一：宿主仅负责插槽与启动，严禁写入业务板块逻辑
import { mountIcons } from '../shared/icons.js';
import { currentRole, currentName, saveIdentity, ROLE_HOME, ROLE_ACCESS, routeMode } from '../shared/roles.js';
import { loadPlugins, unmountModule, broadcastContext } from './plugin-loader.js';
import { eventBus } from './event-bus.js';
import { showToast } from './js/toast.js';
import { openModal, closeModal, bindModalControls } from './js/modal.js';
import { setTheme } from './js/theme.js';
import { connectGlobalSSE } from '../shared/sse.js';
import { showTodoDialog } from '../shared/todo-dialog.js';

const MODE = routeMode();
const PLATFORM = MODE.mobile ? 'mobile' : 'pc';

/* ---------- 全局组件装配 ---------- */
mountIcons();
bindModalControls();
setTheme(document.documentElement.dataset.theme || 'light');

/* ---------- 全局事件通道（宿主侧监听） ---------- */
// 模块请求打开全局弹窗；confirm 后可选回发 event 事件
eventBus.on('ui:open-modal', (payload = {}) => {
  openModal({
    title: payload.title,
    lead: payload.lead,
    body: payload.body,
    confirmText: payload.confirmText,
    onConfirm: () => {
      if (payload.event) eventBus.emit(payload.event, payload.payload || {});
      if (payload.toast) showToast(payload.toast);
    },
  });
});

// 模块请求轻提示
eventBus.on('ui:toast', ({ message } = {}) => showToast(message || ''));

// 侧栏导航跳转：主区模块切换（宿主渲染侧栏，模块通过该事件申请跳转）
eventBus.on('nav:goto-module', async ({ moduleId } = {}) => {
  if (!moduleId) return;
  if (PLATFORM === 'mobile') return; // 手机端口主区不参与模块切换
  const role = currentRole();
  const allowed = role ? (ROLE_ACCESS[role] || ['landing']) : ['landing'];
  if (!allowed.includes(moduleId)) {
    showToast('当前角色无权访问该模块。');
    moduleId = 'landing';
  }
  await switchMain(moduleId);
});

// 待办弹窗「去处理」跳转（2026-11-03 批二 S8）：PC 转发 nav:goto-module（复用宿主鉴权+回落）；
// 移动端由 mod-mobile-home 监听同名事件切换对应视图（事件字典已登记）
eventBus.on('todo:goto', ({ moduleId } = {}) => {
  if (!moduleId || PLATFORM === 'mobile') return;
  eventBus.emit('nav:goto-module', { moduleId });
});

// 登录成功：持久化身份（群组+姓名）并进入工作台
eventBus.on('auth:logged-in', async ({ role, name, home } = {}) => {
  if (!role) return;
  saveIdentity(role, name);
  await enterWorkspace(role, home);
});

/* ---------- 侧栏（宿主渲染，按角色分级菜单） ---------- */
const NAV_META = [
  { id: 'landing', title: '工作台首页', caption: 'HOME', icon: 'grid' },
  { id: 'student-leave', title: '请假管理', caption: 'Leave Management', icon: 'file' },
  { id: 'courses', title: '课程', caption: 'Timetable', icon: 'clock' },
  { id: 'classroom', title: '课堂管理', caption: 'Classroom', icon: 'activity' },
  { id: 'counselor-verify', title: '待审批', caption: 'Approval', icon: 'check' },
  { id: 'academic', title: '教务管理', caption: 'Academic', icon: 'book' },
  { id: 'lesson-review', title: '调课审批', caption: 'Lesson Review', icon: 'check' },
  { id: 'class-records', title: '课堂记录', caption: 'Class Records', icon: 'file' },
  { id: 'student-affairs', title: '学生处', caption: 'Student Affairs', icon: 'users' },
  { id: 'survey', title: '问卷与投票', caption: 'Surveys & Votes', icon: 'vote' },
  { id: 'admin-console', title: '系统管理', caption: 'Admin Console', icon: 'users' },
];

// 实际注册的模块文件夹（registry.json）；侧栏与默认页路由据此过滤，模块被删/禁用时侧栏同步隐藏
let registeredFolders = [];
async function loadRegistry() {
  try {
    const res = await fetch('./modules/registry.json', { cache: 'no-store' });
    if (res.ok) registeredFolders = (await res.json()).modules || [];
  } catch { registeredFolders = []; }
}

const icon = (name, cls = 'icon small') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

function renderSidebar() {
  if (PLATFORM === 'mobile') return;
  const role = currentRole();
  const allowed = role ? (ROLE_ACCESS[role] || ['landing']) : [];
  const sidebar = $('#sidebar');
  if (!sidebar) return;
  sidebar.innerHTML = `
    <div class="side-head"><span>工作空间</span></div>
    <nav class="nav-list" id="desktopNav" aria-label="主导航">${
      NAV_META
        .filter((m) => allowed.includes(m.id) && registeredFolders.includes(MAIN_MODULE_FOLDERS[m.id]))
        .map((m, i) => `<button class="nav-item${(currentMainModule === MAIN_MODULE_FOLDERS[m.id]) || (!currentMainModule && i === 0) ? ' active' : ''}" data-module="${m.id}">
          <span class="nav-icon">${icon(m.icon)}</span>
          <span class="nav-copy"><span class="nav-label">${m.title}</span><span class="nav-caption">${m.caption}</span></span>
        </button>`).join('')
    }</nav>
    <div class="sidebar-spacer"></div>`;
}

function bindSidebar() {
  const sidebar = $('#sidebar');
  if (!sidebar || sidebar.dataset.bound === '1') return;
  sidebar.dataset.bound = '1';
  sidebar.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-module]');
    if (btn) eventBus.emit('nav:goto-module', { moduleId: btn.dataset.module });
  });
}

/* ---------- 主区模块切换（同一插槽单挂） ---------- */
let currentMainModule = null;
const MAIN_MODULE_FOLDERS = {
  'landing': 'mod-landing',
  'student-leave': 'mod-student-leave',
  'courses': 'mod-courses',
  'classroom': 'mod-classroom',
  'counselor-verify': 'mod-counselor-verify',
  'academic': 'mod-academic',
  'lesson-review': 'mod-lesson-review',
  'class-records': 'mod-class-records',
  'student-affairs': 'mod-student-affairs',
  'admin-console': 'mod-admin-console',
  'survey': 'mod-survey',
};

async function switchMain(moduleId) {
  if (PLATFORM === 'mobile') return;
  // 卸载当前主区模块
  if (currentMainModule) await unmountModule(currentMainModule);
  // 模块 id 无文件夹映射时回落工作台首页（学生处专属模块等后续阶段建成前，ROLE_HOME 直入的兜底；与启动序列回落一致）
  if (!MAIN_MODULE_FOLDERS[moduleId]) moduleId = 'landing';
  currentMainModule = MAIN_MODULE_FOLDERS[moduleId];
  renderSidebar();
  const container = $('#mainViewContent');
  container.innerHTML = '';
  if (!currentMainModule) return;
  // 复用加载器对单模块的鉴权+熔断挂载
  const { mountModuleDirect } = await import('./plugin-loader.js');
  const ok = await mountModuleDirect(currentMainModule, hostContext());
  if (!ok) container.innerHTML = '<section class="surface section-card placeholder-page"><div class="placeholder-icon">' + icon('warning', 'icon large') + '</div><h2>模块不可用</h2><p>该功能模块当前未启用或加载失败。</p></section>';
}

/* ---------- 工作区进出 ---------- */
async function enterWorkspace(role, homeOverride) {
  $('#loginStage').classList.remove('open');
  $('#loginStage').innerHTML = '';
  $('#topbar').style.display = '';
  broadcastContext({ id: role, group: role, name: currentName() || role }, PLATFORM);
  connectGlobalSSE(); // 宿主级单连接（退出 reload 随页面销毁，无需手动断）
  if (PLATFORM === 'mobile') {
    $('#pcShell').style.display = 'none';
    $('#mobileStage').classList.add('mobile-active');
    const { mountModuleDirect } = await import('./plugin-loader.js');
    await mountModuleDirect('mod-mobile-home', hostContext());
    showToast(`已以「${role}」身份${MODE.type === 'normal' ? '进入工作台' : `进入 ${MODE.label} 调试会话`}。`);
    // S8 待办弹窗：移动端 in-host 弹窗 host 必须传手机屏（mod-mobile-home 踩坑 #09：传 #mobileStage 会铺满视口越出手机框）
    showTodoDialog({ host: $('#mobileStage .phone-screen') || document.body, inHost: true, eventBus });
  } else {
    $('#pcShell').style.display = '';
    const { mountModuleDirect } = await import('./plugin-loader.js');
    await mountModuleDirect('mod-core-nav', hostContext());
    renderSidebar();
    bindSidebar();
    await switchMain(homeOverride || (registeredFolders.includes(MAIN_MODULE_FOLDERS[ROLE_HOME[role]]) ? ROLE_HOME[role] : 'landing'));
    showToast(`已以「${role}」身份${MODE.type === 'normal' ? '进入工作台' : `进入 ${MODE.label} 调试会话`}。`);
    // S8 待办弹窗：PC 全屏弹窗 host 一律 document.body（顶栏 backdrop-filter 包含块铁律）
    showTodoDialog({ host: document.body, eventBus });
  }
}

function showLogin() {
  $('#topbar').style.display = 'none';
  $('#pcShell').style.display = 'none';
  $('#mobileStage').classList.remove('mobile-active');
  $('#loginStage').classList.add('open');
  // 登录模块按 registry 挂载到 #loginStage
  loadPlugins(hostContext()).catch((err) => console.warn('[host] 插件装载异常：', err.message));
}

function hostContext() {
  const role = currentRole();
  return { user: { id: role || 'guest', group: role || 'guest', name: currentName() || '' }, platform: PLATFORM };
}

/* ---------- 调试端点开关检查 ---------- */
async function devAccessAllowed() {
  if (MODE.type === 'normal') return true;
  try {
    const res = await fetch('/api/dev-access');
    return !!(await res.json()).enabled;
  } catch {
    return false;
  }
}

function showDevClosed() {
  document.title = '调试端点未开启 · 智考通';
  const stage = $('#loginStage');
  stage.classList.add('open');
  stage.innerHTML = `
  <div class="login-panel normal-mapped-surface" data-light-surface style="max-width:520px">
    <div class="login-head-row">
      <div class="login-brand">
        <div class="brand-mark"><svg class="icon"><use href="#i-warning"/></svg></div>
        <div><div class="login-title">调试端点未开启</div><div class="login-subtitle">DEV ACCESS DISABLED</div></div>
      </div>
    </div>
    <p class="login-lead">多角色调试端点（<code>/dev1</code>、<code>/m-dev1</code> 等）当前处于关闭状态。如需在单设备上模拟多角色测试，请联系 IT管理员 在「系统管理 → 调试端点」中开启。</p>
    <a class="btn primary" href="/" style="width:100%;margin-top:6px">返回主工作台</a>
  </div>`;
}

/* ---------- 旧会话迁移：教务科 → 教务处（2026-10-23 P1 角色更名） ----------
 * 遍历本浏览器全部端点会话键（zkt / zkt.devN / zkt.m-devN），role='教务科' → '教务处'，
 * name 同步替换（账号名即'教务科'）。幂等：迁移后原值被覆盖，二次刷新无副作用。
 * 置于 devAccessAllowed 之后：调试端点关闭时走 showDevClosed 不进工作区，仅在真正恢复会话前执行。 */
function migrateLegacyRole() {
  const legacyRoleKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (/^zkt(\.[\w-]+)?\.role$/.test(key) && localStorage.getItem(key) === '教务科') legacyRoleKeys.push(key);
  }
  for (const roleKey of legacyRoleKeys) {
    const prefix = roleKey.slice(0, -'.role'.length);
    const nameKey = `${prefix}.name`;
    const oldName = localStorage.getItem(nameKey) || '教务科';
    localStorage.setItem(roleKey, '教务处');
    localStorage.setItem(nameKey, oldName === '教务科' ? '教务处' : oldName);
  }
}

/* ---------- 启动序列 ---------- */
await loadRegistry();
if (!(await devAccessAllowed())) {
  showDevClosed();
} else {
  migrateLegacyRole();
  if (currentRole()) {
    // 已有会话：直接进入工作区（登录模块不挂载）；默认页指向被删模块时回落工作台首页
    const role = currentRole();
    const home = ROLE_HOME[role] && registeredFolders.includes(MAIN_MODULE_FOLDERS[ROLE_HOME[role]]) ? ROLE_HOME[role] : 'landing';
    await enterWorkspace(role, home);
  } else {
    showLogin();
  }
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModal();
});

function $(selector) { return document.querySelector(selector); }
