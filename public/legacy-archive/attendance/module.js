// 考勤核销中心板块：欢迎区 / KPI / 跨表台账 / 下半区（默认主视图）
import { $, $$, icon } from '../../core/js/dom.js';
import { state, onSearch, renderModule } from '../../core/js/app.js';
import { showToast } from '../../core/js/toast.js';
import { openModal } from '../../core/js/modal.js';
import { runDemoFlow } from '../../panels/agent-panel/agent-panel.js';
import { demoModules } from '../../shared/demo-data.js';

const AVATAR = [
  ['#E3F4E8', '#267347'], ['#FFF0DF', '#935112'], ['#FDE5E4', '#B42318'],
  ['#E9E7FF', '#6353B6'], ['#DDF1FF', '#1D64A9'], ['#FCE7F3', '#A83D78'],
];

function rowsHtml() {
  return state.attendanceData.map((r, i) => {
    const [bg, color] = AVATAR[i % AVATAR.length];
    const statusText = r.status === 'success' ? (r.leave === '—' ? '正常出勤' : '已销假') : r.status === 'pending' ? '待核验' : '异常预警';
    const wifi = r.status === 'success' ? '校园 Wi-Fi ✓' : r.status === 'pending' ? 'Wi-Fi 待确认' : '未获取';
    const action = r.status === 'pending' ? '人工复核' : r.status === 'danger' ? '查看原因' : '查看详情';
    return `<tr data-status="${r.status}" data-search="${r.name} ${r.id} ${r.className}">
      <td><div class="student-cell"><span class="student-avatar" style="--avatar-bg:${bg};--avatar-color:${color}">${r.name[0]}</span><div><div>${r.name}</div><div class="student-meta">${r.id}</div></div></div></td>
      <td>${r.className}</td>
      <td>${r.time}</td>
      <td>${wifi}</td>
      <td>${r.leave}</td>
      <td><span class="status-pill status-${r.status}">${statusText}</span></td>
      <td><button class="text-link row-detail" data-name="${r.name}">${action}</button></td>
    </tr>`;
  }).join('');
}

