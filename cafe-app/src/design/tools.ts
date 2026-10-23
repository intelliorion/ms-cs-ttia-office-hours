import path from 'node:path';
import type { Clock } from '../clock';
import type { Idea } from '../ideas/idea';
import type { EmailRecord } from '../comms/outbox';
import { draftQuestionsEmail } from '../review/prep';
import { isOpenNeed, mergeNeeds, withAnswer, type EmailAnswer } from '../review/needs';
import { reviewInput } from '../review/suggestInput';
import { takeInAnswers } from '../review/updates';
import { showNames } from '../command/names';
import { ideaDir, loadIdea, saveIdea } from '../ideas/store';
import { tick } from '../checklist/checklist';
import type { StepDef } from '../rules/stages';
import { writeFileAtomic } from '../workspace/files';
import { canonicalTool, slug } from '../graph/ontology';
import {
  FEATURE_FLAGS, FEATURE_ONLY_FLAGS, FEATURES_MAX, type FeatureFlag, type FeatureListInput, type FeatureListOutput,
  type FeatureSuggestion, type ToolPickInput, type ToolPickOutput,
} from '../ai/tasks';
import { readDesign, writeDesign, writeDesignMd, mdLine, type DesignFeature, type DesignState, skillGuidance } from './store';
import { cafeCheck } from './cafecheck';
import { FIT_LEVELS, legacyChoice, outOfDate, pathwayOf, toolFeatures, type FitLevel, type ToolChoice, type ToolFit } from './choice';

/** Where each approved tool lands on the pathway ladder (Café skill, Part 3). */
export const PATHWAYS: Record<string, string> = {
  'Microsoft Copilot': 'Citizen-Led (no build)',
  'Copilot Studio': 'Citizen-Led',
  'Power Apps': 'Citizen-Led',
  'Dataiku': 'Citizen-Led',
  'UiPath': 'Citizen-Led',
  'custom app': 'TTIA-Led (CSIC Repository)',
};
export const ASSISTED_NOTE = 'Assisted Citizen until a builder is named';
export const APPROACH_FILE = 'approach.md';
export const TOOL_STEP = 's3e';
/** Said on a tool the operator chose with no AI to evaluate it. */
export const NEEDS_AI_NOTE = 'Pros, cons and fit need the AI: connect one and Re-evaluate.';

import { builderOf } from '../ideas/people';
export { builderOf, pathwayOf, outOfDate, toolFeatures };

/** The pathway as written in approach.md, with the Assisted Citizen note when no builder is named. */
export function pathwayLabel(tool: string, builder?: string): string {
  const base = PATHWAYS[tool] ?? '';
  return pathwayOf(tool, builder) === 'Assisted Citizen' ? `${base} (${ASSISTED_NOTE})` : base;
}

export interface FeatureInput { id?: string; name: string; what?: string; flags?: string[] }

/** One line of plain text: every whitespace run (newlines too) becomes one space, so AI text can never start a heading or field. */
const str = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const lines = (v: unknown, max: number, len: number) => (Array.isArray(v) ? v : []).map((c) => str(c, len)).filter(Boolean).slice(0, max);
const nameKey = (n: string) => str(n, 60).toLowerCase();

/** Checks the operator's feature list: a name each (no two alike), at most 12, feature flags only. No tool here. */
export function validateFeatures(raw: unknown): DesignFeature[] {
  if (!Array.isArray(raw)) throw new Error('Send the features as a list');
  if (raw.length > FEATURES_MAX) throw new Error(`At most ${FEATURES_MAX} features`);
  const out: DesignFeature[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const r of raw as FeatureInput[]) {
    const name = str(r?.name, 60);
    if (!name) throw new Error('Every feature needs a name');
    const key = name.toLowerCase();
    if (names.has(key)) throw new Error(`Two features are called ${name}`);
    names.add(key);
    const flags = (Array.isArray(r.flags) ? r.flags : []).map(String).filter((f) => (FEATURE_ONLY_FLAGS as readonly string[]).includes(f));
    let id = /^[a-z0-9-]{1,60}$/.test(String(r.id ?? '')) ? String(r.id) : slug(name).slice(0, 60) || 'feature';
    while (ids.has(id)) id = `${id}-2`;
    ids.add(id);
    const what = str(r.what, 160);
    out.push({ id, name, ...(what ? { what } : {}), flags: [...new Set(flags)] });
  }
  return out;
}

