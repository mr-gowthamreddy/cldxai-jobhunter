// Small HTTP helpers: async error forwarding, typed errors, input validation.

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function str(v, { max = 500, min = 0, field = 'value', trim = true, required = false } = {}) {
  if (v === undefined || v === null) {
    if (required) throw new HttpError(400, `${field} is required`);
    return '';
  }
  if (typeof v !== 'string' && typeof v !== 'number') throw new HttpError(400, `${field} must be text`);
  let s = String(v);
  if (trim) s = s.trim();
  // Strip control characters except newline/tab.
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  if (required && !s) throw new HttpError(400, `${field} is required`);
  if (s.length < min) throw new HttpError(400, `${field} must be at least ${min} characters`);
  if (s.length > max) throw new HttpError(400, `${field} must be at most ${max} characters`);
  return s;
}

export function email(v) {
  const s = str(v, { max: 254, field: 'email', required: true }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) throw new HttpError(400, 'Enter a valid email address');
  return s;
}

export function strList(v, { maxItems = 50, maxLen = 120, field = 'list' } = {}) {
  if (v === undefined || v === null || v === '') return [];
  const arr = Array.isArray(v) ? v : String(v).split(',');
  if (arr.length > maxItems) throw new HttpError(400, `${field} has too many items (max ${maxItems})`);
  const out = [];
  for (const item of arr) {
    const s = str(item, { max: maxLen, field });
    if (s && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out;
}

export function num(v, { min = -Infinity, max = Infinity, field = 'number', nullable = true, int = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (nullable) return null;
    throw new HttpError(400, `${field} is required`);
  }
  const n = Number(v);
  if (!Number.isFinite(n) || (int && !Number.isInteger(n))) throw new HttpError(400, `${field} must be a number`);
  if (n < min || n > max) throw new HttpError(400, `${field} must be between ${min} and ${max}`);
  return n;
}

export function oneOf(v, allowed, field = 'value') {
  if (!allowed.includes(v)) throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}`);
  return v;
}

export function dateStr(v, field = 'date') {
  if (v === undefined || v === null || v === '') return null;
  const s = str(v, { max: 40, field });
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/.test(s) || Number.isNaN(Date.parse(s))) throw new HttpError(400, `${field} must be a date (YYYY-MM-DD)`);
  return s;
}

export function httpUrl(v, field = 'url') {
  const s = str(v, { max: 2000, field });
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch { throw new HttpError(400, `${field} must be a valid URL`); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new HttpError(400, `${field} must start with http:// or https://`);
  return u.href;
}

export function idParam(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, 'Not found');
  return n;
}

export function clientIp(req) {
  return (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

export function paginate(query, { defaultSize = 25, maxSize = 100 } = {}) {
  const page = Math.max(1, Math.min(10000, Number.parseInt(query.page, 10) || 1));
  const size = Math.max(1, Math.min(maxSize, Number.parseInt(query.page_size, 10) || defaultSize));
  return { page, size, offset: (page - 1) * size };
}
