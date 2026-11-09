// Database-facing matching: builds a user's candidate profile strictly from
// that user's own active resume and preferences, then scores jobs.

import { parseJson } from '../db/index.mjs';
import { buildCandidate, matchJob, relevanceScore } from '../lib/matcher.mjs';

const RESUME_LIST_FIELDS = ['job_titles', 'technical_skills', 'programming_languages', 'cloud_platforms', 'databases', 'certifications', 'education'];

export function decodeResumeData(row) {
  if (!row) return null;
  const out = { ...row };
  for (const f of RESUME_LIST_FIELDS) out[f] = parseJson(row[f], []);
  delete out.raw_text;
  return out;
}

export function loadPreferences(db, userId) {
  const row = db.prepare('SELECT * FROM job_preferences WHERE user_id = ?').get(userId);
  if (!row) return { desired_titles: [], desired_skills: [], categories: [], locations: [], work_arrangements: ['Remote', 'Hybrid', 'WFO'], min_match_score: 50, notify_new_matches: 1, experience_years: null, min_salary: null, salary_currency: '' };
  return {
    ...row,
    desired_titles: parseJson(row.desired_titles, []),
    desired_skills: parseJson(row.desired_skills, []),
    categories: parseJson(row.categories, []),
    locations: parseJson(row.locations, []),
    work_arrangements: parseJson(row.work_arrangements, ['Remote', 'Hybrid', 'WFO']),
  };
}

export function activeResumeData(db, userId) {
  const row = db.prepare(`SELECT d.* FROM resume_data d JOIN resumes r ON r.id = d.resume_id
    WHERE r.user_id = ? AND d.user_id = ? AND r.is_active = 1 LIMIT 1`).get(userId, userId);
  return decodeResumeData(row);
}

export function candidateForUser(db, userId) {
  const resumeData = activeResumeData(db, userId);
  const preferences = loadPreferences(db, userId);
  return { candidate: buildCandidate({ resumeData, preferences }), resumeData, preferences };
}

export function decodeJob(row) {
  return {
    ...row,
    skills: parseJson(row.skills, []),
    preferred_skills: parseJson(row.preferred_skills, []),
    categories: parseJson(row.categories, []),
  };
}

export function favoriteSet(db, userId) {
  return new Set(db.prepare('SELECT company FROM favorite_companies WHERE user_id = ?').all(userId).map((r) => r.company.toLowerCase()));
}

/** Score a list of decoded jobs for a candidate. */
export function scoreJobs(candidate, jobs, favorites = new Set()) {
  const now = Date.now();
  return jobs.map((job) => {
    const match = matchJob(candidate, job);
    return { job, match, relevance: relevanceScore(match, job, { favoriteCompanies: favorites, now }) };
  });
}

/** Jobs visible to users: active, verified link, explicit work arrangement, not a duplicate. */
export const VISIBLE_JOB_WHERE = "j.status = 'active' AND j.duplicate_of IS NULL AND j.work_arrangement IN ('Remote','Hybrid','WFO') AND j.link_status IN ('source_confirmed','verified')";
