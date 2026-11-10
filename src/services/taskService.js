import { db, now } from '../core/db.js';
import { taskEvents } from '../core/events.js';

const pad = (n) => String(n).padStart(2, '0');
const stamp = () => {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
};

export function nextSeq() {
  return db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS s FROM tasks').get().s;
}

export function createTask({ userId = 'demo-user', uploadId = null, type = 'demo-import', priority = 0 } = {}) {
  const seq = nextSeq();
  const id = `task_${stamp()}_${String(seq).padStart(4, '0')}`;
  db.prepare(`INSERT INTO tasks (id,user_id,upload_id,type,status,priority,seq,progress,message,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, userId, uploadId, type, 'QUEUED', priority, seq, 0, '排队中', now(), now());
  broadcastQueueShift();
  return getTask(id);
}

export function getTask(id) {
  return db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
}

/** 排队位置 = 状态为 QUEUED 且 seq 更小的任务数 + 1（方案 §9.1） */
export function queuePosition(id) {
  const t = getTask(id);
  if (!t || t.status !== 'QUEUED') return 0;
  return db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE status='QUEUED' AND seq < ?").get(t.seq).c + 1;
}

export function updateProgress(id, progress, message) {
  db.prepare('UPDATE tasks SET progress=?, message=?, updated_at=? WHERE id=?').run(progress, message, now(), id);
  taskEvents.emit(`task:${id}`, { type: 'progress', progress, message });
}

export function finishTask(id, status, { message = '', resultUrl = null, errorMessage = null } = {}) {
  const progress = status === 'SUCCESS' ? 100 : null;
  db.prepare(`UPDATE tasks SET status=?, progress=COALESCE(?,progress), message=COALESCE(NULLIF(?,''),message),
              result_url=?, error_message=?, finished_at=?, updated_at=? WHERE id=?`)
    .run(status, progress, message, resultUrl, errorMessage, now(), now(), id);
  const evt = status === 'SUCCESS'
    ? { type: 'done', status, resultUrl }
    : { type: 'error', status, message: errorMessage || message || '任务失败' };
  taskEvents.emit(`task:${id}`, evt);
  broadcastQueueShift();
}

/** 队列变动时向所有排队任务推送最新排队位置 */
export function broadcastQueueShift() {
  const rows = db.prepare("SELECT id FROM tasks WHERE status='QUEUED' ORDER BY seq ASC").all();
  rows.forEach((r, i) => taskEvents.emit(`task:${r.id}`, { type: 'queue', queuePosition: i + 1 }));
}

export function stats() {
  const waiting = db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE status='QUEUED'").get().c;
  const processing = db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE status='PROCESSING'").get().c;
  return { waiting, processing };
}
