// cafe-app/tests/inbox-flow.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { startServer, sampleIdea, textPdf, imagePdf, MEMO_LINES } from './helpers';
import { fakeProvider } from '../src/ai/providers/fake';
import { createConnector, type Provider } from '../src/ai/connector';
import { DEFAULT_SETTINGS } from '../src/round/round';
import { readAiLinks, appendAiLink } from '../src/graph/store';
import { saveIdea, loadIdea, ideaDir } from '../src/ideas/store';
import { readHistory } from '../src/workspace/files';
import { getItem, updateItem, listItems } from '../src/inbox/store';

const ID = 'CAFE-2026-001';
const reply = `From: team@example.test\nSubject: Re: ${ID} Email scheduler\n\nAbout 40 a week. Two people triage by hand.\n`;
const statuses = (item: any) => item.steps.map((s: any) => `${s.id}:${s.status}`);
const slotFinding = { from: `idea:${ID}`, to: 'capability:slot-finding', rel: 'NEEDS' as const, description: 'd', source: 'ai:fake:earlier', confidence: 1, status: 'confirmed' as const, newNodes: [{ id: 'capability:slot-finding', type: 'Capability' as const, label: 'Slot finding' }] };

let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; vi.unstubAllEnvs(); });

/** The brief's startServer(today, { ai }) adapted: the server takes a connector; the fake answers only with CAFE_AI_FAKE=1. */
const emailsDir = async (root: string) => path.join(await ideaDir(root, ID), 'emails');

