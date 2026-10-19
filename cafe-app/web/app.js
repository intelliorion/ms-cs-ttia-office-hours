'use strict';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const TABS = [['round', 'Round'], ['ideas', 'Ideas'], ['checklist', 'Checklist'], ['review', 'Review'], ['outbox', 'Outbox']];

let state = null;
const ui = { tab: 'ideas', sel: null, notice: '', report: '' };
try { ui.tab = localStorage.getItem('cafe-tab') || 'ideas'; } catch (_) { /* storage blocked */ }

function setTab(tab) {
  ui.tab = tab;
  try { localStorage.setItem('cafe-tab', tab); } catch (_) { /* storage blocked */ }
}

async function api(url, body) {
  const init = body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Something went wrong (HTTP ${res.status})`), { data });
  return data;
}

async function refresh() {
  state = await api('/api/state');
  if (!state.ideas.some((i) => i.id === ui.sel)) ui.sel = state.ideas[0] ? state.ideas[0].id : null;
  render();
}

async function safeRefresh() {
  try {
    await refresh();
  } catch (e) {
    $('#notice').textContent = `Couldn't reach the app: ${e.message}`;
    $('#notice').hidden = false;
  }
}

async function act(fn, ok) {
  try {
    const r = await fn();
    ui.notice = ok ? ok(r) : '';
  } catch (e) {
    ui.notice = e.message;
    if (e.data && e.data.missing) setTab('round');
  }
  await safeRefresh();
}

async function copyText(m) {
  try {
    await navigator.clipboard.writeText(`Subject: ${m.subject}\n\n${m.body}`);
    return true;
  } catch (_) {
    return false;
  }
}

function waiting(i) {
  const late = new Set(i.overdue.map((o) => o.step));
  const soon = Object.entries(i.due || {})
    .filter(([step]) => i.status[step] !== 'done' && !late.has(step))
    .map(([step, due]) => {
      if (step === 's2d') return `Reply due ${esc(due)}`;
      const def = state.steps.find((x) => x.id === step);
      return `${esc(def ? def.text : step)} · due ${esc(due)}`;
    });
  return [...i.overdue.map((o) => esc(o.text)), ...soon].join('<br>') || '—';
}

const current = () => state.ideas.find((i) => i.id === ui.sel);
const ideaUrl = (suffix) => `/api/ideas/${encodeURIComponent(ui.sel)}/${suffix}`;

function ideaPicker() {
  return `<label>Idea <select data-action="pick">${state.ideas.map((i) =>
    `<option value="${esc(i.id)}" ${i.id === ui.sel ? 'selected' : ''}>${esc(i.id)} ${esc(i.title)}</option>`).join('')}</select></label>`;
}

function viewRound() {
  const { round, settings, fields } = state;
  const input = (src, [key, label], type) =>
    `<label>${esc(label)}<input type="${type}" name="${key}" value="${esc(src[key] ?? '')}"></label>`;
  return `
  <section><h2>${esc(round.id)}: dates</h2>
    <p>Emails that need a date or link can't be approved until it's set here.</p>
    <form data-form="round">${fields.round.map((f) => input(round, f, 'date')).join('')}<button>Save dates</button></form></section>
  <section><h2>Links, signature and capacity</h2>
    <form data-form="settings">${fields.settings.map((f) => input(settings, f, 'text')).join('')}
      <label>Ideas you can take into the design series per round<input type="number" min="1" name="ideasPerRound" value="${settings.capacity.ideasPerRound}"></label>
      <label>Sessions per week<input type="number" min="1" name="sessionsPerWeek" value="${settings.capacity.sessionsPerWeek}"></label>
      <button>Save settings</button></form></section>
  <section><h2>Call for ideas</h2>
    <button data-action="round-draft" data-template="E0">Draft the call for ideas (E0)</button>
    <button data-action="round-draft" data-template="E0B">Draft the deadline reminder (E0B)</button></section>
  <section><h2>For submitters and TTIA</h2>
    <button data-action="status-export">Write status.csv (no names)</button>
    <button data-action="review-pack">Make the review pack for TTIA</button></section>`;
}

