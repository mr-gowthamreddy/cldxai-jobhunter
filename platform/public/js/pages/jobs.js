import { h, icon, clear, skeleton, emptyState, toast, errorToast, modal, field, formError, busy, timeAgo } from '../ui.js';
import { api } from '../api.js';
import { jobCard, noProfileCallout } from '../components.js';
import { navigate } from '../main.js';

const ARR_LABEL = { Remote: 'Remote', Hybrid: 'Hybrid', WFO: 'Work from office' };
const POSTED = [['', 'Any time'], ['1', 'Last 24 hours'], ['3', 'Last 3 days'], ['7', 'Last 7 days'], ['14', 'Last 14 days'], ['30', 'Last 30 days']];
const SORTS = [['match', 'Best match'], ['relevance', 'Most relevant'], ['newest', 'Newest'], ['company', 'Company A–Z'], ['salary', 'Highest salary']];
const LIST_KEYS = ['category', 'bands', 'arrangement', 'source', 'skills', 'company', 'location'];

function readFilters(q) {
  const f = {};
  for (const [k, v] of q.entries()) f[k] = v;
  for (const k of LIST_KEYS) f[k] = f[k] ? f[k].split(',').filter(Boolean) : [];
  return f;
}
function toQuery(f) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    q.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  return q;
}

