// mod-landing：工作台首页（按角色分级的流程入口卡片；C4 待办数量徽标）
// 2026-11-03 批二 S6：徽标取数迁移至后端单源 GET /api/todo/summary（消除前端口径副本，单源禁令）
import { currentRole, ROLE_ACCESS, ROLE_NOTE } from '../../shared/roles.js';
import { fetchTodoSummary } from '../../shared/api-todo.js';

const icon = (name, cls = 'icon small') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></svg></svg>`;

const CARDS = [
  { id: 'student-leave', icon: 'file', title: '请假管理', caption: 'LEAVE MANAGEMENT', desc: '请假申请、凭证上传与审批进度跟踪。', glow: '#1A73E8', ink: 'var(--google-blue)' },
  { id: 'counselor-verify', icon: 'check', title: '待审批', caption: 'APPROVAL', desc: '学生请假申请的同意与拒绝。', glow: '#36A66A', ink: 'var(--mint-ink)' },
  { id: 'academic', icon: 'book', title: '教务管理', caption: 'ACADEMIC', desc: '学生班级管理与教师授课班级分配。', glow: '#F0A93B', ink: '#B4720F' },
  { id: 'survey', icon: 'vote', title: '问卷与投票', caption: 'SURVEYS & VOTES', desc: '问卷填写、投票与统计分析。', glow: '#0F9D58', ink: 'var(--mint-ink)' },
  { id: 'admin-console', icon: 'users', title: '系统管理', caption: 'ADMIN CONSOLE', desc: '考勤规则、用户角色与系统数据管理。', glow: '#8B7CF6', ink: 'var(--purple)' },
];

function roleCard(r) {
  return `<article class="role-card normal-mapped-surface" data-light-surface data-goto="${r.id}" style="--glow:${r.glow}" tabindex="0" role="button" aria-label="进入${r.title}">
    <div class="role-top">
      <span class="role-icon" style="background:var(--google-blue-soft);color:${r.ink}"><svg class="icon"><use href="#i-${r.icon}"/></svg></span>
      <em class="role-badge" data-badge-for="${r.id}" hidden>0</em>
    </div>
    <div class="role-title">${r.title}</div>
    <div class="role-caption">${r.caption}</div>
    <p class="role-desc">${r.desc}</p>
    <div class="role-foot"><span class="role-hint">进入</span>${icon('chevron-right')}</div>
  </article>`;
}

/* C4（2026-10-29）：各角色待办数量徽标（挂载后异步拉取，失败静默不影响入口）
   2026-11-03 批二 S6：取数改后端单源 /api/todo/summary（口径与 leaves/workflow GET 完全一致，
   消除前端过滤副本；items.moduleId 与入口卡 cardId 同名直接映射） */
async function updateBadges(container) {
  const set = (cardId, n) => {
    const badge = container.querySelector(`.role-badge[data-badge-for="${cardId}"]`);
    if (!badge) return;
    badge.hidden = !n;
    badge.textContent = n > 99 ? '99+' : String(n);
  };
  try {
    const { items } = await fetchTodoSummary();
    items.forEach((it) => set(it.moduleId, it.count));
  } catch { /* 网络异常静默：徽标非关键路径 */ }
}

export async function mount(container, context) {
  container.classList.add('mod-landing');
  const role = context.user?.group || currentRole();
  const allowed = role ? (ROLE_ACCESS[role] || ['landing']) : ['landing'];
  const cards = CARDS.filter((c) => allowed.includes(c.id));

  container.innerHTML = `
  <div class="welcome-row"><div>
    <div class="eyebrow"><span class="spark"></span>SMART ATTENDANCE WORKSPACE</div>
    <h1>智考通 · 工作台</h1>
    <div class="welcome-copy">${role ? `当前身份：${role} —— ${ROLE_NOTE[role] || ''}` : '请先登录以查看可用功能。'}</div>
  </div></div>
  ${cards.length ? `<section class="role-grid" aria-label="功能入口">${cards.map(roleCard).join('')}</section>` : ''}`;

  container.querySelectorAll('[data-goto]').forEach((card) => {
    const go = () => context.eventBus.emit('nav:goto-module', { moduleId: card.dataset.goto });
    card.addEventListener('click', go);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });

  if (role) updateBadges(container);
}

export async function unmount(container) {
  container.innerHTML = '';
  container.classList.remove('mod-landing');
}