async function start(provider: Provider = fakeProvider(), opts: { builder?: string } = {}) {
  vi.stubEnv('CAFE_AI_FAKE', '1');
  const s = await startServer('2026-10-21', { connector: createConnector({ providers: [provider], settings: DEFAULT_SETTINGS }) });
  close = async () => { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); };
  // The idea the reply is about, with the E2 questions sent (so the answers and the reply are Safe).
  const people = { submitter: 'Person 1', team: [], ...(opts.builder ? { builder: opts.builder } : {}) };
  await saveIdea(s.root, sampleIdea({ sent: { E2: '2026-10-20' }, people } as any));
  const folder = (await readdir(path.join(s.root, 'data', 'ideas'))).find((f) => f.startsWith(ID))!;
  const dir = path.join(s.root, 'data', 'ideas', folder, 'emails');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, '001-E2.md'), `---\ntemplate: E2\nidea: ${ID}\nstatus: sent\nsentAt: 2026-10-20\n---\nHi,\n\n1. How many requests a week?\n2. Who does it today?\n`);
  type Res = Omit<Response, 'json'> & { json(): Promise<any> };
  const post = (url: string, body: unknown = {}): Promise<Res> => fetch(`${s.base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const drop = (name: string, text: string | Uint8Array): Promise<Res> => fetch(`${s.base}/api/inbox/drop`, {
    method: 'POST', headers: { 'x-filename': encodeURIComponent(name), 'content-type': typeof text === 'string' ? 'text/plain' : 'application/octet-stream' }, body: text,
  });
  return { ...s, post, drop };
}

describe('the pipeline', () => {
  it('records the eight steps in order for a clean reply and applies answers and links in one run', async () => {
    const s = await start();
    const { item } = await (await s.drop('reply.eml', reply)).json();
    expect(statuses(item)).toEqual(['receive:done', 'read:done', 'screen:done', 'match:done', 'understand:done', 'context:done', 'graph:done', 'check:done']);
    expect(item.steps[4].ms).toBeGreaterThanOrEqual(0);
    expect(item.steps[7].detail).toBe('Done');
    expect(item.status).toBe('applied');
    const links = (await readAiLinks(s.root)).links;
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((l) => l.status === 'confirmed')).toBe(true);
  });
  it('a conflicting reply applies the rest and holds the second builder and the near-duplicate star (needs-you at check)', async () => {
    const s = await start(fakeProvider(), { builder: 'Person 3' });
    await appendAiLink(s.root, slotFinding);
    const { item } = await (await s.drop('reply2.eml', reply.replace('About 40', 'We have a second builder now. About 40'))).json();
    expect(item.steps.at(-1)).toMatchObject({ id: 'check', status: 'needs-you' });
    expect(item.steps.at(-1).detail).toMatch(/2 items wait/);
    const held = item.actions.filter((a: any) => a.held);
    expect(held.map((a: any) => a.held.rule).sort()).toEqual(['contradicts-fact', 'near-duplicate-star']);
    expect(item.actions.find((a: any) => a.action.t === 'reply_received').status).toBe('applied');
    expect(item.status).toBe('triaged');
  });
  it('AI failure: understand failed, the rest skipped, nothing applied without you', async () => {
    const fake = fakeProvider();
    const s = await start({ ...fake, complete: async () => { throw new Error('rate limited'); } });
    const { item } = await (await s.drop('reply.eml', reply)).json();
    expect(statuses(item).slice(4)).toEqual(['understand:failed', 'context:skipped', 'graph:skipped', 'check:skipped']);
    expect(item.steps[4].detail).toMatch(/rate limited/);
    expect(item.problems.join(' ')).toMatch(/by hand/);
    expect(item.actions ?? []).toEqual([]);
    expect((await readAiLinks(s.root)).links.filter((l) => l.source.includes(item.file))).toEqual([]);
    expect(await readdir(await emailsDir(s.root))).toEqual(['001-E2.md']);
  });
  it('a drop that asks Which idea?: match needs you, understand keeps its record, the rest is skipped', async () => {
    const s = await start();
    // No Café ID and no title: only the AI names the idea, and its guess alone is never sure enough.
    const { item } = await (await s.drop('thoughts.txt', 'Some thoughts about requests arriving by email.')).json();
    expect(item.triage.ask).toBe(true);
    expect(statuses(item).slice(3)).toEqual(['match:needs-you', 'understand:done', 'context:skipped', 'graph:skipped', 'check:skipped']);
    expect(item.steps[4].ms).toBeGreaterThanOrEqual(0);
    expect(item.steps[4].detail).not.toMatch(/waiting/);
  });
  it('held at the screen: steps stop at screen with needs-you', async () => {
    const s = await start();
    const { item } = await (await s.drop('people.csv', 'Name,Email,Phone\nA B,a@x.test,+1 555 0100\nC D,c@x.test,+1 555 0101\nE F,e@x.test,+1 555 0102\n')).json();
    expect(item.status).toBe('held');
    expect(statuses(item).slice(0, 3)).toEqual(['receive:done', 'read:done', 'screen:needs-you']);
    expect(item.steps.slice(3).every((x: any) => x.status === 'skipped')).toBe(true);
  });
  it('repeat drop: receive only, says it is the same file, no AI call', async () => {
    const fake = fakeProvider(); let calls = 0;
    const s = await start({ ...fake, complete: async (p: string, o: any) => { calls++; return fake.complete(p, o); } });
    await s.drop('reply.eml', reply);
    const n = calls;
    expect(n).toBeGreaterThan(0);
    const r = await (await s.drop('reply.eml', reply)).json();
    expect(r.duplicate).toBe(true);
    expect(calls).toBe(n);
    expect(r.item.steps[0].detail).toMatch(/Same file/);
  });
  it('reprocess re-runs 4–8 and keeps applied records (no double filing, no double links)', async () => {
    const s = await start();
    const { item } = await (await s.drop('reply.eml', reply)).json();
    const links = (await readAiLinks(s.root)).links.length;
    const again = await (await s.post(`/api/inbox/${item.id}/process`, {})).json();
    expect(again.item.actions.filter((a: any) => a.action.t === 'file_email')).toHaveLength(1);
    expect((await readAiLinks(s.root)).links.length).toBe(links);
    expect(statuses(again.item).slice(3)).toEqual(['match:done', 'understand:done', 'context:done', 'graph:done', 'check:done']);
  });
  it('apply with resolve use-existing rewrites the held link to the existing star', async () => {
    const s = await start(fakeProvider(), { builder: 'Person 3' });
    // The existing star hangs off another idea, so the rewritten link is a new edge (the very same edge would add nothing).
    await saveIdea(s.root, sampleIdea({ id: 'CAFE-2026-002', slug: 'slots', title: 'Slots', dedupe_key: 'slots|person 1' }));
    await appendAiLink(s.root, { ...slotFinding, from: 'idea:CAFE-2026-002' });
    const { item } = await (await s.drop('reply2.eml', reply.replace('About 40', 'second builder. About 40'))).json();
    const dup = item.actions.find((a: any) => a.held?.rule === 'near-duplicate-star');
    const r = await (await s.post(`/api/inbox/${item.id}/apply`, { actionIds: [dup.id], resolve: { [dup.id]: 'use-existing' } })).json();
    expect(r.item.actions.find((a: any) => a.id === dup.id).status).toBe('applied');
    const links = (await readAiLinks(s.root)).links.filter((l) => l.source.includes('reply2'));
    expect(links.some((l) => l.to === 'capability:slot-finding' && l.status === 'confirmed')).toBe(true);
    expect(links.some((l) => l.to === 'capability:slot-findings')).toBe(false);
    // Run again (after saying no to the second builder): the resolved star is not proposed again.
    const builder = item.actions.find((a: any) => a.held?.rule === 'contradicts-fact');
    await s.post(`/api/inbox/${item.id}/dismiss-action`, { actionId: builder.id });
    const again = await (await s.post(`/api/inbox/${item.id}/process`, {})).json();
    expect(again.item.actions.filter((a: any) => a.status === 'pending')).toEqual([]);
    expect(again.item.actions.filter((a: any) => a.held?.rule === 'near-duplicate-star')).toHaveLength(1);
    expect(again.item.steps.at(-1)).toMatchObject({ id: 'check', status: 'done' });
  });
  it('apply refuses an unknown resolve', async () => {
    const s = await start(fakeProvider(), { builder: 'Person 3' });
    const { item } = await (await s.drop('reply2.eml', reply.replace('About 40', 'second builder. About 40'))).json();
    const h = item.actions.find((a: any) => a.held);
    const r = await s.post(`/api/inbox/${item.id}/apply`, { actionIds: [h.id], resolve: { [h.id]: 'merge-all' } });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/Unknown resolve/);
  });
  it('dismiss-action drops a held record', async () => {
    const s = await start(fakeProvider(), { builder: 'Person 3' });
    const { item } = await (await s.drop('reply2.eml', reply.replace('About 40', 'second builder. About 40'))).json();
    const h = item.actions.find((a: any) => a.held?.rule === 'contradicts-fact');
    const r = await (await s.post(`/api/inbox/${item.id}/dismiss-action`, { actionId: h.id })).json();
    expect(r.item.actions.find((a: any) => a.id === h.id)).toMatchObject({ status: 'undone', note: 'Dropped by you' });
    expect((await loadIdea(s.root, ID)).people).toMatchObject({ builder: 'Person 3' });
    // Run again: what you dropped is not proposed again, and the history says it understood the file once.
    const again = await (await s.post(`/api/inbox/${item.id}/process`, {})).json();
    expect(again.item.actions.filter((a: any) => a.held?.rule === 'contradicts-fact')).toEqual([expect.objectContaining({ status: 'undone', note: 'Dropped by you' })]);
    expect(again.item.steps.at(-1)).toMatchObject({ id: 'check', status: 'done' });
    const understood = (await readHistory(await ideaDir(s.root, ID))).filter((h) => h.detail?.startsWith('Understood: '));
    expect(understood).toHaveLength(1);
  });
});

describe('final review fixes', () => {
  const twoStars = {
    what: 'A reply about slot finding', understood: ['Slots come from a calendar feed'], kind: 'reply', ideaId: ID, matchConfidence: 0.95,
    facts: {
      answers: [], replyReceived: true, builderNamed: null, newFlags: [], stageHint: null,
      graph: {
        nodes: [{ type: 'Capability', label: 'Slot findings' }, { type: 'System', label: 'Calendar feed' }],
        links: [{ from: 'Slot findings', to: 'Calendar feed', rel: 'USES_DATA', description: 'Reads the calendar feed', confidence: 0.85 }],
      },
    },
    uncertain: [],
  };
  it('use-existing on a held link with two new stars rewrites only the matched end, keeps the other star, no self-link', async () => {
    const fake = fakeProvider();
    const s = await start({ ...fake, complete: async (p: string, o: any) => (p.startsWith('TASK: understand') ? JSON.stringify(twoStars) : fake.complete(p, o)) });
    await saveIdea(s.root, sampleIdea({ id: 'CAFE-2026-002', slug: 'slots', title: 'Slots', dedupe_key: 'slots|person 1' }));
    await appendAiLink(s.root, { ...slotFinding, from: 'idea:CAFE-2026-002' });
    const { item } = await (await s.drop('slots.eml', reply)).json();
    const dup = item.actions.find((a: any) => a.held?.rule === 'near-duplicate-star');
    expect(dup.held).toMatchObject({ existing: 'capability:slot-finding', node: 'capability:slot-findings' });
    const r = await (await s.post(`/api/inbox/${item.id}/apply`, { actionIds: [dup.id], resolve: { [dup.id]: 'use-existing' } })).json();
    expect(r.item.actions.find((a: any) => a.id === dup.id).status).toBe('applied');
    const links = (await readAiLinks(s.root)).links.filter((l) => l.source.includes('slots'));
    expect(links.every((l) => l.from !== l.to)).toBe(true);
    const l = links.find((x) => x.rel === 'USES_DATA')!;
    expect(l).toMatchObject({ from: 'capability:slot-finding', to: 'system:calendar-feed', status: 'confirmed' });
    expect((l.newNodes ?? []).map((n) => n.id)).toEqual(['system:calendar-feed']);
  });
  it('process with an ideaId checks the idea exists and refuses once something is applied', async () => {
    const s = await start();
    // Nothing applied yet (it asks Which idea?): an idea that doesn't exist is refused.
    const ask = (await (await s.drop('thoughts.txt', 'Some thoughts about requests arriving by email.')).json()).item;
    const none = await s.post(`/api/inbox/${ask.id}/process`, { ideaId: 'CAFE-2026-999' });
    expect(none.status).toBe(400);
    expect((await none.json()).error).toMatch(/No idea CAFE-2026-999/);
    // Something applied: picking again is refused until it is undone.
    const { item } = await (await s.drop('reply.eml', reply)).json();
    const applied = await s.post(`/api/inbox/${item.id}/process`, { ideaId: ID });
    expect(applied.status).toBe(400);
    expect((await applied.json()).error).toMatch(/Undo what was done first/);
  });
  it('the check step names no one: an unheld builder proposal is described without the name', async () => {
    const s = await start();
    const { item } = await (await s.drop('reply2.eml', reply.replace('About 40', 'We have a second builder now. About 40'))).json();
    const check = item.steps.at(-1);
    expect(check).toMatchObject({ id: 'check', status: 'needs-you' });
    expect(check.detail).not.toMatch(/Person 9/);
    expect(check.detail).toBe('1 item waits: a builder is named');
  });
  it('a running step older than 180 s is reported as failed (interrupted), the sidecar is not rewritten', async () => {
    const s = await start();
    const { item } = await (await s.drop('reply.eml', reply)).json();
    const steps = item.steps.map((x: any) => (x.id === 'understand' ? { ...x, status: 'running', at: new Date(Date.now() - 181_000).toISOString() } : x));
    await updateItem(s.root, item.id, { steps });
    const v: any = await (await fetch(`${s.base}/api/inbox`)).json();
    const u = v.items.find((i: any) => i.id === item.id).steps.find((x: any) => x.id === 'understand');
    expect(u).toMatchObject({ status: 'failed', detail: 'interrupted' });
    expect((await getItem(s.root, item.id))!.steps!.find((x) => x.id === 'understand')!.status).toBe('running');
    // A step running for less than that is still running.
    await updateItem(s.root, item.id, { steps: item.steps.map((x: any) => (x.id === 'understand' ? { ...x, status: 'running', at: new Date().toISOString() } : x)) });
    const v2: any = await (await fetch(`${s.base}/api/inbox`)).json();
    expect(v2.items.find((i: any) => i.id === item.id).steps.find((x: any) => x.id === 'understand').status).toBe('running');
  });
  it('a re-run honours the screen: a file that now fails the screen is held, as on a first run', async () => {
    const s = await start();
    const { item } = await (await s.drop('reply.eml', reply)).json();
    expect(item.status).toBe('applied');
    await writeFile(path.join(s.root, 'data', ...item.file.split('/')), `${reply}\nHer salary and passport number are below.\n`);
    const r = await s.post(`/api/inbox/${item.id}/process`, {});
    const again = (await r.json()).item;
    expect(again.status).toBe('held');
    expect(again.steps.find((x: any) => x.id === 'screen')).toMatchObject({ status: 'needs-you' });
    expect(again.steps.filter((x: any) => ['match', 'understand', 'context', 'graph', 'check'].includes(x.id)).every((x: any) => x.status === 'skipped')).toBe(true);
  });
});

describe('pictures and PDFs', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const desk = () => sampleIdea({ id: 'CAFE-2026-002', slug: 'desk-booking', title: 'Desk booking', dedupe_key: 'desk booking|person 4', people: { submitter: 'Person 4', team: [] } } as any);
  const spying = () => { const fake = fakeProvider(); const look = vi.fn(fake.look!); return { provider: { ...fake, look }, look }; };

  it('a whiteboard picture is read by the AI, matched by its Café ID and its stars added', async () => {
    const { provider, look } = spying();
    const s = await start(provider);
    await saveIdea(s.root, desk());
    const { item } = await (await s.drop('14-whiteboard.png', PNG)).json();
    expect(look).toHaveBeenCalledTimes(1);
    const read = item.steps.find((x: any) => x.id === 'read');
    expect(read.status).toBe('done');
    expect(read.detail).toMatch(/^Picture read by the AI, \d+\.\d s, 20 words$/);
    expect(typeof read.ms).toBe('number');
    expect(item.type).toBe('note');
    expect(item.meta).toMatchObject({ readBy: 'ai', notes: 'A whiteboard photo with a bulleted list', words: 20 });
    expect(item.triage.ideaId).toBe('CAFE-2026-002');
    expect(item.steps.find((x: any) => x.id === 'graph')).toMatchObject({ status: 'done' });
    const links = (await readAiLinks(s.root)).links.filter((l) => l.source.includes(item.file));
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((l) => l.status === 'confirmed')).toBe(true);
    expect(links.map((l) => `${l.from} ${l.to}`)).toContain('idea:CAFE-2026-002 capability:desk-finding');
  });

  it('a pick for a picture that asked "Which idea?" keeps the transcription; only Run again looks again', async () => {
    const fake = fakeProvider();
    const look = vi.fn(async () => JSON.stringify({ text: 'Some thoughts about requests arriving by email.', notes: 'A note', readable: true }));
    const s = await start({ ...fake, look });
    await saveIdea(s.root, desk());
    const { item } = await (await s.drop('thoughts.png', PNG)).json();
    expect(item.triage.ask).toBe(true);
    const chosen = (await (await s.post(`/api/inbox/${item.id}/choose`, { ideaId: 'CAFE-2026-002' })).json()).item;
    expect(look).toHaveBeenCalledTimes(1);
    expect(chosen.triage.ideaId).toBe('CAFE-2026-002');
    expect(chosen.problems ?? []).toEqual([]);
    expect((await getItem(s.root, item.id))!.text).toBe('Some thoughts about requests arriving by email.');
    // Run again (no pick) has the AI read the picture again.
    await s.post(`/api/inbox/${item.id}/process`);
    expect(look).toHaveBeenCalledTimes(2);
  });

  it('a text PDF is read by code: the AI never looks', async () => {
    const { provider, look } = spying();
    const s = await start(provider);
    const { item } = await (await s.drop('12-text.pdf', textPdf(MEMO_LINES))).json();
    expect(look).not.toHaveBeenCalled();
    expect(item.type).toBe('document');
    expect(item.steps.find((x: any) => x.id === 'read').detail).toMatch(/^PDF, 1 page, \d+ words$/);
    expect(item.meta).toMatchObject({ pages: 1 });
    expect(item.meta.readBy).toBeUndefined();
  });

  it('a scanned PDF (no text layer) goes the picture way and keeps its pages', async () => {
    const { provider, look } = spying();
    const s = await start(provider);
    await saveIdea(s.root, desk());
    const { item } = await (await s.drop('15-scanned.pdf', imagePdf())).json();
    expect(look).toHaveBeenCalledTimes(1);
    expect(item.steps.find((x: any) => x.id === 'read').detail).toMatch(/^Scanned PDF read by the AI, \d+\.\d s, 20 words$/);
    expect(item.type).toBe('note');
    expect(item.meta).toMatchObject({ readBy: 'ai', pages: 1 });
    expect(item.triage.ideaId).toBe('CAFE-2026-002');
  });

  it('a picture of a tracker is held at the screen and its transcription is not kept', async () => {
    const s = await start();
    const { item } = await (await s.drop('tracker.png', PNG)).json();
    expect(item.status).toBe('held');
    expect(item.steps.find((x: any) => x.id === 'screen').status).toBe('needs-you');
    const stored = (await getItem(s.root, item.id))!;
    expect(stored.text).toBe('');
    expect(stored.meta).toEqual({ readBy: 'ai' });
    expect(stored.hold!.reasons).toContain('The text was not kept.');
    expect(item.steps.find((x: any) => x.id === 'screen').detail).toMatch(/^Lists \d+ people by name\. The text was not kept\.$/);
    expect(JSON.stringify(stored)).not.toMatch(/Person 5|EMP-|555-/);
  });

  it('while the AI looks, the Read step is running and says so', async () => {
    const fake = fakeProvider();
    let root = '';
    let during: any;
    const s = await start({ ...fake, look: async (file: string, prompt: string, o: any) => {
      during = (await listItems(root))[0].steps?.find((x) => x.id === 'read');
      return fake.look!(file, prompt, o);
    } });
    root = s.root;
    await saveIdea(s.root, desk());
    await s.drop('14-whiteboard.png', PNG);
    expect(during).toMatchObject({ status: 'running', detail: 'Picture: the AI is reading it…' });
  });

  it('a blank picture is held with the AI\'s note', async () => {
    const s = await start();
    const { item } = await (await s.drop('blank.png', PNG)).json();
    expect(item.status).toBe('held');
    expect(item.hold.reasons).toEqual(["Can't read this picture: A blank picture"]);
  });

  it('a picture with an AI that cannot look is held: it needs Claude Code', async () => {
    const { look: _no, ...fake } = fakeProvider();
    const s = await start(fake);
    const { item } = await (await s.drop('14-whiteboard.png', PNG)).json();
    expect(item.status).toBe('held');
    expect(item.hold.reasons).toEqual(['Reading pictures needs Claude Code (AI helper → provider)']);
  });

  it('a .bmp is held: the format is not supported', async () => {
    const s = await start();
    const { item } = await (await s.drop('photo.bmp', PNG)).json();
    expect(item.status).toBe('held');
    expect(item.hold.reasons).toEqual(["This picture format isn't supported; save it as PNG or JPG"]);
  });
});