/** The tool as given: an approved label, canonical, or "Not on the approved list: <x>". */
export function approvedTool(given: unknown): string {
  const t = str(given, 60);
  const tool = t ? canonicalTool(t) : undefined;
  if (!tool) throw new Error(t ? `Not on the approved list: ${t}` : 'Pick a tool first');
  return tool;
}

/** Fit lines for the features in the list only (named as the list names them), one each, in the list's order. */
function fitFor(raw: unknown, features: { name: string }[]): ToolFit[] {
  const given = new Map<string, ToolFit>();
  for (const r of Array.isArray(raw) ? raw : []) {
    const k = nameKey(r?.feature);
    const fit = String(r?.fit ?? '') as FitLevel;
    if (k && FIT_LEVELS.includes(fit) && !given.has(k)) given.set(k, { feature: '', fit, note: str(r?.note, 200) });
  }
  return features.flatMap((f) => { const g = given.get(nameKey(f.name)); return g ? [{ ...g, feature: f.name }] : []; });
}

/**
 * Checks a tool choice (the operator's save, or the AI's reply) against the feature list. The tool must be approved;
 * the custom-app flag follows it; the pathway is worked out here, never taken as sent.
 */
export function validateChoice(raw: unknown, features: { name: string }[], builder: string | undefined, at: string): ToolChoice {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ToolChoice>;
  const tool = approvedTool(r.tool);
  const flags = (Array.isArray(r.flags) ? r.flags : []).map(String).filter((f): f is FeatureFlag => (FEATURE_FLAGS as readonly string[]).includes(f));
  const custom = tool === 'custom app';
  const flagSet = [...new Set([...(custom ? ['custom-app'] : []), ...flags.filter((f) => f !== 'custom-app')])];
  const evaluatedFor = lines(r.evaluatedFor, FEATURES_MAX, 60);
  return {
    tool, pathway: pathwayOf(tool, builder), by: r.by === 'ai' ? 'ai' : 'operator', reason: str(r.reason, 160),
    pros: lines(r.pros, 5, 200), cons: lines(r.cons, 5, 200), context: lines(r.context, 6, 160), flags: flagSet,
    fit: fitFor(r.fit, features),
    evaluatedFor: Array.isArray(r.evaluatedFor) ? evaluatedFor : features.map((f) => f.name),
    ...(r.needsAi ? { needsAi: true } : {}),
    at: str(r.at, 40) || at, ...(r.provider ? { provider: str(r.provider, 60) } : {}),
  };
}

/** feature name → tool, for the graph (idea NEEDS capability, capability BUILT_WITH tool): every feature, the one tool. */
export const toolsMap = (state: Pick<DesignState, 'features' | 'tool'>): Record<string, string> =>
  Object.fromEntries(toolFeatures(state).filter((f) => f.tool).map((f) => [f.name, f.tool!]));

const FIT_WORD: Record<FitLevel, string> = { yes: 'Yes', partly: 'Partly', no: 'No' };
/** A table cell: one line, and a pipe cannot open a new column. */
const cell = (text: string | undefined) => mdLine(text).replace(/\|/g, '\\|');

/** approach.md: the feature list, then the one tool with its pathway, reason, pros, cons, fit per feature and why. */
export function renderApproachMd(idea: Idea, state: Pick<DesignState, 'features' | 'tool'>): string {
  const builder = builderOf(idea);
  const out = [`# Approach — ${idea.title}`, '', '## Features', ''];
  if (!state.features.length) out.push('(no features yet)');
  for (const f of state.features) out.push(`- **${mdLine(f.name).replace(/\*/g, '')}**: ${mdLine(f.what) || '(not yet said)'}${f.flags.length ? ` [${f.flags.join(', ')}]` : ''}`);
  out.push('', '## Tool', '');
  const t = state.tool;
  if (!t) { out.push('Not picked yet.', ''); return out.join('\n'); }
  out.push(`- Tool: ${t.tool}`);
  out.push(`- Pathway: ${pathwayLabel(t.tool, builder)}`);
  out.push(`- Chosen by: ${t.by === 'ai' ? 'the AI (suggested), saved by the operator' : 'the operator'}`);
  out.push(`- Reason: ${mdLine(t.reason) || '(none given)'}`);
  out.push(`- Flags: ${t.flags.length ? t.flags.join(', ') : 'none'}`);
  if (t.needsAi) out.push(`- Note: ${NEEDS_AI_NOTE}`);
  if (outOfDate(state.features, t)) out.push('- Note: the feature list changed after the tool was evaluated: Re-evaluate the tool for the new features.');
  if (t.pros.length) { out.push('- Pros:'); for (const c of t.pros) out.push(`  - ${mdLine(c)}`); }
  if (t.cons.length) { out.push('- Cons (what it cannot do):'); for (const c of t.cons) out.push(`  - ${mdLine(c)}`); }
  out.push('', '## How the tool fits each feature', '');
  if (!state.features.length) out.push('(no features yet)');
  else {
    const fits = new Map(t.fit.map((x) => [nameKey(x.feature), x]));
    out.push('| Feature | Fit | Note |', '| --- | --- | --- |');
    for (const f of state.features) {
      const x = fits.get(nameKey(f.name));
      out.push(`| ${cell(f.name)} | ${x ? FIT_WORD[x.fit] : 'Not evaluated'} | ${cell(x?.note)} |`);
    }
  }
  if (t.context.length) { out.push('', '## Why this tool', ''); for (const c of t.context) out.push(`- ${mdLine(c)}`); }
  out.push('');
  return out.join('\n');
}

