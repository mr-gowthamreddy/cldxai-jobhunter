// Resume-to-job matching. Pure functions: a candidate profile and a job in,
// a score with its explanation out. A user's matches are computed only from
// that user's own resume data and preferences.

import { canonicalSkill, CATEGORY_BY_SLUG } from './taxonomy.mjs';

const STOP = new Set(['and', 'or', 'the', 'of', 'for', 'to', 'in', 'a', 'an', 'with', 'at', 'on', 'senior', 'sr', 'junior', 'jr', 'lead', 'staff', 'principal', 'i', 'ii', 'iii', 'iv', 'remote', 'hybrid', 'manager', 'associate', 'head', '-', '&', 'level', 'mid']);
// Skills where knowing one is strong evidence for a sibling (used for partial credit only).
const RELATED = [
  ['Apache Spark', 'PySpark', 'Spark SQL', 'Databricks'],
  ['AWS', 'Azure', 'GCP'],
  ['PostgreSQL', 'MySQL', 'SQL Server', 'Oracle Database', 'MariaDB'],
  ['Snowflake', 'BigQuery', 'Redshift', 'Azure Synapse'],
  ['Power BI', 'Tableau', 'Looker', 'Qlik'],
  ['Apache Airflow', 'Dagster', 'Prefect', 'Azure Data Factory'],
  ['React', 'Angular', 'Vue', 'Svelte'],
  ['Jenkins', 'GitHub Actions', 'GitLab CI', 'Azure DevOps', 'CI/CD'],
  ['TensorFlow', 'PyTorch', 'Keras'],
  ['Selenium', 'Cypress', 'Playwright'],
  ['Kafka', 'Kinesis', 'Event Hubs', 'RabbitMQ'],
  ['Terraform', 'CloudFormation', 'Bicep'],
];
const RELATED_MAP = new Map();
for (const group of RELATED) for (const s of group) RELATED_MAP.set(s, group.filter((x) => x !== s));

function tokens(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ').split(' ').filter((t) => t && !STOP.has(t));
}

/** Build the matching profile from a user's resume data + preferences. */
export function buildCandidate({ resumeData, preferences }) {
  const rd = resumeData || {};
  const prefs = preferences || {};
  const skills = new Set([
    ...(rd.technical_skills || []), ...(rd.programming_languages || []),
    ...(rd.cloud_platforms || []), ...(rd.databases || []),
    ...(prefs.desired_skills || []),
  ].map(canonicalSkill).filter(Boolean));
  const years = prefs.experience_years ?? rd.total_experience_years ?? null;
  const relevantYears = rd.relevant_experience_years ?? years;
  const titles = [rd.current_role, ...(rd.job_titles || []), ...(prefs.desired_titles || [])].filter(Boolean);
  return {
    skills,
    years: years === null ? null : Number(years),
    relevantYears: relevantYears === null ? null : Number(relevantYears),
    titles,
    titleTokens: new Set(titles.flatMap(tokens)),
    desiredTitleTokens: new Set((prefs.desired_titles || []).flatMap(tokens)),
    categories: new Set(prefs.categories || []),
    arrangements: new Set(prefs.work_arrangements?.length ? prefs.work_arrangements : ['Remote', 'Hybrid', 'WFO']),
    locations: (prefs.locations || []).map((l) => l.toLowerCase()),
    hasProfile: skills.size > 0 || titles.length > 0,
  };
}

function experienceFit(years, min, max) {
  if (min === null || min === undefined) return { score: 0.7, note: 'The posting does not state an experience requirement.' };
  if (years === null) return { score: 0.6, note: 'Add your experience to your profile for a better estimate.' };
  const req = max !== null && max !== undefined ? `${min}–${max} years` : `${min}+ years`;
  if (years >= min && (max === null || max === undefined || years <= max + 2)) return { score: 1, note: `Your ${years} years meet the ${req} requirement.` };
  if (years < min) {
    const gap = min - years;
    return { score: Math.max(0, 1 - gap / 3), note: `Asks for ${req}; you have ${years} (${gap.toFixed(gap % 1 ? 1 : 0)} short).` };
  }
  return { score: 0.75, note: `Asks for ${req}; with ${years} years you may be over-qualified.` };
}

/**
 * Score one job for one candidate.
 * job: { title, skills[], preferred_skills[], experience_min, experience_max, categories[], work_arrangement, location }
 */
