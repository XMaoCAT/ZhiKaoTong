import { db, now } from '../core/db.js';

/** 读调试端点开关（默认关闭） */
export function devAccessEnabled() {
  const row = db.prepare("SELECT value FROM settings WHERE key='dev_access'").get();
  return !!row && row.value === '1';
}

function setDevAccess(enabled) {
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('dev_access', ?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(enabled ? '1' : '0', now());
}

/**
 * 多角色调试端点开关：
 * - GET  /api/dev-access → { enabled }
 * - POST /api/dev-access { enabled } → 仅 IT管理员（x-zkt-role 请求头）可切换
 */
export function registerDevAccessRoutes(app) {
  app.get('/api/dev-access', async () => ({ enabled: devAccessEnabled() }));

  app.post('/api/dev-access', async (req, res) => {
    let role = '';
    try { role = decodeURIComponent(String(req.headers['x-zkt-role'] || '')); } catch { role = String(req.headers['x-zkt-role'] || ''); }
    if (role !== 'IT管理员') {
      return res.code(403).send({ ok: false, message: '仅 IT管理员 可操作该开关' });
    }
    const enabled = !!(req.body && req.body.enabled);
    setDevAccess(enabled);
    return { ok: true, enabled: devAccessEnabled() };
  });
}
