// mod-student-leave：请假管理
// 学生视图：分步向导（免责声明+签名 → 类型+起止时间滚轮选择+事由+图片佐证）+ 请假记录（待审批/编辑中/已拒绝/已撤销）
// 教职工视图：请假数据汇总（只读；导员审批操作在 mod-counselor-verify，移动端审批在 mod-mobile-home）
// 向导/弹窗为共享组件 shared/leave-wizard.js（双端同步）
import { currentRole } from '../../shared/roles.js';
import { fetchLeaves, leaveAction } from '../../shared/api-leaves.js';
import { openLeaveWizard, openMiniDialog, openRevokeDialog, openReplyPop, openReturnDialog, statusPill, fmtRange, esc, icon, teacherPill, ACTIVE_TODAY, todayStr, coversToday, withinRecentDays } from '../../shared/leave-wizard.js';
import { fetchMyClasses } from '../../shared/api-academic.js';
import { studentMatch } from '../../shared/pinyin-util.js';

/* ---------------- 学生视图 ---------------- */
function renderStudent(container, eventBus) {
  const load = async () => {
    let leaves = [];
    try { leaves = await fetchLeaves(); } catch { /* 网络异常保持空列表 */ }
    const list = container.querySelector('#leaveList');
    if (!list) return;
    const count = (s) => leaves.filter((l) => l.status === s).length;
    container.querySelectorAll('[data-metric]').forEach((el) => { el.textContent = count(el.dataset.metric); });
    container.querySelector('#leaveTotal').textContent = `共 ${leaves.length} 条记录`;
    list.innerHTML = leaves.length ? leaves.map((l) => `
      <div class="leave-item" data-id="${l.id}">
        <div class="leave-top">
          <span class="leave-no">#${String(l.id).padStart(3, '0')}</span>
          <span class="leave-type">${esc(l.type) || '—'}</span>
          ${statusPill(l.status)}
          <span class="leave-time">${l.createdAt ? l.createdAt.slice(0, 10) : ''}</span>
        </div>
        <div class="leave-range">${icon('clock')}${fmtRange(l)}</div>
        <div class="leave-reason">${l.reason ? esc(l.reason) : '<i>（事由未填写）</i>'}</div>
        ${l.images.length ? `<div class="leave-imgs">${l.images.map((s) => `<img src="${s}" alt="佐证" />`).join('')}</div>` : ''}
        ${l.status === 'rejected' && l.rejectReason ? `<div class="leave-reply">${icon('alert')}导员回复：${esc(l.rejectReason)}</div>` : ''}
        ${l.status === 'revoked' && l.revokeReason ? `<div class="leave-reply muted">${icon('alert')}撤销理由：${esc(l.revokeReason)}</div>` : ''}
        ${l.status === 'approved' && l.returnRequired ? `<div class="leave-reply need">${icon('check')}销假要求：${[l.returnRequired.photo ? '拍照' : '', l.returnRequired.sign ? '签名' : ''].filter(Boolean).join(' + ')}，请按时销假</div>${l.returnNote ? `<div class="leave-reply need">${icon('edit')}销假备注：${esc(l.returnNote)}</div>` : ''}` : ''}
        ${l.status === 'completed' ? `<div class="leave-reply done">${icon('check')}已销假${l.returnAt ? ' · ' + l.returnAt.slice(0, 16).replace('T', ' ') : ''}</div>` : ''}
        <div class="leave-ops">
          ${l.status === 'pending' ? `<button class="btn ghost compact" data-op="revoke">${icon('x')}撤销请假</button><button class="btn ghost compact" data-op="edit">${icon('edit')}编辑</button>` : ''}
          ${l.status === 'editing' ? `<button class="btn primary compact" data-op="resume">${icon('edit')}继续编辑</button>` : ''}
          ${l.status === 'rejected' ? `<button class="btn ghost compact" data-op="view-reply">${icon('alert')}查看回复</button><button class="btn primary compact" data-op="edit">${icon('edit')}修改并重新提交</button>` : ''}
          ${l.status === 'approved' && l.returnRequired ? `<button class="btn primary compact" data-op="return">${icon('check')}销假</button>` : ''}
        </div>
      </div>`).join('') : `
      <div class="leave-empty">
        <div class="empty-icon">${icon('file', 'icon large')}</div>
        <strong>暂无请假记录</strong><span>点击右上角「发起请假申请」提交第一条申请</span>
      </div>`;

    /* rejected 未读回复弹窗 */
    const readKey = 'zkt.rejectedRead';
    const read = JSON.parse(localStorage.getItem(readKey) || '[]');
    const unread = leaves.filter((l) => l.status === 'rejected' && !read.includes(l.id));
    if (unread.length && !container.querySelector('.leave-wizard')) {
      openReplyPop({
        host: container, leave: unread[0], eventBus,
        onFix: async (lv) => {
          try { const r = await leaveAction(lv.id, 'start-edit'); openLeaveWizard({ host: container, mode: 'edit', leave: r.leave, eventBus, onDone: afterWizard }); }
          catch (ex) { eventBus.emit('ui:toast', { message: ex.message }); }
        },
      });
      markRead(unread[0].id);
    }

    /* 记录操作 */
    list.querySelectorAll('.leave-item').forEach((item) => {
      item.querySelectorAll('[data-op]').forEach((btn) => {
        btn.addEventListener('click', () => handleOp(+item.dataset.id, btn.dataset.op, leaves));
      });
    });
  };

  const markRead = (id) => {
    const readKey = 'zkt.rejectedRead';
    const read = JSON.parse(localStorage.getItem(readKey) || '[]');
    if (!read.includes(id)) { read.push(id); localStorage.setItem(readKey, JSON.stringify(read.slice(-50))); }
  };

  const handleOp = async (id, op, leaves) => {
    const leave = leaves.find((l) => l.id === id);
    if (!leave) return;
    if (container.querySelector('.leave-wizard')) return; // 防重入：向导/弹窗已开时忽略后续触发
    if (op === 'revoke') return openRevokeDialog({ host: container, leave, eventBus, onDone: load });
    if (op === 'view-reply') return openReplyPop({ host: container, leave, eventBus, onFix: (lv) => handleOp(lv.id, 'edit', [lv]) });
    if (op === 'return') return openReturnDialog({ host: container, leave, eventBus, onDone: load });
    if (op === 'resume') return openLeaveWizard({ host: container, mode: 'edit', leave, eventBus, onDone: afterWizard });
    if (op === 'edit') {
      try {
        const r = await leaveAction(id, 'start-edit');
        openLeaveWizard({ host: container, mode: 'edit', leave: r.leave, eventBus, onDone: afterWizard });
      } catch (ex) { eventBus.emit('ui:toast', { message: ex.message }); }
    }
  };

  const afterWizard = ({ toast: t } = {}) => { if (t) eventBus.emit('ui:toast', { message: t }); load(); };

  /* 发起申请：先检查挂起/编辑中的旧申请 */
  container.querySelector('#newLeaveBtn')?.addEventListener('click', async () => {
    if (container.querySelector('.leave-wizard')) return; // 防重入
    let leaves = [];
    try { leaves = await fetchLeaves(); } catch { /* 忽略，直接新建 */ }
    const editingOne = leaves.find((l) => l.status === 'editing');
    if (!editingOne) return openLeaveWizard({ host: container, mode: 'new', leave: null, eventBus, onDone: afterWizard });
    openMiniDialog({
      host: container,
      title: '存在未完成的请假申请',
      textHTML: `您有一份正在编辑的申请（#${String(editingOne.id).padStart(3, '0')}）尚未提交。继续新申请将清除之前的编辑记录。`,
      buttons: [{ act: 'resume', label: '继续编辑', cls: 'primary' }, { act: 'rewrite', label: '重写申请' }],
      onAction: async (act, d) => {
        d.remove();
        if (act === 'resume') openLeaveWizard({ host: container, mode: 'edit', leave: editingOne, eventBus, onDone: afterWizard });
        else {
          try { await leaveAction(editingOne.id, 'delete'); } catch (ex) { eventBus.emit('ui:toast', { message: ex.message }); }
          openLeaveWizard({ host: container, mode: 'new', leave: null, eventBus, onDone: afterWizard });
        }
      },
    });
  });

  load();
}

