# 模块开发与交接日志：`mod-admin-console` (系统管理)

## 1. 模块元数据与架构自检
- **模块路径**：`modules/mod-admin-console/`
- **挂载插槽**：`#mainViewContent`
- **支持端口**：`pc`
- **开放群组**：`IT管理员`（其余角色在加载器 manifest 过滤阶段即被拒载）
- **物理可删除性自检**：[通过] 无跨模块 import（仅 shared/roles + shared/api-admin + shared/leave-wizard 共享件）；toast 改 `ui:toast` 事件由宿主渲染；样式 `.mod-admin-console` 前缀；删除后 IT管理员登录默认页回落工作台首页。

## 2. 功能开发进度清单 (Progress & Todo List)
- [x] 2026-10-29 **用户与角色管理区上线（原待办三件之一）**：segmented 三 Tab（学生 100/教师动态/管理账号 4）+ 学号/姓名搜索（仅学生 Tab 显示）+ 每行「初始密码/已设自定义密码」胶囊 + 重置密码按钮（确认弹窗→POST /api/admin/account-reset-password→恢复默认 123456）。数据源 GET /api/admin/accounts（IT 专属）。⚠ 实修两缺陷：① 搜索框初始 hidden 但默认 Tab 即学生（漏显示，改为默认显示）；② 按钮索引数组漏 push（改 accRow 内统一 push）。
- [x] 2026-10-29 **考勤规则配置区上线（原待办三件之二）**：三数字输入（旷课扣分/旷寝扣分/预警线，1–100 整数）+ 保存→POST /api/admin/attendance-rules（settings 表单源，violations.js 动态消费）；保存后登记/预警/学生处违规 Tab 分值实时同步（历史违规分值不变）。实测：改 4 分→ GET /api/violations/rules 返回 -4 → 恢复 5。
- [x] 2026-10-29 **数据归档与导出区上线（原待办三件之三）**：三数据集 segmented（请假/违规/课堂）+ 起止日期筛选（YYYY-MM-DD 服务端 400 校验）+ 查询（前 50 条预览 + 总数）+ 导出 CSV（Blob 下载，BOM 前缀保证 Excel 中文，本地日期命名防时区坑）。后端 GET /api/admin/archive（LIMIT 5000，返回 cols+rows 同构供预览与导出共用）。实测：请假 6 条导出 CSV（BOM✓ 表头✓）；违规日期范围空态✓；导出按钮空数据 disabled✓。
- [x] 2026-10-24 晚 **数据管理区（用户需求：初始化+生成模拟数据）**：新增 section-card——①**数据状态行**（GET /api/admin/data-status：教师/学生/班级/请假/课表/课堂/违规/申请/通知/专业部/导员绑定/上传记录计数汇总，操作后实时刷新）；②**初始化**（danger 按钮→弹窗警示全量清零范围+**输入"清空"二字强确认**[错字红框拦截]→POST /api/admin/reset[17 表+storage]→toast 报表数+状态行归零）；③**生成模拟数据**（primary 按钮→确认弹窗列明 5 教师+100 学生→POST /api/admin/seed[幂等]→toast 报实际新增数）。实测：错字拦截/清空执行/状态归零/seed 幂等循环全通（初始化表清单已含 account_credentials）
- [x] 2026-10-22 深夜 **全平台 UI 纠正审计通过**（Rules.md §7.6 SOP）：IT 管理员 PC 系统管理页（iOS 开关/端点直达 chips）截图审查 + 控制台零错误；零缺陷一次通过
- [x] 调试端点 iOS 风格开关（宿主全局组件 `.switch`，`aria-checked` 驱动；GET/POST `/api/dev-access`）
- [x] 端点直达入口（开启后显示 `/dev1` PC 视图、`/m-dev1` 手机视图两个可点击 chip，点击新开标签页直达）
- [x] 2026-10-21 按零空话铁律（Rules.md §〇.5）重做：删除"管理模块"三卡（考勤规则/用户与角色/数据与归档——无点击功能的纯描述卡）、"PC/手机视图端点"与"安全提示"三张说明卡、两条 flow-foot 描述行
- [x] 2026-10-29 **UI 审查**：系统管理整页全页截图（四卡布局/三 Tab 滑块/搜索框/规则输入行/归档工具行全对齐）+ computed 核验（弹窗 rect/搜索过滤 9 行/Tab 载入 2+4 行）+ 控制台零 JS 错误
- [ ] [待办] 考勤规则扩展项（课堂加减分档位/签到口令位数等，需业务口径确认后再上）
- [ ] [待办] 归档自动定期导出（定时任务，需用户需求确认）

