// 应用核心：全局状态、模块注册与路由（保持原 SmartAttendanceApp 契约）
import { $, $$, icon, bindLightSurfaces } from './dom.js';
import { setTheme as applyTheme } from './theme.js';
import { showToast } from './toast.js';
import { openModal } from './modal.js';
import { initialAttendanceData, initialSteps, demoModules } from '../../shared/demo-data.js';
import { features } from '../../shared/feature-flags.js';
import { canAccess } from '../../shared/roles.js';

// 旧六大板块仅在 feature-flags 开启时预注册（默认封存，代码保留供后期参考）
export const modules = new Map();
if (features.legacyModules) {
  for (const [id, meta] of Object.entries(demoModules)) modules.set(id, { ...meta });
}
const stepListeners = new Set();
const searchListeners = new Set();

export const state = {
  theme: document.documentElement.dataset.theme || 'light',
  viewMode: 'pc',
  attendanceData: initialAttendanceData.map((x) => ({ ...x })),
  agentTimelineSteps: initialSteps.map((x) => ({ ...x })),
  activeModule: 'landing',
  activeFilter: 'all',
  searchTerm: '',
  registerModule(module) {
    if (!module || typeof module.id !== 'string' || !module.id.trim()) throw new Error('registerModule(module) 需要提供非空字符串 id。');
    if (!module.label && !module.title) throw new Error('注册模块时请提供 label 或 title。');
    const id = module.id.trim();
    const meta = {
      title: module.title || module.label,
      caption: module.caption || '由扩展智能体注册',
      icon: module.icon || 'grid',
      description: module.description || '该模块已注册，等待业务组件注入。',
      count: module.count,
      render: module.render || null,
      bind: module.bind || null,
    };
    modules.set(id, meta);
    const nav = $('#desktopNav');
    if (nav && !$(`[data-module="${CSS.escape(id)}"]`, nav)) {
      const button = document.createElement('button');
      button.className = 'nav-item';
      button.dataset.module = id;
      button.innerHTML = `<span class="nav-icon">${icon(meta.icon, 'icon')}</span><span class="nav-copy"><span class="nav-label"></span><span class="nav-caption"></span></span>`;
      $('.nav-label', button).textContent = meta.title;
      $('.nav-caption', button).textContent = meta.caption;
      nav.appendChild(button);
    }
    if (state.activeModule === id) renderModule(id);
    return { ok: true, id };
  },
};

export function onAgentSteps(fn) { if (typeof fn === 'function') stepListeners.add(fn); }
export function onSearch(fn) { if (typeof fn === 'function') searchListeners.add(fn); }
export function emitSearch() { searchListeners.forEach((fn) => fn(state.searchTerm)); }

export function setAgentSteps(steps) {
  if (!Array.isArray(steps)) return;
  state.agentTimelineSteps = steps.map((step) => ({
    title: String(step.title || '未命名步骤'),
    description: String(step.description || ''),
    duration: String(step.duration ?? '—'),
    status: ['done', 'running', 'waiting'].includes(step.status) ? step.status : 'waiting',
    progress: Math.max(0, Math.min(100, Number(step.progress ?? (step.status === 'done' ? 100 : 0)))),
  }));
  stepListeners.forEach((fn) => fn(state.agentTimelineSteps));
}

export function setTheme(theme) {
  if (!['light', 'dark'].includes(theme)) return;
  state.theme = theme;
  applyTheme(theme);
}

export function setViewMode(mode) {
  if (!['pc', 'mobile'].includes(mode)) return;
  state.viewMode = mode;
  $('#pcShell').style.display = mode === 'pc' ? '' : 'none';
  $('#mobileStage').style.display = mode === 'mobile' ? 'flex' : 'none';
  $$('[data-view]').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === mode));
}

function placeholderMarkup(meta) {
  return `<section class="surface section-card placeholder-page">
    <div class="placeholder-icon">${icon(meta.icon, 'icon large')}</div>
    <div class="eyebrow"><span class="spark"></span>MODULE SLOT</div>
    <h2>${meta.title}</h2>
    <div class="welcome-copy">${meta.caption}</div>
    <p>${meta.description}</p>
    <div class="placeholder-grid">
      <div class="placeholder-tile"><strong>模块视图插槽已预留</strong><span>后续智能体可以在此模块注入表格、图表、表单或交互流程。</span></div>
      <div class="placeholder-tile"><strong>共用全局设计令牌</strong><span>复用 --surface-card、--on-surface、--google-blue 等 CSS 变量，自动跟随明暗主题。</span></div>
      <div class="placeholder-tile"><strong>联动执行追踪器</strong><span>通过 SmartAttendanceApp.agentTimelineSteps 或 setAgentSteps() 更新右侧执行时间轴。</span></div>
      <div class="placeholder-tile"><strong>业务接入状态</strong><span>当前为前端种子模板；接口、权限、真实数据与持久化仍需后续开发。</span></div>
    </div>
    <div class="slot-note">推荐接入点：<code>[AGENT_SLOT: CANVAS_MAIN_VIEW]</code>。注册模块示例见随附 README。</div>
    <div style="margin-top:18px"><button class="btn primary" id="backToAttendance">返回考勤核销中心</button></div>
  </section>`;
}

export function renderModule(id) {
  // 权限守卫：当前角色无权访问的模块自动回落到工作台首页（分级制度见 shared/roles.js）
  if (!canAccess(id)) {
    showToast('当前角色无权访问该模块，已返回工作台首页。');
    id = 'landing';
  }
  state.activeModule = id;
  $$('.nav-item').forEach((btn) => btn.classList.toggle('active', btn.dataset.module === id));
  const mainContent = $('#mainViewContent');
  const meta = modules.get(id);
  if (meta && typeof meta.render === 'function') {
    const output = meta.render({ app: window.SmartAttendanceApp, root: mainContent });
    if (output instanceof Node) mainContent.replaceChildren(output);
    else mainContent.innerHTML = output ?? '';
  } else {
    const m = meta || { title: id, caption: '扩展模块', icon: 'grid', description: '该模块已注册，等待业务组件注入。' };
    mainContent.innerHTML = placeholderMarkup(m);
    $('#backToAttendance', mainContent)?.addEventListener('click', () => renderModule('attendance'));
  }
  bindLightSurfaces(mainContent);
  if (meta && typeof meta.bind === 'function') meta.bind(mainContent);
}

// 公开交接契约（与种子 UI README 保持一致，供后续智能体调用）
window.SmartAttendanceApp = state;
window.SmartAttendanceApp.showToast = showToast;
window.SmartAttendanceApp.setTheme = setTheme;
window.SmartAttendanceApp.setViewMode = setViewMode;
window.SmartAttendanceApp.openModal = openModal;
window.SmartAttendanceApp.setAgentSteps = setAgentSteps;
