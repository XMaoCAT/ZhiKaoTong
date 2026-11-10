// mod-counselor-verify：待审批
// 导员视图：待审批列表（同意[可选销假要求+**耽误课清单**]/拒绝+理由；编辑中禁用）+ 历史记录；D8：按绑定班级收窄（未绑定空态引导）
// IT管理员视图：全部记录只读
import { currentRole } from '../../shared/roles.js';
import { fetchLeavesEx, leaveAction } from '../../shared/api-leaves.js';
import { fetchAffectedLessons } from '../../shared/api-workflow.js';
import { fetchViolationSummary } from '../../shared/api-violations.js';
import { fetchSessions, fetchSession } from '../../shared/api-classroom.js';
import { STATUS, statusPill, fmtRange, esc, icon } from '../../shared/leave-wizard.js';

const esc_ = esc; // 兼容引用

function toast(eventBus, message) { eventBus.emit('ui:toast', { message }); }

let sseEndedOff = null;

function leaveCard(l, canApprove) {
  const locked = l.status === 'editing';
  return `
  <div class="cv-item" data-id="${l.id}">
    <div class="cv-top">
      <span class="cv-no">#${String(l.id).padStart(3, '0')}</span>
      <strong class="cv-student">${esc(l.studentName)}（学号 ${esc(l.studentId)}）</strong>
      <span class="cv-type">${esc(l.type) || '—'}</span>
      ${statusPill(l.status)}
      <span class="cv-time">${l.createdAt ? l.createdAt.slice(0, 10) : ''}</span>
    </div>
    <div class="cv-range">${icon('clock')}${fmtRange(l)}</div>
    <div class="cv-reason">${l.reason ? esc(l.reason) : '<i>（事由未填写）</i>'}</div>
    ${l.images.length ? `<div class="cv-imgs">${l.images.map((s, i) => `<img src="${s}" alt="佐证${i + 1}" />`).join('')}</div>` : ''}
    ${l.signature ? `<details class="cv-sign"><summary>查看学生签名</summary><img src="${l.signature}" alt="学生签名" /></details>` : ''}
    ${l.status === 'rejected' && l.rejectReason ? `<div class="cv-note bad">${icon('alert')}拒绝理由：${esc(l.rejectReason)}</div>` : ''}
    ${l.status === 'revoked' && l.revokeReason ? `<div class="cv-note mut">${icon('alert')}学生撤销理由：${esc(l.revokeReason)}</div>` : ''}
    ${l.status === 'approved' && l.returnRequired ? `<div class="cv-note info">${icon('check')}销假要求：${[l.returnRequired.photo ? '拍照' : '', l.returnRequired.sign ? '签名' : ''].filter(Boolean).join(' + ')}${l.returnNote ? ` · 备注：${esc(l.returnNote)}` : ''}（学生提交销假后完成）</div>` : ''}
    ${l.status === 'completed' ? `<div class="cv-note ok">${icon('check')}已销假${l.returnAt ? ' · ' + l.returnAt.slice(0, 16).replace('T', ' ') : ''}${l.returnPhoto ? ` · <details class="cv-sign inline"><summary>销假照片</summary><img src="${l.returnPhoto}" alt="销假照片" /></details>` : ''}${l.returnSignature ? ` · <details class="cv-sign inline"><summary>销假签名</summary><img src="${l.returnSignature}" alt="销假签名" /></details>` : ''}</div>` : ''}
    ${locked ? `<div class="cv-note info">${icon('edit')}学生正在修改申请，审批暂不可用；重新提交后恢复处理。</div>` : ''}
    <div class="cv-ops">
      ${canApprove && l.status === 'pending' ? `
        <button class="btn compact" data-op="approve">${icon('check')}同意</button>
        <button class="btn danger compact" data-op="reject">${icon('x')}拒绝</button>` : ''}
      ${canApprove && locked ? `
        <button class="btn compact" disabled title="学生编辑中，暂不可审批">${icon('check')}同意</button>
        <button class="btn danger compact" disabled title="学生编辑中，暂不可审批">${icon('x')}拒绝</button>` : ''}
    </div>
  </div>`;
}

