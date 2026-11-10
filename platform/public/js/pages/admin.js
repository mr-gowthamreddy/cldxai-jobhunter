import { h, icon, clear, fmtNum, fmtBytes, fmtDate, timeAgo, toast, errorToast, modal, field, formError, busy, confirmDialog, chart, chartBox, PALETTE, emptyState, linkBadge, arrangementBadge } from '../ui.js';
import { api } from '../api.js';
import { state } from '../main.js';

const SECTIONS = [
  ['overview', 'Overview', 'chart'], ['users', 'Users', 'users'], ['activity', 'Activity', 'activity'], ['resumes', 'Resumes', 'file'],
  ['jobs', 'Jobs', 'briefcase'], ['duplicates', 'Duplicates', 'copy'], ['sources', 'Job sources', 'database'],
  ['fetching', 'Fetching & logs', 'refresh'], ['sheets', 'Google Sheets', 'sheet'], ['errors', 'Errors', 'alert'], ['settings', 'Settings', 'settings'],
];

export default async function admin(ctx, container) {
  const section = SECTIONS.some(([k]) => k === ctx.params[0]) ? ctx.params[0] : 'overview';
  const tabs = h('div', { class: 'tabs' }, SECTIONS.map(([k, l, ic]) => h('a', { class: `tab ${k === section ? 'on' : ''}`, href: k === 'overview' ? '/admin' : `/admin/${k}` }, l)));
  const body = h('div');
  container.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Admin console'), h('p', null, 'Users, job pipeline, integrations and system health.'))), tabs, body);
  const fn = { overview, users, activity, resumes, jobs, duplicates, sources, fetching, sheets, errors, settings }[section];
  await fn(body, ctx);
}

const stat = (label, value, sub, color = '', ic = 'chart') => h('div', { class: 'card' }, h('div', { class: 'stat' }, h('div', { class: `ico ${color}` }, icon(ic)), h('div', null, h('div', { class: 'val' }, value), h('div', { class: 'lbl' }, label), sub ? h('div', { class: 'muted', style: { fontSize: '12px' } }, sub) : null)));
const tbl = (cols, rows) => h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, cols.map((c) => h('th', null, c)))), h('tbody', null, rows)));
const runBadge = (s) => h('span', { class: `badge ${{ success: 'success', partial: 'warning', failed: 'danger', running: 'info' }[s] || ''}` }, s);

async function triggerFetch(btn, sourceIds) {
  await busy(btn, async () => {
    try { const r = await api('/admin/fetch', { method: 'POST', body: sourceIds ? { source_ids: sourceIds } : {} }); toast(r.message, 'success'); } catch (err) { errorToast(err); }
  });
}

