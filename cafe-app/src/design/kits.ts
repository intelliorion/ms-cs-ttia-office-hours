import { promises as fs, type Dirent } from 'node:fs';
import path from 'node:path';
import type { Idea } from '../ideas/idea';
import { ideaDir } from '../ideas/store';
import { readText, writeFileAtomic } from '../workspace/files';
import { APPROVED_TOOLS } from '../graph/ontology';
import type { DesignKitOutput, DesignPlanInput, DesignPlanOutput } from '../ai/tasks';
import { AGENT_DATA_LINE, AGENT_FILE, CUSTOM_APP_CSIC, DATA_RULE, KIT_NO_AI, peopleByRole, renderKit, taskLines, toolSlug } from './kitFiles';

export { AGENT_DATA_LINE, AGENT_FILE, CUSTOM_APP_CSIC, DATA_RULE, KIT_NO_AI, toolSlug };
import { CSIC_NOTE, mdLine, skillGuidance, type DesignState } from './store';
import { builderOf, pathwayLabel } from './tools';
import { csicFlags, pickedTools, toolFeatures } from './choice';

/**
 * plan.md and the starter kits: written once a design is approved. The kits are filled in from the design and the
 * kit AI's content (kitFiles.ts): a synthetic sample, the tool's own files and a test checklist, plus a short kit for
 * each tool the design adds for its gaps. The app never writes application code itself.
 */

export const PLAN_FILE = 'plan.md';
export const KIT_DIR = 'kit';
export const NOT_APPROVED = 'Design is not approved yet';
/** The plan route with the AI down: plan.md has no hand path in the app. */
export const PLAN_NEEDS_AI = 'plan.md needs the AI: it could not be reached. Try again, or write plan.md by hand in the idea folder.';
export const NOT_PICKED_HEADING = '### Not picked';
export const NOT_PICKED_NOTE = 'These tasks are for a tool that was not picked; move the task to the picked tool, or change the tool.';


/** The AI's input: the idea, the approved summary, the features with the one tool and the answered questions. */
export function designPlanInput(idea: Idea, state: DesignState): DesignPlanInput {
  return {
    idea: { id: idea.id, title: idea.title, challenge: idea.challenge, current_process: idea.current_process, outcomes: idea.outcomes },
    summary: state.summary ?? '',
    // A feature the design left out of the proof of concept is not planned.
    features: toolFeatures(state).filter((f) => f.scope?.status !== 'out').map((f) => ({ name: f.name, ...(f.what ? { what: f.what } : {}), ...(f.tool ? { tool: f.tool } : {}) })),
    // Only what was settled; a step's source says nothing the plan needs.
    steps: state.steps.filter((s) => s.answer?.trim()).map((s) => ({ question: s.question, answer: s.answer!.trim() })),
    guidance: skillGuidance('writing-plans'),
  };
}

const firstSentence = (text: string): string => {
  const one = mdLine(text);
  const m = /^(.+?[.!?])(\s|$)/.exec(one);
  return m ? m[1] : one;
};

/** The answer to the must-show question, else the summary's first sentence. */
export function oneThingToShow(state: DesignState): string {
  const hit = state.steps.find((s) => s.tag === 'must-show' && s.answer?.trim());
  if (hit) return mdLine(hit.answer);
  return state.summary?.trim() ? firstSentence(state.summary) : '(not yet said)';
}

const byTool = <T extends { tool?: string }>(items: T[], tool: string) => items.filter((x) => x.tool === tool);
/** Tools in the approved order, for the ones that appear in `items`. */
const toolsIn = (items: { tool?: string }[]) => APPROVED_TOOLS.filter((t) => items.some((x) => x.tool === t));

