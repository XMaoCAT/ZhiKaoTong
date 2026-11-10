// mod-class-records：教务处·课堂记录（教务处/IT管理员；D9 拆分）
// 列表（日期/班级/教师筛选，GET /sessions?all=1）→ 详情（签到三分类+事件时间线+汇总）→ 行内「修改」
// 修改浮层（改分值/改签到状态/撤销旷课）不直接落库：组装 changes[] → submitRequest('record-modify') → 教师确认后生效
// 数据一致性：changes 的 from 取库内快照，后端执行器校验 from 匹配防陈旧覆盖（§8.4）
import { currentRole, currentName } from '../../shared/roles.js';
import { fetchSessions, fetchSession } from '../../shared/api-classroom.js';
import { submitRequest, fetchRequests, REQ_STATUS } from '../../shared/api-workflow.js';
import { openMiniDialog, esc, icon } from '../../shared/leave-wizard.js';

let sseReviewedOff = null;

const FIELD_LABEL = { sign: '签到状态', score: '加减分', absence: '旷课' };
const SIGN_LABEL = { signed: '已签到', signed_by_teacher: '教师代签', absent: '旷课', leave: '请假' };

export async function mount(container, context) {
  container.classList.add('mod-class-records');
  const toast = (message) => context.eventBus.emit('ui:toast', { message });
  let sessions = [];

  container.innerHTML = `
  <div class="welcome-row"><div>
    <div class="eyebrow"><span class="spark"></span>CLASS RECORDS</div>
    <h1>课堂记录</h1>
    <div class="welcome-copy">全量课堂审查；修改课堂数据须提交申请，由授课教师确认后生效。</div>
  </div></div>
  <section class="surface section-card">
    <div class="section-header">
      <div><div class="section-title"><span class="section-head-icon"><svg class="icon"><use href="#i-file"/></svg></span>课堂台账</div></div>
      <div class="section-tools">
        <input class="acr-filter" type="date" id="acrDateFilter" title="按日期筛选" />
        <button class="btn ghost compact" id="acrReload">${icon('activity')}刷新</button>
      </div>
    </div>
    <div class="aca-requests" id="acrList"></div>
    <div class="flow-foot"><span id="acrTotal">共 0 堂课</span><span>修改走申请 · 教师确认制（D9）</span></div>
  </section>`;

  const load = async () => {
    try { sessions = await fetchSessions({ all: 1 }); } catch (ex) { toast(ex.message); return; }
    const dateFilter = container.querySelector('#acrDateFilter')?.value;
    const list = dateFilter ? sessions.filter((s) => s.date === dateFilter) : sessions;
    const box = container.querySelector('#acrList');
    container.querySelector('#acrTotal').textContent = `共 ${list.length} 堂课`;
    box.innerHTML = list.length ? list.map((s) => `
      <div class="aca-req-row">
        <div class="aca-req-main">
          <div class="aca-req-title"><strong>${esc(s.courseName || '课堂')}</strong><span>${esc(s.className)} · ${s.date} ${s.start}-${s.end}</span><em class="leave-pill ${s.status === 'open' ? 'info' : 'mut'}">${s.status === 'open' ? '进行中' : '已结束'}</em></div>
          <div class="aca-req-meta">授课教师 ${esc(s.teacherName)}${s.endedAt ? ` · 结束于 ${esc(s.endedAt.slice(0, 16).replace('T', ' '))}` : ''}</div>
        </div>
        <button type="button" class="btn ghost compact" data-view="${s.id}">${icon('chevron-right')}详情</button>
        <button type="button" class="btn compact" data-modify="${s.id}">${icon('edit')}修改</button>
      </div>`).join('')
      : `<div class="aca-stu-empty">${icon('file', 'icon large')}<strong>暂无课堂记录</strong><span>教师发起课堂后在此汇总</span></div>`;
    box.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => openDetail(+b.dataset.view, false)));
    box.querySelectorAll('[data-modify]').forEach((b) => b.addEventListener('click', () => openDetail(+b.dataset.modify, true)));
  };

  /* 详情/修改浮层（modify=true 时每行带修改控件；确认组装 changes[] 提交 record-modify） */
  const openDetail = async (id, modify) => {
    if (container.querySelector('.leave-wizard')) return;
    let d = null;
    try { d = await fetchSession(id); } catch (ex) { toast(ex.message); return; }
    if (!d) return toast('课堂不存在');
    const c = d.counts;
    const scoreMap = new Map(); // studentId → 最新分值（供 from 快照与显示）
    [...d.events].reverse().forEach((e) => { if (e.kind === 'score' && !scoreMap.has(e.studentId)) scoreMap.set(e.studentId, e.delta); });
    const allStudents = [...new Set([...d.lists.signed, ...d.lists.absent, ...d.lists.leave].map((x) => x.studentId))];

    const row = (x) => {
      const sign = d.lists.signed.find((y) => y.studentId === x.studentId) || d.lists.absent.find((y) => y.studentId === x.studentId) || d.lists.leave.find((y) => y.studentId === x.studentId);
      const status = sign?.status || '';
      const curScore = scoreMap.get(x.studentId) ?? 0;
      const absentV = status === 'absent';
      if (!modify) {
        return `<div class="acr-row"><strong>${esc(x.studentName)}</strong><code>${x.studentId}</code><em class="cr-status-pill ${status === 'signed' || status === 'signed_by_teacher' ? 'ok' : status === 'absent' ? 'bad' : 'mut'}">${SIGN_LABEL[status] || status}</em><span class="acr-score">${curScore ? `${curScore > 0 ? '+' : ''}${curScore} 分` : '—'}</span></div>`;
      }
      return `<div class="acr-row modify" data-sid="${x.studentId}">
        <strong>${esc(x.studentName)}</strong><code>${x.studentId}</code>
        <select class="acr-select" data-f="sign">
          ${['signed', 'signed_by_teacher', 'absent', 'leave'].map((st) => `<option value="${st}" ${st === status ? 'selected' : ''}>${SIGN_LABEL[st]}</option>`).join('')}
        </select>
        <select class="acr-select" data-f="score">
          ${[0, 1, 2, -1, -2].map((v) => `<option value="${v}" ${v === curScore ? 'selected' : ''}>${v > 0 ? '+' : ''}${v} 分</option>`).join('')}
        </select>
        <label class="acr-absence-toggle"><input type="checkbox" data-f="absence" ${absentV ? 'checked' : ''} />旷课</label>
      </div>`;
    };

    const dlg = openMiniDialog({
      host: container,
      title: `${modify ? '修改' : '详情'} · ${esc(d.courseName)}（${esc(d.className)}）`,
      textHTML: `${d.date} ${d.start}-${d.end}（${esc(d.teacherName)}）· 已签到 <b>${c.signed}</b> / 请假 <b>${c.leave}</b> / 旷课 <b>${c.absent}</b> / 应到 <b>${c.total}</b>${modify ? '<br/><small>调整后点「提交申请」，由授课教师确认生效。</small>' : ''}`,
      rawBody: `
        <div class="acr-list">${allStudents.length ? allStudents.map((sid) => {
          const stu = d.lists.signed.find((y) => y.studentId === sid) || d.lists.absent.find((y) => y.studentId === sid) || d.lists.leave.find((y) => y.studentId === sid);
          return row({ studentId: sid, studentName: stu?.studentName || sid });
        }).join('') : '<p class="aca-empty-hint">无学生记录</p>'}</div>
        ${modify ? '' : `<div class="wizard-label" style="margin-top:10px">课堂事件（时间线）：</div>
        <div class="aca-review-detail" style="margin-bottom:0">${d.events.slice(0, 15).map((e) => `<div class="aca-review-row"><span>${esc(e.studentId)}</span><strong>${esc(e.kind)}${e.delta ? `（${e.delta > 0 ? '+' : ''}${e.delta}）` : ''}${e.note ? ` · ${esc(e.note)}` : ''}${e.operator ? ` · ${esc(e.operator)}` : ''}</strong></div>`).join('') || '<p class="aca-empty-hint">无事件</p>'}</div>`}`,
      buttons: modify
        ? [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '提交申请', cls: 'primary' }]
        : [{ act: 'ok', label: '关闭', cls: 'primary' }],
      onAction: async (act, dd) => {
        if (act === 'cancel' || !modify) return dd.remove();
        /* 组装 changes[]：仅收集与库内快照不一致的项（from=当前快照，防陈旧覆盖） */
        const changes = [];
        dd.querySelectorAll('.acr-row.modify').forEach((r) => {
          const sid = r.dataset.sid;
          const sign = d.lists.signed.find((y) => y.studentId === sid) || d.lists.absent.find((y) => y.studentId === sid) || d.lists.leave.find((y) => y.studentId === sid);
          const curStatus = sign?.status || '';
          const curScore = scoreMap.get(sid) ?? 0;
          const absentV = curStatus === 'absent';
          const toSign = r.querySelector('[data-f="sign"]').value;
          const toScore = Number(r.querySelector('[data-f="score"]').value);
          const toAbsence = r.querySelector('[data-f="absence"]').checked;
          if (toSign !== curStatus) changes.push({ studentId: sid, field: 'sign', from: curStatus, to: toSign });
          if (toScore !== curScore) changes.push({ studentId: sid, field: 'score', from: curScore, to: toScore });
          if (toAbsence !== absentV) changes.push({ studentId: sid, field: 'absence', from: absentV, to: toAbsence });
        });
        if (!changes.length) { toast('未做任何修改'); return; }
        try {
          await submitRequest('record-modify', { sessionId: d.id, changes });
          dd.remove();
          toast(`已提交课堂记录修改申请（${changes.length} 项），等待授课教师确认`);
        } catch (ex) { toast(ex.message); }
      },
    });
    void dlg;
  };

  container.querySelector('#acrReload')?.addEventListener('click', load);
  container.querySelector('#acrDateFilter')?.addEventListener('change', load);

  /* 教师确认生效后刷新（sse:workflowRequestReviewed 含 record-modify 结果） */
  sseReviewedOff = context.eventBus.on('sse:workflowRequestReviewed', (r) => {
    if (r?.type === 'record-modify') { toast('课堂记录修改已由教师确认生效'); load(); }
  });

  load();
}

export async function unmount(container) {
  if (sseReviewedOff) { sseReviewedOff(); sseReviewedOff = null; }
  container.innerHTML = '';
  container.classList.remove('mod-class-records');
}
