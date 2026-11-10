import { db, now } from '../core/db.js';
import { readRole, readName } from '../core/http-utils.js';
import { pub } from '../core/pub.js';
import { listTeacherNames } from './academic.js';
import { counselorBoundClasses } from './violations.js';

/**
 * 问卷与投票 API（开发计划《问卷与投票版块-注入式设计.md》§2–§4，2026-10-30）
 * ---------------------------------------------------------------------------
 * 三表：surveys（问卷/投票统一主表）+ survey_responses（问卷作答，一卷一填）+
 *       survey_ballots（投票票记录，同选项累计票数；改票=事务内删旧插新整体覆盖）。
 * 十端点：POST /api/surveys（创建）｜GET /api/surveys（按角色分支列表）｜GET /:id（详情）
 *        POST /:id/publish｜close｜submit｜vote｜remind｜GET /:id/stats｜DELETE /:id
 * 口径（§0）：发起=学生处/教务处/IT（任意受众）+导员（仅绑定班）；受众=学生(全部/按班)/
 *        教师(全部/按账号)/师生；每卷可匿名（明细对任何人不可见，仅分布+已填名单）；
 *        实名明细可见角色由发起人 visibility 配置（发起人+IT 恒可见统计）；
 *        投票四开关：每人票数 N / 允许重复投同项 / 允许改票 / 结果可见性(after-vote|owner)。
 * 角色头：x-zkt-role / x-zkt-name（URI 编码，见 http-utils.js 单源）。
 */

/* ⚠ 严禁删除本建表块（C1 实锤：workflow 建表曾意外丢失致新库缺表） */
db.exec(`
CREATE TABLE IF NOT EXISTS surveys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('questionnaire','vote')),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  anonymous INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','closed')),
  questions TEXT NOT NULL DEFAULT '[]',
  vote_config TEXT,
  audience TEXT NOT NULL DEFAULT 'students' CHECK (audience IN ('students','teachers','all')),
  target_class_ids TEXT,
  target_teacher_names TEXT,
  visibility TEXT NOT NULL DEFAULT '{}',
  deadline TEXT,
  created_by TEXT NOT NULL,
  created_role TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  published_at TEXT,
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sv_status ON surveys (status, created_at);
CREATE TABLE IF NOT EXISTS survey_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id INTEGER NOT NULL,
  respondent_type TEXT NOT NULL CHECK (respondent_type IN ('student','teacher')),
  respondent_id TEXT NOT NULL,
  answers TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (survey_id, respondent_type, respondent_id)
);
CREATE INDEX IF NOT EXISTS idx_sr_survey ON survey_responses (survey_id);
CREATE TABLE IF NOT EXISTS survey_ballots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id INTEGER NOT NULL,
  respondent_type TEXT NOT NULL CHECK (respondent_type IN ('student','teacher')),
  respondent_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  vote_count INTEGER NOT NULL DEFAULT 1 CHECK (vote_count >= 1),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT,
  UNIQUE (survey_id, respondent_type, respondent_id, option_id)
);
CREATE INDEX IF NOT EXISTS idx_sb_survey ON survey_ballots (survey_id);
`);

/* ================= 工具 ================= */

const CREATE_ROLES = ['学生处', '教务处', 'IT管理员', '导员'];
const RESPONDENT_ROLES = ['学生', '教师'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const pad2 = (n) => String(n).padStart(2, '0');
/** 本地时间 'YYYY-MM-DD HH:MM:SS'（与表内 datetime('now','localtime') 同风格；严禁 toISOString——UTC 偏移坑） */
function localNow() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
/** 本地时间 'YYYY-MM-DDTHH:MM'（与 deadline 存储格式一致，用于过期比较） */
function localNowMin() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
const parseJSON = (s, fallback) => { try { const v = JSON.parse(s); return v == null ? fallback : v; } catch { return fallback; } };
const classNamer = (id) => { const r = db.prepare('SELECT name FROM classes WHERE id = ?').get(id); return r ? r.name : `#${id}` };

/** 行输出契约（前后端唯一） */
function rowOut(r) {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    description: r.description || '',
    anonymous: !!r.anonymous,
    status: r.status,
    questions: parseJSON(r.questions, []),
    voteConfig: r.kind === 'vote' ? parseJSON(r.vote_config, null) : null,
    audience: r.audience,
    targetClassIds: parseJSON(r.target_class_ids, null),
    targetClassNames: parseJSON(r.target_class_ids, null)?.map((cid) => classNamer(cid)) || null,
    targetTeacherNames: parseJSON(r.target_teacher_names, null),
    visibility: parseJSON(r.visibility, {}),
    deadline: r.deadline || null,
    deadlinePassed: !!(r.deadline && r.deadline <= localNowMin()),
    createdBy: r.created_by,
    createdRole: r.created_role,
    createdAt: r.created_at,
    publishedAt: r.published_at || null,
    closedAt: r.closed_at || null,
  };
}

/** 受众判定（仅 published 且角色为学生/教师时可为 true） */
function isAudience(row, role, name) {
  if (row.status !== 'published') return false;
  if (role === '学生') {
    if (!['students', 'all'].includes(row.audience)) return false;
    const targets = row.targetClassIds;
    if (!targets || !targets.length) return true; // 全部学生
    const stu = db.prepare('SELECT class_id FROM students WHERE id = ?').get(name);
    return !!stu && targets.includes(stu.class_id);
  }
  if (role === '教师') {
    if (!['teachers', 'all'].includes(row.audience)) return false;
    const targets = row.targetTeacherNames;
    if (!targets || !targets.length) return true; // 全部教师
    return targets.includes(name);
  }
  return false;
}

/** 统计可见：发起人本人 / IT / visibility.statsViewers 含角色 */
function canViewStats(row, role, name) {
  if (role === 'IT管理员') return true;
  if (row.createdBy === name) return true;
  return ((row.visibility || {}).statsViewers || []).includes(role);
}
/** 实名明细可见：匿名卷对任何人 false；发起人/IT/visibility.detailViewers */
function canViewDetail(row, role, name) {
  if (row.anonymous) return false;
  if (role === 'IT管理员') return true;
  if (row.createdBy === name) return true;
  return ((row.visibility || {}).detailViewers || []).includes(role);
}
const isOwner = (row, role, name) => role === 'IT管理员' || row.createdBy === name;

/** 受答人（学生/教师）作答/投票状态 */
function myStatus(row, role, name) {
  const type = role === '学生' ? 'student' : 'teacher';
  if (row.kind === 'questionnaire') {
    const resp = db.prepare('SELECT answers FROM survey_responses WHERE survey_id = ? AND respondent_type = ? AND respondent_id = ?').get(row.id, type, name);
    return { filled: !!resp, myAnswers: resp ? parseJSON(resp.answers, []) : null };
  }
  const ballots = db.prepare('SELECT option_id, vote_count FROM survey_ballots WHERE survey_id = ? AND respondent_type = ? AND respondent_id = ?').all(row.id, type, name);
  return { voted: ballots.length > 0, myChoices: ballots.map((b) => ({ optionId: b.option_id, count: b.vote_count })) };
}

