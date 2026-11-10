// mod-admin-console：系统管理（仅 IT管理员）——调试端点 + 数据管理 + 用户与角色管理 + 考勤规则
// 零空话原则（Rules.md §〇.5）：只呈现真实可用功能，无功能的说明卡/描述文字一律不渲染
import { currentRole } from '../../shared/roles.js';
import { fetchAdminDataStatus, adminReset, adminSeed, fetchAttendanceRules, saveAttendanceRules, fetchAdminArchive } from '../../shared/api-admin.js';
import { fetchAdminAccounts, resetAccountPassword } from '../../shared/api-auth.js';
import { openMiniDialog, esc, icon } from '../../shared/leave-wizard.js';

const icon_ = icon; // 兼容引用
void icon_;

async function fetchDevAccess() {
  const res = await fetch('/api/dev-access');
  return (await res.json()).enabled;
}

async function toggleDevAccess(enabled) {
  const res = await fetch('/api/dev-access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-zkt-role': encodeURIComponent(currentRole() || '') },
    body: JSON.stringify({ enabled }),
  });
  return res.json();
}

function renderDevStatus(container, enabled) {
  const sw = container.querySelector('#devAccessSwitch');
  if (sw) sw.setAttribute('aria-checked', String(!!enabled));
  const entryRow = container.querySelector('#devEntryRow');
  if (entryRow) entryRow.hidden = !enabled;
}