async function overview(body) {
  const o = await api('/admin/overview');
  const s = o.scheduler;
  const fetchBtn = h('button', { class: 'btn primary', onclick: (e) => triggerFetch(e.currentTarget) }, icon('refresh'), 'Run fetch now');
  body.append(
    h('div', { class: 'callout ' + (s.alive || s.mode === 'embedded' ? 'success' : 'warn'), style: { marginBottom: '16px' } }, icon(s.alive ? 'check' : 'alert'),
      h('div', { style: { flex: 1 } }, h('b', null, s.alive ? 'Scheduler running. ' : 'Scheduler worker is not running. '),
        `Daily refresh at ${s.daily_at} (server time) · next run ${fmtDate(s.next_run_at, true)} · last successful fetch ${s.last_successful_fetch_at ? timeAgo(s.last_successful_fetch_at) : 'never'}.`,
        s.alive ? '' : ' Start it with "npm run worker" (the start scripts do this), or set SCHEDULER_MODE=embedded.'),
      fetchBtn),
    h('div', { class: 'cards k4', style: { marginBottom: '16px' } },
      stat('Registered users', fmtNum(o.users.total), `${o.users.active || 0} active · ${o.users.pending || 0} pending · ${o.users.new_week || 0} new this week`, '', 'users'),
      stat('Visible jobs', fmtNum(o.jobs.visible), `${fmtNum(o.jobs.active)} active · ${fmtNum(o.jobs.new_day)} new today`, 'teal', 'briefcase'),
      stat('Expired / duplicate', `${fmtNum(o.jobs.expired)} / ${fmtNum(o.jobs.duplicate)}`, `${fmtNum(o.jobs.broken)} broken links · ${fmtNum(o.jobs.unspecified)} without a stated arrangement (hidden)`, 'amber', 'layers'),
      stat('Resumes stored', fmtNum(o.resumes.total), `${fmtBytes(o.resumes.bytes)} · ${o.resumes.failed || 0} failed to parse`, 'green', 'file')),
    h('div', { class: 'cards k4', style: { marginBottom: '16px' } },
      stat('Job sources', `${o.sources.enabled}/${o.sources.total}`, `${o.sources.failing || 0} failing on last run`, '', 'database'),
      stat('Errors (24h)', fmtNum(o.errors_24h), null, o.errors_24h ? 'red' : 'green', 'alert'),
      stat('Google Sheets', o.sheets.problem ? 'Not configured' : (o.sheets.last?.status || 'Ready'), o.sheets.problem || (o.sheets.last ? `${o.sheets.last.rows_written} rows · ${timeAgo(o.sheets.last.created_at)}` : ''), o.sheets.problem ? 'amber' : 'green', 'sheet'),
      stat('Email (SMTP)', o.mail.configured ? 'Configured' : 'Not configured', o.mail.configured ? null : 'Emails are saved to the outbox folder', o.mail.configured ? 'green' : 'amber', 'bell')));
  const runs = chartBox();
  const arr = chartBox('sm');
  const src = chartBox('sm');
  body.append(h('div', { class: 'split' },
    h('div', { class: 'card' }, h('h3', null, 'Recent fetch runs'), o.runs.length ? runs.box : emptyState('refresh', 'No fetch runs yet', 'Run a fetch to collect jobs.')),
    h('div', { class: 'stack' }, h('div', { class: 'card' }, h('h3', null, 'Active jobs by arrangement'), arr.box), h('div', { class: 'card' }, h('h3', null, 'Active jobs by source (top 12)'), src.box))));
  if (o.runs.length) chart(runs.canvas, { type: 'bar', data: { labels: o.runs.map((r) => fmtDate(r.started_at)), datasets: [
    { label: 'New', data: o.runs.map((r) => r.jobs_new), backgroundColor: PALETTE[0], borderRadius: 4 },
    { label: 'Refreshed', data: o.runs.map((r) => r.jobs_updated), backgroundColor: PALETTE[1], borderRadius: 4 },
    { label: 'Expired', data: o.runs.map((r) => r.jobs_expired), backgroundColor: PALETTE[7], borderRadius: 4 }] }, options: { scales: { y: { beginAtZero: true } } } });
  chart(arr.canvas, { type: 'doughnut', data: { labels: o.by_arrangement.map((x) => x.k), datasets: [{ data: o.by_arrangement.map((x) => x.n), backgroundColor: PALETTE, borderWidth: 0 }] }, options: { cutout: '60%', plugins: { legend: { position: 'right' } } } });
  chart(src.canvas, { type: 'bar', data: { labels: o.by_source.map((x) => x.k), datasets: [{ data: o.by_source.map((x) => x.n), backgroundColor: PALETTE[4], borderRadius: 4 }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } } } });
}

