import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { db, now } from './db.js';
import { getConfig, ROOT } from './config.js';
import { pressure } from './pressure.js';
import { updateProgress, finishTask, broadcastQueueShift, stats } from '../services/taskService.js';
import { getUploadRow } from '../services/uploadService.js';

export const resultsDir = path.join(ROOT, 'storage', 'results');
fs.mkdirSync(resultsDir, { recursive: true });

const running = new Set();

/** 插件热更新：每个任务执行时全新加载插件文件（方案 §11.5），改文件/换版本无需重启核心 */
async function loadPlugin(type) {
  const c = getConfig();
  const file = c.plugins && c.plugins[type];
  if (!file) throw new Error(`未配置任务类型「${type}」的插件`);
  const full = path.join(ROOT, 'src', 'plugins', path.basename(file));
  if (!fs.existsSync(full)) throw new Error(`插件文件不存在: ${file}`);
  const mod = await import(`${pathToFileURL(full).href}?t=${Date.now()}`);
  const plugin = mod.default;
  if (!plugin || typeof plugin.run !== 'function') throw new Error(`插件 ${file} 缺少 run() 方法`);
  return plugin;
}

function uploadFilePath(uploadId) {
  const row = getUploadRow(uploadId);
  return row && row.storage_path ? path.join(ROOT, row.storage_path) : null;
}

async function runTask(task) {
  try {
    const plugin = await loadPlugin(task.type);
    const result = await plugin.run({
      task,
      filePath: task.upload_id ? uploadFilePath(task.upload_id) : null,
      resultsDir,
      updateProgress: (p, m) => updateProgress(task.id, Math.max(0, Math.min(100, Number(p) || 0)), String(m || '')),
    });
    finishTask(task.id, 'SUCCESS', {
      message: (result && result.message) || '处理完成',
      resultUrl: (result && result.resultUrl) || null,
    });
  } catch (err) {
    finishTask(task.id, 'FAILED', { errorMessage: err.message || String(err) });
  } finally {
    running.delete(task.id);
  }
}

/** 本地任务调度器：定时扫描可执行任务，按压力自适应并发执行（方案 §1.4 / §10） */
export function startScheduler() {
  const timer = setInterval(async () => {
    const s = stats();
    pressure.setSnapshot({ waitingQueue: s.waiting, processing: running.size });
    while (running.size < pressure.taskConcurrency) {
      const task = db.prepare("SELECT * FROM tasks WHERE status='QUEUED' ORDER BY priority DESC, seq ASC LIMIT 1").get();
      if (!task) break;
      db.prepare("UPDATE tasks SET status='PROCESSING', started_at=?, updated_at=?, message='开始处理', progress=5 WHERE id=?")
        .run(now(), now(), task.id);
      running.add(task.id);
      broadcastQueueShift();
      runTask(task);
    }
  }, 1000);
  timer.unref();
  return timer;
}
