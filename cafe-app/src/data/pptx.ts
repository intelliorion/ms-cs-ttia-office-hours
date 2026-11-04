/**
 * A PowerPoint deck (.pptx) read by code, structurally, for "Understand the data": the slides in presentation order
 * (presentation.xml's slide list through its relationships), each slide's title apart from its body, its text in
 * reading order (top to bottom, then left to right; grouped shapes placed by their group; a placeholder with no
 * position of its own placed where its layout puts it) with bullet levels and numbering, its tables (merged cells
 * handled, header rows found) and charts (type, series, categories and values from the chart's cached data) as the
 * same tables a spreadsheet gives, SmartArt text as an outline, picture alt text, and the speaker notes. Hidden slides
 * are counted and skipped. Slide-master and layout boilerplate (footers, dates, slide numbers, empty placeholders) is
 * never read as content. Every part is unzipped under a size guard; a deck whose structure is odd is read as plain
 * text from its slides instead of failing.
 */
import { strFromU8 } from 'fflate';
import { all, attr, first, kid, kids, parseXml, path as xpath, relAttr, textOf, unzipGuarded, ZipLimitError, type XNode } from './ooxml';
import { cleanHeader, COLUMNS_MAX, ROWS_READ_MAX, type ReadTable } from './read';

export class DeckError extends Error {}

export interface DeckMeta {
  /** Slides in the deck, hidden ones included. */
  slides: number;
  hidden: number;
  /** Tables read as tables, and charts read (each chart's data is also a table). */
  tables: number;
  charts: number;
  smartArt: number;
  pictures: number;
  /** Slides with speaker notes. */
  notes: number;
  title?: string;
  /** Read as plain text: the structure was too odd to follow. */
  plain?: true;
  /** Cut: more slides, text or tables than are read. */
  cut?: true;
}
export interface DeckRead { tables: ReadTable[]; text: string; meta: DeckMeta; problems: string[] }

export const SLIDES_MAX = 400;
export const DECK_TABLES_MAX = 12;
export const DECK_TEXT_MAX = 300_000;
const POINTS_MAX = 10_000;
const NAME_MAX = 40;

type Rel = { type: string; target: string };
type Files = Record<string, Uint8Array>;
interface Pos { x: number; y: number }
type Tf = (x: number, y: number) => Pos;
interface SlideCtx { rels: Map<string, Rel>; layout: Map<string, Pos>; n: number; tableNo: number }
interface Block {
  kind: 'title' | 'text' | 'table' | 'chart' | 'picture' | 'smartart' | 'object';
  pos?: Pos; order: number; lines: string[];
  /** A table or chart: its lines (and its name) are made once the slide's title is known. */
  later?: (title: string) => string[];
}

const int = (v: string | undefined, d = 0) => { const n = Number.parseInt(v ?? '', 10); return Number.isFinite(n) ? n : d; };
const on = (v: string | undefined) => v === '1' || v === 'true' || v === 'on';
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const shorten = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
const SLIDE_PART = /^ppt\/slides\/slide[^/]*\.xml$/i;

/** The parts worth unpacking: XML and relationships under ppt/ (never media, fonts or embedded files), and the title. */
const wanted = (name: string) => /^(ppt\/.+\.(xml|rels)|docProps\/core\.xml)$/i.test(name)
  && !/^ppt\/(media|embeddings|fonts|theme|customXml|tags|printerSettings|handoutMasters|notesMasters|revisionInfo)\//i.test(name);

/** Reads a .pptx. Throws DeckError when it cannot be opened at all; an odd structure falls back to plain text. */
export function readPptx(bytes: Uint8Array, opts: { includeHidden?: boolean } = {}): DeckRead {
  let files: Files;
  try { files = unzipGuarded(bytes, wanted); } catch (e) {
    if (e instanceof ZipLimitError) throw new DeckError(`This presentation is too big to read safely: ${e.message}`);
    throw new DeckError(`This presentation is damaged and could not be unpacked (${(e as Error).message}): open it in PowerPoint, save it again and drop it again`);
  }
  if (!files['ppt/presentation.xml'] && !Object.keys(files).some((n) => SLIDE_PART.test(n))) throw new DeckError('This is not a PowerPoint presentation: it has no slides');
  try {
    return new Deck(files, opts).read();
  } catch (e) {
    return plainRead(files, `its structure was unusual (${(e as Error).message})`);
  }
}

/** The slides' text with no structure: every slide part in name order, its runs and paragraph ends only. */
export function plainRead(files: Files, why: string): DeckRead {
  const parts = Object.keys(files).filter((n) => SLIDE_PART.test(n)).sort(natural);
  const out: string[] = [];
  parts.slice(0, SLIDES_MAX).forEach((p, i) => {
    const xml = strFromU8(files[p]);
    let t = '';
    for (const m of xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<\/a:p>|<a:br\b[^>]*>/g)) t += m[1] !== undefined ? m[1] : '\n';
    // The runs keep their entities: a parse of the text alone decodes them.
    const body = textOf(parseXml(`<x>${t.replace(/</g, '&lt;')}</x>`)).split('\n').map(oneLine).filter(Boolean);
    out.push(`## Slide ${i + 1}`, ...body, '');
  });
  return {
    tables: [], text: out.join('\n').trim().slice(0, DECK_TEXT_MAX),
    meta: { slides: parts.length, hidden: 0, tables: 0, charts: 0, smartArt: 0, pictures: 0, notes: 0, plain: true, ...(parts.length > SLIDES_MAX ? { cut: true as const } : {}) },
    problems: [`Read as plain text: ${why}`],
  };
}

