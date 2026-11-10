import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const file = path.resolve('data/runtime.json');

if (!fs.existsSync(file)) {
  console.log('[提示] 未发现运行记录，服务可能未启动。');
  process.exit(0);
}

let info;
try {
  info = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch {
  console.log('[错误] runtime.json 解析失败，已清理该文件。');
  try { fs.unlinkSync(file); } catch {}
  process.exit(0);
}

const alive = () => { try { process.kill(info.pid, 0); return true; } catch { return false; } };

if (!alive()) {
  console.log(`[提示] 服务进程已不在运行（PID ${info.pid}），清理运行记录。`);
  try { fs.unlinkSync(file); } catch {}
  process.exit(0);
}

console.log(`[提示] 正在停止服务 PID=${info.pid} 端口=${info.port} ...`);
try {
  const res = await fetch(`http://127.0.0.1:${info.port}/api/shutdown`, { method: 'POST', signal: AbortSignal.timeout(3000) });
  if (res.ok) console.log('[提示] 已发送优雅停机指令。');
} catch {
  console.log('[提示] 优雅停机不可达，将强制结束进程。');
}

await new Promise(r => setTimeout(r, 2500));

if (alive()) {
  try {
    execSync(`taskkill /PID ${info.pid} /T /F`, { stdio: 'ignore' });
    console.log('[OK] 已强制结束服务进程。');
  } catch {
    console.log('[提示] 强制结束失败，请手动关闭「智考通服务端」窗口。');
  }
} else {
  console.log('[OK] 服务已停止。');
}

try { fs.unlinkSync(file); } catch {}
