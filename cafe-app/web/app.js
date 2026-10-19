'use strict';

// Operator page. Layout and styling follow the approved mockup (cafe-console/project/Main.dc.html);
// every value comes from /api/state. Server values are always passed through esc() before they reach
// innerHTML.

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(iso || '');
};

// Tab order from the mockup. Tabs with a plan number are not built yet.
const TABS = [
  { key: 'round', label: 'Round' },
  { key: 'inbox', label: 'Inbox', plan: 2, what: 'Drop exports, Outlook emails, Teams transcripts and documents here. The app works out what each item is and which idea it belongs to; safe actions apply with Undo, and anything that ticks a step, creates an idea or drafts an email waits for your OK.' },
  { key: 'review', label: 'Review' },
  { key: 'ideas', label: 'Ideas' },
  { key: 'checklist', label: 'Checklist' },
  { key: 'tools', label: 'Tool picker', plan: 4, what: 'Splits an idea into features and recommends a tool for each from the approved list and the five pathways. You make the final pick, saved to approach.md.' },
  { key: 'design', label: 'Design', plan: 4, what: 'Runs the design brainstorm one question at a time and fills in design.md, ending with a Café check, for you to approve.' },
  { key: 'cohorts', label: 'Cohorts', plan: 4, what: 'Groups ideas by the capability they share and the support they asked for, with session dates and calendar invites, one folder per cohort under cohorts/.' },
  { key: 'graph', label: 'Graph', plan: 3, what: 'A knowledge graph built from every idea folder, email and transcript, showing which ideas share a pain point, a capability or a tool, and where each link came from.' },
  { key: 'roadshow', label: 'Roadshow', plan: 4, what: 'Builds the Launch and Learn pack from each idea’s design, outcome and demo notes: deck, presenter script, run of show and who to invite.' },
  { key: 'outbox', label: 'Outbox' },
];

// Where each Round field is used, checked against the bundled templates and the status export.
const USED_IN = {
  open: 'not used in an email yet',
  deadline: 'E0, E0B',
  reviewBy: 'E1, status.csv',
  seriesStart: 'not used in an email yet',
  roadshow: 'not used in an email yet',
  operatorName: 'the signature of every email',
  formLink: 'E0, E0B',
  csicLink: 'E5, E9, E11, CSIC handoff',
  teamsLink: 'E3, E7, E10, session emails',
  distList: 'E0, E0B',
  deckTemplate: 'roadshow deck (plan 4)',
};
// Template titles, from the front matter of templates/*.md.
const TEMPLATE_TITLES = {
  E0: 'Call for ideas', E0B: 'Deadline reminder', E1: 'Idea received', E2: 'A few questions', E2R: 'Reminder about our questions',
  E3: 'Selected for the design series', E4: 'Reuse what exists', E5: 'Route to the CSIC Repository', E6: 'Not in this round',
  E7: 'Session invite', E8: 'Session follow-up', E9: 'Where your idea goes next', E10: 'Roadshow booked', E11: 'Feedback and decision',
  PD: 'Data held', RS: 'Session moved', SR: 'Session reminder',
};
const DECISION_TEMPLATES = ['E3', 'E4', 'E5', 'E6'];

let state = null;
const ui = { tab: 'ideas', sel: null, notice: '', noticeKind: 'ok', report: '' };
try { ui.tab = localStorage.getItem('cafe-tab') || 'ideas'; } catch (_) { /* storage blocked */ }
if (!TABS.some((t) => t.key === ui.tab)) ui.tab = 'ideas';

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

function showNotice(text, kind) {
  const n = $('#notice');
  n.textContent = text;
  n.className = `banner ${kind || 'ok'}`;
  n.hidden = !text;
}

async function safeRefresh() {
  try {
    await refresh();
  } catch (e) {
    showNotice(`Couldn't reach the app: ${e.message}`, 'warn');
  }
}

