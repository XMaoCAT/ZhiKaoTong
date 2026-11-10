// mod-login：登录页（Tab 切换：学生=学号+密码 / 教职工=账号下拉+密码【动态：教师账号从后端拉取】）
// 2026-10-29 密码体系上线：登录走 POST /api/auth/login 服务端校验（群组由服务端返回），默认密码 123456
// 2026-11-03 图形验证码上线：每次登录必填（点击图片刷新；登录失败后自动换新——旧 token 已被服务端一次性消费）
// 隔离铁律：不 import 其他任何 mod-*；对外仅通过 eventBus 通信
import { STAFF_ACCOUNTS, validStudentId, ROLE_HOME, routeMode } from '../../shared/roles.js';
import { fetchStaffAccounts } from '../../shared/api-admin.js';
import { loginAccount, fetchCaptcha } from '../../shared/api-auth.js';

const icon = (name, cls = 'icon small') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

function showLoginError(msg) {
  const el = document.getElementById('loginError');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  window.setTimeout(() => { el.hidden = true; }, 2600);
}

export async function mount(container, context) {
  container.classList.add('mod-login');
  const mode = routeMode();

  container.innerHTML = `
  <div class="login-panel normal-mapped-surface" data-light-surface>
    <div class="login-head-row">
      <div class="login-brand">
        <div class="brand-mark">${icon('sparkles', 'icon')}</div>
        <div><div class="login-title">智考通</div><div class="login-subtitle">SMART ATTENDANCE CONNECT</div></div>
      </div>
    </div>
    <p class="login-lead">${mode.type === 'normal'
      ? '输入学号与密码，或选择教职工账号登录（初始密码 123456）。'
      : `当前处于调试端点 <code>${mode.label}</code>（${mode.mobile ? '手机视图' : 'PC 视图'}），该端点拥有独立登录态。`}</p>
    <div class="segmented login-tabs" role="tablist" aria-label="登录身份切换">
      <button type="button" class="active" role="tab" aria-selected="true" data-tab="student">${icon('users')}学生</button>
      <button type="button" role="tab" aria-selected="false" data-tab="staff">${icon('book')}教职工</button>
    </div>
    <div class="login-pane" id="paneStudent">
      <label class="zone-label" for="studentIdInput">学号</label>
      <input class="id-input" id="studentIdInput" inputmode="numeric" maxlength="9" placeholder="学号（9 位数字）" autocomplete="off" />
      <label class="zone-label pwd-label" for="studentPwdInput">密码</label>
      <input class="id-input pwd-input" id="studentPwdInput" type="password" maxlength="32" placeholder="密码（初始密码 123456）" autocomplete="current-password" />
      <label class="zone-label captcha-label" for="studentCaptchaInput">验证码</label>
      <div class="captcha-row">
        <input class="id-input captcha-input" id="studentCaptchaInput" maxlength="4" placeholder="输入图中字符" autocomplete="off" />
        <div class="captcha-img" id="studentCaptchaImg" role="button" tabindex="0" title="点击刷新" aria-label="点击刷新验证码"></div>
      </div>
      <button type="button" class="btn primary zone-login-btn" id="studentLoginBtn">${icon('send')}登 录</button>
    </div>
    <div class="login-pane" id="paneStaff" hidden>
      <label class="zone-label" for="staffRoleSelect">账号</label>
      <div class="select-wrap">
        <select class="role-select" id="staffRoleSelect" aria-label="教职工账号选择">
          <option value="">加载中…</option>
        </select>
      </div>
      <label class="zone-label pwd-label" for="staffPwdInput">密码</label>
      <input class="id-input pwd-input" id="staffPwdInput" type="password" maxlength="32" placeholder="密码（初始密码 123456）" autocomplete="current-password" />
      <label class="zone-label captcha-label" for="staffCaptchaInput">验证码</label>
      <div class="captcha-row">
        <input class="id-input captcha-input" id="staffCaptchaInput" maxlength="4" placeholder="输入图中字符" autocomplete="off" />
        <div class="captcha-img" id="staffCaptchaImg" role="button" tabindex="0" title="点击刷新" aria-label="点击刷新验证码"></div>
      </div>
      <button type="button" class="btn primary zone-login-btn" id="staffLoginBtn">${icon('send')}登 录</button>
    </div>
    <p class="login-error" id="loginError" hidden></p>
  </div>`;

  /* 教职工下拉动态化（2026-10-24：教师账号随教务管理添加/模拟数据生成实时更新；
     拉取失败回落固定常量 STAFF_ACCOUNTS——fetchStaffAccounts 内置兜底） */
  const staffSelect = container.querySelector('#staffRoleSelect');
  const renderStaffOptions = (accounts) => {
    staffSelect.innerHTML = accounts.map((a) => `<option value="${a}">${a}</option>`).join('');
  };
  renderStaffOptions(STAFF_ACCOUNTS); // 先渲染回落，再异步刷新
  fetchStaffAccounts().then(({ all }) => { if (all.length) renderStaffOptions(all); }).catch(() => {});

  /* ---------- 图形验证码（双 Tab 共用同一 token：Tab 切换不刷新，登录失败后自动换新） ---------- */
  const captchaImgs = [container.querySelector('#studentCaptchaImg'), container.querySelector('#staffCaptchaImg')];
  const captchaInputs = [container.querySelector('#studentCaptchaInput'), container.querySelector('#staffCaptchaInput')];
  let captchaState = { token: '', svg: '' };
  const renderCaptcha = () => {
    captchaImgs.forEach((el) => { if (el) el.innerHTML = captchaState.svg; });
    captchaInputs.forEach((el) => { if (el) el.value = ''; });
  };
  const refreshCaptcha = async () => {
    try {
      const d = await fetchCaptcha();
      captchaState = { token: String(d.token || ''), svg: String(d.svg || '') };
      renderCaptcha();
    } catch (ex) {
      captchaState = { token: '', svg: '' };
      captchaImgs.forEach((el) => { if (el) el.textContent = '加载失败·点击重试'; });
    }
  };
  refreshCaptcha(); // 挂载即取
  captchaImgs.forEach((el) => {
    if (!el) return;
    el.addEventListener('click', refreshCaptcha);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); refreshCaptcha(); } });
  });

  // Tab 切换
  const tabs = container.querySelectorAll('.login-tabs button');
  const switchTab = (tab) => {
    tabs.forEach((b) => {
      const on = b === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    container.querySelector('#paneStudent').hidden = tab.dataset.tab !== 'student';
    container.querySelector('#paneStaff').hidden = tab.dataset.tab !== 'staff';
    const err = container.querySelector('#loginError');
    if (err) err.hidden = true;
  };
  tabs.forEach((b) => b.addEventListener('click', () => switchTab(b)));

  /** 统一登录提交：验证码 + 服务端校验密码并返回群组（2026-11-03 验证码体系） */
  const doLogin = async (account, password, btn, captchaInput) => {
    if (!account || !password) { showLoginError('请输入账号与密码'); return; }
    if (!captchaState.token) { showLoginError('验证码未就绪，请稍候或点击图片刷新'); return; }
    if (!captchaInput) { showLoginError('请输入验证码'); return; }
    btn.disabled = true;
    try {
      const { group } = await loginAccount(account, password, captchaState.token, captchaInput);
      context.eventBus.emit('auth:logged-in', { role: group, name: account, home: ROLE_HOME[group] || 'landing' });
    } catch (ex) {
      showLoginError(ex.message || '登录失败，请稍后重试');
      refreshCaptcha(); // 旧 token 已被服务端一次性消费，无论失败原因一律换新
    } finally {
      btn.disabled = false;
    }
  };

  // 学生登录：学号 001–100 + 密码 + 验证码（学号格式本地预检，密码/验证码交服务端校验）
  const studentBtn = container.querySelector('#studentLoginBtn');
  const doStudentLogin = () => {
    const id = (container.querySelector('#studentIdInput')?.value || '').trim();
    if (!validStudentId(id)) { showLoginError('学号为 9 位数字（000000001 起）'); return; }
    const pwd = container.querySelector('#studentPwdInput')?.value || '';
    doLogin(id, pwd, studentBtn, (container.querySelector('#studentCaptchaInput')?.value || '').trim());
  };
  studentBtn?.addEventListener('click', doStudentLogin);
  container.querySelector('#studentIdInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') container.querySelector('#studentPwdInput')?.focus();
  });
  container.querySelector('#studentPwdInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doStudentLogin();
  });
  container.querySelector('#studentCaptchaInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doStudentLogin();
  });

  // 教职工登录：账号下拉 + 密码 + 验证码 → 群组（服务端判定，动态教师账号归教师群组）
  const staffBtn = container.querySelector('#staffLoginBtn');
  staffBtn?.addEventListener('click', () => {
    const account = container.querySelector('#staffRoleSelect')?.value;
    if (!account) { showLoginError('请选择教职工账号'); return; }
    const pwd = container.querySelector('#staffPwdInput')?.value || '';
    doLogin(account, pwd, staffBtn, (container.querySelector('#staffCaptchaInput')?.value || '').trim());
  });
  container.querySelector('#staffPwdInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') staffBtn?.click();
  });
  container.querySelector('#staffCaptchaInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') staffBtn?.click();
  });
}

export async function unmount(container) {
  container.innerHTML = '';
  container.classList.remove('mod-login');
}
