import path from 'node:path';
import type { Clock } from '../clock';
import type { Idea } from '../ideas/idea';
import { ideaDir, loadIdea, saveIdea } from '../ideas/store';
import { tick } from '../checklist/checklist';
import type { StepDef } from '../rules/stages';
import { writeFileAtomic } from '../workspace/files';
import { canonicalTool, slug } from '../graph/ontology';
import { FEATURE_FLAGS, type FeatureFlag, type ToolPickInput } from '../ai/tasks';
import { readDesign, writeDesign, writeDesignMd, type DesignFeature, type DesignState, type Pathway } from './store';
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

export const builderOf = (idea: Idea): string | undefined =>
  (idea.people as Idea['people'] & { builder?: string }).builder?.trim() || undefined;

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

export interface PickInput { id?: string; name: string; what?: string; tool?: string; reason?: string; flags?: string[] }

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

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
    out.push({
      id, name, ...(what ? { what } : {}), ...(tool ? { tool, pathway: pathwayOf(tool, builder) } : {}),
      ...(reason ? { reason } : {}), flags: [...new Set(flags)],
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
    out.push('');
  }
  return out.join('\n');
}

/** The tool picker's input for the AI: the idea, its support and the features already there. */
export function toolPickInput(idea: Idea, state: DesignState): ToolPickInput {
  return {
    idea: { id: idea.id, title: idea.title, challenge: idea.challenge, current_process: idea.current_process, outcomes: idea.outcomes },
    support: idea.support,
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
  const status = prev.status === 'approved' ? 'approved'
    : picked ? 'designing'
    : prev.status === 'designing' ? 'designing' : 'picking';
  const state: DesignState = { ...prev, status, features };
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
