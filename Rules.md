# Rules.md — 项目全局架构宪章与 AI 跨模型交接控制中心

> **[AI 接管最高指令 / CRITICAL MANDATE FOR AI AGENTS]**
> 当你被要求读取本文件（`Rules.md`）时，意味着你正在接管或参与一个遵循**"微内核宿主 + 垂直切片插件化 + 双层文档状态机"**架构的项目。
>
> **你的立即响应协议（Immediate Action Protocol）：**
> 1. 完整解析本文件中的【架构红线】、【标准作业程序 (SOP)】、【全局模块注册与进度总表】及【全局 EventBus 事件通信字典】。
> 2. 如果用户仅指示"请读取 `Rules.md`"而未下达具体编码任务，请简明回复：
>    - "✅ 已读取并对齐 `Rules.md` 全局规范与当前项目状态。"
>    - 列出底部《全局模块注册与进度总表》中当前的模块概况与待办进度。
>    - 询问用户："请指示接下来需要【新建哪个功能模块】或【继续开发/调试哪个现有模块】（我将先读取对应模块文件夹下的 `DEV_LOG.md` 再开始工作）。"
> 3. **严禁在未读取目标模块 `DEV_LOG.md` 的情况下修改任何现有模块代码；严禁在完成代码修改后不更新 `DEV_LOG.md` 和本文件底部的进度总表。**

---

## ⚡ 新会话快速上手（新接手 AI 必读，30 秒版）

**这是什么**：智考通（高校考勤与教务一体化系统：请假审批/课表调课/课堂签到随人/违规积分，六角色+双端+SSE 实时）——Fastify + SQLite 后端（`server.js` + `src/`）+ 纯前端插件化 UI（`public/`，13 模块微内核）。PC 与手机双端同构（`/m-dev1` 为手机调试端点，独立登录态）。

**怎么跑**：项目根目录 `start.bat`（或 `node server.js`）；端口见 `data/runtime.json`；健康检查 `GET /api/health`。演示账号：学生=9 位学号 `000000001`–`000000100`；教职工下拉**动态**（默认教师01/教师02/教务处/学生处/导员/IT管理员，随「添加教师/生成模拟数据」自动扩展，见 §〇.2）。