/* ---------------- 教师视图：今日请假 / 历史请假 双板块 ---------------- */
/* 三态映射/今日判定（teacherPill/ACTIVE_TODAY/todayStr/coversToday）从 shared/leave-wizard.js 导入，双端共用 */
async function renderTeacherView(container) {
  const todayPane = container.querySelector('#tlTodayPane');
  const histPane = container.querySelector('#tlHistoryPane');
  if (!todayPane || !histPane) return;
  let classes = [];
  try { classes = await fetchMyClasses(); } catch { /* 网络异常保持空 */ }
  const today = todayStr();

  if (!classes.length) {
    todayPane.innerHTML = histPane.innerHTML = '';
    todayPane.innerHTML = `<div class="tl-empty">${icon('book', 'icon large')}<strong>暂未分配授课班级</strong><span>请联系教务处在「教务管理 → 教师管理」中为您分配</span></div>`;
    return;
  }

  // 指标卡（基于授课班级全部记录）
  const allLeaves = classes.flatMap((c) => (c.students || []).flatMap((s) => s.leaves || []));
  container.querySelector('[data-metric="pending"]').textContent = allLeaves.filter((l) => l.status === 'pending').length;
  container.querySelector('[data-metric="today"]').textContent = allLeaves.filter((l) => coversToday(l, today) && ACTIVE_TODAY.includes(l.status)).length;
  container.querySelector('[data-metric="done"]').textContent = allLeaves.filter((l) => ['approved', 'rejected', 'revoked', 'completed'].includes(l.status)).length;
  container.querySelector('#leaveTotal').textContent = `共 ${allLeaves.length} 条记录`;

  // Tab 切换（今日请假 / 历史请假）
  container.querySelectorAll('.tl-tabs button').forEach((b) => b.addEventListener('click', () => {
    container.querySelectorAll('.tl-tabs button').forEach((x) => x.classList.toggle('on', x === b));
    todayPane.hidden = b.dataset.t !== 'today';
    histPane.hidden = b.dataset.t !== 'history';
  }));

  renderTeacherToday(todayPane, classes, today);
  renderTeacherHistory(histPane, classes);
}

