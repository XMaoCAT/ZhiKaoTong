// 功能开关：控制旧演示板块与预留模式的装配
// false = 代码保留（不加载、不渲染），仅供后期搬出改造参考，不直接引用
export const features = {
  // 旧六大板块（考勤核销中心/规则日历/学情预警/公文课件/班委督导/知识库）+ 全局搜索/通知/账号演示
  legacyModules: false,
  // 右侧 Agent 协作面板（演示时间轴 + 上传聊天）
  agentPanel: false,
  // 手机端原型预览
  mobilePreview: false,
};
