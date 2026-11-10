# 模块开发与交接日志：`mod-survey` (问卷与投票)

## 1. 模块元数据与架构自检
- **模块路径**：`modules/mod-survey/`
- **挂载插槽**：`#mainViewContent`
- **支持端口**：`pc`（移动端在 `mod-mobile-home` renderSurveyView 同步实现，双端同步铁律 §〇.8）
- **开放群组**：`学生`, `教师`, `导员`, `学生处`, `教务处`, `IT管理员`（六角色 manifest，mount 内按角色分支渲染）
- **物理可删除性自检**：[通过] 无跨模块 import（仅 shared/api-survey + shared/api-academic + shared/leave-wizard 共享件）；弹窗内件 sv-* 为宿主全局类（components.css）；`unmount` 解绑 3 个 SSE 监听并清空容器；删除后侧栏/landing 卡自动隐藏（registry 过滤），零报错。

## 2. 功能开发进度清单 (Progress & Todo List)
- [x] 2026-10-31 **出题板块重构 S15–S24 全量交付（用户反馈：数字/日期题型不合理+需逻辑判断；开发计划《问卷出题板块重构-题型与显示逻辑.md》）**：
  - **后端**：validateSurveyPayload 重写（九类题型 schema：单选/多选/下拉/排序/填空[格式属性 any/number/date/phone/email——**原 date/number 独立题型并入**]/多行文本/量表[档位可调+两端标签+radio/star/nps 皮肤]/矩阵[行×列+单选/量表模式]/附件[≤3 个 dataURL]；otherOption「其他」补充填空；minSelect/maxSelect 多选上下限）+ visibleWhen 显示条件（多条件 且/或；来源题限之前的单选/多选/下拉；服务端环路复检）+ validateAnswers 重写（**条件引擎 visibleQuestionSet 级联判定 + 隐藏题答案强制剔除 + 九类 value 校验**）+ stats 九类适配（量表均值/矩阵行分布/排序均位/其他文本聚合/附件计数）。API 冒烟 v2 **41/41**。
  - **PC**：设计器重构（九类题型+每类专属编辑区+显示条件编辑器[折叠+多规则行+且/或+实时预览]+一键生成是否选项）+填写端九类渲染+**实时显隐**（作答变化→级联重算→题目即时出现/隐藏）+其他填空联动+回显快照；统计九类视图+CSV 适配。实测：九类卷创建→发布→填写（留校路径隐藏不拦截/离校路径其他对象）→统计全链路。
  - **移动端**：mSvFill 同步九类+显隐（与 PC 同规则镜像引擎）；实测九类作答落库。
  - ⚠ 实修四坑见 #04–#07。
- [x] 2026-10-30 **S1–S10 全量交付（开发计划《问卷与投票版块-注入式设计.md》）**：
  - **后端** `src/api/surveys.js`：3 表（surveys/survey_responses/survey_ballots）+10 端点（创建/列表/详情/发布/关闭/作答/投票/催填/统计/删除）+3 SSE 事件（survey:published/closed/reminded 三级频道定向）；投票规则引擎（每人 N 票/可否重复投同项/可否改票/结果可见性，事务内删旧插新整体覆盖改票）；匿名脱敏（明细对任何人不可见）；visibility 查看范围配置；导员双收窄（创建强制绑定班+统计/催填按绑定班）。API 冒烟 **79/79 全绿**（权限矩阵/受众定向/必填校验/票数规则/409 并发/生命周期全断言 HTTP 状态码）。
  - **PC 模块**：四类角色分支——学生/教师=待填列表+填写弹窗（题型动态渲染+必填拦截+已填回显）+投票弹窗（步进器+剩余票数+改票预填）；导员=填写情况/我的发布双 Tab+统计弹窗（条形分布+未填名单+实名明细+催填+CSV）；学生处/教务处/IT=全部问卷/我的发布+创建表单（kind 切换+题目/选项设计器+四开关+受众定向+查看范围配置）。
  - **注册链**：registry.json/NAV_META/MAIN_MODULE_FOLDERS/ROLE_ACCESS 六角色/icons(i-vote)/sse.js NAMED_EVENTS/RESET_TABLES +3 表/landing 卡。
  - **实测**：学生填写闭环（必填 400→提交→查看回显）、投票（2 票重复投→改票覆盖→after-vote 可见性）、导员统计 1/5 收窄+催填落库、教务处匿名投票创建发布+CSV（BOM 校验）、教师受众投票；PC+移动端双端控制台零 JS 错误。