async function act(fn, ok) {
  try {
    const r = await fn();
    ui.notice = ok ? ok(r) : '';
    ui.noticeKind = 'ok';
  } catch (e) {
    ui.notice = e.message;
    ui.noticeKind = 'warn';
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

const current = () => state.ideas.find((i) => i.id === ui.sel);
const ideaUrl = (id, suffix) => `/api/ideas/${encodeURIComponent(id)}/${suffix}`;
const stageName = (n) => state.stageNames[n] || `Stage ${n}`;
const closedLabel = (i) => i.progress.label.split(' · ').slice(0, 2).join(' · ');
const stageText = (i) => (i.closed ? closedLabel(i) : stageName(i.stage));
const stageChip = (i) => (i.closed ? 'chip grey' : i.stage >= 3 ? 'chip teal' : i.stage === 2 ? 'chip amber' : 'chip');
const missingToMove = (i) => state.steps.filter((s) => s.stage === i.stage && s.needed && i.status[s.id] !== 'done');
const pendingMail = (ideaId, templates) => state.outbox.find((m) => m.idea === ideaId && templates.includes(m.template) && m.status !== 'sent');
const selectedThisRound = () => state.ideas.filter((i) => i.round === state.round.id && i.review && i.review.decision === 'select').length;
const pageHead = (title, lede, right = '') => `<div class="headrow"><div><h1>${title}</h1>${lede ? `<p class="lede">${lede}</p>` : ''}</div>${right ? `<div class="actions">${right}</div>` : ''}</div>`;

function teamText(i) {
  const team = i.people && Array.isArray(i.people.team) ? i.people.team : [];
  if (!team.length) return 'the submitter';
  const n = (role) => team.filter((p) => p.role === role).length;
  const parts = [];
  if (n('lead')) parts.push(n('lead') === 1 ? 'a lead' : `${n('lead')} leads`);
  if (n('sponsor')) parts.push(n('sponsor') === 1 ? 'a sponsor' : `${n('sponsor')} sponsors`);
  if (n('member')) parts.push(plural(n('member'), 'team member'));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
}

function nextStep(i) {
  if (i.closed) return `None · ${closedLabel(i)}`;
  const missing = missingToMove(i);
  if (missing.length) return `Next: ${missing[0].text}`;
  const open = state.steps.find((s) => s.stage === i.stage && i.status[s.id] === 'open');
  if (open) return `Next: ${open.text}`;
  return i.stage < 4 ? `Ready to move to ${stageName(i.stage + 1)}` : 'All steps done';
}

function waitingChips(i) {
  const late = new Set(i.overdue.map((o) => o.step));
  const soon = Object.entries(i.due || {})
    .filter(([step]) => i.status[step] !== 'done' && !late.has(step))
    .map(([step, due]) => {
      if (step === 's2d') return `Reply due ${longDate(due)}`;
      const def = state.steps.find((x) => x.id === step);
      return `${def ? def.text : step} · due ${longDate(due)}`;
    });
  const chips = [...i.overdue.map((o) => `<span class="chip amber">${esc(o.text)}</span>`), ...soon.map((t) => `<span class="chip grey">${esc(t)}</span>`)];
  return chips.length ? `<div class="waits">${chips.join('')}</div>` : '';
}

/* ---------- Round (mockup lines 59-128) ---------- */

function fieldRow(src, [key, label], type) {
  const v = src[key] ?? '';
  return `<div class="frow">
    <label for="f-${esc(key)}">${esc(label)}<span class="hint">Used in: ${esc(USED_IN[key] || 'not used in an email yet')}</span></label>
    <input id="f-${esc(key)}" type="${type}" name="${esc(key)}" value="${esc(v)}"${type === 'text' ? ' placeholder="not set"' : ''}>
    <span class="${v ? 'chip teal' : 'chip amber'}">${v ? 'Set' : 'Not set'}</span>
  </div>`;
}

function capSelect(id, name, value) {
  const opts = [...new Set([1, 2, 3, 4, 5, 6, Number(value)])].filter((n) => n > 0).sort((a, b) => a - b);
  return `<select id="${id}" name="${name}">${opts.map((n) => `<option value="${n}"${n === Number(value) ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
}

function viewRound() {
  const { round, settings, fields } = state;
  const cap = settings.capacity;
  const used = selectedThisRound();
  const over = used > cap.ideasPerRound;
  const pending = (t) => state.outbox.some((m) => m.template === t && !m.idea && m.round === round.id && m.status !== 'sent');
  return `<section class="page">
  ${pageHead(`Round and settings · ${esc(round.id)}`, `Every idea belongs to one round. The dates and links you enter here fill every email. An email that still needs one of them cannot be approved. Saved to <span class="mono">rounds/${esc(round.id)}/round.yaml</span> and <span class="mono">rules/settings.yaml</span>.`)}
  <div class="grid2">
    <form class="card pad" data-form="round">
      <div class="card-title">Round dates</div>
      ${fields.round.map((f) => fieldRow(round, f, 'date')).join('')}
      <div class="actions"><button class="btn small primary">Save dates</button></div>
    </form>
    <form class="card pad" data-form="settings">
      <div class="card-title">Links and settings</div>
      ${fields.settings.map((f) => fieldRow(settings, f, 'text')).join('')}
      <div class="actions"><button class="btn small primary">Save links and settings</button></div>
    </form>
    <form class="card pad" data-form="capacity">
      <div class="card-title">Your capacity</div>
      <div class="frow"><label for="cap">Most ideas you can take into the design series this round</label>${capSelect('cap', 'ideasPerRound', cap.ideasPerRound)}</div>
      <div class="frow"><label for="capw">Most sessions you can run in a week</label>${capSelect('capw', 'sessionsPerWeek', cap.sessionsPerWeek)}</div>
      <div class="capline${over ? ' over' : ''}">${used} of ${esc(cap.ideasPerRound)} design-series places used this round.${over ? ' You are over your limit.' : ''}</div>
      <div class="actions"><button class="btn small primary">Save capacity</button></div>
    </form>
    <div class="card pad">
      <div class="card-title">Call for ideas</div>
      <div class="card-text">Opens the round. Both drafts go to the Outbox and need the deadline, form link and distribution list.</div>
      <div class="actions">
        <button class="btn small primary" data-action="round-draft" data-template="E0">${pending('E0') ? 'E0 drafted · see Outbox' : 'Draft the call for ideas (E0)'}</button>
        <button class="btn small" data-action="round-draft" data-template="E0B">${pending('E0B') ? 'E0B drafted · see Outbox' : 'Draft the deadline reminder (E0B)'}</button>
      </div>
    </div>
    <div class="card pad">
      <div class="frow"><div class="card-title">Status for submitters</div><button class="btn small" data-action="status-export">Write status.csv</button></div>
      <div class="card-text">Answers “was mine selected?” without you. No names, only the Café ID, title and public status, written to <span class="mono">exports/status.csv</span>. The Café page or the Copilot Studio agent can read it.</div>
    </div>
  </div>
</section>`;
}

/* ---------- Review (mockup lines 130-174) ---------- */

function reviewCard(i) {
  const r = i.review;
  const head = `<div class="review-head">
      <div><span class="mono eyebrow">${esc(i.id)} · ${esc(i.function || 'no function')}</span><div class="title">${esc(i.title)}</div></div>
      <span class="${stageChip(i)}">${esc(stageText(i))}</span>
    </div>`;
  if (i.stage < 2) {
    return `<div class="card pad">${head}
      <div class="banner warn">Move it to Review and Select first.</div>
      <div><button class="btn small" data-action="open" data-id="${esc(i.id)}">Open its checklist</button></div>
    </div>`;
  }
  const dec = r ? r.decision : Object.keys(state.decisions)[0];
  const emailOf = (k) => (/\((E\d+)\)/.exec(state.decisions[k] || '') || [])[1] || '';
  return `<form class="card pad" data-form="review" data-id="${esc(i.id)}">${head}
    ${r ? `<div class="hint">Last saved ${esc(longDate(r.at))}: ${esc(state.decisions[r.decision])}</div>` : ''}
    ${state.criteria.map((c) => {
      const on = Boolean(r && r.criteria[c.id]);
      return `<div class="crit"><button type="button" class="box${on ? ' on' : ''}" role="checkbox" aria-checked="${on}" aria-label="${esc(c.text)}" data-action="crit" data-crit="${esc(c.id)}">${on ? '✓' : ''}</button><span>${esc(c.text)}</span></div>`;
    }).join('')}
    <div class="decide">
      <select name="decision" aria-label="Decision" data-action="decision">${Object.entries(state.decisions).map(([k, v]) =>
        `<option value="${esc(k)}" data-email="${esc(emailOf(k))}"${k === dec ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>
      <input type="text" name="reason" aria-label="Reason" placeholder="Reason for the decision" required value="${esc(r ? r.reason : '')}">
      <button class="btn small primary" data-role="save">Save decision and draft ${esc(emailOf(dec))}</button>
    </div>
  </form>`;
}

function viewReview() {
  const open = state.ideas.filter((i) => !i.closed && i.stage <= 2);
  const decided = state.ideas.filter((i) => i.closed || i.stage > 2);
  const cap = state.settings.capacity.ideasPerRound;
  const body = open.length ? open.map(reviewCard).join('') : '<div class="card pad"><div class="card-text">Nothing to review. Import submissions on the Ideas tab.</div></div>';
  return `<section class="page">
  ${pageHead(`Review · ${esc(state.round.id)}`,
    `Five criteria, your decision and a reason, saved to each idea’s <span class="mono">review.md</span>. Saving drafts the decision email. ${selectedThisRound()} of ${esc(cap)} design-series places used this round.`,
    '<button class="btn primary" data-action="review-pack">Make the review pack for TTIA</button>')}
  ${body}
  ${decided.length ? `<div class="hint" style="font-size:14px">Already decided: ${decided.map((i) => `${esc(i.id)} (${esc(stageText(i))})`).join(', ')}.</div>` : ''}
</section>`;
}

/* ---------- Ideas (mockup lines 214-246) ---------- */

function viewIdeas() {
  const ideas = state.ideas;
  const counts = [1, 2, 3, 4].map((n) => ({ label: stageName(n), n: ideas.filter((i) => !i.closed && i.stage === n).length }));
  counts.push({ label: 'Closed', n: ideas.filter((i) => i.closed).length });
  const rows = ideas.map((i) => {
    const pct = i.progress.total ? Math.round((100 * i.progress.done) / i.progress.total) : 0;
    return `<tr class="row" data-action="open" data-id="${esc(i.id)}">
      <td class="mono nowrap">${esc(i.id)}</td>
      <td class="idea"><button class="linkish" data-action="open" data-id="${esc(i.id)}"><strong>${esc(i.title)}</strong></button>
        ${i.support.length ? `<div class="asked">Asked for: ${esc(i.support.join(' · '))}</div>` : ''}
        ${i.flags.length ? `<div class="chips" style="margin-top:6px">${i.flags.map((f) => `<span class="chip amber">${esc(f)}</span>`).join('')}</div>` : ''}</td>
      <td class="nowrap">${esc([i.function, i.region].filter(Boolean).join(' · ') || '—')}</td>
      <td><span class="${stageChip(i)}">${esc(stageText(i))}</span></td>
      <td style="min-width:120px"><div class="mono" style="font-size:13px">${i.progress.done} of ${i.progress.total}</div><div class="bar"><div style="width:${pct}%"></div></div></td>
      <td style="color:var(--text-2)">${esc(nextStep(i))}</td>
      <td>${waitingChips(i)}</td>
    </tr>`;
  }).join('');
  const table = ideas.length
    ? `<div class="card table-wrap"><table class="ideas-table"><thead><tr><th>ID</th><th>Idea</th><th>Function · region</th><th>Stage</th><th>Steps done</th><th>Next step</th><th>Waiting</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<div class="card pad"><div class="card-text">No ideas yet. Import an export above.</div></div>';
  const problems = state.problems.length
    ? `<div class="banner warn">Couldn't read: ${state.problems.map((p) => esc(`${p.folder}: ${p.message}`)).join('; ')}</div>` : '';
  return `<section class="page">
  <div>
    <h1>Ideas</h1>
    <p class="lede">One folder per idea under <span class="mono">ideas/</span>. Select a row to open its checklist and mark steps done.</p>
  </div>
  <div id="drop" class="drop">
    <div><div class="title">Import submissions</div><div class="sub">Drop a SharePoint or Forms export (.csv or .xlsx) here. Rows already imported are skipped.</div></div>
    <label class="filepick"><input type="file" id="file" accept=".csv,.xlsx"><span class="btn small">Choose a file</span></label>
  </div>
  ${ui.report ? `<div class="banner ok" id="report">${ui.report}</div>` : ''}
  <div class="stats">${counts.map((c) => `<div class="card stat"><div class="label">${esc(c.label)}</div><div class="n">${c.n}</div></div>`).join('')}</div>
  ${table}
  ${problems}
</section>`;
}

/* ---------- Checklist (mockup lines 248-298) ---------- */

function stepRow(i, s) {
  const st = i.status[s.id];
  const t = i.checklist[s.id];
  const done = st === 'done';
  const code = s.email === 'decision' ? 'E3–E6' : s.email;
  const mail = s.email ? pendingMail(i.id, s.email === 'decision' ? DECISION_TEMPLATES : [s.email]) : null;
  const side = [];
  if (!done && mail) {
    side.push(`<span class="${mail.status === 'draft' ? 'chip amber' : 'chip teal'}">${esc(mail.template)} ${mail.status === 'draft' ? 'in Outbox · draft' : 'approved · send it'}</span>`);
  } else if (!done && s.email && /^E\d+$/.test(s.email)) {
    side.push(`<button class="btn small" data-action="draft" data-template="${esc(s.email)}">Draft ${esc(s.email)}</button>`);
  }
  if (s.id === 's2d' && i.offerE2R) side.push('<button class="btn small" data-action="draft" data-template="E2R">No reply for 5+ days · draft reminder (E2R)</button>');
  const who = t && t.done ? `${t.by === 'app' ? 'Ticked by the app' : 'Ticked by you'}, ${longDate(t.at)}${t.source ? ` · ${t.source}` : ''}` : '';
  return `<div class="step${done ? ' done' : ''}">
    <button class="box${done ? ' on' : ''}" role="checkbox" aria-checked="${done}" aria-label="${esc(s.text)}" data-action="tick" data-step="${esc(s.id)}" data-done="${done}">${done ? '✓' : ''}</button>
    <div class="body">
      <div class="text">${esc(s.text)}${code ? ` (${esc(code)})` : ''}</div>
      <div class="meta"><span class="${s.owner === 'Team' ? 'chip' : 'chip teal'}">${esc(s.owner)}</span>${s.needed ? '<span class="chip grey">Needed to move on</span>' : ''}${code && !done ? `<span class="hint">Ticks itself when ${esc(s.email === 'decision' ? 'the decision email' : code)} is marked as sent</span>` : ''}</div>
      ${who ? `<div class="hint">${esc(who)}</div>` : ''}
    </div>
    ${side.length ? `<div class="side">${side.join('')}</div>` : ''}
  </div>`;
}

function viewChecklist() {
  const i = current();
  if (!i) return '<section class="page"><h1>Checklist</h1><div class="card pad"><div class="card-text">No ideas yet. Import submissions on the Ideas tab.</div></div></section>';
  const picker = `<select class="picker" data-action="pick" aria-label="Idea">${state.ideas.map((x) =>
    `<option value="${esc(x.id)}"${x.id === i.id ? ' selected' : ''}>${esc(x.id)} ${esc(x.title)}</option>`).join('')}</select>`;
  const missing = missingToMove(i);
  const canMove = !i.closed && i.stage < 4;
  const move = canMove && !missing.length ? `<button class="btn primary" data-action="advance">Move to ${esc(stageName(i.stage + 1))}</button>` : '';
  const blocked = canMove && missing.length
    ? `<div class="banner warn">Before it can move to ${esc(stageName(i.stage + 1))}: ${missing.map((s) => esc(s.text)).join(' · ')}</div>` : '';
  const stageSteps = (n) => state.steps.filter((s) => s.stage === n);
  const na = (n) => Boolean(i.closed) && n > i.stage;
  const stepper = [1, 2, 3, 4].map((n) => {
    const cls = na(n) ? 'na' : (n < i.stage || i.closed) ? 'passed' : n === i.stage ? 'now' : '';
    const label = na(n) ? 'Not applicable' : cls === 'passed' ? 'Passed' : cls === 'now' ? 'Current stage' : 'Upcoming';
    const list = stageSteps(n);
    const d = list.filter((s) => i.status[s.id] === 'done').length;
    return `<div class="stage-cell ${cls}"><div class="state">${label}</div><div class="name">${esc(stageName(n))}</div><div class="mono count">${na(n) ? '—' : `${d} of ${list.length} done`}</div></div>`;
  }).join('');
  const groups = [1, 2, 3, 4].map((n) => {
    const list = stageSteps(n);
    const d = list.filter((s) => i.status[s.id] === 'done').length;
    return `<div class="card group${n === i.stage && !i.closed ? ' current' : ''}">
      <div class="group-head"><div class="card-title">${n} · ${esc(stageName(n))}</div><span class="mono count">${na(n) ? 'Not applicable' : `${d} of ${list.length}`}</span></div>
      ${na(n) ? '<div class="card-text" style="color:var(--muted-2)">Closed before this stage.</div>' : list.map((s) => stepRow(i, s)).join('')}
    </div>`;
  }).join('');
  const chips = (arr, cls) => (arr.length ? `<div class="chips">${arr.map((t) => `<span class="${cls}">${esc(t)}</span>`).join('')}</div>` : '<div class="val">—</div>');
  const dir = `${i.id}-${i.slug}`;
  return `<section class="page">
  <div class="headrow">
    <div>
      <div class="mono eyebrow">${esc([i.id, i.function, i.region].filter(Boolean).join(' · '))}</div>
      <h1 style="margin-top:2px">Checklist · ${esc(i.title)}</h1>
      <p class="lede" style="margin-top:6px;max-width:780px">Tick each step as it happens. Steps with an email tick themselves when you mark that email as sent in the Outbox. Saved to <span class="mono">ideas/${esc(dir)}/idea.yaml</span>, with each tick logged in <span class="mono">history.log</span>.</p>
    </div>
    <div class="actions"><span class="${stageChip(i)}">${esc(stageText(i))}</span>${picker}${move}</div>
  </div>
  <div class="card summary">
    <div class="item"><div class="field-label">Business challenge</div><div class="val">${esc(i.challenge || '—')}</div></div>
    <div class="item"><div class="field-label">Current process</div><div class="val">${esc(i.current_process || '—')}</div></div>
    <div class="col">
      <div class="item"><div class="field-label">Desired outcomes</div>${chips(i.outcomes, 'chip')}</div>
      <div class="item"><div class="field-label">Support requested</div>${chips(i.support, 'chip teal')}</div>
      <div class="item"><div class="field-label">Team · tried it already</div><div class="val">${esc(i.participation || 'Participation not given')}: ${esc(teamText(i))} · Experimented: ${esc(i.experimented || 'not given')}</div></div>
    </div>
  </div>
  ${blocked}
  <div class="stepper">${stepper}</div>
  <div class="grid-steps">${groups}</div>
</section>`;
}

/* ---------- Outbox (mockup lines 545-569) ---------- */

function mailCard(m) {
  const left = m.contentPlaceholders.length;
  const blocked = m.status === 'draft' && m.missingSettings.length;
  const status = m.status === 'draft' ? ['chip amber', 'Draft · awaiting you']
    : m.status === 'approved' ? ['chip teal', 'Approved · copied for Outlook'] : ['chip grey', `Sent ${longDate(m.sentAt)}`];
  let buttons = '';
  let note = '';
  if (m.status === 'draft') {
    buttons = `<button class="btn small primary" data-action="approve" data-key="${esc(m.key)}">${blocked ? `Set first: ${esc(m.missingSettings.map((x) => x.label).join(', '))}` : 'Approve and copy'}</button>`;
    note = blocked ? 'Opens Round and settings' : left ? `${plural(left, 'placeholder')} to fill in Outlook` : '';
  } else if (m.status === 'approved') {
    buttons = `<button class="btn small primary" data-action="sent" data-key="${esc(m.key)}">Mark as sent</button><button class="btn small" data-action="copy" data-key="${esc(m.key)}">Copy again</button>`;
    note = left ? `${plural(left, 'placeholder')} to fill in Outlook` : '';
  }
  const title = TEMPLATE_TITLES[m.template];
  return `<div class="card mail" data-status="${esc(m.status)}">
    <div class="main">
      <div class="actions"><span class="chip grey">${esc(m.template)}${title ? ` · ${esc(title)}` : ''}</span><span class="mono eyebrow">${esc(m.idea || m.round)}</span></div>
      <div class="subject">${esc(m.view.subject)}</div>
      <div class="to">To: ${esc(m.view.to)}</div>
      <div class="text">${esc(m.view.body)}</div>
    </div>
    <div class="side"><span class="${status[0]}">${esc(status[1])}</span>${buttons}${note ? `<span class="hint">${esc(note)}</span>` : ''}</div>
  </div>`;
}

function viewOutbox() {
  const bad = (state.outboxProblems || []).length
    ? `<div class="banner warn">Couldn't read: ${state.outboxProblems.map((p) => esc(`${p.file}: ${p.message}`)).join('; ')}</div>` : '';
  const list = state.outbox.length ? state.outbox.map(mailCard).join('') : '<div class="card pad"><div class="card-text">Nothing in the Outbox yet.</div></div>';
  return `<section class="page">
  ${pageHead('Outbox', 'Every draft waits here. Nothing reaches a colleague until you approve it and send it from Outlook.')}
  ${bad}
  <div class="page" style="gap:12px">${list}</div>
</section>`;
}

/* ---------- Not built yet ---------- */

function viewLater(t) {
  return `<section class="page"><div class="card later">
    <div class="card-title">${esc(t.label)} comes in plan ${t.plan}</div>
    <div class="card-text">${esc(t.what)}</div>
  </div></section>`;
}

function render() {
  const open = state.outbox.filter((m) => m.status !== 'sent').length;
  const toReview = state.ideas.filter((i) => !i.closed && i.stage === 2 && (!i.review || i.review.decision === 'ask')).length;
  const sel = current();
  const label = (t) => {
    if (t.key === 'review') return `Review (${toReview})`;
    if (t.key === 'ideas') return `Ideas (${state.ideas.length})`;
    if (t.key === 'checklist') return sel ? `Checklist · ${sel.id.slice(-3)}` : 'Checklist';
    if (t.key === 'outbox') return `Outbox (${open})`;
    return t.label;
  };
  $('#tabs').innerHTML = TABS.map((t) =>
    `<button class="tab${ui.tab === t.key ? ' on' : ''}" data-action="tab" data-tab="${t.key}"${ui.tab === t.key ? ' aria-current="page"' : ''}${t.plan ? ` aria-disabled="true" title="Comes in plan ${t.plan}"` : ''}>${esc(label(t))}</button>`).join('');
  $('#sub').textContent = `CS TTIA · ${state.round.id}`;
  $('#today').textContent = `Today: ${longDate(state.today)}`;
  showNotice(ui.notice, ui.noticeKind);
  const views = { round: viewRound, ideas: viewIdeas, checklist: viewChecklist, review: viewReview, outbox: viewOutbox };
  const tab = TABS.find((t) => t.key === ui.tab);
  $('#main').innerHTML = tab && tab.plan ? viewLater(tab) : (views[ui.tab] || viewIdeas)();
}

async function upload(file) {
  if (!file) return;
  try {
    const res = await fetch('/api/import', { method: 'POST', headers: { 'x-filename': file.name, 'content-type': 'application/octet-stream' }, body: file });
    const r = await res.json();
    if (!res.ok) throw new Error(r.error);
    const errors = r.errors.length ? `, ${plural(r.errors.length, 'row')} not read (${r.errors.map((e) => `row ${e.row}: ${esc(e.message)}`).join('; ')})` : '';
    ui.report = `<p>Imported ${r.created.length} new, skipped ${r.duplicates.length} already imported${errors}.</p>`
      + (r.duplicates.length ? `<p>Already imported: ${r.duplicates.map((d) => `row ${d.row} is ${esc(d.id)}`).join('; ')}.</p>` : '')
      + (r.ignoredColumns.length ? `<p>Columns not used: ${r.ignoredColumns.map(esc).join(', ')}.</p>` : '')
      + (r.flags.length ? `<ul>${r.flags.map((f) => `<li>${esc(f.id)}: ${esc(f.message)}</li>`).join('')}</ul>` : '');
    ui.notice = '';
  } catch (e) {
    ui.notice = e.message;
    ui.noticeKind = 'warn';
  }
  await safeRefresh();
}

function toggleBox(b) {
  const on = !b.classList.contains('on');
  b.classList.toggle('on', on);
  b.setAttribute('aria-checked', String(on));
  b.textContent = on ? '✓' : '';
}

document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-action]');
  if (!b || b.matches('input, select')) return;
  const outboxItem = () => state.outbox.find((x) => x.key === b.dataset.key);
  switch (b.dataset.action) {
    case 'tab': setTab(b.dataset.tab); ui.notice = ''; render(); break;
    case 'open': ui.sel = b.dataset.id; setTab('checklist'); ui.notice = ''; render(); break;
    case 'crit': toggleBox(b); break;
    case 'tick': act(() => api(ideaUrl(ui.sel, 'tick'), { step: b.dataset.step, done: b.dataset.done !== 'true' })); break;
    case 'draft': act(() => api(ideaUrl(ui.sel, 'draft'), { template: b.dataset.template }), (r) => `${r.template} is drafted in the Outbox.`); break;
    case 'round-draft': act(() => api('/api/round/draft', { template: b.dataset.template }), (r) => `${r.template} is drafted in the Outbox.`); break;
    case 'advance': act(() => api(ideaUrl(ui.sel, 'advance'), {}), (r) => `${r.id} moved to ${stageName(r.stage)}.`); break;
    case 'status-export': act(() => api('/api/status-export', {}), (r) => `Written: ${r.file}`); break;
    case 'review-pack': act(() => api('/api/review-pack', {}), (r) => `Written: ${r.file}`); break;
    case 'approve': {
      const m = outboxItem();
      if (!m) break;
      if (m.missingSettings.length) {
        setTab('round');
        ui.notice = `Set first: ${m.missingSettings.map((x) => x.label).join(', ')}`;
        ui.noticeKind = 'warn';
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
      copyText(m.view).then((ok) => {
        ui.notice = ok ? 'Copied.' : "Copy didn't work here. Select the text and copy it.";
        ui.noticeKind = ok ? 'ok' : 'warn';
        render();
      });
      break;
    }
    case 'sent': act(() => api('/api/outbox/sent', { key: b.dataset.key }), () => 'Marked as sent. The matching step is ticked.'); break;
  }
});

document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.matches('[data-action="pick"]')) { ui.sel = t.value; render(); }
  else if (t.matches('[data-action="decision"]')) {
    const save = t.form && t.form.querySelector('[data-role="save"]');
    if (save) save.textContent = `Save decision and draft ${t.selectedOptions[0].dataset.email || ''}`.trim();
  } else if (t.id === 'file') upload(t.files[0]);
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
    act(() => api('/api/settings', body), () => 'Settings saved.');
  } else if (form.dataset.form === 'capacity') {
    const capacity = { ideasPerRound: Number(fd.get('ideasPerRound')), sessionsPerWeek: Number(fd.get('sessionsPerWeek')) };
    act(() => api('/api/settings', { capacity }), () => 'Capacity saved.');
  } else if (form.dataset.form === 'review') {
    const id = form.dataset.id;
    const criteria = Object.fromEntries(state.criteria.map((c) => {
      const box = form.querySelector(`[data-crit="${CSS.escape(c.id)}"]`);
      return [c.id, Boolean(box && box.classList.contains('on'))];
    }));
    act(() => api(ideaUrl(id, 'review'), { criteria, decision: fd.get('decision'), reason: fd.get('reason') }),
      (r) => `Saved. ${r.email.template} is drafted in the Outbox.${r.handoff ? ` CSIC handoff written: ${r.handoff}.` : ''}${r.warnings.length ? ` ${r.warnings.join(' ')}` : ''}`);
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
