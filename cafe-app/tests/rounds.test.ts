import { describe, it, expect } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { tmpWorkspace, sampleIdea } from './helpers';
import { fixedClock } from '../src/clock';
import { saveIdea, loadIdea, ideaDir } from '../src/ideas/store';
import { readHistory } from '../src/workspace/files';
import {
  currentRoundId, createRound, listRounds, listRoundsChecked, loadRound, saveRound, setIdeaRound, assignIdeas, defaultRoundName,
} from '../src/round/store';

const clock = fixedClock('2026-10-22');

async function legacyRound(root: string, id = 'ROUND-2026-Q4') {
  await mkdir(path.join(root, 'data', 'rounds', id), { recursive: true });
  await writeFile(path.join(root, 'data', 'rounds', id, 'round.yaml'), `id: ${id}\n`);
}

describe('rounds', () => {
  it('has no round in a new workspace', async () => {
    const root = await tmpWorkspace();
    expect(await currentRoundId(root)).toBeNull();
    expect(await listRounds(root)).toEqual([]);
  });

  it('names the default round by year and quarter', () => {
    expect(defaultRoundName('2026-10-22')).toBe('2026 Q4');
    expect(defaultRoundName('2027-01-02')).toBe('2027 Q1');
  });

  it('creates numbered rounds with the default name when none is given', async () => {
    const root = await tmpWorkspace();
    const first = await createRound(root, '', clock);
    expect(first).toEqual({ id: 'ROUND-001', name: '2026 Q4', created: '2026-10-22' });
    const stored = YAML.parse(await readFile(path.join(root, 'data', 'rounds', 'ROUND-001', 'round.yaml'), 'utf8'));
    expect(stored).toEqual({ id: 'ROUND-001', name: '2026 Q4', created: '2026-10-22' });
    expect((await createRound(root, '  Spring pilots ', clock))).toMatchObject({ id: 'ROUND-002', name: 'Spring pilots' });
    expect(await currentRoundId(root)).toBe('ROUND-002');
    // A second round with a name already used (any case) is refused, and nothing is written.
    await expect(createRound(root, '2026 q4', clock)).rejects.toThrow('There is already a round called 2026 Q4 (ROUND-001)');
    expect((await listRounds(root)).map((r) => r.id)).toEqual(['ROUND-002', 'ROUND-001']);
    // No name given when the default is taken: it is numbered on.
    expect((await createRound(root, '', clock)).name).toBe('2026 Q4 (2)');
  });

  it('reads a legacy round folder and leaves it out of the numbering', async () => {
    const root = await tmpWorkspace();
    await legacyRound(root);
    expect(await listRounds(root)).toEqual([{ id: 'ROUND-2026-Q4', name: 'ROUND-2026-Q4', created: '' }]);
    expect((await createRound(root, 'Next', clock)).id).toBe('ROUND-001');
  });

  it('lists newest first by created, then by id', async () => {
    const root = await tmpWorkspace();
    await legacyRound(root);
    await createRound(root, 'Old', fixedClock('2026-01-05'));
    await createRound(root, 'New', fixedClock('2026-09-01'));
    await createRound(root, 'Same day', fixedClock('2026-09-01'));
    expect((await listRounds(root)).map((r) => r.id)).toEqual(['ROUND-003', 'ROUND-002', 'ROUND-001', 'ROUND-2026-Q4']);
  });

  it('saves dates on the round it is given', async () => {
    const root = await tmpWorkspace();
    await createRound(root, 'A', clock);
    await createRound(root, 'B', clock);
    await saveRound(root, 'ROUND-001', { deadline: '2026-11-01', id: 'ROUND-HACK', name: 'ignored' });
    expect(await loadRound(root, 'ROUND-001')).toEqual({ id: 'ROUND-001', name: 'A', created: '2026-10-22', deadline: '2026-11-01' });
    expect((await loadRound(root, 'ROUND-002')).deadline).toBeUndefined();
    await expect(saveRound(root, 'ROUND-001', { deadline: '1/11/2026' })).rejects.toThrow('Submission deadline must be a date');
    await expect(saveRound(root, 'ROUND-404', { deadline: '2026-11-01' })).rejects.toThrow('Unknown round');
    // Saving an empty date clears it.
    await saveRound(root, 'ROUND-001', { deadline: '' });
    expect(await loadRound(root, 'ROUND-001')).toEqual({ id: 'ROUND-001', name: 'A', created: '2026-10-22' });
  });

  it('skips a round.yaml it cannot read and reports the folder', async () => {
    const root = await tmpWorkspace();
    await createRound(root, 'Good', clock);
    await legacyRound(root, 'ROUND-002');
    await writeFile(path.join(root, 'data', 'rounds', 'ROUND-002', 'round.yaml'), 'name: [unclosed\n');
    expect((await listRounds(root)).map((r) => r.id)).toEqual(['ROUND-001']);
    const { problems } = await listRoundsChecked(root);
    expect(problems).toEqual([{ folder: 'ROUND-002', message: expect.any(String) }]);
  });

  it('puts many ideas in a round all or nothing, and counts only real changes', async () => {
    const root = await tmpWorkspace();
    await createRound(root, 'Autumn', clock);
    await saveIdea(root, sampleIdea({ round: '' }));
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-002', slug: 'b', round: 'ROUND-001', dedupe_key: 'b' }));
    await expect(assignIdeas(root, 'ROUND-001', ['CAFE-2026-001', 'CAFE-2026-999'], clock)).rejects.toThrow();
    expect((await loadIdea(root, 'CAFE-2026-001')).round).toBe('');
    await expect(assignIdeas(root, 'ROUND-404', ['CAFE-2026-001'], clock)).rejects.toThrow('Unknown round');
    expect(await assignIdeas(root, 'ROUND-001', ['CAFE-2026-001', 'CAFE-2026-002', 'CAFE-2026-001'], clock)).toBe(1);
    expect((await loadIdea(root, 'CAFE-2026-001')).round).toBe('ROUND-001');
  });

  it('puts an idea in a round and takes it out, logging both', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea({ round: '' }));
    await expect(setIdeaRound(root, 'CAFE-2026-001', 'ROUND-404', clock)).rejects.toThrow('Unknown round');
    await createRound(root, 'Autumn', clock);
    expect((await setIdeaRound(root, 'CAFE-2026-001', 'ROUND-001', clock)).round).toBe('ROUND-001');
    expect((await loadIdea(root, 'CAFE-2026-001')).round).toBe('ROUND-001');
    expect((await setIdeaRound(root, 'CAFE-2026-001', '', clock)).round).toBe('');
    const details = (await readHistory(await ideaDir(root, 'CAFE-2026-001'))).map((h) => h.detail);
    expect(details).toEqual(['round set to Autumn', 'round cleared']);
  });
});
