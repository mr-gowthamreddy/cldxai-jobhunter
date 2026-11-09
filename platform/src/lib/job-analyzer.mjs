// Turns a raw provider job into the platform's structured record: experience
// range + band, work arrangement, skills, categories, salary.

import { findSkills, categorize } from './taxonomy.mjs';

// Default experience bands. Admins can replace them (settings key
// "experience_bands"); bands never filter jobs out, they only label them.
export const DEFAULT_EXPERIENCE_BANDS = [
  { id: 'fresher', label: 'Fresher', min: 0, max: 0 },
  { id: '0-2', label: '0–2 years', min: 0, max: 2 },
  { id: '2-4', label: '2–4 years', min: 2, max: 4 },
  { id: '4-6', label: '4–6 years', min: 4, max: 6 },
  { id: '6-8', label: '6–8 years', min: 6, max: 8 },
  { id: '8-10', label: '8–10 years', min: 8, max: 10 },
  { id: '10+', label: '10+ years', min: 10, max: null },
];

const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15 };
const NUM = '(\\d{1,2}(?:\\.\\d)?|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen)';
function toNum(s) {
  const k = String(s).toLowerCase();
  return NUM_WORDS[k] ?? Number.parseFloat(k);
}

const RANGE_RE = new RegExp(`${NUM}\\s*(?:\\+\\s*)?(?:-|–|—|to)\\s*${NUM}\\s*\\+?\\s*(?:years?|yrs?)`, 'gi');
const MIN_RE = new RegExp(`(?:minimum(?: of)?|at least|min\\.?|over|more than)?\\s*${NUM}\\s*\\+?\\s*(?:\\+|plus)?\\s*(?:years?|yrs?)(?:'s)?\\s*(?:of\\s+)?(?:\\w+\\s+){0,4}?(?:experience|exp\\b|in\\b|working|building|of)`, 'gi');
const FRESHER_RE = /\b(fresher|freshers|fresh graduate|new grad(?:uate)?|recent graduate|entry[\s-]level|graduate (?:program|trainee|engineer)|campus hire|internship|intern\b|trainee|no experience required|0\s*(?:-|to)\s*1\s*years?)\b/i;