/** 今日请假：按班级分组，班级卡标注（N 人），仅显示有今日请假学生的班级；展开看具体学生+状态胶囊 */
function renderTeacherToday(pane, classes, today) {
  const groups = classes.map((c) => {
    const stus = (c.students || []).map((s) => {
      const active = (s.leaves || []).filter((l) => ACTIVE_TODAY.includes(l.status) && coversToday(l, today));
      return active.length ? { id: s.id, name: s.name, active } : null;
    }).filter(Boolean);
    return stus.length ? { className: c.className, stus } : null;
  }).filter(Boolean);

  if (!groups.length) {
    pane.innerHTML = `<div class="tl-empty">${icon('check', 'icon large')}<strong>今日无请假学生</strong><span>授课班级今日时段内没有请假记录</span></div>`;
    return;
  }
  pane.innerHTML = groups.map((g) => `
    <div class="tc-card">
      <button type="button" class="tc-head">
        ${icon('book')}<strong>${esc(g.className)}</strong><em>（今日请假<b>${g.stus.length}</b>人）</em>
        <svg class="icon small" style="margin-left:auto"><use href="#i-chevron-down"/></svg>
      </button>
      <div class="tc-body" hidden>
        ${g.stus.map((s) => `
        <div class="tl-stu-row">
          <div class="tl-stu-top"><strong>${esc(s.name)}</strong><code>${s.id}</code></div>
          <div class="tl-pills">${s.active.map((l) => teacherPill(l.status)).join('')}</div>
        </div>`).join('')}
      </div>
    </div>`).join('');
  pane.querySelectorAll('.tc-head').forEach((h) => h.addEventListener('click', () => {
    const body = h.parentElement.querySelector('.tc-body');
    body.hidden = !body.hidden;
    h.parentElement.classList.toggle('open', !body.hidden);
  }));
}

