# 模块开发与交接日志：`mod-mobile-home` (手机端工作台)
## 1. 模块元数据与架构自检
- **模块路径**：`modules/mod-mobile-home/`
- **挂载插槽**：`#mobileStage`
- **支持端口**：`mobile`（PC 端口不加载；m-devN 调试端点即为此端口）
- **开放群组**：`学生`, `教师`, `教务处`, `学生处`, `导员`, `IT管理员`
- **物理可删除性自检**：[通过] 无跨模块 import（仅 `shared/*` 共享件：roles / api-leaves / api-academic / leave-wizard / pinyin-util（含 vendor/pinyin-pro 本地副本），见踩坑 #07）；样式 `.mod-mobile-home` 前缀；`unmount` 清除 30s 时钟定时器、解绑 `leave:submitted`/`verify:completed` 总线监听并清空容器；删除后 m-dev 端点显示空手机舞台，PC 端点零影响。

## 2. 功能开发进度清单 (Progress & Todo List)
- [x] 2026-11-03 **批二 S8/S10 双端同步：首页全局搜索 + 待办弹窗「去处理」视图切换（待办清账批二）**：①**首页搜索框**（greeting 下方 40px 胶囊输入）→ debounce 250ms → GET /api/search（shared/api-todo 单源）→ inline 分组结果（学生/班级/教师/课程四组，`.m-search-*`）→ 点击按角色切视图（课程→courses、学生处→sa、教务处/IT→academic，无权限纯展示行）；结果收起+输入清空后跳转。②**todo:goto 监听**（登录待办弹窗[宿主 main.js showTodoDialog]「去处理」→ TODO_VIEW 映射切对应视图：student-leave/counselor-verify→leave、student-affairs→sa、lesson-review/classroom/courses/academic 同名视图），unmount 解绑（todoGotoOff）。实测 m-dev1：教师01 搜「学生」授课班 5 人+「高等」课程跳 courses 视图；学生处登录 in-host 待办弹窗（班级变更申请待审批 1）→ 去处理→sa 视图切换全闭环。
- [x] 2026-10-29 深夜 **C 批次双端同步（与 PC 同任务落地）**：①**C1 班级重命名**——学生处 SA 学生管理「重命名」直改弹窗 + 教务管理视图「申请重命名」/IT 直改（class-rename 申请→学生处审批，E2E 实测：教务处 m-dev1 提交→学生处 SA 待审批→同意→班级名生效）；②**C2 违规流水筛选**（类型×状态六 chips，命中 N/M 文案）+**请假汇总筛选**（姓名/学号搜索+时段范围，状态保值）；③**C3 学生课表日视图**（周/日 segmented + ‹日› 导航 + 课程详情 in-host 弹窗）。
- [x] 2026-10-29 **B1「消息」tab 上线（替代原"开发中"占位 toast，零空话/双端铁律收口）**：底部导航「消息」→真实通知列表（GET /api/notifications 按当前身份受众过滤）——未读蓝点+标题/详情/时间卡片，点选标记已读，「全部已读」按钮，空态引导；导航按钮红底白字未读徽标（挂载时拉未读数，进 tab/标记后刷新）。实测 E2E：教师01 提交加课→教务处 m-dev1 审批同意→学生登录消息 tab 收到「新课通知」未读卡+徽标 1→点选已读→徽标归零。
- [x] 2026-10-29 **B2 课堂管理移动端增强（与 PC 四区面板同能力）**：①**随人提问**（in-host 弹窗学生 chips 网格→开始随机 80ms 轮换高亮 3 秒定格 .picked→结果浮层 ±1/±2/仅记录 chips→pickStudents+scoreStudent）；②**学生名单行内操作**（全名单=名册减三类名单；待签到[记旷课/代签]/已签到[+1/-1]/旷课[撤销旷课]/请假无操作）；③**历史课堂**（ended 会话列表→详情弹窗含事件学生名映射与计数）；④调课审批视图增「审批历史」区（状态胶囊+审批人/驳回原因）；⑤课堂记录详情事件行显学生姓名；修「课堂·课堂」标题重复（courseName 空用 className 兑底）。实测：发起→代签001→记旷课002→+1→随人定格002选+2→结束→历史详情事件全对；控制台零 JS 错误。
- [x] 2026-10-29 **「我的」页修改密码上线（密码体系配套，双端同步铁律）**：个人卡新增「修改密码」按钮（退出登录上方）→ 共享 openChangePasswordDialog in-host 弹窗（三字段）→ POST /api/auth/password；实测 m-dev1 教务处账号改密/改回全闭环 + 学生密码登录。⚠ 实修 host 挂载错误（踩坑 #09：host 必须为 phoneScreen() 而非 container，否则 absolute 遮罩铺满视口越出手机框）。违规登记弹窗分值改动态拉取（fetchViolationRules，A3 考勤规则可配置）；违规 Tab 预警条 warnBelow 改响应字段动态值。
- [x] 2026-10-24 晚 **添加教师同步（与 PC mod-academic 同任务，双端同步铁律；用户需求：教务管理→教师管理支持添加）**：教师管理子视图（renderAcaTeachers）头部新增**「+ 添加教师」虚线框按钮**（复用全局 .aca-folder-add）→ in-host 弹窗输入姓名 → POST /api/academic/teachers → 教师卡列表即时刷新+新教师自动入登录页教职工下拉（teachers 表动态化）。实测 m-dev1 教务处添加"李明"→列表 7 张教师卡+toast 确认。
- [x] 2026-10-24 **P11 移动端全量（开发计划 §11）**：HOME_CARDS 完整卡组（学生+课程/教师+课程课堂/教务处+调课审批课堂记录/学生处+学生管理待审批违规）+五新视图（renderCoursesView[compact 课表横滚 640px+周开关+签到卡+加课/停课 in-host 弹窗]/renderClassroomView[发起+进行中面板+撤销旷课]/renderSAView[三 Tab 直改+审批+违规]/renderLessonReviewView/renderClassRecordsView[列表+详情，修改引导 PC]）+SSE 统一 toast+当前视图刷新（lessonAdded/lessonCancelled/reviewed）；ttHandleMobile（课表红线定时器）与七监听 unmount 全清理；m-dev1 五角色实测全通过、控制台零错误。
- [x] 2026-10-23 **P1 角色更名+学生处壳（开发计划 §2）**：GREETINGS '教务科'键→'教务处'并新增 '学生处': ['早上好，学生处','学生事务与审批']；HOME_CARDS 同步更名，新增学生处条目（P1 保守版仅「请假汇总」卡——零空话铁律：待审批/违规积分等无真实功能的入口不上卡，后续阶段补齐）；教师空态/注释“教务科”→“教务处”；请假汇总视图对学生处自动生效（renderLeaveView 汇总分支）。实测 m-dev1 学生处（问候/角色徽标/职责卡/请假汇总 6 条）与教务处（三卡+教务管理视图）全通过
- [x] 2026-10-23 午 **弹窗间距修复 + 未分配移出容器同步**（与 PC mod-academic 同任务，双端同步铁律）：「未分配」移出 m-aca-folders 灰蓝容器，独立白底描边条目（`.m-un-row`，margin-top 10px）置于容器下方（容器内仅自建班级 + 新建班级虚线框；m-un-row 带 data-f="un" 复用统一 folder 绑定，随 body.innerHTML 重建无重复绑定问题）；编辑弹窗间距修复（全局 `.aca-dlg-tabs` mb 10px + `.aca-pane>.wizard-label` mb 8px，in-host 弹窗同受益），rect 复验节奏 10/10/10/8/10
- [x] 2026-10-23 **教务管理入口迁移与编辑弹窗三栏同步**（与 PC mod-academic 同任务，双端同步铁律）：m-aca-folders 底部虚线框「+ 新建班级」常驻（宿主全局 `.aca-folder-add`，未分配态也显示）；m-aca-tools 工具行精简为「编辑」「解散」（选中班级时渲染，未分配态整行不渲染）；「编辑」弹窗重构为三栏 segmented Tab（添加学生/批量添加/移除学生，in-host，`.aca-dlg-tabs` 全局样式与登录页 login-tabs 同款交互）统一提交 members（勾选+批量学号合并）；原「添加学生」弹窗退役；新建班级弹窗文案同步。实测：三 Tab 切换 aria/computed（active 白底浮起 rgb(255,255,255)+蓝字+flex 均分）、截图审查（弹窗无溢出手机框）、新建班级弹窗打开正常、控制台零错误
- [x] 2026-10-22 深夜 **全平台 UI 纠正审计通过**（Rules.md §7.6 SOP）：移动端 4 角色截图审查 + 控制台零错误——学生（请假列表+向导 in-host 弹窗）/教师（今日/历史双板块+拼音搜索+分页）/教务科（segmented 滑块+班级编辑弹窗红色移出态+解散）/导员（审批+同意/拒绝弹窗）；零缺陷一次通过
- [x] 2026-10-22 夜 班级编辑与解散同步（与 PC mod-academic 同任务，双端同步铁律）：学生管理工具行（选中班级时）新增「编辑」「解散」按钮——编辑弹窗（in-host：当前学生勾选移出红色警示态 + 未分配勾选加入 → 保存统一提交）；解散弹窗（必填原因，红框拦截空提交 → 确认后学生回未分配、班级夹消失、视图回未分配）；API 走 shared/api-academic updateClassMembers/dissolveClass
- [x] 2026-10-22 夜 教务管理主滑块同步（与 PC mod-academic 同任务）：教务管理视图顶部切换由自定义 `aca-tabs .on`（蓝边胶囊）换为**宿主全局 `.segmented` 骨架**（`m-aca-tabs`，active 白色浮起+aria-selected），与登录页学生/教职工切换同款交互
- [x] 2026-10-22 深夜 同步 PC 第四轮迭代（双端同步铁律）：今日括号 `（今日请假<b>x</b>人）`（800 加粗深色+数字蓝色）；历史板块显示班级内**全部学生**（0 次也显示“共请过 0 次假”，灰显 disabled 不可展开）；气泡近 3 天全状态蓝底白字“近期请过假” + rejected 红底白字“有被驳回记录”（`.m-tl-bubble.blue/.red`）；判定 withinRecentDays 共用 shared/leave-wizard
- [x] 2026-10-22 **教务管理与教师班级双端同步**（与 PC mod-academic / mod-student-leave 同任务落地，Rules §〇.8）：
  - [x] 教师移动端「我教的班级」：请假 tab 顶部班级卡（可展开/收起，`.m-tc-*`）——班级名+人数，展开显示学生名册（姓名+9位学号+各自请假记录状态胶囊+时段）+ 下方权限过滤后的请假卡片列表；未分配班级时显示“请联系教务科分配”空态（**2026-10-22 晚已被双板块替换**，见下）
  - [x] 教务科/IT 移动端「教务管理」视图（首页功能卡入口）：顶部 学生管理/教师管理 Tab 切换；学生管理=班级分类夹（未分配+自建，含人数）+新建班级弹窗（自由命名）+添加学生弹窗（双 Tab：勾选添加/批量文本添加，与 PC 同功能）+学生列表（前 60 名+总数提示）；教师管理=教师卡展开授课班级 chips 多选+保存
