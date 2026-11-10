// mod-mobile-home：手机端正式请销假工作台（mobile 端口专用）
// 双端同步铁律（Rules §〇.8）：请假业务与 PC 端同步实现——学生全流程（向导/撤销/编辑/挂起/回复弹窗）、
// 导员审批（同意/拒绝）、其他教职工汇总只读；向导与弹窗复用共享件 shared/leave-wizard.js（in-host 内嵌模式）
// 教务管理视图与 PC mod-academic 同功能（学生管理/教师管理）；教师"我教的班级"与 PC mod-student-leave 同步

import { currentRole, currentName, routeMode, ROLE_NOTE, logout } from '../../shared/roles.js';
import { esc, statusPill, fmtRange, icon, openMiniDialog, openLeaveWizard, openRevokeDialog, openReplyPop, openReturnDialog, openChangePasswordDialog, teacherPill, ACTIVE_TODAY, todayStr, coversToday, withinRecentDays, createSignaturePad } from '../../shared/leave-wizard.js';
import { fetchLeaves, leaveAction } from '../../shared/api-leaves.js';
import { fetchMyClasses, fetchStudents, fetchClasses, createClass, fetchTeachers, setTeacherClasses, updateClassMembers, dissolveClass, addTeacher, renameClass } from '../../shared/api-academic.js';
import { fetchRequests, reviewRequest, submitRequest, REQ_STATUS, fetchNotifications, markNotificationsRead } from '../../shared/api-workflow.js';
import { searchAll } from '../../shared/api-todo.js';
import { fetchMyTimetableEx, fetchTeacherTimetable } from '../../shared/api-timetable.js';
import { fetchSession, startSession, endSession, proxySign, markAbsence, cancelAbsence, scoreStudent, pickStudents, fetchSessions as fetchClassroomSessions } from '../../shared/api-classroom.js';
import { fetchViolations, registerViolation, fetchViolationRules } from '../../shared/api-violations.js';
import { fetchSurveys, fetchSurvey, createSurvey, publishSurvey, closeSurvey, submitSurvey, voteSurvey, remindSurvey, fetchSurveyStats, deleteSurvey, SURVEY_STATUS, AUDIENCE_LABEL } from '../../shared/api-survey.js';
import { renderTimetable } from '../../shared/timetable.js';
import { studentMatch } from '../../shared/pinyin-util.js';

const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const GREETINGS = {
  '学生': ['早上好，同学', '祝学习顺利'],
  '教师': ['早上好，老师', '今日班级动态已就绪'],
  '教务处': ['早上好，教务处', '排课与学员安排'],
  '学生处': ['早上好，学生处', '学生事务与审批'],
  '导员': ['早上好，导员', '待办核实事项请留意'],
  'IT管理员': ['早上好，管理员', '系统运行正常'],
};

/** 首页功能入口卡：全部真实可跳转（零空话：无功能入口不上卡；双端同步：教务管理与 PC mod-academic 同功能）
 *  2026-10-24 P11：按 §11.2 注入完整卡组（课程/课堂/调课审批/课堂记录/违规与积分） */
const HOME_CARDS = {
  '学生': [
    { icon: 'file', title: '发起请假', desc: '签名与凭证一站式提交', tab: 'leave', action: 'new' },
    { icon: 'clock', title: '我的请假', desc: '审批进度与记录', tab: 'leave' },
    { icon: 'clock', title: '课程', desc: '本班课表与课堂签到', tab: 'courses' },
    { icon: 'vote', title: '问卷与投票', desc: '待填问卷与待投投票', tab: 'survey' },
  ],
  '教师': [
    { icon: 'file', title: '我教的班级', desc: '授课班级名单与请假信息', tab: 'leave' },
    { icon: 'clock', title: '课程', desc: '授课课表与加课/停课申请', tab: 'courses' },
    { icon: 'activity', title: '课堂管理', desc: '发起签到/随人/加减分', tab: 'classroom' },
    { icon: 'vote', title: '问卷与投票', desc: '待填问卷与待投投票', tab: 'survey' },
  ],
  '教务处': [
    { icon: 'book', title: '学生管理', desc: '班级分类夹与学生分配', tab: 'academic', action: 'students' },
    { icon: 'users', title: '教师管理', desc: '专业部与导员绑定', tab: 'academic', action: 'teachers' },
    { icon: 'check', title: '调课审批', desc: '加课/停课/旷课撤销', tab: 'lesson-review' },
    { icon: 'file', title: '课堂记录', desc: '全量课堂审查与修改', tab: 'class-records' },
    { icon: 'vote', title: '问卷与投票', desc: '发起问卷与统计分析', tab: 'survey' },
    { icon: 'file', title: '请假汇总', desc: '全校请假记录查询', tab: 'leave' },
  ],
  '学生处': [
    { icon: 'users', title: '学生管理', desc: '班级直改（建班/编辑/解散）', tab: 'sa', action: 'students' },
    { icon: 'check', title: '待审批', desc: '教务处班级变更申请', tab: 'sa', action: 'pending' },
    { icon: 'alert', title: '违规与积分', desc: '登记违规与低分预警', tab: 'sa', action: 'violations' },
    { icon: 'vote', title: '问卷与投票', desc: '发起问卷与统计分析', tab: 'survey' },
    { icon: 'file', title: '请假汇总', desc: '全校请假记录查询', tab: 'leave' },
  ],
  '导员': [
    { icon: 'check', title: '请假审批', desc: '处理学生请假请求', tab: 'leave' },
    { icon: 'vote', title: '问卷与投票', desc: '填写情况/催填/发起', tab: 'survey' },
  ],
  'IT管理员': [
    { icon: 'book', title: '教务管理', desc: '学生班级与教师分配', tab: 'academic', action: 'students' },
    { icon: 'vote', title: '问卷与投票', desc: '全部问卷与统计', tab: 'survey' },
    { icon: 'file', title: '数据台账', desc: '请假与核实数据', tab: 'leave' },
  ],
};

let clockTimer = null;

function toast(message) {
  const region = document.getElementById('toastRegion');
  if (!region) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `${icon('check')}<span></span>`;
  t.querySelector('span').textContent = String(message);
  region.appendChild(t);
  window.setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateY(7px)';
    window.setTimeout(() => t.remove(), 220);
  }, 2600);
}