function viewIdeas() {
  const rows = state.ideas.map((i) => `
    <tr class="${i.overdue.length ? 'late' : ''}">
      <td><button class="link" data-action="open" data-id="${esc(i.id)}">${esc(i.id)}</button></td>
      <td>${esc(i.title)}</td>
      <td>${esc(i.function || '')}</td>
      <td>${esc(i.progress.label)}</td>
      <td>${waiting(i)}</td>
      <td>${esc(i.flags.join(' · ')) || '—'}</td>
    </tr>`).join('');
  const table = state.ideas.length
    ? `<table><thead><tr><th>Café ID</th><th>Title</th><th>Team</th><th>Where it is</th><th>Waiting</th><th>Flags</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p>No ideas yet. Import an export above.</p>';
  const problems = state.problems.length
    ? `<p class="warn">Couldn't read: ${state.problems.map((p) => esc(`${p.folder}: ${p.message}`)).join('; ')}</p>` : '';
  return `
  <section><h2>Import submissions</h2>
    <div id="drop" class="drop">Drop a SharePoint or Forms export (.csv or .xlsx) here, or
      <label class="link">choose a file<input type="file" id="file" accept=".csv,.xlsx" hidden></label></div>
    <div id="report">${ui.report}</div></section>
  <section><h2>Ideas (${state.ideas.length})</h2>${table}${problems}</section>`;
}

function viewChecklist() {
  const i = current();
  if (!i) return '<p>No ideas yet.</p>';
  const stages = [1, 2, 3, 4].map((n) => {
    const items = state.steps.filter((s) => s.stage === n).map((s) => {
      const st = i.status[s.id];
      const t = i.checklist[s.id];
      const draft = s.email && /^E\d+$/.test(s.email) && st === 'open'
        ? ` <button data-action="draft" data-template="${s.email}">Draft ${s.email}</button>` : '';
      const reminder = s.id === 's2d' && i.offerE2R
        ? ' <button data-action="draft" data-template="E2R">No reply for 5+ days · draft reminder (E2R)</button>' : '';
      const who = t && t.done ? `<small>${t.by === 'app' ? 'Ticked by the app' : 'Ticked by you'}, ${esc(t.at)}${t.source ? ` · ${esc(t.source)}` : ''}</small>` : '';
      return `<li class="${st === 'n/a' ? 'na' : st}"><label><input type="checkbox" data-action="tick" data-step="${s.id}" ${st === 'done' ? 'checked' : ''} ${st === 'n/a' ? 'disabled' : ''}>
        <span class="owner">${s.owner}</span> ${esc(s.text)}${s.needed ? ' <em>needed</em>' : ''}</label>${who}${st === 'n/a' ? '<small>Not applicable</small>' : ''}${draft}${reminder}</li>`;
    }).join('');
    return `<section><h3>${n} · ${esc(state.stageNames[n])}${i.stage === n && !i.closed ? ' (now)' : ''}</h3><ul class="steps">${items}</ul></section>`;
  }).join('');
  const move = !i.closed && i.stage < 4 ? `<button class="primary" data-action="advance">Move to ${esc(state.stageNames[i.stage + 1])}</button>` : '';
  return `${ideaPicker()}<p>${esc(i.progress.label)}</p>${move}${stages}`;
}

