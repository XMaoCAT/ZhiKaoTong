// 演示数据与六大板块元信息（自 zhikaotong_seed_ui.html 拆分）
export const initialAttendanceData = [
  { id: '240301018', name: '林知夏', className: '物流管理 2401', time: '08:27:16', status: 'success', leave: 'LS-26020' },
  { id: '240301026', name: '周予安', className: '物流管理 2401', time: '08:39:42', status: 'pending', leave: 'LS-26027' },
  { id: '240301031', name: '陈一诺', className: '物流管理 2401', time: '未签到', status: 'danger', leave: '无匹配假条' },
  { id: '240301042', name: '赵可心', className: '物流管理 2401', time: '08:30:03', status: 'success', leave: 'LS-26011' },
  { id: '240301055', name: '王沐阳', className: '物流管理 2401', time: '08:33:57', status: 'pending', leave: 'LS-26029' },
  { id: '240301063', name: '许清禾', className: '物流管理 2401', time: '08:25:40', status: 'success', leave: '—' },
];

export const initialSteps = [
  { title: 'Excel 解析', description: '读取列名、学号与签到时间', duration: '0.8s', status: 'done', progress: 100 },
  { title: '宽限期比对', description: '按配置规则计算迟到候选项', duration: '0.4s', status: 'done', progress: 100 },
  { title: '多源假条交叉核销', description: '匹配申请、销假凭证与签到记录', duration: '1.2s', status: 'done', progress: 100 },
  { title: '异常分流', description: '将低置信度记录移交人工确认', duration: '0.6s', status: 'done', progress: 100 },
  { title: 'Word 周报归档', description: '整理摘要与周报草稿（模拟）', duration: '0.9s', status: 'done', progress: 100 },
];

export const demoModules = {
  attendance: {
    id: 'attendance', title: '考勤核销中心', caption: 'Attendance Hub', icon: 'grid', count: 6,
    description: '汇总签到、请假、销假和异常待复核记录。',
  },
  calendar: {
    id: 'calendar', title: '考勤规则与日历', caption: 'Rules & Calendar', icon: 'calendar',
    description: '为后续模块配置上课时间、宽限期、节假日、课程表和签退规则。',
  },
  warning: {
    id: 'warning', title: '学情预警与宿舍', caption: 'Student Insights', icon: 'warning', count: 3,
    description: '将高频缺勤、迟到候选项和宿舍网格信息汇总为分级待办。预警是核查线索，不自动作出处分认定。',
  },
  documents: {
    id: 'documents', title: '公文与课件中心', caption: 'Docs & Slides', icon: 'file',
    description: '为 Word 周报、辅导员述职 PPT 与课件文件预留统一入口。',
  },
  supervision: {
    id: 'supervision', title: '班委履职督导', caption: 'Class Committee', icon: 'users',
    description: '按职责维护考勤班委、寝室长等任务清单和留痕记录。',
  },
  knowledge: {
    id: 'knowledge', title: '本地隐私知识库', caption: 'Local Knowledge', icon: 'database',
    description: '预留校规、请假制度、操作手册等本地知识检索空间。实际本地化能力需由后端落实。',
  },
};
