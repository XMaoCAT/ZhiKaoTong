// 请假向导共享件（PC 与移动端共用；归属宿主共享层，样式为全局 .leave-wizard 系列）
// 依赖：core/js/wheel-picker.js（全局滚轮选择器）、shared/api-leaves.js
import { submitLeave, leaveAction } from './api-leaves.js';
import { createDateTimePicker } from '../core/js/wheel-picker.js';
import { fetchAffectedLessons } from './api-workflow.js';
import { currentName } from './roles.js';
import { changePassword } from './api-auth.js';

// ⚠ 与 src/api/leaves.js TYPES 同步（踩坑 #05：字典双处漂移；历史行 type='其他' 原样展示不映射）
export const TYPES = ['病假', '事假', '公假'];

export const STATUS = {
  pending: { label: '待审批', cls: 'warn' },
  editing: { label: '编辑中', cls: 'info' },
  approved: { label: '已同意', cls: 'ok' },
  completed: { label: '已销假', cls: 'done' },
  rejected: { label: '已拒绝', cls: 'bad' },
  revoked: { label: '已撤销', cls: 'mut' },
};

export const esc = (s) => String(s || '').replace(/</g, '&lt;');
export const statusPill = (s) => { const v = STATUS[s] || { label: s, cls: 'mut' }; return `<span class="leave-pill ${v.cls}">${v.label}</span>`; };
export const fmtRange = (l) => `${l.dateFrom || '?'} ${l.timeFrom || ''} ~ ${l.dateTo || '?'} ${l.timeTo || ''}`;
export const icon = (name, cls = 'icon small') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></svg></svg>`;

/* 教师视角三态（2026-10-22 用户口径，双端共用，严禁模块内复制副本）：
   申请中未获批=待审批+编辑中；休假中=已同意；被驳回=已拒绝；已销假/已撤销不计入今日统计、仅在历史细则按原状态展示 */
export const TEACHER_STATUS = {
  pending: { label: '申请中未获批', cls: 'warn' },
  editing: { label: '申请中未获批', cls: 'warn' },
  approved: { label: '休假中', cls: 'ok' },
  rejected: { label: '被驳回', cls: 'bad' },
};
export const ACTIVE_TODAY = ['pending', 'editing', 'approved', 'rejected'];
export const teacherPill = (s) => { const v = TEACHER_STATUS[s] || { label: s, cls: 'mut' }; return `<span class="leave-pill ${v.cls}">${v.label}</span>`; };
export const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const coversToday = (l, today) => l.dateFrom <= today && l.dateTo >= today;

/* 近期判定（2026-10-22 用户口径：近 3 天含今天，全部状态均算）：请假时段与 [今天-(days-1), 今天] 窗口有交集 */
const addDays = (dateStr, n) => { const d = new Date(`${dateStr}T00:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const withinRecentDays = (l, days = 3) => { const t = todayStr(); return l.dateFrom <= t && l.dateTo >= addDays(t, -(days - 1)); };

/** 图片压缩为 dataURL（最长边 900px，jpeg 0.72） */
export function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 900 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
    img.src = url;
  });
}

/** 手写签名板（canvas + pointer 事件） */
export function createSignaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  let strokes = 0;
  let drawing = false;
  const setup = () => {
    const w = canvas.parentElement.clientWidth || 400;
    canvas.width = w * 2;
    canvas.height = 260;
    canvas.style.width = '100%';
    canvas.style.height = '130px';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#16233F';
  };
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    drawing = true;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });
  const stop = () => { if (drawing) { drawing = false; strokes += 1; canvas.dispatchEvent(new CustomEvent('pad:ink')); } };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  setup();
  return {
    hasInk: () => strokes > 0,
    clear: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); strokes = 0; },
    toDataURL: () => canvas.toDataURL('image/png'),
    load: (dataURL) => {
      setup();
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); strokes = 1; };
      img.src = dataURL;
    },
  };
}

/** 通用迷你对话框
 *  opts: { host, inHost, title, textHTML?, rawBody?(自定义主体 HTML), textarea?, buttons, onAction }
 *  onAction(act, dlg)：可通过 dlg.querySelector 读取 rawBody 内控件状态 */
