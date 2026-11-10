import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getConfig, ROOT } from './src/core/config.js';
import { db, now } from './src/core/db.js';
import { startScheduler } from './src/core/scheduler.js';
import { registerUploadRoutes } from './src/api/upload.js';
import { registerTaskRoutes } from './src/api/task.js';
import { registerEventsRoutes } from './src/api/events.js';
import { registerVersionRoutes } from './src/api/version.js';
import { registerQueueRoutes } from './src/api/queue.js';
import { registerDevAccessRoutes } from './src/api/devaccess.js';
import { registerLeaveRoutes } from './src/api/leaves.js';
import { registerAcademicRoutes } from './src/api/academic.js';
import { registerWorkflowRoutes } from './src/api/workflow.js';
import { registerMajorsRoutes } from './src/api/majors.js';
import { registerTimetableRoutes } from './src/api/timetable.js';
import { registerClassroomRoutes } from './src/api/classroom.js';
import { registerViolationRoutes } from './src/api/violations.js';
import { registerGlobalEvents } from './src/api/events-global.js';
import { registerAdminDataRoutes } from './src/api/admin-data.js';
import { registerAuthRoutes } from './src/api/auth.js';
import { registerSurveyRoutes } from './src/api/surveys.js';
import { registerTodoRoutes } from './src/api/todo.js';
import { registerSearchRoutes } from './src/api/search.js';

const config = getConfig();

async function buildApp() {
  const app = Fastify({ bodyLimit: config.chunkSize * 2 + 65536, logger: false });
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (req, body, done) => done(null, body));

  // 静态资源：前端板块化目录（public/），index 不做长缓存以便热更新
  await app.register(fastifyStatic, {
    root: path.join(ROOT, 'public'),
    index: 'index.html',
    cacheControl: false,
    setHeaders: (res) => { res.setHeader('Cache-Control', 'no-cache'); },
  });

  registerUploadRoutes(app);
  registerTaskRoutes(app);
  registerEventsRoutes(app);
  registerVersionRoutes(app);
  registerQueueRoutes(app);
  registerDevAccessRoutes(app);
  registerLeaveRoutes(app);
  registerAcademicRoutes(app);
  registerWorkflowRoutes(app);
  registerMajorsRoutes(app);
  registerTimetableRoutes(app);
  registerClassroomRoutes(app);
  registerViolationRoutes(app);
  registerGlobalEvents(app);
  registerAdminDataRoutes(app);
  registerAuthRoutes(app);
  registerSurveyRoutes(app);
  registerTodoRoutes(app);
  registerSearchRoutes(app);

  // 多角色调试端点：/devN（PC 视图）与 /m-devN（手机视图）均返回主应用，前端按路径分流与检查开关
  // Fastify v4 不支持 RegExp 路由，用前缀通配 + handler 内严格校验，非法路径交回 404
  const DEV_PATH = /^\/(m-)?dev\d+$/i;
  const devFallback = (req, res) => {
    const pathname = req.raw.url.split('?')[0];
    if (DEV_PATH.test(pathname)) return res.sendFile('index.html');
    return res.callNotFound();
  };
  app.get('/dev*', devFallback);
  app.get('/m-dev*', devFallback);

  app.get('/api/health', async () => ({ ok: true, uptime: Math.round(process.uptime()) }));

  // 本机停机接口（Stop.bat 优先调用，优雅退出）
  app.post('/api/shutdown', async (req, res) => {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip)) {
      return res.code(403).send({ ok: false, message: '仅允许本机调用' });
    }
    res.send({ ok: true });
    setTimeout(() => process.exit(0), 300);
  });
  return app;
}

const lanIPs = () =>
  Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);

function openBrowser(url) {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* 忽略打不开浏览器的情况，控制台已打印地址 */ }
}

const runtimeFile = path.join(ROOT, 'data', 'runtime.json');
process.on('exit', () => { try { fs.unlinkSync(runtimeFile); } catch { /* ignore */ } });

/** 回环功能验证：确认 127.0.0.1:port 由本服务应答（防止本机其他服务特异性占用该端口的回环地址） */
async function loopbackIsOurs(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2500) });
    const data = await res.json().catch(() => null);
    return !!(data && data.ok === true && typeof data.uptime === 'number');
  } catch {
    return false;
  }
}

