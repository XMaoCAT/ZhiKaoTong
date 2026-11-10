# 模块开发与交接日志：`mod-counselor-verify` (待审批)

## 1. 模块元数据与架构自检
- **模块路径**：`modules/mod-counselor-verify/`
- **挂载插槽**：`#mainViewContent`
- **支持端口**：`pc`
- **开放群组**：`导员`, `IT管理员`（学生/教师在加载器阶段即被 manifest 过滤，不加载本模块）
- **物理可删除性自检**：[通过] 跨模块依赖仅共享层（`shared/roles.js` + `shared/api-leaves.js` + `shared/leave-wizard.js` 的 STATUS/statusPill 等纯函数）；样式 `.mod-counselor-verify` 前缀；`leave:submitted`/`leave:returned` 监听均保存解绑引用；删除后导员登录默认页由宿主 `nav:goto-module` 兜底回落工作台首页，零报错。

## 2. 功能开发进度清单 (Progress & Todo List)
- [x] 2026-10-24 **P8/P10 三 Tab 重构 + D8 收窄 + 耽误课（开发计划 §8.5/§10.2）**：顶部 segmented 三 Tab（**待审批**=pending+editing 队列 / **历史**=全状态留痕 / **课堂状态**=违规汇总卡+绑定班近期课堂+签到详情弹窗+课堂结束 SSE toast）；审批列表按 counselor_classes 绑定班级收窄（未绑定显示空态引导"联系教务处分配"）；同意/拒绝弹窗注入**将耽误的课程清单**（affectedLessons 后端单源计算——审批依据；P12 实修时区 bug 后日期/星期一致）；离开未绑定守卫（approve/reject 403）。监听 sse:classroomSessionEnded（unmount 解绑）。
- [x] 2026-10-22 深夜 **全平台 UI 纠正审计通过**（Rules.md §7.6 SOP）：PC 5 角色 + 移动 4 角色 + 样式表 cssRules 全量核对 + 双端控制台零错误；审计中揪出并修复本模块唯一问题——拒绝弹窗 `cv-reason-input` 基线空隙（见踩坑 #06），复验 textarea→按钮 20px 达标、面板上下对称差 0px
- [x] 2026-10-22 夜 **弹窗垂直间距对称化**（用户报告“文字与下方按钮上下间隔不对称”）：`.cv-dialog-panel` padding 底 16→20（上下对称 20/20）、`.cv-dialog-title` mb 12→10、`.cv-dialog-foot` 加 margin-top 10（对齐全局弹窗节奏：块间 10px/控件→按钮 20px）；rect 实测标题顶→面板顶 20.7 = 按钮底→面板底 20.7 完全对称。详见 Rules.md §七（UI 设计规范，同日建立）
- [x] 2026-10-22 销假要求上线：同意弹窗增加“是否要求学生主动销假？”开关（不需要/需要）→ 选需要时展开凭证勾选芯片（拍照/签名，至少勾选一项否则报红拒绝提交）→ PATCH approve 携带 `requireReturn { photo, sign }`；卡片显示蓝色“销假要求：拍照 + 签名”提示条
- [x] 2026-10-22 销假**备注板块**（用户需求）：同意弹窗新增 `#apNote` 备注 textarea（maxlength 300，placeholder “销假备注（选填）：如拍照具体拍什么、签名注意什么”）→ PATCH approve 携带 `returnNote`（选填）→ 学生销假弹窗（shared/leave-wizard openReturnDialog）显示“导员备注：xxx”；实测备注落库（leaves.return_note）与学生端展示均通过
- [x] 销假完成展示：completed 状态绿色胶囊“已销假” + 绿色提示条（销假时间 + 销假照片/销假签名折叠可查）；指标卡加“已销假”；监听 `leave:returned` 自动刷新
- [x] 2026-10-21 审批全流程上线（后端 `src/api/leaves.js`）：
  - [x] 待处理列表（真实数据）：学生/学号/类型/时段/事由/图片佐证缩略/学生签名（折叠查看）+ 状态胶囊 + 指标卡
  - [x] 同意：确认弹窗 → PATCH approve → approved（刷新 + toast + 广播 `verify:completed`）
  - [x] 拒绝：弹窗必填拒绝理由（明示"将返回给学生"）→ PATCH reject → rejected；理由在卡片中显示
  - [x] 学生编辑中（editing 状态）：**同意/拒绝按钮禁用** + 状态"编辑中" + 提示
  - [x] 已撤销记录显示学生撤销理由；已拒绝显示拒绝理由
  - [x] 列表排序：导员视图 pending → editing → rejected → revoked → approved → completed（待处理优先）；IT 管理员按 id 倒序
  - [x] 刷新按钮 + 监听 `leave:submitted`/`leave:returned` 自动刷新（解绑引用 leaveOff/returnOff）
  - [x] IT管理员视图：全部记录只读（无审批按钮）
