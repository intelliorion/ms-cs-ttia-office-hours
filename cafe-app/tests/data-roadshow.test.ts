import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { startServer, sampleIdea } from './helpers';
import { saveIdea, loadIdea, ideaDir } from '../src/ideas/store';
import { createConnector, type Provider } from '../src/ai/connector';
import { fakeProvider } from '../src/ai/providers/fake';
import { DEFAULT_SETTINGS } from '../src/round/round';
import { checkDeck } from '../src/roadshow/deck';
import { expenseCsv, outputCsv, rulesXlsx } from './dataFixtures';

const ID = 'CAFE-2026-004';
let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; vi.unstubAllEnvs(); });

describe('the roadshow tells the data', () => {
  it('checkDeck adds a data slide after the solution when the data can be drawn, and gives a data slide its visual', () => {
    const slide = (kind: string) => ({ kind, title: kind, points: [], notes: 'n', minutes: 1 }) as any;
    const { spec, warnings } = checkDeck({ title: 'T', subtitle: '', slides: [slide('title'), slide('problem'), slide('solution'), slide('demo')] }, { visuals: ['data'], data: '', hasTeam: false });
    expect(spec.slides.map((s) => s.kind)).toEqual(['title', 'problem', 'solution', 'data', 'demo']);
    expect(spec.slides[3].visual).toBe('data');
    expect(warnings).toContain('Added the data slide');
    expect(checkDeck({ title: 'T', subtitle: '', slides: [slide('title'), slide('data')] }, { visuals: ['data'], data: '', hasTeam: false }).spec.slides[1].visual).toBe('data');
    expect(checkDeck({ title: 'T', subtitle: '', slides: [slide('title'), slide('solution')] }, { visuals: [], data: '', hasTeam: false }).spec.slides.map((s) => s.kind)).toEqual(['title', 'solution']);
  });

  it('with confirmed data, the deck has "The data" slide (what goes in, what comes out), the before-after opens with the files, the script says it', async () => {
    vi.stubEnv('CAFE_AI_FAKE', '1');
    const prompts: string[] = [];
    const spy: Provider = { ...fakeProvider(), async complete(p, o) { prompts.push(p); return fakeProvider().complete(p, o); } };
    const s = await startServer('2026-10-20', { connector: createConnector({ providers: [spy], settings: DEFAULT_SETTINGS }) });
    close = async () => { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); };
    const post = async (url: string, body: unknown = {}) => (await fetch(`${s.base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<any>;
    const drop = (name: string, bytes: Uint8Array | string, kind: string) => fetch(`${s.base}/api/ideas/${ID}/data/drop`, {
      method: 'POST', body: typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes,
      headers: { 'x-filename': encodeURIComponent(name), 'x-kind': kind, 'content-type': 'application/octet-stream' },
    }).then((r) => r.json());
    await saveIdea(s.root, sampleIdea({ id: ID, slug: 'expense-anomaly-finder', title: 'Expense anomaly finder', stage: 3, challenge: 'Claims are checked by hand.', current_process: 'An analyst checks each claim by eye.' }));
    await drop('expenses.csv', expenseCsv(30), 'input');
    await drop('caps.xlsx', await rulesXlsx(), 'rules');
    await drop('flagged.csv', outputCsv(), 'output');
    for (let k = 0; k < 4; k++) {
      const r = await post(`/api/ideas/${ID}/data/step`);
      if (r.step) await post(`/api/ideas/${ID}/data/answer`, { n: r.step.n, suggestedIndex: 0 });
      if (r.done) break;
    }
    await post(`/api/ideas/${ID}/data/confirm`);
    // Launch and Learn (moved here by hand, as an operator would).
    await saveIdea(s.root, { ...(await loadIdea(s.root, ID)), stage: 4 });
    prompts.length = 0;
    const view = await post(`/api/ideas/${ID}/roadshow/build`);
    const deckPrompt = prompts.find((p) => p.startsWith('TASK: roadshow-deck'))!;
    expect(deckPrompt).toMatch(/Add a "data" slide/);
    expect(deckPrompt).toContain('"visuals"');
    expect(view.deck.slides.find((x: any) => x.kind === 'data')).toMatchObject({ visual: 'data' });
    const dir = path.join(await ideaDir(s.root, ID), 'roadshow');
    const html = await readFile(path.join(dir, 'deck.html'), 'utf8');
    expect(html).toContain('What goes in');
    expect(html).toContain('expenses.csv');
    expect(html).toContain('caps.xlsx');
    expect(html).toContain('flagged.csv');
    expect(html).toContain('<span>policy_type</span>');
    const script = await readFile(path.join(dir, 'script.md'), 'utf8');
    expect(script).toMatch(/The data/);
    // The before-after opens with the files: the sample output is what it makes.
    expect(html).toContain('It makes: flagged.csv');
    expect((await readFile(path.join(dir, 'deck.pptx'))).length).toBeGreaterThan(10_000);
  });
});
