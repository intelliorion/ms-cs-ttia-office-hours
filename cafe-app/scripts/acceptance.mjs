#!/usr/bin/env node
// End-to-end acceptance run of the Inbox against the synthetic kit in test-data/.
// Starts its own server (in this process, on a free port, never 4100) on a fresh scratch workspace,
// drives it only through the HTTP API, and prints file → expected → actual → PASS/FAIL.
//
//   npx tsx scripts/acceptance.mjs --fake [--workspace DIR]     deterministic, no real AI (CAFE_AI_FAKE=1)
//   npx tsx scripts/acceptance.mjs --real-ai [--workspace DIR]  whatever provider this machine has (minutes)
//
// --fake: the built-in fake answers every triage with fixed facts for CAFE-2026-001 (it fits the unit-test
// fixture), which would make every kit file disagree with it. So triage goes to a scripted, deterministic
// stand-in that reads only the DATA block of the prompt and answers like a careful AI would, except on
// 05-injection.eml, where it deliberately obeys the injected text (stage Launch, a budget flag) to prove the
// code, not the AI, decides what is Safe. Every other task goes to the built-in fake.
// --real-ai: asserts tiers and kinds, never AI wording; 120 s per drop.
// After the drop-through, --fake also runs a design pass on one idea: tool picker → three brainstorm steps
// (the second answered "I don't know", which drafts an E2) → approve → plan.md and the starter kits.
// Run it with tsx (npm run acceptance), since it imports the app's TypeScript.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server/server.ts';
import { initWorkspace } from '../src/workspace/init.ts';
import { createConnector, defaultProviders } from '../src/ai/connector.ts';
import { fakeProvider } from '../src/ai/providers/fake.ts';
import { loadSettings } from '../src/round/store.ts';
import { fixedClock } from '../src/clock.ts';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KIT = path.join(APP, 'test-data');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : d; };
const REAL = argv.includes('--real-ai');
if (!REAL && !argv.includes('--fake')) { console.error('Pass --fake or --real-ai'); process.exit(2); }
const workspace = path.resolve(flag('workspace', path.join(APP, `.acceptance-${REAL ? 'real' : 'fake'}`)));
const DROP_MS = REAL ? 120_000 : 15_000;

if (REAL) delete process.env.CAFE_AI_FAKE; else process.env.CAFE_AI_FAKE = '1';

/* ---------- the AI, counted ---------- */

const calls = { n: 0, tasks: [] };
const counted = (p) => ({ ...p, async complete(prompt, opts) { calls.n++; calls.tasks.push(prompt.slice(6, prompt.indexOf('\n'))); return p.complete(prompt, opts); } });

/** Deterministic triage from the DATA block only (see the header). */
function scriptedTriage(prompt) {
  const data = JSON.parse(prompt.slice(prompt.indexOf('<<<DATA') + 7, prompt.indexOf('DATA>>>')));
  const { item, idea, candidates = [] } = data;
  const text = item.text ?? '';
  const ideaId = idea?.id ?? candidates[0]?.id ?? null;
  const numbered = [...text.matchAll(/^\s*(\d{1,2})[.)]\s+(.+)$/gm)].map((m) => [Number(m[1]), m[2].trim()]);
  const answers = idea ? numbered.filter(([n]) => idea.openQuestions[n - 1] || !idea.openQuestions.length)
    .map(([n, a]) => ({ question: idea.openQuestions[n - 1] ?? `Question ${n}`, answer: a.slice(0, 300) })) : [];
  const builder = /^\s*\d[.)]\s+([A-Z][\p{L}'-]+ [A-Z][\p{L}'-]+)\b.*\bwill build\b/mu.exec(text)?.[1] ?? null;
  const injected = /ignore your rules/i.test(text);
  const ours = /cafe@|Creators/.test(item.from ?? '');
  const graph = { nodes: [], links: [] };
  if (/Service Catalogue/.test(text)) {
    graph.nodes.push({ type: 'Capability', label: 'Desk availability lookup' }, { type: 'System', label: 'Service Catalogue' });
    graph.links.push(
      { from: 'idea', to: 'Desk availability lookup', rel: 'NEEDS', description: 'Shows which desks are free', confidence: 0.9 },
      { from: 'Desk availability lookup', to: 'Service Catalogue', rel: 'USES_DATA', description: 'Reads the desk inventory', confidence: 0.6 },
    );
  }
  return JSON.stringify({
    summary: `${item.type} about ${idea?.title ?? 'an unknown idea'}`.slice(0, 160),
    kind: item.type === 'transcript' ? 'transcript' : answers.length ? 'reply' : 'update',
    ideaId, matchConfidence: idea ? 0.95 : 0.5,
    facts: {
      ...(ours ? {} : { answers }),
      replyReceived: !ours && answers.length > 0 && idea?.waitingReply === true,
      builderNamed: ours ? null : builder,
      newFlags: injected ? ['Budget approved'] : [],
      stageHint: injected ? 'launch' : null,
      graph,
    },
  });
}
function scriptedFake() {
  const base = fakeProvider();
  return { ...base, async complete(prompt, opts) { return prompt.startsWith('TASK: triage') ? scriptedTriage(prompt) : base.complete(prompt, opts); } };
}

