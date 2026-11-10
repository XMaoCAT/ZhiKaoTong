# 智考通 Seed UI（HTML 单文件原型）

## 运行方式

1. 下载 `zhikaotong_seed_ui.html`。
2. 使用 Chrome、Edge 或 Firefox 直接打开；无需安装依赖、无需启动服务器。
3. 顶部可切换 PC / 手机预览和亮色 / 暗色主题。

## 当前已实现

- Material 3 风格卡片、导航、胶囊按钮及浅/深主题 CSS 变量。
- PC 三栏工作台：左侧 6 项导航、中间考勤核销示例、右侧 Agent Run Tracker 与任务输入框。
- 手机样机预览：角色切换、打卡圆盘、假条上传区、补卡卡片和底部四栏导航。
- 台账状态筛选、学生搜索、详情弹窗、主题切换、工作流演示、拖入文件名展示、移动端交互反馈。
- 光标跟随的微光叠层，以及 SVG `feSpecularLighting` / `fePointLight` 的轻量光照示例。
- 下游扩展插槽：`[AGENT_SLOT: CANVAS_MAIN_VIEW]`、`[AGENT_SLOT: MODAL_CONTAINER]`。
- 全局接口：`window.SmartAttendanceApp`。

## 重要边界

这是可交互的前端种子 UI，不是已连接后端的考勤系统。所有姓名、学号、统计数字、状态、时间和执行耗时均为虚构演示数据。当前不接入 TeleAgent、不读取 GPS / 校园 Wi-Fi、不上传或解析文件、不进行真实审批，也不生成 DOCX / PPT 文件。

## 给后续智能体的交接契约

全局对象包含：

```js
window.SmartAttendanceApp.theme
window.SmartAttendanceApp.viewMode
window.SmartAttendanceApp.attendanceData
window.SmartAttendanceApp.agentTimelineSteps
window.SmartAttendanceApp.registerModule(module)
window.SmartAttendanceApp.setTheme('light' | 'dark')
window.SmartAttendanceApp.setViewMode('pc' | 'mobile')
window.SmartAttendanceApp.setAgentSteps(steps)
window.SmartAttendanceApp.openModal({ title, lead, body, confirmText, onConfirm })
window.SmartAttendanceApp.showToast(message)
```

扩展模块注册示例：

```js
window.SmartAttendanceApp.registerModule({
  id: 'my-report-module',
  label: '我的报告模块',
  caption: '报告生成与预览',
  icon: 'file',
  description: '这个模块负责报告生成流程。',
  render: ({ app, root }) => {
    const section = document.createElement('section');
    section.className = 'surface section-card';
    section.style.padding = '24px';
    section.innerHTML = '<h2>报告模块</h2><p>请继续在这里实现业务。</p>';
    return section;
  }
});
```

`render` 可以返回 HTML 字符串或 DOM 节点。注册成功后，模块会追加到左侧导航。添加新组件时优先复用已有 CSS 变量（如 `--surface-card`、`--on-surface`、`--google-blue`），并通过 `setAgentSteps()` 更新运行追踪器。

## 接入真实服务前建议补齐

- 明确前端、TeleAgent、文件存储与学校系统的真实数据流向和权限边界。
- 为考勤数据建立后端 API、身份认证、角色权限、审计日志和错误处理。
- 文件解析、OCR、Word / PPT 生成必须由真实服务实现，前端只负责展示进度与结果。
- GPS / Wi-Fi 打卡必须有授权、异常兜底、防伪和人工复核机制。
- 对高风险缺勤判断保留人工复核，不能仅凭模型输出自动定责。
