import { h, icon, fmtNum, timeAgo, scoreRing, arrangementBadge, companyLogo, statusBadge, chart, chartBox, PALETTE, emptyState, skeleton } from '../ui.js';
import { api } from '../api.js';

function statCard(ic, color, value, label, href) {
  const body = h('div', { class: 'stat' }, h('div', { class: `ico ${color}` }, icon(ic)), h('div', null, h('div', { class: 'val' }, value), h('div', { class: 'lbl' }, label)));
  return href ? h('a', { class: 'card', href, style: { textDecoration: 'none', color: 'inherit' } }, body) : h('div', { class: 'card' }, body);
}

export default async function dashboard(ctx, container) {
  container.append(skeleton(3));
  const [d, stats, meta] = await Promise.all([api('/dashboard'), api('/applications/stats'), api('/jobs/meta')]);
  container.replaceChildren();
  const catName = new Map(meta.categories.map((c) => [c.slug, c.name]));
  const first = d.user.full_name.split(' ')[0];

  const onboarding = !d.onboarding.has_resume
    ? h('div', { class: 'callout', style: { marginBottom: '18px' } }, icon('zap'),
      h('div', { style: { flex: 1 } }, h('b', null, 'Get started: upload your resume. '), 'We will extract your skills and experience and start recommending matching jobs right away.'),
      h('a', { class: 'btn primary sm', href: '/app/resumes' }, icon('upload'), 'Upload resume'))
    : !d.onboarding.has_preferences
      ? h('div', { class: 'callout', style: { marginBottom: '18px' } }, icon('target'),
        h('div', { style: { flex: 1 } }, h('b', null, 'Sharpen your matches. '), 'Add target job titles and categories in your preferences.'),
        h('a', { class: 'btn sm', href: '/app/profile?tab=preferences' }, 'Set preferences'))
      : null;

  const head = h('div', { class: 'page-head' },
    h('div', null, h('h1', null, `Welcome back, ${first}`),
      h('p', null, d.profile?.current_role ? `${d.profile.current_role}${d.profile.years !== null && d.profile.years !== undefined ? ` · ${d.profile.years} years experience` : ''}` : 'Your personal job search workspace')),
    h('div', { class: 'btn-row' },
      h('span', { class: 'badge success dot', title: 'Last successful job refresh' }, d.last_updated ? `Jobs updated ${timeAgo(d.last_updated)}` : 'Waiting for the first job refresh'),
      h('a', { class: 'btn primary', href: '/app/jobs' }, icon('search'), 'Discover jobs')));

  const statsRow = h('div', { class: 'cards k4', style: { marginBottom: '16px' } },
    statCard('target', '', fmtNum(d.matches.good), 'Jobs matching your profile', '/app/recommendations'),
    statCard('zap', 'teal', fmtNum(d.counts.new_today), `New in the last 24h (of ${fmtNum(d.counts.total_jobs)} active)`, '/app/jobs?posted_within_days=1'),
    statCard('briefcase', 'amber', fmtNum(stats.applied), `Applications sent · ${stats.interviewing} interviewing`, '/app/applications'),
    statCard('bookmark', 'green', fmtNum(d.counts.saved), 'Saved jobs', '/app/saved'));

  // Top matches
  const topCard = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, 'Top matches for you'), h('a', { href: '/app/recommendations' }, 'See all')));
  if (!d.profile) topCard.append(emptyState('file', 'No resume yet', 'Upload a resume to get personalised recommendations.', h('a', { class: 'btn primary sm', href: '/app/resumes' }, 'Upload resume')));
  else if (!d.matches.top.length) topCard.append(emptyState('search', 'No strong matches yet', 'Try lowering your minimum match score in preferences, or broaden your target categories.'));
  else {
    topCard.append(h('div', { class: 'stack' }, d.matches.top.map((j) => h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } },
      companyLogo(j.company),
      h('div', { style: { flex: 1, minWidth: 0 } }, h('a', { class: 'job-title', href: `/app/jobs/${j.id}`, style: { fontSize: '14px' } }, j.title),
        h('div', { class: 'muted', style: { fontSize: '12px' } }, `${j.company} · ${j.location || '—'} · ${timeAgo(j.posted_at)}`)),
      arrangementBadge(j.work_arrangement), scoreRing(j.score)))));
  }

  // Pipeline chart
  const pipe = chartBox();
  const pipelineCard = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, 'Application pipeline'), h('a', { href: '/app/applications' }, 'Manage')),
    stats.total ? pipe.box : emptyState('briefcase', 'No applications yet', 'Track a job to see your pipeline here.'));

  const catBox = chartBox('sm');
  const arrBox = chartBox('sm');
  const charts = h('div', { class: 'cards k2' },
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, 'Matches by category')), d.matches.by_category.length ? catBox.box : emptyState('chart', 'No data yet', null)),
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, 'Matches by work arrangement')), Object.keys(d.matches.by_arrangement).length ? arrBox.box : emptyState('chart', 'No data yet', null)));

  const recent = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, 'Recent activity')),
    d.recent_applications.length
      ? h('div', { class: 'stack' }, d.recent_applications.map((a) => h('a', { href: `/app/applications/${a.id}`, style: { display: 'flex', justifyContent: 'space-between', gap: '10px', color: 'inherit', textDecoration: 'none' } },
        h('div', { style: { minWidth: 0 } }, h('div', { style: { fontWeight: 600 } }, a.title), h('div', { class: 'muted', style: { fontSize: '12px' } }, `${a.company} · ${timeAgo(a.updated_at)}`)), statusBadge(a.status))))
      : h('p', { class: 'muted' }, 'Your latest application updates will appear here.'));
  const upcoming = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, 'Upcoming interviews')),
    stats.upcoming_interviews.length
      ? h('div', { class: 'stack' }, stats.upcoming_interviews.map((i) => h('div', null, h('b', null, i.company), h('div', { class: 'muted', style: { fontSize: '12px' } }, `${i.title} · ${new Date(i.interview_at).toLocaleString()}`))))
      : h('p', { class: 'muted' }, 'No interviews scheduled. Add interview dates in your applications.'));
  const skills = d.profile ? h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, 'Your skills'), h('a', { href: '/app/resumes' }, 'Edit')),
    h('div', { class: 'chips' }, d.profile.skills.map((s) => h('span', { class: 'chip neutral' }, s)))) : null;

  container.append(head, onboarding || '', statsRow,
    h('div', { class: 'split' }, h('div', { class: 'stack' }, topCard, charts), h('div', { class: 'stack' }, pipelineCard, upcoming, recent, skills)));

  if (stats.total) {
    const labels = Object.keys(stats.by_status);
    chart(pipe.canvas, { type: 'bar', data: { labels, datasets: [{ data: labels.map((l) => stats.by_status[l]), backgroundColor: PALETTE, borderRadius: 6 }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { precision: 0 } } } } });
  }
  if (d.matches.by_category.length) {
    chart(catBox.canvas, { type: 'bar', data: { labels: d.matches.by_category.map((c) => catName.get(c.slug) || c.slug), datasets: [{ data: d.matches.by_category.map((c) => c.n), backgroundColor: PALETTE[0], borderRadius: 6 }] }, options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { precision: 0 } } } } });
  }
  const arr = Object.entries(d.matches.by_arrangement);
  if (arr.length) chart(arrBox.canvas, { type: 'doughnut', data: { labels: arr.map(([k]) => (k === 'WFO' ? 'Work from office' : k)), datasets: [{ data: arr.map(([, v]) => v), backgroundColor: [PALETTE[1], PALETTE[4], PALETTE[2]], borderWidth: 0 }] }, options: { cutout: '65%' } });
}
