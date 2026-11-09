// Translates a job-search filter object into a parameterised SQL WHERE clause.
// All user input goes through bound parameters; LIKE wildcards are escaped.

import { canonicalSkill } from '../lib/taxonomy.mjs';

const ARRANGEMENTS = new Set(['Remote', 'Hybrid', 'WFO']);

function likeEscape(s) {
  return String(s).replace(/[\\%_]/g, (c) => `\\${c}`);
}
function list(v) {
  if (v === undefined || v === null || v === '') return [];
  if (Array.isArray(v)) return v.flatMap(list);
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * filters: { q, title, company, skills, category, bands, min_years, max_years, years,
 *            location, arrangement, salary_min, posted_within_days, source, direct_only }
 */
export function buildJobQuery(filters = {}) {
  const clauses = [];
  const params = [];
  const f = filters || {};
  if (f.q) {
    const terms = String(f.q).slice(0, 200).split(/\s+/).filter(Boolean).slice(0, 8);
    for (const t of terms) {
      clauses.push("(j.title LIKE ? ESCAPE '\\' OR j.company LIKE ? ESCAPE '\\' OR j.skills LIKE ? ESCAPE '\\' OR j.description LIKE ? ESCAPE '\\')");
      const p = `%${likeEscape(t)}%`;
      params.push(p, p, p, p);
    }
  }
  if (f.title) { clauses.push("j.title LIKE ? ESCAPE '\\'"); params.push(`%${likeEscape(String(f.title).slice(0, 120))}%`); }
  const companies = list(f.company).slice(0, 20);
  if (companies.length) {
    clauses.push(`(${companies.map(() => "j.company LIKE ? ESCAPE '\\'").join(' OR ')})`);
    params.push(...companies.map((c) => `%${likeEscape(c)}%`));
  }
  for (const s of list(f.skills).slice(0, 15)) {
    clauses.push("j.skills LIKE ? ESCAPE '\\'");
    params.push(`%"${likeEscape(canonicalSkill(s))}"%`);
  }
  const cats = list(f.category).slice(0, 10);
  if (cats.length) {
    clauses.push(`(${cats.map(() => "j.categories LIKE ? ESCAPE '\\'").join(' OR ')})`);
    params.push(...cats.map((c) => `%"${likeEscape(c)}"%`));
  }
  const bands = list(f.bands).slice(0, 12);
  if (bands.length) {
    clauses.push(`j.experience_band IN (${bands.map(() => '?').join(',')})`);
    params.push(...bands);
  }
  if (f.years !== undefined && f.years !== '' && Number.isFinite(Number(f.years))) {
    // Jobs a candidate with N years can realistically apply to.
    const y = Number(f.years);
    clauses.push('(j.experience_min IS NULL OR j.experience_min <= ?)');
    params.push(y + 1);
    clauses.push('(j.experience_min IS NULL OR j.experience_min >= ?)');
    params.push(Math.max(0, y - 6));
  }
  if (f.min_years !== undefined && f.min_years !== '' && Number.isFinite(Number(f.min_years))) {
    clauses.push('(j.experience_min IS NOT NULL AND j.experience_min >= ?)');
    params.push(Number(f.min_years));
  }
  if (f.max_years !== undefined && f.max_years !== '' && Number.isFinite(Number(f.max_years))) {
    clauses.push('(j.experience_min IS NULL OR j.experience_min <= ?)');
    params.push(Number(f.max_years));
  }
  const locs = list(f.location).slice(0, 10);
  if (locs.length) {
    clauses.push(`(${locs.map(() => "j.location LIKE ? ESCAPE '\\'").join(' OR ')})`);
    params.push(...locs.map((l) => `%${likeEscape(l)}%`));
  }
  const arr = list(f.arrangement).filter((a) => ARRANGEMENTS.has(a));
  if (arr.length) {
    clauses.push(`j.work_arrangement IN (${arr.map(() => '?').join(',')})`);
    params.push(...arr);
  }
  if (f.salary_min !== undefined && f.salary_min !== '' && Number.isFinite(Number(f.salary_min))) {
    clauses.push('COALESCE(j.salary_max, j.salary_min) >= ?');
    params.push(Number(f.salary_min));
  }
  if (f.has_salary === '1' || f.has_salary === true) clauses.push('j.salary_min IS NOT NULL');
  if (f.posted_within_days && Number(f.posted_within_days) > 0) {
    clauses.push("COALESCE(j.posted_at, j.first_seen_at) >= datetime('now', ?)");
    params.push(`-${Math.min(365, Number(f.posted_within_days))} days`);
  }
  const sources = list(f.source).map(Number).filter(Number.isInteger).slice(0, 30);
  if (sources.length) {
    clauses.push(`j.source_id IN (${sources.map(() => '?').join(',')})`);
    params.push(...sources);
  }
  if (f.direct_only === '1' || f.direct_only === true) clauses.push('j.is_direct = 1');
  return { where: clauses.join(' AND '), params };
}

export const SORTS = {
  newest: 'COALESCE(j.posted_at, j.first_seen_at) DESC',
  oldest: 'COALESCE(j.posted_at, j.first_seen_at) ASC',
  company: 'j.company COLLATE NOCASE ASC, j.title COLLATE NOCASE ASC',
  salary: 'COALESCE(j.salary_max, j.salary_min, 0) DESC',
};
