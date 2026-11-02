import type { Clock } from '../clock';
import type { Idea } from '../ideas/idea';
import { loadIdea, saveIdea, ideaDir } from '../ideas/store';
import { plainName, withRoleOn } from '../ideas/people';
import { rebuildGraph } from '../graph/store';
import { appendHistory } from '../workspace/files';
import { joinNames } from './builderAnswer';
import { peopleFor } from './suggestInput';

/**
 * The learned brief kept in line with the idea's roles. The brief is the AI's, but who builds it and whether they can
 * attend are facts the record holds (an answer read by the code, replaced or taken back at review): a brief that names
 * someone else as builder, misses a builder, or says the opposite about attendance is corrected by the code from the
 * roles, so it never contradicts the Team panel.
 */
type Learned = NonNullable<Idea['learned']>;
type Point = Learned['points'][number];

/** A point about who builds it or whether they can attend. */
export const isBuilderPoint = (p: Pick<Point, 'topic'>) => /\bbuild|\battend/i.test(p.topic);
const BUILD = /\bbuild(?:s|er|ers|ing)?\b/i;
const ATTEND = /\battend|\bevery (?:design )?session|\ball (?:the )?(?:design )?sessions/i;
const NEG = /\b(?:not|cannot|can't|can’t|cant|unable|won't|won’t|no)\b/i;
const pad = (s: string) => ` ${plainName(s)} `;
const names = (text: string, name: string) => !!plainName(name) && pad(text).includes(pad(name));

/** The code's own line for the builder point, from the roles. */
export function builderLine(builders: string[], attends: boolean): string {
  const many = builders.length > 1;
  return `${joinNames(builders)} ${many ? 'build' : 'builds'} it${attends
    ? ` and ${many ? 'can all' : 'can'} attend every design session.`
    : '; whether they can attend every design session is not said yet.'}`;
}

/**
 * The brief with its builder part agreeing with the roles. `known`: everyone the Café knows by name for the idea.
 * Returns the same object when nothing needed changing.
 */
export function alignBrief(learned: Learned, idea: Idea, known: string[]): Learned {
  const builders = withRoleOn(idea, 'builder').map((p) => p.name);
  const attends = !!(idea.checklist.s2e?.done || idea.checklist.s3a?.done);
  const others = [...new Set(known.filter((k) => k.trim() && !builders.some((b) => plainName(b) === plainName(k))))];
  const namesOther = (t: string) => others.some((o) => names(t, o));
  const wrong = (t: string) => {
    if (namesOther(t)) return true;
    if (builders.length && !builders.every((b) => names(t, b))) return true;
    if (ATTEND.test(t)) { const no = NEG.test(t); if (!no && !attends) return true; if (no && attends) return true; }
    return false;
  };
  let wrote = false;
  const points: Point[] = [];
  for (const p of learned.points) {
    if (isBuilderPoint(p)) {
      if (!wrong(p.text)) { points.push(p); continue; }
      // Wrong about the builder: the code writes it from the roles (once), or leaves it out when no one builds it now.
      if (builders.length && !wrote) { points.push({ topic: 'Builder', text: builderLine(builders, attends) }); wrote = true; }
      continue;
    }
    // Elsewhere, a sentence that has someone else build it (and no builder of the idea) goes.
    const sentences = p.text.split(/(?<=[.!?])\s+/);
    const kept = sentences.filter((s) => !(BUILD.test(s) && namesOther(s) && !builders.some((b) => names(s, b))));
    if (kept.length === sentences.length) points.push(p);
    else if (kept.join(' ').trim()) points.push({ ...p, text: kept.join(' ').trim() });
  }
  // A builder the answers gave (not the form) and no point about them: the code adds it.
  const fromAnswers = withRoleOn(idea, 'builder').some((p) => p.added?.includes('builder'));
  if (fromAnswers && !points.some(isBuilderPoint)) { points.unshift({ topic: 'Builder', text: builderLine(builders, attends) }); }
  const same = points.length === learned.points.length && points.every((p, i) => p.topic === learned.points[i].topic && p.text === learned.points[i].text);
  return same ? learned : { ...learned, points };
}

/** alignBrief on the stored idea: saved, and logged, when the brief changed. Returns whether it did. */
export async function alignLearned(root: string, id: string, clock?: Clock): Promise<boolean> {
  const idea = await loadIdea(root, id);
  if (!idea.learned?.points.length) return false;
  const known = (await peopleFor(root, await rebuildGraph(root), idea)).map((n) => n.label);
  const next = alignBrief(idea.learned, idea, known);
  if (next === idea.learned) return false;
  const points = next.points;
  // A brief left with no points stays (empty, and out of date when it was): the answers are still there to rebuild it.
  await saveIdea(root, { ...idea, learned: next });
  if (clock) {
    await appendHistory(await ideaDir(root, id), {
      at: clock(), action: 'learned-aligned', by: 'app',
      detail: `The learned brief's builder part was written from the roles: ${points.find(isBuilderPoint)?.text ?? 'no one builds it now, so it was taken out'}`,
    });
  }
  return true;
}
