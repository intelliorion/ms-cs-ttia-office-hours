/**
 * "Build the deck": the AI writes the slides and the speaker script as a structured spec (never HTML or slides), the
 * code checks it against the Café's rules, and the app draws the files from it in code: roadshow/deck.html (one
 * self-contained file), script.md, run-of-show.md and deck.pptx. Files are written only into the idea folder's
 * roadshow/. The photos are read from the idea folder and never go to the AI.
 */
import path from 'node:path';
import type { Clock } from '../clock';
import { writeFileAtomic, appendHistory } from '../workspace/files';
import { showNames, type Coded } from '../command/names';
import { pointOf } from '../design/points';
import {
  DECK_POINT_MAX, DECK_POINTS_MAX, DECK_TITLE_MAX, deckTitleMax, type DeckSlide, type DeckSpec, type DeckVisual, type RoadshowInput,
} from '../ai/tasks';
import type { DiagramSpec } from '../design/diagram';
import { columnsOf, isUsable, KIND_LABELS, whatOf, type DataFile } from '../data/model';
import { DECK_FILES, photosBasis, presentersOf, readRoadshow, roadshowDir, rosterOf, rolesLine, writeRoadshow, type RoadshowDeck, type RoadshowState, type TemplateNote } from './store';
import { codedRoadshowInput, datesOf, diagramOfDesign, gatherRoadshow, recordBasis, visualsOf, type RoadshowSource } from './source';
import { IMAGE_MIME, imageSize, readStoredPhoto, type ImageKind } from './photos';
import { readTemplateTheme, DEFAULT_THEME, type DeckTheme } from './template';
import { renderDeckHtml } from './render/html';
import { renderScriptMd, renderRunOfShowMd } from './render/text';
import { renderDeckPptx } from './render/pptx';

export class DeckError extends Error {}

/* ---------- checking the AI's spec ---------- */

/** Value words the Café never puts on a slide: it shows that an idea works, not what it is worth. */
export const VALUE_WORDS = /\b(ROI|return on (?:the )?investment|KPIs?|cost[- ]savings?|savings|payback|business case|FTEs?)\b|[$£€]\s?\d/i;
/** A figure: a number of two or more digits, or any percentage or amount. */
const FIGURE = /(?:[$£€]\s?)?\d[\d,.]*\d%?|\d%/g;
/** Talk timings are the deck's own, not claims. */
const TIMING = /^\s*(?:min(?:ute)?s?|seconds?|secs?|slides?)\b/i;

/** The figures in a line that the record does not hold (talk timings aside). */
export function unknownFigures(text: string, data: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(FIGURE)) {
    const raw = m[0].replace(/^[$£€]\s?/, '');
    if (TIMING.test(text.slice((m.index ?? 0) + m[0].length))) continue;
    const plain = raw.replace(/%$/, '');
    const digits = plain.replace(/[,.]/g, '');
    if (digits.length < 2 && !raw.endsWith('%') && !/^[$£€]/.test(m[0])) continue;
    if (data.includes(plain) || data.includes(digits)) continue;
    out.push(m[0]);
  }
  return out;
}

const one = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const LEFTOVER_CODE = /\[[A-Z]\d{1,3}\]/g;

/** The AI's words with the names put back; a code the app does not know becomes "the team". */
export function decodeDeck(spec: DeckSpec, codes: Map<string, Coded>): DeckSpec {
  const n = (t: string) => showNames(t, codes).replace(LEFTOVER_CODE, 'the team');
  return {
    title: n(spec.title), subtitle: n(spec.subtitle),
    slides: spec.slides.map((s) => ({
      ...s, title: n(s.title), points: s.points.map(n), notes: n(s.notes),
      ...(s.quote !== undefined ? { quote: n(s.quote) } : {}),
      ...(s.before ? { before: s.before.map(n) } : {}), ...(s.after ? { after: s.after.map(n) } : {}),
    })),
  };
}

