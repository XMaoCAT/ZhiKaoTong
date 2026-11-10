import { stats } from '../services/taskService.js';
import { pressure } from '../core/pressure.js';

export function registerQueueRoutes(app) {
  app.get('/api/queue/status', async () => {
    const s = stats();
    const p = pressure.snapshot();
    return {
      waitingCount: s.waiting,
      processingCount: s.processing,
      serverPressure: p.level,
      acceptingNewTasks: p.acceptingNewTasks,
      uploadSlots: p.uploadSlots,
      taskConcurrency: p.taskConcurrency,
      activeUploads: p.activeUploads,
      metrics: { cpu: p.cpu, mem: p.mem, loopDelayMs: p.loopDelayMs, diskFreeBytes: p.diskFreeBytes },
    };
  });
}
