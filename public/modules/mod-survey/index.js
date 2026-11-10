// mod-survey：问卷与投票（学生/教师=填写与投票；导员=绑定班填写情况+催填+发起；学生处/教务处/IT=发起[受众定向/查看范围配置]+统计+CSV 导出）
// 后端属地：src/api/surveys.js（开发计划《问卷与投票版块-注入式设计.md》§5）
// 口径：匿名卷明细对任何人不可见（仅分布+已填名单）；实名明细可见角色由发起人 visibility 配置；
//      投票四开关（每人票数/可否重复投同项/可否改票/结果可见性）；一卷一填不可改；截止过期禁填。
import { currentRole, currentName } from '../../shared/roles.js';
import {
  fetchSurveys, fetchSurvey, createSurvey, publishSurvey, closeSurvey,
  submitSurvey, voteSurvey, remindSurvey, fetchSurveyStats, deleteSurvey,
  SURVEY_STATUS, AUDIENCE_LABEL,
} from '../../shared/api-survey.js';
import { fetchClasses, fetchTeachers } from '../../shared/api-academic.js';
import { openMiniDialog, esc, icon } from '../../shared/leave-wizard.js';

let ssePubOff = null;
let sseClosedOff = null;
let sseRemindOff = null;

const pad2 = (n) => String(n).padStart(2, '0');
const fmtDeadline = (d) => (d ? String(d).replace('T', ' ') : '');
/** 九类作答值规范化（回显/明细/CSV 共用单源） */
const fmtAns = (q, v) => {
  if (v == null) return '—';
  if (q?.type === 'matrix' && typeof v === 'object') return (q.rows || []).map((r) => `${r.label}：${v[r.id] ?? '—'}`).join('；');
  if (typeof v === 'object' && !Array.isArray(v)) return `其他：${v.otherText || ''}`;
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? `其他：${x.otherText || ''}` : String(x))).join('、');
  return String(v);
};
const tomorrowDefault = () => {
  const t = new Date(Date.now() + 7 * 86400000); // 默认一周后
  return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}T23:59`;
};

export async function mount(container, context) {
  container.classList.add('mod-survey');
  const role = context.user?.group || currentRole();
  const name = context.user?.name || currentName();
  const toast = (message) => context.eventBus.emit('ui:toast', { message });

  const isRespondent = role === '学生' || role === '教师';
  const isCounselor = role === '导员';
  const canCreate = ['学生处', '教务处', 'IT管理员', '导员'].includes(role);

  let surveys = [];
  let boundClassIds = [];
  let tab = isRespondent ? 'fill' : isCounselor ? 'watch' : 'all';

  container.innerHTML = `
  <div class="welcome-row"><div>
    <div class="eyebrow"><span class="spark"></span>SURVEYS &amp; VOTES</div>
    <h1>问卷与投票</h1>
    <div class="welcome-copy">${isRespondent ? '待填问卷与待投投票（匿名卷匿名填写，提交后不可修改）。' : isCounselor ? '查看绑定班级的填写情况、催填提醒，并发起面向本班学生的问卷。' : '发起问卷与投票（受众可定向学生班级/教师/师生；查看范围可配置）、统计与导出。'}</div>
  </div></div>
  <section class="surface section-card">
    <div class="section-header">
      <div><div class="section-title"><span class="section-head-icon"><svg class="icon"><use href="#i-vote"/></svg></span>${isRespondent ? '待填写' : '问卷与投票'}</div></div>
      <div class="section-tools">${canCreate ? `<button class="btn primary compact" id="svCreateBtn">${icon('plus')}发起问卷 / 投票</button>` : ''}</div>
    </div>
    ${!isRespondent ? `
    <div class="aca-top">
      <div class="segmented aca-main-tabs" role="tablist" aria-label="问卷视图切换">
        ${isCounselor ? `
        <button type="button" class="active" role="tab" aria-selected="true" data-tab="watch">${icon('trend')}填写情况</button>
        <button type="button" role="tab" aria-selected="false" data-tab="mine">${icon('file')}我的发布</button>` : `
        <button type="button" class="active" role="tab" aria-selected="true" data-tab="all">${icon('file')}全部问卷</button>
        <button type="button" role="tab" aria-selected="false" data-tab="mine">${icon('edit')}我的发布</button>`}
      </div>
    </div>` : ''}
    <div class="sv-list" id="svList">加载中…</div>
    <div class="flow-foot"><span>${isRespondent ? '发布即通知 · 一卷一填 · 投票规则见卡片说明' : '匿名卷任何人不可见明细 · 实名明细按发起人配置 · 统计实时汇总'}</span></div>
  </section>`;

  /* ---------- 主 Tab ---------- */
  const mainTabs = container.querySelectorAll('.aca-main-tabs button');
  mainTabs.forEach((b) => b.addEventListener('click', () => {
    mainTabs.forEach((x) => {
      const on = x === b;
      x.classList.toggle('active', on);
      x.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    tab = b.dataset.tab;
    renderList();
  }));

  /* ---------- 数据加载与列表 ---------- */
  const load = async () => {
    try {
      const r = await fetchSurveys();
      surveys = r.surveys;
      if (isCounselor) boundClassIds = r.boundClassIds || [];
      renderList();
    } catch (ex) { toast(ex.message); }
  };

  const kindPill = (s) => `<em class="sv-kind-pill ${s.kind === 'vote' ? 'vt' : 'qn'}">${s.kind === 'vote' ? '投票' : '问卷'}</em>`;
  const statusPill = (s) => `<em class="leave-pill ${s.status === 'published' ? (s.deadlinePassed ? 'mut' : 'info') : s.status === 'draft' ? 'warn' : 'mut'}">${s.deadlinePassed && s.status === 'published' ? '已过截止' : SURVEY_STATUS[s.status] || s.status}</em>`;
  const audienceText = (s) => {
    let t = `受众：${AUDIENCE_LABEL[s.audience] || s.audience}`;
    if (s.targetClassNames && s.targetClassNames.length) t += `（${s.targetClassNames.join('、')}）`;
    if (s.targetTeacherNames && s.targetTeacherNames.length) t += `（${s.targetTeacherNames.join('、')}）`;
    return t;
  };

  const renderList = () => {
    const box = container.querySelector('#svList');
    if (!box) return;
    let list = surveys;
    if (tab === 'mine') list = surveys.filter((s) => s.createdBy === name);
    else if (tab === 'watch') list = surveys.filter((s) => s.status === 'published' && s.createdBy !== name);
    // 其余（fill/all）为服务端已按角色过滤的全量

    box.innerHTML = list.length ? list.map((s) => {
      const mine = s.createdBy === name;
      const done = s.kind === 'questionnaire' ? s.filled : s.voted;
      let ops = '';
      if (isRespondent) {
        ops = `<button type="button" class="btn ${done ? 'ghost' : 'primary'} compact" data-fill="${s.id}">${icon(done ? 'file' : 'edit')}${done ? '查看' : s.kind === 'vote' ? '投票' : '填写'}</button>`;
      } else {
        const canStats = mine || role === 'IT管理员' || (s.visibility?.statsViewers || []).includes(role) || (isCounselor && s.status === 'published');
        if (canStats && s.status !== 'draft') ops += `<button type="button" class="btn compact" data-stats="${s.id}">${icon('trend')}统计</button>`;
        if (mine || role === 'IT管理员') {
          if (s.status === 'draft') ops += `<button type="button" class="btn primary compact" data-pub="${s.id}">${icon('send')}发布</button>`;
          if (s.status === 'published') ops += `<button type="button" class="btn ghost compact" data-close="${s.id}">${icon('x')}关闭</button>`;
          ops += `<button type="button" class="btn danger compact" data-del="${s.id}">${icon('x')}删除</button>`;
        }
      }
      return `
      <div class="aca-req-row">
        <div class="aca-req-main">
          <div class="aca-req-title"><strong>${esc(s.title)}</strong>${kindPill(s)}${s.anonymous ? '<em class="leave-pill mut">匿名</em>' : ''}${statusPill(s)}</div>
          <div class="aca-req-meta">${audienceText(s)}${s.deadline ? ` · 截止 ${fmtDeadline(s.deadline)}` : ' · 长期开放'} · 发起 ${esc(s.createdRole)} ${esc(s.createdBy)}${isRespondent && s.kind === 'vote' && s.voteConfig ? ` · 每人 ${s.voteConfig.votesPerPerson} 票${s.voteConfig.allowRepeatOption ? '（可重复投同项）' : ''}${s.voteConfig.allowRevote ? '（可改票）' : '（不可改票）'}` : ''}</div>
        </div>
        <div class="aca-req-ops">${ops}</div>
      </div>`;
    }).join('') : `<div class="sv-empty">${icon('vote', 'icon large')}<strong>${tab === 'mine' ? '尚未发起过问卷 / 投票' : '暂无问卷或投票'}</strong><span>${isRespondent ? '发布后将实时出现在此' : canCreate ? '点击右上角「发起问卷 / 投票」创建' : ''}</span></div>`;

    box.querySelectorAll('[data-fill]').forEach((b) => b.addEventListener('click', async () => {
      const s = surveys.find((x) => x.id === +b.dataset.fill);
      if (s) openFill(s);
    }));
    box.querySelectorAll('[data-stats]').forEach((b) => b.addEventListener('click', () => openStats(+b.dataset.stats)));
    box.querySelectorAll('[data-pub]').forEach((b) => b.addEventListener('click', () => confirmAction(surveys.find((x) => x.id === +b.dataset.pub), 'publish')));
    box.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => confirmAction(surveys.find((x) => x.id === +b.dataset.close), 'close')));
    box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => confirmAction(surveys.find((x) => x.id === +b.dataset.del), 'delete')));
  };

  /* ---------- 发布/关闭/删除（确认弹窗） ---------- */
  const confirmAction = (s, action) => {
    if (!s || container.querySelector('.leave-wizard')) return;
    const conf = {
      publish: { title: `发布 · ${esc(s.title)}`, text: `发布后受众（${audienceText(s)}）将实时收到通知${s.deadline ? `，截止 ${fmtDeadline(s.deadline)}` : '，长期开放'}。发布后题目不可修改。`, ok: '确认发布', fn: publishSurvey, msg: (r) => `已发布（受众将收到通知）` },
      close: { title: `关闭 · ${esc(s.title)}`, text: '关闭后受众停止填写/投票，已有数据保留可统计。', ok: '确认关闭', fn: closeSurvey, msg: () => '已关闭' },
      delete: { title: `删除 · ${esc(s.title)}`, text: '<b style="color:var(--danger)">不可恢复</b>：问卷与全部作答/选票记录将连带删除。', ok: '确认删除', fn: deleteSurvey, msg: (r) => `已删除（连带清理 ${r.cleared} 条作答/选票）` },
    }[action];
    openMiniDialog({
      host: container,
      title: conf.title,
      textHTML: conf.text,
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: conf.ok, cls: action === 'delete' ? 'danger' : 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        try { const r = await conf.fn(s.id); d.remove(); toast(conf.msg(r)); load(); }
        catch (ex) { toast(ex.message); }
      },
    });
  };

  /* ---------- 填写入口（问卷/投票统一；已填→回显/改票） ---------- */
  const openFill = async (s) => {
    if (container.querySelector('.leave-wizard')) return;
    let d0;
    try { d0 = await fetchSurvey(s.id); } catch (ex) { return toast(ex.message); }
    if (d0.status !== 'published') return toast('该问卷当前不可填写');
    if (d0.deadlinePassed) return toast('已过截止时间');
    const done = d0.kind === 'questionnaire' ? d0.filled : d0.voted;
    if (done && d0.kind === 'questionnaire') return openMyAnswers(d0);
    if (done && d0.kind === 'vote') return openVote(d0, true); // 已投→可改票视图（allowRevote 服务端校验）
    if (d0.kind === 'questionnaire') openQuestionnaire(d0);
    else openVote(d0, false);
  };

  /* 问卷填写弹窗（v2：九类渲染+显示逻辑实时显隐+其他补充填空） */
  const openQuestionnaire = (s) => {
    /** 题块渲染（九类控件） */
    const qBlockHtml = (q, idx) => {
      let control = '';
      if (q.type === 'single' || q.type === 'multi') {
        control = `<div class="chip-row sv-opts">${q.options.map((o) => `<button type="button" class="sv-opt" data-val="${esc(o)}">${esc(o)}</button>`).join('')}${q.otherOption ? `<button type="button" class="sv-opt" data-val="__other__">其他</button>` : ''}</div>
          ${q.type === 'multi' ? `<div class="sv-hint">可多选${q.minSelect || q.maxSelect ? `（${q.minSelect ? `至少 ${q.minSelect} 项` : ''}${q.minSelect && q.maxSelect ? '、' : ''}${q.maxSelect ? `至多 ${q.maxSelect} 项` : ''}）` : ''}</div>` : ''}
          ${q.otherOption ? '<input class="aca-input sv-other-input" placeholder="其他：请说明（选「其他」后必填）" maxlength="100" hidden />' : ''}`;
      } else if (q.type === 'dropdown') {
        control = `<select class="aca-input sv-dropdown">${q.options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}${q.otherOption ? '<option value="__other__">其他</option>' : ''}</select>${q.otherOption ? '<input class="aca-input sv-other-input" placeholder="其他：请说明" maxlength="100" hidden />' : ''}`;
      } else if (q.type === 'sort') {
        control = `<div class="sv-sort-list">${q.options.map((o) => `
          <div class="sv-sort-row" data-val="${esc(o)}">
            <span class="sv-sort-order"></span><strong>${esc(o)}</strong>
            <button type="button" class="btn ghost compact" data-sort="-1" aria-label="上移">↑</button>
            <button type="button" class="btn ghost compact" data-sort="1" aria-label="下移">↓</button>
          </div>`).join('')}</div><div class="sv-hint">用 ↑↓ 调整顺序（从上到下为喜好排序）</div>`;
      } else if (q.type === 'text') {
        control = `<input class="aca-input sv-text-input" ${q.format === 'date' ? 'type="date"' : q.format === 'number' ? 'type="number"' : 'type="text"'} placeholder="${q.format === 'phone' ? '手机号' : q.format === 'email' ? '邮箱' : q.format === 'number' ? '数字' : '填写内容'}" maxlength="200" />`;
      } else if (q.type === 'textarea') {
        control = '<textarea class="reason-input sv-textarea" maxlength="500" placeholder="填写内容（≤500 字）"></textarea>';
      } else if (q.type === 'scale') {
        const sc = q.scale || { min: 1, max: 5 };
        const nps = sc.skin === 'nps';
        control = `<div class="sv-scale-row">${(() => { let h = ''; for (let n = sc.min; n <= sc.max; n++) h += `<button type="button" class="sv-scale-opt${nps ? ' nps' : sc.skin === 'star' ? ' star' : ''}" data-val="${n}" title="${n} 分">${sc.skin === 'star' ? '★' : n}</button>`; return h; })()}</div>
          ${sc.lowLabel || sc.highLabel ? `<div class="sv-scale-labels"><span>${esc(sc.lowLabel || '')}</span><span>${esc(sc.highLabel || '')}</span></div>` : ''}`;
      } else if (q.type === 'matrix') {
        control = `<div class="sv-matrix-scroll"><table class="sv-matrix"><thead><tr><th></th>${(q.cols || []).map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
          <tbody>${(q.rows || []).map((r) => `<tr><td class="sv-mx-rowlabel">${esc(r.label)}</td>${(q.cols || []).map((c) => `<td><input type="radio" name="mx-${esc(String(q.id))}-${esc(r.id)}" data-row="${esc(r.id)}" data-col="${esc(c.label)}" /></td>`).join('')}</tr>`).join('')}</tbody></table></div>
          ${q.matrixMode === 'scale' ? '<div class="sv-hint">每行选择一档</div>' : ''}`;
      } else if (q.type === 'file') {
        control = `<input class="aca-input" type="file" accept="image/*" multiple /><div class="sv-file-list"></div><div class="sv-hint">最多 ${q.maxFiles ?? 3} 个，单个 ≤2MB</div>`;
      }
      const condHint = q.visibleWhen ? '<div class="sv-hint sv-cond-mark">按条件显示</div>' : '';
      return `
      <div class="sv-q-block sv-fill-q" data-qid="${esc(String(q.id))}" data-qtype="${q.type}">
        <div class="wizard-label">Q${idx + 1} ${esc(q.title)}${q.required ? ' <small style="color:var(--danger)">*必填</small>' : ' <small>（选填）</small>'}</div>
        ${control}${condHint}
      </div>`;
    };
    const qBody = s.questions.map(qBlockHtml).join('');
    openMiniDialog({
      host: container,
      title: `填写 · ${esc(s.title)}${s.anonymous ? '（匿名）' : ''}`,
      textHTML: `${s.description ? `${esc(s.description)}<br/>` : ''}提交后<b>不可修改</b>${s.deadline ? `；截止 ${fmtDeadline(s.deadline)}` : ''}。`,
      rawBody: qBody,
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '提交', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const collected = collectAnswers(d);
        if (collected.bad) return toast(collected.bad);
        try {
          await submitSurvey(s.id, collected.answers);
          d.remove();
          toast('已提交，感谢填写');
          load();
        } catch (ex) { toast(ex.message); }
      },
    });

    const dlg = container.querySelector('.leave-wizard');

    /* ---- 前端显隐引擎（与服务端 visibleQuestionSet 同规则单源镜像；每次作答变化重算） ---- */
    const readValues = () => {
      const map = {};
      dlg.querySelectorAll('.sv-q-block[data-qid]').forEach((block) => {
        const q = s.questions.find((x) => String(x.id) === block.dataset.qid);
        if (!q) return;
        map[q.id] = readOne(q, block);
      });
      return map;
    };
    const readOne = (q, block) => {
      if (q.type === 'single') {
        const on = block.querySelector('.sv-opt.on');
        if (!on) return null;
        if (on.dataset.val === '__other__') {
          const txt = block.querySelector('.sv-other-input')?.value.trim();
          return txt ? { option: '__other__', otherText: txt } : null;
        }
        return on.dataset.val;
      }
      if (q.type === 'dropdown') {
        const sel = block.querySelector('.sv-dropdown')?.value;
        if (!sel || sel === '') return null;
        if (sel === '__other__') {
          const txt = block.querySelector('.sv-other-input')?.value.trim();
          return txt ? { option: '__other__', otherText: txt } : null;
        }
        return sel;
      }
      if (q.type === 'multi') {
        const arr = [];
        block.querySelectorAll('.sv-opt.on').forEach((c) => {
          if (c.dataset.val === '__other__') {
            const txt = block.querySelector('.sv-other-input')?.value.trim();
            if (txt) arr.push({ option: '__other__', otherText: txt });
          } else arr.push(c.dataset.val);
        });
        return arr.length ? arr : null;
      }
      if (q.type === 'sort') {
        const rows = Array.from(block.querySelectorAll('.sv-sort-row'));
        return rows.length ? rows.map((r) => r.dataset.val) : null;
      }
      if (q.type === 'scale') {
        const on = block.querySelector('.sv-scale-opt.on');
        return on ? Number(on.dataset.val) : null;
      }
      if (q.type === 'matrix') {
        const out = {};
        let any = false;
        block.querySelectorAll('input[type="radio"]:checked').forEach((r) => { out[r.dataset.row] = r.dataset.col; any = true; });
        return any ? out : null;
      }
      if (q.type === 'file') {
        const stored = block.querySelector('.sv-file-list')?.dataset.urls;
        if (!stored) return null;
        try { const arr = JSON.parse(stored); return arr.length ? arr : null; } catch { return null; }
      }
      // text/textarea
      const el = block.querySelector('.sv-text-input, .sv-textarea');
      return el && el.value.trim() !== '' ? el.value.trim() : null;
    };
    /** 与服务端同规则（§2.2 镜像）：来源题不可见或未命中 → 规则假；and/or 汇总 */
    const recomputeVisibility = () => {
      const values = readValues();
      const visible = {};
      for (const q of s.questions) {
        const vw = q.visibleWhen;
        if (!vw || !Array.isArray(vw.rules) || !vw.rules.length) { visible[q.id] = true; continue; }
        const results = vw.rules.map((rule) => {
          if (visible[rule.questionId] !== true) return false;
          const src = s.questions.find((x) => String(x.id) === String(rule.questionId));
          if (!src) return false;
          const ans = values[rule.questionId];
          const picked = new Set();
          const addVal = (v) => {
            if (v == null || v === '') return;
            if (typeof v === 'object' && !Array.isArray(v)) { picked.add('__other__'); return; }
            picked.add(String(v));
          };
          if (src.type === 'multi') (Array.isArray(ans) ? ans : []).forEach(addVal); else addVal(ans);
          return rule.optionValues.some((v) => picked.has(v));
        });
        visible[q.id] = vw.op === 'or' ? results.some(Boolean) : results.every(Boolean);
      }
      // 应用显隐（S21 实测踩坑：hidden 与 vis 同名赋值写反致无条件题全隐藏——注意取反）
      dlg.querySelectorAll('.sv-q-block[data-qid]').forEach((block) => {
        const vis = visible[block.dataset.qid] !== false;
        block.hidden = !vis;
        block.classList.toggle('sv-q-hidden', !vis);
      });
    };
    // 任何作答变化 → 重算
    dlg.addEventListener('click', recomputeVisibility);
    dlg.addEventListener('change', recomputeVisibility);
    dlg.addEventListener('input', recomputeVisibility);

    /* ---- 控件交互绑定 ---- */
    dlg.querySelectorAll('.sv-q-block[data-qid]').forEach((block) => {
      const q = s.questions.find((x) => String(x.id) === block.dataset.qid);
      if (!q) return;
      if (q.type === 'single' || q.type === 'multi') {
        block.querySelectorAll('.sv-opt').forEach((c) => c.addEventListener('click', () => {
          if (q.type === 'single') {
            block.querySelectorAll('.sv-opt').forEach((x) => x.classList.toggle('on', x === c));
            const otherInput = block.querySelector('.sv-other-input');
            if (otherInput) otherInput.hidden = c.dataset.val !== '__other__';
          } else {
            c.classList.toggle('on');
            const otherInput = block.querySelector('.sv-other-input');
            const otherOn = block.querySelector('.sv-opt[data-val="__other__"]')?.classList.contains('on');
            if (otherInput && q.otherOption) otherInput.hidden = !otherOn;
            // 多选上下限软提示
            if (q.maxSelect) {
              const onN = block.querySelectorAll('.sv-opt.on').length;
              if (onN > q.maxSelect) { c.classList.remove('on'); toast(`「${q.title}」最多选 ${q.maxSelect} 项`); }
            }
          }
        }));
      }
      if (q.type === 'dropdown') {
        const sel = block.querySelector('.sv-dropdown');
        sel?.addEventListener('change', () => {
          const otherInput = block.querySelector('.sv-other-input');
          if (otherInput && q.otherOption) otherInput.hidden = sel.value !== '__other__';
        });
      }
      if (q.type === 'sort') {
        const move = (row, dir) => {
          const rows = Array.from(block.querySelectorAll('.sv-sort-row'));
          const i = rows.indexOf(row);
          const j = i + dir;
          if (j < 0 || j >= rows.length) return;
          if (dir < 0) row.parentElement.insertBefore(row, rows[j]);
          else row.parentElement.insertBefore(rows[j], row);
          renumber();
        };
        const renumber = () => {
          block.querySelectorAll('.sv-sort-row').forEach((r, i) => { r.querySelector('.sv-sort-order').textContent = String(i + 1); });
        };
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

    /* ---- 收集答案（含必填/其他/多选限制前端拦截） ---- */
    const collectAnswers = (d) => {
      const answers = [];
      const values = readValues();
      const visible = {};
      for (const q of s.questions) {
        const vw = q.visibleWhen;
        if (!vw || !Array.isArray(vw.rules) || !vw.rules.length) { visible[q.id] = true; continue; }
        const results = vw.rules.map((rule) => {
          if (visible[rule.questionId] !== true) return false;
          const src = s.questions.find((x) => String(x.id) === String(rule.questionId));
          if (!src) return false;
          const ans = values[rule.questionId];
          const picked = new Set();
          const addVal = (v) => { if (v == null || v === '') return; if (typeof v === 'object' && !Array.isArray(v)) { picked.add('__other__'); return; } picked.add(String(v)); };
          if (src.type === 'multi') (Array.isArray(ans) ? ans : []).forEach(addVal); else addVal(ans);
          return rule.optionValues.some((v) => picked.has(v));
        });
        visible[q.id] = vw.op === 'or' ? results.some(Boolean) : results.every(Boolean);
      }
      for (const q of s.questions) {
        if (!visible[q.id]) continue; // 隐藏题：不校验不出答案（服务端二次剔除兜底）
        const v = values[q.id];
        const isEmpty = v == null || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && q.type === 'matrix' && Object.keys(v).length === 0);
        if (isEmpty) {
          if (q.required) return { bad: `「${q.title}」为必填` };
          continue;
        }
        if (q.type === 'multi' && q.minSelect && v.length < q.minSelect) return { bad: `「${q.title}」至少选 ${q.minSelect} 项` };
        answers.push({ questionId: q.id, value: v });
      }
      return { answers };
    };

    recomputeVisibility(); // 初始显隐
  };

  /* 投票弹窗（步进器+剩余票数；isMine=已投改票视图预填） */
  const openVote = (s, isMine) => {
    const vc = s.voteConfig || {};
    const my = new Map((s.myChoices || []).map((c) => [String(c.optionId), c.count]));
    openMiniDialog({
      host: container,
      title: `投票 · ${esc(s.title)}`,
      textHTML: `每人 <b>${vc.votesPerPerson}</b> 票${vc.allowRepeatOption ? '，可重复投同一选项' : '，每项限 1 票'}${vc.allowRevote ? '，提交后<b>可修改</b>' : '，<b>一投定局不可修改</b>'}${vc.resultVisibility === 'after-vote' ? '；提交后可见当前票数' : '；结果仅发起人可见'}。${isMine && vc.allowRevote ? '<br/><b style="color:var(--google-blue)">您已投过票，修改后整体覆盖原选票。</b>' : ''}`,
      rawBody: `<div id="svVoteBody">${vc.options.map((o) => `
        <div class="sv-q-block" data-oid="${esc(String(o.id))}" style="flex-direction:row;align-items:center;justify-content:space-between;gap:10px">
          <strong style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(o.label)}</strong>
          <div class="sv-stepper">
            <button type="button" class="sv-step-btn" data-step="-1" aria-label="减票">−</button>
            <span class="sv-step-num" data-num>0</span>
            <button type="button" class="sv-step-btn" data-step="1" aria-label="加票">＋</button>
          </div>
        </div>`).join('')}
        <div class="sv-hint" style="margin-top:8px">剩余可投：<b class="sv-remain" id="svRemain">${vc.votesPerPerson}</b> 票</div>`,
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: isMine ? '修改选票' : '提交投票', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const choices = [];
        d.querySelectorAll('.sv-q-block[data-oid]').forEach((block) => {
          const n = Number(block.querySelector('[data-num]').textContent);
          if (n > 0) choices.push({ optionId: block.dataset.oid, count: n });
        });
        if (!choices.length) return toast('请至少投 1 票');
        try {
          const r = await voteSurvey(s.id, choices);
          d.remove();
          toast(r.revoted ? '选票已修改' : '投票成功');
          load();
        } catch (ex) { toast(ex.message); }
      },
    });
    const dlg = container.querySelector('.leave-wizard');
    const vpp = vc.votesPerPerson;
    const sync = () => {
      let total = 0;
      dlg.querySelectorAll('.sv-q-block[data-oid]').forEach((block) => {
        const numEl = block.querySelector('[data-num]');
        const n = Number(numEl.textContent);
        total += n;
        block.querySelector('[data-step="-1"]').disabled = n <= 0;
        block.querySelector('[data-step="1"]').disabled = total >= vpp || (!vc.allowRepeatOption && n >= 1);
      });
      const remain = dlg.querySelector('#svRemain');
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
  };

  /* 已填问卷回显（九类值规范化显示） */
  const openMyAnswers = (s) => {
    const valOf = (qid) => (s.myAnswers || []).find((a) => String(a.questionId) === String(qid))?.value;
    const fmtVal = (q, v) => {
      if (v == null) return '<span class="sv-hint">（未填）</span>';
      if (q.type === 'matrix' && typeof v === 'object') {
        return esc((q.rows || []).map((r) => `${r.label}：${v[r.id] ?? '—'}`).join('；'));
      }
      if (typeof v === 'object' && !Array.isArray(v)) return esc(`其他：${v.otherText || ''}`);
      if (Array.isArray(v)) {
        return esc(v.map((x) => (typeof x === 'object' ? `其他：${x.otherText || ''}` : String(x))).join('、'));
      }
      return esc(String(v));
    };
    openMiniDialog({
      host: container,
      title: `我的填写 · ${esc(s.title)}`,
      textHTML: `已提交${s.anonymous ? '（匿名）' : ''}，<b>不可修改</b>。`,
      rawBody: s.questions.map((q) => `<div class="aca-review-row"><span>${esc(q.title)}</span><strong>${fmtVal(q, valOf(q.id))}</strong></div>`).join(''),
      buttons: [{ act: 'ok', label: '关闭', cls: 'primary' }],
      onAction: (act, d) => d.remove(),
    });
  };

  /* ---------- 统计弹窗（填写率+分布/票数+实名明细+催填+CSV） ---------- */
  const openStats = async (id) => {
    if (container.querySelector('.leave-wizard')) return;
    let st;
    try { st = await fetchSurveyStats(id); } catch (ex) { return toast(ex.message); }
    const s = st.survey;
    const rate = st.respondentCount ? Math.round((st.filledCount / st.respondentCount) * 100) : 0;

    /* 分布/票数渲染（v2 九类：单选/下拉/多选计数；排序位次；量表均值；矩阵行；其他文本） */
    let distHtml = '';
    if (s.kind === 'questionnaire') {
      distHtml = (st.distribution || []).map((d) => {
        const maxC = Math.max(1, ...(d.counts || []).map((c) => c.count));
        const bars = (d.counts || []).length
          ? d.counts.map((c) => `<div class="sv-bar-row"><span class="sv-bar-label" title="${esc(c.label)}">${esc(c.label)}${c.avgRank != null ? `<small style="color:var(--on-surface-3)">（均位 ${c.avgRank}）</small>` : ''}</span><div class="sv-bar-track"><div class="sv-bar-fill${d.type === 'scale' ? ' mint' : ''}" style="width:${(c.count / maxC) * 100}%"></div></div><span class="sv-bar-num">${c.count}</span></div>`).join('')
          : '';
        const avgHtml = d.avg != null ? `<div class="sv-hint" style="margin-top:3px">均值：<b style="color:var(--google-blue)">${d.avg}</b>${d.scale?.lowLabel ? `（${esc(d.scale.lowLabel)} → ${esc(d.scale.highLabel || '')}）` : ''}</div>` : '';
        const matrixHtml = (d.rows || []).length
          ? d.rows.map((r) => {
              const mmax = Math.max(1, ...(r.counts || []).map((c) => c.count));
              return `<div class="sv-bar-row" style="margin-top:4px"><span class="sv-bar-label" title="${esc(r.rowLabel)}">${esc(r.rowLabel)}${r.avg != null ? `<small> 均 ${r.avg}</small>` : ''}</span><div class="sv-bar-track"><div class="sv-bar-fill mint" style="width:${((r.counts?.[0]?.count || 0) / mmax) * 100}%"></div></div><span class="sv-bar-num">${r.counts?.map((c) => `${esc(c.label)}:${c.count}`).join(' ') || '—'}</span></div>`;
            }).join('')
          : '';
        const fileHtml = d.fileCount != null ? `<div class="sv-hint">附件共 ${d.fileCount} 个</div>` : '';
        const texts = (d.textValues || []).length
          ? `<div class="sv-hint" style="margin-top:4px">${d.textValues.slice(0, 20).map((v) => esc(String(v).slice(0, 40))).join(' ｜ ')}</div>` : '';
        return `<div class="wizard-label" style="margin-top:10px">${esc(d.title)}</div>${bars}${avgHtml}${matrixHtml}${fileHtml}${texts}`;
      }).join('');
    } else {
      const maxV = Math.max(1, ...((st.vote?.tallies || []).map((t) => t.votes)));
      distHtml = (st.vote?.options || []).map((o) => {
        const votes = (st.vote?.tallies || []).find((t) => String(t.optionId) === String(o.id))?.votes || 0;
        return `<div class="sv-bar-row"><span class="sv-bar-label" title="${esc(o.label)}">${esc(o.label)}</span><div class="sv-bar-track"><div class="sv-bar-fill mint" style="width:${(votes / maxV) * 100}%"></div></div><span class="sv-bar-num">${votes}</span></div>`;
      }).join('') + `<div class="sv-hint" style="margin-top:6px">投票人数：<b>${st.vote?.voters ?? 0}</b> 人</div>`;
    }

    /* 未填名单 */
    const unfilledHtml = (st.unfilledStudents?.length || st.unfilledTeachers?.length)
      ? `<div class="wizard-label" style="margin-top:10px">未填名单（${st.unfilledStudents.length + (st.unfilledTeachers?.length || 0)} 人）：</div>
         <div class="sv-hint">${st.unfilledStudents.slice(0, 24).map((u) => `${esc(u.name)}${u.className ? `（${esc(u.className)}）` : ''}`).join('、')}${st.unfilledStudents.length > 24 ? '…' : ''}${st.unfilledTeachers?.length ? `<br/>教师：${st.unfilledTeachers.map(esc).join('、')}` : ''}</div>`
      : '<div class="sv-hint" style="margin-top:8px">全部受众已完成填写。</div>';

    /* 实名明细（九类值规范化——fmtAns 模块级共享） */
    let detailHtml = '';
    if (st.canViewDetail && st.details?.length) {
      detailHtml = `<div class="wizard-label" style="margin-top:10px">实名明细（${st.details.length} 份）：</div>
        <div class="sv-detail-table">${st.details.slice(0, 60).map((r) => `
          <div class="sv-detail-row"><strong title="${esc(r.name)}">${esc(r.name)}</strong><code>${esc(r.respondentType === 'teacher' ? '教师' : r.respondentId)}</code><span>${r.answers.map((a) => {
            const q = s.questions.find((x) => String(x.id) === String(a.questionId));
            return `${esc(q?.title || a.questionId)}：${esc(fmtAns(q, a.value))}`;
          }).join('；')}</span></div>`).join('')}</div>`;
    } else if (!st.anonymous && !st.canViewDetail) {
      detailHtml = '<div class="sv-hint" style="margin-top:8px">实名明细：您不在发起人配置的可见范围内。</div>';
    } else if (st.anonymous) {
      detailHtml = '<div class="sv-hint" style="margin-top:8px">匿名问卷：明细对任何人不可见（含发起人）。</div>';
    }

    const dlg = openMiniDialog({
      host: container,
      title: `统计 · ${esc(s.title)}`,
      textHTML: `${kindPill(s)} ${s.anonymous ? '<em class="leave-pill mut">匿名</em>' : ''} ${statusPill(s)} · ${audienceText(s)}${s.deadline ? ` · 截止 ${fmtDeadline(s.deadline)}` : ''}`,
      rawBody: `
        <div class="sv-stats-head"><span class="sv-rate">已填 ${st.filledCount} / ${st.respondentCount}（${rate}%）</span></div>
        ${distHtml}${unfilledHtml}${detailHtml}`,
      buttons: [
        ...(s.status === 'published' ? [{ act: 'remind', label: '催填提醒', cls: 'primary' }] : []),
        { act: 'csv', label: '导出 CSV' },
        { act: 'ok', label: '关闭', cls: 'ghost' },
      ],
      onAction: async (act, d) => {
        if (act === 'ok') return d.remove();
        if (act === 'remind') {
          try { const r = await remindSurvey(s.id); toast(`已发送催填提醒（${r.channels} 个频道）`); }
          catch (ex) { toast(ex.message); }
          return;
        }
        if (act === 'csv') return exportStatsCsv(s, st);
      },
    });
    void dlg;
  };

  /* 统计 CSV 导出（明细优先九类规范化，匿名/无权导汇总+未填名单） */
  const exportStatsCsv = (s, st) => {
    const rows = [];
    if (st.canViewDetail && st.details?.length) {
      rows.push(['姓名', '类型', ...s.questions.map((q) => q.title)]);
      st.details.forEach((r) => rows.push([r.name, r.respondentType === 'teacher' ? '教师' : r.respondentId,
        ...s.questions.map((q) => { const a = r.answers.find((x) => String(x.questionId) === String(q.id)); return a ? fmtAns(q, a.value) : ''; })]));
    } else {
      rows.push(['统计项', '数值']);
      rows.push(['标题', s.title]);
      rows.push(['类型', s.kind === 'vote' ? '投票' : '问卷']);
      rows.push(['匿名', s.anonymous ? '是' : '否']);
      rows.push(['已填人数', st.filledCount]);
      rows.push(['受众人数', st.respondentCount]);
      if (s.kind === 'vote') {
        (st.vote?.options || []).forEach((o) => rows.push([`选项：${o.label}`, (st.vote?.tallies || []).find((t) => String(t.optionId) === String(o.id))?.votes || 0]));
      } else {
        (st.distribution || []).forEach((d) => {
          if (d.avg != null) rows.push([`${d.title}｜均值`, d.avg]);
          if (d.rows?.length) d.rows.forEach((r) => { const top = (r.counts || []).slice().sort((a, b) => b.count - a.count)[0]; rows.push([`${d.title}｜${r.rowLabel}${r.avg != null ? `（均 ${r.avg}）` : ''}`, top ? `${top.label}:${top.count}` : '—']); });
          else if (d.fileCount != null) rows.push([`${d.title}｜附件数`, d.fileCount]);
          else (d.counts || []).forEach((c) => rows.push([`${d.title}｜${c.label}${c.avgRank != null ? `（均位 ${c.avgRank}）` : ''}`, c.count]));
          (d.textValues || []).slice(0, 10).forEach((v, i) => rows.push([`${d.title}｜文本${i + 1}`, v]));
        });
      }
      if (st.unfilledStudents?.length) rows.push(['未填学生', st.unfilledStudents.map((u) => u.name).join('、')]);
      if (st.unfilledTeachers?.length) rows.push(['未填教师', st.unfilledTeachers.join('、')]);
    }
    const csvCell = (v) => { const x = String(v ?? ''); return /[",\r\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
    const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    const d = new Date(); // 本地日期（严禁 toISOString——UTC 偏移坑）
    a.href = URL.createObjectURL(blob);
    a.download = `问卷统计-${s.title}-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}.csv`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('已导出统计 CSV');
  };

  /* ---------- 创建表单（kind 切换+题目/选项设计器+四开关+受众+查看范围） ---------- */
  const openCreate = async () => {
    if (container.querySelector('.leave-wizard')) return;
    let classes = [];
    let teachers = [];
    if (!isCounselor) {
      try {
        const [cls, tch] = await Promise.all([fetchClasses(), fetchTeachers()]);
        classes = cls.classes || [];
        teachers = tch || [];
      } catch { /* 网络异常时允许创建（默认全校） */ }
    }
    openMiniDialog({
      host: container,
      title: '发起问卷 / 投票',
      textHTML: '创建为<b>草稿</b>，发布后受众实时收到通知；发布前可删除重建修改。',
      rawBody: `
        <div class="segmented aca-dlg-tabs sv-kind-tabs" role="tablist" aria-label="类型切换">
          <button type="button" class="active" role="tab" aria-selected="true" data-k="questionnaire">${icon('file')}问卷</button>
          <button type="button" role="tab" aria-selected="false" data-k="vote">${icon('vote')}投票</button>
        </div>
        <div class="wizard-label">标题：</div>
        <input class="aca-input" id="svTitle" maxlength="60" placeholder="如：节假日离校统计 / 心理健康调查" autocomplete="off" />
        <div class="wizard-label" style="margin-top:10px">说明（选填）：</div>
        <textarea class="reason-input" id="svDesc" maxlength="300" placeholder="用途与填写说明"></textarea>
        <div class="wizard-label" style="margin-top:10px">填写方式：</div>
        <div class="chip-row">
          <button type="button" class="sv-opt on" data-anon="0">实名</button>
          <button type="button" class="sv-opt" data-anon="1">匿名（明细仅汇总，任何人不见单份）</button>
        </div>
        <div class="wizard-label" style="margin-top:10px">受众：</div>
        ${isCounselor ? `<div class="sv-hint">面向您绑定的班级（共 ${boundClassIds.length} 个，自动定向）</div><input type="hidden" id="svAudience" value="students" />`
          : `<select class="aca-input" id="svAudience">
              <option value="students">学生</option>
              <option value="teachers">教师</option>
              <option value="all">全校师生</option>
            </select>
            <div id="svClassRow" style="margin-top:8px"><div class="wizard-label">定向班级（不选=全部学生）：</div>
              <div class="chip-row">${classes.map((c) => `<button type="button" class="sv-opt" data-cid="${c.id}">${esc(c.name)}</button>`).join('') || '<span class="sv-hint">暂无班级（将发全部学生）</span>'}</div></div>
            <div id="svTeacherRow" hidden style="margin-top:8px"><div class="wizard-label">定向教师（不选=全部教师）：</div>
              <div class="chip-row">${teachers.map((t) => `<button type="button" class="sv-opt" data-tname="${esc(t.name)}">${esc(t.name)}</button>`).join('') || '<span class="sv-hint">暂无教师</span>'}</div></div>`}
        <div class="wizard-label" style="margin-top:10px">截止时间（选填）：</div>
        <input class="aca-input" id="svDeadline" type="datetime-local" value="${tomorrowDefault()}" />
        <div class="sv-pane" data-p="q">
          <div class="wizard-label" style="margin-top:10px">题目设计（1–30 题）：</div>
          <div id="svQList"></div>
          <button type="button" class="btn ghost compact" id="svAddQ" style="margin-top:8px">${icon('plus')}添加题目</button>
        </div>
        <div class="sv-pane" data-p="v" hidden>
          <div class="wizard-label" style="margin-top:10px">投票选项（2–20 个）：</div>
          <div id="svOptList"></div>
          <button type="button" class="btn ghost compact" id="svAddOpt" style="margin-top:8px">${icon('plus')}添加选项</button>
          <div class="wizard-label" style="margin-top:10px">投票规则：</div>
          <div class="sv-opt-row"><span class="sv-hint" style="flex:0 0 96px">每人票数</span><input class="aca-input" id="svVpp" type="number" min="1" max="10" value="1" style="flex:0 0 84px" /></div>
          <div class="chip-row" style="margin-top:8px">
            <button type="button" class="sv-opt" data-sw="repeat">允许重复投同一选项</button>
            <button type="button" class="sv-opt on" data-sw="revote">允许改票</button>
          </div>
          <div class="sv-opt-row" style="margin-top:8px"><span class="sv-hint" style="flex:0 0 96px">结果可见性</span>
            <select class="aca-input" id="svResultVis" style="flex:1">
              <option value="after-vote">投票人提交后可见</option>
              <option value="owner">仅发起人与授权者</option>
            </select></div>
        </div>
        <div class="wizard-label" style="margin-top:10px">查看范围（谁可看统计 / 实名明细；您本人与IT恒可见统计）：</div>
        <div class="sv-hint">统计可见：</div>
        <div class="chip-row" id="svVisStats">${['导员', '学生处', '教务处'].map((r) => `<button type="button" class="sv-opt" data-role="${r}">${r}</button>`).join('')}</div>
        <div class="sv-hint" style="margin-top:6px">实名明细可见（匿名卷对任何人不开放）：</div>
        <div class="chip-row" id="svVisDetail">${['导员', '学生处', '教务处'].map((r) => `<button type="button" class="sv-opt" data-role="${r}">${r}</button>`).join('')}</div>`,
      buttons: [{ act: 'cancel', label: '取消' }, { act: 'ok', label: '创建草稿', cls: 'primary' }],
      onAction: async (act, d) => {
        if (act === 'cancel') return d.remove();
        const payload = collectCreate(d);
        if (payload.errors.length) return toast(payload.errors.join('；'));
        try {
          const r = await createSurvey(payload.value);
          d.remove();
          toast(`已创建草稿「${r.survey.title}」（发布后生效）`);
          tab = 'mine';
          mainTabs.forEach((x) => {
            const on = x.dataset.tab === 'mine';
            x.classList.toggle('active', on);
            x.setAttribute('aria-selected', on ? 'true' : 'false');
          });
          load();
        } catch (ex) { toast(ex.message); }
      },
    });

    /* ---- 手动绑定（踩坑 #01） ---- */
    const dlg = container.querySelector('.leave-wizard');
    // kind 切换
    dlg.querySelectorAll('.sv-kind-tabs button').forEach((b) => b.addEventListener('click', () => {
      dlg.querySelectorAll('.sv-kind-tabs button').forEach((x) => {
        const on = x === b;
        x.classList.toggle('active', on);
        x.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      dlg.querySelectorAll('.sv-pane').forEach((p) => { p.hidden = p.dataset.p !== (b.dataset.k === 'vote' ? 'v' : 'q'); });
    }));
    // 匿名 chips（互斥单选）
    dlg.querySelectorAll('.sv-opt[data-anon]').forEach((c) => c.addEventListener('click', () => {
      dlg.querySelectorAll('.sv-opt[data-anon]').forEach((x) => x.classList.toggle('on', x === c));
    }));
    // 受众切换显隐
    const audSel = dlg.querySelector('#svAudience');
    if (audSel) audSel.addEventListener('change', () => {
      const v = audSel.value;
      const clsRow = dlg.querySelector('#svClassRow');
      const tchRow = dlg.querySelector('#svTeacherRow');
      if (clsRow) clsRow.hidden = !['students', 'all'].includes(v);
      if (tchRow) tchRow.hidden = !['teachers', 'all'].includes(v);
    });
    // 班级/教师定向 chips
    dlg.querySelectorAll('#svClassRow .sv-opt[data-cid], #svTeacherRow .sv-opt[data-tname]').forEach((c) => c.addEventListener('click', () => c.classList.toggle('on')));
    // 规则开关 chips（独立 toggle）
    dlg.querySelectorAll('.sv-opt[data-sw]').forEach((c) => c.addEventListener('click', () => c.classList.toggle('on')));
    // 查看范围 chips（独立 toggle）
    dlg.querySelectorAll('#svVisStats .sv-opt, #svVisDetail .sv-opt').forEach((c) => c.addEventListener('click', () => c.classList.toggle('on')));
    // 题目设计器（v2 九类题型+每类专属控件+显示条件编辑器——S20）
    const Q_TYPES = [
      ['single', '单选题'], ['multi', '多选题'], ['dropdown', '下拉题'], ['sort', '排序题'],
      ['text', '填空题'], ['textarea', '多行文本'], ['scale', '量表题'], ['matrix', '矩阵题'], ['file', '附件题'],
    ];
    const TEXT_FORMAT_OPTS = [['any', '任意文本'], ['number', '数字'], ['date', '日期'], ['phone', '手机号'], ['email', '邮箱']];
    const qList = dlg.querySelector('#svQList');
    /** 题型专属编辑区 HTML（按 type 切换重渲染；rows/cols/scale 为编辑态，收集时读输入） */
    const typeEditorHtml = (type) => {
      if (['single', 'multi', 'dropdown', 'sort'].includes(type)) {
        return `<div class="sv-q-opts"><div class="sv-opt-row"><input class="aca-input sv-q-opt" placeholder="选项 1" maxlength="50" /><button type="button" class="btn ghost compact" data-optdel>${icon('x')}</button></div><div class="sv-opt-row"><input class="aca-input sv-q-opt" placeholder="选项 2" maxlength="50" /><button type="button" class="btn ghost compact" data-optdel>${icon('x')}</button></div></div>
          <button type="button" class="btn ghost compact sv-opt-add" style="margin-top:4px">${icon('plus')}加选项</button>
          ${type !== 'sort' ? `<label class="sv-q-req" style="margin-top:4px"><input type="checkbox" class="sv-q-otherck" />启用「其他（请说明）」补充填空</label>` : ''}
          ${type === 'multi' ? `<div class="sv-opt-row" style="margin-top:4px"><span class="sv-hint" style="flex:0 0 110px">选数限制</span><input class="aca-input sv-q-minsel" type="number" min="1" placeholder="最少" style="flex:1" /><span class="sv-hint">~</span><input class="aca-input sv-q-maxsel" type="number" min="1" placeholder="最多" style="flex:1" /><span class="sv-hint">（空=不限）</span></div>` : ''}
          ${type === 'single' ? '<div style="margin-top:4px"><button type="button" class="btn ghost compact sv-yesno-gen">一键生成 是/否 选项</button></div>' : ''}`;
      }
      if (type === 'text') {
        return `<div class="sv-opt-row" style="margin-top:4px"><span class="sv-hint" style="flex:0 0 70px">格式校验</span><select class="aca-input sv-q-format">${TEXT_FORMAT_OPTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>`;
      }
      if (type === 'scale') {
        return `<div class="sv-opt-row" style="margin-top:4px"><span class="sv-hint" style="flex:0 0 70px">档位</span><input class="aca-input sv-q-smin" type="number" value="1" min="0" max="9" style="flex:0 0 60px" /><span class="sv-hint">~</span><input class="aca-input sv-q-smax" type="number" value="5" min="1" max="10" style="flex:0 0 60px" /><span class="sv-hint">分</span></div>
          <div class="sv-opt-row" style="margin-top:4px"><span class="sv-hint" style="flex:0 0 70px">左端标签</span><input class="aca-input sv-q-slow" maxlength="12" placeholder="如：很不满意" style="flex:1" /></div>
          <div class="sv-opt-row" style="margin-top:4px"><span class="sv-hint" style="flex:0 0 70px">右端标签</span><input class="aca-input sv-q-shigh" maxlength="12" placeholder="如：很满意" style="flex:1" /></div>
          <div class="sv-opt-row" style="margin-top:4px"><span class="sv-hint" style="flex:0 0 70px">样式</span><select class="aca-input sv-q-sskin"><option value="radio">单选钮</option><option value="star">星级</option><option value="nps">NPS(0-10)</option></select></div>`;
      }
      if (type === 'matrix') {
        return `<div class="wizard-label" style="margin-top:6px">行（子题，1–10）：</div><div class="sv-mx-rows"><div class="sv-opt-row"><input class="aca-input sv-mx-row" placeholder="行 1（如：教学质量）" maxlength="30" /><button type="button" class="btn ghost compact" data-rowdel>${icon('x')}</button></div></div><button type="button" class="btn ghost compact sv-mx-row-add" style="margin-top:4px">${icon('plus')}加行</button>
          <div class="wizard-label" style="margin-top:6px">列（2–7）：</div><div class="sv-mx-cols"><div class="sv-opt-row"><input class="aca-input sv-mx-col" placeholder="列 1（如：满意）" maxlength="12" /><button type="button" class="btn ghost compact" data-coldel>${icon('x')}</button></div><div class="sv-opt-row"><input class="aca-input sv-mx-col" placeholder="列 2（如：一般）" maxlength="12" /><button type="button" class="btn ghost compact" data-coldel>${icon('x')}</button></div></div><button type="button" class="btn ghost compact sv-mx-col-add" style="margin-top:4px">${icon('plus')}加列</button>
          <div class="sv-opt-row" style="margin-top:4px"><span class="sv-hint" style="flex:0 0 70px">模式</span><select class="aca-input sv-mx-mode"><option value="single">单选列</option><option value="scale">量表列（每行打分）</option></select></div>`;
      }
      if (type === 'file') {
        return '<div class="sv-hint" style="margin-top:4px">答题者可上传附件（图片等，每题最多 3 个）。</div>';
      }
      return '<div class="sv-hint" style="margin-top:4px">长文本作答（≤500 字）。</div>';
    };
    /** 显示条件编辑区（多行 且/或；来源题=本题之前的单选/多选/下拉） */
    const condEditorHtml = (idx) => `
      <div class="sv-cond" data-cond>
        <button type="button" class="btn ghost compact sv-cond-toggle" style="margin-top:6px">${icon('trend')}显示条件：始终显示</button>
        <div class="sv-cond-body" hidden>
          <div class="sv-opt-row" style="margin-top:4px"><span class="sv-hint" style="flex:0 0 70px">组合</span>
            <select class="aca-input sv-cond-op" style="flex:0 0 84px"><option value="and">全部满足（且）</option><option value="or">任一满足（或）</option></select></div>
          <div class="sv-cond-rules"></div>
          <button type="button" class="btn ghost compact sv-cond-addrule" style="margin-top:4px">${icon('plus')}加条件</button>
          <div class="sv-hint sv-cond-preview" style="margin-top:4px"></div>
        </div>
      </div>`;
    /** 单条条件行（来源题下拉+触发选项 chips）——needs: 之前的选择类题集合 */
    const condRuleHtml = (srcCandidates) => `
      <div class="sv-cond-rule" style="margin-top:4px">
        <select class="aca-input sv-cond-src" style="flex:1">${srcCandidates.length ? srcCandidates.map(([qid, label, opts]) => `<option value="${esc(qid)}">${esc(label)}</option>`).join('') : '<option value="">（之前无可选作条件的题目）</option>'}</select>
        <span class="sv-hint">选中</span>
        <div class="chip-row sv-cond-vals" style="flex:2"></div>
        <button type="button" class="btn danger compact" data-ruledel>${icon('x')}</button>
      </div>`;
    /** 收集"本题之前的题"（供条件来源下拉；含其选项以联动 chips）
     *  ⚠ 严禁用 qList.compareDocumentPosition(b, excludeBlock)——后代组合场景返回 CONTAINED_BY|FOLLOWING(20)
     *    导致 PRECEDING 位恒假（S20 实测踩坑）；改用 children 索引序比较 */
    const prevQuestions = (excludeBlock) => {
      const all = Array.from(qList.querySelectorAll('.sv-q-block'));
      const myIdx = all.indexOf(excludeBlock);
      return all.slice(0, Math.max(0, myIdx))
        .map((b) => {
          const t = b.querySelector('.sv-q-type')?.value;
          if (!['single', 'multi', 'dropdown'].includes(t)) return null;
          const title = b.querySelector('.sv-q-title')?.value.trim() || b.querySelector('.sv-q-title')?.placeholder || '未命名';
          const idx = all.indexOf(b) + 1;
          const opts = Array.from(b.querySelectorAll('.sv-q-opt')).map((i) => i.value.trim()).filter(Boolean);
          return [`q${idx}`, `Q${idx} ${title}`, opts];
        })
        .filter(Boolean);
    };

    const bindQBlock = (div) => {
      const typeSel = div.querySelector('.sv-q-type');
      const editorBox = div.querySelector('.sv-q-editor');
      const renderEditor = () => { editorBox.innerHTML = typeEditorHtml(typeSel.value); bindEditorControls(div, typeSel.value); };
      typeSel.addEventListener('change', renderEditor);
      renderEditor();
    };
    const bindEditorControls = (div, type) => {
      // 选项行增删（选择类）
      const optsBox = div.querySelector('.sv-q-opts');
      if (optsBox) {
        const bindOpt = (row) => row.querySelector('[data-optdel]')?.addEventListener('click', () => row.remove());
        div.querySelectorAll('.sv-q-opts .sv-opt-row').forEach(bindOpt);
        const addBtn = div.querySelector('.sv-opt-add');
        if (addBtn) {
          addBtn.addEventListener('click', () => {
            const row = document.createElement('div');
            row.className = 'sv-opt-row';
            row.innerHTML = `<input class="aca-input sv-q-opt" placeholder="选项 ${optsBox.querySelectorAll('.sv-opt-row').length + 1}" maxlength="50" /><button type="button" class="btn ghost compact" data-optdel>${icon('x')}</button>`;
            bindOpt(row);
            optsBox.appendChild(row);
          });
        }
        // 一键生成 是/否
        div.querySelector('.sv-yesno-gen')?.addEventListener('click', () => {
          const inputs = Array.from(optsBox.querySelectorAll('.sv-q-opt'));
          inputs[0].value = '是';
          if (inputs[1]) inputs[1].value = '否';
        });
      }
      // 矩阵行/列增删
      const rowsBox = div.querySelector('.sv-mx-rows');
      const colsBox = div.querySelector('.sv-mx-cols');
      if (rowsBox) div.querySelector('.sv-mx-row-add')?.addEventListener('click', () => {
        const row = document.createElement('div');
        row.className = 'sv-opt-row';
        row.innerHTML = `<input class="aca-input sv-mx-row" placeholder="行 ${rowsBox.children.length + 1}" maxlength="30" /><button type="button" class="btn ghost compact" data-rowdel>${icon('x')}</button>`;
        row.querySelector('[data-rowdel]').addEventListener('click', () => row.remove());
        rowsBox.appendChild(row);
      });
      if (colsBox) div.querySelector('.sv-mx-col-add')?.addEventListener('click', () => {
        const row = document.createElement('div');
        row.className = 'sv-opt-row';
        row.innerHTML = `<input class="aca-input sv-mx-col" placeholder="列 ${colsBox.children.length + 1}" maxlength="12" /><button type="button" class="btn ghost compact" data-coldel>${icon('x')}</button>`;
        row.querySelector('[data-coldel]').addEventListener('click', () => row.remove());
        colsBox.appendChild(row);
      });
      div.querySelectorAll('[data-rowdel]').forEach((b) => b.addEventListener('click', () => b.closest('.sv-opt-row').remove()));
      div.querySelectorAll('[data-coldel]').forEach((b) => b.addEventListener('click', () => b.closest('.sv-opt-row').remove()));
      // NPS 皮肤联动档位
      const skinSel = div.querySelector('.sv-q-sskin');
      if (skinSel) skinSel.addEventListener('change', () => {
        const smin = div.querySelector('.sv-q-smin'); const smax = div.querySelector('.sv-q-smax');
        if (skinSel.value === 'nps') { smin.value = '0'; smax.value = '10'; smin.disabled = true; smax.disabled = true; }
        else { smin.disabled = false; smax.disabled = false; }
      });
    };
    /** 绑定显示条件编辑器（折叠+规则行增删+预览） */
    const bindCondEditor = (div) => {
      const toggle = div.querySelector('.sv-cond-toggle');
      const body = div.querySelector('.sv-cond-body');
      const rulesBox = div.querySelector('.sv-cond-rules');
      const preview = div.querySelector('.sv-cond-preview');
      toggle.addEventListener('click', () => {
        body.hidden = !body.hidden;
        toggle.innerHTML = body.hidden ? `${icon('trend')}显示条件：始终显示` : `${icon('trend')}显示条件：配置中 ▾`;
        if (!body.hidden && !rulesBox.children.length) addRule();
        syncPreview();
      });
      const addRule = () => {
        const row = document.createElement('div');
        row.innerHTML = condRuleHtml([]); // 候选惰性求值（实时重算——快照会漏掉展开后才填的题，S20 实测踩坑）
        rulesBox.appendChild(row.firstElementChild);
        bindRule(rulesBox.lastElementChild);
      };
      const bindRule = (ruleEl) => {
        const srcSel = ruleEl.querySelector('.sv-cond-src');
        const valsBox = ruleEl.querySelector('.sv-cond-vals');
        const refreshSrc = () => {
          const cands = prevQuestions(div);
          const cur = srcSel.value;
          srcSel.innerHTML = cands.length ? cands.map(([qid, label]) => `<option value="${esc(qid)}">${esc(label)}</option>`).join('') : '<option value="">（之前无可选作条件的题目）</option>';
          if (cands.some((c) => c[0] === cur)) srcSel.value = cur; // 保留已选
          fillVals();
        };
        const fillVals = () => {
          const cands = prevQuestions(div);
          const cand = cands.find((c) => c[0] === srcSel.value);
          const prevOn = new Set(Array.from(valsBox.querySelectorAll('.sv-cond-val.on')).map((c) => c.dataset.val));
          valsBox.innerHTML = cand ? [...cand[2], '__other__'].map((o) => `<button type="button" class="sv-opt sv-cond-val${prevOn.has(o) ? ' on' : ''}" data-val="${esc(o)}">${o === '__other__' ? '其他' : esc(o)}</button>`).join('') : '';
          valsBox.querySelectorAll('.sv-cond-val').forEach((c) => c.addEventListener('click', () => { c.classList.toggle('on'); syncPreview(); }));
          syncPreview();
        };
        srcSel.addEventListener('change', fillVals);
        srcSel.addEventListener('click', refreshSrc); // 展开即重算（含其他题后填的标题/选项）
        refreshSrc();
        ruleEl.querySelector('[data-ruledel]')?.addEventListener('click', () => { ruleEl.remove(); syncPreview(); });
      };
      div.querySelector('.sv-cond-addrule')?.addEventListener('click', addRule);
      const syncPreview = () => {
        if (body.hidden) { preview.textContent = ''; return; }
        const op = div.querySelector('.sv-cond-op').value;
        const parts = Array.from(rulesBox.children).map((ruleEl) => {
          const srcSel = ruleEl.querySelector('.sv-cond-src');
          const label = srcSel.selectedOptions[0]?.textContent || '?';
          const on = Array.from(ruleEl.querySelectorAll('.sv-cond-val.on')).map((c) => c.dataset.val === '__other__' ? '「其他」' : `「${c.dataset.val}」`);
          return on.length ? `${label} 选 ${on.join(' / ')}` : null;
        }).filter(Boolean);
        preview.textContent = parts.length ? `仅当 ${parts.join(op === 'or' ? ' 或 ' : ' 且 ')} 时显示本题` : '尚未配置条件（本题将始终显示）';
      };
      div.querySelector('.sv-cond-op').addEventListener('change', syncPreview);
      syncPreview();
    };
    const addQ = () => {
      const i = qList.children.length + 1;
      const div = document.createElement('div');
      div.className = 'sv-q-block';
      div.innerHTML = `
        <div class="sv-q-head">
          <select class="aca-input sv-q-type">${Q_TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
          <input class="aca-input sv-q-title" placeholder="第 ${i} 题标题（必填）" maxlength="100" />
          <label class="sv-q-req"><input type="checkbox" class="sv-q-reqck" checked />必填</label>
          <button type="button" class="btn danger compact" data-qdel>${icon('x')}删除</button>
        </div>
        <div class="sv-q-editor"></div>
        ${condEditorHtml(i)}`;
      qList.appendChild(div);
      bindQBlock(div);
      bindCondEditor(div);
      div.querySelector('[data-qdel]').addEventListener('click', () => div.remove());
    };
    dlg.querySelector('#svAddQ')?.addEventListener('click', addQ);
    addQ(); // 默认一题（单选）
    // 投票选项设计器
    const oList = dlg.querySelector('#svOptList');
    const addOptRow = (label = '') => {
      const row = document.createElement('div');
      row.className = 'sv-opt-row';
      row.style.marginTop = '6px';
      row.innerHTML = `<input class="aca-input sv-v-opt" placeholder="选项 ${oList.children.length + 1}" maxlength="50" value="${esc(label)}" /><button type="button" class="btn ghost compact" data-optdel>${icon('x')}</button>`;
      row.querySelector('[data-optdel]').addEventListener('click', () => row.remove());
      oList.appendChild(row);
    };
    dlg.querySelector('#svAddOpt')?.addEventListener('click', () => addOptRow());
    addOptRow(); addOptRow(); // 默认两项

    /* ---- 收集 payload ---- */
    const collectCreate = (d) => {
      const errors = [];
      const kind = d.querySelector('.sv-kind-tabs button.active')?.dataset.k || 'questionnaire';
      const title = d.querySelector('#svTitle').value.trim();
      if (!title) errors.push('请填写标题');
      const anonymous = d.querySelector('.sv-opt[data-anon="1"]')?.classList.contains('on') ? 1 : 0;
      const audience = d.querySelector('#svAudience')?.value || 'students';
      const deadline = d.querySelector('#svDeadline').value || null;
      const payload = {
        kind, title, description: d.querySelector('#svDesc').value.trim(), anonymous, audience, deadline,
        visibility: {
          statsViewers: Array.from(d.querySelectorAll('#svVisStats .sv-opt.on')).map((c) => c.dataset.role),
          detailViewers: Array.from(d.querySelectorAll('#svVisDetail .sv-opt.on')).map((c) => c.dataset.role),
        },
      };
      if (!isCounselor) {
        const cids = Array.from(d.querySelectorAll('#svClassRow .sv-opt.on')).map((c) => +c.dataset.cid);
        const tnames = Array.from(d.querySelectorAll('#svTeacherRow .sv-opt.on')).map((c) => c.dataset.tname);
        if (['students', 'all'].includes(audience) && cids.length) payload.targetClassIds = cids;
        if (['teachers', 'all'].includes(audience) && tnames.length) payload.targetTeacherNames = tnames;
      }
      if (kind === 'questionnaire') {
        const questions = [];
        const blocks = Array.from(d.querySelectorAll('#svQList .sv-q-block'));
        blocks.forEach((block, idx) => {
          const type = block.querySelector('.sv-q-type').value;
          const qTitle = block.querySelector('.sv-q-title').value.trim();
          if (!qTitle) { errors.push(`第 ${idx + 1} 题缺少标题`); return; }
          const q = { id: `q${idx + 1}`, type, title: qTitle, required: block.querySelector('.sv-q-reqck').checked };
          if (['single', 'multi', 'dropdown', 'sort'].includes(type)) {
            q.options = Array.from(block.querySelectorAll('.sv-q-opt')).map((i) => i.value.trim()).filter(Boolean);
            if (q.options.length < 2) errors.push(`「${qTitle}」至少 2 个选项`);
            else if (new Set(q.options).size !== q.options.length) errors.push(`「${qTitle}」选项重复`);
            if (type !== 'sort' && block.querySelector('.sv-q-otherck')?.checked) q.otherOption = true;
            if (type === 'multi') {
              const minS = block.querySelector('.sv-q-minsel')?.value;
              const maxS = block.querySelector('.sv-q-maxsel')?.value;
              if (minS) q.minSelect = Number(minS);
              if (maxS) q.maxSelect = Number(maxS);
            }
          } else if (type === 'text') {
            q.format = block.querySelector('.sv-q-format')?.value || 'any';
          } else if (type === 'textarea') {
            void 0;
          } else if (type === 'scale') {
            const skin = block.querySelector('.sv-q-sskin')?.value || 'radio';
            const smin = skin === 'nps' ? 0 : Number(block.querySelector('.sv-q-smin')?.value || 1);
            const smax = skin === 'nps' ? 10 : Number(block.querySelector('.sv-q-smax')?.value || 5);
            if (smin >= smax) errors.push(`「${qTitle}」量表档位无效（最小须小于最大）`);
            else q.scale = { min: smin, max: smax, lowLabel: block.querySelector('.sv-q-slow')?.value.trim() || '', highLabel: block.querySelector('.sv-q-shigh')?.value.trim() || '', skin };
          } else if (type === 'matrix') {
            q.rows = Array.from(block.querySelectorAll('.sv-mx-row')).map((i, ri) => ({ id: `r${ri + 1}`, label: i.value.trim() })).filter((r) => r.label);
            q.cols = Array.from(block.querySelectorAll('.sv-mx-col')).map((i, ci) => ({ id: `c${ci + 1}`, label: i.value.trim() })).filter((c) => c.label);
            q.matrixMode = block.querySelector('.sv-mx-mode')?.value || 'single';
            if (q.rows.length < 1) errors.push(`「${qTitle}」矩阵至少 1 行`);
            if (q.cols.length < 2) errors.push(`「${qTitle}」矩阵至少 2 列`);
          } else if (type === 'file') {
            void 0;
          }
          // 显示条件收集
          const condBody = block.querySelector('.sv-cond-body');
          if (condBody && !condBody.hidden) {
            const rules = Array.from(condBody.querySelectorAll('.sv-cond-rule')).map((ruleEl) => {
              const srcId = ruleEl.querySelector('.sv-cond-src')?.value;
              const vals = Array.from(ruleEl.querySelectorAll('.sv-cond-val.on')).map((c) => c.dataset.val);
              return srcId && vals.length ? { questionId: srcId, optionValues: vals } : null;
            }).filter(Boolean);
            if (rules.length) q.visibleWhen = { op: condBody.querySelector('.sv-cond-op')?.value || 'and', rules };
            else errors.push(`「${qTitle}」已展开显示条件但未配置规则`);
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
          votesPerPerson: Math.max(1, Math.min(10, Number(d.querySelector('#svVpp').value) || 1)),
          allowRepeatOption: d.querySelector('.sv-opt[data-sw="repeat"]').classList.contains('on'),
          allowRevote: d.querySelector('.sv-opt[data-sw="revote"]').classList.contains('on'),
          resultVisibility: d.querySelector('#svResultVis').value,
        };
      }
      return { errors, value: payload };
    };
  };
  container.querySelector('#svCreateBtn')?.addEventListener('click', openCreate);

  /* ---------- SSE 实时（发布/关闭/催填 → toast+刷新） ---------- */
  ssePubOff = context.eventBus.on('sse:surveyPublished', (p) => {
    if (isRespondent) toast(`新${p?.kind === 'vote' ? '投票' : '问卷'}：${p?.title || ''}`);
    load();
  });
  sseClosedOff = context.eventBus.on('sse:surveyClosed', (p) => {
    toast(`问卷已关闭：${p?.title || ''}`);
    load();
  });
  sseRemindOff = context.eventBus.on('sse:surveyReminded', (p) => {
    if (isRespondent) toast(`催填提醒：${p?.title || ''}`);
    load();
  });

  load();
}

export async function unmount(container) {
  [ssePubOff, sseClosedOff, sseRemindOff].forEach((off) => { if (off) off(); });
  ssePubOff = sseClosedOff = sseRemindOff = null;
  container.innerHTML = '';
  container.classList.remove('mod-survey');
}