const sentences = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z[“"'(])/);

/**
 * The code's check of the deck: value words and figures the record does not hold come out (a point goes; in the
 * script, the sentence); each visual must be one the app can draw; the title slide opens the deck; the team slide is
 * there when the idea has people; the timings add up to about ten minutes. Says what it changed, in plain words.
 */
export function checkDeck(spec: DeckSpec, ctx: { visuals: DeckVisual[]; data: string; hasTeam: boolean }): { spec: DeckSpec; warnings: string[] } {
  const warnings: string[] = [];
  const bad = (t: string) => (VALUE_WORDS.test(t) ? 'a value claim' : unknownFigures(t, ctx.data).length ? 'a figure the record does not hold' : '');
  const slides: DeckSlide[] = spec.slides.map((s, i) => {
    const where = `Slide ${i + 1} (${s.title})`;
    const lines = (list: string[] | undefined) => (list ?? []).map((p) => one(p, DECK_POINT_MAX)).filter((p) => {
      const why = p && bad(p);
      if (why) warnings.push(`${where}: took out "${p}" (${why})`);
      return p && !why;
    }).slice(0, DECK_POINTS_MAX);
    const notes = s.notes.split(/\n{2,}/).map((para) => sentences(para).filter((x) => {
      const why = bad(x);
      if (why) warnings.push(`${where}, script: took out "${one(x, 120)}" (${why})`);
      return !why;
    }).join(' ')).filter((p) => p.trim()).join('\n\n');
    let visual = s.visual && ctx.visuals.includes(s.visual) ? s.visual : undefined;
    if (!visual && s.kind === 'team' && ctx.visuals.includes('team')) visual = 'team';
    if (!visual && s.kind === 'diagram' && ctx.visuals.includes('diagram')) visual = 'diagram';
    if (!visual && s.kind === 'tool' && ctx.visuals.includes('fit-table')) visual = 'fit-table';
    if (!visual && s.kind === 'data' && ctx.visuals.includes('data')) visual = 'data';
    const quote = s.quote && !bad(s.quote) ? one(s.quote, 240) : '';
    const title = one(s.title, deckTitleMax(s.kind));
    return {
      kind: s.kind, title: bad(title) ? s.kind[0].toUpperCase() + s.kind.slice(1) : title, points: lines(s.points),
      ...(quote ? { quote } : {}), ...(visual ? { visual } : {}),
      ...(visual === 'before-after' ? { before: lines(s.before), after: lines(s.after) } : {}),
      notes: notes.trim() || 'Pause here and let the slide speak.', minutes: Math.min(4, Math.max(0.25, Number(s.minutes) || 0.5)),
    };
  });
  if (slides[0]?.kind !== 'title') {
    slides.unshift({ kind: 'title', title: one(spec.title, DECK_TITLE_MAX), points: [], notes: `Hello everyone, and thank you for having us. We're here to show you ${one(spec.title, DECK_TITLE_MAX)}.`, minutes: 0.25 });
    warnings.push('Added a title slide to open the deck');
  }
  if (ctx.hasTeam && !slides.some((s) => s.kind === 'team')) {
    // After how it works today (else the problem): the people come once the room knows what they took on.
    const today = slides.findIndex((s) => s.kind === 'today');
    const after = today >= 0 ? today : slides.findIndex((s) => s.kind === 'problem');
    slides.splice(after >= 0 ? after + 1 : 1, 0, { kind: 'team', title: 'The team behind it', points: [], visual: 'team', notes: 'This is the team behind it, and the part each of us played.', minutes: 0.5 });
    warnings.push('Added the team slide');
  }
  if (ctx.visuals.includes('data') && !slides.some((s) => s.kind === 'data')) {
    // The data slide goes after what was built (else after the team, how it works today or the problem).
    const at = ['solution', 'team', 'today', 'problem'].map((k) => slides.findIndex((s) => s.kind === k)).find((i) => i >= 0) ?? 0;
    slides.splice(at + 1, 0, { kind: 'data', title: 'The data it runs on', points: [], visual: 'data', notes: 'This is the data it runs on: what goes in and what comes out. It is sample data, masked, never the real thing.', minutes: 0.5 });
    warnings.push('Added the data slide');
  }
  const total = slides.reduce((t, s) => t + s.minutes, 0);
  if (total < 7 || total > 13) {
    const k = 10 / total;
    for (const s of slides) s.minutes = Math.max(0.25, Math.round(s.minutes * k * 4) / 4);
    warnings.push(`The timings added up to ${Math.round(total * 10) / 10} minutes: scaled to about 10`);
  }
  return { spec: { title: one(spec.title, DECK_TITLE_MAX) || 'Our proof of concept', subtitle: one(spec.subtitle, 160), slides }, warnings };
}

/* ---------- what the app draws: the spec plus the record ---------- */

export interface DeckPhoto { mime: string; base64: string; kind: ImageKind; w?: number; h?: number }
export interface DeckPerson { name: string; roles: string; initials: string; photo?: DeckPhoto }
export type FitMark = 'yes' | 'partly' | 'no' | 'out' | 'outside';
/** A file of the confirmed data, as the data slide shows it. */
export interface DeckDataFile { name: string; kind: string; what: string; columns: string[] }
export interface DeckData { inputs: DeckDataFile[]; rules: DeckDataFile[]; output?: DeckDataFile; tool?: string }
export interface DeckModel {
  id: string;
  ideaTitle: string;
  title: string;
  subtitle: string;
  roundName?: string;
  roadshowDate?: string;
  /** The day the files were drawn. */
  builtOn: string;
  slides: DeckSlide[];
  team: DeckPerson[];
  diagram?: DiagramSpec;
  fit?: { tool: string; pathway?: string; rows: { feature: string; mark: FitMark; note: string }[] };
  /** The data slide: the confirmed files, what goes in, the rules, what comes out. */
  data?: DeckData;
  timeline: { what: string; date: string }[];
  /** For a before-after slide the AI left empty: today's process, and what the proof of concept shows. */
  before: string[];
  after: string[];
  theme: DeckTheme;
  template?: TemplateNote;
  /** A link the team gave for the demo, when an answer holds one. */
  demoLink?: string;
  /** Who presents: the lead (or the submitter), then the builder. */
  presenters: string[];
  builder?: string;
}

/** A line of text cut to a slide's length, on a word. */
const clip = (t: string, max = DECK_POINT_MAX) => { const x = one(t, 2000); return x.length <= max ? x : `${x.slice(0, max - 1).replace(/\s+\S*$/, '')}…`; };

/** Today's process as short lines: "1) …" and new lines each start one. */
export function processLines(text: string | undefined): string[] {
  return (text ?? '').split(/\n+|(?=\b\d\)\s)/).map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim()).filter(Boolean).slice(0, 5).map((l) => clip(l));
}