/** 历史请假：班级内全部学生（含 0 次，不可展开）；搜索（姓名/学号/拼音）；每页 10 人；气泡（近期请过假蓝底白字/有被驳回记录红底白字）；有记录学生单击展开细则 */
function renderTeacherHistory(pane, classes) {
  const state = { page: 1, query: '' };
  pane.innerHTML = `
    <div class="tl-search">${icon('search')}<input type="search" id="tlSearch" placeholder="搜索姓名 / 学号 / 拼音（如 zhangsan、zs）" autocomplete="off" /></div>
    <div id="tlHistList"></div>
    <div class="tl-pager" id="tlPager"></div>`;
  const input = pane.querySelector('#tlSearch');
  let deb = null;
  input.addEventListener('input', () => {
    clearTimeout(deb);
    deb = setTimeout(() => { state.query = input.value; state.page = 1; draw(); }, 250);
  });

  function draw() {
    const list = [];
    classes.forEach((c) => (c.students || []).forEach((s) => {
      if (!studentMatch(s, state.query)) return;
      list.push({ id: s.id, name: s.name, leaves: (s.leaves || []).slice() });
    }));
    list.sort((a, b) => b.leaves.length - a.leaves.length || String(a.id).localeCompare(String(b.id)));

    const totalPages = Math.max(1, Math.ceil(list.length / 10));
    if (state.page > totalPages) state.page = totalPages;
    const pageList = list.slice((state.page - 1) * 10, state.page * 10);

    pane.querySelector('#tlHistList').innerHTML = pageList.length ? pageList.map((s) => {
      const recent = s.leaves.some((l) => withinRecentDays(l, 3));
      const rejected = s.leaves.some((l) => l.status === 'rejected');
      const badges = `${recent ? '<span class="tl-bubble blue">近期请过假</span>' : ''}${rejected ? '<span class="tl-bubble red">有被驳回记录</span>' : ''}`;
      return `
      <div class="tl-hist-card${s.leaves.length ? '' : ' none'}">
        <button type="button" class="tl-hist-head"${s.leaves.length ? '' : ' disabled'}>
          <strong>${esc(s.name)}</strong><code>${s.id}</code>
          <em>共请过 ${s.leaves.length} 次假</em>${badges}
          ${s.leaves.length ? '<svg class="icon small" style="margin-left:auto"><use href="#i-chevron-down"/></svg>' : ''}
        </button>
        ${s.leaves.length ? `<div class="tl-hist-body" hidden>
          ${s.leaves.map((l) => `<div class="tl-detail-row">${statusPill(l.status)}<span>${fmtRange(l)}</span><small>${l.reason ? esc(l.reason).slice(0, 24) : '—'}</small></div>`).join('')}
        </div>` : ''}
      </div>`;
    }).join('') : `<div class="tl-empty">${icon('search', 'icon large')}<strong>未找到匹配学生</strong><span>换个姓名、学号或拼音试试</span></div>`;

    pane.querySelectorAll('.tl-hist-head:not([disabled])').forEach((h) => h.addEventListener('click', () => {
      const body = h.parentElement.querySelector('.tl-hist-body');
      body.hidden = !body.hidden;
      h.parentElement.classList.toggle('open', !body.hidden);
    }));

    const pager = pane.querySelector('#tlPager');
    pager.innerHTML = list.length ? `
      <button type="button" class="btn compact" data-p="prev" ${state.page <= 1 ? 'disabled' : ''}>${icon('chevron-left')}上一页</button>
      <span class="tl-page-info">${state.page} / ${totalPages} 页 · 共 ${list.length} 人</span>
      <button type="button" class="btn compact" data-p="next" ${state.page >= totalPages ? 'disabled' : ''}>下一页${icon('chevron-right')}</button>` : '';
    pager.querySelectorAll('button[data-p]').forEach((b) => b.addEventListener('click', () => {
      if (b.disabled) return;
      state.page += b.dataset.p === 'prev' ? -1 : 1;
      draw();
    }));
  }
  draw();
}

