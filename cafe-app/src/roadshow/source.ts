/**
 * Everything the roadshow reads: the idea, its design and plan, its history and round. Gathered once, then turned into
 * the AI's input (names coded the way the decision codes them), the deck's dates and the fingerprint that says when a
 * deck is out of date.
 */
import path from 'node:path';
import type { Idea } from '../ideas/idea';
import { ideaDir, loadIdea } from '../ideas/store';
import { readHistory, readText, type HistoryEntry } from '../workspace/files';
import { readDesign, type DesignState } from '../design/store';
import { DESIGN_TAGS, pointOf, POINT_LABELS } from '../design/points';
import { plainDiagram, type DiagramSpec } from '../design/diagram';
import { scopeWords } from '../design/choice';
import { PLAN_FILE } from '../design/kits';
import { DECISION_LABELS } from '../review/review';
import { reviewInput } from '../review/suggestInput';
import { listRounds, loadSettings } from '../round/store';
import type { Round, Settings } from '../round/round';
import type { Coded } from '../command/names';
import type { DeckVisual, RoadshowInput } from '../ai/tasks';
import { fingerprint, readRoadshow, rosterOf, ROLE_WORDS, type RoadshowState } from './store';

export type Answer = { question: string; answer: string; source?: string };

export interface RoadshowSource {
  idea: Idea & { answers?: Answer[] };
  design: DesignState;
  planMd?: string;
  history: HistoryEntry[];
  round?: Round;
  settings: Settings;
  state: RoadshowState;
  folder: string;
}

export async function gatherRoadshow(root: string, id: string): Promise<RoadshowSource> {
  const idea = await loadIdea(root, id) as RoadshowSource['idea'];
  const folder = await ideaDir(root, id);
  const [design, planMd, history, rounds, settings, state] = await Promise.all([
    readDesign(root, id), readText(path.join(folder, PLAN_FILE)), readHistory(folder), listRounds(root).catch(() => [] as Round[]),
    loadSettings(root), readRoadshow(root, id),
  ]);
  return { idea, design, planMd, history, round: rounds.find((r) => r.id === idea.round), settings, state, folder };
}

/** The build plan from plan.md: each task (ticked or not) and the risks. */
export function planOf(planMd: string | undefined): { tasks: { title: string; done: boolean }[]; risks: string[] } | undefined {
  if (!planMd) return undefined;
  const tasks: { title: string; done: boolean }[] = [];
  const risks: string[] = [];
  let section = '';
  for (const line of planMd.split('\n')) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) { section = h[1].trim().toLowerCase(); continue; }
    const t = /^- \[( |x|X)\] (.*)$/.exec(line);
    if (t) { tasks.push({ title: t[2].replace(/\*\*/g, '').replace(/\\(.)/g, '$1').trim(), done: t[1] !== ' ' }); continue; }
    if (section === 'risks') { const r = /^- (.*)$/.exec(line); if (r && !/^\(none/.test(r[1])) risks.push(r[1].replace(/\\(.)/g, '$1').trim()); }
  }
  return tasks.length || risks.length ? { tasks, risks } : undefined;
}

const firstAt = (h: HistoryEntry[], test: (e: HistoryEntry) => boolean) => h.find(test)?.at;
const lastAt = (h: HistoryEntry[], test: (e: HistoryEntry) => boolean) => [...h].reverse().find(test)?.at;
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}/.test(s);

