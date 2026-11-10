# 模块开发与交接日志：`mod-login` (登录页)

## 1. 模块元数据与架构自检
- **模块路径**：`modules/mod-login/`
- **挂载插槽**：`#loginStage`
- **支持端口**：`pc` / `mobile`
- **开放群组**：`学生`, `教师`, `教务处`, `学生处`, `导员`, `IT管理员`, `guest`（未登录态）
- **物理可删除性自检**：[通过] 无跨模块 import（仅依赖宿主层 `shared/roles.js`），样式全部以 `.mod-login` 前缀收敛，`unmount` 清空容器无残留副作用；登录跳转通过 `eventBus.emit('auth:logged-in')` 交宿主处理。

## 2. 功能开发进度清单 (Progress & Todo List)
- [x] 2026-11-03 **登录限流+图形验证码上线（待办清账批一 S1–S5，开发计划《待办清账四批次-设计与进度.md》§1）**：
  - **后端**（src/api/auth.js）：①`GET /api/auth/captcha` 自绘 SVG 图形验证码（4 位大写字母数字，去除易混淆 I O 0 1；随机旋转/偏移/颜色+4 干扰线+30 噪点；零外部依赖；token 5 分钟过期+**一次性消费**——读取即删防同一码多次试密码）；②`POST /api/auth/login` 增加 captchaToken/captchaInput 必填校验（错/过期 400，比对忽略大小写）；③**登录限流**：内存 Map<ip, 时间戳[]>，**仅计失败**（账号不存在/密码错误 401 各记一次；验证码错误不计——防脚本刷爆计数锁死真人；成功登录不计不清零——用户口径 2026-11-03），半小时滑动窗口累计 5 次后直接 429「尝试过于频繁，请半小时后再试」（限流期正确密码也拒绝）；内存实现不落库，重启即清零。
  - **前端**（mod-login 双 Tab + api-auth.js）：双 Tab（学生/教职工）均加「验证码」行（输入框+116×42 SVG 图片横排，与输入框同高对齐）；双 Tab **共用同一 token**（Tab 切换不刷新）；点击/Enter/Space 图片刷新；**登录失败后自动换新**（旧 token 已被服务端消费）；挂载即取，加载失败显示「加载失败·点击重试」；验证码输入 Enter 直提登录。
  - **验收**：API 冒烟 10/10（验证码结构/无码 400/伪造 token 400/错码 400/重复消费 400/小写正确码+错密码 401/不存在账号 401/空账号 400/学生+教师正确登录 200）+ 限流冒烟 4/4（序列 401×3→429×3 恰在第 5 次失败后触发；限流期正确密码 429；文案断言）+ 重启清零后解锁 PASS；PC 与 /m-dev1 双端浏览器实测（验证码渲染/点击刷新（2EZ6→6JGW）/空码提示/错码提示+自动刷新（6JGW→8BU2）/学生与教师01 登录闭环/控制台零 JS 错误）+ §7.6 computed 核验（图片 116×42=输入框高、uppercase、captcha-label margin-top 14px 同 pwd-label 节奏档、flex row、cursor:pointer、圆角 10px）。