**完整项目说明**：`开发计划/软件描述.md`（52KB，六部分：功能总览/架构设计/核心算法/功能明细/业务规则/**接手者指南**含 51 端点 API 速查与字段级表结构）——想全面理解项目或接手开发时优先阅读，本文（Rules.md）仍是改码纪律与踩坑的唯一权威。

**动手前 4 步（强制）**：
1. 读本文件：§〇 铁律 1–10（尤其 §〇.8 双端同步、§〇.9 需求先问、§〇.10 CSS/manifest 完整性）+ §七 UI 设计规范（新 UI 必须在规范内取值）+ §六 总表看进度。
2. 不熟悉项目全貌时先读 `开发计划/软件描述.md`（功能/架构/算法/API 速查/表结构，含接手者指南）。
3. 读目标模块 `public/modules/mod-*/DEV_LOG.md` 的【踩坑表】——那是前人踩过的雷，跳过会重蹈覆辙。
4. 向用户复述需求理解，疑点先问（§〇.9）。

**收尾 4 步（强制）**：改完 → 双端浏览器实测（PC + `/m-dev1`）→ §7.6 UI 审查（截图+computed 双核验）→ 更新 DEV_LOG 与本文件总表。

**高频雷区速记**：显式 display + hidden 必须配套 `[hidden]` 规则；CSS 注释内严禁"星号斜杠"连写；manifest 必含 entry+style；弹窗内样式必须归宿主全局 components.css；后端返回 leaves 一律走 parseRow；PowerShell 变量禁止大小写同名（$B/$b 同一变量）；字重视觉验收以 getComputedStyle 为准；**SQLite WAL 模式严禁多进程共用库时做文件级备份/恢复**（主文件+残留 WAL 重放会覆盖恢复结果——2026-10-24 实锤，恢复须停全部持有库的进程并连带清理 -wal/-shm，或改用 SQLite 在线事务搬运）；**带 backdrop-filter/transform/filter 的容器会为 fixed 定位于孙创建包含块**——从中打开的全屏弹窗 host 必须 document.body（mod-core-nav 踩坑 #04）；**移动端 in-host 弹窗 host 必须传 phoneScreen()**（定位容器），传 #mobileStage 会铺满视口越出手机框（mod-mobile-home 踩坑 #09）；**hidden 赋值方向=不可见**（`= !vis` 取反——mod-survey #05 显隐写反实锤）；**动态候选下拉严禁创建时快照**（惰性求值，交互时实时重算——mod-survey #06）；**compareDocumentPosition 判兄弟前后必须由共同父级调用且参数序正确**（后代组合返回 20 恒假——mod-survey #06）；**多形态 value 空值判定按题型分流**（矩阵对象无 option 键≠空——mod-survey #04）。

**进度快照（2026-11-03 待办清账批二：通知铃铛+待办弹窗+全局搜索交付）**：批二（S6–S12）——①**后端**：新建 `src/api/todo.js`（GET /api/todo/summary 五角色待办计数，口径对齐 landing C4 后端单源：学生/导员=请假 pending+editing[导员绑定班收窄]、学生处=class-*、教务处=调课三类、教师=record-modify 本人课堂、IT 恒空）+`src/api/search.js`（GET /api/search：学生=本班/教师=授课班/管理角色=全校，四组[学生/班级/教师/课程]各限 10，**拼音全拼/首字母后端单源**[直接 import 前端 vendor pinyin-pro 纯 ESM，Node 实测可载]）；②**前端**：mod-core-nav 顶栏**通知铃铛**（未读红徽标+下拉 20 条+单条/全部已读+SSE 全 10 事件实时刷新[实测教务处 API 提交申请→学生处徽标实时 +1]+**sse:reconnected 断线补拉**）+**全局搜索框**（debounce 250ms+竞态序号+分组下拉+按角色权限跳转）+三浮层互斥管理；`shared/todo-dialog.js` 登录待办弹窗（宿主 main.js enterWorkspace 双端挂接；无待办不弹；sessionStorage 身份+端点双维度一次性；PC host=body/移动 in-host phone-screen）+`todo:goto` 事件（PC 转发 nav:goto-module 鉴权/移动 TODO_VIEW 切视图）；mod-mobile-home 首页搜索框+todo:goto 监听；components.css 全局 todo-row 弹窗内件；**mod-landing C4 徽标取数迁移 fetchTodoSummary 后端单源**（旧前端五分支过滤副本+两 import 删除，单源禁令闭环）。③验收：API 冒烟 21/21+双端浏览器全链路（学生/导员/学生处/教师01 四身份：待办弹窗→去处理→模块/视图切换；搜索拼音 xs/学号/分组/跳转；铃铛 SSE 实时+已读归零；复检学生徽标 1 经后端单源正确显示）+§7.6 computed（顶栏 76px 零回归/铃铛 40×40/搜索 320×38 胶囊/12px·600）+双端控制台零 JS 错误；测试数据全清回基线（申请撤回删痕+通知删净+班级 2 不变）。**待继续**：批三（考勤规则扩展+归档自动导出含问卷）→批四（凭证分片上传+教师发起问卷+交叉核验）。

**进度快照（2026-11-03 待办清账批一：登录限流+图形验证码交付）**：应用户问答确认（10 项决策，8 项做/问卷 §6 边界维持，计划文档《待办清账四批次-设计与进度.md》S1–S25）启动四批清账——**批一**：①**后端**（src/api/auth.js）GET /api/auth/captcha 自绘 SVG 图形验证码（4 位去易混淆字符+干扰线+噪点，零外部依赖；token 5 分钟过期+一次性消费）；POST /api/auth/login 增 captchaToken/captchaInput 必填（忽略大小写；错/过期 400）；**仅计失败限流**（内存滑动窗口单 IP 半小时 5 次 401→429，验证码错不计、成功不清零，重启清零）；②**前端** mod-login 双 Tab 加验证码行（双 Tab 共用 token；点击/Enter 刷新；失败自动换新）+ api-auth.js fetchCaptcha/loginAccount 扩参；③验收：冒烟 10/10+限流 4/4+重启解锁 PASS+PC 与 /m-dev1 双端全链路（刷新/错码/登录闭环）+§7.6 computed（116×42 同高/uppercase/14px 节奏）+控制台零 JS 错误。服务为本会话后台自启（8081，注册表管理，限流测试后已重启清零）。**待继续**：批二（顶栏通知铃铛+待办弹窗+全局搜索）→批三（考勤规则扩展+归档自动导出含问卷）→批四（凭证分片上传+教师发起问卷+交叉核验）。

**进度快照（2026-10-31 问卷出题板块重构 S15–S24 全量交付）**：应用户反馈（数字/日期独立题型不合理+需逻辑判断）重构出题体系——①**九类题型**（单选[一键是否]/多选[上下限]/下拉/排序[↑↓]/填空[格式属性 any/number/date/phone/email——原 date/number 题型并入]/多行文本/量表[档位可调+两端标签+radio/star/nps 皮肤，统计出均值]/矩阵[行×列+单选/量表模式]/附件[dataURL≤3]）+「其他」补充填空；②**显示逻辑引擎**（visibleWhen 多条件且/或；来源题限之前的单选/多选/下拉；级联隐藏；服务端环路复检 400；隐藏题不校验必填且答案强制剔除防绕过）；③填写端**实时显隐**（作答变化→级联重算→题目即时出现/消失，双端同规则）；④统计九类适配（均值/矩阵行/排序均位/其他文本聚合/附件计数）+CSV。API 冒烟 v2 **41/41**；双端全链路实测（九类卷创建→发布→填写留校/离校两路径→统计）。⚠ 实修四坑沉淀至 mod-survey DEV_LOG #04–#07（矩阵空值判定/hidden 取反/条件候选惰性求值+索引序/加选项按钮遗漏）。计划文档：`开发计划/问卷出题板块重构-题型与显示逻辑.md`（S15–S24 全绿勾验）。**暂缓**：跳转逻辑/题目引用/选项随机/嵌套条件组（计划 §6）。

**进度快照（2026-10-30 问卷与投票版块 S0–S14 全量交付）**：应用户需求（两轮弹窗确认 8 项口径）新增独立版块——①**后端** `src/api/surveys.js`：3 表+10 端点+3 SSE 事件，投票规则引擎（每人 N 票/可否重复投同项/可否改票/结果可见性四开关），匿名脱敏（明细对任何人不输出），visibility 查看范围（谁发的谁定谁能看），导员双收窄（创建强制绑定班+统计/催填按绑定班），API 冒烟 **79/79**（断言 HTTP 状态码）；②**PC 模块** `mod-survey`（六角色 manifest，四类角色分支：填写/投票/发起/统计）+ 注册链 7 处（registry/NAV_META/FOLDERS/ROLE_ACCESS/icons-vote/sse.js/RESET_TABLES）+ landing 卡；③**移动端** mod-mobile-home renderSurveyView 全功能（填写/投票/统计/催填/创建/发布，in-host 弹窗）；④验收：双端浏览器多角色全链路（学生填写闭环/投票改票/导员统计催填/教务处匿名投票创建发布 CSV BOM 校验/教师受众投票）、§7.6 截图+computed 审查、测试数据全清回基线。⚠ 实修并沉淀：创建表单"加选项"按钮泛选误删行坑（mod-survey #01 专用类禁令）；导员未指定定向时强制收窄绑定班（防全校越权）；催填学生粒度为 class/role 级（notifications 无 student 维度，文案不点名）。开发计划文档：`开发计划/问卷与投票版块-注入式设计.md`（S0–S14 十五阶段含进度锚点）。**暂缓**：教师发起问卷（归课堂板块后期，口径 Q7）、数据归档扩展问卷数据集。

**进度快照（2026-10-29 晚 A 批次：密码体系+系统管理三件套交付）**：应用户指示逐步清偿待办——①**密码体系上线**（后端新建 src/api/auth.js：account_credentials 表 scrypt+随机盐，默认密码 123456，登录改 POST /api/auth/login 服务端校验群组；登录页双 Tab 均加密码框；PC 个人中心/移动端「我的」新增修改密码共享弹窗 openChangePasswordDialog；IT 可在用户与角色管理重置任意账号密码）；②**系统管理三件套**（用户与角色管理：三 Tab 账号清单+搜索+重置；考勤规则配置：settings 表单源 attendance_rules，violations.js 动态消费、学生处/移动端分值同步动态；数据归档与导出：请假/违规/课堂三数据集日期范围查询+CSV 下载 BOM）。验收：API 冒烟 30/30、双端浏览器全链路（错误密码提示/改密闭环/重置恢复/规则保存生效/CSV 导出内容校验）、控制台零 JS 错误。⚠ 实修四坑并沉淀：scrypt 摘要比对 hex/二进制长度不一致恒假（auth.js 修复）；顶栏 backdrop-filter 包含块吞弹窗（mod-core-nav #04）；移动端 in-host 弹窗 host 錯挂（mod-mobile-home #09）；账号列表索引数组漏 push（mod-admin-console #06）。**待继续**：B 批次（移动端消息 tab+课堂/审批/记录增强）→C 批次（班级重命名/筛选/日视图/徽标等散点）。**凭证分片上传与考勤交叉核验经确认暂缓**（前者与 §17 用户确认的不做边界冲突，后者无业务口径）。⚠ 验证服务器为本会话自启（8081 端口，后台注册表管理），用户旧 8084 实例需重启后生效。

**进度快照（2026-10-29 深夜 B 批次：移动端补齐交付）**：①**「消息」tab 上线**（B1）——真实通知列表（按身份受众过滤）+未读蓝点+点选已读+全部已读+导航红徽标，E2E 实测（教师提加课→教务处 m-dev1 审批→学生收新课通知未读卡→标记已读徽标归零）；②**课堂管理移动端完整化**（B2）——随人提问（80ms 轮换 3s 定格→±1/±2/仅记录结果浮层）、学生名单行内操作（记旷课/代签/+1/-1/撤销旷课按状态出钮）、历史课堂+详情（事件显学生名）；③调课审批移动端补审批历史区；④课堂记录移动端详情事件显学生名+修「课堂·课堂」标题重复。实测后测试数据全清（会话/事件/签到/违规/申请/通知/课表行归零，分数还原，数据库回到 10-24 基线+密码体系表）。

**进度快照（2026-10-29 深夜 C 批次：散点增强清账，待办清单全清）**：①**C1 班级重命名**——后端 class-rename 第八类申请（⚠ 顺带实修两颗雷：P2 的 workflow_requests/notifications 建表语句已从源码丢失[新库会缺表]，已恢复幂等建表+旧库 CHECK 约束重建迁移；GET /api/violations 半新半旧拼接体致 500 已修）+ academic rename 直改端点；双端 UI（学生处直改/教务处申请/IT 直改）；②**C2 两处筛选**——违规流水（类型×状态 chips，双端）+ 请假汇总（学生搜索+时段相交范围，双端）；③**C3 学生课表日视图**（周/日 segmented+日导航+课程详情弹窗，双端）；④**C4 首页待办徽标**（五角色各口径）。⚠ 本轮实修重大事故并沉淀：**mod-mobile-home 学生处视图整块（约 160 行）在 B 批次批量替换中被静默吞掉**——靠编辑前读取的原文重建；禁令升级：长文件整段替换后必须 grep 函数清单与视图引用比对。测试数据全清回基线。**至此 2026-10-24 晚列出的全部待办（除两项经确认暂缓）已清零**：暂缓项=凭证分片上传（与 §17 口径冲突）、考勤交叉核验（无口径）。

**进度快照（2026-10-24 晚 系统数据管理三功能交付）**：应用户需求新增——①**初始化**（系统管理→数据管理：17 张业务表+storage 上传文件全部清零，弹窗输入"清空"强确认，不可逆）；②**生成模拟数据**（5 教师（教师01-05）+100 学生（学号 000000001-000000100），幂等）；③**添加教师**（教务管理→教师管理左栏虚线框按钮，自定义姓名；同步移动端）。**教师账号体系动态化**：新增 teachers 表（consts.js TEACHERS 常量退役），登录页教职工下拉改为 GET /api/staff-accounts 动态拉取（roles.js staffAccountToGroup 群组映射——动态教师名归教师群组）；新 API 文件 src/api/admin-data.js（data-status/reset/seed/staff-accounts 四端点，IT 专属守卫）。验收：API 19/19、双端浏览器全链路、演示数据完整。⚠ 本轮实修 WAL 多进程恢复事故（雷区速记末条）：文件级恢复被残留 WAL 重放覆盖，后以事务搬运还原原始演示数据（教师2/学生100分班9/班级2/课表10/请假6/专业部2/导员绑定1——当前数据库基线）。⚠ 用户 8084 实例为旧代码，重启（Stop.bat → start.bat）后 P1–P13 与系统数据管理全部生效。**完整交接文档已就绪：`开发计划/软件描述.md`**（六部分含接手者指南，新会话接手优先读它再读本文件）。

> **前史（2026-10-24 P1–P13 开发计划全量交付）**：角色体系（六角色/教务处申请化 C1/导员绑定收窄 D8）→ 数据层+SSE 三级频道 → 审批引擎七类 → 一期前端（mod-student-affairs）→ 专业部（教师 pane 三件套+班级 chips 课表 D1b+导员绑定 D7）→ 课表（mod-courses+shared/timetable 组件）→ 调课审批（mod-lesson-review）→ 违规积分（旷课 -5/旷寝 -10/预警 60）+耽误课展示（affectedLessons）→ 课堂（mod-classroom+学生签到卡+请假预置）→ 课堂记录三方（mod-class-records+record-modify 确认制+导员课堂状态 Tab）→ 移动端全量（五新视图+in-host 弹窗+SSE toast）→ P12 全链路审计（实修 affectedLessons 时区错位 bug：toISOString 与本地 getDay 混用致日期/星期错位）。13 模块全部注册运行。遗留待办见 §六 总表各模块行。

> **前史（P1–P3，2026-10-23～24）**：P1 角色全量更名（教务科→教务处）+学生处+旧会话迁移（migrateLegacyRole）+switchMain 未注册兜底；P2 数据层 10 表+种子+SSE 三级频道（pub.js/events-global/http-utils/consts 单源）+守卫矩阵（教务处写 403 引导）；P3 审批引擎 workflow.js 七类型策略表+四端点+通知（36/36 用例：提交/审批/驳回必填/409 互斥/撤回/还分事务/耽误课计算；实修 add-lesson execute 教师名误取审批请求头的 BUG——execute 第三参 requester 为准）。

---

## 〇、本项目环境适配说明（智考通 · Tan-Project）

> 本节为宪章在本项目的落地适配层，与正文规范冲突时以正文规范为准。

1. **前端根目录**：本规范正文中 `project-root/` 对应本项目 `public/`（由 Fastify 静态托管，`server.js` 为后端入口）。规范中的 `index.html` 即 `public/index.html`，`core/` 即 `public/core/`，`modules/` 即 `public/modules/`。
2. **用户群组与权限等级映射**：本项目实际角色为 `学生` / `教师` / `教务处` / `学生处` / `导员` / `IT管理员`（定义于 `public/shared/roles.js`，2026-10-23 P1 更名后六角色）。manifest.json 的 `allowedUserGroups` 直接使用上述中文角色值。**权限等级体系（2026-10-21 用户定级，数字越小权限越高；2026-10-23 P1 扩展六角色）**：`IT管理员 0 > 教务处/学生处 1 > 导员/教师 2 > 学生 3`，等级表导出为 `shared/roles.js` 的 `ROLE_LEVEL` / `roleLevel()` / `levelAtMost()`，后续功能鉴权一律引用该表，严禁在模块内另行硬编码等级。教务处属教师阵营（职责为排课与授课班级分配，专属模块开发后挂入 `ROLE_ACCESS['教务处']`）；学生处职责为学生班级管理与变更审批、违规与积分（专属模块 mod-student-affairs 待建，建成前 ROLE_HOME 回落 landing）。
    **登录账号体系（2026-10-21；学号 2026-10-22 升级 9 位；2026-10-23 P1 角色更名+新角色；2026-10-24 教师账号动态化）**：登录页为 Tab 切换式——学生输入**9 位学号 000000001–000000100**（`validStudentId` 校验 `/^\d{9}$/` 且数值 1–100，姓名即学号，群组=学生；旧 3 位学号不再受理，leaves 历史数据已自动迁移 9 位）；教职工下拉账号**动态拉取**（GET `/api/staff-accounts`：SQLite `teachers` 表动态教师[教务管理→教师管理可添加，`listTeacherNames()` 单源] + 固定管理账号 教务处/学生处/导员/IT管理员；拉取失败回落 `STAFF_ACCOUNTS` 常量[教师01/教师02+四管理账号]）；**群组判定统一走 `staffAccountToGroup(account)`**（固定账号查 `ACCOUNT_TO_GROUP` → 管理账号白名单 → 其余一律归'教师'群组——**严禁对动态教师名直查 ACCOUNT_TO_GROUP**，会得 undefined 被误当群组）；旧“教务科”浏览器会话由宿主 `main.js` 的 `migrateLegacyRole()` 自动迁移为“教务处”含跨端点遍历。会话存储**群组+姓名双键**（`saveIdentity`/`currentRole`/`currentName`；⚠ 键名格式：普通路径 `zkt.role`/`zkt.name`，dev 端点为 `zkt.<label>.role`/`zkt.<label>.name`（如 `zkt.dev4.role`、`zkt.m-dev1.name`）——**不是** `zkt.role.<devN>`，曾因记错格式导致测试脚本写错键、误报会话恢复 bug）；模块鉴权用群组，界面展示用姓名。
3. **现有代码迁移状态**：规范结构迁移已于 2026-10-21 完成——正式功能全部入驻 `public/modules/mod-*/`；旧原型 6 板块封存于 `public/legacy-archive/`（不在 registry，零加载，仅作 UI 参考）。宿主启动入口为 `public/core/main.js`。
4. **后端边界**：`server.js`、`src/`（Fastify + SQLite：分片上传/任务队列/SSE/热更新/调试端点开关）不属于前端插件体系管辖范围，按原架构方案维护，不强制套用本宪章目录规范。**请假业务 API 已上线（2026-10-21，销假扩展 2026-10-22）**：`src/api/leaves.js`（SQLite `leaves` 表，含 return_required/return_photo/return_signature/return_at/**return_note** 五列，旧库 ALTER 自动迁移）——GET `/api/leaves`、POST `/api/leaves`（提交或 draft 挂起）、PATCH `/api/leaves/:id`（action：start-edit/save/submit/cancel-edit/delete/revoke/approve/reject/return）。状态机：`pending 待审批 → editing 编辑中（导员审批锁定）→ pending 重审 → approved 已同意（可带 requireReturn {photo,sign} 与 returnNote 销假备注）→ completed 已销假（学生按导员勾选提交 returnPhoto/returnSignature）`；`pending → revoked 已撤销`。身份头：`x-zkt-role` + `x-zkt-name`（均 URI 编码；**读头函数已单源化** `src/core/http-utils.js` readRole/readName，SSE 场景兼容 query `?role=&name=`，踩坑 #05 禁令）。前端客户端：`public/shared/api-leaves.js`。**教务管理 API 已上线（2026-10-22，编辑/解散扩展同日；2026-10-23 P2 守卫矩阵重构）**：`src/api/academic.js`（students/classes/teacher_classes 三表 + 100 名学生种子 9 位学号 + `students.score`（默认 100）/`classes.major_id`（可 NULL=未归属）两新列 ALTER 迁移）——GET `/api/academic/students`、GET/POST `/api/academic/classes`、POST `/api/academic/classes/:id/students`（单个/批量勾选/学号文本批量共用）、POST `/api/academic/classes/:id/members`（编辑成员：removeIds 回未分配 + addIds 划入，事务统一提交）、POST `/api/academic/classes/:id/dissolve`（解散：学生回未分配+清 teacher_classes+删班级，reason 必填并日志留痕）、GET `/api/academic/teachers`、POST `/api/academic/teachers/:name/classes`、GET `/api/academic/my-classes`（教师视角班级名册+请假记录，**复用 leaves.js 导出的 parseRow 契约**）。**守卫矩阵（P2，C1 口径：教务处写操作全部走申请）**：READ_ROLES=教务处/学生处/IT（guardRead）；WRITE_ROLES=学生处/IT（guardWrite，教务处调写端点 403 引导文案"教务处请提交申请"——申请流 P3 上线，期间 UI 点击收 403 toast 属预期中间态）；TEACHER_ADMIN=教务处/IT（guardTeacher，C2 教师管理留教务处直改）；REQUEST/REVIEW_ROLES 见 `src/core/consts.js`（P3 workflow.js 消费）。**权限模型：教师 GET /api/leaves 仅返回其授课班级（teacher_classes）学生的请假信息**。前端客户端：`public/shared/api-academic.js`。**P2 数据层+SSE 已上线（2026-10-24）**：五个数据层 API 文件（`workflow.js` 建 workflow_requests/notifications 两表、`majors.js` 建 major_departments/teacher_majors/counselor_classes 三表+种子（计算机系/外语系、教师02 双部、导员→计算机2301 绑定）、`timetable.js` 建 timetable_lessons+种子（计算机2301 周一~五 2 节 base 课 10 条）、`classroom.js` 建 lesson_sessions/sign_records/classroom_events 三表、`violations.js` 建 violation_records+POINTS{旷课:-5,旷寝:-10}/WARN_BELOW 60 常量）——端点逻辑分别属 P3/P5/P6/P8/P9，当前 register 为空壳；`src/core/pub.js` SSE 发布池（三级频道 role:/class:/teacher:、15s 心跳、publishToRole/Class/Teacher）；`src/api/events-global.js` GET `/api/events/global`（六角色白名单，学生自动挂 class 频道、教师挂 teacher 频道，首帧 hello{channels,serverTime}，EventSource 走 query 身份）；`src/core/consts.js` TEACHERS/REQUEST_ROLES/REVIEW_ROLES 单源。server.js 已挂全部 6 个注册函数。**P3–P10 端点全量上线（2026-10-24）**：workflow.js 七类型审批引擎（TYPE_HANDLERS 策略表：class-create/edit/dissolve[教务处→学生处]、add-lesson/teacher-leave/absence-cancel[教师→教务处]、record-modify[教务处→教师确认制]；四端点[提交/列表?status=&mine=/review 409 互斥/withdraw]+GET/POST notifications 读写+notifyStudentsChanged 供 academic.js 四写端点内嵌）；majors.js 写端点群（POST majors[唯一 400]/:id/members 多对多/:id/dissolve[班级置 NULL]/counselor/:name/classes 绑定 D7+GET 含 counselors）；timetable.js 查询端点（GET ?classId=[学生仅本班 403]/?teacher=[+scope=all 授课班全课]/?majorId=[D1b]/mine 学生自助+affected 耽误课[本地时区格式化，P12 实修]+checkConflict/affectedLessons 双导出）；classroom.js 课堂 API（发起[预置请假+publishToClass]/sign[口令 400]/detail[mySign+学生剥离口令]/end[absent 快照+双频道推送]/proxy-sign/score±1±2/pick/absence[事务-5]/DELETE absence open 还分 ended 409 引导审批/sessions 列表[导员绑定班 D8]）；violations.js（POST 登记[学生处/导员/IT D6+导员绑定校验]/GET 流水低分/summary+applyViolation/revokeViolation 事务单源）。前端共享件六件（api-workflow/api-majors/api-timetable/api-classroom/api-violations/sse.js 转发件+shared/timetable.js 课表渲染组件）。**系统数据管理与教师账号动态化（2026-10-24 晚）**：`src/api/admin-data.js`——GET `/api/staff-accounts`（登录页公开账号列表：动态教师+固定管理账号）、GET `/api/admin/data-status`（各表计数汇总）、POST `/api/admin/reset`（**初始化**：17 张业务表清零+storage 上传文件清空+VACUUM 收缩，不可逆，IT 专属）、POST `/api/admin/seed`（**生成模拟数据**：教师01-05+学生001-100 幂等）；`teachers` 表（academic.js 建表+种子教师01/02+listTeacherNames() 单源导出[consts.js TEACHERS 常量退役]+POST `/api/academic/teachers` 添加教师[姓名唯一/禁与管理账号重名/TEACHER_ADMIN 守卫]+GET teachers/:name/classes 校验改查表）；majors.js 教师校验同步改查表。前端客户端：`shared/api-admin.js`；roles.js 新增 MANAGEMENT_ACCOUNTS/staffAccountToGroup（动态教师名→教师群组）。
5. **UI 零空话铁律（2026-10-21 用户指示，最高优先级）**：做功能就是做功能，**严禁渲染任何没有真实功能支撑的说明卡、描述段落、占位介绍**（如"PC 视图端点：访问 xxx…可同时以不同角色进入工作台"这类纯文字卡）。界面只允许出现：真实可操作的功能控件（按钮/开关/表单/列表）、极简的一行功能定位副标题、操作反馈（toast/状态）。功能未实现就不上界面，无入口优于空话入口。判断标准：删掉这段文字，用户损失任何能力吗？——不损失就删。
6. **全局交互组件归宿主**：iOS 风格开关（`.switch`，`aria-checked` 驱动）、日期时间滚轮选择器（`core/js/wheel-picker.js`，`.wp-*` 类，Semi UI 风格）、请假向导共享件（`shared/leave-wizard.js` + 全局 `.leave-wizard` 样式，含 2026-10-22 下沉的教师三态 TEACHER_STATUS/teacherPill/ACTIVE_TODAY/todayStr/coversToday）等通用控件定义于 `core/css/components.css` / `core/js/`，模块直接复用，严禁在 mod-* 内重复定义私有版本。`welcome-row`/`section-*`/`flow-*`/`table-scroll`/`leave-pill` 为宿主级共用骨架类（同 `.section-card`），各模块可直接使用。**拼音搜索**：`shared/pinyin-util.js`（依赖 `shared/vendor/pinyin-pro/` 本地 ESM 副本，无外网依赖，2026-10-22 引入），提供 `pinyinKeys()/studentMatch()`（姓名/学号/全拼/首字母模糊匹配），双端共用。
7. **任务收尾 UI 审查铁律（2026-10-21 用户指示；2026-10-22 系统化为 §七）**：凡任务涉及 UI 变更，结束前**必须**执行 §7.6 UI 审查 SOP（截图视觉审查 + computed 核验，含弹窗/浮层展开态）；发现错位、溢出、截断、丢样式必须当场修复并复检后方可交付。**仅做 DOM/数据断言不算完成**——历史教训：曾只验证数据未看视觉，导致模块样式丢失（flow-metrics 裸排、页脚溢出卡片）带病交付。新 UI 创建必须遵循 §七设计规范（令牌/间距节奏/字体层级/组件规范）。
8. **双端同步铁律（2026-10-21 用户指示）**：任何业务功能必须**同时**落地 PC 端与移动端（PC 模块 + `mod-mobile-home` 对应视图/入口），除非用户明确豁免某端；只完成一端视为任务未完成，不得交付。移动端不得以"开发中"占位条目长期存在——要么实现，要么不渲染入口。
9. **需求重读与疑点先问铁律（2026-10-22 用户指示）**：每次开始修改代码前，都必须**重新通读并复述对当前需求的理解**，严禁凭记忆或上一轮上下文直接动手；需求中存在疑点、歧义、前后矛盾或写得模糊不清之处时，**必须先向用户提问澄清**，确认理解用户的需求走向（业务目标、边界、数据口径）之后，才开始落实代码。宁可多问一句，不可猜错方向返工。（对应 §五 SOP Step 1 的强制前置步骤）
10. **CSS 注释与 manifest 完整性铁律（2026-10-22 教务管理整页裸排实锤，双因叠加）**：① CSS 注释内**严禁出现"星号紧跟斜杠"的连续字符序列**（如把通配符列举写成 `section-*/flow-*/`）——它会提前闭合注释，解析器错误恢复会吞掉紧随其后的整条规则（mod-academic 踩坑 #04：`.aca-split` 主规则被吞致双栏失效）；通配符列举一律带空格写法 `xxx-* / yyy-*`，警示性注释本身也不得包含该字面序列。② 新模块 `manifest.json` **必须含 `entry` + `style` 双字段**——plugin-loader 仅在 `manifest.style` 声明时才注入样式 link，entry 缺省走默认值会放行 JS 造成"模块挂载成功但零私有样式"的隐蔽裸排；收尾时须与其余模块 diff 比对字段完整性。③ 排查此类问题必须查 `document.styleSheets` 的 cssRules 数量与首条规则（link 非 404 ≠ 规则全解析）。

---

## 一、 核心架构哲学 (Core Architecture Philosophy)

1. **宿主与插件彻底解耦（Microkernel + Plug-in）**：
   - `index.html` 是唯一的宿主底座（Host Shell），仅负责提供页面布局插槽（DOM Slots）与启动核心加载器（`core/plugin-loader.js`），严禁写入任何具体业务板块逻辑。
   - 所有业务功能板块（Feature Modules）都是独立插件，100%收敛在 `modules/mod-<feature-name>/` 独立文件夹内。
2. **随时物理删除零副作用（Zero-Side-Effect Deletion）**：
   - 任何一个 `modules/mod-<feature-name>/` 文件夹必须具备完全的自治性与隔离性。
   - **检验标准**：直接从硬盘上物理删除任意一个模块文件夹，或将其 `manifest.json` 中的 `enabled` 设为 `false`，主程序（`index.html`）与其他所有模块必须能够**零报错、零代码修改**地正常编译与运行。
3. **配置驱动权限与端口控制（Manifest-Driven RBAC & Platform Routing）**：
   - 每个模块文件夹下必须包含 `manifest.json`，用于控制该板块的总开关（`enabled`）、运行终端端口（`pc` / `mobile`）以及允许访问的用户群组（`allowedUserGroups`）。
4. **双层文档记忆交接（Doc-Driven State Machine）**：
   - 根目录 `Rules.md`（本文件）负责维护全局规则、模块进度总表与跨模块通信字典。
   - 每个模块文件夹下的 `DEV_LOG.md` 负责记录该模块的内部进度清单、通信契约与历史【踩坑与避坑记录】。
   - **代码未动，文档先行；代码改完，文档必更。**

---

## 二、 标准目录结构强制规范 (Directory Structure)

严禁按传统技术层级（如全局 `css/`、`js/`、`components/`）混放业务代码。必须严格保持以下目录树结构：

```plaintext
project-root/
├── Rules.md                        # [全局宪章与总表] AI 接管必读入口、全局事件字典、全模块进度总表
├── index.html                      # [宿主底座] 仅含全局布局插槽(Slots)与引入 core/plugin-loader.js
├── core/                           # [微内核核心] 仅存放插件加载器、全局事件总线与基础上下文工具
│   ├── plugin-loader.js            # 动态扫描/读取模块、校验 manifest.json 权限、挂载与异常熔断隔离
│   └── event-bus.js                # 跨板块解耦通信总线 (基于浏览器原生 CustomEvent 封装)
└── modules/                        # [插件目录] 所有业务功能板块必须作为独立子文件夹存放在此目录下
    ├── registry.json               # [可选/静态环境] 已注册模块文件夹名称列表
    └── mod-<feature-name>/         # [独立功能板块] 命名强制规范：mod-功能英文名 (如 mod-pc-analytics)
        ├── manifest.json           # [必选] 板块元数据、启停开关、终端端口(pc/mobile)与用户群组权限配置
        ├── DEV_LOG.md              # [必选] 本板块专属：开发进度、内部架构、通信契约与踩坑避坑指南
        ├── index.js                # [必选] 板块唯一逻辑入口，导出标准 mount / unmount 生命周期函数
        ├── style.css               # [可选] 板块私有样式（所有选择器必须以 .mod-<feature-name> 为前缀）
        └── assets/                 # [可选] 板块私有静态资源（严禁存放在项目全局目录）