/* ---------- relationships ---------- */

function dirOf(part: string) { const i = part.lastIndexOf('/'); return i < 0 ? '' : part.slice(0, i); }
/** A relationship target resolved against its part's folder ("../charts/chart1.xml" from ppt/slides). */
export function resolvePart(fromPart: string, target: string): string {
  const t = target.replace(/\\/g, '/');
  const segs = (t.startsWith('/') ? t.slice(1) : `${dirOf(fromPart)}/${t}`).split('/');
  const out: string[] = [];
  for (const s of segs) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); }
  return out.join('/');
}

class Deck {
  private xmlCache = new Map<string, XNode | undefined>();
  private layoutCache = new Map<string, Map<string, Pos>>();
  private names = new Set<string>();
  private W = 12_192_000;
  private H = 6_858_000;
  private tables: ReadTable[] = [];
  private problems: string[] = [];
  private meta: DeckMeta = { slides: 0, hidden: 0, tables: 0, charts: 0, smartArt: 0, pictures: 0, notes: 0 };

  constructor(private files: Files, private opts: { includeHidden?: boolean }) {}

  private xml(part: string | undefined): XNode | undefined {
    if (!part) return undefined;
    if (!this.xmlCache.has(part)) {
      const b = this.files[part];
      this.xmlCache.set(part, b ? parseXml(strFromU8(b).replace(/^﻿/, '')) : undefined);
    }
    return this.xmlCache.get(part);
  }

  private rels(part: string): Map<string, Rel> {
    const out = new Map<string, Rel>();
    const relsPart = `${dirOf(part)}/_rels/${part.slice(part.lastIndexOf('/') + 1)}.rels`;
    for (const r of all(this.xml(relsPart), 'Relationship')) {
      const id = attr(r, 'Id'); const target = attr(r, 'Target');
      if (!id || !target || attr(r, 'TargetMode') === 'External') continue;
      out.set(id, { type: attr(r, 'Type') ?? '', target: resolvePart(part, target) });
    }
    return out;
  }

