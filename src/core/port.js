import net from 'node:net';

/** 在 [start, end] 范围内寻找未被占用的端口；全部占用则回退到系统随机分配端口 */
export function findFreePort(start = 8080, end = 8090, host = '0.0.0.0') {
  return new Promise((resolve, reject) => {
    const tryPort = (p) => {
      if (p > end) {
        const srv = net.createServer();
        srv.once('error', () => reject(new Error('无法分配可用端口')));
        srv.listen(0, host, () => {
          const port = srv.address().port;
          srv.close(() => resolve(port));
        });
        return;
      }
      const srv = net.createServer();
      srv.once('error', () => tryPort(p + 1));
      srv.listen(p, host, () => srv.close(() => resolve(p)));
    };
    tryPort(start);
  });
}
