import { h, icon, statusBadge, fmtDate, timeAgo, toast, field, formError, busy, confirmDialog, errorToast } from '../ui.js';
import { api } from '../api.js';
import { APP_STATUSES } from '../components.js';

const toLocalInput = (v) => {
  if (!v) return '';
  const s = String(v);
  return s.length === 10 ? `${s}T09:00` : s.slice(0, 16).replace(' ', 'T');
};

export default async function applicationDetail(ctx, container) {
  const { application: a, events, interview_prep: prep } = await api(`/applications/${ctx.params[0]}`);
  const manual = !a.job_id;
  const status = h('select', null, APP_STATUSES.map((s) => h('option', { value: s, selected: s === a.status }, s)));
  const applied = h('input', { type: 'date', value: a.applied_on ? a.applied_on.slice(0, 10) : '' });
  const interview = h('input', { type: 'datetime-local', value: toLocalInput(a.interview_at) });
  const notes = h('textarea', { rows: 8, value: a.notes });
  const eventNote = h('input', { type: 'text', placeholder: 'Optional note for this status change' });
  const company = h('input', { type: 'text', value: a.company, disabled: !manual });
  const title = h('input', { type: 'text', value: a.title, disabled: !manual });
  const url = h('input', { type: 'url', value: a.job_url, disabled: !manual });
  const save = h('button', { class: 'btn primary', type: 'submit' }, 'Save changes');
  const form = h('form', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', null, 'Application details'), statusBadge(a.status)),
    h('div', { class: 'grid-2' }, field('Company', company), field('Job title', title)),
    field('Job URL', url, manual ? null : 'Linked to a job found in this app; company, title and URL come from the posting.'),
    h('div', { class: 'grid-3' }, field('Status', status), field('Applied on', applied), field('Interview date', interview)),
    field('Status change note', eventNote),
    field('Notes', notes),
    h('div', { class: 'btn-row' }, save,
      a.job_url ? h('a', { class: 'btn', href: a.job_url, target: '_blank', rel: 'noopener noreferrer' }, 'Open posting', icon('external')) : null,
      a.job_id ? h('a', { class: 'btn', href: `/app/jobs/${a.job_id}` }, 'View job details') : null,
      h('button', { class: 'btn danger', type: 'button', style: { marginLeft: 'auto' }, onclick: async () => {
        if (!(await confirmDialog('This removes the application and its history.', { okText: 'Delete', danger: true }))) return;
        try { await api(`/applications/${a.id}`, { method: 'DELETE' }); toast('Application deleted'); ctx.navigate('/app/applications'); } catch (err) { errorToast(err); }
      } }, icon('trash'), 'Delete')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    formError(form, null);
    busy(save, async () => {
      try {
        const body = { status: status.value, applied_on: applied.value || null, interview_at: interview.value || null, notes: notes.value, event_note: eventNote.value };
        if (manual) Object.assign(body, { company: company.value, title: title.value, job_url: url.value });
        await api(`/applications/${a.id}`, { method: 'PATCH', body });
        toast('Saved', 'success');
        ctx.navigate(location.pathname, { replace: true });
      } catch (err) { formError(form, err.message); }
    });
  });

  const timeline = h('div', { class: 'card' }, h('h3', null, 'Progress'),
    h('div', { class: 'stack' }, events.map((ev) => h('div', { style: { display: 'flex', gap: '10px' } },
      h('div', { style: { width: '10px', height: '10px', borderRadius: '50%', background: 'var(--primary)', marginTop: '6px', flex: 'none' } }),
      h('div', null, h('div', null, ev.from_status ? [ev.from_status, ' → '] : null, h('b', null, ev.to_status)),
        h('div', { class: 'muted', style: { fontSize: '12px' } }, `${fmtDate(ev.created_at, true)} · ${timeAgo(ev.created_at)}`),
        ev.note ? h('div', { class: 'text-2', style: { fontSize: '13px' } }, ev.note) : null)))));

  const prepCard = h('div', { class: 'card' }, h('h3', null, 'Interview preparation'),
    h('ul', { class: 'reasons' }, prep.stage_tips.map((t) => h('li', null, t))),
    prep.skill_focus.map((f) => h('div', { style: { marginTop: '10px' } }, h('b', null, f.skill), f.gap ? h('span', { class: 'badge danger', style: { marginLeft: '6px' } }, 'gap') : null, h('ul', { class: 'reasons' }, f.topics.map((t) => h('li', null, t))))),
    h('h4', { style: { marginTop: '12px' } }, 'Behavioural questions to rehearse'), h('ul', { class: 'reasons' }, prep.behavioural.map((t) => h('li', null, t))));

  container.append(h('div', { style: { marginBottom: '12px' } }, h('a', { href: '/app/applications', class: 'muted' }, '← Back to applications')),
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, a.title), h('p', null, `${a.company}${a.location ? ` · ${a.location}` : ''}`))),
    h('div', { class: 'split' }, form, h('div', { class: 'stack' }, timeline, prepCard)));
}