async function users(body) {
  const q = h('input', { type: 'search', placeholder: 'Search name or email' });
  const status = h('select', { style: { width: 'auto' } }, [['', 'All statuses'], ['active', 'Active'], ['pending', 'Pending approval'], ['disabled', 'Deactivated']].map(([v, l]) => h('option', { value: v }, l)));
  const role = h('select', { style: { width: 'auto' } }, [['', 'All roles'], ['user', 'Users'], ['admin', 'Admins']].map(([v, l]) => h('option', { value: v }, l)));
  const out = h('div');
  body.append(h('div', { class: 'toolbar' }, h('div', { class: 'grow' }, q), status, role), out);
  const load = async () => {
    const r = await api('/admin/users', { query: { q: q.value, status: status.value, role: role.value, page_size: 100 } });
    clear(out).append(h('p', { class: 'muted' }, `${r.total} accounts`), tbl(['User', 'Role', 'Status', 'Verified', 'Data', 'Joined', 'Last sign-in', 'Actions'], r.items.map((u) => {
      const self = u.id === state.user.id;
      const act = async (body2, msg) => { try { await api(`/admin/users/${u.id}`, { method: 'PATCH', body: body2 }); toast(msg, 'success'); load(); } catch (err) { errorToast(err); } };
      return h('tr', null,
        h('td', null, h('b', null, u.full_name), self ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, 'you') : null, h('div', { class: 'sub' }, u.email)),
        h('td', null, h('span', { class: `badge ${u.role === 'admin' ? 'primary' : ''}` }, u.role)),
        h('td', null, h('span', { class: `badge ${{ active: 'success', pending: 'warning', disabled: 'danger' }[u.status]}` }, u.status)),
        h('td', null, u.is_verified ? h('span', { class: 'badge success' }, 'Verified') : h('span', { class: 'badge' }, 'No')),
        h('td', { class: 'nowrap sub' }, `${u.resumes} resumes · ${u.applications} apps · ${u.saved_jobs} saved`),
        h('td', { class: 'nowrap' }, fmtDate(u.created_at)),
        h('td', { class: 'nowrap' }, u.last_login_at ? timeAgo(u.last_login_at) : 'never'),
        h('td', null, h('div', { class: 'btn-row' },
          u.status === 'pending' ? h('button', { class: 'btn sm primary', onclick: () => act({ status: 'active', is_verified: true }, 'Account approved') }, 'Approve') : null,
          !u.is_verified && u.status !== 'pending' ? h('button', { class: 'btn sm', onclick: () => act({ is_verified: true }, 'Marked as verified') }, 'Verify') : null,
          self ? null : u.status === 'disabled'
            ? h('button', { class: 'btn sm', onclick: () => act({ status: 'active' }, 'Account activated') }, 'Activate')
            : u.status === 'active' ? h('button', { class: 'btn sm', onclick: () => act({ status: 'disabled' }, 'Account deactivated') }, 'Deactivate') : null,
          self ? null : h('button', { class: 'btn sm', onclick: () => act({ role: u.role === 'admin' ? 'user' : 'admin' }, 'Role updated') }, u.role === 'admin' ? 'Make user' : 'Make admin'),
          h('a', { class: 'btn sm ghost', href: `/admin/activity?user_id=${u.id}` }, 'Activity'),
          self ? null : h('button', { class: 'btn sm ghost', title: 'Sign out everywhere', onclick: async () => { try { await api(`/admin/users/${u.id}/revoke-sessions`, { method: 'POST' }); toast('Sessions revoked'); } catch (err) { errorToast(err); } } }, icon('logout')),
          self ? null : h('button', { class: 'btn sm danger', title: 'Delete user', onclick: async () => {
            if (!(await confirmDialog(`Delete ${u.email} and all of their resumes, applications and data?`, { okText: 'Delete user', danger: true }))) return;
            try { await api(`/admin/users/${u.id}`, { method: 'DELETE' }); toast('User deleted'); load(); } catch (err) { errorToast(err); }
          } }, icon('trash')))));
    })));
  };
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
  status.addEventListener('change', load);
  role.addEventListener('change', load);
  await load();
}

async function activity(body, ctx) {
  const userId = ctx.query.get('user_id');
  const r = await api('/admin/activity', { query: { user_id: userId } });
  const detail = (d) => Object.entries(d || {}).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ');
  body.append(
    userId ? h('p', null, 'Filtered to one user · ', h('a', { href: '/admin/activity' }, 'show everyone')) : null,
    h('div', { class: 'cards k2' },
      h('div', null, h('h3', null, 'User activity'), h('p', { class: 'muted', style: { fontSize: '12px' } }, 'Action types only — resume contents and personal data are never logged.'),
        tbl(['When', 'User', 'Action', 'Details'], r.user_activity.map((a) => h('tr', null, h('td', { class: 'nowrap' }, timeAgo(a.created_at)), h('td', null, a.email || '—'), h('td', null, h('code', null, a.action)), h('td', { class: 'sub truncate' }, detail(a.details)))))),
      h('div', null, h('h3', null, 'Administrator actions'), h('p', { class: 'muted', style: { fontSize: '12px' } }, 'Audit log of every admin change.'),
        tbl(['When', 'Admin', 'Action', 'Target'], r.admin_activity.map((a) => h('tr', null, h('td', { class: 'nowrap' }, timeAgo(a.created_at)), h('td', null, a.actor_email || '—'), h('td', null, h('code', null, a.action)), h('td', { class: 'sub truncate' }, `${a.target_type} ${a.target_id} ${detail(a.details)}`)))))));
}

