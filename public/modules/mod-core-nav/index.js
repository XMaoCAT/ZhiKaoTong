// mod-core-nav：顶栏导航壳层（品牌 / 全局搜索 / 通知铃铛 / 账户头像与姓名 → 个人中心浮层[修改密码+退出登录] / dev 徽标 / 主题）
// 2026-11-03 批二 S7/S10：顶栏通知铃铛（未读徽标+下拉列表+单条/全部已读+SSE 实时刷新）+ 全局搜索框（分组结果+按权限跳转）
// 隔离铁律：不 import 其他任何 mod-*；对外仅通过 eventBus 通信
import { currentRole, currentName, logout, routeMode } from '../../shared/roles.js';
import { setTheme as applyTheme } from '../../core/js/theme.js';
import { openChangePasswordDialog } from '../../shared/leave-wizard.js';
import { fetchNotifications, markNotificationsRead } from '../../shared/api-workflow.js';
import { searchAll } from '../../shared/api-todo.js';

const icon = (name, cls = 'icon small') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let themeOff = null;
let sseOffs = [];          // 铃铛 SSE 监听解绑句柄（unmount 全清）
let docClickOff = null;    // document 级点击关闭浮层（unmount 解绑）

/* 搜索结果跳转映射：按角色返回可直达的模块 id（无权限返回 null → 纯展示行） */
function gotoModuleFor(kind, role) {
  if (kind === 'student' || kind === 'class') {
    if (role === '学生处') return 'student-affairs';
    if (role === '教务处' || role === 'IT管理员') return 'academic';
    return null;
  }
  if (kind === 'teacher') return role === '教务处' || role === 'IT管理员' ? 'academic' : null;
  if (kind === 'lesson') return ['学生', '教师', 'IT管理员'].includes(role) ? 'courses' : null;
  return null;
}

