import os from 'node:os';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { getConfig, ROOT } from './config.js';

/**
 * 压力自适应监控器（方案 §10）
 * - 指标：CPU、内存、事件循环延迟、磁盘剩余、排队数、活跃上传数
 * - 等级：LOW / NORMAL / HIGH，每 5 秒（可配）评估一次
 * - 行为：HIGH 降并发/降槽位；LOW 逐步恢复；调节平滑不剧烈波动
 */
class PressureMonitor extends EventEmitter {
  constructor() {
    super();
    const c = getConfig();
    this.level = 'NORMAL';
    this.uploadSlots = Math.max(2, Math.min(c.maxUploadSlots, 4));
    this.taskConcurrency = 1;
    this.activeUploads = 0;
    this.waitingQueue = 0;
    this.processing = 0;
    this.cpu = 0;
    this.mem = 0;
    this.loopDelay = 0;
    this.diskFreeBytes = Infinity;

    this._cpuLast = process.cpuUsage();
    this._cpuMark = process.hrtime.bigint();

    setInterval(() => this._sample(), 1000).unref();
    this._loopWatch();
    const timer = setInterval(() => this._check(), Math.max(1000, getConfig().pressureCheckIntervalMs || 5000));
    timer.unref();
  }

  _sample() {
    const u = process.cpuUsage();
    const t = process.hrtime.bigint();
    const d = (u.user + u.system) - (this._cpuLast.user + this._cpuLast.system);
    const dt = Number(t - this._cpuMark);
    if (dt > 0) this.cpu = Math.min(1, d / dt);
    this._cpuLast = u;
    this._cpuMark = t;
    this.mem = 1 - os.freemem() / os.totalmem();
  }

  _loopWatch() {
    const span = 200;
    const tick = () => {
      const before = process.hrtime.bigint();
      setTimeout(() => {
        this.loopDelay = Math.max(0, Number(process.hrtime.bigint() - before) / 1e6 - span);
        tick();
      }, span);
    };
    tick();
  }

  async _disk() {
    try {
      const st = await fs.promises.statfs(ROOT);
      this.diskFreeBytes = Number(st.bsize) * Number(st.bavail);
    } catch {
      this.diskFreeBytes = Infinity;
    }
  }

  setSnapshot({ activeUploads, waitingQueue, processing } = {}) {
    if (activeUploads !== undefined) this.activeUploads = activeUploads;
    if (waitingQueue !== undefined) this.waitingQueue = waitingQueue;
    if (processing !== undefined) this.processing = processing;
  }

  _check() {
    this._disk();
    const c = getConfig();
    const high = this.cpu > c.highCpuUsage
      || this.mem > 0.85
      || this.waitingQueue > c.highQueueLength
      || this.loopDelay > 150
      || this.diskFreeBytes < 1024 ** 3;
    const low = this.cpu < c.lowCpuUsage
      && this.mem < 0.7
      && this.waitingQueue < c.lowQueueLength
      && this.loopDelay < 50
      && this.diskFreeBytes > 5 * 1024 ** 3;
    const next = high ? 'HIGH' : low ? 'LOW' : 'NORMAL';
    if (next !== this.level) {
      this.level = next;
      console.log(`[pressure] 压力等级切换为 ${next}`);
      this.emit('change', next);
    }
    if (this.level === 'HIGH') {
      this.taskConcurrency = Math.max(1, Math.min(c.maxTaskConcurrency, Math.floor(this.taskConcurrency * 0.75)));
      this.uploadSlots = Math.max(2, this.uploadSlots - 3);
    } else if (this.level === 'LOW') {
      this.taskConcurrency = Math.min(c.maxTaskConcurrency, this.taskConcurrency + 1);
      this.uploadSlots = Math.min(c.maxUploadSlots, this.uploadSlots + 1);
    }
  }

  get acceptingNewTasks() {
    const c = getConfig();
    return this.diskFreeBytes > 500 * 1024 ** 2 && this.waitingQueue <= c.highQueueLength * 2;
  }

  get slotsAvailable() {
    return this.level !== 'HIGH' && this.activeUploads < this.uploadSlots;
  }

  snapshot() {
    return {
      level: this.level,
      cpu: +this.cpu.toFixed(3),
      mem: +this.mem.toFixed(3),
      loopDelayMs: +this.loopDelay.toFixed(1),
      diskFreeBytes: this.diskFreeBytes === Infinity ? null : this.diskFreeBytes,
      uploadSlots: this.uploadSlots,
      taskConcurrency: this.taskConcurrency,
      activeUploads: this.activeUploads,
      waitingQueue: this.waitingQueue,
      processing: this.processing,
      acceptingNewTasks: this.acceptingNewTasks,
    };
  }
}

export const pressure = new PressureMonitor();