async function resumes(body) {
  const r = await api('/admin/resumes');
  const total = r.by_type.reduce((a, b) => a + b.n, 0);
  const daily = chartBox('sm');
  body.append(
    h('div', { class: 'callout', style: { marginBottom: '16px' } }, icon('lock'), h('div', null, 'Administrators see resume counts and file metadata only. Resume files and extracted personal details are never shown here.')),
    h('div', { class: 'cards k4', style: { marginBottom: '16px' } },
      stat('Total resumes', fmtNum(total), null, '', 'file'),
      ...r.by_type.map((t) => stat(t.file_ext.toUpperCase(), fmtNum(t.n), fmtBytes(t.bytes), 'teal', 'file')),
      ...r.by_status.map((s) => stat(`Parse: ${s.parse_status}`, fmtNum(s.n), null, s.parse_status === 'failed' ? 'red' : 'green', 'zap'))),
    h('div', { class: 'split' },
      h('div', { class: 'card' }, h('h3', null, 'Uploads in the last 30 days'), r.daily.length ? daily.box : emptyState('upload', 'No uploads yet', null)),
      h('div', { class: 'card' }, h('h3', null, 'Resumes per user'), tbl(['User', 'Count', 'Last upload'], r.per_user.map((u) => h('tr', null, h('td', null, u.email), h('td', null, String(u.n)), h('td', null, timeAgo(u.last_upload))))))));
  if (r.daily.length) chart(daily.canvas, { type: 'bar', data: { labels: r.daily.map((d) => d.d), datasets: [{ data: r.daily.map((d) => d.n), backgroundColor: PALETTE[0], borderRadius: 4 }] }, options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { precision: 0 } } } } });
}

async function jobs(body, ctx) {
  const q = h('input', { type: 'search', placeholder: 'Title or company' });
  const status = h('select', { style: { width: 'auto' } }, [['', 'Any status'], ['active', 'Active'], ['expired', 'Expired'], ['closed', 'Closed'], ['broken', 'Broken'], ['duplicate', 'Duplicate']].map(([v, l]) => h('option', { value: v, selected: ctx.query.get('status') === v }, l)));
  const arr = h('select', { style: { width: 'auto' } }, [['', 'Any arrangement'], ['Remote', 'Remote'], ['Hybrid', 'Hybrid'], ['WFO', 'WFO'], ['Unspecified', 'Unspecified (hidden)']].map(([v, l]) => h('option', { value: v }, l)));
  const link = h('select', { style: { width: 'auto' } }, [['', 'Any link status'], ['source_confirmed', 'Live on source'], ['verified', 'Verified'], ['unverified', 'Unverified'], ['broken', 'Broken'], ['expired', 'Expired']].map(([v, l]) => h('option', { value: v }, l)));
  const out = h('div');
  let page = 1;
  body.append(h('div', { class: 'toolbar' }, h('div', { class: 'grow' }, q), status, arr, link), out);
  const load = async () => {
    const r = await api('/admin/jobs', { query: { q: q.value, status: status.value, arrangement: arr.value, link_status: link.value, page, page_size: 50 } });
    const pages = Math.ceil(r.total / r.page_size);
    clear(out).append(h('p', { class: 'muted' }, `${fmtNum(r.total)} jobs`), tbl(['Job', 'Source', 'Arrangement', 'Status', 'Link', 'Seen', 'Actions'], r.items.map((j) => h('tr', null,
      h('td', null, h('a', { href: `/app/jobs/${j.id}` }, j.title), h('div', { class: 'sub' }, `${j.company} · ${j.location || '—'}`)),
      h('td', null, j.source_name || '—', j.is_direct ? h('div', { class: 'sub' }, 'direct') : null),
      h('td', null, j.work_arrangement === 'Unspecified' ? h('span', { class: 'badge' }, 'Unspecified') : arrangementBadge(j.work_arrangement)),
      h('td', null, h('span', { class: `badge ${j.status === 'active' ? 'success' : j.status === 'duplicate' ? 'warning' : 'danger'}` }, j.status), j.missed_fetches ? h('div', { class: 'sub' }, `missed ${j.missed_fetches} fetch(es)`) : null),
      h('td', { title: j.link_check_note || '' }, linkBadge(j.link_status)),
      h('td', { class: 'nowrap sub' }, `first ${fmtDate(j.first_seen_at)}`, h('br'), `last ${timeAgo(j.last_seen_at)}`),
      h('td', null, h('div', { class: 'btn-row' },
        h('button', { class: 'btn sm', onclick: async (e) => { await busy(e.currentTarget, async () => { try { const x = await api(`/admin/jobs/${j.id}/check-link`, { method: 'POST' }); toast(`Link: ${x.result.result} — ${x.result.reason}`); load(); } catch (err) { errorToast(err); } }); } }, 'Check link'),
        j.status === 'active' ? h('button', { class: 'btn sm danger', onclick: async () => { try { await api(`/admin/jobs/${j.id}`, { method: 'PATCH', body: { status: 'closed' } }); toast('Marked closed'); load(); } catch (err) { errorToast(err); } } }, 'Close')
          : j.status !== 'duplicate' ? h('button', { class: 'btn sm', onclick: async () => { try { await api(`/admin/jobs/${j.id}`, { method: 'PATCH', body: { status: 'active' } }); toast('Reactivated'); load(); } catch (err) { errorToast(err); } } }, 'Reactivate') : null))))),
    pages > 1 ? h('div', { class: 'pager' }, h('button', { class: 'btn sm', disabled: page <= 1, onclick: () => { page--; load(); } }, 'Previous'), h('span', { class: 'muted' }, `Page ${page} of ${pages}`), h('button', { class: 'btn sm', disabled: page >= pages, onclick: () => { page++; load(); } }, 'Next')) : null);
  };
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { page = 1; load(); } });
  for (const s of [status, arr, link]) s.addEventListener('change', () => { page = 1; load(); });
  await load();
}

