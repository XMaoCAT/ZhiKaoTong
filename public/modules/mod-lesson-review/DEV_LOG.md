# 模块开发与交接日志：`mod-lesson-review` (调课审批)

## 1. 模块元数据与架构自检
- **模块路径**：`modules/mod-lesson-review/`
- **挂载插槽**：`#mainViewContent`
- **支持端口**：`pc`（移动端属 P11）
- **开放群组**：`教务处`, `IT管理员`
- **物理可删除性自检**：[通过] 无跨模块 import（仅 shared/roles + shared/api-workflow + shared/leave-wizard）；布局复用宿主全局 aca-* 骨架类；`unmount` 解绑 `sse:workflowRequestNew` 监听并清空容器；删除后侧栏/landing 自动隐藏（registry 过滤），零报错。

## 2. 功能开发进度清单 (Progress & Todo List)
- [x] 2026-10-24 **P7 模块创建（开发计划 §8.4b，D9 拆分）**：双 Tab（segmented）——
  - **待审批**：add-lesson/teacher-leave/absence-cancel 三类列表（fetchRequests 过滤 REVIEW_TYPES）→ 审批弹窗（摘要+展开细则 detail 行+**teacher-leave 签名图/图片材料展示**+同意/驳回必填原因红框拦截）→ reviewRequest
  - **审批历史**：全状态列表（含审批人/驳回原因/result 快照）
  - **实时**：`sse:workflowRequestNew` → toast+徽标（em.aca-badge）+列表刷新；挂载 updateBadge
- [x] 2026-10-29 P11 移动端视图已同步完整版（mod-mobile-home renderLessonReviewView：待审批+审批弹窗含签名图+审批历史区，见其 DEV_LOG B2）

## 3. 跨模块事件通信契约 (EventBus Contracts)
- **对外触发事件 (Emits)**：
  - `ui:toast` -> `{ message }`（操作反馈；SSE 收到新申请提示）
- **监听外部事件 (Listens)**：
  - `sse:workflowRequestNew` -> 教师/教务处提交申请时（shared/sse.js 转发）刷新徽标+列表（`unmount` 中已解绑）

## 4. ⚠️ 踩坑记录与避坑指南 (Pitfalls & Lessons Learned)
> **[AI 接手铁律]**：任何后续接手修改本模块的 AI 模型，在编写代码前必须仔细阅读下表，严禁推翻已验证的修复方案或重蹈覆辙！

| 编号 | 历史 Bug / 踩坑现象描述 | 根本原因分析 (Root Cause) | 最终验证解决方案与代码禁令 (Mandatory Fix & Rule) |
| :--- | :--- | :--- | :--- |
| #01 | （架构预防）教师请假签名 dataURL 直接拼入 innerHTML | XSS 面 + 引号转义风险 | 签名图/材料图均以 `src="${url}"` 属性渲染（dataURL 无尖括号风险但仍经 esc 校验来源）；**禁令**：payload 中的用户文本一律 esc()，仅 data:image URL 可直拼 src |

> AI生成