export async function mount(container, context) {
  container.classList.add('mod-counselor-verify');
  const role = context.user?.group || currentRole();
  const canApprove = role === '导员' || role === 'IT管理员';

  const isCounselor = role === '导员';
  const v = isCounselor
    ? { title: '待审批', subtitle: '处理学生请假申请：同意或拒绝（拒绝须填写理由）', eyebrow: 'VERIFY WORKBENCH' }
    : { title: '核实记录', subtitle: '全部请假与审批记录查询（只读）', eyebrow: 'VERIFY RECORDS' };

  container.innerHTML = `
  <div class="welcome-row"><div>
    <div class="eyebrow"><span class="spark"></span>${v.eyebrow}</div>
    <h1>${v.title}</h1>
    <div class="welcome-copy">${v.subtitle}。</div>
  </div></div>
  <section class="surface section-card">
    <div class="aca-top">
      <div class="segmented cv-main-tabs" role="tablist" aria-label="导员工作切换">
        <button type="button" class="active" role="tab" aria-selected="true" data-tab="approve">${icon('check')}待审批</button>
        <button type="button" role="tab" aria-selected="false" data-tab="history">${icon('file')}历史</button>
        <button type="button" role="tab" aria-selected="false" data-tab="classroom">${icon('activity')}课堂状态</button>
      </div>
    </div>
    <div class="aca-pane-box" id="cvPaneApprove">
    <div class="section-header">
      <div>
        <div class="section-title"><span class="section-head-icon"><svg class="icon"><use href="#i-check"/></svg></span>${isCounselor ? '待处理申请' : '全部记录'}</div>
      </div>
      <div class="section-tools"><button class="btn ghost compact" id="cvRefresh">${icon('activity')}刷新</button></div>
    </div>
    <div class="flow-metrics">
      <div class="flow-metric"><strong data-metric="pending">0</strong><span>待审批</span></div>
      <div class="flow-metric"><strong data-metric="editing">0</strong><span>编辑中</span></div>
      <div class="flow-metric"><strong data-metric="approved">0</strong><span>已同意</span></div>
      <div class="flow-metric"><strong data-metric="completed">0</strong><span>已销假</span></div>
      <div class="flow-metric"><strong data-metric="rejected">0</strong><span>已拒绝</span></div>
      <div class="flow-metric"><strong data-metric="revoked">0</strong><span>已撤销</span></div>
    </div>
    <div class="cv-list" id="cvList"></div>
    <div class="flow-foot"><span id="cvTotal">共 0 条记录</span><span>拒绝理由将返回给学生</span></div>
    </div>
    <div class="aca-pane-box" id="cvPaneHistory" hidden>
      <div class="section-header">
        <div><div class="section-title"><span class="section-head-icon"><svg class="icon"><use href="#i-file"/></svg></span>历史记录</div></div>
      </div>
      <div class="cv-list" id="cvHistoryList"></div>
      <div class="flow-foot"><span>已处理的申请留痕</span></div>
    </div>
    <div class="aca-pane-box" id="cvPaneClassroom" hidden>
      <div class="section-header">
        <div><div class="section-title"><span class="section-head-icon"><svg class="icon"><use href="#i-activity"/></svg></span>课堂状态（绑定班级）</div></div>
      </div>
      <div id="cvClassroomZone"></div>
      <div class="flow-foot"><span>按绑定班级收窄（D8）；课堂结束时实时提醒</span></div>
    </div>
  </section>`;

  /* 主 Tab（待审批/历史/课堂状态；§8.5） */
  const mainTabs = container.querySelectorAll('.cv-main-tabs button');
  mainTabs.forEach((b) => b.addEventListener('click', () => {
    mainTabs.forEach((x) => {
      const on = x === b;
      x.classList.toggle('active', on);
      x.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    container.querySelector('#cvPaneApprove').hidden = b.dataset.tab !== 'approve';
    container.querySelector('#cvPaneHistory').hidden = b.dataset.tab !== 'history';
    container.querySelector('#cvPaneClassroom').hidden = b.dataset.tab !== 'classroom';
    if (b.dataset.tab === 'history') renderHistory(leavesCache);
    if (b.dataset.tab === 'classroom') renderClassroomZone();
  }));

  let leavesCache = [];
  const load = async () => {
    let leaves = [];
    let unbound = false;
    try { ({ leaves, unbound } = await fetchLeavesEx()); } catch { /* 网络异常保持空列表 */ }
    leavesCache = leaves;
    const count = (s) => leaves.filter((l) => l.status === s).length;
    container.querySelectorAll('[data-metric]').forEach((el) => { el.textContent = count(el.dataset.metric); });
    container.querySelector('#cvTotal').textContent = `共 ${leaves.length} 条记录`;
    const list = container.querySelector('#cvList');
    // 待审批 pane：只显示 pending + editing（待处理队列）
    const active = leaves.filter((l) => ['pending', 'editing'].includes(l.status));
    const sortedActive = [...active].sort((a, b) => b.id - a.id);
    list.innerHTML = sortedActive.length ? sortedActive.map((l) => leaveCard(l, canApprove)).join('') : `
      <div class="cv-empty">
        <div class="empty-icon">${icon(unbound ? 'users' : 'check', 'icon large')}</div>
        <strong>${unbound ? '尚未绑定所带班级' : '暂无待处理申请'}</strong>
        <span>${unbound ? '请联系教务处在「教务管理 → 教师管理 → 导员绑定」中分配所带班级后，这里将只显示绑定班级学生的申请' : '学生提交请假申请后将在此排队处理'}</span>
      </div>`;
    list.querySelectorAll('.cv-item').forEach((item) => {
      item.querySelectorAll('[data-op]').forEach((btn) => {
        btn.addEventListener('click', () => handleOp(+item.dataset.id, btn.dataset.op, leaves));
      });
    });
  };

  const handleOp = (id, op, leaves) => {
    const leave = leaves.find((l) => l.id === id);
    if (!leave || !canApprove) return;
    /* 耽误课清单（D8：审批依据，后端单源计算；异步填充不阻断弹窗） */
    const affectedHTML = `<div class="wizard-label" style="margin-top:12px">将耽误的课程：</div><div class="wz-affected" id="cvAffected"><div class="wz-affected-none">计算中…</div></div>`;
    const fillAffected = (dlg) => {
      fetchAffectedLessons({
        studentId: leave.studentId,
        dateFrom: leave.dateFrom, timeFrom: leave.timeFrom,
        dateTo: leave.dateTo, timeTo: leave.timeTo,
      }).then((lessons) => {
        const box = dlg.querySelector('#cvAffected');
        if (!box) return;
        const weekdayLabel = (d) => `周${'日一二三四五六'[new Date(`${d}T00:00:00`).getDay()]}`;
        box.innerHTML = lessons.length
          ? lessons.map((l) => `<div class="wz-affected-row"><strong>${esc(l.courseName)}</strong><span>${esc(l.teacherName)}</span><code>${l.date}（${weekdayLabel(l.date)}）${l.start}-${l.end}</code>${l.source === 'add' ? '<em>单次课</em>' : ''}</div>`).join('')
          : '<div class="wz-affected-none">该时段无课程安排</div>';
      }).catch(() => {
        const box = dlg.querySelector('#cvAffected');
        if (box) box.innerHTML = '<div class="wz-affected-none">耽误课计算暂不可用</div>';
      });
    };
    if (op === 'approve') {
      // 同意弹窗：是否要求学生主动销假 → 勾选销假凭证（拍照/签名）+ 耽误课清单（审批依据）
      const dlg = openDialog(`同意请假 #${String(id).padStart(3, '0')}`,
        `<p class="cv-dialog-text">同意 ${esc(leave.studentName)}（学号 ${esc(leave.studentId)}）的${esc(leave.type)}申请？</p>
         ${affectedHTML}
         <div class="cv-return-ask">
            <span class="cv-return-q">是否要求学生主动销假？</span>
            <div class="cv-return-switches">
              <button type="button" class="cv-rs-btn active" data-rs="no">不需要</button>
              <button type="button" class="cv-rs-btn" data-rs="yes">需要</button>
            </div>
          </div>
          <div class="cv-return-opts" hidden>
            <span class="cv-return-q">销假凭证要求（至少一项）：</span>
            <div class="chip-row">
              <button type="button" class="cv-opt-chip" data-opt="photo">拍照</button>
              <button type="button" class="cv-opt-chip" data-opt="sign">签名</button>
            </div>
            <textarea class="cv-reason-input cv-note-input" id="apNote" maxlength="300" placeholder="销假备注（选填）：如拍照具体拍什么、签名注意事项等，将展示给学生"></textarea>
          </div>`,
        `<button class="btn ghost" data-act="cancel">取消</button><button class="btn primary" data-act="ok">确认同意</button>`);
      // 交互：销假开关 + 凭证勾选 + 耽误课清单填充
      fillAffected(dlg);
      const optsBox = dlg.querySelector('.cv-return-opts');
      const syncOpts = () => { if (dlg.querySelector('.cv-rs-btn.active')?.dataset.rs === 'yes') { optsBox.hidden = false; return; } optsBox.hidden = true; optsBox.querySelectorAll('.cv-opt-chip').forEach((c) => c.classList.remove('on')); };
      dlg.querySelectorAll('.cv-rs-btn').forEach((b) => b.addEventListener('click', () => {
        dlg.querySelectorAll('.cv-rs-btn').forEach((x) => x.classList.toggle('active', x === b));
        syncOpts();
      }));
      optsBox.querySelectorAll('.cv-opt-chip').forEach((c) => c.addEventListener('click', () => c.classList.toggle('on')));
      dlg.addEventListener('click', async (ev) => {
        if (!ev.target.closest('[data-act="ok"]') && !ev.target.closest('[data-act="cancel"]')) return;
        if (ev.target.closest('[data-act="cancel"]')) return dlg.remove();
        // 组装销假要求与备注
        let requireReturn = null;
        let returnNote = '';
        if (dlg.querySelector('.cv-rs-btn.active')?.dataset.rs === 'yes') {
          const photo = !!dlg.querySelector('.cv-opt-chip[data-opt="photo"]')?.classList.contains('on');
          const sign = !!dlg.querySelector('.cv-opt-chip[data-opt="sign"]')?.classList.contains('on');
          if (!photo && !sign) { dlg.querySelector('.cv-return-q').style.color = 'var(--danger)'; return; }
          requireReturn = { photo, sign };
          returnNote = dlg.querySelector('#apNote')?.value.trim() || '';
        }
        try {
          await leaveAction(id, 'approve', { requireReturn, returnNote });
          dlg.remove();
          context.eventBus.emit('verify:completed', { leaveId: id, conclusion: '通过', verifiedBy: currentRole() });
          toast(context.eventBus, requireReturn ? '已同意，学生需按要求销假' : '已同意该请假申请');
          load();
        } catch (ex) { toast(context.eventBus, ex.message); }
      });
    }
    if (op === 'reject') {
      const dlg = openDialog(`拒绝请假 #${String(id).padStart(3, '0')}`,
        `<p class="cv-dialog-text">拒绝理由将返回给学生，请填写：<b class="cv-required">*</b></p>
         ${affectedHTML}
         <textarea class="cv-reason-input" id="rjReason" maxlength="300" placeholder="拒绝理由（必填）"></textarea>`,
        `<button class="btn ghost" data-act="cancel">取消</button><button class="btn danger" data-act="ok">确认拒绝</button>`);
      fillAffected(dlg);
      dlg.addEventListener('click', async (ev) => {
        if (ev.target.closest('[data-act="cancel"]')) return dlg.remove();
        if (!ev.target.closest('[data-act="ok"]')) return;
        const reason = dlg.querySelector('#rjReason').value.trim();
        if (!reason) { dlg.querySelector('.cv-dialog-text').innerHTML = '拒绝理由将返回给学生：<b style="color:var(--danger)">请填写拒绝理由</b>'; return; }
        try {
          await leaveAction(id, 'reject', { reason });
          dlg.remove();
          context.eventBus.emit('verify:completed', { leaveId: id, conclusion: '退回', verifiedBy: currentRole() });
          toast(context.eventBus, '已拒绝，理由已返回给学生');
          load();
        } catch (ex) { toast(context.eventBus, ex.message); }
      });
    }
  };

  const openDialog = (title, bodyHTML, footHTML) => {
    const dlg = document.createElement('div');
    dlg.className = 'cv-dialog';
    dlg.innerHTML = `
      <div class="cv-dialog-panel normal-mapped-surface" data-light-surface>
        <div class="cv-dialog-title">${title}</div>
        ${bodyHTML}
        <div class="cv-dialog-foot">${footHTML}</div>
      </div>`;
    container.appendChild(dlg);
    return dlg;
  };

  container.querySelector('#cvRefresh')?.addEventListener('click', load);

  /* ---------- 历史 Tab（全状态留痕） ---------- */
  const renderHistory = (leaves) => {
    const box = container.querySelector('#cvHistoryList');
    if (!box) return;
    const done = [...leaves].filter((l) => !['pending', 'editing'].includes(l.status)).sort((a, b) => b.id - a.id);
    box.innerHTML = done.length ? done.map((l) => leaveCard(l, false)).join('') : `
      <div class="cv-empty"><div class="empty-icon">${icon('file', 'icon large')}</div><strong>暂无历史记录</strong><span>已处理的申请将在此留痕</span></div>`;
  };

  /* ---------- 课堂状态 Tab（§8.5：违规汇总 + 近期课堂签到率，按绑定班级收窄） ---------- */
  const renderClassroomZone = async () => {
    const zone = container.querySelector('#cvClassroomZone');
    if (!zone) return;
    let summary = [];
    let unbound = false;
    let sessions = [];
    try { ({ summary, unbound } = await fetchViolationSummary()); } catch { /* 静默 */ }
    try { sessions = await fetchSessions({}); } catch { sessions = []; }
    if (unbound) {
      zone.innerHTML = `<div class="cv-empty"><div class="empty-icon">${icon('users', 'icon large')}</div><strong>尚未绑定所带班级</strong><span>请联系教务处在「教务管理 → 教师管理 → 导员绑定」中分配所带班级</span></div>`;
      return;
    }
    const recent = sessions.slice(0, 8);
    const sessionDetailStats = recent.map((s) => `
      <div class="aca-req-row" data-cs="${s.id}">
        <div class="aca-req-main">
          <div class="aca-req-title"><strong>${esc(s.courseName || '课堂')}</strong><span>${esc(s.className)} · ${s.date}</span><em class="leave-pill ${s.status === 'open' ? 'info' : 'mut'}">${s.status === 'open' ? '进行中' : '已结束'}</em></div>
          <div class="aca-req-meta">${esc(s.teacherName)} · ${s.start}-${s.end}</div>
        </div>
        <button type="button" class="btn ghost compact" data-cv="${s.id}">${icon('chevron-right')}签到详情</button>
      </div>`).join('');
    zone.innerHTML = `
      <div class="vi-summary-row" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:9px;padding:0 20px 12px">
        ${summary.map((c) => `
        <div class="aca-stu-row" style="flex-direction:column;align-items:flex-start;gap:5px">
          <strong>${esc(c.className)}</strong>
          <span class="aca-stu-cls">${c.studentCount} 人 · 平均 ${c.avgScore} 分</span>
          <em class="${c.lowCount ? 'vi-score vi-score-red' : 'vi-score'}" style="margin-left:0">${c.violationCount} 次违规${c.lowCount ? ` · ${c.lowCount} 人低于预警线` : ''}</em>
        </div>`).join('') || '<p class="aca-empty-hint">暂无绑定班级汇总</p>'}
      </div>
      <div style="padding:0 20px 14px">
        <div class="wizard-label" style="margin-bottom:8px">近期课堂（绑定班级）：</div>
        <div class="aca-requests" style="padding:0">${sessionDetailStats || '<p class="aca-empty-hint">暂无课堂记录</p>'}</div>
      </div>`;
    zone.querySelectorAll('[data-cv]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const d = await fetchSession(+b.dataset.cv);
        if (!d) return;
        openDialog(`课堂详情 · ${esc(d.courseName)}`,
          `<p class="cv-dialog-text">${esc(d.className)} · ${d.date}（${esc(d.teacherName)}）<br/>已签到 <b>${d.counts.signed}</b> / 请假 <b>${d.counts.leave}</b> / 旷课 <b>${d.counts.absent}</b> / 应到 <b>${d.counts.total}</b></p>`,
          `<button class="btn ghost" data-act="cancel">关闭</button>`);
        const dlg = container.querySelector('.cv-dialog:last-child');
        dlg?.addEventListener('click', (ev) => { if (ev.target.closest('[data-act="cancel"]')) dlg.remove(); });
      } catch (ex) { toast(context.eventBus, ex.message); }
    }));
  };

  /* 课堂结束实时提醒（§8.5：仅绑定班级的 session；SSE 推送含 classId） */
  sseEndedOff = context.eventBus.on('sse:classroomSessionEnded', (p) => {
    toast(context.eventBus, `课堂结束：${p?.className || ''} ${p?.courseName || ''}（${p?.teacherName || ''}）`);
    if (!container.querySelector('#cvPaneClassroom').hidden) renderClassroomZone();
  });

  /* 学生提交/重新提交、学生销假后自动刷新（跨模块事件，unmount 解绑） */
  leaveOff = context.eventBus.on('leave:submitted', load);
  returnOff = context.eventBus.on('leave:returned', load);
  load();
}

let leaveOff = null;
let returnOff = null;

export async function unmount(container) {
  if (leaveOff) { leaveOff(); leaveOff = null; }
  if (returnOff) { returnOff(); returnOff = null; }
  if (sseEndedOff) { sseEndedOff(); sseEndedOff = null; }
  container.innerHTML = '';
  container.classList.remove('mod-counselor-verify');
}