async function duplicates(body) {
  const load = async () => {
    const r = await api('/admin/duplicates');
    clear(body).append(h('p', { class: 'muted' }, 'Postings detected as the same job (same company, title and location) from different URLs. The primary record is the one users see; the employer’s own link is preferred automatically.'),
      r.items.length ? tbl(['Duplicate', 'Primary (shown to users)', 'Actions'], r.items.map((d) => h('tr', null,
        h('td', null, h('b', null, d.title), h('div', { class: 'sub' }, `${d.company} · ${d.source_name || '—'}${d.is_direct ? ' · direct' : ''}`), h('a', { href: d.apply_url, target: '_blank', rel: 'noopener noreferrer', class: 'sub' }, 'open link')),
        h('td', null, h('a', { href: `/app/jobs/${d.primary_id}` }, `#${d.primary_id}`), h('div', { class: 'sub' }, `${d.primary_source || '—'}${d.primary_direct ? ' · direct' : ''} · ${d.primary_status}`)),
        h('td', null, h('div', { class: 'btn-row' },
          h('button', { class: 'btn sm', onclick: async () => { try { await api(`/admin/jobs/${d.id}/make-primary`, { method: 'POST' }); toast('Primary swapped'); load(); } catch (err) { errorToast(err); } } }, 'Make primary'),
          h('button', { class: 'btn sm', onclick: async () => { try { await api(`/admin/jobs/${d.id}/not-duplicate`, { method: 'POST' }); toast('Unmarked — both jobs are now shown'); load(); } catch (err) { errorToast(err); } } }, 'Not a duplicate')))))) : emptyState('copy', 'No duplicates detected', null));
  };
  await load();
}

