import { h, icon, clear, emptyState, fmtBytes, fmtDate, timeAgo, toast, errorToast, modal, field, formError, busy, confirmDialog, tagInput } from '../ui.js';
import { api, upload } from '../api.js';

const ACCEPT = '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export default async function resumes(ctx, container) {
  let data = await api('/resumes');
  const welcome = ctx.query.get('welcome') === '1';
  const listBox = h('div', { class: 'stack' });
  const detailBox = h('div');
  let selected = data.resumes.find((r) => r.is_active)?.id || data.resumes[0]?.id || null;

  const head = h('div', { class: 'page-head' },
    h('div', null, h('h1', null, 'Resumes'), h('p', null, 'Upload versions of your resume. The active one powers your job matches; parsed details are editable.')));

  const fileInput = h('input', { type: 'file', accept: ACCEPT, class: 'sr-only', id: 'resume-file' });
  const progressArea = h('div');
  let replaceId = null;
  const dz = h('div', { class: 'dropzone', role: 'button', tabindex: '0', 'aria-label': 'Upload a resume: drop a file here or press Enter to browse' },
    icon('upload'),
    h('h3', null, 'Drag & drop your resume here'),
    h('p', { class: 'muted', style: { margin: 0 } }, `PDF, DOC or DOCX · up to ${data.limits.max_mb} MB · `, h('span', { style: { color: 'var(--primary)', fontWeight: 600 } }, 'or browse files')),
    fileInput);
  const openPicker = (rid = null) => { replaceId = rid; fileInput.value = ''; fileInput.click(); };
  dz.addEventListener('click', (e) => { if (e.target !== fileInput) openPicker(); });
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } });
  for (const ev of ['dragenter', 'dragover']) dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); });
  dz.addEventListener('drop', (e) => { const f = e.dataTransfer.files?.[0]; if (f) send(f, null); });
  fileInput.addEventListener('change', () => { const f = fileInput.files?.[0]; if (f) send(f, replaceId); });

  async function send(file, rid) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'doc', 'docx'].includes(ext)) return errorToast(new Error('Only PDF, DOC and DOCX files are accepted.'));
    if (file.size > data.limits.max_mb * 1024 * 1024) return errorToast(new Error(`The file is larger than ${data.limits.max_mb} MB.`));
    const bar = h('span', { style: { width: '0%' } });
    const pct = h('span', { class: 'muted', style: { minWidth: '90px', textAlign: 'right' } }, '0%');
    const item = h('div', { class: 'upload-item' }, icon('file'), h('div', { style: { minWidth: 0, flex: 1 } }, h('div', { style: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' } }, file.name), h('div', { class: 'progress' }, bar)), pct);
    progressArea.append(item);
    const fd = new FormData();
    if (rid) fd.append('replace_id', String(rid));
    fd.append('file', file);
    try {
      const r = await upload('/resumes', fd, (p) => { bar.style.width = `${Math.round(p * 100)}%`; pct.textContent = p < 1 ? `${Math.round(p * 100)}%` : 'Analysing…'; });
      bar.style.width = '100%';
      pct.textContent = r.resume.parse_status === 'parsed' ? 'Done' : 'Uploaded';
      toast(r.resume.parse_status === 'parsed' ? 'Resume uploaded and analysed — review the extracted details.' : `Uploaded, but parsing failed: ${r.resume.parse_error}`, r.resume.parse_status === 'parsed' ? 'success' : 'error');
      selected = r.resume.id;
      setTimeout(() => item.remove(), 2500);
      await reload();
    } catch (err) {
      pct.textContent = 'Failed';
      item.append(h('span', { class: 'badge danger' }, err.message));
      setTimeout(() => item.remove(), 8000);
    }
  }

  async function reload() {
    data = await api('/resumes');
    if (!data.resumes.some((r) => r.id === selected)) selected = data.resumes.find((r) => r.is_active)?.id || data.resumes[0]?.id || null;
    renderList();
    renderDetail();
  }

  function renderList() {
    clear(listBox);
    if (!data.resumes.length) { listBox.append(emptyState('file', 'No resumes yet', 'Your uploads stay private to your account.')); return; }
    for (const r of data.resumes) {
      const row = h('div', { class: 'card', style: { padding: '14px', cursor: 'pointer', borderColor: r.id === selected ? 'var(--primary)' : '' }, onclick: () => { selected = r.id; renderList(); renderDetail(); } },
        h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
          h('div', { class: 'stat' }, h('div', { class: 'ico' }, icon('file'))),
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { style: { fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.label, h('span', { class: 'muted', style: { fontWeight: 500 } }, ` · v${r.version}`)),
            h('div', { class: 'muted', style: { fontSize: '12px' } }, `${r.file_ext.toUpperCase()} · ${fmtBytes(r.size_bytes)} · ${timeAgo(r.created_at)}`)),
          r.is_active ? h('span', { class: 'badge success' }, 'Active') : null,
          r.parse_status === 'failed' ? h('span', { class: 'badge danger' }, 'Parse failed') : null));
      listBox.append(row);
    }
  }

  async function renderDetail() {
    clear(detailBox);
    if (!selected) {
      detailBox.append(h('div', { class: 'card' }, emptyState('upload', 'Upload a resume to build your profile', 'We extract your name, contact details, experience, skills, cloud platforms, databases, certifications and education.')));
      return;
    }
    detailBox.append(h('div', { class: 'skeleton', style: { height: '300px' } }));
    const { resume: r, data: d } = await api(`/resumes/${selected}`);
    clear(detailBox);
    const actions = h('div', { class: 'btn-row' },
      r.file_ext === 'pdf' ? h('button', { class: 'btn sm', onclick: () => preview(r) }, icon('eye'), 'Preview') : null,
      h('a', { class: 'btn sm', href: `/api/resumes/${r.id}/file`, download: true }, icon('download'), 'Download'),
      r.is_active ? null : h('button', { class: 'btn sm primary', onclick: async () => { try { await api(`/resumes/${r.id}/activate`, { method: 'POST' }); toast('Active resume changed — matches updated', 'success'); reload(); } catch (err) { errorToast(err); } } }, icon('check'), 'Use for matching'),
      h('button', { class: 'btn sm', onclick: () => openPicker(r.id) }, icon('refresh'), 'Replace file'),
      h('button', { class: 'btn sm', onclick: () => rename(r) }, icon('edit'), 'Rename'),
      h('button', { class: 'btn sm', onclick: async (e) => { await busy(e.currentTarget, async () => { try { await api(`/resumes/${r.id}/reparse`, { method: 'POST' }); toast('Re-analysed from the original file'); renderDetail(); } catch (err) { errorToast(err); } }); } }, icon('zap'), 'Re-run parsing'),
      h('button', { class: 'btn sm danger', onclick: async () => {
        if (!(await confirmDialog(`Delete “${r.label}” (v${r.version})? The file and its extracted data are removed permanently.`, { okText: 'Delete', danger: true }))) return;
        try { await api(`/resumes/${r.id}`, { method: 'DELETE' }); toast('Resume deleted'); reload(); } catch (err) { errorToast(err); }
      } }, icon('trash'), 'Delete'));

    const head2 = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', null, h('h3', null, `${r.label} · v${r.version}`), h('div', { class: 'muted', style: { fontSize: '12px' } }, `${r.original_name} · uploaded ${fmtDate(r.created_at, true)}`)), r.is_active ? h('span', { class: 'badge success' }, 'Used for matching') : null),
      actions,
      r.parse_status === 'failed' ? h('div', { class: 'callout danger', style: { marginTop: '12px' } }, icon('alert'), h('div', null, h('b', null, 'We could not read text from this file. '), r.parse_error, ' You can still fill in the details below by hand.')) : null);
    detailBox.append(head2, profileForm(r, d || {}), insightsCard(r));
  }

  function profileForm(r, d) {
    const name = h('input', { type: 'text', value: d.candidate_name || '' });
    const email = h('input', { type: 'email', value: d.email || '' });
    const phone = h('input', { type: 'text', value: d.phone || '' });
    const total = h('input', { type: 'number', min: 0, max: 60, step: '0.1', value: d.total_experience_years ?? '' });
    const relevant = h('input', { type: 'number', min: 0, max: 60, step: '0.1', value: d.relevant_experience_years ?? '' });
    const role = h('input', { type: 'text', value: d.current_role || '' });
    const summary = h('textarea', { rows: 3, value: d.summary || '' });
    const tags = {
      job_titles: tagInput(d.job_titles || [], { placeholder: 'Add a job title' }),
      technical_skills: tagInput(d.technical_skills || [], { placeholder: 'Add a skill or tool' }),
      programming_languages: tagInput(d.programming_languages || [], { placeholder: 'Add a language' }),
      cloud_platforms: tagInput(d.cloud_platforms || [], { placeholder: 'AWS, Azure, GCP…' }),
      databases: tagInput(d.databases || [], { placeholder: 'Add a database' }),
      certifications: tagInput(d.certifications || [], { placeholder: 'Add a certification' }),
      education: tagInput(d.education || [], { placeholder: 'Add a degree / school' }),
    };
    const save = h('button', { class: 'btn primary', type: 'submit' }, 'Save profile');
    const form = h('form', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', null, 'Extracted candidate profile'), d.edited_by_user ? h('span', { class: 'badge info' }, 'Edited by you') : h('span', { class: 'badge' }, 'Auto-extracted — please review')),
      h('div', { class: 'grid-3' }, field('Candidate name', name), field('Email', email), field('Phone', phone)),
      h('div', { class: 'grid-3' }, field('Total experience (years)', total), field('Relevant experience (years)', relevant), field('Current role', role)),
      field('Previous job titles', tags.job_titles.el),
      field('Technical skills & tools', tags.technical_skills.el, 'Used for matching. Add anything the parser missed.'),
      h('div', { class: 'grid-3' }, field('Programming languages', tags.programming_languages.el), field('Cloud platforms', tags.cloud_platforms.el), field('Databases', tags.databases.el)),
      h('div', { class: 'grid-2' }, field('Certifications', tags.certifications.el), field('Education', tags.education.el)),
      field('Summary', summary),
      save);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      formError(form, null);
      busy(save, async () => {
        try {
          const body = { candidate_name: name.value, email: email.value, phone: phone.value, total_experience_years: total.value, relevant_experience_years: relevant.value, current_role: role.value, summary: summary.value };
          for (const [k, t] of Object.entries(tags)) body[k] = t.get();
          await api(`/resumes/${r.id}/data`, { method: 'PUT', body });
          toast('Profile saved — your matches now use these details', 'success');
        } catch (err) { formError(form, err.message); }
      });
    });
    return form;
  }

  function insightsCard(r) {
    const card = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, 'Resume improvement suggestions')), h('div', { class: 'skeleton', style: { height: '120px' } }));
    api(`/resumes/${r.id}/insights`).then((ins) => {
      card.lastChild.remove();
      const lvl = { high: 'danger', medium: 'warning', low: 'info', info: 'success' };
      card.append(h('div', { class: 'stack' }, ins.suggestions.map((s) => h('div', { style: { display: 'flex', gap: '10px' } },
        h('span', { class: `badge ${lvl[s.level] || ''}`, style: { flex: 'none' } }, s.level === 'info' ? 'OK' : s.level),
        h('div', null, h('b', null, s.title), h('div', { class: 'text-2', style: { fontSize: '13px' } }, s.detail))))));
      if (ins.missing_skills.length) {
        card.append(h('hr'), h('h4', null, `Missing-skills analysis (across your ${ins.compared_jobs} best-matching jobs)`),
          h('div', { class: 'stack' }, ins.missing_skills.slice(0, 10).map((m) => h('div', null,
            h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px' } }, h('span', null, m.skill), h('span', { class: 'muted' }, `${m.count} jobs · ${m.share}%`)),
            h('div', { class: 'progress' }, h('span', { style: { width: `${m.share}%` } }))))));
      }
    }).catch((err) => { card.lastChild.replaceWith(h('div', { class: 'form-error' }, err.message)); });
    return card;
  }

  function preview(r) {
    modal({ title: r.original_name, wide: true, content: h('iframe', { src: `/api/resumes/${r.id}/file?inline=1`, title: 'Resume preview', style: { width: '100%', height: '75vh', border: '1px solid var(--border)', borderRadius: '8px', background: '#fff' } }) });
  }

  function rename(r) {
    modal({
      title: 'Rename resume',
      content: (close) => {
        const label = h('input', { type: 'text', value: r.label, required: true });
        const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Save');
        const form = h('form', null, field('Label', label, 'e.g. “Data Engineer – 2026” or “Product resume”'), h('div', { class: 'modal-foot' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), btn));
        form.addEventListener('submit', (e) => { e.preventDefault(); busy(btn, async () => { try { await api(`/resumes/${r.id}`, { method: 'PATCH', body: { label: label.value } }); close(); reload(); } catch (err) { formError(form, err.message); } }); });
        return form;
      },
    });
  }

  container.append(head,
    welcome && !data.resumes.length ? h('div', { class: 'callout success', style: { marginBottom: '16px' } }, icon('check'), h('div', null, h('b', null, 'Account created. '), 'Upload your resume to get matched with live jobs.')) : '',
    h('div', { class: 'split', style: { gridTemplateColumns: 'minmax(0,1fr) minmax(0,2fr)' } },
      h('div', { class: 'stack' }, dz, progressArea, h('div', { class: 'callout' }, icon('lock'), h('div', { style: { fontSize: '13px' } }, 'Resumes are stored privately on this server. Only you can view or download them; administrators see counts, never contents.')), listBox),
      detailBox));
  renderList();
  renderDetail();
}