/* ---------------- 教职工汇总视图（教师/教务处/学生处/导员/IT管理员 只读；C2 筛选：学生搜索+时段范围） ---------------- */
let staffLeavesCache = [];
async function renderStaff(container) {
  let leaves = [];
  try { leaves = await fetchLeaves(); } catch { /* 网络异常保持空列表 */ }
  staffLeavesCache = leaves;
  const today = new Date().toISOString().slice(0, 10);
  const count = (fn) => leaves.filter(fn).length;
  container.querySelector('[data-metric="pending"]').textContent = count((l) => l.status === 'pending');
  container.querySelector('[data-metric="today"]').textContent = count((l) => l.dateFrom === today || l.dateTo === today);
  container.querySelector('[data-metric="done"]').textContent = count((l) => ['approved', 'rejected', 'revoked'].includes(l.status));

  /* C2（2026-10-29）：按学生（姓名/学号）+ 时段范围筛选（与请假区间相交命中）；仅重绘表格不清指标卡 */
  const drawTable = () => {
    const body = container.querySelector('#staffTableBody');
    if (!body) return;
    const kw = (container.querySelector('#lvSearch')?.value || '').trim().toLowerCase();
    const from = container.querySelector('#lvFrom')?.value || '';
    const to = container.querySelector('#lvTo')?.value || '';
    const rows = staffLeavesCache.filter((l) => {
      if (kw && !String(l.studentName || '').toLowerCase().includes(kw) && !String(l.studentId || '').includes(kw)) return false;
      if (from && (l.dateTo || '') < from) return false;  // 请假结束日早于筛选起 → 不相交
      if (to && (l.dateFrom || '') > to) return false;    // 请假开始日晚于筛选止 → 不相交
      return true;
    });
    const cols = 6;
    body.innerHTML = rows.length ? rows.map((l) => `
      <tr>
        <td>${esc(l.studentName)}<div class="cell-sub">${esc(l.studentId)}</div></td>
        <td>${esc(l.type) || '—'}</td>
        <td>${fmtRange(l)}</td>
        <td>${l.reason ? esc(l.reason).slice(0, 24) : '—'}</td>
        <td>${statusPill(l.status)}${l.status === 'rejected' && l.rejectReason ? `<div class="cell-sub">${esc(l.rejectReason).slice(0, 20)}</div>` : ''}</td>
        <td>${l.createdAt ? l.createdAt.slice(0, 10) : ''}</td>
      </tr>`).join('') : `
      <tr><td class="flow-empty" colspan="${cols}"><div class="empty-icon">${icon('file', 'icon large')}</div><strong>${kw || from || to ? '无匹配记录' : '暂无请假记录'}</strong><span>${kw || from || to ? '调整筛选条件后重试' : '学生提交申请后将在此汇总'}</span></td></tr>`;
    container.querySelector('#leaveTotal').textContent = `共 ${rows.length} 条记录`;
  };
  container.querySelector('#lvSearch')?.addEventListener('input', drawTable);
  container.querySelector('#lvFrom')?.addEventListener('change', drawTable);
  container.querySelector('#lvTo')?.addEventListener('change', drawTable);
  container.querySelector('#lvClear')?.addEventListener('click', () => {
    const s = container.querySelector('#lvSearch'); const f = container.querySelector('#lvFrom'); const t = container.querySelector('#lvTo');
    if (s) s.value = '';
    if (f) f.value = '';
    if (t) t.value = '';
    drawTable();
  });
  drawTable();
}

