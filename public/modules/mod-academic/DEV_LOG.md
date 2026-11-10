# 模块开发与交接日志：`mod-academic` (教务管理)

## 1. 模块元数据与架构自检
- **模块路径**：`modules/mod-academic/`
- **挂载插槽**：`#mainViewContent`
- **支持端口**：`pc`（移动端教务管理视图在 `mod-mobile-home` 内实现，双端同步铁律 §〇.8）
- **开放群组**：`教务处`, `IT管理员`（后端 `/api/academic/*` 同步角色校验双保险；2026-10-23 P1 守卫更名教务科→教务处，学生处暂不可访问——其专属模块 mod-student-affairs 后续阶段建设，守卫矩阵拆分见开发计划 §5.1）
- **物理可删除性自检**：[通过] 无跨模块 import（仅 `shared/roles.js` + `shared/api-academic.js` + `shared/leave-wizard.js` 的 openMiniDialog/esc/icon 纯函数）；弹窗复用全局 `.leave-wizard` 样式；样式 `.mod-academic` 前缀；无总线监听；删除后侧栏/landing 自动隐藏入口（registry 过滤），零报错。

## 2. 功能开发进度清单 (Progress & Todo List)
- [x] 2026-10-29 **C1 班级重命名（教务处=申请化，C1 口径）**：学生管理选中班级时头部新增「申请重命名」按钮（IT 登录时为直改「重命名」）→ 弹窗输入新名 → submitRequest('class-rename', {classId, name}) → toast+我的申请刷新；后端第八类申请（教务处→学生处），TYPE_LABEL 已含。移动端同步（教务管理视图）。E2E 实测：PC 提交→申请入队→学生处审批→班级名生效。
- [x] 2026-10-29 晚 **添加教师（用户需求：教务管理→教师管理支持添加）**：教师 pane 左栏新增**「+ 添加教师」虚线框按钮**（复用全局 .aca-folder-add，置于未分配教师条目下方）；弹窗输入姓名（2–30 字）→ POST /api/academic/teachers → 新教师即时入登录页教职工下拉/未分配教师条目/专业部编辑勾选/授课分配（teachers 表动态化，TEACHERS 常量退役）。移动端 mod-mobile-home 教师管理头部同步（双端铁律）。实测：教务处添加"王芳"→未分配教师 5→6→登录下拉出现并可登录（群组=教师）。
- [x] 2026-10-24 **P2 守卫矩阵重构（后端 academic.js，开发计划 §5.1；C1 口径：教务处写操作全部走申请）**：单一 guard 拆为三函数——guardRead（教务处/学生处/IT）/guardWrite（学生处/IT；**教务处调写端点 403 引导文案"仅学生处/IT管理员可直接修改学生数据，教务处请提交申请"**）/guardTeacher（教务处/IT，C2 教师管理留教务处直改）；TEACHERS 常量外移 `src/core/consts.js` 单源；ALTER 注入 students.score（默认 100）/classes.major_id 两新列；readRole/readName 换 `src/core/http-utils.js` 共享。⚠ **前端中间态（P4 前已知）**：教务处用户界面写入口（新建班级框/编辑/解散）仍渲染，点击将收 403 toast 引导文案——申请化 UI 改造属 P4；学生处班级管理界面属 P4 mod-student-affairs。实测：curl 8 用例全过 + 浏览器教务处读渲染正常 + 写提交 403 toast 文案正确
- [x] 2026-10-23 **P1 角色更名联动（开发计划 §2）**：manifest/index.js 头注释/后端 academic.js 守卫与注释更名教务科→教务处（ACADEMIC = ['教务处','IT管理员']，403 文案同步）；功能零变化（守卫矩阵重构属后续阶段 §5.1）。实测：教务处登录→教务管理正常挂载（班级夹/学生列表渲染）；学生处/旧“教务科”访问 API 均正确 403
- [x] 2026-10-23 午 **弹窗间距修复 + 未分配移出容器**（用户截图实锤两需求）：① 编辑弹窗节奏断裂修复——实测 tabs→label 与 label→list 均 **0px 贴死**（根因：旧 `.aca-tabs` 有 `margin-bottom:12px`，重构为 `.segmented.aca-dlg-tabs` 时丢失；`wizard-label` 无 margin），修复 `.aca-dlg-tabs` margin-bottom 10px + `.aca-pane > .wizard-label` margin-bottom 8px，复验节奏 10/10/10/8/10 双端统一（视觉模型"说明文字与Tab间距40px偏大"系误报，实测 10px 正常，按 §7.6.3 事实源原则判定）；② 左栏布局重构——「未分配」移出灰蓝容器（`#acaFolders`），独立白底描边条目（`.aca-un-row`）置于容器下方（容器内仅自建班级 + 新建班级虚线框；`#acaUnRow` DOM 静态不重建仅同步 active/计数，事件 mount 时绑一次防叠加；`.aca-left` 包裹 flex column gap 10px）- [x] 2026-10-23 **「新建班级」入口迁移 + 编辑弹窗三栏重构**（用户需求，口径经提问确认：虚线框按钮直接更名/批量添加合并进编辑弹窗/Tab 设计与登录页 login-tabs 一致）：
  - 移除学生管理标题行右上角「新建班级」按钮（section-tools 整体删除）；功能迁至左栏文件夹列表底部**蓝色虚线框「+ 新建班级」**（原「+ 添加学生」位置，全局 `.aca-folder-add` 样式，**常驻显示含未分配态**——原添加学生仅选中班级时出现）
  - 「编辑」弹窗重构为**三栏 segmented Tab**（添加学生/批量添加/移除学生；`.segmented.aca-dlg-tabs` 宿主全局样式，与登录页 login-tabs 同款 active+aria-selected+pane hidden 交互）：添加=勾选未分配加入；批量=textarea 学号（兼容中文逗号/顿号/空格）；移除=红色警示勾选移出；三 Tab 统一提交 POST members（removeIds + addIds 去重合并，无效学号由后端 400 拦截 toast 明细）
  - 原「添加学生」独立弹窗退役（其"勾选加入"与编辑弹窗重复，用户确认）；空态文案"点击「编辑」勾选学生加入"、新建班级弹窗文案"创建后可通过「编辑」勾选学生划入"同步更新
  - 双端实测通过：新建班级弹窗/三 Tab 切换 aria/computed/统一提交（移出学生001+批量加入学生006 一次生效后反向还原）/§7.6 截图审查（主页面+弹窗 add/remove 态）/样式表 cssRules 吞规则复查（components 191 条全解析、mod-academic 36 条首规则正常）/双端控制台零错误