- [ ] [待办] 考勤交叉核验（与考勤数据比对，业务二期）

## 3. 跨模块事件通信契约 (EventBus Contracts)
- **对外触发事件 (Emits)**：
  - `verify:completed` -> `{ leaveId: number, conclusion: '通过'|'退回', verifiedBy: string }`（审批动作成功后广播，学生端 `mod-student-leave` 监听刷新）
  - `ui:toast` -> `{ message }`（操作反馈）
- **监听外部事件 (Listens)**：
  - `leave:submitted` -> `{}`（学生提交/重新提交后刷新待办；解绑引用 `leaveOff`）
  - `leave:returned` -> `{ leaveId }`（学生销假后刷新列表；解绑引用 `returnOff`）

## 4. ⚠️ 踩坑记录与避坑指南 (Pitfalls & Lessons Learned)
> **[AI 接手铁律]**：任何后续接手修改本模块的 AI 模型，在编写代码前必须仔细阅读下表，严禁推翻已验证的修复方案或重蹈覆辙！

| 编号 | 历史 Bug / 踩坑现象描述 | 根本原因分析 (Root Cause) | 最终验证解决方案与代码禁令 (Mandatory Fix & Rule) |
| :--- | :--- | :--- | :--- |
| #01 | `eventBus.on('leave:submitted')` 未保存解绑引用 | mount 内直接调用 on 未记录解绑函数 | **已修**（2026-10-21）：`leaveOff = on(...)`，unmount 中 `leaveOff()`；严禁挂总线监听而不解绑 |
| #02 | 审批按钮在学生编辑中仍可点击（初版需求风险） | 编辑锁状态未联动按钮 | editing 状态渲染 disabled 按钮 + `.cv-note.info` 提示文案；**禁令**：审批操作必须先判 `l.status === 'pending'`，editing/approved/rejected/revoked 一律禁用（后端 PATCH 同样校验双保险） |
| #03 | 2026-10-21 晚 UI 审查：本模块 flow-* 骨架样式与 mod-student-leave 重复定义两份 | 迁移时各模块自抄一份公共骨架类 | 骨架类（welcome-row/section-*/flow-*/table-scroll/leave-pill）统一下沉宿主 `core/css/components.css`，本模块 style.css 只保留 `.mod-counselor-verify .cv-*` 私有类；**禁令**：模块样式只写本模块私有类，共用骨架一律引用宿主全局 |
| #04 | 2026-10-22 用户指示：界面名称"核实工作台"改为"待审批" | 命名应直指功能（零空话精神） | 模块标题、侧栏 NAV_META（core/main.js）、landing 卡片、manifest name 全部统一为"待审批"；**禁令**：同一功能在不同入口的名称必须同步修改，改名须全项目 grep 排查 |
| #05 | 2026-10-22 销假上线时：completed 状态胶囊显示原文"completed"而非"已销假" | 本模块自抄了一份 STATUS 字典副本（未含 completed），新增状态时两处字典漂移；且 cv-pill 类样式已在样式下沉时被删、胶囊裸靠无样式的 cv-pill 类 | STATUS/statusPill/esc/icon/fmtRange 改为从 `shared/leave-wizard.js` 导入（单一来源，含 completed），statusPill 输出全局 `leave-pill` 类直接命中宿主全局样式。**禁令**：状态字典/工具函数严禁在模块内复制副本，一律 import 共享件；新增状态时 grep 全项目排查所有 STATUS 定义点 |
| #06 | 2026-10-22 深夜全平台审计：拒绝弹窗内 textarea→按钮实测 29px，超出 §七节奏标准 20px；面板上下不对称 | `.cv-reason-input` 未显式声明 display，textarea 继承 UA 默认 `inline-block`，在 block 流面板内其行框基线对齐产生约 9px 额外空隙（与踩坑 #01 显式 display+hidden 配套规则同源的“隐性 display 陷阱”变体） | **已修**（style.css L38）：`.cv-reason-input` 显式 `display: block;` 并以 `margin-bottom: 20px` 收口。复验 rect 实测 textarea→按钮 20px 达标、面板上下对称差 0px。**禁令**：模块内任何参与垂直排版节奏的表单控件（input/textarea/select）一律显式声明 `display: block`，严禁依赖 UA 默认 display；修复后必须 rect 复测间距 |

> AI生成
