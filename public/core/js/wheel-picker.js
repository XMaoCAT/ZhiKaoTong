// 全局日期时间滚轮选择器（Semi UI DatePicker dateTime·wheel 风格）
// 用法：const p = createDateTimePicker({ value: '2026-10-22 08:00', onConfirm({date,time,text}) }); container.appendChild(p.el)
// value 格式 'YYYY-MM-DD HH:mm'；空则占位"请选择日期时间"，面板默认定位到当前时刻
// ⚠ v3 防抖动设计（2026-10-21 用户实测反馈"选择时抽动"）：
//   1) 禁用 CSS scroll-snap（与 JS 吸附竞争是抽动主因），吸附全由 JS 瞬时定位完成
//   2) 严禁 smooth scrollTo 吸附（动画过程持续触发 scroll→高亮反复跳变）；一律 scrollTop 直接赋值
//   3) 高亮仅在索引真正变化时更新（i !== lastIndex），滚动中不闪烁
//   4) 选中项显示单位后缀（年/月/日/时/分，Semi 风格）；.unit 常占位、opacity 显隐，避免文本变化引起布局位移
const ITEM_H = 36;

// 全局单例：点击任意空白处收起所有滚轮面板
if (typeof document !== 'undefined' && !window.__wpDocListener) {
  document.addEventListener('click', () => {
    document.querySelectorAll('.wp-panel:not([hidden])').forEach((p) => { p.hidden = true; });
  });
  window.__wpDocListener = true;
}

/**
 * 单列滚轮
 * @param items    项文本数组（纯数字）
 * @param selIndex 初始选中索引
 * @param unit     单位后缀（年/月/日/时/分）
 * @param onPick   选中变化回调（settle 后与点击时触发）
 */
function makeCol(items, selIndex, unit, onPick) {
  const col = document.createElement('div');
  col.className = 'wp-col';
  col.innerHTML = items.map((label, i) => `<div class="wp-item${i === selIndex ? ' sel' : ''}" data-i="${i}"><span class="num">${label}</span><span class="unit">${unit}</span></div>`).join('');
  const markSel = (i) => col.querySelectorAll('.wp-item').forEach((el) => { el.classList.toggle('sel', +el.dataset.i === i); });
  const nearest = () => Math.max(0, Math.min(items.length - 1, Math.round(col.scrollTop / ITEM_H)));
  let lastIndex = selIndex;
  let settleTimer = null;

  // 滚动：高亮跟随最近项；停止 140ms 后瞬时吸附到整数位并回调
  col.addEventListener('scroll', () => {
    const i = nearest();
    if (i !== lastIndex) { lastIndex = i; markSel(i); } // 仅索引变化才重绘，滚动中不闪烁
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      if (!col.isConnected) return; // 列已重建替换：丢弃过期回调（防竞态回滚）
      const target = lastIndex * ITEM_H;
      if (Math.abs(col.scrollTop - target) > 0.5) col.scrollTop = target; // 瞬时吸附，绝不用 smooth
      onPick(lastIndex);
    }, 140);
  }, { passive: true });

  // 点击项：直接瞬时定位（smooth 动画会与滚动监听互相触发造成抽动）
  col.addEventListener('click', (ev) => {
    const item = ev.target.closest('.wp-item');
    if (!item) return;
    clearTimeout(settleTimer);
    const i = +item.dataset.i;
    lastIndex = i;
    markSel(i);
    col.scrollTop = i * ITEM_H;
    onPick(i);
  });

  requestAnimationFrame(() => { col.scrollTop = selIndex * ITEM_H; });
  return col;
}

