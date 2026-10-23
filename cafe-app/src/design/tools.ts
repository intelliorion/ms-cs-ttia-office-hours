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
import { FEATURE_FLAGS, type FeatureFlag, type ToolPickFeature, type ToolPickInput, type ToolPickOutput } from '../ai/tasks';
import { readDesign, writeDesign, writeDesignMd, type DesignFeature, type DesignState, type Pathway , skillGuidance } from './store';
import { cafeCheck } from './cafecheck';

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

import { builderOf } from '../ideas/people';
export { builderOf };

/** The stored pathway for a pick: custom app is TTIA-Led; a citizen tool with no builder named yet is Assisted Citizen. */
export function pathwayOf(tool: string, builder?: string): Pathway {
  if (tool === 'custom app') return 'TTIA-Led';
  if (tool === 'Microsoft Copilot') return 'Citizen-Led';
  return builder ? 'Citizen-Led' : 'Assisted Citizen';
}

/** The pathway as written in approach.md, with the Assisted Citizen note when no builder is named. */
export function pathwayLabel(tool: string, builder?: string): string {
  const base = PATHWAYS[tool] ?? '';
  return pathwayOf(tool, builder) === 'Assisted Citizen' ? `${base} (${ASSISTED_NOTE})` : base;
}

export interface PickInput { id?: string; name: string; what?: string; tool?: string; reason?: string; flags?: string[]; context?: string[]; pros?: string[]; cons?: string[] }

/** One line of plain text: every whitespace run (newlines too) becomes one space, so AI text can never start a heading or field. */
const str = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Checks the operator's picks and turns them into design features. A tool must resolve to an
 * approved label, else "Not on the approved list: <x>". A feature may have no tool yet.
 */
export function validatePicks(raw: unknown, builder?: string): DesignFeature[] {
  if (!Array.isArray(raw)) throw new Error('Send the features as a list');
  if (raw.length > 12) throw new Error('At most 12 features');
  const out: DesignFeature[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const r of raw as PickInput[]) {
    const name = str(r?.name, 60);
    if (!name) throw new Error('Every feature needs a name');
    const key = name.toLowerCase();
    if (names.has(key)) throw new Error(`Two features are called ${name}`);
    names.add(key);
    const given = str(r.tool, 60);
    const tool = given ? canonicalTool(given) : undefined;
    if (given && !tool) throw new Error(`Not on the approved list: ${given}`);
    const flags = (Array.isArray(r.flags) ? r.flags : []).map(String).filter((f): f is FeatureFlag => (FEATURE_FLAGS as readonly string[]).includes(f));
    if (tool === 'custom app' && !flags.includes('custom-app')) flags.push('custom-app');
    if (tool !== 'custom app') { const i = flags.indexOf('custom-app'); if (i >= 0) flags.splice(i, 1); }
    let id = /^[a-z0-9-]{1,60}$/.test(String(r.id ?? '')) ? String(r.id) : slug(name).slice(0, 60);
    while (ids.has(id)) id = `${id}-2`;
    ids.add(id);
    const what = str(r.what, 160);
    const reason = str(r.reason, 160);
    const lines = (v: unknown, max: number) => (Array.isArray(v) ? v : []).map((c) => str(c, 200)).filter(Boolean).slice(0, max);
    const context = lines(r.context, 6).map((c) => c.slice(0, 160));
    const pros = lines(r.pros, 5); const cons = lines(r.cons, 5);
    out.push({
      id, name, ...(what ? { what } : {}), ...(tool ? { tool, pathway: pathwayOf(tool, builder) } : {}),
      ...(reason ? { reason } : {}), ...(context.length ? { context } : {}), ...(pros.length ? { pros } : {}), ...(cons.length ? { cons } : {}),
      flags: [...new Set(flags)],
    });
  }
  return out;
}

/** feature name → tool, for the graph (idea NEEDS capability, capability BUILT_WITH tool). */
export const toolsMap = (features: DesignFeature[]): Record<string, string> =>
  Object.fromEntries(features.filter((f) => f.tool).map((f) => [f.name, f.tool!]));

export function renderApproachMd(idea: Idea, features: DesignFeature[]): string {
  const builder = builderOf(idea);
  const out = [`# Approach — ${idea.title}`, ''];
  if (!features.length) out.push('(no features yet)', '');
  for (const f of features) {
    out.push(`## ${f.name}`, '');
    out.push(`- What: ${f.what || '(not yet said)'}`);
    out.push(`- Tool: ${f.tool ?? 'not picked yet'}`);
    out.push(`- Pathway: ${f.tool ? pathwayLabel(f.tool, builder) : '(after a tool is picked)'}`);
    out.push(`- Reason: ${f.reason || '(none given)'}`);
    out.push(`- Flags: ${f.flags.length ? f.flags.join(', ') : 'none'}`);
    if (f.pros?.length) { out.push('- Pros:'); for (const c of f.pros) out.push(`  - ${c}`); }
    if (f.cons?.length) { out.push('- Cons (what it cannot do):'); for (const c of f.cons) out.push(`  - ${c}`); }
    if (f.context?.length) { out.push('- Why this tool:'); for (const c of f.context) out.push(`  - ${c}`); }
    out.push('');
  }
  return out.join('\n');
}

/** The team's replies so far: answers the Import recorded on the idea, then answered design steps. */
export function teamAnswers(idea: Idea, state: DesignState): { question: string; answer: string }[] {
  const recorded = ((idea as Idea & { answers?: { question: string; answer: string }[] }).answers ?? [])
    .map((a) => ({ question: str(a.question, 200), answer: str(a.answer, 500) }));
  const steps = state.steps.filter((s) => s.answer?.trim()).map((s) => ({ question: str(s.question, 200), answer: str(s.answer, 500) }));
  return [...recorded, ...steps].filter((a) => a.question && a.answer);
}

