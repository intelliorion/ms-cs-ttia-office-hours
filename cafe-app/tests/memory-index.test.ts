import { describe, it, expect } from 'vitest';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpWorkspace, sampleIdea } from './helpers';
import { saveIdea } from '../src/ideas/store';
import { cosine, fakeEmbedder, fakeVector, getEmbedder, embedderName, meanVector, FAKE_DIMS, EMBED_MODEL } from '../src/memory/embed';
import { writableModelDir } from '../src/memory/model';
import { chunkWorkspace } from '../src/memory/chunks';
import { groupByIdea, ideaCentroids, indexAvailable, labelVectors, nearestChunks, readIndex, readState, summary, updateState, writeIndex, writeState, type IndexRow } from '../src/memory/index';

const FAKE = { ...process.env, CAFE_EMBED_FAKE: '1' };

describe('the fake embedder', () => {
  it('is deterministic, unit length, and scores shared words higher', () => {
    const a = fakeVector('invoice matching for vendors');
    expect(a).toHaveLength(FAKE_DIMS);
    expect(a).toEqual(fakeVector('Invoice matching, for vendors!'));
    expect(Math.sqrt(a.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 6);
    expect(cosine(a, fakeVector('invoice matching vendors today'))).toBeGreaterThan(cosine(a, fakeVector('desk booking assistant')));
    expect(cosine(a, fakeVector('invoice matching vendors today'))).toBeGreaterThan(0.7);
    expect(fakeVector('')).toEqual(new Array(FAKE_DIMS).fill(0));
  });
  it('is picked only under CAFE_EMBED_FAKE=1, and nothing else is loaded for it', async () => {
    expect(getEmbedder(FAKE).name).toBe('fake');
    expect(embedderName(FAKE)).toBe('fake');
    expect(embedderName({})).toBe(EMBED_MODEL);
    expect((await fakeEmbedder().embed(['a b', 'c'])).map((v) => v.length)).toEqual([FAKE_DIMS, FAKE_DIMS]);
    expect(writableModelDir({ CAFE_MODEL_DIR: '/models/here' })).toBe('/models/here');
    expect(writableModelDir({})).toMatch(/\.cafe-ai[\\/]models$/);
  });
  it('the mean of unit vectors is unit length', () => {
    const m = meanVector([fakeVector('a b c'), fakeVector('c d e')]);
    expect(Math.sqrt(m.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 6);
    expect(meanVector([])).toEqual([]);
  });
});

async function rowsFor(root: string): Promise<IndexRow[]> {
  const { chunks } = await chunkWorkspace(root);
  const vectors = await fakeEmbedder().embed(chunks.map((c) => c.text));
  return chunks.map((c, i) => ({ ...c, vector: vectors[i] }));
}

describe('the index', () => {
  it('starts empty: no file, idle state, nothing available, 0 %', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea({ challenge: 'Contracts are missed.' }));
    expect(await readIndex(root)).toEqual([]);
    expect(await readState(root)).toEqual({ status: 'idle', done: 0, total: 0, stale: [] });
    expect(await indexAvailable(root, FAKE)).toBe(false);
    const s = await summary(root, FAKE);
    expect(s).toMatchObject({ chunks: 1, embedded: 0, percent: 0, available: false });
    expect(s.ideas).toEqual([{ id: 'CAFE-2026-001', title: 'Email scheduler', chunks: 1, embedded: 0, status: 'new', kinds: { submission: { chunks: 1, embedded: 0 } } }]);
    expect((await readdir(path.join(root, 'data'))).includes('memory')).toBe(true);
  });

  it('updateState serialises read-modify-write per workspace: two writers at once lose nothing (the job loop and upkeep share state.json)', async () => {
    const root = await tmpWorkspace();
    await writeState(root, { status: 'running', embedder: 'fake', done: 0, total: 4, stale: [] });
    // The job writes "paused" while upkeep records a decision: fired together, no await between them.
    const decision = { act: 'queue' as const, ideas: ['CAFE-2026-001'], why: 'a read is running', at: '2026-10-26T09:00:00.000Z' };
    const [a, b] = await Promise.all([
      updateState(root, (s) => ({ ...s, status: 'paused' })),
      updateState(root, (s) => ({ ...s, lastDecision: decision })),
    ]);
    expect(a.status).toBe('paused');
    expect(b).toMatchObject({ status: 'paused', lastDecision: decision });
    expect(await readState(root)).toMatchObject({ status: 'paused', lastDecision: decision, embedder: 'fake', total: 4 });
    // Many counters at once: every increment lands.
    await Promise.all(Array.from({ length: 20 }, () => updateState(root, (s) => ({ ...s, done: s.done + 1 }))));
    expect((await readState(root)).done).toBe(20);
    // A throwing update does not jam the chain for the next one.
    await expect(updateState(root, () => { throw new Error('no'); })).rejects.toThrow('no');
    expect((await updateState(root, (s) => ({ ...s, status: 'done' }))).status).toBe('done');
  });

  it('round-trips rows and state; a passage that changed makes its idea stale, a new idea is new', async () => {
    const root = await tmpWorkspace();
    const idea = sampleIdea({ challenge: 'Contracts are missed.', current_process: 'Read by hand.' });
    await saveIdea(root, idea);
    const rows = await rowsFor(root);
    await writeIndex(root, rows);
    await writeState(root, { status: 'done', embedder: 'fake', done: rows.length, total: rows.length, stale: [], lastRun: { at: '2026-10-26T09:00:00.000Z', ms: 10, chunks: 2, ideas: 1 } });
    expect(await readIndex(root)).toEqual(rows);
    expect(await indexAvailable(root, FAKE)).toBe(true);
    let s = await summary(root, FAKE);
    expect(s).toMatchObject({ chunks: 2, embedded: 2, percent: 100, available: true });
    expect(s.ideas[0].status).toBe('read');
    expect(s.kinds.submission).toEqual({ chunks: 2, embedded: 2 });
    // The challenge changes: one of two passages is stale; a second idea has never been read.
    await saveIdea(root, { ...idea, challenge: 'Contracts are missed, and so are notices.' });
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-002', title: 'Desk booking' }));
    s = await summary(root, FAKE);
    expect(s).toMatchObject({ chunks: 3, embedded: 1, percent: 33 });
    expect(s.ideas.map((i) => [i.id, i.status])).toEqual([['CAFE-2026-001', 'stale'], ['CAFE-2026-002', 'new']]);
  });

  it('an index built with another embedder counts as unread and is not available', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea({ challenge: 'Contracts are missed.' }));
    const rows = await rowsFor(root);
    await writeIndex(root, rows);
    await writeState(root, { status: 'done', embedder: 'Xenova/other-model', done: 1, total: 1, stale: [] });
    const s = await summary(root, FAKE);
    expect(s).toMatchObject({ embedded: 0, available: false, otherModel: 'Xenova/other-model' });
    expect(s.ideas[0].status).toBe('new');
    expect(await indexAvailable(root, FAKE)).toBe(false);
  });

  it('nearest passages, grouped by idea; idea centres; star labels cached and people never embedded', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-001', title: 'Contract summariser', challenge: 'Vendor contracts and renewal dates are missed.', current_process: 'A paralegal reads every contract.' }));
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-002', title: 'Desk booking', challenge: 'Desks are double booked every morning.' }));
    const rows = await rowsFor(root);
    const q = fakeVector('renewal dates in vendor contracts');
    const hits = nearestChunks(rows, q, 3);
    expect(hits[0].ideaId).toBe('CAFE-2026-001');
    expect(hits[0].section).toBe('title+challenge');
    expect(hits[0].score).toBeGreaterThan(hits[hits.length - 1].score);
    expect(nearestChunks(rows, q, 3, 0.99)).toEqual([]);
    const grouped = groupByIdea(nearestChunks(rows, q, 10));
    expect(grouped[0].ideaId).toBe('CAFE-2026-001');
    expect(grouped[0].hits.length).toBeLessThanOrEqual(2);
    expect(grouped.map((g) => g.ideaId)).toEqual(['CAFE-2026-001', 'CAFE-2026-002']);
    const centres = ideaCentroids(rows);
    expect([...centres.keys()].sort()).toEqual(['CAFE-2026-001', 'CAFE-2026-002']);
    expect(cosine(centres.get('CAFE-2026-001')!, q)).toBeGreaterThan(cosine(centres.get('CAFE-2026-002')!, q));

    let calls = 0;
    const counting = { ...fakeEmbedder(), embed: async (t: string[]) => { calls++; return fakeEmbedder().embed(t); } };
    const nodes = [
      { id: 'capability:invoice-matching', type: 'Capability' as const, label: 'Invoice matching' },
      { id: 'person:person-1', type: 'Person' as const, label: 'Person 1' },
    ];
    const v1 = await labelVectors(root, counting, nodes);
    expect([...v1.keys()]).toEqual(['capability:invoice-matching']);
    expect(v1.get('capability:invoice-matching')).toEqual(fakeVector('Invoice matching'));
    // The second call finds the label in labels.jsonl and embeds nothing.
    const v2 = await labelVectors(root, counting, nodes);
    expect(v2.get('capability:invoice-matching')).toEqual(v1.get('capability:invoice-matching'));
    expect(calls).toBe(1);
  });
});
