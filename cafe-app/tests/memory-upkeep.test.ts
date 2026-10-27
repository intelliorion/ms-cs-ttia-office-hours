import { describe, it, expect } from 'vitest';
import { touched, onTouched, sourceOfPath } from '../src/memory/touch';
import { decide, sourceWords, type UpkeepState, type UpkeepTrigger } from '../src/memory/upkeep';

/* ---------- The bus ---------- */

describe('the touch bus', () => {
  it('tells its listeners which ideas a source touched, by workspace root', () => {
    const seen: unknown[] = [];
    const off = onTouched((e) => seen.push(e));
    touched('/ws', ['CAFE-2026-003'], 'save');
    touched('/other', ['CAFE-2026-001'], 'import');
    off();
    touched('/ws', ['CAFE-2026-009'], 'save');
    expect(seen).toEqual([{ root: '/ws', ideas: ['CAFE-2026-003'], source: 'save' }, { root: '/other', ideas: ['CAFE-2026-001'], source: 'import' }]);
  });
  it('knows an idea write from its path, and the source from the file', () => {
    const at = (f: string) => sourceOfPath(`/home/me/cafe-workspace/data/ideas/CAFE-2026-003-vendor-contracts/${f}`);
    expect(at('idea.yaml')).toEqual({ root: '/home/me/cafe-workspace', ideaId: 'CAFE-2026-003', source: 'save' });
    expect(at('design.yaml')?.source).toBe('design');
    expect(at('approach.md')?.source).toBe('design');
    expect(at('emails/001-E2.md')?.source).toBe('email');
    expect(at('emails/in/x.summary.md')?.source).toBe('email');
    expect(at('roadshow/script.md')?.source).toBe('roadshow');
    expect(at('csic-handoff.md')?.source).toBe('handoff');
    expect(at('history.log')?.source).toBe('history');
    expect(at('design.md')?.source).toBe('file');
    expect(at('data/sample.csv')?.source).toBe('file');
    // An idea folder without a slug, and Windows separators.
    expect(sourceOfPath('C:\\ws\\data\\ideas\\CAFE-2026-010\\idea.yaml')).toEqual({ root: 'C:\\ws', ideaId: 'CAFE-2026-010', source: 'save' });
    // Not an idea write.
    expect(sourceOfPath('/ws/data/rounds/2026-q4/round.yaml')).toBeUndefined();
    expect(sourceOfPath('/ws/data/inbox/held/x.eml')).toBeUndefined();
    expect(sourceOfPath('/ws/data/memory/index.jsonl')).toBeUndefined();
    expect(sourceOfPath('/ws/rules/settings.yaml')).toBeUndefined();
  });
});

/* ---------- decide(): pure, one rule at a time ---------- */

const trig = (over: Partial<UpkeepTrigger> = {}): UpkeepTrigger => ({ sources: ['save'], ideas: ['CAFE-2026-003'], at: '2026-10-26T09:00:00.000Z', ...over });
const idea = (id: string, present: string[], indexed: string[]) => ({ id, present, indexed });
const ready = (over: Partial<UpkeepState> = {}): UpkeepState => ({
  hasIndex: true, indexEmbedder: 'fake', embedder: 'fake', modelReady: true, on: true, status: 'done',
  ideas: [idea('CAFE-2026-003', ['a', 'b', 'c'], ['a', 'b'])],
  ...over,
});