  read(): DeckRead {
    const pres = this.xml('ppt/presentation.xml');
    const sz = first(pres, 'sldSz');
    this.W = int(attr(sz, 'cx')) || this.W;
    this.H = int(attr(sz, 'cy')) || this.H;
    const presRels = this.rels('ppt/presentation.xml');
    let slides = all(first(pres, 'sldIdLst'), 'sldId').map((s) => presRels.get(relAttr(s, 'id') ?? '')?.target).filter((t): t is string => !!t && !!this.files[t]);
    if (!slides.length) {
      slides = Object.keys(this.files).filter((n) => SLIDE_PART.test(n)).sort(natural);
      if (slides.length) this.problems.push('The deck does not say its slide order: the slides are read in file order');
    }
    if (!slides.length) throw new Error('no slides found');
    const coreTitle = oneLine(textOf(first(this.xml('docProps/core.xml'), 'title')));
    if (coreTitle) this.meta.title = shorten(coreTitle, 200);
    this.meta.slides = slides.length;
    const out: string[] = [];
    let size = 0;
    slides.forEach((part, i) => {
      if (i >= SLIDES_MAX || size > DECK_TEXT_MAX) { this.meta.cut = true; return; }
      const lines = this.slide(part, i + 1);
      size += lines.reduce((n, l) => n + l.length + 1, 0);
      out.push(...lines, '');
    });
    if (this.meta.cut && slides.length > SLIDES_MAX) out.push(`…(cut: only the first ${SLIDES_MAX} slides are read)`);
    let text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length > DECK_TEXT_MAX) { text = `${text.slice(0, DECK_TEXT_MAX)}\n…(cut: the text is too long)`; this.meta.cut = true; }
    return { tables: this.tables, text, meta: this.meta, problems: this.problems };
  }

  /* ---------- one slide ---------- */

  private slide(part: string, n: number): string[] {
    const sld = first(this.xml(part), 'sld');
    if (!sld) return [`## Slide ${n}`, '(could not be read)'];
    if (attr(sld, 'show') === '0') {
      this.meta.hidden++;
      if (!this.opts.includeHidden) return [`## Slide ${n} (hidden: not read)`];
    }
    const rels = this.rels(part);
    const ctx: SlideCtx = { rels, layout: this.layoutPositions(rels), n, tableNo: 0 };
    const blocks: Block[] = [];
    this.walk(xpath(sld, 'cSld', 'spTree'), (x, y) => ({ x, y }), blocks, ctx);

    // Reading order: the title first, then by rows (a band of 4% of the slide's height), left to right in a row.
    // A shape with no position (and none from its layout) keeps its place after the shape before it.
    let last: Pos = { x: 0, y: 0 };
    for (const b of blocks) { if (b.pos) last = b.pos; else b.pos = { ...last }; }
    const band = Math.max(1, this.H * 0.04);
    const sorted = [...blocks].sort((a, b) => (a.kind === 'title' ? 0 : 1) - (b.kind === 'title' ? 0 : 1)
      || Math.floor(a.pos!.y / band) - Math.floor(b.pos!.y / band) || a.pos!.x - b.pos!.x || a.order - b.order);
    let titles = sorted.filter((b) => b.kind === 'title');
    let body = sorted.filter((b) => b.kind !== 'title');
    // No title placeholder: a single short line at the top of the slide, before anything else, is its title.
    if (!titles.length && body[0]?.kind === 'text' && body[0].lines.length === 1 && body[0].lines[0].length <= 90 && body[0].pos!.y <= this.H * 0.25) {
      titles = [body[0]]; body = body.slice(1);
    }
    const title = oneLine(titles.flatMap((b) => b.lines).join(' ').replace(/^(- |\d+\. )/, ''));
    const lines = [`## Slide ${n}${title ? `: ${title}` : ''}`];
    for (const b of body) lines.push(...(b.later ? b.later(title) : b.lines));
    const notes = this.notes(rels);
    if (notes.length) { this.meta.notes++; lines.push(`Notes: ${notes[0].trim()}`, ...notes.slice(1).map((l) => `  ${l}`)); }
    return lines;
  }

  /** A table or chart's name: "S3 Costs by team" (unique in the deck, at most 40 characters, never ": "). */
  private uniqueName(raw: string): string {
    const base = shorten(oneLine(raw.replace(/\s*:\s*/g, ' - ')), NAME_MAX);
    let name = base;
    for (let k = 2; this.names.has(name.toLowerCase()); k++) name = `${shorten(base, NAME_MAX - String(k).length - 1)} ${k}`;
    this.names.add(name.toLowerCase());
    return name;
  }

  private walk(tree: XNode | undefined, tf: Tf, out: Block[], ctx: SlideCtx): void {
    for (const el of kids(tree)) {
      switch (el.local) {
        case 'sp': this.shape(el, tf, out, ctx); break;
        case 'grpSp': {
          // A group's children are placed in its own space (chOff, chExt), mapped onto the slide by its off and ext.
          const x = xpath(el, 'grpSpPr', 'xfrm');
          const off = kid(x, 'off'); const ext = kid(x, 'ext'); const chOff = kid(x, 'chOff'); const chExt = kid(x, 'chExt');
          const ox = int(attr(off, 'x')); const oy = int(attr(off, 'y'));
          const cx = int(attr(chOff, 'x')); const cy = int(attr(chOff, 'y'));
          const sx = int(attr(chExt, 'cx')) ? int(attr(ext, 'cx'), 1) / int(attr(chExt, 'cx')) : 1;
          const sy = int(attr(chExt, 'cy')) ? int(attr(ext, 'cy'), 1) / int(attr(chExt, 'cy')) : 1;
          this.walk(el, off ? (px, py) => tf(ox + (px - cx) * sx, oy + (py - cy) * sy) : tf, out, ctx);
          break;
        }
        case 'graphicFrame': this.frame(el, tf, out, ctx); break;
        case 'pic': {
          this.meta.pictures++;
          const pr = xpath(el, 'nvPicPr', 'cNvPr');
          const alt = oneLine(attr(pr, 'descr') ?? '') || oneLine(attr(pr, 'title') ?? '');
          if (alt) out.push({ kind: 'picture', pos: this.posOf(xpath(el, 'spPr', 'xfrm'), tf), order: out.length, lines: [`[Picture: ${shorten(alt, 300)}]`] });
          break;
        }
        case 'AlternateContent': {
          // Newer content with a fallback for older readers: the newer one when it is there.
          const choice = kid(el, 'Choice') ?? kid(el, 'Fallback');
          if (choice) this.walk(choice, tf, out, ctx);
          break;
        }
        default: break;
      }
    }
  }

  private posOf(xfrm: XNode | undefined, tf: Tf): Pos | undefined {
    const off = kid(xfrm, 'off');
    return off ? tf(int(attr(off, 'x')), int(attr(off, 'y'))) : undefined;
  }

  private shape(sp: XNode, tf: Tf, out: Block[], ctx: SlideCtx): void {
    const ph = xpath(sp, 'nvSpPr', 'nvPr', 'ph');
    const type = ph ? attr(ph, 'type') ?? 'body' : undefined;
    // Footers, dates, slide numbers and headers are the master's boilerplate, never content.
    if (type && ['dt', 'ftr', 'sldNum', 'hdr', 'sldImg'].includes(type)) return;
    const isTitle = type === 'title' || type === 'ctrTitle';
    const lines = paragraphs(kid(sp, 'txBody'), Boolean(type) && !isTitle && type !== 'subTitle');
    if (!lines.length) return;
    const pos = this.posOf(xpath(sp, 'spPr', 'xfrm'), tf)
      ?? (ph ? ctx.layout.get(`idx:${attr(ph, 'idx') ?? ''}`) ?? ctx.layout.get(`type:${normType(type!)}`) : undefined);
    out.push({ kind: isTitle ? 'title' : 'text', pos, order: out.length, lines });
  }

  private frame(gf: XNode, tf: Tf, out: Block[], ctx: SlideCtx): void {
    const pos = this.posOf(kid(gf, 'xfrm'), tf);
    const data = xpath(gf, 'graphic', 'graphicData');
    const tbl = kid(data, 'tbl');
    if (tbl) { out.push({ kind: 'table', pos, order: out.length, lines: [], later: (title) => this.table(tbl, ctx, title) }); return; }
    const chart = kid(data, 'chart');
    if (chart) {
      const root = this.xml(ctx.rels.get(relAttr(chart, 'id') ?? '')?.target);
      out.push({ kind: 'chart', pos, order: out.length, lines: [], later: (title) => (root ? this.chart(root, ctx, title) : ['[Chart: its data could not be found]']) });
      return;
    }
    const dgm = kid(data, 'relIds');
    if (dgm) {
      const lines = smartArt(this.xml(ctx.rels.get(relAttr(dgm, 'dm') ?? '')?.target));
      if (lines.length) { this.meta.smartArt++; out.push({ kind: 'smartart', pos, order: out.length, lines: ['[SmartArt]', ...lines] }); }
      return;
    }
    const name = oneLine(attr(xpath(gf, 'nvGraphicFramePr', 'cNvPr'), 'name') ?? '');
    if (/ole|object/i.test(attr(data, 'uri') ?? '')) out.push({ kind: 'object', pos, order: out.length, lines: [`[Embedded object${name ? ` ${shorten(name, 80)}` : ''}: not read]`] });
  }

  /* ---------- tables ---------- */

  private table(tbl: XNode, ctx: SlideCtx, title: string): string[] {
    const g = readGrid(tbl);
    if (!g) return [];
    // A table of one row, or of one column, is text on the slide, not data.
    if (g.body.length < 1 || g.width < 2) return g.all.map((r) => r.filter(Boolean).join(' | ')).filter(Boolean);
    this.meta.tables++;
    ctx.tableNo++;
    const shown = `${plural(g.width, 'column')} (${shorten(g.header.join(', '), 160)}) and ${plural(g.total, 'row')}${g.merged ? ', merged cells filled in' : ''}`;
    if (this.tables.length >= DECK_TABLES_MAX) {
      this.meta.cut = true;
      return [`[Table: ${shown}; not read as a table: over ${DECK_TABLES_MAX} tables and charts]`, ...g.all.slice(0, 6).map((r) => `  ${r.join(' | ')}`)];
    }
    const name = this.uniqueName(`S${ctx.n} ${title || 'table'}${ctx.tableNo > 1 ? ` table ${ctx.tableNo}` : ''}`);
    this.tables.push({ name, header: g.header, rows: g.body, total: g.total });
    return [`[Table "${name}": ${shown}; read as a table]`];
  }

  /* ---------- charts ---------- */

  private chart(root: XNode, ctx: SlideCtx, title: string): string[] {
    const c = readChart(root);
    if (!c) return ['[Chart: no data in it]'];
    this.meta.charts++;
    const series = c.header.slice(1);
    const shown = `${c.kind}${c.title ? ` "${shorten(c.title, 100)}"` : ''}: ${plural(series.length, 'series', 'series')} (${shorten(series.join(', '), 160)}) over ${plural(c.rows.length, 'point')}`;
    if (!c.rows.length) return [`[Chart: ${shown}]`];
    if (this.tables.length >= DECK_TABLES_MAX) { this.meta.cut = true; return [`[Chart: ${shown}; not read as a table: over ${DECK_TABLES_MAX} tables and charts]`]; }
    const name = this.uniqueName(`S${ctx.n} ${c.title || (title ? `${title} chart` : 'chart')}`);
    this.tables.push({ name, header: cleanHeader(c.header), rows: c.rows, total: c.rows.length });
    return [`[Chart "${name}": ${shown}; its data read as a table]`];
  }

  /* ---------- notes ---------- */

  private notes(rels: Map<string, Rel>): string[] {
    const root = this.xml([...rels.values()].find((r) => r.type.endsWith('/notesSlide'))?.target);
    if (!root) return [];
    const sps = all(xpath(first(root, 'notes'), 'cSld', 'spTree'), 'sp');
    const typeOf = (sp: XNode) => { const ph = xpath(sp, 'nvSpPr', 'nvPr', 'ph'); return ph ? attr(ph, 'type') ?? 'body' : undefined; };
    const bodies = sps.filter((sp) => typeOf(sp) === 'body');
    const use = bodies.length ? bodies : sps.filter((sp) => !['sldImg', 'sldNum', 'hdr', 'ftr', 'dt'].includes(typeOf(sp) ?? ''));
    return use.flatMap((sp) => paragraphs(kid(sp, 'txBody'), false));
  }

  /* ---------- layout positions ---------- */

  /** Where the slide's layout (then its master) puts each placeholder, by idx and by type. */
  private layoutPositions(rels: Map<string, Rel>): Map<string, Pos> {
    const layout = [...rels.values()].find((r) => r.type.endsWith('/slideLayout'))?.target;
    if (!layout) return new Map();
    const cached = this.layoutCache.get(layout);
    if (cached) return cached;
    const out = new Map<string, Pos>();
    const add = (p: string | undefined, byIdx: boolean) => {
      for (const sp of all(xpath(first(this.xml(p), 'cSld'), 'spTree'), 'sp')) {
        const ph = xpath(sp, 'nvSpPr', 'nvPr', 'ph');
        const off = xpath(sp, 'spPr', 'xfrm', 'off');
        if (!ph || !off) continue;
        const pos = { x: int(attr(off, 'x')), y: int(attr(off, 'y')) };
        const idx = attr(ph, 'idx');
        if (byIdx && idx && !out.has(`idx:${idx}`)) out.set(`idx:${idx}`, pos);
        const t = `type:${normType(attr(ph, 'type') ?? 'body')}`;
        if (!out.has(t)) out.set(t, pos);
      }
    };
    add(layout, true);
    add([...this.rels(layout).values()].find((r) => r.type.endsWith('/slideMaster'))?.target, false);
    this.layoutCache.set(layout, out);
    return out;
  }
}

