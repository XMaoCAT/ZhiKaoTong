import { getConfig } from '../core/config.js';

export function registerVersionRoutes(app) {
  app.get('/api/version', async () => {
    const c = getConfig();
    return { version: c.webVersion, notes: c.webNotes || '', forceUpdate: !!c.forceUpdate };
  });
}