export function openMiniDialog({ host = document.body, inHost = false, title, textHTML = '', rawBody = '', textarea = null, buttons = [], onAction = () => {} }) {
  const dlg = document.createElement('div');
  dlg.className = `leave-wizard mini-dialog${inHost ? ' in-host' : ''}`;
  dlg.innerHTML = `
    <div class="wizard-panel mini">
      <div class="wizard-title">${title}</div>
      ${textHTML ? `<p class="wizard-text">${textHTML}</p>` : ''}
      ${rawBody}
      ${textarea != null ? `<textarea class="reason-input" id="miniReason" maxlength="${textarea.max || 300}" placeholder="${textarea.placeholder || ''}">${textarea.value || ''}</textarea>` : ''}
      <div class="wizard-foot center">${buttons.map((b) => `<button type="button" class="btn ${b.cls || 'ghost'}" data-act="${b.act}">${b.icon ? icon(b.icon) : ''}${b.label}</button>`).join('')}</div>
    </div>`;
  host.appendChild(dlg);
  dlg.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    await onAction(btn.dataset.act, dlg);
  });
  return dlg;
}

/** 修改密码弹窗（2026-10-29 密码体系：PC 个人中心浮层与移动端「我的」页共用；当前登录账号自助修改） */
export function openChangePasswordDialog({ host = document.body, inHost = false, eventBus, onDone }) {
  const dlg = openMiniDialog({
    host, inHost,
    title: '修改密码',
    textHTML: `当前账号 <b>${esc(currentName() || '')}</b>，修改成功后下次登录使用新密码。`,
    rawBody: `
      <div class="pwd-pane">
        <label class="wizard-label" for="pwdOldInput">原密码</label>
        <input class="aca-input" id="pwdOldInput" type="password" maxlength="32" autocomplete="current-password" />
        <label class="wizard-label" for="pwdNewInput">新密码（6–32 位）</label>
        <input class="aca-input" id="pwdNewInput" type="password" maxlength="32" autocomplete="new-password" />
        <label class="wizard-label" for="pwdNew2Input">确认新密码</label>
        <input class="aca-input" id="pwdNew2Input" type="password" maxlength="32" autocomplete="new-password" />
      </div>`,
    buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '确认修改', cls: 'primary' }],
    onAction: async (act, d) => {
      if (act === 'cancel') return d.remove();
      const oldV = d.querySelector('#pwdOldInput').value;
      const newV = d.querySelector('#pwdNewInput').value;
      const new2V = d.querySelector('#pwdNew2Input').value;
      const fail = (msg) => { d.querySelector('.wizard-text').innerHTML = `<b style="color:var(--danger)">${esc(msg)}</b>`; };
      if (!oldV) return fail('请输入原密码');
      if (newV.length < 6 || newV.length > 32) return fail('新密码需 6–32 位');
      if (newV !== new2V) return fail('两次输入的新密码不一致');
      try {
        await changePassword(oldV, newV);
        d.remove();
        eventBus?.emit('ui:toast', { message: '密码已修改，下次登录请使用新密码' });
        onDone?.();
      } catch (ex) {
        fail(ex.message || '修改失败，请稍后重试');
      }
    },
  });
  return dlg;
}

/** 撤销请假弹窗（必填理由，明示同步导员） */
export function openRevokeDialog({ host = document.body, inHost = false, leave, eventBus, onDone }) {
  const dlg = openMiniDialog({
    host, inHost,
    title: `撤销请假 #${String(leave.id).padStart(3, '0')}`,
    textHTML: '请填写撤销理由。<b>填写的撤销理由将同步给导员。</b>',
    textarea: { placeholder: '撤销理由（必填）' },
    buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '确认撤销', cls: 'danger' }],
    onAction: async (act, d) => {
      if (act === 'cancel') return d.remove();
      const reason = d.querySelector('#miniReason').value.trim();
      if (!reason) { d.querySelector('.wizard-text').innerHTML = '<b style="color:var(--danger)">请填写撤销理由</b>（将同步给导员）'; return; }
      try {
        await leaveAction(leave.id, 'revoke', { reason });
        d.remove();
        eventBus.emit('ui:toast', { message: '已撤销请假，理由已同步给导员' });
        onDone?.();
      } catch (ex) { eventBus.emit('ui:toast', { message: ex.message }); }
    },
  });
  return dlg;
}

