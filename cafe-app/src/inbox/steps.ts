import { getItem, updateItem, type InboxItem } from './store';

/**
 * The step log of one dropped file: eight fixed steps, each written to the sidecar the moment it ends,
 * so the Import screen can show the run live. A step is appended once; writing the same id again replaces it
 * (running → done / failed / needs-you).
 */
export type StepId = 'receive' | 'read' | 'screen' | 'match' | 'understand' | 'context' | 'graph' | 'check';
export type StepStatus = 'running' | 'done' | 'skipped' | 'needs-you' | 'failed';
/** One line of what the AI found while a step ran (a form export's ideas, one entry each). */
export interface TrailEntry { title: string; found: string[]; held?: number; failed?: true }
export interface Step {
  id: StepId; status: StepStatus; at: string; detail: string; ms?: number;
  /** Progress through a list (the 3rd of 7 ideas is [3, 7]). */
  of?: [number, number];
  /** What the AI found so far, newest last. */
  trail?: TrailEntry[];
  /** When a running step began (at is refreshed while it runs). */
  since?: string;
}

export const STEP_ORDER: StepId[] = ['receive', 'read', 'screen', 'match', 'understand', 'context', 'graph', 'check'];
export const STEP_WORDS: Record<StepId, string> = {
  receive: 'Receive', read: 'Read', screen: 'Screen', match: 'Match', understand: 'Understand', context: 'Update context', graph: 'Build the graph', check: 'Check',
};

const now = () => new Date().toISOString();

async function load(root: string, id: string): Promise<InboxItem> {
  const item = await getItem(root, id);
  if (!item) throw new Error(`No such import ${id}`);
  return item;
}

export async function markStep(root: string, id: string, step: Omit<Step, 'at'> & { at?: string }): Promise<InboxItem> {
  const item = await load(root, id);
  const steps = [...(item.steps ?? [])];
  const full: Step = { ...step, at: step.at ?? now() };
  const i = steps.findIndex((s) => s.id === step.id);
  if (i >= 0) steps[i] = full; else steps.push(full);
  return updateItem(root, id, { steps });
}

/** Every step after `after` becomes skipped with `detail` (a failure or a hold ended the run). */
export async function skipRest(root: string, id: string, after: StepId, detail: string): Promise<InboxItem> {
  const item = await load(root, id);
  const steps = [...(item.steps ?? [])];
  const at = now();
  for (const sid of STEP_ORDER.slice(STEP_ORDER.indexOf(after) + 1)) {
    const i = steps.findIndex((s) => s.id === sid);
    const s: Step = { id: sid, status: 'skipped', at, detail };
    if (i >= 0) steps[i] = s; else steps.push(s);
  }
  return updateItem(root, id, { steps });
}

/** Drop `from` and everything after it (a re-run of steps 4–8 starts here). */
export async function resetStepsFrom(root: string, id: string, from: StepId): Promise<InboxItem> {
  const item = await load(root, id);
  const keep = new Set(STEP_ORDER.slice(0, STEP_ORDER.indexOf(from)));
  return updateItem(root, id, { steps: (item.steps ?? []).filter((s) => keep.has(s.id)) });
}

export const stepOf = (item: Pick<InboxItem, 'steps'>, id: StepId): Step | undefined => item.steps?.find((s) => s.id === id);
export const isRunning = (item: Pick<InboxItem, 'steps'>): boolean => (item.steps ?? []).some((s) => s.status === 'running');

/** Measures one step: marks it running, runs `fn`, marks done with ms (or failed with the error) and rethrows. */
export async function timed<T>(
  root: string, id: string, step: StepId, running: string,
  fn: () => Promise<{ value: T; detail: string; status?: StepStatus }>,
): Promise<T> {
  await markStep(root, id, { id: step, status: 'running', detail: running });
  const t0 = Date.now();
  try {
    const r = await fn();
    await markStep(root, id, { id: step, status: r.status ?? 'done', detail: r.detail, ms: Date.now() - t0 });
    return r.value;
  } catch (e) {
    await markStep(root, id, { id: step, status: 'failed', detail: (e as Error).message || 'failed', ms: Date.now() - t0 });
    throw e;
  }
}
