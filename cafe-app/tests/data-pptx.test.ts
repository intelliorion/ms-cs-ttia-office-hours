import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { readPptx, plainRead, readChart, fmtValue, resolvePart, DeckError, deckWords } from '../src/data/pptx';
import { parseXml, decodeXml, unzipGuarded, ZipLimitError, cfbKind } from '../src/data/ooxml';
import { checkDataFile, readDataFile, DataError } from '../src/data/read';
import { checkRead } from '../src/data/check';
import { profileDoc } from '../src/data/profile';
import { readWords } from '../src/data/understand';
import { sizeWords, guessKind, DATA_EXTS } from '../src/data/model';
import { chunkIdea } from '../src/memory/chunks';
import { startServer, sampleIdea } from './helpers';
import { saveIdea, loadIdea, ideaDir } from '../src/ideas/store';
import { createConnector, type Provider } from '../src/ai/connector';
import { fakeProvider } from '../src/ai/providers/fake';
import { DEFAULT_SETTINGS } from '../src/round/round';
import { handDeck, libDeck, oleFile, slideXml } from './pptxFixtures';
import { processDocx } from './dataFixtures';

describe('A .pptx read structurally', () => {
  it('reads the slides in presentation order, each title apart from its body, in reading order, without boilerplate', () => {
    const r = readPptx(handDeck());
    const slides = r.text.split('\n').filter((l) => l.startsWith('## '));
    // presentation.xml lists slide3.xml first: file names do not decide the order.
    expect(slides).toEqual(['## Slide 1: Expense review today', '## Slide 2: Costs by team', '## Slide 3: How claims flow', '## Slide 4 (hidden: not read)']);
    const one = r.text.slice(0, r.text.indexOf('## Slide 2'));
    expect(one.trim().split('\n')).toEqual([
      '## Slide 1: Expense review today',
      // The body has no position of its own: the layout puts it under the title.
      '- R&D <team> claims', // entities decoded
      '  - Checked by hand', '    every Monday', // level 1, and a line break kept under it
      '1. Export the claims', '2. Compare with the caps', // numbering counted
      'No bullet here',
      '[Picture: Photo of the claims tracker]', // alt text kept; a picture with none is only counted
      'Group left', 'Group right', // a group's shapes by their place, not their order in the file
      'Source: the October export', // first in the XML, last on the slide
      'Notes: Say the caps changed in May.', '  Ask who owns the export.',
    ]);
    // Footers, slide numbers, empty placeholders and the layout's own text are never content.
    expect(r.text).not.toMatch(/Confidential|Layout footer|^7$|Draft numbers/m);
    expect(r.meta).toMatchObject({ slides: 4, hidden: 1, tables: 1, charts: 1, smartArt: 1, pictures: 2, notes: 1, title: 'Expense check deck' });
    expect(deckWords(r.meta)).toBe('4 slides (1 hidden, skipped), 1 table, 1 chart, 1 SmartArt graphic, 2 pictures, notes on 1 slide');
  });

  it('reads a table with merged cells as data: a two-row header combined, a value merged down filled into each row', () => {
    const [t] = readPptx(handDeck()).tables;
    expect(t).toEqual({ name: 'S2 Costs by team', header: ['Team', 'Q1 Actual', 'Q1 Plan'], rows: [['Ops', '120', '100'], ['Ops', '130', '110'], ['Finance', '90', '95']], total: 3 });
    expect(readPptx(handDeck()).text).toContain('[Table "S2 Costs by team": 3 columns (Team, Q1 Actual, Q1 Plan) and 3 rows, merged cells filled in; read as a table]');
  });

  it('reads a chart from its cached data: its type, title, axis, series and values as the chart shows them', () => {
    const r = readPptx(handDeck());
    expect(r.tables[1]).toEqual({ name: 'S3 Claims & refunds by month', header: ['Month', 'Claims', 'Refund rate'], rows: [['Jan', '40', '25%'], ['Feb', '52', '10%'], ['Mar', '47', '12.5%']], total: 3 });
    expect(r.text).toContain('[Chart "S3 Claims & refunds by month": combination chart (column chart, line chart) "Claims & refunds by month": 2 series (Claims, Refund rate) over 3 points; its data read as a table]');
    // SmartArt as an outline, in its own order (srcOrd), not the order its points are written in.
    expect(r.text).toContain('[SmartArt]\n- Export the claims\n  - Weekly, on Monday\n- Check the cap');
  });

  it('a hidden slide is flagged and skipped by default, read when asked', () => {
    expect(readPptx(handDeck()).text).not.toContain('Draft numbers');
    expect(readPptx(handDeck(), { includeHidden: true }).text).toContain('## Slide 4: Draft numbers, not for the team');
  });

  it('reads a deck as a real tool writes it (pptxgenjs): bullets, notes, a table, a column chart, a hidden slide', async () => {
    const r = readPptx(await libDeck());
    expect(r.text).toContain('## Slide 1: Expense review\n- Claims are checked by hand\n  - Each Monday\nNotes: Say the caps changed in May.');
    expect(r.tables.map((t) => [t.name, t.header, t.rows])).toEqual([
      ['S2 Caps by policy', ['Policy', 'Cap', 'Receipt over'], [['T', '150', '25'], ['M', '40', '10']]],
      ['S3 Claims by month', ['Category', '2025', '2026'], [['Jan', '10', '11'], ['Feb', '12', '14'], ['Mar', '9', '8']]],
    ]);
    expect(r.text).toContain('column chart "Claims by month"');
    expect(r.meta).toMatchObject({ slides: 4, hidden: 1, tables: 1, charts: 1, notes: 1 });
    expect(r.text).not.toContain('Draft numbers');
  });

  it('formats cached values as shown, resolves relationship paths, and decodes XML safely', () => {
    expect(fmtValue('0.125', '0.0%')).toBe('12.5%');
    expect(fmtValue('1234.5', '"£"#,##0.00')).toBe('£1234.5');
    expect(fmtValue('-20', '[$€-1809]#,##0')).toBe('-€20');
    expect(fmtValue('45658', 'mmm\\-yy')).toBe('2025-01-01');
    expect(fmtValue('Jan', 'General')).toBe('Jan');
    expect(resolvePart('ppt/slides/slide1.xml', '../charts/chart1.xml')).toBe('ppt/charts/chart1.xml');
    expect(resolvePart('ppt/presentation.xml', '/ppt/slides/slide2.xml')).toBe('ppt/slides/slide2.xml');
    expect(decodeXml('a &amp;lt; &#x41;&#66; &#xD800; &bogus;')).toBe('a &lt; AB  &bogus;');
    // A DOCTYPE's entities are never expanded (no billion laughs); broken XML never throws.
    const t = parseXml('<!DOCTYPE x [<!ENTITY a "aaaa">]><x>&a;<y>open</x>');
    expect(t.kids.length).toBe(1);
    expect(() => parseXml('<a><b attr="1>2"></c></a')).not.toThrow();
    // A scatter chart whose series do not share x values: one row per point.
    const sc = readChart(parseXml(`<c:chartSpace xmlns:c="c"><c:chart><c:plotArea><c:scatterChart>
      <c:ser><c:order val="0"/><c:tx><c:v>A</c:v></c:tx><c:xVal><c:numLit><c:ptCount val="2"/><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt></c:numLit></c:xVal><c:yVal><c:numLit><c:ptCount val="2"/><c:pt idx="0"><c:v>5</c:v></c:pt><c:pt idx="1"><c:v>6</c:v></c:pt></c:numLit></c:yVal></c:ser>
      <c:ser><c:order val="1"/><c:tx><c:v>B</c:v></c:tx><c:xVal><c:numLit><c:ptCount val="1"/><c:pt idx="0"><c:v>3</c:v></c:pt></c:numLit></c:xVal><c:yVal><c:numLit><c:ptCount val="1"/><c:pt idx="0"><c:v>7</c:v></c:pt></c:numLit></c:yVal></c:ser>
      </c:scatterChart></c:plotArea></c:chart></c:chartSpace>`))!;
    expect(sc).toMatchObject({ kind: 'scatter chart', header: ['Series', 'X', 'Y'], rows: [['A', '1', '5'], ['A', '2', '6'], ['B', '3', '7']] });
  });
});