describe('decide()', () => {
  it('1. the model is not on this machine yet: never downloaded on the app\'s own initiative', () => {
    expect(decide(trig(), ready({ modelReady: false }))).toEqual({ act: 'skip', ideas: ['CAFE-2026-003'], why: 'the model is not on this machine yet: press Run once to download it', passages: 0 });
    // Even with no index at all.
    expect(decide(trig(), ready({ modelReady: false, hasIndex: false, indexEmbedder: undefined })).why).toBe('the model is not on this machine yet: press Run once to download it');
  });
  it('1b. the model is here and there is no index yet: a touched idea is simply read, every passage fresh', () => {
    const s = ready({ hasIndex: false, indexEmbedder: undefined, ideas: [idea('CAFE-2026-003', ['a', 'b', 'c'], [])] });
    expect(decide(trig({ sources: ['import'] }), s)).toEqual({ act: 'read', ideas: ['CAFE-2026-003'], why: 'read 2026-003 after Import · 3 passages', passages: 3 });
    // The switch off, a pause or a running read still win with no index.
    expect(decide(trig(), { ...s, on: false })).toMatchObject({ act: 'skip', why: 'automatic upkeep is off' });
    expect(decide(trig(), { ...s, status: 'paused' })).toMatchObject({ act: 'skip', why: 'paused by you: 2026-003 will be read at Continue' });
    expect(decide(trig(), { ...s, status: 'running' })).toMatchObject({ act: 'queue' });
  });
  it('1c. start-up: the ideas never read are read, and the reason says so', () => {
    const s = ready({ hasIndex: false, indexEmbedder: undefined, ideas: [idea('CAFE-2026-001', ['a', 'b'], []), idea('CAFE-2026-002', ['c'], [])] });
    expect(decide(trig({ sources: ['startup'], ideas: ['CAFE-2026-001', 'CAFE-2026-002'] }), s)).toEqual({ act: 'read', ideas: ['CAFE-2026-001', 'CAFE-2026-002'], why: 'read 2026-001 and 2026-002 at start-up · 3 passages', passages: 3 });
  });
  it('2. the switch is off: fully manual', () => {
    expect(decide(trig(), ready({ on: false }))).toMatchObject({ act: 'skip', why: 'automatic upkeep is off' });
  });
  it('3. an index built with another model: say so, Rerun all stays the operator\'s call', () => {
    expect(decide(trig(), ready({ indexEmbedder: 'Xenova/all-MiniLM-L6-v2' }))).toMatchObject({ act: 'skip', why: 'the index was built with another model (Xenova/all-MiniLM-L6-v2): Rerun all to read with this one' });
  });
  it('4. paused: never resumed; the ideas are named so they can be marked stale', () => {
    expect(decide(trig(), ready({ status: 'paused' }))).toMatchObject({ act: 'skip', ideas: ['CAFE-2026-003'], why: 'paused by you: 2026-003 will be read at Continue' });
  });
  it('5. running: queued, folded into the end of that run', () => {
    expect(decide(trig({ ideas: ['CAFE-2026-003', 'CAFE-2026-004'] }), ready({ status: 'running' }))).toMatchObject({ act: 'queue', ideas: ['CAFE-2026-003', 'CAFE-2026-004'], why: 'a read is running: 2026-003 and 2026-004 will be checked when it ends' });
  });
  it('6. a star renamed or merged: labels only, no passage read', () => {
    expect(decide(trig({ sources: ['stars'], ideas: [] }), ready({ ideas: [] }))).toEqual({ act: 'skip', ideas: [], why: 'star labels refreshed; no passage changed', passages: 0, labels: true });
  });
  it('7. nothing changed: every passage already in the index', () => {
    const s = ready({ ideas: [idea('CAFE-2026-003', ['a', 'b'], ['a', 'b'])] });
    expect(decide(trig(), s)).toEqual({ act: 'skip', ideas: ['CAFE-2026-003'], why: 'nothing changed in 2026-003', passages: 0 });
    // A stars event together with an unchanged save is still a skip, and the labels are still refreshed.
    expect(decide(trig({ sources: ['save', 'stars'] }), s)).toMatchObject({ act: 'skip', labels: true, why: 'nothing changed in 2026-003' });
  });
  it('8. something changed: read just those passages of just those ideas', () => {
    expect(decide(trig(), ready())).toEqual({ act: 'read', ideas: ['CAFE-2026-003'], why: 'read 2026-003 after a save · 1 passage', passages: 1 });
    // Two ideas, one unchanged: only the changed one is read, and the reason says Import when an Import is among the sources.
    const s = ready({ ideas: [idea('CAFE-2026-003', ['a', 'b'], ['a', 'b']), idea('CAFE-2026-004', ['x', 'y', 'z'], [])] });
    expect(decide(trig({ sources: ['save', 'import'], ideas: ['CAFE-2026-003', 'CAFE-2026-004'] }), s)).toEqual({ act: 'read', ideas: ['CAFE-2026-004'], why: 'read 2026-004 after Import · 3 passages', passages: 3 });
    // A passage that went away is dropped, and said.
    expect(decide(trig(), ready({ ideas: [idea('CAFE-2026-003', ['a'], ['a', 'b'])] }))).toEqual({ act: 'read', ideas: ['CAFE-2026-003'], why: 'read 2026-003 after a save · 0 passages · 1 dropped', passages: 0 });
    // An idea whose folder is gone.
    expect(decide(trig(), ready({ ideas: [idea('CAFE-2026-003', [], ['a', 'b'])] }))).toEqual({ act: 'read', ideas: ['CAFE-2026-003'], why: '2026-003 removed: its passages dropped', passages: 0 });
  });
  it('the rules hold in order: a missing model wins over the switch, the switch over the model mismatch, the mismatch over the pause, the pause over the run', () => {
    expect(decide(trig(), ready({ modelReady: false, on: false, status: 'running' })).why).toBe('the model is not on this machine yet: press Run once to download it');
    expect(decide(trig(), ready({ on: false, status: 'running' })).why).toBe('automatic upkeep is off');
    expect(decide(trig(), ready({ indexEmbedder: 'other', status: 'paused' })).why).toMatch(/another model/);
    expect(decide(trig(), ready({ status: 'paused' })).act).toBe('skip');
  });
  it('the source words', () => {
    expect(sourceWords(['save'])).toBe('after a save');
    expect(sourceWords(['design', 'email'])).toBe('after the design was saved and an email');
    expect(sourceWords(['save', 'import', 'history'])).toBe('after Import');
    expect(sourceWords(['roadshow'])).toBe('after the roadshow');
    expect(sourceWords(['handoff'])).toBe('after the hand-off');
    expect(sourceWords(['history'])).toBe('after the history');
    expect(sourceWords(['file'])).toBe('after a file');
    expect(sourceWords([])).toBe('after a change');
    expect(sourceWords(['startup'])).toBe('at start-up');
  });
});

