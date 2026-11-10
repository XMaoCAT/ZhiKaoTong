# 模块开发与交接日志：`mod-landing` (工作台首页)

## 1. 模块元数据与架构自检
- **模块路径**：`modules/mod-landing/`
- **挂载插槽**：`#mainViewContent`
- **支持端口**：`pc`
- **开放群组**：`学生`, `教师`, `导员`, `IT管理员`
- **物理可删除性自检**：[通过] 无跨模块 import；卡片跳转改为 `eventBus.emit('nav:goto-module')`（由宿主切换模块），删除本模块后宿主可回落默认视图，其余模块零影响；样式全部 `.mod-landing` 前缀。

## 2. 功能开发进度清单 (Progress & Todo List)
- [x] 2026-11-03 **批二 S6 复检补齐：C4 徽标取数迁移后端单源**（待办清账批二）：updateBadges 改为 `fetchTodoSummary()`（GET /api/todo/summary，src/api/todo.js 后端单源——五角色口径与 leaves/workflow GET 完全一致）；**删除旧前端过滤副本**（fetchLeaves/fetchRequests 五分支 filter 逻辑及两个 import，残留 grep=0，单源禁令闭环）；items.moduleId 与入口卡 data-badge-for 同名直映射（学生=student-leave/导员=counselor-verify/学生处=student-affairs/教务处=lesson-review/教师=classroom；本模块 CARDS 仅 5 张卡，无对应卡的 roleId 徽标 set 静默跳过——与迁移前行为一致）。实测：学生身份徽标「1」正确显示（后端单源路径）；学生处无待办徽标全隐藏；控制台零错误。
- [x] 2026-10-23 **P1 角色更名联动（开发计划 §2）**：manifest allowedUserGroups 更名教务科→教务处并追加学生处；welcome 文案随 ROLE_NOTE 自动更新（教务处“排课与授课班级分配（学生班级变更走申请）”/学生处“学生班级管理与变更审批、违规与积分”）；学生处登录仅显示请假管理卡（student-affairs 模块未建成，ROLE_ACCESS 未命中卡片自动不渲染，零空话铁律）。实测学生处/教务处 landing 渲染正确
- [x] 2026-10-22 深夜 **全平台 UI 纠正审计通过**（Rules.md §7.6 SOP）：各角色 PC 工作台首页（按角色过滤的入口卡片/身份说明行）随全角色审查通过 + 控制台零错误；零缺陷一次通过
- [x] 按角色过滤的流程入口卡片（学生2项/教师2项/导员3项/IT管理员4项，取自 `shared/roles.js` ROLE_ACCESS）
- [x] 身份职责说明行（当前身份：角色 —— 职责描述）
- [x] 迁移至规范结构；卡片点击/键盘导航改 EventBus 契约
- [x] 首页概览统计（各角色待办数量徽标，2026-10-29 C4 交付）

## 3. 跨模块事件通信契约 (EventBus Contracts)
- **对外触发事件 (Emits)**：
  - `nav:goto-module` -> `{ moduleId: string }`（点击入口卡片或键盘 Enter/Space 时触发，宿主负责切换主区模块）
- **监听外部事件 (Listens)**：无

## 4. ⚠️ 踩坑记录与避坑指南 (Pitfalls & Lessons Learned)
> **[AI 接手铁律]**：任何后续接手修改本模块的 AI 模型，在编写代码前必须仔细阅读下表，严禁推翻已验证的修复方案或重蹈覆辙！

| 编号 | 历史 Bug / 踩坑现象描述 | 根本原因分析 (Root Cause) | 最终验证解决方案与代码禁令 (Mandatory Fix & Rule) |
| :--- | :--- | :--- | :--- |
| #01 | （迁移前史）卡片直接 import renderModule 造成模块间耦合，删除目标模块后点击报错 | 旧实现由 landing 直接调用宿主 app.js 的渲染函数，形成硬依赖 | 迁移后只 emit `nav:goto-module` 事件，**严禁**在本模块 import 其他模块或直接调用宿主渲染函数 |
| #02 | （迁移前史）学生视角仍显示无权进入的"系统管理"卡片 | 卡片渲染未按 ROLE_ACCESS 过滤，点击后才被守卫拦截 | 渲染前先按 `ROLE_ACCESS[role]` 过滤卡片集合；权限外元素一律不渲染（整套系统只显示可用元素原则） |

> AI生成