/** The team's replies so far: answers the Import recorded on the idea, then answered design steps. */
export function teamAnswers(idea: Idea, state: DesignState): { question: string; answer: string }[] {
  const recorded = ((idea as Idea & { answers?: { question: string; answer: string }[] }).answers ?? [])
    .map((a) => ({ question: str(a.question, 200), answer: str(a.answer, 500) }));
  const steps = state.steps.filter((s) => s.answer?.trim()).map((s) => ({ question: str(s.question, 200), answer: str(s.answer, 500) }));
  return [...recorded, ...steps].filter((a) => a.question && a.answer);
}

/** The tool picker's input for the AI: the idea, its support, the team's replies and the feature list. */
export function toolPickInput(idea: Idea, state: DesignState, features: { name: string; what?: string }[] = state.features): ToolPickInput {
  return {
    idea: { id: idea.id, title: idea.title, challenge: idea.challenge, current_process: idea.current_process, outcomes: idea.outcomes },
    support: idea.support,
    builderNamed: Boolean(builderOf(idea)),
    ...(teamAnswers(idea, state).length ? { teamAnswers: teamAnswers(idea, state) } : {}),
    guidance: skillGuidance('cafe-design'),
    ...(features.length ? { features: features.map((f) => ({ name: f.name, ...(f.what ? { what: f.what } : {}) })) } : {}),
  };
}

/**
 * Suggestions never overwrite a row: a feature the operator already has stays as it is (first),
 * and only suggested features with a new name are added after it.
 */
export function mergeSuggestions<E extends { name: string }, S extends { name: string }>(existing: E[], suggested: S[]): (E | S)[] {
  const have = new Set(existing.map((f) => f.name.trim().toLowerCase()));
  const out: (E | S)[] = [...existing];
  for (const s of suggested) {
    const k = s.name.trim().toLowerCase();
    if (k && !have.has(k)) { have.add(k); out.push(s); }
  }
  return out;
}

/** The answered design steps, as question and answer. */
const stepAnswers = (state: DesignState) => state.steps.filter((s) => s.answer?.trim()).map((s) => ({ question: str(s.question, 200), answer: str(s.answer, 500) }));

/**
 * Suggest features with AI: the AI reads the form, the team's answers and the "Learned since the form" brief (names
 * coded) and lists what the proof of concept must do. Merged into the rows sent (or the saved list): no row the
 * operator has is dropped or changed; only new names are added. Nothing is saved until Save.
 */