- [x] 2026-10-22 深夜 **全平台 UI 纠正审计通过**（Rules.md §7.6 SOP）：PC 教务科（segmented 主滑块/双栏列表/班级编辑弹窗勾选态/解散弹窗必填红框）+ 移动端教务管理视图（segmented+红色移出态）截图审查 + style.css cssRules 吞规则复查（31 条规则全解析，§〇.10 ①② 复核无复发）+ 控制台零错误；零缺陷一次通过
- [x] 2026-10-22 夜 **班级编辑与解散**（用户需求，口径经提问确认：集中弹窗/学生区头部按钮/解散必填原因）：
  - [x] 编辑：学生区头部「编辑」按钮（仅选中自建班级时出现）→ 弹窗集中管理——上半区「当前学生 N 人（勾选将移出）」红色警示态勾选行（红边框+浅红底+红色勾选）+ 下半区「未分配学生 N 人（勾选将加入）」→ 保存统一提交（后端 `POST /classes/:id/members` 事务：removeIds 回未分配 + addIds 划入，空提交 400 拦截）→ toast「已保存：移出 X 人、加入 Y 人」
  - [x] 解散：学生区头部「解散」按钮（danger 红）→ 确认弹窗明示「N 名学生还原为未分配、教师授课关联同步清除、不可恢复」+ **解散原因必填**（空提交红框拦截）→ 后端 `POST /classes/:id/dissolve` 事务（学生回未分配 + 清 teacher_classes + 删班级；原因写入服务器日志留痕）→ 成功后 folder 重置回未分配视图
  - [x] 移除原待办「班级重命名/删除、学生移出」中的删除/移出部分（已实现；仅重命名仍待办）
