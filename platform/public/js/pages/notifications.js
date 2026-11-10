import { h, icon, clear, emptyState, timeAgo, toast, errorToast } from '../ui.js';
import { api } from '../api.js';
import { updateBell } from '../main.js';

const ICON = { new_matches: 'star', saved_search: 'search', job_expired: 'alert', account: 'user', system: 'info' };

export default async function notifications(ctx, container) {
  const list = h('div', { class: 'card', style: { padding: 0 } });
  const head = h('div', { class: 'page-head' },
    h('div', null, h('h1', null, 'Notifications'), h('p', null, 'New matching jobs, saved-search alerts and account updates.')),
    h('button', { class: 'btn', onclick: async () => { try { await api('/me/notifications/read', { method: 'POST', body: {} }); toast('All marked as read'); load(); updateBell(); } catch (err) { errorToast(err); } } }, icon('check'), 'Mark all as read'));
  container.append(head, list);
  async function load() {
    const { items } = await api('/me/notifications');
    clear(list);
    if (!items.length) { list.append(emptyState('bell', 'You are all caught up', 'We will notify you when new jobs match your resume or saved searches.')); return; }
    for (const n of items) {
      const row = h('div', { style: { display: 'flex', gap: '14px', padding: '14px 18px', borderBottom: '1px solid var(--border)', background: n.is_read ? '' : 'var(--primary-soft)' } },
        h('div', { class: 'stat' }, h('div', { class: 'ico' }, icon(ICON[n.type] || 'info'))),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { style: { fontWeight: n.is_read ? 500 : 700 } }, n.title),
          n.body ? h('div', { class: 'text-2', style: { fontSize: '13px' } }, n.body) : null,
          h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '4px' } }, timeAgo(n.created_at))),
        h('div', { class: 'btn-row' },
          n.link ? h('a', { class: 'btn sm', href: n.link, onclick: () => api('/me/notifications/read', { method: 'POST', body: { id: n.id } }).catch(() => {}) }, 'Open') : null,
          n.is_read ? null : h('button', { class: 'btn sm ghost', title: 'Mark as read', onclick: async () => { await api('/me/notifications/read', { method: 'POST', body: { id: n.id } }); load(); updateBell(); } }, icon('check')),
          h('button', { class: 'btn sm ghost', title: 'Delete', 'aria-label': 'Delete notification', onclick: async () => { await api(`/me/notifications/${n.id}`, { method: 'DELETE' }); row.remove(); updateBell(); } }, icon('trash'))));
      list.append(row);
    }
  }
  await load();
}
