// 学生搜索拼音匹配工具（教师「历史请假」板块搜索：姓名 / 学号 / 拼音全拼 / 拼音首字母）
// 依赖 vendor/pinyin-pro（pinyin-pro ESM 本地副本，无外网依赖）；2026-10-22 用户需求：如 张三 可输 zhangsan / zs / 姓名 / 学号 模糊搜索
import { pinyin } from './vendor/pinyin-pro/index.mjs';

/** 姓名 → { full: 'zhangsan', first: 'zs' }（小写、去空格；非汉字字符连续保留，如 学生001 → xuesheng001 / xs001） */
export function pinyinKeys(name) {
  try {
    const s = String(name || '');
    const full = pinyin(s, { toneType: 'none', type: 'string', nonZh: 'consecutive' }).replace(/\s+/g, '').toLowerCase();
    const first = pinyin(s, { pattern: 'first', toneType: 'none', type: 'string', nonZh: 'consecutive' }).replace(/\s+/g, '').toLowerCase();
    return { full, first };
  } catch { return { full: '', first: '' }; }
}

/** 学生搜索匹配：query 命中 学号 / 姓名 / 拼音全拼 / 拼音首字母 之一即返回 true（大小写不敏感；空查询恒真） */
export function studentMatch(s, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  if (String(s.id || '').includes(q)) return true;
  const name = String(s.name || '');
  if (name.toLowerCase().includes(q)) return true;
  const k = pinyinKeys(name);
  return k.full.includes(q) || k.first.includes(q);
}