describe('A .pptx that is odd, broken, protected or old', () => {
  it('a broken slide does not stop the rest; slides with no order are read in file order; plain text is the last resort', () => {
    const r = readPptx(handDeck({ first: '<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Half a shape' }));
    expect(r.text).toContain('## Slide 1: Half a shape');
    expect(r.tables).toHaveLength(2);
    const noOrder = readPptx(handDeck({ presentation: '<p:presentation xmlns:p="p"/>' }));
    expect(noOrder.problems).toEqual(['The deck does not say its slide order: the slides are read in file order']);
    expect(readWords({ type: 'presentation', meta: {}, text: noOrder.text, deck: noOrder.meta, problems: noOrder.problems })).toMatch(/words\. The deck does not say its slide order/);
    expect(noOrder.text.split('\n').filter((l) => l.startsWith('## '))[0]).toBe('## Slide 1: Costs by team');
    const plain = plainRead({ 'ppt/slides/slide2.xml': strToU8('<a:p><a:r><a:t>B &amp; C</a:t></a:r></a:p>'), 'ppt/slides/slide10.xml': strToU8('<a:p><a:r><a:t>Ten</a:t></a:r></a:p>') }, 'test');
    expect(plain.text).toBe('## Slide 1\nB & C\n\n## Slide 2\nTen');
    expect(plain.meta.plain).toBe(true);
  });

  it('a damaged zip, a zip with no slides and a zip bomb are refused with a reason, never a crash', () => {
    expect(() => readPptx(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]))).toThrow(DeckError);
    expect(() => readPptx(zipSync({ 'a.txt': strToU8('hi') }))).toThrow(/no slides/);
    // 30 MB of spaces packs into a few KB: the size the zip declares is refused before it is unpacked.
    const bomb = zipSync({ 'ppt/presentation.xml': strToU8('<p:presentation/>'), 'ppt/slides/slide1.xml': strToU8(' '.repeat(30 * 1024 * 1024)) }, { level: 9 });
    expect(bomb.length).toBeLessThan(200_000);
    expect(() => readPptx(bomb)).toThrow(/too big to read safely: ppt\/slides\/slide1\.xml unpacks to over 25 MB/);
    expect(() => unzipGuarded(handDeck(), () => true, { entry: 1e9, total: 1000, entries: 1e6 })).toThrow(ZipLimitError);
    expect(() => unzipGuarded(handDeck(), () => true, { entry: 1e9, total: 1e9, entries: 3 })).toThrow(/over 3 parts/);
  });

  it('checks a dropped deck by what is inside it: .ppt, password, old file renamed, a Word file renamed, damage, size', () => {
    expect(DATA_EXTS).toContain('pptx');
    expect(checkDataFile('deck.pptx', handDeck())).toBe('pptx');
    expect(() => checkDataFile('old.ppt', oleFile('PowerPoint Document'))).toThrow(/Old \.ppt presentations are not read: open it in PowerPoint, save it as \.pptx/);
    expect(cfbKind(oleFile('EncryptionInfo'))).toBe('encrypted');
    expect(() => checkDataFile('locked.pptx', oleFile('EncryptionInfo'))).toThrow(/protected with a password: open it, remove the password/);
    expect(() => checkDataFile('locked.xlsx', oleFile('EncryptedPackage'))).toThrow(/This workbook is protected with a password/);
    expect(() => checkDataFile('old.pptx', oleFile('PowerPoint Document'))).toThrow(/Old \.ppt presentations renamed \.pptx are not read/);
    expect(() => checkDataFile('notes.pptx', processDocx())).toThrow(/a document \(\.docx\), not a presentation: rename it \.docx/);
    expect(() => checkDataFile('broken.pptx', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9]))).toThrow(/damaged: it could not be opened/);
    expect(() => checkDataFile('fake.pptx', strToU8('slides'))).toThrow(/not a real \.pptx/);
    expect(() => checkDataFile('any.pptx', zipSync({ 'a.txt': strToU8('x') }))).toThrow(/no slides in it/);
    // A deck carries pictures: up to 20 MB, where other files stop at 10.
    const big = zipSync({ ...unzipSync(handDeck()), 'ppt/media/photo.bin': [new Uint8Array(15 * 1024 * 1024).map((_, i) => (i * 7919) % 251), { level: 0 }] });
    expect(big.length).toBeGreaterThan(15 * 1024 * 1024);
    expect(() => checkDataFile('big.pptx', big)).not.toThrow(DataError);
    expect(() => checkDataFile('huge.pptx', new Uint8Array(21 * 1024 * 1024))).toThrow(/over 20 MB: compress its pictures/);
    expect(guessKind('claims process.pptx')).toBe('process');
    expect(guessKind('monthly report.pptx')).toBe('today');
  });
});