export default async function jobs(ctx, container) {
  const meta = await api('/jobs/meta');
  const f = readFilters(ctx.query);
  if (f.saved) {
    // Load a saved search into the filters, then drop the id from the URL.
    const { searches } = await api('/me/searches');
    const s = searches.find((x) => String(x.id) === String(f.saved));
    delete f.saved;
    if (s) Object.assign(f, readFilters(new URLSearchParams(Object.entries(s.query).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)]))));
  }
  const apply = (patch = {}, { resetPage = true } = {}) => {
    Object.assign(f, patch);
    if (resetPage) delete f.page;
    history.replaceState(null, '', `/app/jobs?${toQuery(f)}`);
    load();
  };

  const toggleIn = (key, value) => {
    const arr = new Set(f[key] || []);
    if (arr.has(value)) arr.delete(value); else arr.add(value);
    apply({ [key]: [...arr] });
  };

  // Header + category pills
  const head = h('div', { class: 'page-head' },
    h('div', null, h('h1', null, 'Discover jobs'),
      h('p', null, `${meta.total_active.toLocaleString()} active, verified openings · updated ${meta.last_updated ? timeAgo(meta.last_updated) : '—'} · next refresh ${meta.next_refresh ? new Date(meta.next_refresh).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}`)),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: () => saveSearchDialog(f) }, icon('bell'), 'Save search & alert')));

  const featured = meta.categories.filter((c) => c.featured);
  const pills = h('div', { class: 'cat-pills', role: 'group', 'aria-label': 'Featured categories' },
    featured.map((c) => h('button', { class: `pill ${f.category.includes(c.slug) ? 'on' : ''}`, onclick: () => toggleIn('category', c.slug) }, c.name, h('small', null, c.count.toLocaleString()))));

  // Sidebar filters
  const q = h('input', { type: 'search', value: f.q || '', placeholder: 'Title, company, skill…' });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply({ q: q.value.trim() }); });
  const company = h('input', { type: 'text', value: (f.company || []).join(', '), placeholder: 'e.g. Databricks, Stripe' });
  const location = h('input', { type: 'text', value: (f.location || []).join(', '), placeholder: 'e.g. Bengaluru, India, London' });
  const skills = h('input', { type: 'text', value: (f.skills || []).join(', '), placeholder: 'e.g. Python, Snowflake' });
  const salary = h('input', { type: 'number', min: 0, value: f.salary_min || '', placeholder: 'Minimum (annual)' });
  const posted = h('select', null, POSTED.map(([v, l]) => h('option', { value: v, selected: String(f.posted_within_days || '') === v }, l)));
  posted.addEventListener('change', () => apply({ posted_within_days: posted.value }));
  const fitExp = h('input', { type: 'checkbox', checked: f.fit_experience === '1' });
  fitExp.addEventListener('change', () => apply({ fit_experience: fitExp.checked ? '1' : '' }));
  const direct = h('input', { type: 'checkbox', checked: f.direct_only === '1' });
  direct.addEventListener('change', () => apply({ direct_only: direct.checked ? '1' : '' }));
  const hasSalary = h('input', { type: 'checkbox', checked: f.has_salary === '1' });
  hasSalary.addEventListener('change', () => apply({ has_salary: hasSalary.checked ? '1' : '' }));

  const textApply = () => apply({
    q: q.value.trim(),
    company: company.value.split(',').map((s) => s.trim()).filter(Boolean),
    location: location.value.split(',').map((s) => s.trim()).filter(Boolean),
    skills: skills.value.split(',').map((s) => s.trim()).filter(Boolean),
    salary_min: salary.value,
  });
  for (const el of [company, location, skills, salary]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') textApply(); });

  const checks = (key, options) => h('div', { class: 'opts' }, options.map(([value, label, count]) => {
    const cb = h('input', { type: 'checkbox', checked: (f[key] || []).includes(value) });
    cb.addEventListener('change', () => toggleIn(key, value));
    return h('label', { class: 'check' }, cb, label, count !== undefined ? h('small', null, count.toLocaleString()) : null);
  }));

  const filterBody = h('div', { class: 'filter-body' },
    h('h4', null, 'Keywords'), q,
    h('h4', null, 'Work arrangement'), checks('arrangement', meta.arrangements.map((a) => [a, ARR_LABEL[a]])),
    h('h4', null, 'Experience'),
    h('label', { class: 'check', style: { marginBottom: '8px' } }, fitExp, 'Match my experience'),
    checks('bands', [...meta.experience_bands.map((b) => [b.id, b.label]), ['unknown', 'Not stated']]),
    h('h4', null, 'Date posted'), posted,
    h('h4', null, 'Required skills'), skills,
    h('h4', null, 'Company'), company,
    h('h4', null, 'Location'), location,
    h('h4', null, 'Salary'), salary,
    h('label', { class: 'check', style: { marginTop: '8px' } }, hasSalary, 'Only jobs that list a salary'),
    h('h4', null, 'Category'), checks('category', meta.categories.filter((c) => !c.featured && c.count).map((c) => [c.slug, c.name, c.count])),
    h('h4', null, 'Source'),
    h('label', { class: 'check', style: { marginBottom: '8px' } }, direct, 'Direct employer links only'),
    checks('source', meta.sources.map((s) => [String(s.id), s.name])),
    h('div', { class: 'btn-row', style: { marginTop: '16px' } },
      h('button', { class: 'btn primary sm', onclick: textApply }, 'Apply filters'),
      h('button', { class: 'btn ghost sm', onclick: () => navigate('/app/jobs') }, 'Reset')));
  const filters = h('aside', { class: 'card filters collapsed', 'aria-label': 'Filters' },
    h('button', { class: 'btn sm ghost menu-toggle', style: { width: '100%', marginBottom: '8px' }, onclick: (e) => e.currentTarget.parentElement.classList.toggle('collapsed') }, icon('filter'), 'Show / hide filters'),
    filterBody);

  // Results
  const sort = h('select', { 'aria-label': 'Sort by', style: { width: 'auto' } }, SORTS.map(([v, l]) => h('option', { value: v, selected: (f.sort || 'match') === v }, l)));
  sort.addEventListener('change', () => apply({ sort: sort.value }));
  const minMatch = h('select', { 'aria-label': 'Minimum match', style: { width: 'auto' } }, [['', 'Any match'], ['40', '40%+ match'], ['55', '55%+ match'], ['70', '70%+ match']].map(([v, l]) => h('option', { value: v, selected: String(f.min_match || '') === v }, l)));
  minMatch.addEventListener('change', () => apply({ min_match: minMatch.value }));
  const count = h('div', { class: 'grow muted' });
  const list = h('div', { class: 'job-list' });
  const pager = h('div', { class: 'pager' });
  const results = h('section', null, h('div', { class: 'toolbar' }, count, minMatch, sort), list, pager);

  container.append(head, pills, h('div', { class: 'jobs-layout' }, filters, results));

  async function load() {
    clear(list).append(skeleton(4));
    clear(pager);
    try {
      const r = await api('/jobs', { query: { ...f, page: f.page || 1 } });
      clear(list);
      count.textContent = `${r.total.toLocaleString()} job${r.total === 1 ? '' : 's'} found`;
      if (!r.has_profile) list.append(noProfileCallout());
      if (!r.items.length) list.append(emptyState('search', 'No jobs match these filters', 'Try removing a filter or searching a broader keyword.'));
      for (const job of r.items) list.append(jobCard(job));
      const pages = Math.ceil(r.total / r.page_size);
      if (pages > 1) {
        pager.append(
          h('button', { class: 'btn sm', disabled: r.page <= 1, onclick: () => { apply({ page: r.page - 1 }, { resetPage: false }); window.scrollTo(0, 0); } }, 'Previous'),
          h('span', { class: 'muted' }, `Page ${r.page} of ${pages}`),
          h('button', { class: 'btn sm', disabled: r.page >= pages, onclick: () => { apply({ page: r.page + 1 }, { resetPage: false }); window.scrollTo(0, 0); } }, 'Next'));
      }
    } catch (err) { clear(list).append(h('div', { class: 'form-error' }, err.message)); }
  }
  load();
}

function saveSearchDialog(filters) {
  modal({
    title: 'Save this search',
    content: (close) => {
      const name = h('input', { type: 'text', placeholder: 'e.g. Remote Snowflake roles', required: true });
      const notify = h('input', { type: 'checkbox', checked: true });
      const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Save search');
      const form = h('form', null, field('Name', name), h('label', { class: 'check' }, notify, 'Notify me when new jobs match'),
        h('div', { class: 'modal-foot' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), btn));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        busy(btn, async () => {
          try {
            const query = {};
            for (const [k, v] of Object.entries(filters)) if (!['page', 'sort', 'min_match'].includes(k)) query[k] = v;
            await api('/me/searches', { method: 'POST', body: { name: name.value, query, notify: notify.checked } });
            toast('Search saved. Find it under Profile → Saved searches.', 'success');
            close();
          } catch (err) { formError(form, err.message); }
        });
      });
      return form;
    },
  });
}
export { errorToast };
