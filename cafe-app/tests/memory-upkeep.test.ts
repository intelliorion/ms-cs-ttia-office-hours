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
  hasIndex: true, indexEmbedder: 'fake', embedder: 'fake', on: true, status: 'done',
  ideas: [idea('CAFE-2026-003', ['a', 'b', 'c'], ['a', 'b'])],
  ...over,
});

describe('decide()', () => {
  it('1. never the first run: no index, or no embedder recorded', () => {
    expect(decide(trig(), ready({ hasIndex: false }))).toEqual({ act: 'skip', ideas: ['CAFE-2026-003'], why: 'Deep read has not been run yet', passages: 0 });
    expect(decide(trig(), ready({ indexEmbedder: undefined })).why).toBe('Deep read has not been run yet');
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
  it('the rules hold in order: the first run wins over the switch, the model over the pause, the pause over the run', () => {
    expect(decide(trig(), ready({ hasIndex: false, on: false, status: 'running' })).why).toBe('Deep read has not been run yet');
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
  });
});
