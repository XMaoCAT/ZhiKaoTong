// 分片上传客户端：申请槽位/排队 → 分片上传（断点续传+失败重试）→ 完成 → 任务事件（方案 §7/§8）
import { apiGet, apiPost, apiPutBuffer } from './api.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let guardActive = false;
export function setUploadGuard(active) { guardActive = !!active; }
window.addEventListener('beforeunload', (event) => {
  if (guardActive) {
    event.preventDefault();
    event.returnValue = '数据正在上传，请勿退出';
  }
});

/**
 * 上传单个文件到本地服务端。
 * hooks: onQueue(queuePosition, waitedSec) / onStart({uploadId,chunkSize,chunkCount})
 *        onProgress({chunkIndex,chunkCount,sent,total,percent,speed}) / onQueued({taskId,queuePosition})
 * 返回 taskId。
 */
export async function uploadFile(file, hooks = {}) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  setUploadGuard(true);
  try {
    const payload = { fileName: file.name, fileSize: file.size, fileType: ext, bizType: 'demo-import' };
    let resp = await apiPost('/api/uploads/apply', payload);
    if (resp.status === 'rejected') throw new Error(resp.reason || '服务器暂不接受新上传');

    let waited = 0;
    while (resp.status === 'queued') {
      hooks.onQueue && hooks.onQueue(resp.queuePosition, waited);
      await sleep(3000);
      waited += 3;
      resp = await apiPost('/api/uploads/apply', { ...payload, ticketId: resp.ticketId });
      if (resp.status === 'rejected') throw new Error(resp.reason || '服务器暂不接受新上传');
    }

    const { uploadId, chunkSize, chunkCount } = resp;
    hooks.onStart && hooks.onStart({ uploadId, chunkSize, chunkCount });

    // 断点续传：先查询已上传分片数，按顺序补齐
    const status = await apiGet(`/api/uploads/${uploadId}`).catch(() => null);
    const doneSet = new Set();
    if (status && status.uploadedChunkCount > 0) {
      for (let i = 0; i < status.uploadedChunkCount; i++) doneSet.add(i);
    }

    let sent = doneSet.size * chunkSize;
    let lastSent = sent;
    let lastTime = Date.now();
    for (let i = 0; i < chunkCount; i++) {
      if (doneSet.has(i)) continue;
      const blob = file.slice(i * chunkSize, Math.min(file.size, (i + 1) * chunkSize));
      let ok = false;
      let lastErr = null;
      for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
        try {
          await apiPutBuffer(`/api/uploads/${uploadId}/chunks/${i}`, blob);
          ok = true;
        } catch (err) {
          lastErr = err;
          await sleep(700 * attempt);
        }
      }
      if (!ok) throw lastErr || new Error(`分片 ${i} 上传失败`);
      sent += blob.size;
      const nowTs = Date.now();
      const speed = (sent - lastSent) / Math.max(0.001, (nowTs - lastTime) / 1000);
      lastSent = sent;
      lastTime = nowTs;
      hooks.onProgress && hooks.onProgress({
        chunkIndex: i,
        chunkCount,
        sent,
        total: file.size,
        percent: Math.min(100, Math.round((sent / file.size) * 100)),
        speed,
      });
    }

    const finished = await apiPost(`/api/uploads/${uploadId}/complete`, {});
    hooks.onQueued && hooks.onQueued({ taskId: finished.taskId, queuePosition: finished.queuePosition });
    return finished.taskId;
  } finally {
    setUploadGuard(false);
  }
}
