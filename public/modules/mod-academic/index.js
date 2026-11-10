// mod-academic：教务管理（教务处/IT管理员）
// 学生管理：分类夹（未分配+自建班级）——教务处写操作全部走申请（C1）；IT 直改（C4）
// 教师管理（P5 重构 §6.2）：左栏专业部夹（新建专业部虚线框+未分配教师独立条目）→ 右栏三件套：
//   专业名+[编辑][解散] / 班级 chips 切换课表（D1b，timetable 组件只读）/ 部内教师卡 / 导员绑定区（D7）
import { currentRole } from '../../shared/roles.js';
import { fetchStudents, fetchClasses, createClass, fetchTeachers, setTeacherClasses, updateClassMembers, dissolveClass, addTeacher, renameClass } from '../../shared/api-academic.js';
import { fetchMajors, createMajor, updateMajorMembers, dissolveMajor, setCounselorClasses } from '../../shared/api-majors.js';
import { fetchClassTimetable } from '../../shared/api-timetable.js';
import { renderTimetable } from '../../shared/timetable.js';
import { submitRequest, fetchRequests, withdrawRequest, fetchNotifications, markNotificationsRead, REQ_STATUS } from '../../shared/api-workflow.js';
import { openMiniDialog, esc, icon } from '../../shared/leave-wizard.js';

let sseOff = null;
let sseReviewedOff = null;