/** 导员拒绝回复弹窗：辅导员回复 + 我知道了 / 修改并重新提交 */
export function openReplyPop({ host = document.body, inHost = false, leave, eventBus, onFix }) {
  const pop = document.createElement('div');
  pop.className = `leave-wizard reply-pop${inHost ? ' in-host' : ''}`;
  pop.innerHTML = `
    <div class="wizard-panel mini">
      <div class="wizard-title">导员回复</div>
      <p class="wizard-text big">辅导员回复：${esc(leave.rejectReason)}</p>
      <div class="wizard-foot center">
        <button type="button" class="btn ghost" data-act="know">我知道了</button>
        <button type="button" class="btn primary" data-act="fix">修改并重新提交</button>
      </div>
    </div>`;
  host.appendChild(pop);
  pop.addEventListener('click', async (ev) => {
    const act = ev.target.closest('button')?.dataset.act;
    if (!act) return;
    pop.remove();
    if (act === 'fix') onFix?.(leave);
  });
  return pop;
}

/**
 * 请假向导（两步）：① 免责声明 + 签名板 → ② 类型 + 起止时间（滚轮选择器）+ 事由 + 图片佐证 → 提交
 * opts: { host(挂载容器，默认 body), inHost(内嵌模式：遮罩 absolute 定位于 host 内，移动端用),
 *         mode: 'new'|'edit', leave, eventBus, onDone({toast}) }
 * 编辑模式：跳过签名步骤、预填数据、按钮"重新提交申请"；中途关闭弹"是否保存当前编辑"（保存=挂起/不保存=恢复原申请）。
 */