- [x] 2026-10-29 **密码体系上线（用户需求：登录密码校验）**：学生/教职工双 Tab 均增加密码输入框（.pwd-input + .pwd-label 分节间距）；登录改为 `POST /api/auth/login` 服务端校验（群组由服务端返回，本地仅预检学号格式）；默认密码 123456（登录页 placeholder 同步提示）；错误提示复用 #loginError（密码错误/账号不存在 401）；密码框 Enter 直提登录、学号框 Enter 跳密码框；按钮请求期间 disabled 防重复提交。后端属地：`src/api/auth.js`（新建，account_credentials 表 scrypt+盐）。实测：错误密码 401 提示/默认密码登录/修改后新旧密码切换/IT 重置后恢复默认/动态教师与管理账号全通过（API 30/30 + 双端浏览器）
- [x] 2026-10-23 **P1 角色体系更名与新角色（开发计划 §2）**：教职工下拉由 STAFF_ACCOUNTS 常量驱动自动更新为六账号（教师01 / 教师02 / **教务处** / **学生处** / 导员 / IT管理员，旧“教务科”账号退役）；模块零代码改动（读 shared/roles.js 常量）；旧“教务科”浏览器会话由宿主 main.js migrateLegacyRole 自动迁移为“教务处”。实测：六账号下拉渲染、教务处/学生处登录全流程、旧会话迁移直入工作区均通过
- [x] 2026-10-22 深夜 **全平台 UI 纠正审计通过**（Rules.md §7.6 SOP）：PC 登录页（segmented 学生/教职工切换 + 9 位学号输入态）截图审查 + 控制台零错误；零缺陷一次通过
- [x] 2026-10-22 **学号升级 9 位**（用户需求）：学生 Tab 输入框改为 9 位学号（placeholder “学号（9 位数字）”，maxlength 9）；`validStudentId`（shared/roles.js）改为 `/^\d{9}$/` 且数值 1–100（即 000000001–000000100，与 students 表种子学号一致）；登录后姓名即 9 位学号；旧 3 位学号登录不再受理
- [x] 2026-10-21 重做为 Tab 切换式登录：顶部 segmented 切换「学生 / 教职工」；学生=学号输入框（校验失败弹错误提示不进入）；教职工=账号下拉（教师01 / 教师02 / 教务科 / 导员 / IT管理员）
- [x] 学生 100 个账号：学号 000000001–000000100（9 位，后端 students 表种子），登录后姓名即学号，群组=学生
- [x] 教职工账号拆分：教师01/教师02（同教师级权限，群组映射 `ACCOUNT_TO_GROUP`）；其他功能待续
- [x] 登录事件携带姓名：`auth:logged-in` 载荷增加 `name`（学号/账号名）
- [x] 删除 login-foot 空话脚注（零空话铁律 §〇.5）
- [x] 调试端点上下文提示（/devN PC 视图、/m-devN 手机视图独立登录态说明）
- [x] 迁移至规范结构：manifest.json + index.js（mount/unmount 生命周期）+ style.css（命名空间前缀）
- [x] 2026-11-03 登录限流/验证码已交付（见顶部条目）；限流为内存实现（重启清零，内网演示可接受；验证码仅图形，不做短信/邮件）

## 3. 跨模块事件通信契约 (EventBus Contracts)
- **对外触发事件 (Emits)**：
  - `auth:logged-in` -> `{ role: '学生'|'教师'|'教务处'|'学生处'|'导员'|'IT管理员', name: string（9 位学号 000000001–000000100 / 账号名）, home: string }`（点击登录按钮触发；宿主 `saveIdentity` 持久化群组+姓名并广播 `context:user-changed`；home 指向未注册模块时宿主 switchMain 自动回落 landing）
- **监听外部事件 (Listens)**：无（纯触发方，登录页不依赖其他模块状态）

## 4. ⚠️ 踩坑记录与避坑指南 (Pitfalls & Lessons Learned)
> **[AI 接手铁律]**：任何后续接手修改本模块的 AI 模型，在编写代码前必须仔细阅读下表，严禁推翻已验证的修复方案或重蹈覆辙！