/* ---------- The runner: timers, the flush, and what it writes ---------- */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpWorkspace, sampleIdea } from './helpers';
import { saveIdea } from '../src/ideas/store';
import { fakeEmbedder, type Embedder } from '../src/memory/embed';
import { createDeepRead } from '../src/memory/job';
import { readIndex, readState, memoryDir } from '../src/memory/index';
import { createUpkeep } from '../src/memory/upkeep';

const FAKE = { ...process.env, CAFE_EMBED_FAKE: '1' };
const clock = () => '2026-10-26T09:00:00.000Z';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** An embedder that counts the texts it was asked for. */
function counting(): { embedder: () => Embedder; texts: string[] } {
  const texts: string[] = [];
  const base = fakeEmbedder();
  return { texts, embedder: () => ({ ...base, embed: async (t) => { texts.push(...t); return base.embed(t); } }) };
}
const ID1 = 'CAFE-2026-001'; const ID2 = 'CAFE-2026-002';
async function twoIdeas(root: string) {
  await saveIdea(root, sampleIdea({ id: ID1, title: 'Vendor contracts', challenge: 'Contracts are read by hand.', current_process: 'A lawyer reads each one.', dedupe_key: 'a' }));
  await saveIdea(root, sampleIdea({ id: ID2, title: 'Desk booking', challenge: 'Desks are double booked.', current_process: 'A spreadsheet.', dedupe_key: 'b' }));
}
function setup(root: string, opts: { embedder?: () => Embedder; on?: boolean; modelReady?: boolean; quietMs?: number; maxMs?: number; nodes?: () => Promise<{ id: string; type: 'Capability' | 'Person'; label: string }[]> } = {}) {
  const emb = opts.embedder ?? fakeEmbedder;
  const job = createDeepRead(root, emb, clock);
  const upkeep = createUpkeep(root, { job, embedder: emb, env: FAKE, clock, quietMs: opts.quietMs ?? 20, maxMs: opts.maxMs ?? 200, on: async () => opts.on ?? true, nodes: opts.nodes ?? (async () => []), ...(opts.modelReady === undefined ? {} : { modelReady: async () => opts.modelReady! }) });
  return { job, upkeep };
}