const normType = (t: string) => (t === 'ctrTitle' ? 'title' : t === 'obj' ? 'body' : t);

/* ---------- text ---------- */

/** A paragraph's text: its runs, line breaks, and fields (a slide number or date field is boilerplate). */
function runsOf(p: XNode): string {
  let s = '';
  for (const k of kids(p)) {
    if (k.local === 'r') s += textOf(kid(k, 't'));
    else if (k.local === 'br') s += '\n';
    else if (k.local === 'fld' && !/^(slidenum|datetime)/i.test(attr(k, 'type') ?? '')) s += textOf(kid(k, 't'));
  }
  return s.replace(/\u000b/g, '\n');
}

/**
 * A text body's paragraphs as lines: each level indented two spaces, a bullet as "- " and numbering as "1. " (its own
 * count per level), where the paragraph or, for a body placeholder, the master gives one; empty paragraphs dropped;
 * a line break inside a paragraph kept as a new line under it.
 */
export function paragraphs(txBody: XNode | undefined, bulletsByDefault: boolean): string[] {
  const out: string[] = [];
  const counters: number[] = [];
  for (const p of kids(txBody, 'p')) {
    const pPr = kid(p, 'pPr');
    const lvl = Math.min(8, Math.max(0, int(attr(pPr, 'lvl'))));
    const parts = runsOf(p).split('\n').map(oneLine).filter(Boolean);
    if (!parts.length) continue;
    const auto = kid(pPr, 'buAutoNum');
    const bullet = kid(pPr, 'buNone') ? false : kid(pPr, 'buChar') || auto ? true : bulletsByDefault;
    let prefix = '';
    if (bullet && auto) {
      counters.length = lvl + 1;
      counters[lvl] = (counters[lvl] ?? int(attr(auto, 'startAt'), 1) - 1) + 1;
      prefix = `${counters[lvl]}. `;
    } else {
      counters.length = Math.min(counters.length, lvl);
      if (bullet) prefix = '- ';
    }
    const indent = '  '.repeat(lvl);
    out.push(`${indent}${prefix}${parts[0]}`, ...parts.slice(1).map((l) => `${indent}${prefix ? '  ' : ''}${l}`));
  }
  return out;
}