- [ ] [待办] 教师发起问卷/投票（归课堂板块后期——口径 §0 Q7）；数据归档数据集扩展问卷（后续按需）

## 3. 跨模块事件通信契约 (EventBus Contracts)
- **对外触发事件 (Emits)**：
  - `ui:toast` -> `{ message }`（操作反馈）
- **监听外部事件 (Listens)**：
  - `sse:surveyPublished` -> 新问卷/投票发布（受众角色 toast+列表刷新；`unmount` 中已解绑）
  - `sse:surveyClosed` -> 关闭通知+刷新
  - `sse:surveyReminded` -> 催填提醒（受众 toast+刷新）

## 4. ⚠️ 踩坑记录与避坑指南 (Pitfalls & Lessons Learned)
> **[AI 接手铁律]**：任何后续接手修改本模块的 AI 模型，在编写代码前必须仔细阅读下表，严禁推翻已验证的修复方案或重蹈覆辙！

| 编号 | 历史 Bug / 踩坑现象描述 | 根本原因分析 (Root Cause) | 最终验证解决方案与代码禁令 (Mandatory Fix & Rule) |
| :--- | :--- | :--- | :--- |
| #01 | S7 开发中：自动化填表脚本点击"加选项"按钮后**误删了选项 1 行**再在 [2] 越界报错 | `querySelector('.sv-q-opts button.btn')` 泛选命中的是**行内删除钮**（同为 .btn 类）而非"加选项"钮（DOM 顺序在前） | "加选项"按钮加专用类 `sv-opt-add`，选择器一律用专用类。**禁令**：行内含多个同前缀按钮时严禁用 `button.btn` 泛选，必须专用类或 data 属性选择 |
| #02 | S12 审查：视觉模型报创建弹窗"未居中整体偏左" | 视觉模型对弹窗居中误报（与 mod-student-leave 踩坑 #14 同模式） | computed 实证 leftGap 318 = rightGap 318（centerDiff=0）判定合格；"查看范围"模块位于滚动区下方属长表单正常。**禁令**：弹窗居中类验收以 getComputedStyle/rect 双侧间距为准 |
| #03 | （架构预防）创建表单题目/选项设计器为 DOM 状态型动态表单 | openMiniDialog 只代理 data-act 按钮，设计器增删/类型切换需重建绑定 | 题目块增删用局部重建+事件委托；kind 切换用 sv-pane [hidden] 显隐（配套全局规则防 display 覆盖）。**禁令**：rawBody 动态控件一律创建后手动绑定（同 mod-academic #01） |
| #04 | 2026-10-31 S19 实测：矩阵题必填恒报「为必填」（已填也拦） | validateAnswers 的 isEmpty 用 `v.option == null` 判对象空——矩阵 value 是普通对象（键=行 id）无 option 键，被误判空 | isEmpty 按 q.type 分流：matrix 用 `Object.keys(v).length === 0`；其余对象（其他选项）才查 option/otherText。**禁令**：多形态 value 的空值判定必须按题型分流，严禁单表达式包揽 |
| #05 | 2026-10-31 S21 实测：填写弹窗无条件题全部隐藏、条件题反而显示 | 应用显隐时 `block.hidden = vis`——hidden 与可见同向赋值（笔误未取反） | `block.hidden = !vis`。**禁令**：hidden 赋值方向必须命名对齐（hidden=不可见），提交前 grep 复查所有 hidden 赋值点 |
| #06 | 2026-10-31 S20 实测：条件来源题下拉恒显「无可选作条件的题目」（之前题已填选项） | ① addRule 时用 prevQuestions(div) 快照——快照后新填的题目/选项不回流；② prevQuestions 用 qList.compareDocumentPosition(b, excludeBlock) 判前后——后代组合场景返回 CONTAINED_BY\|FOLLOWING(20)，PRECEDING 位恒假 | ① 快照改惰性求值（refreshSrc 在 click/change 时实时重算，保留已选值）；② 前后判定改用 querySelectorAll 索引序比较。**禁令**：compareDocumentPosition 判“兄弟前后”必须由共同父级调用且参数序正确；动态候选下拉一律惰性求值，严禁创建时快照 |
| #07 | 2026-10-31 S20 实测：题型切换后选择类题的「加选项」按钮消失 | typeEditorHtml 重写时模板遗漏 sv-opt-add 按钮（首版按钮由 bindEditorControls 动态 append，重构后未入模板） | 模板内联 `<button class="btn ghost compact sv-opt-add">`。**禁令**：编辑区模板重构后必须逐控件比对旧版（增删/其他开关/上下限/加选项四件套） |

> AI生成