/** 学生受众全集（定向班或全部；导员传 bound 时收窄） */
function studentUniverse(row, bound = null) {
  const targets = row.targetClassIds;
  let rows;
  if (targets && targets.length) {
    rows = db.prepare(`SELECT s.id, s.name, s.class_id FROM students s WHERE s.class_id IN (${targets.map(() => '?').join(',')})`).all(...targets);
  } else {
    rows = db.prepare('SELECT s.id, s.name, s.class_id FROM students s').all();
  }
  if (bound && bound.length) {
    const set = new Set(bound);
    rows = rows.filter((s) => set.has(s.class_id));
  } else if (bound) {
    rows = []; // bound 为空数组=导员未绑定任何班
  }
  return rows;
}
/** 教师受众全集（定向账号或全部） */
function teacherUniverse(row) {
  const targets = row.targetTeacherNames;
  return targets && targets.length ? targets.slice() : listTeacherNames();
}

/** 投票票数汇总（含投票人数去重） */
function voteTallies(surveyId) {
  const rows = db.prepare('SELECT option_id, SUM(vote_count) AS total FROM survey_ballots WHERE survey_id = ? GROUP BY option_id').all(surveyId);
  const voters = db.prepare('SELECT COUNT(*) c FROM (SELECT DISTINCT respondent_type, respondent_id FROM survey_ballots WHERE survey_id = ?)').get(surveyId).c;
  return { tallies: rows.map((r) => ({ optionId: r.option_id, votes: r.total })), voters };
}

/* ================= 通知与 SSE（§4：三级频道定向） ================= */

