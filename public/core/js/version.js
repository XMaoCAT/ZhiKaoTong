// 版本检测与更新提示（方案 §6.1 / §11.2：GET /api/version 对比本地版本）
import { openModal } from './modal.js';

const KEY = 'zkt.webVersion';

export async function checkVersion() {
  try {
    const res = await fetch('/api/version');
    if (!res.ok) return;
    const info = await res.json();
    const local = localStorage.getItem(KEY);
    if (!local) { localStorage.setItem(KEY, info.version); return; }
    if (local === info.version) return;
    openModal({
      title: '发现新版本',
      lead: `当前版本 ${local} · 最新版本 ${info.version}`,
      body: `更新说明：${info.notes || '无'}\n\n点击「立即更新」将清除本地缓存并重新加载页面。`,
      confirmText: info.forceUpdate ? '立即更新（强制）' : '立即更新',
      onConfirm() {
        localStorage.setItem(KEY, info.version);
        try { localStorage.clear(); } catch { /* ignore */ }
        localStorage.setItem(KEY, info.version);
        const url = new URL(location.href);
        url.searchParams.set('_v', info.version);
        location.href = url.href;
      },
    });
  } catch { /* 静默失败：离线或服务未就绪 */ }
}