```

---

## 三、 模块文件标准契约与隔离红线 (Contracts & Isolation Rules)

### 3.1 板块控制清单契约 (`modules/mod-<feature-name>/manifest.json`)
创建任何模块时，必须首先生成符合以下 Schema 的 `manifest.json`：

```json
{
  "moduleId": "mod-feature-name",
  "name": "板块中文名称",
  "version": "1.0.0",
  "enabled": true,
  "mountSlot": "#slot-main",
  "platforms": ["pc", "mobile"],
  "allowedUserGroups": ["admin", "vip", "user", "guest"],
  "entry": "./index.js",
  "style": "./style.css",
  "description": "板块核心职责简述"
}
```

### 3.2 板块生命周期入口契约 (`modules/mod-<feature-name>/index.js`)
每个模块的 `index.js` 必须作为 ES Module 导出标准的 `mount` 和 `unmount` 函数，严禁在模块顶层直接执行具有全局副作用的 DOM 操作：

```javascript
/**
 * 挂载板块
 * @param {HTMLElement} container - 宿主分配的 DOM 插槽容器节点
 * @param {Object} context - 宿主注入上下文 { user: { id, group }, platform: 'pc'|'mobile', eventBus }
 */
export async function mount(container, context) {
  // 1. 为容器或内部根节点添加模块专属命名空间类名 (如 mod-feature-name)
  // 2. 渲染模块内部 DOM 与初始化局部状态
  // 3. 绑定内部事件与 context.eventBus.on(...) 监听器（必须保存引用以便卸载）
}

