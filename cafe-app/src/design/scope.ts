/**
 * The feature list follows the design: when a design answer leaves a feature out, moves it to another tool outside the
 * build, or changes what it does, the AI says so in its reply and the app applies it at once (design answers save
 * themselves). The AI proposes; the code checks each change against the list here.
 */
import path from 'node:path';
import type { Clock } from '../clock';
import type { Idea } from '../ideas/idea';
import { ideaDir, loadIdea, saveIdea } from '../ideas/store';
import { appendHistory, writeFileAtomic } from '../workspace/files';
import { canonicalTool } from '../graph/ontology';
import type { FeatureChange } from '../ai/tasks';
import { readDesign, writeDesign, writeDesignMd, type DesignFeature, type DesignState } from './store';

import { APPROACH_FILE, neededFeatures, renderApproachMd, toolsMap } from './tools';

const one = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * The feature list with the AI's changes applied, and one history line per change made. Only names on the list count
 * (case and spacing aside); an "outside-tool" change needs the other tool, and naming the main tool is no move; a
 * change that changes nothing is skipped. `step` is the latest answered question (what the change rests on).
 */
export function planFeatureChanges(
  state: Pick<DesignState, 'features' | 'tool'>, changes: FeatureChange[] | undefined, at: string, step?: number,
): { features: DesignFeature[]; log: string[]; tool?: DesignState['tool'] } {
  const features = state.features.map((f) => ({ ...f }));
  const log: string[] = [];
  // The tool's fit follows: a feature out of scope or done with another tool has no fit with the main tool any more
  // (its scope says what happens to it); a feature that does something else now has a fit that may not hold.
  let fit = state.tool?.fit ? state.tool.fit.map((x) => ({ ...x })) : undefined;
  const fitKey = (name: string) => one(name, 60).toLowerCase();
  const dropFit = (name: string) => { if (fit) fit = fit.filter((x) => fitKey(x.feature) !== fitKey(name)); };
  const staleFit = (name: string) => { if (fit) fit = fit.map((x) => (fitKey(x.feature) === fitKey(name) ? { ...x, stale: true } : x)); };
  const main = state.tool?.tool;
  for (const c of changes ?? []) {
    const key = one(c.name, 60).toLowerCase();
    const f = features.find((x) => one(x.name, 60).toLowerCase() === key);
    if (!f) continue;
    const why = one(c.why, 200);
    const base = { at, ...(why ? { why } : {}), ...(step ? { step } : {}) };
    if (c.change === 'drop') {
      if (f.scope?.status === 'out') continue;
      f.scope = { status: 'out', ...base };
      dropFit(f.name);
      log.push(`${f.name}: out of scope${why ? ` (${why})` : ''}`);
    } else if (c.change === 'outside-tool') {
      const by = one(c.by, 60);
      if (!by || (main && canonicalTool(by) === main) || by.toLowerCase() === main?.toLowerCase()) continue;
      if (f.scope?.status === 'outside' && f.scope.by === by) continue;
      f.scope = { status: 'outside', by, ...base };
      dropFit(f.name);
      log.push(`${f.name}: done with ${by}, outside the ${main ?? 'main'} build`);
    } else if (c.change === 'reword') {
      const what = one(c.what, 160);
      if (!what || what === f.what) continue;
      f.what = what;
      if (fit?.some((x) => fitKey(x.feature) === fitKey(f.name))) staleFit(f.name);
      log.push(`${f.name}: now "${what}"`);
    }
  }
  return { features, log, ...(state.tool && fit ? { tool: { ...state.tool, fit } } : {}) };
}

/**
 * Applies the design reply's feature changes: design.yaml, approach.md, the idea's features and tools (an out-of-scope
 * feature is no longer NEEDed; an outside one is not BUILT_WITH the main tool), design.md, and a history line each.
 * Returns the lines logged (none when nothing changed). Never touches the stage or the tool.
 */
export async function applyFeatureChanges(root: string, id: string, changes: FeatureChange[] | undefined, clock: Clock): Promise<string[]> {
  if (!changes?.length) return [];
  const state = await readDesign(root, id);
  const last = [...state.steps].reverse().find((s) => s.answer?.trim())?.n;
  const at = clock();
  const { features, log, tool } = planFeatureChanges(state, changes, at, last);
  if (!log.length) return [];
  const next: DesignState = { ...state, features, ...(tool ? { tool } : {}) };
  const idea = await loadIdea(root, id);
  const withTools: Idea = { ...idea, tools: toolsMap(next), features: neededFeatures(next) };

  await writeDesign(root, id, next);
  const dir = await ideaDir(root, id);
  await writeFileAtomic(path.join(dir, APPROACH_FILE), renderApproachMd(idea, next));
  await saveIdea(root, withTools);
  await writeDesignMd(root, withTools, next);
  for (const detail of log) await appendHistory(dir, { at, action: 'design-feature', by: 'app', source: 'design.md', detail });
  return log;
}
