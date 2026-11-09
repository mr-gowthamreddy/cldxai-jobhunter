import { h, icon, field, formError, busy } from '../ui.js';
import { api, setCsrf } from '../api.js';
import { state, navigate } from '../main.js';

function frame(title, subtitle, form, foot) {
  return h('div', { class: 'auth-wrap' },
    h('div', { class: 'auth-side' },
      h('a', { class: 'brand', href: '/' }, h('span', { class: 'brand-mark' }, 'C'), 'Career-Ops'),
      h('div', null,
        h('h2', null, 'Your job search, organised.'),
        h('p', null, 'Resume-based matching, daily verified listings and a private application tracker — for every profession.'),
        h('div', { class: 'chips', style: { marginTop: '18px' } }, ['Explainable matches', 'Direct employer links', 'Private by default'].map((t) => h('span', { class: 'chip', style: { background: 'rgba(255,255,255,.15)', color: '#fff' } }, t)))),
      h('small', { style: { color: 'rgba(255,255,255,.7)' } }, 'Open source · runs on your own server')),
    h('div', { class: 'auth-main' }, h('div', { class: 'auth-card' },
      h('a', { class: 'brand', href: '/', style: { paddingLeft: 0 } }, h('span', { class: 'brand-mark' }, 'C'), 'Career-Ops'),
      h('h1', null, title), h('p', { class: 'muted' }, subtitle), form, foot ? h('p', { class: 'muted', style: { marginTop: '18px', textAlign: 'center' } }, foot) : null)));
}

function safeNext(q) {
  const n = q.get('next') || '';
  return n.startsWith('/') && !n.startsWith('//') ? n : '/app';
}

function pwStrength(input) {
  const bar = h('span');
  const meter = h('div', { class: 'pw-meter' }, bar);
  const upd = () => {
    const v = input.value;
    let s = 0;
    if (v.length >= 8) s++; if (v.length >= 12) s++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++; if (/\d/.test(v)) s++; if (/[^A-Za-z0-9]/.test(v)) s++;
    bar.style.width = `${(s / 5) * 100}%`;
    bar.style.background = s <= 2 ? 'var(--danger)' : s === 3 ? 'var(--warning)' : 'var(--success)';
  };
  input.addEventListener('input', upd);
  return meter;
}

export function login(ctx) {
  const email = h('input', { type: 'email', autocomplete: 'email', required: true });
  const password = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const btn = h('button', { class: 'btn primary lg', type: 'submit', style: { width: '100%' } }, 'Sign in');
  const form = h('form', { novalidate: true },
    field('Email', email), field('Password', password),
    h('div', { style: { textAlign: 'right', marginTop: '-6px', marginBottom: '14px' } }, h('a', { href: '/forgot-password' }, 'Forgot password?')),
    btn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    formError(form, null);
    busy(btn, async () => {
      try {
        const r = await api('/auth/login', { method: 'POST', body: { email: email.value, password: password.value } });
        state.user = r.user; setCsrf(r.csrf);
        navigate(safeNext(ctx.query), { replace: true });
      } catch (err) { formError(form, err.message); }
    });
  });
  return frame('Welcome back', 'Sign in to your workspace.', form, state.registration ? ['New here? ', h('a', { href: '/register' }, 'Create an account')] : null);
}

export function register(ctx) {
  if (!state.registration) return frame('Registration closed', 'Ask an administrator to create an account for you.', h('a', { class: 'btn primary', href: '/login' }, 'Sign in'));
  const name = h('input', { type: 'text', autocomplete: 'name', required: true });
  const email = h('input', { type: 'email', autocomplete: 'email', required: true });
  const password = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const confirm = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const btn = h('button', { class: 'btn primary lg', type: 'submit', style: { width: '100%' } }, 'Create account');
  const form = h('form', { novalidate: true },
    field('Full name', name), field('Email', email),
    h('div', { class: 'field' }, h('label', { for: 'reg-pw' }, 'Password'), Object.assign(password, { id: 'reg-pw' }), pwStrength(password), h('div', { class: 'hint' }, 'At least 8 characters, with a letter and a number.')),
    field('Confirm password', confirm),
    h('p', { class: 'muted', style: { fontSize: '12px' } }, 'Your resume and job search data stay private to your account.'),
    btn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    formError(form, null);
    if (password.value !== confirm.value) return formError(form, 'The passwords do not match.');
    busy(btn, async () => {
      try {
        const r = await api('/auth/register', { method: 'POST', body: { full_name: name.value, email: email.value, password: password.value } });
        if (r.pending) {
          form.replaceWith(h('div', { class: 'form-ok' }, r.message));
          return;
        }
        state.user = r.user; setCsrf(r.csrf);
        navigate('/app/resumes?welcome=1', { replace: true });
      } catch (err) { formError(form, err.message); }
    });
  });
  return frame('Create your account', 'Start matching your resume with live jobs in minutes.', form, ['Already have an account? ', h('a', { href: '/login' }, 'Sign in')]);
}

export function forgot() {
  const email = h('input', { type: 'email', autocomplete: 'email', required: true });
  const btn = h('button', { class: 'btn primary lg', type: 'submit', style: { width: '100%' } }, 'Send reset link');
  const form = h('form', { novalidate: true }, field('Email', email), btn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    formError(form, null);
    busy(btn, async () => {
      try {
        const r = await api('/auth/forgot', { method: 'POST', body: { email: email.value } });
        form.replaceWith(h('div', null, h('div', { class: 'form-ok' }, r.message), r.dev_note ? h('div', { class: 'callout warn' }, icon('info'), h('div', null, r.dev_note)) : null));
      } catch (err) { formError(form, err.message); }
    });
  });
  return frame('Reset your password', 'Enter your account email and we will send you a reset link.', form, h('a', { href: '/login' }, 'Back to sign in'));
}

export function reset(ctx) {
  const token = ctx.query.get('token') || '';
  const password = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const confirm = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const btn = h('button', { class: 'btn primary lg', type: 'submit', style: { width: '100%' } }, 'Set new password');
  const form = h('form', { novalidate: true }, h('div', { class: 'field' }, h('label', null, 'New password'), password, pwStrength(password)), field('Confirm password', confirm), btn);
  if (!token) formError(form, 'This link is missing its reset token. Request a new link.');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    formError(form, null);
    if (password.value !== confirm.value) return formError(form, 'The passwords do not match.');
    busy(btn, async () => {
      try {
        const r = await api('/auth/reset', { method: 'POST', body: { token, password: password.value } });
        form.replaceWith(h('div', null, h('div', { class: 'form-ok' }, r.message), h('a', { class: 'btn primary', href: '/login' }, 'Sign in')));
      } catch (err) { formError(form, err.message); }
    });
  });
  return frame('Choose a new password', 'Pick a password you do not use anywhere else.', form, h('a', { href: '/forgot-password' }, 'Request a new link'));
}