/**
 * 卸载板块（用于权限切换、端口切换或热关闭时彻底清理副作用）
 * @param {HTMLElement} container - 宿主分配的 DOM 插槽容器节点
 * @param {Object} context - 宿主注入上下文
 */
export async function unmount(container, context) {
  // 1. 清理模块内部所有定时器 (clearInterval / clearTimeout / cancelAnimationFrame)
  // 2. 显式解绑所有全局事件与 context.eventBus.off(...) 监听器
  // 3. 销毁第三方实例并清空 container.innerHTML = ''
}
```

### 3.3 物理与逻辑隔离四条铁律 (Strict Isolation Redlines)
1. **严禁跨模块直接引用 (Zero Cross-Module Imports)**：
   - 绝对禁止在 `modules/mod-a/` 的任何文件中使用 `import ... from '../mod-b/...'`。模块之间在代码层面上必须完全不知道对方的存在。
2. **跨模块通信唯一通道 (EventBus Only)**：
   - 模块间的数据传递或状态触发，必须且只能通过 `context.eventBus.emit(eventName, payload)` 与 `context.eventBus.on(eventName, handler)` 进行。
   - 所有自定义事件必须登记在本文件底部的《全局 EventBus 事件通信字典》中。当监听方模块被删除时，发送方依然安全运行，绝不报错。
3. **样式作用域绝对隔离 (Strict CSS Scoping)**：
   - 模块内的 `style.css` 严禁直接定义 `body`、`html`、`div`、`button` 等全局标签或无前缀类名。
   - 所有 CSS 规则必须以该模块的 `moduleId` 类名作为顶级命名空间前缀（例如：`.mod-feature-name .submit-btn { ... }`），确保删除模块或同时挂载多模块时样式零冲突。
   - ⚠️ **命名空间前缀必须区分"后代"与"同元素"两种写法**：模块 `mount()` 是把 `mod-xxx` 类注入到**插槽容器自身**（如 `#loginStage`、`#topbar`，见 §3.2 第 1 步）。凡针对**插槽元素本身**（其宿主类如 `.login-stage`、`.topbar`、`.mobile-stage`）的规则，必须写**同元素复合选择器** `.login-stage.mod-login { ... }`；后代写法 `.mod-login .login-stage` 要求插槽是其后代，**永不命中**（2026-10-21 实修：登录页失去 fixed 全屏覆盖与居中、顶栏失去 sticky/flex 布局，均由此引起）。模块内部子元素仍用后代写法 `.mod-login .login-panel { ... }`。
4. **宿主底座容错与先鉴权后加载 (Fault Isolation & Lazy Loading)**：
   - `core/plugin-loader.js` 加载任何模块必须包含在独立的 `try...catch` 块中。
   - 若某模块文件夹被物理删除（请求 `manifest.json` 返回 404），加载器仅输出 `console.warn` 并自动跳过（`continue`），严禁中断宿主和其他模块的渲染。
   - 必须先拉取并校验 `manifest.json`（确认 `enabled === true`、当前终端在 `platforms` 内、当前用户角色在 `allowedUserGroups` 内），全部通过后才可动态加载 `style.css` 与 `import('./index.js')`。

---

## 四、 模块内部文档标准模板 (`modules/mod-<feature-name>/DEV_LOG.md`)

每个模块文件夹下必须包含 `DEV_LOG.md` 文件。新建模块时必须同步创建该文件，每次修改模块代码时必须同步更新该文件。其内容必须严格遵循以下格式：

```markdown
# 模块开发与交接日志：`mod-<feature-name>` (<模块中文名>)

## 1. 模块元数据与架构自检
- **模块路径**：`modules/mod-<feature-name>/`
- **挂载插槽**：`#slot-xxx`
- **支持端口**：`pc` / `mobile`
- **开放群组**：`admin`, `vip`, `user`, `guest`
- **物理可删除性自检**：[通过] 无外部跨模块直接引用，样式已加 `.mod-<feature-name>` 前缀，卸载钩子已清理所有副作用。