function view() {
  return `
  <div class="welcome-row">
    <div>
      <div class="eyebrow"><span class="spark"></span>TELEAGENT WORKSPACE</div>
      <h1>考勤核销中心</h1>
      <div class="welcome-copy">早上好，辅导员。今天的考勤与假条核销进度一目了然。</div>
    </div>
    <div class="welcome-actions">
      <button class="btn" id="exportBtn">${icon('download')}导出台账</button>
      <button class="btn primary" id="startVerifyBtn">${icon('sparkles')}开始智能核销</button>
    </div>
  </div>
  <div class="shift-strip">
    <span class="shift-mark">${icon('clock')}</span>
    <span><strong>固定班制</strong> · 08:30 上课</span><span class="shift-sep"></span>
    <span>08:35 前免除异常</span><span class="shift-sep"></span><span>24:00 最晚签退</span>
    <span class="live-label">规则已载入（演示）</span>
  </div>
  <section class="kpi-grid" aria-label="核心考勤指标">
    <article class="kpi-card normal-mapped-surface" data-light-surface style="--glow:#1A73E8">
      <div class="kpi-top"><span>今日应考勤</span><span class="kpi-icon"><svg class="icon"><use href="#i-users"/></svg></span></div>
      <div class="kpi-value">1,286</div><div class="kpi-bottom"><span class="trend"><svg class="icon small"><use href="#i-trend"/></svg>全班覆盖</span><span>· 演示统计</span></div>
    </article>
    <article class="kpi-card normal-mapped-surface" data-light-surface style="--glow:#36A66A;--kpi-color:var(--mint-ink);--kpi-soft:var(--mint-soft)">
      <div class="kpi-top"><span>正常出勤</span><span class="kpi-icon"><svg class="icon"><use href="#i-check"/></svg></span></div>
      <div class="kpi-value">1,204</div><div class="kpi-bottom"><span class="trend"><svg class="icon small"><use href="#i-trend"/></svg>93.6%</span><span>· 应到比例</span></div>
    </article>
    <article class="kpi-card normal-mapped-surface" data-light-surface style="--glow:#FA903E;--kpi-color:var(--amber-ink);--kpi-soft:var(--amber-soft)">
      <div class="kpi-top"><span>待核销假条</span><span class="kpi-icon"><svg class="icon"><use href="#i-file"/></svg></span></div>
      <div class="kpi-value" id="pendingKpi">18</div><div class="kpi-bottom"><span class="trend warning">需要处理</span><span>· 待人工确认</span></div>
    </article>
    <article class="kpi-card normal-mapped-surface" data-light-surface style="--glow:#D93025;--kpi-color:var(--danger);--kpi-soft:var(--danger-soft)">
      <div class="kpi-top"><span>异常待复核</span><span class="kpi-icon"><svg class="icon"><use href="#i-warning"/></svg></span></div>
      <div class="kpi-value">6</div><div class="kpi-bottom"><span class="trend danger">优先处理</span><span>· 不自动定责</span></div>
    </article>
  </section>
  <section class="surface section-card" aria-labelledby="tableHeading">
    <div class="section-header">
      <div>
        <div class="section-title"><span class="section-head-icon"><svg class="icon"><use href="#i-calendar"/></svg></span><span id="tableHeading">跨表考勤与假条交叉核销台账</span></div>
        <div class="section-subtitle">关联签到记录、请假申请与销假凭证，异常项保留人工复核入口。</div>
      </div>
      <div class="section-tools">
        <button class="btn compact" id="tableRefreshBtn">${icon('activity')}刷新视图</button>
        <button class="icon-button" style="width:32px;height:32px" id="tableMoreBtn" aria-label="更多台账操作"><svg class="icon"><use href="#i-more"/></svg></button>
      </div>
    </div>
    <div class="filter-row" id="tableFilters">
      <button class="filter-chip active" data-filter="all">全部记录 <span id="allCount">06</span></button>
      <button class="filter-chip" data-filter="success">已销假</button>
      <button class="filter-chip" data-filter="pending">待核验</button>
      <button class="filter-chip" data-filter="danger">异常预警</button>
      <span class="filter-spacer"></span>
      <button class="btn compact" id="tableSearchToggle">${icon('search')}筛选学生</button>
    </div>
    <div class="table-scroll">
      <table class="attendance-table">
        <thead><tr><th>学生 / 学号</th><th>班级</th><th>签到时间</th><th>定位 / Wi-Fi</th><th>假条关联</th><th>核销状态</th><th>操作</th></tr></thead>
        <tbody id="attendanceTbody">${rowsHtml()}</tbody>
      </table>
    </div>
    <div class="table-footer">
      <span id="tableResultText">显示 6 条演示记录 · 实际数据待接入</span>
      <div class="pagination">
        <button class="page-btn" disabled>‹</button><button class="page-btn current">1</button>
        <button class="page-btn" id="fakeNextPage">2</button><button class="page-btn">3</button><button class="page-btn">›</button>
      </div>
    </div>
  </section>
  <div class="lower-grid">
    <section class="surface mini-panel">
      <div class="mini-panel-header">
        <div class="mini-panel-title"><span class="section-head-icon"><svg class="icon"><use href="#i-warning"/></svg></span>异常分流概览</div>
        <button class="btn compact" data-open-module="warning">查看预警 ${icon('chevron-right')}</button>
      </div>
      <div class="mini-kpi-row">
        <div class="mini-metric"><strong>03</strong><span>迟到待复核</span></div>
        <div class="mini-metric"><strong>02</strong><span>假条信息不全</span></div>
        <div class="mini-metric"><strong>01</strong><span>缺勤待确认</span></div>
      </div>
      <div class="mini-note">${icon('warning')}<span>风险记录只提示核查线索，不自动认定旷课或处分；最终结论需由有权限的教师确认。</span></div>
    </section>
    <section class="surface mini-panel">
      <div class="mini-panel-header">
        <div class="mini-panel-title"><span class="section-head-icon" style="color:var(--mint-ink);background:var(--mint-soft)"><svg class="icon"><use href="#i-file"/></svg></span>周报预览</div>
        <span class="status-pill status-success">草稿</span>
      </div>
      <div class="report-preview">
        <div class="report-top">
          <div class="doc-icon"><svg class="icon large"><use href="#i-file"/></svg></div>
          <div><div class="report-name">第 42 周考勤与销假工作周报.docx</div><div class="report-meta">更新于今天 09:16 · 示例预览</div></div>
        </div>
        <div class="report-lines"><span class="report-line"></span><span class="report-line"></span><span class="report-line"></span></div>
        <div class="report-bottom">
          <span class="generated-stamp">${icon('check')}模板已就绪</span>
          <button class="btn compact" id="reportPreviewBtn">打开预览</button>
        </div>
      </div>
    </section>
  </div>
  <div class="footer-note">原型说明：指标、学生、台账、耗时及时间戳均为虚构演示内容。当前页面不采集真实定位、不校验真实 Wi-Fi、不访问学校系统；附件上传与任务处理由本机服务完成。</div>`;
}