/* ---------- tables ---------- */

const NUMERIC = /^[-+]?\(?[$£€¥]?\s?\d[\d.,\s]*%?\)?\s?[kKmMbB]?n?$/;

export interface Grid { header: string[]; body: string[][]; all: string[][]; total: number; width: number; merged: boolean }

/**
 * A table's grid, merged cells handled: a cell spanning columns (gridSpan, its covered cells hMerge) or rows
 * (rowSpan, its covered cells vMerge) is placed by the table's grid. Header rows: the first row, or the first two when
 * the first has a cell spanning columns over a second row of labels ("Q1 Actual", "Q1 Plan"); none when the first row
 * is plainly data (numbers) and the table is not marked as having a header row. In the body a value merged down is
 * filled into each row it covers; one merged across stays in its first column.
 */
export function readGrid(tbl: XNode): Grid | undefined {
  const gridCols = kids(kid(tbl, 'tblGrid'), 'gridCol').length;
  const trs = kids(tbl, 'tr').slice(0, ROWS_READ_MAX + 10);
  if (!trs.length) return undefined;
  interface Cell { text: string; h: boolean; v: boolean }
  const cells: Cell[][] = [];
  let merged = false;
  for (const tr of trs) {
    const tcs = kids(tr, 'tc');
    const spans = tcs.map((tc) => Math.max(1, int(attr(tc, 'gridSpan'), 1)));
    // Most writers keep a covered cell (hMerge) for each column a span covers; some leave them out.
    const leftOut = gridCols > 0 && tcs.length < gridCols && !tcs.some((tc) => on(attr(tc, 'hMerge'))) && spans.reduce((a, b) => a + b, 0) <= gridCols;
    const row: Cell[] = [];
    tcs.forEach((tc, i) => {
      const h = on(attr(tc, 'hMerge')); const v = on(attr(tc, 'vMerge'));
      if (h || v || spans[i] > 1 || int(attr(tc, 'rowSpan'), 1) > 1) merged = true;
      row.push({ text: paragraphs(kid(tc, 'txBody'), false).map((l) => l.trim()).join(' '), h, v });
      if (leftOut) for (let k = 1; k < spans[i]; k++) row.push({ text: '', h: true, v });
    });
    cells.push(row);
  }
  const width = Math.min(COLUMNS_MAX, Math.max(gridCols, ...cells.map((r) => r.length)));
  // origin: a covered cell has the text of the cell covering it (for header names); shown: what a body row holds.
  const origin: string[][] = []; const shown: string[][] = [];
  cells.forEach((row, r) => {
    origin.push([]); shown.push([]);
    for (let c = 0; c < width; c++) {
      const cell = row[c] ?? { text: '', h: false, v: false };
      origin[r][c] = cell.h ? origin[r][c - 1] ?? '' : cell.v ? origin[r - 1]?.[c] ?? '' : cell.text;
      shown[r][c] = cell.v ? shown[r - 1]?.[c] ?? '' : cell.h ? '' : cell.text;
    }
  });
  const numeric = (s: string) => NUMERIC.test(s.trim());
  const labels = (r: number) => { const vals = (origin[r] ?? []).filter(Boolean); return vals.length > 0 && vals.every((v) => !numeric(v)); };
  const marked = on(attr(kid(tbl, 'tblPr'), 'firstRow'));
  let head = 1;
  if (!marked && origin[0].some((v) => v && numeric(v))) head = 0;
  else if (cells.length >= 3 && cells[0].some((c) => c.h) && labels(1) && cells[1].filter((c) => c.text).length >= 2) head = 2;
  const names = Array.from({ length: width }, (_, c) => {
    const parts: string[] = [];
    for (let r = 0; r < head; r++) { const v = origin[r][c]; if (v && v !== parts[parts.length - 1]) parts.push(v); }
    return parts.join(' ');
  });
  const body = shown.slice(head).filter((r) => r.some(Boolean));
  return { header: cleanHeader(names), body: body.slice(0, ROWS_READ_MAX), all: shown, total: body.length, width, merged };
}

