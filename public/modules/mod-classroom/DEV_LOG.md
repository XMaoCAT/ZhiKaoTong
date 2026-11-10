# 模块开发与交接日志：`mod-classroom` (课堂管理)

## 1. 模块元数据与架构自检
- **模块路径**：`modules/mod-classroom/`
- **挂载插槽**：`#mainViewContent`
- **支持端口**：`pc`（移动端属 P11）
- **开放群组**：`教师`, `IT管理员`
- **物理可删除性自检**：[通过] 无跨模块 import（仅 shared/roles + shared/api-academic + shared/api-timetable + shared/api-classroom + shared/pinyin-util + shared/leave-wizard）；`.cr-*` 私有前缀；`unmount` 清除 3s 轮询定时器并清空容器；删除后侧栏/landing 自动隐藏（registry 过滤），零报错。

## 2. 功能开发进度清单 (Progress & Todo List)
- [x] 2026-10-24 **P10 教师确认窗（开发计划 §8.2 record-modify 双向流）**：监听 sse:workflowRequestNew→openModifyConfirm（教务处修改申请 diff 表[from→to 红绿]→同意生效/驳回必填原因）；确认后 activeSession 刷新
- [x] 2026-10-24 **P9 修复与增强**：刷新恢复进行中课堂（load 查本人 open session→fetchSession+startPolling）；课堂操作按钮统一 data-sid 属性（实修旷课/代签/撤销按钮 dataset.sid undefined bug）
- [x] 2026-10-24 **P9 模块创建（开发计划 §8.2）**：双 Tab（segmented）——
  - **发起区**：今日课程 chips（fetchTeacherTimetable 过滤今日+未停课）+ 按班级手动发起；确认弹窗选签到方式（口令/点击，口令可自定义或自动生成）
  - **课堂面板四区**：签到区（课程头/**口令 40px 大字**/已签·请假·旷课·应到计数/结束课堂）→ 随人区（学生头像网格+**开始随机 80ms 高亮轮换 3s**→定格→结果浮层[±1/±2/仅记录 chips]）→ 学生列表区（拼音搜索+行内 [+1][-1][旷课][代签][撤销旷课]，旷课态显撤销）→ 签到详情区（已签到/旷课/请假三分栏）
  - **3s 轮询**：fetchSession 刷新计数与名单（进行中课堂自动同步学生签到）；结束自动停轮询
  - **旷课撤销语义**：open 期行内撤销（还分 409→引导调课审批）
  - **历史记录**：sessions 列表 → 详情弹窗（签到统计+事件时间线）
- [x] 2026-10-24 P10 record-modify 确认窗已上线（见上）
- [x] 2026-10-29 P11 移动端视图已增强为完整版（mod-mobile-home renderClassroomView：随人/行内加减分记旷课代签/历史详情，见其 DEV_LOG B2）

## 3. 跨模块事件通信契约 (EventBus Contracts)
- **对外触发事件 (Emits)**：
  - `ui:toast` -> `{ message }`（操作反馈）
- **监听外部事件 (Listens)**：无（P10 将监听 `sse:workflowRequestNew`）

## 4. ⚠️ 踩坑记录与避坑指南 (Pitfalls & Lessons Learned)
> **[AI 接手铁律]**：任何后续接手修改本模块的 AI 模型，在编写代码前必须仔细阅读下表，严禁推翻已验证的修复方案或重蹈覆辙！

| 编号 | 历史 Bug / 踩坑现象描述 | 根本原因分析 (Root Cause) | 最终验证解决方案与代码禁令 (Mandatory Fix & Rule) |
| :--- | :--- | :--- | :--- |
| #01 | （架构预防）3s 轮询 setInterval 若不随模块卸载清理，反复挂载叠加 interval 致请求风暴 | 与 mod-mobile-home 时钟坑（#03）、课表红线定时器同模式 | 轮询句柄存模块级 `pollTimer`，`unmount` 必 clearInterval；**禁令**：任何 interval/timeout 必须有对应清理路径 |
| #02 | （架构预防）随人轮换 interval 若课堂结束/模块卸载不清除，会在后台永久轮换 DOM | 随人动画 80ms interval 独立于轮询 | 轮换句柄局部存 `pickTimer`，结束定格时 clearInterval；模块卸载时随 innerHTML 清空（网格销毁后 interval 内 DOM 操作静默）——**禁令**：动画 interval 必须带结束条件（3s 超时） |
| #03 | 2026-10-24 P9 实测旷课/代签/撤销旷课点击后报"学生不在该班级" | 渲染时操作值写在了操作键属性上（`data-absence="${id}"`）而绑定读 `b.dataset.sid`（undefined→后端 400） | 操作按钮统一携带 `data-sid="${x.id}"` 属性，操作键仅作选择器；**禁令**：动态渲染的行内操作按钮，数据属性与操作属性分离，绑定统一读 dataset.sid |

> AI生成
