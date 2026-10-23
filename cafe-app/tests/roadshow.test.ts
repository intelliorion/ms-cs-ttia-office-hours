import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import os from 'node:os';
import { unzipSync, strFromU8, zipSync, strToU8 } from 'fflate';
import { startServer, sampleIdea, tmpWorkspace } from './helpers';
import { saveIdea, loadIdea, ideaDir } from '../src/ideas/store';
import { emptyDesign, writeDesign, type DesignState } from '../src/design/store';
import { createConnector, LONGEST_TIMEOUT_MS, type Provider } from '../src/ai/connector';
import { fakeProvider } from '../src/ai/providers/fake';
import { DEFAULT_SETTINGS } from '../src/round/round';
import { fixedClock } from '../src/clock';
import {
  roadshowDeckTask, roadshowPrepTask, ROADSHOW_DECK_SCHEMA, ROADSHOW_PREP_SCHEMA, DECK_KINDS, type DeckSpec,
} from '../src/ai/tasks';
import { imageKind, imageSize, cleanPhotoPath, readPhotoFile, PhotoError, setPhotoFromPath, removePhoto, PHOTO_MAX_BYTES } from '../src/roadshow/photos';
import { rosterOf, readRoadshow, initialsOf, rolesLine } from '../src/roadshow/store';
import { checkDeck, unknownFigures, decodeDeck, processLines, demoLinkOf } from '../src/roadshow/deck';
import { planOf, datesOf, gatherRoadshow } from '../src/roadshow/source';
import { themeFromTemplate, readTemplateTheme } from '../src/roadshow/template';
import { FEEDBACK_QUESTIONS } from '../src/roadshow/render/text';
import { mergeNeeds } from '../src/review/needs';

const ID = 'CAFE-2026-001';
const json = (r: Response) => r.json() as Promise<any>;
let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; vi.unstubAllEnvs(); });

/* ---------- synthetic pictures (never a real photo) ---------- */
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
/** A plain coloured PNG made in code. */
function png(w: number, h: number, rgb: [number, number, number] = [40, 90, 200]): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** The smallest JPEG header the size reader needs (SOI, then a SOF0 with 30 × 20). */
const jpeg = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x14, 0x00, 0x1e, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]);
const gif = () => Buffer.from('GIF89a\x10\x00\x08\x00\x00\x00\x00;', 'latin1');

async function pictures() {
  const dir = await import('node:fs/promises').then((f) => f.mkdtemp(path.join(os.tmpdir(), 'cafe-photos-')));
  const a = path.join(dir, 'person-a.png'); await writeFile(a, png(24, 24));
  const b = path.join(dir, 'person-b.jpg'); await writeFile(b, jpeg());
  const fakePng = path.join(dir, 'notes.png'); await writeFile(fakePng, 'plain text, not a picture');
  const folder = path.join(dir, 'album.png'); await mkdir(folder);
  const text = path.join(dir, 'secrets.txt'); await writeFile(text, 'nothing to see');
  const big = path.join(dir, 'big.png'); await writeFile(big, Buffer.concat([png(4, 4), Buffer.alloc(PHOTO_MAX_BYTES)]));
  return { dir, a, b, fakePng, folder, text, big };
}