/* ---------- charts ---------- */

export interface ChartRead { kind: string; title: string; header: string[]; rows: string[][] }

const CHART_WORDS: Record<string, string> = {
  barChart: 'bar chart', bar3DChart: 'bar chart', lineChart: 'line chart', line3DChart: 'line chart', pieChart: 'pie chart', pie3DChart: 'pie chart',
  ofPieChart: 'pie chart', doughnutChart: 'doughnut chart', areaChart: 'area chart', area3DChart: 'area chart', scatterChart: 'scatter chart',
  bubbleChart: 'bubble chart', radarChart: 'radar chart', stockChart: 'stock chart', surfaceChart: 'surface chart', surface3DChart: 'surface chart',
};
const CHARTEX_WORDS: Record<string, string> = {
  clusteredColumn: 'histogram', paretoLine: 'pareto chart', waterfall: 'waterfall chart', funnel: 'funnel chart', treemap: 'treemap',
  sunburst: 'sunburst chart', boxWhisker: 'box and whisker chart', regionMap: 'map chart',
};

/** A chart's or a series' title: its rich text, or the cell it points at (cached). */
function titleOf(t: XNode | undefined): string {
  if (!t) return '';
  const rich = first(t, 'rich');
  if (rich) return oneLine(kids(rich, 'p').map(runsOf).join(' '));
  return oneLine(all(t, 'v').map(textOf).join(' '));
}

/**
 * A cached number as PowerPoint shows it: a percentage format as a percentage, a date format as a date (from the
 * spreadsheet day count), a currency format with its symbol; anything else as it is.
 */
export function fmtValue(v: string, fmt = ''): string {
  const s = v.trim();
  if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return s;
  const n = Number(s);
  const round = (x: number) => String(Number(x.toPrecision(12)));
  const bare = fmt.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, ' ');
  if (/%/.test(bare)) return `${round(n * 100)}%`;
  if (/(^|[^a-z])(y{2,4}|d{1,4}|m{3,5})([^a-z]|$)/i.test(bare) && n > 0 && n < 2_958_466) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86_400_000));
    return d.toISOString().slice(0, /h|s/i.test(bare) ? 16 : 10).replace('T', ' ');
  }
  const sym = /\[\$([£€$¥])|"([£€$¥])"|\\([£€$¥])|^([£€$¥])/.exec(fmt);
  const cur = sym ? sym.slice(1).find(Boolean) ?? '' : '';
  return `${n < 0 && cur ? '-' : ''}${cur}${round(cur ? Math.abs(n) : n)}`;
}

/** The name of a point's group on each higher level: the nearest name at or before it. */
const groupAt = (level: string[], i: number) => { for (let k = i; k >= 0; k--) if (level[k]) return level[k]; return ''; };

