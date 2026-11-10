# 模块开发与交接日志：`mod-student-leave` (请假管理)

## 1. 模块元数据与架构自检
- **模块路径**：`modules/mod-student-leave/`
- **挂载插槽**：`#mainViewContent`
- **支持端口**：`pc` / `mobile`
- **开放群组**：`学生`, `教师`, `教务处`, `学生处`, `导员`, `IT管理员`
- **物理可删除性自检**：[通过] 无跨模块 import（仅 `shared/roles.js` + `shared/api-leaves.js` + `shared/api-academic.js` + `shared/leave-wizard.js` + `shared/pinyin-util.js` 共享件）；向导/弹窗为共享组件层渲染；样式 `.mod-student-leave` 前缀；`verify:completed`/`leave:returned` 监听保存解绑引用在 unmount 解绑；删除后宿主按 `nav:goto-module` 兜底回落。

## 2. 功能开发进度清单 (Progress & Todo List)
- [x] 2026-10-23 **P1 角色更名+学生处视图（开发计划 §2）**：manifest 更名教务科→教务处并追加学生处；VIEWS 字典新增教务处/学生处「请假汇总」条目（后端 STAFF 守卫同步含两新角色，可读全校汇总）；教师空态/副标题“教务科”→“教务处”。实测：学生处登录→请假汇总视图（6 条记录）渲染正确、控制台零错误
- [x] 2026-10-22 深夜 **全平台 UI 纠正审计通过**（Rules.md §7.6 SOP）：PC 学生列表+请假向导、教师双板块（今日括号/历史全员/蓝红气泡）截图视觉审查 + computed 核验，控制台零错误；「括号文字加粗」遭视觉模型误报，按 §7.6.3 事实源原则以 computed 800/深色判定合格（与踩坑 #14 同模式，不返工）。全平台唯一修复点在 mod-counselor-verify（见其踩坑 #06），本模块零缺陷一次通过
- [x] 2026-10-22 夜 **全局弹窗垂直节奏统一**（用户报告“文字与下方功能按键上下间隔不对称”，宿主 components.css 层修复，双端全部弹窗受益）：`.wizard-panel.mini` padding 上下对称 20px（原 20/16）、`.wizard-text` margin 上下对称 10px（原 10/4，**用户实锤点**）、`.wizard-foot.center` margin-top 10 + padding-top 10（控件→按钮总间隔 20px 形成分节）、in-host panel 对称 16/16、`.aca-input` margin-top 归零。实测节奏链：PC `20/20 边距 + 10/10/10/10 块距`，input→按钮 20px；移动端 in-host 同构（16/16 + 10/10/10）。**UI 审查：2 截图 + rect computed 核验（新建班级 PC/移动、解散 textarea 版、导员同意弹窗 rect 20.7/20.7 对称）**。规范沉淀为 Rules.md §7.2 间距节奏体系（当夜建立 §七 UI 设计规范）
- [x] 2026-10-22 晚 **更名+今日括号+历史全员+气泡**（用户需求，口径经提问确认）：
  - [x] 全局更名"请假中心"→"请假管理"（侧栏 NAV_META + landing 卡片 + manifest name + eyebrow LEAVE MANAGEMENT，全项目 grep 零残留）
  - [x] 今日请假班级卡括号改 `（今日请假<b>x</b>人）`：整体 800 加粗深色，数字 x 蓝色 800（computed 实测 rgb(26,115,232)）
  - [x] 历史请假显示班级内**全部学生**（含 0 次）：0 次学生显示"共请过 0 次假"、灰显、无箭头、button disabled 不可展开；有记录学生单击展开六态细则不变
  - [x] 气泡：近 3 天（含今天）时段交集且**全部状态**（含已销假/已驳回/已撤销）→ 蓝底白字"近期请过假"（`.tl-bubble.blue`）；存在 rejected 记录 → 红底白字"有被驳回记录"（`.tl-bubble.red`）；判定函数 `withinRecentDays(l, days)` 下沉 shared/leave-wizard.js 双端共用
