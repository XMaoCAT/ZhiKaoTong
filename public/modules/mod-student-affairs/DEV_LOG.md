# 模块开发与交接日志：`mod-student-affairs` (学生处)

## 1. 模块元数据与架构自检
- **模块路径**：`modules/mod-student-affairs/`
- **挂载插槽**：`#mainViewContent`
- **支持端口**：`pc`（移动端视图属 P11，mod-mobile-home renderSAView）
- **开放群组**：`学生处`, `IT管理员`
- **物理可删除性自检**：[通过] 无跨模块 import（仅 `shared/roles.js` + `shared/api-academic.js` + `shared/api-majors.js` + `shared/api-workflow.js` + `shared/leave-wizard.js` 共享件）；布局全部复用宿主全局骨架类（2026-10-24 P4 上浮的 aca-* 班级管理类）；`unmount` 解绑 `sse:workflowRequestNew` 监听并清空容器；删除后侧栏/landing 自动隐藏（registry 过滤），零报错。

## 2. 功能开发进度清单 (Progress & Todo List)
- [x] 2026-10-29 **C1 班级重命名（直改通道）**：学生管理选中班级时头部新增「重命名」按钮（编辑/解散之前）→ 弹窗输入新名（预填现名）→ POST /api/academic/classes/:id/rename（guardWrite 学生处/IT）→ toast+reload+教务处通知。教务处同功能走 class-rename 申请（mod-academic 属地）。实测：计算机2301→计算机2301测试→API 验证→申请链路还原。
- [x] 2026-10-29 **C2 违规流水筛选（类型×状态）**：违规流水区新增六 chips（全部类型/旷课/旷寝 + 全部状态/生效/已撤销，前端过滤）+ 命中 N/M 条文案（无匹配时「命中 0 / N 条（无匹配）」+空态引导）；移动端同步（mod-mobile-home SA 违规 Tab）。实测：1条→旷寝 0条→重置 1条。
- [x] 2026-10-29 **考勤规则动态化（A3 配套）**：违规与积分 Tab 预警条/低分红显/flow-foot 分值文案/登记弹窗类型 chips 分值全部改为后端动态值（fetchViolations 响应 points/warnBelow，登录时同步 #saRulesFoot）；原 POINTS/WARN_BELOW 常量 import 退役（后端 settings 单源）。
- [x] 2026-10-24 **P8 违规与积分 Tab（开发计划 §9.2）**：预警条（红底白字横幅+N 名单 chips）/学生积分表（姓名/学号/班级/当前分[<60 红]/违规计数）/违规流水（类型/分值/来源/操作人/已撤销灰线）/「登记违规」弹窗（拼音搜索选生+类型 chips[分值动态]+备注）；数据源 violations API（低分名单 low=1+流水）。
- [x] 2026-10-24 **P4 模块创建（开发计划 §一期前端）**：三 Tab（segmented 复用）——
  - **学生管理**（直改通道，WRITE_ROLES=学生处/IT）：左栏班级夹（自建+未分配+底部虚线框新建）+右栏学生列表+编辑弹窗（添加/批量添加/移出三 Tab 统一提交 members 端点）+解散弹窗（必填原因）；**建班弹窗带专业部归属 chips（D1a，GET /api/majors）**；学生处直改后自动通知教务处（后端 notifyStudentsChanged 内嵌）
  - **待审批**：class-* 三类申请列表（fetchRequests status=pending）→ 审批弹窗（摘要+展开细则 detail 行+同意/驳回必填原因 textarea）→ reviewRequest；驳回必填红框拦截
  - **审批历史**：全状态列表（含审批人/驳回原因留痕）
  - **实时**：监听 `sse:workflowRequestNew` → toast+徽标（em.aca-badge 全局）+待审批列表刷新；挂载时 updateBadge；待审批过滤已含 class-rename 第八类
- [ ] [待办] 无（违规流水筛选已交付，移动端已同步）

## 3. 跨模块事件通信契约 (EventBus Contracts)
- **对外触发事件 (Emits)**：
  - `ui:toast` -> `{ message }`（操作反馈；SSE 收到新申请时提示）
- **监听外部事件 (Listens)**：
  - `sse:workflowRequestNew` -> 教务处提交 class-* 申请时（shared/sse.js 转发）刷新徽标+待审批列表（`unmount` 中已解绑）

## 4. ⚠️ 踩坑记录与避坑指南 (Pitfalls & Lessons Learned)
> **[AI 接手铁律]**：任何后续接手修改本模块的 AI 模型，在编写代码前必须仔细阅读下表，严禁推翻已验证的修复方案或重蹈覆辙！

| 编号 | 历史 Bug / 踩坑现象描述 | 根本原因分析 (Root Cause) | 最终验证解决方案与代码禁令 (Mandatory Fix & Rule) |
| :--- | :--- | :--- | :--- |
| #01 | （架构预防）班级管理布局样式与 mod-academic 高度相似，直接复制其私有 style.css 会造成双份漂移（踩坑 #05 同类风险） | 布局类原为 `.mod-academic .aca-*` 私有前缀，跨模块不可见 | 2026-10-24 P4 将整套班级管理布局类（aca-top/main-tabs/pane-box/split/left/folders/folder/un-row/stu-*/req-*/review-*）**上浮宿主 components.css 为全局无前缀类**，mod-academic 与本模块共用零复制；**禁令**：两模块班级管理 UI 需求变更时改全局类，严禁再在本模块复制一份 |

> AI生成