## 2. 功能开发进度清单 (Progress & Todo List)
- [x] 已完成的具体子功能点 1（含实现简述）
- [x] 已完成的具体子功能点 2
- [ ] [待办] 尚未完成的子功能点 3（供下一个接手的 AI 模型继续开发）

## 3. 跨模块事件通信契约 (EventBus Contracts)
- **对外触发事件 (Emits)**：
  - `event:name` -> 载荷格式 `{ key: type }`（说明触发时机）
- **监听外部事件 (Listens)**：
  - `event:name` -> 处理逻辑说明（已在 `unmount` 中解绑）

## 4. ⚠️ 踩坑记录与避坑指南 (Pitfalls & Lessons Learned)
> **[AI 接手铁律]**：任何后续接手修改本模块的 AI 模型，在编写代码前必须仔细阅读下表，严禁推翻已验证的修复方案或重蹈覆辙！

| 编号 | 历史 Bug / 踩坑现象描述 | 根本原因分析 (Root Cause) | 最终验证解决方案与代码禁令 (Mandatory Fix & Rule) |
| :--- | :--- | :--- | :--- |
| #01 | (记录具体的报错、样式冲突、异步渲染时机等问题) | (分析为什么会出错) | (明确规定代码必须怎么写，严禁怎么写) |
```

---

## 五、 AI 开发标准作业程序 (Standard Operating Procedure - SOP)

无论是哪个 AI 模型接手本项目，每次执行用户的开发、修改、调试或重构指令时，必须严格按以下 **4 步闭环工作流** 执行：

### Step 1：读取与上下文对齐 (Read & Align)
- **需求重读与澄清（§〇.9 铁律，强制前置）**：动手前先向用户复述需求要点；凡需求存在疑点/歧义/模糊之处，**必须先提问确认需求走向，得到答复后才进入编码**，严禁自行猜测拍板。
- **若为项目初始化（尚无宿主底座）**：先按本规范生成 `index.html`、`core/event-bus.js`、`core/plugin-loader.js`、`modules/registry.json`，并更新本文件底部总表。
- **若为修改/续写现有模块**：必须先读取本文件底部的全局总表，再读取目标文件夹下的 `manifest.json` 和 `DEV_LOG.md`。重点精读 `DEV_LOG.md` 中的【待办清单】与【踩坑记录与避坑指南】。
- **若为新建模块**：检查本文件底部的《全局模块注册与进度总表》与《全局 EventBus 事件通信字典》，确认模块命名、挂载插槽与事件命名无冲突。

### Step 2：物理隔离编码 (Isolated Coding)
- 严格在目标模块文件夹 `modules/mod-<feature-name>/` 内部创建或修改代码（`manifest.json`、`index.js`、`style.css`）。
- 除非用户明确要求修改全局布局插槽或微内核加载器，否则**严禁触碰 `index.html`、`core/` 及其他任何模块文件夹**。
- **UI 创建遵循 §七设计规范（2026-10-22 起）**：样式只引用 §7.1 令牌、间距取 §7.2 节奏档位、字重用 §7.3 档位、组件复用 §7.4 全局骨架类（模块 style.css 只写 `.mod-xxx` 前缀私有类）；新交互态遵循 §7.5 语义色约定。

### Step 3：更新模块级记忆文档 (Update Module `DEV_LOG.md`)
- 代码编写或修复完成后，立即创建或更新 `modules/mod-<feature-name>/DEV_LOG.md`。
- 将已完成的任务从 `[ ]` 改为 `[x]`，并补充新的待办项。
- **强制避坑沉淀**：如果本次对话解决了任何 Bug、调整了 DOM 挂载时机、修复了样式错乱或处理了边界异常，必须将该问题的【现象、原因、解决方案与禁令】追加写入 `DEV_LOG.md` 的第 4 节《踩坑记录与避坑指南》表格中。

### Step 4：同步全局总表与交付报告 (Sync `Rules.md` & Report)
- 更新本文件（`Rules.md`）底部的《全局模块注册与进度总表》（更新进度百分比、开关状态、最近交接备注）及《全局 EventBus 事件通信字典》。
- **凡涉及 UI 变更：交付前必须完成 §7.6 UI 审查 SOP（截图+computed 双核验）并在 DEV_LOG 记录审查结论，未通过不得交付。**
- 向用户输出结构化交付报告，明确列出：
  1. 本次新建/修改的文件路径清单；
  2. `DEV_LOG.md` 与 `Rules.md` 的同步状态；
  3. 物理删除安全确认（确认直接删除该文件夹不会影响系统其他部分）。

---

## 六、 项目实时状态追踪中心 (Live Project State Registry)

> **[动态维护区]**：以下两张表格为项目的实时真理源（Single Source of Truth）。AI 每次完成模块的新增、修改、启停或删除后，必须直接更新下方表格内容。

### 6.1 📊 全局模块注册与进度总表 (Global Module Registry & Progress)

> **现状说明（2026-10-24 P13 收尾：开发计划 P1–P13 全量交付）**：本节为最终交接汇总（P1–P3 前史见下）。
> **P4 一期前端**：mod-academic 教务处申请化（写操作走 class-create/edit/dissolve 申请+我的申请 Tab+审批结果/学生数据变更双实时窗；IT 保留直改 C4）；**mod-student-affairs 新模块**（学生处直改+建班带专业部归属 D1a+待审批/审批历史+违规与积分 P8）；班级管理布局类上浮宿主 components.css（aca-split/folder/un-row/stu-*/req-*/review-* 全局双模块共用）。
> **P5 专业部**：majors 写端点群（新建/多对多编辑/解散[班级归属置 NULL]/导员绑定 D7）；**mod-academic 教师 pane 重构三件套**（专业部夹+右栏专业头[编辑/解散]+班级 chips 切换课表 D1b+部内教师卡[可展开编辑授课班级 C2]+导员绑定区）+新建专业部虚线框+未分配教师独立条目。
> **P6/P7 课表与调课**：timetable 查询端点（classId/teacher?scope=all/majorId/mine 学生自助）；**shared/timetable.js 周课表组件**（分钟级定位/午休线/当前时间红线 30s 重算/ongoing 描边/add 紫标/cancelled 置灰标停课/onCellClick/onLessonClick）；**mod-courses**（学生课表+签到卡+新课停课弹窗；教师 mine/all 开关+点空格加课申请+点本人课停课申请[签名板]）；**mod-lesson-review 调课审批**（三类+审批弹窗含签名图展示+SSE 徽标）。
> **P8 违规积分+耽误课**：TYPES 双处更名（其他→公假+互指注释）；violations.js 完整 API（applyViolation/revokeViolation 事务单源[workflow absence-cancel/record-modify 统一调用]+登记[学生处/导员 D6]+流水/低分/汇总[导员绑定班 D8]）；学生处违规与积分 Tab（预警条/低分名单/流水/登记弹窗拼音搜索）；**导员审批收窄 D8**（leaves.js GET 按绑定班过滤+approve/reject 守卫+未绑定空态引导）；耽误课展示（向导 Step2 实时计算 .wz-affected+审批弹窗审批依据）。
> **P9 课堂**：classroom.js 完整 API（发起[预置请假 sign_records leave-auto+publishToClass]/学生签到[口令 400 校验]/详情[三类名单+计数+mySign]/结束[absent 快照+publish 导员教务处]/代签/加减分/随人/旷课[事务扣分]/open 撤销还分 ended 409）；**mod-classroom**（发起双入口+四区面板[口令 40px/3s 轮询/随人 80ms 轮换/学生列表行内操作/三分栏详情]+刷新恢复+历史详情）；**mod-courses 学生签到卡**（SSE+离线补拉+请假"请假中"无按钮+口令/点击双模式）。
> **P10 课堂记录三方**：**mod-class-records**（教务处全量台账+修改浮层[签到/分值/旷课下拉勾选→changes from 快照→record-modify 申请→教师确认制生效]）；mod-classroom 教师确认窗（diff 表 from→to）；**mod-counselor-verify 三 Tab 重构**（待审批/历史/课堂状态[违规汇总+绑定班近期课堂+签到详情]）+课堂结束 SSE toast。
> **P11 移动端全量**：HOME_CARDS 完整卡组+五新视图（renderCoursesView[compact 课表横滚 640px+签到卡+加课/停课 in-host 弹窗]/renderClassroomView/renderSAView 三 Tab/renderLessonReviewView/renderClassRecordsView）+SSE 统一 toast+当前视图刷新；ttHandleMobile+七监听 unmount 全清理。
> **P12 全链路审计**：权限矩阵 15/15（学生他班课表 403/教师改他人课堂 403/学生处·导员提交加课 403/教师建专业部 403/pending 竞争 409[A 审批通过后 B 审批 409 建议驳回]/他班进行中课堂 403 等）；请假新类型公假回归+导员审批耽误课展示；**实修 affectedLessons 时区错位 BUG**（toISOString[UTC]与本地 getDay 混用致日期显示前一天——周一申请显示"周日"却命中周一课；修复为本地格式化）；演示库卫生核对（课堂/申请/加课/低分学生全零，用户历史请假 6 条保留）。
> ⚠ 用户 8084 实例为旧代码，重启后全部生效。5 个新模块 DEV_LOG 均已建档；P3–P12 各阶段浏览器实测（双端点多身份）与控制台零错误记录在各阶段执行过程。
> **前史（2026-10-23 下午 P1 完成：角色全量更名+学生处+旧会话迁移）**：①`shared/roles.js` 七常量改造（教务科→教务处、新增学生处同级，ROLE_ACCESS 预置 courses/classroom/lesson-review/class-records/student-affairs 新模块 id，未注册时侧栏/landing 自动隐藏）；②六 manifest 更名（login/core-nav/landing/student-leave/mobile-home 追加学生处，academic 仅更名）；③`core/main.js` 注入 `migrateLegacyRole()`（devAccess 通过后、会话判定前，遍历全部 `zkt(.端点)?.role` 键把“教务科”迁移为“教务处”，name 同步替换，幂等）；④后端 leaves.js STAFF 加教务处/学生处；⑤界面文案 ~10 处更名。⚠ 实修接缝缺陷并沉淀：学生处登录后主区空白——`switchMain` 收到未注册模块 id（ROLE_HOME 学生处→student-affairs）时直接 return，补兜底回落 landing；教训：**ROLE_ACCESS/ROLE_HOME 预置未来模块 id 时，切换路径必须有未注册回落**。验收：grep“教务科”仅剩历史性注释、API 冒烟 7/7、双端六角色登录回归、旧会话多端点迁移实测（normal+dev2 同迁、m-dev1 学生不受影响）。
> **前史（2026-10-23 午 弹窗间距修复+未分配移出容器交接）**：应用户截图实锤完成两项修正——①**编辑弹窗节奏断裂修复**：rect 实测 tabs→label 与 label→list 均 0px 贴死（根因：`.aca-tabs`→`.segmented.aca-dlg-tabs` 组件替换时丢失旧组件 margin-bottom；`wizard-label` 无 margin），补 `.aca-dlg-tabs` mb 10px + `.aca-pane>.wizard-label` mb 8px（components.css 全局），双端复验节奏 10/10/10/8/10 统一（视觉模型"40px 偏大"目测系误报，实测 10px；沉淀 mod-academic 踩坑 #07：组件替换必须 diff 继承旧 margin）；②**左栏布局重构（用户需求：未分配移出 box 放其下方）**：「未分配」移出灰蓝容器成独立白底描边条目（`.aca-un-row`/`.m-un-row`）置于容器下方（容器内仅自建班级+新建班级虚线框；PC `#acaUnRow` 静态 DOM 仅同步态防重复绑定，`.aca-left` flex gap 10px；移动端复用统一绑定），双端 rect 验证容器→未分配 10px + 截图审查通过、控制台零错误。
> **前史（2026-10-23 教务管理入口迁移交接）**：应用户需求完成学生管理面板功能整合——①右上角「新建班级」按钮移除，功能迁至左栏文件夹列表底部**蓝色虚线框「+ 新建班级」常驻**（全局 `.aca-folder-add`，双端共用，未分配态可见）；②原「添加学生」独立弹窗退役（勾选加入与编辑弹窗功能重复，经用户确认），其**批量添加**能力合并进「编辑」弹窗；③「编辑」弹窗重构为**三栏 segmented Tab**（添加学生/批量添加/移除学生，`.segmented.aca-dlg-tabs` 全局样式与登录页 login-tabs 同款交互），三 Tab 数据统一合并提交 members 端点；④移动端 mod-mobile-home 同步（folders 底部虚线框常驻 + 工具行精简 + in-host 三栏弹窗）。双端实测（含统一提交移出+批量加入→反向还原数据闭环）+ §7.6 审查（截图+computed+cssRules 吞规则复查+双端控制台零错误）全部通过。⚠️ 本轮实修工具坑并沉淀 mod-academic 踩坑 #06：**multiedit 报成功但编辑未落盘**（PC 端旧函数残留致重复 const 声明 SyntaxError、移动端整段未替换）——批量编辑后必须读回复查 + node --check + grep 特征验证。
> **前史（2026-10-22 深夜 全平台 UI 审计通过交接）**：应用户指示执行**全平台 UI 纠正审计**（§7.6 SOP 首次全量执行）——PC 5 角色（登录/学生列表+向导/教师双板块/教务科滑块+编辑解散/导员审批+同意拒绝弹窗/IT 系统管理）+ 移动端 4 角色（学生向导 in-host/教师双板块/教务科 segmented+红色移出态/导员审批）+ 样式表 cssRules 吞规则检查 + 双端控制台零错误。**审计发现并修复 1 处**：导员拒绝弹窗 `cv-reason-input`（block 流面板内 textarea 保持 UA inline-block 产生基线空隙 + margin 叠加，实测 ta→按钮 29px 超标；修复 display:block + margin-bottom 20 → 实测 20px 达标、面板上下对称差 0px，沉淀踩坑 #06）。其余全部一次通过（教师括号加粗再次遭遇视觉模型误报，按 §7.6.3 事实源原则以 computed 800 判定合格）。同轮建立 **⚡新会话快速上手**块（本文件顶部）与各模块 DEV_LOG UI 审查结论补录，确保新接手者零成本上手。
> **前史（2026-10-22 夜早些时候）**：应用户指示建立 **§七 UI 设计规范与视觉审查系统**（设计令牌/间距节奏/字体层级/组件规范/语义色/UI 审查 SOP 六节），§〇.7 与 SOP Step 2/4 已挂接强制条款——后续一切新 UI 必须遵循 §七创建，收尾必须执行 §7.6 审查（截图+computed 双核验、computed 为事实源）。同轮修复用户报告的“文字与下方功能按钮上下间隔不对称”：宿主 components.css 弹窗节奏链统一（`.wizard-text` 原 margin 10/4 为实锤根源）+ `cv-dialog-panel` 对称化，双端 rect 实测 20.7/20.7 完全对称；视觉模型对小差异辨识不可靠再次实证（与踩坑 #14 同模式）。⚠️ 更早前史（同日）：教务管理三连修（CSS 丢失双因 §〇.10 / segmented 滑块重构 box 嵌套 box / 班级编辑+解散 with members/dissolve 端点）；请假管理更名+教师双板块（今日请假（今日请假x人）加粗蓝数/历史全员 0 次不可展开/近期请过假蓝气泡+被驳回红气泡/拼音搜索）；mod-mobile-home 同步全部。⚠️ 教务管理上线轮实修三个坑：① `mod-mobile-home/index.js` 整文件 import 丢失致模块熔断空白（截断交付教训，必须浏览器实测双端）；② `.tc-body/.m-tc-body` 显式 display 覆盖 `[hidden]`（全项目第三次踩，配套规则必须成对写）；③ my-classes 透传 SQLite 原始行与 parseRow 契约不一致（后端返回 leaves 一律复用 parseRow）。历史：宪章规范结构迁移已完成——`core/plugin-loader.js`、`core/event-bus.js` 已就绪；`public/index.html` 已改造为纯插槽宿主（`core/main.js` 为启动装配入口）；八个正式模块全部入驻 `public/modules/mod-*/`（manifest + DEV_LOG + mount/unmount 生命周期 + 前缀样式）。旧原型 6 板块移至 `public/legacy-archive/` 封存（不在 registry，零加载）。物理删除零副作用已实测（删除 mod-counselor-verify 后主界面仅 console.warn 并正常回落）。⚠️ 2026-10-21 实修插槽级样式坑：挂载到宿主插槽元素自身（#loginStage/#topbar）的 CSS 必须用同元素复合选择器（如 `.login-stage.mod-login`），后代写法（`.mod-login .login-stage`）永不命中，曾致登录页与顶栏整体错位，详见 §3.3 铁律 3 及各模块 DEV_LOG。⚠️ 同日实修宿主侧栏样式丢失坑：侧栏由宿主渲染（`core/main.js` renderSidebar → `#sidebar`），迁移时其 17 条内部样式（`.side-head/.nav-list/.nav-item` 等）无任何文件承接，致左栏裸排错位；已从 `zhikaotong_seed_ui.html` 原样回迁至 `core/css/layout.css`（宿主底座归属），含 760px 下隐藏规则。**宿主渲染的插槽内容（侧栏/弹窗/轻提示）样式固定归 `core/css/`，严禁挪入任何 mod-***。⚠️ 2026-10-21 晚大修：请假向导与弹窗抽为共享件 `shared/leave-wizard.js`（PC/移动双端复用，in-host 内嵌模式）；时间选择改为滚轮选择器 `core/js/wheel-picker.js`（Semi UI 风格）；骨架类（welcome-row/flow-*/table-scroll/leave-pill）统一下沉宿主 components.css（曾因模块重写误删致裸排带病交付，催生 §〇.7 UI 审查铁律）；移动端请假 tab 双端同步补齐（§〇.8）。