/** The first http(s) link in an answer about the demo. */
export function demoLinkOf(answers: { question: string; answer: string }[] = []): string | undefined {
  for (const a of [...answers].reverse()) {
    if (!/demo/i.test(`${a.question} ${a.answer}`)) continue;
    const m = /https?:\/\/[^\s<>"')]+/.exec(a.answer);
    if (m) return m[0].replace(/[.,;:]+$/, '');
  }
  return undefined;
}

/** The confirmed data, for the data slide and the before-after: the usable files by what they are. */
export function deckData(design: RoadshowSource['design']): DeckData | undefined {
  const d = design.data;
  if (!d?.confirmedAt) return undefined;
  const ok = d.files.filter(isUsable);
  const card = (f: DataFile): DeckDataFile => ({ name: f.name, kind: KIND_LABELS[f.kind], what: clip(whatOf(f) ?? '', 120), columns: columnsOf(f).filter((c) => c.type !== 'empty').map((c) => c.name).slice(0, 6) });
  const out = ok.find((f) => f.kind === 'output') ?? ok.find((f) => f.kind === 'today');
  const inputs = ok.filter((f) => f.kind === 'input').slice(0, 2).map(card);
  if (!inputs.length && !out) return undefined;
  return { inputs, rules: ok.filter((f) => f.kind === 'rules').slice(0, 2).map(card), ...(out ? { output: card(out) } : {}), ...(design.tool ? { tool: design.tool.tool } : {}) };
}

/** Said before the points a full-bleed diagram slide moves into its speaker notes. */
export const DIAGRAM_POINTS_LEAD = 'Points to make on this slide:';

/**
 * The design-diagram slide is drawn full bleed: the diagram fills the slide under the title, with no points beside it.
 * Any point the AI gave it moves to the end of its speaker notes, so nothing it wanted said is lost.
 */
export function bleedSlide(s: DeckSlide): DeckSlide {
  if (s.visual !== 'diagram' || !s.points.length) return s;
  return { ...s, points: [], notes: `${s.notes.trimEnd()}\n\n${DIAGRAM_POINTS_LEAD} ${s.points.map((p) => p.replace(/[.;\s]+$/, '')).join('; ')}.` };
}

/** The deck as the renderers see it: the checked spec, with the team, diagram, fit, dates and photos from the record. */
export async function deckModel(src: RoadshowSource, spec: DeckSpec, opts: { today: string; theme?: DeckTheme; template?: TemplateNote }): Promise<DeckModel> {
  const { idea, design } = src;
  const roster = rosterOf(idea);
  const team: DeckPerson[] = [];
  for (const p of roster) {
    const stored = src.state.photos[p.key];
    const got = stored ? await readStoredPhoto(src.folder, stored.file) : undefined;
    const size = got ? imageSize(got.bytes) : undefined;
    team.push({
      name: p.name, roles: rolesLine(p.roles), initials: p.initials,
      ...(got ? { photo: { mime: IMAGE_MIME[got.kind], base64: Buffer.from(got.bytes).toString('base64'), kind: got.kind, ...(size ?? {}) } } : {}),
    });
  }
  const t = design.tool;
  const fits = new Map((t?.fit ?? []).map((x) => [x.feature.toLowerCase(), x]));
  const fit = t ? {
    tool: t.tool, pathway: t.pathway,
    rows: (design.features.length ? design.features : t.fit.map((x) => ({ name: x.feature, scope: undefined, what: undefined }))).map((f) => {
      const x = fits.get(f.name.toLowerCase());
      if (f.scope?.status === 'out') return { feature: f.name, mark: 'out' as const, note: `Out of scope${f.scope.why ? `: ${f.scope.why}` : ''}` };
      if (f.scope?.status === 'outside') return { feature: f.name, mark: 'outside' as const, note: `With ${f.scope.by}, outside the ${t.tool} build` };
      return { feature: f.name, mark: (x?.fit ?? 'yes') as FitMark, note: x?.note || f.what || '' };
    }),
  } : undefined;
  const presenters = presentersOf(roster);
  const builder = roster.find((p) => p.roles.includes('builder'));
  const after = pointOf(design, 'must-show') ?? design.summary;
  const diagram = diagramOfDesign(design);
  const data = deckData(design);
  // Today's report and the sample output, when the team gave them, open the before and the after.
  const confirmed = design.data?.confirmedAt ? design.data.files.filter(isUsable) : [];
  const today = confirmed.find((f) => f.kind === 'today');
  const sample = confirmed.find((f) => f.kind === 'output');
  const fileLine = (label: string, f: DataFile) => clip(`${label}: ${f.name}${whatOf(f) ? `, ${whatOf(f)}` : ''}`, 110);
  // A before-after the AI wrote still opens with the files when it does not name them: by name only, so its own
  // lines still fit beside it.
  const openWith = (lines: string[] | undefined, f: DataFile | undefined, label: string) =>
    (!lines?.length || !f || lines.some((l) => l.includes(f.name)) ? lines : [`${label}: ${f.name}`, ...lines].slice(0, DECK_POINTS_MAX));
  const withFiles = (sl: DeckSlide): DeckSlide => (sl.visual !== 'before-after' ? sl
    : { ...sl, ...(sl.before ? { before: openWith(sl.before, today, "Today's report") } : {}), ...(sl.after ? { after: openWith(sl.after, sample, 'It makes') } : {}) });
  return {
    id: idea.id, ideaTitle: idea.title, title: spec.title, subtitle: spec.subtitle,
    ...(src.round?.name ? { roundName: src.round.name } : {}), ...(src.round?.roadshow ? { roadshowDate: src.round.roadshow } : {}),
    builtOn: opts.today, slides: (diagram ? spec.slides.map(bleedSlide) : spec.slides).map(withFiles), team,
    ...(diagram ? { diagram } : {}),
    ...(fit ? { fit } : {}),
    timeline: datesOf(src),
    ...(data ? { data } : {}),
    before: [...(today ? [fileLine("Today's report", today)] : []), ...processLines(idea.current_process ?? pointOf(design, 'replaces'))].slice(0, 5),
    after: [...(sample ? [fileLine('It makes', sample)] : []), ...(after ? [clip(after, 240)] : [])],
    theme: opts.theme ?? DEFAULT_THEME, ...(opts.template ? { template: opts.template } : {}),
    ...(demoLinkOf(idea.answers) ? { demoLink: demoLinkOf(idea.answers) } : {}),
    presenters: presenters.map((p) => p.name),
    ...(builder ? { builder: builder.name } : {}),
  };
}

/** Draws every file from the model, into the idea folder's roadshow/ (and nowhere else). */
export async function writeDeckFiles(folder: string, model: DeckModel): Promise<string[]> {
  const dir = roadshowDir(folder);
  const files: Record<string, string | Uint8Array> = {
    'deck.html': renderDeckHtml(model),
    'script.md': renderScriptMd(model),
    'run-of-show.md': renderRunOfShowMd(model),
    'deck.pptx': await renderDeckPptx(model),
  };
  for (const name of DECK_FILES) await writeFileAtomic(path.join(dir, name), files[name]);
  return [...DECK_FILES];
}

/** The data the AI saw, as text: what a figure on a slide must come from. */
const dataText = (input: RoadshowInput, src: RoadshowSource) => `${JSON.stringify(input)} ${src.idea.title}`;

export type RunDeck = (input: RoadshowInput) => Promise<{ provider: string; output: DeckSpec }>;

/**
 * Build the deck: the AI reads everything the idea holds (names coded), its reply is decoded and checked, and the files
 * are drawn. Throws when the AI fails; nothing changes then.
 */
export async function buildDeck(root: string, id: string, run: RunDeck, clock: Clock): Promise<{ state: RoadshowState; deck: RoadshowDeck }> {
  const src = await gatherRoadshow(root, id);
  const { input, codes } = await codedRoadshowInput(root, src);
  const { provider, output } = await run(input);
  const { spec, warnings } = checkDeck(decodeDeck(output, codes), { visuals: visualsOf(src), data: dataText(input, src), hasTeam: rosterOf(src.idea).length > 0 });
  return renderAndSave(root, id, spec, { provider, at: clock(), warnings, basis: recordBasis(src) }, clock);
}

/** Draw the files again from the deck already written (new photos, or the record's diagram and dates), with no AI. */
export async function redrawDeck(root: string, id: string, clock: Clock): Promise<{ state: RoadshowState; deck: RoadshowDeck }> {
  const state = await readRoadshow(root, id);
  if (!state.deck) throw new DeckError('Build the deck first');
  return renderAndSave(root, id, state.deck.spec, state.deck, clock);
}

export const WEBP_NOTE = 'it shows in deck.html, and deck.pptx shows the initials (use a PNG or JPG to have it there too)';

async function renderAndSave(
  root: string, id: string, spec: DeckSpec, from: Pick<RoadshowDeck, 'at' | 'warnings' | 'basis'> & { provider?: string }, clock: Clock,
): Promise<{ state: RoadshowState; deck: RoadshowDeck }> {
  // Read again: the photos or the to-do list may have changed while the AI wrote.
  const src = await gatherRoadshow(root, id);
  const { theme, template } = await readTemplateTheme(src.settings.deckTemplate);
  const model = await deckModel(src, spec, { today: clock(), theme, template });
  const files = await writeDeckFiles(src.folder, model);
  // What this drawing could not do is said with the checks (and replaced at the next drawing).
  const webp = model.team.filter((p) => p.photo?.kind === 'webp').map((p) => `${p.name}'s photo is WebP: ${WEBP_NOTE}`);
  const deck: RoadshowDeck = {
    spec, at: from.at, ...(from.provider ? { provider: from.provider } : {}), basis: from.basis, photos: photosBasis(src.state),
    renderedAt: clock(), files, warnings: [...from.warnings.filter((w) => !w.endsWith(WEBP_NOTE)), ...webp], template,
  };
  const state = { ...src.state, deck };
  await writeRoadshow(root, id, state);
  await appendHistory(src.folder, { at: clock(), action: 'roadshow-deck', by: 'app', detail: `${spec.slides.length} slides drawn: ${files.join(', ')}`, source: 'roadshow/' });
  return { state, deck };
}

/** Whether the deck is out of date: the record its words came from, or the photos its files were drawn with, changed. */
export function deckStale(src: RoadshowSource): { record: boolean; photos: boolean } {
  const d = src.state.deck;
  if (!d) return { record: false, photos: false };
  return { record: d.basis !== recordBasis(src), photos: d.photos !== photosBasis(src.state) };
}