async function sources(body) {
  const [{ items }, { providers }] = await Promise.all([api('/admin/sources'), api('/admin/providers')]);
  const addBtn = h('button', { class: 'btn primary', onclick: () => sourceDialog(null) }, icon('plus'), 'Add source');
  body.append(
    h('div', { class: 'toolbar' }, h('p', { class: 'muted grow', style: { margin: 0 } }, 'Sources are read through career-ops’ provider modules: public, no-login ATS APIs and job feeds. Company boards give direct application links.'), addBtn),
    tbl(['Source', 'Kind', 'Provider / URL', 'Active jobs', 'Last run', 'Enabled', 'Actions'], items.map((s) => {
      const en = h('input', { type: 'checkbox', checked: s.enabled, 'aria-label': `Enable ${s.name}` });
      en.addEventListener('change', async () => { try { await api(`/admin/sources/${s.id}`, { method: 'PATCH', body: { enabled: en.checked } }); toast(en.checked ? 'Source enabled' : 'Source disabled'); } catch (err) { errorToast(err); en.checked = !en.checked; } });
      return h('tr', null,
        h('td', null, h('b', null, s.name)),
        h('td', null, h('span', { class: `badge ${s.kind === 'company' ? 'primary' : ''}` }, s.kind === 'company' ? 'Company (direct)' : 'Aggregator')),
        h('td', { class: 'sub truncate' }, s.provider || s.careers_url),
        h('td', null, fmtNum(s.active_jobs)),
        h('td', { class: 'nowrap' }, s.last_fetch_at ? [h('span', { class: `badge ${s.last_status === 'ok' ? 'success' : 'danger'}` }, s.last_status), ' ', h('span', { class: 'sub' }, timeAgo(s.last_fetch_at))] : h('span', { class: 'sub' }, 'never'), s.last_error ? h('div', { class: 'sub', style: { color: 'var(--danger)' } }, s.last_error) : null),
        h('td', null, en),
        h('td', null, h('div', { class: 'btn-row' },
          h('button', { class: 'btn sm', onclick: (e) => testSource(e.currentTarget, s) }, 'Test'),
          h('button', { class: 'btn sm', onclick: (e) => triggerFetch(e.currentTarget, [s.id]) }, 'Fetch'),
          h('button', { class: 'btn sm ghost', onclick: () => sourceDialog(s) }, icon('edit')),
          h('button', { class: 'btn sm danger', onclick: async () => { if (!(await confirmDialog(`Remove ${s.name}? Its active jobs are closed.`, { okText: 'Remove', danger: true }))) return; try { await api(`/admin/sources/${s.id}`, { method: 'DELETE' }); toast('Source removed'); location.reload(); } catch (err) { errorToast(err); } } }, icon('trash')))));
    })));

  async function testSource(btn, s) {
    await busy(btn, async () => {
      const r = await api(`/admin/sources/${s.id}/test`, { method: 'POST' });
      modal({ title: `Test: ${s.name}`, wide: true, content: r.ok
        ? h('div', null, h('div', { class: 'form-ok' }, `${r.provider} returned ${r.count} postings.`), tbl(['Title', 'Company', 'Location'], r.sample.map((j) => h('tr', null, h('td', null, j.title), h('td', null, j.company), h('td', null, j.location)))))
        : h('div', { class: 'form-error' }, r.error) });
    });
  }

  function sourceDialog(s) {
    modal({
      title: s ? `Edit ${s.name}` : 'Add a job source',
      content: (close) => {
        const name = h('input', { type: 'text', value: s?.name || '', required: true });
        const kind = h('select', null, [['company', 'Company career board (direct links)'], ['aggregator', 'Aggregator / job board feed']].map(([v, l]) => h('option', { value: v, selected: (s?.kind || 'company') === v }, l)));
        const url = h('input', { type: 'url', value: s?.careers_url || '', placeholder: 'https://job-boards.greenhouse.io/acme · https://jobs.lever.co/acme · https://jobs.ashbyhq.com/acme' });
        const provider = h('select', null, h('option', { value: '' }, 'Auto-detect from URL'), providers.map((p) => h('option', { value: p, selected: s?.provider === p }, p)));
        const remoteOnly = h('input', { type: 'checkbox', checked: Boolean(s?.config?.remote_only) });
        const btn = h('button', { class: 'btn primary', type: 'submit' }, s ? 'Save' : 'Add source');
        const form = h('form', null, field('Name', name), field('Kind', kind),
          field('Careers URL', url, 'Supported: Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, BambooHR, Teamtailor, Workday and 100+ more.'),
          field('Provider', provider, 'Pick explicitly for feeds without a URL (Remotive, Himalayas, Jobicy, RemoteOK, Arbeitnow, …).'),
          h('label', { class: 'check' }, remoteOnly, 'Every posting from this source is remote'),
          h('div', { class: 'modal-foot' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), btn));
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          busy(btn, async () => {
            try {
              const payload = { name: name.value, kind: kind.value, careers_url: url.value, provider: provider.value, config: { ...(s?.config || {}), remote_only: remoteOnly.checked } };
              if (s) await api(`/admin/sources/${s.id}`, { method: 'PATCH', body: payload });
              else await api('/admin/sources', { method: 'POST', body: payload });
              close(); toast('Source saved', 'success'); location.reload();
            } catch (err) { formError(form, err.message); }
          });
        });
        return form;
      },
    });
  }
}

