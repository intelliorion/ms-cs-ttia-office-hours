import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { startServer, sampleIdea } from './helpers';
import { saveIdea, loadIdea } from '../src/ideas/store';
import { appendAiLink } from '../src/graph/store';
import type { AiLink } from '../src/graph/ontology';
import { fullIdea } from './memory-chunks.test';
import { agentTask, type AgentInput } from '../src/ai/tasks';
import { queryGuide, QUERY_GUIDE } from '../src/command/query';

const was = { embed: process.env.CAFE_EMBED_FAKE, ai: process.env.CAFE_AI_FAKE };
beforeAll(() => { process.env.CAFE_EMBED_FAKE = '1'; process.env.CAFE_AI_FAKE = '1'; });
afterAll(() => { process.env.CAFE_EMBED_FAKE = was.embed; process.env.CAFE_AI_FAKE = was.ai; });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (r: Response): Promise<any> => r.json();
let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; });
async function boot() {
  const s = await startServer('2026-10-19', { upkeep: { quietMs: 20, maxMs: 150 } });
  close = () => new Promise<void>((resolve) => { s.server.close(() => resolve()); s.server.closeAllConnections(); });
  return s;
}
const post = (base: string, url: string, body: unknown = {}) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = (base: string, url: string) => fetch(base + url).then(j);
async function untilIdle(base: string) {
  for (let i = 0; i < 200; i++) {
    const m = await get(base, '/api/memory');
    if (m.job.status !== 'running' && !m.upkeep.waiting) return m;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('still running');
}

const input = (deepRead: AgentInput['deepRead']): AgentInput => ({ message: 'how many ideas?', stars: [], steps: [], stepsLeft: 6, deepRead });

describe('the assistant knows where Deep read stands', () => {
  it('the prompt carries the state and tells the agent when to search what people wrote, and when not to', () => {
    const on = agentTask.prompt(input({ on: true, percent: 94, staleIdeas: 1, lastRead: '2026-10-26T09:00:00.000Z' }));
    expect(on).toContain('Deep read is on: 94 % of what people wrote is read, 1 idea changed since it was read, last read 2026-10-26T09:00:00.000Z.');
    expect(on).toContain('Use search and similar only for questions about what people WROTE');
    expect(on).toContain('For stars, links, counts, people and stages use stars, follow, filter, role, rank and count_by');
    expect(on).toContain('- search: Deep read.');
    expect(on).toContain('"deepRead":{"on":true,"percent":94,"staleIdeas":1,"lastRead":"2026-10-26T09:00:00.000Z"}');
    const off = agentTask.prompt(input({ on: false, percent: 0, staleIdeas: 0 }));
    expect(off).toContain('Deep read has not run: the search and similar steps do not exist');
    expect(off).not.toContain('- search: Deep read.');
    expect(off).not.toContain('- similar: Deep read.');
    expect(off).not.toContain('what did teams say about data access');
    expect(off).toContain('"deepRead":{"on":false');
    // An older caller passing nothing still gets a sensible prompt.
    expect(agentTask.prompt(input(undefined))).toContain('Deep read has not run');
    expect(queryGuide(true)).toEqual(QUERY_GUIDE);
    expect(queryGuide(false).filter((l) => /Deep read|"op":"similar"|"op":"search"/.test(l))).toEqual([]);
    // The graph's own way to similar ideas stays when Deep read is off: SIMILAR_TO is a fact, not a reading.
    expect(queryGuide(false).join('\n')).toContain('- which ideas are similar to [I1]: [{"op":"stars","codes":["I1"]},{"op":"follow","rel":"SIMILAR_TO","type":"Idea"}]');
  });

  it('a question about stars runs graph steps only, never a search; a stale idea is named in the trace, not re-read inline', async () => {
    const { base, root } = await boot();
    await fullIdea(root);
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-002', title: 'Desk booking assistant', challenge: 'Desks are double booked every morning.', dedupe_key: 'b' }));
    await post(base, '/api/memory/run');
    await untilIdle(base);
    const stars = await j(await post(base, '/api/chat', { text: 'who leads the desk booking assistant?' }));
    expect(stars.kind).toBe('question');
    expect(stars.trace.flat().map((t: { text: string }) => t.text).join(' ')).not.toMatch(/Search what people wrote/);
    expect(stars.trace.flat().every((t: { text: string }) => !/changed since/.test(t.text))).toBe(true);
    // Upkeep off, the idea's text changed: it is stale, and a search that lands on it says so.
    await post(base, '/api/memory/upkeep', { on: false });
    const idea = await loadIdea(root, 'CAFE-2026-001');
    await saveIdea(root, { ...idea, challenge: `${idea.challenge} And now the notice dates slip.` });
    await untilIdle(base);
    const before = await get(base, '/api/memory');
    expect(before.summary.ideas[0].status).toBe('stale');
    expect(before.job.lastDecision).toMatchObject({ act: 'skip', why: 'automatic upkeep is off' });
    const e = await j(await post(base, '/api/chat', { text: 'what did teams say about data access?' }));
    expect(e.kind).toBe('question');
    expect(e.trace[0]).toEqual([
      { text: 'Search what people wrote for "what did teams say about data access"', size: 2 },
      { text: '2026-001 changed since it was read', size: 1 },
    ]);
    // Not re-read inline: still stale after the answer.
    expect((await get(base, '/api/memory')).summary.ideas[0].status).toBe('stale');
    expect(e.reply).toMatch(/^2 ideas mention that\./);
  });
});

describe('similar ideas: the graph first, Deep read second', () => {
  const needs = (idea: string, cap: string, label: string): AiLink =>
    ({ from: `idea:${idea}`, rel: 'NEEDS', to: `capability:${cap}`, description: '', source: 'ai:test', confidence: 0.9, status: 'confirmed', newNodes: [{ id: `capability:${cap}`, type: 'Capability', label }] });
  /** Three ideas with alike text: Travel policy and Procurement FAQ share two capabilities (SIMILAR_TO derived); the expense finder shares no star. */
  async function seed(root: string) {
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-001', title: 'Expense anomaly finder', challenge: 'Expense policy questions flood the mailbox.', dedupe_key: 'a' }));
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-002', title: 'Travel policy assistant', challenge: 'Travel policy questions flood the mailbox.', dedupe_key: 'b' }));
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-003', title: 'Procurement FAQ bot', challenge: 'Procurement policy questions flood the mailbox.', dedupe_key: 'c' }));
    for (const id of ['CAFE-2026-002', 'CAFE-2026-003']) { await appendAiLink(root, needs(id, 'policy-q-a', 'Policy Q&A')); await appendAiLink(root, needs(id, 'mailbox-triage', 'Mailbox triage')); }
  }
  const ask = (base: string) => post(base, '/api/chat', { text: 'which ideas are similar to @Travel policy assistant?', mentions: ['idea:CAFE-2026-002'] }).then(j);

  it('with Deep read run: the SIMILAR_TO idea with its shared stars comes first, the reading hits after, lit in that order', async () => {
    const { base, root } = await boot();
    await seed(root);
    await post(base, '/api/memory/run');
    await untilIdle(base);
    const e = await ask(base);
    expect(e.kind).toBe('question');
    expect(e.reply).toMatch(/^By shared stars: Procurement FAQ bot \(share Mailbox triage, Policy Q&A\)\. By reading, also: Expense anomaly finder\.$/);
    const texts = e.trace.map((t: { text: string }[]) => t.map((s) => s.text));
    expect(texts[0]).toEqual(['Start from Travel policy assistant', 'Follow similar to links to ideas', 'Travel policy assistant similar to Procurement FAQ bot: derived by shared-stars from Travel policy assistant NEEDS Mailbox triage, Procurement FAQ bot NEEDS Mailbox triage, Travel policy assistant NEEDS Policy Q&A, Procurement FAQ bot NEEDS Policy Q&A']);
    expect(texts[1]).toEqual(['Nearest ideas to Travel policy assistant']);
    expect(e.highlight.slice(0, 2)).toEqual(['idea:CAFE-2026-002', 'idea:CAFE-2026-003']);
    expect(e.highlight).toContain('idea:CAFE-2026-001');
  });

  it('with Deep read never run: only the graph part, no reading step', async () => {
    const { base, root } = await boot();
    await seed(root);
    const e = await ask(base);
    expect(e.reply).toBe('By shared stars: Procurement FAQ bot (share Mailbox triage, Policy Q&A).');
    expect(e.trace).toHaveLength(1);
    expect(e.highlight).toEqual(['idea:CAFE-2026-002', 'idea:CAFE-2026-003']);
  });
});

describe('impact of a system change: the derived links first, search second', () => {
  const link = (from: string, rel: AiLink['rel'], to: string, type: 'Capability' | 'System', label: string): AiLink =>
    ({ from, rel, to, description: '', source: 'ai:test', confidence: 0.9, status: 'confirmed', idea: from.startsWith('idea:') ? from.slice(5) : 'CAFE-2026-001', newNodes: [{ id: to, type, label }] });
  /** Two ideas need capabilities that read the travel policy (DEPENDS_ON derived); a third names the policy in its text but needs nothing that reads it. */
  async function seed(root: string) {
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-001', title: 'Travel policy assistant', challenge: 'Travel policy questions flood the mailbox.', dedupe_key: 'a' }));
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-002', title: 'Expense anomaly finder', challenge: 'Claims are checked by hand against the rules.', dedupe_key: 'b' }));
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-003', title: 'Desk booking assistant', challenge: 'Desks are double booked; the travel policy is unrelated but mentioned here.', dedupe_key: 'c' }));
    for (const [id, cap, label] of [['CAFE-2026-001', 'policy-q-a', 'Policy Q&A'], ['CAFE-2026-002', 'claim-scoring', 'Claim scoring']] as const) {
      await appendAiLink(root, link(`idea:${id}`, 'NEEDS', `capability:${cap}`, 'Capability', label));
      await appendAiLink(root, { ...link(`capability:${cap}`, 'USES_DATA', 'system:travel-policy', 'System', 'Travel policy'), idea: id });
    }
  }
  const ask = (base: string) => post(base, '/api/chat', { text: 'which ideas would need rework if the travel policy is rewritten?' }).then(j);
  const DERIVED = [
    'Travel policy assistant depends on Travel policy: derived by needs+uses_data from Travel policy assistant NEEDS Policy Q&A, Policy Q&A USES_DATA Travel policy',
    'Expense anomaly finder depends on Travel policy: derived by needs+uses_data from Expense anomaly finder NEEDS Claim scoring, Claim scoring USES_DATA Travel policy',
  ];

  it('with Deep read off: the policy star, follow DEPENDS_ON in, the two depending ideas lit and the rule in the trace; no search', async () => {
    const { base, root } = await boot();
    await seed(root);
    const e = await ask(base);
    expect(e.kind).toBe('question');
    expect(e.steps.map((s: { kind: string }) => s.kind)).toEqual(['search']);
    expect(e.trace).toHaveLength(1);
    expect(e.trace[0].map((t: { text: string }) => t.text)).toEqual(['Start from Travel policy', 'Follow depends on links to ideas', ...DERIVED]);
    expect(e.highlight.sort()).toEqual(['idea:CAFE-2026-001', 'idea:CAFE-2026-002', 'system:travel-policy']);
    expect(e.reply).toBe('By the graph, 2 ideas depend on Travel policy: Travel policy assistant (via Policy Q&A), Expense anomaly finder (via Claim scoring).');
  });

  it('with Deep read on: the same graph step first, then a search of the text kept apart as a reading', async () => {
    const { base, root } = await boot();
    await seed(root);
    await post(base, '/api/memory/run');
    await untilIdle(base);
    const e = await ask(base);
    expect(e.trace.map((t: { text: string }[]) => t[0].text)).toEqual(['Start from Travel policy', 'Search what people wrote for "travel policy"']);
    expect(e.trace[0].map((t: { text: string }) => t.text)).toEqual(['Start from Travel policy', 'Follow depends on links to ideas', ...DERIVED]);
    expect(e.highlight.slice(0, 3).sort()).toEqual(['idea:CAFE-2026-001', 'idea:CAFE-2026-002', 'system:travel-policy']);
    expect(e.reply).toMatch(/^By the graph, 2 ideas depend on Travel policy: Travel policy assistant \(via Policy Q&A\), Expense anomaly finder \(via Claim scoring\)\. By reading, the text also names it in: Desk booking assistant\.$/);
  });
});

describe('which team owns an idea: the derived OWNS link, from the submitter, even with no lead', () => {
  it('an idea with a submitter and no lead still has its team, the trace says member+submitted, and the reply names the submitter', async () => {
    const { base, root } = await boot();
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-001', title: 'Travel policy assistant', function: 'GSS', challenge: 'Travel policy questions flood the mailbox.', dedupe_key: 'a',
      people: { submitter: 'Avery Chen', team: [] } }));
    const e = await post(base, '/api/chat', { text: 'which team owns @Travel policy assistant?', mentions: ['idea:CAFE-2026-001'] }).then(j);
    expect(e.kind).toBe('question');
    expect(e.trace).toHaveLength(1);
    expect(e.trace[0].map((t: { text: string }) => t.text)).toEqual([
      'Start from Travel policy assistant', 'Follow owns links to teams',
      'GSS owns Travel policy assistant: derived by member+submitted from GSS HAS_MEMBER Avery Chen, Avery Chen SUBMITTED Travel policy assistant',
    ]);
    expect(e.highlight.sort()).toEqual(['idea:CAFE-2026-001', 'team:gss']);
    expect(e.reply).toBe('By the graph, GSS owns Travel policy assistant (via the submitter Avery Chen).');
  });
});