/** Extract the stated experience requirement. Returns {min, max, source}. */
export function extractExperience(title = '', description = '') {
  const text = `${description}`.slice(0, 20000);
  const ranges = [];
  for (const m of text.matchAll(RANGE_RE)) {
    const a = toNum(m[1]); const b = toNum(m[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && a <= b && b <= 30) ranges.push([a, b]);
  }
  if (ranges.length) {
    ranges.sort((x, y) => x[0] - y[0]);
    return { min: ranges[0][0], max: ranges[0][1], source: 'description' };
  }
  const mins = [];
  for (const m of text.matchAll(MIN_RE)) {
    const a = toNum(m[1]);
    if (Number.isFinite(a) && a <= 25) mins.push(a);
  }
  if (mins.length) {
    // The smallest stated minimum is the gate; larger ones are usually "preferred".
    const min = Math.min(...mins);
    return { min, max: null, source: 'description' };
  }
  const t = title.toLowerCase();
  if (FRESHER_RE.test(title) || FRESHER_RE.test(text.slice(0, 3000))) return { min: 0, max: 1, source: 'fresher' };
  // Title seniority fallback, clearly marked as inferred.
  if (/\b(intern|trainee|apprentice)\b/.test(t)) return { min: 0, max: 0, source: 'title' };
  if (/\b(junior|jr\.?|associate|entry)\b/.test(t)) return { min: 0, max: 2, source: 'title' };
  if (/\b(principal|distinguished|director|vp|vice president|head of|chief)\b/.test(t)) return { min: 10, max: null, source: 'title' };
  if (/\b(staff|architect|lead manager|senior manager)\b/.test(t)) return { min: 8, max: null, source: 'title' };
  if (/\b(lead|manager)\b/.test(t)) return { min: 6, max: null, source: 'title' };
  if (/\b(senior|sr\.?|iii)\b/.test(t)) return { min: 4, max: 8, source: 'title' };
  if (/\b(ii|mid[\s-]level)\b/.test(t)) return { min: 2, max: 5, source: 'title' };
  return { min: null, max: null, source: 'unknown' };
}

/** Pick the band whose range contains the job's minimum requirement. */
export function experienceBand(min, max, bands = DEFAULT_EXPERIENCE_BANDS) {
  if (min === null || min === undefined) return 'unknown';
  if (min === 0 && (max === 0 || max === 1) && bands.some((b) => b.id === 'fresher')) return 'fresher';
  const sorted = bands.filter((b) => b.id !== 'fresher' || b.max !== 0).slice();
  for (const b of sorted) {
    if (b.max === null || b.max === undefined) { if (min >= b.min) return b.id; continue; }
    if (min >= b.min && min < b.max) return b.id;
  }
  for (const b of sorted) if (b.max === null && min >= b.min) return b.id;
  return sorted.length ? sorted[sorted.length - 1].id : 'unknown';
}

/** Which bands a candidate with `years` of experience can target. */
export function bandsForYears(years, bands = DEFAULT_EXPERIENCE_BANDS) {
  if (years === null || years === undefined) return bands.map((b) => b.id);
  return bands.filter((b) => years >= b.min - 0.5 && (b.max === null || years <= b.max + 1)).map((b) => b.id);
}

// Work arrangement. Explicit evidence only: a job that never says how it is
// worked is "Unspecified" and is excluded from user-facing lists.
const REMOTE_RE = /\b(fully[\s-]remote|100% remote|remote[\s-](first|only|friendly|position|role|opportunity|work)|work from home|wfh|work from anywhere|remote\b(?!\s*(sensing|control|monitoring|patient)))/i;
const HYBRID_RE = /\b(hybrid(?![\s-]cloud)|(\d|two|three|four)\s*days?\s*(a|per)\s*week\s*(in|at)\s*(the\s*|our\s*)?office|flexible office|mobiles arbeiten|homeoffice[\s-]?(möglich|option|tage)|teilweise homeoffice)\b/i;
const ONSITE_RE = /\b(on[\s-]?site|in[\s-]office|work from office|wfo|in[\s-]person|office[\s-]based|5 days (a|per) week in (the )?office|onsite|(work|working|based|join us|report) (from|in|at|to) (our|the) ([A-Z][\w-]+\s){0,3}offices?\b|vor ort|präsenz(?:pflicht)?)\b/i;
const NOT_REMOTE_RE = /\b(not (a )?remote|no remote|non[\s-]remote|remote work is not)\b/i;

const WORKPLACE_TYPE = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'WFO', 'on-site': 'WFO', on_site: 'WFO', office: 'WFO', inoffice: 'WFO' };

export function detectWorkArrangement({ title = '', location = '', description = '', isRemote, workplaceType, providerRemoteOnly } = {}) {
  // The source's own structured field beats any text heuristic.
  const wt = WORKPLACE_TYPE[String(workplaceType || '').toLowerCase().replace(/\s+/g, '')];
  if (wt) return wt;
  const loc = location || '';
  const head = `${title} ${loc}`;
  const body = String(description || '').slice(0, 8000);
  if (HYBRID_RE.test(head)) return 'Hybrid';
  if (/\bremote\b/i.test(head) && !NOT_REMOTE_RE.test(head)) return 'Remote';
  if (ONSITE_RE.test(head)) return 'WFO';
  if (isRemote === true || providerRemoteOnly) return 'Remote';
  if (NOT_REMOTE_RE.test(body) && ONSITE_RE.test(body)) return 'WFO';
  const hybrid = HYBRID_RE.test(body);
  const remote = REMOTE_RE.test(body) && !NOT_REMOTE_RE.test(body);
  const onsite = ONSITE_RE.test(body);
  if (hybrid) return 'Hybrid';
  if (remote && !onsite) return 'Remote';
  if (onsite && !remote) return 'WFO';
  if (remote && onsite) return 'Hybrid';
  return 'Unspecified';
}