export async function mount(container, context) {
  container.classList.add('mod-admin-console');
  const toast = (message) => context.eventBus.emit('ui:toast', { message });

  container.innerHTML = `
  <div class="welcome-row"><div>
    <div class="eyebrow"><span class="spark"></span>ADMIN CONSOLE</div>
    <h1>系统管理</h1>
  </div></div>
  <section class="surface section-card">
    <div class="section-header">
      <div>
        <div class="section-title"><span class="section-head-icon"><svg class="icon"><use href="#i-activity"/></svg></span>调试端点</div>
        <div class="section-subtitle">多角色并行测试（各端点独立登录态）</div>
      </div>
      <div class="section-tools">
        <button type="button" class="switch" id="devAccessSwitch" role="switch" aria-checked="false" aria-label="调试端点开关"></button>
      </div>
    </div>
    <div class="dev-entry-row" id="devEntryRow" hidden>
      <button type="button" class="dev-entry" data-href="/dev1">${icon('monitor')}<code>/dev1</code><span>PC 视图</span></button>
      <button type="button" class="dev-entry" data-href="/m-dev1">${icon('smartphone')}<code>/m-dev1</code><span>手机视图</span></button>
    </div>
  </section>
  <section class="surface section-card">
    <div class="section-header">
      <div>
        <div class="section-title"><span class="section-head-icon"><svg class="icon"><use href="#i-database"/></svg></span>数据管理</div>
        <div class="section-subtitle">初始化清零与模拟数据生成</div>
      </div>
    </div>
    <div class="adm-status" id="admStatus">数据加载中…</div>
    <div class="adm-actions">
      <button type="button" class="btn danger compact" id="admResetBtn">${icon('alert')}初始化</button>
      <button type="button" class="btn primary compact" id="admSeedBtn">${icon('sparkles')}生成模拟数据</button>
    </div>
    <div class="flow-foot"><span>初始化不可逆（业务记录与上传文件全部清零）；模拟数据含教师 01–05 与学生 001–100</span></div>
  </section>
  <section class="surface section-card">
    <div class="section-header">
      <div>
        <div class="section-title"><span class="section-head-icon"><svg class="icon"><use href="#i-users"/></svg></span>用户与角色管理</div>
        <div class="section-subtitle">账号清单与密码重置（初始密码 123456）</div>
      </div>
    </div>
    <div class="aca-top">
      <div class="segmented adm-acc-tabs" role="tablist" aria-label="账号类型切换">
        <button type="button" class="active" role="tab" aria-selected="true" data-t="students">学生</button>
        <button type="button" role="tab" aria-selected="false" data-t="teachers">教师</button>
        <button type="button" role="tab" aria-selected="false" data-t="management">管理账号</button>
      </div>
    </div>
    <div class="adm-acc-tools">
      <input class="aca-input adm-acc-search" id="admAccSearch" placeholder="搜索学号 / 姓名" autocomplete="off" />
      <span class="adm-acc-count" id="admAccCount"></span>
    </div>
    <div class="adm-acc-list" id="admAccList">加载中…</div>
  </section>
  <section class="surface section-card">
    <div class="section-header">
      <div>
        <div class="section-title"><span class="section-head-icon"><svg class="icon"><use href="#i-alert"/></svg></span>考勤规则</div>
        <div class="section-subtitle">违规扣分与积分预警线（保存后即时生效）</div>
      </div>
    </div>
    <div class="adm-rules-row">
      <label class="adm-rule-field">旷课扣分<input class="aca-input" id="ruleAbsence" type="number" min="1" max="100" step="1" inputmode="numeric" /></label>
      <label class="adm-rule-field">旷寝扣分<input class="aca-input" id="ruleDorm" type="number" min="1" max="100" step="1" inputmode="numeric" /></label>
      <label class="adm-rule-field">预警线（分）<input class="aca-input" id="ruleWarn" type="number" min="1" max="100" step="1" inputmode="numeric" /></label>
      <button type="button" class="btn primary compact adm-rule-save" id="ruleSaveBtn">${icon('check')}保存</button>
    </div>
    <div class="flow-foot"><span>登记与课堂自动扣分、低分预警名单均按当前规则计算；历史违规的分值不变</span></div>
  </section>
  <section class="surface section-card">
    <div class="section-header">
      <div>
        <div class="section-title"><span class="section-head-icon"><svg class="icon"><use href="#i-file"/></svg></span>数据归档与导出</div>
        <div class="section-subtitle">业务记录查询与 CSV 导出（留档备份）</div>
      </div>
    </div>
    <div class="aca-top">
      <div class="segmented adm-arch-tabs" role="tablist" aria-label="归档数据集切换">
        <button type="button" class="active" role="tab" aria-selected="true" data-t="leaves">请假记录</button>
        <button type="button" role="tab" aria-selected="false" data-t="violations">违规流水</button>
        <button type="button" role="tab" aria-selected="false" data-t="sessions">课堂记录</button>
      </div>
    </div>
    <div class="adm-arch-tools">
      <label class="adm-arch-field">起 <input class="aca-input" id="archFrom" type="date" /></label>
      <label class="adm-arch-field">止 <input class="aca-input" id="archTo" type="date" /></label>
      <button type="button" class="btn primary compact adm-arch-go" id="archQueryBtn">${icon('search')}查询</button>
      <button type="button" class="btn ghost compact adm-arch-go" id="archExportBtn" disabled>${icon('download')}导出 CSV</button>
    </div>
    <div class="adm-acc-count adm-arch-count" id="archCount">选择数据集后点击「查询」</div>
    <div class="adm-acc-list" id="archList"></div>
  </section>`;

  /* ---------- 数据状态行 ---------- */
  const TABLE_LABEL = {
    teachers: '教师', students: '学生', classes: '班级', leaves: '请假',
    timetable_lessons: '课表', lesson_sessions: '课堂', violation_records: '违规',
    workflow_requests: '申请', notifications: '通知', major_departments: '专业部',
    counselor_classes: '导员绑定', uploads: '上传记录',
  };
  const renderStatus = async () => {
    const box = container.querySelector('#admStatus');
    try {
      const counts = await fetchAdminDataStatus();
      const parts = Object.entries(TABLE_LABEL).map(([t, label]) => `${label} ${counts[t] ?? 0}`).join(' · ');
      box.innerHTML = `当前数据：<span>${esc(parts)}</span>`;
    } catch (ex) {
      box.innerHTML = `当前数据：<span class="aca-empty-hint">${esc(ex.message)}</span>`;
    }
  };
  renderStatus();

  /* ---------- 初始化（强确认：输入"清空"文字验证，破坏性操作双保险） ---------- */
  container.querySelector('#admResetBtn')?.addEventListener('click', () => {
    if (container.querySelector('.leave-wizard')) return;
    openMiniDialog({
      host: container,
      title: '初始化（全部清零）',
      textHTML: `将清空 <b>全部信息记录</b>：请假/班级/学生/教师账号/课表/课堂/违规/申请/通知/专业部/导员绑定 + 上传文件，回到空库。<br/><b style="color:var(--danger)">此操作不可恢复</b>，如需演示数据请在完成后点击「生成模拟数据」。`,
      rawBody: '<input class="aca-input" id="admResetConfirm" placeholder="输入「清空」二字以确认" autocomplete="off" />',
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '确认初始化', cls: 'danger' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const input = d.querySelector('#admResetConfirm');
        if (input.value.trim() !== '清空') {
          input.style.borderColor = 'var(--danger)';
          input.placeholder = '请输入「清空」二字后重试';
          return;
        }
        try {
          const r = await adminReset();
          d.remove();
          toast(`初始化完成：${r.tables} 张表已清零${r.storageCleared ? '，上传文件已清空' : ''}`);
          renderStatus();
        } catch (ex) { toast(ex.message); }
      },
    });
  });

  /* ---------- 生成模拟数据（5 教师 + 100 学生） ---------- */
  container.querySelector('#admSeedBtn')?.addEventListener('click', () => {
    if (container.querySelector('.leave-wizard')) return;
    openMiniDialog({
      host: container,
      title: '生成模拟数据',
      textHTML: '将生成：<b>5 名教师</b>（教师01–教师05，可登录）与 <b>100 名学生</b>（学生001–学生100，学号 000000001–000000100，未分配班级）。已存在的账号自动跳过。',
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '生成', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        try {
          const r = await adminSeed();
          d.remove();
          toast(`已生成：教师 ${r.teachersAdded} 名、学生 ${r.studentsAdded} 名（重复账号已跳过）`);
          renderStatus();
        } catch (ex) { toast(ex.message); }
      },
    });
  });

  /* ---------- 用户与角色管理（2026-10-29：账号清单 + 重置密码为初始密码 123456） ---------- */
  let accData = { students: [], teachers: [], management: [] };
  let accTab = 'students';
  let accRows = []; // 当前列表行对应的账号（按钮按索引取值，避免账号名进 data 属性的转义风险）

  const accRow = (account, sub, custom) => {
    accRows.push(account);
    return `
    <div class="adm-acc-row">
      <div class="adm-acc-copy"><strong>${esc(account)}</strong><small>${esc(sub)}</small></div>
      <span class="leave-pill ${custom ? 'ok' : 'mut'}">${custom ? '已设自定义密码' : '初始密码'}</span>
      <button type="button" class="btn ghost compact" data-i="${accRows.length - 1}">${icon('lock')}重置密码</button>
    </div>`;
  };

  const renderAccounts = () => {
    const list = container.querySelector('#admAccList');
    if (!list) return;
    const keyword = (container.querySelector('#admAccSearch')?.value || '').trim().toLowerCase();
    accRows = [];
    let html = '';
    if (accTab === 'students') {
      const filtered = accData.students.filter((a) => !keyword || a.account.includes(keyword) || (a.name || '').toLowerCase().includes(keyword));
      html = filtered.map((a) => accRow(a.account, `${a.name} · ${a.className}`, a.custom)).join('');
    } else if (accTab === 'teachers') {
      html = accData.teachers.map((a) => accRow(a.account, '教师账号（教务管理可添加）', a.custom)).join('');
    } else {
      html = accData.management.map((a) => accRow(a.account, `${a.group}（固定管理账号）`, a.custom)).join('');
    }
    const count = container.querySelector('#admAccCount');
    if (count) count.textContent = `共 ${accRows.length} 个账号`;
    list.innerHTML = html || `<div class="adm-acc-empty">${icon('users', 'icon large')}暂无账号</div>`;
    list.querySelectorAll('button[data-i]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (container.querySelector('.leave-wizard')) return;
        const account = accRows[Number(btn.dataset.i)];
        if (!account) return;
        openMiniDialog({
          host: container,
          title: '重置密码',
          textHTML: `将账号 <b>${esc(account)}</b> 的密码重置为初始密码 <b>123456</b>（其自定义密码作废）。`,
          buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '确认重置', cls: 'primary' }],
          onAction: async (act, d) => {
            if (act === 'cancel') return d.remove();
            try {
              await resetAccountPassword(account);
              d.remove();
              toast(`账号「${account}」已重置为初始密码 123456`);
              loadAccounts();
            } catch (ex) { toast(ex.message); }
          },
        });
      });
    });
  };

  const loadAccounts = async () => {
    try {
      accData = await fetchAdminAccounts();
      renderAccounts();
    } catch (ex) {
      const list = container.querySelector('#admAccList');
      if (list) list.innerHTML = `<div class="adm-acc-empty">${esc(ex.message)}</div>`;
    }
  };
  loadAccounts();

  container.querySelectorAll('.adm-acc-tabs button').forEach((b) => {
    b.addEventListener('click', () => {
      accTab = b.dataset.t;
      container.querySelectorAll('.adm-acc-tabs button').forEach((x) => {
        const on = x === b;
        x.classList.toggle('active', on);
        x.setAttribute('aria-selected', String(on));
      });
      const search = container.querySelector('#admAccSearch');
      if (search) { search.hidden = accTab !== 'students'; search.value = ''; }
      renderAccounts();
    });
  });
  container.querySelector('#admAccSearch')?.addEventListener('input', renderAccounts);

  /* ---------- 考勤规则（2026-10-29 A3：settings 单源，保存后即时生效） ---------- */
  const loadRules = async () => {
    try {
      const { rules } = await fetchAttendanceRules();
      container.querySelector('#ruleAbsence').value = rules.absencePoints;
      container.querySelector('#ruleDorm').value = rules.dormPoints;
      container.querySelector('#ruleWarn').value = rules.warnBelow;
    } catch (ex) { toast(ex.message); }
  };
  loadRules();

  container.querySelector('#ruleSaveBtn')?.addEventListener('click', async () => {
    const btn = container.querySelector('#ruleSaveBtn');
    const readVal = (id) => Math.round(Number(container.querySelector(id)?.value));
    const rules = { absencePoints: readVal('#ruleAbsence'), dormPoints: readVal('#ruleDorm'), warnBelow: readVal('#ruleWarn') };
    if (!Object.values(rules).every((n) => Number.isFinite(n) && n >= 1 && n <= 100)) {
      return toast('各项须为 1–100 的整数');
    }
    btn.disabled = true;
    try {
      const r = await saveAttendanceRules(rules);
      toast(`考勤规则已保存：旷课 ${r.points['旷课']} / 旷寝 ${r.points['旷寝']} / 预警线 ${r.rules.warnBelow} 分`);
      loadRules();
    } catch (ex) { toast(ex.message); }
    finally { btn.disabled = false; }
  });

  /* ---------- 数据归档与导出（2026-10-29 A4：三数据集查询 + CSV 下载） ---------- */
  let archDataset = 'leaves';
  let archCols = [];
  let archRows = [];
  const ARCH_LABEL = { leaves: '请假记录', violations: '违规流水', sessions: '课堂记录' };
  const csvCell = (v) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const renderArchive = () => {
    const list = container.querySelector('#archList');
    const count = container.querySelector('#archCount');
    if (!list) return;
    if (count) count.textContent = `共 ${archRows.length} 条记录`;
    const preview = archRows.slice(0, 50).map((r) => {
      const cells = r.map((c) => esc(String(c ?? '')));
      return `<div class="adm-arch-row">${cells.slice(0, 5).join(' · ')}${cells.length > 5 ? ' …' : ''}</div>`;
    }).join('');
    list.innerHTML = archRows.length
      ? `${preview}${archRows.length > 50 ? `<div class="adm-arch-more">仅预览前 50 条；导出 CSV 含全部 ${archRows.length} 条</div>` : ''}`
      : `<div class="adm-acc-empty">${icon('file', 'icon large')}该条件下暂无记录</div>`;
    const exportBtn = container.querySelector('#archExportBtn');
    if (exportBtn) exportBtn.disabled = archRows.length === 0;
  };

  const queryArchive = async () => {
    const from = container.querySelector('#archFrom')?.value || '';
    const to = container.querySelector('#archTo')?.value || '';
    if (from && to && from > to) return toast('起始日期不能晚于结束日期');
    try {
      const r = await fetchAdminArchive({ dataset: archDataset, from, to });
      archCols = r.cols;
      archRows = r.rows;
      renderArchive();
    } catch (ex) { toast(ex.message); }
  };

  container.querySelectorAll('.adm-arch-tabs button').forEach((b) => {
    b.addEventListener('click', () => {
      archDataset = b.dataset.t;
      container.querySelectorAll('.adm-arch-tabs button').forEach((x) => {
        const on = x === b;
        x.classList.toggle('active', on);
        x.setAttribute('aria-selected', String(on));
      });
      archCols = [];
      archRows = [];
      const count = container.querySelector('#archCount');
      if (count) count.textContent = `已切换至「${ARCH_LABEL[archDataset]}」，点击「查询」`;
      const list = container.querySelector('#archList');
      if (list) list.innerHTML = '';
      const exportBtn = container.querySelector('#archExportBtn');
      if (exportBtn) exportBtn.disabled = true;
    });
  });
  container.querySelector('#archQueryBtn')?.addEventListener('click', queryArchive);

  container.querySelector('#archExportBtn')?.addEventListener('click', () => {
    if (!archRows.length) return toast('无数据可导出');
    const csv = [archCols, ...archRows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }); // BOM 前缀保证 Excel 中文不乱码
    const a = document.createElement('a');
    const d = new Date(); // 本地日期（严禁 toISOString——UTC 会错一天，P12 教训）
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    a.href = URL.createObjectURL(blob);
    a.download = `智考通-${ARCH_LABEL[archDataset]}-${today}.csv`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`已导出 ${archRows.length} 条${ARCH_LABEL[archDataset]}（CSV）`);
  });

  try {
    renderDevStatus(container, await fetchDevAccess());
  } catch { /* 拉取失败保持默认关闭 */ }

  container.querySelector('#devAccessSwitch')?.addEventListener('click', async (ev) => {
    const sw = ev.currentTarget;
    sw.disabled = true;
    try {
      let enabled = false;
      try { enabled = await fetchDevAccess(); } catch { /* 视为关闭 */ }
      const result = await toggleDevAccess(!enabled);
      if (result.ok === false) {
        context.eventBus.emit('ui:toast', { message: result.message || '操作被拒绝' });
      } else {
        renderDevStatus(container, result.enabled);
        context.eventBus.emit('dev:endpoint-toggled', { enabled: result.enabled });
        context.eventBus.emit('ui:toast', { message: result.enabled ? '调试端点已开启' : '调试端点已关闭' });
      }
    } catch (err) {
      context.eventBus.emit('ui:toast', { message: `操作失败：${err.message}` });
    } finally {
      sw.disabled = false;
    }
  });

  // 端点直达入口：点击新开标签页直达对应调试端点
  container.querySelectorAll('.dev-entry').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.open(btn.dataset.href, '_blank');
    });
  });
}

export async function unmount(container) {
  container.innerHTML = '';
  container.classList.remove('mod-admin-console');
}
