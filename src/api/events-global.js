import { db, now } from '../core/db.js';
import { readRole, readName } from '../core/http-utils.js';
import { pub } from '../core/pub.js';

/**
 * 全局 SSE 事件流（开发计划 §4.2）：GET /api/events/global
 * ---------------------------------------------------------------------------
 * - 身份：`x-zkt-role` / `x-zkt-name` 请求头（URI 编码）或 `?role=&name=` query
 *   （EventSource 无法携带自定义头，前端转发件 shared/sse.js 走 query 通道）。
 * - 白名单：六角色全部可连——学生收签到卡/课表通知、教师收审批确认窗、
 *   教务处/学生处/导员收审批与课堂事件、IT管理员收全局。
 * - 频道注册：所有角色挂 `role:<role>`；学生另挂 `class:<classId>`（students.class_id）；
 *   教师另挂 `teacher:<账号名>`。
 * - 连接写法逐行参照 src/api/events.js 样板：hijack → writeHead → 注册（含 15s 心跳）→ close 清理。
 * - 首帧 `hello`：{ channels, serverTime }（前端对时校验用）。
 */

const ALLOWED_ROLES = ['学生', '教师', '教务处', '学生处', '导员', 'IT管理员'];

export function registerGlobalEvents(app) {
  app.get('/api/events/global', (req, reply) => {
    const role = readRole(req);
    const name = readName(req);

    if (!ALLOWED_ROLES.includes(role)) {
      return reply.code(403).send({ ok: false, message: '未登录或角色无效，无法建立事件流' });
    }

    // 频道计算：role 频道全员；学生加 class 频道；教师加 teacher 频道
    const channels = [`role:${role}`];
    if (role === '学生' && name) {
      const stu = db.prepare('SELECT class_id FROM students WHERE id = ?').get(name);
      if (stu && stu.class_id != null) channels.push(`class:${stu.class_id}`);
    } else if (role === '教师' && name) {
      channels.push(`teacher:${name}`);
    }

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    pub.register(raw, channels);
    // 首帧：频道清单 + 服务器时间（对时校验）
    raw.write(`event: hello\ndata: ${JSON.stringify({ channels, serverTime: now() })}\n\n`);

    req.raw.on('close', () => pub.unregister(raw));
  });
}
