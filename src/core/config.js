import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const configFile = path.join(ROOT, 'config', 'config.json');

let config = JSON.parse(fs.readFileSync(configFile, 'utf8'));

export const configEvents = new EventEmitter();

// 配置热更新：修改 config/config.json 无需重启服务
let reloadTimer = null;
try {
  fs.watch(configFile, () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      try {
        config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        configEvents.emit('reload', config);
        console.log('[config] 配置已热加载');
      } catch (err) {
        console.error('[config] 配置重载失败，沿用旧配置:', err.message);
      }
    }, 300);
  });
} catch (err) {
  console.warn('[config] 配置文件监听不可用:', err.message);
}

export const getConfig = () => config;