const CURRENCY_RE = /(USD|EUR|GBP|INR|CAD|AUD|SGD|\$|€|£|₹)/;
/** Pull a salary range out of free text when the provider gave none. */
export function extractSalary(text = '') {
  const t = String(text).slice(0, 15000);
  const m = t.match(/(USD|EUR|GBP|INR|CAD|AUD|SGD|\$|€|£|₹)\s?(\d{2,3}(?:[,.]\d{3})+|\d{2,3}\s?[kK])\s*(?:-|–|to)\s*(?:USD|EUR|GBP|INR|CAD|AUD|SGD|\$|€|£|₹)?\s?(\d{2,3}(?:[,.]\d{3})+|\d{2,3}\s?[kK])/);
  const lpa = t.match(/(\d{1,2}(?:\.\d)?)\s*(?:-|–|to)\s*(\d{1,2}(?:\.\d)?)\s*(?:LPA|lakhs? per annum|lakhs?)/i);
  if (m) {
    const val = (s) => { const k = /k/i.test(s); const n = Number(s.replace(/[^\d]/g, '')); return k ? n * 1000 : n; };
    const cur = { $: 'USD', '€': 'EUR', '£': 'GBP', '₹': 'INR' }[m[1]] || m[1];
    const min = val(m[2]); const max = val(m[3]);
    if (min > 1000 && max >= min) return { min, max, currency: cur };
  }
  if (lpa) {
    const min = Number(lpa[1]) * 100000; const max = Number(lpa[2]) * 100000;
    if (max >= min) return { min, max, currency: 'INR' };
  }
  return null;
}

const TAG_RE = /<[^>]+>/g;
export function plainText(html = '') {
  return String(html)
    .replace(/<(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, '\n')
    .replace(TAG_RE, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

export function normalizeCompany(name = '') {
  return String(name).toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|gmbh|corp|corporation|co|pvt|private|plc|s\.?a\.?|technologies|technology)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
export function normalizeTitle(title = '') {
  return String(title).toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(sr)\b\.?/g, 'senior').replace(/\b(jr)\b\.?/g, 'junior')
    .replace(/[^a-z0-9+#]+/g, ' ').trim();
}
export function fingerprint(company, title, location) {
  const loc = String(location || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim().split(' ').slice(0, 2).join(' ');
  return `${normalizeCompany(company)}|${normalizeTitle(title)}|${loc}`;
}

/** Full analysis of one provider job. */
export function analyzeJob(raw, { source = {}, bands = DEFAULT_EXPERIENCE_BANDS } = {}) {
  const description = plainText(raw.description || '');
  const title = String(raw.title || '').trim();
  const exp = extractExperience(title, description);
  const skills = findSkills(`${title}\n${description}`);
  // Skills named only under a "nice to have / preferred / bonus" heading are preferred, not required.
  const split = description.search(/\n\s*(nice[\s-]to[\s-]have|preferred(?: qualifications| skills)?|bonus(?: points)?|good to have|it'?s a plus|pluses)\b[^\n]{0,40}\n/i);
  let preferredSkills = [];
  if (split > 0) {
    const core = new Set(findSkills(`${title}\n${description.slice(0, split)}`));
    preferredSkills = skills.filter((s) => !core.has(s));
  }
  const categories = categorize(title, skills);
  const arrangement = detectWorkArrangement({
    title, location: raw.location, description,
    isRemote: raw.isRemote ?? raw.remote,
    workplaceType: raw.workplaceType,
    providerRemoteOnly: Boolean(source.config?.remote_only),
  });
  let salary = null;
  if (raw.salary && (raw.salary.min || raw.salary.max)) {
    salary = { min: raw.salary.min ?? raw.salary.max, max: raw.salary.max ?? raw.salary.min, currency: raw.salary.currency || '' };
  } else {
    salary = extractSalary(description);
  }
  return {
    title,
    company: String(raw.company || source.name || '').trim(),
    location: String(raw.location || '').trim(),
    description,
    experience_min: exp.min,
    experience_max: exp.max,
    experience_source: exp.source,
    experience_band: experienceBand(exp.min, exp.max, bands),
    work_arrangement: arrangement,
    skills,
    preferred_skills: preferredSkills,
    categories,
    salary,
    posted_at: Number.isFinite(raw.postedAt) ? new Date(raw.postedAt).toISOString() : null,
  };
}
