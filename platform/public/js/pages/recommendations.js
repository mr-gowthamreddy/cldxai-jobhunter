import { h, icon, clear, skeleton, emptyState } from '../ui.js';
import { api } from '../api.js';
import { jobCard, noProfileCallout } from '../components.js';

export default async function recommendations(ctx, container) {
  const fresh = ctx.query.get('fresh') === '1';
  const minSel = h('select', { style: { width: 'auto' }, 'aria-label': 'Minimum match' }, [['', 'My preference'], ['40', '40%+'], ['55', '55%+'], ['70', '70%+'], ['85', '85%+']].map(([v, l]) => h('option', { value: v, selected: ctx.query.get('min_match') === v }, l)));
  const freshCb = h('input', { type: 'checkbox', checked: fresh });
  const list = h('div', { class: 'job-list' });
  const head = h('div', { class: 'page-head' },
    h('div', null, h('h1', null, 'Recommended for you'), h('p', null, 'Ranked by match with your active resume, freshness, direct employer links and your favourite companies.')),
    h('div', { class: 'btn-row' }, h('label', { class: 'check' }, freshCb, 'Only new (last 48h)'), minSel));
  container.append(head, list);
  const load = async () => {
    clear(list).append(skeleton(4));
    const q = new URLSearchParams();
    if (freshCb.checked) q.set('fresh', '1');
    if (minSel.value) q.set('min_match', minSel.value);
    history.replaceState(null, '', `/app/recommendations${q.toString() ? `?${q}` : ''}`);
    const r = await api('/jobs/recommendations', { query: { fresh: freshCb.checked ? '1' : '', min_match: minSel.value } });
    clear(list);
    if (!r.has_profile) { list.append(noProfileCallout()); return; }
    if (!r.items.length) { list.append(emptyState('star', 'No recommendations at this threshold', `Nothing scores ${r.threshold}% or more right now. Lower the threshold, add skills or target titles in your preferences, or check back after the next daily refresh.`, h('a', { class: 'btn sm', href: '/app/profile?tab=preferences' }, 'Edit preferences'))); return; }
    list.append(h('p', { class: 'muted' }, `${r.items.length} jobs at ${r.threshold}%+ match`));
    for (const j of r.items) list.append(jobCard({ ...j, match: { ...j.match, reasons: j.match.reasons } }));
  };
  freshCb.addEventListener('change', load);
  minSel.addEventListener('change', load);
  await load();
}