- [x] 2026-10-22 晚 **教师请假中心双板块**（与 PC mod-student-leave 同任务重构，双端同步铁律）：教师请假 tab 完全替换为「今日请假 / 历史请假」分页夹（`.m-tl-tabs`）——
  - 今日请假：班级卡（班级名+**（今日请假N人）**加粗+数字蓝色，今日时段内活跃请假学生数，已销假/已撤销不计入；无人的班级不显示）→ 展开显示学生（姓名+9位学号+三态胶囊，复用 `.m-tc-card` 骨架）
  - 历史请假：班级内全部学生（含 0 次）+搜索框（姓名/学号/拼音全拼/首字母，`shared/pinyin-util.js`）+ 按学生聚合（“共请过 N 次假”+气泡）+ **每页 10 人分页** + 有记录学生单击展开细则（六态原样胶囊+时段）；0 次学生不可展开（灰显无箭头）
  - 三态映射/今日判定从 `shared/leave-wizard.js` 导入（teacherPill/ACTIVE_TODAY/todayStr/coversToday），与 PC 共用
- [x] 2026-10-22 销假双端同步（与 PC 同任务落地，Rules §〇.8）：
  - [x] 导员同意弹窗：销假询问开关（不需要/需要）+ 凭证勾选芯片（拍照/签名，复选样式）+ requireReturn 提交
  - [x] 学生销假：approved 且带要求→卡片提示条+销假按钮→共享件 `openReturnDialog` in-host 模式（按需渲染照片上传/签名板，拍照 input 带 capture=environment 调用相机）→ completed 绿色胶囊+销假时间