export function matchJob(candidate, job) {
  const required = (job.skills || []).filter((s) => !(job.preferred_skills || []).includes(s));
  const preferred = job.preferred_skills || [];
  const matching = required.filter((s) => candidate.skills.has(s));
  const missing = required.filter((s) => !candidate.skills.has(s));
  const partial = missing.filter((s) => (RELATED_MAP.get(s) || []).some((r) => candidate.skills.has(r)));
  const matchingPreferred = preferred.filter((s) => candidate.skills.has(s));

  let skillScore = null;
  if (required.length) {
    skillScore = (matching.length + 0.4 * partial.length) / required.length;
    if (preferred.length) skillScore = Math.min(1, skillScore + 0.1 * (matchingPreferred.length / preferred.length));
  }

  const exp = experienceFit(candidate.years, job.experience_min, job.experience_max);

  const jt = tokens(job.title);
  const overlap = jt.filter((t) => candidate.titleTokens.has(t));
  let titleScore = jt.length ? overlap.length / jt.length : 0;
  if (jt.some((t) => candidate.desiredTitleTokens.has(t))) titleScore = Math.min(1, titleScore + 0.2);
  const catHit = (job.categories || []).some((c) => candidate.categories.has(c));
  if (catHit) titleScore = Math.min(1, titleScore + 0.25);

  let prefScore = candidate.arrangements.has(job.work_arrangement) ? 1 : 0.3;
  if (candidate.locations.length) {
    const loc = String(job.location || '').toLowerCase();
    const locHit = job.work_arrangement === 'Remote' || candidate.locations.some((l) => loc.includes(l));
    prefScore = (prefScore + (locHit ? 1 : 0.2)) / 2;
  }

  let score;
  if (skillScore === null) score = 0.55 * titleScore + 0.3 * exp.score + 0.15 * prefScore;
  else score = 0.55 * skillScore + 0.2 * exp.score + 0.2 * titleScore + 0.05 * prefScore;
  if (!candidate.hasProfile) score = 0;
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);

  const reasons = [];
  if (required.length) reasons.push(`You have ${matching.length} of the ${required.length} skills this job asks for${matching.length ? ` (${matching.slice(0, 5).join(', ')}${matching.length > 5 ? '…' : ''})` : ''}.`);
  else reasons.push('The posting lists no recognised skills, so the match leans on title and experience.');
  if (partial.length) reasons.push(`Related experience counts toward ${partial.slice(0, 3).join(', ')}.`);
  if (overlap.length) reasons.push(`The title matches your background (${[...new Set(overlap)].slice(0, 4).join(', ')}).`);
  if (catHit) reasons.push(`It is in a category you follow: ${(job.categories || []).filter((c) => candidate.categories.has(c)).map((c) => CATEGORY_BY_SLUG.get(c)?.name || c).join(', ')}.`);
  reasons.push(exp.note);
  if (!candidate.arrangements.has(job.work_arrangement)) reasons.push(`It is ${job.work_arrangement}, which is not in your preferred work arrangements.`);

  return {
    score: pct,
    skill_score: skillScore === null ? null : Math.round(skillScore * 100),
    experience_score: Math.round(exp.score * 100),
    title_score: Math.round(titleScore * 100),
    required_skills: required,
    preferred_skills: preferred,
    matching_skills: matching,
    missing_skills: missing,
    related_skills: partial,
    required_experience: job.experience_min === null || job.experience_min === undefined ? null : { min: job.experience_min, max: job.experience_max },
    candidate_experience: candidate.years,
    reasons,
    label: pct >= 75 ? 'Strong match' : pct >= 55 ? 'Good match' : pct >= 35 ? 'Partial match' : 'Low match',
  };
}

/**
 * Relevance = match plus freshness, a direct employer link and favourites.
 * Used to rank recommendations; the match % stays the user-facing number.
 */
export function relevanceScore(match, job, { favoriteCompanies = new Set(), now = Date.now() } = {}) {
  let r = match.score;
  const posted = job.posted_at ? Date.parse(job.posted_at) : Date.parse(job.first_seen_at || '');
  if (Number.isFinite(posted)) {
    const days = (now - posted) / 86400000;
    r += days <= 3 ? 8 : days <= 7 ? 5 : days <= 14 ? 2 : days > 45 ? -5 : 0;
  }
  if (job.is_direct) r += 3;
  if (favoriteCompanies.has(String(job.company || '').toLowerCase())) r += 6;
  return Math.max(0, Math.min(100, Math.round(r)));
}