- [x] 2026-10-22 夜 **主切换滑块重构**（用户需求：box 嵌套 box + 顶部切换，与登录页同款交互）：由竖向双 section 改为**单 section-card 容器**——顶部 `.segmented .aca-main-tabs` 胶囊滑块（复用宿主全局 segmented 骨架，与学生/教职工登录切换同款：active 白色浮起 + aria-selected）切换「学生管理/教师管理」两面板（`.aca-pane-box` + `[hidden]` 显隐配套规则，box 嵌套 box：pane 内含 section-header/双栏/flow-foot）；移动端同步换 segmented（见 mod-mobile-home）
- [x] 2026-10-22 教务管理上线（后端 `src/api/academic.js`：students/classes/teacher_classes 三表 + 100 名学生种子 9 位学号 000000001–000000100，leaves 旧 3 位学号自动迁移 9 位）：
  - [x] 学生管理：左侧分类夹（未分配 + 自建班级，含人数）切换；右侧学生列表（姓名 + 9 位学号）
  - [x] 新建班级：弹窗自由输入名称（唯一性校验）→ 创建后自动切到新夹
  - [x] 添加学生弹窗（选中班级夹时左侧出现「+ 添加学生」）：**双 Tab**——「添加」（未分配学生勾选列表，可多选）与「批量添加」（textarea 输入 `000000001,000000002` 学号+英文逗号格式，兼容中文逗号/顿号/换行/空格分隔）
  - [x] 教师管理：教师卡片（教师01/教师02）单击展开 → 授课班级 chips 多选 → 保存（整体替换 teacher_classes）
  - [x] 权限闭环：教师 GET /api/leaves 仅返回其授课班级学生的请假信息（见 leaves.js）；教师 GET /api/academic/my-classes 返回班级+学生名册+各自请假记录（复用 parseRow 契约，见踩坑 #03）
  - [x] 2026-10-22 全链路实测通过：API 级（班内学生提交→审批→销假，教师全程可见；班外学生 050/未分配学生 005 提交，教师不可见；教务科全量可见）+ PC 浏览器（教务管理渲染/批量添加/教师分配）+ 移动端浏览器（mod-mobile-home 同功能视图，见其 DEV_LOG）
  - [x] 2026-10-22 深夜 **CSS 全量丢失修复**（用户截图实锤裸排）：双因叠加——① manifest.json 缺 `entry`/`style` 字段（前置 Agent 截断遗留，plugin-loader 仅在 manifest.style 声明时才注入样式 link，JS 走默认 entry 正常挂载故模块能渲染但零私有样式）；② style.css 头部注释内 `section-*/` 的 `*/` 序列提前闭合注释，CSS 解析器错误恢复把紧跟的 `.aca-split` 主规则整条吞掉（双栏布局失效，其余规则恢复解析）。修复后实测：样式 link 注入且加载、规则数 31→32、split display:grid 双栏 220px+1fr、文件夹/学生卡/教师卡/弹窗全部样式化，视觉审查通过（学生管理双栏/添加学生弹窗 Tab 胶囊/教师展开 chips 蓝色选中）；全项目 grep 确认同类注释隐患仅此一处，其余 7 模块 manifest 字段齐全
- [x] 班级重命名（解散/移出/加入已实现；2026-10-29 C1 交付：IT 直改+教务处 class-rename 申请）
- [x] 教师账号扩容（2026-10-24 已交付：teachers 表动态化+添加教师）

## 3. 跨模块事件通信契约 (EventBus Contracts)
- **对外触发事件 (Emits)**：
  - `ui:toast` -> `{ message }`（操作反馈）
- **监听外部事件 (Listens)**：无

## 4. ⚠️ 踩坑记录与避坑指南 (Pitfalls & Lessons Learned)
> **[AI 接手铁律]**：任何后续接手修改本模块的 AI 模型，在编写代码前必须仔细阅读下表，严禁推翻已验证的修复方案或重蹈覆辙！

