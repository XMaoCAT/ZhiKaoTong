// mod-student-affairs：学生处（学生处/IT管理员）
// 三 Tab（segmented）：学生管理（直改通道，建班带专业部归属 chips D1a）/ 待审批（class-* 三类申请）/ 审批历史
// 违规与积分 Tab 属 P8 阶段补充；移动端视图属 P11（mod-mobile-home renderSAView）
// 实时：监听 sse:workflowRequestNew → 待审批列表刷新 + Tab 徽标；学生处直改后自动通知教务处（后端 notifyStudentsChanged）
import { currentRole } from '../../shared/roles.js';
import { fetchStudents, fetchClasses, createClass, updateClassMembers, dissolveClass, renameClass } from '../../shared/api-academic.js';
import { fetchMajors } from '../../shared/api-majors.js';
import { fetchRequests, reviewRequest, REQ_STATUS } from '../../shared/api-workflow.js';
import { fetchViolations, registerViolation } from '../../shared/api-violations.js';
import { studentMatch } from '../../shared/pinyin-util.js';
import { openMiniDialog, esc, icon } from '../../shared/leave-wizard.js';

let sseOff = null;

const TYPE_LABEL = { 'class-create': '新建班级', 'class-edit': '编辑成员', 'class-dissolve': '解散班级', 'class-rename': '重命名班级', 'add-lesson': '加课', 'teacher-leave': '教师请假', 'absence-cancel': '旷课撤销', 'record-modify': '课堂记录修改' };

