import { h, icon, clear, emptyState, arrangementBadge } from '../ui.js';
import { api } from '../api.js';
import { jobCard } from '../components.js';

export default async function saved(ctx, container) {
  const [{ items }, { companies }, recent] = await Promise.all([api('/jobs/saved'), api('/me/favorites'), api('/jobs/recent')]);
  const list = h('div', { class: 'job-list' });
  const render = () => {
    clear(list);
    const live = items.filter((j) => j.saved);
    if (!live.length) list.append(emptyState('bookmark', 'No saved jobs yet', 'Save jobs while browsing to compare them later.', h('a', { class: 'btn primary sm', href: '/app/jobs' }, 'Discover jobs')));
    for (const j of live) {
      const card = jobCard(j, { onSaveChange: (s) => { j.saved = s; if (!s) render(); } });
      if (j.status !== 'active') card.prepend(h('div', { class: 'badge danger', style: { gridColumn: '1 / -1' } }, 'No longer open'));
      list.append(card);
    }
  };
  render();
  const favCard = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, 'Favourite companies')),
    companies.length ? h('div', { class: 'stack' }, companies.map((c) => h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } },
      h('a', { href: `/app/jobs?company=${encodeURIComponent(c.company)}` }, c.company), h('span', { class: 'badge' }, `${c.open_jobs} open`))))
      : h('p', { class: 'muted' }, 'Mark companies as favourites from a job page. Their jobs rank higher in your recommendations.'));
  const recentCard = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, 'Recently viewed')),
    recent.items.length ? h('div', { class: 'stack' }, recent.items.slice(0, 10).map((j) => h('div', null,
      h('a', { href: `/app/jobs/${j.id}`, style: { fontWeight: 600 } }, j.title), h('div', { class: 'muted', style: { fontSize: '12px', display: 'flex', gap: '6px', alignItems: 'center' } }, j.company, ' · ', arrangementBadge(j.work_arrangement)))))
      : h('p', { class: 'muted' }, 'Jobs you open will appear here.'));
  container.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Saved jobs'), h('p', null, 'Your shortlist, favourite companies and recently viewed jobs.'))),
    h('div', { class: 'split' }, list, h('div', { class: 'stack' }, favCard, recentCard)));
}
