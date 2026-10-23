/**
 * The kit AI's input and the way back: everything the approved design holds, with people coded the way the design
 * questions code them (reviewInput), and the reply decoded. Sample data never gets a name back: a person code in it
 * becomes "Person 1", "Person 2" and an email address is dropped.
 */
import type { Idea } from '../ideas/idea';
import type { DesignKitInput, DesignKitOutput, DesignPlanInput, DesignPlanOutput } from '../ai/tasks';
import { reviewInput } from '../review/suggestInput';
import { showNames, type Coded } from '../command/names';
import { DESIGN_TAGS, pointOf } from './points';
import { scopeWords } from './choice';
import { DESIGN_SOURCE } from './brainstorm';
import type { DesignState } from './store';
import { designPlanInput } from './kits';

/** The tools the design uses for its gaps (features done outside the build), in the order the features name them. */
export const outsideToolsOf = (state: Pick<DesignState, 'features'>): string[] =>
  [...new Set(state.features.filter((f) => f.scope?.status === 'outside' && f.scope.by).map((f) => f.scope!.by!.trim()))];

/** Every string in a value, mapped (a copy; keys and other values as they are). */
export function mapStrings<T>(v: T, fn: (s: string) => string): T {
  if (typeof v === 'string') return fn(v) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, fn)) as unknown as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, fn)])) as T;
  return v;
}

/**
 * The input, coded: every free text that could name someone rides in through reviewInput as an extra answer, in a
 * fixed order, so it gets the same codes as the idea, and comes back out the same way.
 */
export async function codedKitInput(root: string, idea: Idea, state: DesignState, plan: DesignPlanOutput): Promise<{ input: DesignKitInput; codes: Map<string, Coded> }> {
  const t = state.tool;
  const points = DESIGN_TAGS.map((tag) => [tag, pointOf(state, tag) ?? ''] as const).filter(([, v]) => v);
  const steps = state.steps.filter((s) => s.answer?.trim());
  const brief = idea.learned?.points ?? [];
  const fits = new Map((t?.fit ?? []).map((x) => [x.feature.toLowerCase(), x]));
  const blocks: string[][] = [
    [state.summary ?? ''],
    points.map(([, v]) => v),
    steps.flatMap((s) => [s.question, s.answer ?? '']),
    brief.map((p) => p.text),
    state.features.flatMap((f) => [f.what ?? '', f.scope?.why ?? '', fits.get(f.name.toLowerCase())?.note ?? '']),
    t ? [t.reason, ...t.pros, ...t.cons] : [],
    plan.tasks.flatMap((x) => [x.title, x.detail, x.done_when]),
    plan.risks,
  ];
  const flat = blocks.flat();
  const { input: seen, codes } = await reviewInput(root, idea.id, flat.map((answer) => ({ question: 'T', answer })), { skipSource: DESIGN_SOURCE });
  const all = (seen.answers ?? []).map((a) => a.answer);
  const tail = all.slice(all.length - flat.length);
  let at = 0;
  const take = (n: number) => { const out = tail.slice(at, at + n); at += n; return out; };
  const [[summary], pointTexts, stepTexts, briefTexts, featureTexts, toolTexts, taskTexts, riskTexts] = blocks.map((b) => take(b.length));
  let k = 0;
  const input: DesignKitInput = {
    idea: { id: idea.id, title: idea.title, challenge: seen.idea.challenge, current_process: seen.idea.current_process, outcomes: idea.outcomes },
    tool: t ? { tool: t.tool, pathway: t.pathway, reason: toolTexts[k++], pros: t.pros.map(() => toolTexts[k++]), cons: t.cons.map(() => toolTexts[k++]) }
      : { tool: '', pros: [], cons: [] },
    summary: summary ?? '',
    features: state.features.map((f, i) => {
      const [what, why, note] = featureTexts.slice(3 * i, 3 * i + 3);
      const fit = fits.get(f.name.toLowerCase());
      return {
        name: f.name, ...(what ? { what } : {}), status: f.scope ? scopeWords(f.scope, t?.tool) : 'built',
        ...(!f.scope && fit ? { fit: fit.fit, ...(note ? { note } : {}) } : {}), ...(why ? { why } : {}),
      };
    }),
    points: Object.fromEntries(points.map(([tag], i) => [tag, pointTexts[i]])),
    steps: steps.map((_, i) => ({ question: stepTexts[2 * i], answer: stepTexts[2 * i + 1] })),
    ...(brief.length ? { learned: brief.map((p, i) => ({ topic: p.topic, text: briefTexts[i] })) } : {}),
    plan: {
      tasks: plan.tasks.map((x, i) => ({ title: taskTexts[3 * i], detail: taskTexts[3 * i + 1], tool: x.tool, done_when: taskTexts[3 * i + 2] })),
      risks: riskTexts,
    },
    outsideTools: outsideToolsOf(state),
  };
  return { input, codes };
}

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const LEFTOVER_CODE = /\[[A-Z]\d{1,3}\]/g;