function viewReview() {
  const i = current();
  if (!i) return '<p>No ideas yet.</p>';
  const r = i.review;
  if (i.closed) return `${ideaPicker()}<section><p>${esc(i.progress.label)}.</p>${r ? `<p>${esc(state.decisions[r.decision])}: ${esc(r.reason)}</p>` : ''}</section>`;
  return `${ideaPicker()}
  <section><form data-form="review">
    <fieldset><legend>Criteria</legend>${state.criteria.map((c) =>
      `<label><input type="checkbox" name="c-${c.id}" ${r && r.criteria[c.id] ? 'checked' : ''}> ${esc(c.text)}</label>`).join('')}</fieldset>
    <label>Decision<select name="decision">${Object.entries(state.decisions).map(([k, v]) =>
      `<option value="${k}" ${r && r.decision === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
    <label>Reason<textarea name="reason" required>${esc(r ? r.reason : '')}</textarea></label>
    <button>Save the review and draft the email</button>
  </form></section>`;
}

function viewOutbox() {
  const bad = (state.outboxProblems || []).length
    ? `<p class="warn">Couldn't read: ${state.outboxProblems.map((p) => esc(`${p.file}: ${p.message}`)).join('; ')}</p>` : '';
  if (!state.outbox.length) return `<p>Nothing in the Outbox yet.</p>${bad}`;
  return bad + state.outbox.map((m) => {
    const left = m.contentPlaceholders.length;
    const actions = m.status === 'draft'
      ? `<button class="primary" data-action="approve" data-key="${esc(m.key)}">${m.missingSettings.length ? 'Open Round to set them' : 'Approve and copy'}</button>`
      : m.status === 'approved'
        ? `<button data-action="copy" data-key="${esc(m.key)}">Copy again</button> <button class="primary" data-action="sent" data-key="${esc(m.key)}">Mark as sent</button>`
        : `<small>Sent ${esc(m.sentAt)}</small>`;
    return `<article class="mail ${m.status}">
      <header><strong>${esc(m.template)}</strong> · ${esc(m.idea || m.round)} · <span class="badge">${m.status}</span></header>
      <p><b>To:</b> ${esc(m.view.to)}<br><b>Subject:</b> ${esc(m.view.subject)}</p>
      <pre>${esc(m.view.body)}</pre>
      ${m.missingSettings.length ? `<p class="warn">Set first: ${m.missingSettings.map((x) => esc(x.label)).join(', ')}</p>` : ''}
      ${left ? `<p>${left} placeholder${left === 1 ? '' : 's'} to fill in Outlook.</p>` : ''}
      ${actions}</article>`;
  }).join('');
}

function render() {
  const open = state.outbox.filter((m) => m.status !== 'sent').length;
  $('#tabs').innerHTML = TABS.map(([k, label]) =>
    `<button role="tab" aria-selected="${ui.tab === k}" data-action="tab" data-tab="${k}">${label}${k === 'outbox' && open ? ` (${open})` : ''}</button>`).join('');
  $('#today').textContent = `Today: ${state.today} · ${state.round.id}`;
  $('#notice').textContent = ui.notice;
  $('#notice').hidden = !ui.notice;
  const views = { round: viewRound, ideas: viewIdeas, checklist: viewChecklist, review: viewReview, outbox: viewOutbox };
  $('#main').innerHTML = (views[ui.tab] || viewIdeas)();
}

async function upload(file) {
  if (!file) return;
  try {
    const res = await fetch('/api/import', { method: 'POST', headers: { 'x-filename': file.name, 'content-type': 'application/octet-stream' }, body: file });
    const r = await res.json();
    if (!res.ok) throw new Error(r.error);
    const errors = r.errors.length ? `, ${r.errors.length} row${r.errors.length === 1 ? '' : 's'} not read (${r.errors.map((e) => `row ${e.row}: ${esc(e.message)}`).join('; ')})` : '';
    ui.report = `<p>Imported ${r.created.length} new, skipped ${r.duplicates.length} already imported${errors}.</p>`
      + (r.duplicates.length ? `<p>Already imported: ${r.duplicates.map((d) => `row ${d.row} is ${esc(d.id)}`).join('; ')}.</p>` : '')
      + (r.ignoredColumns.length ? `<p>Columns not used: ${r.ignoredColumns.map(esc).join(', ')}.</p>` : '')
      + (r.flags.length ? `<ul>${r.flags.map((f) => `<li>${esc(f.id)}: ${esc(f.message)}</li>`).join('')}</ul>` : '');
    ui.notice = '';
  } catch (e) {
    ui.notice = e.message;
  }
  await safeRefresh();
}

document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-action]');
  if (!b || b.matches('input, select')) return;
  const outboxItem = () => state.outbox.find((x) => x.key === b.dataset.key);
  switch (b.dataset.action) {
    case 'tab': setTab(b.dataset.tab); ui.notice = ''; render(); break;
    case 'open': ui.sel = b.dataset.id; setTab('checklist'); render(); break;
    case 'draft': act(() => api(ideaUrl('draft'), { template: b.dataset.template }), (r) => `${r.template} is drafted in the Outbox.`); break;
    case 'round-draft': act(() => api('/api/round/draft', { template: b.dataset.template }), (r) => `${r.template} is drafted in the Outbox.`); break;
    case 'advance': act(() => api(ideaUrl('advance'), {}), (r) => `${r.id} moved to ${state.stageNames[r.stage]}.`); break;
    case 'status-export': act(() => api('/api/status-export', {}), (r) => `Written: ${r.file}`); break;
    case 'review-pack': act(() => api('/api/review-pack', {}), (r) => `Written: ${r.file}`); break;
    case 'approve': {
      const m = outboxItem();
      if (!m) break;
      if (m.missingSettings.length) {
        setTab('round');
        ui.notice = `Set first: ${m.missingSettings.map((x) => x.label).join(', ')}`;
        render();
        break;
      }
      act(async () => copyText(await api('/api/outbox/approve', { key: m.key })),
        (copied) => (copied ? 'Approved and copied. Paste it into Outlook, then mark it as sent.' : 'Approved. Use "Copy again" to copy it for Outlook.'));
      break;
    }
    case 'copy': {
      const m = outboxItem();
      if (!m) break;
      copyText(m.view).then((ok) => { ui.notice = ok ? 'Copied.' : "Copy didn't work here. Select the text and copy it."; render(); });
      break;
    }
    case 'sent': act(() => api('/api/outbox/sent', { key: b.dataset.key }), () => 'Marked as sent. The matching step is ticked.'); break;
  }
});

