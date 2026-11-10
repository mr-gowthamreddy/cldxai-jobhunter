import { h, icon, clear, field, formError, busy, toast, errorToast, tagInput, confirmDialog, fmtDate } from '../ui.js';
import { api, setCsrf } from '../api.js';
import { state, setTheme } from '../main.js';

const TABS = [['profile', 'Profile'], ['preferences', 'Job preferences'], ['searches', 'Saved searches'], ['security', 'Security & account']];

export default async function profile(ctx, container) {
  const tab = TABS.some(([k]) => k === ctx.query.get('tab')) ? ctx.query.get('tab') : 'profile';
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([k, l]) => h('a', { class: `tab ${k === tab ? 'on' : ''}`, href: `/app/profile?tab=${k}`, role: 'tab' }, l)));
  const body = h('div');
  container.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Profile & preferences'), h('p', null, 'Manage your details, what you are looking for and your account.'))), tabs, body);
  if (tab === 'profile') await profileTab(body);
  if (tab === 'preferences') await prefsTab(body);
  if (tab === 'searches') await searchesTab(body);
  if (tab === 'security') securityTab(body, ctx);
}

async function profileTab(body) {
  const { user, profile: p } = await api('/me/profile');
  const name = h('input', { type: 'text', value: user.full_name, required: true });
  const headline = h('input', { type: 'text', value: p.headline || '', placeholder: 'e.g. Data Engineer · Azure · Databricks' });
  const phone = h('input', { type: 'text', value: p.phone || '' });
  const location = h('input', { type: 'text', value: p.location || '' });
  const linkedin = h('input', { type: 'url', value: p.linkedin_url || '', placeholder: 'https://linkedin.com/in/…' });
  const portfolio = h('input', { type: 'url', value: p.portfolio_url || '', placeholder: 'https://…' });
  const bio = h('textarea', { value: p.bio || '' });
  const theme = h('select', null, [['system', 'Match my system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => h('option', { value: v, selected: (p.theme || 'system') === v }, l)));
  const emailNotif = h('input', { type: 'checkbox', checked: p.email_notifications });
  const save = h('button', { class: 'btn primary', type: 'submit' }, 'Save profile');
  const form = h('form', { class: 'card' },
    h('div', { class: 'grid-2' }, field('Full name', name), field('Email', h('input', { type: 'email', value: user.email, disabled: true }), 'Contact an administrator to change your sign-in email.')),
    field('Headline', headline),
    h('div', { class: 'grid-2' }, field('Phone', phone), field('Location', location)),
    h('div', { class: 'grid-2' }, field('LinkedIn', linkedin), field('Portfolio / GitHub', portfolio)),
    field('About you', bio),
    h('div', { class: 'grid-2' }, field('Theme', theme), h('div', { class: 'field' }, h('label', null, 'Email'), h('label', { class: 'check' }, emailNotif, 'Email me about new matching jobs (when the server has email configured)'))),
    h('p', { class: 'muted', style: { fontSize: '12px' } }, `Member since ${fmtDate(user.created_at)} · last sign-in ${fmtDate(user.last_login_at, true)}`),
    save);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    formError(form, null);
    busy(save, async () => {
      try {
        await api('/me/profile', { method: 'PUT', body: { full_name: name.value, headline: headline.value, phone: phone.value, location: location.value, linkedin_url: linkedin.value, portfolio_url: portfolio.value, bio: bio.value, theme: theme.value, email_notifications: emailNotif.checked } });
        state.user.full_name = name.value;
        setTheme(theme.value);
        toast('Profile saved', 'success');
      } catch (err) { formError(form, err.message); }
    });
  });
  body.append(form);
}

async function prefsTab(body) {
  const [{ preferences: p }, meta] = await Promise.all([api('/me/preferences'), api('/jobs/meta')]);
  const titles = tagInput(p.desired_titles, { placeholder: 'e.g. Data Engineer, Analytics Engineer' });
  const skills = tagInput(p.desired_skills, { placeholder: 'Extra skills to match on (added to your resume skills)' });
  const locations = tagInput(p.locations, { placeholder: 'e.g. Bengaluru, Hyderabad, Remote India' });
  const cats = new Set(p.categories);
  const catBox = h('div', { class: 'cat-pills' }, meta.categories.filter((c) => c.slug !== 'other').map((c) => {
    const b = h('button', { type: 'button', class: `pill ${cats.has(c.slug) ? 'on' : ''}` }, c.name);
    b.addEventListener('click', () => { if (cats.has(c.slug)) cats.delete(c.slug); else cats.add(c.slug); b.classList.toggle('on'); });
    return b;
  }));
  const arr = ['Remote', 'Hybrid', 'WFO'].map((a) => ({ a, cb: h('input', { type: 'checkbox', checked: p.work_arrangements.includes(a) }) }));
  const years = h('input', { type: 'number', min: 0, max: 60, step: '0.5', value: p.experience_years ?? '', placeholder: 'Use the value from my resume' });
  const minSalary = h('input', { type: 'number', min: 0, value: p.min_salary ?? '' });
  const currency = h('input', { type: 'text', maxlength: 8, value: p.salary_currency || '', placeholder: 'INR, USD, EUR…' });
  const minMatch = h('input', { type: 'range', min: 0, max: 100, step: 5, value: p.min_match_score ?? 50 });
  const minMatchLbl = h('b', null, `${minMatch.value}%`);
  minMatch.addEventListener('input', () => { minMatchLbl.textContent = `${minMatch.value}%`; });
  const notify = h('input', { type: 'checkbox', checked: Boolean(p.notify_new_matches) });
  const save = h('button', { class: 'btn primary', type: 'submit' }, 'Save preferences');
  const form = h('form', { class: 'card' },
    field('Target job titles', titles.el, 'Titles you want next. They boost matching jobs, whatever your profession.'),
    h('div', { class: 'field' }, h('label', null, 'Categories you follow'), catBox),
    field('Additional skills', skills.el),
    h('div', { class: 'field' }, h('label', null, 'Work arrangements'), h('div', { class: 'btn-row' }, arr.map(({ a, cb }) => h('label', { class: 'check' }, cb, a === 'WFO' ? 'Work from office' : a)))),
    field('Preferred locations', locations.el, 'Remote jobs always count as a location match.'),
    h('div', { class: 'grid-3' }, field('Years of experience (override)', years), field('Minimum salary (annual)', minSalary), field('Currency', currency)),
    h('div', { class: 'field' }, h('label', null, 'Minimum match for recommendations and alerts: ', minMatchLbl), minMatch),
    h('label', { class: 'check', style: { marginBottom: '16px' } }, notify, 'Notify me when new jobs match my resume'),
    save);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    formError(form, null);
    busy(save, async () => {
      try {
        await api('/me/preferences', { method: 'PUT', body: {
          desired_titles: titles.get(), desired_skills: skills.get(), locations: locations.get(), categories: [...cats],
          work_arrangements: arr.filter((x) => x.cb.checked).map((x) => x.a), experience_years: years.value, min_salary: minSalary.value,
          salary_currency: currency.value, min_match_score: Number(minMatch.value), notify_new_matches: notify.checked,
        } });
        toast('Preferences saved — recommendations updated', 'success');
      } catch (err) { formError(form, err.message); }
    });
  });
  body.append(form);
}