/** 自动寻找未被占用的端口：优先 portStart..portEnd，逐一尝试；监听成功后回环自检；最后随机端口兜底 */
async function listenWithRetry() {
  const candidates = [];
  if (process.env.PORT) {
    candidates.push(Number(process.env.PORT));
  } else {
    for (let p = Number(config.portStart); p <= Number(config.portEnd); p++) candidates.push(p);
  }
  candidates.push(0); // 随机端口兜底
  let lastApp = null;
  for (const cand of candidates) {
    const app = await buildApp();
    lastApp = app;
    try {
      await app.listen({ port: cand, host: config.host });
    } catch (err) {
      if (err && err.code === 'EADDRINUSE') continue;
      throw err;
    }
    const actualPort = app.server.address().port;
    if (await loopbackIsOurs(actualPort)) return { app, port: actualPort };
    console.log(`[port] ${actualPort} 回环访问被其他服务应答，跳过该端口`);
    await app.close();
  }
  throw new Error('未能找到可用端口：所有候选端口的回环访问均被占用');
}

const { app, port } = await listenWithRetry();

fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
fs.writeFileSync(runtimeFile, JSON.stringify({ pid: process.pid, port, host: config.host, startedAt: now() }, null, 2));

db.prepare(`INSERT INTO app_versions (version, notes, force_update, created_at)
            SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM app_versions WHERE version = ?)`)
  .run(config.webVersion, config.webNotes || '', config.forceUpdate ? 1 : 0, now(), config.webVersion);

startScheduler();

console.log('==================================================');
console.log('  智考通服务已启动');
console.log(`  版本: ${config.webVersion}`);
console.log(`  本机访问: http://127.0.0.1:${port}`);
lanIPs().forEach((ip) => console.log(`  内网访问: http://${ip}:${port}`));
console.log('  停止服务: 运行 Stop.bat（或本机 POST /api/shutdown）');
console.log('==================================================');

if (config.autoOpenBrowser && process.env.ZKT_SELFTEST !== '1') openBrowser(`http://127.0.0.1:${port}`);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n收到 ${sig}，正在关闭服务...`);
    app.close().finally(() => process.exit(0));
  });
}

if (process.env.ZKT_SELFTEST === '1') selfTest(app);

async function selfTest(app) {
  const results = [];
  const check = (name, ok, extra = '') => {
    results.push({ name, ok });
    console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${extra ? ' · ' + extra : ''}`);
  };
  try {
    const v = await app.inject({ method: 'GET', url: '/api/version' });
    check('/api/version', v.statusCode === 200 && !!v.json().version, v.json().version);

    const q = await app.inject({ method: 'GET', url: '/api/queue/status' });
    check('/api/queue/status', q.statusCode === 200, `pressure=${q.json().serverPressure}`);

    const home = await app.inject({ method: 'GET', url: '/' });
    check('静态首页', home.statusCode === 200 && home.body.includes('智考通'));

    const buf = Buffer.from('hello-zhikaotong-selftest');
    const apply = await app.inject({
      method: 'POST', url: '/api/uploads/apply',
      payload: { fileName: 'selftest.txt', fileSize: buf.length, fileType: 'txt', bizType: 'demo-import' },
    });
    const aj = apply.json();
    check('/api/uploads/apply', aj.status === 'allowed', `uploadId=${aj.uploadId}`);

    if (aj.status === 'allowed') {
      const put = await app.inject({
        method: 'PUT', url: `/api/uploads/${aj.uploadId}/chunks/0`,
        headers: { 'content-type': 'application/octet-stream' }, payload: buf,
      });
      check('分片上传', put.statusCode === 200 && put.json().received === true);

      const comp = await app.inject({ method: 'POST', url: `/api/uploads/${aj.uploadId}/complete` });
      const cj = comp.json();
      check('完成上传并创建任务', comp.statusCode === 200 && !!cj.taskId, `taskId=${cj.taskId}`);

      if (cj.taskId) {
        let task = null;
        for (let i = 0; i < 25; i++) {
          await new Promise((r) => setTimeout(r, 700));
          task = (await app.inject({ method: 'GET', url: `/api/tasks/${cj.taskId}` })).json();
          if (task.status === 'SUCCESS' || task.status === 'FAILED') break;
        }
        check('任务处理完成', task.status === 'SUCCESS', `status=${task.status} progress=${task.progress}`);

        if (task.result_url) {
          const dl = await app.inject({ method: 'GET', url: task.result_url });
          check('结果下载', dl.statusCode === 200, `status=${dl.statusCode} body=${String(dl.body).slice(0, 60)}`);
        }

        const sse = await app.inject({ method: 'GET', url: `/api/tasks/${cj.taskId}/events` });
        check('SSE 事件流', sse.statusCode === 200 && String(sse.body).includes('event:'));
      }
    }

    const failed = results.filter((r) => !r.ok).length;
    console.log(`自检完成: ${results.length - failed}/${results.length} 通过`);
    process.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('[FAIL] 自检异常:', err);
    process.exit(1);
  }
}