describe('A deck through Read, Check and Profile', () => {
  it('reads as a presentation with tables and text, profiled as both, screened as both', async () => {
    const r = await readDataFile('/nowhere/d.pptx', 'd.pptx', handDeck());
    expect(r.type).toBe('presentation');
    expect(r.tables!.map((t) => t.name)).toEqual(['S2 Costs by team', 'S3 Claims & refunds by month']);
    expect(r.text).toContain('## Slide 1: Expense review today');
    expect(readWords(r)).toMatch(/^Presentation: 4 slides \(1 hidden, skipped\), 1 table, 1 chart, 1 SmartArt graphic, 2 pictures, notes on 1 slide; \d+ words$/);
    const doc = profileDoc(r);
    expect(doc).toMatchObject({ slides: 3, hiddenSlides: 1, tables: 1, charts: 1, notes: 1, headings: ['Slide 1: Expense review today', 'Slide 2: Costs by team', 'Slide 3: How claims flow'] });
    expect(sizeWords({ tables: [{ rows: 3 }, { rows: 3 }] as any, doc })).toMatch(/^3 slides, 1 table and 1 chart \(6 rows\), \d+ words$/);
    expect(checkRead(r, 'd.pptx', []).status).toBe('clear');
    // Personal data in the speaker notes holds the deck, as it would a document.
    const held = checkRead(await readDataFile('/x/d.pptx', 'd.pptx', await libDeck('Call 020 7946 0001, 020 7946 0002 or 020 7946 0003 about card 4111 1111 1111 1111')), 'd.pptx', []);
    expect(held.status).toBe('held');
    expect(held.findings.map((f) => f.kind).sort()).toEqual(['card', 'phone']);
  });

  it('a deck with nothing to read says so', async () => {
    const empty = zipSync({ 'ppt/presentation.xml': strToU8('<p:presentation xmlns:p="p"/>'), 'ppt/slides/slide1.xml': strToU8(slideXml('')), 'ppt/slides/slide2.xml': strToU8(slideXml('', true)) });
    expect((await readDataFile('/x/e.pptx', 'e.pptx', empty)).unreadable).toBe('No text, table or chart found on any slide (1 hidden slide was skipped)');
  });
});

