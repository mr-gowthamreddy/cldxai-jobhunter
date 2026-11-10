// API client: JSON requests with the session's CSRF token; uploads with progress.
let csrf = null;
export function setCsrf(token) { csrf = token; }

export class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

export async function api(path, { method = 'GET', body, query } = {}) {
  let url = `/api${path}`;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
      qs.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrf) headers['X-CSRF-Token'] = csrf;
  let res;
  try {
    res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check that the app is running (start.bat / start.sh).');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new CustomEvent('cops:unauthorized'));
    throw new ApiError(res.status, data.error || `Request failed (${res.status})`, data.details);
  }
  return data;
}

/** Multipart upload with a progress callback (0..1). */
export function upload(path, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${path}`);
    if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data.error || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Upload failed: cannot reach the server.'));
    xhr.send(formData);
  });
}