/* ---------- an idea in Launch and Learn ---------- */
const TEAM = { submitter: 'Person 1', team: [{ name: 'Person 1', roles: ['lead' as const] }, { name: 'Person 2', roles: ['builder' as const] }, { name: 'Person 3', roles: ['sponsor' as const] }] };
const DESIGN: DesignState = {
  ...emptyDesign(), status: 'approved', approvedAt: '2026-10-21',
  features: [
    { id: 'a', name: 'Weekend spend check', what: 'Flags weekend claims', flags: [] },
    { id: 'b', name: 'Query drafting', flags: [], scope: { status: 'outside', by: 'Microsoft Copilot' } },
  ],
  tool: {
    tool: 'Dataiku', pathway: 'Citizen-Led', by: 'operator', reason: 'Rules over a table', pros: ['Reads a spreadsheet'], cons: ['Cannot send emails'],
    context: [], flags: [], fit: [{ feature: 'Weekend spend check', fit: 'yes', note: 'A date rule' }], evaluatedFor: ['Weekend spend check'], at: '2026-10-20',
  },
  steps: [
    { n: 1, question: 'What must it show?', suggested: [], source: 'operator', tag: 'must-show', answer: 'Every weekend claim flagged' },
    { n: 2, question: 'Who builds it?', suggested: [], source: 'operator', tag: 'builder', answer: 'Person 2 builds it in Dataiku' },
  ],
  summary: 'A Dataiku flow that flags weekend claims in a sample of 40 claims, built by Person 2.',
};
async function seed(root: string) {
  await saveIdea(root, sampleIdea({
    stage: 4, title: 'Weekend claim checker', people: TEAM, challenge: 'Person 1 checks 40 claims a week by eye.',
    current_process: '1) Pull a sample\n2) Check each claim by eye\n3) Email the claimant',
    business_impact: 'Saves 200 hours a year', review: { decision: 'select', reason: 'Person 2 can build it', criteria: {}, at: '2026-10-19' },
    checklist: { s1d: { done: true, by: 'app', at: '2026-10-10' }, s3e: { done: true, by: 'app', at: '2026-10-20' } },
  }));
  await writeDesign(root, ID, DESIGN);
  const dir = await ideaDir(root, ID);
  await writeFile(path.join(dir, 'plan.md'), '# Plan\n\n## Tasks\n\n- [x] **Make the sample**\n  Done when: ok\n- [ ] **Build the flow**\n  Done when: ok\n\n## Risks\n\n- The sample may miss a case\n');
}

