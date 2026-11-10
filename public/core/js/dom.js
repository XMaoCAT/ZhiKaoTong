// DOM 工具：选择器、图标模板、光标跟随效果绑定
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
export const icon = (name, cls = 'icon small') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

/** 绑定光标跟随微光效果（含沙盒卡 SVG 点光源联动），可在任意渲染后重复调用 */
export function bindLightSurfaces(root = document) {
  $$('[data-light-surface]', root).forEach((surface) => {
    if (surface.dataset.lightBound === '1') return;
    surface.dataset.lightBound = '1';
    surface.addEventListener('pointermove', (event) => {
      const rect = surface.getBoundingClientRect();
      const x = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
      const y = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
      surface.style.setProperty('--mx', `${x}%`);
      surface.style.setProperty('--my', `${y}%`);
      const light = document.getElementById('dynamicPointLight');
      if (light && surface.classList.contains('sandbox-card')) {
        light.setAttribute('x', String(Math.round((x / 100) * 160)));
        light.setAttribute('y', String(Math.round((y / 100) * 80)));
      }
    });
    surface.addEventListener('pointerleave', () => {
      surface.style.setProperty('--mx', '52%');
      surface.style.setProperty('--my', '20%');
    });
  });
}