export async function mount(container, context) {
  container.classList.add('mod-student-affairs');
  let students = [];
  let classes = [];
  let majors = [];
  let unassigned = 0;
  let folder = 'un'; // 'un' | classId
  // 考勤规则（2026-10-29 A3 动态化：后端 settings 单源，渲染时随响应刷新；初始值为 D2 默认口径兑底）
  let viRules = { points: { '旷课': -5, '旷寝': -10 }, warnBelow: 60 };

  container.innerHTML = `
  <div class="welcome-row"><div>
    <div class="eyebrow"><span class="spark"></span>STUDENT AFFAIRS</div>
    <h1>学生处</h1>
    <div class="welcome-copy">学生班级管理与变更审批（教务处变更走申请，在此审批生效）、违规与积分。</div>
  </div></div>
  <section class="surface section-card">
    <div class="aca-top">
      <div class="segmented aca-main-tabs" role="tablist" aria-label="学生处切换">
        <button type="button" class="active" role="tab" aria-selected="true" data-tab="students">${icon('users')}学生管理</button>
        <button type="button" role="tab" aria-selected="false" data-tab="pending">${icon('check')}待审批<em class="aca-badge" id="saPendingBadge" hidden>0</em></button>
        <button type="button" role="tab" aria-selected="false" data-tab="history">${icon('file')}审批历史</button>
        <button type="button" role="tab" aria-selected="false" data-tab="violations">${icon('alert')}违规与积分</button>
      </div>
    </div>
    <div class="aca-pane-box" id="saPaneStudents">
      <div class="section-header">
        <div><div class="section-title"><span class="section-head-icon"><svg class="icon"><use href="#i-users"/></svg></span>学生管理</div></div>
      </div>
      <div class="aca-split">
        <div class="aca-left">
          <div class="aca-folders" id="saFolders"></div>
          <button type="button" class="aca-folder aca-un-row" id="saUnRow">${icon('users')}<span>未分配</span><em id="saUnCount">0</em></button>
        </div>
        <div class="aca-students" id="saStudents"></div>
      </div>
      <div class="flow-foot"><span id="saStuTotal">共 0 名学生</span><span>学生处可直接修改学生数据（教务处变更走申请）</span></div>
    </div>
    <div class="aca-pane-box" id="saPanePending" hidden>
      <div class="section-header">
        <div><div class="section-title"><span class="section-head-icon"><svg class="icon"><use href="#i-check"/></svg></span>待审批</div></div>
      </div>
      <div class="aca-requests" id="saPending"></div>
      <div class="flow-foot"><span>教务处提交的班级变更申请；驳回必须填写原因</span></div>
    </div>
    <div class="aca-pane-box" id="saPaneHistory" hidden>
      <div class="section-header">
        <div><div class="section-title"><span class="section-head-icon"><svg class="icon"><use href="#i-file"/></svg></span>审批历史</div></div>
      </div>
      <div class="aca-requests" id="saHistory"></div>
      <div class="flow-foot"><span>全部已处理申请（含审批人与驳回原因）</span></div>
    </div>
    <div class="aca-pane-box" id="saPaneViolations" hidden>
      <div class="section-header">
        <div><div class="section-title"><span class="section-head-icon"><svg class="icon"><use href="#i-alert"/></svg></span>违规与积分</div></div>
        <div class="section-tools"><button class="btn primary compact" id="saAddViolation">${icon('plus')}登记违规</button></div>
      </div>
      <div id="saViolationZone"></div>
      <div class="flow-foot"><span id="saRulesFoot">旷课 ${viRules.points['旷课']} 分 · 旷寝 ${viRules.points['旷寝']} 分 · 预警线 ${viRules.warnBelow} 分（导员亦可登记）</span></div>
    </div>
  </section>`;

  /* 主切换滑块（复用宿主 .segmented 骨架） */
  const mainTabs = container.querySelectorAll('.aca-main-tabs button');
  mainTabs.forEach((b) => b.addEventListener('click', () => {
    mainTabs.forEach((x) => {
      const on = x === b;
      x.classList.toggle('active', on);
      x.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    container.querySelector('#saPaneStudents').hidden = b.dataset.tab !== 'students';
    container.querySelector('#saPanePending').hidden = b.dataset.tab !== 'pending';
    container.querySelector('#saPaneHistory').hidden = b.dataset.tab !== 'history';
    container.querySelector('#saPaneViolations').hidden = b.dataset.tab !== 'violations';
    if (b.dataset.tab === 'pending') renderPending();
    if (b.dataset.tab === 'history') renderHistory();
    if (b.dataset.tab === 'violations') renderViolations();
  }));

  const toast = (message) => context.eventBus.emit('ui:toast', { message });
  const reload = async () => {
    const [stuList, clsData, majorData] = await Promise.all([fetchStudents(), fetchClasses(), fetchMajors().catch(() => ({ majors: [], unassignedTeachers: [] }))]);
    students = stuList;
    classes = clsData.classes;
    unassigned = clsData.unassigned;
    majors = majorData.majors || [];
    renderFolders();
    renderStudents();
  };

  /* ---------- 学生管理（直改通道） ---------- */
  const renderFolders = () => {
    const box = container.querySelector('#saFolders');
    box.innerHTML = `
      ${classes.map((c) => `
      <button type="button" class="aca-folder${folder === c.id ? ' active' : ''}" data-f="${c.id}">
        ${icon('book')}<span>${esc(c.name)}</span><em>${c.count}</em>
      </button>`).join('')}
      <button type="button" class="aca-folder-add" id="saNewClass">${icon('plus')}新建班级</button>`;
    container.querySelector('#saUnRow').classList.toggle('active', folder === 'un');
    container.querySelector('#saUnCount').textContent = unassigned;
    box.querySelectorAll('.aca-folder').forEach((b) => b.addEventListener('click', () => { folder = +b.dataset.f; renderFolders(); renderStudents(); }));
    box.querySelector('#saNewClass')?.addEventListener('click', openNewClass);
  };
  container.querySelector('#saUnRow')?.addEventListener('click', () => { if (folder !== 'un') { folder = 'un'; renderFolders(); renderStudents(); } });

  const renderStudents = () => {
    const box = container.querySelector('#saStudents');
    const isUn = folder === 'un';
    const cls = classes.find((c) => c.id === folder);
    const list = isUn ? students.filter((s) => !s.classId) : students.filter((s) => s.classId === folder);
    container.querySelector('#saStuTotal').textContent = `共 ${students.length} 名学生`;
    box.innerHTML = `
      <div class="aca-stu-head">${isUn ? '未分配学生' : esc(cls?.name || '')}<em>${list.length} 人</em>${isUn ? '' : `
        <span class="aca-stu-acts">
          <button type="button" class="btn compact" id="saRenameClass">${icon('edit')}重命名</button>
          <button type="button" class="btn compact" id="saEditClass">${icon('edit')}编辑</button>
          <button type="button" class="btn danger compact" id="saDissolveClass">${icon('x')}解散</button>
        </span>`}</div>
      ${list.length ? `<div class="aca-stu-list">${list.map((s) => `
        <div class="aca-stu-row"><strong>${esc(s.name)}</strong><code>${s.id}</code>${isUn ? '' : `<span class="aca-stu-cls">${esc(s.className)}</span>`}</div>`).join('')}</div>`
        : `<div class="aca-stu-empty">${icon('users', 'icon large')}<strong>${isUn ? '全部学生已分配班级' : '班级暂无学生'}</strong><span>${isUn ? '' : '点击「编辑」勾选学生加入'}</span></div>`}`;
    box.querySelector('#saEditClass')?.addEventListener('click', () => openEditClass(cls));
    box.querySelector('#saDissolveClass')?.addEventListener('click', () => openDissolveClass(cls, list.length));
    box.querySelector('#saRenameClass')?.addEventListener('click', () => openRenameClass(cls));
  };

  /* 班级重命名（直改；2026-10-29 C1：教务处同功能走 class-rename 申请） */
  const openRenameClass = (cls) => {
    if (container.querySelector('.leave-wizard')) return;
    openMiniDialog({
      host: container,
      title: `重命名班级 · ${esc(cls?.name || '')}`,
      textHTML: '输入新班级名称（唯一；保存后立即生效，教务处将收到通知）。',
      rawBody: `<input class="aca-input" id="saRenameName" maxlength="30" placeholder="新班级名称" value="${esc(cls?.name || '')}" autocomplete="off" />`,
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '保存', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const name = d.querySelector('#saRenameName').value.trim();
        if (!name || name === cls?.name) { d.querySelector('#saRenameName').style.borderColor = 'var(--danger)'; return; }
        try {
          await renameClass(folder, name);
          d.remove();
          toast(`已重命名：「${cls?.name}」→「${name}」（教务处已同步收到通知）`);
          reload();
        } catch (ex) { toast(ex.message); }
      },
    });
  };

  /* 新建班级（直改；D1a：归属专业部 chips 可选） */
  const openNewClass = () => {
    if (container.querySelector('.leave-wizard')) return;
    const majorChips = majors.length ? `
      <div class="wizard-label">归属专业部（可选）：</div>
      <div class="chip-row">${majors.map((m) => `<button type="button" class="pick-chip" data-mid="${m.id}">${esc(m.name)}</button>`).join('')}</div>` : '';
    const dlg = openMiniDialog({
      host: container,
      title: '新建班级',
      textHTML: '输入班级名称（分类夹），创建后可通过「编辑」勾选学生划入。',
      rawBody: `<input class="aca-input" id="saClassName" maxlength="30" placeholder="班级名称（如：计算机2302）" autocomplete="off" />${majorChips}`,
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '创建', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const name = d.querySelector('#saClassName').value.trim();
        if (!name) { d.querySelector('#saClassName').style.borderColor = 'var(--danger)'; return; }
        const mid = d.querySelector('.pick-chip.on')?.dataset.mid;
        try {
          const r = await createClass(name, mid ? +mid : null);
          d.remove();
          folder = r.id;
          toast(`已创建班级「${name}」${mid ? `（归属 ${esc(majors.find((m) => m.id === +mid)?.name || '')}）` : ''}`);
          reload();
        } catch (ex) { toast(ex.message); }
      },
    });
    dlg.querySelectorAll('.pick-chip[data-mid]').forEach((c) => c.addEventListener('click', () => {
      dlg.querySelectorAll('.pick-chip[data-mid]').forEach((x) => x.classList.toggle('on', x === c));
    }));
  };

  /* 编辑班级成员（直改；三 Tab 统一提交 members 端点——与教务处直改弹窗同模式） */
  const openEditClass = (cls) => {
    if (container.querySelector('.leave-wizard')) return;
    const members = students.filter((s) => s.classId === folder);
    const unList = students.filter((s) => !s.classId);
    const dlg = openMiniDialog({
      host: container,
      title: `编辑班级 · ${esc(cls?.name || '')}`,
      textHTML: '切换标签添加或移除学生，点击保存统一生效。',
      rawBody: `
        <div class="segmented aca-dlg-tabs" role="tablist" aria-label="班级成员管理">
          <button type="button" class="active" role="tab" aria-selected="true" data-t="add">${icon('plus')}添加学生</button>
          <button type="button" role="tab" aria-selected="false" data-t="batch">${icon('edit')}批量添加</button>
          <button type="button" role="tab" aria-selected="false" data-t="remove">${icon('x')}移出学生</button>
        </div>
        <div class="aca-pane" data-p="add">
          <div class="wizard-label">未分配学生 <small>${unList.length} 人（勾选将加入）</small></div>
          <div class="aca-pick-list">${unList.length ? unList.map((s) => `
            <label class="aca-pick-row"><input type="checkbox" data-add="${s.id}" /><strong>${esc(s.name)}</strong><code>${s.id}</code></label>`).join('')
            : '<p class="aca-empty-hint">没有未分配的学生</p>'}</div>
        </div>
        <div class="aca-pane" data-p="batch" hidden>
          <textarea class="reason-input" id="saBatch" placeholder="000000001,000000002&#10;（学号 + 英文逗号 + 学号，可换行；兼容中文逗号/顿号/空格）"></textarea>
        </div>
        <div class="aca-pane" data-p="remove" hidden>
          <div class="wizard-label">当前学生 <small>${members.length} 人（勾选将移出）</small></div>
          <div class="aca-pick-list">${members.length ? members.map((s) => `
            <label class="aca-pick-row out"><input type="checkbox" data-rm="${s.id}" /><strong>${esc(s.name)}</strong><code>${s.id}</code></label>`).join('')
            : '<p class="aca-empty-hint">班级暂无学生</p>'}</div>
        </div>`,
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '保存', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const removeIds = Array.from(d.querySelectorAll('input[data-rm]:checked')).map((i) => i.dataset.rm);
        const checkedIds = Array.from(d.querySelectorAll('input[data-add]:checked')).map((i) => i.dataset.add);
        const batchIds = [...new Set(d.querySelector('#saBatch').value.split(/[,，、\s]+/).map((x) => x.trim()).filter(Boolean))];
        const addIds = [...new Set([...checkedIds, ...batchIds])];
        if (!removeIds.length && !addIds.length) { toast('未勾选任何更改'); return; }
        try {
          const r = await updateClassMembers(folder, removeIds, addIds);
          d.remove();
          toast(`已保存：移出 ${r.removed} 人、加入 ${r.added} 人（教务处已同步收到通知）`);
          reload();
        } catch (ex) { toast(ex.message); }
      },
    });
    dlg.querySelectorAll('.aca-dlg-tabs button').forEach((b) => b.addEventListener('click', () => {
      dlg.querySelectorAll('.aca-dlg-tabs button').forEach((x) => {
        const on = x === b;
        x.classList.toggle('active', on);
        x.setAttribute('aria-selected', String(on));
      });
      dlg.querySelectorAll('.aca-pane').forEach((p) => { p.hidden = p.dataset.p !== b.dataset.t; });
    }));
  };

  /* 解散班级（直改；必填原因） */
  const openDissolveClass = (cls, count) => {
    if (container.querySelector('.leave-wizard')) return;
    openMiniDialog({
      host: container,
      title: `解散班级 · ${esc(cls?.name || '')}`,
      textHTML: `解散后该班级夹将删除，<b>${count} 名学生</b>还原为未分配，相关教师的授课关联同步清除。此操作不可恢复。`,
      rawBody: '<textarea class="reason-input" id="saDissolveReason" maxlength="200" placeholder="解散原因（必填）：如班级合并、重新分班等"></textarea>',
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '确认解散', cls: 'danger' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const reason = d.querySelector('#saDissolveReason').value.trim();
        if (!reason) { d.querySelector('#saDissolveReason').style.borderColor = 'var(--danger)'; d.querySelector('#saDissolveReason').placeholder = '请填写解散原因（必填）'; return; }
        try {
          const r = await dissolveClass(folder, reason);
          d.remove();
          folder = 'un';
          toast(`已解散班级「${cls?.name}」，${r.released} 名学生还原为未分配（教务处已同步收到通知）`);
          reload();
        } catch (ex) { toast(ex.message); }
      },
    });
  };

  /* ---------- 待审批 / 审批历史 ---------- */
  const reqRow = (r, { pending = false } = {}) => `
    <div class="aca-req-row">
      <div class="aca-req-main">
        <div class="aca-req-title"><strong>${esc(TYPE_LABEL[r.type] || r.type)}</strong><span>${esc(r.title)}</span><em class="leave-pill ${r.status === 'pending' ? 'warn' : r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'bad' : 'mut'}">${REQ_STATUS[r.status] || r.status}</em></div>
        <div class="aca-req-meta">${esc(r.requestedBy)} 提交于 ${esc((r.createdAt || '').slice(0, 16).replace('T', ' '))}${r.reviewedAt ? ` · ${esc(r.reviewedBy)} 审批于 ${esc(r.reviewedAt.slice(0, 16).replace('T', ' '))}` : ''}${r.rejectReason ? ` · 驳回原因：${esc(r.rejectReason)}` : ''}</div>
      </div>
      ${pending ? `<button type="button" class="btn primary compact" data-rv="${r.id}">${icon('check')}审批</button>` : ''}
    </div>`;

  const renderPending = async () => {
    const box = container.querySelector('#saPending');
    let list = [];
    try { list = await fetchRequests({ status: 'pending' }); } catch (ex) { toast(ex.message); return; }
    box.innerHTML = list.length ? list.map((r) => reqRow(r, { pending: true })).join('')
      : `<div class="aca-stu-empty">${icon('check', 'icon large')}<strong>暂无待审批申请</strong><span>教务处提交班级变更后将实时出现在此</span></div>`;
    box.querySelectorAll('[data-rv]').forEach((b) => b.addEventListener('click', () => openReview(+b.dataset.rv)));
  };

  const renderHistory = async () => {
    const box = container.querySelector('#saHistory');
    let list = [];
    try { list = (await fetchRequests()).filter((r) => r.status !== 'pending'); } catch (ex) { toast(ex.message); return; }
    box.innerHTML = list.length ? list.map((r) => reqRow(r)).join('')
      : `<div class="aca-stu-empty">${icon('file', 'icon large')}<strong>暂无审批历史</strong><span>已处理的申请将在此留痕</span></div>`;
  };

  /* 审批弹窗：摘要 + 展开细则 + 同意/驳回（必填原因） */
  const openReview = async (id) => {
    if (container.querySelector('.leave-wizard')) return;
    let req = null;
    try { req = (await fetchRequests({ status: 'pending' })).find((r) => r.id === id); } catch (ex) { toast(ex.message); return; }
    if (!req) { toast('该申请已被处理'); renderPending(); return; }
    const detailRows = (req.detail || []).map((d) => `<div class="aca-review-row"><span>${esc(d.label)}</span><strong>${esc(String(d.value))}</strong></div>`).join('');
    const dlg = openMiniDialog({
      host: container,
      title: `审批 · ${esc(TYPE_LABEL[req.type] || req.type)}`,
      textHTML: `${esc(req.title)}<br/><small>${esc(req.requestedBy)} 提交于 ${esc((req.createdAt || '').slice(0, 16).replace('T', ' '))}</small>`,
      rawBody: `
        <div class="aca-review-detail">${detailRows || '<p class="aca-empty-hint">无细则</p>'}</div>
        <textarea class="reason-input" id="saReviewReason" maxlength="300" placeholder="驳回原因（驳回时必填；同意可留空）"></textarea>`,
      buttons: [
        { act: 'cancel', label: '取消' },
        { act: 'reject', label: '驳回', cls: 'danger' },
        { act: 'approve', label: '同意', cls: 'primary' },
      ],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const reason = d.querySelector('#saReviewReason').value.trim();
        if (act === 'reject' && !reason) {
          d.querySelector('#saReviewReason').style.borderColor = 'var(--danger)';
          d.querySelector('#saReviewReason').placeholder = '驳回必须填写原因';
          return;
        }
        try {
          await reviewRequest(id, act, reason);
          d.remove();
          toast(act === 'approve' ? '已同意，变更已生效（发起方将收到通知）' : '已驳回（发起方将收到通知）');
          renderPending();
          updateBadge();
          reload(); // 审批通过建班/编辑/解散后学生管理列表同步（本模块是直改方兼审批方，无需自监听通知）
        } catch (ex) { toast(ex.message); renderPending(); }
      },
    });
  };

  /* ---------- 违规与积分（P8 §9.2：预警条 + 学生积分表 + 违规流水 + 登记弹窗；A3 规则动态化；C2 流水筛选） ---------- */
  let viFilterType = 'all';   // 'all' | '旷课' | '旷寝'
  let viFilterStatus = 'all'; // 'all' | 'active' | 'cancelled'
  const renderViolations = async () => {
    const zone = container.querySelector('#saViolationZone');
    if (!zone) return;
    let students = [];
    let violations = [];
    try {
      const lowRes = await fetchViolations({ low: 1 });
      students = lowRes.students;
      const res = await fetchViolations({});
      violations = res.violations;
      viRules = { points: res.points, warnBelow: res.warnBelow }; // 与后端 settings 单源同步
      const foot = container.querySelector('#saRulesFoot');
      if (foot) foot.textContent = `旷课 ${res.points['旷课']} 分 · 旷寝 ${res.points['旷寝']} 分 · 预警线 ${res.warnBelow} 分（导员亦可登记）`;
    } catch (ex) { toast(ex.message); return; }
    const { warnBelow } = viRules;
    const warnBar = students.length
      ? `<div class="vi-warn-bar">${icon('alert')}当前 <b>${students.length}</b> 名学生积分低于 ${warnBelow}：<span>${students.slice(0, 8).map((s) => `${esc(s.name)}（${s.score}）`).join('、')}${students.length > 8 ? '…' : ''}</span></div>`
      : '';
    /* C2 流水筛选（前端过滤；类型×状态两 chips 组） */
    const filteredVios = violations.filter((v) =>
      (viFilterType === 'all' || v.type === viFilterType)
      && (viFilterStatus === 'all' || (viFilterStatus === 'cancelled') === !!v.cancelled));
    const chip = (group, val, label) => `<button type="button" class="pick-chip${(group === 'type' ? viFilterType : viFilterStatus) === val ? ' on' : ''}" data-vfg="${group}" data-vfv="${val}">${label}</button>`;
    zone.innerHTML = `
      ${warnBar}
      <div class="vi-section">
        <div class="wizard-label">学生积分表（${students.length ? `${students.length} 人低于预警线` : '全部达标'}）：</div>
        ${students.length ? `<div class="aca-pick-list" style="grid-template-columns:1fr 1fr 1fr">${students.map((s) => `
          <div class="aca-stu-row"><strong>${esc(s.name)}</strong><code>${s.id}</code><span class="aca-stu-cls">${esc(s.className || '未分配')}</span><em class="vi-score${s.score < warnBelow ? '-red' : ''}">${s.score} 分 · ${s.violationCount} 次</em></div>`).join('')}</div>`
          : `<div class="aca-stu-empty">${icon('check', 'icon large')}<strong>暂无低分学生</strong><span>全部学生积分不低于 ${warnBelow}</span></div>`}
      </div>
      <div class="vi-section">
        <div class="wizard-label">违规流水（${!violations.length ? '暂无记录' : filteredVios.length ? `命中 ${filteredVios.length} / ${violations.length} 条，最新 ${Math.min(filteredVios.length, 50)} 条` : `命中 0 / ${violations.length} 条（无匹配）`}）：</div>
        <div class="chip-row vi-filter-chips">
          ${chip('type', 'all', '全部类型')}${chip('type', '旷课', '旷课')}${chip('type', '旷寝', '旷寝')}
          <span class="vi-filter-gap"></span>
          ${chip('status', 'all', '全部状态')}${chip('status', 'active', '生效')}${chip('status', 'cancelled', '已撤销')}
        </div>
        ${filteredVios.length ? filteredVios.slice(0, 50).map((v) => `
          <div class="aca-req-row vi-row${v.cancelled ? ' vi-row-cancelled' : ''}">
            <div class="aca-req-main">
              <div class="aca-req-title"><strong>${esc(v.studentName || v.studentId)}</strong><span>${esc(v.type)} · ${v.points} 分</span><em class="leave-pill ${v.type === '旷寝' ? 'warn' : 'bad'}">${v.source === 'auto' ? '课堂自动' : '手动登记'}</em>${v.cancelled ? '<em class="leave-pill mut">已撤销</em>' : ''}</div>
              <div class="aca-req-meta">${esc(v.className || '未分配')} · ${v.operator ? `操作人 ${esc(v.operator)}` : ''} · ${esc((v.createdAt || '').slice(0, 16).replace('T', ' '))}${v.note ? ` · ${esc(v.note)}` : ''}</div>
            </div>
          </div>`).join('')
        : `<div class="aca-stu-empty">${icon('file', 'icon large')}<strong>${violations.length ? '无匹配记录' : '暂无违规记录'}</strong><span>${violations.length ? '调整筛选条件后重试' : '登记旷课/旷寝后在此留痕'}</span></div>`}
      </div>`;
    zone.querySelectorAll('.vi-filter-chips .pick-chip').forEach((c) => c.addEventListener('click', () => {
      if (c.dataset.vfg === 'type') viFilterType = c.dataset.vfv;
      else viFilterStatus = c.dataset.vfv;
      renderViolations();
    }));
    container.querySelector('#saAddViolation')?.addEventListener('click', openAddViolation);
  };

  /* 登记违规弹窗（搜索选生 → 类型 chips → 分值固定不可改 → 备注；分值随考勤规则动态） */
  const openAddViolation = () => {
    if (container.querySelector('.leave-wizard')) return;
    const { points } = viRules;
    openMiniDialog({
      host: container,
      title: '登记违规',
      textHTML: `搜索选择学生，选择违规类型后提交（分值按考勤规则固定：旷课 ${points['旷课']} / 旷寝 ${points['旷寝']}）。`,
      rawBody: `
        <div class="aca-pane">
          <div class="wizard-label">搜索学生（姓名/学号/拼音）：</div>
          <input class="aca-input" id="viSearch" placeholder="如：学生006 / 000000006 / xs006" autocomplete="off" />
          <div class="aca-pick-list" id="viPickList" style="margin-top:8px"></div>
          <div class="wizard-label" style="margin-top:10px">违规类型：</div>
          <div class="chip-row">
            <button type="button" class="pick-chip" data-vt="旷课">旷课（${points['旷课']} 分）</button>
            <button type="button" class="pick-chip" data-vt="旷寝">旷寝（${points['旷寝']} 分）</button>
          </div>
          <div class="wizard-label" style="margin-top:10px">备注（选填）：</div>
          <textarea class="reason-input" id="viNote" maxlength="200" placeholder="登记说明：如查寝记录、目击情况等"></textarea>
        </div>`,
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '登记', cls: 'danger' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const picked = d.querySelector('.vi-picked');
        const typeChip = d.querySelector('.pick-chip[data-vt].on');
        if (!picked) { d.querySelector('#viSearch').style.borderColor = 'var(--danger)'; d.querySelector('#viSearch').placeholder = '请先搜索并选择学生'; return; }
        if (!typeChip) { toast('请选择违规类型'); return; }
        try {
          const r = await registerViolation({ studentId: picked.dataset.sid, type: typeChip.dataset.vt, note: d.querySelector('#viNote').value.trim() });
          d.remove();
          toast(`已登记：${esc(picked.textContent.trim())} ${typeChip.dataset.vt}（${r.points} 分）`);
          renderViolations();
        } catch (ex) { toast(ex.message); }
      },
    });
    /* 类型 chips 互斥 */
    const dlg = container.querySelector('.leave-wizard');
    dlg.querySelectorAll('.pick-chip[data-vt]').forEach((c) => c.addEventListener('click', () => {
      dlg.querySelectorAll('.pick-chip[data-vt]').forEach((x) => x.classList.toggle('on', x === c));
    }));
    /* 学生搜索（拼音/学号；复用 studentMatch） */
    const input = dlg.querySelector('#viSearch');
    const pickList = dlg.querySelector('#viPickList');
    let deb = null;
    const draw = async (q) => {
      let all = [];
      try { all = await fetchStudents(); } catch { pickList.innerHTML = '<p class="aca-empty-hint">学生列表加载失败</p>'; return; }
      const hits = q ? all.filter((s) => studentMatch(s, q)) : all.slice(0, 8);
      pickList.innerHTML = hits.length ? hits.slice(0, 12).map((s) => `
        <label class="aca-pick-row vi-pick" data-sid="${s.id}"><input type="radio" name="viStudent" data-sid="${s.id}" /><strong>${esc(s.name)}</strong><code>${s.id}</code><span class="aca-stu-cls">${esc(s.className || '未分配')}</span></label>`).join('')
        : '<p class="aca-empty-hint">未找到匹配学生</p>';
      pickList.querySelectorAll('.vi-pick input[type="radio"]').forEach((r) => r.addEventListener('change', () => {
        pickList.querySelectorAll('.vi-pick').forEach((row) => row.classList.toggle('vi-picked', row.contains(r) && r.checked));
      }));
    };
    input.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => draw(input.value.trim()), 200); });
    draw('');
  };

  /* ---------- SSE 实时：新申请 → 徽标 + 打开待审批时刷新 ---------- */
  const updateBadge = async () => {
    try {
      const pending = await fetchRequests({ status: 'pending' });
      const badge = container.querySelector('#saPendingBadge');
      if (pending.length) { badge.hidden = false; badge.textContent = pending.length; }
      else badge.hidden = true;
      if (!container.querySelector('#saPanePending').hidden) renderPending();
    } catch { /* 网络异常静默 */ }
  };
  sseOff = context.eventBus.on('sse:workflowRequestNew', () => {
    toast('收到新的班级变更申请');
    updateBadge();
  });

  reload();
  updateBadge();
}

export async function unmount(container) {
  if (sseOff) { sseOff(); sseOff = null; }
  container.innerHTML = '';
  container.classList.remove('mod-student-affairs');
}