| 模块文件夹 (`moduleId`) | 模块中文名称 | 挂载插槽 (`mountSlot`) | 适用端口 (`platforms`) | 开放用户群组 (`allowedUserGroups`) | 启用状态 (`enabled`) | 当前进度 | 最近交接备注与下一步待办 (Handover Notes) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `mod-login` | 登录页（Tab 切换：学生 9 位学号+密码+图形验证码 / 教职工账号下拉【动态】+密码+验证码，服务端校验+限流） | `#loginStage` | `pc`, `mobile` | 学生, 教师, 教务处, 学生处, 导员, IT管理员, guest | `true` | `100%` | 2026-11-03 **登录限流+图形验证码上线**：GET /api/auth/captcha 自绘 SVG（零依赖，token 5 分钟一次性消费）+登录必填验证码（忽略大小写）+仅计失败限流（单 IP 半小时 5 次→429，成功不清零，验证码错不计；内存态重启清零）；登录失败自动换新验证码。待办：无 |
| `mod-landing` | 工作台首页（按角色过滤入口卡片+待办徽标） | `#mainViewContent` | `pc` | 学生, 教师, 教务处, 学生处, 导员, IT管理员 | `true` | `100%` | 2026-10-29 C4：各角色待办徽标。2026-11-03 批二 S6：**徽标取数迁移后端单源 fetchTodoSummary**（GET /api/todo/summary；旧前端五分支过滤副本+fetchLeaves/fetchRequests import 删除，单源禁令闭环）；学生身份实测徽标 1 正确 |
| `mod-academic` | 教务管理（三 Tab：学生管理[教务处=申请化，IT=直改 C4] / 教师管理[专业部三件套+添加教师+导员绑定 D7] / 我的申请） | `#mainViewContent` | `pc` | 教务处, IT管理员 | `true` | `100%` | 2026-10-29 C1：**班级重命名**（教务处走 class-rename 第八类申请/IT 直改，双端）。待办：无（原班级重命名/教师扩容均已交付）；踩坑 #03-#07 必读 |
| `mod-student-leave` | 请假管理（学生向导全流程 + 教师今日/历史双板块 + 教职工汇总） | `#mainViewContent` | `pc`, `mobile` | 学生, 教师, 教务处, 学生处, 导员, IT管理员 | `true` | `98%` | 2026-10-23 P1：VIEWS 新增教务处/学生处「请假汇总」+文案更名；后端 STAFF 同步（学生处可读全校汇总）。2026-10-22 深夜：更名“请假管理”+今日括号/历史全员/蓝红气泡（详见 DEV_LOG）。待办：凭证分片上传；踩坑 #04-#14 必读（#14 字重视觉验收以 computed 为准） |
| `mod-counselor-verify` | 待审批（三 Tab：待审批/历史/课堂状态） | `#mainViewContent` | `pc` | 导员, IT管理员 | `true` | `93%` | 2026-10-24 P8/P10：审批列表按绑定班级收窄 D8+未绑定空态引导；同意/拒绝弹窗+**耽误课清单**（affectedLessons 后端单源）；课堂状态 Tab（违规汇总+绑定班近期课堂+签到详情+课堂结束 SSE toast）。销假要求+备注/编辑中锁定保留。待办：考勤交叉核验 |
| `mod-admin-console` | 系统管理（调试端点开关+直达入口+数据管理+**用户与角色管理**+**考勤规则**+**数据归档导出**） | `#mainViewContent` | `pc` | IT管理员 | `true` | `98%` | 2026-10-29 A 批次三件套上线：①用户与角色管理（三 Tab 学生/教师/管理账号+搜索+重置密码）；②考勤规则（settings 单源，保存即时生效）；③数据归档与导出（三数据集日期筛选+CSV 下载 BOM）。踩坑 #06/#07 必读。待办：归档定时自动导出、考勤规则扩展项（需口径） |
| `mod-mobile-home` | 手机端工作台（首页[全局搜索]/请假/消息/教务管理/课程/课堂/学生处/调课审批/课堂记录/我的） | `#mobileStage` | `mobile` | 学生, 教师, 教务处, 学生处, 导员, IT管理员 | `true` | `100%` | 2026-11-03 批二：**首页全局搜索**（分组结果+按角色切视图）+**待办弹窗「去处理」视图切换**（todo:goto 监听）。2026-10-29 B/C 批次：消息 tab+课堂完整化+散点清账；P11 移动端全量。踩坑 #07/#08/#09 必读 |
| `mod-student-affairs` | 学生处（学生管理直改+待审批+审批历史+违规与积分[筛选]） | `#mainViewContent` | `pc` | 学生处, IT管理员 | `true` | `98%` | 2026-10-29：C1 班级重命名直改+C2 违规流水筛选（类型×状态）；考勤规则动态化。P4/P8：四 Tab；建班带专业部 chips；审批弹窗；SSE 徽标。移动端同步（含重建修复，见 mod-mobile-home 踩坑 #10）。待办：无；踩坑 #01 必读 |
| `mod-courses` | 课程（学生课表[周/日视图]+签到卡+课程详情 / 教师课表+开关+加课+停课） | `#mainViewContent` | `pc` | 学生, 教师, IT管理员 | `true` | `96%` | 2026-10-29 C3：**学生日视图切换**（周/日 segmented+日导航）+**课程详情弹窗**（学生/IT/教师非本人课，双端）。P6/P7/P9：签到卡+新课停课实时弹窗；教师加课/停课申请+审批结果窗。ttHandle unmount 必 destroy（踩坑 #01） |
| `mod-classroom` | 课堂管理（发起/进行中面板四区/历史） | `#mainViewContent` | `pc` | 教师, IT管理员 | `true` | `90%` | 2026-10-29 B2 移动端完整化（随人/行内操作/历史，随 PC 同步）；P9/P10：发起双入口+四区面板+刷新恢复+record-modify 确认窗；旷课 open 撤销还分/ended 409 引导审批。踩坑 #01（轮询清理）#02（动画 interval 结束条件）+实修按钮 data-sid 缺失 bug 必读 |
| `mod-lesson-review` | 调课审批（教务处·D9 拆分） | `#mainViewContent` | `pc` | 教务处, IT管理员 | `true` | `95%` | 2026-10-29 B2 移动端完整版（待审批+历史，E2E 实测）；P7：双 Tab+审批弹窗（摘要+细则+签名图/材料图+驳回必填）+SSE 徽标。待办：无（移动端已同步完整版） |
| `mod-class-records` | 课堂记录（教务处·D9 拆分：全量审查+修改申请确认制） | `#mainViewContent` | `pc` | 教务处, IT管理员 | `true` | `92%` | 2026-10-29 移动端详情事件行显学生姓名；P10：课堂台账+修改浮层（changes from 快照→record-modify 确认制）；移动端列表+详情（修改引导 PC 属确认制设计决策）。踩坑 #01（from 快照防陈旧）必读 |
| `mod-core-nav` | 顶栏导航壳层（含全局搜索框+通知铃铛+个人中心浮层[修改密码+退出登录]） | `#topbar` | `pc` | 学生, 教师, 教务处, 学生处, 导员, IT管理员 | `true` | `100%` | 2026-11-03 批二：**通知铃铛**（未读红徽标+下拉最近 20 条+单条/全部已读+SSE 全事件实时刷新，与移动端消息 tab 同源同表）+**全局搜索框**（debounce+分组下拉+拼音匹配[后端单源]+按角色权限跳转，1120px 以下隐藏）。原两项待办清零；踩坑 #03–#06 必读 |
| `mod-survey` | 问卷与投票（学生/教师填写投票；导员填写情况+催填+发起；学生处/教务处/IT 发起+统计+CSV） | `#mainViewContent` | `pc` | 学生, 教师, 导员, 学生处, 教务处, IT管理员 | `true` | `100%` | 2026-10-31 **出题板块重构**（S15–S24）：九类题型（数字/日期并入填空格式属性）+「其他」补充填空+显示逻辑引擎（多条件且/或、级联隐藏、服务端强制剔除隐藏题答案）+实时显隐（双端）+统计九类适配；API 冒烟 v2 41/41。2026-10-30 全量交付（S1–S14）：3 表+10 端点+3 SSE 事件+投票四开关+匿名脱敏+visibility 配置+导员双收窄。待办：教师发起归课堂板块；踩坑 #01/#04–#07 必读 |
| `mod-legacy-*` | 考勤核销中心等旧原型（6 板块） | — | — | — | `false` | `封存` | 移至 `public/legacy-archive/`（不在 registry）。仅作 UI 参考素材，严禁直接引用 |