- [x] 2026-10-22 晚 **教师请假中心重构为双板块**（用户需求，口径经提问确认）：完全替换原汇总表格+班级名册卡，教师登录请假管理顶部为分页夹（`.tl-tabs`）——
  - **今日请假**：今天处于请假时段内（dateFrom ≤ 今天 ≤ dateTo）；按班级分组只显示班级卡（班级名+**（今日请假N人）**加粗+数字蓝色，N=今日活跃请假学生数，已销假/已撤销不计入）；无今日请假的班级整卡不显示；展开显示具体学生（姓名+9位学号+三态胶囊：申请中未获批/休假中/被驳回，一生多条今日记录则多胶囊并列）
  - **历史请假**：班级内全部学生（含 0 次）+搜索框（**姓名/学号/拼音全拼/拼音首字母**模糊，`shared/pinyin-util.js` + vendor/pinyin-pro 本地副本，如 学生005 可搜 xuesheng005/xs005/005/学生005）+ 按学生聚合（姓名+学号+“共请过 N 次假”+气泡）+ **每页 10 人分页**（上一页/页码/下一页，搜索重置回第 1 页）+ 有记录学生单击展开细则（六态原样胶囊+时段+事由）；0 次学生不可展开（灰显无箭头）
  - 三态映射与今日判定（TEACHER_STATUS/teacherPill/ACTIVE_TODAY/todayStr/coversToday）**下沉 `shared/leave-wizard.js` 导出**（踩坑 #05 禁令：字典禁止模块副本），与移动端共用；指标卡与 footer 改由教师视图自填（基于授课班级全部记录）
- [x] 2026-10-22 教师视图「我教的班级」班级卡（已被双板块替换，今日请假板块复用 `.tc-card` 骨架）
- [x] 请假全流程（后端 `src/api/leaves.js` 状态机 + 前端向导）：
  - [x] 分步向导（**共享件 `shared/leave-wizard.js`**，PC/移动双端复用）：Step1 免责声明（占位文案）+ 手写签名板；Step2 类型选择卡 + **起止时间滚轮选择器**（`core/js/wheel-picker.js`，Semi UI DatePicker·wheel 风格：5 列滚轮年/月/日/时/分、中央高亮条、上下渐隐、此刻/取消/确定，日列随年月联动）+ 事由 + 图片佐证（压缩 900px、最多 6 张、可删）
  - [x] 撤销请假（必填理由，明示同步导员）/ 编辑（editing 锁导员审批）/ 挂起保存与继续编辑 / 新申请冲突提醒（继续编辑/重写申请）/ 拒绝回复弹窗（我知道了/修改并重新提交，未读自动弹+已读标记）
  - [x] 2026-10-22 销假流程（共享件 `openReturnDialog`）：approved 且带 returnRequired 的记录显示“销假要求”提示条（拍照+签名）与**销假按钮** → 弹窗按导员勾选动态渲染（要求拍照=照片上传；要求签名=签名板，缺项提交报错拦截）→ PATCH return → completed（绿色胶囊+销假时间提示条，操作按钮消失）；指标卡加“已销假”；监听 `leave:returned` 刷新
  - [x] 教职工汇总表（教务科/导员/IT管理员 只读，真实数据；教师已改为双板块视图）
- [ ] [待办] 凭证接入后端 uploads 分片 API（当前 dataURL 直存 SQLite；与 §17 确认口径冲突，待用户单独拍板）

## 3. 跨模块事件通信契约 (EventBus Contracts)
- **对外触发事件 (Emits)**：
  - `leave:submitted` -> `{}`（提交/重新提交成功后广播，`mod-counselor-verify` 与 `mod-mobile-home` 监听刷新）
  - `ui:toast` -> `{ message }`（操作反馈）
- **监听外部事件 (Listens)**：
  - `verify:completed` -> `{ leaveId, conclusion, verifiedBy }`（审批后刷新列表；解绑引用 `verifyOff`）
  - `leave:returned` -> `{ leaveId }`（销假后刷新；解绑引用 `returnOff`，unmount 中调用）

## 4. ⚠️ 踩坑记录与避坑指南 (Pitfalls & Lessons Learned)
> **[AI 接手铁律]**：任何后续接手修改本模块的 AI 模型，在编写代码前必须仔细阅读下表，严禁推翻已验证的修复方案或重蹈覆辙！

