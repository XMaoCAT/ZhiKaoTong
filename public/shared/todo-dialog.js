// 登录待办弹窗共享件（2026-11-03 批二 S8：进入工作区时应用内弹窗显示本角色当前待办）
// ---------------------------------------------------------------------------
// 消费方：宿主 core/main.js enterWorkspace（PC host=document.body / 移动 host=手机屏 in-host）。
// 行为口径：
//   - 无待办不弹（不渲染空弹窗）；有待办按分类计数逐行展示，每行「去处理」按钮。
//   - 会话一次性：sessionStorage key 含 身份+端点（换账号/换端点重新弹，同会话同身份不重复）。
//   - 「去处理」统一 emit 'todo:goto' { moduleId }——PC 由宿主转发 nav:goto-module（鉴权+回落
//     landing 全免费），移动端由 mod-mobile-home 监听切换对应视图（事件字典已登记）。
// 弹窗内类（todo-row/todo-label/todo-count）定义于宿主全局 components.css（弹窗内类归宿主铁律）。
import { currentRole, currentName, routeMode } from './roles.js';
import { fetchTodoSummary } from './api-todo.js';
import { openMiniDialog } from './leave-wizard.js';

const icon = (name, cls = 'icon small') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

/** 会话一次性标记键（端点+身份双维度：换账号登录重新弹，同会话同身份只弹一次） */
function sessionKey() {
  const mode = routeMode();
  const tag = mode.type === 'normal' ? '' : `.${mode.label}`;
  return `zkt${tag}.todoShown.${currentRole() || ''}.${currentName() || ''}`;
}

/**
 * 进入工作区时展示待办弹窗（静默失败：网络异常/无待办均不弹，不影响主流程）
 * @param {Object} opts { host=HTMLElement, inHost=boolean, eventBus }
 */
export async function showTodoDialog({ host = document.body, inHost = false, eventBus } = {}) {
  try {
    const key = sessionKey();
    if (sessionStorage.getItem(key) === '1') return;
    sessionStorage.setItem(key, '1'); // 无论有无待办，本会话本身份只检查一次
    const { items, total } = await fetchTodoSummary();
    if (!items.length || !total) return;

    const rows = items.map((it) => `
      <div class="todo-row">
        <span class="todo-label">${it.label}</span>
        <em class="todo-count">${it.count > 99 ? '99+' : it.count}</em>
        <button type="button" class="btn ghost compact" data-act="goto:${it.moduleId}">${icon('chevron-right')}去处理</button>
      </div>`).join('');

    openMiniDialog({
      host, inHost,
      title: '待办提醒',
      textHTML: `当前身份共有 <b>${total > 99 ? '99+' : total}</b> 项待处理事项：`,
      rawBody: rows,
      buttons: [{ act: 'close', label: '知道了', cls: 'primary' }],
      onAction: (act, dlg) => {
        if (act.startsWith('goto:')) {
          const moduleId = act.slice(5);
          if (eventBus) eventBus.emit('todo:goto', { moduleId });
        }
        dlg.remove();
      },
    });
  } catch { /* 网络异常静默：待办弹窗非关键路径 */ }
}
