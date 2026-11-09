// Shared job components: job card, save/track actions, "add to tracker" dialog.
import { h, icon, companyLogo, scoreRing, arrangementBadge, linkBadge, fmtExp, fmtSalary, timeAgo, ageDays, toast, errorToast, modal, field, formError, busy, statusBadge } from './ui.js';
import { api } from './api.js';
import { navigate } from './main.js';

export const APP_STATUSES = ['Interested', 'Saved', 'Applied', 'Interview Scheduled', 'Technical Round', 'HR Round', 'Offer Received', 'Rejected'];

export function postedLabel(job) {
  const when = job.posted_at || job.first_seen_at;
  const d = ageDays(when);
  if (d === null) return null;
  const txt = job.posted_at ? `Posted ${timeAgo(when)}` : `Found ${timeAgo(when)}`;
  return h('span', { class: d <= 3 ? 'fresh' : '' }, icon('clock'), d <= 1 ? `New · ${txt}` : txt);
}

export function saveButton(job, { onChange, small = true } = {}) {
  let saved = Boolean(job.saved);
  const btn = h('button', { class: `btn ${small ? 'sm' : ''} ${saved ? 'primary' : ''}`, 'aria-pressed': String(saved), title: saved ? 'Remove from saved' : 'Save job' });
  const paint = () => { btn.className = `btn ${small ? 'sm' : ''} ${saved ? 'primary' : ''}`; btn.replaceChildren(icon('bookmark'), saved ? 'Saved' : 'Save'); btn.setAttribute('aria-pressed', String(saved)); };
  paint();
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await api(`/jobs/${job.id}/save`, { method: saved ? 'DELETE' : 'POST' });
      saved = !saved; job.saved = saved; paint();
      toast(saved ? 'Job saved' : 'Removed from saved jobs');
      onChange?.(saved);
    } catch (err) { errorToast(err); }
  });
  return btn;
}

export function trackButton(job, { small = true, onTracked } = {}) {
  if (job.application) {
    return h('a', { class: `btn ${small ? 'sm' : ''}`, href: `/app/applications/${job.application.id}` }, icon('briefcase'), job.application.status);
  }
  return h('button', { class: `btn ${small ? 'sm' : ''}`, onclick: (e) => { e.preventDefault(); trackDialog(job, onTracked); } }, icon('plus'), 'Track');
}

export function trackDialog(job, onTracked) {
  modal({
    title: 'Track this application',
    content: (close) => {
      const status = h('select', null, APP_STATUSES.map((s) => h('option', { value: s, selected: s === 'Interested' }, s)));
      const applied = h('input', { type: 'date' });
      const notes = h('textarea', { placeholder: 'Referral, recruiter name, salary discussed…' });
      const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Add to tracker');
      const form = h('form', null,
        h('p', null, h('b', null, job.title), ' at ', job.company),
        h('div', { class: 'grid-2' }, field('Status', status), field('Applied on', applied, 'Filled in automatically when the status is Applied.')),
        field('Notes', notes),
        h('div', { class: 'modal-foot' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), btn));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        busy(btn, async () => {
          try {
            const r = await api('/applications', { method: 'POST', body: { job_id: job.id, status: status.value, applied_on: applied.value || undefined, notes: notes.value } });
            job.application = { id: r.application.id, status: r.application.status };
            toast('Added to your applications', 'success');
            close();
            onTracked?.(r.application);
          } catch (err) { formError(form, err.message); }
        });
      });
      return form;
    },
  });
}

export function applyButton(job, { small = true } = {}) {
  return h('a', { class: `btn primary ${small ? 'sm' : ''}`, href: job.apply_url, target: '_blank', rel: 'noopener noreferrer nofollow', title: job.is_direct ? 'Opens the employer’s own application page' : 'Opens the job board listing' },
    job.is_direct ? 'Apply on company site' : 'Apply', icon('external'));
}

export function jobCard(job, { onSaveChange } = {}) {
  const salary = fmtSalary(job);
  const m = job.match;
  return h('article', { class: 'job-card' },
    companyLogo(job.company),
    h('div', { style: { minWidth: 0 } },
      h('a', { class: 'job-title', href: `/app/jobs/${job.id}` }, job.title),
      h('div', { class: 'job-meta' },
        h('span', null, icon('building'), job.company || 'Unknown company'),
        job.location ? h('span', null, icon('mapPin'), job.location.length > 60 ? `${job.location.slice(0, 60)}…` : job.location) : null,
        h('span', null, icon('briefcase'), fmtExp(job.experience_min, job.experience_max)),
        salary ? h('span', null, icon('dollar'), salary) : null,
        postedLabel(job)),
      h('div', { class: 'chips' },
        arrangementBadge(job.work_arrangement),
        job.is_direct ? h('span', { class: 'badge primary' }, 'Direct employer link') : h('span', { class: 'badge' }, job.source_name || 'Job board'),
        linkBadge(job.link_status),
        m ? m.matching_skills.slice(0, 4).map((s) => h('span', { class: 'chip ok' }, icon('check'), s)) : (job.skills || []).slice(0, 5).map((s) => h('span', { class: 'chip neutral' }, s)),
        m && m.missing_skills.length ? h('span', { class: 'chip miss', title: `Missing: ${m.missing_skills.join(', ')}` }, `${m.missing_skills.length} missing`) : null),
      m && m.reasons?.length ? h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '8px' } }, m.reasons[0]) : null),
    h('div', { class: 'job-side' },
      m ? h('div', { style: { textAlign: 'center' } }, scoreRing(m.score), h('div', { class: 'muted', style: { fontSize: '11px', marginTop: '4px' } }, m.label)) : null,
      h('div', { class: 'btn-row', style: { justifyContent: 'flex-end' } }, saveButton(job, { onChange: onSaveChange }), trackButton(job), applyButton(job))));
}

export function noProfileCallout() {
  return h('div', { class: 'callout' }, icon('info'),
    h('div', null, h('b', null, 'Upload your resume to see match scores. '), 'Matching uses only your own resume and preferences.',
      h('div', { style: { marginTop: '8px' } }, h('a', { class: 'btn sm primary', href: '/app/resumes' }, icon('upload'), 'Upload resume'))));
}

export { statusBadge, navigate };