## 3. 跨模块事件通信契约 (EventBus Contracts)
- **对外触发事件 (Emits)**：
  - `dev:endpoint-toggled` -> `{ enabled: boolean }`（切换调试端点开关成功后广播，供宿主/其他模块感知）
  - `ui:toast` -> `{ message: string }`（操作结果提示请求宿主渲染）
- **监听外部事件 (Listens)**：无

## 4. ⚠️ 踩坑记录与避坑指南 (Pitfalls & Lessons Learned)
> **[AI 接手铁律]**：任何后续接手修改本模块的 AI 模型，在编写代码前必须仔细阅读下表，严禁推翻已验证的修复方案或重蹈覆辙！

| 编号 | 历史 Bug / 踩坑现象描述 | 根本原因分析 (Root Cause) | 最终验证解决方案与代码禁令 (Mandatory Fix & Rule) |
| :--- | :--- | :--- | :--- |
| #01 | （迁移前史）POST `/api/dev-access` 携带中文角色头被 fetch 拒绝 | HTTP 头仅允许 ASCII，中文角色名直接放 header 报 `ByteString` 错误 | 请求头角色一律 `encodeURIComponent` 编码，服务端 `decodeURIComponent` 解码；**严禁**在请求头直写非 ASCII |
| #02 | （迁移前史）curl 直测 403 误判为权限逻辑错误 | Windows curl 对中文 header 的编码与浏览器不一致，服务端收到乱码 | 权限类接口联调必须用浏览器/node fetch（与生产同路径）验证；curl 仅作状态码初筛 |
| #03 | （迁移前史）切换开关后页面刷新状态回跳 | 状态渲染依赖首次挂载时的一次性 fetch，切换后未重绘 | 切换成功后必须调用 `renderDevStatus(container, result.enabled)` 重绘开关 `aria-checked` 与入口行 `hidden` |
| #04 | 2026-10-21 用户按界面提示访问 `127.0.0.1:8080/dev1` 得到外部服务 401"界面不正常" | 调试端点说明文案**硬编码 8080 端口**；本机 8080 被其他服务占用时 Start.bat 自动改用 8081，实际端口与文案不符 | 端点地址一律运行时取 `location.host`（现由 `.dev-entry` 按钮点击 `window.open` 直达，地址即按钮内容）。**禁令**：模块内严禁硬编码端口/主机名 |
| #05 | 2026-10-21 用户截图反馈：调试端点区"已开启"胶囊与按钮高低不齐、三张说明卡文字堆挤难读，且均为无功能空话 | ① 状态胶囊+文字按钮两控件混排未对齐；② `.admin-tiles/.admin-tile` 类从未在任何 CSS 定义（旧 panels 删除后无承接），卡片裸排；③ 违反零空话原则——说明卡无任何可操作功能 | 全区重做为 iOS 开关（宿主 `.switch` 组件，绿 #34C759 开/灰 #F2F2F7+#D1D1D6 描边关，48×29 滑块 25px 位移 19px，实测 computed style 全对）+ 开启后显示可点击直达 chip（`/dev1`、`/m-dev1`，`window.open` 新标签直达，实测生效）。**禁令**：本模块界面只允许真实功能控件，说明性长文案一律删除（Rules.md §〇.5 零空话铁律） |
| #06 | 2026-10-29 用户与角色管理开发中：账号列表初始渲染搜索框不可见（默认 Tab 即学生本应显示）；且重置按钮 data-i 索引与 accRows 数组错位（students 分支漏 push，教师/管理分支双 push） | ① 搜索框初始写了 `hidden` 属性但未在初次渲染时按当前 Tab 同步显隐；② accRow 用 `accRows.length` 作索引但 push 职责分散在调用方 | ① 初始 HTML 去掉 hidden（学生为默认 Tab）；② push 统一收敛进 accRow 内部（push 后用 length-1 作 data-i）。**禁令**：行内按钮按索引取数据时，索引生成与数组 push 必须在同一函数内闭环，严禁分散两处各自维护 |
| #07 | 2026-10-29 归档端点开发中：multiedit 报成功但 admin-data.js 的 POST /api/admin/attendance-rules 端点与函数收尾大括号被静默删除（node --check 前读回发现） | 长 oldString 编辑时误将后续代码段一并吞掉，工具未报错（mod-academic 踩坑 #06 同类） | 读回复查 + node --check 三件套当场拦截。**禁令**：批量编辑后端路由文件必须立即读回尾部确认结构完整（register 函数闭合/端点数量），node --check 不可省 |

> AI生成
