import { getTask, queuePosition } from '../services/taskService.js';
import { taskEvents } from '../core/events.js';

/** SSE 任务事件流：GET /api/tasks/:taskId/events（方案 §9.2） */
export function registerEventsRoutes(app) {
  app.get('/api/tasks/:taskId/events', (req, reply) => {
    reply.hijack();
    const raw = reply.raw;
    const id = req.params.taskId;
    const task = getTask(id);
    if (!task) {
      raw.writeHead(404, { 'Content-Type': 'application/json' });
      raw.end(JSON.stringify({ message: '任务不存在' }));
      return;
    }

    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    const send = (name, data) => raw.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);

    let closed = false;
    const hb = setInterval(() => { if (!closed) raw.write(': ping\n\n'); }, 15000);
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(hb);
      taskEvents.off(`task:${id}`, listener);
    };
    const listener = (evt) => {
      if (closed) return;
      send(evt.type, evt);
      if (evt.type === 'done' || evt.type === 'error') {
        cleanup();
        raw.end();
      }
    };

    send('queue', { queuePosition: queuePosition(id) });
    if (task.status === 'PROCESSING') send('progress', { progress: task.progress, message: task.message });
    if (task.status === 'SUCCESS') { send('done', { status: 'SUCCESS', resultUrl: task.result_url }); cleanup(); raw.end(); return; }
    if (task.status === 'FAILED' || task.status === 'CANCELLED') { send('error', { message: task.error_message || '任务失败' }); cleanup(); raw.end(); return; }

    taskEvents.on(`task:${id}`, listener);
    req.raw.on('close', cleanup);
  });
}