export function openLeaveWizard(opts) {
  const { host = document.body, inHost = false, mode = 'new', leave = null, eventBus, onDone = () => {} } = opts;
  const editing = mode === 'edit';
  const sel = {
    type: leave?.type || '',
    from: leave?.dateFrom && leave?.timeFrom ? `${leave.dateFrom} ${leave.timeFrom}` : '',
    to: leave?.dateTo && leave?.timeTo ? `${leave.dateTo} ${leave.timeTo}` : '',
    reason: leave?.reason || '',
    images: [...(leave?.images || [])],
    signature: leave?.signature || null,
  };
  let step = editing ? 2 : 1;

  const overlay = document.createElement('div');
  overlay.className = `leave-wizard${inHost ? ' in-host' : ''}`;
  overlay.innerHTML = `
    <div class="wizard-panel normal-mapped-surface" data-light-surface>
      <div class="wizard-head">
        <div>
          <div class="wizard-title">${editing ? '编辑请假申请' : '发起请假申请'}</div>
          <div class="wizard-steps"><span class="ws ${step >= 1 ? 'on' : ''}" data-ws="1">① 免责声明与签名</span><span class="ws ${step >= 2 ? 'on' : ''}" data-ws="2">② 请假信息</span></div>
        </div>
        <button type="button" class="wizard-close" id="wzClose" aria-label="关闭">${icon('x')}</button>
      </div>
      <div class="wizard-body">
        <div class="wizard-step" data-step="1">
          <div class="wizard-block">
            <div class="wizard-label">免责声明</div>
            <div class="disclaimer">免责声明内容</div>
          </div>
          <div class="wizard-block">
            <div class="wizard-label">签名区 <small>（点击下方区域进行签名）</small></div>
            <div class="sign-area"><canvas id="signCanvas"></canvas></div>
            <div class="sign-tools">
              <button type="button" class="btn ghost compact" id="signClear">${icon('x')}清除签名</button>
              <span class="sign-hint">签名后才能进入下一步</span>
            </div>
          </div>
        </div>
        <div class="wizard-step" data-step="2" ${step === 2 ? '' : 'hidden'}>
          <div class="wizard-block">
            <div class="wizard-label">请假类型</div>
            <div class="chip-row" data-chips="type">${TYPES.map((t) => `<button type="button" class="pick-chip ${sel.type === t ? 'on' : ''}" data-v="${t}">${t}</button>`).join('')}</div>
          </div>
          <div class="wizard-block">
            <div class="wizard-label">开始时间</div>
            <div class="wp-slot" id="wpStart"></div>
          </div>
          <div class="wizard-block">
            <div class="wizard-label">结束时间</div>
            <div class="wp-slot" id="wpEnd"></div>
          </div>
          <div class="wizard-block" id="wzAffectedBlock" hidden>
            <div class="wizard-label">将耽误的课程 <small id="wzAffectedCount"></small></div>
            <div class="wz-affected" id="wzAffected"></div>
          </div>
          <div class="wizard-block">
            <div class="wizard-label">请假事由</div>
            <textarea class="reason-input" id="wzReason" maxlength="500" placeholder="请填写请假事由（500 字内）">${esc(sel.reason)}</textarea>
          </div>
          <div class="wizard-block">
            <div class="wizard-label">图片佐证 <small>（可选，最多 6 张）</small></div>
            <div class="img-list" id="wzImages">${sel.images.map((src, i) => `<span class="img-item"><img src="${src}" alt="佐证${i + 1}" /><button type="button" class="img-del" data-i="${i}" aria-label="删除图片">${icon('x')}</button></span>`).join('')}</div>
            <label class="img-add">${icon('image')}添加图片<input type="file" id="wzFile" accept="image/*" multiple hidden /></label>
          </div>
        </div>
      </div>
      <div class="wizard-foot">
        <button type="button" class="btn ghost" id="wzBack" ${step === 2 ? '' : 'hidden'}>${icon('chevron-left')}上一步</button>
        <span class="wizard-err" id="wzErr" hidden></span>
        <button type="button" class="btn primary" id="wzNext" ${step === 1 ? '' : 'hidden'} disabled>下一步${icon('chevron-right')}</button>
        <button type="button" class="btn primary" id="wzSubmit" ${step === 2 ? '' : 'hidden'}>${icon('send')}${editing ? '重新提交申请' : '提交申请'}</button>
      </div>
    </div>`;
  host.appendChild(overlay);

  const $ = (q) => overlay.querySelector(q);
  const err = (msg) => { const e = $('#wzErr'); e.textContent = msg || ''; e.hidden = !msg; };

  /* 签名板 */
  const pad = createSignaturePad($('#signCanvas'));
  if (editing && sel.signature) pad.load(sel.signature);
  const syncNext = () => {
    const hasSign = pad.hasInk() || (editing && sel.signature);
    overlay.querySelector('.sign-area').classList.toggle('has-ink', hasSign);
    $('#wzNext').disabled = !hasSign;
  };
  syncNext();
  $('#signCanvas').addEventListener('pad:ink', syncNext);
  $('#signClear').addEventListener('click', () => { pad.clear(); sel.signature = null; syncNext(); });

  /* 步骤切换 */
  const showStep = (n) => {
    step = n;
    overlay.querySelectorAll('.wizard-step').forEach((el) => { el.hidden = +el.dataset.step !== n; });
    overlay.querySelectorAll('.ws').forEach((el) => { el.classList.toggle('on', +el.dataset.ws <= n); });
    $('#wzBack').hidden = n !== 2 || editing;
    $('#wzNext').hidden = n !== 1;
    $('#wzSubmit').hidden = n !== 2;
    err('');
  };
  $('#wzNext').addEventListener('click', () => {
    if (pad.hasInk()) sel.signature = pad.toDataURL();
    showStep(2);
  });
  $('#wzBack').addEventListener('click', () => showStep(1));

  /* 类型选择卡 */
  overlay.querySelector('[data-chips="type"]').addEventListener('click', (ev) => {
    const chip = ev.target.closest('.pick-chip');
    if (!chip) return;
    sel.type = chip.dataset.v;
    chip.parentElement.querySelectorAll('.pick-chip').forEach((c) => { c.classList.toggle('on', c === chip); });
    err('');
  });

  /* 起止时间滚轮选择器（D8：起止确定后实时计算将耽误的课程清单——纯展示不影响提交） */
  const startPicker = createDateTimePicker({
    value: sel.from,
    placeholder: '请选择开始日期时间',
    onConfirm: ({ text }) => { sel.from = text; err(''); refreshAffected(); },
  });
  $('#wpStart').appendChild(startPicker.el);
  const endPicker = createDateTimePicker({
    value: sel.to,
    placeholder: '请选择结束日期时间',
    onConfirm: ({ text }) => { sel.to = text; err(''); refreshAffected(); },
  });
  $('#wpEnd').appendChild(endPicker.el);

  /* 耽误课清单（D8 新需求：后端 affectedLessons 单源计算，前端仅渲染；0 节显示无课程） */
  let affectedTimer = null;
  function refreshAffected() {
    const block = $('#wzAffectedBlock');
    if (!block) return;
    if (!sel.from || !sel.to) { block.hidden = true; return; }
    const [dateFrom, timeFrom] = [sel.from.slice(0, 10), sel.from.slice(11, 16)];
    const [dateTo, timeTo] = [sel.to.slice(0, 10), sel.to.slice(11, 16)];
    if (dateFrom > dateTo || (dateFrom === dateTo && timeFrom >= timeTo)) { block.hidden = true; return; }
    clearTimeout(affectedTimer);
    affectedTimer = setTimeout(async () => {
      try {
        const lessons = await fetchAffectedLessons({ studentId: currentStudentId(), dateFrom, timeFrom, dateTo, timeTo });
        block.hidden = false;
        $('#wzAffectedCount').textContent = lessons.length ? `共 ${lessons.length} 节` : '';
        const weekdayLabel = (d) => `周${'日一二三四五六'[new Date(`${d}T00:00:00`).getDay()]}`;
        $('#wzAffected').innerHTML = lessons.length
          ? lessons.map((l) => `<div class="wz-affected-row"><strong>${esc(l.courseName)}</strong><span>${esc(l.teacherName)}</span><code>${l.date}（${weekdayLabel(l.date)}）${l.start}-${l.end}</code>${l.source === 'add' ? '<em>单次课</em>' : ''}</div>`).join('')
          : '<div class="wz-affected-none">该时段无课程安排</div>';
      } catch { block.hidden = true; /* 网络异常不阻断向导 */ }
    }, 250);
  }
  /* 学生学号（向导为学生专用；roles.js currentName 感知 dev 端点键，严禁直读 localStorage） */
  const currentStudentId = () => currentName() || '';
  if (step === 2 && sel.from && sel.to) refreshAffected(); // 编辑模式进入 Step2 时预计算

  /* 事由 & 图片 */
  $('#wzReason').addEventListener('input', (e) => { sel.reason = e.target.value; });
  const renderImages = () => {
    $('#wzImages').innerHTML = sel.images.map((src, i) => `<span class="img-item"><img src="${src}" alt="佐证${i + 1}" /><button type="button" class="img-del" data-i="${i}" aria-label="删除图片">${icon('x')}</button></span>`).join('');
  };
  overlay.addEventListener('click', (ev) => {
    const del = ev.target.closest('.img-del');
    if (del) { sel.images.splice(+del.dataset.i, 1); renderImages(); }
  });
  $('#wzFile').addEventListener('change', async (e) => {
    const files = [...e.target.files].slice(0, 6 - sel.images.length);
    e.target.value = '';
    for (const f of files) {
      try { sel.images.push(await compressImage(f)); } catch { /* 跳过读取失败文件 */ }
    }
    renderImages();
  });

  /* 表单收集与校验 */
  const collect = () => ({
    type: sel.type,
    dateFrom: sel.from ? sel.from.slice(0, 10) : '',
    timeFrom: sel.from ? sel.from.slice(11, 16) : '',
    dateTo: sel.to ? sel.to.slice(0, 10) : '',
    timeTo: sel.to ? sel.to.slice(11, 16) : '',
    reason: sel.reason,
    images: sel.images,
    signature: pad.hasInk() ? pad.toDataURL() : sel.signature,
  });
  const validate = (f) => {
    if (!f.type) return '请选择请假类型';
    if (!f.dateFrom || !f.timeFrom) return '请选择开始日期与时间';
    if (!f.dateTo || !f.timeTo) return '请选择结束日期与时间';
    if (f.dateFrom > f.dateTo || (f.dateFrom === f.dateTo && f.timeFrom >= f.timeTo)) return '结束时间必须晚于开始时间';
    if (!f.reason.trim()) return '请填写请假事由';
    if (!f.signature) return '缺少签名，请返回第一步完成签名';
    return '';
  };

  /* 提交 */
  $('#wzSubmit').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const f = collect();
    const msg = validate(f);
    if (msg) return err(msg);
    btn.disabled = true;
    try {
      if (editing) await leaveAction(leave.id, 'submit', f);
      else await submitLeave(f);
      eventBus.emit('leave:submitted', {});
      overlay.remove();
      onDone({ toast: editing ? '已重新提交，等待导员审批' : '申请已提交，等待导员审批' });
    } catch (ex) {
      err(ex.message);
      btn.disabled = false;
    }
  });

  /* 关闭（编辑中退出提示是否保存） */
  $('#wzClose').addEventListener('click', () => {
    if (step === 1 && !editing) { overlay.remove(); return onDone({}); }
    openMiniDialog({
      host: overlay, inHost: true,
      title: '是否保存当前编辑？',
      textHTML: `选择「保存」后该申请将挂起，可随时「继续编辑」；选择「不保存」将放弃本次修改${editing ? '，恢复原申请' : '。'}`,
      buttons: [
        { act: 'stay', label: '继续编辑' },
        { act: 'drop', label: '不保存' },
        { act: 'save', label: '保存', cls: 'primary' },
      ],
      onAction: async (act, d) => {
        if (act === 'stay') return d.remove();
        try {
          if (act === 'save') {
            const f = collect();
            if (editing) await leaveAction(leave.id, 'save', f);
            else await submitLeave({ ...f, draft: true });
            overlay.remove();
            onDone({ toast: '已保存为挂起的申请，可随时继续编辑' });
          } else {
            if (editing) await leaveAction(leave.id, 'cancel-edit');
            overlay.remove();
            onDone({});
          }
        } catch (ex) {
          d.remove();
          err(ex.message);
        }
      },
    });
  });
}