async function searchesTab(body) {
  const { searches } = await api('/me/searches');
  const card = h('div', { class: 'card' });
  if (!searches.length) card.append(h('p', { class: 'muted' }, 'No saved searches. Use “Save search & alert” on the Discover jobs page.'));
  for (const s of searches) {
    const notify = h('input', { type: 'checkbox', checked: s.notify });
    notify.addEventListener('change', async () => { try { await api(`/me/searches/${s.id}`, { method: 'PATCH', body: { notify: notify.checked } }); toast(notify.checked ? 'Alerts on' : 'Alerts off'); } catch (err) { errorToast(err); } });
    const summary = Object.entries(s.query).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ') || 'All jobs';
    const row = h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' } },
      h('div', { style: { flex: 1, minWidth: 0 } }, h('a', { href: `/app/jobs?saved=${s.id}`, style: { fontWeight: 700 } }, s.name), h('div', { class: 'muted', style: { fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, summary)),
      h('label', { class: 'check' }, notify, 'Alerts'),
      h('button', { class: 'btn sm danger', onclick: async () => { try { await api(`/me/searches/${s.id}`, { method: 'DELETE' }); row.remove(); toast('Saved search deleted'); } catch (err) { errorToast(err); } } }, icon('trash')));
    card.append(row);
  }
  body.append(card);
}

function securityTab(body, ctx) {
  const current = h('input', { type: 'password', autocomplete: 'current-password' });
  const next = h('input', { type: 'password', autocomplete: 'new-password' });
  const confirm = h('input', { type: 'password', autocomplete: 'new-password' });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Change password');
  const pwForm = h('form', { class: 'card' }, h('h3', null, 'Change password'), field('Current password', current), h('div', { class: 'grid-2' }, field('New password', next, 'At least 8 characters with a letter and a number.'), field('Confirm new password', confirm)), btn);
  pwForm.addEventListener('submit', (e) => {
    e.preventDefault();
    formError(pwForm, null);
    if (next.value !== confirm.value) return formError(pwForm, 'The new passwords do not match.');
    busy(btn, async () => {
      try { await api('/auth/change-password', { method: 'POST', body: { current_password: current.value, new_password: next.value } }); toast('Password changed. Other devices were signed out.', 'success'); pwForm.reset(); } catch (err) { formError(pwForm, err.message); }
    });
  });
  const delPw = h('input', { type: 'password', autocomplete: 'current-password' });
  const delBtn = h('button', { class: 'btn danger', type: 'submit' }, icon('trash'), 'Delete my account');
  const delForm = h('form', { class: 'card' }, h('h3', null, 'Delete account'),
    h('p', { class: 'text-2' }, 'Permanently deletes your account, every uploaded resume, your applications, saved jobs and preferences. This cannot be undone.'),
    field('Confirm with your password', delPw), delBtn);
  delForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError(delForm, null);
    if (!(await confirmDialog('Your data will be removed permanently.', { title: 'Delete your account?', okText: 'Delete everything', danger: true }))) return;
    busy(delBtn, async () => {
      try { await api('/me/account', { method: 'DELETE', body: { password: delPw.value } }); state.user = null; setCsrf(null); ctx.navigate('/', { replace: true }); toast('Your account was deleted.'); } catch (err) { formError(delForm, err.message); }
    });
  });
  body.append(pwForm, delForm);
}