| 编号 | 历史 Bug / 踩坑现象描述 | 根本原因分析 (Root Cause) | 最终验证解决方案与代码禁令 (Mandatory Fix & Rule) |
| :--- | :--- | :--- | :--- |
| #01 | openMiniDialog 只代理 `data-act` 按钮；Tab 切换/勾选等自定义交互无响应 | 共享弹窗的 click 委托只回传 data-act 按钮 | 弹窗创建后手动绑定自定义控件（Tab 按钮/checkbox/chips），与移动端同意弹窗同一模式。**禁令**：openMiniDialog 的 rawBody 内自定义控件一律返回后手动绑定，禁用 data-act 之外的委托假设 |
| #02 | 学生列表人数与班级夹计数不同步 | classes.count 由后端 GROUP BY 统计，添加学生后需刷新 | 任何 addStudentsToClass/createClass/setTeacherClasses 成功后必须调 `reload()`（并发 fetchStudents+fetchClasses+teachers），严禁只改本地数组 |
| #03 | 2026-10-22 实测 my-classes 返回的 leaves 前端 fmtRange 显示 `? ~ ?` | my-classes 初版直接 `SELECT * FROM leaves` 透传原始行（snake_case），与 /api/leaves 的 parseRow camelCase 契约不一致 | leaves.js 导出 `parseRow`，本文件 import 后 my-classes 的 leaves `.map(parseRow)` 统一契约。**禁令**：新增返回 leaves 行的端点必须复用 parseRow，严禁透传 SQLite 原始行 |
| #04 | 2026-10-22 用户截图实锤：教务管理整页 CSS 丢失——文件夹/学生列表/教师卡全部浏览器原生裸排，且班级名与人数粘连（“计算机23015”）；但外层 section-card 骨架正常 | **双因叠加**：① manifest.json 缺 `entry`/`style` 字段（前置轮次截断遗留）——plugin-loader 仅 `if (manifest.style)` 才注入样式 link，entry 走默认值放行 JS，造成“模块能挂载但零私有样式”；② 修完 manifest 后仍发现 `.aca-split` 主规则消失（样式表第一条规则直接是 @media）——style.css 头部注释里 `section-*/flow-*/chip-row/` 写法中 `*/` 序列**提前闭合了 CSS 注释**，其后内容成非法 token，解析器错误恢复把紧跟的 `.aca-split { display:grid }` 整条规则吞掉（其后规则恢复解析，故只有双栏布局失效而其他样式“看似部分生效”——修复前裸排实因 ①，②是叠加隐藏雷） | ① manifest.json 补全 `entry`/`style` 字段（与其余 7 模块对齐，收尾必须全量比对 manifest 完整性）；② 注释内通配符列表改为 `section-* / flow-*`（星号与斜杠间加空格），并在文件头加固警示注释（警示语本身也严禁包含字面 `*/` 序列）。**禁令（三条）**：a. CSS 注释内严禁出现连续字符序列“星号紧跟斜杠”，通配符列举一律 `xxx-* / yyy-*` 带空格写法；b. 新模块 manifest 必须含 entry+style 双字段并与其他模块 diff 比对；c. 排查此类问题必须查 document.styleSheets 的 cssRules 数量与首条规则（而非仅看 link 是否 404），规则数缺失即存在解析吞规则 |
| #05 | 2026-10-22 编辑弹窗开发后视觉审查实锤：移动端勾选“移出行”无红色警示态（仅蓝色勾选），PC 端正常 | `.aca-pick-row.out` 红色态规则初写在 `mod-academic/style.css`（带 `.mod-academic` 前缀），但移动端编辑弹窗渲染在 `mod-mobile-home` 内，前缀不命中 | 该规则下沉宿主全局 `core/css/components.css`（弹窗内件归属，与 aca-input/aca-tabs 同类先例）；实测双端红边框+浅红底生效。**禁令**：弹窗（openMiniDialog rawBody）内使用的类必须定义为宿主全局样式，严禁写在某模块前缀下（弹窗可能被任意模块/端点打开） |
| #06 | 2026-10-23 重构编辑弹窗时，multiedit 报告 8 处编辑全部成功，实际 2 处未正确落盘：PC 端旧版 `openEditClass` 残留 → 同作用域**重复 const 声明**（模块 SyntaxError 根本无法加载）；移动端 `openAcaEditClass` 完全未替换（仍是旧版双板块结构） | oldString 与文件实际内容存在细微出入（凭记忆补写了文件中不存在的 `return dlg;` 行；unicode 转义中出现错字）。长 oldString 部分匹配失败时工具未可靠报错，造成“报成功、实未改”的静默失败 | **禁令（三条）**：a. multiedit/批量编辑后**必须立即读回文件复查**关键段落 + `node --check` 语法校验 + grep 验证目标特征（函数唯一定义、新类名/新文案存在、旧标识零残留）；b. 长 oldString 一律从**刚读取的原文逐字复制**，严禁凭记忆拼装（尤其函数结尾 return 语句）；c. 发现“报成功实未改”时，用单个 edit 以刚读回的真实内容为 oldString 重新替换，再复验 |
| #07 | 2026-10-23 用户截图实锤编辑弹窗"间隔不一致看着别扭"；视觉模型初判"说明文字与 Tab 间距 40px 偏大" | rect 实测证伪视觉模型（text→tabs 实为 10px 正常）；**真凶是 tabs→label=0px 与 label→list=0px 双贴死**——重构 `.aca-tabs`→`.segmented.aca-dlg-tabs` 时只搬了新组件样式，未继承旧组件的 `margin-bottom:12px`（组件替换丢间距属性），`wizard-label` 本身无 margin | `.aca-dlg-tabs { margin-bottom: 10px }` + `.aca-pane > .wizard-label { margin-bottom: 8px }`（components.css 全局），复验节奏 10/10/10/8/10。**禁令**：更换弹窗内组件类时必须 diff 旧组件的全部 margin/padding 并显式继承到新组件；弹窗间距验收一律 rect 实测各相邻元素对，视觉模型目测仅作参考（再次实证误报） |
| #08 | 2026-10-24 晚添加教师功能初版：模块加载即报 `ReferenceError: Cannot access 'openAddTeacher' before initialization`，整个教务管理熔断 | `addEventListener('click', openAddTeacher)` 写在 `const openAddTeacher = () => {...}` 声明之前——const 存在暂时性死区（TDZ），绑定时机即触发求值失败 | 先 `const openAddTeacher = ...` 声明、后 `addEventListener` 引用（本轮已修正落盘）；**禁令**：函数表达式的具名引用绑定必须置于声明之后，或在绑定处直接写内联箭头函数；模块改动后必须 node --check + 浏览器实测挂载（熔断类错误控制台必现） |

> AI生成