/**
 * The plan AI's input (designPlanInput), coded the same way: the idea's text, the summary, each feature's line and each
 * answered question and its answer ride in through reviewInput, so no name reaches the prompt. The codes come back so
 * the reply can be decoded (decodePlan).
 */
export async function codedPlanInput(root: string, idea: Idea, state: DesignState): Promise<{ input: DesignPlanInput; codes: Map<string, Coded> }> {
  const base = designPlanInput(idea, state);
  const blocks: string[][] = [
    [base.summary],
    base.features.map((f) => f.what ?? ''),
    base.steps.flatMap((s) => [s.question, s.answer]),
  ];
  const flat = blocks.flat();
  const { input: seen, codes } = await reviewInput(root, idea.id, flat.map((answer) => ({ question: 'T', answer })), { skipSource: DESIGN_SOURCE });
  const all = (seen.answers ?? []).map((a) => a.answer);
  const tail = all.slice(all.length - flat.length);
  const summary = tail[0] ?? '';
  const whats = tail.slice(1, 1 + base.features.length);
  const steps = tail.slice(1 + base.features.length);
  const input: DesignPlanInput = {
    ...base,
    idea: { ...base.idea, challenge: seen.idea.challenge, current_process: seen.idea.current_process },
    summary,
    features: base.features.map((f, i) => ({ ...f, ...(f.what ? { what: whats[i] } : {}) })),
    steps: base.steps.map((_, i) => ({ question: steps[2 * i], answer: steps[2 * i + 1] })),
  };
  return { input, codes };
}

/** The plan reply with any person code turned back into the name (a code left over reads "the team"). */
export function decodePlan(out: DesignPlanOutput, codes: Map<string, Coded>): DesignPlanOutput {
  const prose = (s: string) => showNames(s, codes).replace(LEFTOVER_CODE, 'the team');
  return {
    tasks: out.tasks.map((x) => ({ ...x, title: prose(x.title), detail: prose(x.detail), done_when: prose(x.done_when) })),
    risks: out.risks.map(prose),
  };
}


/** A sample cell: a person's code becomes "Person N" (never the name), any other code its label, an email address goes. */
export function sampleCell(text: string, codes: Map<string, Coded>): string {
  const people = [...codes.entries()].filter(([, c]) => c.type === 'Person').map(([code]) => code);
  let out = text;
  people.forEach((code, i) => { out = out.replace(new RegExp(`\\[${code}\\]|\\b${code}\\b`, 'g'), `Person ${i + 1}`); });
  return showNames(out, codes).replace(LEFTOVER_CODE, 'Person').replace(EMAIL, 'someone@example.com');
}

/** The reply with names put back in the prose; the sample's cells and the rules sheet's get roles, never names. */
export function decodeKit(out: DesignKitOutput, codes: Map<string, Coded>): DesignKitOutput {
  const prose = (s: string) => showNames(s, codes).replace(LEFTOVER_CODE, 'the team');
  const cell = (s: string) => sampleCell(s, codes);
  const decoded = mapStrings(out, prose);
  return {
    ...decoded,
    sample: {
      ...decoded.sample,
      rows: out.sample.rows.map((r) => r.map(cell)),
      seeded: out.sample.seeded.map((g, i) => ({ ...decoded.sample.seeded[i], row: g.row.map(cell) })),
    },
    ...(out.dataiku?.rules && decoded.dataiku ? { dataiku: { ...decoded.dataiku, rules: { columns: decoded.dataiku.rules!.columns, rows: out.dataiku.rules.rows.map((r) => r.map(cell)) } } } : {}),
  };
}
