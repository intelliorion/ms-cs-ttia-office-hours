import path from 'node:path';
import { plusDays, type Clock } from '../clock';
import { CLOSURE_LABELS, type Closure, type Idea } from './idea';
import { loadIdea, saveIdea, ideaDir } from './store';
import { appendHistory, readText, writeFileAtomic } from '../workspace/files';
import { loadSettings } from '../round/store';
import { renderHandoff } from '../review/review';
import { STAGES, type StageNo } from '../rules/stages';
import { changes, whereLabel, type StageTarget } from './suggest';

const BAD_TARGET = 'Pick Review and Select, Design series or Launch and Learn, or a way to close it';

/** Checks a target that came from the page; anything else is refused in plain words. */
export function parseTarget(raw: unknown): StageTarget {
  const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (t.stage !== undefined && t.closeAs === undefined) {
    const n = Number(t.stage);
    if ((STAGES as number[]).includes(n) && String(t.stage).trim() !== '') return { stage: n as StageNo };
  }
  if (t.closeAs !== undefined && t.stage === undefined && typeof t.closeAs === 'string' && Object.hasOwn(CLOSURE_LABELS, t.closeAs)) {
    return { closeAs: t.closeAs as Closure };
  }
  throw new Error(BAD_TARGET);
}

/**
 * Sets an idea's stage, forward or back, or closes it. Never blocked by steps; every change is logged.
 * Setting a stage reopens a closed idea. Closing keeps the stage the idea reached.
 */
export async function setStage(root: string, id: string, rawTarget: StageTarget, clock: Clock): Promise<Idea> {
  const target = parseTarget(rawTarget);
  const idea = await loadIdea(root, id);
  if (!changes(idea, target)) return idea;
  const at = clock();
  let next: Idea;
  if ('closeAs' in target) {
    next = target.closeAs === 'csic'
      ? { ...idea, closed: { as: 'csic', at, followUp: plusDays(at, 28) }, route: 'CSIC Repository' }
      : { ...idea, closed: { as: target.closeAs, at } };
  } else {
    const { closed: _closed, ...open } = idea;
    next = { ...open, stage: target.stage };
  }
  await saveIdea(root, next);
  const dir = await ideaDir(root, id);
  await appendHistory(dir, { at, action: 'stage', by: 'operator', detail: `${whereLabel(idea)} → ${whereLabel(next)}` });
  // A CSIC handoff written at review time gets its follow-up date once the idea is closed as csic.
  const handoff = path.join(dir, 'csic-handoff.md');
  if (next.closed?.as === 'csic' && (await readText(handoff)) !== undefined) {
    await writeFileAtomic(handoff, renderHandoff(next, await loadSettings(root)));
  }
  return next;
}