export function createDateTimePicker({ value = '', placeholder = '请选择日期时间', years = [2025, 2026, 2027, 2028], onConfirm = () => {} } = {}) {
  const pad2 = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const parse = (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/.exec(String(v || '').trim());
    return m ? { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] } : null;
  };
  let cur = parse(value) || { y: now.getFullYear(), mo: now.getMonth() + 1, d: now.getDate(), h: now.getHours(), mi: now.getMinutes() };
  let confirmed = parse(value);

  const wrap = document.createElement('div');
  wrap.className = 'wp-wrap';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'wp-trigger';
  const renderTrigger = () => {
    const text = confirmed ? `${confirmed.y}-${pad2(confirmed.mo)}-${pad2(confirmed.d)} ${pad2(confirmed.h)}:${pad2(confirmed.mi)}` : placeholder;
    trigger.innerHTML = `<span class="wp-value${confirmed ? '' : ' ph'}">${text}</span><svg class="icon small" aria-hidden="true"><use href="#i-clock"/></svg>`;
  };
  renderTrigger();
  wrap.appendChild(trigger);

  const panel = document.createElement('div');
  panel.className = 'wp-panel';
  panel.hidden = true;
  panel.addEventListener('click', (e) => e.stopPropagation());
  wrap.appendChild(panel);

  const colsBox = document.createElement('div');
  colsBox.className = 'wp-cols';
  colsBox.innerHTML = '<div class="wp-band"></div><div class="wp-mask top"></div><div class="wp-mask bottom"></div>';
  panel.appendChild(colsBox);

  const daysIn = (y, mo) => new Date(y, mo, 0).getDate();

  const buildCols = () => {
    colsBox.querySelectorAll('.wp-col').forEach((c) => c.remove());
    const dayCount = daysIn(cur.y, cur.mo);
    if (cur.d > dayCount) cur.d = dayCount;
    const mk = (key, items, sel, valOf, unit) => {
      const col = makeCol(items, sel, unit, (i) => {
        const v = valOf(i);
        if (cur[key] === v) return; // 值未变化不重建（阻断 settle→rebuild 无限循环）
        cur[key] = v;
        if (key === 'y' || key === 'mo') buildCols(); // 年/月变化 → 重建日列（天数联动）
      });
      colsBox.appendChild(col);
    };
    mk('y', years.map(String), Math.max(0, years.indexOf(cur.y)), (i) => years[i], '年');
    mk('mo', Array.from({ length: 12 }, (_, i) => pad2(i + 1)), cur.mo - 1, (i) => i + 1, '月');
    mk('d', Array.from({ length: dayCount }, (_, i) => pad2(i + 1)), cur.d - 1, (i) => i + 1, '日');
    mk('h', Array.from({ length: 24 }, (_, i) => pad2(i)), cur.h, (i) => i, '时');
    mk('mi', Array.from({ length: 60 }, (_, i) => pad2(i)), cur.mi, (i) => i, '分');
  };
  buildCols();

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (panel.hidden) {
      document.querySelectorAll('.wp-panel:not([hidden])').forEach((p) => { p.hidden = true; });
      buildCols(); // 重新定位到当前 cur
      panel.hidden = false;
    } else {
      panel.hidden = true;
    }
  });

  const foot = document.createElement('div');
  foot.className = 'wp-foot';
  foot.innerHTML = `
    <button type="button" class="wp-btn ghost" data-act="now">此刻</button>
    <button type="button" class="wp-btn ghost" data-act="cancel">取消</button>
    <button type="button" class="wp-btn primary" data-act="ok">确定</button>`;
  panel.appendChild(foot);

  foot.addEventListener('click', (ev) => {
    const act = ev.target.closest('button')?.dataset.act;
    if (!act) return;
    if (act === 'now') {
      cur = { y: now.getFullYear(), mo: now.getMonth() + 1, d: now.getDate(), h: now.getHours(), mi: now.getMinutes() };
      buildCols();
    }
    if (act === 'cancel') panel.hidden = true;
    if (act === 'ok') {
      confirmed = { ...cur };
      panel.hidden = true;
      renderTrigger();
      onConfirm({ date: `${confirmed.y}-${pad2(confirmed.mo)}-${pad2(confirmed.d)}`, time: `${pad2(confirmed.h)}:${pad2(confirmed.mi)}`, text: `${confirmed.y}-${pad2(confirmed.mo)}-${pad2(confirmed.d)} ${pad2(confirmed.h)}:${pad2(confirmed.mi)}` });
    }
  });

  return {
    el: wrap,
    getValue: () => confirmed ? `${confirmed.y}-${pad2(confirmed.mo)}-${pad2(confirmed.d)} ${pad2(confirmed.h)}:${pad2(confirmed.mi)}` : '',
  };
}
