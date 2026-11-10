import { h, icon, clear, emptyState, statusBadge, fmtDate, timeAgo, toast, errorToast, modal, field, formError, busy, chart, chartBox, PALETTE } from '../ui.js';
import { api } from '../api.js';
import { APP_STATUSES } from '../components.js';

export default async function applications(ctx, container) {
  const view = ctx.query.get('view') === 'table' ? 'table' : 'board';
  const [{ items }, stats] = await Promise.all([api('/applications'), api('/applications/stats')]);

  const head = h('div', { class: 'page-head' },
    h('div', null, h('h1', null, 'Applications'), h('p', null, 'Track every opportunity from first interest to offer.')),
    h('div', { class: 'btn-row' },
      h('a', { class: 'btn', href: '/api/applications/export?format=csv', download: true }, icon('download'), 'CSV'),
      h('a', { class: 'btn', href: '/api/applications/export?format=xlsx', download: true }, icon('download'), 'Excel'),
      h('button', { class: 'btn primary', onclick: () => manualDialog() }, icon('plus'), 'Add job manually')));

  const kpi = (label, value, sub) => h('div', { class: 'card' }, h('div', { class: 'stat' }, h('div', null, h('div', { class: 'val' }, value), h('div', { class: 'lbl' }, label), sub ? h('div', { class: 'muted', style: { fontSize: '12px' } }, sub) : null)));
  const kpis = h('div', { class: 'cards k4', style: { marginBottom: '16px' } },
    kpi('Total tracked', String(stats.total)),
    kpi('Applied', String(stats.applied)),
    kpi('In interviews', String(stats.interviewing), `${stats.response_rate}% of applications reached an interview`),
    kpi('Offers', String(stats.offers), stats.rejected ? `${stats.rejected} rejected` : null));

  const statusChart = chartBox('sm');
  const weeklyChart = chartBox('sm');
  const chartsRow = stats.total ? h('div', { class: 'cards k2', style: { marginBottom: '16px' } },
    h('div', { class: 'card' }, h('h3', null, 'By status'), statusChart.box),
    h('div', { class: 'card' }, h('h3', null, 'Applications per week (last 12 weeks)'), weeklyChart.box)) : null;

  const tabs = h('div', { class: 'tabs', role: 'tablist' },
    h('a', { class: `tab ${view === 'board' ? 'on' : ''}`, href: '/app/applications', role: 'tab' }, 'Board'),
    h('a', { class: `tab ${view === 'table' ? 'on' : ''}`, href: '/app/applications?view=table', role: 'tab' }, 'Table'));

  const body = h('div');
  container.append(head, kpis, chartsRow || '', tabs, body);

  if (!items.length) {
    body.append(emptyState('briefcase', 'Nothing tracked yet', 'Use “Track” on any job, or add a job you found elsewhere.', h('button', { class: 'btn primary sm', onclick: () => manualDialog() }, 'Add job manually')));
  } else if (view === 'board') {
    body.append(board(items));
  } else {
    body.append(table(items));
  }

  if (stats.total) {
    const labels = APP_STATUSES.filter((s) => stats.by_status[s]);
    chart(statusChart.canvas, { type: 'doughnut', data: { labels, datasets: [{ data: labels.map((s) => stats.by_status[s]), backgroundColor: PALETTE, borderWidth: 0 }] }, options: { cutout: '62%', plugins: { legend: { position: 'right' } } } });
    chart(weeklyChart.canvas, { type: 'line', data: { labels: stats.weekly.map((w) => `W${w.week.split('-')[1]}`), datasets: [{ data: stats.weekly.map((w) => w.n), borderColor: PALETTE[0], backgroundColor: 'rgba(59,130,246,.15)', fill: true, tension: .35, pointRadius: 3 }] }, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } });
  }

  function board(list) {
    const wrap = h('div', { class: 'kanban' });
    for (const status of APP_STATUSES) {
      const col = h('div', { class: 'kcol', dataset: { status } });
      const cards = list.filter((a) => a.status === status);
      col.append(h('h4', null, status, h('span', { class: 'badge' }, String(cards.length))));
      for (const a of cards) {
        const card = h('div', { class: 'kcard', draggable: 'true', dataset: { id: a.id } },
          h('a', { class: 't', href: `/app/applications/${a.id}`, style: { color: 'inherit' } }, a.title),
          h('div', { class: 'c' }, a.company),
          h('div', { class: 'c', style: { marginTop: '6px', display: 'flex', justifyContent: 'space-between' } },
            h('span', null, a.interview_at ? `Interview ${fmtDate(a.interview_at)}` : `Updated ${timeAgo(a.updated_at)}`),
            a.match_score !== null ? h('span', { class: 'badge primary' }, `${a.match_score}%`) : null));
        card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(a.id)); e.dataTransfer.effectAllowed = 'move'; });
        col.append(card);
      }
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
      col.addEventListener('dragleave', () => col.classList.remove('drop'));
      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('drop');
        const id = Number(e.dataTransfer.getData('text/plain'));
        const app = list.find((x) => x.id === id);
        if (!app || app.status === status) return;
        try {
          await api(`/applications/${id}`, { method: 'PATCH', body: { status } });
          app.status = status;
          toast(`Moved to ${status}`, 'success');
          clear(body).append(board(list));
        } catch (err) { errorToast(err); }
      });
      wrap.append(col);
    }
    return h('div', null, h('p', { class: 'muted', style: { fontSize: '12px' } }, 'Drag cards between columns to update their status. Open a card for notes, dates and interview preparation.'), wrap);
  }

  function table(list) {
    return h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Company', 'Role', 'Status', 'Applied', 'Interview', 'Match', 'Source', 'Updated', ''].map((c) => h('th', null, c)))),
      h('tbody', null, list.map((a) => {
        const sel = h('select', { style: { height: '30px', width: 'auto' }, 'aria-label': 'Status' }, APP_STATUSES.map((s) => h('option', { value: s, selected: s === a.status }, s)));
        sel.addEventListener('change', async () => {
          try { await api(`/applications/${a.id}`, { method: 'PATCH', body: { status: sel.value } }); a.status = sel.value; toast('Status updated', 'success'); } catch (err) { errorToast(err); sel.value = a.status; }
        });
        return h('tr', null,
          h('td', null, h('b', null, a.company)),
          h('td', null, h('a', { href: `/app/applications/${a.id}` }, a.title), a.job_status && a.job_status !== 'active' ? h('div', { class: 'sub' }, 'Posting closed') : null),
          h('td', null, sel),
          h('td', { class: 'nowrap' }, fmtDate(a.applied_on)),
          h('td', { class: 'nowrap' }, a.interview_at ? fmtDate(a.interview_at, true) : '—'),
          h('td', null, a.match_score !== null ? `${a.match_score}%` : '—'),
          h('td', null, a.source === 'manual' ? 'Manual' : 'Job search'),
          h('td', { class: 'nowrap muted' }, timeAgo(a.updated_at)),
          h('td', null, h('a', { class: 'btn sm', href: `/app/applications/${a.id}` }, 'Open')));
      }))));
  }

  function manualDialog() {
    modal({
      title: 'Add a job you found elsewhere',
      content: (close) => {
        const company = h('input', { type: 'text', required: true });
        const title = h('input', { type: 'text', required: true });
        const url = h('input', { type: 'url', placeholder: 'https://…' });
        const location = h('input', { type: 'text' });
        const status = h('select', null, APP_STATUSES.map((s) => h('option', { value: s, selected: s === 'Applied' }, s)));
        const applied = h('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
        const interview = h('input', { type: 'datetime-local' });
        const notes = h('textarea');
        const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Add application');
        const form = h('form', null,
          h('div', { class: 'grid-2' }, field('Company', company), field('Job title', title)),
          h('div', { class: 'grid-2' }, field('Job URL', url), field('Location', location)),
          h('div', { class: 'grid-3' }, field('Status', status), field('Applied on', applied), field('Interview', interview)),
          field('Notes', notes),
          h('div', { class: 'modal-foot' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), btn));
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          busy(btn, async () => {
            try {
              const r = await api('/applications', { method: 'POST', body: { company: company.value, title: title.value, job_url: url.value, location: location.value, status: status.value, applied_on: applied.value, interview_at: interview.value || undefined, notes: notes.value } });
              close();
              toast('Application added', 'success');
              ctx.navigate(`/app/applications/${r.application.id}`);
            } catch (err) { formError(form, err.message); }
          });
        });
        return form;
      },
    });
  }
}
