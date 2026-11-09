// Heuristic resume parser. It produces a structured candidate profile that the
// user reviews and corrects in the UI — parsing is never treated as ground truth.

import { findSkills, skillGroup, canonicalSkill } from './taxonomy.mjs';

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?)?\d{3,5}[\s.-]?\d{3,5}(?:[\s.-]?\d{1,4})?/g;

const SECTION_HEADINGS = {
  summary: /^(professional\s+)?(summary|profile|objective|about me|career objective|professional profile)\b/i,
  experience: /^(work\s+|professional\s+|employment\s+|relevant\s+)?(experience|history|employment)( history)?\b|^career history\b|^work history\b/i,
  education: /^(education|academic|qualifications|academics|educational qualifications?)\b/i,
  skills: /^(technical\s+|key\s+|core\s+)?(skills|competencies|technologies|tech stack|tools)\b/i,
  certifications: /^(certifications?|certificates|licenses|licen[cs]es & certifications|courses)\b/i,
  projects: /^(projects|personal projects|key projects|academic projects)\b/i,
  other: /^(awards|achievements|languages|interests|hobbies|publications|references|declaration|personal details)\b/i,
};

function sectionOf(line) {
  const clean = line.replace(/[:|•\-–_*#]+$/g, '').replace(/^[#*\s]+/, '').trim();
  if (clean.length > 45) return null;
  for (const [name, re] of Object.entries(SECTION_HEADINGS)) if (re.test(clean)) return name;
  return null;
}

export function splitSections(text) {
  const sections = { header: [] };
  let current = 'header';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const s = sectionOf(line);
    if (s) { current = s; sections[current] = sections[current] || []; continue; }
    (sections[current] = sections[current] || []).push(line);
  }
  return sections;
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const MONTH_NAME = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DATE_TOKEN = `(?:${MONTH_NAME}\\.?\\s*,?\\s*(\\d{4})|(\\d{1,2})[/.-](\\d{4})|(\\d{4}))`;
const RANGE_RE = new RegExp(`${DATE_TOKEN}\\s*(?:-|–|—|to|till|until)\\s*(?:${DATE_TOKEN}|(present|current|now|till date|today|ongoing))`, 'gi');

function toMonthIndex(mName, y1, mm, y2, yOnly, isEnd) {
  if (mName) return Number(y1) * 12 + MONTHS[mName.slice(0, 3).toLowerCase() === 'sep' ? 'sep' : mName.slice(0, 3).toLowerCase()];
  if (mm) return Number(y2) * 12 + Math.max(0, Math.min(11, Number(mm) - 1));
  if (yOnly) return Number(yOnly) * 12 + (isEnd ? 11 : 0);
  return null;
}

/** Find employment date ranges in a block of text: [{start, end, line, index}] in month indexes. */
export function findDateRanges(text, now = new Date()) {
  const nowIdx = now.getFullYear() * 12 + now.getMonth();
  const out = [];
  for (const m of text.matchAll(RANGE_RE)) {
    const start = toMonthIndex(m[1], m[2], m[3], m[4], m[5], false);
    let end;
    if (m[11]) end = nowIdx;
    else end = toMonthIndex(m[6], m[7], m[8], m[9], m[10], true);
    if (start === null || end === null) continue;
    if (start > nowIdx + 1 || end < start || (end - start) > 12 * 45) continue;
    if (start < 1960 * 12) continue;
    out.push({ start, end: Math.min(end, nowIdx), current: Boolean(m[11]), index: m.index, match: m[0] });
  }
  return out;
}

/** Total months covered by possibly-overlapping ranges. */
export function mergedMonths(ranges) {
  const sorted = ranges.map((r) => [r.start, r.end]).sort((a, b) => a[0] - b[0]);
  let total = 0; let cur = null;
  for (const [s, e] of sorted) {
    if (!cur) { cur = [s, e]; continue; }
    if (s <= cur[1] + 1) cur[1] = Math.max(cur[1], e);
    else { total += cur[1] - cur[0] + 1; cur = [s, e]; }
  }
  if (cur) total += cur[1] - cur[0] + 1;
  return total;
}

const TITLE_WORDS = /\b(engineer|developer|analyst|scientist|architect|manager|consultant|lead|designer|administrator|specialist|intern|associate|director|officer|executive|coordinator|accountant|recruiter|tester|programmer|head|vp|president|founder|teacher|nurse|technician|representative|strategist|writer|editor|owner|trainee|sde|devops|sre)\b/i;

function cleanTitle(s) {
  return s.replace(new RegExp(RANGE_RE.source, 'gi'), '')
    .replace(/\s*[|@•·,–—-]\s*$/g, '')
    .replace(/^[•\-*\s]+/, '')
    .trim();
}

/** Job titles found near date ranges inside the experience section. */
export function extractTitles(expLines) {
  const titles = [];
  for (let i = 0; i < expLines.length; i++) {
    const line = expLines[i];
    if (line.length > 140) continue;
    if (/^[•\-*▪●◦]/.test(line)) continue; // bullet
    // Titles often share a line with company/date: "Data Engineer | Acme | 2020 - Present"
    for (const part of line.split(/\s*[|•·]\s*|\s+[–—-]\s+|\s+at\s+|,\s+/i)) {
      const p = cleanTitle(part);
      if (p.length < 3 || p.length > 70) continue;
      if (!TITLE_WORDS.test(p)) continue;
      if (/\b(responsible|worked|developed|built|led|managed|using|with|for the|and the)\b/i.test(p) && p.split(' ').length > 5) continue;
      titles.push(p.replace(/\s{2,}/g, ' '));
      break;
    }
  }
  const seen = new Set();
  return titles.filter((t) => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 12);
}

const DEGREE_RE = /\b(b\.?\s?tech|b\.?\s?e\b|b\.?\s?sc|b\.?\s?com|b\.?\s?c\.?\s?a|bca|mca|m\.?\s?tech|m\.?\s?e\b|m\.?\s?sc|m\.?\s?s\b|mba|pgdm|ph\.?\s?d|bachelor(?:'s)?|master(?:'s)?|doctorate|diploma|associate degree|high school|hsc|ssc|b\.?a\b|m\.?a\b|bs\b|ms\b|ba\b|ma\b)/i;

export function extractEducation(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (DEGREE_RE.test(line) && line.length < 200) {
      const next = lines[i + 1] && !DEGREE_RE.test(lines[i + 1]) && lines[i + 1].length < 120 ? ` — ${lines[i + 1]}` : '';
      out.push((line + (line.length < 60 ? next : '')).replace(/^[•\-*\s]+/, ''));
    }
  }
  return [...new Set(out)].slice(0, 6);
}

const CERT_RE = /\b(certified|certification|certificate|associate|professional|specialty|practitioner|fundamentals|az-\d{3}|dp-\d{3}|ai-\d{3}|pl-\d{3}|aws certified|ckad|cka|pmp|scrum master|cissp|ccna|comptia|snowpro|databricks certified)\b/i;
export function extractCertifications(sectionLines, allText) {
  const out = [];
  for (const line of sectionLines || []) {
    const l = line.replace(/^[•\-*▪●\s]+/, '').trim();
    if (l.length > 3 && l.length < 160) out.push(l);
  }
  if (!out.length) {
    for (const line of allText.split('\n')) {
      const l = line.replace(/^[•\-*▪●\s]+/, '').trim();
      if (l.length < 140 && CERT_RE.test(l) && /\b(certified|certification|certificate|az-\d{3}|dp-\d{3}|snowpro|pmp|cka|ckad)\b/i.test(l)) out.push(l);
    }
  }
  return [...new Set(out)].slice(0, 15);
}

function extractName(headerLines, email) {
  for (const raw of headerLines.slice(0, 6)) {
    const line = raw.replace(/[|•·].*$/, '').trim();
    if (!line || line.length > 50) continue;
    if (EMAIL_RE.test(line) || /\d{3}/.test(line) || /https?:|www\.|linkedin|github/i.test(line)) continue;
    if (/\b(resume|curriculum|vitae|cv)\b/i.test(line)) continue;
    const words = line.split(/\s+/);
    if (words.length < 1 || words.length > 5) continue;
    if (words.every((w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w))) {
      return words.map((w) => (w === w.toUpperCase() && w.length > 2 ? w[0] + w.slice(1).toLowerCase() : w)).join(' ');
    }
  }
  if (email) {
    const local = email.split('@')[0].replace(/[0-9_]+/g, ' ').replace(/[.\-]+/g, ' ').trim();
    if (local.split(' ').length >= 2) return local.split(' ').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  }
  return '';
}

function extractPhone(text) {
  const head = text.slice(0, 1500);
  for (const m of head.matchAll(PHONE_RE)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 14 && !/^(19|20)\d{2}(19|20)\d{2}$/.test(digits)) return m[0].trim();
  }
  return '';
}

