# 模块开发与交接日志：`mod-courses` (课程)

## 1. 模块元数据与架构自检
- **模块路径**：`modules/mod-courses/`
- **挂载插槽**：`#mainViewContent`
- **支持端口**：`pc`（移动端属 P11）
- **开放群组**：`学生`, `教师`, `IT管理员`
- **物理可删除性自检**：[通过] 无跨模块 import（仅 shared/roles + shared/api-timetable + shared/timetable 组件 + shared/leave-wizard）；课表 .tt-* 为宿主全局类；`unmount` 销毁 ttHandle（30s 红线定时器）+ 解绑三个 SSE 监听并清空容器。

## 2. 功能开发进度清单 (Progress & Todo List)
- [x] 2026-10-29 **C3 学生日视图 + 课程详情弹窗**：学生视图新增「周视图|日视图」segmented（切日视图默认今天，‹标签›日导航可前后翻日，标签带「（今天）」标记）+ 日导航提示文案；课程卡点击（学生/IT/教师点非本人课）→ 详情弹窗（授课教师/类型[基础课/单次加课]/时段/停课状态）；flow-foot 提示同步。组件层：shared/timetable.js setMode('day', dayIndex) 既有能力接入。实测：周 7 列→日 1 列（周五今天 2 门）→周四→周六 0 门→详情弹窗字段全对；移动端同步（m-tt-day + m-day-nav + in-host 详情）。
- [x] 2026-10-24 **P7 教师课表增强（开发计划 §7.3）**：`只看我的课|全部课程` segmented 开关（后端 scope=all 授课班全课）；点空格加课弹窗（预填 weekday/分钟[10 分钟粒度]+班级 chips[限本人授课班]+日期/起止+课程名→add-lesson 申请；提交时以所选日期实际星期为准）；点本人课停课表单（备注必填+createSignaturePad 签名板+图片材料≤6[FileReader dataURL]→teacher-leave 申请）；sse:workflowRequestReviewed 结果通知窗+课表刷新。⚠ 实修两 bug：fetchTeacherTimetable query 双问号拼接（?teacher=x?scope=mine→&）；highlightTeacher 参数逻辑反转（scope 已在服务端过滤，前端删二次过滤）
- [x] 2026-10-24 **P9 签到卡实装（开发计划 §8.3）**：SSE 收到本班课堂开启→渲染卡（课程/教师/时段+口令 input 或点击按钮+请假学生显"请假中"无按钮+已签到态）；fetchSession 拉 mySign 判定；提交 signSession→卡变"已签到"；离线兑底（挂载时 fetchOpenSessions 补拉本班 open 课堂）
- [x] 2026-10-24 **P6 模块创建（开发计划 §7.3）**：
  - **学生视图**：本班周课表（`GET /api/timetable/mine` 学生自助端点 + shared/timetable.js 组件：分钟级定位/午休线/当前时间红线 30s 重算/ongoing 描边/加课紫标/停课置灰）；**签到卡容器**（#courseSignCard + `sse:classroomSessionOpened` 监听占位——P9 实装渲染）；**新课/停课实时通知弹窗**（`sse:timetableLessonAdded/Cancelled` → openMiniDialog + 课表自动刷新）
  - **教师视图（P6 基础版）**：本人全部授课班课程合集（fetchTeacherTimetable）
  - **IT管理员**：只读课表查询（默认首班）；点击课程卡可看详情（C3）
- [x] P11 移动端已在 mod-mobile-home renderCoursesView 实现（compact 横滚+签到卡+加课/停课 in-host 弹窗）；2026-10-29 C3 补齐学生日视图+详情（同 PC）

## 3. 跨模块事件通信契约 (EventBus Contracts)
- **对外触发事件 (Emits)**：
  - `ui:toast` -> `{ message }`（操作反馈预留）
- **监听外部事件 (Listens)**：
  - `sse:timetableLessonAdded` / `sse:timetableLessonCancelled` -> 学生端新课/停课通知弹窗 + 课表刷新（`unmount` 中已解绑）
  - `sse:classroomSessionOpened` -> 签到卡渲染（P9 实装；P6 占位零 UI）

## 4. ⚠️ 踩坑记录与避坑指南 (Pitfalls & Lessons Learned)
> **[AI 接手铁律]**：任何后续接手修改本模块的 AI 模型，在编写代码前必须仔细阅读下表，严禁推翻已验证的修复方案或重蹈覆辙！

| 编号 | 历史 Bug / 踩坑现象描述 | 根本原因分析 (Root Cause) | 最终验证解决方案与代码禁令 (Mandatory Fix & Rule) |
| :--- | :--- | :--- | :--- |
| #01 | （架构预防）课表组件 30s 红线定时器若不随模块卸载清理，模块反复挂载会叠加 interval 致页面卡顿 | 组件含 setInterval（mod-mobile-home 踩坑 #03 同模式） | renderTimetable 返回 handle；模块 `unmount` 必调 `handle.destroy()`；**禁令**：使用 shared/timetable.js 的模块必须保存 handle 并在 unmount 销毁 |

> AI生成
