// mod-courses：课程（学生/教师/IT管理员）
// 学生视图（P6）：本班周课表 + 签到卡容器（P9 实装）+ 新课/停课实时通知弹窗
// 教师视图（P7 增强 §7.3）：「全部课程|只看我的课」开关（scope=all）+ 点空格加课弹窗
//   （add-lesson 申请：班级[限本人授课班]/日期/起止/课程名）+ 点本人课请假表单
//   （teacher-leave 申请：备注必填 + createSignaturePad 签名板 + 图片材料 ≤6）+ 审批结果通知窗
// IT管理员：只读汇总（默认首班）
import { currentRole, currentName } from '../../shared/roles.js';
import { fetchClassTimetable, fetchTeacherTimetable, fetchMyTimetableEx } from '../../shared/api-timetable.js';
import { fetchMyClasses } from '../../shared/api-academic.js';
import { submitRequest, REQ_STATUS } from '../../shared/api-workflow.js';
import { fetchSession, signSession, fetchOpenSessions } from '../../shared/api-classroom.js';
import { renderTimetable } from '../../shared/timetable.js';
import { openMiniDialog, createSignaturePad, esc, icon } from '../../shared/leave-wizard.js';

let sseAddedOff = null;
let sseCancelledOff = null;
let sseSessionOff = null;
let sseReviewedOff = null;
let ttHandle = null;
let myClassId = null; // 学生本班 id（签到卡离线补拉用）

const pad2 = (n) => String(n).padStart(2, '0');