| 编号 | 历史 Bug / 踩坑现象描述 | 根本原因分析 (Root Cause) | 最终验证解决方案与代码禁令 (Mandatory Fix & Rule) |
| :--- | :--- | :--- | :--- |
| #01 | （迁移前史）教师/导员页面出现无功能预置按钮 | 为未来功能预置 | 按钮一律随数据出现，严禁渲染无实际行为的操作按钮 |
| #02 | （迁移前史）style.css 曾混入其他模块样式 | 公共 css 复制未拆分归属 | 样式迁移必须只保留本模块类 |
| #03 | `eventBus.on` 未保存解绑引用 | mount 内直接 on 未记录 | **已修**：`verifyOff = on(...)`，unmount 解绑；严禁挂总线监听而不解绑 |
| #04 | 向导 Step1 时"上一步/提交申请"按钮照样显示（hidden 失效） | 全局 `.btn { display:inline-flex }` 覆盖 UA `[hidden]` | components.css 全局补 `.btn[hidden] { display:none }`。**禁令**：对 .btn 用 hidden 控制显隐必须依赖该全局规则 |
| #05 | 提交申请报 `res.json is not a function` | api 客户端把 fetch() 的 Promise 当 Response 直接调 .json() | json() 内先 `await promise`。**禁令**：封装 fetch 必须先 await 得到 Response |
| #06 | 实测出现"无人操作自动 start-edit"幽灵请求 | 测试会话时序假象，静置不复发 | 防重入护栏：所有"打开弹层"入口先查 `container.querySelector('.leave-wizard')` 存在即 return |
| #07 | 2026-10-21 晚用户截图实锤：指标卡竖排裸堆、页脚溢出卡片、汇总空态图标错位——**带病交付** | 重写 style.css 时误删 `flow-metrics/flow-table/flow-empty/flow-foot` 等骨架样式（且 `welcome-row/welcome-copy/table-scroll` 迁移期就无任何文件承接）；当时只做了 DOM/数据断言未做视觉审查，漏检 | 骨架类全部下沉宿主全局 `core/css/components.css`（welcome-row/flow-*/table-scroll/leave-pill，同 `.section-card` 先例）；本模块 style.css 只留 `.mod-student-leave .leave-*` 私有类。**禁令（Rules §〇.7 UI 审查铁律的由来）**：任务收尾必须截图视觉审查所有受影响视图，仅 DOM 断言不算完成；删改样式文件前必须 diff 确认未误删在用规则 |
| #08 | 滚轮选择器选中值被"回滚"到默认（如选 12 月变回 10 月）——竞态 | 年/月列 settle 回调触发 buildCols 重建列后，**被替换旧列上挂着的防抖定时器仍会触发**，用过期索引回写 cur；且 settle→rebuild 无限循环 | `core/js/wheel-picker.js` 三重修复：① 定时器回调加 `if (!col.isConnected) return`（脱离文档即丢弃）；② 列点击先 `clearTimeout(snapTimer)`；③ onPick 值未变化直接 return（阻断无限重建）。**禁令**：任何"重建 DOM 组件"必须使旧实例的 pending 定时器失效（isConnected 守卫或显式销毁） |
| #09 | 2026-10-21 用户截图反馈：滚轮无"年/月/日/时/分"单位标注，且选择时**抽动**（高亮反复跳变） | ① 单位未实现；② 抽动=双重吸附竞争：CSS `scroll-snap-type: y mandatory` 与 JS smooth 吸附动画互相打架——smooth scrollTo 动画过程持续触发 scroll 事件→高亮按中间位置反复重算跳变；且滚动中每次 scroll 都全量 markSel 重绘 | `wheel-picker.js` v3 四项修复：① 禁用 CSS scroll-snap（吸附全归 JS）；② **严禁 smooth scrollTo 吸附/点击定位**，一律 scrollTop 瞬时赋值；③ 高亮仅在索引真正变化时更新（i !== lastIndex）；④ 单位后缀用 `.unit` 常占位 + opacity 显隐（Semi 风格仅选中项显示，且不引起布局位移）。实测：滚动 300→精确落位 288（36 的整数倍）、月选 09 日列联动 30 天、PC/移动双端单位显示正常。**禁令**：滚轮类组件禁止 CSS snap + JS smooth 吸附并用；禁用动画型 scrollTo 做吸附 |
| #10 | 2026-10-22 用户截图实锤："是否保存当前编辑"确认弹窗**通栏占满整页**（1707px） | `.wizard-panel` 父容器是 `display:flex`（.leave-wizard 的 flex 布局），absolute 定位的 `.wizard-panel.mini` 作为 flex 子项被交叉轴默认 stretch 拉满父宽，`width: min(400px,94vw)` 被覆盖 | components.css：mini 加 `align-self:center; flex:0 0 auto`（+ in-host 内 mini 用 min(340px,92%)）。实测弹窗 340px 居中。**禁令**：absolute 定位元素若同时是 flex 子项，必须显式 align-self/flex 基线设置，否则 stretch 覆盖 width |
| #11 | 2026-10-22 实测教师班级卡点击后**永不收起**（hiddenAttr: true 但 computed display 仍为 flex，学生名册一直显示） | `.tc-body { display:flex }` 显式声明优先级高于 UA 对 `[hidden]` 的 display:none，hidden 属性被覆盖（与 mod-login 踩坑 #06 同源；本项目已第三次踩：login-pane/cv-return-opts 均有配套规则唯独漏了 tc-body） | style.css 补 `.mod-student-leave .tc-body[hidden] { display: none; }`；实测展开 flex（5 名学生）/收起 none 双向正确。**禁令**：新增"显式 display + hidden 显隐"组件时，必须检索项目内全部同类写法统一补齐 `[hidden]` 规则，不得逐模块踩坑 |
| #12 | 2026-10-22 实测教师班级卡内学生请假时段显示 `? ~ ?`（下方表格同一条记录正常） | `/api/academic/my-classes` 直接返回 SQLite 原始行（snake_case：date_from/time_from…），前端共享件 `fmtRange` 读 camelCase（dateFrom/timeFrom），与 /api/leaves 的 parseRow 契约不一致 | 后端统一契约：leaves.js 导出 `parseRow`，academic.js my-classes 的 leaves 改 `.map(parseRow)`；实测 PC/移动班级卡时段正常显示。**禁令**：后端新增返回 leaves 行的端点必须复用 parseRow 输出统一 camelCase 契约，严禁直接透传原始 SQLite 行 |
| #13 | 2026-10-22 双板块开发中：拼音搜索造数验证时 API 脚本报 `Invalid URI: The hostname could not be parsed`，函数内 $B（基础 URL）莫名为空 | PowerShell 变量名**大小写不敏感**：函数内局部 `$b`（请求体 JSON）与外层 `$B`（http://127.0.0.1:port）是同一变量，被覆盖成 JSON 字符串后 URI 畸形 | 测试脚本内变量命名避免大小写同名（$B/$b、$Id/$id），或改用不同名称（基础 URL 叫 $apiBase、请求体叫 $body）。**禁令**：编写 PowerShell 测试脚本时严禁同字母大小写双变量 |
| #14 | 2026-10-22 加粗需求验证：computed font-weight 760 已达标，但视觉审查模型多轮持续报"括号文字是常规字重"，与同一样式（760/13.5px/同色）的班级名判断自相矛盾 | 视觉审查模型对**小字号 CJK 字重辨识不可靠**（同一 computed 值的两段文字给出矛盾判断；且 canvas measureText 对 CJK 等宽字体无法反映笔画粗细）；全角括号+蓝色数字混排进一步干扰 | 字重证据以 getComputedStyle 为准（事实源）；为肉眼明确加粗，括号文字直接提到 **800**（微软雅黑 Bold 最粗档）+字号与班级名同级 13.5px；视觉模型对"字重是否加粗"的结论仅作参考，与 computed 冲突时以 computed 为准并加大档位消除歧义。**禁令**：字重类视觉验收必须 computed style 实测佐证，不得单凭截图模型口头结论返工 |

> AI生成