document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.matches('[data-action="tick"]')) act(() => api(ideaUrl('tick'), { step: t.dataset.step, done: t.checked }));
  else if (t.matches('[data-action="pick"]')) { ui.sel = t.value; render(); }
  else if (t.id === 'file') upload(t.files[0]);
});

document.addEventListener('submit', (ev) => {
  const form = ev.target.closest('form[data-form]');
  if (!form) return;
  ev.preventDefault();
  const fd = new FormData(form);
  if (form.dataset.form === 'round') {
    act(() => api('/api/round', Object.fromEntries(fd)), () => 'Dates saved.');
  } else if (form.dataset.form === 'settings') {
    const body = Object.fromEntries(state.fields.settings.map(([k]) => [k, fd.get(k) || '']));
    body.capacity = { ideasPerRound: Number(fd.get('ideasPerRound')), sessionsPerWeek: Number(fd.get('sessionsPerWeek')) };
    act(() => api('/api/settings', body), () => 'Settings saved.');
  } else if (form.dataset.form === 'review') {
    const criteria = Object.fromEntries(state.criteria.map((c) => [c.id, fd.get(`c-${c.id}`) === 'on']));
    act(() => api(ideaUrl('review'), { criteria, decision: fd.get('decision'), reason: fd.get('reason') }),
      (r) => `Saved. ${r.email.template} is drafted in the Outbox.${r.warnings.length ? ` ${r.warnings.join(' ')}` : ''}`);
  }
});

const dropZone = (ev) => (ev.target.closest ? ev.target.closest('#drop') : null);
document.addEventListener('dragover', (ev) => {
  const d = dropZone(ev);
  if (d) { ev.preventDefault(); d.classList.add('over'); }
});
document.addEventListener('dragleave', (ev) => {
  const d = dropZone(ev);
  if (d) d.classList.remove('over');
});
document.addEventListener('drop', (ev) => {
  const d = dropZone(ev);
  if (!d) return;
  ev.preventDefault();
  upload(ev.dataTransfer.files[0]);
});

refresh().catch((e) => { $('#main').textContent = `Couldn't reach the app: ${e.message}`; });