/** A series' points (strCache, numCache, a literal or a multi-level category), formatted, by index. */
function pointsOf(n: XNode | undefined): string[] {
  if (!n) return [];
  const ml = first(n, 'multiLvlStrCache') ?? first(n, 'multiLvlStrLit');
  if (ml) {
    const count = Math.min(POINTS_MAX, int(attr(kid(ml, 'ptCount'), 'val')));
    const levels = kids(ml, 'lvl').map((lvl) => {
      const arr: string[] = Array(count).fill('');
      for (const pt of kids(lvl, 'pt')) { const i = int(attr(pt, 'idx'), -1); if (i >= 0 && i < count) arr[i] = oneLine(textOf(kid(pt, 'v'))); }
      return arr;
    });
    // The first level is next to the axis; each higher one names the group its points are in.
    return Array.from({ length: count }, (_, i) => [...levels.slice(1).reverse().map((lv) => groupAt(lv, i)), levels[0]?.[i] ?? ''].filter(Boolean).join(' / '));
  }
  const c = first(n, 'strCache') ?? first(n, 'numCache') ?? first(n, 'strLit') ?? first(n, 'numLit');
  if (!c) return [];
  const fmt = textOf(kid(c, 'formatCode'));
  const pts = kids(c, 'pt');
  const count = Math.min(POINTS_MAX, int(attr(kid(c, 'ptCount'), 'val')) || pts.reduce((m, pt) => Math.max(m, int(attr(pt, 'idx'), -1) + 1), 0));
  const arr: string[] = Array(count).fill('');
  for (const pt of pts) {
    const i = int(attr(pt, 'idx'), -1);
    if (i >= 0 && i < count) arr[i] = fmtValue(oneLine(textOf(kid(pt, 'v'))), attr(pt, 'formatCode') ?? fmt);
  }
  return arr;
}

/**
 * A chart's data from its cached values (what PowerPoint shows; the embedded workbook is not opened): the categories
 * as the first column and one column per series, or for a scatter chart whose series do not share their x values,
 * one row per point (series, x, y). Chart types from c:plotArea; the newer charts (cx: waterfall, treemap, funnel…)
 * from their data blocks.
 */
export function readChart(root: XNode): ChartRead | undefined {
  const space = first(root, 'chartSpace');
  if (!space) return undefined;
  if (kid(space, 'chartData')) return readChartEx(space);
  const chart = kid(space, 'chart');
  const title = attr(kid(chart, 'autoTitleDeleted'), 'val') === '1' ? '' : titleOf(kid(chart, 'title'));
  const plot = kid(chart, 'plotArea');
  const groups = kids(plot).filter((k) => k.local in CHART_WORDS);
  if (!groups.length) return undefined;
  const kindOf = (g: XNode) => (g.local.startsWith('bar') && attr(kid(g, 'barDir'), 'val') === 'col' ? 'column chart' : CHART_WORDS[g.local]);
  const words = [...new Set(groups.map(kindOf))];
  const kind = words.length > 1 ? `combination chart (${words.join(', ')})` : words[0];
  const series = groups.flatMap((g) => kids(g, 'ser').map((s) => ({
    order: int(attr(kid(s, 'order'), 'val'), int(attr(kid(s, 'idx'), 'val'))),
    name: titleOf(kid(s, 'tx')),
    cats: pointsOf(kid(s, 'cat') ?? kid(s, 'xVal')),
    vals: pointsOf(kid(s, 'val') ?? kid(s, 'yVal')),
  }))).sort((a, b) => a.order - b.order);
  if (!series.length) return { kind, title, header: [], rows: [] };
  const axisTitle = (local: string) => titleOf(kid(kids(plot, local)[0], 'title'));
  const scatter = groups.every((g) => /scatter|bubble/.test(g.local));
  const catName = scatter ? axisTitle('valAx') || 'X' : axisTitle('catAx') || axisTitle('dateAx') || 'Category';
  const names = series.map((s, i) => s.name || (series.length === 1 ? title || 'Value' : `Series ${i + 1}`));
  const sameX = series.every((s) => s.cats.join('\u0001') === series[0].cats.join('\u0001'));
  if (scatter && !sameX) {
    const rows = series.flatMap((s, i) => s.vals.map((v, k) => [names[i], s.cats[k] ?? String(k + 1), v])).filter((r) => r[2] !== '').slice(0, POINTS_MAX);
    return { kind, title, header: ['Series', catName, 'Y'], rows };
  }
  const cats = series.find((s) => s.cats.some(Boolean))?.cats ?? [];
  const len = Math.min(POINTS_MAX, Math.max(cats.length, ...series.map((s) => s.vals.length)));
  const rows = Array.from({ length: len }, (_, i) => [cats[i] || String(i + 1), ...series.map((s) => s.vals[i] ?? '')]).filter((r) => r.slice(1).some(Boolean));
  return { kind, title, header: [catName, ...names].slice(0, COLUMNS_MAX), rows: rows.map((r) => r.slice(0, COLUMNS_MAX)) };
}

