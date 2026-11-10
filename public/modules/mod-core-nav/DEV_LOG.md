# 模块开发与交接日志：`mod-core-nav` (顶栏导航壳层)

## 1. 模块元数据与架构自检
- **模块路径**：`modules/mod-core-nav/`
- **挂载插槽**：`#topbar`
- **支持端口**：`pc`
- **开放群组**：`学生`, `教师`, `教务处`, `学生处`, `导员`, `IT管理员`
- **物理可删除性自检**：[通过] 无跨模块 import（依赖宿主层 `shared/roles.js` 与 `core/js/theme.js`），样式全部 `.mod-core-nav` 前缀，`unmount` 解绑事件总线监听并清空容器；删除后顶栏插槽空置，主流程侧栏/主区不受影响。

## 2. 功能开发进度清单 (Progress & Todo List)
- [x] 2026-11-03 **批二 S7/S10：顶栏通知铃铛+全局搜索上线（待办清账批二，开发计划《待办清账四批次-设计与进度.md》§2）**：
  - **通知铃铛**：顶栏新增铃铛按钮（复用宿主 .icon-button 基类+红色未读徽标 .nav-bell-badge）；点击下拉通知列表（GET /api/notifications 最近 20 条+未读蓝点+时间）；单条点击已读+「全部已读」按钮（POST /api/notifications/read，与移动端消息 tab 同源同表）；**SSE 全事件实时刷新**（监听全部 10 个 sse: 事件→未读数重拉；下拉开着同步列表）；与个人中心浮层/搜索下拉互斥，点外部全关（document 级监听，unmount 解绑）。
  - **全局搜索**：topbar-center 新增搜索框（320×38 胶囊，1120px 以下响应式隐藏）；输入 debounce 250ms→GET /api/search→分组下拉（学生[学号·班级]/班级[人数]/教师[授课班数]/课程[教师·班级·单次加课标]）；**竞态序号防过期响应**；拼音全拼/首字母匹配（后端单源）；结果点击按角色权限跳转（学生处→student-affairs、教务处/IT→academic、课程→courses，无权限纯展示行 disabled+无箭头）；Escape 清空收起。
  - 验收：API 冒烟 21/21+双端浏览器全链路（学生处登录→教务处 API 提交班级申请→**铃铛徽标实时 +1**→下拉未读→点击已读归零；学生/导员/学生处三身份待办弹窗+搜索分组+跳转）+§7.6 computed（顶栏 76px 零回归/铃铛 40×40 圆/搜索 320×38 胶囊 radius-pill/12px·600 档位）+双端控制台零 JS 错误。
- [x] 2026-11-03 **批二 S7/S10：顶栏通知铃铛+全局搜索上线（待办清账批二，开发计划《待办清账四批次-设计与进度.md》§2）**：
  - **通知铃铛**：顶栏新增铃铛按钮（复用宿主 .icon-button 基类+红色未读徽标 .nav-bell-badge）；点击下拉通知列表（GET /api/notifications 最近 20 条+未读蓝点+时间）；单条点击已读+「全部已读」按钮（POST /api/notifications/read，与移动端消息 tab 同源同表）；**SSE 全事件实时刷新**（监听全部 10 个 sse: 事件→未读数重拉；下拉开着同步列表）；与个人中心浮层/搜索下拉互斥，点外部全关（document 级监听，unmount 解绑）。
  - **全局搜索**：topbar-center 新增搜索框（320×38 胶囊，1120px 以下响应式隐藏）；输入 debounce 250ms→GET /api/search→分组下拉（学生[学号·班级]/班级[人数]/教师[授课班数]/课程[教师·班级·单次加课标]）；**竞态序号防过期响应**；拼音全拼/首字母匹配（后端单源）；结果点击按角色权限跳转（学生处→student-affairs、教务处/IT→academic、课程→courses，无权限纯展示行 disabled+无箭头）；Escape 清空收起。
  - 验收：API 冒烟 21/21+双端浏览器全链路（学生处登录→教务处 API 提交班级申请→**铃铛徽标实时 +1**→下拉未读→点击已读归零；学生/导员/学生处三身份待办弹窗+搜索分组+跳转）+§7.6 computed（顶栏 76px 零回归/铃铛 40×40 圆/搜索 320×38 胶囊 radius-pill/12px·600 档位）+双端控制台零 JS 错误。
- [x] 2026-10-29 **个人中心「修改密码」上线（密码体系配套）**：浮层新增修改密码按钮（退出登录上方，host: document.body 共享弹窗 openChangePasswordDialog）；弹窗三字段（原密码/新密码 6–32 位/确认）→ POST /api/auth/password（会话身份校验防改他人）；成功 toast「下次登录请使用新密码」。⚠ 实修弹窗被压缩进顶栏 bug（踩坑 #08，backdrop-filter 包含块）。实测：PC 学生账号改密→新密码登录→改回全闭环
- [x] 2026-10-23 **P1 角色更名联动（开发计划 §2）**：manifest allowedUserGroups 更名教务科→教务处并追加学生处；账户按钮/个人中心浮层角色徽标随会话角色自动显示新名称。实测教务处/学生处顶栏正常
- [x] 2026-10-22 深夜 **全平台 UI 纠正审计通过**（Rules.md §7.6 SOP）：PC 5 角色登录后顶栏（品牌区/账户按钮姓名角色/主题切换/dev 会话徽标）随全角色审查通过 + 控制台零错误；零缺陷一次通过
- [x] 品牌区、dev 会话徽标（devN / m-devN）、主题切换（迁移自 `public/panels/topbar/topbar.js`）
- [x] 2026-10-21 个人中心：顶栏改为「头像+姓名/角色」账户按钮（`currentName()` 驱动，学生显学号、教师显教师01/02），点击弹浮层（logo 头像 + 姓名 + 角色徽标 + 退出登录按钮），点外部关闭；原独立退出登录按钮移入浮层
- [x] 2026-10-21 删除"本地部署"徽标（`.prototype-badge`）：模板、模块 CSS、core/components.css 全局定义及 760px 隐藏规则一并清除，零残留
- [x] EventBus 接入：`theme:change` 广播、`auth:logout` 触发、`context:user-changed` 兑底刷新姓名与角色
- [x] 迁移至规范结构（manifest + mount/unmount + 前缀样式）
- [x] 2026-11-03 全局搜索框与通知铃铛已交付（见顶部条目；原两项待办清零）

