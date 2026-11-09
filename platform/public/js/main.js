// SPA entry: session state, routing and the authenticated app shell.
import { api, setCsrf } from './api.js';
import { h, clear, icon, initials, toast, timeAgo } from './ui.js';

export const state = { user: null, unread: 0, registration: true };

const routes = [
  { re: /^\/$/, page: () => import('./pages/landing.js'), public: true },
  { re: /^\/login$/, page: () => import('./pages/auth.js').then((m) => ({ default: m.login })), public: true, guestOnly: true },
  { re: /^\/register$/, page: () => import('./pages/auth.js').then((m) => ({ default: m.register })), public: true, guestOnly: true },
  { re: /^\/forgot-password$/, page: () => import('./pages/auth.js').then((m) => ({ default: m.forgot })), public: true },
  { re: /^\/reset-password$/, page: () => import('./pages/auth.js').then((m) => ({ default: m.reset })), public: true },
  { re: /^\/app\/?$/, page: () => import('./pages/dashboard.js'), nav: 'dashboard' },
  { re: /^\/app\/jobs$/, page: () => import('./pages/jobs.js'), nav: 'jobs' },
  { re: /^\/app\/jobs\/(\d+)$/, page: () => import('./pages/job-detail.js'), nav: 'jobs' },
  { re: /^\/app\/recommendations$/, page: () => import('./pages/recommendations.js'), nav: 'recommendations' },
  { re: /^\/app\/saved$/, page: () => import('./pages/saved.js'), nav: 'saved' },
  { re: /^\/app\/applications$/, page: () => import('./pages/applications.js'), nav: 'applications' },
  { re: /^\/app\/applications\/(\d+)$/, page: () => import('./pages/application-detail.js'), nav: 'applications' },
  { re: /^\/app\/resumes$/, page: () => import('./pages/resumes.js'), nav: 'resumes' },
  { re: /^\/app\/profile$/, page: () => import('./pages/profile.js'), nav: 'profile' },
  { re: /^\/app\/notifications$/, page: () => import('./pages/notifications.js'), nav: 'notifications' },
  { re: /^\/admin\/?$/, page: () => import('./pages/admin.js'), nav: 'admin', admin: true },
  { re: /^\/admin\/([a-z-]+)$/, page: () => import('./pages/admin.js'), nav: 'admin', admin: true },
];

export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  render();
  window.scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a || a.target === '_blank' || a.hasAttribute('download') || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  const href = a.getAttribute('href');
  if (!href || !href.startsWith('/') || href.startsWith('//') || href.startsWith('/api/') || href.startsWith('/vendor/')) return;
  e.preventDefault();
  navigate(href);
});
window.addEventListener('popstate', () => render());
window.addEventListener('cops:unauthorized', () => {
  if (state.user) { state.user = null; toast('Your session ended. Please sign in again.'); navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true }); }
});

export async function refreshSession() {
  const me = await api('/auth/me');
  state.user = me.user;
  state.registration = me.registration !== false;
  setCsrf(me.csrf || null);
  return me.user;
}

export function setTheme(pref) {
  try { localStorage.setItem('cops-theme', pref); } catch { /* storage unavailable */ }
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}
function currentThemeIsDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }

let renderSeq = 0;
export async function render() {
  const seq = ++renderSeq;
  const root = document.getElementById('app');
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const route = routes.find((r) => r.re.test(path));
  if (!route) { clear(root).append(notFound()); return; }
  const params = path.match(route.re).slice(1);
  if (!route.public && !state.user) { navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true }); return; }
  if (route.guestOnly && state.user) { navigate('/app', { replace: true }); return; }
  if (route.admin && state.user?.role !== 'admin') { clear(root).append(shell(route, h('div', { class: 'card' }, h('h2', null, 'Administrators only'), h('p', { class: 'muted' }, 'You do not have access to this section.')))); return; }
  const mod = await route.page();
  if (seq !== renderSeq) return;
  const ctx = { params, query: new URLSearchParams(location.search), navigate, state };
  if (route.public) {
    const node = await mod.default(ctx);
    if (seq === renderSeq) clear(root).append(node);
    return;
  }
  const content = h('div', { class: 'content' });
  clear(root).append(shell(route, content));
  try {
    const node = await mod.default(ctx, content);
    if (seq === renderSeq && node) content.append(node);
  } catch (err) {
    if (seq === renderSeq) content.append(h('div', { class: 'callout danger' }, icon('alert'), h('div', null, h('b', null, 'Could not load this page. '), err.message)));
  }
  updateBell();
}

function notFound() {
  return h('div', { class: 'auth-main', style: { minHeight: '100vh' } }, h('div', { class: 'auth-card', style: { textAlign: 'center' } },
    h('h1', null, 'Page not found'), h('p', { class: 'muted' }, 'The page you are looking for does not exist.'), h('a', { class: 'btn primary', href: state.user ? '/app' : '/' }, 'Go home')));
}

const NAV = [
  ['Workspace', [
    ['dashboard', '/app', 'home', 'Dashboard'],
    ['jobs', '/app/jobs', 'search', 'Discover jobs'],
    ['recommendations', '/app/recommendations', 'star', 'Recommended'],
    ['saved', '/app/saved', 'bookmark', 'Saved jobs'],
    ['applications', '/app/applications', 'briefcase', 'Applications'],
  ]],
  ['Profile', [
    ['resumes', '/app/resumes', 'file', 'Resumes'],
    ['profile', '/app/profile', 'user', 'Profile & preferences'],
    ['notifications', '/app/notifications', 'bell', 'Notifications'],
  ]],
];