/** The tool picker's input for the AI: the idea, its support, the team's replies and the features already there. */
export function toolPickInput(idea: Idea, state: DesignState): ToolPickInput {
  return {
    idea: { id: idea.id, title: idea.title, challenge: idea.challenge, current_process: idea.current_process, outcomes: idea.outcomes },
    support: idea.support,
    builderNamed: Boolean(builderOf(idea)),
    ...(teamAnswers(idea, state).length ? { teamAnswers: teamAnswers(idea, state) } : {}),
    guidance: skillGuidance('brainstorming', 6000),
    ...(state.features.length ? {
      existingFeatures: state.features.map((f) => ({ name: f.name, what: f.what, tool: f.tool, reason: f.reason })),
    } : {}),
  };
}

/**
 * Suggestions never overwrite a pick: a feature the operator already has stays as it is (first),
 * and only suggested features with a new name are added after it.
 */
export function mergeSuggestions<S extends { name: string }>(existing: DesignFeature[], suggested: S[]): (DesignFeature | S)[] {
  const have = new Set(existing.map((f) => f.name.trim().toLowerCase()));
  return [...existing, ...suggested.filter((s) => !have.has(s.name.trim().toLowerCase()))];
}

/**
 * Saves the operator's picks: design.yaml, approach.md, idea.tools (replaced whole, so graph links
 * are never duplicated and a changed pick replaces its BUILT_WITH link), the s3e tick and design.md.
 */
export async function saveToolPicks(
  root: string, id: string, rawFeatures: unknown, opts: { clock: Clock; steps: StepDef[] },
): Promise<{ state: DesignState; approachFile: string; designFile: string }> {
  const idea = await loadIdea(root, id);
  const features = validatePicks(rawFeatures, builderOf(idea));
  const prev = await readDesign(root, id);
  const picked = features.some((f) => f.tool);
  // Changing the features of an approved design reopens it: the approval was for the old features.
  const changed = JSON.stringify(prev.features) !== JSON.stringify(features);
  const reopen = prev.status === 'approved' && changed;
  const status = prev.status === 'approved' && !reopen ? 'approved'
    : picked || reopen ? 'designing'
    : prev.status === 'designing' ? 'designing' : 'picking';
  const state: DesignState = { ...prev, status, features };
  if (reopen) delete state.approvedAt;
  const tools = toolsMap(features);
  const withTools: Idea = { ...idea, tools };
  state.cafeCheck = cafeCheck(withTools, state);
  await writeDesign(root, id, state);
  const dir = await ideaDir(root, id);
  const approachFile = path.join(dir, APPROACH_FILE);
  await writeFileAtomic(approachFile, renderApproachMd(idea, features));
  await saveIdea(root, withTools);
  if (picked) await tick(root, id, TOOL_STEP, true, { by: 'app', source: APPROACH_FILE, clock: opts.clock, steps: opts.steps });
  const designFile = await writeDesignMd(root, withTools, state);
  return { state, approachFile, designFile };
}

/**
 * The picker could not pick: every question it needs goes into the idea's E2 draft at once (drafted or reused),
 * and design.yaml remembers them, so the panel can say the team was asked and the Suggest button can wait.
 */
/**
 * Suggest with AI, or Re-evaluate: the AI reads the form, the team's answers, what the operator pasted against the
 * to-do list and the features there, and gives the one pick it can stand behind plus what it still needs (the last
 * list's items kept and marked met or not). Saved on the design; nothing is picked until Save.
 */
export async function suggestTools(
  root: string, id: string, run: (input: ToolPickInput) => Promise<{ provider: string; output: ToolPickOutput }>, clock: Clock,
): Promise<{ state: DesignState; features: (DesignFeature | ToolPickFeature)[]; provider: string }> {
  const idea = await loadIdea(root, id);
  const state = await readDesign(root, id);
  const prev = state.toolPrep?.needs ?? [];
  const pasted = prev.filter((n) => n.answer?.trim()).map((n) => ({ question: str(n.ask, 200), answer: str(n.answer, 500) }));
  // The same coded view of the idea the decision gets (names hidden), so the answers can propose a builder too.
  const { input: seen, codes } = await reviewInput(root, id, pasted);
  const base = toolPickInput(idea, state);
  const steps = state.steps.filter((s) => s.answer?.trim()).map((s) => ({ question: str(s.question, 200), answer: str(s.answer, 500) }));
  const answers = [...(seen.answers ?? []), ...steps];
  const { provider, output } = await run({
    ...base, idea: seen.idea,
    ...(answers.length ? { teamAnswers: answers } : { teamAnswers: undefined }),
    ...(prev.length ? { todo: prev.map(({ need, ask }) => ({ need, ask })) } : {}),
    ...(seen.form?.participation ? { form: { participation: seen.form.participation } } : {}),
    ...(seen.flags ? { flags: seen.flags } : {}), ...(seen.graph ? { graph: seen.graph } : {}),
  });
  const at = clock();
  const name = (t: string) => showNames(t, codes);
  state.toolPrep = { at, provider, needs: mergeNeeds(prev, output.needs, name) };
  await writeDesign(root, id, state);
  // What the answers change (proposed, each waiting for Yes) and the brief of what they add, as after the decision.
  await saveIdea(root, { ...idea, ...(await takeInAnswers(root, idea, output, codes, provider, at, answers.length)) });
  const pick = output.pick && {
    ...output.pick, name: name(output.pick.name), what: name(output.pick.what), reason: name(output.pick.reason),
    context: output.pick.context.map(name), pros: output.pick.pros.map(name), cons: output.pick.cons.map(name),
  };
  return { state, features: mergeSuggestions(state.features, pick ? [pick] : []), provider };
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
