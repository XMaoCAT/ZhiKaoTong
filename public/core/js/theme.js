// 主题切换板块
import { $ } from './dom.js';

export function setTheme(theme) {
  if (!['light', 'dark'].includes(theme)) return;
  document.documentElement.dataset.theme = theme;
  const use = $('#themeIcon use');
  if (use) use.setAttribute('href', theme === 'dark' ? '#i-sun' : '#i-moon');
  const btn = $('#themeToggle');
  if (btn) btn.title = theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题';
}