**架构完成清单**：
- [x] `public/core/event-bus.js`（CustomEvent 封装 on/off/emit）
- [x] `public/core/plugin-loader.js`（manifest 三重校验 + 熔断隔离 + 懒加载 + mountModuleDirect）
- [x] `public/index.html` 纯插槽宿主 + `public/core/main.js` 启动装配
- [x] `public/modules/registry.json` + 8 模块规范结构迁移完成（含 2026-10-22 新增 mod-academic）
- [x] 物理删除零副作用实测通过（404 → warn → 跳过 → 界面回落）

### 6.2 📡 全局 EventBus 事件通信字典 (Global Event Dictionary)

> **现状说明**：`core/event-bus.js` 已实现（CustomEvent 封装，on/off/emit，无监听方时发送方静默安全）。以下为已实现与规划事件契约。

| 事件名称 (`Event Name`) | 触发方模块 (`Emitter`) | 监听方模块 (`Listeners`) | 载荷数据结构 (`Payload Schema`) | 触发时机与业务说明 |
| :--- | :--- | :--- | :--- | :--- |
| `context:user-changed` | `core/main`（broadcastContext） | 所有已挂载模块 | `{ userId: string, group: '学生'\|'教师'\|'教务处'\|'学生处'\|'导员'\|'IT管理员', name: string（9 位学号/账号名）, platform: 'pc'\|'mobile' }` | 登录成功进入工作区时触发 |
| `theme:change` | `mod-core-nav` | 所有已挂载模块 | `{ theme: 'light' \| 'dark' }` | 顶栏切换深浅色主题时广播 |
| `auth:logged-in` | `mod-login` | `core/main` | `{ role: 群组, name: 9 位学号（000000001–000000100）或账号名（教师01 等）, home: string }` | 登录页提交；宿主 `saveIdentity(role, name)` 持久化群组+姓名并进入工作区 |
| `auth:logout` | `mod-core-nav`（PC 顶栏个人中心浮层）/ `mod-mobile-home`（手机「我的」页） | `core/main`（规划） | `{}` | 退出登录（先广播再 logout() 清群组+姓名双键并 reload） |
| `nav:goto-module` | `mod-landing`, `core/main`(侧栏) | `core/main` | `{ moduleId: string }` | 入口卡片或侧栏点击申请切换主区模块；宿主校验角色权限后挂载 |
| `ui:open-modal` | `mod-student-leave`（已用）/ 其他模块（可用） | `core/main` | `{ title, lead, body, confirmText, event?, payload?, toast? }` | 模块请求宿主全局弹窗；确认后可选回发 `event` |
| `ui:toast` | `mod-admin-console`（已用）/ 其他模块（可用） | `core/main` | `{ message: string }` | 模块请求宿主全局轻提示 |
| `todo:goto` | `shared/todo-dialog.js`（登录待办弹窗「去处理」按钮） | `core/main`（PC：转发 nav:goto-module 走宿主鉴权）/ `mod-mobile-home`（移动：TODO_VIEW 映射切对应视图） | `{ moduleId: string }` | 登录进入工作区后待办弹窗内点击「去处理」时触发（双端同步铁律） |
| `dev:endpoint-toggled` | `mod-admin-console` | `core/main`（规划） | `{ enabled: boolean }` | IT管理员 切换 /devN、/m-devN 调试端点开关（后端 `/api/dev-access`） |
| `leave:submitted` | `mod-student-leave`（已实现） | `mod-counselor-verify`（已实现） | `{}` | 学生提交/重新提交请假成功后广播，导员待办列表自动刷新 |
| `verify:completed` | `mod-counselor-verify`（已实现）/ `mod-mobile-home`（已实现） | `mod-student-leave`（已实现） | `{ leaveId: number, conclusion: '通过'\|'退回', verifiedBy: string }` | 导员同意/拒绝后广播，学生端列表刷新（拒绝回复弹窗由学生端加载时按未读触发） |
| `leave:returned` | `shared/leave-wizard.js` openReturnDialog（已实现） | `mod-counselor-verify` / `mod-student-leave` / `mod-mobile-home`（均已实现） | `{ leaveId: number }` | 学生按导员要求销假成功后广播，各列表刷新为“已销假” |
| `sse:workflowRequestNew` | `shared/sse.js`（转发后端 `workflow:request-new`） | `mod-student-affairs`（class-*）/ `mod-lesson-review`（调课三类）/ `mod-classroom`（record-modify 确认窗）/ `mod-mobile-home` | `{ id, type, title, ...rowOut }` | 教务处/教师提交申请时实时推送审批方（SSE 三级频道 role:/teacher:） |
| `sse:workflowRequestReviewed` | `shared/sse.js`（转发 `workflow:request-reviewed`） | `mod-academic`（结果窗+reload）/ `mod-courses`（教师结果窗+课表刷新）/ `mod-class-records`（刷新台账）/ `mod-mobile-home`（toast） | `{ id, type, title, status, reviewedBy, rejectReason, result, ... }` | 审批/确认完成后推送发起人频道 |
| `sse:timetableLessonAdded` / `sse:timetableLessonCancelled` | `shared/sse.js`（转发） | `mod-courses`（学生新课/停课弹窗+课表刷新）/ `mod-mobile-home`（toast+课程视图刷新） | `{ requestId, audienceType:'class', key, kind, title, detail }` | 加课/停课审批通过后推送班级频道 |
| `sse:classroomSessionOpened` | `shared/sse.js`（转发） | `mod-courses`（学生签到卡渲染）/ `mod-mobile-home`（课程视图内签到卡） | `{ sessionId, classId, courseName, teacherName, date, start, end, signMode }` | 教师发起课堂时推送班级频道 |
| `sse:classroomSessionEnded` | `shared/sse.js`（转发） | `mod-counselor-verify`（课堂状态 Tab toast+刷新）/ `mod-mobile-home` | `{ sessionId, classId, className, courseName, teacherName, date }` | 课堂结束时推送导员+教务处频道 |
| `sse:academicStudentsChanged` | `shared/sse.js`（转发） | `mod-academic`（教务处通知窗+reload） | `{ title, detail }` | 学生处/IT 直改学生数据后推送 role:教务处 |
| `sse:surveyPublished` | `shared/sse.js`（转发 `survey:published`） | `mod-survey` / `mod-mobile-home`（受众角色 toast+待填列表刷新） | `{ surveyId, kind, title, deadline }` | 问卷/投票发布时按受众定向推送（role:/class:/teacher: 组合）并落通知表进消息 tab |
| `sse:surveyClosed` | `shared/sse.js`（转发 `survey:closed`） | `mod-survey` / `mod-mobile-home` | `{ surveyId, kind, title }` | 问卷关闭时推送受众频道 |
| `sse:surveyReminded` | `shared/sse.js`（转发 `survey:reminded`） | `mod-survey` / `mod-mobile-home`（受众 toast+刷新） | `{ surveyId, kind, title }` | 催填提醒推送未填者所在频道（学生 class/role 级、教师逐人） |

