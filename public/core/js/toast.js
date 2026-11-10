// 轻提示板块
import { $, icon } from './dom.js';

export function showToast(message) {
  const region = $('#toastRegion');
  if (!region) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `${icon('check')}<span></span>`;
  $('span', toast).textContent = String(message);
  region.appendChild(toast);
  window.setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(7px)';
    window.setTimeout(() => toast.remove(), 220);
  }, 2600);
}
