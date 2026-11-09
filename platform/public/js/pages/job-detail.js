import { h, icon, companyLogo, scoreRing, arrangementBadge, linkBadge, fmtExp, fmtSalary, fmtDate, timeAgo, toast, errorToast } from '../ui.js';
import { api } from '../api.js';
import { saveButton, trackButton, applyButton, noProfileCallout, postedLabel } from '../components.js';

export default async function jobDetail(ctx, container) {
  const { job, match, favorite_company: fav, interview_prep: prep } = await api(`/jobs/${ctx.params[0]}`);
  const closed = job.status !== 'active' && job.status !== 'duplicate';
  let favorite = fav;
  const favBtn = h('button', { class: 'btn sm' });
  const paintFav = () => favBtn.replaceChildren(icon('heart'), favorite ? 'Favourite company' : 'Add company to favourites');
  paintFav();
  favBtn.addEventListener('click', async () => {
    try {
      await api('/me/favorites', { method: favorite ? 'DELETE' : 'POST', body: { company: job.company } });
      favorite = !favorite; paintFav();
      toast(favorite ? `${job.company} added to favourites` : 'Removed from favourites');
    } catch (err) { errorToast(err); }
  });

  const header = h('div', { class: 'card' },
    h('div', { style: { display: 'flex', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap' } },
      companyLogo(job.company),
      h('div', { style: { flex: 1, minWidth: '240px' } },
        h('h1', { style: { marginBottom: '4px' } }, job.title),
        h('div', { class: 'job-meta' },
          h('span', null, icon('building'), job.company),
          job.location ? h('span', null, icon('mapPin'), job.location) : null,
          h('span', null, icon('briefcase'), fmtExp(job.experience_min, job.experience_max)),
          fmtSalary(job) ? h('span', null, icon('dollar'), fmtSalary(job)) : null,
          postedLabel(job)),
        h('div', { class: 'chips' }, arrangementBadge(job.work_arrangement), job.is_direct ? h('span', { class: 'badge primary' }, 'Direct employer link') : h('span', { class: 'badge' }, `Via ${job.source_name || 'job board'}`), linkBadge(job.link_status))),
      match ? h('div', { style: { textAlign: 'center' } }, scoreRing(match.score, 'lg'), h('div', { class: 'muted', style: { marginTop: '6px', fontWeight: 600 } }, match.label)) : null),
    closed ? h('div', { class: 'callout danger', style: { marginTop: '16px' } }, icon('alert'), h('div', null, h('b', null, 'This posting is no longer open. '), job.link_check_note || 'It was closed or removed by the employer.')) : null,
    h('div', { class: 'btn-row', style: { marginTop: '16px' } }, closed ? null : applyButton(job, { small: false }), saveButton(job, { small: false }), trackButton(job, { small: false }), favBtn),
    !job.is_direct && !closed ? h('p', { class: 'muted', style: { fontSize: '12px', marginTop: '10px', marginBottom: 0 } }, 'This listing comes from a job board. If you can, apply on the company’s own careers page.') : null);

  const matchCard = match ? h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', null, 'Why this job matches you')),
    h('ul', { class: 'reasons' }, match.reasons.map((r) => h('li', null, r))),
    h('hr'),
    h('div', { class: 'grid-2' },
      h('div', null, h('h4', null, `Matching skills (${match.matching_skills.length})`), h('div', { class: 'chips' }, match.matching_skills.length ? match.matching_skills.map((s) => h('span', { class: 'chip ok' }, icon('check'), s)) : h('span', { class: 'muted' }, 'None found'))),
      h('div', null, h('h4', null, `Missing skills (${match.missing_skills.length})`), h('div', { class: 'chips' }, match.missing_skills.length ? match.missing_skills.map((s) => h('span', { class: `chip ${match.related_skills.includes(s) ? 'warn' : 'miss'}`, title: match.related_skills.includes(s) ? 'You know a closely related tool' : '' }, s)) : h('span', { class: 'muted' }, 'You cover every listed skill')))),
    match.preferred_skills.length ? h('div', { style: { marginTop: '12px' } }, h('h4', null, 'Nice to have'), h('div', { class: 'chips' }, match.preferred_skills.map((s) => h('span', { class: 'chip neutral' }, s)))) : null,
    h('hr'),
    h('dl', { class: 'kv' },
      h('dt', null, 'Required experience'), h('dd', null, match.required_experience ? fmtExp(match.required_experience.min, match.required_experience.max) : 'Not stated'),
      h('dt', null, 'Your experience'), h('dd', null, match.candidate_experience !== null && match.candidate_experience !== undefined ? `${match.candidate_experience} years` : 'Unknown — add it in your resume details'),
      h('dt', null, 'Skill coverage'), h('dd', null, match.skill_score === null ? 'No skills listed' : `${match.skill_score}%`),
      h('dt', null, 'Experience fit'), h('dd', null, `${match.experience_score}%`),
      h('dt', null, 'Title relevance'), h('dd', null, `${match.title_score}%`))) : noProfileCallout();

  const prepCard = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', null, 'Interview preparation')),
    h('h4', null, 'Next steps'), h('ul', { class: 'reasons' }, prep.stage_tips.map((t) => h('li', null, t))),
    prep.skill_focus.length ? [h('h4', { style: { marginTop: '12px' } }, 'Technical focus'), prep.skill_focus.map((f) => h('div', { style: { marginBottom: '10px' } },
      h('div', { style: { fontWeight: 700 } }, f.skill, f.gap ? h('span', { class: 'badge danger', style: { marginLeft: '6px' } }, 'gap') : null),
      h('ul', { class: 'reasons' }, f.topics.map((t) => h('li', null, t)))))] : null,
    prep.gaps.length ? [h('h4', null, 'Handling gaps'), h('ul', { class: 'reasons' }, prep.gaps.map((g) => h('li', null, g)))] : null,
    h('h4', null, 'Questions to ask them'), h('ul', { class: 'reasons' }, prep.questions_to_ask.map((g) => h('li', null, g))));

  const description = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', null, 'Job description'), h('span', { class: 'muted', style: { fontSize: '12px' } }, `Last confirmed ${timeAgo(job.last_seen_at)}`)),
    job.skills.length ? h('div', { class: 'chips', style: { marginBottom: '14px' } }, job.skills.map((s) => h('span', { class: 'chip neutral' }, s))) : null,
    h('div', { class: 'jd' }, job.description || 'The source did not provide a description. Open the application page for details.'));

  const facts = h('div', { class: 'card' }, h('h3', null, 'Details'),
    h('dl', { class: 'kv' },
      h('dt', null, 'Company'), h('dd', null, job.company),
      h('dt', null, 'Work arrangement'), h('dd', null, job.work_arrangement === 'WFO' ? 'Work from office' : job.work_arrangement),
      h('dt', null, 'Experience band'), h('dd', null, job.experience_band === 'unknown' ? 'Not stated' : job.experience_band),
      h('dt', null, 'Posted'), h('dd', null, job.posted_at ? fmtDate(job.posted_at) : 'Not stated by the source'),
      h('dt', null, 'First seen'), h('dd', null, fmtDate(job.first_seen_at)),
      h('dt', null, 'Source'), h('dd', null, job.source_name || '—'),
      h('dt', null, 'Link status'), h('dd', null, linkBadge(job.link_status))));

  container.append(
    h('div', { style: { marginBottom: '12px' } }, h('a', { href: '/app/jobs', class: 'muted' }, '← Back to jobs')),
    header,
    h('div', { class: 'split', style: { marginTop: '16px' } }, h('div', { class: 'stack' }, matchCard, description), h('div', { class: 'stack' }, facts, prepCard)));
}