function readChartEx(space: XNode): ChartRead | undefined {
  const dim = (d: XNode | undefined) => {
    const levels = kids(d, 'lvl').map((lvl) => {
      const count = Math.min(POINTS_MAX, int(attr(lvl, 'ptCount')));
      const arr: string[] = Array(count).fill('');
      for (const pt of kids(lvl, 'pt')) { const i = int(attr(pt, 'idx'), -1); if (i >= 0 && i < count) arr[i] = fmtValue(oneLine(textOf(pt)), attr(lvl, 'formatCode') ?? ''); }
      return arr;
    });
    return Array.from({ length: levels[0]?.length ?? 0 }, (_, i) => [...levels.slice(1).reverse().map((lv) => groupAt(lv, i)), levels[0][i]].filter(Boolean).join(' / '));
  };
  const data = new Map<string, { cats: string[]; vals: string[] }>();
  for (const d of kids(kid(space, 'chartData'), 'data')) {
    const nums = kids(d, 'numDim');
    data.set(attr(d, 'id') ?? '', {
      cats: dim(kids(d, 'strDim')[0] ?? nums.find((x) => attr(x, 'type') === 'cat' || attr(x, 'type') === 'x')),
      vals: dim(nums.find((x) => ['val', 'size', 'y'].includes(attr(x, 'type') ?? ''))),
    });
  }
  const chart = kid(space, 'chart');
  const title = titleOf(kid(chart, 'title'));
  const series = all(kid(chart, 'plotArea'), 'series').map((s) => ({
    layout: attr(s, 'layoutId') ?? '', name: oneLine(all(kid(s, 'tx'), 'v').map(textOf).join(' ')), d: data.get(attr(kid(s, 'dataId'), 'val') ?? '') ?? { cats: [], vals: [] },
  })).filter((s) => s.layout !== 'paretoLine');
  if (!series.length) return undefined;
  const kind = CHARTEX_WORDS[series[0].layout] ?? 'chart';
  const cats = series[0].d.cats;
  const len = Math.min(POINTS_MAX, Math.max(cats.length, ...series.map((s) => s.d.vals.length)));
  const rows = Array.from({ length: len }, (_, i) => [cats[i] || String(i + 1), ...series.map((s) => s.d.vals[i] ?? '')]).filter((r) => r.slice(1).some(Boolean));
  return { kind, title, header: ['Category', ...series.map((s, i) => s.name || (series.length === 1 ? title || 'Value' : `Series ${i + 1}`))], rows };
}

/* ---------- SmartArt ---------- */

/** SmartArt's text as an outline: its points under the document point, ordered and indented by their parent links. */
export function smartArt(root: XNode | undefined): string[] {
  const model = first(root, 'dataModel');
  if (!model) return [];
  const pts = new Map<string, { type: string; text: string }>();
  for (const pt of kids(kid(model, 'ptLst'), 'pt')) {
    pts.set(attr(pt, 'modelId') ?? '', { type: attr(pt, 'type') ?? 'node', text: oneLine(kids(kid(pt, 't'), 'p').map(runsOf).join(' ')) });
  }
  const children = new Map<string, { dest: string; ord: number }[]>();
  for (const c of kids(kid(model, 'cxnLst'), 'cxn')) {
    if ((attr(c, 'type') ?? 'parOf') !== 'parOf') continue;
    const src = attr(c, 'srcId') ?? '';
    children.set(src, [...(children.get(src) ?? []), { dest: attr(c, 'destId') ?? '', ord: int(attr(c, 'srcOrd')) }]);
  }
  const out: string[] = []; const seen = new Set<string>();
  const visit = (id: string, depth: number) => {
    for (const { dest } of [...(children.get(id) ?? [])].sort((a, b) => a.ord - b.ord)) {
      if (seen.has(dest)) continue;
      seen.add(dest);
      const p = pts.get(dest);
      if (!p || !['node', 'asst'].includes(p.type)) continue;
      if (p.text) out.push(`${'  '.repeat(depth)}- ${p.text}`);
      visit(dest, p.text ? depth + 1 : depth);
    }
  };
  for (const [id, p] of pts) if (p.type === 'doc') visit(id, 0);
  for (const [id, p] of pts) if (!seen.has(id) && ['node', 'asst'].includes(p.type) && p.text) out.push(`- ${p.text}`);
  return out.slice(0, 200);
}

/** What a deck read holds, in a few words ("12 slides (1 hidden, skipped), 2 tables, 1 chart, notes on 3 slides"). */
export function deckWords(m: DeckMeta): string {
  return [
    `${plural(m.slides, 'slide')}${m.hidden ? ` (${m.hidden} hidden, skipped)` : ''}`,
    m.tables ? plural(m.tables, 'table') : '', m.charts ? plural(m.charts, 'chart') : '', m.smartArt ? plural(m.smartArt, 'SmartArt graphic') : '',
    m.pictures ? plural(m.pictures, 'picture') : '', m.notes ? `notes on ${plural(m.notes, 'slide')}` : '', m.plain ? 'read as plain text' : '',
  ].filter(Boolean).join(', ');
}
