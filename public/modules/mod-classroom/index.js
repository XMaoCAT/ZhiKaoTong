// mod-classroom：课堂管理（教师/IT管理员）
// 双 Tab（segmented）：课堂（发起/进行中面板）/ 历史记录
// 课堂面板四区（§8.2）：签到区（mode/口令大字/已签计数 3s 轮询/结束签到）→ 随人区（学生头像网格+
//   开始随机 80ms 高亮轮换 3s → 定格 → 浮层加减分）→ 学生列表区（搜索+行内[+1][-1][旷课]）→ 签到详情区（三分栏）
// 旷课：open 期再点撤销（还分）；ended 期按钮置灰+引导文案（课后撤销走调课审批）
// record-modify 确认窗（教务处修改请求）属 P10；本模块 P9 先不监听（P10 补）
import { currentRole, currentName } from '../../shared/roles.js';
import { fetchMyClasses } from '../../shared/api-academic.js';
import { fetchTeacherTimetable } from '../../shared/api-timetable.js';
import { startSession, fetchSession, fetchSessions, endSession, proxySign, scoreStudent, pickStudents, markAbsence, cancelAbsence } from '../../shared/api-classroom.js';
import { submitRequest, fetchRequests, reviewRequest, REQ_STATUS } from '../../shared/api-workflow.js';
import { studentMatch } from '../../shared/pinyin-util.js';
import { openMiniDialog, esc, icon } from '../../shared/leave-wizard.js';

let pollTimer = null;
let sseNewOff = null;

const SIGN_LABEL = { signed: '已签到', signed_by_teacher: '教师代签', absent: '旷课', leave: '请假' };

const pad2 = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