function shell(route, content) {
  const wrap = h('div', { class: 'shell' });
  const closeNav = () => wrap.classList.remove('nav-open');
  const sections = NAV.map(([title, links]) => [
    h('div', { class: 'nav-section' }, title),
    links.map(([key, href, ic, label]) => h('a', { class: `nav-link ${route.nav === key ? 'active' : ''}`, href, onclick: closeNav }, icon(ic), label,
      key === 'notifications' && state.unread ? h('span', { class: 'count', id: 'nav-unread' }, String(state.unread)) : null)),
  ]);
  if (state.user?.role === 'admin') {
    sections.push(h('div', { class: 'nav-section' }, 'Administration'),
      h('a', { class: `nav-link ${route.nav === 'admin' ? 'active' : ''}`, href: '/admin', onclick: closeNav }, icon('shield'), 'Admin console'));
  }
  const sidebar = h('aside', { class: 'sidebar', 'aria-label': 'Main navigation' },
    h('a', { class: 'brand', href: '/app' }, h('span', { class: 'brand-mark' }, 'C'), 'Career-Ops'),
    sections,
    h('div', { class: 'sidebar-foot' },
      h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', padding: '6px 8px' } },
        h('div', { class: 'avatar' }, initials(state.user?.full_name)),
        h('div', { style: { minWidth: 0 } },
          h('div', { style: { fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, state.user?.full_name),
          h('div', { class: 'muted', style: { fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, state.user?.email))),
      h('button', { class: 'nav-link', style: { width: '100%', border: 0, background: 'none', cursor: 'pointer', font: 'inherit' }, onclick: logout }, icon('logout'), 'Sign out')));

  const search = h('input', { type: 'search', placeholder: 'Search jobs, companies or skills…', 'aria-label': 'Search jobs' });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate(`/app/jobs?q=${encodeURIComponent(search.value.trim())}`); });
  const themeBtn = h('button', { class: 'btn ghost icon-only', 'aria-label': 'Toggle dark mode', title: 'Toggle light / dark mode', onclick: () => {
    setTheme(currentThemeIsDark() ? 'light' : 'dark'); clear(themeBtn).append(icon(currentThemeIsDark() ? 'sun' : 'moon'));
    window.dispatchEvent(new Event('cops:theme'));
  } }, icon(currentThemeIsDark() ? 'sun' : 'moon'));

  const bellWrap = h('div', { class: 'rel' });
  const bellBtn = h('button', { class: 'btn ghost icon-only bell', 'aria-label': 'Notifications', id: 'bell' }, icon('bell'));
  bellWrap.append(bellBtn);
  bellBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const existing = bellWrap.querySelector('.dropdown');
    if (existing) { existing.remove(); return; }
    const dd = h('div', { class: 'dropdown', role: 'menu' }, h('div', { class: 'muted', style: { padding: '8px 12px' } }, 'Loading…'));
    bellWrap.append(dd);
    const close = (ev) => { if (!dd.contains(ev.target)) { dd.remove(); document.removeEventListener('click', close); } };
    setTimeout(() => document.addEventListener('click', close));
    try {
      const { items } = await api('/me/notifications');
      clear(dd);
      if (!items.length) dd.append(h('div', { class: 'muted', style: { padding: '10px 12px' } }, 'No notifications yet.'));
      for (const n of items.slice(0, 6)) {
        dd.append(h('a', { class: `item ${n.is_read ? '' : 'unread'}`, href: n.link || '/app/notifications', onclick: () => { api('/me/notifications/read', { method: 'POST', body: { id: n.id } }).then(updateBell).catch(() => {}); dd.remove(); } },
          h('div', null, n.title), h('div', { class: 'muted', style: { fontSize: '12px' } }, timeAgo(n.created_at))));
      }
      dd.append(h('a', { class: 'item', href: '/app/notifications', style: { color: 'var(--primary)', fontWeight: 600 }, onclick: () => dd.remove() }, 'View all notifications'));
    } catch (err) { clear(dd).append(h('div', { class: 'form-error' }, err.message)); }
  });

  const top = h('header', { class: 'topbar' },
    h('button', { class: 'btn ghost icon-only menu-toggle', 'aria-label': 'Open menu', onclick: () => wrap.classList.toggle('nav-open') }, icon('menu')),
    h('div', { class: 'search' }, icon('search'), search),
    h('div', { class: 'spacer' }),
    themeBtn, bellWrap,
    h('a', { href: '/app/profile', title: 'Profile', class: 'avatar', style: { textDecoration: 'none' } }, initials(state.user?.full_name)));
  wrap.append(sidebar, h('div', { class: 'scrim', onclick: closeNav }), h('div', { class: 'main' }, top, h('main', null, content)));
  return wrap;
}

export async function updateBell() {
  try {
    const { unread } = await api('/me/notifications').catch(() => ({ unread: 0 }));
    state.unread = unread;
    const bell = document.getElementById('bell');
    if (bell) {
      bell.querySelector('.dot')?.remove();
      if (unread) bell.append(h('span', { class: 'dot' }));
    }
    const navCount = document.getElementById('nav-unread');
    if (navCount) navCount.textContent = String(unread);
  } catch { /* ignore */ }
}

async function logout() {
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* already signed out */ }
  state.user = null; setCsrf(null);
  navigate('/', { replace: true });
}

(async function boot() {
  try { await refreshSession(); } catch { state.user = null; }
  render();
})();
