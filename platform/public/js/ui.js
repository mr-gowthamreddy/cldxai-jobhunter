// DOM + UI helpers. All dynamic text goes through text nodes (never innerHTML),
// so job descriptions and user input cannot inject markup.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'multiple') el[k] = Boolean(v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

// Static, trusted SVG paths (feather-style).
const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.35-4.35',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  bookmark: 'M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z',
  briefcase: 'M3 8h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM8 8V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3M3 13h18',
  file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h6',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M18 14a6 6 0 0 1 4 7',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  database: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4L21 8M21 3v5h-5',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  download: 'M12 4v12M7 11l5 5 5-5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  mapPin: 'M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  building: 'M4 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M16 9h3a1 1 0 0 1 1 1v11M8 7h4M8 11h4M8 15h4M2 21h20',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
  dollar: 'M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  check: 'M5 12l5 5 9-11',
  x: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  menu: 'M3 6h18M3 12h18M3 18h18',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  logout: 'M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4M16 17l5-5-5-5M21 12H9',
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16v-4M12 8h.01',
  alert: 'M12 3 2 20h20zM12 9v5M12 17h.01',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  filter: 'M3 4h18l-7 8v7l-4 2v-9z',
  sheet: 'M4 3h16v18H4zM4 9h16M4 15h16M10 3v18',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  eye: 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  kanban: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  graduation: 'M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5',
};

export function icon(name, cls = '') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `icon ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICONS[name] || ICONS.info);
  svg.append(p);
  return svg;
}

export function toast(message, type = '') {
  const box = document.getElementById('toasts');
  const t = h('div', { class: `toast ${type}`, role: 'status' }, message);
  box.append(t);
  setTimeout(() => t.remove(), type === 'error' ? 6000 : 3500);
}

export function errorToast(err) { toast(err?.message || String(err), 'error'); }

/** Modal dialog. Returns { close, el }. content may be a Node or a function(close) => Node. */
export function modal({ title, content, wide = false, onClose } = {}) {
  const back = h('div', { class: 'modal-back', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const body = typeof content === 'function' ? content(close) : content;
  const box = h('div', { class: `modal ${wide ? 'wide' : ''}` },
    h('div', { class: 'modal-head' }, h('h3', null, title), h('button', { class: 'btn ghost icon-only sm', 'aria-label': 'Close', onclick: close }, icon('x'))),
    body);
  back.append(box);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  box.querySelector('input,select,textarea,button.primary')?.focus();
  return { close, el: box };
}

export function confirmDialog(message, { title = 'Are you sure?', okText = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title,
      onClose: () => { if (!done) resolve(false); },
      content: (close) => h('div', null,
        h('p', { class: 'text-2' }, message),
        h('div', { class: 'modal-foot' },
          h('button', { class: 'btn', onclick: () => close() }, 'Cancel'),
          h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => { done = true; resolve(true); close(); } }, okText))),
    });
    return m;
  });
}

// ---- formatting ----
export function timeAgo(value) {
  if (!value) return '';
  const t = Date.parse(String(value).includes('T') || String(value).endsWith('Z') ? value : `${String(value).replace(' ', 'T')}Z`);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  if (d < 30) return `${d} day${d > 1 ? 's' : ''} ago`;
  const mo = Math.floor(d / 30);
  return mo < 12 ? `${mo} month${mo > 1 ? 's' : ''} ago` : `${Math.floor(mo / 12)} year${mo >= 24 ? 's' : ''} ago`;
}
export function ageDays(value) {
  if (!value) return null;
  const t = Date.parse(String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`);
  return Number.isFinite(t) ? (Date.now() - t) / 86400000 : null;
}
export function fmtDate(value, withTime = false) {
  if (!value) return '—';
  const t = Date.parse(String(value).length <= 10 ? `${value}T00:00:00` : String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`);
  if (!Number.isFinite(t)) return String(value);
  return new Date(t).toLocaleString(undefined, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
}
export function fmtNum(n) { return n === null || n === undefined ? '—' : Number(n).toLocaleString(); }
export function fmtBytes(b) { if (!b) return '0 B'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let n = b; while (n >= 1024 && i < 3) { n /= 1024; i++; } return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`; }
export function fmtSalary(job) {
  if (!job.salary_min && !job.salary_max) return null;
  const cur = job.salary_currency || '';
  const f = (v) => (v >= 100000 && cur === 'INR' ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v));
  const a = job.salary_min ? f(job.salary_min) : null; const b = job.salary_max ? f(job.salary_max) : null;
  return `${cur} ${a && b && a !== b ? `${a}–${b}` : a || b}`.trim();
}
export function fmtExp(min, max) {
  if (min === null || min === undefined) return 'Experience not stated';
  if (min === 0 && (max === 0 || max === 1)) return 'Fresher / entry level';
  if (max === null || max === undefined) return `${min}+ yrs`;
  return min === max ? `${min} yrs` : `${min}–${max} yrs`;
}
export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}
const LOGO_COLORS = ['#4f46e5', '#0ea5a4', '#db2777', '#ea580c', '#2563eb', '#7c3aed', '#059669', '#ca8a04', '#dc2626', '#0891b2'];
export function companyLogo(name = '') {
  let hsh = 0;
  for (const c of name) hsh = (hsh * 31 + c.charCodeAt(0)) >>> 0;
  return h('div', { class: 'logo', style: { background: LOGO_COLORS[hsh % LOGO_COLORS.length] }, 'aria-hidden': 'true' }, (name.trim()[0] || '?').toUpperCase());
}
export function scoreRing(score, size = '') {
  const cls = score >= 75 ? 'high' : score >= 50 ? 'mid' : 'low';
  const el = h('div', { class: `score ${cls} ${size}`, title: `${score}% match`, role: 'img', 'aria-label': `${score} percent match` }, h('b', null, `${score}%`));
  el.style.setProperty('--v', String(score));
  return el;
}
export function arrangementBadge(a) {
  const map = { Remote: 'success', Hybrid: 'info', WFO: 'warning' };
  return h('span', { class: `badge ${map[a] || ''}` }, a === 'WFO' ? 'Work from office' : a);
}
export function linkBadge(status) {
  const map = { verified: ['success', 'Link verified'], source_confirmed: ['info', 'Live on source'], unverified: ['', 'Checking link'], broken: ['danger', 'Broken link'], expired: ['danger', 'Expired'] };
  const [cls, label] = map[status] || ['', status];
  return h('span', { class: `badge dot ${cls}` }, label);
}
export const STATUS_COLORS = {
  Interested: '', Saved: 'primary', Applied: 'info', 'Interview Scheduled': 'warning', 'Technical Round': 'warning', 'HR Round': 'warning', 'Offer Received': 'success', Rejected: 'danger',
};
export function statusBadge(s) { return h('span', { class: `badge ${STATUS_COLORS[s] || ''}` }, s); }