/* ---------------- 销假（学生按导员要求提交照片/签名） ---------------- */

/** 学生销假弹窗：按 leave.returnRequired 动态渲染照片上传与签名板，逐项校验后提交
 *  opts: { host, inHost, leave, eventBus, onDone } */
export function openReturnDialog({ host = document.body, inHost = false, leave, eventBus, onDone }) {
  const req = leave?.returnRequired || {};
  if (!req.photo && !req.sign) return; // 无销假要求不弹
  const overlay = document.createElement('div');
  overlay.className = `leave-wizard${inHost ? ' in-host' : ''}`;
  overlay.innerHTML = `
    <div class="wizard-panel mini return-dialog">
      <div class="wizard-title">销假 #${String(leave.id).padStart(3, '0')}</div>
      <p class="wizard-text">导员要求销假凭证：<b>${[req.photo ? '拍照' : '', req.sign ? '签名' : ''].filter(Boolean).join(' + ')}</b></p>
      ${leave.returnNote ? `<p class="wizard-text big">导员备注：${esc(leave.returnNote)}</p>` : ''}
      ${req.photo ? `
      <div class="wizard-block">
        <div class="wizard-label">销假照片 <small>（必填）</small></div>
        <div class="img-list" id="rtImgs"></div>
        <label class="img-add">${icon('image')}拍照 / 选择图片<input type="file" id="rtFile" accept="image/*" capture="environment" hidden /></label>
      </div>` : ''}
      ${req.sign ? `
      <div class="wizard-block">
        <div class="wizard-label">销假签名 <small>（必填，点击下方区域签名）</small></div>
        <div class="sign-area"><canvas id="rtCanvas"></canvas></div>
        <div class="sign-tools"><button type="button" class="btn ghost compact" id="rtClear">${icon('x')}清除签名</button></div>
      </div>` : ''}
      <span class="wizard-err" id="rtErr" hidden></span>
      <div class="wizard-foot center">
        <button type="button" class="btn ghost" data-act="cancel">取消</button>
        <button type="button" class="btn primary" data-act="ok">${icon('check')}提交销假</button>
      </div>
    </div>`;
  host.appendChild(overlay);

  const err = (msg) => { const e = overlay.querySelector('#rtErr'); e.textContent = msg || ''; e.hidden = !msg; };

  /* 照片（压缩 900px jpeg，仅 1 张） */
  let photo = '';
  const renderImgs = () => {
    const box = overlay.querySelector('#rtImgs');
    if (box) box.innerHTML = photo ? `<span class="img-item"><img src="${photo}" alt="销假照片" /><button type="button" class="img-del" aria-label="删除照片">${icon('x')}</button></span>` : '';
  };
  overlay.addEventListener('click', (ev) => {
    if (ev.target.closest('.img-del')) { photo = ''; renderImgs(); }
  });
  overlay.querySelector('#rtFile')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try { photo = await compressImage(file); renderImgs(); err(''); } catch { err('图片读取失败，请重试'); }
  });

  /* 签名板 */
  let pad = null;
  const canvas = overlay.querySelector('#rtCanvas');
  if (canvas) {
    pad = createSignaturePad(canvas);
    canvas.addEventListener('pad:ink', () => { canvas.closest('.sign-area')?.classList.add('has-ink'); err(''); });
    overlay.querySelector('#rtClear')?.addEventListener('click', () => { pad.clear(); canvas.closest('.sign-area')?.classList.remove('has-ink'); });
  }

  overlay.addEventListener('click', async (ev) => {
    const act = ev.target.closest('button[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'cancel') return overlay.remove();
    if (req.photo && !photo) return err('请提交销假照片');
    if (req.sign && !(pad && pad.hasInk())) return err('请完成销假签名');
    try {
      await leaveAction(leave.id, 'return', { returnPhoto: photo, returnSignature: pad ? pad.toDataURL() : '' });
      overlay.remove();
      eventBus.emit('leave:returned', { leaveId: leave.id });
      eventBus.emit('ui:toast', { message: '销假完成' });
      onDone?.();
    } catch (ex) { err(ex.message); }
  });
}