export async function suggestFeatures(
  root: string, id: string, rows: unknown, run: (input: FeatureListInput) => Promise<{ provider: string; output: FeatureListOutput }>,
): Promise<{ features: (DesignFeature | FeatureSuggestion)[]; provider: string }> {
  const idea = await loadIdea(root, id);
  const state = await readDesign(root, id);
  const have = rows === undefined ? state.features : validateFeatures(rows);
  // The brief rides in as extra answers, so its names get the same codes as everything else, then comes back out.
  const brief = idea.learned?.points ?? [];
  const { input: seen, codes } = await reviewInput(root, id, brief.map((p) => ({ question: p.topic, answer: p.text })));
  const all = seen.answers ?? [];
  const answers = [...all.slice(0, all.length - brief.length), ...stepAnswers(state)];
  const learned = all.slice(all.length - brief.length).map((a) => ({ topic: a.question, text: a.answer }));
  const { provider, output } = await run({
    idea: seen.idea, support: idea.support,
    ...(answers.length ? { teamAnswers: answers } : {}), ...(learned.length ? { learned } : {}),
    ...(have.length ? { existingFeatures: have.map((f) => ({ name: f.name, ...(f.what ? { what: f.what } : {}) })) } : {}),
    guidance: skillGuidance('cafe-design'),
  });
  const name = (t: string) => showNames(t, codes);
  const suggested = output.features.map((f) => ({
    name: str(name(f.name), 60), what: str(name(f.what), 160),
    flags: f.flags.filter((x) => (FEATURE_ONLY_FLAGS as readonly string[]).includes(x)),
  })).filter((f) => f.name);
  return { features: mergeSuggestions(have, suggested).slice(0, FEATURES_MAX), provider };
}

/**
 * Suggest a tool, Re-evaluate, or evaluate the operator's own tool: the AI reads the form, the team's answers, what the
 * operator pasted against the to-do list and the feature list, and gives ONE tool for the whole list (pros, cons, fit
 * per feature) plus what it still needs (the last list's items kept and marked met or not). With `tool` set, the AI
 * evaluates that tool and may not change it (a reply naming another is refused). The to-do list, the proposed updates
 * and the brief are saved as today; the choice itself is not saved until Save.
 */
export async function suggestTools(
  root: string, id: string, run: (input: ToolPickInput) => Promise<{ provider: string; output: ToolPickOutput }>, clock: Clock,
  body: { features?: unknown; tool?: unknown } = {},
): Promise<{ state: DesignState; tool?: ToolChoice; provider: string }> {
  const idea = await loadIdea(root, id);
  const state = await readDesign(root, id);
  const features = body.features === undefined ? state.features : validateFeatures(body.features);
  const evaluate = body.tool === undefined || body.tool === '' ? undefined : approvedTool(body.tool);
  const prev = state.toolPrep?.needs ?? [];
  const pasted = prev.filter((n) => n.answer?.trim()).map((n) => ({ question: str(n.ask, 200), answer: str(n.answer, 500) }));
  // The same coded view of the idea the decision gets (names hidden), so the answers can propose a builder too.
  const { input: seen, codes } = await reviewInput(root, id, pasted);
  const base = toolPickInput(idea, state, features);
  const answers = [...(seen.answers ?? []), ...stepAnswers(state)];
  const { provider, output } = await run({
    ...base, idea: seen.idea,
    ...(answers.length ? { teamAnswers: answers } : { teamAnswers: undefined }),
    ...(evaluate ? { evaluate } : {}),
    ...(prev.length ? { todo: prev.map(({ need, ask }) => ({ need, ask })) } : {}),
    ...(seen.form?.participation ? { form: { participation: seen.form.participation } } : {}),
    ...(seen.flags ? { flags: seen.flags } : {}), ...(seen.graph ? { graph: seen.graph } : {}),
  });
  // The operator's tool is theirs: an evaluation of another tool is no evaluation of it.
  if (evaluate && output.pick && output.pick.tool !== evaluate) throw new Error(`The AI answered for ${output.pick.tool}, not ${evaluate}. Try again.`);
  const at = clock();
  const name = (t: string) => showNames(t, codes);
  state.toolPrep = { at, provider, needs: mergeNeeds(prev, output.needs, name) };
  await writeDesign(root, id, state);
  // What the answers change (proposed, each waiting for Yes) and the brief of what they add, as after the decision.
  await saveIdea(root, { ...idea, ...(await takeInAnswers(root, idea, output, codes, provider, at, answers.length, 'tools')) });
  const p = output.pick;
  const tool = p && validateChoice({
    tool: p.tool, by: evaluate ? 'operator' : 'ai', reason: name(p.reason), flags: p.flags,
    context: p.context.map(name), pros: p.pros.map(name), cons: p.cons.map(name),
    fit: p.fit.map((f) => ({ ...f, note: name(f.note) })), evaluatedFor: features.map((f) => f.name), provider,
  }, features, builderOf(idea), at);
  return { state, ...(tool ? { tool } : {}), provider };
}