- [x] 2026-10-21 晚「请假」tab 双端同步上线（Rules §〇.8）：
  - [x] 学生全流程：请假列表卡片（状态胶囊/时段/事由/回复）+ 发起申请（共享向导 `shared/leave-wizard.js` **in-host 内嵌模式**：遮罩 absolute 定位于 .phone-screen 内，向导/滚轮选择器/签名板全部在手机框内）+ 撤销（必填理由）/编辑/继续编辑/新申请冲突提醒/拒绝回复弹窗（未读自动弹）
  - [x] 导员审批：同意（确认弹窗）/拒绝（必填理由）；学生 editing 状态→按钮禁用+提示
  - [x] 教师（今日/历史双板块，同上）/教务科/IT管理员：只读视图
  - [x] 首页功能卡片全部真实跳转（发起请假→请假 tab+自动开向导；我的请假→请假 tab）；删“请假流程功能开发中”占位文字与无功能卡片（零空话铁律）
- [x] 正式请销假移动视图（移除原型的打卡/拍照假条/补卡审批/星辰 AI 等未启用交互）
- [x] 按角色问候语 + 职责卡 + 功能入口卡片（五角色分级）+ 底部导航（首页/请假/消息/我的）
- [x] 「我的」个人中心页（logo 头像+姓名+角色徽标+修改密码+退出登录）
- [x] 时钟定时器/总线监听 unmount 清理；m-dev 端点锁定手机视图
- [x] 2026-10-29 **UI 审查**：消息页（卡片/蓝点/全部已读/导航徽标对齐）+ 课堂详情弹窗（in-host 无溢出/事件列表对齐）截图审查通过；随人弹窗/行内按钮 rect 核验；控制台零 JS 错误（唯一 ERROR 为系统休眠期间 SSE ERR_NETWORK_IO_SUSPENDED，EventSource 自动重连，非应用缺陷）