| 编号 | 历史 Bug / 踩坑现象描述 | 根本原因分析 (Root Cause) | 最终验证解决方案与代码禁令 (Mandatory Fix & Rule) |
| :--- | :--- | :--- | :--- |
| #01 | （迁移前史）登录后点击顶栏"退出登录"刷新页面但角色未清 | 旧实现在 login.js 与 main.js 双处维护角色 key，退出时只清了其中一处 | 会话读写统一收敛到 `shared/roles.js`（含 dev 端点独立 key `zkt.role.<devN>`）；**严禁**在模块内直接操作 localStorage 角色键 |
| #02 | （迁移前史）调试端点 POST 角色头传中文报错 `Cannot convert argument to a ByteString` | HTTP 头仅允许 ASCII，中文角色名直接放 header 会被 fetch 拒绝 | 角色头一律 `encodeURIComponent` 传输、服务端 `decodeURIComponent` 解码；**严禁**在请求头直写非 ASCII 值 |
| #03 | （迁移前史）m-dev1 登录后点任何入口跳回 PC 视图 | main.js 装配手机板块后无条件执行 `setViewMode('pc')` | 装配逻辑按 `routeMode().mobile` 分流；m-dev 进入工作台时锁定 `setViewMode('mobile')` 且 PC 外壳 `display:none`；**严禁**在手机调试路径调用 PC 视图切换 |
| #04 | 迁移时样式前缀遗漏：`.zone-head` 等内部类未加 `.mod-login` 前缀 | 仅对部分选择器做了正则替换 | 迁移后必须逐行校验"非 `.mod-login` 前缀选择器 = 0"再交付；`@media` 内选择器同样要加前缀 |
| #05 | 2026-10-21 用户报"界面错位"：登录卡片顶在左上角、无全屏渐变背景、无居中；computed style 显示 `#loginStage` 为 `display:block / position:static / z-index:auto` | `.mod-login .login-stage` 是**后代选择器**，但 `mount()` 把 `.mod-login` 类注入到了插槽 `#loginStage` **自身**（同一元素 `class="login-stage open mod-login"`），后代写法永不命中，stage 的 fixed 覆盖层/居中/背景全部失效（内部 `.login-panel` 等后代选择器正常，故卡片样式在、位置错） | 插槽元素自身的规则必须用**同元素复合选择器** `.login-stage.mod-login`（`.open` 状态写作 `.login-stage.mod-login.open`）；已修复并用 getComputedStyle 实测（fixed/z-60/flex 居中/渐变背景全部生效）。**禁令**：凡挂载到宿主插槽（#loginStage/#topbar/#mobileStage 等）自身的样式，严禁后代写法，只能复合写法；修复依据 Rules.md §3.3 铁律 3 |
| #06 | 2026-10-21 用户报"一个窗口一个登录按钮啊"：Tab 重做后学生表单与教职工表单**同时堆叠显示**，切换失效 | `.login-pane` 显式声明 `display:flex`，优先级高于 UA 对 `[hidden]` 的默认 `display:none`，`hidden` 属性被覆盖失效（此前验证只查了 `pf.hidden` 属性值未查 computed display，漏检） | 凡给元素显式设 display 的同时用 `hidden` 控制显隐，**必须**补 `[hidden]` 规则：`.mod-login .login-pane[hidden] { display: none; }`；已修复并实测切换后 computed display（学生 none/教职工 flex 双向正确）。**禁令**：显式 display + hidden 组合必须配套 `[hidden]` 覆盖规则；验证显隐必须查 getComputedStyle().display 而非仅查 hidden 属性 |
| #07 | （2026-10-24 预防）动态教师名（如"王芳""张伟"登录时若直查 ACCOUNT_TO_GROUP 得 undefined，被 `|| account` 兑底后群组名即教师名，saveIdentity 校验 ALL_ROLES 不含则静默失败/登录异常 | 教师账号已动态化（teachers 表），固定映射表无法覆盖新姓名 | 统一走 `staffAccountToGroup()`（固定账号查表+管理账号白名单，其余归'教师'）；**禁令**：登录/鉴权处严禁对教职工账号直查 ACCOUNT_TO_GROUP，必须经 staffAccountToGroup |
| #08 | （2026-11-03 预防）验证码答案可从 SVG 明文 <text> 提取——机器人可直接解析后自动重试 | SVG 本就是给人眼看的明文载体，本项目为内网演示系统，图形验证码定位是**防最低成本脚本刷接口**而非防 OCR（真正防线是限流 5 次/半小时）；后续如需升级接清到 DEV_LOG：换 canvas 像素级绘制或后端会话绑定 | **禁令**：不得在前端 JS 任何位置缓存/暴露验证码答案；限流计数严禁把验证码错误计入（防脚本刷爆计数锁死真人）；测试验证码流程时用 SVG 正则提取答案（与人眼同源，非后门） |
| #09 | （2026-11-03 预防）限流测试会锁定本机 IP 半小时，导致后续浏览器实测全部 429 | 内存限流与测试流程冲突 | 限流类验收必须放在双端浏览器实测**之后**执行；测完立即重启服务清零（注册表 inspect→cleanup→重启→解锁验证四步）再收尾。**禁令**：验证码一次性消费后，前端任何失败路径（400/401/429）都必须 refreshCaptcha 换新，否则用户拿着已消费 token 永远过不了验证码层 |

> AI生成