function addNotification({ audienceType, key, kind, surveyId, title, detail }) {
  db.prepare(`INSERT INTO notifications (audience_type, audience_key, kind, request_id, title, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(audienceType, String(key), kind, surveyId ?? null, title, detail ?? null, now());
}
function publishFor(audienceType, key, event, data) {
  if (audienceType === 'role') pub.publishToRole(key, event, data);
  else if (audienceType === 'class') pub.publishToClass(Number(key), event, data);
  else if (audienceType === 'teacher') pub.publishToTeacher(key, event, data);
}
/** 受众频道清单（发布/关闭广播用） */
function audienceChannels(row) {
  const list = [];
  if (['students', 'all'].includes(row.audience)) {
    const targets = row.targetClassIds;
    if (targets && targets.length) targets.forEach((cid) => list.push({ audienceType: 'class', key: cid }));
    else list.push({ audienceType: 'role', key: '学生' });
  }
  if (['teachers', 'all'].includes(row.audience)) {
    const targets = row.targetTeacherNames;
    if (targets && targets.length) targets.forEach((t) => list.push({ audienceType: 'teacher', key: t }));
    else list.push({ audienceType: 'role', key: '教师' });
  }
  return list;
}
/** 广播（发布/关闭）：通知表 + SSE 同频道 */
function broadcast(row, event, kind, title, detail) {
  const payload = { surveyId: row.id, kind: row.kind, title: row.title, deadline: row.deadline };
  for (const ch of audienceChannels(row)) {
    addNotification({ audienceType: ch.audienceType, key: ch.key, kind, surveyId: row.id, title, detail });
    publishFor(ch.audienceType, ch.key, event, payload);
  }
}
/**
 * 催填（§3）：仅未填/未投者所在频道定向（导员传 bound 时学生全集收窄到绑定班）。
 * 教师按账号精确（teacher 频道逐人）；学生通知粒度为 class/role 级（notifications 无 student 维度、
 * SSE 无学生单播频道——消息文案面向"尚未填写的同学"，不点名，已填者无害）。
 */
function remindAudience(row, bound = null) {
  const event = 'survey:reminded';
  const kind = 'survey-reminded';
  const title = `催填提醒：${row.title}`;
  const detail = `尚未填写的同学请在截止时间前完成（${row.deadline ? `截止 ${row.deadline.replace('T', ' ')}` : '长期开放'}）。`;
  let reminded = 0;
  const mark = (audienceType, key) => {
    addNotification({ audienceType, key, kind, surveyId: row.id, title, detail });
    publishFor(audienceType, key, event, { surveyId: row.id, kind: row.kind, title: row.title });
    reminded += 1;
  };

  if (['students', 'all'].includes(row.audience)) {
    const universe = studentUniverse(row, bound);
    const done = new Set(
      (row.kind === 'questionnaire'
        ? db.prepare(`SELECT respondent_id FROM survey_responses WHERE survey_id = ? AND respondent_type = 'student'`).all(row.id)
        : db.prepare(`SELECT respondent_id FROM survey_ballots WHERE survey_id = ? AND respondent_type = 'student'`).all(row.id)
      ).map((r) => r.respondent_id),
    );
    const undone = universe.filter((s) => !done.has(s.id));
    if (undone.length) {
      const targeted = !!(row.targetClassIds && row.targetClassIds.length);
      const byClass = new Map();
      undone.forEach((s) => { const arr = byClass.get(s.class_id) || []; arr.push(s); byClass.set(s.class_id, arr); });
      if (!targeted && undone.length === universe.length) {
        mark('role', '学生'); // 全校问卷全员未填 → role 级一条
      } else {
        for (const [cid, stus] of byClass) {
          if (!stus.length) continue;
          if (cid == null) mark('role', '学生'); // 未分配学生 → role 兜底一条
          else mark('class', cid);
        }
      }
    }
  }
  if (['teachers', 'all'].includes(row.audience)) {
    const universe = teacherUniverse(row);
    const done = new Set(
      (row.kind === 'questionnaire'
        ? db.prepare(`SELECT respondent_id FROM survey_responses WHERE survey_id = ? AND respondent_type = 'teacher'`).all(row.id)
        : db.prepare(`SELECT respondent_id FROM survey_ballots WHERE survey_id = ? AND respondent_type = 'teacher'`).all(row.id)
      ).map((r) => r.respondent_id),
    );
    universe.filter((t) => !done.has(t)).forEach((t) => mark('teacher', t));
  }
  return { channels: reminded };
}

/* ================= 创建校验（重构 v2：九类题型+显示逻辑，开发计划《问卷出题板块重构》§1–§2） ================= */

/** 题型枚举（九类，单源——前端 api-survey.js Q_TYPE 严禁复制副本，踩坑 #05） */
const Q_TYPES = ['single', 'multi', 'dropdown', 'sort', 'text', 'textarea', 'scale', 'matrix', 'file'];
/** 带选项的题型（可作显示条件来源题） */
const OPTION_TYPES = ['single', 'multi', 'dropdown'];
/** 填空格式枚举（text 的 format 属性；原 date/number 独立题型并入于此——R1 口径） */
const TEXT_FORMATS = ['any', 'number', 'date', 'phone', 'email'];
const PHONE_RE = /^1[3-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateSurveyPayload(b, role, name) {
  const errors = [];
  const kind = String(b.kind || '');
  if (!['questionnaire', 'vote'].includes(kind)) errors.push('类型须为 questionnaire（问卷）或 vote（投票）');
  const title = String(b.title || '').trim();
  if (!title || title.length > 60) errors.push('标题必填且不超过 60 字');
  const audience = String(b.audience || 'students');
  if (!['students', 'teachers', 'all'].includes(audience)) errors.push('受众参数无效');
  let deadline = null;
  if (b.deadline != null && String(b.deadline) !== '') {
    deadline = String(b.deadline);
    if (!DATETIME_LOCAL.test(deadline)) errors.push('截止时间格式须为 YYYY-MM-DDTHH:MM');
  }
  const targetClassIds = Array.isArray(b.targetClassIds) ? [...new Set(b.targetClassIds.map(Number))] : null;
  if (targetClassIds) for (const cid of targetClassIds) {
    if (!db.prepare('SELECT id FROM classes WHERE id = ?').get(cid)) { errors.push(`班级不存在（id=${cid}）`); break; }
  }
  const targetTeacherNames = Array.isArray(b.targetTeacherNames) ? [...new Set(b.targetTeacherNames.map(String))] : null;
  if (targetTeacherNames && targetTeacherNames.length) {
    const teachers = listTeacherNames();
    for (const t of targetTeacherNames) if (!teachers.includes(t)) { errors.push(`教师不存在：${t}`); break; }
  }
  // 导员收窄（§0 Q7）：仅面向学生且定向班级 ⊆ 绑定班；未指定定向时强制填充为全部绑定班（严禁发全校）
  if (role === '导员') {
    if (audience !== 'students') errors.push('导员发起的问卷/投票仅面向学生');
    const bound = counselorBoundClasses(name);
    if (!bound.length) errors.push('您尚未绑定任何班级，无法发起');
    else if (targetClassIds && targetClassIds.length && targetClassIds.some((cid) => !bound.includes(cid))) errors.push('导员只能定向自己绑定的班级');
  }
  // visibility（查看范围；发起人/IT 恒可见，此处仅配置其他角色）
  const VIS_ROLES = ['导员', '学生处', '教务处'];
  const pick = (arr) => (Array.isArray(arr) ? [...new Set(arr.map(String))].filter((r) => VIS_ROLES.includes(r)) : []);
  const visibility = {
    statsViewers: pick(b.visibility?.statsViewers),
    detailViewers: pick(b.visibility?.detailViewers),
  };
  let questions = [];
  let voteConfig = null;
  if (kind === 'questionnaire') {
    questions = Array.isArray(b.questions) ? b.questions : [];
    if (!questions.length || questions.length > 30) errors.push('问卷须 1–30 道题');
    const seen = new Set();
    const cleaned = [];
    questions.forEach((q, i) => {
      const qid = String(q?.id || '');
      const label = `第 ${i + 1} 题「${q?.title || qid}」`;
      if (!qid) { errors.push(`第 ${i + 1} 题缺少 id`); return; }
      if (seen.has(qid)) { errors.push(`题目 id 重复：${qid}`); return; }
      const type = String(q.type || '');
      if (!Q_TYPES.includes(type)) { errors.push(`${label}题型无效（九类：单选/多选/下拉/排序/填空/多行文本/量表/矩阵/附件）`); return; }
      if (!String(q.title || '').trim() || String(q.title).length > 100) { errors.push(`${label}标题必填且不超过 100 字`); return; }
      const cq = { id: qid, type, title: String(q.title).trim(), required: !!q.required };

      // 选择类：选项 + 「其他」开关（R5）+ 多选上下限（R7）
      if (['single', 'multi', 'dropdown', 'sort'].includes(type)) {
        const opts = Array.isArray(q.options) ? q.options.map(String).map((s) => s.trim()).filter(Boolean) : [];
        if (opts.length < 2) errors.push(`${label}选项至少 2 个`);
        else if (new Set(opts).size !== opts.length) errors.push(`${label}选项重复`);
        if (opts.length > 20) errors.push(`${label}选项最多 20 个`);
        cq.options = opts;
        if (OPTION_TYPES.includes(type)) cq.otherOption = !!q.otherOption; // sort 不支持其他
        if (type === 'multi') {
          const minS = q.minSelect == null ? null : Number(q.minSelect);
          const maxS = q.maxSelect == null ? null : Number(q.maxSelect);
          if (minS != null && (!Number.isInteger(minS) || minS < 1)) errors.push(`${label}最少选数无效`);
          if (maxS != null && (!Number.isInteger(maxS) || maxS > Math.max(2, opts.length))) errors.push(`${label}最多选数无效`);
          if (minS != null && maxS != null && minS > maxS) errors.push(`${label}最少选数大于最多选数`);
          if (minS != null) cq.minSelect = minS;
          if (maxS != null) cq.maxSelect = maxS;
        }
      }

      // 填空：格式属性（R1；原 date/number 题型并入）
      if (type === 'text') {
        const format = String(q.format || 'any');
        if (!TEXT_FORMATS.includes(format)) { errors.push(`${label}填空格式无效`); return; }
        cq.format = format;
      }
      if (type === 'textarea') void 0;

      // 量表：档位可调+两端标签+皮肤（R6）
      if (type === 'scale') {
        const sc = q.scale || {};
        const min = Number(sc.min ?? 1);
        const max = Number(sc.max ?? 5);
        if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max > 10 || max - min < 1 || max - min > 10) {
          errors.push(`${label}量表档位无效（0–10 范围且至少 2 档）`);
        }
        const skin = String(sc.skin || 'radio');
        if (!['radio', 'star', 'nps'].includes(skin)) errors.push(`${label}量表皮肤无效`);
        if (!errors.length) {
          cq.scale = {
            min, max,
            lowLabel: String(sc.lowLabel || '').slice(0, 12),
            highLabel: String(sc.highLabel || '').slice(0, 12),
            skin,
          };
        }
      }

      // 矩阵：行×列 + 模式（单选列 / 量表列）
      if (type === 'matrix') {
        const rows = Array.isArray(q.rows) ? q.rows.map((r) => ({ id: String(r?.id || ''), label: String(r?.label || '').trim() })).filter((r) => r.id && r.label) : [];
        const cols = Array.isArray(q.cols) ? q.cols.map((c) => ({ id: String(c?.id || ''), label: String(c?.label || '').trim() })).filter((c) => c.id && c.label) : [];
        if (rows.length < 1 || rows.length > 10) errors.push(`${label}矩阵行须 1–10 个`);
        if (cols.length < 2 || cols.length > 7) errors.push(`${label}矩阵列须 2–7 个`);
        const rowIds = new Set(rows.map((r) => r.id));
        if (rowIds.size !== rows.length) errors.push(`${label}矩阵行 id 重复`);
        const mode = String(q.matrixMode || 'single');
        if (!['single', 'scale'].includes(mode)) errors.push(`${label}矩阵模式无效`);
        if (!errors.length) { cq.rows = rows; cq.cols = cols; cq.matrixMode = mode; }
      }

      // 附件（R8：dataURL ≤3 个，前端拦大小）
      if (type === 'file') cq.maxFiles = Math.min(3, Math.max(1, Number(q.maxFiles ?? 3) || 3));

      // 显示条件（R2/R4：来源题限之前的单选/多选/下拉；规则值 ∈ 来源题选项或 __other__）
      if (q.visibleWhen != null && String(q.visibleWhen || '') !== '' && typeof q.visibleWhen === 'object') {
        const vw = q.visibleWhen;
        const op = String(vw.op || 'and');
        if (!['and', 'or'].includes(op)) errors.push(`${label}显示条件的组合方式须为且/或`);
        const rules = Array.isArray(vw.rules) ? vw.rules : [];
        if (!rules.length) errors.push(`${label}显示条件至少一条规则`);
        const cRules = [];
        rules.forEach((r, ri) => {
          const srcId = String(r?.questionId || '');
          const src = questions.findIndex((x) => String(x?.id) === srcId);
          const srcQ = src >= 0 ? questions[src] : null;
          if (!srcQ) { errors.push(`${label}第 ${ri + 1} 条条件的来源题不存在`); return; }
          if (src > i) { errors.push(`${label}显示条件只能引用本题之前的题目`); return; } // 环路防线（设计器限制+服务端复检）
          if (!OPTION_TYPES.includes(String(srcQ.type || ''))) { errors.push(`${label}条件来源题须为单选/多选/下拉题`); return; }
          const srcOpts = (srcQ.options || []).map(String);
          const vals = [...new Set((Array.isArray(r?.optionValues) ? r.optionValues : []).map(String))].filter(Boolean);
          if (!vals.length) { errors.push(`${label}第 ${ri + 1} 条条件未勾选触发选项`); return; }
          const bad = vals.filter((v) => v !== '__other__' && !srcOpts.includes(v));
          if (bad.length) { errors.push(`${label}条件选项「${bad[0]}」不在来源题选项内`); return; }
          cRules.push({ questionId: srcId, optionValues: vals });
        });
        if (cRules.length) cq.visibleWhen = { op, rules: cRules };
      }
      cleaned.push(cq);
    });
    questions = cleaned;
  } else if (kind === 'vote') {
    const vc = b.voteConfig || {};
    const options = Array.isArray(vc.options) ? vc.options : [];
    if (options.length < 2 || options.length > 20) errors.push('投票选项须 2–20 个');
    const seen = new Set();
    options.forEach((o) => {
      const oid = String(o?.id || '');
      if (!oid) { errors.push('选项缺少 id'); return; }
      if (seen.has(oid)) { errors.push(`选项 id 重复：${oid}`); return; }
      seen.add(oid);
      if (!String(o.label || '').trim() || String(o.label).length > 50) errors.push(`选项「${o.label || oid}」文字必填且不超过 50 字`);
    });
    const vpp = Number(vc.votesPerPerson ?? 1);
    if (!Number.isInteger(vpp) || vpp < 1 || vpp > 10) errors.push('每人票数须为 1–10 的整数');
    if (!['after-vote', 'owner'].includes(String(vc.resultVisibility || 'after-vote'))) errors.push('结果可见性参数无效');
    if (!errors.length) {
      voteConfig = {
        options: options.map((o) => ({ id: String(o.id), label: String(o.label).trim() })),
        votesPerPerson: vpp,
        allowRepeatOption: !!vc.allowRepeatOption,
        allowRevote: vc.allowRevote !== false, // 默认开（§0 Q8）
        resultVisibility: String(vc.resultVisibility || 'after-vote'),
      };
    }
  }
  return { errors, value: (() => {
    const v = { kind, title, description: String(b.description || '').slice(0, 300), anonymous: b.anonymous ? 1 : 0, audience, targetClassIds, targetTeacherNames, visibility, deadline, questions, voteConfig };
    if (role === '导员' && !errors.length) {
      const bound = counselorBoundClasses(name);
      v.targetClassIds = (targetClassIds && targetClassIds.length) ? targetClassIds.filter((cid) => bound.includes(cid)) : bound;
    }
    return v;
  })() };
}

/* ================= 显示逻辑引擎（§2.2：创建端与填写端共用单源；服务端 submit 消费） ================= */

/**
 * 依 answers 求全卷可见题集合（级联：来源题不可见→规则 false→依赖题隐藏；题目按序求值天然无环）。
 * answers 键为 questionId（宽松 String 化），值形态见 §1.2。
 */
function visibleQuestionSet(questions, answers) {
  const visible = new Map(); // qid -> true/false
  const ansOf = (qid) => answers[qid];
  for (const q of questions) {
    const vw = q.visibleWhen;
    if (!vw || !Array.isArray(vw.rules) || !vw.rules.length) { visible.set(String(q.id), true); continue; }
    const results = vw.rules.map((rule) => {
      // 来源题不可见/未答 → 规则 false
      if (visible.get(String(rule.questionId)) !== true) return false;
      const src = questions.find((x) => String(x.id) === String(rule.questionId));
      if (!src) return false;
      const ans = ansOf(String(rule.questionId));
      const picked = pickedOptionValues(src, ans); // 归一为字符串集合（含 __other__）
      return rule.optionValues.some((v) => picked.has(v));
    });
    const ok = vw.op === 'or' ? results.some(Boolean) : results.every(Boolean);
    visible.set(String(q.id), ok);
  }
  return visible;
}

/** 把某题答案归一为命中的选项值集合（single/dropdown：字符串或其他对象→__other__；multi：数组并集） */
function pickedOptionValues(q, ans) {
  const out = new Set();
  const addVal = (v) => {
    if (v == null || v === '') return;
    if (typeof v === 'object' && !Array.isArray(v)) { if (v.option === '__other__' || v.otherText != null) out.add('__other__'); return; }
    out.add(String(v));
  };
  if (q.type === 'multi') { (Array.isArray(ans) ? ans : []).forEach(addVal); }
  else addVal(ans);
  return out;
}

/** 问卷作答校验+过滤（v2：九类 value 契约+显示逻辑；返回 { errors, answers }——隐藏题答案强制剔除） */
function validateAnswers(questions, answers) {
  const errors = [];
  const raw = Array.isArray(answers) ? answers : [];
  const answerMap = new Map();
  for (const a of raw) {
    const qid = String(a?.questionId || '');
    if (answerMap.has(qid)) { errors.push(`题目「${qid}」重复作答`); break; }
    answerMap.set(qid, a?.value);
  }
  // 未知题目拦截
  const known = new Set(questions.map((q) => String(q.id)));
  for (const qid of answerMap.keys()) if (!known.has(qid)) { errors.push(`未知题目：${qid}`); break; }
  if (errors.length) return { errors, answers: [] };

  // 先按提交答案求可见集（用于剔除隐藏题——即使来源题此刻未答也按提交值判定）
  const submittedAsMap = {};
  for (const [k, v] of answerMap) submittedAsMap[k] = v;
  const visible = visibleQuestionSet(questions, submittedAsMap);

  // 逐题校验（仅可见题；隐藏题答案剔除）
  const out = [];
  for (const q of questions) {
    const qid = String(q.id);
    const vis = visible.get(qid) !== false;
    const v = answerMap.get(qid);
    // 空值判定：矩阵题为普通对象（键=行 id），须与"其他"对象区分（v.option==null 不能当矩阵空值——S19 实锤踩坑）
    const isEmpty = q.type === 'matrix'
      ? (v == null || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length === 0)
      : (v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && v.option == null && v.otherText == null));
    if (!vis) {
      if (!isEmpty) continue; // 隐藏题有答案 → 直接丢弃（不报错；前端绕过防线的兜底）
      continue;
    }
    if (isEmpty) {
      if (q.required) errors.push(`「${q.title}」为必填`);
      continue;
    }
    // 九类 value 校验
    if (q.type === 'single' || q.type === 'dropdown') {
      if (typeof v === 'object') {
        if (v.option !== '__other__' || !String(v.otherText || '').trim()) errors.push(`「${q.title}」其他说明必填`);
        else if (!q.otherOption) errors.push(`「${q.title}」未启用"其他"选项`);
      } else if (!q.options.includes(String(v))) errors.push(`「${q.title}」选项值无效`);
    } else if (q.type === 'multi') {
      if (!Array.isArray(v) || !v.length) errors.push(`「${q.title}」多选值无效`);
      else {
        const labels = v.map((x) => (typeof x === 'object' ? '__other__' : String(x)));
        if (new Set(labels).size !== labels.length) errors.push(`「${q.title}」多选值重复`);
        if (labels.includes('__other__')) {
          const otherObj = v.find((x) => typeof x === 'object');
          if (!q.otherOption) errors.push(`「${q.title}」未启用"其他"选项`);
          else if (!String(otherObj?.otherText || '').trim()) errors.push(`「${q.title}」其他说明必填`);
        }
        const plain = labels.filter((x) => x !== '__other__');
        if (plain.some((x) => !q.options.includes(x))) errors.push(`「${q.title}」多选选项值无效`);
        const n = labels.length;
        if (q.minSelect != null && n < q.minSelect) errors.push(`「${q.title}」至少选 ${q.minSelect} 项`);
        if (q.maxSelect != null && n > q.maxSelect) errors.push(`「${q.title}」最多选 ${q.maxSelect} 项`);
      }
    } else if (q.type === 'sort') {
      if (!Array.isArray(v) || v.length !== q.options.length || new Set(v.map(String)).size !== v.length || v.some((x) => !q.options.includes(String(x)))) {
        errors.push(`「${q.title}」排序须为全部选项的一个排列`);
      }
    } else if (q.type === 'text') {
      const s = String(v).trim();
      if (s.length > 200) errors.push(`「${q.title}」填空不超过 200 字`);
      else if (q.format === 'number' && !/^-?\d+(\.\d+)?$/.test(s)) errors.push(`「${q.title}」须为数字`);
      else if (q.format === 'date' && !DATE.test(s)) errors.push(`「${q.title}」日期格式须为 YYYY-MM-DD`);
      else if (q.format === 'phone' && !PHONE_RE.test(s)) errors.push(`「${q.title}」手机号格式无效`);
      else if (q.format === 'email' && !EMAIL_RE.test(s)) errors.push(`「${q.title}」邮箱格式无效`);
    } else if (q.type === 'textarea') {
      if (String(v).length > 500) errors.push(`「${q.title}」不超过 500 字`);
    } else if (q.type === 'scale') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < (q.scale?.min ?? 1) || n > (q.scale?.max ?? 5)) errors.push(`「${q.title}」分值须在 ${q.scale?.min ?? 1}–${q.scale?.max ?? 5} 之间`);
    } else if (q.type === 'matrix') {
      if (typeof v !== 'object' || Array.isArray(v)) errors.push(`「${q.title}」矩阵作答无效`);
      else {
        for (const r of q.rows || []) {
          const rv = v[r.id];
          if (rv == null || rv === '') { if (q.required) errors.push(`「${q.title}」行「${r.label}」未作答`); continue; }
          if (q.matrixMode === 'scale') {
            const n = Number(rv);
            if (!Number.isInteger(n) || n < 1 || n > 10) errors.push(`「${q.title}」行「${r.label}」分值须在 1–10`);
          } else {
            const col = (q.cols || []).find((c) => String(c.label) === String(rv));
            if (!col) errors.push(`「${q.title}」行「${r.label}」列值无效`);
          }
        }
        for (const k of Object.keys(v)) if (!(q.rows || []).some((r) => r.id === k)) errors.push(`「${q.title}」矩阵含未知行`);
      }
    } else if (q.type === 'file') {
      if (!Array.isArray(v) || !v.length) errors.push(`「${q.title}」附件无效`);
      else if (v.length > (q.maxFiles ?? 3)) errors.push(`「${q.title}」附件最多 ${q.maxFiles ?? 3} 个`);
      else if (v.some((x) => !String(x).startsWith('data:'))) errors.push(`「${q.title}」附件格式无效`);
    }
    if (isEmpty === false) out.push({ questionId: qid, value: v });
  }
  return { errors, answers: out };
}

/** 投票选票校验（§2 规则引擎） */
function validateChoices(vc, choices) {
  if (!Array.isArray(choices) || !choices.length) return ['请至少投 1 票'];
  const errors = [];
  const optIds = new Set(vc.options.map((o) => String(o.id)));
  const seen = new Set();
  let total = 0;
  for (const c of choices) {
    const oid = String(c?.optionId || '');
    if (!optIds.has(oid)) { errors.push(`未知选项：${oid}`); break; }
    if (seen.has(oid)) { errors.push('选项重复提交'); break; }
    seen.add(oid);
    const cnt = Number(c.count ?? 1);
    if (!Number.isInteger(cnt) || cnt < 1) { errors.push('每项票数须为正整数'); break; }
    total += cnt;
  }
  if (errors.length) return errors;
  if (total > vc.votesPerPerson) errors.push(`总票数 ${total} 超过每人 ${vc.votesPerPerson} 票上限`);
  if (!vc.allowRepeatOption && choices.some((c) => Number(c.count ?? 1) > 1)) errors.push('本投票不允许重复投同一选项');
  return errors;
}

/* ================= 端点 ================= */

export function registerSurveyRoutes(app) {
  const getRow = (id) => {
    const r = db.prepare('SELECT * FROM surveys WHERE id = ?').get(Number(id));
    return r ? rowOut(r) : null;
  };

  /* ---------- 创建（草稿） ---------- */
  app.post('/api/surveys', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    if (!CREATE_ROLES.includes(role)) return res.code(403).send({ ok: false, message: '仅学生处/教务处/导员/IT管理员可发起问卷与投票' });
    const { errors, value } = validateSurveyPayload(req.body || {}, role, name);
    if (errors.length) return res.code(400).send({ ok: false, message: errors.join('；') });
    const info = db.prepare(`INSERT INTO surveys (kind, title, description, anonymous, status, questions, vote_config, audience, target_class_ids, target_teacher_names, visibility, deadline, created_by, created_role, created_at)
      VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(value.kind, value.title, value.description, value.anonymous,
        JSON.stringify(value.questions), value.voteConfig ? JSON.stringify(value.voteConfig) : null,
        value.audience, value.targetClassIds ? JSON.stringify(value.targetClassIds) : null,
        value.targetTeacherNames ? JSON.stringify(value.targetTeacherNames) : null,
        JSON.stringify(value.visibility), value.deadline, name, role, localNow());
    console.log(`[surveys] 创建${value.kind === 'vote' ? '投票' : '问卷'}「${value.title}」#${info.lastInsertRowid}（${role} ${name}）@ ${localNow()}`);
    return { ok: true, survey: getRow(info.lastInsertRowid) };
  });

  /* ---------- 列表（按角色分支） ---------- */
  app.get('/api/surveys', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    if (!role) return res.code(403).send({ ok: false, message: '未登录' });
    const rows = db.prepare('SELECT * FROM surveys ORDER BY id DESC').all().map(rowOut);

    if (RESPONDENT_ROLES.includes(role)) {
      // 学生/教师：可填/可投列表（含我的状态）
      const list = rows.filter((r) => isAudience(r, role, name)).map((r) => ({ ...r, ...myStatus(r, role, name) }));
      return { ok: true, surveys: list };
    }
    if (role === '导员') {
      const bound = counselorBoundClasses(name);
      const mine = rows.filter((r) => r.createdBy === name);
      const visible = rows.filter((r) => r.status === 'published'
        && ['students', 'all'].includes(r.audience)
        && (!r.targetClassIds || !r.targetClassIds.length || r.targetClassIds.some((cid) => bound.includes(cid)))
        && canViewStats(r, role, name));
      return { ok: true, surveys: [...mine, ...visible.filter((v) => !mine.some((m) => m.id === v.id))], boundClassIds: bound };
    }
    // 学生处/教务处/IT：全部
    return { ok: true, surveys: rows };
  });

  /* ---------- 详情 ---------- */
  app.get('/api/surveys/:id', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    if (!role) return res.code(403).send({ ok: false, message: '未登录' });
    const row = getRow(req.params.id);
    if (!row) return res.code(404).send({ ok: false, message: '问卷不存在' });
    const staff = canViewStats(row, role, name);
    const audience = isAudience(row, role, name);
    if (!staff && !audience) return res.code(403).send({ ok: false, message: '无权查看该问卷' });
    const out = { ...row };
    if (audience) Object.assign(out, myStatus(row, role, name));
    // 投票结果可见性：after-vote=投票人投后可见；owner=仅发起人/IT/statsViewers
    if (row.kind === 'vote') {
      const voted = out.voted === true;
      const canSeeResult = staff || (row.voteConfig?.resultVisibility === 'after-vote' && voted);
      if (canSeeResult) Object.assign(out, voteTallies(row.id));
      out.resultVisible = !!canSeeResult;
    }
    return { ok: true, survey: out };
  });

  /* ---------- 发布 ---------- */
  app.post('/api/surveys/:id/publish', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    const row = getRow(req.params.id);
    if (!row) return res.code(404).send({ ok: false, message: '问卷不存在' });
    if (!isOwner(row, role, name)) return res.code(403).send({ ok: false, message: '仅发起人或IT管理员可发布' });
    if (row.status !== 'draft') return res.code(400).send({ ok: false, message: `仅草稿可发布（当前状态：${row.status}）` });
    if (row.deadline && row.deadline <= localNowMin()) return res.code(400).send({ ok: false, message: '截止时间已过，无法发布' });
    db.prepare("UPDATE surveys SET status = 'published', published_at = ? WHERE id = ? AND status = 'draft'").run(localNow(), row.id);
    const fresh = getRow(row.id);
    broadcast(fresh, 'survey:published', 'survey-published', `新${row.kind === 'vote' ? '投票' : '问卷'}：${row.title}`,
      `${row.description || '请查收填写'}${row.deadline ? `｜截止 ${row.deadline.replace('T', ' ')}` : ''}${row.anonymous ? '｜匿名' : ''}`);
    console.log(`[surveys] 发布「${row.title}」#${row.id}（受众 ${row.audience}）；操作者：${name} @ ${localNow()}`);
    return { ok: true, survey: fresh };
  });

  /* ---------- 关闭 ---------- */
  app.post('/api/surveys/:id/close', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    const row = getRow(req.params.id);
    if (!row) return res.code(404).send({ ok: false, message: '问卷不存在' });
    if (!isOwner(row, role, name)) return res.code(403).send({ ok: false, message: '仅发起人或IT管理员可关闭' });
    if (row.status !== 'published') return res.code(400).send({ ok: false, message: `仅已发布状态可关闭（当前状态：${row.status}）` });
    db.prepare("UPDATE surveys SET status = 'closed', closed_at = ? WHERE id = ? AND status = 'published'").run(localNow(), row.id);
    const fresh = getRow(row.id);
    broadcast(fresh, 'survey:closed', 'survey-closed', `问卷已关闭：${row.title}`, '该问卷/投票已停止填写。');
    console.log(`[surveys] 关闭「${row.title}」#${row.id}；操作者：${name} @ ${localNow()}`);
    return { ok: true, survey: fresh };
  });

  /* ---------- 问卷作答 ---------- */
  app.post('/api/surveys/:id/submit', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    if (!RESPONDENT_ROLES.includes(role)) return res.code(403).send({ ok: false, message: '仅学生/教师可填写问卷' });
    const row = getRow(req.params.id);
    if (!row) return res.code(404).send({ ok: false, message: '问卷不存在' });
    if (row.kind !== 'questionnaire') return res.code(400).send({ ok: false, message: '该卷为投票，请使用投票接口' });
    if (row.status !== 'published') return res.code(400).send({ ok: false, message: row.status === 'closed' ? '该问卷已关闭，停止填写' : '该问卷未发布' });
    if (!isAudience(row, role, name)) return res.code(403).send({ ok: false, message: '您不是该问卷的受众' });
    if (row.deadlinePassed) return res.code(400).send({ ok: false, message: '该问卷已过截止时间' });
    const type = role === '学生' ? 'student' : 'teacher';
    if (db.prepare('SELECT 1 FROM survey_responses WHERE survey_id = ? AND respondent_type = ? AND respondent_id = ?').get(row.id, type, name)) {
      return res.code(409).send({ ok: false, message: '您已填写过该问卷（一卷一填不可修改）' });
    }
    const answers = (req.body || {}).answers;
    const { errors, answers: cleaned } = validateAnswers(row.questions, answers);
    if (errors.length) return res.code(400).send({ ok: false, message: errors.join('；') });
    db.prepare('INSERT INTO survey_responses (survey_id, respondent_type, respondent_id, answers, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(row.id, type, name, JSON.stringify(cleaned), localNow());
    console.log(`[surveys] 作答 #${row.id}「${row.title}」：${role} ${name}（${cleaned.length} 题可见作答）@ ${localNow()}`);
    return { ok: true };
  });

  /* ---------- 投票（含改票=整体覆盖） ---------- */
  app.post('/api/surveys/:id/vote', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    if (!RESPONDENT_ROLES.includes(role)) return res.code(403).send({ ok: false, message: '仅学生/教师可投票' });
    const row = getRow(req.params.id);
    if (!row) return res.code(404).send({ ok: false, message: '投票不存在' });
    if (row.kind !== 'vote') return res.code(400).send({ ok: false, message: '该卷为问卷，请使用填写接口' });
    if (row.status !== 'published') return res.code(400).send({ ok: false, message: row.status === 'closed' ? '该投票已关闭，停止投票' : '该投票未发布' });
    if (!isAudience(row, role, name)) return res.code(403).send({ ok: false, message: '您不是该投票的受众' });
    if (row.deadlinePassed) return res.code(400).send({ ok: false, message: '该投票已过截止时间' });
    const vc = row.voteConfig || {};
    const choices = (req.body || {}).choices;
    const errors = validateChoices(vc, choices);
    if (errors.length) return res.code(400).send({ ok: false, message: errors.join('；') });
    const type = role === '学生' ? 'student' : 'teacher';
    const existing = db.prepare('SELECT 1 FROM survey_ballots WHERE survey_id = ? AND respondent_type = ? AND respondent_id = ? LIMIT 1').get(row.id, type, name);
    if (existing && !vc.allowRevote) return res.code(400).send({ ok: false, message: '您已投过票，本投票不允许改票' });
    const tx = db.transaction(() => {
      // 事务内复检发布状态（并发关闭竞态防线）
      const st = db.prepare('SELECT status FROM surveys WHERE id = ?').get(row.id);
      if (!st || st.status !== 'published') throw Object.assign(new Error('该投票已关闭'), { statusCode: 409 });
      db.prepare('DELETE FROM survey_ballots WHERE survey_id = ? AND respondent_type = ? AND respondent_id = ?').run(row.id, type, name);
      const ins = db.prepare('INSERT INTO survey_ballots (survey_id, respondent_type, respondent_id, option_id, vote_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const c of choices) ins.run(row.id, type, name, String(c.optionId), Number(c.count ?? 1), localNow(), localNow());
    });
    try { tx(); } catch (ex) {
      return res.code(ex.statusCode || 400).send({ ok: false, message: ex.message });
    }
    console.log(`[surveys] 投票 #${row.id}「${row.title}」：${role} ${name}（${existing ? '改票' : '首投'} ${choices.length} 项）@ ${localNow()}`);
    const out = { ok: true, revoted: !!existing, ...voteTallies(row.id) };
    if (vc.resultVisibility !== 'after-vote') { delete out.tallies; delete out.voters; } // owner 模式不回票数
    return out;
  });

  /* ---------- 催填提醒 ---------- */
  app.post('/api/surveys/:id/remind', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    const row = getRow(req.params.id);
    if (!row) return res.code(404).send({ ok: false, message: '问卷不存在' });
    if (row.status !== 'published') return res.code(400).send({ ok: false, message: '仅已发布状态可催填' });
    if (role === '导员') {
      const bound = counselorBoundClasses(name);
      if (!['students', 'all'].includes(row.audience)) return res.code(403).send({ ok: false, message: '该问卷不面向学生，导员无催填范围' });
      if (!canViewStats(row, role, name)) return res.code(403).send({ ok: false, message: '您无该问卷的查看权限' });
      const r = remindAudience(row, bound);
      console.log(`[surveys] 催填 #${row.id}「${row.title}」：${r.channels} 个频道（导员收窄绑定班）；操作者：${role} ${name} @ ${localNow()}`);
      return { ok: true, ...r };
    } else if (!isOwner(row, role, name)) {
      return res.code(403).send({ ok: false, message: '仅发起人/导员/IT管理员可催填' });
    }
    const r = remindAudience(row);
    console.log(`[surveys] 催填 #${row.id}「${row.title}」：${r.channels} 个频道；操作者：${role} ${name} @ ${localNow()}`);
    return { ok: true, ...r };
  });

  /* ---------- 统计 ---------- */
  app.get('/api/surveys/:id/stats', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    if (!role) return res.code(403).send({ ok: false, message: '未登录' });
    const row = getRow(req.params.id);
    if (!row) return res.code(404).send({ ok: false, message: '问卷不存在' });
    if (!canViewStats(row, role, name)) return res.code(403).send({ ok: false, message: '您无该问卷的统计查看权限' });
    const bound = role === '导员' ? counselorBoundClasses(name) : null;
    const students = ['students', 'all'].includes(row.audience) ? studentUniverse(row, bound) : [];
    const teachers = ['teachers', 'all'].includes(row.audience) ? teacherUniverse(row) : [];
    const stuIds = students.map((s) => s.id);
    const filledStu = row.kind === 'questionnaire'
      ? new Set(db.prepare(`SELECT respondent_id FROM survey_responses WHERE survey_id = ? AND respondent_type = 'student'`).all(row.id).map((r) => r.respondent_id))
      : new Set(db.prepare(`SELECT respondent_id FROM survey_ballots WHERE survey_id = ? AND respondent_type = 'student'`).all(row.id).map((r) => r.respondent_id));
    const filledTch = row.kind === 'questionnaire'
      ? new Set(db.prepare(`SELECT respondent_id FROM survey_responses WHERE survey_id = ? AND respondent_type = 'teacher'`).all(row.id).map((r) => r.respondent_id))
      : new Set(db.prepare(`SELECT respondent_id FROM survey_ballots WHERE survey_id = ? AND respondent_type = 'teacher'`).all(row.id).map((r) => r.respondent_id));
    const unfilledStudents = students.filter((s) => !filledStu.has(s.id)).map((s) => ({ id: s.id, name: s.name, className: s.class_id != null ? classNamer(s.class_id) : '未分配' }));
    const unfilledTeachers = teachers.filter((t) => !filledTch.has(t));
    const stats = {
      survey: row,
      anonymous: row.anonymous,
      respondentCount: stuIds.length + teachers.length,
      filledCount: stuIds.filter((id) => filledStu.has(id)).length + teachers.filter((t) => filledTch.has(t)).length,
      unfilledStudents, unfilledTeachers,
      canViewDetail: canViewDetail(row, role, name),
    };
    if (row.kind === 'questionnaire') {
      const respRows = db.prepare('SELECT respondent_type, respondent_id, answers, created_at FROM survey_responses WHERE survey_id = ? ORDER BY id').all(row.id);
      // 逐题分布（v2 九类适配：§1.3——单选/下拉/多选计数；排序位次；量表均值；矩阵行分布；其他文本聚合）
      const valueOf = (r, qid) => {
        const arr = parseJSON(r.answers, []);
        const hit = arr.find((a) => String(a.questionId) === String(qid));
        return hit ? hit.value : null;
      };
      const normText = (v) => {
        if (typeof v === 'object' && !Array.isArray(v)) return `其他：${String(v.otherText || '').slice(0, 40)}`;
        return String(v);
      };
      const distribution = row.questions.map((q) => {
        const values = respRows.map((r) => valueOf(r, q.id)).filter((v) => v != null && v !== '' && !(Array.isArray(v) && !v.length));
        const base = { questionId: q.id, title: q.title, type: q.type, counts: [], textValues: [] };
        if (q.type === 'single' || q.type === 'dropdown') {
          base.counts = q.options.map((opt) => ({ label: opt, count: values.filter((v) => typeof v === 'string' && v === opt).length }));
          if (q.otherOption) {
            const others = values.filter((v) => typeof v === 'object' && v.option === '__other__');
            base.counts.push({ label: '其他', count: others.length });
            base.textValues = others.map((v) => String(v.otherText || ''));
          }
          return base;
        }
        if (q.type === 'multi') {
          base.counts = q.options.map((opt) => ({ label: opt, count: values.filter((v) => Array.isArray(v) && v.some((x) => typeof x === 'string' && x === opt)).length }));
          if (q.otherOption) {
            const others = values.filter((v) => Array.isArray(v) && v.some((x) => typeof x === 'object'));
            base.counts.push({ label: '其他', count: others.length });
            base.textValues = others.map((v) => { const o = v.find((x) => typeof x === 'object'); return String(o?.otherText || ''); });
          }
          return base;
        }
        if (q.type === 'sort') {
          // 平均位次 + 被排第一的分布
          base.counts = q.options.map((opt) => {
            const positions = values.filter(Array.isArray).map((v) => v.findIndex((x) => x === opt) + 1).filter((p) => p > 0);
            const firsts = positions.filter((p) => p === 1).length;
            return { label: opt, count: firsts, avgRank: positions.length ? Math.round((positions.reduce((s, p) => s + p, 0) / positions.length) * 100) / 100 : null };
          });
          return base;
        }
        if (q.type === 'scale') {
          const nums = values.map(Number).filter(Number.isFinite);
          const min = q.scale?.min ?? 1;
          const max = q.scale?.max ?? 5;
          base.avg = nums.length ? Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 100) / 100 : null;
          base.scale = q.scale || null;
          base.counts = [];
          for (let n = min; n <= max; n++) base.counts.push({ label: String(n), count: nums.filter((x) => x === n).length });
          return base;
        }
        if (q.type === 'matrix') {
          // 每行（子题）独立分布/均值
          base.rows = (q.rows || []).map((r) => {
            const rv = respRows.map((resp) => {
              const v = valueOf(resp, q.id);
              return v && typeof v === 'object' ? v[r.id] : null;
            }).filter((x) => x != null && x !== '');
            if (q.matrixMode === 'scale') {
              const nums = rv.map(Number).filter(Number.isFinite);
              return { rowLabel: r.label, mode: 'scale', avg: nums.length ? Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 100) / 100 : null, counts: (q.cols || []).map((c) => ({ label: c.label, count: nums.filter((n) => String(n) === String(c.label)).length })) };
            }
            return { rowLabel: r.label, mode: 'single', counts: (q.cols || []).map((c) => ({ label: c.label, count: rv.filter((x) => String(x) === String(c.label)).length })) };
          });
          return base;
        }
        if (q.type === 'file') {
          base.fileCount = values.filter(Array.isArray).reduce((s, v) => s + v.length, 0);
          return base;
        }
        // text / textarea
        base.textValues = values.map(normText);
        return base;
      });
      stats.distribution = distribution;
      // 实名明细（匿名卷恒空——canViewDetail 已含匿名判定）
      if (stats.canViewDetail) {
        const typeNames = { student: (id) => { const s = students.find((x) => x.id === id); return s ? { name: s.name, className: s.class_id != null ? classNamer(s.class_id) : '未分配' } : { name: id, className: '' }; }, teacher: (id) => ({ name: id, className: '教师' }) };
        stats.details = respRows.map((r) => ({
          respondentType: r.respondent_type,
          respondentId: r.respondent_id,
          ...(typeNames[r.respondent_type]?.(r.respondent_id) || { name: r.respondent_id, className: '' }),
          answers: parseJSON(r.answers, []),
          createdAt: r.created_at,
        }));
      }
    } else {
      stats.vote = voteTallies(row.id);
      stats.vote.options = (row.voteConfig?.options || []);
    }
    return { ok: true, stats };
  });

  /* ---------- 删除（danger：连带清作答/选票） ---------- */
  app.delete('/api/surveys/:id', async (req, res) => {
    const role = readRole(req);
    const name = readName(req);
    const row = getRow(req.params.id);
    if (!row) return res.code(404).send({ ok: false, message: '问卷不存在' });
    if (!isOwner(row, role, name)) return res.code(403).send({ ok: false, message: '仅发起人或IT管理员可删除' });
    let cleared = 0;
    const tx = db.transaction(() => {
      cleared += db.prepare('DELETE FROM survey_responses WHERE survey_id = ?').run(row.id).changes;
      cleared += db.prepare('DELETE FROM survey_ballots WHERE survey_id = ?').run(row.id).changes;
      db.prepare('DELETE FROM surveys WHERE id = ?').run(row.id);
    });
    tx();
    console.log(`[surveys] 删除「${row.title}」#${row.id}（连带清理 ${cleared} 条作答/选票）；操作者：${role} ${name} @ ${localNow()}`);
    return { ok: true, cleared };
  });
}