## 3. 跨模块事件通信契约 (EventBus Contracts)
- **对外触发事件 (Emits)**：
  - `theme:change` -> `{ theme: 'light' | 'dark' }`（点击主题按钮时广播，各模块自行适配）
  - `auth:logout` -> `{}`（点击退出登录；先广播再执行 `logout()` 刷新）
- **监听外部事件 (Listens)**：
  - `context:user-changed` -> 兑底刷新账户按钮姓名与角色小字（`unmount` 中已解绑）

## 4. ⚠️ 踩坑记录与避坑指南 (Pitfalls & Lessons Learned)
> **[AI 接手铁律]**：任何后续接手修改本模块的 AI 模型，在编写代码前必须仔细阅读下表，严禁推翻已验证的修复方案或重蹈覆辙！

| 编号 | 历史 Bug / 踩坑现象描述 | 根本原因分析 (Root Cause) | 最终验证解决方案与代码禁令 (Mandatory Fix & Rule) |
| :--- | :--- | :--- | :--- |
| #01 | （迁移前史）顶栏在手机调试端点重复渲染 PC 侧栏按钮 | 顶栏模板内联了视图切换按钮组，m-dev 下误触发 setViewMode('pc') | 视图切换按钮随 legacy 封存移除；m-dev 模式不渲染 PC 专属控件。**严禁**在 mobile 端口模块里提供切回 PC 的交互 |
| #02 | 样式迁移时 `.role-chip` 等共用类被旧全局 css/panels CSS 覆盖产生优先级混乱 | 同名类既存在于旧 `panels/topbar/topbar.css` 又存在于模块样式 | 迁移期模块样式一律带 `.mod-core-nav` 前缀；旧文件删除后必须回归验证顶栏视觉 |
| #03 | 2026-10-21 用户报"界面错位"：顶栏失去横条布局，品牌/徽标/按钮裸排堆叠；computed style 显示 `#topbar` 为 `display:block / position:static / height:auto / padding:0` | `.mod-core-nav .topbar` 是**后代选择器**，但 `mount()` 把 `.mod-core-nav` 类注入到了插槽 `#topbar` **自身**（同一元素 `class="topbar mod-core-nav"`），后代写法永不命中，height:76px/sticky/flex/毛玻璃 backdrop-filter/边框全部失效（`.brand` 等内部子元素为后代选择器，正常命中） | 插槽元素自身的规则必须用**同元素复合选择器** `.topbar.mod-core-nav`（含 `@media 1400px` 与 `@media 760px` 内共 3 处同步改写）；已修复并用 getComputedStyle 实测（flex/sticky/z-30/76px/blur(18px) 全部生效）。**禁令**：凡挂载到宿主插槽（#topbar/#loginStage 等）自身的样式，严禁后代写法，只能复合写法；修复依据 Rules.md §3.3 铁律 3 |
| #04 | 2026-10-29 密码体系上线后实测：个人中心弹出的「修改密码」弹窗**整体偏上被截断、遮罩只盖住顶栏一条**（截图实锤） | 弹窗 host 传了 container（#topbar）；顶栏样式含 `backdrop-filter: blur(18px)`——**backdrop-filter 会为 fixed 定位子孙创建包含块**，`.leave-wizard { position:fixed; inset:0 }` 被压缩到 76px 高的顶栏内 | 弹窗 host 改为 `document.body`（全屏遮罩正常、弹窗居中，截图复验通过）；**禁令**：凡从带 backdrop-filter/transform/filter 的容器（顶栏等）打开的全屏弹窗，host 一律 document.body，带该类属性的宿主内严禁挂 fixed 全屏件 |
| #05 | 2026-11-03 批二开发预防：顶栏三浮层（铃铛下拉/个人中心/搜索下拉）同开互踩、点外部不关闭 | 浮层各自绑定 document click 无互斥协调 | 统一 closeAllPops(except) 管理器：三浮层互斥开关；document 级 onDocClick 判定 container.contains(target)（顶栏内点击仅收搜索下拉，顶栏外全关）；onDocClick 句柄 unmount 显式解绑。**禁令**：模块内挂 document/window 级监听必须保存解绑引用，unmount 全清（本模块既有 sseOffs 数组同模式） |
| #06 | 2026-11-03 批二开发预防：搜索输入快速连续输入时，慢响应后到覆盖新结果（竞态） | 网络响应无序，旧响应后到覆盖新响应渲染 | searchSeq 递增序号：仅渲染最新一次请求结果（seq !== searchSeq 时丢弃）。**禁令**：凡 debounce+fetch 的搜索/列表刷新必须带竞态序号或 AbortController，严禁盲渲染 |

> AI生成