/** The idea's dates so far, oldest first: submitted, decided, the design series, the tool, the approval, Launch and Learn, the roadshow. */
export function datesOf(src: Pick<RoadshowSource, 'idea' | 'design' | 'history' | 'round'>): { what: string; date: string }[] {
  const { idea, design, history: h, round } = src;
  const out: { what: string; date: string }[] = [];
  const add = (what: string, date?: string) => { if (isDate(date) && !out.some((x) => x.what === what)) out.push({ what, date: date!.slice(0, 10) }); };
  add('Submitted', firstAt(h, (e) => e.action === 'created') ?? idea.checklist.s1d?.at);
  if (idea.review) add(idea.review.decision === 'select' ? 'Selected' : 'Decided', idea.review.at);
  add('Design series', firstAt(h, (e) => e.action === 'stage' && /→ Design series/.test(e.detail ?? '')));
  add('Tool picked', idea.checklist.s3e?.at);
  add('Design approved', design.approvedAt);
  add('Launch and Learn', lastAt(h, (e) => e.action === 'stage' && /→ Launch and Learn$/.test(e.detail ?? '')));
  add('Roadshow', round?.roadshow);
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** The design's diagram: the AI's when it drew one, else the plain one the app draws from the design. */
export function diagramOfDesign(design: DesignState): DiagramSpec | undefined {
  if (design.diagram?.spec) return design.diagram.spec;
  if (!design.features.length && !design.summary) return undefined;
  return plainDiagram(design);
}

/** The visuals the app can draw for this idea. */
export function visualsOf(src: Pick<RoadshowSource, 'idea' | 'design' | 'history' | 'round'>): DeckVisual[] {
  const v: DeckVisual[] = ['before-after'];
  if (rosterOf(src.idea).length) v.push('team');
  if (diagramOfDesign(src.design)) v.push('diagram');
  if (src.design.tool && (src.design.tool.fit.length || src.design.features.length)) v.push('fit-table');
  if (datesOf(src).length >= 2) v.push('timeline');
  return v;
}

/**
 * What the deck's words are written from, as a fingerprint: the form, the people, the decision, the answers, the brief,
 * the design, the plan and the dates. When it changes after a build, the deck is out of date.
 */
export function recordBasis(src: RoadshowSource): string {
  const { idea, design } = src;
  return fingerprint([
    idea.title, idea.challenge, idea.current_process, idea.outcomes, idea.beneficiaries, idea.use_case_category, idea.support,
    idea.function, idea.region, idea.people, idea.review ?? null, idea.learned?.points ?? [], (idea.answers ?? []).map((a) => [a.question, a.answer]),
    design.features, design.tool ?? null, design.summary ?? '', design.steps.map((s) => [s.question, s.answer ?? '']), design.settled ?? {},
    design.diagram?.spec ?? null, design.approvedAt ?? '', src.planMd ?? '', datesOf(src), src.round?.name ?? '', src.round?.roadshow ?? '',
  ]);
}

/** Where a feature stands, in words, for the AI. */
const featureStatus = (f: DesignState['features'][number], tool?: string) => (f.scope ? scopeWords(f.scope, tool) : 'built');

/**
 * The AI's input: everything the idea holds, with people coded the way the decision codes them. Every free text that
 * could name someone (the team, the reason, the brief, the design, the tool, the plan) rides in through reviewInput as
 * an extra answer, so it gets the same codes, then comes back out in order. The codes come back so the reply can be
 * decoded; `read` is how many answers were read (for the brief).
 */
export async function codedRoadshowInput(
  root: string, src: RoadshowSource, extra: { todo?: { need: string; ask: string }[] } = {},
): Promise<{ input: RoadshowInput; codes: Map<string, Coded>; read: number }> {
  const { idea, design } = src;
  const roster = rosterOf(idea);
  const t = design.tool;
  const plan = planOf(src.planMd);
  const points = DESIGN_TAGS.map((tag) => [tag, pointOf(design, tag) ?? ''] as const).filter(([, v]) => v);
  const steps = design.steps.filter((s) => s.answer?.trim());
  const diagram = diagramOfDesign(design);
  // The texts to code, in a fixed order; each block's length is known, so they come back out the same way.
  const blocks: string[][] = [
    roster.map((p) => p.name),
    [idea.review?.reason ?? ''],
    (idea.learned?.points ?? []).map((p) => p.text),
    [design.summary ?? ''],
    steps.flatMap((s) => [s.question, s.answer ?? '']),
    points.map(([, v]) => v),
    design.features.map((f) => f.what ?? ''),
    t ? [t.reason, ...t.pros, ...t.cons, ...t.fit.map((x) => x.note)] : [],
    plan ? [...plan.tasks.map((x) => x.title), ...plan.risks] : [],
    diagram ? diagram.nodes.map((n) => n.label) : [],
    // The last to-do list: its questions may name someone.
    (extra.todo ?? []).flatMap((t) => [t.need, t.ask]),
  ];
  const flat = blocks.flat();
  const { input: seen, codes } = await reviewInput(root, idea.id, flat.map((answer) => ({ question: 'T', answer })));
  const all = seen.answers ?? [];
  const nAnswers = all.length - flat.length;
  const recorded = (idea.answers ?? []).slice(-20);
  const answers = all.slice(0, nAnswers).map((a, i) => ({ ...a, ...(recorded[i]?.source ? { source: recorded[i].source } : {}) }));
  const tail = all.slice(nAnswers).map((a) => a.answer);
  let at = 0;
  const take = (n: number) => { const out = tail.slice(at, at + n); at += n; return out; };
  const [names, [reason], learned, [summary], stepTexts, pointTexts, whats, toolTexts, planTexts, partTexts, todoTexts] = blocks.map((b) => take(b.length));
  const team = roster.map((p, i) => ({ code: names[i] ?? '', roles: p.roles.map((r) => ROLE_WORDS[r]) }));
  let k = 0;
  const toolOut = t ? {
    tool: t.tool, pathway: t.pathway, reason: toolTexts[k++],
    pros: t.pros.map(() => toolTexts[k++]), cons: t.cons.map(() => toolTexts[k++]),
    fit: t.fit.map((x) => ({ feature: x.feature, fit: x.fit, note: toolTexts[k++] })),
  } : undefined;
  const input: RoadshowInput = {
    // The form's business impact is left out: the Café shows that an idea works, never what it is worth.
    idea: { ...seen.idea, business_impact: undefined, use_case_category: idea.use_case_category, support: idea.support },
    form: { function: idea.function, region: idea.region, participation: idea.participation, maturity: idea.maturity, experimented: idea.experimented },
    team,
    ...(idea.review ? { decision: { decision: idea.review.decision, label: DECISION_LABELS[idea.review.decision] ?? idea.review.decision, reason, at: idea.review.at } } : {}),
    ...(learned.length ? { learned: (idea.learned?.points ?? []).map((p, i) => ({ topic: p.topic, text: learned[i] })) } : {}),
    ...(answers.length ? { answers } : {}),
    ...(design.features.length ? { features: design.features.map((f, i) => ({ name: f.name, ...(whats[i] ? { what: whats[i] } : {}), status: featureStatus(f, t?.tool) })) } : {}),
    ...(toolOut ? { tool: toolOut } : {}),
    ...(design.summary || steps.length ? {
      design: {
        ...(summary ? { summary } : {}), ...(design.approvedAt ? { approved: design.approvedAt } : {}),
        points: Object.fromEntries(points.map(([tag], i) => [POINT_LABELS[tag], pointTexts[i]])),
        steps: steps.map((_, i) => ({ question: stepTexts[2 * i], answer: stepTexts[2 * i + 1] })),
        ...(diagram ? { parts: diagram.nodes.map((n, i) => `${n.kind}: ${partTexts[i]}`) } : {}),
      },
    } : {}),
    ...(plan ? { plan: { tasks: plan.tasks.map((x, i) => ({ title: planTexts[i], done: x.done })), risks: planTexts.slice(plan.tasks.length) } } : {}),
    dates: datesOf(src),
    ...(src.round ? { roadshow: { name: src.round.name, ...(src.round.roadshow ? { date: src.round.roadshow } : {}) } } : {}),
    visuals: visualsOf(src),
    ...(extra.todo?.length ? { todo: extra.todo.map((_, i) => ({ need: todoTexts[2 * i], ask: todoTexts[2 * i + 1] })) } : {}),
  };
  return { input, codes, read: answers.length };
}