---

## 七、UI 设计规范与视觉审查系统（Design System & UI Review，2026-10-22 建立）

> **[强制]** 后续任何新 UI / 改版必须遵循本章规范创建，确保全项目审美视觉统一；收尾必须执行 §7.6 UI 审查 SOP。本章是 §〇.7 铁律的系统化展开，冲突时以本章细则为准。

### 7.1 设计令牌（唯一来源：`core/css/tokens.css`，明暗双主题自动切换）

| 类别 | 令牌 | 浅色值 | 用途 |
| :--- | :--- | :--- | :--- |
| 主色 | `--google-blue` / `--google-blue-soft` | #1A73E8 / #E8F0FE | 主操作、选中态、链接、强调数字 |
| 成功 | `--mint` / `--mint-ink` / `--mint-soft` | #81C995 / #17653B / #E7F6EC | 已同意/已销假等正向状态 |
| 危险 | `--danger` / `--danger-soft` | #D93025 / #FDE8E7 | 拒绝/解散/移出/删除等破坏性语义 |
| 点缀 | `--purple` | #8B7CF6 | 系统管理类模块主题色 |
| 文字 | `--on-surface` / `-2` / `-3` | #0F172A / #475569 / #64748B | 主文/次文/弱文三级 |
| 边框 | `--outline` / `--outline-strong` | rgba(100,116,139,.18) / .28 | 常规边/输入框边 |
| 表面 | `--surface-card` / `low` / `mid` / `high` | #FFF / #F1F5F9 / … | 卡片/内嵌底/分区底 |
| 圆角 | `--radius-xl/lg/md` / `--radius-pill` | 24/18/14px / 9999px | 大卡/面板/控件/胶囊 |
| 阴影 | `--shadow` / `--shadow-float` | — | 卡片静置/浮层弹窗 |
| 缓动 | `--ease` | cubic-bezier(.2,.8,.2,1) | 全部 transition 统一曲线 |
| 字体 | body font-family | Inter, ui-sans-serif, system-ui, … "Microsoft YaHei" | 严禁引入新字体族 |

**禁令**：UI 中严禁硬编码颜色/圆角/阴影字面量（临时调试除外），一律引用令牌；新增语义色先补 tokens.css（含暗色块 `[data-theme="dark"]` 同名变量）再使用。

### 7.2 间距节奏体系（4px 基数，弹窗链为强制标准）

全局间距只能取 **4 / 6 / 8 / 10 / 12 / 14 / 16 / 20** px（再往上是 24/32 容器级留白）。核心比例：
- **弹窗垂直节奏链（强制，2026-10-22 实测校准）**：面板上下 padding 对称（PC `20px 22px 20px`，in-host 移动端 `16px 14px 16px`）；标题→说明文字 `10px`；文字→控件 `10px`；控件→按钮行 `10px`；按钮行内距 `10px`（即**控件到按钮总间隔 20px，形成内容/操作分节**）。实测链：`20/20 边距 + 10/10/10/10 块距`，双端一致。
- **页面卡片**：`section-header` padding `19px 20px 14px`（标题区呼吸感，允许上大下小）；内容区左右 `20px`（移动端 `15px`）；`flow-foot` padding `13px 20px`（顶边框分隔）。
- **列表/网格**：条目间 `gap 8–10px`；卡片内子块 `gap 6–8px`。
- **对称性铁律**：任何“文字块与其下方按钮行/面板上下边距”必须上下对称（±0px）；块间距允许层级性差异（分节 20 > 块间 10），但同一层级必须一致。历史教训：`.wizard-text { margin:10px 0 4px }` 上大下小 2.4 倍被用户实锤（2026-10-22 已修）。

### 7.3 字体层级（字重为可变字体体系，必须用现有档位）

| 层级 | 字号 | 字重 | 用途 |
| :--- | :--- | :--- | :--- |
| 页面主标题 h1 | 依宿主 | 780+ | 每模块唯一 |
| 卡片标题 | 13–15px | 760–770 | section-title / 班级卡名 |
| 控件/行标题 | 12–13.5px | 740–760 | 学生名/教师名/弹窗强调 |
| 正文/说明 | 12px（wizard-text） | 400–650 | 说明文字、事由 |
| 辅助 | 10–11px | 600–650 | 学号 code/计数 em/提示 |
| 数字强调 | 同级+1px | **800** | 统计数字、括号内加粗数字（数字另加蓝色） |
| 气泡徽标 | 10px（移动 9px） | 700 | 蓝底白字/红底白字圆角气泡 |

**禁令**：字重只能取 400/600/650/700/740/760/770/780/800 现有档位；**字重视觉验收以 getComputedStyle 为事实源**（视觉模型对小字号 CJK 字重辨识不可靠，踩坑 #14）；数字用 `font-variant-numeric: tabular-nums`。

### 7.4 组件规范（骨架类归宿主全局，模块只写私有前缀类）

- **页面骨架**：`welcome-row`（页头）+ `surface section-card`（卡片）+ `section-header`（题+工具）+ `flow-foot`（底注）；双栏布局参照 `.aca-split`（grid `220px 1fr`，≤900px 单栏）。
- **顶部切换滑块**：一律复用宿主 `.segmented`（灰底胶囊容器 + active 白色浮起 + `role="tab"`/`aria-selected`），同款交互见登录页与教务管理；严禁模块自造 Tab 样式。
- **按钮**：`.btn` 基类 + `primary`（蓝渐变主操作）/ `danger`（红破坏性）/ `ghost`（次级）/ `tonal`（软底）/ `compact`（紧凑）；危险操作必须 `danger` 且配确认弹窗。
- **状态胶囊**：`leave-pill` + warn/ok/done/bad/mut（浅底深字）；**实底气泡**（蓝底白字“近期请过假”/红底白字“有被驳回记录”）用 `.tl-bubble.blue/.red` 模式（移动端 `.m-tl-bubble`），二者语义分工：胶囊=状态、气泡=标记。
- **弹窗**：一律 `openMiniDialog`（共享件），结构固定为 `wizard-title → wizard-text → 控件区 → wizard-foot.center`；移动端传 `inHost:true` 限制手机框内。**弹窗内使用的类必须定义为宿主全局样式**（components.css），严禁写在模块前缀下（踩坑 #05）。
- **勾选行**：`.aca-pick-row`（双列网格）+ 移出场景 `.out`（红警示态）。
- **显隐**：显式 `display` 的元素用 `hidden` 切换必须配套 `[hidden]{display:none}` 规则（全项目已三次踩坑，§3.3 铁律 3）。
- **图标**：仅用 `shared/icons.js` SVG sprite（`icon(name)`），严禁引入图标库/emoji 充当功能图标。

### 7.5 语义与交互态约定

- 语义色固定：蓝=主操作/选中/信息；红=危险/拒绝/移出；绿=成功/同意/销假；灰=禁用/弱化。**严禁用红色做非破坏性装饰、严禁用蓝色表达失败**。
- 交互态：可点击元素必须有 `cursor:pointer` + hover 反馈（背景 `--surface-low` 或边框变 `--google-blue`）；disabled 必须 `.none` 灰显（文字降为 `--on-surface-3`）且逻辑上拦截（按钮 `disabled` 属性双保险）。
- 空态：居中虚线框（`border:1px dashed var(--outline)`）+ 大图标 + 主句（`--on-surface-2`）+ 弱句（`--on-surface-3`）。
- 反馈：操作结果走 toast；表单校验失败用 `--danger` 边框 + placeholder 提示（不发 alert）。

### 7.6 UI 审查 SOP（收尾强制执行，替代旧 §〇.7 粗粒度要求）

1. **截图审查**：对全部受影响视图（含弹窗展开态/浮层/空态/暗色主题若涉及）逐张截图，检查：布局无错位溢出截断、无文字粘连、间距符合 7.2 节奏、语义色符合 7.5、双端同步一致。
2. **computed 核验**（与截图并行，缺一不可）：关键布局查 `display/position/尺寸`；间距查实际 rect 差值是否落在节奏档位；字重/颜色查 getComputedStyle；样式表加载后查 `document.styleSheets` 规则数无缺失（吞规则排查）。
3. **事实源原则**：视觉模型结论与 computed 冲突时**以 computed 为准**；仅视觉模型口头判断不足以定案或返工。
4. **双端必测**：PC 与 m-dev1 移动端各自走一遍核心交互（§〇.8 双端同步铁律）。
5. **回归扫描**：本模块外受共享样式影响的视图抽查（改 components.css/tokens.css 时全量抽查）。
6. 全部通过后在 DEV_LOG 记录“UI 审查：N 截图 + computed 核验项”方可交付。

> AI生成