export async function mount(container, context) {
  container.classList.add('mod-mobile-home');
  const mode = routeMode();
  const role = context.user?.group || currentRole() || '学生';
  const name = context.user?.name || currentName() || role;
  const greet = GREETINGS[role] || GREETINGS['学生'];
  const cards = HOME_CARDS[role] || HOME_CARDS['学生'];
  const now = new Date();
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const phoneScreen = () => container.querySelector('.phone-screen');

  container.innerHTML = `
    <div class="phone-frame">
      <div class="phone-screen normal-mapped-surface" data-light-surface>
        <div class="phone-status">
          <span>${mode.type === 'normal' ? '09:41' : '调试'}</span>
          <span class="phone-status-icons">${icon('wifi')}<span>92%</span></span>
        </div>
        <div class="phone-top">
          <div class="phone-brand">
            <div class="brand-mark">${icon('sparkles', 'icon')}</div>
            <div><div class="brand-title">智考通</div><div class="brand-subtitle">SMART ATTENDANCE</div></div>
          </div>
          <span class="role-chip mobile-role-chip">${icon('users')}${role}</span>
        </div>
        <div class="mobile-content" id="mobileHome">
          <div class="mobile-greeting">
            <div><h2>${greet[0]}</h2><p>${greet[1]}</p></div>
            <span class="date-chip">${weekdays[now.getDay()]} · ${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}</span>
          </div>
          <div class="m-search-wrap">
            <span class="m-search-ico">${icon('search')}</span>
            <input class="m-search-input" id="mSearchInput" type="text" placeholder="搜索 学生 / 班级 / 教师 / 课程" autocomplete="off" aria-label="全局搜索" />
          </div>
          <div class="m-search-results" id="mSearchResults" hidden></div>
          <section class="checkin-card normal-mapped-surface" data-light-surface>
            <div class="checkin-label">${role} · ${ROLE_NOTE[role] || ''}</div>
            <div class="checkin-time" data-mobile-clock>--:--</div>
            <div class="checkin-date">${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${weekdays[now.getDay()]}</div>
          </section>
          <div class="mobile-list-head"><span>功能入口</span><span class="muted">${mode.type === 'normal' ? '' : mode.label}</span></div>
          <div class="mobile-action-list">
            ${cards.map((c) => `<button type="button" class="mobile-action-card" data-tab="${c.tab}" data-action="${c.action || ''}">
              <span class="card-ico">${icon(c.icon, 'icon large')}</span>
              <span class="card-copy"><strong>${c.title}</strong><small>${c.desc}</small></span>
              <svg class="icon small" style="margin-left:auto;flex:0 0 auto"><use href="#i-chevron-right"/></svg>
            </button>`).join('')}
          </div>
        </div>
        <div class="mobile-content mobile-leave" id="mobileLeaveView" hidden></div>
        <div class="mobile-content mobile-academic" id="mobileAcademicView" hidden></div>
        <div class="mobile-content mobile-courses" id="mobileCoursesView" hidden></div>
        <div class="mobile-content mobile-classroom" id="mobileClassroomView" hidden></div>
        <div class="mobile-content mobile-sa" id="mobileSAView" hidden></div>
        <div class="mobile-content mobile-lr" id="mobileLessonReviewView" hidden></div>
        <div class="mobile-content mobile-cr" id="mobileClassRecordsView" hidden></div>
        <div class="mobile-content mobile-profile" id="mobileProfile" hidden>
          <section class="profile-card normal-mapped-surface" data-light-surface>
            <span class="avatar avatar-lg">${icon('sparkles')}</span>
            <strong class="profile-name">${name}</strong>
            <span class="role-chip">${icon('users')}${role}</span>
            <button type="button" class="btn profile-pwd" id="mobilePwdBtn">${icon('lock')}修改密码</button>
            <button type="button" class="btn profile-logout" id="mobileLogoutBtn">${icon('x')}退出登录</button>
          </section>
        </div>
        <div class="mobile-content mobile-msg" id="mobileMsgView" hidden></div>
        <div class="mobile-content mobile-survey" id="mobileSurveyView" hidden></div>
        <nav class="phone-bottom-nav" aria-label="手机底部导航">
          <button type="button" class="phone-nav-item active" data-mobile-tab="首页"><span class="nav-ico-wrap">${icon('grid', 'icon')}</span><span>首页</span></button>
          <button type="button" class="phone-nav-item" data-mobile-tab="请假"><span class="nav-ico-wrap">${icon('file', 'icon')}</span><span>请假</span></button>
          <button type="button" class="phone-nav-item" data-mobile-tab="消息"><span class="nav-ico-wrap">${icon('bell', 'icon')}</span><span>消息</span><em class="m-msg-badge" hidden>0</em></button>
          <button type="button" class="phone-nav-item" data-mobile-tab="我的"><span class="nav-ico-wrap">${icon('users', 'icon')}</span><span>我的</span></button>
        </nav>
      </div>
    </div>`;

  /* ---------------- 请假视图（双端同步：学生全流程 / 导员审批 / 其他只读） ---------------- */
  const wizardOpts = { eventBus: context.eventBus, onDone: afterWizard };
  /* C2 汇总筛选（双端同步铁律）：非学生/非教师视图的搜索与时段范围状态 */
  let mLeaveKw = '';
  let mLeaveFrom = '';
  let mLeaveTo = '';

  function afterWizard({ toast: t } = {}) {
    if (t) toast(t);
    renderLeaveView();
  }

  async function renderLeaveView() {
    const view = container.querySelector('#mobileLeaveView');
    if (!view) return;
    let leaves = [];
    try { leaves = await fetchLeaves(); } catch { /* 网络异常保持空列表 */ }
    const isStudent = role === '学生';
    const isCounselor = role === '导员';

    const title = isStudent ? '我的请假' : isCounselor ? '请假审批' : role === '教师' ? '我教的班级' : '请假汇总';
    view.innerHTML = `
      <div class="m-leave-head">
        <span>${title}</span>
        ${isStudent ? `<button type="button" class="btn primary compact" id="mNewLeaveBtn">${icon('plus')}发起申请</button>` : ''}
      </div>
      ${!isStudent && role !== '教师' ? `
      <div class="m-lv-filter">
        <input class="aca-input" id="mLvSearch" placeholder="搜索学生姓名 / 学号" value="${esc(mLeaveKw)}" autocomplete="off" />
        <div class="m-lv-filter-dates">
          <input class="aca-input" id="mLvFrom" type="date" value="${mLeaveFrom}" title="时段起" />
          <span>至</span>
          <input class="aca-input" id="mLvTo" type="date" value="${mLeaveTo}" title="时段止" />
        </div>
      </div>` : ''}
      ${role === '教师' ? `
      <div class="m-tl-tabs" role="tablist" aria-label="教师请假分页夹">
        <button type="button" class="on" data-t="today">今日请假</button>
        <button type="button" data-t="history">历史请假</button>
      </div>
      <div class="m-tl-pane" id="mTlTodayPane"></div>
      <div class="m-tl-pane" id="mTlHistoryPane" hidden></div>` : '<div class="m-leave-list" id="mLeaveList"></div>'}`;

    /* 教师视图：今日请假 / 历史请假 双板块（与 PC mod-student-leave 同功能，双端同步铁律） */
    if (role === '教师') { await renderMobileTeacherPanels(view); return; }

    const listEl = view.querySelector('#mLeaveList');
    /* C2：汇总视图按学生（姓名/学号）+时段范围过滤（与请假区间相交命中；状态变量供重渲染保值） */
    const kw = mLeaveKw.trim().toLowerCase();
    const shown = (!isStudent && role !== '教师') ? leaves.filter((l) => {
      if (kw && !String(l.studentName || '').toLowerCase().includes(kw) && !String(l.studentId || '').includes(kw)) return false;
      if (mLeaveFrom && (l.dateTo || '') < mLeaveFrom) return false;
      if (mLeaveTo && (l.dateFrom || '') > mLeaveTo) return false;
      return true;
    }) : leaves;
    const hasFilter = !!(kw || mLeaveFrom || mLeaveTo);
    view.querySelector('#mLvSearch')?.addEventListener('input', (e) => { mLeaveKw = e.target.value; renderLeaveView(); });
    view.querySelector('#mLvFrom')?.addEventListener('change', (e) => { mLeaveFrom = e.target.value; renderLeaveView(); });
    view.querySelector('#mLvTo')?.addEventListener('change', (e) => { mLeaveTo = e.target.value; renderLeaveView(); });
    listEl.innerHTML = shown.length ? shown.map((l) => `
      <div class="m-leave-card" data-id="${l.id}">
        <div class="m-lv-top">
          <span class="m-lv-no">#${String(l.id).padStart(3, '0')}</span>
          ${isCounselor || !isStudent ? `<strong class="m-lv-student">${esc(l.studentName)}</strong>` : ''}
          <span class="m-lv-type">${esc(l.type) || '—'}</span>
          ${statusPill(l.status)}
        </div>
        <div class="m-lv-range">${icon('clock')}${fmtRange(l)}</div>
        ${l.reason ? `<div class="m-lv-reason">${esc(l.reason)}</div>` : ''}
        ${l.images.length ? `<div class="m-lv-imgs">${l.images.map((s) => `<img src="${s}" alt="佐证" />`).join('')}</div>` : ''}
        ${l.status === 'rejected' && l.rejectReason ? `<div class="m-lv-note bad">${icon('alert')}导员回复：${esc(l.rejectReason)}</div>` : ''}
        ${l.status === 'revoked' && l.revokeReason ? `<div class="m-lv-note mut">${icon('alert')}撤销理由：${esc(l.revokeReason)}</div>` : ''}
        ${l.status === 'approved' && l.returnRequired ? `<div class="m-lv-note info">${icon('check')}销假要求：${[l.returnRequired.photo ? '拍照' : '', l.returnRequired.sign ? '签名' : ''].filter(Boolean).join(' + ')}</div>${l.returnNote ? `<div class="m-lv-note info">${icon('edit')}销假备注：${esc(l.returnNote)}</div>` : ''}` : ''}
        ${l.status === 'completed' ? `<div class="m-lv-note done">${icon('check')}已销假${l.returnAt ? ' · ' + l.returnAt.slice(0, 16).replace('T', ' ') : ''}</div>` : ''}
        ${isCounselor && l.status === 'editing' ? `<div class="m-lv-note info">${icon('edit')}学生正在修改申请，审批暂不可用</div>` : ''}
        ${(() => {
          if (isStudent) {
            if (l.status === 'pending') return `<div class="m-lv-ops"><button class="btn ghost compact" data-op="revoke">${icon('x')}撤销</button><button class="btn ghost compact" data-op="edit">${icon('edit')}编辑</button></div>`;
            if (l.status === 'editing') return `<div class="m-lv-ops"><button class="btn primary compact" data-op="resume">${icon('edit')}继续编辑</button></div>`;
            if (l.status === 'rejected') return `<div class="m-lv-ops"><button class="btn ghost compact" data-op="view-reply">${icon('alert')}查看回复</button><button class="btn primary compact" data-op="edit">${icon('edit')}修改重提</button></div>`;
            if (l.status === 'approved' && l.returnRequired) return `<div class="m-lv-ops"><button class="btn primary compact" data-op="return">${icon('check')}销假</button></div>`;
            return '';
          }
          if (isCounselor) {
            if (l.status === 'pending') return `<div class="m-lv-ops"><button class="btn compact" data-op="approve">${icon('check')}同意</button><button class="btn danger compact" data-op="reject">${icon('x')}拒绝</button></div>`;
            if (l.status === 'editing') return `<div class="m-lv-ops"><button class="btn compact" disabled>${icon('check')}同意</button><button class="btn danger compact" disabled>${icon('x')}拒绝</button></div>`;
          }
          return '';
        })()}
      </div>`).join('') : `
      <div class="m-leave-empty">${icon('file', 'icon large')}<strong>${hasFilter && !isStudent ? '无匹配记录' : '暂无请假记录'}</strong>${hasFilter && !isStudent ? '<span>调整筛选条件后重试</span>' : ''}</div>`;

    /* 学生未读拒绝回复弹窗（进入请假页自动弹） */
    if (isStudent) {
      const readKey = 'zkt.rejectedRead';
      const read = JSON.parse(localStorage.getItem(readKey) || '[]');
      const unread = leaves.filter((l) => l.status === 'rejected' && !read.includes(l.id));
      if (unread.length && !container.querySelector('.leave-wizard')) {
        openReplyPop({
          host: phoneScreen(), inHost: true, leave: unread[0], eventBus: context.eventBus,
          onFix: async (lv) => {
            try { const r = await leaveAction(lv.id, 'start-edit'); openLeaveWizard({ ...wizardOpts, host: phoneScreen(), inHost: true, mode: 'edit', leave: r.leave }); }
            catch (ex) { toast(ex.message); }
          },
        });
        read.push(unread[0].id);
        localStorage.setItem(readKey, JSON.stringify(read.slice(-50)));
      }
    }

    /* 卡片操作 */
    listEl.querySelectorAll('.m-leave-card').forEach((card) => {
      card.querySelectorAll('[data-op]').forEach((btn) => {
        btn.addEventListener('click', () => handleOp(+card.dataset.id, btn.dataset.op, leaves));
      });
    });

    view.querySelector('#mNewLeaveBtn')?.addEventListener('click', startNewLeave);
  }

  const handleOp = async (id, op, leaves) => {
    const leave = leaves.find((l) => l.id === id);
    if (!leave) return;
    if (container.querySelector('.leave-wizard')) return; // 防重入
    if (op === 'revoke') return openRevokeDialog({ host: phoneScreen(), inHost: true, leave, eventBus: context.eventBus, onDone: renderLeaveView });
    if (op === 'return') return openReturnDialog({ host: phoneScreen(), inHost: true, leave, eventBus: context.eventBus, onDone: renderLeaveView });
    if (op === 'view-reply') return openReplyPop({
      host: phoneScreen(), inHost: true, leave, eventBus: context.eventBus,
      onFix: (lv) => handleOp(lv.id, 'edit', [lv]),
    });
    if (op === 'resume') return openLeaveWizard({ ...wizardOpts, host: phoneScreen(), inHost: true, mode: 'edit', leave });
    if (op === 'edit') {
      try { const r = await leaveAction(id, 'start-edit'); openLeaveWizard({ ...wizardOpts, host: phoneScreen(), inHost: true, mode: 'edit', leave: r.leave }); }
      catch (ex) { toast(ex.message); }
    }
    if (op === 'approve') {
      // 同意弹窗：是否要求学生主动销假 → 勾选凭证（拍照/签名）——与 PC 端同交互
      openMiniDialog({
        host: phoneScreen(), inHost: true,
        title: `同意请假 #${String(id).padStart(3, '0')}`,
        textHTML: `同意 ${esc(leave.studentName)} 的${esc(leave.type)}申请？`,
        rawBody: `
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
             <textarea class="reason-input cv-note-input" id="apNote" maxlength="300" placeholder="销假备注（选填）：如拍照具体拍什么，将展示给学生"></textarea>
           </div>`,
        buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '确认同意', cls: 'primary' }],
        onAction: async (act, d) => {
          if (act === 'cancel') return d.remove();
          let requireReturn = null;
          let returnNote = '';
          if (d.querySelector('.cv-rs-btn.active')?.dataset.rs === 'yes') {
            const photo = !!d.querySelector('.cv-opt-chip[data-opt="photo"]')?.classList.contains('on');
            const sign = !!d.querySelector('.cv-opt-chip[data-opt="sign"]')?.classList.contains('on');
            if (!photo && !sign) { d.querySelector('.cv-return-q').style.color = 'var(--danger)'; return; }
            requireReturn = { photo, sign };
            returnNote = d.querySelector('#apNote')?.value.trim() || '';
          }
          try {
            await leaveAction(id, 'approve', { requireReturn, returnNote });
            d.remove();
            context.eventBus.emit('verify:completed', { leaveId: id, conclusion: '通过', verifiedBy: role });
            toast(requireReturn ? '已同意，学生需按要求销假' : '已同意该请假申请');
            renderLeaveView();
          } catch (ex) { toast(ex.message); }
        },
      });
      // 交互绑定（openMiniDialog 只代理 data-act 按钮，勾选件在此绑定）
      const dlg = container.querySelector('.phone-screen .mini-dialog:last-of-type') || container.querySelector('.mini-dialog');
      const optsBox = dlg?.querySelector('.cv-return-opts');
      if (dlg && optsBox) {
        dlg.querySelectorAll('.cv-rs-btn').forEach((b) => b.addEventListener('click', () => {
          dlg.querySelectorAll('.cv-rs-btn').forEach((x) => x.classList.toggle('active', x === b));
          const yes = b.dataset.rs === 'yes';
          optsBox.hidden = !yes;
          if (!yes) optsBox.querySelectorAll('.cv-opt-chip').forEach((c) => c.classList.remove('on'));
        }));
        optsBox.querySelectorAll('.cv-opt-chip').forEach((c) => c.addEventListener('click', () => c.classList.toggle('on')));
      }
    }
    if (op === 'reject') {
      openMiniDialog({
        host: phoneScreen(), inHost: true,
        title: `拒绝请假 #${String(id).padStart(3, '0')}`,
        textHTML: '拒绝理由将返回给学生：<b style="color:var(--danger)">*</b>',
        textarea: { placeholder: '拒绝理由（必填）' },
        buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '确认拒绝', cls: 'danger' }],
        onAction: async (act, d) => {
          if (act === 'cancel') return d.remove();
          const reason = d.querySelector('#miniReason').value.trim();
          if (!reason) { d.querySelector('.wizard-text').innerHTML = '拒绝理由将返回给学生：<b style="color:var(--danger)">请填写拒绝理由</b>'; return; }
          try {
            await leaveAction(id, 'reject', { reason });
            d.remove();
            context.eventBus.emit('verify:completed', { leaveId: id, conclusion: '退回', verifiedBy: role });
            toast('已拒绝，理由已返回给学生');
            renderLeaveView();
          } catch (ex) { toast(ex.message); }
        },
      });
    }
  };

  /* 发起申请：检查挂起/编辑中旧申请（与 PC 同逻辑） */
  async function startNewLeave() {
    if (container.querySelector('.leave-wizard')) return; // 防重入
    let leaves = [];
    try { leaves = await fetchLeaves(); } catch { /* 忽略，直接新建 */ }
    const editingOne = leaves.find((l) => l.status === 'editing');
    if (!editingOne) return openLeaveWizard({ ...wizardOpts, host: phoneScreen(), inHost: true, mode: 'new', leave: null });
    openMiniDialog({
      host: phoneScreen(), inHost: true,
      title: '存在未完成的请假申请',
      textHTML: `您有一份正在编辑的申请（#${String(editingOne.id).padStart(3, '0')}）尚未提交。继续新申请将清除之前的编辑记录。`,
      buttons: [{ act: 'resume', label: '继续编辑', cls: 'primary' }, { act: 'rewrite', label: '重写申请' }],
      onAction: async (act, d) => {
        d.remove();
        if (act === 'resume') openLeaveWizard({ ...wizardOpts, host: phoneScreen(), inHost: true, mode: 'edit', leave: editingOne });
        else {
          try { await leaveAction(editingOne.id, 'delete'); } catch (ex) { toast(ex.message); }
          openLeaveWizard({ ...wizardOpts, host: phoneScreen(), inHost: true, mode: 'new', leave: null });
        }
      },
    });
  }

  /* ---------------- 教师视图：今日请假 / 历史请假 双板块（手机端，双端同步 PC mod-student-leave） ---------------- */
  async function renderMobileTeacherPanels(view) {
    const todayPane = view.querySelector('#mTlTodayPane');
    const histPane = view.querySelector('#mTlHistoryPane');
    if (!todayPane || !histPane) return;
    let classes = [];
    try { classes = await fetchMyClasses(); } catch { /* 网络异常保持空 */ }
    const today = todayStr();

    if (!classes.length) {
      todayPane.innerHTML = `<div class="m-tc-empty">${icon('book', 'icon large')}<strong>暂未分配授课班级</strong><span>请联系教务处分記</span></div>`;
      histPane.innerHTML = '';
      return;
    }

    /* Tab 切换 */
    view.querySelectorAll('.m-tl-tabs button').forEach((b) => b.addEventListener('click', () => {
      view.querySelectorAll('.m-tl-tabs button').forEach((x) => x.classList.toggle('on', x === b));
      todayPane.hidden = b.dataset.t !== 'today';
      histPane.hidden = b.dataset.t !== 'history';
    }));

    drawMobileTeacherToday(todayPane, classes, today);
    drawMobileTeacherHistory(histPane, classes);
  }

  /** 今日请假：按班级分组，班级卡（N 人），仅显示有今日请假学生的班级；展开看学生+三态胶囊 */
  function drawMobileTeacherToday(pane, classes, today) {
    const groups = classes.map((c) => {
      const stus = (c.students || []).map((s) => {
        const active = (s.leaves || []).filter((l) => ACTIVE_TODAY.includes(l.status) && coversToday(l, today));
        return active.length ? { id: s.id, name: s.name, active } : null;
      }).filter(Boolean);
      return stus.length ? { className: c.className, stus } : null;
    }).filter(Boolean);

    if (!groups.length) {
      pane.innerHTML = `<div class="m-tc-empty">${icon('check', 'icon large')}<strong>今日无请假学生</strong><span>授课班级今日时段内没有请假记录</span></div>`;
      return;
    }
    pane.innerHTML = groups.map((g) => `
      <div class="m-tc-card">
        <button type="button" class="m-tc-head">${icon('book')}<strong>${esc(g.className)}</strong><em>（今日请假<b>${g.stus.length}</b>人）</em><svg class="icon small" style="margin-left:auto"><use href="#i-chevron-down"/></svg></button>
        <div class="m-tc-body" hidden>
          ${g.stus.map((s) => `
          <div class="m-tl-stu">
            <div class="m-tc-top"><strong>${esc(s.name)}</strong><code>${s.id}</code></div>
            <div class="m-tl-pills">${s.active.map((l) => teacherPill(l.status)).join('')}</div>
          </div>`).join('')}
        </div>
      </div>`).join('');
    pane.querySelectorAll('.m-tc-head').forEach((h) => h.addEventListener('click', () => {
      const body = h.parentElement.querySelector('.m-tc-body');
      body.hidden = !body.hidden;
      h.parentElement.classList.toggle('open', !body.hidden);
    }));
  }

  /** 历史请假：班级内全部学生（含 0 次，不可展开）；搜索（姓名/学号/拼音）；每页 10 人；气泡（近期请过假蓝底白字/有被驳回记录红底白字）；有记录学生单击展开细则（六态原样） */
  function drawMobileTeacherHistory(pane, classes) {
    const state = { page: 1, query: '' };
    pane.innerHTML = `
      <div class="m-tl-search">${icon('search')}<input type="search" id="mTlSearch" placeholder="搜索姓名 / 学号 / 拼音（如 zhangsan、zs）" autocomplete="off" /></div>
      <div id="mTlHistList"></div>
      <div class="m-tl-pager" id="mTlPager"></div>`;
    const input = pane.querySelector('#mTlSearch');
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

      pane.querySelector('#mTlHistList').innerHTML = pageList.length ? pageList.map((s) => {
        const recent = s.leaves.some((l) => withinRecentDays(l, 3));
        const rejected = s.leaves.some((l) => l.status === 'rejected');
        const badges = `${recent ? '<span class="m-tl-bubble blue">近期请过假</span>' : ''}${rejected ? '<span class="m-tl-bubble red">有被驳回记录</span>' : ''}`;
        return `
        <div class="m-tl-hist-card${s.leaves.length ? '' : ' none'}">
          <button type="button" class="m-tl-hist-head"${s.leaves.length ? '' : ' disabled'}>
            <strong>${esc(s.name)}</strong><code>${s.id}</code>
            <em>共请过 ${s.leaves.length} 次假</em>${badges}
            ${s.leaves.length ? '<svg class="icon small" style="margin-left:auto"><use href="#i-chevron-down"/></svg>' : ''}
          </button>
          ${s.leaves.length ? `<div class="m-tl-hist-body" hidden>
            ${s.leaves.map((l) => `<div class="m-tl-detail">${statusPill(l.status)}<span>${fmtRange(l)}</span></div>`).join('')}
          </div>` : ''}
        </div>`;
      }).join('') : `<div class="m-leave-empty">${icon('search', 'icon large')}<strong>未找到匹配学生</strong></div>`;

      pane.querySelectorAll('.m-tl-hist-head:not([disabled])').forEach((h) => h.addEventListener('click', () => {
        const body = h.parentElement.querySelector('.m-tl-hist-body');
        body.hidden = !body.hidden;
        h.parentElement.classList.toggle('open', !body.hidden);
      }));

      const pager = pane.querySelector('#mTlPager');
      pager.innerHTML = list.length ? `
        <button type="button" class="btn ghost compact" data-p="prev" ${state.page <= 1 ? 'disabled' : ''}>${icon('chevron-left')}上一页</button>
        <span class="m-tl-page-info">${state.page} / ${totalPages} 页 · ${list.length} 人</span>
        <button type="button" class="btn ghost compact" data-p="next" ${state.page >= totalPages ? 'disabled' : ''}>下一页${icon('chevron-right')}</button>` : '';
      pager.querySelectorAll('button[data-p]').forEach((b) => b.addEventListener('click', () => {
        if (b.disabled) return;
        state.page += b.dataset.p === 'prev' ? -1 : 1;
        draw();
      }));
    }
    draw();
  }

  /* ---------------- 教务管理视图（教务处/IT，双端同步 PC mod-academic） ---------------- */
  let acaFolder = 'un';
  let acaTab = 'students';

  async function renderAcademicView() {
    const view = container.querySelector('#mobileAcademicView');
    if (!view) return;
    view.innerHTML = `
      <div class="segmented m-aca-tabs" role="tablist" aria-label="教务管理切换">
        <button type="button" class="${acaTab === 'students' ? 'active' : ''}" role="tab" aria-selected="${acaTab === 'students'}" data-t="students">学生管理</button>
        <button type="button" class="${acaTab === 'teachers' ? 'active' : ''}" role="tab" aria-selected="${acaTab === 'teachers'}" data-t="teachers">教师管理</button>
      </div>
      <div id="mAcaBody"></div>`;
    view.querySelectorAll('.m-aca-tabs button').forEach((b) => b.addEventListener('click', () => { acaTab = b.dataset.t; renderAcademicView(); }));
    if (acaTab === 'students') await renderAcaStudents(view.querySelector('#mAcaBody'));
    else await renderAcaTeachers(view.querySelector('#mAcaBody'));
  }

  async function renderAcaStudents(body) {
    let students = [];
    let classes = [];
    let unassigned = 0;
    try { [students, { classes, unassigned }] = await Promise.all([fetchStudents(), fetchClasses()]); } catch { /* 网络异常保持空 */ }
    const isUn = acaFolder === 'un';
    const cls = classes.find((c) => c.id === acaFolder);
    const list = isUn ? students.filter((s) => !s.classId) : students.filter((s) => s.classId === acaFolder);
    body.innerHTML = `
      <div class="m-aca-folders">
        ${classes.map((c) => `<button type="button" class="m-aca-folder${acaFolder === c.id ? ' on' : ''}" data-f="${c.id}">${icon('book')}${esc(c.name)}<em>${c.count}</em></button>`).join('')}
        <button type="button" class="aca-folder-add" id="mNewClass">${icon('plus')}新建班级</button>
      </div>
      <button type="button" class="m-aca-folder m-un-row${isUn ? ' on' : ''}" data-f="un">${icon('users')}未分配<em>${unassigned}</em></button>
      ${!isUn ? `<div class="m-aca-tools">
        <button type="button" class="btn ghost compact" id="mRenameClass">${icon('edit')}重命名</button>
        <button type="button" class="btn ghost compact" id="mEditClass">${icon('edit')}编辑</button>
        <button type="button" class="btn danger compact" id="mDissolveClass">${icon('x')}解散</button>
      </div>` : ''}
      <div class="m-aca-stu-list">${list.length ? list.slice(0, 60).map((s) => `
        <div class="m-aca-stu"><strong>${esc(s.name)}</strong><code>${s.id}</code></div>`).join('') + (list.length > 60 ? `<span class="m-tc-more">仅显示前 60 名，共 ${list.length} 名</span>` : '')
        : `<div class="m-tc-empty">${icon('users', 'icon large')}<strong>${isUn ? '全部学生已分配班级' : '班级暂无学生'}</strong></div>`}</div>`;
    body.querySelectorAll('.m-aca-folder').forEach((b) => b.addEventListener('click', () => { acaFolder = isNaN(+b.dataset.f) ? 'un' : +b.dataset.f; renderAcaStudents(body); }));
    body.querySelector('#mNewClass')?.addEventListener('click', () => openAcaNewClass(body));
    body.querySelector('#mEditClass')?.addEventListener('click', () => openAcaEditClass(body, cls, students));
    body.querySelector('#mDissolveClass')?.addEventListener('click', () => openAcaDissolveClass(body, cls, list.length));
    body.querySelector('#mRenameClass')?.addEventListener('click', () => openAcaRenameClass(body, cls));
  }

  /* 班级重命名（教务管理视图：IT 直改 / 教务处走 class-rename 申请→学生处审批；2026-10-29 C1 双端同步） */
  function openAcaRenameClass(body, cls) {
    if (container.querySelector('.leave-wizard')) return;
    const isDirect = role === 'IT管理员';
    openMiniDialog({
      host: phoneScreen(), inHost: true,
      title: `${isDirect ? '重命名' : '申请重命名'} · ${esc(cls?.name || '')}`,
      textHTML: isDirect ? '输入新班级名称（唯一；保存后立即生效）。' : '填写新班级名称，提交后由学生处审批；通过后生效。',
      rawBody: `<input class="aca-input" id="mAcaRenameName" maxlength="30" placeholder="新班级名称" value="${esc(cls?.name || '')}" autocomplete="off" />`,
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: isDirect ? '保存' : '提交申请', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const name = d.querySelector('#mAcaRenameName').value.trim();
        if (!name || name === cls?.name) { d.querySelector('#mAcaRenameName').style.borderColor = 'var(--danger)'; return; }
        try {
          if (isDirect) {
            await renameClass(acaFolder, name);
            d.remove();
            toast(`已重命名：「${cls?.name}」→「${name}」`);
            renderAcaStudents(body);
          } else {
            await submitRequest('class-rename', { classId: acaFolder, name });
            d.remove();
            toast(`已提交「重命名 ${cls?.name || ''} → ${name}」申请，等待学生处审批`);
          }
        } catch (ex) { toast(ex.message); }
      },
    });
  }

  /* 编辑班级成员（弹窗三栏 segmented：添加学生/批量添加/移除学生，统一提交；与 PC 同构，双端同步铁律）（2026-10-23 重构，吸收原「添加学生」弹窗） */
  function openAcaEditClass(body, cls, students) {
    if (container.querySelector('.leave-wizard')) return;
    const members = students.filter((s) => s.classId === acaFolder);
    const unList = students.filter((s) => !s.classId);
    const dlg = openMiniDialog({
      host: phoneScreen(), inHost: true,
      title: `编辑班级 · ${esc(cls?.name || '')}`,
      textHTML: '切换标签添加或移除学生，点击保存统一生效。',
      rawBody: `
        <div class="segmented aca-dlg-tabs" role="tablist" aria-label="班级成员管理">
          <button type="button" class="active" role="tab" aria-selected="true" data-t="add">${icon('plus')}添加学生</button>
          <button type="button" role="tab" aria-selected="false" data-t="batch">${icon('edit')}批量添加</button>
          <button type="button" role="tab" aria-selected="false" data-t="remove">${icon('x')}移除学生</button>
        </div>
        <div class="aca-pane" data-p="add">
          <div class="wizard-label">未分配学生 <small>${unList.length} 人（勾选将加入）</small></div>
          <div class="aca-pick-list">${unList.length ? unList.map((s) => `
            <label class="aca-pick-row"><input type="checkbox" data-add="${s.id}" /><strong>${esc(s.name)}</strong><code>${s.id}</code></label>`).join('')
            : '<p class="aca-empty-hint">没有未分配的学生</p>'}</div>
        </div>
        <div class="aca-pane" data-p="batch" hidden>
          <textarea class="reason-input" id="acaBatch" placeholder="000000001,000000002&#10;（学号 + 英文逗号 + 学号，可换行；兼容中文逗号/顿号/空格）"></textarea>
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
        const batchIds = [...new Set(d.querySelector('#acaBatch').value.split(/[,，、\s]+/).map((x) => x.trim()).filter(Boolean))];
        const addIds = [...new Set([...checkedIds, ...batchIds])];
        if (!removeIds.length && !addIds.length) { toast('未勾选任何更改'); return; }
        try {
          const r = await updateClassMembers(acaFolder, removeIds, addIds);
          d.remove();
          toast(`已保存：移出 ${r.removed} 人、加入 ${r.added} 人`);
          renderAcaStudents(body);
        } catch (ex) { toast(ex.message); }
      },
    });
    /* Tab 切换手动绑定（踩坑 #01；与登录页 login-tabs 同款 active + aria-selected） */
    dlg.querySelectorAll('.aca-dlg-tabs button').forEach((b) => b.addEventListener('click', () => {
      dlg.querySelectorAll('.aca-dlg-tabs button').forEach((x) => {
        const on = x === b;
        x.classList.toggle('active', on);
        x.setAttribute('aria-selected', String(on));
      });
      dlg.querySelectorAll('.aca-pane').forEach((p) => { p.hidden = p.dataset.p !== b.dataset.t; });
    }));
  }

  /* 解散班级（确认弹窗：必填解散原因；与 PC 同功能）（2026-10-22） */
  function openAcaDissolveClass(body, cls, count) {
    if (container.querySelector('.leave-wizard')) return;
    openMiniDialog({
      host: phoneScreen(), inHost: true,
      title: `解散班级 · ${esc(cls?.name || '')}`,
      textHTML: `解散后该班级夹将删除，<b>${count} 名学生</b>还原为未分配，相关教师的授课关联同步清除。此操作不可恢复。`,
      rawBody: '<textarea class="reason-input" id="mDissolveReason" maxlength="200" placeholder="解散原因（必填）：如班级合并、重新分班等"></textarea>',
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '确认解散', cls: 'danger' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const reason = d.querySelector('#mDissolveReason').value.trim();
        if (!reason) { d.querySelector('#mDissolveReason').style.borderColor = 'var(--danger)'; d.querySelector('#mDissolveReason').placeholder = '请填写解散原因（必填）'; return; }
        try {
          const r = await dissolveClass(acaFolder, reason);
          d.remove();
          acaFolder = 'un';
          toast(`已解散班级「${cls?.name}」，${r.released} 名学生还原为未分配`);
          renderAcaStudents(body);
        } catch (ex) { toast(ex.message); }
      },
    });
  }

  function openAcaNewClass(body) {
    if (container.querySelector('.leave-wizard')) return;
    openMiniDialog({
      host: phoneScreen(), inHost: true,
      title: '新建班级',
      textHTML: '输入班级名称（分类夹），创建后可通过「编辑」勾选学生划入。',
      rawBody: '<input class="aca-input" id="acaClassName" maxlength="30" placeholder="班级名称（如：计算机2301）" autocomplete="off" />',
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '创建', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const name = d.querySelector('#acaClassName').value.trim();
        if (!name) { d.querySelector('#acaClassName').style.borderColor = 'var(--danger)'; return; }
        try {
          const r = await createClass(name);
          d.remove();
          acaFolder = r.id;
          toast(`已创建班级「${name}」`);
          renderAcaStudents(body);
        } catch (ex) { toast(ex.message); }
      },
    });
  }

  let acaExpandedTeacher = null;
  async function renderAcaTeachers(body) {
    let teachers = [];
    let classes = [];
    try { [teachers, { classes }] = await Promise.all([fetchTeachers(), fetchClasses()]); } catch { /* 网络异常保持空 */ }
    body.innerHTML = `
    <button type="button" class="aca-folder-add" id="mAcaAddTeacher" style="margin:0 0 10px">${icon('plus')}添加教师</button>
    ${teachers.map((t) => {
      const open = acaExpandedTeacher === t.name;
      const names = t.classIds.map((cid) => classes.find((c) => c.id === cid)?.name).filter(Boolean);
      return `
      <div class="m-tc-card${open ? ' open' : ''}">
        <button type="button" class="m-tc-head">${icon('users')}<strong>${esc(t.name)}</strong><em>${names.length || '未分配'}</em><svg class="icon small" style="margin-left:auto"><use href="#i-chevron-down"/></svg></button>
        ${open ? `<div class="m-tc-body">
          <div class="chip-row">${classes.length ? classes.map((c) => `<button type="button" class="pick-chip${t.classIds.includes(c.id) ? ' on' : ''}" data-cid="${c.id}">${esc(c.name)}</button>`).join('') : '<span class="aca-empty-hint">尚未创建班级</span>'}</div>
          <div class="m-aca-tools"><button type="button" class="btn primary compact" data-save="${esc(t.name)}">${icon('check')}保存</button></div>
        </div>` : ''}
      </div>`;
    }).join('')}`;
    /* 添加教师（2026-10-24 双端同步：与 PC mod-academic 教师管理同功能，in-host 弹窗） */
    body.querySelector('#mAcaAddTeacher')?.addEventListener('click', () => {
      if (container.querySelector('.leave-wizard')) return;
      openMiniDialog({
        host: phoneScreen(), inHost: true,
        title: '添加教师',
        textHTML: '输入教师姓名（2–30 字，不可与管理账号重名）；创建后即可登录。',
        rawBody: '<input class="aca-input" id="mAcaTeacherName" maxlength="30" placeholder="教师姓名（如：张伟 / 教师03）" autocomplete="off" />',
        buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '创建', cls: 'primary' }],
        onAction: async (act, d) => {
          if (act === 'cancel') return d.remove();
          const name = d.querySelector('#mAcaTeacherName').value.trim();
          if (!name) { d.querySelector('#mAcaTeacherName').style.borderColor = 'var(--danger)'; return; }
          try {
            await addTeacher(name);
            d.remove();
            toast(`已添加教师「${name}」（登录页教职工下拉即时可见）`);
            acaExpandedTeacher = null;
            renderAcaTeachers(body);
          } catch (ex) { toast(ex.message); }
        },
      });
    });
    body.querySelectorAll('.m-tc-head').forEach((h) => h.addEventListener('click', () => {
      acaExpandedTeacher = acaExpandedTeacher === h.parentElement.querySelector('strong')?.textContent ? null : h.parentElement.querySelector('strong')?.textContent;
      renderAcaTeachers(body);
    }));
    body.querySelectorAll('.pick-chip[data-cid]').forEach((c) => c.addEventListener('click', () => c.classList.toggle('on')));
    body.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', async () => {
      const classIds = Array.from(b.closest('.m-tc-card').querySelectorAll('.pick-chip.on')).map((c) => +c.dataset.cid);
      try {
        await setTeacherClasses(b.dataset.save, classIds);
        toast(`已保存 ${b.dataset.save} 的授课班级`);
        acaExpandedTeacher = null;
        renderAcaTeachers(body);
      } catch (ex) { toast(ex.message); }
    }));
  }

  /* ---------------- 课程视图（P11：学生=课表+签到卡+通知；教师=课表+开关+加课/停课申请；C3 学生日视图+详情） ---------------- */
  let myClassIdMobile = null;
  let studentViewMobile = 'week'; // C3：学生周/日视图状态（跨重渲染保留）
  let dayIndexMobile = new Date().getDay() === 0 ? 7 : new Date().getDay();
  async function renderCoursesView() {
    const view = container.querySelector('#mobileCoursesView');
    if (!view) return;
    const isStudent = role === '学生';
    const isTeacher = role === '教师';
    view.innerHTML = `
      <div class="m-view-head"><span>${isStudent ? '我的课表' : isTeacher ? '我的课表' : '课表查询'}</span></div>
      <div id="mSignCard"></div>
      ${isTeacher ? `
      <div class="segmented m-tt-switch" role="tablist" aria-label="课表视角">
        <button type="button" class="active" role="tab" aria-selected="true" data-s="mine">只看我的课</button>
        <button type="button" role="tab" aria-selected="false" data-s="all">全部课程</button>
      </div>` : ''}
      ${isStudent ? `
      <div class="m-tt-viewrow">
        <div class="segmented m-tt-switch m-tt-day" role="tablist" aria-label="课表视图">
          <button type="button" class="active" role="tab" aria-selected="true" data-v="week">周视图</button>
          <button type="button" role="tab" aria-selected="false" data-v="day">日视图</button>
        </div>
        <div class="m-day-nav" id="mDayNav" hidden>
          <button type="button" class="btn ghost compact" id="mDayPrev" aria-label="前一天">${icon('chevron-left')}</button>
          <span class="m-day-label" id="mDayLabel"></span>
          <button type="button" class="btn ghost compact" id="mDayNext" aria-label="后一天">${icon('chevron-right')}</button>
        </div>
      </div>` : ''}
      <div class="m-tt-box" id="mTtBox"></div>
      <div class="m-view-foot">${isTeacher ? '点空白格申请加课 · 点本人课申请停课' : '红线为当前时刻 · 紫色为单次加课'}</div>`;
    const ttBox = view.querySelector('#mTtBox');
    let scope = 'mine';
    /* C3 双端同步：学生周/日视图 + 日导航 + 课程详情弹窗（与 PC mod-courses 同能力） */
    const TODAY_WD = new Date().getDay() === 0 ? 7 : new Date().getDay();
    const WEEK_LABELS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const syncDayNav = () => {
      const nav = view.querySelector('#mDayNav');
      if (!nav) return;
      nav.hidden = studentViewMobile !== 'day';
      const label = view.querySelector('#mDayLabel');
      if (label) label.textContent = WEEK_LABELS[dayIndexMobile] + (dayIndexMobile === TODAY_WD ? '（今天）' : '');
    };
    const openLessonDetailMobile = (lesson) => {
      if (container.querySelector('.leave-wizard')) return;
      const when = lesson.source === 'base' ? `每周${'日一二三四五六'[lesson.weekday % 7]}` : `单次 · ${lesson.singleDate}`;
      openMiniDialog({
        host: phoneScreen(), inHost: true,
        title: `课程 · ${esc(lesson.courseName)}`,
        textHTML: `${esc(lesson.className || '')} · ${when} ${lesson.start}-${lesson.end}`,
        rawBody: `<div class="aca-review-detail">
          <div class="aca-review-row"><span>授课教师</span><strong>${esc(lesson.teacherName)}</strong></div>
          <div class="aca-review-row"><span>类型</span><strong>${lesson.source === 'add' ? '单次加课' : '每周基础课'}</strong></div>
          <div class="aca-review-row"><span>时段</span><strong>${when} ${lesson.start}-${lesson.end}</strong></div>
          ${lesson.cancelled ? '<div class="aca-review-row"><span>状态</span><strong style="color:var(--danger)">已停课（停课不补）</strong></div>' : ''}
        </div>`,
        buttons: [{ act: 'ok', label: '关闭', cls: 'primary' }],
        onAction: (act, d) => d.remove(),
      });
    };
    const drawTT = async () => {
      try {
        let lessons = [];
        if (isStudent) { const mine = await fetchMyTimetableEx(); lessons = mine.lessons; myClassIdMobile = mine.classId; }
        else if (isTeacher) lessons = await fetchTeacherTimetable(name, scope);
        else lessons = await (await import('../../shared/api-timetable.js')).fetchClassTimetable(1);
        if (ttHandleMobile) ttHandleMobile.destroy();
        ttHandleMobile = renderTimetable(ttBox, lessons, {
          compact: true,
          mode: isStudent ? studentViewMobile : 'week',
          dayIndex: dayIndexMobile,
          onCellClick: isTeacher ? (wd, minute) => mOpenAddLesson(wd, minute) : null,
          onLessonClick: isTeacher
            ? (lesson) => (lesson.teacherName === name ? mOpenTeacherLeave(lesson) : openLessonDetailMobile(lesson))
            : openLessonDetailMobile,
        });
        syncDayNav();
      } catch (ex) { ttBox.innerHTML = `<div class="aca-stu-empty">${icon('clock', 'icon large')}<strong>课表加载失败</strong><span>${esc(ex.message)}</span></div>`; }
    };
    view.querySelectorAll('.m-tt-switch.m-tt-day button').forEach((b) => b.addEventListener('click', () => {
      view.querySelectorAll('.m-tt-switch.m-tt-day button').forEach((x) => {
        const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', String(on));
      });
      studentViewMobile = b.dataset.v;
      dayIndexMobile = TODAY_WD;
      if (ttHandleMobile) ttHandleMobile.setMode(studentViewMobile, dayIndexMobile);
      syncDayNav();
    }));
    view.querySelector('#mDayPrev')?.addEventListener('click', () => {
      dayIndexMobile = dayIndexMobile === 1 ? 7 : dayIndexMobile - 1;
      if (ttHandleMobile) ttHandleMobile.setMode('day', dayIndexMobile);
      syncDayNav();
    });
    view.querySelector('#mDayNext')?.addEventListener('click', () => {
      dayIndexMobile = dayIndexMobile === 7 ? 1 : dayIndexMobile + 1;
      if (ttHandleMobile) ttHandleMobile.setMode('day', dayIndexMobile);
      syncDayNav();
    });
    view.querySelectorAll('.m-tt-switch:not(.m-tt-day) button').forEach((b) => b.addEventListener('click', () => {
      view.querySelectorAll('.m-tt-switch:not(.m-tt-day) button').forEach((x) => {
        const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', String(on));
      });
      scope = b.dataset.s; drawTT();
    }));
    drawTT();

    /* 学生：签到卡（SSE + 补拉；请假学生显"请假中"） */
    if (isStudent) {
      const renderSign = async (session) => {
        const card = view.querySelector('#mSignCard');
        let detail = null;
        try { detail = await fetchSession(session.sessionId || session.id); } catch { /* ignore */ }
        const my = detail?.mySign;
        const isLeave = my?.status === 'leave';
        const isSigned = my?.status === 'signed' || my?.status === 'signed_by_teacher';
        const mode = session.signMode || detail?.signMode || 'code';
        card.innerHTML = `
        <section class="m-sign-card">
          <div class="m-sign-head"><strong>课堂签到 · ${esc(session.courseName || detail?.courseName || '')}</strong>${isLeave ? '<em class="leave-pill mut">请假中</em>' : isSigned ? '<em class="leave-pill ok">已签到</em>' : '<em class="leave-pill info">进行中</em>'}</div>
          <div class="m-sign-meta">${esc(session.teacherName || '')} · ${esc(session.date || '')} ${esc(session.start || '')}-${esc(session.end || '')}</div>
          ${isLeave ? '<p class="aca-empty-hint">该时段您已请假，无需签到。</p>' : isSigned ? '<p class="aca-empty-hint">已完成签到。</p>' : `
            ${mode === 'code' ? '<input class="aca-input cs-code-input" id="mSignCode" maxlength="4" inputmode="numeric" placeholder="输入 4 位签到口令" autocomplete="off" />' : ''}
            <button type="button" class="btn primary" id="mSignBtn">${icon('check')}${mode === 'code' ? '签到' : '点击签到'}</button>`}
        </section>`;
        card.querySelector('#mSignBtn')?.addEventListener('click', async () => {
          const codeInput = card.querySelector('#mSignCode');
          try {
            const { signSession } = await import('../../shared/api-classroom.js');
            await signSession(session.sessionId || session.id, codeInput ? codeInput.value.trim() : '');
            toast('签到成功'); renderSign(session);
          } catch (ex) { toast(ex.message); }
        });
      };
      if (!sseSignOff) sseSignOff = context.eventBus.on('sse:classroomSessionOpened', (s) => { if (currentView === 'courses') renderSign(s); });
      /* 离线兜底补拉 */
      (async () => {
        try {
          if (myClassIdMobile == null) { const mine = await fetchMyTimetableEx(); myClassIdMobile = mine.classId; }
          if (myClassIdMobile != null) {
            const { fetchOpenSessions } = await import('../../shared/api-classroom.js');
            const opens = await fetchOpenSessions(myClassIdMobile);
            if (opens.length) renderSign(opens[0]);
          }
        } catch { /* 静默 */ }
      })();
    }
  }

  /* 教师移动端：加课申请（in-host 弹窗） */
  async function mOpenAddLesson(weekday, minute) {
    if (container.querySelector('.leave-wizard')) return;
    let classes = [];
    try { classes = await fetchMyClasses(); } catch { /* ignore */ }
    if (!classes.length) return toast('尚未分配授课班级');
    const tomorrow = new Date(Date.now() + 86400000);
    const ds = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    const hh = String(Math.floor(minute / 60)).padStart(2, '0'); const mm = String(minute % 60).padStart(2, '0');
    openMiniDialog({
      host: phoneScreen(), inHost: true,
      title: '申请加课（单次课）',
      textHTML: '提交后由教务处审批；通过后本班学生实时收到通知。',
      rawBody: `
        <div class="chip-row">${classes.map((c) => `<button type="button" class="pick-chip${c.classId === classes[0].classId ? ' on' : ''}" data-al="${c.classId}">${esc(c.className)}</button>`).join('')}</div>
        <input class="aca-input" id="mAlCourse" maxlength="40" placeholder="课程名称（如：习题课）" style="margin-top:8px" autocomplete="off" />
        <input class="aca-input" id="mAlDate" type="date" value="${ds}" style="margin-top:8px" />
        <div class="cs-time-row" style="margin-top:8px">
          <input class="aca-input" id="mAlStart" type="time" value="${hh}:${mm}" />
          <span>至</span>
          <input class="aca-input" id="mAlEnd" type="time" value="${String(Math.floor(Math.min(minute + 100, 1320) / 60)).padStart(2, '0')}:${String(Math.min(minute + 100, 1320) % 60).padStart(2, '0')}" />
        </div>`,
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '提交申请', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const classId = +d.querySelector('.pick-chip.on')?.dataset.al;
        const courseName = d.querySelector('#mAlCourse').value.trim();
        const singleDate = d.querySelector('#mAlDate').value;
        const start = d.querySelector('#mAlStart').value; const end = d.querySelector('#mAlEnd').value;
        if (!courseName || !singleDate || !start || !end) return toast('请填写完整');
        const wd = new Date(`${singleDate}T00:00:00`).getDay() || 7;
        try {
          await submitRequest('add-lesson', { classId, courseName, weekday: wd, start, end, singleDate });
          d.remove(); toast('加课申请已提交，等待教务处审批');
        } catch (ex) { toast(ex.message); }
      },
    });
    phoneScreen().querySelectorAll('.pick-chip[data-al]').forEach((c) => c.addEventListener('click', () => {
      phoneScreen().querySelectorAll('.pick-chip[data-al]').forEach((x) => x.classList.toggle('on', x === c));
    }));
  }

  /* 教师移动端：停课申请（in-host 签名板） */
  function mOpenTeacherLeave(lesson) {
    if (container.querySelector('.leave-wizard')) return;
    const dlg = openMiniDialog({
      host: phoneScreen(), inHost: true,
      title: `申请停课 · ${esc(lesson.courseName)}`,
      textHTML: `${esc(lesson.className || '')} · ${lesson.source === 'base' ? '每周' + '日一二三四五六'[lesson.weekday % 7] : lesson.singleDate} ${lesson.start}-${lesson.end}<br/><b>停课不补</b>；教务处审批后学生实时收到通知。`,
      rawBody: `
        <textarea class="reason-input" id="mTlNote" maxlength="300" placeholder="停课原因（必填）"></textarea>
        <div class="wizard-label" style="margin-top:10px">手写签名（必填）：</div>
        <canvas class="tl-sign-canvas" id="mTlSign"></canvas>`,
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '提交申请', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const note = d.querySelector('#mTlNote').value.trim();
        if (!note) { d.querySelector('#mTlNote').style.borderColor = 'var(--danger)'; return; }
        if (!mPad.hasInk()) return toast('请手写签名');
        try {
          await submitRequest('teacher-leave', { lessonId: lesson.id, note, signature: mPad.toDataURL(), images: [] });
          d.remove(); toast('停课申请已提交，等待教务处审批');
        } catch (ex) { toast(ex.message); }
      },
    });
    const mPad = createSignaturePad(dlg.querySelector('#mTlSign'));
  }

  /* ---------------- 课堂管理视图（P11 创建；B2 2026-10-29 增强：随人/行内加减分记旷课代签/历史详情） ---------------- */
  const STATUS_PILL = { signed: { label: '已签到', cls: 'ok' }, unsigned: { label: '待签到', cls: 'warn' }, leave: { label: '请假', cls: 'info' }, absent: { label: '旷课', cls: 'bad' } };

  function mPickResult(session, stu) {
    const dlg = openMiniDialog({
      host: phoneScreen(), inHost: true,
      title: `随人 · ${esc(stu.name || stu.id)}`,
      textHTML: '请选择本次表现记分：',
      rawBody: `<div class="chip-row" id="mPickScore">
        <button type="button" class="pick-chip" data-d="1">+1</button>
        <button type="button" class="pick-chip" data-d="2">+2</button>
        <button type="button" class="pick-chip" data-d="-1">-1</button>
        <button type="button" class="pick-chip" data-d="-2">-2</button>
        <button type="button" class="pick-chip" data-d="0">仅记录</button>
      </div>`,
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '提交', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const picked = d.querySelector('#mPickScore .pick-chip.on');
        if (!picked) return toast('请选择记分');
        const delta = Number(picked.dataset.d);
        try {
          await pickStudents(session.id, [stu.id]);
          if (delta) await scoreStudent(session.id, stu.id, delta);
          d.remove();
          toast(`已记录：${stu.name || stu.id}${delta ? `（${delta > 0 ? '+' : ''}${delta} 分）` : '（仅记录）'}`);
          renderClassroomView();
        } catch (ex) { toast(ex.message); }
      },
    });
    dlg.querySelectorAll('#mPickScore .pick-chip').forEach((c) => c.addEventListener('click', () => {
      dlg.querySelectorAll('#mPickScore .pick-chip').forEach((x) => x.classList.toggle('on', x === c));
    }));
  }

  /* 随人提问（B2：80ms 轮换高亮 3 秒定格 → 结果浮层 ±1/±2/仅记录；动画 interval 带结束条件，同 PC 模式） */
  function mOpenPick(session, students) {
    if (container.querySelector('.leave-wizard')) return;
    if (!students.length) return toast('该班暂无学生');
    let pickTimer = null;
    const dlg = openMiniDialog({
      host: phoneScreen(), inHost: true,
      title: '随人提问',
      textHTML: '点击「开始随机」，3 秒后随机定格一名学生。',
      rawBody: `<div class="m-pick-grid" id="mPickGrid">${students.map((s) => `<span class="m-pick-chip" data-sid="${esc(String(s.id))}">${esc(s.name || s.id)}</span>`).join('')}</div>`,
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'go', label: '开始随机', cls: 'primary' }],
      onAction: (act, d) => {
        if (act === 'cancel') { if (pickTimer) clearInterval(pickTimer); return d.remove(); }
        const goBtn = d.querySelector('[data-act="go"]');
        if (goBtn.disabled) return;
        goBtn.disabled = true;
        const chips = Array.from(d.querySelectorAll('.m-pick-chip'));
        const start = Date.now();
        pickTimer = setInterval(() => {
          if (Date.now() - start > 3000) {
            clearInterval(pickTimer);
            const picked = chips[Math.floor(Math.random() * chips.length)];
            chips.forEach((x) => x.classList.remove('pulse'));
            picked.classList.add('picked');
            const sid = picked.dataset.sid;
            const stu = students.find((s) => String(s.id) === String(sid));
            window.setTimeout(() => { d.remove(); mPickResult(session, stu); }, 400);
            return;
          }
          const el = chips[Math.floor(Math.random() * chips.length)];
          chips.forEach((x) => x.classList.toggle('pulse', x === el));
        }, 80);
      },
    });
    void dlg;
  }

  async function renderClassroomView() {
    const view = container.querySelector('#mobileClassroomView');
    if (!view) return;
    let myClasses = [];
    try { myClasses = await fetchMyClasses(); } catch { /* ignore */ }
    let openSession = null;
    let ended = [];
    try {
      const mine = await fetchClassroomSessions({});
      const open = mine.find((s) => s.status === 'open');
      if (open) openSession = await fetchSession(open.id);
      ended = mine.filter((s) => s.status !== 'open').slice(0, 20);
    } catch { /* ignore */ }
    const c = openSession?.counts || null;

    /* 学生行内操作数据组装（B2：全名单=名册减去三类名单；行内按状态出按钮） */
    const roster = openSession ? (myClasses.find((cl) => cl.classId === openSession.classId)?.students || []) : [];
    const stuRows = [];
    if (openSession) {
      const inList = (sid) => ['signed', 'absent', 'leave'].some((k) => (openSession.lists[k] || []).some((x) => String(x.studentId) === String(sid)));
      for (const s of roster) {
        if (inList(s.id)) continue;
        stuRows.push({ id: s.id, name: s.name, status: 'unsigned' });
      }
      for (const x of (openSession.lists.signed || [])) stuRows.push({ id: x.studentId, name: x.studentName, status: 'signed' });
      for (const x of (openSession.lists.leave || [])) stuRows.push({ id: x.studentId, name: x.studentName, status: 'leave' });
      for (const x of (openSession.lists.absent || [])) stuRows.push({ id: x.studentId, name: x.studentName, status: 'absent' });
      stuRows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    }
    const rowOps = (r) => {
      if (r.status === 'unsigned') return `<button type="button" class="btn danger compact" data-abs="${esc(String(r.id))}">记旷课</button><button type="button" class="btn ghost compact" data-proxy="${esc(String(r.id))}">代签</button>`;
      if (r.status === 'signed') return `<button type="button" class="btn compact" data-score="1|${esc(String(r.id))}">+1</button><button type="button" class="btn ghost compact" data-score="-1|${esc(String(r.id))}">-1</button>`;
      if (r.status === 'absent') return `<button type="button" class="btn ghost compact" data-cancel="${esc(String(r.id))}">撤销旷课</button>`;
      return '';
    };

    view.innerHTML = `
      <div class="m-view-head"><span>课堂管理</span></div>
      ${openSession ? `
      <section class="m-cr-live">
        <div class="m-sign-head"><strong>${esc(openSession.courseName)}</strong><em class="leave-pill info">进行中</em></div>
        <div class="m-sign-meta">${esc(openSession.className)} · ${openSession.date} ${openSession.start}-${openSession.end}${openSession.signMode === 'code' ? ` · 口令 <b>${esc(openSession.signCode)}</b>` : ''}</div>
        <div class="cr-sign-counts"><span>已签 <b>${c.signed}</b></span><span>请假 <b>${c.leave}</b></span><span>旷课 <b>${c.absent}</b></span><span>应到 <b>${c.total}</b></span></div>
        <div class="chip-row" style="margin-top:10px">
          <button type="button" class="btn primary compact" id="mPickBtn">${icon('sparkles')}随人提问</button>
          <button type="button" class="btn danger compact" id="mEndBtn">${icon('x')}结束课堂</button>
        </div>
        ${stuRows.length ? `<div class="m-view-foot" style="margin-top:12px">学生名单（行内操作）：</div>
        <div class="m-cr-list">${stuRows.map((r) => `
          <div class="m-cr-row">
            <strong>${esc(r.name || r.id)}</strong>
            <em class="leave-pill ${STATUS_PILL[r.status].cls}">${STATUS_PILL[r.status].label}</em>
            <div class="m-cr-ops">${rowOps(r)}</div>
          </div>`).join('')}</div>` : '<p class="aca-empty-hint" style="padding:4px">（未分配授课班级，无法显示名册；可用下方按班级发起）</p>'}
      </section>` : ''}
      <div class="m-view-foot">${openSession ? '发起新课堂（进行中课堂结束后可用）' : '按班级发起课堂（口令自动生成）'}</div>
      <div class="chip-row" style="padding:0 4px">${myClasses.length ? myClasses.map((cl) => `<button type="button" class="pick-chip" ${openSession ? 'disabled' : ''} data-start="${cl.classId}">${esc(cl.className)}</button>`).join('') : '<span class="aca-empty-hint">尚未分配授课班级</span>'}</div>
      <div class="m-view-foot">历史课堂（最新 ${ended.length} 条）：</div>
      ${ended.length ? ended.map((s) => `
        <div class="aca-req-row"><div class="aca-req-main">
          <div class="aca-req-title"><strong>${esc(s.courseName || '课堂')}</strong><span>${esc(s.className)} · ${s.date}</span><em class="leave-pill mut">已结束</em></div>
          <div class="aca-req-meta">${esc(s.teacherName)} · ${s.start}-${s.end}</div>
        </div><button type="button" class="btn ghost compact" data-hv="${s.id}">详情</button></div>`).join('')
      : '<p class="aca-empty-hint" style="padding:4px 4px 12px">暂无历史课堂</p>'}`;
    view.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', async () => {
      if (openSession) return toast('已有进行中课堂，请先结束');
      try {
        const r = await startSession({ classId: +b.dataset.start, signMode: 'code' });
        toast(`课堂已发起（口令 ${r.session.signCode}）`);
        renderClassroomView();
      } catch (ex) { toast(ex.message); }
    }));
    view.querySelector('#mEndBtn')?.addEventListener('click', async () => {
      try { await endSession(openSession.id); toast('课堂已结束'); renderClassroomView(); } catch (ex) { toast(ex.message); }
    });
    view.querySelector('#mPickBtn')?.addEventListener('click', () => mOpenPick(openSession, stuRows.map((r) => ({ id: r.id, name: r.name }))));
    view.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
      try { await cancelAbsence(openSession.id, b.dataset.cancel); toast('已撤销旷课（归还 5 分）'); renderClassroomView(); } catch (ex) { toast(ex.message); }
    }));
    view.querySelectorAll('[data-abs]').forEach((b) => b.addEventListener('click', async () => {
      try { await markAbsence(openSession.id, b.dataset.abs); toast('已记旷课（-5 分）'); renderClassroomView(); } catch (ex) { toast(ex.message); }
    }));
    view.querySelectorAll('[data-proxy]').forEach((b) => b.addEventListener('click', async () => {
      try { await proxySign(openSession.id, b.dataset.proxy); toast('已代签'); renderClassroomView(); } catch (ex) { toast(ex.message); }
    }));
    view.querySelectorAll('[data-score]').forEach((b) => b.addEventListener('click', async () => {
      const [delta, sid] = String(b.dataset.score).split('|');
      try { await scoreStudent(openSession.id, sid, Number(delta)); toast(`已${Number(delta) > 0 ? '加' : '减'} ${Math.abs(Number(delta))} 分`); renderClassroomView(); } catch (ex) { toast(ex.message); }
    }));
    view.querySelectorAll('[data-hv]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const d = await fetchSession(+b.dataset.hv);
        if (!d) return;
        const nameOf = {}; 
        ['signed', 'absent', 'leave'].forEach((k) => (d.lists[k] || []).forEach((x) => { nameOf[x.studentId] = x.studentName; }));
        openMiniDialog({
          host: phoneScreen(), inHost: true, title: `课堂 · ${esc(d.courseName || d.className)}`,
          textHTML: `${esc(d.className)} · ${d.date}（${esc(d.teacherName)}）<br/>已签到 <b>${d.counts.signed}</b> / 请假 <b>${d.counts.leave}</b> / 旷课 <b>${d.counts.absent}</b> / 应到 <b>${d.counts.total}</b>`,
          rawBody: `<div class="aca-review-detail">${d.events.slice(0, 12).map((e) => `<div class="aca-review-row"><span>${esc(nameOf[e.studentId] || e.studentId)}</span><strong>${esc(e.kind)}${e.delta ? `（${e.delta > 0 ? '+' : ''}${e.delta}）` : ''}</strong></div>`).join('') || '<p class="aca-empty-hint">无事件</p>'}</div>`,
          buttons: [{ act: 'ok', label: '关闭', cls: 'primary' }],
          onAction: (act, dl) => dl.remove(),
        });
      } catch (ex) { toast(ex.message); }
    }));
  }

  /* ---------------- 学生处视图（P11：学生管理/待审批/违规与积分 三 Tab；C1 增班级重命名） ----------------
   * ⚠ 2026-10-29 重建记录：本块（renderSAView/mSaEdit/mSaDissolve/mSaNewClass/mSaAddViolation 约 160 行）
   * 曾在 B 批次课堂视图批量编辑中被静默吞掉（node --check 语法合法故未拦截；showView('sa') 将 ReferenceError）——
   * 依据编辑前读取的原文 + PC 同构交互重建，并并入 C1 重命名；后续对本文件长段替换必须读回复查全函数清单。 */
  let saTab = 'students';
  let saFolder = 'un';
  let mViType = 'all';    // C2 双端同步：违规流水类型筛选
  let mViStatus = 'all';  // C2 双端同步：违规流水状态筛选
  async function renderSAView() {
    const view = container.querySelector('#mobileSAView');
    if (!view) return;
    view.innerHTML = `
      <div class="m-view-head"><span>学生处</span></div>
      <div class="segmented m-sa-tabs" role="tablist" aria-label="学生处切换">
        <button type="button" class="${saTab === 'students' ? 'active' : ''}" role="tab" aria-selected="${saTab === 'students'}" data-t="students">学生管理</button>
        <button type="button" class="${saTab === 'pending' ? 'active' : ''}" role="tab" aria-selected="${saTab === 'pending'}" data-t="pending">待审批</button>
        <button type="button" class="${saTab === 'violations' ? 'active' : ''}" role="tab" aria-selected="${saTab === 'violations'}" data-t="violations">违规积分</button>
      </div>
      <div id="mSaBody"></div>`;
    view.querySelectorAll('.m-sa-tabs button').forEach((b) => b.addEventListener('click', () => { saTab = b.dataset.t; renderSAView(); }));
    const body = view.querySelector('#mSaBody');
    if (saTab === 'students') {
      /* 学生管理：班级夹 + 新建班级 + 重命名 + 学生列表（直改；编辑/解散/重命名弹窗 in-host） */
      let classes = []; let students = []; let unassigned = 0;
      try { [students, { classes, unassigned }] = await Promise.all([fetchStudents(), fetchClasses()]); } catch (ex) { return toast(ex.message); }
      const isUn = saFolder === 'un';
      const cls = classes.find((c) => c.id === saFolder);
      const list = isUn ? students.filter((s) => !s.classId) : students.filter((s) => s.classId === saFolder);
      body.innerHTML = `
        <div class="m-aca-folders">
          ${classes.map((c) => `<button type="button" class="m-aca-folder${saFolder === c.id ? ' on' : ''}" data-f="${c.id}">${icon('book')}${esc(c.name)}<em>${c.count}</em></button>`).join('')}
          <button type="button" class="aca-folder-add" id="mSaNewClass">${icon('plus')}新建班级</button>
        </div>
        <button type="button" class="m-aca-folder m-un-row${isUn ? ' on' : ''}" data-f="un">${icon('users')}未分配<em>${unassigned}</em></button>
        ${!isUn ? `<div class="m-aca-tools">
          <button type="button" class="btn ghost compact" id="mSaRename">${icon('edit')}重命名</button>
          <button type="button" class="btn ghost compact" id="mSaEdit">${icon('edit')}编辑</button>
          <button type="button" class="btn danger compact" id="mSaDissolve">${icon('x')}解散</button>
        </div>` : ''}
        <div class="m-aca-stu-list">${list.length ? list.slice(0, 60).map((s) => `
          <div class="m-aca-stu"><strong>${esc(s.name)}</strong><code>${s.id}</code></div>`).join('') + (list.length > 60 ? `<span class="m-tc-more">仅显示前 60 名，共 ${list.length} 名</span>` : '')
          : `<div class="m-tc-empty">${icon('users', 'icon large')}<strong>${isUn ? '全部学生已分配班级' : '班级暂无学生'}</strong></div>`}</div>`;
      body.querySelectorAll('.m-aca-folder').forEach((b) => b.addEventListener('click', () => { saFolder = isNaN(+b.dataset.f) ? 'un' : +b.dataset.f; renderSAView(); }));
      body.querySelector('#mSaNewClass')?.addEventListener('click', () => mSaNewClass());
      body.querySelector('#mSaEdit')?.addEventListener('click', () => mSaEdit(cls, students));
      body.querySelector('#mSaDissolve')?.addEventListener('click', () => mSaDissolve(cls));
      body.querySelector('#mSaRename')?.addEventListener('click', () => mSaRename(cls));
    } else if (saTab === 'pending') {
      let list = [];
      try { list = (await fetchRequests({ status: 'pending' })).filter((r) => ['class-create', 'class-edit', 'class-dissolve', 'class-rename'].includes(r.type)); } catch (ex) { return toast(ex.message); }
      body.innerHTML = list.length ? list.map((r) => `
        <div class="aca-req-row"><div class="aca-req-main">
          <div class="aca-req-title"><strong>${esc(r.title)}</strong><em class="leave-pill warn">待审批</em></div>
          <div class="aca-req-meta">${esc(r.requestedBy)} 提交 · ${(r.createdAt || '').slice(0, 16).replace('T', ' ')}</div>
        </div><button type="button" class="btn primary compact" data-rv="${r.id}">审批</button></div>`).join('')
        : '<div class="aca-stu-empty">暂无待审批申请</div>';
      body.querySelectorAll('[data-rv]').forEach((b) => b.addEventListener('click', async () => {
        const req = list.find((x) => x.id === +b.dataset.rv);
        const detailRows = (req.detail || []).map((d) => `<div class="aca-review-row"><span>${esc(d.label)}</span><strong>${esc(String(d.value))}</strong></div>`).join('');
        openMiniDialog({
          host: phoneScreen(), inHost: true, title: `审批 · ${esc(req.title)}`,
          textHTML: `${esc(req.requestedBy)} 提交于 ${(req.createdAt || '').slice(0, 16).replace('T', ' ')}`,
          rawBody: `<div class="aca-review-detail">${detailRows}</div><textarea class="reason-input" id="mSaReason" maxlength="300" placeholder="驳回原因（驳回时必填）"></textarea>`,
          buttons: [{ act: 'cancel', label: '取消' }, { act: 'reject', label: '驳回', cls: 'danger' }, { act: 'approve', label: '同意', cls: 'primary' }],
          onAction: async (act, d) => {
            if (act === 'cancel') return d.remove();
            const reason = d.querySelector('#mSaReason').value.trim();
            if (act === 'reject' && !reason) return toast('驳回必须填写原因');
            try { await reviewRequest(req.id, act, reason); d.remove(); toast(act === 'approve' ? '已同意，变更已生效' : '已驳回'); renderSAView(); } catch (ex) { toast(ex.message); }
          },
        });
      }));
    } else {
      let violations = []; let lowStudents = []; let warnBelow = 60;
      try {
        const res = await fetchViolations({});
        violations = res.violations;
        warnBelow = res.warnBelow;
        ({ students: lowStudents } = await fetchViolations({ low: 1 }));
      } catch (ex) { return toast(ex.message); }
      const shownVios = violations.filter((v) =>
        (mViType === 'all' || v.type === mViType)
        && (mViStatus === 'all' || (mViStatus === 'cancelled') === !!v.cancelled));
      const viChip = (group, val, label) => `<button type="button" class="pick-chip${(group === 'type' ? mViType : mViStatus) === val ? ' on' : ''}" data-vfg="${group}" data-vfv="${val}">${label}</button>`;
      body.innerHTML = `
        ${lowStudents.length ? `<div class="vi-warn-bar">${icon('alert')}<b>${lowStudents.length}</b> 名学生低于 ${warnBelow} 分</div>` : ''}
        <div class="m-view-foot">违规流水（${shownVios.length ? `命中 ${shownVios.length} / ${violations.length} 条` : '暂无记录'}）：</div>
        <div class="chip-row" style="padding:0 2px 8px">
          ${viChip('type', 'all', '全部类型')}${viChip('type', '旷课', '旷课')}${viChip('type', '旷寝', '旷寝')}
          ${viChip('status', 'all', '全部状态')}${viChip('status', 'active', '生效')}${viChip('status', 'cancelled', '已撤销')}
        </div>
        ${shownVios.length ? shownVios.slice(0, 20).map((v) => `
          <div class="aca-req-row${v.cancelled ? ' vi-row-cancelled' : ''}"><div class="aca-req-main">
            <div class="aca-req-title"><strong>${esc(v.studentName || v.studentId)}</strong><span>${esc(v.type)} ${v.points} 分</span>${v.cancelled ? '<em class="leave-pill mut">已撤销</em>' : ''}</div>
            <div class="aca-req-meta">${v.operator ? esc(v.operator) : ''} · ${(v.createdAt || '').slice(0, 16).replace('T', ' ')}</div>
          </div></div>`).join('') : `<div class="aca-stu-empty">${violations.length ? '无匹配记录（调整筛选）' : '暂无违规记录'}</div>`}
        <button type="button" class="btn primary compact" id="mSaAddV" style="margin:10px 0">${icon('plus')}登记违规</button>`;
      body.querySelectorAll('.chip-row .pick-chip[data-vfg]').forEach((c) => c.addEventListener('click', () => {
        if (c.dataset.vfg === 'type') mViType = c.dataset.vfv;
        else mViStatus = c.dataset.vfv;
        renderSAView();
      }));
      body.querySelector('#mSaAddV')?.addEventListener('click', () => mSaAddViolation());
    }
  }

  function mSaNewClass() {
    openMiniDialog({
      host: phoneScreen(), inHost: true, title: '新建班级',
      textHTML: '输入班级名称（分类夹），创建后可通过「编辑」勾选学生划入。',
      rawBody: '<input class="aca-input" id="mSaNewName" maxlength="30" placeholder="班级名称（如：计算机2302）" autocomplete="off" />',
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '创建', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const name = d.querySelector('#mSaNewName').value.trim();
        if (!name) { d.querySelector('#mSaNewName').style.borderColor = 'var(--danger)'; return; }
        try {
          const r = await createClass(name);
          d.remove();
          saFolder = r.id;
          toast(`已创建班级「${name}」（教务处已收到通知）`);
          renderSAView();
        } catch (ex) { toast(ex.message); }
      },
    });
  }

  /* 班级重命名（学生处直改；2026-10-29 C1） */
  function mSaRename(cls) {
    openMiniDialog({
      host: phoneScreen(), inHost: true, title: `重命名 · ${esc(cls?.name || '')}`,
      textHTML: '输入新班级名称（唯一；保存后立即生效，教务处将收到通知）。',
      rawBody: `<input class="aca-input" id="mSaRenameName" maxlength="30" placeholder="新班级名称" value="${esc(cls?.name || '')}" autocomplete="off" />`,
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '保存', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const name = d.querySelector('#mSaRenameName').value.trim();
        if (!name || name === cls?.name) { d.querySelector('#mSaRenameName').style.borderColor = 'var(--danger)'; return; }
        try {
          await renameClass(saFolder, name);
          d.remove();
          toast(`已重命名：「${cls?.name}」→「${name}」（教务处已收到通知）`);
          renderSAView();
        } catch (ex) { toast(ex.message); }
      },
    });
  }

  function mSaEdit(cls, students) {
    const members = students.filter((s) => s.classId === saFolder);
    const unList = students.filter((s) => !s.classId);
    const dlg = openMiniDialog({
      host: phoneScreen(), inHost: true, title: `编辑 · ${esc(cls?.name || '')}`,
      textHTML: '勾选变更，保存统一生效（教务处将收到通知）。',
      rawBody: `
        <div class="wizard-label">未分配（勾选加入）：</div>
        <div class="aca-pick-list">${unList.slice(0, 30).map((s) => `<label class="aca-pick-row"><input type="checkbox" data-add="${s.id}" /><strong>${esc(s.name)}</strong><code>${s.id}</code></label>`).join('') || '<p class="aca-empty-hint">无</p>'}</div>
        <div class="wizard-label" style="margin-top:10px">班内（勾选移出）：</div>
        <div class="aca-pick-list">${members.slice(0, 30).map((s) => `<label class="aca-pick-row out"><input type="checkbox" data-rm="${s.id}" /><strong>${esc(s.name)}</strong><code>${s.id}</code></label>`).join('') || '<p class="aca-empty-hint">无</p>'}</div>`,
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '保存', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const removeIds = Array.from(d.querySelectorAll('input[data-rm]:checked')).map((i) => i.dataset.rm);
        const addIds = Array.from(d.querySelectorAll('input[data-add]:checked')).map((i) => i.dataset.add);
        if (!removeIds.length && !addIds.length) return toast('未勾选任何更改');
        try { const r = await updateClassMembers(saFolder, removeIds, addIds); d.remove(); toast(`已保存：移出 ${r.removed}、加入 ${r.added}`); renderSAView(); } catch (ex) { toast(ex.message); }
      },
    });
    void dlg;
  }

  function mSaDissolve(cls) {
    openMiniDialog({
      host: phoneScreen(), inHost: true, title: `解散 · ${esc(cls?.name || '')}`,
      textHTML: '学生还原未分配、教师关联清除，不可恢复。',
      rawBody: '<textarea class="reason-input" id="mSaDissolveR" maxlength="200" placeholder="解散原因（必填）"></textarea>',
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '确认解散', cls: 'danger' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const reason = d.querySelector('#mSaDissolveR').value.trim();
        if (!reason) { d.querySelector('#mSaDissolveR').style.borderColor = 'var(--danger)'; return; }
        try {
          const r = await dissolveClass(saFolder, reason);
          d.remove();
          saFolder = 'un';
          toast(`已解散班级「${cls?.name}」，${r.released} 名学生还原未分配`);
          renderSAView();
        } catch (ex) { toast(ex.message); }
      },
    });
  }

  async function mSaAddViolation() {
    let all = [];
    let points = { '旷课': -5, '旷寝': -10 }; // 兑底默认；实际分值随考勤规则动态拉取
    try { all = await fetchStudents(); ({ points } = await fetchViolationRules()); } catch (ex) { return toast(ex.message); }
    openMiniDialog({
      host: phoneScreen(), inHost: true, title: '登记违规',
      textHTML: `选择学生与类型（旷课 ${points['旷课']} / 旷寝 ${points['旷寝']}）。`,
      rawBody: `
        <div class="aca-pick-list" id="mViPad">${all.slice(0, 12).map((s) => `<label class="aca-pick-row"><input type="radio" name="mViStu" data-sid="${s.id}" /><strong>${esc(s.name)}</strong><code>${s.id}</code></label>`).join('')}</div>
        <div class="chip-row" style="margin-top:10px">
          <button type="button" class="pick-chip" data-vt="旷课">旷课（${points['旷课']}）</button>
          <button type="button" class="pick-chip" data-vt="旷寝">旷寝（${points['旷寝']}）</button>
        </div>`,
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '登记', cls: 'danger' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const sid = d.querySelector('input[name="mViStu"]:checked')?.dataset.sid;
        const type = d.querySelector('.pick-chip[data-vt].on')?.dataset.vt;
        if (!sid || !type) return toast('请选择学生与类型');
        try { await registerViolation({ studentId: sid, type }); d.remove(); toast('已登记'); renderSAView(); } catch (ex) { toast(ex.message); }
      },
    });
    phoneScreen().querySelectorAll('.pick-chip[data-vt]').forEach((c) => c.addEventListener('click', () => {
      phoneScreen().querySelectorAll('.pick-chip[data-vt]').forEach((x) => x.classList.toggle('on', x === c));
    }));
  }

  /* ---------------- 调课审批视图（P11 创建；B2 2026-10-29 增强：待审批+审批历史） ---------------- */
  async function renderLessonReviewView() {
    const view = container.querySelector('#mobileLessonReviewView');
    if (!view) return;
    const REVIEW_TYPES = ['add-lesson', 'teacher-leave', 'absence-cancel'];
    let list = [];
    let history = [];
    try {
      const all = (await fetchRequests({})).filter((r) => REVIEW_TYPES.includes(r.type));
      list = all.filter((r) => r.status === 'pending');
      history = all.filter((r) => r.status !== 'pending').slice(0, 20);
    } catch (ex) { return toast(ex.message); }
    const stPill = (s) => `<em class="leave-pill ${s === 'approved' ? 'ok' : s === 'rejected' ? 'bad' : 'mut'}">${REQ_STATUS[s] || s}</em>`;
    view.innerHTML = `
      <div class="m-view-head"><span>调课审批${list.length ? `（待审批 ${list.length}）` : ''}</span></div>
      ${list.length ? list.map((r) => `
        <div class="aca-req-row"><div class="aca-req-main">
          <div class="aca-req-title"><strong>${esc(r.title)}</strong><em class="leave-pill warn">待审批</em></div>
          <div class="aca-req-meta">${esc(r.requestedBy)} · ${(r.createdAt || '').slice(0, 16).replace('T', ' ')}</div>
        </div><button type="button" class="btn primary compact" data-rv="${r.id}">审批</button></div>`).join('')
      : '<div class="aca-stu-empty">暂无待审批调课申请</div>'}
      ${history.length ? `<div class="m-view-foot">审批历史（最新 ${history.length} 条）：</div>
      ${history.map((r) => `
        <div class="aca-req-row"><div class="aca-req-main">
          <div class="aca-req-title"><strong>${esc(r.title)}</strong>${stPill(r.status)}</div>
          <div class="aca-req-meta">${esc(r.requestedBy)} · ${r.reviewedBy ? `审批人 ${esc(r.reviewedBy)}` : ''}${r.rejectReason ? ` · 驳回：${esc(r.rejectReason)}` : ''}</div>
        </div></div>`).join('')}` : ''}`;
    view.querySelectorAll('[data-rv]').forEach((b) => b.addEventListener('click', () => {
      const req = list.find((x) => x.id === +b.dataset.rv);
      const detailRows = (req.detail || []).map((d) => `<div class="aca-review-row"><span>${esc(d.label)}</span><strong>${esc(String(d.value))}</strong></div>`).join('');
      const signImg = req.type === 'teacher-leave' && req.payload?.signature ? `<div class="wizard-label" style="margin-top:8px">签名：</div><img class="lr-sign-img" src="${req.payload.signature}" alt="签名" style="max-width:100%;border:1px solid var(--outline);border-radius:10px" />` : '';
      openMiniDialog({
        host: phoneScreen(), inHost: true, title: `审批 · ${esc(req.title)}`,
        textHTML: `${esc(req.requestedBy)} 提交于 ${(req.createdAt || '').slice(0, 16).replace('T', ' ')}`,
        rawBody: `<div class="aca-review-detail">${detailRows}${signImg}</div><textarea class="reason-input" id="mLrReason" maxlength="300" placeholder="驳回原因（驳回时必填）"></textarea>`,
        buttons: [{ act: 'cancel', label: '取消' }, { act: 'reject', label: '驳回', cls: 'danger' }, { act: 'approve', label: '同意', cls: 'primary' }],
        onAction: async (act, d) => {
          if (act === 'cancel') return d.remove();
          const reason = d.querySelector('#mLrReason').value.trim();
          if (act === 'reject' && !reason) return toast('驳回必须填写原因');
          try { await reviewRequest(req.id, act, reason); d.remove(); toast(act === 'approve' ? '已同意，调课已生效' : '已驳回'); renderLessonReviewView(); } catch (ex) { toast(ex.message); }
        },
      });
    }));
  }

  /* ---------------- 课堂记录视图（P11：教务处列表+详情） ---------------- */
  async function renderClassRecordsView() {
    const view = container.querySelector('#mobileClassRecordsView');
    if (!view) return;
    let list = [];
    try { list = await fetchClassroomSessions({ all: 1 }); } catch (ex) { return toast(ex.message); }
    view.innerHTML = `
      <div class="m-view-head"><span>课堂记录</span></div>
      ${list.length ? list.slice(0, 30).map((s) => `
        <div class="aca-req-row"><div class="aca-req-main">
          <div class="aca-req-title"><strong>${esc(s.courseName || '课堂')}</strong><span>${esc(s.className)} · ${s.date}</span><em class="leave-pill ${s.status === 'open' ? 'info' : 'mut'}">${s.status === 'open' ? '进行中' : '已结束'}</em></div>
          <div class="aca-req-meta">${esc(s.teacherName)} · ${s.start}-${s.end}</div>
        </div><button type="button" class="btn ghost compact" data-hv="${s.id}">详情</button></div>`).join('')
      : '<div class="aca-stu-empty">暂无课堂记录</div>'}
      <p class="aca-empty-hint" style="padding:8px 4px">修改课堂数据请前往 PC 端「课堂记录」模块提交申请（教师确认制）</p>`;
    view.querySelectorAll('[data-hv]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const d = await fetchSession(+b.dataset.hv);
        if (!d) return;
        openMiniDialog({
          host: phoneScreen(), inHost: true, title: `课堂 · ${esc(d.courseName || d.className)}`,
          textHTML: `${esc(d.className)} · ${d.date}（${esc(d.teacherName)}）<br/>已签到 <b>${d.counts.signed}</b> / 请假 <b>${d.counts.leave}</b> / 旷课 <b>${d.counts.absent}</b> / 应到 <b>${d.counts.total}</b>`,
          rawBody: `<div class="aca-review-detail">${d.events.slice(0, 10).map((e) => `<div class="aca-review-row"><span>${esc(e.studentId)}</span><strong>${esc(e.kind)}${e.delta ? `（${e.delta > 0 ? '+' : ''}${e.delta}）` : ''}</strong></div>`).join('') || '<p class="aca-empty-hint">无事件</p>'}</div>`,
          buttons: [{ act: 'ok', label: '关闭', cls: 'primary' }],
          onAction: (act, dl) => dl.remove(),
        });
      } catch (ex) { toast(ex.message); }
    }));
  }

  /* ---------------- 问卷与投票视图（S11 2026-10-30：与 PC mod-survey 同能力，in-host 弹窗） ---------------- */
  const mSvIsRespondent = role === '学生' || role === '教师';
  const mSvIsCounselor = role === '导员';
  const mSvCanCreate = ['学生处', '教务处', 'IT管理员', '导员'].includes(role);
  let mSvTab = mSvIsRespondent ? 'fill' : mSvIsCounselor ? 'watch' : 'all';
  let mSvSurveys = [];

  const mSvKindPill = (s) => `<em class="sv-kind-pill ${s.kind === 'vote' ? 'vt' : 'qn'}">${s.kind === 'vote' ? '投票' : '问卷'}</em>`;
  const mSvStatusPill = (s) => `<em class="leave-pill ${s.status === 'published' ? (s.deadlinePassed ? 'mut' : 'info') : s.status === 'draft' ? 'warn' : 'mut'}">${s.deadlinePassed && s.status === 'published' ? '已过截止' : SURVEY_STATUS[s.status] || s.status}</em>`;
  const mSvAudText = (s) => `受众：${AUDIENCE_LABEL[s.audience] || s.audience}${s.targetClassNames?.length ? `（${s.targetClassNames.join('、')}）` : ''}${s.targetTeacherNames?.length ? `（${s.targetTeacherNames.join('、')}）` : ''}`;

  async function renderSurveyView() {
    const view = container.querySelector('#mobileSurveyView');
    if (!view) return;
    try { const r = await fetchSurveys(); mSvSurveys = r.surveys; } catch (ex) { return toast(ex.message); }
    let list = mSvSurveys;
    if (mSvTab === 'mine') list = mSvSurveys.filter((s) => s.createdBy === name);
    else if (mSvTab === 'watch') list = mSvSurveys.filter((s) => s.status === 'published' && s.createdBy !== name);
    view.innerHTML = `
      <div class="m-leave-head"><span>问卷与投票</span>${mSvCanCreate ? `<button type="button" class="btn primary compact" id="mSvCreate">${icon('plus')}发起</button>` : ''}</div>
      ${!mSvIsRespondent ? `<div class="segmented m-sa-tabs" role="tablist" aria-label="问卷视图">
        <button type="button" class="${mSvTab === (mSvIsCounselor ? 'watch' : 'all') ? 'active' : ''}" data-t="${mSvIsCounselor ? 'watch' : 'all'}">${mSvIsCounselor ? '填写情况' : '全部'}</button>
        <button type="button" class="${mSvTab === 'mine' ? 'active' : ''}" data-t="mine">我的发布</button>
      </div>` : ''}
      ${list.length ? list.map((s) => {
        const mine = s.createdBy === name;
        const done = s.kind === 'questionnaire' ? s.filled : s.voted;
        let ops = '';
        if (mSvIsRespondent) {
          ops = `<button type="button" class="btn ${done ? 'ghost' : 'primary'} compact" data-fill="${s.id}">${done ? '查看' : s.kind === 'vote' ? '投票' : '填写'}</button>`;
        } else {
          const canStats = mine || role === 'IT管理员' || (s.visibility?.statsViewers || []).includes(role) || (mSvIsCounselor && s.status === 'published');
          if (canStats && s.status !== 'draft') ops += `<button type="button" class="btn compact" data-stats="${s.id}">统计</button>`;
          if (mine || role === 'IT管理员') {
            if (s.status === 'draft') ops += `<button type="button" class="btn primary compact" data-pub="${s.id}">发布</button>`;
            if (s.status === 'published') ops += `<button type="button" class="btn ghost compact" data-close="${s.id}">关闭</button>`;
            ops += `<button type="button" class="btn danger compact" data-del="${s.id}">删除</button>`;
          }
        }
        return `
        <div class="aca-req-row"><div class="aca-req-main">
          <div class="aca-req-title"><strong>${esc(s.title)}</strong>${mSvKindPill(s)}${s.anonymous ? '<em class="leave-pill mut">匿名</em>' : ''}${mSvStatusPill(s)}</div>
          <div class="aca-req-meta">${mSvAudText(s)}${s.deadline ? ` · 截止 ${String(s.deadline).replace('T', ' ')}` : ''}</div>
        </div><div class="aca-req-ops">${ops}</div></div>`;
      }).join('') : `<div class="aca-stu-empty">${icon('vote', 'icon large')}<strong>暂无问卷或投票</strong></div>`}`;
    view.querySelectorAll('.m-sa-tabs button').forEach((b) => b.addEventListener('click', () => { mSvTab = b.dataset.t; renderSurveyView(); }));
    view.querySelector('#mSvCreate')?.addEventListener('click', () => mSvCreate());
    view.querySelectorAll('[data-fill]').forEach((b) => b.addEventListener('click', async () => {
      const s = mSvSurveys.find((x) => x.id === +b.dataset.fill);
      if (s) mSvFill(s);
    }));
    view.querySelectorAll('[data-stats]').forEach((b) => b.addEventListener('click', () => mSvStats(+b.dataset.stats)));
    view.querySelectorAll('[data-pub],[data-close],[data-del]').forEach((b) => b.addEventListener('click', () => {
      const s = mSvSurveys.find((x) => x.id === +b.dataset.pub || x.id === +b.dataset.close || x.id === +b.dataset.del);
      const act = b.dataset.pub ? 'publish' : b.dataset.close ? 'close' : 'delete';
      mSvConfirm(s, act);
    }));
  }

  function mSvConfirm(s, action) {
    if (!s || container.querySelector('.leave-wizard')) return;
    const conf = {
      publish: { t: `发布 · ${esc(s.title)}`, txt: '发布后受众将实时收到通知；发布后题目不可修改。', ok: '确认发布', fn: publishSurvey, msg: () => '已发布' },
      close: { t: `关闭 · ${esc(s.title)}`, txt: '关闭后停止填写，已有数据保留可统计。', ok: '确认关闭', fn: closeSurvey, msg: () => '已关闭' },
      delete: { t: `删除 · ${esc(s.title)}`, txt: '<b style="color:var(--danger)">不可恢复</b>：全部作答/选票连带删除。', ok: '确认删除', fn: deleteSurvey, msg: (r) => `已删除（清理 ${r.cleared} 条）` },
    }[action];
    openMiniDialog({
      host: phoneScreen(), inHost: true, title: conf.t, textHTML: conf.txt,
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: conf.ok, cls: action === 'delete' ? 'danger' : 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        try { const r = await conf.fn(s.id); d.remove(); toast(conf.msg(r)); renderSurveyView(); } catch (ex) { toast(ex.message); }
      },
    });
  }

  async function mSvFill(s) {
    if (container.querySelector('.leave-wizard')) return;
    let d0;
    try { d0 = await fetchSurvey(s.id); } catch (ex) { return toast(ex.message); }
    if (d0.status !== 'published') return toast('当前不可填写');
    if (d0.deadlinePassed) return toast('已过截止时间');
    const done = d0.kind === 'questionnaire' ? d0.filled : d0.voted;
    if (done && d0.kind === 'questionnaire') {
      const valOf = (qid) => (d0.myAnswers || []).find((a) => String(a.questionId) === String(qid))?.value;
      const fmtV = (q, v) => {
        if (v == null) return '（未填）';
        if (q.type === 'matrix' && typeof v === 'object') return (q.rows || []).map((r) => `${r.label}：${v[r.id] ?? '—'}`).join('；');
        if (typeof v === 'object' && !Array.isArray(v)) return `其他：${v.otherText || ''}`;
        if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? `其他：${x.otherText || ''}` : String(x))).join('、');
        return String(v);
      };
      return openMiniDialog({
        host: phoneScreen(), inHost: true, title: `我的填写 · ${esc(d0.title)}`,
        textHTML: '已提交，不可修改。',
        rawBody: d0.questions.map((q) => `<div class="aca-review-row"><span>${esc(q.title)}</span><strong>${esc(fmtV(q, valOf(q.id)))}</strong></div>`).join(''),
        buttons: [{ act: 'ok', label: '关闭', cls: 'primary' }],
        onAction: (act, d) => d.remove(),
      });
    }
    if (d0.kind === 'vote') return mSvVote(d0, done);

    /* 问卷填写（v2：九类渲染+显示逻辑实时显隐+其他补充填空——与 PC openQuestionnaire 同规则） */
    const qBlockHtml = (q, idx) => {
      let control = '';
      if (q.type === 'single' || q.type === 'multi') {
        control = `<div class="chip-row sv-opts">${q.options.map((o) => `<button type="button" class="sv-opt" data-val="${esc(o)}">${esc(o)}</button>`).join('')}${q.otherOption ? `<button type="button" class="sv-opt" data-val="__other__">其他</button>` : ''}</div>
          ${q.type === 'multi' ? `<div class="sv-hint">可多选${q.minSelect || q.maxSelect ? `（${q.minSelect ? `至少 ${q.minSelect} 项` : ''}${q.minSelect && q.maxSelect ? '、' : ''}${q.maxSelect ? `至多 ${q.maxSelect} 项` : ''}）` : ''}</div>` : ''}
          ${q.otherOption ? '<input class="aca-input sv-other-input" placeholder="其他：请说明" maxlength="100" hidden />' : ''}`;
      } else if (q.type === 'dropdown') {
        control = `<select class="aca-input sv-dropdown">${q.options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}${q.otherOption ? '<option value="__other__">其他</option>' : ''}</select>${q.otherOption ? '<input class="aca-input sv-other-input" placeholder="其他：请说明" maxlength="100" hidden />' : ''}`;
      } else if (q.type === 'sort') {
        control = `<div class="sv-sort-list">${q.options.map((o) => `
          <div class="sv-sort-row" data-val="${esc(o)}"><span class="sv-sort-order"></span><strong>${esc(o)}</strong>
            <button type="button" class="btn ghost compact" data-sort="-1" aria-label="上移">↑</button>
            <button type="button" class="btn ghost compact" data-sort="1" aria-label="下移">↓</button>
          </div>`).join('')}</div><div class="sv-hint">↑↑↓ 调整顺序</div>`;
      } else if (q.type === 'text') {
        control = `<input class="aca-input sv-text-input" ${q.format === 'date' ? 'type="date"' : q.format === 'number' ? 'type="number"' : 'type="text"'} placeholder="${q.format === 'phone' ? '手机号' : q.format === 'email' ? '邮箱' : q.format === 'number' ? '数字' : '填写内容'}" maxlength="200" />`;
      } else if (q.type === 'textarea') {
        control = '<textarea class="reason-input sv-textarea" maxlength="500" placeholder="填写内容（≤500 字）"></textarea>';
      } else if (q.type === 'scale') {
        const sc = q.scale || { min: 1, max: 5 };
        const nps = sc.skin === 'nps';
        let opts = '';
        for (let n = sc.min; n <= sc.max; n++) opts += `<button type="button" class="sv-scale-opt${nps ? ' nps' : sc.skin === 'star' ? ' star' : ''}" data-val="${n}">${sc.skin === 'star' ? '★' : n}</button>`;
        control = `<div class="sv-scale-row">${opts}</div>${sc.lowLabel || sc.highLabel ? `<div class="sv-scale-labels"><span>${esc(sc.lowLabel || '')}</span><span>${esc(sc.highLabel || '')}</span></div>` : ''}`;
      } else if (q.type === 'matrix') {
        control = `<div class="sv-matrix-scroll"><table class="sv-matrix"><thead><tr><th></th>${(q.cols || []).map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
          <tbody>${(q.rows || []).map((r) => `<tr><td class="sv-mx-rowlabel">${esc(r.label)}</td>${(q.cols || []).map((c) => `<td><input type="radio" name="mxm-${esc(String(q.id))}-${esc(r.id)}" data-row="${esc(r.id)}" data-col="${esc(c.label)}" /></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      } else if (q.type === 'file') {
        control = `<input class="aca-input" type="file" accept="image/*" multiple /><div class="sv-file-list"></div><div class="sv-hint">最多 ${q.maxFiles ?? 3} 个</div>`;
      }
      return `
      <div class="sv-q-block sv-fill-q" data-qid="${esc(String(q.id))}" data-qtype="${q.type}">
        <div class="wizard-label">Q${idx + 1} ${esc(q.title)}${q.required ? ' <small style="color:var(--danger)">*必填</small>' : ' <small>（选填）</small>'}</div>
        ${control}${q.visibleWhen ? '<div class="sv-hint sv-cond-mark">按条件显示</div>' : ''}
      </div>`;
    };
    openMiniDialog({
      host: phoneScreen(), inHost: true, title: `填写 · ${esc(d0.title)}${d0.anonymous ? '（匿名）' : ''}`,
      textHTML: `${d0.description ? `${esc(d0.description)}<br/>` : ''}提交后不可修改${d0.deadline ? `；截止 ${String(d0.deadline).replace('T', ' ')}` : ''}。`,
      rawBody: d0.questions.map(qBlockHtml).join(''),
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '提交', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const collected = collectAnswers();
        if (collected.bad) return toast(collected.bad);
        try { await submitSurvey(d0.id, collected.answers); d.remove(); toast('已提交'); renderSurveyView(); } catch (ex) { toast(ex.message); }
      },
    });
    const dlg = container.querySelector('.leave-wizard');

    /* 读值（九类） */
    const readOne = (q, block) => {
      if (q.type === 'single') {
        const on = block.querySelector('.sv-opt.on');
        if (!on) return null;
        if (on.dataset.val === '__other__') { const t = block.querySelector('.sv-other-input')?.value.trim(); return t ? { option: '__other__', otherText: t } : null; }
        return on.dataset.val;
      }
      if (q.type === 'dropdown') {
        const sel = block.querySelector('.sv-dropdown')?.value;
        if (!sel) return null;
        if (sel === '__other__') { const t = block.querySelector('.sv-other-input')?.value.trim(); return t ? { option: '__other__', otherText: t } : null; }
        return sel;
      }
      if (q.type === 'multi') {
        const arr = [];
        block.querySelectorAll('.sv-opt.on').forEach((c) => {
          if (c.dataset.val === '__other__') { const t = block.querySelector('.sv-other-input')?.value.trim(); if (t) arr.push({ option: '__other__', otherText: t }); }
          else arr.push(c.dataset.val);
        });
        return arr.length ? arr : null;
      }
      if (q.type === 'sort') { const rows = Array.from(block.querySelectorAll('.sv-sort-row')); return rows.length ? rows.map((r) => r.dataset.val) : null; }
      if (q.type === 'scale') { const on = block.querySelector('.sv-scale-opt.on'); return on ? Number(on.dataset.val) : null; }
      if (q.type === 'matrix') {
        const out = {}; let any = false;
        block.querySelectorAll('input[type="radio"]:checked').forEach((r) => { out[r.dataset.row] = r.dataset.col; any = true; });
        return any ? out : null;
      }
      if (q.type === 'file') {
        const stored = block.querySelector('.sv-file-list')?.dataset.urls;
        if (!stored) return null;
        try { const arr = JSON.parse(stored); return arr.length ? arr : null; } catch { return null; }
      }
      const el = block.querySelector('.sv-text-input, .sv-textarea');
      return el && el.value.trim() !== '' ? el.value.trim() : null;
    };
    const readValues = () => {
      const map = {};
      dlg.querySelectorAll('.sv-q-block[data-qid]').forEach((block) => {
        const q = d0.questions.find((x) => String(x.id) === block.dataset.qid);
        if (q) map[q.id] = readOne(q, block);
      });
      return map;
    };
    const computeVisible = (values) => {
      const visible = {};
      for (const q of d0.questions) {
        const vw = q.visibleWhen;
        if (!vw || !Array.isArray(vw.rules) || !vw.rules.length) { visible[q.id] = true; continue; }
        const results = vw.rules.map((rule) => {
          if (visible[rule.questionId] !== true) return false;
          const src = d0.questions.find((x) => String(x.id) === String(rule.questionId));
          if (!src) return false;
          const ans = values[rule.questionId];
          const picked = new Set();
          const addVal = (v) => { if (v == null || v === '') return; if (typeof v === 'object' && !Array.isArray(v)) { picked.add('__other__'); return; } picked.add(String(v)); };
          if (src.type === 'multi') (Array.isArray(ans) ? ans : []).forEach(addVal); else addVal(ans);
          return rule.optionValues.some((v) => picked.has(v));
        });
        visible[q.id] = vw.op === 'or' ? results.some(Boolean) : results.every(Boolean);
      }
      return visible;
    };
    const recomputeVisibility = () => {
      const visible = computeVisible(readValues());
      dlg.querySelectorAll('.sv-q-block[data-qid]').forEach((block) => {
        const vis = visible[block.dataset.qid] !== false;
        block.hidden = !vis;
        block.classList.toggle('sv-q-hidden', !vis);
      });
    };
    dlg.addEventListener('click', recomputeVisibility);
    dlg.addEventListener('change', recomputeVisibility);
    dlg.addEventListener('input', recomputeVisibility);

    /* 控件绑定（九类） */
    dlg.querySelectorAll('.sv-q-block[data-qid]').forEach((block) => {
      const q = d0.questions.find((x) => String(x.id) === block.dataset.qid);
      if (!q) return;
      if (q.type === 'single' || q.type === 'multi') {
        block.querySelectorAll('.sv-opt').forEach((c) => c.addEventListener('click', () => {
          if (q.type === 'single') {
            block.querySelectorAll('.sv-opt').forEach((x) => x.classList.toggle('on', x === c));
            const oi = block.querySelector('.sv-other-input');
            if (oi) oi.hidden = c.dataset.val !== '__other__';
          } else {
            c.classList.toggle('on');
            const oi = block.querySelector('.sv-other-input');
            const otherOn = block.querySelector('.sv-opt[data-val="__other__"]')?.classList.contains('on');
            if (oi && q.otherOption) oi.hidden = !otherOn;
            if (q.maxSelect && block.querySelectorAll('.sv-opt.on').length > q.maxSelect) { c.classList.remove('on'); toast(`「${q.title}」最多选 ${q.maxSelect} 项`); }
          }
        }));
      }
      if (q.type === 'dropdown') {
        const sel = block.querySelector('.sv-dropdown');
        sel?.addEventListener('change', () => {
          const oi = block.querySelector('.sv-other-input');
          if (oi && q.otherOption) oi.hidden = sel.value !== '__other__';
        });
      }
      if (q.type === 'sort') {
        const move = (row, dir) => {
          const rows = Array.from(block.querySelectorAll('.sv-sort-row'));
          const i = rows.indexOf(row); const j = i + dir;
          if (j < 0 || j >= rows.length) return;
          if (dir < 0) row.parentElement.insertBefore(row, rows[j]); else row.parentElement.insertBefore(rows[j], row);
          renumber();
        };
        const renumber = () => block.querySelectorAll('.sv-sort-row').forEach((r, i) => { r.querySelector('.sv-sort-order').textContent = String(i + 1); });
        block.querySelectorAll('.sv-sort-row').forEach((row) => {
          row.querySelector('[data-sort="-1"]')?.addEventListener('click', () => move(row, -1));
          row.querySelector('[data-sort="1"]')?.addEventListener('click', () => move(row, 1));
        });
        renumber();
      }
      if (q.type === 'scale') {
        block.querySelectorAll('.sv-scale-opt').forEach((c) => c.addEventListener('click', () => {
          block.querySelectorAll('.sv-scale-opt').forEach((x) => x.classList.toggle('on', x === c));
        }));
      }
      if (q.type === 'file') {
        const input = block.querySelector('input[type="file"]');
        const list = block.querySelector('.sv-file-list');
        input?.addEventListener('change', async () => {
          const files = Array.from(input.files || []).slice(0, q.maxFiles ?? 3);
          const urls = [];
          for (const f of files) {
            if (f.size > 2 * 1024 * 1024) { toast(`「${f.name}」超过 2MB，已跳过`); continue; }
            urls.push(await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => resolve(null); r.readAsDataURL(f); }));
          }
          const valid = urls.filter(Boolean);
          list.dataset.urls = JSON.stringify(valid);
          list.innerHTML = valid.map((u, i) => `<img src="${u}" alt="附件 ${i + 1}" />`).join('') || '<span class="sv-hint">未选择</span>';
        });
      }
    });

    const collectAnswers = () => {
      const values = readValues();
      const visible = computeVisible(values);
      const answers = [];
      for (const q of d0.questions) {
        if (!visible[q.id]) continue;
        const v = values[q.id];
        const isEmpty = v == null || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && q.type === 'matrix' && Object.keys(v).length === 0);
        if (isEmpty) { if (q.required) return { bad: `「${q.title}」为必填` }; continue; }
        if (q.type === 'multi' && q.minSelect && v.length < q.minSelect) return { bad: `「${q.title}」至少选 ${q.minSelect} 项` };
        answers.push({ questionId: q.id, value: v });
      }
      return { answers };
    };

    recomputeVisibility();
  }

  function mSvVote(s, isMine) {
    const vc = s.voteConfig || {};
    const my = new Map((s.myChoices || []).map((c) => [String(c.optionId), c.count]));
    openMiniDialog({
      host: phoneScreen(), inHost: true, title: `投票 · ${esc(s.title)}`,
      textHTML: `每人 <b>${vc.votesPerPerson}</b> 票${vc.allowRepeatOption ? '，可重复投同一选项' : '，每项限 1 票'}${vc.allowRevote ? '，提交后可修改' : '，一投定局'}。${isMine && vc.allowRevote ? '<br/><b style="color:var(--google-blue)">已投过，修改后覆盖原选票。</b>' : ''}`,
      rawBody: `<div>${vc.options.map((o) => `
        <div class="sv-q-block" data-oid="${esc(String(o.id))}" style="flex-direction:row;align-items:center;justify-content:space-between;gap:10px">
          <strong style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(o.label)}</strong>
          <div class="sv-stepper">
            <button type="button" class="sv-step-btn" data-step="-1">−</button>
            <span class="sv-step-num" data-num>0</span>
            <button type="button" class="sv-step-btn" data-step="1">＋</button>
          </div>
        </div>`).join('')}
        <div class="sv-hint" style="margin-top:8px">剩余可投：<b class="sv-remain" id="mSvRemain">${vc.votesPerPerson}</b> 票</div></div>`,
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: isMine ? '修改选票' : '提交投票', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const choices = [];
        d.querySelectorAll('.sv-q-block[data-oid]').forEach((block) => {
          const n = Number(block.querySelector('[data-num]').textContent);
          if (n > 0) choices.push({ optionId: block.dataset.oid, count: n });
        });
        if (!choices.length) return toast('请至少投 1 票');
        try { const r = await voteSurvey(s.id, choices); d.remove(); toast(r.revoted ? '选票已修改' : '投票成功'); renderSurveyView(); } catch (ex) { toast(ex.message); }
      },
    });
    const dlg = container.querySelector('.leave-wizard');
    const vpp = vc.votesPerPerson;
    const sync = () => {
      let total = 0;
      dlg.querySelectorAll('.sv-q-block[data-oid]').forEach((block) => {
        const n = Number(block.querySelector('[data-num]').textContent);
        total += n;
        block.querySelector('[data-step="-1"]').disabled = n <= 0;
        block.querySelector('[data-step="1"]').disabled = total >= vpp || (!vc.allowRepeatOption && n >= 1);
      });
      const remain = dlg.querySelector('#mSvRemain');
      if (remain) remain.textContent = String(vpp - total);
    };
    dlg.querySelectorAll('.sv-q-block[data-oid]').forEach((block) => {
      if (my.has(block.dataset.oid)) block.querySelector('[data-num]').textContent = String(my.get(block.dataset.oid));
      block.querySelectorAll('.sv-step-btn').forEach((btn) => btn.addEventListener('click', () => {
        const numEl = block.querySelector('[data-num]');
        numEl.textContent = String(Math.max(0, Number(numEl.textContent) + Number(btn.dataset.step)));
        sync();
      }));
    });
    sync();
  }

  async function mSvStats(id) {
    if (container.querySelector('.leave-wizard')) return;
    let st;
    try { st = await fetchSurveyStats(id); } catch (ex) { return toast(ex.message); }
    const s = st.survey;
    const rate = st.respondentCount ? Math.round((st.filledCount / st.respondentCount) * 100) : 0;
    let distHtml = '';
    if (s.kind === 'questionnaire') {
      distHtml = (st.distribution || []).map((d) => {
        const bars = d.counts.length ? d.counts.map((c) => `<div class="sv-bar-row"><span class="sv-bar-label" title="${esc(c.label)}">${esc(c.label)}</span><div class="sv-bar-track"><div class="sv-bar-fill" style="width:${st.filledCount ? Math.max(2, (c.count / st.filledCount) * 100) : 0}%"></div></div><span class="sv-bar-num">${c.count}</span></div>`).join('') : '';
        return `<div class="wizard-label" style="margin-top:10px">${esc(d.title)}</div>${bars}`;
      }).join('');
    } else {
      const maxV = Math.max(1, ...((st.vote?.tallies || []).map((t) => t.votes)));
      distHtml = (st.vote?.options || []).map((o) => {
        const votes = (st.vote?.tallies || []).find((t) => String(t.optionId) === String(o.id))?.votes || 0;
        return `<div class="sv-bar-row"><span class="sv-bar-label" title="${esc(o.label)}">${esc(o.label)}</span><div class="sv-bar-track"><div class="sv-bar-fill mint" style="width:${(votes / maxV) * 100}%"></div></div><span class="sv-bar-num">${votes}</span></div>`;
      }).join('') + `<div class="sv-hint" style="margin-top:6px">投票人数：<b>${st.vote?.voters ?? 0}</b> 人</div>`;
    }
    const unfilled = (st.unfilledStudents?.length || st.unfilledTeachers?.length)
      ? `<div class="wizard-label" style="margin-top:10px">未填名单（${st.unfilledStudents.length + (st.unfilledTeachers?.length || 0)} 人）：</div><div class="sv-hint">${st.unfilledStudents.slice(0, 12).map((u) => `${esc(u.name)}（${esc(u.className)}）`).join('、')}${st.unfilledStudents.length > 12 ? '…' : ''}${st.unfilledTeachers?.length ? `<br/>教师：${st.unfilledTeachers.map(esc).join('、')}` : ''}</div>`
      : '<div class="sv-hint" style="margin-top:8px">全部受众已完成填写。</div>';
    openMiniDialog({
      host: phoneScreen(), inHost: true, title: `统计 · ${esc(s.title)}`,
      textHTML: `${s.anonymous ? '匿名' : '实名'} · ${mSvAudText(s)}${s.deadline ? ` · 截止 ${String(s.deadline).replace('T', ' ')}` : ''}`,
      rawBody: `<div class="sv-stats-head"><span class="sv-rate">已填 ${st.filledCount} / ${st.respondentCount}（${rate}%）</span></div>${distHtml}${unfilled}${st.anonymous ? '<div class="sv-hint" style="margin-top:6px">匿名：明细对任何人不可见。</div>' : !st.canViewDetail ? '<div class="sv-hint" style="margin-top:6px">实名明细：不在可见范围。</div>' : ''}`,
      buttons: [
        ...(s.status === 'published' ? [{ act: 'remind', label: '催填', cls: 'primary' }] : []),
        { act: 'ok', label: '关闭', cls: 'ghost' },
      ],
      onAction: async (act, d) => {
        if (act === 'ok') return d.remove();
        if (act === 'remind') {
          try { const r = await remindSurvey(s.id); toast(`已催填（${r.channels} 个频道）`); } catch (ex) { toast(ex.message); }
        }
      },
    });
  }

  async function mSvCreate() {
    if (container.querySelector('.leave-wizard')) return;
    openMiniDialog({
      host: phoneScreen(), inHost: true, title: '发起问卷 / 投票',
      textHTML: '创建为草稿，发布后受众收到通知。',
      rawBody: `
        <div class="segmented aca-dlg-tabs sv-kind-tabs" role="tablist">
          <button type="button" class="active" role="tab" aria-selected="true" data-k="questionnaire">问卷</button>
          <button type="button" role="tab" aria-selected="false" data-k="vote">投票</button>
        </div>
        <div class="wizard-label">标题：</div>
        <input class="aca-input" id="mSvTitle" maxlength="60" placeholder="如：班级活动投票" autocomplete="off" />
        <div class="wizard-label" style="margin-top:10px">说明（选填）：</div>
        <textarea class="reason-input" id="mSvDesc" maxlength="300"></textarea>
        <div class="wizard-label" style="margin-top:10px">填写方式：</div>
        <div class="chip-row"><button type="button" class="sv-opt on" data-anon="0">实名</button><button type="button" class="sv-opt" data-anon="1">匿名</button></div>
        ${mSvIsCounselor ? '<div class="sv-hint" style="margin-top:8px">面向您绑定的班级（自动定向）</div><input type="hidden" id="mSvAudience" value="students" />' : `
        <div class="wizard-label" style="margin-top:10px">受众：</div>
        <select class="aca-input" id="mSvAudience"><option value="students">学生</option><option value="teachers">教师</option><option value="all">全校师生</option></select>`}
        <div class="wizard-label" style="margin-top:10px">截止时间（选填）：</div>
        <input class="aca-input" id="mSvDeadline" type="datetime-local" />`,
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '创建草稿', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const payload = collect(d);
        if (payload.errors.length) return toast(payload.errors.join('；'));
        try {
          const r = await createSurvey(payload.value);
          d.remove();
          toast(`已创建草稿「${r.survey.title}」`);
          mSvTab = 'mine';
          renderSurveyView();
        } catch (ex) { toast(ex.message); }
      },
    });
    const dlg = container.querySelector('.leave-wizard');
    dlg.querySelectorAll('.sv-kind-tabs button').forEach((b) => b.addEventListener('click', () => {
      dlg.querySelectorAll('.sv-kind-tabs button').forEach((x) => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', String(on)); });
      const kind = b.dataset.k;
      // 切换时插入对应设计器（重建）
      let designer = dlg.querySelector('#mSvDesigner');
      if (designer) designer.remove();
      designer = document.createElement('div');
      designer.id = 'mSvDesigner';
      designer.innerHTML = kind === 'vote' ? voteDesigner() : questionDesigner();
      dlg.querySelector('.wizard-foot').before(designer);
      bindDesigner(kind, designer);
    }));
    dlg.querySelectorAll('.sv-opt[data-anon]').forEach((c) => c.addEventListener('click', () => {
      dlg.querySelectorAll('.sv-opt[data-anon]').forEach((x) => x.classList.toggle('on', x === c));
    }));
    // 默认插入问卷设计器
    const designer = document.createElement('div');
    designer.id = 'mSvDesigner';
    designer.innerHTML = questionDesigner();
    dlg.querySelector('.wizard-foot').before(designer);
    bindDesigner('questionnaire', designer);

    function questionDesigner() {
      return `<div class="wizard-label" style="margin-top:10px">题目（默认 1 题，可增删）：</div>
        <div id="mSvQList"></div>
        <button type="button" class="btn ghost compact" id="mSvAddQ" style="margin-top:8px">${icon('plus')}添加题目</button>`;
    }
    function voteDesigner() {
      return `<div class="wizard-label" style="margin-top:10px">投票选项（默认 2 项）：</div>
        <div id="mSvOptList"></div>
        <button type="button" class="btn ghost compact" id="mSvAddOpt" style="margin-top:8px">${icon('plus')}添加选项</button>
        <div class="wizard-label" style="margin-top:10px">规则：</div>
        <div class="sv-opt-row"><span class="sv-hint" style="flex:0 0 84px">每人票数</span><input class="aca-input" id="mSvVpp" type="number" min="1" max="10" value="1" style="flex:0 0 70px" /></div>
        <div class="chip-row" style="margin-top:8px"><button type="button" class="sv-opt" data-sw="repeat">可重复投同项</button><button type="button" class="sv-opt on" data-sw="revote">可改票</button></div>
        <div class="sv-opt-row" style="margin-top:8px"><span class="sv-hint" style="flex:0 0 84px">结果可见</span>
          <select class="aca-input" id="mSvResultVis" style="flex:1"><option value="after-vote">投票后可见</option><option value="owner">仅发起人</option></select></div>`;
    }
    function bindDesigner(kind, root) {
      if (kind === 'questionnaire') {
        const qList = root.querySelector('#mSvQList');
        const addQ = () => {
          const i = qList.children.length + 1;
          const div = document.createElement('div');
          div.className = 'sv-q-block';
          div.innerHTML = `
            <div class="sv-q-head">
              <select class="aca-input sv-q-type"><option value="single">单选</option><option value="multi">多选</option><option value="text">文本</option><option value="date">日期</option><option value="number">数字</option></select>
              <input class="aca-input sv-q-title" placeholder="第 ${i} 题标题" maxlength="100" />
              <label class="sv-q-req"><input type="checkbox" class="sv-q-reqck" checked />必填</label>
              <button type="button" class="btn danger compact" data-qdel>${icon('x')}</button>
            </div>
            <div class="sv-q-opts"><div class="sv-opt-row"><input class="aca-input sv-q-opt" placeholder="选项 1" maxlength="50" /><button type="button" class="btn ghost compact" data-optdel>${icon('x')}</button></div><div class="sv-opt-row"><input class="aca-input sv-q-opt" placeholder="选项 2" maxlength="50" /><button type="button" class="btn ghost compact" data-optdel>${icon('x')}</button></div></div>`;
          qList.appendChild(div);
          const typeSel = div.querySelector('.sv-q-type');
          const optsBox = div.querySelector('.sv-q-opts');
          const syncType = () => { optsBox.hidden = !['single', 'multi'].includes(typeSel.value); };
          typeSel.addEventListener('change', syncType);
          syncType();
          div.querySelector('[data-qdel]').addEventListener('click', () => div.remove());
          div.querySelectorAll('.sv-opt-row [data-optdel]').forEach((b) => b.addEventListener('click', () => b.parentElement.remove()));
          const addOptBtn = document.createElement('button');
          addOptBtn.type = 'button'; addOptBtn.className = 'btn ghost compact sv-opt-add'; addOptBtn.style.marginTop = '6px'; addOptBtn.innerHTML = `${icon('plus')}加选项`;
          addOptBtn.addEventListener('click', () => {
            const row = document.createElement('div');
            row.className = 'sv-opt-row';
            row.innerHTML = `<input class="aca-input sv-q-opt" placeholder="选项 ${optsBox.querySelectorAll('.sv-opt-row').length + 1}" maxlength="50" /><button type="button" class="btn ghost compact" data-optdel>${icon('x')}</button>`;
            row.querySelector('[data-optdel]').addEventListener('click', () => row.remove());
            optsBox.appendChild(row);
          });
          optsBox.appendChild(addOptBtn);
        };
        root.querySelector('#mSvAddQ')?.addEventListener('click', addQ);
        addQ();
      } else {
        const oList = root.querySelector('#mSvOptList');
        const addOptRow = () => {
          const row = document.createElement('div');
          row.className = 'sv-opt-row'; row.style.marginTop = '6px';
          row.innerHTML = `<input class="aca-input sv-v-opt" placeholder="选项 ${oList.children.length + 1}" maxlength="50" /><button type="button" class="btn ghost compact" data-optdel>${icon('x')}</button>`;
          row.querySelector('[data-optdel]').addEventListener('click', () => row.remove());
          oList.appendChild(row);
        };
        root.querySelector('#mSvAddOpt')?.addEventListener('click', addOptRow);
        addOptRow(); addOptRow();
        root.querySelectorAll('.sv-opt[data-sw]').forEach((c) => c.addEventListener('click', () => c.classList.toggle('on')));
      }
    }
    function collect(d) {
      const errors = [];
      const kind = d.querySelector('.sv-kind-tabs button.active')?.dataset.k || 'questionnaire';
      const title = d.querySelector('#mSvTitle').value.trim();
      if (!title) errors.push('请填写标题');
      const payload = {
        kind, title,
        description: d.querySelector('#mSvDesc').value.trim(),
        anonymous: d.querySelector('.sv-opt[data-anon="1"]').classList.contains('on') ? 1 : 0,
        audience: d.querySelector('#mSvAudience')?.value || 'students',
        deadline: d.querySelector('#mSvDeadline').value || null,
        visibility: { statsViewers: [], detailViewers: [] }, // 移动端简化：不配额外查看角色（PC 端可配）
      };
      if (kind === 'questionnaire') {
        const questions = [];
        d.querySelectorAll('#mSvQList .sv-q-block').forEach((block, idx) => {
          const qTitle = block.querySelector('.sv-q-title').value.trim();
          if (!qTitle) { errors.push(`第 ${idx + 1} 题缺少标题`); return; }
          const type = block.querySelector('.sv-q-type').value;
          const q = { id: `q${idx + 1}`, type, title: qTitle, required: block.querySelector('.sv-q-reqck').checked };
          if (['single', 'multi'].includes(type)) {
            q.options = Array.from(block.querySelectorAll('.sv-q-opt')).map((i) => i.value.trim()).filter(Boolean);
            if (q.options.length < 2) errors.push(`「${qTitle}」至少 2 个选项`);
          }
          questions.push(q);
        });
        if (!questions.length) errors.push('问卷至少 1 道题');
        payload.questions = questions;
      } else {
        const options = Array.from(d.querySelectorAll('.sv-v-opt')).map((i, idx) => ({ id: `o${idx + 1}`, label: i.value.trim() })).filter((o) => o.label);
        if (options.length < 2) errors.push('投票至少 2 个选项');
        payload.voteConfig = {
          options,
          votesPerPerson: Math.max(1, Math.min(10, Number(d.querySelector('#mSvVpp')?.value) || 1)),
          allowRepeatOption: d.querySelector('.sv-opt[data-sw="repeat"]')?.classList.contains('on') || false,
          allowRevote: d.querySelector('.sv-opt[data-sw="revote"]')?.classList.contains('on') !== false,
          resultVisibility: d.querySelector('#mSvResultVis')?.value || 'after-vote',
        };
      }
      return { errors, value: payload };
    }
  }

  /* ---------------- 消息视图（B1 2026-10-29：通知列表 + 点选已读 + 全部已读，替代原"开发中"占位 toast） ---------------- */
  function updateMsgBadge(count) {
    const badge = container.querySelector('.m-msg-badge');
    if (!badge) return;
    badge.hidden = !count;
    badge.textContent = count > 99 ? '99+' : String(count);
  }

  async function refreshMsgBadge() {
    try { updateMsgBadge((await fetchNotifications({ unread: 1 })).length); } catch { /* 静默：网络异常不影响入口 */ }
  }

  async function renderMsgView() {
    const view = container.querySelector('#mobileMsgView');
    if (!view) return;
    let list = [];
    try { list = await fetchNotifications({}); } catch (ex) { return toast(ex.message); }
    const unread = list.filter((n) => !n.readAt);
    updateMsgBadge(unread.length);
    view.innerHTML = `
      <div class="m-leave-head">
        <span>消息${unread.length ? `（${unread.length} 条未读）` : ''}</span>
        ${unread.length ? `<button type="button" class="btn ghost compact" id="mMsgReadAll">${icon('check')}全部已读</button>` : ''}
      </div>
      ${list.length ? `<div class="m-msg-list">${list.map((n) => `
        <div class="m-msg-card${n.readAt ? '' : ' unread'}" data-nid="${n.id}">
          <div class="m-msg-top"><span class="m-msg-dot${n.readAt ? ' read' : ''}"></span><strong>${esc(n.title)}</strong></div>
          ${n.detail ? `<div class="m-msg-detail">${esc(n.detail)}</div>` : ''}
          <div class="m-msg-time">${(n.createdAt || '').slice(0, 16).replace('T', ' ')}</div>
        </div>`).join('')}</div>`
      : `<div class="m-leave-empty">${icon('bell', 'icon large')}<strong>暂无消息</strong></div>`}`;
    view.querySelectorAll('.m-msg-card').forEach((card) => {
      card.addEventListener('click', async () => {
        const nid = Number(card.dataset.nid);
        const n = list.find((x) => x.id === nid);
        if (n && !n.readAt) {
          try { await markNotificationsRead([nid]); } catch (ex) { toast(ex.message); }
        }
        renderMsgView();
      });
    });
    view.querySelector('#mMsgReadAll')?.addEventListener('click', async () => {
      const ids = unread.map((n) => n.id);
      if (!ids.length) return;
      try {
        await markNotificationsRead(ids);
        toast(`已标记 ${ids.length} 条为已读`);
      } catch (ex) { toast(ex.message); }
      renderMsgView();
    });
  }
  refreshMsgBadge();

  /* ---------------- 视图切换（首页 / 请假 / 消息 / 我的 / 教务管理 / 课程 / 课堂 / 学生处 / 调课审批 / 课堂记录 / 问卷与投票） ---------------- */
  const VIEWS = ['home', 'leave', 'msg', 'profile', 'academic', 'courses', 'classroom', 'sa', 'lesson-review', 'class-records', 'survey'];
  const VIEW_IDS = { home: '#mobileHome', leave: '#mobileLeaveView', msg: '#mobileMsgView', profile: '#mobileProfile', academic: '#mobileAcademicView', courses: '#mobileCoursesView', classroom: '#mobileClassroomView', sa: '#mobileSAView', 'lesson-review': '#mobileLessonReviewView', 'class-records': '#mobileClassRecordsView', survey: '#mobileSurveyView' };
  const showView = (which) => {
    if (!VIEWS.includes(which)) which = 'home';
    VIEWS.forEach((v) => { container.querySelector(VIEW_IDS[v]).hidden = v !== which; });
    if (which === 'leave') renderLeaveView();
    if (which === 'msg') renderMsgView();
    if (which === 'academic') renderAcademicView();
    if (which === 'courses') renderCoursesView();
    if (which === 'classroom') renderClassroomView();
    if (which === 'sa') renderSAView();
    if (which === 'lesson-review') renderLessonReviewView();
    if (which === 'class-records') renderClassRecordsView();
    if (which === 'survey') renderSurveyView();
    currentView = which;
  };
  let currentView = 'home';
  $$('.phone-nav-item', container).forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.phone-nav-item', container).forEach((x) => x.classList.toggle('active', x === btn));
      const tab = btn.dataset.mobileTab;
      if (tab === '首页') return showView('home');
      if (tab === '请假') return showView('leave');
      if (tab === '消息') return showView('msg');
      if (tab === '我的') return showView('profile');
    });
  });

  /* 首页功能入口卡：真实跳转（leave→请假 tab；academic→教务管理视图；P11 新视图路由） */
  $$('.mobile-action-card', container).forEach((card) => {
    card.addEventListener('click', () => {
      const tab = card.dataset.tab;
      const action = card.dataset.action;
      if (tab === 'academic') {
        if (action === 'teachers') acaTab = 'teachers';
        else acaTab = 'students';
        return showView('academic');
      }
      if (tab === 'sa') { saTab = ['pending', 'violations'].includes(action) ? action : 'students'; return showView('sa'); }
      if (['courses', 'classroom', 'lesson-review', 'class-records', 'survey'].includes(tab)) return showView(tab);
      const navBtn = container.querySelector(`.phone-nav-item[data-mobile-tab="${tab === 'leave' ? '请假' : tab}"]`);
      if (navBtn) navBtn.click();
      if (action === 'new') setTimeout(() => startNewLeave(), 250); // 等请假视图挂载后再开向导
    });
  });

  /* 个人中心退出登录 */
  container.querySelector('#mobileLogoutBtn')?.addEventListener('click', () => logout());

  /* 修改密码（共享弹窗 in-host 手机框内，2026-10-29 密码体系；防重入护栏；
     ⚠ host 必须是 phoneScreen()（position:relative+overflow:hidden）——挂 #mobileStage 时
     absolute 遮罩无定位祖先会铺满整个视口（实测 rect 1021×850 越出手机框），与其余 in-host 弹窗同款接法） */
  container.querySelector('#mobilePwdBtn')?.addEventListener('click', () => {
    if (container.querySelector('.leave-wizard')) return;
    openChangePasswordDialog({ host: phoneScreen(), inHost: true, eventBus: context.eventBus });
  });

  /* 学生提交/导员审批/学生销假后（本页或其他端点触发）刷新请假视图 */
  leaveOff = context.eventBus.on('leave:submitted', renderLeaveView);
  verifyOff = context.eventBus.on('verify:completed', renderLeaveView);
  returnOff = context.eventBus.on('leave:returned', renderLeaveView);

  /* SSE 实时通知（P11：统一 toast + 当前视图自动刷新，避免跨视图弹窗冲突） */
  lessonAddedOff = context.eventBus.on('sse:timetableLessonAdded', (p) => {
    if (role === '学生') { toast(`${p?.title || '新课通知'}：${p?.detail || ''}`); if (currentView === 'courses') renderCoursesView(); }
  });
  lessonCancelledOff = context.eventBus.on('sse:timetableLessonCancelled', (p) => {
    if (role === '学生') { toast(`${p?.title || '停课通知'}：${p?.detail || ''}`); if (currentView === 'courses') renderCoursesView(); }
  });
  reviewedOff = context.eventBus.on('sse:workflowRequestReviewed', (r) => {
    if (role === '教师' || role === '教务处') {
      const st = r?.status === 'approved' ? '已通过' : '已驳回';
      toast(`审批结果：${r?.title || ''}（${st}）`);
      if (currentView === 'lesson-review' && role === '教务处') renderLessonReviewView();
      if (currentView === 'courses' && role === '教师') renderCoursesView();
    }
  });

  /* 问卷与投票 SSE（S11 2026-10-30：发布/关闭/催填 → toast + 当前视图刷新） */
  surveyPubOff = context.eventBus.on('sse:surveyPublished', (p) => {
    if (mSvIsRespondent) toast(`新${p?.kind === 'vote' ? '投票' : '问卷'}：${p?.title || ''}`);
    if (currentView === 'survey') renderSurveyView();
    refreshMsgBadge();
  });
  surveyClosedOff = context.eventBus.on('sse:surveyClosed', (p) => {
    toast(`问卷已关闭：${p?.title || ''}`);
    if (currentView === 'survey') renderSurveyView();
  });
  surveyRemindOff = context.eventBus.on('sse:surveyReminded', (p) => {
    if (mSvIsRespondent) toast(`催填提醒：${p?.title || ''}`);
    if (currentView === 'survey') renderSurveyView();
  });

  const updateClock = () => {
    const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    const el = container.querySelector('[data-mobile-clock]');
    if (el) el.textContent = time;
  };
  updateClock();
  clockTimer = setInterval(updateClock, 30000);

  /* ---------------- 全局搜索（2026-11-03 批二 S10 双端同步：首页搜索框 + inline 分组结果 + 按角色跳视图） ---------------- */
  const mSearchGoto = (kind) => {
    if (kind === 'student' || kind === 'class') {
      if (role === '学生处') return 'sa';
      if (role === '教务处' || role === 'IT管理员') return 'academic';
      return null;
    }
    if (kind === 'teacher') return role === '教务处' || role === 'IT管理员' ? 'academic' : null;
    if (kind === 'lesson') return ['学生', '教师', 'IT管理员'].includes(role) ? 'courses' : null;
    return null;
  };
  let mSearchTimer = null;
  const mSearchInput = container.querySelector('#mSearchInput');
  const mSearchResults = container.querySelector('#mSearchResults');
  const renderMobileSearch = (groups) => {
    const secs = [];
    if (groups.students?.length) secs.push({ title: '学生', items: groups.students.map((s) => ({ main: s.name, sub: `${s.id} · ${s.className}`, view: mSearchGoto('student') })) });
    if (groups.classes?.length) secs.push({ title: '班级', items: groups.classes.map((c) => ({ main: c.name, sub: `${c.studentCount} 名学生`, view: mSearchGoto('class') })) });
    if (groups.teachers?.length) secs.push({ title: '教师', items: groups.teachers.map((t) => ({ main: t.name, sub: `${t.classCount} 个授课班`, view: mSearchGoto('teacher') })) });
    if (groups.lessons?.length) secs.push({ title: '课程', items: groups.lessons.map((l) => ({ main: l.courseName, sub: `${l.teacherName} · ${l.className}${l.source === 'add' ? ' · 单次加课' : ''}`, view: mSearchGoto('lesson') })) });
    mSearchResults.innerHTML = secs.length
      ? secs.map((sec) => `
        <div class="m-sec-head">${sec.title}</div>
        ${sec.items.map((it) => `
          <button type="button" class="m-search-item${it.view ? '' : ' flat'}" data-view="${it.view || ''}" ${it.view ? '' : 'disabled'}>
            <strong>${esc(it.main)}</strong>
            <small>${esc(it.sub)}</small>
            ${it.view ? '<svg class="icon small" style="margin-left:auto;flex:0 0 auto"><use href="#i-chevron-right"/></svg>' : ''}
          </button>`).join('')}`).join('')
      : `<div class="m-search-empty">${icon('search', 'icon large')}<span>无匹配结果</span></div>`;
    mSearchResults.hidden = false;
    mSearchResults.querySelectorAll('.m-search-item[data-view]:not([disabled])').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.view;
        if (v && VIEWS.includes(v)) {
          mSearchInput.value = '';
          mSearchResults.hidden = true;
          mSearchResults.innerHTML = '';
          showView(v);
        }
      });
    });
  };
  mSearchInput?.addEventListener('input', () => {
    window.clearTimeout(mSearchTimer);
    const q = mSearchInput.value.trim();
    if (!q) { mSearchResults.hidden = true; mSearchResults.innerHTML = ''; return; }
    mSearchTimer = window.setTimeout(async () => {
      try { renderMobileSearch(await searchAll(q)); } catch { /* 搜索失败静默 */ }
    }, 250);
  });

  /* ---------------- 待办弹窗「去处理」跳转（批二 S8：todo:goto 事件 → 切换对应视图） ---------------- */
  const TODO_VIEW = { 'student-leave': 'leave', 'counselor-verify': 'leave', 'student-affairs': 'sa', 'lesson-review': 'lesson-review', 'classroom': 'classroom', 'courses': 'courses', 'academic': 'academic' };
  todoGotoOff = context.eventBus.on('todo:goto', ({ moduleId } = {}) => {
    const v = TODO_VIEW[moduleId];
    if (v && VIEWS.includes(v)) showView(v);
  });
}