const STATED_YEARS_RE = /(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)(?:'s)?\s+(?:of\s+)?(?:total\s+|overall\s+|professional\s+|industry\s+|hands[\s-]on\s+|it\s+)?(?:work\s+)?experience/i;

/** Parse resume text into a structured candidate profile. */
export function parseResume(text, { now = new Date() } = {}) {
  const sections = splitSections(text);
  const email = (text.match(EMAIL_RE) || [''])[0];
  const phone = extractPhone(text);
  const name = extractName(sections.header || text.split('\n'), email);

  const expLines = sections.experience || [];
  const expText = expLines.join('\n');
  const ranges = findDateRanges(expText || text, now);
  let totalYears = null;
  const stated = text.match(STATED_YEARS_RE);
  if (ranges.length) totalYears = Math.round((mergedMonths(ranges) / 12) * 10) / 10;
  // Employment dates are the better evidence (a "5+ years" summary line goes
  // stale); the candidate's own statement is the fallback when no dates parse.
  if (stated && totalYears === null) totalYears = Number(stated[1]);

  const titles = extractTitles(expLines.length ? expLines : (sections.header || []));
  let currentRole = '';
  const currentRange = ranges.find((r) => r.current);
  if (currentRange) {
    // Title on the same or nearest preceding line of the "Present" range.
    const before = expText.slice(0, currentRange.index).split('\n').slice(-3).join('\n');
    const lineWith = expText.slice(currentRange.index).split('\n')[0];
    const cands = extractTitles([...before.split('\n'), lineWith]);
    currentRole = cands[cands.length - 1] || titles[0] || '';
  } else {
    currentRole = titles[0] || '';
  }
  if (!currentRole && sections.header) {
    const t = sections.header.find((l) => TITLE_WORDS.test(l) && l.length < 70 && !EMAIL_RE.test(l));
    if (t) currentRole = cleanTitle(t);
  }

  // Relevant experience: years spent in roles that share the domain of the current role.
  let relevantYears = null;
  if (ranges.length && currentRole) {
    const key = domainKey(currentRole);
    const relevant = ranges.filter((r) => {
      const ctx = expText.slice(Math.max(0, r.index - 160), r.index + r.match.length + 40);
      return key && domainKey(ctx) === key;
    });
    if (relevant.length) relevantYears = Math.round((mergedMonths(relevant) / 12) * 10) / 10;
  }
  if (relevantYears === null) relevantYears = totalYears;
  if (relevantYears !== null && totalYears !== null) relevantYears = Math.min(relevantYears, totalYears);

  const skills = findSkills(text);
  const pick = (group) => skills.filter((s) => skillGroup(s) === group);
  const programmingLanguages = pick('programming_languages');
  const cloud = pick('cloud_platforms');
  const databases = pick('databases');
  const technical = skills.filter((s) => !['programming_languages', 'cloud_platforms', 'databases'].includes(skillGroup(s)));

  const summary = (sections.summary || []).join(' ').slice(0, 1200);

  return {
    candidate_name: name,
    email,
    phone,
    total_experience_years: totalYears,
    relevant_experience_years: relevantYears,
    current_role: currentRole,
    job_titles: titles,
    technical_skills: technical,
    programming_languages: programmingLanguages,
    cloud_platforms: cloud,
    databases,
    certifications: extractCertifications(sections.certifications, text),
    education: extractEducation(sections.education || text.split('\n')),
    summary,
  };
}

const DOMAINS = [
  ['data', /\b(data|etl|analytics|bi|warehouse|spark|databricks|snowflake)\b/i],
  ['ml', /\b(machine learning|ml|ai|scientist)\b/i],
  ['devops', /\b(devops|sre|reliability|infrastructure|cloud|platform)\b/i],
  ['qa', /\b(qa|test|quality)\b/i],
  ['frontend', /\b(front[\s-]?end|ui|react|angular)\b/i],
  ['software', /\b(software|developer|backend|full[\s-]?stack|sde|programmer)\b/i],
  ['product', /\bproduct\b/i],
  ['design', /\b(design|ux)\b/i],
  ['sales', /\b(sales|account|business development)\b/i],
  ['marketing', /\bmarketing|seo|content\b/i],
  ['finance', /\b(finance|account|audit|tax)\b/i],
  ['hr', /\b(hr|recruit|talent|people)\b/i],
];
function domainKey(text) {
  for (const [k, re] of DOMAINS) if (re.test(text)) return k;
  return null;
}

/** All skills of a parsed profile as one canonical list. */
export function profileSkills(data) {
  const all = [
    ...(data.technical_skills || []),
    ...(data.programming_languages || []),
    ...(data.cloud_platforms || []),
    ...(data.databases || []),
  ].map(canonicalSkill);
  return [...new Set(all.filter(Boolean))];
}