export async function mount(container, context) {
  container.classList.add('mod-courses');
  const role = context.user?.group || currentRole();
  const name = context.user?.name || currentName();
  const toast = (message) => context.eventBus.emit('ui:toast', { message });
  let teacherScope = 'mine'; // 'mine' | 'all'（教师开关）

  container.innerHTML = `
  <div class="welcome-row"><div>
    <div class="eyebrow"><span class="spark"></span>COURSES</div>
    <h1>课程</h1>
    <div class="welcome-copy">${role === '学生' ? '本班课表与课堂签到。' : role === '教师' ? '授课班级课程一览；点击空白时段申请加课，点击本人课程申请停课。' : '班级课表查询。'}</div>
  </div></div>
  <div id="courseSignCard"></div>
  <section class="surface section-card">
    <div class="section-header">
      <div><div class="section-title"><span class="section-head-icon"><svg class="icon"><use href="#i-clock"/></svg></span>${role === '学生' ? '本班课表' : role === '教师' ? '我的课表' : '课表查询'}</div></div>
      ${role === '教师' ? `
      <div class="segmented tt-teacher-switch" role="tablist" aria-label="课表视角切换">
        <button type="button" class="active" role="tab" aria-selected="true" data-s="mine">只看我的课</button>
        <button type="button" role="tab" aria-selected="false" data-s="all">全部课程</button>
      </div>` : ''}
      ${role === '学生' ? `
      <div class="segmented cs-view-switch" role="tablist" aria-label="课表视图切换">
        <button type="button" class="active" role="tab" aria-selected="true" data-v="week">周视图</button>
        <button type="button" role="tab" aria-selected="false" data-v="day">日视图</button>
      </div>` : ''}
    </div>
    ${role === '学生' ? `
    <div class="cs-day-nav" id="csDayNav" hidden>
      <button type="button" class="btn ghost compact" id="csDayPrev" aria-label="前一天">${icon('chevron-left')}</button>
      <span class="cs-day-label" id="csDayLabel"></span>
      <button type="button" class="btn ghost compact" id="csDayNext" aria-label="后一天">${icon('chevron-right')}</button>
      <span class="cs-day-hint">仅显示当日课程（点击课程卡看详情）</span>
    </div>` : ''}
    <div class="cs-timetable" id="csTimetable"></div>
    <div class="flow-foot"><span>${role === '教师' ? '点空白格申请加课 · 点本人课程申请停课（停课不补） · ' : role === '学生' ? '点击课程卡查看详情 · ' : ''}基础课每周循环 · 加课单次（紫色） · 停课置灰 · 红线为当前时刻</span></div>
  </section>`;

  const ttBox = container.querySelector('#csTimetable');

  /* ---------- C3（2026-10-29）：学生周/日视图切换 + 日导航；课程详情弹窗 ---------- */
  let studentView = 'week'; // 学生：'week' | 'day'
  const todayWd = new Date().getDay() === 0 ? 7 : new Date().getDay();
  let dayIndex = todayWd;
  const WEEK_LABELS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const syncDayNav = () => {
    const nav = container.querySelector('#csDayNav');
    if (!nav) return;
    nav.hidden = studentView !== 'day';
    const label = container.querySelector('#csDayLabel');
    if (label) label.textContent = WEEK_LABELS[dayIndex] + (dayIndex === todayWd ? '（今天）' : '');
  };
  container.querySelectorAll('.cs-view-switch button').forEach((b) => b.addEventListener('click', () => {
    container.querySelectorAll('.cs-view-switch button').forEach((x) => {
      const on = x === b;
      x.classList.toggle('active', on);
      x.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    studentView = b.dataset.v;
    dayIndex = todayWd; // 切回日视图时回到今天
    if (ttHandle) ttHandle.setMode(studentView, dayIndex);
    syncDayNav();
  }));
  container.querySelector('#csDayPrev')?.addEventListener('click', () => {
    dayIndex = dayIndex === 1 ? 7 : dayIndex - 1;
    if (ttHandle) ttHandle.setMode('day', dayIndex);
    syncDayNav();
  });
  container.querySelector('#csDayNext')?.addEventListener('click', () => {
    dayIndex = dayIndex === 7 ? 1 : dayIndex + 1;
    if (ttHandle) ttHandle.setMode('day', dayIndex);
    syncDayNav();
  });

  /* 课程详情弹窗（C3：学生/IT 点课程卡；教师点非本人课；本人课仍走停课申请） */
  const openLessonDetail = (lesson) => {
    if (container.querySelector('.leave-wizard')) return;
    const when = lesson.source === 'base' ? `每周${'日一二三四五六'[lesson.weekday % 7]}` : `单次 · ${lesson.singleDate}`;
    openMiniDialog({
      host: container,
      title: `课程 · ${esc(lesson.courseName)}`,
      textHTML: `${esc(lesson.className || '')} · ${when} ${lesson.start}-${lesson.end}`,
      rawBody: `<div class="aca-review-detail">
        <div class="aca-review-row"><span>授课教师</span><strong>${esc(lesson.teacherName)}</strong></div>
        <div class="aca-review-row"><span>类型</span><strong>${lesson.source === 'add' ? '单次加课（紫色角标）' : '每周基础课'}</strong></div>
        <div class="aca-review-row"><span>时段</span><strong>${when} ${lesson.start}-${lesson.end}</strong></div>
        ${lesson.cancelled ? '<div class="aca-review-row"><span>状态</span><strong style="color:var(--danger)">已停课（停课不补）</strong></div>' : ''}
      </div>`,
      buttons: [{ act: 'ok', label: '关闭', cls: 'primary' }],
      onAction: (act, d) => d.remove(),
    });
  };

  const loadTimetable = async () => {
    try {
      let lessons = [];
      if (role === '学生') {
        const mine = await fetchMyTimetableEx();
        lessons = mine.lessons;
        myClassId = mine.classId;
      }
      else if (role === '教师') lessons = await fetchTeacherTimetable(name, teacherScope);
      else lessons = await fetchClassTimetable(1); // IT 默认首班
      if (ttHandle) ttHandle.destroy();
      ttHandle = renderTimetable(ttBox, lessons, {
        // 视角切换由数据源 scope 承担（mine=服务端过滤本人课；all=授课班完整课表），前端不再二次过滤
        mode: role === '学生' ? studentView : 'week',
        dayIndex,
        onCellClick: role === '教师' ? (wd, minute) => openAddLesson(wd, minute) : null,
        onLessonClick: role === '教师'
          ? (lesson) => (lesson.teacherName === name ? openTeacherLeave(lesson) : openLessonDetail(lesson))
          : openLessonDetail,
      });
      syncDayNav();
    } catch (ex) {
      ttBox.innerHTML = `<div class="aca-stu-empty">${icon('clock', 'icon large')}<strong>课表加载失败</strong><span>${esc(ex.message)}</span></div>`;
    }
  };

  /* 教师开关：只看我的课 | 全部课程 */
  container.querySelectorAll('.tt-teacher-switch button').forEach((b) => b.addEventListener('click', () => {
    container.querySelectorAll('.tt-teacher-switch button').forEach((x) => {
      const on = x === b;
      x.classList.toggle('active', on);
      x.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    teacherScope = b.dataset.s;
    loadTimetable();
  }));

  /* ---------- 教师加课申请（点空白时段格；add-lesson → 教务处审批） ---------- */
  const openAddLesson = async (weekday, minute) => {
    if (container.querySelector('.leave-wizard')) return;
    let classes = [];
    try { classes = await fetchMyClasses(); } catch { /* 网络异常保持空 */ }
    if (!classes.length) { toast('尚未分配授课班级，无法加课'); return; }
    const tomorrow = new Date(Date.now() + 86400000);
    const defaultDate = `${tomorrow.getFullYear()}-${pad2(tomorrow.getMonth() + 1)}-${pad2(tomorrow.getDate())}`;
    const hh = pad2(Math.floor(minute / 60));
    const mm = pad2(minute % 60);
    const endMin = Math.min(minute + 100, 1320);
    const eh = pad2(Math.floor(endMin / 60));
    const em = pad2(endMin % 60);
    openMiniDialog({
      host: container,
      title: '申请加课（单次课）',
      textHTML: '提交后由教务处审批；通过后本班学生将实时收到新课通知。',
      rawBody: `
        <div class="aca-pane">
          <div class="wizard-label">班级：</div>
          <div class="chip-row">${classes.map((c) => `<button type="button" class="pick-chip${c.classId === classes[0].classId ? ' on' : ''}" data-al-class="${c.classId}">${esc(c.className)}</button>`).join('')}</div>
          <div class="wizard-label" style="margin-top:10px">课程名称：</div>
          <input class="aca-input" id="alCourse" maxlength="40" placeholder="如：习题课" autocomplete="off" />
          <div class="wizard-label" style="margin-top:10px">日期（单次课）：</div>
          <input class="aca-input" id="alDate" type="date" value="${defaultDate}" />
          <div class="wizard-label" style="margin-top:10px">起止时间：</div>
          <div class="cs-time-row">
            <input class="aca-input" id="alStart" type="time" value="${hh}:${mm}" />
            <span>至</span>
            <input class="aca-input" id="alEnd" type="time" value="${eh}:${em}" />
          </div>
          <input type="hidden" id="alWeekday" value="${weekday}" />
        </div>`,
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '提交申请', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const classId = +d.querySelector('.pick-chip.on')?.dataset.alClass;
        const courseName = d.querySelector('#alCourse').value.trim();
        const singleDate = d.querySelector('#alDate').value;
        const start = d.querySelector('#alStart').value;
        const end = d.querySelector('#alEnd').value;
        if (!classId) { toast('请选择班级'); return; }
        if (!courseName) { d.querySelector('#alCourse').style.borderColor = 'var(--danger)'; return; }
        if (!singleDate || !start || !end) { toast('请填写完整日期与起止时间'); return; }
        // 提交的 weekday 以所选日期实际星期为准（弹窗预填值仅用于定位）
        const wd = new Date(`${singleDate}T00:00:00`).getDay() || 7;
        try {
          await submitRequest('add-lesson', { classId, courseName, weekday: wd, start, end, singleDate });
          d.remove();
          toast('加课申请已提交，等待教务处审批');
        } catch (ex) { toast(ex.message); }
      },
    });
    container.querySelectorAll('.pick-chip[data-al-class]').forEach((c) => c.addEventListener('click', () => {
      container.querySelectorAll('.pick-chip[data-al-class]').forEach((x) => x.classList.toggle('on', x === c));
    }));
  };

  /* ---------- 教师停课申请（点本人课程；teacher-leave → 教务处审批，D4 停课不补） ---------- */
  const openTeacherLeave = (lesson) => {
    if (container.querySelector('.leave-wizard')) return;
    const when = lesson.source === 'base' ? `每周${'日一二三四五六'[lesson.weekday % 7]} ${lesson.start}-${lesson.end}` : `${lesson.singleDate} ${lesson.start}-${lesson.end}`;
    const dlg = openMiniDialog({
      host: container,
      title: `申请停课 · ${esc(lesson.courseName)}`,
      textHTML: `${esc(lesson.className || '')} · ${when}<br/><b>停课不补（D4）</b>；提交后由教务处审批，通过后本班学生实时收到停课通知。`,
      rawBody: `
        <div class="aca-pane">
          <div class="wizard-label">请假备注（必填）：</div>
          <textarea class="reason-input" id="tlNote" maxlength="300" placeholder="停课原因：如外出培训、病假等"></textarea>
          <div class="wizard-label" style="margin-top:10px">手写签名（必填）：</div>
          <canvas class="tl-sign-canvas" id="tlSign"></canvas>
          <div class="aca-teacher-foot"><button type="button" class="btn ghost compact" id="tlClear">${icon('x')}清除重签</button></div>
          <div class="wizard-label" style="margin-top:10px">图片材料（可选，≤6 张）：</div>
          <input class="aca-input" id="tlImages" type="file" accept="image/*" multiple />
        </div>`,
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '提交申请', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const note = d.querySelector('#tlNote').value.trim();
        if (!note) { d.querySelector('#tlNote').style.borderColor = 'var(--danger)'; return; }
        if (!pad.hasInk()) { toast('请手写签名'); return; }
        let images = [];
        try { images = await readImages(d.querySelector('#tlImages')); } catch { images = []; }
        try {
          await submitRequest('teacher-leave', { lessonId: lesson.id, note, signature: pad.toDataURL(), images });
          d.remove();
          toast('停课申请已提交，等待教务处审批');
        } catch (ex) { toast(ex.message); }
      },
    });
    const pad = createSignaturePad(dlg.querySelector('#tlSign'));
    dlg.querySelector('#tlClear')?.addEventListener('click', () => pad.clear());
  };

  /** 图片材料读取（dataURL，≤6 张） */
  const readImages = (input) => new Promise((resolve) => {
    const files = Array.from(input.files || []).slice(0, 6);
    if (!files.length) return resolve([]);
    const out = [];
    let done = 0;
    files.forEach((f) => {
      const reader = new FileReader();
      reader.onload = () => { out.push(reader.result); if (++done === files.length) resolve(out); };
      reader.onerror = () => { if (++done === files.length) resolve(out); };
      reader.readAsDataURL(f);
    });
  });

  loadTimetable();

  /* ---------- SSE 实时 ---------- */
  if (role === '学生') {
    sseAddedOff = context.eventBus.on('sse:timetableLessonAdded', (p) => {
      openMiniDialog({
        host: container,
        title: p?.title || '新课通知',
        textHTML: `${esc(p?.detail || '本班新增课程')}<br/><small>课表已自动刷新。</small>`,
        buttons: [{ act: 'ok', label: '知道了', cls: 'primary' }],
        onAction: (act, d) => { if (act === 'ok') d.remove(); },
      });
      loadTimetable();
    });
    sseCancelledOff = context.eventBus.on('sse:timetableLessonCancelled', (p) => {
      openMiniDialog({
        host: container,
        title: p?.title || '停课通知',
        textHTML: `${esc(p?.detail || '本班有课程停课（停课不补）')}<br/><small>课表已自动刷新。</small>`,
        buttons: [{ act: 'ok', label: '知道了', cls: 'primary' }],
        onAction: (act, d) => { if (act === 'ok') d.remove(); },
      });
      loadTimetable();
    });
    /* 签到卡（P9 实装：SSE 收到本班课堂开启 → 渲染卡；请假学生显"请假中"无按钮） */
    const renderSignCard = async (session) => {
      const card = container.querySelector('#courseSignCard');
      if (!card) return;
      let detail = null;
      try { detail = await fetchSession(session.sessionId || session.id); } catch { /* 详情拉取失败仍渲染基础卡 */ }
      const mySign = detail?.mySign;
      const isLeave = mySign?.status === 'leave';
      const isSigned = mySign?.status === 'signed' || mySign?.status === 'signed_by_teacher';
      const mode = session.signMode || detail?.signMode || 'code';
      card.innerHTML = `
      <section class="surface section-card cs-sign-card">
        <div class="section-header">
          <div><div class="section-title"><span class="section-head-icon"><svg class="icon"><use href="#i-activity"/></svg></span>课堂签到 · ${esc(session.courseName || detail?.courseName || '')}</div></div>
          ${isLeave ? '<em class="leave-pill mut">请假中</em>' : isSigned ? '<em class="leave-pill ok">已签到</em>' : '<em class="leave-pill info">进行中</em>'}
        </div>
        <div class="cs-sign-body">
          <div class="cs-sign-meta">${esc(session.teacherName || detail?.teacherName || '')} · ${esc(session.date || detail?.date || '')} ${esc(session.start || detail?.start || '')}-${esc(session.end || detail?.end || '')}</div>
          ${isLeave
            ? '<div class="cs-sign-hint">该时段您已请假，无需签到。</div>'
            : isSigned
              ? '<div class="cs-sign-hint">已完成签到。</div>'
              : `${mode === 'code' ? `<input class="aca-input cs-code-input" id="csSignCode" maxlength="4" inputmode="numeric" placeholder="输入 4 位签到口令" autocomplete="off" />` : ''}
                <button type="button" class="btn primary" id="csSignBtn">${icon('check')}${mode === 'code' ? '签到' : '点击签到'}</button>`}
        </div>
      </section>`;
      card.querySelector('#csSignBtn')?.addEventListener('click', async () => {
        const codeInput = card.querySelector('#csSignCode');
        try {
          await signSession(session.sessionId || session.id, codeInput ? codeInput.value.trim() : '');
          toast('签到成功');
          renderSignCard(session);
        } catch (ex) { toast(ex.message); }
      });
    };
    sseSessionOff = context.eventBus.on('sse:classroomSessionOpened', (session) => renderSignCard(session));
    /* 离线兜底：挂载时补拉本班进行中课堂（SSE 断连期间错过的签到卡） */
    (async () => {
      try {
        if (myClassId == null) { const mine = await fetchMyTimetableEx(); myClassId = mine.classId; }
        if (myClassId != null) {
          const opens = await fetchOpenSessions(myClassId);
          if (opens.length) renderSignCard(opens[0]);
        }
      } catch { /* 网络异常静默 */ }
    })();
  }
  if (role === '教师') {
    sseReviewedOff = context.eventBus.on('sse:workflowRequestReviewed', (r) => {
      const st = r?.status === 'approved' ? '已通过' : r?.status === 'rejected' ? `已驳回${r?.rejectReason ? `：${r.rejectReason}` : ''}` : r?.status || '';
      openMiniDialog({
        host: container,
        title: '审批结果通知',
        textHTML: `${esc(r?.title || '我的申请')}<br/><b>${st}</b>${r?.reviewedBy ? `<br/><small>审批人：${esc(r.reviewedBy)}</small>` : ''}`,
        buttons: [{ act: 'ok', label: '知道了', cls: 'primary' }],
        onAction: (act, d) => { if (act === 'ok') d.remove(); },
      });
      loadTimetable();
    });
  }
}

export async function unmount(container) {
  if (ttHandle) { ttHandle.destroy(); ttHandle = null; }
  [sseAddedOff, sseCancelledOff, sseSessionOff, sseReviewedOff].forEach((off) => { if (off) off(); });
  sseAddedOff = sseCancelledOff = sseSessionOff = sseReviewedOff = null;
  container.innerHTML = '';
  container.classList.remove('mod-courses');
}
