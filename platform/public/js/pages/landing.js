import { h, icon, companyLogo, scoreRing, arrangementBadge } from '../ui.js';
import { state, setTheme } from '../main.js';
import { logo, brandName } from '../brand.js';

const FEATURES = [
  ['upload', 'Drag-and-drop resume parsing', 'Upload a PDF, DOC or DOCX. We extract your skills, experience, education and certifications into a profile you can edit.'],
  ['target', 'Explainable match scores', 'Every job shows a match percentage with the skills you have, the ones you are missing and why it was recommended.'],
  ['refresh', 'Fresh, verified listings — daily', 'Jobs are fetched every day from company career boards and trusted feeds. Expired, duplicate and broken listings are removed automatically.'],
  ['building', 'Direct employer links', 'We prioritise the company’s own application page over third-party redirects, so you apply where the hiring team actually looks.'],
  ['kanban', 'Application tracker', 'Track every application from Interested to Offer, with notes, interview dates, progress charts and CSV/Excel export.'],
  ['lock', 'Private by design', 'Your resume and history are visible only to you. Each account is fully isolated; resumes are never public.'],
];

const DEMO = [
  { company: 'Northwind Data', title: 'Senior Data Engineer — Databricks', loc: 'Bengaluru', arr: 'Hybrid', score: 88 },
  { company: 'Contoso Cloud', title: 'Azure Data Engineer', loc: 'Remote, India', arr: 'Remote', score: 81 },
  { company: 'Fabrikam', title: 'Analytics Engineer (dbt, Snowflake)', loc: 'Pune', arr: 'WFO', score: 74 },
];

export default function landing() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const cta = state.user
    ? h('a', { class: 'btn primary lg', href: '/app' }, 'Open your dashboard')
    : h('a', { class: 'btn primary lg', href: '/register' }, 'Create a free account');
  return h('div', { class: 'landing' },
    h('nav', { class: 'lnav' },
      logo({ href: '/', size: 'lg' }),
      h('div', { class: 'links' },
        h('button', { class: 'btn ghost icon-only', 'aria-label': 'Toggle dark mode', onclick: () => { setTheme(dark ? 'light' : 'dark'); location.reload(); } }, icon(dark ? 'sun' : 'moon')),
        state.user ? h('a', { class: 'btn primary', href: '/app' }, 'Dashboard') : [
          h('a', { class: 'btn ghost hide-sm', href: '/login' }, 'Sign in'),
          h('a', { class: 'btn primary', href: '/register' }, 'Get started'),
        ])),
    h('section', { class: 'hero' },
      h('div', null,
        h('span', { class: 'badge primary', style: { marginBottom: '16px' } }, icon('zap'), 'AI-powered job matching'),
        h('h1', null, 'Find jobs that ', h('em', null, 'actually fit'), ' your resume.'),
        h('p', { class: 'lead' }, `Upload your resume once. ${brandName()} matches you with active, verified openings — remote, hybrid or in-office — explains every score, and keeps your whole job search organised in one private workspace.`),
        h('div', { class: 'btn-row' }, cta, state.user ? null : h('a', { class: 'btn lg', href: '/login' }, 'I already have an account')),
        h('div', { class: 'chips', style: { marginTop: '22px' } },
          ['Data Engineering', 'Snowflake', 'Databricks', 'Power BI', 'Software', 'Product', 'Design', 'Marketing'].map((c) => h('span', { class: 'chip neutral' }, c)))),
      h('div', { class: 'hero-card', 'aria-hidden': 'true' },
        h('div', { class: 'card-head' }, h('h3', null, 'Recommended for you'), h('span', { class: 'badge success dot' }, 'Updated today')),
        DEMO.map((d) => h('div', { class: 'job-card' }, companyLogo(d.company),
          h('div', null, h('div', { class: 'job-title' }, d.title), h('div', { class: 'job-meta' }, h('span', null, d.company), h('span', null, d.loc)), arrangementBadge(d.arr)),
          h('div', { class: 'job-side' }, scoreRing(d.score)))),
        h('p', { class: 'muted', style: { margin: '6px 0 0', fontSize: '12px', textAlign: 'center' } }, 'Illustration — your dashboard shows real, live postings.'))),
    h('section', { class: 'features' }, FEATURES.map(([ic, t, d]) => h('div', { class: 'card feature' }, h('div', { class: 'ico' }, icon(ic)), h('h3', null, t), h('p', { class: 'muted', style: { margin: 0 } }, d)))),
    h('section', { class: 'trust' }, ['Remote', 'Hybrid', 'Work from office', 'Fresher to 10+ years', 'Daily refresh', 'CSV & Excel export'].map((t) => h('span', { class: 'badge' }, icon('check'), t))),
    h('footer', { class: 'lfoot' }, `© ${new Date().getFullYear()} ${brandName()} · You decide where to apply; we never apply on your behalf. · Powered by the open-source `, h('a', { href: 'https://github.com/career-ops-hq/career-ops', target: '_blank', rel: 'noopener' }, 'career-ops'), ' engine.'));
}
