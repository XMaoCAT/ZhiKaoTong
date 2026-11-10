import { EventEmitter } from 'node:events';

/** 全局任务事件总线：taskEvents.emit(`task:${taskId}`, { type: 'queue'|'progress'|'done'|'error', ... }) */
export const taskEvents = new EventEmitter();
taskEvents.setMaxListeners(0);