export async function mount(container, context) {
  container.classList.add('mod-core-nav');
  const role = currentRole();
  const name = currentName() || role || '';
  const mode = routeMode();

  container.innerHTML = `
  <div class="brand">
    <div class="brand-mark">${icon('sparkles', 'icon')}</div>
    <div><div class="brand-title">智考通</div><div class="brand-subtitle">SMART ATTENDANCE CONNECT</div></div>
  </div>
  <div class="topbar-center">
    <div class="nav-search-wrap" id="navSearchWrap">
      <span class="nav-search-ico">${icon('search')}</span>
      <input class="nav-search-input" id="navSearchInput" type="text" placeholder="搜索 学生 / 班级 / 教师 / 课程" autocomplete="off" aria-label="全局搜索" />
      <div class="nav-search-pop" id="navSearchPop" hidden></div>
    </div>
    <div class="workspace-label">高校考勤 · 智能工作台</div>
  </div>
  <div class="topbar-actions">
    ${mode.type !== 'normal' ? `<span class="role-chip dev-chip" title="调试会话（独立登录态）">${icon('activity')}${mode.label}</span>` : ''}
    <button type="button" class="icon-button nav-bell-btn" id="bellBtn" aria-label="通知" title="通知" aria-expanded="false">
      ${icon('bell', 'icon')}
      <em class="nav-bell-badge" id="bellBadge" hidden>0</em>
    </button>
    <button type="button" class="account-btn" id="accountBtn" aria-haspopup="true" aria-expanded="false" title="个人中心">
      <span class="avatar">${icon('sparkles', 'icon small')}</span>
      <span class="account-copy"><strong>${name}</strong><small>${role}</small></span>
    </button>
    <button type="button" class="icon-button" id="themeToggle" aria-label="切换明暗主题" title="切换明暗主题"><svg class="icon" id="themeIcon"><use href="#i-moon"/></svg></button>
  </div>
  <div class="account-pop" id="accountPop" hidden>
    <div class="account-pop-head">
      <span class="avatar avatar-lg">${icon('sparkles')}</span>
      <div><strong>${name}</strong><span class="role-chip">${icon('users')}${role}</span></div>
    </div>
    <button type="button" class="btn account-pwd" id="pwdBtn">${icon('lock')}修改密码</button>
    <button type="button" class="btn account-logout" id="logoutBtn">${icon('x')}退出登录</button>
  </div>
  <div class="nav-bell-pop" id="bellPop" hidden>
    <div class="nav-bell-head">
      <span>通知</span>
      <button type="button" class="btn ghost compact" id="bellReadAll">${icon('check')}全部已读</button>
    </div>
    <div class="nav-bell-list" id="bellList"></div>
  </div>`;

  /* ==================== 浮层统一管理（铃铛/个人中心互斥，外部点击全关） ==================== */
  const bellBtn = container.querySelector('#bellBtn');
  const bellPop = container.querySelector('#bellPop');
  const accountBtn = container.querySelector('#accountBtn');
  const accountPop = container.querySelector('#accountPop');
  const searchPop = container.querySelector('#navSearchPop');
  const searchInput = container.querySelector('#navSearchInput');
  const bellBadge = container.querySelector('#bellBadge');

  const closeAllPops = (except) => {
    if (bellPop !== except && !bellPop.hidden) { bellPop.hidden = true; bellBtn.setAttribute('aria-expanded', 'false'); }
    if (accountPop !== except && !accountPop.hidden) { accountPop.hidden = true; accountBtn.setAttribute('aria-expanded', 'false'); }
    if (searchPop !== except && !searchPop.hidden) searchPop.hidden = true;
  };

  /* ==================== 通知铃铛（S7：未读徽标 + 下拉 + 已读 + SSE 实时） ==================== */
  const updateBadge = (n) => {
    bellBadge.hidden = !n;
    bellBadge.textContent = n > 99 ? '99+' : String(n);
  };

  async function refreshBellUnread() {
    try { updateBadge((await fetchNotifications({ unread: 1 })).length); } catch { /* 静默：徽标非关键路径 */ }
  }

  async function renderBellList() {
    const listEl = container.querySelector('#bellList');
    if (!listEl) return;
    let list = [];
    try { list = await fetchNotifications({}); } catch (ex) {
      listEl.innerHTML = `<div class="nav-notify-empty">${icon('bell', 'icon large')}<span>${esc(ex.message || '加载失败')}</span></div>`;
      return;
    }
    const recent = list.slice(0, 20);
    updateBadge(list.filter((n) => !n.readAt).length);
    listEl.innerHTML = recent.length ? recent.map((n) => `
      <button type="button" class="nav-notify${n.readAt ? '' : ' unread'}" data-nid="${n.id}" title="${n.readAt ? '' : '点击标记已读'}">
        <span class="nav-notify-dot${n.readAt ? ' read' : ''}"></span>
        <span class="nav-notify-copy">
          <strong>${esc(n.title)}</strong>
          ${n.detail ? `<small>${esc(n.detail)}</small>` : ''}
          <time>${(n.createdAt || '').slice(0, 16).replace('T', ' ')}</time>
        </span>
      </button>`).join('') : `<div class="nav-notify-empty">${icon('bell', 'icon large')}<span>暂无通知</span></div>`;
    listEl.querySelectorAll('.nav-notify').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const nid = Number(btn.dataset.nid);
        const n = recent.find((x) => x.id === nid);
        if (n && !n.readAt) {
          try { await markNotificationsRead([nid]); } catch { /* 已读失败不阻断 */ }
        }
        renderBellList();
      });
    });
  }

  bellBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = bellPop.hidden;
    closeAllPops(bellPop);
    bellPop.hidden = !willOpen;
    bellBtn.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) renderBellList();
  });

  container.querySelector('#bellReadAll')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      let list = [];
      try { list = await fetchNotifications({ unread: 1 }); } catch { /* ignore */ }
      if (list.length) await markNotificationsRead(list.map((n) => n.id));
      renderBellList();
    } catch { /* ignore */ }
  });

  // SSE 全事件刷新：所有会落通知表的服务端事件（转发名见 shared/sse.js NAMED_EVENTS）→ 未读数实时更新；下拉开着同步列表；
  // sse:reconnected（断线重连）→ 补拉未读数（离线期间错过的通知不丢，S7「离线补拉」口径）
  const SSE_EVENTS = [
    'sse:workflowRequestNew', 'sse:workflowRequestReviewed',
    'sse:timetableLessonAdded', 'sse:timetableLessonCancelled',
    'sse:classroomSessionOpened', 'sse:classroomSessionEnded',
    'sse:academicStudentsChanged',
    'sse:surveyPublished', 'sse:surveyClosed', 'sse:surveyReminded',
    'sse:reconnected',
  ];
  sseOffs = SSE_EVENTS.map((evt) => context.eventBus.on(evt, () => {
    refreshBellUnread();
    if (!bellPop.hidden) renderBellList();
  }));
  refreshBellUnread();

  /* ==================== 全局搜索（S10：debounce + 分组下拉 + 按权限跳转） ==================== */
  let searchTimer = null;
  let searchSeq = 0; // 竞态序号：仅渲染最新一次请求结果

  function renderSearchPop(groups) {
    const sections = [];
    if (groups.students?.length) sections.push({ title: '学生', items: groups.students.map((s) => ({ main: s.name, sub: `${s.id} · ${s.className}`, goto: gotoModuleFor('student', role) })) });
    if (groups.classes?.length) sections.push({ title: '班级', items: groups.classes.map((c) => ({ main: c.name, sub: `${c.studentCount} 名学生`, goto: gotoModuleFor('class', role) })) });
    if (groups.teachers?.length) sections.push({ title: '教师', items: groups.teachers.map((t) => ({ main: t.name, sub: `${t.classCount} 个授课班`, goto: gotoModuleFor('teacher', role) })) });
    if (groups.lessons?.length) sections.push({ title: '课程', items: groups.lessons.map((l) => ({ main: l.courseName, sub: `${l.teacherName} · ${l.className}${l.source === 'add' ? ' · 单次加课' : ''}`, goto: gotoModuleFor('lesson', role) })) });

    if (!sections.length) {
      searchPop.innerHTML = `<div class="nav-search-empty">${icon('search', 'icon large')}<span>无匹配结果</span></div>`;
      searchPop.hidden = false;
      return;
    }
    searchPop.innerHTML = sections.map((sec) => `
      <div class="nav-sec-head">${sec.title}</div>
      ${sec.items.map((it) => `
        <button type="button" class="nav-search-item${it.goto ? '' : ' flat'}" data-goto="${it.goto || ''}" ${it.goto ? '' : 'disabled'}>
          <strong>${esc(it.main)}</strong><small>${esc(it.sub)}</small>
          ${it.goto ? icon('chevron-right') : ''}
        </button>`).join('')}`).join('');
    searchPop.hidden = false;
    searchPop.querySelectorAll('.nav-search-item[data-goto]:not([disabled])').forEach((btn) => {
      btn.addEventListener('click', () => {
        const moduleId = btn.dataset.goto;
        if (moduleId) context.eventBus.emit('nav:goto-module', { moduleId });
        searchInput.value = '';
        closeAllPops(null);
      });
    });
  }

  searchInput?.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (!q) { closeAllPops(null); return; }
    searchTimer = window.setTimeout(async () => {
      const seq = ++searchSeq;
      try {
        const groups = await searchAll(q);
        if (seq !== searchSeq) return; // 过期响应丢弃
        closeAllPops(searchPop);
        renderSearchPop(groups);
      } catch { /* 搜索失败静默关闭 */ }
    }, 250);
  });
  searchInput?.addEventListener('focus', () => {
    if (searchInput.value.trim() && searchPop.hidden) {
      // 已有关键词聚焦时重新展开（保留上次结果即可，输入变化会重查）
      searchInput.dispatchEvent(new Event('input'));
    }
  });
  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { searchInput.value = ''; closeAllPops(null); searchInput.blur(); }
  });
  searchPop?.addEventListener('click', (e) => e.stopPropagation()); // 下拉内部点击不触发外部关闭

  /* ==================== 主题切换（原有功能保留） ==================== */
  container.querySelector('#themeToggle')?.addEventListener('click', () => {
    const next = (document.documentElement.dataset.theme || 'light') === 'light' ? 'dark' : 'light';
    applyTheme(next);
    context.eventBus.emit('theme:change', { theme: next });
  });

  /* ==================== 退出登录 / 修改密码（原有功能保留） ==================== */
  container.querySelector('#logoutBtn')?.addEventListener('click', () => {
    context.eventBus.emit('auth:logout', {});
    logout();
  });

  // 修改密码（浮层内 → 共享弹窗，2026-10-29 密码体系；防重入护栏见踩坑模式）
  // ⚠ 弹窗 host 必须用 document.body：#topbar 有 backdrop-filter（fixed 定位的包含块），
  //   挂在顶栏内时 position:fixed 全屏遮罩会被压缩裁剪到 76px 顶栏内（截图实锤：弹窗偏上截断+遮罩失效）
  container.querySelector('#pwdBtn')?.addEventListener('click', () => {
    if (document.querySelector('.leave-wizard')) return;
    closeAllPops(null);
    openChangePasswordDialog({ host: document.body, eventBus: context.eventBus });
  });

  /* ==================== 个人中心浮层（原有交互 + 浮层互斥） ==================== */
  const togglePop = (show) => {
    if (!accountPop || !accountBtn) return;
    accountPop.hidden = !show;
    accountBtn.setAttribute('aria-expanded', String(show));
  };
  accountBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = accountPop.hidden;
    closeAllPops(accountPop);
    togglePop(willOpen);
  });
  docClickOff = () => document.removeEventListener('click', onDocClick);
  function onDocClick(e) {
    // 顶栏内点击（按钮自身已 stopPropagation；浮层与搜索框内部）不关闭
    if (container.contains(e.target)) {
      if (!e.target.closest('.nav-search-wrap')) searchPop.hidden = true; // 顶栏其他区域点击时收起搜索下拉
      return;
    }
    closeAllPops(null);
  }
  document.addEventListener('click', onDocClick);

  // 监听用户变化以刷新徽标（登录/切换角色时由宿主重挂载，此处兜底刷新）
  themeOff = context.eventBus.on('context:user-changed', () => {
    const r = currentRole();
    const n = currentName() || r;
    const copy = container.querySelector('.account-copy');
    if (copy) {
      const strong = copy.querySelector('strong');
      const small = copy.querySelector('small');
      if (strong) strong.textContent = n || '';
      if (small) small.textContent = r || '';
    }
  });
}

export async function unmount(container) {
  if (themeOff) { themeOff(); themeOff = null; }
  sseOffs.forEach((off) => { try { off(); } catch { /* ignore */ } });
  sseOffs = [];
  if (docClickOff) { docClickOff(); docClickOff = null; }
  container.innerHTML = '';
  container.classList.remove('mod-core-nav');
}