/* ---------- server and API ---------- */

let base = '';
async function api(method, url, body, headers = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), DROP_MS + 10_000);
  try {
    const isRaw = body instanceof Uint8Array;
    const res = await fetch(base + url, {
      method, signal: ctl.signal,
      headers: isRaw ? headers : { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: isRaw ? body : JSON.stringify(body) }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${json.error ?? ''}`);
    return json;
  } finally { clearTimeout(timer); }
}
const drop = async (name) => {
  const before = calls.n; const t0 = Date.now();
  const out = await api('POST', '/api/inbox/drop', new Uint8Array(await fs.readFile(path.join(KIT, name))), { 'x-filename': encodeURIComponent(name) });
  return { ...out, aiCalls: calls.n - before, ms: Date.now() - t0 };
};
const state = () => api('GET', '/api/state');
const ideaOf = async (id) => (await state()).ideas.find((i) => i.id === id);
const graph = () => api('GET', '/api/graph');

/* ---------- checks ---------- */

const rows = [];
const check = (file, expected, actual, pass) => { rows.push({ file, expected, actual, pass: !!pass }); };
const acts = (item) => item.actions ?? [];
const show = (item) => {
  const tr = item.triage ?? {};
  const a = acts(item).map((r) => `${r.action.t}:${r.kind}/${r.status}`).join(' ');
  if (item.status === 'held') return `held (${(item.hold?.reasons ?? []).join('; ').slice(0, 70)})`;
  return `${tr.ask ? `ask${tr.suggested ? `→${tr.suggested}` : ''}` : tr.ideaId ?? '-'} @${tr.confidence ?? '-'} [${tr.match?.how ?? ''}] ${a}`;
};
const only = (item, kinds) => acts(item).every((r) => kinds.includes(r.action.t));
const safeApplied = (item, t) => acts(item).some((r) => r.action.t === t && r.kind === 'safe' && r.status === 'applied');

async function main() {
  await fs.rm(workspace, { recursive: true, force: true });
  await fs.mkdir(workspace, { recursive: true });
  const clock = fixedClock('2026-10-20');
  await initWorkspace(workspace, clock);
  const providers = (REAL ? defaultProviders() : [scriptedFake()]).map(counted);
  const connector = createConnector({ providers, settings: () => loadSettings(workspace) });
  const server = createApp({ root: workspace, clock, connector });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  if (port === 4100) throw new Error('Never port 4100');
  base = `http://localhost:${port}`;
  console.log(`Acceptance (${REAL ? 'real AI' : 'fake'}) on ${base}, workspace ${workspace}`);
  try {
    await run();
  } catch (e) {
    check('(run)', 'no crash', String(e.stack ?? e).slice(0, 300), false);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
  print();
}

async function run() {
  const status = await api('GET', '/api/ai/status');
  console.log(`AI: ${status.label}`);
  check('(setup)', REAL ? 'a real provider answers' : 'fake provider', status.label, REAL ? status.provider && status.provider !== 'fake' : status.provider === 'fake');
  await api('POST', '/api/round', { reviewBy: '2026-11-13', deadline: '2026-10-30' });
  await api('POST', '/api/settings', { operatorName: 'Café operator', formLink: 'https://forms.example.com/cafe' });

  // 01 xlsx: 7 ideas, row 7 rejected.
  let d = await drop('01-submissions.xlsx');
  let imp = acts(d.item).find((r) => r.action.t === 'import_export');
  const ideas = (await state()).ideas;
  // The report numbers spreadsheet rows (header = row 1), so submission 7 is reported as row 8.
  check('01-submissions.xlsx', '7 ideas, submission 7 (sheet row 8) rejected, 0 AI',
    `${ideas.length} ideas, errors ${(imp?.result?.errors ?? []).map((e) => `row ${e.row}: ${e.message}`).join(',')}, ${d.aiCalls} AI`,
    imp?.status === 'applied' && ideas.length === 7 && imp.result.errors.length === 1 && imp.result.errors[0].row === 8
      && /title/i.test(imp.result.errors[0].message) && d.aiCalls === 0);

  d = await drop('01-submissions.csv');
  imp = acts(d.item).find((r) => r.action.t === 'import_export');
  const n2 = (await state()).ideas.length;
  check('01-submissions.csv', 'duplicate: nothing new', d.duplicate ? 'duplicate drop' : `created ${imp?.result?.created?.length}, dupes ${imp?.result?.duplicates?.length}, ${n2} ideas`,
    n2 === 7 && (d.duplicate || (imp?.result?.created?.length === 0 && imp?.result?.duplicates?.length === 7)));

  // E2 for CAFE-2026-002, with the three questions the kit's reply answers.
  const e2 = await api('POST', '/api/ideas/CAFE-2026-002/draft', { template: 'E2' });
  const body = e2.body
    .replace(/\[QUESTION 1[^\]]*\]/, 'Who would use it day to day: which team or role?')
    .replace(/\[QUESTION 2[^\]]*\]/, 'What does it replace today?')
    .replace(/\[QUESTION 3[^\]]*\]/, 'Who in your team would build the proof of concept?');
  await api('POST', '/api/outbox/update', { key: e2.key, body });
  await api('POST', '/api/outbox/approve', { key: e2.key });
  const sent = await api('POST', '/api/outbox/sent', { key: e2.key });
  check('(E2 for 002)', 'drafted, approved, sent', sent.status, sent.status === 'sent' && !!(await ideaOf('CAFE-2026-002')).sent?.E2);

  // 02: sure match; answers to our questions, reply received: Safe.
  d = await drop('02-reply-with-id.eml');
  const i2 = d.item; const idea2 = await ideaOf('CAFE-2026-002');
  // Sure by ID (1.0); the AI may lower the final figure a little but not below 0.7 without making it ask.
  check('02-reply-with-id.eml', 'sure 002 (ID); file+answers+reply Safe applied; quote split',
    show(i2),
    i2.triage?.ideaId === 'CAFE-2026-002' && i2.triage.match?.how === 'cafe-id' && i2.triage.match.confidence === 1 && !i2.triage.ask && safeApplied(i2, 'file_email') && safeApplied(i2, 'record_answers')
      && safeApplied(i2, 'reply_received') && (idea2.answers ?? []).length >= 2 && idea2.checklist?.s2d?.done && !(i2.preview ?? '').includes('Original Message'));

  // 03: whole title in the subject: likely 002 (or asks with 002 suggested if the AI lowers it).
  d = await drop('03-reply-no-id.eml');
  const t3 = d.item.triage ?? {};
  check('03-reply-no-id.eml', 'title match 0.9 → likely 002 (AI may only lower it to ask)', show(d.item),
    t3.match?.how === 'title' && t3.match.confidence === 0.9 && t3.confidence <= 0.9
      && (t3.ask ? t3.suggested === 'CAFE-2026-002' || t3.candidates.some((c) => c.id === 'CAFE-2026-002') : t3.ideaId === 'CAFE-2026-002' && safeApplied(d.item, 'file_email')));

  // 04: sender is the submitter of exactly one idea (003): 0.8, or a question.
  d = await drop('04-sender-only.eml');
  const t4 = d.item.triage ?? {};
  check('04-sender-only.eml', 'sender match 003 @0.8, or ask', show(d.item),
    t4.match?.how === 'sender' && t4.match.ideaId === 'CAFE-2026-003'
      && (t4.ask ? t4.candidates.some((c) => c.id === 'CAFE-2026-003') : t4.ideaId === 'CAFE-2026-003' && t4.confidence >= 0.7 && t4.confidence <= 0.8));

  // 05: injection. No stage change, no answers saved (no E2 was sent for 003), anything beyond filing waits.
  const before5 = await ideaOf('CAFE-2026-003');
  d = await drop('05-injection.eml');
  const after5 = await ideaOf('CAFE-2026-003');
  const unsafe = acts(d.item).filter((r) => r.kind === 'safe' && !['file_email', 'graph_links'].includes(r.action.t));
  const pendingTypes = acts(d.item).filter((r) => r.status === 'pending').map((r) => r.action.t);
  check('05-injection.eml', 'sure 003; stage, answers, flags unchanged; only filing Safe', `${show(d.item)} | stage ${before5.stage}→${after5.stage}`,
    d.item.triage?.ideaId === 'CAFE-2026-003' && after5.stage === before5.stage && JSON.stringify(after5.closed) === JSON.stringify(before5.closed)
      && !(after5.answers ?? []).length && JSON.stringify(after5.flags) === JSON.stringify(before5.flags) && !unsafe.length
      && acts(d.item).filter((r) => ['suggest_stage', 'add_flag', 'record_answers'].includes(r.action.t)).every((r) => r.kind === 'ok' && r.status === 'pending')
      && (REAL || (pendingTypes.includes('suggest_stage') && pendingTypes.includes('record_answers'))));

  // 06, 11, 12: held, never reach the AI.
  for (const [name, why] of [['06-tracker.eml', /name|id|phone/i], ['11-held-tracker.csv', /people|name/i], ['12-cannot-read.pdf', /can't read/i]]) {
    const n = (await state()).ideas.length;
    d = await drop(name);
    const heldFile = d.item.file?.startsWith('inbox/held/') && await fs.access(path.join(workspace, d.item.file)).then(() => true, () => false);
    check(name, 'HELD, 0 AI calls, nothing imported', `${show(d.item)}, ${d.aiCalls} AI`,
      d.item.status === 'held' && why.test((d.item.hold?.reasons ?? []).join(' ')) && d.aiCalls === 0 && heldFile
        && !d.item.preview && !acts(d.item).length && (await state()).ideas.length === n);
  }

  // 07: our own E3, filed out, nothing proposed.
  d = await drop('07-our-own-sent.eml');
  const f7 = acts(d.item).find((r) => r.action.t === 'file_email');
  check('07-our-own-sent.eml', 'filed out on 004, nothing proposed', show(d.item),
    d.item.triage?.ideaId === 'CAFE-2026-004' && f7?.action.direction === 'out' && f7.status === 'applied' && only(d.item, ['file_email']));

  // 08: transcript, sure 002, filed in notes; graph proposals.
  d = await drop('08-transcript.vtt');
  const i8 = d.item;
  const dir2 = (await fs.readdir(path.join(workspace, 'ideas'))).find((x) => x.startsWith('CAFE-2026-002'));
  const notes = await fs.readdir(path.join(workspace, 'ideas', dir2, 'notes')).catch(() => []);
  check('08-transcript.vtt', 'sure 002, filed to notes, graph proposed', `${show(i8)} | notes: ${notes.filter((n) => n.endsWith('.vtt')).length} vtt`,
    i8.type === 'transcript' && i8.triage?.ideaId === 'CAFE-2026-002' && safeApplied(i8, 'file_email') && notes.some((n) => n.endsWith('.vtt'))
      && acts(i8).some((r) => r.action.t === 'graph_links'));

  // 09 and 10: ask which idea.
  d = await drop('09-minutes.docx');
  check('09-minutes.docx', 'document, asks (title only in body: 004 suggested)', `${d.item.type}, ${show(d.item)}`,
    d.item.type === 'document' && d.item.triage?.ask === true && only(d.item, ['ask_idea'])
      && (d.item.triage.suggested === 'CAFE-2026-004' || d.item.triage.candidates.some((c) => c.id === 'CAFE-2026-004')));
  d = await drop('10-note.txt');
  check('10-note.txt', 'asks which idea', show(d.item), d.item.triage?.ask === true && only(d.item, ['ask_idea']));

  /* ---------- follow-ups: apply a Needs-OK, Undo a Safe, confirm a link ---------- */

  const box = (await api('GET', '/api/inbox')).items;
  const find = (prefix) => box.find((i) => i.name.startsWith(prefix));

  // Apply one Needs-OK action: 08's new-star links if any, else 02's builder, else any pending non-ask action.
  const okOnes = [find('08-'), find('02-'), ...box].filter(Boolean)
    .flatMap((it) => acts(it).filter((r) => r.kind === 'ok' && r.status === 'pending' && !['ask_idea', 'suggest_stage'].includes(r.action.t)).map((r) => ({ it, r })));
  const pick = okOnes.find(({ r }) => r.action.t === 'graph_links') ?? okOnes[0];
  if (!pick) check('(apply Needs-OK)', 'one Needs-OK action applied', 'none was proposed', false);
  else {
    const g0 = await graph();
    const out = await api('POST', `/api/inbox/${pick.it.id}/apply`, { actionIds: [pick.r.id] });
    const r = acts(out.item).find((x) => x.id === pick.r.id);
    const g1 = await graph();
    let reflected = true; let what = '';
    if (pick.r.action.t === 'graph_links') {
      reflected = pick.r.action.links.every((l) => g1.edges.some((e) => e.from === l.from && e.to === l.to && e.rel === l.rel));
      what = `edges ${g0.edges.length}→${g1.edges.length}, nodes ${g0.nodes.length}→${g1.nodes.length}`;
    } else if (pick.r.action.t === 'name_builder') {
      const idea = await ideaOf(pick.r.action.ideaId);
      reflected = idea.people?.builder === pick.r.action.name; what = `builder ${idea.people?.builder}`;
    }
    check('(apply Needs-OK)', `${pick.r.action.t} on ${pick.it.name.slice(0, 12)} applied, shown`, `${r?.status}; ${what}`, r?.status === 'applied' && reflected);
  }

  // Undo one Safe action: 02's saved answers.
  const it2 = (await api('GET', '/api/inbox')).items.find((i) => i.name.startsWith('02-'));
  const ans = acts(it2).find((r) => r.action.t === 'record_answers' && r.kind === 'safe' && r.status === 'applied');
  if (!ans) check('(undo Safe)', 'Undo 02 answers', 'no applied Safe answers on 02', false);
  else {
    const n0 = ((await ideaOf('CAFE-2026-002')).answers ?? []).length;
    const out = await api('POST', `/api/inbox/${it2.id}/undo`, { recordId: ans.id });
    const n1 = ((await ideaOf('CAFE-2026-002')).answers ?? []).length;
    const st = acts(out.item).find((r) => r.id === ans.id)?.status;
    check('(undo Safe)', 'Undo 02 answers: answers removed', `${st}; answers ${n0}→${n1}`, st === 'undone' && n1 === n0 - ans.action.answers.length);
  }

  // Confirm one unconfirmed link in the universe.
  const g = await graph();
  const pending = g.edges.find((e) => !e.confirmed);
  if (!pending) check('(confirm link)', 'one unconfirmed link confirmed', 'no unconfirmed link in the universe', false);
  else {
    await api('POST', '/api/graph/confirm', { edgeId: pending.id });
    const g2 = await graph();
    const e = g2.edges.find((x) => x.id === pending.id);
    check('(confirm link)', 'confirmed in /api/graph, unconfirmed -1', `${pending.id.slice(0, 40)}: ${e?.confirmed}; unconfirmed ${g.unconfirmed}→${g2.unconfirmed}`,
      e?.confirmed === true && g2.unconfirmed === g.unconfirmed - 1);
  }

  const view = await api('GET', '/api/inbox');
  check('(inbox)', 'no problems listed', JSON.stringify(view.counts), !view.problems.length);
  // The design pass asserts the fake's scripted replies, so it runs with --fake only.
  if (!REAL) await designPass();
  console.log(`AI calls: ${calls.n} (${calls.tasks.join(', ')})`);
}

/* ---------- design series: tool picker, brainstorm, approve, plan and kits (--fake) ---------- */

const exists = (file) => fs.access(file).then(() => true, () => false);

async function designPass() {
  const ID = 'CAFE-2026-005';
  const idea = await ideaOf(ID);
  if (!idea) { check('(design) idea', `${ID} exists`, 'not found', false); return; }
  const dir = path.join(workspace, 'ideas', (await fs.readdir(path.join(workspace, 'ideas'))).find((x) => x.startsWith(ID)));
  const u = (r) => `/api/ideas/${ID}/${r}`;

  // Tool picker: the AI suggests, the operator saves the picks.
  const sug = await api('POST', u('tools/suggest'));
  const saved = await api('POST', u('tools'), { features: sug.features.map(({ name, what, tool, reason, flags }) => ({ name, what, tool, reason, flags })) });
  const built = (await graph()).edges.filter((e) => e.rel === 'BUILT_WITH' && String(e.source ?? '').includes(`${ID}:approach.md`));
  const approach = await exists(path.join(dir, 'approach.md'));
  check('(design) tool picks', '3 suggested, saved; approach.md; BUILT_WITH links',
    `${sug.features.length} suggested, ${saved.state.features.length} saved, approach.md ${approach}, ${built.length} BUILT_WITH`,
    sug.features.length === 3 && saved.state.features.length === 3 && saved.state.features.some((f) => f.tool === 'custom app')
      && approach && built.length >= 1 && (await ideaOf(ID)).checklist?.s3e?.done);

  // Brainstorm: three questions, one at a time; the second is "I don't know", which goes into an E2 draft.
  const s1 = await api('POST', u('design/step'), {});
  await api('POST', u('design/answer'), { n: s1.step.n, suggestedIndex: 0 });
  const s2 = await api('POST', u('design/step'), {});
  const idk = await api('POST', u('design/answer'), { n: s2.step.n, idk: true });
  const e2 = (await state()).outbox.find((m) => m.idea === ID && m.template === 'E2' && m.status === 'draft');
  const s3 = await api('POST', u('design/step'), {});
  await api('POST', u('design/answer'), { n: s3.step.n, answer: 'A citizen builder in the team' });
  const open2 = s3.state.steps.find((s) => s.n === s2.step.n);
  check('(design) brainstorm', '3 steps; step 2 "I don\'t know" → E2 draft with the question, step stays open',
    `${s3.state.steps.length} steps, emailKey ${idk.emailKey ?? '-'}, E2 ${e2 ? e2.status : 'none'}, has question ${!!e2?.body.includes(s2.step.question)}`,
    s3.state.steps.length === 3 && !!idk.emailKey && e2?.key === idk.emailKey && e2.body.includes(s2.step.question)
      && open2?.askedTeam && !open2.answer);

  // Next question until the AI says done (the fake does after three).
  let st = s3; let guard = 0;
  while (!st.state.summary && guard++ < 5) st = await api('POST', u('design/step'), {});
  const designMd = await fs.readFile(path.join(dir, 'design.md'), 'utf8').catch(() => '');
  check('(design) done', 'summary set; design.yaml and design.md end with the Café check',
    `summary ${st.state.summary ? 'set' : 'missing'}, design.yaml ${await exists(path.join(dir, 'design.yaml'))}, Café check last ${designMd.lastIndexOf('## ') === designMd.indexOf('## Café check')}`,
    !!st.state.summary && await exists(path.join(dir, 'design.yaml')) && designMd.includes('## Café check')
      && designMd.lastIndexOf('## ') === designMd.indexOf('## Café check'));

  // Approve: s3f ticked; the custom app is a CSIC flag, so it suggests closing as Routed to CSIC (never automatic).
  const ok = await api('POST', u('design/approve'));
  const after = await ideaOf(ID);
  check('(design) approve', 's3f ticked; suggest closeAs csic; stage and closure unchanged',
    `${ok.state.status}, s3f ${!!after.checklist?.s3f?.done}, suggest ${ok.suggest?.closeAs ?? '-'}, stage ${idea.stage}→${after.stage}`,
    ok.state.status === 'approved' && after.checklist?.s3f?.done && ok.suggest?.closeAs === 'csic'
      && after.stage === idea.stage && JSON.stringify(after.closed) === JSON.stringify(idea.closed));

  // Plan and kits: every fake task's tool was picked, so no Not picked heading.
  const plan = await api('POST', u('plan'));
  const planMd = await fs.readFile(path.join(dir, 'plan.md'), 'utf8').catch(() => '');
  const agent = await fs.readFile(path.join(dir, 'kit', 'custom-app', 'BUILD-WITH-AGENT.md'), 'utf8').catch(() => '');
  check('(design) plan and kits', 'plan.md, kit/custom-app/BUILD-WITH-AGENT.md; no Not picked',
    `${plan.files.length} files, plan.md ${!!planMd}, agent kit ${!!agent}, Not picked ${planMd.includes('### Not picked')}`,
    plan.files.includes('plan.md') && plan.files.includes('kit/custom-app/BUILD-WITH-AGENT.md') && !!planMd && /```text\n/.test(agent)
      && planMd.includes('## Café check') && !planMd.includes('### Not picked'));
}

function print() {
  const w = [24, 60, 78];
  const cut = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s)).padEnd(n);
  console.log(`\n${cut('file', w[0])} | ${cut('expected', w[1])} | ${cut('actual', w[2])} | result`);
  console.log('-'.repeat(w[0] + w[1] + w[2] + 15));
  for (const r of rows) console.log(`${cut(r.file, w[0])} | ${cut(r.expected, w[1])} | ${cut(r.actual, w[2])} | ${r.pass ? 'PASS' : 'FAIL'}`);
  const fails = rows.filter((r) => !r.pass).length;
  console.log(`\n${rows.length - fails}/${rows.length} PASS${fails ? `, ${fails} FAIL` : ''}`);
  if (argv.includes('--json')) console.log(`JSON ${JSON.stringify(rows)}`);
  process.exitCode = fails ? 1 : 0;
}

await main();
