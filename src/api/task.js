import path from 'node:path';
import fs from 'node:fs';
import { getTask, queuePosition } from '../services/taskService.js';
import { resultsDir } from '../core/scheduler.js';

export function registerTaskRoutes(app) {
  app.get('/api/tasks/:taskId', async (req, res) => {
    const t = getTask(req.params.taskId);
    if (!t) return res.code(404).send({ message: '任务不存在' });
    return { ...t, queuePosition: queuePosition(t.id) };
  });

  app.get('/api/results/:taskId', async (req, res) => {
    const t = getTask(req.params.taskId);
    if (!t || !t.result_url) return res.code(404).send({ message: '结果不存在' });
    const name = path.basename(t.result_url);
    const file = path.join(resultsDir, `${name}.json`);
    if (!fs.existsSync(file)) return res.code(404).send({ message: '结果文件缺失' });
    return res.sendFile(`${name}.json`, resultsDir);
  });
}