export function emptyState(iconName, title, text, action) {
  return h('div', { class: 'empty' }, icon(iconName), h('h3', null, title), text ? h('p', null, text) : null, action || null);
}

export function skeleton(n = 3) { return h('div', { class: 'stack' }, Array.from({ length: n }, () => h('div', { class: 'skeleton' }))); }

/** Tag input bound to an array. Returns { el, get() }. */
export function tagInput(values = [], { placeholder = 'Type and press Enter', suggestions = [] } = {}) {
  const list = [...values];
  const listId = `dl-${Math.random().toString(36).slice(2)}`;
  const input = h('input', { type: 'text', placeholder, list: suggestions.length ? listId : null, 'aria-label': placeholder });
  const wrap = h('div', { class: 'tags' });
  const render = () => {
    clear(wrap);
    list.forEach((v, i) => wrap.append(h('span', { class: 'chip' }, v, h('button', { type: 'button', 'aria-label': `Remove ${v}`, onclick: () => { list.splice(i, 1); render(); input.focus(); } }, '×'))));
    wrap.append(input);
    if (suggestions.length) wrap.append(h('datalist', { id: listId }, suggestions.map((s) => h('option', { value: s }))));
  };
  const add = () => {
    for (const part of input.value.split(',')) {
      const v = part.trim();
      if (v && !list.some((x) => x.toLowerCase() === v.toLowerCase())) list.push(v);
    }
    input.value = '';
    render();
    input.focus();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
    else if (e.key === 'Backspace' && !input.value && list.length) { list.pop(); render(); input.focus(); }
  });
  input.addEventListener('blur', () => { if (input.value.trim()) add(); });
  wrap.addEventListener('click', (e) => { if (e.target === wrap) input.focus(); });
  render();
  return { el: wrap, get: () => { if (input.value.trim()) add(); return [...list]; } };
}

export function field(labelText, control, hint) {
  const id = control.id || `f-${Math.random().toString(36).slice(2)}`;
  if (!control.id && ['INPUT', 'SELECT', 'TEXTAREA'].includes(control.tagName)) control.id = id;
  return h('div', { class: 'field' }, h('label', { for: control.id || null }, labelText), control, hint ? h('div', { class: 'hint' }, hint) : null);
}

export function formError(el, msg) {
  let box = el.querySelector(':scope > .form-error');
  if (!msg) { box?.remove(); return; }
  if (!box) { box = h('div', { class: 'form-error', role: 'alert' }); el.prepend(box); }
  box.textContent = msg;
}

/** Disable a button while an async action runs. */
export async function busy(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true;
  const sp = h('span', { class: 'spinner' });
  btn.prepend(sp);
  try { return await fn(); } finally { btn.disabled = false; sp.remove(); if (!btn.textContent) btn.textContent = label; }
}

// ---- charts (Chart.js, loaded once from /vendor) ----
let chartLib = null;
export function loadCharts() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (!chartLib) {
    chartLib = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/chart.umd.js';
      s.onload = () => resolve(window.Chart);
      s.onerror = reject;
      document.head.append(s);
    });
  }
  return chartLib;
}
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
export const PALETTE = ['#3b82f6', '#0ea5e9', '#a1a1aa', '#f59e0b', '#22c55e', '#8b5cf6', '#ef4444', '#14b8a6', '#ec4899', '#52525b'];
export async function chart(canvas, config) {
  const Chart = await loadCharts();
  Chart.defaults.font.family = css('--font');
  Chart.defaults.color = css('--text-3');
  Chart.defaults.borderColor = css('--border');
  const c = new Chart(canvas, { ...config, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { boxWidth: 12, usePointStyle: true } }, ...(config.options?.plugins || {}) }, ...(config.options || {}), plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } }, ...(config.options?.plugins || {}) } } });
  return c;
}
export function chartBox(cls = '') {
  const canvas = h('canvas');
  return { box: h('div', { class: `chart-box ${cls}` }, canvas), canvas };
}