export function renderPlanMd(idea: Idea, state: DesignState, plan: DesignPlanOutput): string {
  const builder = builderOf(idea);
  const out: string[] = [`# Plan — ${mdLine(idea.title)}`, ''];
  if (state.approvedAt) out.push(`Design approved on ${state.approvedAt}. The tasks are a draft: change them as the build goes.`, '');
  out.push('## The one thing to show', '', oneThingToShow(state), '');
  out.push('## Tasks', '');
  if (!plan.tasks.length) out.push('(no tasks yet)', '');
  const picked = new Set(pickedTools(state));
  for (const tool of toolsIn(plan.tasks).filter((t) => picked.has(t))) {
    out.push(`### ${tool}`, '', `Pathway: ${pathwayLabel(tool, builder)}`, '');
    out.push(...taskLines(byTool(plan.tasks, tool)), '');
  }
  // A task on a tool other than the one picked has no kit: it goes last, never under a kit's tool.
  const stray = plan.tasks.filter((t) => !picked.has(t.tool));
  if (stray.length) {
    out.push(NOT_PICKED_HEADING, '', NOT_PICKED_NOTE, '');
    for (const t of stray) out.push(...taskLines([t]).map((l, i) => (i === 0 ? `${l} (${mdLine(t.tool)})` : l)));
    out.push('');
  }
  out.push('## Risks', '');
  out.push(plan.risks.length ? plan.risks.map((r) => `- ${mdLine(r)}`).join('\n') : '- (none named)', '');
  // The same CSIC note design.md has, from the tool choice's flags.
  const csic = csicFlags(state);
  if (csic.length) out.push(`${CSIC_NOTE} (${csic.map(mdLine).join(', ')})`, '');
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/* ---------- starter kits ---------- */

/**
 * The kit folders for the one picked tool and for each tool the design adds for its gaps: path relative to the idea
 * folder → content. `kit` is the kit AI's content (decoded); without it the kit holds what the design says alone.
 */
export function kitFiles(idea: Idea, state: DesignState, plan: DesignPlanOutput, kit?: DesignKitOutput): Record<string, string> {
  const out: Record<string, string> = {};
  const features = toolFeatures(state);
  // The kits are shared with the builder and the team: people by role, never by name.
  const byRole = peopleByRole(idea);
  for (const tool of APPROVED_TOOLS.filter((t) => pickedTools(state).includes(t))) {
    const fits = new Map((state.tool?.fit ?? []).map((x) => [x.feature.toLowerCase(), x]));
    const built = features.filter((f) => !f.scope).map((f) => {
      const x = fits.get(f.name.toLowerCase());
      return { ...f, ...(x ? { fit: x.fit, ...(x.note ? { note: x.note } : {}), ...(x.stale ? { stale: true } : {}) } : {}) };
    });
    const folders = renderKit({
      idea, state, tool, built,
      outside: state.features.filter((f) => f.scope?.status === 'outside'), out: state.features.filter((f) => f.scope?.status === 'out'),
      tasks: byTool(plan.tasks, tool), risks: plan.risks, mustShow: oneThingToShow(state), ...(kit ? { kit } : {}),
    });
    for (const [slug, files] of Object.entries(folders)) {
      for (const [name, content] of Object.entries(files)) {
        const text = byRole(content);
        out[`${KIT_DIR}/${slug}/${name}`] = text.endsWith('\n') ? text : `${text}\n`;
      }
    }
  }
  return out;
}

/* ---------- what the app wrote in kit/: kit/.cafe-written.json ---------- */

/** The list of kit files the app wrote last time, so the next write can take away only its own files it no longer writes. */
export const WRITTEN_FILE = `${KIT_DIR}/.cafe-written.json`;
/**
 * Every file name a kit has ever had (from the history of kits.ts and kitFiles.ts: topics.md and process.md were the
 * Copilot Studio and UiPath outlines before the kits were filled in). Only for an idea written before the list existed:
 * such a file the new layout does not write is shown as an "older kit file" for the operator to remove (it may be one
 * they edited), never removed by itself.
 */
export const KNOWN_KIT_NAMES = new Set([
  'README.md', 'sample-data.csv', 'test-checklist.md', 'prompts.md', 'instructions.md', 'knowledge.md', 'skills.md', 'topics.md', 'data-model.md',
  'screens.md', 'flows.md', 'datasets.md', 'rules.csv', 'flow.md', 'flow.json', 'flow-diagram.html', 'BUILD-WITH-AGENT.md', 'process.md',
]);
interface Written { files: string[]; older?: string[] }

/** A path the app may take away: under kit/, no step out, not the list itself. */
const isKitPath = (rel: string) => rel.startsWith(`${KIT_DIR}/`) && rel !== WRITTEN_FILE && !rel.split('/').some((p) => p === '..' || p === '.' || !p);

async function readWritten(dir: string): Promise<Written | undefined> {
  const text = await readText(path.join(dir, ...WRITTEN_FILE.split('/')));
  if (text === undefined) return undefined;
  try {
    const raw = JSON.parse(text) as Partial<Written>;
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && isKitPath(x)) : []);
    return { files: list(raw.files), older: list(raw.older) };
  } catch { return { files: [] }; }
}
const writeWritten = (dir: string, w: Written) =>
  writeFileAtomic(path.join(dir, ...WRITTEN_FILE.split('/')), `${JSON.stringify({ note: 'The kit files the Café app wrote. It removes only these.', files: [...w.files].sort(), ...(w.older?.length ? { older: [...w.older].sort() } : {}) }, null, 1)}\n`);
