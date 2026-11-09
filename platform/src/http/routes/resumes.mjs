import { Router } from 'express';
import multer from 'multer';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { config } from '../../config.mjs';
import { sniffType, extractText, MIME_BY_EXT } from '../../lib/text-extract.mjs';
import { parseResume } from '../../lib/resume-parser.mjs';
import { resumeSuggestions, missingSkillsAnalysis } from '../../lib/insights.mjs';
import { canonicalSkill } from '../../lib/taxonomy.mjs';
import { logUser } from '../../lib/activity.mjs';
import { decodeResumeData, candidateForUser, decodeJob, scoreJobs, VISIBLE_JOB_WHERE } from '../../services/matching.mjs';
import { ah, HttpError, str, strList, num, idParam, clientIp } from '../util.mjs';
import { tx } from '../../db/index.mjs';

const ALLOWED_EXT = new Set(['pdf', 'doc', 'docx']);

function userDir(userId) {
  const dir = path.join(config.uploadDir, String(Number(userId)));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function filePath(row) {
  // stored_name is generated server-side ([0-9a-f]+.ext); never derived from user input.
  if (!/^[0-9a-f]{32}\.(pdf|docx?)$/.test(row.stored_name)) throw new HttpError(500, 'Invalid stored file name');
  return path.join(userDir(row.user_id), row.stored_name);
}

function ownResume(db, userId, id) {
  const row = db.prepare('SELECT * FROM resumes WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) throw new HttpError(404, 'Resume not found');
  return row;
}

function serializeResume(row) {
  const { stored_name, sha256, ...rest } = row;
  return { ...rest, is_active: Boolean(row.is_active) };
}

async function parseAndStore(db, userId, resumeId, buf, type) {
  try {
    const text = await extractText(buf, type);
    if (!text || text.length < 30) throw new Error('No readable text found. If this is a scanned image, upload a text-based PDF or a Word file.');
    const p = parseResume(text);
    db.prepare(`INSERT INTO resume_data (resume_id, user_id, candidate_name, email, phone, total_experience_years, relevant_experience_years, current_role,
        job_titles, technical_skills, programming_languages, cloud_platforms, databases, certifications, education, summary, raw_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(resume_id) DO UPDATE SET candidate_name = excluded.candidate_name, email = excluded.email, phone = excluded.phone,
        total_experience_years = excluded.total_experience_years, relevant_experience_years = excluded.relevant_experience_years,
        current_role = excluded.current_role, job_titles = excluded.job_titles, technical_skills = excluded.technical_skills,
        programming_languages = excluded.programming_languages, cloud_platforms = excluded.cloud_platforms, databases = excluded.databases,
        certifications = excluded.certifications, education = excluded.education, summary = excluded.summary, raw_text = excluded.raw_text,
        edited_by_user = 0, updated_at = datetime('now')`)
      .run(resumeId, userId, p.candidate_name, p.email, p.phone, p.total_experience_years, p.relevant_experience_years, p.current_role,
        JSON.stringify(p.job_titles), JSON.stringify(p.technical_skills), JSON.stringify(p.programming_languages), JSON.stringify(p.cloud_platforms),
        JSON.stringify(p.databases), JSON.stringify(p.certifications), JSON.stringify(p.education), p.summary, text.slice(0, 100000));
    db.prepare("UPDATE resumes SET parse_status = 'parsed', parse_error = NULL, updated_at = datetime('now') WHERE id = ?").run(resumeId);
  } catch (err) {
    db.prepare("UPDATE resumes SET parse_status = 'failed', parse_error = ?, updated_at = datetime('now') WHERE id = ?").run(String(err.message).slice(0, 500), resumeId);
  }
}

export function resumeRoutes(getDb) {
  const r = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1, fields: 10 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').slice(1).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) return cb(new HttpError(400, 'Only PDF, DOC and DOCX files are accepted.'));
      cb(null, true);
    },
  });
  const single = (req, res, next) => upload.single('file')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `The file is larger than ${config.maxUploadMb} MB.`));
    if (err && !(err instanceof HttpError)) return next(new HttpError(400, err.message));
    next(err);
  });

  r.get('/', ah(async (req, res) => {
    const db = getDb();
    const rows = db.prepare(`SELECT r.*, d.candidate_name, d.current_role, d.total_experience_years FROM resumes r
      LEFT JOIN resume_data d ON d.resume_id = r.id WHERE r.user_id = ? ORDER BY r.is_active DESC, r.created_at DESC`).all(req.user.id);
    res.json({ resumes: rows.map(serializeResume), limits: { max_mb: config.maxUploadMb, max_resumes: config.maxResumesPerUser, types: ['pdf', 'doc', 'docx'] } });
  }));

  r.post('/', single, ah(async (req, res) => {
    const db = getDb();
    if (!req.file) throw new HttpError(400, 'Choose a file to upload.');
    const buf = req.file.buffer;
    const type = sniffType(buf);
    const ext = path.extname(req.file.originalname).slice(1).toLowerCase();
    if (!type) throw new HttpError(400, 'This file is not a valid PDF or Word document.');
    if (!(type === ext || (type === 'docx' && ext === 'docx') || (type === 'doc' && ext === 'doc'))) {
      throw new HttpError(400, `The file content is ${type.toUpperCase()} but its name ends in .${ext}. Rename it or export it again.`);
    }
    const replaceId = req.body.replace_id ? idParam(req.body.replace_id) : null;
    const replacing = replaceId ? ownResume(db, req.user.id, replaceId) : null;
    const count = db.prepare('SELECT COUNT(*) n FROM resumes WHERE user_id = ?').get(req.user.id).n;
    if (!replacing && count >= config.maxResumesPerUser) throw new HttpError(400, `You can keep up to ${config.maxResumesPerUser} resumes. Delete an old one first.`);

    const originalName = path.basename(req.file.originalname).replace(/[^\w.\- ()]+/g, '_').slice(0, 150);
    const label = str(req.body.label, { max: 80, field: 'Label' }) || replacing?.label || originalName.replace(/\.(pdf|docx?)$/i, '');
    const storedName = `${randomBytes(16).toString('hex')}.${type}`;
    const sha = createHash('sha256').update(buf).digest('hex');
    writeFileSync(path.join(userDir(req.user.id), storedName), buf, { mode: 0o600 });

    const version = replacing ? replacing.version + 1
      : (db.prepare('SELECT MAX(version) v FROM resumes WHERE user_id = ? AND label = ?').get(req.user.id, label).v || 0) + 1;
    const makeActive = replacing ? replacing.is_active : (count === 0 || req.body.make_active === 'true' ? 1 : 0);
    const id = tx(db, () => {
      if (makeActive) db.prepare('UPDATE resumes SET is_active = 0 WHERE user_id = ?').run(req.user.id);
      const info = db.prepare(`INSERT INTO resumes (user_id, label, original_name, stored_name, mime_type, file_ext, size_bytes, sha256, version, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(req.user.id, label, originalName, storedName, MIME_BY_EXT[type], type, buf.length, sha, version, makeActive ? 1 : 0);
      if (replacing) db.prepare('DELETE FROM resumes WHERE id = ? AND user_id = ?').run(replacing.id, req.user.id);
      return Number(info.lastInsertRowid);
    });
    if (replacing) { try { unlinkSync(filePath(replacing)); } catch { /* already gone */ } }
    await parseAndStore(db, req.user.id, id, buf, type);
    logUser(db, { userId: req.user.id, action: replacing ? 'resume_replaced' : 'resume_uploaded', details: { resume_id: id, type, size: buf.length }, ip: clientIp(req) });
    const row = ownResume(db, req.user.id, id);
    res.status(201).json({ resume: serializeResume(row), data: decodeResumeData(db.prepare('SELECT * FROM resume_data WHERE resume_id = ? AND user_id = ?').get(id, req.user.id)) });
  }));

  r.get('/:id', ah(async (req, res) => {
    const db = getDb();
    const row = ownResume(db, req.user.id, idParam(req.params.id));
    const data = decodeResumeData(db.prepare('SELECT * FROM resume_data WHERE resume_id = ? AND user_id = ?').get(row.id, req.user.id));
    res.json({ resume: serializeResume(row), data });
  }));

  r.get('/:id/insights', ah(async (req, res) => {
    const db = getDb();
    const row = ownResume(db, req.user.id, idParam(req.params.id));
    const dataRow = db.prepare('SELECT * FROM resume_data WHERE resume_id = ? AND user_id = ?').get(row.id, req.user.id);
    if (!dataRow) return res.json({ suggestions: [], missing_skills: [] });
    const data = decodeResumeData(dataRow);
    // Market gap: compare this resume against the jobs it matches best.
    const { preferences } = candidateForUser(db, req.user.id);
    const { buildCandidate } = await import('../../lib/matcher.mjs');
    const candidate = buildCandidate({ resumeData: data, preferences });
    const jobs = db.prepare(`SELECT j.* FROM jobs j WHERE ${VISIBLE_JOB_WHERE} ORDER BY COALESCE(j.posted_at, j.first_seen_at) DESC LIMIT 3000`).all().map(decodeJob);
    const top = scoreJobs(candidate, jobs).filter((s) => s.match.score >= 40).sort((a, b) => b.match.score - a.match.score).slice(0, 150).map((s) => s.match);
    const missing = missingSkillsAnalysis(top);
    res.json({ suggestions: resumeSuggestions(data, dataRow.raw_text, { marketMissing: missing }), missing_skills: missing, compared_jobs: top.length });
  }));

  r.put('/:id/data', ah(async (req, res) => {
    const db = getDb();
    const row = ownResume(db, req.user.id, idParam(req.params.id));
    const b = req.body || {};
    const skills = (k) => strList(b[k], { field: k, maxItems: 80, maxLen: 80 }).map(canonicalSkill);
    const values = {
      candidate_name: str(b.candidate_name, { max: 120, field: 'Name' }),
      email: str(b.email, { max: 254, field: 'Email' }),
      phone: str(b.phone, { max: 40, field: 'Phone' }),
      total_experience_years: num(b.total_experience_years, { min: 0, max: 60, field: 'Total experience' }),
      relevant_experience_years: num(b.relevant_experience_years, { min: 0, max: 60, field: 'Relevant experience' }),
      current_role: str(b.current_role, { max: 120, field: 'Current role' }),
      job_titles: JSON.stringify(strList(b.job_titles, { field: 'Job titles', maxItems: 20 })),
      technical_skills: JSON.stringify(skills('technical_skills')),
      programming_languages: JSON.stringify(skills('programming_languages')),
      cloud_platforms: JSON.stringify(skills('cloud_platforms')),
      databases: JSON.stringify(skills('databases')),
      certifications: JSON.stringify(strList(b.certifications, { field: 'Certifications', maxItems: 30, maxLen: 200 })),
      education: JSON.stringify(strList(b.education, { field: 'Education', maxItems: 10, maxLen: 250 })),
      summary: str(b.summary, { max: 2000, field: 'Summary' }),
    };
    const exists = db.prepare('SELECT 1 FROM resume_data WHERE resume_id = ?').get(row.id);
    if (!exists) db.prepare('INSERT INTO resume_data (resume_id, user_id) VALUES (?, ?)').run(row.id, req.user.id);
    db.prepare(`UPDATE resume_data SET candidate_name = ?, email = ?, phone = ?, total_experience_years = ?, relevant_experience_years = ?, current_role = ?,
      job_titles = ?, technical_skills = ?, programming_languages = ?, cloud_platforms = ?, databases = ?, certifications = ?, education = ?, summary = ?,
      edited_by_user = 1, updated_at = datetime('now') WHERE resume_id = ? AND user_id = ?`)
      .run(...Object.values(values), row.id, req.user.id);
    logUser(db, { userId: req.user.id, action: 'resume_data_edited', details: { resume_id: row.id }, ip: clientIp(req) });
    res.json({ data: decodeResumeData(db.prepare('SELECT * FROM resume_data WHERE resume_id = ?').get(row.id)) });
  }));

  r.post('/:id/reparse', ah(async (req, res) => {
    const db = getDb();
    const row = ownResume(db, req.user.id, idParam(req.params.id));
    const buf = readFileSync(filePath(row));
    await parseAndStore(db, req.user.id, row.id, buf, row.file_ext);
    res.json({ resume: serializeResume(ownResume(db, req.user.id, row.id)), data: decodeResumeData(db.prepare('SELECT * FROM resume_data WHERE resume_id = ?').get(row.id)) });
  }));

  r.post('/:id/activate', ah(async (req, res) => {
    const db = getDb();
    const row = ownResume(db, req.user.id, idParam(req.params.id));
    tx(db, () => {
      db.prepare('UPDATE resumes SET is_active = 0 WHERE user_id = ?').run(req.user.id);
      db.prepare('UPDATE resumes SET is_active = 1 WHERE id = ? AND user_id = ?').run(row.id, req.user.id);
    });
    res.json({ ok: true });
  }));

  r.patch('/:id', ah(async (req, res) => {
    const db = getDb();
    const row = ownResume(db, req.user.id, idParam(req.params.id));
    const label = str(req.body.label, { max: 80, field: 'Label', required: true });
    db.prepare("UPDATE resumes SET label = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?").run(label, row.id, req.user.id);
    res.json({ ok: true });
  }));

  // Download or inline preview. Only the owner reaches this (ownResume).
  r.get('/:id/file', ah(async (req, res) => {
    const db = getDb();
    const row = ownResume(db, req.user.id, idParam(req.params.id));
    const p = filePath(row);
    if (!existsSync(p)) throw new HttpError(404, 'The file is missing from storage.');
    const inline = req.query.inline === '1' && row.file_ext === 'pdf';
    const safeName = row.original_name.replace(/["\\\r\n]/g, '_');
    res.setHeader('Content-Type', row.mime_type);
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(row.original_name)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (inline) res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.send(readFileSync(p));
  }));

  r.delete('/:id', ah(async (req, res) => {
    const db = getDb();
    const row = ownResume(db, req.user.id, idParam(req.params.id));
    tx(db, () => {
      db.prepare('DELETE FROM resumes WHERE id = ? AND user_id = ?').run(row.id, req.user.id);
      if (row.is_active) {
        const next = db.prepare('SELECT id FROM resumes WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(req.user.id);
        if (next) db.prepare('UPDATE resumes SET is_active = 1 WHERE id = ?').run(next.id);
      }
    });
    try { unlinkSync(filePath(row)); } catch { /* already gone */ }
    logUser(db, { userId: req.user.id, action: 'resume_deleted', details: { resume_id: row.id }, ip: clientIp(req) });
    res.json({ ok: true });
  }));

  return r;
}