/** A provider that answers like the fake, and records every prompt. */
function spy(over: (prompt: string) => string | undefined = () => undefined) {
  const prompts: string[] = [];
  const fake = fakeProvider();
  const provider: Provider = { ...fake, complete: async (p, o) => { prompts.push(p); return over(p) ?? fake.complete(p, o); } };
  return { prompts, provider };
}
async function server(provider: Provider = fakeProvider()) {
  vi.stubEnv('CAFE_AI_FAKE', '1');
  const s = await startServer('2026-10-23', { connector: createConnector({ providers: [provider], settings: DEFAULT_SETTINGS }) });
  close = async () => { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); };
  const post = (url: string, body: unknown = {}) => fetch(`${s.base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const get = (url: string) => fetch(`${s.base}${url}`);
  await seed(s.root);
  return { ...s, post, get, rs: `/api/ideas/${ID}/roadshow` };
}

describe('the two AI tasks', () => {
  it('roadshow-prep: a to-do list and the brief; schema-checked', () => {
    expect(ROADSHOW_PREP_SCHEMA.required).toEqual(['needs', 'learned']);
    const out = roadshowPrepTask.parse(JSON.stringify({ needs: [{ need: 'What was hard', ask: 'What\nwas hard?', met: false }], learned: [] }));
    expect(out.needs[0].ask).toBe('What was hard?');
    expect(() => roadshowPrepTask.parse(JSON.stringify({ needs: [] }))).toThrow(/invalid output/);
    const p = roadshowPrepTask.prompt({ idea: { id: ID, title: 'x' }, team: [{ code: '[P1]', roles: ['Lead'] }], dates: [], visuals: [], todo: [{ need: 'n', ask: 'a' }] });
    expect(p.startsWith('TASK: roadshow-prep')).toBe(true);
    expect(p).toMatch(/Only ask what DATA does not already hold/);
    expect(p).toMatch(/never ask for a name/);
    expect(p).toMatch(/return on investment/);
    expect(p).toContain('"todo"');
  });
  it('roadshow-deck: a strict spec (kinds, visuals, sizes), a long time limit, the E10 structure and the Café rules in the prompt', () => {
    expect(ROADSHOW_DECK_SCHEMA.required).toEqual(['title', 'subtitle', 'slides']);
    expect(DECK_KINDS).toContain('headaches');
    expect(roadshowDeckTask.timeoutMs).toBe(300_000);
    expect(LONGEST_TIMEOUT_MS).toBeGreaterThanOrEqual(300_000);
    const slide = (kind: string) => ({ kind, title: 'T', points: [], notes: 'Say it.', minutes: 1 });
    const ok = { title: 'Deck', subtitle: '', slides: ['title', 'problem', 'team', 'demo', 'question', 'thanks'].map(slide) };
    expect(roadshowDeckTask.parse(JSON.stringify(ok)).slides).toHaveLength(6);
    expect(() => roadshowDeckTask.parse(JSON.stringify({ ...ok, slides: [...ok.slides.slice(0, 5), slide('agenda')] }))).toThrow(/invalid output/);
    expect(() => roadshowDeckTask.parse(JSON.stringify({ ...ok, slides: ok.slides.slice(0, 3) }))).toThrow(/invalid output/);
    expect(() => roadshowDeckTask.parse(JSON.stringify({ ...ok, slides: ok.slides.map((s) => ({ ...s, visual: 'chart' })) }))).toThrow(/invalid output/);
    const p = roadshowDeckTask.prompt({ idea: { id: ID, title: 'x' }, team: [], dates: [], visuals: ['team'] });
    expect(p.startsWith('TASK: roadshow-deck')).toBe(true);
    expect(p).toMatch(/one question for the room/i);
    expect(p).toMatch(/notes: the speaker script/);
    expect(p).toMatch(/never put a figure in that DATA does not hold/);
  });
});

describe('photos: checked, then copied into the idea folder', () => {
  it('tells a picture by its bytes, and its size from its header', () => {
    expect(imageKind(png(3, 2))).toBe('png');
    expect(imageSize(png(30, 20))).toEqual({ w: 30, h: 20 });
    expect(imageKind(jpeg())).toBe('jpg');
    expect(imageSize(jpeg())).toEqual({ w: 30, h: 20 });
    expect(imageKind(gif())).toBe('gif');
    expect(imageSize(gif())).toEqual({ w: 16, h: 8 });
    expect(imageKind(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(imageKind(Buffer.from('%PDF-1.4'))).toBeUndefined();
  });
  it('reads a pasted path: quotes off, ~ for home, a file:// link; a relative path is refused', () => {
    expect(cleanPhotoPath('"/Users/x/a photo.png"')).toBe('/Users/x/a photo.png');
    expect(cleanPhotoPath('~/p.jpg')).toBe(path.join(os.homedir(), 'p.jpg'));
    expect(cleanPhotoPath('file:///Users/x/a%20b.png')).toBe('/Users/x/a b.png');
    expect(cleanPhotoPath('C:\\Users\\x\\p.png')).toBe('C:\\Users\\x\\p.png');
    expect(() => cleanPhotoPath('photo.png')).toThrow(/full path/);
    expect(() => cleanPhotoPath('  ')).toThrow(PhotoError);
  });
  it('refuses anything that is not a picture, with a plain message, and never a folder or a file over 5 MB', async () => {
    const f = await pictures();
    await expect(readPhotoFile(f.text)).rejects.toThrow(/Only a picture/);
    await expect(readPhotoFile(f.fakePng)).rejects.toThrow(/not a picture/);
    await expect(readPhotoFile(f.folder)).rejects.toThrow(/folder/);
    await expect(readPhotoFile(f.big)).rejects.toThrow(/over 5 MB/);
    await expect(readPhotoFile(path.join(f.dir, 'missing.png'))).rejects.toThrow(/No file at/);
    const ok = await readPhotoFile(f.a);
    expect(ok.kind).toBe('png');
  });
  it('copies the picture to roadshow/photos/<person>.<ext>; a new one replaces it; Remove takes the copy off, never the original', async () => {
    const root = await tmpWorkspace();
    await seed(root);
    const f = await pictures();
    const clock = fixedClock('2026-10-23');
    const people = rosterOf(await loadIdea(root, ID));
    expect(people.map((p) => [p.key, p.name, rolesLine(p.roles)])).toEqual([
      ['person-1', 'Person 1', 'Lead · Submitted the idea'], ['person-2', 'Person 2', 'Builder'], ['person-3', 'Person 3', 'Sponsor'],
    ]);
    let st = await setPhotoFromPath(root, ID, 'person-2', f.a, clock);
    const photos = path.join(await ideaDir(root, ID), 'roadshow', 'photos');
    expect(st.photos['person-2']).toMatchObject({ file: 'person-2.png', from: 'path', at: '2026-10-23' });
    expect(await readFile(path.join(photos, 'person-2.png'))).toEqual(await readFile(f.a));
    st = await setPhotoFromPath(root, ID, 'person-2', f.b, clock);
    expect(st.photos['person-2'].file).toBe('person-2.jpg');
    expect(await readdir(photos)).toEqual(['person-2.jpg']);
    await expect(setPhotoFromPath(root, ID, 'nobody', f.a, clock)).rejects.toThrow(/not on this idea/);
    st = await removePhoto(root, ID, 'person-2');
    expect(st.photos).toEqual({});
    expect(await readdir(photos)).toEqual([]);
    expect((await stat(f.b)).isFile()).toBe(true);
    expect((await readRoadshow(root, ID)).photos).toEqual({});
  });
  it('the roster: the submitter first (added when the team does not list them), each person once, initials for no photo', () => {
    const idea = sampleIdea({ people: { submitter: 'Person 9', team: [{ name: 'Person 2', roles: ['builder', 'member'] }, { name: 'person 2', roles: ['lead'] }] } });
    const r = rosterOf(idea);
    expect(r.map((p) => p.name)).toEqual(['Person 9', 'Person 2']);
    expect(r[0].roles).toEqual(['submitter']);
    expect(initialsOf('Person Nine Two')).toBe('PT');
    expect(initialsOf('Ada')).toBe('A');
  });
});

describe('the deck spec is checked by the code', () => {
  const base = (slides: Partial<DeckSpec['slides'][number]>[]): DeckSpec => ({
    title: 'Weekend claim checker', subtitle: '', slides: slides.map((s) => ({ kind: 'problem', title: 'T', points: [], notes: 'Say it.', minutes: 1, ...s })) as DeckSpec['slides'],
  });
  const data = JSON.stringify({ challenge: 'Person 1 checks 40 claims a week by eye. 12,000 claims a month.' });
  it('takes out value claims and figures the record does not hold (a point, or a sentence of the script)', () => {
    const { spec, warnings } = checkDeck(base([
      { kind: 'title' },
      { kind: 'problem', points: ['We check 40 claims a week', 'Saves 300 hours a year', 'A clear ROI', 'About 12,000 claims a month', 'Huge cost savings'], notes: 'We check 40 claims. It saves 300 hours. Thank you.' },
      { kind: 'team' },
      { kind: 'demo', points: ['Two minutes on the demo'], notes: 'This takes 10 minutes of talk.' },
    ]), { visuals: ['team'], data, hasTeam: true });
    expect(spec.slides[1].points).toEqual(['We check 40 claims a week', 'About 12,000 claims a month']);
    expect(spec.slides[1].notes).toBe('We check 40 claims. Thank you.');
    expect(spec.slides[3].notes).toBe('This takes 10 minutes of talk.');
    expect(warnings.join('\n')).toMatch(/took out "Saves 300 hours a year" \(a figure the record does not hold\)/);
    expect(warnings.join('\n')).toMatch(/took out "A clear ROI" \(a value claim\)/);
    expect(unknownFigures('Up 35% and 7 days', data)).toEqual(['35%']);
  });
  it('opens with a title slide, has the team slide when the idea has people, keeps only visuals the app can draw, scales the timings to about ten minutes', () => {
    const { spec, warnings } = checkDeck(base([
      { kind: 'problem', minutes: 0.5 }, { kind: 'today', visual: 'diagram', minutes: 0.5 }, { kind: 'tool', minutes: 0.5 }, { kind: 'demo', minutes: 1 },
      { kind: 'question', minutes: 0.5 }, { kind: 'thanks', minutes: 0.25 },
    ]), { visuals: ['team', 'fit-table', 'before-after'], data, hasTeam: true });
    expect(spec.slides.map((s) => s.kind)).toEqual(['title', 'problem', 'today', 'team', 'tool', 'demo', 'question', 'thanks']);
    expect(spec.slides[2].visual).toBeUndefined();
    expect(spec.slides[3].visual).toBe('team');
    expect(spec.slides[4].visual).toBe('fit-table');
    const total = spec.slides.reduce((t, s) => t + s.minutes, 0);
    expect(total).toBeGreaterThan(8.5);
    expect(total).toBeLessThan(11.5);
    expect(warnings).toEqual(expect.arrayContaining(['Added a title slide to open the deck', 'Added the team slide', expect.stringMatching(/scaled to about 10/)]));
  });
  it('puts the names back from their codes; a code it does not know becomes "the team"', () => {
    const codes = new Map([['P1', { id: 'person:p1', type: 'Person' as const, label: 'Person 1' }]]);
    const out = decodeDeck(base([{ title: '[P1] presents', notes: '[P1] and [P7] built it.', points: ['Ask [P1]'] }]), codes);
    expect(out.slides[0]).toMatchObject({ title: 'Person 1 presents', notes: 'Person 1 and the team built it.', points: ['Ask Person 1'] });
  });
  it('reads the plan, the dates, today\'s process and a demo link from the record', () => {
    expect(planOf('## Tasks\n\n- [x] **A**\n- [ ] **B \\* c**\n\n## Risks\n\n- One\n- (none named)\n')).toEqual({ tasks: [{ title: 'A', done: true }, { title: 'B * c', done: false }], risks: ['One'] });
    expect(processLines('1) Pull a sample\n2) Check it 3) Email')).toEqual(['Pull a sample', 'Check it', 'Email']);
    expect(demoLinkOf([{ question: 'How will you run the demo?', answer: 'From https://example.test/demo.' }])).toBe('https://example.test/demo');
    const dates = datesOf({
      idea: sampleIdea({ review: { decision: 'select', reason: '', criteria: {}, at: '2026-10-19' }, checklist: { s3e: { done: true, by: 'app', at: '2026-10-20' } } }),
      design: { ...emptyDesign(), approvedAt: '2026-10-21' }, history: [{ at: '2026-10-10', action: 'created', by: 'app' }, { at: '2026-10-22', action: 'stage', by: 'operator', detail: 'Design series → Launch and Learn' }],
      round: { id: 'R', name: '2026 Q4', created: '', roadshow: '2026-11-05' },
    });
    expect(dates.map((d) => d.what)).toEqual(['Submitted', 'Selected', 'Tool picked', 'Design approved', 'Launch and Learn', 'Roadshow']);
  });
});

describe('the to-do list keeps its ids apart', () => {
  it('a new item whose question only looks like a kept one gets its own id; the same words keep theirs', () => {
    const prev = [
      { id: 'n1', need: 'What was hard', ask: 'What was the hardest part?', met: false },
      { id: 'n3', need: 'One question for the room', ask: 'What one question would you like the room to answer?', met: false, answer: 'Who else?' },
    ];
    const out = mergeNeeds(prev, [
      { need: 'Next steps', ask: 'What are your next steps, and what would you like the room to answer?', met: false },
      { need: 'One question for the room', ask: 'What one question would you like the room to answer?', met: true, answer: 'Who else' },
      { need: 'What was hard', ask: 'What was the hardest part?', met: true },
    ]);
    expect(out.map((x) => x.id)).toEqual(['n4', 'n3', 'n1']);
    expect(out[1].answer).toBe('Who else?');
  });
});

describe('the firm template', () => {
  it('reads the colours and fonts of a template file; says honestly what is not applied', async () => {
    const theme = '<a:theme><a:clrScheme name="Firm"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:dk2><a:srgbClr val="1F2A44"/></a:dk2>'
      + '<a:accent1><a:srgbClr val="005EB8"/></a:accent1><a:accent2><a:srgbClr val="FFFFFF"/></a:accent2></a:clrScheme>'
      + '<a:fontScheme><a:majorFont><a:latin typeface="Firm Serif"/></a:majorFont><a:minorFont><a:latin typeface="Firm Sans"/></a:minorFont></a:fontScheme></a:theme>';
    const zip = zipSync({ 'ppt/theme/theme1.xml': strToU8(theme), 'ppt/presentation.xml': strToU8('<p/>') });
    expect(themeFromTemplate(zip)).toEqual({ accent: '#005eb8', ink: '#1f2a44', headFont: expect.stringMatching(/^"Firm Serif"/), bodyFont: expect.stringMatching(/^"Firm Sans"/) });
    const dir = await import('node:fs/promises').then((f) => f.mkdtemp(path.join(os.tmpdir(), 'cafe-tpl-')));
    const file = path.join(dir, 'firm.potx');
    await writeFile(file, zip);
    const got = await readTemplateTheme(file);
    expect(got.template).toMatchObject({ applied: true, file: 'firm.potx' });
    expect(got.template.note).toMatch(/slide masters, logos and layouts are not/);
    expect(got.theme.accent).toBe('#005eb8');
    expect((await readTemplateTheme(undefined)).template).toMatchObject({ applied: false, note: expect.stringMatching(/No firm template is set/) });
    expect((await readTemplateTheme('deck')).template.note).toMatch(/not the full path/);
    expect((await readTemplateTheme(path.join(dir, 'gone.pptx'))).template.note).toMatch(/no file there/);
  });
});

describe('the roadshow, end to end on the server', () => {
  it('Suggest lists what the story needs (names coded); a pasted answer is saved on the idea at once; Re-evaluate keeps the list and marks it met', async () => {
    const sp = spy();
    const s = await server(sp.provider);
    const first = await json(await s.post(`${s.rs}/suggest`));
    expect(first.prep.needs.map((n: any) => [n.id, n.met])).toEqual([['n1', false], ['n2', false], ['n3', false]]);
    const asked = sp.prompts.at(-1)!;
    expect(asked.startsWith('TASK: roadshow-prep')).toBe(true);
    expect(asked).not.toMatch(/Person [123]/);
    expect(asked).toMatch(/\[P\d\]/);
    expect(asked).not.toContain('Saves 200 hours');
    const answered = await json(await s.post(`${s.rs}/prep/answer`, { need: 'n1', answer: 'Getting a sample with weekend claims in it' }));
    expect(answered.prep.needs[0].answer).toBe('Getting a sample with weekend claims in it');
    const idea = await loadIdea(s.root, ID) as any;
    expect(idea.answers).toEqual([{ question: first.prep.needs[0].ask, answer: 'Getting a sample with weekend claims in it', source: 'roadshow' }]);
    const again = await json(await s.post(`${s.rs}/suggest`));
    expect(again.prep.needs.map((n: any) => [n.id, n.met])).toEqual([['n1', true], ['n2', false], ['n3', false]]);
    expect(sp.prompts.at(-1)).toContain('"todo"');
    expect(sp.prompts.at(-1)).not.toMatch(/Person [123]/);
    // Clearing the answer takes it off the idea too.
    await s.post(`${s.rs}/prep/answer`, { need: 'n1', answer: '' });
    expect(((await loadIdea(s.root, ID)) as any).answers ?? []).toEqual([]);
  });

  it('a person in a question comes back by name (it goes to the team as written), and back to the AI as a code', async () => {
    const sp = spy((p) => (p.startsWith('TASK: roadshow-prep') && !p.includes('"todo"')
      ? JSON.stringify({ needs: [{ need: 'Build time for [P2]', ask: 'How long did it take [P2] to build it?', met: false }], learned: [] }) : undefined));
    const s = await server(sp.provider);
    const first = await json(await s.post(`${s.rs}/suggest`));
    expect(first.prep.needs[0]).toMatchObject({ need: 'Build time for Person 2', ask: 'How long did it take Person 2 to build it?' });
    await s.post(`${s.rs}/suggest`);
    const again = sp.prompts.at(-1)!;
    expect(again).toContain('"todo"');
    expect(again).not.toContain('Person 2');
    expect(again).toMatch(/How long did it take \[P\d\] to build it\?/);
  });

  it('the brief is rewritten by the reply ("learned" only: nothing to say yes to)', async () => {
    const sp = spy((p) => (p.startsWith('TASK: roadshow-prep') ? JSON.stringify({ needs: [], learned: [{ topic: 'Demo', text: '[P2] shows it live.' }] }) : undefined));
    const s = await server(sp.provider);
    await s.post(`${s.rs}/suggest`);
    const idea = await loadIdea(s.root, ID);
    expect(idea.learned?.points).toEqual([{ topic: 'Demo', text: 'Person 2 shows it live.' }]);
    expect(idea.updates ?? []).toEqual([]);
  });

  it('Draft email opens the open questions as an E2 and marks them asked; its Undo unmarks them', async () => {
    vi.stubEnv('CAFE_NO_OUTLOOK', '1');
    const s = await server();
    const first = await json(await s.post(`${s.rs}/suggest`));
    await s.post('/api/settings', { operatorName: 'Café operator' });
    const sent = await json(await s.post(`${s.rs}/prep/email`));
    expect(sent.email).toMatchObject({ template: 'E2', status: 'sent' });
    for (const n of first.prep.needs) expect(sent.email.body).toContain(n.ask);
    expect((await readRoadshow(s.root, ID)).prep!.needs.every((n) => n.askedAt === '2026-10-23')).toBe(true);
    await s.post('/api/outbox/unopen', { key: sent.email.key });
    expect((await readRoadshow(s.root, ID)).prep!.needs.some((n) => n.askedAt)).toBe(false);
  });

  it('Build the deck: the AI writes the spec (names coded, no photos, no business impact), the app draws deck.html, script.md, run-of-show.md and deck.pptx', async () => {
    const sp = spy();
    const s = await server(sp.provider);
    const f = await pictures();
    await json(await s.post(`${s.rs}/photo`, { person: 'person-1', path: f.a }));
    const view = await json(await s.post(`${s.rs}/build`));
    expect(view.error).toBeUndefined();
    const asked = sp.prompts.find((p) => p.startsWith('TASK: roadshow-deck'))!;
    expect(asked).not.toMatch(/Person [123]/);
    expect(asked).not.toContain('base64');
    expect(asked).not.toContain('Saves 200 hours');
    expect(asked).toContain('"visuals"');
    const deck = view.deck;
    expect(deck.files).toEqual(['deck.html', 'script.md', 'run-of-show.md', 'deck.pptx']);
    const n = deck.slides.length;
    expect(n).toBeGreaterThanOrEqual(10);
    expect(deck.slides.map((x: any) => x.kind)).toEqual(expect.arrayContaining(['title', 'team', 'diagram', 'tool', 'demo', 'question']));
    expect(view.stale).toEqual({ record: false, photos: false });

    const dir = path.join(await ideaDir(s.root, ID), 'roadshow');
    const html = await readFile(path.join(dir, 'deck.html'), 'utf8');
    expect(html.match(/<section class="slide /g)).toHaveLength(n);
    expect(html.match(/<div class="sn" hidden/g)).toHaveLength(n);
    expect(html).toContain(`data:image/png;base64,${png(24, 24).toString('base64')}`);
    expect(html).toContain('Person 2'); // no photo: initials
    expect(html).toContain('<span class="ph ini" aria-hidden="true">P2</span>');
    expect(html).toContain('<svg class="diagram"');
    expect(html).toContain('Weekend spend check');
    expect(html).toContain('@media print');
    expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)="https?:/);
    expect(html).toMatch(/Content-Security-Policy/);

    const script = await readFile(path.join(dir, 'script.md'), 'utf8');
    for (const x of deck.slides) expect(script).toContain(`. ${x.title}`);
    expect(script).toMatch(/\*\*\[switch to the demo\]\*\*/);
    expect(script).toMatch(/0:00–0:30/);
    const ros = await readFile(path.join(dir, 'run-of-show.md'), 'utf8');
    for (const q of FEEDBACK_QUESTIONS) expect(ros).toContain(q);
    expect(ros).toMatch(/## The demo cue/);
    expect(ros).toMatch(/## The one question/);
    expect(ros).toMatch(/Person 2 switches to the demo/);

    const zip = unzipSync(new Uint8Array(await readFile(path.join(dir, 'deck.pptx'))));
    const names = Object.keys(zip);
    expect(names.filter((x) => /^ppt\/slides\/slide\d+\.xml$/.test(x))).toHaveLength(n);
    expect(names.filter((x) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(x))).toHaveLength(n);
    expect(names.some((x) => /^ppt\/media\/.+\.png$/.test(x))).toBe(true);
    const notes1 = strFromU8(zip['ppt/notesSlides/notesSlide1.xml']);
    expect(notes1).toContain('We will talk this through');
    // Files go only into roadshow/.
    expect((await readdir(dir)).sort()).toEqual(['deck.html', 'deck.pptx', 'photos', 'run-of-show.md', 'script.md']);
  });

  it('out of date when the record or the photos change; Update the files redraws with no AI', async () => {
    const s = await server();
    const f = await pictures();
    await s.post(`${s.rs}/build`);
    let view = await json(await s.post(`${s.rs}/photo`, { person: 'person-3', path: f.b }));
    expect(view.stale).toEqual({ record: false, photos: true });
    view = await json(await s.post(`${s.rs}/render`));
    expect(view.stale).toEqual({ record: false, photos: false });
    const dir = path.join(await ideaDir(s.root, ID), 'roadshow');
    expect(await readFile(path.join(dir, 'deck.html'), 'utf8')).toContain('data:image/jpeg;base64,');
    await s.post(`${s.rs}/suggest`);
    await s.post(`${s.rs}/prep/answer`, { need: 'n2', answer: 'A recording, in case the network is slow' });
    view = await json(await s.get(s.rs));
    expect(view.stale.record).toBe(true);
    expect((await json(await s.post(`${s.rs}/render`))).stale.record).toBe(true);
  });

  it('serves the files: the deck as a page that loads nothing from anywhere, the PowerPoint as a download, the script as text; the photos for the previews', async () => {
    const s = await server();
    expect((await json(await s.get(`${s.rs}/files/deck.html`))).error).toMatch(/not written yet/);
    const f = await pictures();
    await s.post(`${s.rs}/photo`, { person: 'person-1', path: f.a });
    await s.post(`${s.rs}/build`);
    const page = await s.get(`${s.rs}/files/deck.html`);
    expect(page.headers.get('content-type')).toMatch(/^text\/html/);
    expect(page.headers.get('content-security-policy')).toMatch(/default-src 'none'/);
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(await page.text()).toMatch(/^<!doctype html>/);
    const pptx = await s.get(`${s.rs}/files/deck.pptx`);
    expect(pptx.headers.get('content-disposition')).toMatch(/attachment; filename="CAFE-2026-001-roadshow-deck.pptx"/);
    expect((await pptx.arrayBuffer()).byteLength).toBeGreaterThan(10_000);
    const script = await s.get(`${s.rs}/files/script.md?download=1`);
    expect(script.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(script.headers.get('content-disposition')).toMatch(/attachment/);
    expect((await json(await s.get(`${s.rs}/files/roadshow.yaml`))).error).toMatch(/Not a roadshow file/);
    expect((await json(await s.get(`${s.rs}/files/..%2Fidea.yaml`))).error).toMatch(/Not a roadshow file/);
    const view = await json(await s.get(s.rs));
    const photo = await s.get(view.people[0].photo.url);
    expect(photo.headers.get('content-type')).toBe('image/png');
    expect((await json(await s.get(`${s.rs}/photos/..%2Fidea.yaml`))).error).toMatch(/No such photo/);
    // The design pack reads the script and the run of show.
    const read = await json(await s.post(`/api/ideas/${ID}/design-file`, { path: 'roadshow/script.md' }));
    expect(read.text).toMatch(/^# Roadshow script/);
    expect((await json(await s.post(`/api/ideas/${ID}/design-file`, { path: 'roadshow/deck.html' }))).error).toMatch(/Not a design file/);
  });

  it('a photo from the file picker is checked the same way; anything else is refused with a plain message', async () => {
    const s = await server();
    const up = (name: string, body: Buffer, person = 'person-2') => fetch(`${s.base}${s.rs}/photo-upload`, {
      method: 'POST', headers: { 'x-filename': encodeURIComponent(name), 'x-person': person, 'content-type': 'application/octet-stream' }, body,
    });
    const ok = await json(await up('me.png', png(8, 8)));
    expect(ok.people.find((p: any) => p.key === 'person-2').photo).toMatchObject({ file: 'person-2.png', from: 'upload' });
    expect((await json(await up('notes.txt', Buffer.from('hello')))).error).toMatch(/Only a picture/);
    expect((await json(await up('fake.png', Buffer.from('hello')))).error).toMatch(/not a picture/);
    expect((await json(await up('me.png', png(8, 8), 'person-9'))).error).toMatch(/not on this idea/);
    const st = await gatherRoadshow(s.root, ID);
    expect(Object.keys(st.state.photos)).toEqual(['person-2']);
  });

  it('with no AI the deck cannot be built and nothing changes', async () => {
    const broken: Provider = { ...fakeProvider(), complete: async () => 'not json' };
    const s = await server(broken);
    const r = await s.post(`${s.rs}/build`);
    expect(r.status).toBe(400);
    expect((await json(r)).error).toMatch(/Working by hand/);
    expect((await readRoadshow(s.root, ID)).deck).toBeUndefined();
  });
});