export async function mount(container, context) {
  container.classList.add('mod-classroom');
  const name = context.user?.name || currentName();
  const toast = (message) => context.eventBus.emit('ui:toast', { message });
  let classes = [];
  let todayLessons = [];
  let activeSession = null; // 进行中 session 详情

  container.innerHTML = `
  <div class="welcome-row"><div>
    <div class="eyebrow"><span class="spark"></span>CLASSROOM</div>
    <h1>课堂管理</h1>
    <div class="welcome-copy">发起课堂签到、随人提问、加减分与旷课记录。</div>
  </div></div>
  <section class="surface section-card">
    <div class="aca-top">
      <div class="segmented cr-main-tabs" role="tablist" aria-label="课堂管理切换">
        <button type="button" class="active" role="tab" aria-selected="true" data-tab="live">${icon('activity')}课堂</button>
        <button type="button" role="tab" aria-selected="false" data-tab="history">${icon('file')}历史记录</button>
      </div>
    </div>
    <div class="aca-pane-box" id="crPaneLive">
      <div id="crStartZone"></div>
      <div id="crPanelZone"></div>
    </div>
    <div class="aca-pane-box" id="crPaneHistory" hidden>
      <div class="section-header">
        <div><div class="section-title"><span class="section-head-icon"><svg class="icon"><use href="#i-file"/></svg></span>历史课堂</div></div>
      </div>
      <div class="aca-requests" id="crHistory"></div>
      <div class="flow-foot"><span>已结束课堂（含签到统计）</span></div>
    </div>
  </section>`;

  const mainTabs = container.querySelectorAll('.cr-main-tabs button');
  mainTabs.forEach((b) => b.addEventListener('click', () => {
    mainTabs.forEach((x) => {
      const on = x === b;
      x.classList.toggle('active', on);
      x.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    container.querySelector('#crPaneLive').hidden = b.dataset.tab !== 'live';
    container.querySelector('#crPaneHistory').hidden = b.dataset.tab !== 'history';
    if (b.dataset.tab === 'history') renderHistory();
  }));

  const load = async () => {
    try { classes = await fetchMyClasses(); } catch { classes = []; }
    try { todayLessons = (await fetchTeacherTimetable(name)).filter((l) => l.weekday === ((new Date().getDay() || 7)) && !l.cancelled); } catch { todayLessons = []; }
    renderStartZone();
    renderPanel();
    /* 恢复进行中课堂（刷新页面不丢面板；教师可能有多个 open，取最新一个） */
    try {
      const mine = await fetchSessions({ teacher: name });
      const open = mine.find((s) => s.status === 'open');
      if (open) {
        activeSession = await fetchSession(open.id);
        if (activeSession && activeSession.status === 'open') { renderPanel(); startPolling(); }
      }
    } catch { /* 网络异常静默 */ }
  };

  /* ---------- 发起区（班级 + 今日课程双入口） ---------- */
  const renderStartZone = () => {
    const zone = container.querySelector('#crStartZone');
    const todayWd = new Date().getDay() || 7;
    const todayLessonBtns = todayLessons.filter((l) => l.weekday === todayWd).map((l) => `
      <button type="button" class="pick-chip" data-lesson="${l.id}" data-class="${l.classId}" title="${esc(l.start)}-${esc(l.end)}">${esc(l.courseName)} · ${esc(l.className || '')}</button>`).join('');
    zone.innerHTML = `
    <div class="cr-start">
      <div class="wizard-label">按今日课程发起：</div>
      <div class="chip-row">${todayLessonBtns || '<span class="aca-empty-hint">今日暂无排课，可按班级手动发起</span>'}</div>
      <div class="wizard-label" style="margin-top:12px">按班级手动发起（默认 45 分钟，口令签到）：</div>
      <div class="chip-row">${classes.length ? classes.map((c) => `<button type="button" class="pick-chip" data-manual="${c.classId}">${esc(c.className)}</button>`).join('') : '<span class="aca-empty-hint">尚未分配授课班级</span>'}</div>
    </div>`;
    zone.querySelectorAll('[data-lesson]').forEach((b) => b.addEventListener('click', () => confirmStart(+b.dataset.class, +b.dataset.lesson, b.textContent.trim())));
    zone.querySelectorAll('[data-manual]').forEach((b) => b.addEventListener('click', () => confirmStart(+b.dataset.manual, null, null)));
  };

  const confirmStart = (classId, lessonId, label) => {
    if (container.querySelector('.leave-wizard')) return;
    openMiniDialog({
      host: container,
      title: lessonId ? `发起课堂 · ${esc(label)}` : '发起课堂',
      textHTML: '发起后本班学生实时收到签到卡；请假学生自动标记（无需签到）。',
      rawBody: `
        <div class="aca-pane">
          <div class="wizard-label">签到方式：</div>
          <div class="chip-row">
            <button type="button" class="pick-chip on" data-sm="code">口令签到</button>
            <button type="button" class="pick-chip" data-sm="click">点击签到</button>
          </div>
          <div id="crCodeRow" style="margin-top:10px">
            <div class="wizard-label">签到口令（4 位数字，留空自动生成）：</div>
            <input class="aca-input" id="crSignCode" maxlength="4" inputmode="numeric" placeholder="自动生成" autocomplete="off" />
          </div>
        </div>`,
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '发起课堂', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const signMode = d.querySelector('.pick-chip[data-sm].on')?.dataset.sm || 'code';
        const signCode = d.querySelector('#crSignCode')?.value.trim() || undefined;
        try {
          const r = await startSession({ classId, lessonId, signMode, signCode });
          d.remove();
          activeSession = r.session;
          toast(`课堂已发起（${signMode === 'code' ? `口令 ${r.session.signCode}` : '点击签到'}），本班学生将实时收到签到卡`);
          renderPanel();
          startPolling();
        } catch (ex) { toast(ex.message); }
      },
    });
    const dlg = container.querySelector('.leave-wizard');
    dlg.querySelectorAll('.pick-chip[data-sm]').forEach((c) => c.addEventListener('click', () => {
      dlg.querySelectorAll('.pick-chip[data-sm]').forEach((x) => x.classList.toggle('on', x === c));
      dlg.querySelector('#crCodeRow').hidden = c.dataset.sm !== 'code';
    }));
  };

  /* ---------- 课堂面板（四区 + 3s 轮询） ---------- */
  const renderPanel = () => {
    const zone = container.querySelector('#crPanelZone');
    if (!activeSession) {
      zone.innerHTML = `<div class="aca-stu-empty">${icon('activity', 'icon large')}<strong>暂无进行中课堂</strong><span>从上方入口发起；学生签到将实时计入</span></div>`;
      return;
    }
    const s = activeSession;
    const c = s.counts || { signed: 0, absent: 0, leave: 0, total: 0 };
    zone.innerHTML = `
    <div class="cr-panel">
      <div class="cr-sign-zone">
        <div class="cr-sign-head"><strong>${esc(s.courseName)}</strong><span>${esc(s.className)} · ${s.date} ${s.start}-${s.end}</span><em class="leave-pill info">进行中</em></div>
        ${s.signMode === 'code' ? `<div class="cr-code-big">${esc(s.signCode)}</div><div class="cr-code-hint">签到口令（告知学生）</div>` : `<div class="cr-code-hint">点击签到模式（学生点击按钮即签到）</div>`}
        <div class="cr-sign-counts">
          <span>已签到 <b>${c.signed}</b></span><span>请假 <b>${c.leave}</b></span><span>旷课 <b>${c.absent}</b></span><span>应到 <b>${c.total}</b></span>
        </div>
        <div class="cr-sign-foot"><button type="button" class="btn danger compact" id="crEndBtn">${icon('x')}结束课堂</button></div>
      </div>
      <div class="cr-pick-zone">
        <div class="wizard-label">随人提问（随机点名）：</div>
        <div class="cr-pick-grid" id="crPickGrid"></div>
        <div class="cr-pick-ops"><button type="button" class="btn primary compact" id="crPickBtn">${icon('sparkles')}开始随机</button></div>
      </div>
      <div class="cr-students-zone">
        <div class="wizard-label">学生操作（加减分 / 旷课 / 代签）：</div>
        <div class="m-tl-search">${icon('search')}<input type="search" id="crSearch" placeholder="搜索姓名 / 学号 / 拼音" autocomplete="off" /></div>
        <div class="cr-stu-list" id="crStuList"></div>
      </div>
      <div class="cr-detail-zone">
        <div class="wizard-label">签到详情：</div>
        <div class="cr-detail-cols">
          <div class="cr-detail-col"><div class="cr-col-title ok">已签到（${s.lists.signed.length}）</div>${s.lists.signed.map((x) => `<div class="cr-stu-row">${esc(x.studentName)}<code>${x.studentId}</code></div>`).join('') || '<p class="aca-empty-hint">暂无</p>'}</div>
          <div class="cr-detail-col"><div class="cr-col-title bad">旷课（${s.lists.absent.length}）</div>${s.lists.absent.map((x) => `<div class="cr-stu-row">${esc(x.studentName)}<code>${x.studentId}</code></div>`).join('') || '<p class="aca-empty-hint">暂无</p>'}</div>
          <div class="cr-detail-col"><div class="cr-col-title mut">请假（${s.lists.leave.length}）</div>${s.lists.leave.map((x) => `<div class="cr-stu-row">${esc(x.studentName)}<code>${x.studentId}</code><em>请假</em></div>`).join('') || '<p class="aca-empty-hint">暂无</p>'}</div>
        </div>
      </div>
    </div>`;
    bindPanel();
  };

  const bindPanel = () => {
    const s = activeSession;
    if (!s) return;
    container.querySelector('#crEndBtn')?.addEventListener('click', async () => {
      try {
        await endSession(s.id);
        toast('课堂已结束（未签到未请假学生记为旷课待处理）');
        activeSession = null;
        stopPolling();
        renderPanel();
        renderHistory();
      } catch (ex) { toast(ex.message); }
    });

    /* 学生列表（本班全部学生 + 签到态 + 行内操作） */
    const cls = classes.find((c) => c.classId === s.classId);
    const allStudents = (cls?.students || []).map((x) => ({ ...x }));
    const signMap = new Map();
    [...s.lists.signed, ...s.lists.absent, ...s.lists.leave].forEach((x) => signMap.set(x.studentId, x.status));
    const drawStuList = (q = '') => {
      const box = container.querySelector('#crStuList');
      const hits = allStudents.filter((x) => studentMatch(x, q));
      box.innerHTML = hits.map((x) => {
        const st = signMap.get(x.id) || '';
        const absentRecord = st === 'absent';
        return `
        <div class="cr-stu-row ops">
          <strong>${esc(x.name)}</strong><code>${x.id}</code>
          <em class="cr-status-pill ${st === 'signed' || st === 'signed_by_teacher' ? 'ok' : st === 'absent' ? 'bad' : st === 'leave' ? 'mut' : ''}">${st === 'signed' ? '已签到' : st === 'signed_by_teacher' ? '教师代签' : st === 'absent' ? '旷课' : st === 'leave' ? '请假' : '未签到'}</em>
          <span class="cr-ops">
            <button type="button" class="btn compact" data-sc="1" data-sid="${x.id}" title="加 1 分">+1</button>
            <button type="button" class="btn compact" data-sc="-1" data-sid="${x.id}" title="减 1 分">-1</button>
            ${st === 'leave' ? '' : absentRecord
              ? `<button type="button" class="btn ghost compact" data-cancel-absence data-sid="${x.id}">撤销旷课</button>`
              : `<button type="button" class="btn danger compact" data-absence data-sid="${x.id}">旷课</button><button type="button" class="btn ghost compact" data-proxy data-sid="${x.id}">代签</button>`}
          </span>
        </div>`;
      }).join('') || '<p class="aca-empty-hint">未找到匹配学生</p>';
      bindStuOps();
    };
    drawStuList();
    const searchInput = container.querySelector('#crSearch');
    searchInput?.addEventListener('input', () => drawStuList(searchInput.value.trim()));

    function bindStuOps() {
      container.querySelectorAll('[data-sc]').forEach((b) => b.addEventListener('click', async () => {
        try { await scoreStudent(s.id, b.dataset.sid, Number(b.dataset.sc)); toast(`${b.dataset.sc > 0 ? '已加' : '已减'} ${Math.abs(Number(b.dataset.sc))} 分`); refreshPanel(); } catch (ex) { toast(ex.message); }
      }));
      container.querySelectorAll('[data-absence]').forEach((b) => b.addEventListener('click', async () => {
        try { await markAbsence(s.id, b.dataset.sid); toast('已记旷课（-5 分）'); refreshPanel(); } catch (ex) { toast(ex.message); }
      }));
      container.querySelectorAll('[data-cancel-absence]').forEach((b) => b.addEventListener('click', async () => {
        try { await cancelAbsence(s.id, b.dataset.sid); toast('已撤销旷课（归还 5 分）'); refreshPanel(); } catch (ex) { toast(ex.message); }
      }));
      container.querySelectorAll('[data-proxy]').forEach((b) => b.addEventListener('click', async () => {
        try { await proxySign(s.id, b.dataset.sid); toast('已代签'); refreshPanel(); } catch (ex) { toast(ex.message); }
      }));
    }

    /* 随人区（头像网格 + 80ms 高亮轮换 3s → 定格 → 浮层加减分） */
    const grid = container.querySelector('#crPickGrid');
    grid.innerHTML = allStudents.length ? allStudents.map((x) => `<div class="cr-pick-avatar" data-sid="${x.id}"><strong>${esc(x.name.slice(-2))}</strong><span>${esc(x.name)}</span></div>`).join('') : '<p class="aca-empty-hint">暂无学生</p>';
    let pickTimer = null;
    container.querySelector('#crPickBtn')?.addEventListener('click', () => {
      if (pickTimer) return;
      const cells = Array.from(grid.querySelectorAll('.cr-pick-avatar'));
      if (!cells.length) return;
      const start = Date.now();
      pickTimer = setInterval(() => {
        cells.forEach((c) => c.classList.remove('pulse'));
        const random = cells[Math.floor(Math.random() * cells.length)];
        random.classList.add('pulse');
        if (Date.now() - start > 3000) {
          clearInterval(pickTimer);
          pickTimer = null;
          cells.forEach((c) => c.classList.remove('pulse'));
          random.classList.add('picked');
          setTimeout(() => { openPickResult(random.dataset.sid); }, 350);
        }
      }, 80);
    });
    const openPickResult = (studentId) => {
      const stu = allStudents.find((x) => x.id === studentId);
      if (!stu) return;
      openMiniDialog({
        host: container,
        title: `随人结果 · ${esc(stu.name)}`,
        textHTML: `${esc(stu.name)}（${esc(stu.id)}）被选中，请记录课堂表现：`,
        rawBody: `
          <div class="chip-row" style="justify-content:center">
            <button type="button" class="pick-chip" data-pd="2">+2 分</button>
            <button type="button" class="pick-chip" data-pd="1">+1 分</button>
            <button type="button" class="pick-chip" data-pd="-1">-1 分</button>
            <button type="button" class="pick-chip" data-pd="-2">-2 分</button>
            <button type="button" class="pick-chip" data-pd="0">仅记录</button>
          </div>`,
        buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '记录', cls: 'primary' }],
        onAction: async (act, d) => {
          if (act === 'cancel') return d.remove();
          const delta = Number(d.querySelector('.pick-chip[data-pd].on')?.dataset.pd || 0);
          try {
            await pickStudents(s.id, [studentId], '随人提问');
            if (delta) await scoreStudent(s.id, studentId, delta, '随人提问');
            d.remove();
            toast(delta ? `已记录：${stu.name} ${delta > 0 ? '+' : ''}${delta} 分` : `已记录：${stu.name}`);
            refreshPanel();
          } catch (ex) { toast(ex.message); }
        },
      });
      const dlg = container.querySelector('.leave-wizard');
      dlg.querySelectorAll('.pick-chip[data-pd]').forEach((c) => c.addEventListener('click', () => {
        dlg.querySelectorAll('.pick-chip[data-pd]').forEach((x) => x.classList.toggle('on', x === c));
      }));
    };
  };

  const refreshPanel = async () => {
    if (!activeSession) return;
    try {
      activeSession = await fetchSession(activeSession.id);
      if (activeSession && activeSession.status === 'open') renderPanel();
      else { activeSession = null; stopPolling(); renderPanel(); }
    } catch { /* 轮询失败静默 */ }
  };

  const startPolling = () => { stopPolling(); pollTimer = setInterval(refreshPanel, 3000); };
  const stopPolling = () => { if (pollTimer) clearInterval(pollTimer); pollTimer = null; };

  /* ---------- 历史记录 ---------- */
  const renderHistory = async () => {
    const box = container.querySelector('#crHistory');
    let list = [];
    try { list = await fetchSessions({ teacher: name }); } catch (ex) { toast(ex.message); return; }
    box.innerHTML = list.length ? list.map((s) => `
      <div class="aca-req-row" data-hs="${s.id}">
        <div class="aca-req-main">
          <div class="aca-req-title"><strong>${esc(s.courseName || '课堂')}</strong><span>${esc(s.className)} · ${s.date} ${s.start}-${s.end}</span><em class="leave-pill ${s.status === 'open' ? 'info' : 'mut'}">${s.status === 'open' ? '进行中' : '已结束'}</em></div>
          <div class="aca-req-meta">${esc(s.teacherName)} 发起 · ${s.endedAt ? `结束于 ${esc(s.endedAt.slice(0, 16).replace('T', ' '))}` : '进行中'}</div>
        </div>
        <button type="button" class="btn ghost compact" data-hv="${s.id}">${icon('chevron-right')}详情</button>
      </div>`).join('')
      : `<div class="aca-stu-empty">${icon('file', 'icon large')}<strong>暂无课堂记录</strong><span>发起课堂后在此留痕</span></div>`;
    box.querySelectorAll('[data-hv]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const d = await fetchSession(+b.dataset.hv);
        if (!d) return toast('课堂不存在');
        const counts = d.counts;
        openMiniDialog({
          host: container,
          title: `课堂详情 · ${esc(d.courseName)}`,
          textHTML: `${esc(d.className)} · ${d.date} ${d.start}-${d.end}（${esc(d.teacherName)}）<br/>已签到 <b>${counts.signed}</b> · 请假 <b>${counts.leave}</b> · 旷课 <b>${counts.absent}</b> · 应到 <b>${counts.total}</b>`,
          rawBody: `<div class="aca-review-detail">${d.events.slice(0, 12).map((e) => `<div class="aca-review-row"><span>${esc(e.studentId)}</span><strong>${esc(e.kind)}${e.delta ? `（${e.delta > 0 ? '+' : ''}${e.delta}）` : ''}${e.note ? ` · ${esc(e.note)}` : ''}</strong></div>`).join('') || '<p class="aca-empty-hint">无课堂事件</p>'}</div>`,
          buttons: [{ act: 'ok', label: '关闭', cls: 'primary' }],
          onAction: (act, dl) => dl.remove(),
        });
      } catch (ex) { toast(ex.message); }
    }));
  };

  /* ---------- 教师确认窗（P10：教务处 record-modify 修改申请 → 本模块确认/驳回） ---------- */
  const openModifyConfirm = async () => {
    if (container.querySelector('.leave-wizard')) return;
    let list = [];
    try { list = (await fetchRequests({ status: 'pending' })).filter((r) => r.type === 'record-modify'); } catch { return; }
    const req = list[0];
    if (!req) return;
    const changes = Array.isArray(req.payload?.changes) ? req.payload.changes : [];
    const diffRows = changes.map((c) => `
      <div class="aca-review-row"><span>${esc(c.studentId)} · ${c.field === 'sign' ? '签到' : c.field === 'score' ? '分值' : '旷课'}</span>
        <strong><i class="cv-from">${esc(c.field === 'sign' ? SIGN_LABEL[c.from] || c.from : String(c.from))}</i> → <i class="cv-to">${esc(c.field === 'sign' ? SIGN_LABEL[c.to] || c.to : String(c.to))}</i></strong>
      </div>`).join('');
    openMiniDialog({
      host: container,
      title: '课堂记录修改确认',
      textHTML: `${esc(req.title)}<br/><small>教务处提交于 ${esc((req.createdAt || '').slice(0, 16).replace('T', ' '))}；确认后立即生效。</small>`,
      rawBody: `
        <div class="aca-review-detail">${diffRows || '<p class="aca-empty-hint">无修改项</p>'}</div>
        <textarea class="reason-input" id="rmReason" maxlength="300" placeholder="驳回原因（驳回时必填）"></textarea>`,
      buttons: [
        { act: 'cancel', label: '稍后处理' },
        { act: 'reject', label: '驳回', cls: 'danger' },
        { act: 'approve', label: '确认生效', cls: 'primary' },
      ],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const reason = d.querySelector('#rmReason').value.trim();
        if (act === 'reject' && !reason) {
          d.querySelector('#rmReason').style.borderColor = 'var(--danger)';
          d.querySelector('#rmReason').placeholder = '驳回必须填写原因';
          return;
        }
        try {
          await reviewRequest(req.id, act, reason);
          d.remove();
          toast(act === 'approve' ? '已确认，修改已生效（教务处将收到通知）' : '已驳回（教务处将收到通知）');
          if (activeSession) refreshPanel();
        } catch (ex) { toast(ex.message); }
      },
    });
  };
  sseNewOff = context.eventBus.on('sse:workflowRequestNew', () => {
    toast('收到教务处的课堂记录修改确认请求');
    openModifyConfirm();
  });

  load();
}

export async function unmount(container) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  if (sseNewOff) { sseNewOff(); sseNewOff = null; }
  container.innerHTML = '';
  container.classList.remove('mod-classroom');
}