let leaveOff = null;
let verifyOff = null;
let returnOff = null;
let lessonAddedOff = null;
let lessonCancelledOff = null;
let reviewedOff = null;
let surveyPubOff = null;
let surveyClosedOff = null;
let surveyRemindOff = null;
let sseSignOff = null;
let todoGotoOff = null;
let ttHandleMobile = null; // 课表组件句柄（含 30s 红线定时器，unmount 必 destroy）

export async function unmount(container) {
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  if (leaveOff) { leaveOff(); leaveOff = null; }
  if (verifyOff) { verifyOff(); verifyOff = null; }
  if (returnOff) { returnOff(); returnOff = null; }
  if (lessonAddedOff) { lessonAddedOff(); lessonAddedOff = null; }
  if (lessonCancelledOff) { lessonCancelledOff(); lessonCancelledOff = null; }
  if (reviewedOff) { reviewedOff(); reviewedOff = null; }
  if (surveyPubOff) { surveyPubOff(); surveyPubOff = null; }
  if (surveyClosedOff) { surveyClosedOff(); surveyClosedOff = null; }
  if (surveyRemindOff) { surveyRemindOff(); surveyRemindOff = null; }
  if (sseSignOff) { sseSignOff(); sseSignOff = null; }
  if (todoGotoOff) { todoGotoOff(); todoGotoOff = null; }
  if (ttHandleMobile) { ttHandleMobile.destroy(); ttHandleMobile = null; }
  container.innerHTML = '';
  container.classList.remove('mod-mobile-home');
}