const ID = 'CAFE-2026-004';
let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; vi.unstubAllEnvs(); });

describe('Understand the data: a dropped deck end to end', () => {
  it('runs Read, Check, Profile, Understand and Saved; the AI sees its tables with their slides, names coded', async () => {
    vi.stubEnv('CAFE_AI_FAKE', '1');
    const prompts: string[] = [];
    const fake = fakeProvider();
    const spy: Provider = { ...fake, complete: async (prompt, o) => { prompts.push(prompt); return fake.complete(prompt, o); } };
    const s = await startServer('2026-10-20', { connector: createConnector({ providers: [spy], settings: DEFAULT_SETTINGS }) });
    close = async () => { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); };
    await saveIdea(s.root, sampleIdea({ id: ID, slug: 'expense-check', title: 'Expense check', stage: 3, challenge: 'Claims are checked by hand.', outcomes: ['Flag claims'], people: { submitter: 'Rowan Vale', team: [] } }));
    const drop = async (name: string, bytes: Uint8Array) => {
      const r = await fetch(`${s.base}/api/ideas/${ID}/data/drop`, { method: 'POST', body: bytes, headers: { 'x-filename': encodeURIComponent(name), 'x-kind': 'today', 'content-type': 'application/octet-stream' } });
      return { status: r.status, body: await r.json() as any };
    };
    expect((await drop('old deck.ppt', oleFile('PowerPoint Document'))).body.error).toMatch(/save it as \.pptx/);

    // The submitter's name in the speaker notes: masked and coded before the AI, like any document's.
    const f = (await drop('claims review.pptx', await libDeck('Rowan Vale owns the export.'))).body.file;
    expect(f.type).toBe('presentation');
    expect(f.steps.map((x: any) => [x.id, x.status])).toEqual([['read', 'done'], ['check', 'done'], ['profile', 'done'], ['understand', 'done'], ['saved', 'done']]);
    expect(f.steps[0].detail).toMatch(/^Presentation: 4 slides \(1 hidden, skipped\), 1 table, 1 chart, notes on 1 slide/);
    expect(f.tables.map((t: any) => t.name)).toEqual(['S2 Caps by policy', 'S3 Claims by month']);
    expect(f.doc).toMatchObject({ slides: 3, hiddenSlides: 1, charts: 1, notes: 1 });
    // Columns understood like any data file, each with its table; the made-up one dropped.
    expect(f.understanding.columns.map((c: any) => `${c.table}/${c.name}`)).toEqual(['S2 Caps by policy/Policy', 'S2 Caps by policy/Cap', 'S2 Caps by policy/Receipt over', 'S3 Claims by month/Category', 'S3 Claims by month/2025', 'S3 Claims by month/2026']);
    const asked = prompts.filter((x) => x.startsWith('TASK: data-understand')).at(-1)!;
    expect(asked).toContain('A presentation (type \\"presentation\\")'.replace(/\\"/g, '"'));
    expect(asked).toContain('S2 Caps by policy');
    expect(asked).toContain('## Slide 1: Expense review');
    expect(asked).not.toContain('Rowan');
    expect(asked).not.toContain('Vale');
    // design.md and Deep read carry it like any other file.
    const dir = await ideaDir(s.root, ID);
    const md = await readFile(path.join(dir, 'design.md'), 'utf8');
    expect(md).toContain('### claims review.pptx (Today\'s output or report)');
    expect(md).toMatch(/- `Cap` \(number, in S2 Caps by policy\)/);
    const chunks = await chunkIdea(s.root, await loadIdea(s.root, ID), dir);
    const data = chunks.filter((c) => c.section === 'data f1').map((c) => c.text).join('\n');
    expect(data).toContain('Slides: Slide 1: Expense review; Slide 2: Caps by policy\n');
    expect(data).toContain('Column Cap (S2 Caps by policy):');
  });
});