const exists = async (file: string) => fs.stat(file).then((s) => s.isFile(), () => false);

/** Takes away one kit file the app wrote, and its folder when that leaves it empty (never anything else). */
async function removeKitFile(dir: string, rel: string): Promise<boolean> {
  if (!isKitPath(rel)) return false;
  const file = path.join(dir, ...rel.split('/'));
  if (!(await exists(file))) return false;
  await fs.rm(file);
  // Empty folders up to kit/ go too: a tool that is no longer picked leaves no empty folder behind.
  let folder = path.dirname(file);
  const kitRoot = path.join(dir, KIT_DIR);
  while (folder.startsWith(kitRoot) && folder !== kitRoot) {
    if ((await fs.readdir(folder).catch(() => ['x'])).length) break;
    await fs.rmdir(folder).catch(() => {});
    folder = path.dirname(folder);
  }
  return true;
}

/**
 * Writes plan.md and the kits. Re-running overwrites only these files; anything else in kit/ (the operator's notes,
 * an agent's work) is left alone. A file the app wrote last time (kit/.cafe-written.json) that the new layout no longer
 * writes is taken away. For an idea written before that list, the files with a name the kits used to have that are not
 * written now are kept as "older kit files" for the operator to remove (removeOlderKitFiles). Returns the files
 * written, sorted, what was taken away and the older files.
 */
export async function writePlan(
  root: string, idea: Idea, state: DesignState, plan: DesignPlanOutput, kit?: DesignKitOutput,
): Promise<{ files: string[]; planMd: string; removed: string[]; older: string[] }> {
  const dir = await ideaDir(root, idea.id);
  const planMd = renderPlanMd(idea, state, plan);
  const files: Record<string, string> = { [PLAN_FILE]: planMd, ...kitFiles(idea, state, plan, kit) };
  const before = await readWritten(dir);
  for (const [rel, content] of Object.entries(files)) await writeFileAtomic(path.join(dir, ...rel.split('/')), content);
  const now = Object.keys(files).filter(isKitPath);
  const removed: string[] = [];
  let older: string[];
  if (before) {
    for (const rel of before.files) if (!now.includes(rel) && (await removeKitFile(dir, rel))) removed.push(rel);
    older = [];
    for (const rel of before.older ?? []) if (!now.includes(rel) && (await exists(path.join(dir, ...rel.split('/'))))) older.push(rel);
  } else {
    older = (await walk(path.join(dir, KIT_DIR), KIT_DIR)).filter((rel) => isKitPath(rel) && !now.includes(rel) && KNOWN_KIT_NAMES.has(rel.split('/').pop()!) && rel.split('/').length === 3);
  }
  await writeWritten(dir, { files: now, older });
  return { files: Object.keys(files).sort(), planMd, removed: removed.sort(), older: older.sort() };
}

/** The operator's "Remove older kit files": only the files listed as older, each still a kit file; the list is cleared. */
export async function removeOlderKitFiles(root: string, id: string): Promise<{ removed: string[] }> {
  const dir = await ideaDir(root, id);
  const w = await readWritten(dir);
  const removed: string[] = [];
  for (const rel of w?.older ?? []) if (await removeKitFile(dir, rel)) removed.push(rel);
  if (w) await writeWritten(dir, { files: w.files, older: [] });
  return { removed };
}

async function walk(dir: string, rel: string): Promise<string[]> {
  let entries: Dirent[];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
  const out: string[] = [];
  for (const e of entries) {
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), r)));
    else if (e.isFile() && !e.name.includes('.tmp-')) out.push(r);
  }
  return out;
}

/** What is on disk: plan.md (if written) and every file under kit/ (not the app's own list), sorted; and the older kit files still there. */
export async function readPlan(root: string, id: string): Promise<{ planMd?: string; files: string[]; older?: string[] }> {
  const dir = await ideaDir(root, id);
  const planMd = await readText(path.join(dir, PLAN_FILE));
  const files = [...(planMd !== undefined ? [PLAN_FILE] : []), ...(await walk(path.join(dir, KIT_DIR), KIT_DIR)).filter((f) => f !== WRITTEN_FILE)].sort();
  const older = ((await readWritten(dir))?.older ?? []).filter((f) => files.includes(f));
  return { ...(planMd !== undefined ? { planMd } : {}), files, ...(older.length ? { older } : {}) };
}
