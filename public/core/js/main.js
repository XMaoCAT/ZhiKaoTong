// 入口：装配图标、登录门控、壳层板块、预留流程与初始渲染
// 路由分流：/ → 普通模式；/devN → PC 多角色调试；/m-devN → 手机多角色调试
// 调试端点受 IT管理员 的 /api/dev-access 开关控制，关闭时显示提示页
import { mountIcons } from '../../shared/icons.js';
import { features } from '../../shared/feature-flags.js';
import { $ } from './dom.js';
import { state, renderModule, setTheme, setViewMode } from './app.js';
import { bindModalControls, closeModal } from './modal.js';
import { checkVersion } from './version.js';
import { mountTopbar } from '../../panels/topbar/topbar.js';
import { mountSidebar } from '../../panels/sidebar/sidebar.js';
import { mountLanding } from '../../views/landing/landing.js';
import { mountLogin } from '../../views/login/login.js';
import { currentRole, saveRole, ROLE_HOME, routeMode } from '../../shared/roles.js';
import { showToast } from './toast.js';
import '../../views/roles/student-leave/module.js';
import '../../views/roles/counselor-verify/module.js';
import '../../views/roles/admin-console/module.js';

const MODE = routeMode();

mountIcons();
mountSidebar();
mountLanding();
bindModalControls();

// 条件装配：封存板块通过动态 import 按需加载（默认关闭）
if (features.agentPanel) {
  const { mountAgentPanel } = await import('../../panels/agent-panel/agent-panel.js');
  mountAgentPanel();
} else {
  $('#pcShell').classList.add('no-agent');
}

if (features.mobilePreview || MODE.mobile) {
  const { mountMobile } = await import('../../mobile/mobile.js');
  mountMobile();
  if (!MODE.mobile) setViewMode('pc');
}

if (features.legacyModules) {
  await import('../../modules/attendance/module.js');
  await import('../../modules/calendar/module.js');
  await import('../../modules/warning/module.js');
  await import('../../modules/documents/module.js');
  await import('../../modules/supervision/module.js');
  await import('../../modules/knowledge/module.js');
}

setTheme(state.theme);

/** 登录后进入工作台：恢复顶栏与外壳，按角色路由默认模块；m-dev 始终保持手机视图 */
function enterWorkspace(role) {
  $('#loginStage').classList.remove('open');
  $('#loginStage').innerHTML = '';
  $('#topbar').style.display = '';
  if (MODE.mobile) {
    // 手机调试端点：重挂手机界面（按新角色刷新问候与功能入口），锁定手机视图
    import('../../mobile/mobile.js').then(({ mountMobile }) => mountMobile());
    $('#pcShell').style.display = 'none';
    setViewMode('mobile');
  } else {
    $('#pcShell').style.display = '';
    mountTopbar();
    renderModule(ROLE_HOME[role] || 'landing');
  }
  checkVersion();
}

/** 未登录：显示登录页，隐藏顶栏与外壳（手机端点下手机舞台也隐藏，登录后再挂载） */
function showLogin() {
  $('#topbar').style.display = 'none';
  $('#pcShell').style.display = 'none';
  if (MODE.mobile) $('#mobileStage').style.display = 'none';
  $('#loginStage').classList.add('open');
  mountLogin((role) => {
    saveRole(role);
    showToast(`已以「${role}」身份${MODE.type === 'normal' ? '进入工作台' : `进入 ${MODE.label} 调试会话`}。`);
    // 侧栏导航按新角色的分级权限重新装配（shared/roles.js）
    mountSidebar();
    enterWorkspace(role);
  });
}

/** 调试端点未开启：全屏提示页 */
function showDevAccessClosed() {
  document.title = `调试端点未开启 · 智考通`;
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

// 调试端点需要后端开关放行；普通路径直接装配
let devAllowed = true;
if (MODE.type !== 'normal') {
  try {
    const res = await fetch('/api/dev-access');
    const data = await res.json();
    devAllowed = !!data.enabled;
  } catch {
    devAllowed = false;
  }
}

if (MODE.type !== 'normal' && !devAllowed) {
  showDevAccessClosed();
} else if (currentRole()) {
  enterWorkspace(currentRole());
} else {
  showLogin();
}

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    const box = $('#globalSearch');
    if (box) {
      event.preventDefault();
      box.focus();
    }
  }
  if (event.key === 'Escape') closeModal();
});