async function fetching(body) {
  const r = await api('/admin/fetch-runs');
  const level = h('select', { style: { width: 'auto' } }, [['', 'All log levels'], ['error', 'Errors'], ['warn', 'Warnings'], ['info', 'Info']].map(([v, l]) => h('option', { value: v }, l)));
  const logs = h('div');
  const loadLogs = async () => {
    const l = await api('/admin/logs', { query: { level: level.value } });
    clear(logs).append(tbl(['When', 'Level', 'Source', 'Message'], l.items.map((x) => h('tr', null, h('td', { class: 'nowrap' }, timeAgo(x.created_at)), h('td', null, h('span', { class: `badge ${{ error: 'danger', warn: 'warning', info: '' }[x.level]}` }, x.level)), h('td', null, x.source_name || '—'), h('td', { style: { maxWidth: '640px', overflowWrap: 'anywhere' } }, x.message)))));
  };
  level.addEventListener('change', loadLogs);
  body.append(
    h('div', { class: 'toolbar' }, h('p', { class: 'muted grow', style: { margin: 0 } }, `Scheduler: ${r.scheduler.alive ? 'running' : 'not running'} · daily at ${r.scheduler.daily_at} · next ${fmtDate(r.scheduler.next_run_at, true)}${r.scheduler.fetch_requested ? ' · manual run queued' : ''}`),
      h('button', { class: 'btn primary', onclick: (e) => triggerFetch(e.currentTarget) }, icon('refresh'), 'Run fetch now')),
    h('h3', null, 'Fetch runs'),
    tbl(['Started', 'Trigger', 'Status', 'Sources', 'New', 'Refreshed', 'Expired', 'Duplicates', 'Links checked', 'Summary', ''], r.items.map((x) => h('tr', null,
      h('td', { class: 'nowrap' }, fmtDate(x.started_at, true)), h('td', null, x.trigger), h('td', null, runBadge(x.status)),
      h('td', null, `${x.sources_total - x.sources_failed}/${x.sources_total}`), h('td', null, fmtNum(x.jobs_new)), h('td', null, fmtNum(x.jobs_updated)),
      h('td', null, fmtNum(x.jobs_expired)), h('td', null, fmtNum(x.jobs_duplicate)), h('td', null, `${x.links_checked} (${x.links_broken} bad)`),
      h('td', { class: 'sub truncate' }, x.summary),
      h('td', null, h('button', { class: 'btn sm', onclick: async () => {
        const l = await api(`/admin/fetch-runs/${x.id}/logs`);
        modal({ title: `Run #${x.id} log`, wide: true, content: tbl(['Level', 'Source', 'Message'], l.items.map((y) => h('tr', null, h('td', null, y.level), h('td', null, y.source_name || '—'), h('td', { style: { overflowWrap: 'anywhere' } }, y.message)))) });
      } }, 'Log'))))),
    h('div', { class: 'toolbar', style: { marginTop: '22px' } }, h('h3', { class: 'grow', style: { margin: 0 } }, 'Scheduler & fetch logs'), level), logs);
  await loadLogs();
}

async function sheets(body) {
  const r = await api('/admin/sheets');
  const syncBtn = h('button', { class: 'btn primary', disabled: Boolean(r.problem), onclick: (e) => busy(e.currentTarget, async () => {
    try { const x = await api('/admin/sheets/sync', { method: 'POST' }); toast(x.status === 'success' ? `Synced ${x.rows} new rows to “${x.tab}”` : `Sync ${x.status}: ${x.message || ''}`, x.status === 'success' ? 'success' : 'error'); } catch (err) { errorToast(err); }
  }) }, icon('sheet'), 'Sync today’s jobs now');
  body.append(
    r.problem
      ? h('div', { class: 'callout warn', style: { marginBottom: '16px' } }, icon('alert'), h('div', null, h('b', null, 'Google Sheets is not configured. '), r.problem, h('div', { style: { marginTop: '6px' } }, 'Set the GOOGLE_* variables in platform/.env (see platform/docs/GOOGLE_SHEETS.md) and restart the server and worker.')))
      : h('div', { class: 'callout success', style: { marginBottom: '16px' } }, icon('check'), h('div', null, `Configured · spreadsheet ${r.spreadsheet_id} · tabs named “${r.tab_prefix} YYYY-MM-DD”. The worker syncs after each daily fetch.`)),
    h('div', { class: 'toolbar' }, h('div', { class: 'grow' }), syncBtn),
    tbl(['When', 'Tab', 'Status', 'Rows', 'Message'], r.logs.map((x) => h('tr', null, h('td', { class: 'nowrap' }, fmtDate(x.created_at, true)), h('td', null, x.tab_name), h('td', null, runBadge(x.status === 'skipped' ? 'partial' : x.status), ' ', x.status), h('td', null, String(x.rows_written)), h('td', { class: 'sub', style: { overflowWrap: 'anywhere' } }, x.message)))));
}

