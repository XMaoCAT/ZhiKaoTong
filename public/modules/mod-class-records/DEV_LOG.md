# 模块开发与交接日志：`mod-class-records` (课堂记录)

## 1. 模块元数据与架构自检
- **模块路径**：`modules/mod-class-records/`
- **挂载插槽**：`#mainViewContent`
- **支持端口**：`pc`（移动端属 P11）
- **开放群组**：`教务处`, `IT管理员`
- **物理可删除性自检**：[通过] 无跨模块 import（仅 shared/roles + shared/api-classroom + shared/api-workflow + shared/leave-wizard）；`.acr-*` 私有前缀；`unmount` 解绑 `sse:workflowRequestReviewed` 监听并清空容器；删除后侧栏/landing 自动隐藏（registry 过滤），零报错。

## 2. 功能开发进度清单 (Progress & Todo List)
- [x] 2026-10-24 **P10 模块创建（开发计划 §8.4，D9 拆分）**：
  - **课堂台账**：全量 sessions 列表（日期筛选+刷新；行内[详情][修改]）
  - **详情浮层**：签到三分类统计+学生状态/分值+课堂事件时间线
  - **修改浮层（确认制核心）**：每行 签到状态下拉 + 分值下拉 + 旷课勾选 → **不直接落库**，组装 changes[]（from=库内快照，仅收集差异项）→ `submitRequest('record-modify')` → toast"已发教师确认"；后端执行器校验 from 匹配防陈旧覆盖（§8.4 数据一致性接缝）
  - **实时**：`sse:workflowRequestReviewed`（type=record-modify）→ toast+列表刷新
- [x] 2026-10-29 P11 移动端视图已交付且增强（mod-mobile-home renderClassRecordsView：列表+详情[事件显学生名]；修改引导 PC 属确认制交互设计决策，保留）

## 3. 跨模块事件通信契约 (EventBus Contracts)
- **对外触发事件 (Emits)**：
  - `ui:toast` -> `{ message }`（操作反馈）
- **监听外部事件 (Listens)**：
  - `sse:workflowRequestReviewed` -> record-modify 申请被教师确认/驳回后刷新台账（`unmount` 中已解绑）

## 4. ⚠️ 踩坑记录与避坑指南 (Pitfalls & Lessons Learned)
> **[AI 接手铁律]**：任何后续接手修改本模块的 AI 模型，在编写代码前必须仔细阅读下表，严禁推翻已验证的修复方案或重蹈覆辙！

| 编号 | 历史 Bug / 踩坑现象描述 | 根本原因分析 (Root Cause) | 最终验证解决方案与代码禁令 (Mandatory Fix & Rule) |
| :--- | :--- | :--- | :--- |
| #01 | （架构预防）修改浮层的 from 快照若取自渲染时旧数据，教师确认时库内已变 → 后端 from 校验 400 拒绝 | 教务处打开浮层→教师同时在课堂操作→数据漂移 | changes 的 from 在浮层打开时从 fetchSession 快照读取（scoreMap/状态），仅收集与快照不一致项提交；后端 execute 二次校验 from（§8.4）；**禁令**：from 快照必须来自打开时刻的真实库数据，严禁用前端缓存旧值 |

> AI生成
