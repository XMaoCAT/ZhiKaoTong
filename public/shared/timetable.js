// 课表渲染组件（开发计划 §7.1；跨模块共享件：mod-academic 教师 pane / mod-courses / mod-mobile-home 共用）
// ---------------------------------------------------------------------------
// 契约：renderTimetable(container, lessons, opts) → { refresh(lessons?), setMode(m), destroy() }
// lessons 行契约（api-timetable rowOut）：{ id, classId?, className?, teacherName, courseName, weekday(1-7),
//   start('HH:MM'), end('HH:MM'), source('base'|'add'), singleDate?, cancelled }
// opts：
//   startMin/endMin 默认 360/1320（06:00–22:00）；lunchMin 午休线 720（12:00）
//   mode 'week'|'day'（day 需 dayIndex 1-7）；compact 紧凑态（移动端）
//   highlightTeacher 只看该教师的课（开关过滤）；onCellClick 点空格（教师加课）；
//   onLessonClick 点课程（教师请假入口 / 学生看详情）
// 渲染管线：分钟级连续定位（不依赖节次粒度）；午休线；当前时间红线（30s 重算，非今日列不渲染）；
//   正在上课 .tt-ongoing 描边；cancelled 置灰标"停课"；add 课角标"加"。
// 定时器生命周期：interval 存 handle，模块 unmount 必调 handle.destroy()（防泄漏铁律）。

const WEEK_LABELS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const toMin = (t) => Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5));
const pad2 = (n) => String(n).padStart(2, '0');

export function renderTimetable(container, lessons = [], opts = {}) {
  const cfg = {
    startMin: 360,
    endMin: 1320,
    lunchMin: 720,
    mode: opts.mode || 'week',
    dayIndex: opts.dayIndex || 1,
    compact: !!opts.compact,
    highlightTeacher: opts.highlightTeacher || null,
    onCellClick: opts.onCellClick || null,
    onLessonClick: opts.onLessonClick || null,
  };
  let data = lessons.slice();
  let destroyed = false;
  let tickTimer = null;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function build() {
    if (destroyed) return;
    const range = cfg.endMin - cfg.startMin; // 960
    const days = cfg.mode === 'week' ? [1, 2, 3, 4, 5, 6, 7] : [cfg.dayIndex];
    const today = new Date();
    const todayWd = today.getDay() === 0 ? 7 : today.getDay();
    const nowMin = today.getHours() * 60 + today.getMinutes();

    // 课程过滤（教师开关）
    const filtered = cfg.highlightTeacher ? data.filter((l) => l.teacherName === cfg.highlightTeacher) : data;

    // 时间轴刻度（每 2h）
    const axisMarks = [];
    for (let m = cfg.startMin; m <= cfg.endMin; m += 120) axisMarks.push(`<div class="tt-axis-mark" style="top:${((m - cfg.startMin) / range) * 100}%">${pad2(Math.floor(m / 60))}:${pad2(m % 60)}</div>`);

    const cols = days.map((wd) => {
      const dayLessons = filtered.filter((l) => l.weekday === wd);
      const boxes = dayLessons.map((l) => {
        const s = Math.max(toMin(l.start), cfg.startMin);
        const e = Math.min(toMin(l.end), cfg.endMin);
        if (e <= s) return '';
        const top = ((s - cfg.startMin) / range) * 100;
        const height = ((e - s) / range) * 100;
        const ongoing = wd === todayWd && nowMin >= s && nowMin < e && !l.cancelled;
        return `
        <div class="tt-box${l.cancelled ? ' cancelled' : ''}${l.source === 'add' ? ' add' : ''}${ongoing ? ' tt-ongoing' : ''}"
          style="top:${top}%;height:${height}%" data-lid="${l.id}" tabindex="0" role="button"
          title="${esc(l.courseName)} ${esc(l.start)}-${esc(l.end)}${l.className ? ` · ${esc(l.className)}` : ''}${l.cancelled ? '（停课）' : ''}">
          <strong>${esc(l.courseName)}</strong>
          <span>${esc(l.start)}-${esc(l.end)}</span>
          ${cfg.mode === 'week' ? `<em>${esc(l.teacherName)}</em>` : `<em>${esc(l.className || l.teacherName)}</em>`}
          ${l.cancelled ? '<i class="tt-stopped">停课</i>' : ''}
        </div>`;
      }).join('');
      const isToday = cfg.mode === 'week' && wd === todayWd;
      // 空格点击层（教师加课入口；仅未取消课程不阻挡）
      const cellLayer = cfg.onCellClick ? `<div class="tt-cell-layer" data-wd="${wd}"></div>` : '';
      // 今日红线（仅今日列且时刻在范围内）
      const nowline = isToday && nowMin >= cfg.startMin && nowMin <= cfg.endMin
        ? `<div class="tt-nowline" style="top:${((nowMin - cfg.startMin) / range) * 100}%"></div>` : '';
      return `<div class="tt-col${isToday ? ' tt-nowcol' : ''}" data-wd="${wd}">${cellLayer}${boxes}${nowline}</div>`;
    }).join('');

    container.innerHTML = `
      <div class="tt-grid${cfg.compact ? ' compact' : ''}${cfg.mode === 'day' ? ' day-mode' : ''}" role="grid" aria-label="周课表">
        <div class="tt-axis-col">${axisMarks.join('')}</div>
        <div class="tt-head-row"><div class="tt-corner"></div>${days.map((wd) => `<div class="tt-head${wd === todayWd ? ' tt-nowcol' : ''}">${WEEK_LABELS[wd]}</div>`).join('')}</div>
        <div class="tt-body">
          <div class="tt-lunch" style="top:${((cfg.lunchMin - cfg.startMin) / range) * 100}%"></div>
          ${cols}
        </div>
      </div>`;

    // 交互绑定
    container.querySelectorAll('.tt-box').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const lesson = filtered.find((l) => String(l.id) === b.dataset.lid);
      if (lesson && cfg.onLessonClick) cfg.onLessonClick(lesson);
    }));
    if (cfg.onCellClick) {
      // 空格点击：纵坐标换算分钟（对齐 10 分钟粒度），供教师加课预填
      container.querySelectorAll('.tt-cell-layer').forEach((layer) => {
        layer.addEventListener('click', (ev) => {
          const wd = Number(layer.dataset.wd);
          const rect = layer.getBoundingClientRect();
          const ratio = (ev.clientY - rect.top) / rect.height;
          const minute = cfg.startMin + Math.round((ratio * (cfg.endMin - cfg.startMin)) / 10) * 10;
          cfg.onCellClick(wd, minute, rect);
        });
      });
    }
  }

  build();

  // 当前时间红线 30s 重算（分钟级平滑）
  tickTimer = setInterval(() => {
    if (!destroyed && container.isConnected) build();
  }, 30000);

  return {
    refresh(next) { if (Array.isArray(next)) data = next.slice(); build(); },
    setMode(m, dayIndex) { cfg.mode = m; if (dayIndex) cfg.dayIndex = dayIndex; build(); },
    destroy() { destroyed = true; if (tickTimer) clearInterval(tickTimer); tickTimer = null; container.innerHTML = ''; },
  };
}