## 3. 跨模块事件通信契约 (EventBus Contracts)
- **对外触发事件 (Emits)**：
  - `verify:completed` -> `{ leaveId, conclusion, verifiedBy }`（导员在移动端审批后广播，供同会话其他模块刷新）
  - `leave:submitted` ->（由共享向导发出，本模块无直接触发）
  - `ui:toast` -> `{ message }`（向导/弹窗操作反馈；本地 toast 函数仍是兑底，见踩坑 #04）
- **监听外部事件 (Listens)**：
  - `leave:submitted` / `verify:completed` / `leave:returned` -> 刷新「请假」视图（解绑引用 leaveOff/verifyOff/returnOff，unmount 中调用）

## 4. ⚠️ 踩坑记录与避坑指南 (Pitfalls & Lessons Learned)
> **[AI 接手铁律]**：任何后续接手修改本模块的 AI 模型，在编写代码前必须仔细阅读下表，严禁推翻已验证的修复方案或重蹈覆辙！

| 编号 | 历史 Bug / 踩坑现象描述 | 根本原因分析 (Root Cause) | 最终验证解决方案与代码禁令 (Mandatory Fix & Rule) |
| :--- | :--- | :--- | :--- |
| #01 | （迁移前史）m-dev 点击「星辰 AI」后跳回 PC 视图 | 旧 mobile.js 导航回调里调用 `setViewMode('pc')`，且 main.js 装配后无条件执行 `setViewMode('pc')` | 本模块严禁调用任何视图切换 API；视图锁定职责归宿主（`routeMode().mobile` 时锁定 mobile）。旧原型相关交互已全部移除 |
| #02 | （迁移前史）手机端出现"极速打卡""补卡审批"等未上线功能入口 | 复用了原型演示 HTML，包含大量未启用交互 | 移动端界面只保留请销假业务元素；未启用功能一律不渲染，开发中的仅 toast 提示。**严禁**搬运原型演示交互进正式模块 |
| #03 | 时钟 setInterval 在模块反复挂载后叠加，页面卡顿 | 旧实现 setInterval 无清理路径 | 本模块唯一全局定时器必须 `clockTimer` 持引用并在 `unmount` 中 `clearInterval`；新增定时器同样必须走此模式 |
| #04 | 模块内直接操作 `#toastRegion` 全局节点渲染提示 | toast 为宿主全局组件，模块直接操作破坏隔离 | 迁移期暂保留本地 toast 函数（宿主暂未监听 `ui:toast` 时兜底）；宿主实现后必须改 emit `ui:toast` 并删除本地实现 |
| #05 | 2026-10-21 晚用户反馈：移动端长期只有"开发中"占位，请假功能只在 PC 实现 | 违反双端同步铁律（Rules §〇.8）——只做一端就交付 | 已补齐移动端全流程（共享向导 in-host 模式 + 导员审批 + 汇总）；**禁令**：新功能开发必须在同一任务内落地双端，移动端不得长期保留"开发中"占位 |
| #06 | 向导/弹窗若用 fixed 遮罩会覆盖整页 PC 视口而非手机框 | 移动端组件需限制在 .phone-screen 容器内 | 共享向导/弹窗支持 `inHost` 模式：`.leave-wizard.in-host { position:absolute }` 挂在 .phone-screen（已 relative+overflow:hidden）内，视觉与交互全部限制在手机框内 |
| #07 | 2026-10-22 实测 m-dev1 登录后手机工作台**整体空白**，控制台报 `mod-mobile-home 挂载失败已熔断： ReferenceError: routeMode is not defined`（index.js:58） | 前一开发轮次给本模块补写教务管理/我教的班级代码时，**漏写了全部 import 语句**（routeMode/currentRole/currentName/ROLE_NOTE/logout/roles、esc/statusPill/fmtRange/icon/openMiniDialog/openLeaveWizard/openRevokeDialog/openReplyPop/openReturnDialog/leave-wizard、fetchLeaves/leaveAction/api-leaves、fetchMyClasses 等 7 个 api-academic 函数）；因截断未及移动端浏览器验证而未暴露 | 文件头部补齐 4 行完整 import（roles/leave-wizard/api-leaves/api-academic）；实测 m-dev1 登录后模块挂载成功、教师/教务科双视图渲染正常。**禁令**：新增使用共享件函数的代码后，收尾前必须 grep 校验文件顶部 import 覆盖所有外部标识符，且必须在移动端实际加载验证（console 零熔断告警）才能交付 |
| #08 | 2026-10-22 实测移动端班级卡点击后**永不收起**（内容一直显示，仅箭头旋转） | `.m-tc-body { display:flex }` 显式声明优先级高于 UA 对 `[hidden]` 的 display:none，hidden 属性被覆盖（与 mod-login 踩坑 #06、mod-student-leave 踩坑 #11 同源） | style.css 补 `.mod-mobile-home .m-tc-body[hidden] { display: none; }`；实测展开 flex/收起 none 双向正确。**禁令**：凡显式设 display 的元素用 hidden 控制显隐，必须配套 `[hidden]` 覆盖规则，验证必须查 getComputedStyle().display |
| #09 | 2026-10-29 密码体系实测：「我的」页修改密码弹窗**铺满整个浏览器视口**（rect 1021×850），越出手机框（手机壳仅 372px 宽），in-host 类名存在但未生效 | 弹窗 host 传了 container（#mobileStage）；`.leave-wizard.in-host { position:absolute }` 的定位祖先是**最近的 positioned 元素**——#mobileStage 无定位，遮罩最终锚到视口；项目内其余 in-host 弹窗全部传 phoneScreen()（.phone-screen 有 position:relative+overflow:hidden） | host 改为 `phoneScreen()`；实测弹窗 rect 371×789 完全收敛手机框内 + 截图审查通过。**禁令**：移动端 in-host 弹窗 host 必须传 phoneScreen()（定位容器），严禁传 #mobileStage 或 container |
| #10 | 2026-10-29 C1 开发中发现：**整个学生处视图（renderSAView/mSaEdit/mSaDissolve/mSaNewClass/mSaAddViolation 约 160 行）在 B 批次课堂视图批量替换时被静默吞掉**——文件语法合法（node --check 不报）、showView('sa') 将 ReferenceError，且因 B 批次测试未覆盖 SA 视图而未暴露 | 对 1500+ 行大文件做长 oldString 整段替换时，替换边界外的相邻函数块可能被一并吞掉而工具报成功（multiedit 静默失败第 N 次实锤）；语法校验无法拦截"合法但缺失" | 依据编辑前读取的原文+PC 同构交互重建全部函数，并 grep 函数清单（function \w+）与 showView 引用逐项核对。**禁令**：对本文件做整段替换后，必须立即 grep 全部函数定义并与视图切换/卡片入口引用清单比对；新增视图函数必须当轮浏览器实测挂载 |
| #11 | 2026-10-29 同轮发现：A3 考勤规则改造中 GET /api/violations 的 multiedit 四段编辑仅部分落盘——处理头部仍用旧 POINTS 常量而尾部已用新 rules 变量，运行时 500「POINTS is not defined」，且因测试脚本对 500 响应的 violations||[] 兑底而静默漏检 | 同 #10 静默失败；且测试断言未检查 HTTP 状态码 | 修复后 API 直测 200；**禁令**：API 冒烟脚本必须断言 res.status，禁止仅读 json 字段兑底 |
| #12 | 2026-10-29 截图审查+Range 双行盒实证：SA 三 Tab「学生管理/违规积分」文案**换行成两行**（宿主 .segmented button 默认内距在手机三分栏 63px 宽内容不下 4 汉字） | P11 遗留；视觉模型报对但按 §7.6.3 先用 computed 复核（Range.getClientRects 双行盒实锤） | `.m-sa-tabs button { padding: 0 4px; white-space: nowrap }`；复验三 Tab 全部单行盒。**禁令**：手机端三分栏以上 Tab 必须验证文案单行（Range 行盒数），禁依赖视觉模型口头判断 |

> AI生成