async function errors(body) {
  const r = await api('/admin/errors');
  body.append(
    r.failing_sources.length ? h('div', { class: 'card', style: { marginBottom: '16px' } }, h('h3', null, 'Sources failing on their last run'), tbl(['Source', 'Error', 'When'], r.failing_sources.map((s) => h('tr', null, h('td', null, s.name), h('td', { class: 'sub' }, s.last_error), h('td', null, timeAgo(s.last_fetch_at)))))) : null,
    h('h3', null, 'Application errors'), r.system.length ? tbl(['When', 'Where', 'Message'], r.system.map((e) => h('tr', null, h('td', { class: 'nowrap' }, timeAgo(e.created_at)), h('td', null, h('code', null, e.context)), h('td', { style: { overflowWrap: 'anywhere' } }, e.message)))) : emptyState('check', 'No application errors', null),
    h('h3', { style: { marginTop: '20px' } }, 'Fetch errors'), r.fetch.length ? tbl(['When', 'Source', 'Message'], r.fetch.map((e) => h('tr', null, h('td', { class: 'nowrap' }, timeAgo(e.created_at)), h('td', null, e.source_name || '—'), h('td', { style: { overflowWrap: 'anywhere' } }, e.message)))) : emptyState('check', 'No fetch errors', null));
}

async function settings(body) {
  const s = await api('/admin/settings');
  const daily = h('input', { type: 'time', value: s.fetch_daily_at });
  const bands = s.experience_bands.map((b) => ({ ...b }));
  const bandBox = h('div');
  const renderBands = () => {
    clear(bandBox).append(tbl(['Label', 'Min years', 'Max years (empty = no limit)', ''], bands.map((b, i) => {
      const lbl = h('input', { type: 'text', value: b.label }); lbl.addEventListener('input', () => { b.label = lbl.value; });
      const mn = h('input', { type: 'number', min: 0, step: '0.5', value: b.min }); mn.addEventListener('input', () => { b.min = mn.value; });
      const mx = h('input', { type: 'number', min: 0, step: '0.5', value: b.max ?? '' }); mx.addEventListener('input', () => { b.max = mx.value === '' ? null : mx.value; });
      return h('tr', null, h('td', null, lbl), h('td', null, mn), h('td', null, mx), h('td', null, h('button', { class: 'btn sm ghost', onclick: () => { bands.splice(i, 1); renderBands(); } }, icon('trash'))));
    })), h('button', { class: 'btn sm', style: { marginTop: '8px' }, onclick: () => { bands.push({ id: `band-${Date.now()}`, label: 'New band', min: 0, max: null }); renderBands(); } }, icon('plus'), 'Add band'));
  };
  renderBands();
  const save = h('button', { class: 'btn primary' }, 'Save settings');
  const form = h('div', { class: 'card' });
  save.addEventListener('click', () => busy(save, async () => {
    formError(form, null);
    try { await api('/admin/settings', { method: 'PUT', body: { fetch_daily_at: daily.value, experience_bands: bands } }); toast('Settings saved — jobs relabelled with the new bands', 'success'); } catch (err) { formError(form, err.message); }
  }));
  form.append(
    h('h3', null, 'Daily job refresh'), field('Fetch time (server local time, 24h)', daily, 'The worker runs a full fetch, link verification, notifications and Sheets sync once a day at this time.'),
    h('h3', { style: { marginTop: '18px' } }, 'Experience categories'), h('p', { class: 'muted' }, 'Labels shown on jobs and used in filters. Bands only label jobs; they never exclude any experience range.'), bandBox,
    h('div', { style: { marginTop: '16px' } }, save));
  body.append(form,
    h('div', { class: 'card' }, h('h3', null, 'Registration'), h('dl', { class: 'kv' },
      h('dt', null, 'Open registration'), h('dd', null, s.registration.allow ? 'Yes' : 'No'),
      h('dt', null, 'Admin approval'), h('dd', null, s.registration.require_approval ? 'Required' : 'Not required')),
      h('p', { class: 'muted', style: { fontSize: '12px' } }, 'Change ALLOW_REGISTRATION / REQUIRE_ADMIN_APPROVAL in platform/.env and restart.')),
    h('div', { class: 'card' }, h('h3', null, 'Job categories'), h('div', { class: 'chips' }, s.categories.map((c) => h('span', { class: `chip ${c.featured ? '' : 'neutral'}` }, c.name)))));
}