/**
 * Saves the feature list and the one tool: design.yaml, approach.md, idea.tools (replaced whole, so graph links
 * are never duplicated and a changed tool replaces its BUILT_WITH links), the s3e tick and design.md. An older
 * client's body (a tool on each feature, no `tool`) is read the way older records are.
 */
export async function saveToolPicks(
  root: string, id: string, body: { features?: unknown; tool?: unknown }, opts: { clock: Clock; steps: StepDef[] },
): Promise<{ state: DesignState; approachFile: string; designFile: string }> {
  const idea = await loadIdea(root, id);
  const at = opts.clock();
  let rawFeatures = body.features ?? [];
  let rawTool = body.tool;
  if (rawTool === undefined && Array.isArray(rawFeatures) && rawFeatures.some((f) => f && typeof f === 'object' && (f as { tool?: unknown }).tool)) {
    for (const f of rawFeatures as { tool?: unknown }[]) if (f?.tool) approvedTool(f.tool);
    const legacy = legacyChoice(rawFeatures.map((f) => ({ ...(f as object), tool: (f as { tool?: unknown }).tool ? approvedTool((f as { tool?: unknown }).tool) : undefined })), at);
    rawFeatures = (rawFeatures as Record<string, unknown>[]).map((f, i) => ({ ...legacy.features[i], id: f.id, flags: f.flags }));
    rawTool = legacy.tool;
  }
  const features = validateFeatures(rawFeatures);
  const tool = rawTool ? validateChoice(rawTool, features, builderOf(idea), at) : undefined;
  const prev = await readDesign(root, id);
  // Changing the features or the tool of an approved design reopens it: the approval was for the old ones.
  const changed = JSON.stringify([prev.features, prev.tool ?? null]) !== JSON.stringify([features, tool ?? null]);
  const reopen = prev.status === 'approved' && changed;
  const status = prev.status === 'approved' && !reopen ? 'approved'
    : tool || reopen ? 'designing'
    : prev.status === 'designing' ? 'designing' : 'picking';
  const state: DesignState = { ...prev, status, features };
  if (tool) state.tool = tool; else delete state.tool;
  if (reopen) delete state.approvedAt;
  const withTools: Idea = { ...idea, tools: toolsMap(state) };
  state.cafeCheck = cafeCheck(withTools, state);
  await writeDesign(root, id, state);
  const dir = await ideaDir(root, id);
  const approachFile = path.join(dir, APPROACH_FILE);
  await writeFileAtomic(approachFile, renderApproachMd(idea, state));
  await saveIdea(root, withTools);
  if (tool) await tick(root, id, TOOL_STEP, true, { by: 'app', source: APPROACH_FILE, clock: opts.clock, steps: opts.steps });
  const designFile = await writeDesignMd(root, withTools, state);
  return { state, approachFile, designFile };
}

/** Save what the operator pasted for one of the picker's to-do items. Read at the next Re-evaluate. */
export async function answerToolNeed(root: string, id: string, needId: string, raw: unknown): Promise<DesignState> {
  const state = await readDesign(root, id);
  if (!state.toolPrep) throw new Error('No questions yet: Suggest with AI first');
  state.toolPrep = { ...state.toolPrep, needs: withAnswer(state.toolPrep.needs, needId, raw) };
  await writeDesign(root, id, state);
  return state;
}

/** The picker's open questions, as the questions email (E2). Opening it in Outlook is the caller's next step. */
export async function draftToolNeedsEmail(root: string, id: string, clock: Clock): Promise<EmailRecord> {
  const idea = await loadIdea(root, id) as Idea & { answers?: EmailAnswer[] };
  const open = ((await readDesign(root, id)).toolPrep?.needs ?? []).filter((x) => isOpenNeed(x, idea.answers));
  return draftQuestionsEmail(root, id, open.map((x) => x.ask), clock);
}

/** Once that email is opened in Outlook: the open items it asked are marked asked (and unmarked on its Undo). */
export async function markToolAsked(root: string, id: string, at: string, asked = true): Promise<void> {
  const idea = await loadIdea(root, id) as Idea & { answers?: EmailAnswer[] };
  const state = await readDesign(root, id);
  if (!state.toolPrep) return;
  const needs = state.toolPrep.needs.map((x) => {
    if (asked) return isOpenNeed(x, idea.answers) ? { ...x, askedAt: at } : x;
    const { askedAt, ...rest } = x;
    return askedAt === at ? rest : x;
  });
  state.toolPrep = { ...state.toolPrep, needs };
  await writeDesign(root, id, state);
}
