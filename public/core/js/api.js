// API 访问层：JSON 请求封装 + SSE 订阅（断线自动降级为 3 秒轮询，方案 §6.4）
async function request(url, options = {}) {
  const res = await fetch(url, options);
  let data = null;
  try { data = await res.json(); } catch { /* 无 JSON 响应体 */ }
  if (!res.ok) throw new Error((data && data.message) || `请求失败(${res.status})`);
  return data;
}

export const apiGet = (url) => request(url);
export const apiPost = (url, body) => request(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body ?? {}),
});
export const apiPutBuffer = (url, buffer) => request(url, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/octet-stream' },
  body: buffer,
});

/**
 * 订阅任务事件：queue / progress / done / error
 * SSE 断开后自动降级为每 3 秒轮询任务状态，直至任务终态。
 */
export function subscribeTask(taskId, handlers = {}) {
  let es = null;
  let pollTimer = null;
  let closed = false;

  const finish = (payload) => {
    if (closed) return;
    cleanup();
    handlers.onDone && handlers.onDone(payload);
  };
  const handle = (type, data) => {
    if (closed) return;
    if (type === 'queue') handlers.onQueue && handlers.onQueue(data);
    else if (type === 'progress') handlers.onProgress && handlers.onProgress(data);
    else if (type === 'done') finish({ type: 'done', ...data });
    else if (type === 'error') finish({ type: 'error', ...data });
  };

  const startPolling = () => {
    if (pollTimer || closed) return;
    const tick = async () => {
      try {
        const t = await apiGet(`/api/tasks/${taskId}`);
        if (t.status === 'SUCCESS') finish({ type: 'done', status: 'SUCCESS', resultUrl: t.result_url });
        else if (t.status === 'FAILED' || t.status === 'CANCELLED') finish({ type: 'error', message: t.error_message || '任务失败' });
        else {
          if (t.status === 'QUEUED') handlers.onQueue && handlers.onQueue({ queuePosition: t.queuePosition });
          handlers.onProgress && handlers.onProgress({ progress: t.progress, message: t.message });
        }
      } catch { /* 轮询失败下次再试 */ }
    };
    pollTimer = setInterval(tick, 3000);
    tick();
  };

  try {
    es = new EventSource(`/api/tasks/${taskId}/events`);
    ['queue', 'progress', 'done', 'error'].forEach((name) => {
      es.addEventListener(name, (ev) => {
        let data = {};
        try { data = JSON.parse(ev.data); } catch { /* ignore */ }
        handle(name, data);
      });
    });
    es.onerror = () => {
      if (closed) return;
      es.close();
      es = null;
      startPolling();
    };
  } catch { startPolling(); }

  function cleanup() {
    closed = true;
    if (es) es.close();
    if (pollTimer) clearInterval(pollTimer);
  }

  return { close: cleanup };
}