export async function mount(container, context) {
  container.classList.add('mod-academic');
  const role = context.user?.group || currentRole();
  const isDirect = role === 'IT管理员'; // C4：IT 保留直改；教务处写操作全部走申请（C1）
  let students = [];
  let classes = [];
  let unassigned = 0;
  let folder = 'un'; // 'un' | classId
  let expandedTeacher = null;
  /* P5 专业部状态 */
  let majors = [];
  let unassignedTeachers = [];
  let counselors = [];
  let teachers = []; // [{name, classIds}]（教师授课班级摘要）
  let selectedMajor = null; // null=未选中 | 'un' | majorId
  let selectedClass = null; // 班级 chips 选中 classId
  let ttHandle = null; // 课表组件句柄（unmount 必 destroy）

  container.innerHTML = `
  <div class="welcome-row"><div>
    <div class="eyebrow"><span class="spark"></span>ACADEMIC</div>
    <h1>教务管理</h1>
    <div class="welcome-copy">${isDirect ? '学生班级管理与教师授课班级分配（直改模式）。' : '学生班级管理（变更走申请，学生处审批）与教师授课班级分配。'}</div>
  </div></div>
  <section class="surface section-card">
    <div class="aca-top">
      <div class="segmented aca-main-tabs" role="tablist" aria-label="教务管理切换">
        <button type="button" class="active" role="tab" aria-selected="true" data-tab="students">${icon('users')}学生管理</button>
        <button type="button" role="tab" aria-selected="false" data-tab="teachers">${icon('book')}教师管理</button>
        ${isDirect ? '' : `<button type="button" role="tab" aria-selected="false" data-tab="requests">${icon('file')}我的申请</button>`}
      </div>
    </div>
    <div class="aca-pane-box" id="acaPaneStudents">
      <div class="section-header">
        <div><div class="section-title"><span class="section-head-icon"><svg class="icon"><use href="#i-users"/></svg></span>学生管理</div></div>
      </div>
      <div class="aca-split">
        <div class="aca-left">
          <div class="aca-folders" id="acaFolders"></div>
          <button type="button" class="aca-folder aca-un-row" id="acaUnRow">${icon('users')}<span>未分配</span><em id="acaUnCount">0</em></button>
        </div>
        <div class="aca-students" id="acaStudents"></div>
      </div>
      <div class="flow-foot"><span id="acaStuTotal">共 0 名学生</span><span>学号为 9 位数字</span></div>
    </div>
    <div class="aca-pane-box" id="acaPaneTeachers" hidden>
      <div class="section-header">
        <div><div class="section-title"><span class="section-head-icon"><svg class="icon"><use href="#i-book"/></svg></span>教师管理</div></div>
      </div>
      <div class="aca-split">
        <div class="aca-left">
          <div class="aca-folders" id="acaMajorFolders"></div>
          <button type="button" class="aca-folder aca-un-row" id="acaUnTeachersRow">${icon('users')}<span>未分配教师</span><em id="acaUnTeachersCount">0</em></button>
          <button type="button" class="aca-folder-add aca-add-teacher" id="acaAddTeacher">${icon('plus')}添加教师</button>
        </div>
        <div class="aca-major-main" id="acaMajorMain"></div>
      </div>
      <div class="flow-foot"><span>专业部 · 教师多对多归属 · 导员绑定（导员审批范围由此决定）</span></div>
    </div>
    ${isDirect ? '' : `
    <div class="aca-pane-box" id="acaPaneRequests" hidden>
      <div class="section-header">
        <div><div class="section-title"><span class="section-head-icon"><svg class="icon"><use href="#i-file"/></svg></span>我的申请</div></div>
      </div>
      <div class="aca-requests" id="acaRequests"></div>
      <div class="flow-foot"><span>班级变更申请由学生处审批，结果将实时通知</span></div>
    </div>`}
  </section>`;

  /* 主切换滑块（与登录页 segmented 同款交互：active + aria-selected + pane hidden） */
  const mainTabs = container.querySelectorAll('.aca-main-tabs button');
  mainTabs.forEach((b) => b.addEventListener('click', () => {
    mainTabs.forEach((x) => {
      const on = x === b;
      x.classList.toggle('active', on);
      x.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    container.querySelector('#acaPaneStudents').hidden = b.dataset.tab !== 'students';
    container.querySelector('#acaPaneTeachers').hidden = b.dataset.tab !== 'teachers';
    const reqPane = container.querySelector('#acaPaneRequests');
    if (reqPane) reqPane.hidden = b.dataset.tab !== 'requests';
    if (b.dataset.tab === 'requests') renderRequests();
  }));

  const toast = (message) => context.eventBus.emit('ui:toast', { message });
  const reload = async () => {
    const [stuList, clsData, majorData, teacherList] = await Promise.all([
      fetchStudents(),
      fetchClasses(),
      fetchMajors().catch(() => ({ majors: [], unassignedTeachers: [], counselors: [] })),
      fetchTeachers().catch(() => []),
    ]);
    students = stuList;
    classes = clsData.classes;
    unassigned = clsData.unassigned;
    majors = majorData.majors || [];
    unassignedTeachers = majorData.unassignedTeachers || [];
    counselors = majorData.counselors || [];
    teachers = teacherList;
    renderFolders();
    renderStudents();
    renderMajorFolders();
    renderMajorMain();
  };

  /* ---------- 学生管理 ---------- */
  /* 布局（2026-10-23 用户需求）：左栏 = 灰蓝容器（自建班级 + 底部虚线框新建班级）+ 容器下方独立「未分配」条目；
     未分配 DOM 静态不重建，仅同步 active 态与计数，事件只绑一次 */
  const renderFolders = () => {
    const box = container.querySelector('#acaFolders');
    box.innerHTML = `
      ${classes.map((c) => `
      <button type="button" class="aca-folder${folder === c.id ? ' active' : ''}" data-f="${c.id}">
        ${icon('book')}<span>${esc(c.name)}</span><em>${c.count}</em>
      </button>`).join('')}
      <button type="button" class="aca-folder-add" id="acaNewClass">${icon('plus')}新建班级</button>`;
    container.querySelector('#acaUnRow').classList.toggle('active', folder === 'un');
    container.querySelector('#acaUnCount').textContent = unassigned;
    box.querySelectorAll('.aca-folder').forEach((b) => b.addEventListener('click', () => { folder = +b.dataset.f; renderFolders(); renderStudents(); }));
    box.querySelector('#acaNewClass')?.addEventListener('click', () => isDirect ? openNewClass() : openApplyNewClass());
  };
  container.querySelector('#acaUnRow')?.addEventListener('click', () => { if (folder !== 'un') { folder = 'un'; renderFolders(); renderStudents(); } });

  const renderStudents = () => {
    const box = container.querySelector('#acaStudents');
    const isUn = folder === 'un';
    const cls = classes.find((c) => c.id === folder);
    const list = isUn ? students.filter((s) => !s.classId) : students.filter((s) => s.classId === folder);
    container.querySelector('#acaStuTotal').textContent = `共 ${students.length} 名学生`;
    box.innerHTML = `
      <div class="aca-stu-head">${isUn ? '未分配学生' : esc(cls?.name || '')}<em>${list.length} 人</em>${isUn ? '' : `
        <span class="aca-stu-acts">
          <button type="button" class="btn compact" id="acaRenameClass">${icon('edit')}${isDirect ? '重命名' : '申请重命名'}</button>
          <button type="button" class="btn compact" id="acaEditClass">${icon('edit')}${isDirect ? '编辑' : '申请编辑'}</button>
          <button type="button" class="btn danger compact" id="acaDissolveClass">${icon('x')}${isDirect ? '解散' : '申请解散'}</button>
        </span>`}</div>
      ${list.length ? `<div class="aca-stu-list">${list.map((s) => `
        <div class="aca-stu-row"><strong>${esc(s.name)}</strong><code>${s.id}</code>${isUn ? '' : `<span class="aca-stu-cls">${esc(s.className)}</span>`}</div>`).join('')}</div>`
        : `<div class="aca-stu-empty">${icon('users', 'icon large')}<strong>${isUn ? '全部学生已分配班级' : '班级暂无学生'}</strong><span>${isUn ? '' : isDirect ? '点击「编辑」勾选学生加入' : '点击「申请编辑」提交成员变更申请'}</span></div>`}`;
    box.querySelector('#acaEditClass')?.addEventListener('click', () => isDirect ? openEditClass(cls) : openApplyEditClass(cls));
    box.querySelector('#acaDissolveClass')?.addEventListener('click', () => isDirect ? openDissolveClass(cls, list.length) : openApplyDissolveClass(cls, list.length));
    box.querySelector('#acaRenameClass')?.addEventListener('click', () => isDirect ? openRenameClass(cls) : openApplyRenameClass(cls));
  };

  /* 班级重命名（IT 直改；2026-10-29 C1） */
  const openRenameClass = (cls) => {
    if (container.querySelector('.leave-wizard')) return;
    openMiniDialog({
      host: container,
      title: `重命名班级 · ${esc(cls?.name || '')}`,
      textHTML: '输入新班级名称（唯一；保存后立即生效，教务处将收到通知）。',
      rawBody: `<input class="aca-input" id="acaRenameName" maxlength="30" placeholder="新班级名称" value="${esc(cls?.name || '')}" autocomplete="off" />`,
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '保存', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const name = d.querySelector('#acaRenameName').value.trim();
        if (!name || name === cls?.name) { d.querySelector('#acaRenameName').style.borderColor = 'var(--danger)'; return; }
        try {
          await renameClass(folder, name);
          d.remove();
          toast(`已重命名：「${cls?.name}」→「${name}」`);
          reload();
        } catch (ex) { toast(ex.message); }
      },
    });
  };

  /* 申请重命名班级（class-rename，教务处→学生处审批；2026-10-29 C1） */
  const openApplyRenameClass = (cls) => {
    if (container.querySelector('.leave-wizard')) return;
    openMiniDialog({
      host: container,
      title: `申请重命名 · ${esc(cls?.name || '')}`,
      textHTML: '填写新班级名称，提交后由学生处审批；通过后生效。',
      rawBody: '<input class="aca-input" id="acaApplyRename" maxlength="30" placeholder="新班级名称" autocomplete="off" />',
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '提交申请', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const name = d.querySelector('#acaApplyRename').value.trim();
        if (!name || name === cls?.name) { d.querySelector('#acaApplyRename').style.borderColor = 'var(--danger)'; return; }
        try {
          await submitRequest('class-rename', { classId: folder, name });
          d.remove();
          toast(`已提交「重命名 ${cls?.name || ''} → ${name}」申请，等待学生处审批`);
          renderRequests(true);
        } catch (ex) { toast(ex.message); }
      },
    });
  };

  /* 新建班级（左栏底部虚线框按钮，2026-10-23 由右上角 section-tools 迁入并常驻） */
  const openNewClass = () => {
    if (container.querySelector('.leave-wizard')) return;
    openMiniDialog({
      host: container,
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
          folder = r.id;
          toast(`已创建班级「${name}」`);
          reload();
        } catch (ex) { toast(ex.message); }
      },
    });
  };

  /* ================= 教务处申请化弹窗（C1：写操作走申请，P4） ================= */

  /* 申请新建班级（class-create）：提交学生处审批 */
  const openApplyNewClass = () => {
    if (container.querySelector('.leave-wizard')) return;
    openMiniDialog({
      host: container,
      title: '申请新建班级',
      textHTML: '填写班级名称，提交后由学生处审批；通过后自动创建。',
      rawBody: '<input class="aca-input" id="acaApplyName" maxlength="30" placeholder="班级名称（如：计算机2302）" autocomplete="off" />',
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '提交申请', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const name = d.querySelector('#acaApplyName').value.trim();
        if (!name) { d.querySelector('#acaApplyName').style.borderColor = 'var(--danger)'; return; }
        try {
          await submitRequest('class-create', { name });
          d.remove();
          toast(`已提交「新建 ${name}」申请，等待学生处审批`);
          renderRequests(true);
        } catch (ex) { toast(ex.message); }
      },
    });
  };

  /* 申请编辑班级成员（class-edit）：三 Tab 勾选 → 提交申请（审批通过后生效） */
  const openApplyEditClass = (cls) => {
    if (container.querySelector('.leave-wizard')) return;
    const members = students.filter((s) => s.classId === folder);
    const unList = students.filter((s) => !s.classId);
    const dlg = openMiniDialog({
      host: container,
      title: `申请编辑 · ${esc(cls?.name || '')}`,
      textHTML: '勾选成员变更，提交后由学生处审批；通过后统一生效。',
      rawBody: `
        <div class="segmented aca-dlg-tabs" role="tablist" aria-label="班级成员变更">
          <button type="button" class="active" role="tab" aria-selected="true" data-t="add">${icon('plus')}添加学生</button>
          <button type="button" role="tab" aria-selected="false" data-t="remove">${icon('x')}移出学生</button>
        </div>
        <div class="aca-pane" data-p="add">
          <div class="wizard-label">未分配学生 <small>${unList.length} 人（勾选将加入）</small></div>
          <div class="aca-pick-list">${unList.length ? unList.map((s) => `
            <label class="aca-pick-row"><input type="checkbox" data-add="${s.id}" /><strong>${esc(s.name)}</strong><code>${s.id}</code></label>`).join('')
            : '<p class="aca-empty-hint">没有未分配的学生</p>'}</div>
        </div>
        <div class="aca-pane" data-p="remove" hidden>
          <div class="wizard-label">当前学生 <small>${members.length} 人（勾选将移出）</small></div>
          <div class="aca-pick-list">${members.length ? members.map((s) => `
            <label class="aca-pick-row out"><input type="checkbox" data-rm="${s.id}" /><strong>${esc(s.name)}</strong><code>${s.id}</code></label>`).join('')
            : '<p class="aca-empty-hint">班级暂无学生</p>'}</div>
        </div>`,
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '提交申请', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const removeIds = Array.from(d.querySelectorAll('input[data-rm]:checked')).map((i) => i.dataset.rm);
        const addIds = Array.from(d.querySelectorAll('input[data-add]:checked')).map((i) => i.dataset.add);
        if (!removeIds.length && !addIds.length) { toast('未勾选任何更改'); return; }
        try {
          await submitRequest('class-edit', { classId: folder, removeIds, addIds });
          d.remove();
          toast(`已提交「编辑 ${cls?.name || ''}」申请（移出 ${removeIds.length} 人、加入 ${addIds.length} 人），等待学生处审批`);
          renderRequests(true);
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

  /* 申请解散班级（class-dissolve）：必填原因 → 提交申请 */
  const openApplyDissolveClass = (cls, count) => {
    if (container.querySelector('.leave-wizard')) return;
    openMiniDialog({
      host: container,
      title: `申请解散 · ${esc(cls?.name || '')}`,
      textHTML: `提交后由学生处审批；通过后 <b>${count} 名学生</b>还原为未分配、教师授课关联同步清除。`,
      rawBody: '<textarea class="reason-input" id="acaApplyDissolve" maxlength="200" placeholder="解散原因（必填）：如班级合并、重新分班等"></textarea>',
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '提交申请', cls: 'danger' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const reason = d.querySelector('#acaApplyDissolve').value.trim();
        if (!reason) { d.querySelector('#acaApplyDissolve').style.borderColor = 'var(--danger)'; d.querySelector('#acaApplyDissolve').placeholder = '请填写解散原因（必填）'; return; }
        try {
          await submitRequest('class-dissolve', { classId: folder, reason });
          d.remove();
          toast(`已提交「解散 ${cls?.name || ''}」申请，等待学生处审批`);
          renderRequests(true);
        } catch (ex) { toast(ex.message); }
      },
    });
  };

  /* ================= 我的申请 Tab（P4） ================= */
  const TYPE_LABEL = { 'class-create': '新建班级', 'class-edit': '编辑成员', 'class-dissolve': '解散班级', 'class-rename': '重命名班级', 'add-lesson': '加课', 'teacher-leave': '教师请假', 'absence-cancel': '旷课撤销', 'record-modify': '课堂记录修改' };

  const renderRequests = async (silent) => {
    const box = container.querySelector('#acaRequests');
    if (!box) return;
    let list = [];
    try { list = await fetchRequests({ mine: 1 }); } catch (ex) { if (!silent) toast(ex.message); return; }
    box.innerHTML = list.length ? list.map((r) => `
      <div class="aca-req-row">
        <div class="aca-req-main">
          <div class="aca-req-title"><strong>${esc(TYPE_LABEL[r.type] || r.type)}</strong><span>${esc(r.title)}</span><em class="leave-pill ${r.status === 'pending' ? 'warn' : r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'bad' : 'mut'}">${REQ_STATUS[r.status] || r.status}</em></div>
          <div class="aca-req-meta">提交于 ${esc((r.createdAt || '').slice(0, 16).replace('T', ' '))}${r.reviewedAt ? ` · 审批于 ${esc(r.reviewedAt.slice(0, 16).replace('T', ' '))}` : ''}${r.rejectReason ? ` · 驳回原因：${esc(r.rejectReason)}` : ''}</div>
        </div>
        ${r.status === 'pending' ? `<button type="button" class="btn ghost compact" data-wd="${r.id}">${icon('x')}撤回</button>` : ''}
      </div>`).join('')
      : `<div class="aca-stu-empty">${icon('file', 'icon large')}<strong>暂无申请记录</strong><span>学生管理中的变更操作将在此跟踪审批进度</span></div>`;
    box.querySelectorAll('[data-wd]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await withdrawRequest(+b.dataset.wd);
        toast('已撤回申请');
        renderRequests(true);
      } catch (ex) { toast(ex.message); }
    }));
  };

  /* ================= 通知窗（学生处直改后实时提醒 + 离线补拉） ================= */
  const showNotice = async (payload) => {
    const title = payload?.title || '学生数据变更';
    openMiniDialog({
      host: container,
      title: '学生数据变更通知',
      textHTML: `${esc(title)}${payload?.detail ? `<br/><small>${esc(payload.detail)}</small>` : ''}<br/><small>列表即将自动刷新。</small>`,
      buttons: [{ act: 'ok', label: '知道了', cls: 'primary' }],
      onAction: (act, d) => { if (act === 'ok') d.remove(); },
    });
    reload();
  };
  sseOff = context.eventBus.on('sse:academicStudentsChanged', (p) => showNotice(p));

  /* 审批结果实时窗（§13：workflow:request-reviewed → 结果通知窗+我的申请刷新） */
  sseReviewedOff = context.eventBus.on('sse:workflowRequestReviewed', (r) => {
    const st = r?.status === 'approved' ? '已通过' : r?.status === 'rejected' ? `已驳回${r?.rejectReason ? `：${r.rejectReason}` : ''}` : r?.status || '';
    openMiniDialog({
      host: container,
      title: '审批结果通知',
      textHTML: `${esc(r?.title || '我的申请')}<br/><b>${st}</b>${r?.reviewedBy ? `<br/><small>审批人：${esc(r.reviewedBy)}</small>` : ''}`,
      buttons: [{ act: 'ok', label: '知道了', cls: 'primary' }],
      onAction: (act, d) => { if (act === 'ok') d.remove(); },
    });
    reload(); // 学生处同意建班/编辑后班级列表同步刷新
    renderRequests(true);
  });

  /* 离线补拉：未读 students-changed 通知（挂载时汇总提示） */
  (async () => {
    try {
      const unread = (await fetchNotifications({ unread: 1 })).filter((n) => n.kind === 'students-changed');
      if (unread.length) {
        await markNotificationsRead(unread.map((n) => n.id));
        showNotice(unread[0]);
      }
    } catch { /* 网络异常静默 */ }
  })();

  /* 编辑班级成员（弹窗三栏 segmented：添加学生/批量添加/移除学生，统一提交；IT 直改专用；2026-10-23 重构，吸收原「添加学生」弹窗双Tab功能） */
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
          const r = await updateClassMembers(folder, removeIds, addIds);
          d.remove();
          toast(`已保存：移出 ${r.removed} 人、加入 ${r.added} 人`);
          reload();
        } catch (ex) { toast(ex.message); }
      },
    });
    /* Tab 切换手动绑定（openMiniDialog 自定义控件，踩坑 #01；与登录页 login-tabs 同款 active + aria-selected） */
    dlg.querySelectorAll('.aca-dlg-tabs button').forEach((b) => b.addEventListener('click', () => {
      dlg.querySelectorAll('.aca-dlg-tabs button').forEach((x) => {
        const on = x === b;
        x.classList.toggle('active', on);
        x.setAttribute('aria-selected', String(on));
      });
      dlg.querySelectorAll('.aca-pane').forEach((p) => { p.hidden = p.dataset.p !== b.dataset.t; });
    }));
  };

  /* 解散班级（确认弹窗：必填解散原因；学生全部还原未分配）（2026-10-22 用户需求） */
  const openDissolveClass = (cls, count) => {
    if (container.querySelector('.leave-wizard')) return;
    openMiniDialog({
      host: container,
      title: `解散班级 · ${esc(cls?.name || '')}`,
      textHTML: `解散后该班级夹将删除，<b>${count} 名学生</b>还原为未分配，相关教师的授课关联同步清除。此操作不可恢复。`,
      rawBody: '<textarea class="reason-input" id="acaDissolveReason" maxlength="200" placeholder="解散原因（必填）：如班级合并、重新分班等"></textarea>',
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '确认解散', cls: 'danger' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const reason = d.querySelector('#acaDissolveReason').value.trim();
        if (!reason) { d.querySelector('#acaDissolveReason').style.borderColor = 'var(--danger)'; d.querySelector('#acaDissolveReason').placeholder = '请填写解散原因（必填）'; return; }
        try {
          const r = await dissolveClass(folder, reason);
          d.remove();
          folder = 'un';
          toast(`已解散班级「${cls?.name}」，${r.released} 名学生还原为未分配`);
          reload();
        } catch (ex) { toast(ex.message); }
      },
    });
  };

  /* ---------- 教师管理（P5 重构 §6.2：专业部夹 + 右栏三件套 + 导员绑定 D7） ---------- */

  /* 左栏：专业部夹（灰蓝容器内：专业部行 + 新建专业部虚线框）+ 容器下方独立「未分配教师」条目 */
  const renderMajorFolders = () => {
    const box = container.querySelector('#acaMajorFolders');
    if (!box) return;
    box.innerHTML = `
      ${majors.map((m) => `
      <button type="button" class="aca-folder${selectedMajor === m.id ? ' active' : ''}" data-mid="${m.id}">
        ${icon('book')}<span>${esc(m.name)}</span><em>${m.teachers.length}</em>
      </button>`).join('')}
      <button type="button" class="aca-folder-add" id="acaNewMajor">${icon('plus')}新建专业部</button>`;
    const unRow = container.querySelector('#acaUnTeachersRow');
    unRow?.classList.toggle('active', selectedMajor === 'un');
    const unCount = container.querySelector('#acaUnTeachersCount');
    if (unCount) unCount.textContent = unassignedTeachers.length;
    box.querySelectorAll('.aca-folder[data-mid]').forEach((b) => b.addEventListener('click', () => {
      selectedMajor = +b.dataset.mid;
      selectedClass = null;
      renderMajorFolders();
      renderMajorMain();
    }));
    box.querySelector('#acaNewMajor')?.addEventListener('click', openNewMajor);
  };
  container.querySelector('#acaUnTeachersRow')?.addEventListener('click', () => {
    if (selectedMajor !== 'un') { selectedMajor = 'un'; selectedClass = null; renderMajorFolders(); renderMajorMain(); }
  });
  /* 添加教师（2026-10-24 用户需求：教务管理→教师管理支持添加；姓名唯一，新教师自动入登录下拉/专业部分配/授课分配） */
  const openAddTeacher = () => {
    if (container.querySelector('.leave-wizard')) return;
    openMiniDialog({
      host: container,
      title: '添加教师',
      textHTML: '输入教师姓名（2–30 字，不可与管理账号重名）；创建后即可登录，并可在专业部与授课班级中分配。',
      rawBody: '<input class="aca-input" id="acaTeacherName" maxlength="30" placeholder="教师姓名（如：张伟 / 教师03）" autocomplete="off" />',
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '创建', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const name = d.querySelector('#acaTeacherName').value.trim();
        if (!name) { d.querySelector('#acaTeacherName').style.borderColor = 'var(--danger)'; return; }
        try {
          await addTeacher(name);
          d.remove();
          toast(`已添加教师「${name}」（登录页教职工下拉即时可见）`);
          reload();
        } catch (ex) { toast(ex.message); }
      },
    });
  };
  container.querySelector('#acaAddTeacher')?.addEventListener('click', openAddTeacher);

  /* 右栏：专业详情（头+班级 chips 课表+教师卡+导员区）/ 未分配教师列表 */
  const renderMajorMain = () => {
    const box = container.querySelector('#acaMajorMain');
    if (!box) return;
    if (ttHandle) { ttHandle.destroy(); ttHandle = null; }

    /* 未分配教师视图（无课表区、无编辑/解散钮） */
    if (selectedMajor === 'un') {
      box.innerHTML = `
        <div class="aca-stu-head">未分配教师<em>${unassignedTeachers.length} 人</em></div>
        ${unassignedTeachers.length ? `<div class="aca-stu-list">${unassignedTeachers.map((t) => `
          <div class="aca-stu-row"><strong>${esc(t)}</strong><code>教师账号</code><span class="aca-stu-cls">未加入任何专业部</span></div>`).join('')}</div>`
          : `<div class="aca-stu-empty">${icon('users', 'icon large')}<strong>全部教师已归属专业部</strong><span>在专业部内可多对多归属（一名教师可属多个部）</span></div>`}
        ${renderCounselorZone()}`;
      bindCounselorZone();
      return;
    }

    const major = majors.find((m) => m.id === selectedMajor);
    if (!major) {
      box.innerHTML = `<div class="aca-stu-empty">${icon('book', 'icon large')}<strong>选择左侧专业部查看详情</strong><span>或点击底部虚线框新建专业部</span></div>`;
      return;
    }

    const majorClasses = classes.filter((c) => major.classIds.includes(c.id));
    if (selectedClass == null && majorClasses.length) selectedClass = majorClasses[0].id;

    box.innerHTML = `
      <div class="aca-major-head">
        <div class="aca-stu-head">${esc(major.name)}<em>${major.teachers.length} 名教师</em></div>
        <span class="aca-stu-acts">
          <button type="button" class="btn compact" id="acaEditMajor">${icon('edit')}编辑</button>
          <button type="button" class="btn danger compact" id="acaDissolveMajor">${icon('x')}解散</button>
        </span>
      </div>
      <div class="aca-major-chips">
        <div class="wizard-label">班级课表（点击切换）：</div>
        <div class="chip-row">${majorClasses.length ? majorClasses.map((c) => `
          <button type="button" class="pick-chip${selectedClass === c.id ? ' on' : ''}" data-cid="${c.id}">${esc(c.name)}</button>`).join('')
          : '<span class="aca-empty-hint">该专业部暂无归属班级（学生处建班时可选归属）</span>'}</div>
        <div id="acaMajorTimetable"></div>
      </div>
      <div class="aca-major-teachers">
        <div class="wizard-label">部内教师（点击展开可编辑授课班级，C2 直改）：</div>
        ${major.teachers.length ? major.teachers.map((name) => {
          const t = teachers.find((x) => x.name === name);
          const open = expandedTeacher === name;
          const names = (t?.classIds || []).map((cid) => classes.find((c) => c.id === cid)?.name).filter(Boolean);
          return `
          <div class="aca-teacher${open ? ' open' : ''}" data-t="${esc(name)}">
            <button type="button" class="aca-teacher-head">
              ${icon('users')}<strong>${esc(name)}</strong>
              <span class="aca-teacher-cls">${names.length ? `授课：${esc(names.join('、'))}` : '未分配授课班级'}</span>
              <svg class="icon small" style="margin-left:auto"><use href="#i-chevron-down"/></svg>
            </button>
            ${open ? `
            <div class="aca-teacher-body">
              <div class="wizard-label">授课班级（可多选）：</div>
              <div class="chip-row">${classes.length ? classes.map((c) => `
                <button type="button" class="pick-chip${(t?.classIds || []).includes(c.id) ? ' on' : ''}" data-tcid="${c.id}">${esc(c.name)}</button>`).join('')
                : '<span class="aca-empty-hint">尚未创建班级</span>'}</div>
              <div class="aca-teacher-foot"><button type="button" class="btn primary compact" data-tsave="${esc(name)}">${icon('check')}保存</button></div>
            </div>` : ''}
          </div>`;
        }).join('') : '<p class="aca-empty-hint">暂无教师，点击「编辑」勾选加入</p>'}
      </div>
      ${renderCounselorZone()}`;

    box.querySelector('#acaEditMajor')?.addEventListener('click', () => openEditMajor(major));
    box.querySelector('#acaDissolveMajor')?.addEventListener('click', () => openDissolveMajor(major));
    box.querySelectorAll('.pick-chip[data-cid]').forEach((c) => c.addEventListener('click', () => {
      selectedClass = +c.dataset.cid;
      renderMajorMain();
    }));
    /* 教师卡展开编辑授课班级（C2 直改；复用原卡展开 chips 模式） */
    box.querySelectorAll('.aca-teacher-head').forEach((h) => h.addEventListener('click', () => {
      expandedTeacher = expandedTeacher === h.closest('.aca-teacher').dataset.t ? null : h.closest('.aca-teacher').dataset.t;
      renderMajorMain();
    }));
    box.querySelectorAll('.pick-chip[data-tcid]').forEach((c) => c.addEventListener('click', () => c.classList.toggle('on')));
    box.querySelectorAll('[data-tsave]').forEach((b) => b.addEventListener('click', async () => {
      const card = b.closest('.aca-teacher');
      const classIds = Array.from(card.querySelectorAll('.pick-chip.on')).map((c) => +c.dataset.tcid);
      try {
        await setTeacherClasses(b.dataset.tsave, classIds);
        toast(`已保存 ${b.dataset.tsave} 的授课班级（教师请假可见范围即时生效）`);
        expandedTeacher = null;
        reload();
      } catch (ex) { toast(ex.message); }
    }));
    bindCounselorZone();

    /* 课表挂载（只读；所选班级） */
    const ttBox = box.querySelector('#acaMajorTimetable');
    if (ttBox && selectedClass != null) {
      ttHandle = renderTimetable(ttBox, [], {});
      fetchClassTimetable(selectedClass).then((ls) => ttHandle && ttHandle.refresh(ls)).catch(() => {});
    }
  };

  /* 导员绑定区（D7：导员班级 chips 多选 + 保存，整体替换） */
  const renderCounselorZone = () => {
    const c = counselors.find((x) => x.name === '导员');
    const bound = new Set(c?.classIds || []);
    return `
    <div class="aca-counselor-zone">
      <div class="wizard-label">导员绑定（审批与课堂状态按绑定班级收窄 D8）：</div>
      <div class="chip-row">${classes.length ? classes.map((cl) => `
        <button type="button" class="pick-chip${bound.has(cl.id) ? ' on' : ''}" data-ccid="${cl.id}">${esc(cl.name)}</button>`).join('')
        : '<span class="aca-empty-hint">尚未创建班级</span>'}</div>
      <div class="aca-teacher-foot"><button type="button" class="btn primary compact" id="acaSaveCounselor">${icon('check')}保存绑定</button></div>
    </div>`;
  };
  const bindCounselorZone = () => {
    const zone = container.querySelector('.aca-counselor-zone');
    if (!zone) return;
    zone.querySelectorAll('.pick-chip[data-ccid]').forEach((c) => c.addEventListener('click', () => c.classList.toggle('on')));
    zone.querySelector('#acaSaveCounselor')?.addEventListener('click', async () => {
      const classIds = Array.from(zone.querySelectorAll('.pick-chip.on')).map((c) => +c.dataset.ccid);
      try {
        await setCounselorClasses('导员', classIds);
        toast(`已保存导员绑定：${classIds.length} 个班级（导员审批范围即时生效）`);
        reload();
      } catch (ex) { toast(ex.message); }
    });
  };

  /* 新建专业部（虚线框按钮） */
  const openNewMajor = () => {
    if (container.querySelector('.leave-wizard')) return;
    openMiniDialog({
      host: container,
      title: '新建专业部',
      textHTML: '输入专业部名称，创建后可通过「编辑」勾选教师归属（一名教师可属多个部）。',
      rawBody: '<input class="aca-input" id="acaMajorName" maxlength="30" placeholder="专业部名称（如：计算机系）" autocomplete="off" />',
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '创建', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const name = d.querySelector('#acaMajorName').value.trim();
        if (!name) { d.querySelector('#acaMajorName').style.borderColor = 'var(--danger)'; return; }
        try {
          const r = await createMajor(name);
          d.remove();
          selectedMajor = r.id;
          toast(`已创建专业部「${name}」`);
          reload();
        } catch (ex) { toast(ex.message); }
      },
    });
  };

  /* 编辑专业部教师（两栏 segmented：添加教师/移除教师，统一提交 members 端点） */
  const openEditMajor = (major) => {
    if (container.querySelector('.leave-wizard')) return;
    const inMajor = major.teachers;
    const outList = ['教师01', '教师02'].filter((t) => !inMajor.includes(t));
    const dlg = openMiniDialog({
      host: container,
      title: `编辑专业部 · ${esc(major.name)}`,
      textHTML: '勾选教师加入或移出，保存统一生效（多对多：教师可同时归属多个专业部）。',
      rawBody: `
        <div class="segmented aca-dlg-tabs" role="tablist" aria-label="专业部教师管理">
          <button type="button" class="active" role="tab" aria-selected="true" data-t="add">${icon('plus')}添加教师</button>
          <button type="button" role="tab" aria-selected="false" data-t="remove">${icon('x')}移出教师</button>
        </div>
        <div class="aca-pane" data-p="add">
          <div class="wizard-label">未入本部教师 <small>${outList.length} 人（勾选将加入）</small></div>
          <div class="aca-pick-list">${outList.length ? outList.map((t) => `
            <label class="aca-pick-row"><input type="checkbox" data-add="${esc(t)}" /><strong>${esc(t)}</strong><code>教师账号</code></label>`).join('')
            : '<p class="aca-empty-hint">全部教师均已在本部</p>'}</div>
        </div>
        <div class="aca-pane" data-p="remove" hidden>
          <div class="wizard-label">本部教师 <small>${inMajor.length} 人（勾选将移出）</small></div>
          <div class="aca-pick-list">${inMajor.length ? inMajor.map((t) => `
            <label class="aca-pick-row out"><input type="checkbox" data-rm="${esc(t)}" /><strong>${esc(t)}</strong><code>教师账号</code></label>`).join('')
            : '<p class="aca-empty-hint">本部暂无教师</p>'}</div>
        </div>`,
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '保存', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const removeNames = Array.from(d.querySelectorAll('input[data-rm]:checked')).map((i) => i.dataset.rm);
        const addNames = Array.from(d.querySelectorAll('input[data-add]:checked')).map((i) => i.dataset.add);
        if (!removeNames.length && !addNames.length) { toast('未勾选任何更改'); return; }
        try {
          const r = await updateMajorMembers(major.id, removeNames, addNames);
          d.remove();
          toast(`已保存：移出 ${r.removed} 人、加入 ${r.added} 人`);
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

  /* 解散专业部（必填原因；班级归属置 NULL） */
  const openDissolveMajor = (major) => {
    if (container.querySelector('.leave-wizard')) return;
    openMiniDialog({
      host: container,
      title: `解散专业部 · ${esc(major.name)}`,
      textHTML: `解散后 <b>${major.classIds.length} 个归属班级</b>将置为未归属、${major.teachers.length} 名教师的部内关联清除。此操作不可恢复。`,
      rawBody: '<textarea class="reason-input" id="acaMajorDissolveReason" maxlength="200" placeholder="解散原因（必填）：如专业合并、撤系等"></textarea>',
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '确认解散', cls: 'danger' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const reason = d.querySelector('#acaMajorDissolveReason').value.trim();
        if (!reason) { d.querySelector('#acaMajorDissolveReason').style.borderColor = 'var(--danger)'; d.querySelector('#acaMajorDissolveReason').placeholder = '请填写解散原因（必填）'; return; }
        try {
          const r = await dissolveMajor(major.id, reason);
          d.remove();
          selectedMajor = null;
          toast(`已解散专业部「${major.name}」，${r.releasedClasses} 个班级置为未归属`);
          reload();
        } catch (ex) { toast(ex.message); }
      },
    });
  };

  reload();
}

export async function unmount(container) {
  if (ttHandle) { ttHandle.destroy(); ttHandle = null; }
  if (sseOff) { sseOff(); sseOff = null; }
  if (sseReviewedOff) { sseReviewedOff(); sseReviewedOff = null; }
  container.innerHTML = '';
  container.classList.remove('mod-academic');
}