function applyFilter(root = document) {
  const table = $('#attendanceTbody', root);
  if (!table) return;
  const rows = $$('tr', table);
  let shown = 0;
  rows.forEach((row) => {
    const matchesFilter = state.activeFilter === 'all' || row.dataset.status === state.activeFilter;
    const query = state.searchTerm.trim().toLowerCase();
    const haystack = `${row.dataset.search || ''} ${row.textContent}`.toLowerCase();
    const matchesSearch = !query || haystack.includes(query);
    row.style.display = matchesFilter && matchesSearch ? '' : 'none';
    if (matchesFilter && matchesSearch) shown++;
  });
  const text = $('#tableResultText', root);
  if (text) text.textContent = `显示 ${shown} 条演示记录 · 实际数据待接入`;
  const allCount = $('#allCount', root);
  if (allCount) allCount.textContent = String(rows.length).padStart(2, '0');
}

function bind(root) {
  applyFilter(root);
  $('#exportBtn', root)?.addEventListener('click', () => showToast('导出功能为演示状态；接入后端后再生成真实台账文件。'));
  $('#startVerifyBtn', root)?.addEventListener('click', () => runDemoFlow('一键核销本周考勤'));
  $('#tableRefreshBtn', root)?.addEventListener('click', () => { applyFilter(root); showToast('台账视图已刷新（仅刷新演示界面）。'); });
  $('#tableMoreBtn', root)?.addEventListener('click', () => openModal({
    title: '台账操作',
    body: '可在此扩展批量复核、列设置、导入和导出等菜单。当前原型不执行真实数据操作。',
    confirmText: '关闭',
  }));
  $('#tableSearchToggle', root)?.addEventListener('click', () => {
    const box = $('#globalSearch');
    box?.focus();
    if (box && !box.value) box.placeholder = '输入学生姓名或学号过滤表格…';
    showToast('已聚焦顶部搜索框，可按姓名或学号过滤当前演示记录。');
  });
  $('#reportPreviewBtn', root)?.addEventListener('click', () => openModal({
    title: '周报预览 · 示例草稿',
    lead: '该窗口是报告预览插槽的占位示例。',
    body: '一、本周考勤概况：此处由后续模块自动汇总。\n二、请假与销假情况：此处展示来源记录及匹配依据。\n三、待复核事项：保留责任人、复核结论和操作留痕。\n\n当前不会创建真实 DOCX 文件。',
    confirmText: '返回工作台',
  }));
  $('#fakeNextPage', root)?.addEventListener('click', () => showToast('分页数据尚未接入，本页仅展示 6 条演示记录。'));
  $$('[data-open-module]', root).forEach((btn) => btn.addEventListener('click', () => renderModule(btn.dataset.openModule)));
  $$('#tableFilters [data-filter]', root).forEach((btn) => btn.addEventListener('click', () => {
    state.activeFilter = btn.dataset.filter;
    $$('#tableFilters [data-filter]', root).forEach((chip) => chip.classList.toggle('active', chip === btn));
    applyFilter(root);
  }));
  $$('.row-detail', root).forEach((btn) => btn.addEventListener('click', () => openModal({
    title: `学生记录 · ${btn.dataset.name}`,
    lead: '记录详情占位视图 · 演示信息',
    body: `${btn.dataset.name} 的来源记录、假条匹配依据、定位/Wi-Fi 校验结果和复核历史将在业务模块接入后展示。\n\n请勿将原型中的虚构内容用于真实考勤判断。`,
    confirmText: '关闭',
  })));
}

// 顶部搜索变化时刷新台账过滤
onSearch(() => {
  if (state.activeModule === 'attendance') applyFilter($('#mainViewContent'));
});

state.registerModule({ ...demoModules.attendance, render: () => view(), bind: (root) => bind(root) });
