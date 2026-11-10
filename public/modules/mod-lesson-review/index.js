// mod-lesson-review：教务处·调课审批（教务处/IT管理员；D9 拆分自教务管理）
// 双 Tab（segmented）：待审批（add-lesson/teacher-leave/absence-cancel 三类，SSE 实时+徽标）/ 审批历史
// 审批弹窗：摘要 + 展开细则（含 teacher-leave 签名图展示）+ 同意/驳回必填原因
import { currentRole } from '../../shared/roles.js';
import { fetchRequests, reviewRequest, REQ_STATUS } from '../../shared/api-workflow.js';
import { openMiniDialog, esc, icon } from '../../shared/leave-wizard.js';

let sseNewOff = null;

const TYPE_LABEL = { 'add-lesson': '加课', 'teacher-leave': '教师请假', 'absence-cancel': '旷课撤销', 'record-modify': '课堂记录修改' };
const REVIEW_TYPES = ['add-lesson', 'teacher-leave', 'absence-cancel']; // 调课审批三类（record-modify 属课堂记录流）

export async function mount(container, context) {
  container.classList.add('mod-lesson-review');
  const toast = (message) => context.eventBus.emit('ui:toast', { message });

  container.innerHTML = `
  <div class="welcome-row"><div>
    <div class="eyebrow"><span class="spark"></span>LESSON REVIEW</div>
    <h1>调课审批</h1>
    <div class="welcome-copy">教师加课、请假停课与旷课撤销申请的审批。</div>
  </div></div>
  <section class="surface section-card">
    <div class="aca-top">
      <div class="segmented lr-main-tabs" role="tablist" aria-label="调课审批切换">
        <button type="button" class="active" role="tab" aria-selected="true" data-tab="pending">${icon('check')}待审批<em class="aca-badge" id="lrPendingBadge" hidden>0</em></button>
        <button type="button" role="tab" aria-selected="false" data-tab="history">${icon('file')}审批历史</button>
      </div>
    </div>
    <div class="aca-pane-box" id="lrPanePending">
      <div class="section-header">
        <div><div class="section-title"><span class="section-head-icon"><svg class="icon"><use href="#i-check"/></svg></span>待审批</div></div>
      </div>
      <div class="aca-requests" id="lrPending"></div>
      <div class="flow-foot"><span>教师提交的调课申请；驳回必须填写原因</span></div>
    </div>
    <div class="aca-pane-box" id="lrPaneHistory" hidden>
      <div class="section-header">
        <div><div class="section-title"><span class="section-head-icon"><svg class="icon"><use href="#i-file"/></svg></span>审批历史</div></div>
      </div>
      <div class="aca-requests" id="lrHistory"></div>
      <div class="flow-foot"><span>全部已处理调课申请（含 result 快照）</span></div>
    </div>
  </section>`;

  const mainTabs = container.querySelectorAll('.lr-main-tabs button');
  mainTabs.forEach((b) => b.addEventListener('click', () => {
    mainTabs.forEach((x) => {
      const on = x === b;
      x.classList.toggle('active', on);
      x.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    container.querySelector('#lrPanePending').hidden = b.dataset.tab !== 'pending';
    container.querySelector('#lrPaneHistory').hidden = b.dataset.tab !== 'history';
    if (b.dataset.tab === 'pending') renderPending();
    if (b.dataset.tab === 'history') renderHistory();
  }));

  const reqRow = (r, { pending = false } = {}) => `
    <div class="aca-req-row">
      <div class="aca-req-main">
        <div class="aca-req-title"><strong>${esc(TYPE_LABEL[r.type] || r.type)}</strong><span>${esc(r.title)}</span><em class="leave-pill ${r.status === 'pending' ? 'warn' : r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'bad' : 'mut'}">${REQ_STATUS[r.status] || r.status}</em></div>
        <div class="aca-req-meta">${esc(r.requestedBy)} 提交于 ${esc((r.createdAt || '').slice(0, 16).replace('T', ' '))}${r.reviewedAt ? ` · ${esc(r.reviewedBy)} 审批于 ${esc(r.reviewedAt.slice(0, 16).replace('T', ' '))}` : ''}${r.rejectReason ? ` · 驳回原因：${esc(r.rejectReason)}` : ''}</div>
      </div>
      ${pending ? `<button type="button" class="btn primary compact" data-rv="${r.id}">${icon('check')}审批</button>` : ''}
    </div>`;

  const renderPending = async () => {
    const box = container.querySelector('#lrPending');
    let list = [];
    try { list = (await fetchRequests({ status: 'pending' })).filter((r) => REVIEW_TYPES.includes(r.type)); } catch (ex) { toast(ex.message); return; }
    box.innerHTML = list.length ? list.map((r) => reqRow(r, { pending: true })).join('')
      : `<div class="aca-stu-empty">${icon('check', 'icon large')}<strong>暂无待审批调课申请</strong><span>教师提交加课/请假/旷课撤销后将实时出现在此</span></div>`;
    box.querySelectorAll('[data-rv]').forEach((b) => b.addEventListener('click', () => openReview(+b.dataset.rv)));
  };

  const renderHistory = async () => {
    const box = container.querySelector('#lrHistory');
    let list = [];
    try { list = (await fetchRequests()).filter((r) => REVIEW_TYPES.includes(r.type) && r.status !== 'pending'); } catch (ex) { toast(ex.message); return; }
    box.innerHTML = list.length ? list.map((r) => reqRow(r)).join('')
      : `<div class="aca-stu-empty">${icon('file', 'icon large')}<strong>暂无审批历史</strong><span>已处理的调课申请将在此留痕</span></div>`;
  };

  /* 审批弹窗：摘要 + 细则（含 teacher-leave 签名图）+ 同意/驳回必填 */
  const openReview = async (id) => {
    if (container.querySelector('.leave-wizard')) return;
    let req = null;
    try { req = (await fetchRequests({ status: 'pending' })).find((r) => r.id === id && REVIEW_TYPES.includes(r.type)); } catch (ex) { toast(ex.message); return; }
    if (!req) { toast('该申请已被处理'); renderPending(); updateBadge(); return; }
    const detailRows = (req.detail || []).map((d) => `<div class="aca-review-row"><span>${esc(d.label)}</span><strong>${esc(String(d.value))}</strong></div>`).join('');
    const signImg = req.type === 'teacher-leave' && req.payload?.signature
      ? `<div class="wizard-label" style="margin-top:8px">教师签名：</div><img class="lr-sign-img" src="${req.payload.signature}" alt="签名" />` : '';
    const imgs = req.type === 'teacher-leave' && Array.isArray(req.payload?.images) && req.payload.images.length
      ? `<div class="wizard-label" style="margin-top:8px">图片材料（${req.payload.images.length} 张）：</div><div class="lr-imgs">${req.payload.images.map((s) => `<img src="${s}" alt="材料" />`).join('')}</div>` : '';
    const dlg = openMiniDialog({
      host: container,
      title: `审批 · ${esc(TYPE_LABEL[req.type] || req.type)}`,
      textHTML: `${esc(req.title)}<br/><small>${esc(req.requestedBy)} 提交于 ${esc((req.createdAt || '').slice(0, 16).replace('T', ' '))}</small>`,
      rawBody: `
        <div class="aca-review-detail">${detailRows || '<p class="aca-empty-hint">无细则</p>'}${signImg}${imgs}</div>
        <textarea class="reason-input" id="lrReviewReason" maxlength="300" placeholder="驳回原因（驳回时必填；同意可留空）"></textarea>`,
      buttons: [
        { act: 'cancel', label: '取消' },
        { act: 'reject', label: '驳回', cls: 'danger' },
        { act: 'approve', label: '同意', cls: 'primary' },
      ],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const reason = d.querySelector('#lrReviewReason').value.trim();
        if (act === 'reject' && !reason) {
          d.querySelector('#lrReviewReason').style.borderColor = 'var(--danger)';
          d.querySelector('#lrReviewReason').placeholder = '驳回必须填写原因';
          return;
        }
        try {
          await reviewRequest(id, act, reason);
          d.remove();
          toast(act === 'approve' ? '已同意，调课已生效（教师与本班学生将收到实时通知）' : '已驳回（教师将收到通知）');
          renderPending();
          updateBadge();
        } catch (ex) { toast(ex.message); renderPending(); }
      },
    });
    void dlg;
  };

  const updateBadge = async () => {
    try {
      const pending = (await fetchRequests({ status: 'pending' })).filter((r) => REVIEW_TYPES.includes(r.type));
      const badge = container.querySelector('#lrPendingBadge');
      if (pending.length) { badge.hidden = false; badge.textContent = pending.length; }
      else badge.hidden = true;
      if (!container.querySelector('#lrPanePending').hidden) renderPending();
    } catch { /* 网络异常静默 */ }
  };

  sseNewOff = context.eventBus.on('sse:workflowRequestNew', () => {
    toast('收到新的调课申请');
    updateBadge();
  });

  renderPending();
  updateBadge();
}

export async function unmount(container) {
  if (sseNewOff) { sseNewOff(); sseNewOff = null; }
  container.innerHTML = '';
  container.classList.remove('mod-lesson-review');
}