describe('the upkeep runner', () => {
  it('does nothing while the model is not on this machine: the decision is kept in memory only, no memory folder', async () => {
    const root = await tmpWorkspace();
    await twoIdeas(root);
    const c = counting();
    const { upkeep } = setup(root, { embedder: c.embedder, modelReady: false });
    await saveIdea(root, sampleIdea({ id: ID1, title: 'Vendor contracts', challenge: 'Changed.', dedupe_key: 'a' }));
    upkeep.touch([ID1], 'save');
    await upkeep.idle();
    expect(upkeep.last()).toMatchObject({ act: 'skip', why: 'the model is not on this machine yet: press Run once to download it' });
    expect(c.texts).toEqual([]);
    await expect(fs.stat(path.join(memoryDir(root), 'state.json'))).rejects.toThrow();
    await expect(fs.stat(path.join(memoryDir(root), 'index.jsonl'))).rejects.toThrow();
    // Start-up does nothing either, and says why.
    expect(await upkeep.startup()).toMatchObject({ act: 'skip', why: 'the model is not on this machine yet: press Run once to download it' });
    expect(c.texts).toEqual([]);
    upkeep.close();
  });

  it('with the model on this machine and no index yet, a touched idea is read without a Run: the index is created and the model recorded', async () => {
    const root = await tmpWorkspace();
    await twoIdeas(root);
    const c = counting();
    const { upkeep } = setup(root, { embedder: c.embedder });
    await saveIdea(root, sampleIdea({ id: ID1, title: 'Vendor contracts', challenge: 'Changed.', current_process: 'A lawyer reads each one.', dedupe_key: 'a' }));
    upkeep.touch([ID1], 'save');
    await upkeep.idle();
    expect(c.texts).toHaveLength(2);
    const rows = await readIndex(root);
    expect(rows.map((r) => r.ideaId)).toEqual([ID1, ID1]);
    const state = await readState(root);
    expect(state.embedder).toBe('fake');
    expect(state.lastDecision).toEqual({ act: 'read', ideas: [ID1], why: 'read 2026-001 after a save · 2 passages', at: clock() });
    upkeep.close();
  });

  it('start-up reads only the ideas not read yet, in the background, and records the reason; with every idea read it reads nothing', async () => {
    const root = await tmpWorkspace();
    await twoIdeas(root);
    const c = counting();
    const { job, upkeep } = setup(root, { embedder: c.embedder });
    // A fresh workspace: both ideas are unread.
    const d = await upkeep.startup();
    expect(d).toMatchObject({ act: 'read', ideas: [ID1, ID2], why: 'read 2026-001 and 2026-002 at start-up · 4 passages' });
    expect(c.texts).toHaveLength(4);
    expect((await readState(root)).lastDecision).toMatchObject({ act: 'read', why: 'read 2026-001 and 2026-002 at start-up · 4 passages' });
    // The job's own view shows that read as its last run: not idle 0/0 with no last run.
    const after = await readState(root);
    expect(after.lastRun).toMatchObject({ at: clock(), chunks: 4, ideas: 2 });
    expect(after).toMatchObject({ status: 'done', done: 4, total: 4 });
    // Changed while the server was down: only that idea at the next start.
    upkeep.close();
    await saveIdea(root, sampleIdea({ id: ID2, title: 'Desk booking', challenge: 'Desks are double booked twice.', current_process: 'A spreadsheet.', dedupe_key: 'b' }));
    c.texts.length = 0;
    const up2 = createUpkeep(root, { job, embedder: c.embedder, env: FAKE, clock, quietMs: 20, maxMs: 200, on: async () => true, nodes: async () => [] });
    expect(await up2.startup()).toMatchObject({ act: 'read', ideas: [ID2], why: 'read 2026-002 at start-up · 1 passage' });
    expect(c.texts).toEqual(['Desk booking\nDesks are double booked twice.']);
    // Everything read: nothing done, nothing written, and said.
    c.texts.length = 0;
    const before = await readState(root);
    expect(await up2.startup()).toMatchObject({ act: 'skip', ideas: [], why: 'every idea is already read' });
    expect(c.texts).toEqual([]);
    expect(await readState(root)).toEqual(before);
    expect(up2.startupDecision()).toMatchObject({ why: 'every idea is already read' });
    up2.close();
  });

  it('start-up never resumes a pause and never reads with the switch off', async () => {
    const root = await tmpWorkspace();
    await twoIdeas(root);
    const c = counting();
    const { upkeep } = setup(root, { embedder: c.embedder, on: false });
    expect(await upkeep.startup()).toMatchObject({ act: 'skip', why: 'automatic upkeep is off' });
    expect(c.texts).toEqual([]);
    upkeep.close();
    // Paused before its first batch: start-up leaves it paused and reads nothing.
    const p = setup(root, { embedder: c.embedder });
    await p.job.run(); await p.job.pause(); await p.job.idle();
    expect((await readState(root)).status).toBe('paused');
    expect(await p.upkeep.startup()).toMatchObject({ act: 'skip', why: 'paused by you: 2026-001 and 2026-002 will be read at Continue' });
    expect(c.texts).toEqual([]);
    expect((await readState(root)).status).toBe('paused');
    p.upkeep.close();
  });

  it('after a run, a changed idea is re-read: only its changed passages, the rows replaced and stamped, the reason kept', async () => {
    const root = await tmpWorkspace();
    await twoIdeas(root);
    const c = counting();
    const { job, upkeep } = setup(root, { embedder: c.embedder });
    await job.run(); await job.idle();
    expect(c.texts).toHaveLength(4);
    c.texts.length = 0;
    await saveIdea(root, sampleIdea({ id: ID1, title: 'Vendor contracts', challenge: 'Contracts are read by hand, late.', current_process: 'A lawyer reads each one.', dedupe_key: 'a' }));
    upkeep.touch([ID1], 'save');
    expect(upkeep.waiting()).toBe(true);
    await upkeep.idle();
    expect(c.texts).toEqual(['Vendor contracts\nContracts are read by hand, late.']);
    const state = await readState(root);
    expect(state.lastDecision).toEqual({ act: 'read', ideas: [ID1], why: 'read 2026-001 after a save · 1 passage', at: clock() });
    expect(state.status).toBe('done');
    const rows = await readIndex(root);
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.ideaId === ID1).map((r) => r.at)).toEqual([clock(), clock()]);
    expect(upkeep.waiting()).toBe(false);
  });

  it('a save with no text change is skipped, and said', async () => {
    const root = await tmpWorkspace();
    await twoIdeas(root);
    const c = counting();
    const { job, upkeep } = setup(root, { embedder: c.embedder });
    await job.run(); await job.idle(); c.texts.length = 0;
    await saveIdea(root, sampleIdea({ id: ID2, title: 'Desk booking', challenge: 'Desks are double booked.', current_process: 'A spreadsheet.', dedupe_key: 'b', stage: 2 } as never));
    upkeep.touch([ID2], 'save');
    await upkeep.idle();
    expect(c.texts).toEqual([]);
    expect((await readState(root)).lastDecision).toMatchObject({ act: 'skip', why: 'nothing changed in 2026-002' });
  });

  it('a burst becomes one read: many touches inside the quiet time, one decision, one embed call; the longest wait is capped', async () => {
    const root = await tmpWorkspace();
    await twoIdeas(root);
    const c = counting();
    const { job, upkeep } = setup(root, { embedder: c.embedder, quietMs: 30, maxMs: 90 });
    await job.run(); await job.idle(); c.texts.length = 0;
    // Every write into an idea folder reaches every runner on that root: the first one is closed, the saves are made, then the counting one listens.
    upkeep.close();
    const calls: number[] = [];
    const e = c.embedder; const spy = () => { const x = e(); return { ...x, embed: async (t: string[]) => { calls.push(t.length); return x.embed(t); } }; };
    await saveIdea(root, sampleIdea({ id: ID1, title: 'Vendor contracts', challenge: 'One.', current_process: 'A lawyer reads each one.', dedupe_key: 'a' }));
    await saveIdea(root, sampleIdea({ id: ID2, title: 'Desk booking', challenge: 'Two.', current_process: 'A spreadsheet.', dedupe_key: 'b' }));
    const u2 = createUpkeep(root, { job, embedder: spy, env: FAKE, clock, quietMs: 30, maxMs: 90, on: async () => true, nodes: async () => [] });
    // Touches every 10 ms for 70 ms: never 30 ms of quiet, so the 90 ms cap flushes it.
    const t0 = Date.now();
    for (let i = 0; i < 7; i++) { u2.touch([i % 2 ? ID1 : ID2], i === 3 ? 'import' : 'save'); await wait(10); }
    await u2.idle();
    expect(Date.now() - t0).toBeLessThan(400);
    expect(calls).toEqual([2]);
    expect((await readState(root)).lastDecision).toMatchObject({ act: 'read', ideas: [ID2, ID1], why: 'read 2026-002 and 2026-001 after Import · 2 passages' });
    u2.close();
  });

  it('while a read runs the trigger is queued and folded into the end of that run; paused is never resumed', async () => {
    const root = await tmpWorkspace();
    await twoIdeas(root);
    let gate: (() => void) | undefined;
    const slow = (): Embedder => ({ ...fakeEmbedder(), embed: async (t) => { await new Promise<void>((r) => { gate = r; }); return fakeEmbedder().embed(t); } });
    const { job, upkeep } = setup(root, { embedder: fakeEmbedder });
    await job.run(); await job.idle();
    upkeep.close();
    // A slower job for the second run, with its own runner (the save's own touch, from the files layer, reaches it too).
    const job2 = createDeepRead(root, slow, clock);
    const up2 = createUpkeep(root, { job: job2, embedder: fakeEmbedder, env: FAKE, clock, quietMs: 10, maxMs: 50, on: async () => true, nodes: async () => [] });
    await saveIdea(root, sampleIdea({ id: ID1, title: 'Vendor contracts', challenge: 'Changed once.', dedupe_key: 'a' }));
    await job2.run();
    await wait(15);
    expect((await readState(root)).status).toBe('running');
    await saveIdea(root, sampleIdea({ id: ID2, title: 'Desk booking', challenge: 'Changed too.', dedupe_key: 'b' }));
    up2.touch([ID2], 'save');
    await wait(40);
    expect((await readState(root)).lastDecision).toMatchObject({ act: 'queue' });
    expect((await readState(root)).lastDecision?.why).toMatch(/^a read is running: 2026-00[12]( and 2026-002)? will be checked when it ends$/);
    gate?.();
    await job2.idle();
    await up2.idle();
    // The fold: the run read everything, so the re-check finds nothing to do, or reads the one passage the plan missed.
    const after = await readState(root);
    expect(after.status).toBe('done');
    expect(['skip', 'read']).toContain(after.lastDecision?.act);
    expect(after.lastDecision?.why).toMatch(/^(nothing changed in (2026-001 and )?2026-002|read (2026-001 and )?2026-002 after a save)/);
    // Paused before its first batch: nothing read, and a change while paused is marked stale, never read.
    await saveIdea(root, sampleIdea({ id: ID1, title: 'Vendor contracts', challenge: 'Changed again.', dedupe_key: 'a' }));
    await job2.run(); await job2.pause(); await job2.idle();
    expect((await readState(root)).status).toBe('paused');
    await saveIdea(root, sampleIdea({ id: ID1, title: 'Vendor contracts', challenge: 'Changed a third time.', dedupe_key: 'a' }));
    up2.touch([ID1], 'save');
    await up2.idle();
    const paused = await readState(root);
    expect(paused.status).toBe('paused');
    expect(paused.lastDecision).toMatchObject({ act: 'skip', why: 'paused by you: 2026-001 will be read at Continue' });
    expect(paused.stale).toEqual([ID1]);
    up2.close();
  });

  it('the switch off: a decision is recorded, nothing is read', async () => {
    const root = await tmpWorkspace();
    await twoIdeas(root);
    const c = counting();
    const { job, upkeep } = setup(root, { embedder: c.embedder, on: false });
    await job.run(); await job.idle(); c.texts.length = 0;
    await saveIdea(root, sampleIdea({ id: ID1, title: 'Vendor contracts', challenge: 'Changed.', dedupe_key: 'a' }));
    upkeep.touch([ID1], 'save');
    await upkeep.idle();
    expect(c.texts).toEqual([]);
    expect((await readState(root)).lastDecision).toMatchObject({ act: 'skip', why: 'automatic upkeep is off' });
  });

  it('a failing embedder defers once with the error and is not retried until the next touch', async () => {
    const root = await tmpWorkspace();
    await twoIdeas(root);
    const { job, upkeep } = setup(root);
    await job.run(); await job.idle();
    upkeep.close();
    let calls = 0;
    const failing = (): Embedder => ({ ...fakeEmbedder(), embed: async () => { calls++; throw new Error('The model could not be loaded'); } });
    const up = createUpkeep(root, { job, embedder: failing, env: FAKE, clock, quietMs: 10, maxMs: 50, on: async () => true, nodes: async () => [] });
    await saveIdea(root, sampleIdea({ id: ID1, title: 'Vendor contracts', challenge: 'Changed.', dedupe_key: 'a' }));
    up.touch([ID1], 'save');
    await up.idle();
    await wait(60);
    expect(calls).toBe(1);
    const s = await readState(root);
    expect(s.status).toBe('done');
    expect(s.lastDecision).toMatchObject({ act: 'defer', ideas: [ID1], why: 'could not read 2026-001: The model could not be loaded; will try again at the next change' });
    expect(await readIndex(root)).toHaveLength(4);
    up.touch([ID1], 'save');
    await up.idle();
    expect(calls).toBe(2);
    up.close();
  });

  it('a renamed or merged star refreshes the missing label vectors only; no passage is read', async () => {
    const root = await tmpWorkspace();
    await twoIdeas(root);
    const c = counting();
    const nodes = [{ id: 'cap:1', type: 'Capability' as const, label: 'Contract summary' }, { id: 'person:1', type: 'Person' as const, label: 'A Person' }];
    const { job, upkeep } = setup(root, { embedder: c.embedder, nodes: async () => nodes });
    await job.run(); await job.idle(); c.texts.length = 0;
    upkeep.touch([], 'stars');
    await upkeep.idle();
    expect(c.texts).toEqual(['Contract summary']);
    expect((await readState(root)).lastDecision).toMatchObject({ act: 'skip', why: 'star labels refreshed; no passage changed' });
    const labels = await fs.readFile(path.join(memoryDir(root), 'labels.jsonl'), 'utf8');
    expect(labels.trim().split('\n')).toHaveLength(1);
    // Again: cached, nothing embedded.
    c.texts.length = 0;
    upkeep.touch([], 'stars');
    await upkeep.idle();
    expect(c.texts).toEqual([]);
  });

  it('an idea whose folder is gone has its passages dropped', async () => {
    const root = await tmpWorkspace();
    await twoIdeas(root);
    const { job, upkeep } = setup(root);
    await job.run(); await job.idle();
    const dir = (await fs.readdir(path.join(root, 'data', 'ideas'))).find((n) => n.startsWith(ID2))!;
    await fs.rm(path.join(root, 'data', 'ideas', dir), { recursive: true });
    upkeep.touch([ID2], 'save');
    await upkeep.idle();
    expect((await readIndex(root)).map((r) => r.ideaId)).toEqual([ID1, ID1]);
    expect((await readState(root)).lastDecision).toMatchObject({ act: 'read', why: '2026-002 removed: its passages dropped' });
  });
});