describe('a capability shared by two teams: one grouped query, then what the submitters wrote', () => {
  const link = (from: string, to: string, label: string): AiLink =>
    ({ from, rel: 'NEEDS', to, description: '', source: 'ai:test', confidence: 0.9, status: 'confirmed', idea: from.slice(5), newNodes: [{ id: to, type: 'Capability', label }] });
  /** GSS: 001 and 004; BSI: 002 and 003. Policy Q&A is needed on both sides (001, 003), Document parsing too (004, 002); Desk finding by BSI only. */
  async function seed(root: string) {
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-001', title: 'Travel policy assistant', function: 'GSS', current_process: 'Current process: today the travel desk answers each policy question by email, one at a time.', dedupe_key: 'a', people: { submitter: 'Person 1', team: [] } }));
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-002', title: 'Desk booking assistant', function: 'BSI', current_process: 'Current process: today the floor team books desks by hand from a spreadsheet every morning.', dedupe_key: 'b', people: { submitter: 'Person 2', team: [] } }));
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-003', title: 'Onboarding checklist helper', function: 'BSI', current_process: 'Current process: today a coordinator reads the policy pages and emails the checklist by hand.', dedupe_key: 'c', people: { submitter: 'Person 3', team: [] } }));
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-004', title: 'Expense anomaly finder', function: 'GSS', current_process: 'Current process: today claims are parsed by hand from the expense export and checked one by one.', dedupe_key: 'd', people: { submitter: 'Person 4', team: [] } }));
    await appendAiLink(root, link('idea:CAFE-2026-001', 'capability:policy-q-a', 'Policy Q&A'));
    await appendAiLink(root, link('idea:CAFE-2026-003', 'capability:policy-q-a', 'Policy Q&A'));
    await appendAiLink(root, link('idea:CAFE-2026-004', 'capability:document-parsing', 'Document parsing'));
    await appendAiLink(root, link('idea:CAFE-2026-002', 'capability:document-parsing', 'Document parsing'));
    await appendAiLink(root, link('idea:CAFE-2026-002', 'capability:desk-finding', 'Desk finding'));
  }
  const ask = (base: string) => post(base, '/api/chat', { text: 'Is there any capability shared by GSS and BSI ideas? If so, which ideas, and what did each submitter say the current process is?' }).then(j);
  const GRAPH_TRACE = [
    'Start from every idea in GSS', 'Follow needs links to capabilities', 'Keep only what a second search also found', 'Follow needs links to ideas, per capability',
    'Policy Q&A: Travel policy assistant, Onboarding checklist helper', 'Document parsing: Desk booking assistant, Expense anomaly finder',
  ];
  const BY_GRAPH = 'By the graph, Policy Q&A: Travel policy assistant, Onboarding checklist helper (both need it); Document parsing: Desk booking assistant, Expense anomaly finder (both need it).';

  it('with Deep read off: one query, the ideas grouped per shared capability in the trace, and one line that the text is unread', async () => {
    const { base, root } = await boot();
    await seed(root);
    const e = await ask(base);
    expect(e.kind).toBe('question');
    expect(e.trace).toHaveLength(1);
    expect(e.trace[0].map((t: { text: string }) => t.text)).toEqual(GRAPH_TRACE);
    expect(e.highlight.sort()).toEqual(['capability:document-parsing', 'capability:policy-q-a', 'idea:CAFE-2026-001', 'idea:CAFE-2026-002', 'idea:CAFE-2026-003', 'idea:CAFE-2026-004']);
    expect(e.reply).toBe(`${BY_GRAPH} Deep read has not read what they wrote yet.`);
  });

  it('with Deep read on: the same query, then a search for the current process kept to those ideas, quoted per idea', async () => {
    const { base, root } = await boot();
    await seed(root);
    await post(base, '/api/memory/run');
    await untilIdle(base);
    const e = await ask(base);
    expect(e.trace).toHaveLength(2);
    expect(e.trace[0].map((t: { text: string }) => t.text)).toEqual(GRAPH_TRACE);
    expect(e.trace[1][0].text).toBe('Search what people wrote for "current process", among the previous answer');
    expect(e.reply).toMatch(/^By the graph, Policy Q&A: Travel policy assistant, Onboarding checklist helper \(both need it\); Document parsing: Desk booking assistant, Expense anomaly finder \(both need it\)\. By reading, the current process: /);
    expect(e.reply).toMatch(/Travel policy assistant: "Current process: today the travel desk answers each policy question by email/);
    expect(e.reply).toMatch(/Desk booking assistant: "Current process: today the floor team books desks by hand/);
    expect(e.reply).not.toMatch(/Person \d/);
  });
});