/* ---------------- 入口 ---------------- */
export async function mount(container, context) {
  container.classList.add('mod-student-leave');
  const role = context.user?.group || currentRole();
  const isStudent = role === '学生';

  const VIEWS = {
    '学生': { title: '我的请假', subtitle: '发起请假申请、上传凭证、跟踪审批进度' },
    '教师': { title: '我教的班级', subtitle: '今日请假与历史请假（仅可见教务处分配的班级）' },
    '教务处': { title: '请假汇总', subtitle: '全校学生请假记录汇总（只读）' },
    '学生处': { title: '请假汇总', subtitle: '全校学生请假记录汇总（只读）' },
    '导员': { title: '请假汇总', subtitle: '全部学生请假记录汇总（审批操作请进入「待审批」）' },
    'IT管理员': { title: '请假数据台账', subtitle: '全部请假申请数据查询（只读）' },
  };
  const v = VIEWS[role] || VIEWS['学生'];

  container.innerHTML = `
  <div class="welcome-row"><div>
    <div class="eyebrow"><span class="spark"></span>LEAVE MANAGEMENT</div>
    <h1>${v.title}</h1>
    <div class="welcome-copy">${v.subtitle}。</div>
  </div></div>
  <section class="surface section-card">
    <div class="section-header">
      <div>
        <div class="section-title"><span class="section-head-icon"><svg class="icon"><use href="#i-file"/></svg></span>${v.title}</div>
      </div>
      <div class="section-tools">${isStudent ? `<button class="btn primary compact" id="newLeaveBtn">${icon('plus')}发起请假申请</button>` : ''}</div>
    </div>
    <div class="flow-metrics">
      ${isStudent
        ? `<div class="flow-metric"><strong data-metric="pending">0</strong><span>待审批</span></div>
           <div class="flow-metric"><strong data-metric="editing">0</strong><span>编辑中</span></div>
           <div class="flow-metric"><strong data-metric="approved">0</strong><span>已同意</span></div>
           <div class="flow-metric"><strong data-metric="completed">0</strong><span>已销假</span></div>
           <div class="flow-metric"><strong data-metric="rejected">0</strong><span>已拒绝</span></div>
           <div class="flow-metric"><strong data-metric="revoked">0</strong><span>已撤销</span></div>`
        : `<div class="flow-metric"><strong data-metric="pending">0</strong><span>待审批</span></div>
           <div class="flow-metric"><strong data-metric="today">0</strong><span>今日涉及</span></div>
           <div class="flow-metric"><strong data-metric="done">0</strong><span>已结单</span></div>`}
    </div>
    ${isStudent ? '<div class="leave-list" id="leaveList"></div>' : `${role === '教师' ? `
    <div class="tl-tabs" role="tablist" aria-label="教师请假分页夹">
      <button type="button" class="on" data-t="today">今日请假</button>
      <button type="button" data-t="history">历史请假</button>
    </div>
    <div class="tl-pane" id="tlTodayPane"></div>
    <div class="tl-pane" id="tlHistoryPane" hidden></div>` : `
    <div class="lv-filter-row">
      <input class="aca-input lv-filter-search" id="lvSearch" placeholder="搜索学生姓名 / 学号" autocomplete="off" />
      <input class="aca-input lv-filter-date" id="lvFrom" type="date" title="时段起始（请假区间相交命中）" />
      <span class="lv-filter-sep">至</span>
      <input class="aca-input lv-filter-date" id="lvTo" type="date" title="时段结束" />
      <button type="button" class="btn ghost compact" id="lvClear">${icon('x')}清除</button>
    </div>
    <div class="table-scroll">
      <table class="flow-table">
        <thead><tr><th>学生</th><th>类型</th><th>时段</th><th>事由</th><th>状态</th><th>提交日期</th></tr></thead>
        <tbody id="staffTableBody"></tbody>
      </table>
    </div>`}`}
    <div class="flow-foot"><span id="leaveTotal">共 0 条记录</span><span>数据由本机服务存储，不出校园网</span></div>
  </section>`;

  if (isStudent) renderStudent(container, context.eventBus);
  else if (role === '教师') renderTeacherView(container);
  else renderStaff(container);

  /* 导员审批/学生销假结果实时刷新（PC 审批在 mod-counselor-verify）；unmount 中解绑 */
  verifyOff = context.eventBus.on('verify:completed', () => {
    if (isStudent) renderStudent(container, context.eventBus);
    else renderStaff(container);
  });
  returnOff = context.eventBus.on('leave:returned', () => {
    if (isStudent) renderStudent(container, context.eventBus);
    else renderStaff(container);
  });
}

let verifyOff = null;
let returnOff = null;

export async function unmount(container) {
  if (verifyOff) { verifyOff(); verifyOff = null; }
  if (returnOff) { returnOff(); returnOff = null; }
  container.innerHTML = '';
  container.classList.remove('mod-student-leave');
}
