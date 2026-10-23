import type { Clock } from '../clock';
import type { Idea, PrepUpdate, UpdateSource } from '../ideas/idea';
import { loadIdea, saveIdea, ideaDir } from '../ideas/store';
import { hasRole, matchPerson, personOn, withAddedRole, withoutRole, withRoleOn } from '../ideas/people';
import { sameQuestion } from '../inbox/question';
import { appendHistory } from '../workspace/files';
import { tick } from '../checklist/checklist';
import { loadSteps } from '../rules/stages';
import { showNames, type Coded } from '../command/names';
import { planAiLinks } from '../ai/apply';
import { rebuildGraph, readAiLinks, appendAiLink, setAiLinkStatus } from '../graph/store';
import { edgeId, NODE_LABELS, type AiLink, type NodeType } from '../graph/ontology';
import type { ReviewUpdates } from '../ai/tasks';


/** Where a proposal came from; older ones, from before there were sources, came from the decision. */
export const sourceOf = (u: Pick<PrepUpdate, 'from'>): UpdateSource => u.from ?? 'decision';

type WithAnswers = Idea & { answers?: { question: string; answer: string; source?: string }[] };
/** Where answers saved from the review list say they came from. */
export const REVIEW_SOURCE = 'review answers';
/** A link, read as a sentence. */
const REL_WORDS: Record<string, string> = { NEEDS: 'needs', REPLACES: 'replaces the problem', USES_DATA: 'uses data from', BUILT_WITH: 'is built with' };
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The AI's proposed updates, checked against the idea as it is: only real changes, each once, in plain words.
 * Names come back from their codes. A change said no to before is not proposed again; applied ones stay listed.
 */
export async function planUpdates(
  root: string, idea: WithAnswers, u: ReviewUpdates | undefined, codes: Map<string, Coded>, provider: string, before: PrepUpdate[] = [],
  from: UpdateSource = 'decision',
): Promise<PrepUpdate[]> {
  // A new suggestion replaces only its own section's waiting proposals; the other sections' stay as they are.
  const kept = before.filter((x) => x.status !== 'proposed' || sourceOf(x) !== from);
  const known = new Set(kept.map((x) => x.key));
  const out: Omit<PrepUpdate, 'id'>[] = [];
  const add = (x: Omit<PrepUpdate, 'id' | 'status' | 'from'>) => { if (!known.has(x.key)) { known.add(x.key); out.push({ ...x, from, status: 'proposed' }); } };
  let graph: Awaited<ReturnType<typeof rebuildGraph>> | undefined;
  const graphNow = async () => (graph ??= await rebuildGraph(root));
  if (u) {
    const typed = showNames(u.builder ?? '', codes).replace(/[[\]]/g, '').trim();
    if (typed.split(/\s+/).length >= 2) {
      // The person the answer means: someone already on the team or in the universe when the name fits one of them
      // (spelt another way, or with an extra word), so a builder is never added twice.
      const known = [...idea.people.team.map((p) => p.name), idea.people.submitter ?? '', ...(await graphNow()).nodes.filter((n) => n.type === 'Person').map((n) => n.label)];
      const name = matchPerson(typed, known) ?? typed;
      const instead = withRoleOn(idea, 'builder').map((p) => p.name).filter((x) => norm(x) !== norm(name));
      if (!hasRole(personOn(idea, name), 'builder') || instead.length) {
        const parts = [
          `Make ${name} the builder`,
          norm(typed) !== norm(name) ? ` (the answer says "${typed}")` : '',
          instead.length ? ` instead of ${instead.join(' and ')}` : '',
          personOn(idea, name) ? '' : ' (adds them to the team)',
          u.builderCanAttend ? ', and tick "Builder named, can attend every session"' : '',
        ];
        add({ key: `builder:${norm(name)}`, kind: 'builder', label: parts.join(''),
          builder: { name, canAttend: u.builderCanAttend === true, ...(norm(typed) !== norm(name) ? { typed } : {}), ...(instead.length ? { instead } : {}) } });
      }
    }
    if ((u.participation === 'Team' || u.participation === 'Individual') && u.participation !== idea.participation) {
      add({ key: `participation:${u.participation}`, kind: 'participation', participation: u.participation,
        label: `Set participation to ${u.participation}${idea.participation ? ` (the form says ${idea.participation})` : ''}` });
    }
    for (const f of u.resolvedFlags ?? []) {
      const hit = idea.flags.find((x) => norm(x) === norm(f));
      if (hit) add({ key: `flag:${norm(hit)}`, kind: 'flag', flag: hit, label: `Clear the flag: ${hit}` });
    }
    const have = idea.answers ?? [];
    const facts = (u.facts ?? []).map((f) => ({ question: showNames(f.question, codes), answer: showNames(f.answer, codes) }))
      .filter((f) => f.answer.trim() && !have.some((h) => norm(h.answer) === norm(f.answer) || (sameQuestion(h.question, f.question) && norm(h.answer).replace(/\W/g, '') === norm(f.answer).replace(/\W/g, ''))));
    // One answer per question from your review: a newer one replaces the one before, it is not added beside it.
    const replacing = have.filter((h) => h.source === REVIEW_SOURCE && facts.some((f) => sameQuestion(f.question, h.question))).length;
    if (facts.length) {
      add({ key: `facts:${facts.map((f) => norm(f.answer)).join('|')}`, kind: 'facts', facts,
        label: `Save ${facts.length === 1 ? 'this answer' : `these ${facts.length} answers`} on the idea${replacing ? ` (in place of ${replacing} saved before)` : ''}, for the design series and later suggestions: ${facts.map((f) => f.answer).join(' · ')}` });
    }
    if (u.graph?.nodes?.length || u.graph?.links?.length) {
      const graph = await graphNow();
      const { links } = planAiLinks(idea.id, u.graph, graph, (await readAiLinks(root)).links, provider, { status: 'confirmed' });
      const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label;
      for (const l of links) {
        const id = edgeId(l.from, l.rel, l.to);
        const fresh = new Map((l.newNodes ?? []).map((n) => [n.id, n]));
        const name = (nid: string) => fresh.get(nid)?.label ?? label(nid) ?? nid;
        const neu = [...fresh.values()].map((n) => `${n.label} (${NODE_LABELS[n.type as NodeType].toLowerCase()})`);
        add({ key: `link:${id}`, kind: 'link', link: { ...l, source: `ai:${provider}:review-answers` },
          label: `${name(l.from)} ${REL_WORDS[l.rel] ?? l.rel} ${name(l.to)}${neu.length ? `; adds a new star: ${neu.join(', ')}` : ''}` });
      }
    }
  }
  let n = Math.max(0, ...before.map((x) => Number(/^u(\d+)$/.exec(x.id)?.[1] ?? 0)));
  return [...kept, ...out.map((x) => ({ ...x, id: `u${++n}` }) as PrepUpdate)];
}

/**
 * Applies one update to the idea (the builder, participation, a flag, the answers as facts, a graph link) and returns
 * how to undo it. The decision's Yes does this; the data questions do it by themselves (src/data). `source` is where
 * saved answers and ticks say they came from.
 */
export async function applyUpdate(
  root: string, id: string, u: PrepUpdate, clock: Clock, opts: { by: 'operator' | 'app'; source: string },
): Promise<NonNullable<PrepUpdate['undo']>> {
  const idea = await loadIdea(root, id) as WithAnswers;
  const steps = await loadSteps(root);
  const tickIf = async (step: string, ok: boolean): Promise<string[]> => {
    const now = await loadIdea(root, id);
    if (!ok || now.checklist[step]?.done) return [];
    await tick(root, id, step, true, { by: opts.by, source: opts.source, clock, steps });
    return [step];
  };
  const undo: NonNullable<PrepUpdate['undo']> = {};
  if (u.kind === 'builder' && u.builder) {
    // The builder: the one named takes the role; anyone else who had it keeps their other roles.
    let team = idea.people.team;
    for (const other of withRoleOn(idea, 'builder')) if (norm(other.name) !== norm(u.builder.name)) team = withoutRole(team, other.name, 'builder');
    team = withAddedRole(team, u.builder.name, 'builder');
    undo.team = idea.people.team; undo.teamAfter = team;
    await saveIdea(root, { ...idea, people: { ...idea.people, team } });
    undo.ticked = await tickIf('s2e', u.builder.canAttend);
  } else if (u.kind === 'participation' && u.participation) {
    undo.participation = idea.participation ?? null;
    // Keep what the form said, the first time the field changes.
    const formWas = idea.formWas?.participation !== undefined || !idea.participation ? idea.formWas : { ...idea.formWas, participation: idea.participation };
    await saveIdea(root, { ...idea, participation: u.participation, ...(formWas ? { formWas } : {}) });
  } else if (u.kind === 'flag' && u.flag) {
    await saveIdea(root, { ...idea, flags: idea.flags.filter((f) => f !== u.flag) });
  } else if (u.kind === 'facts' && u.facts) {
    const replaced = (idea.answers ?? []).filter((a) => a.source === opts.source && u.facts!.some((f) => sameQuestion(f.question, a.question)));
    const kept = (idea.answers ?? []).filter((a) => !replaced.includes(a));
    undo.replaced = replaced;
    await saveIdea(root, { ...idea, answers: [...kept, ...u.facts.map((f) => ({ ...f, source: opts.source }))] } as Idea);
    // The team answered our questions: the reply is in.
    undo.ticked = await tickIf('s2d', !!(idea.sent?.E2 || idea.sent?.E2R));
  } else if (u.kind === 'link' && u.link) {
    await appendAiLink(root, { ...(u.link as AiLink), status: 'confirmed' });
    undo.edgeId = edgeId(u.link.from, u.link.rel as AiLink['rel'], u.link.to);
  }
  return undo;
}

/** Yes, No or Undo on one proposed update. Each change goes in the idea's history; Undo puts back only what it changed. */
export async function decideUpdate(root: string, id: string, uid: string, act: unknown, clock: Clock): Promise<PrepUpdate> {
  const idea = await loadIdea(root, id) as WithAnswers;
  const all = idea.updates ?? [];
  const u = all.find((x) => x.id === uid);
  if (!u) throw new Error('That update is gone; re-evaluate again');
  const at = clock();
  const dir = await ideaDir(root, id);
  const log = (detail: string) => appendHistory(dir, { at, action: 'review-update', by: 'operator', detail, source: REVIEW_SOURCE });
  const save = async (next: PrepUpdate, changed?: WithAnswers) => {
    const base = changed ?? (await loadIdea(root, id) as WithAnswers);
    await saveIdea(root, { ...base, updates: (base.updates ?? all).map((x) => (x.id === uid ? next : x)) } as Idea);
    return next;
  };
  if (act === 'no') {
    if (u.status !== 'proposed') throw new Error('Only a proposed update can be said no to');
    return save({ ...u, status: 'dismissed' });
  }
  if (act === 'yes') {
    if (u.status !== 'proposed') throw new Error(`That update is already ${u.status}`);
    const undo = await applyUpdate(root, id, u, clock, { by: 'operator', source: REVIEW_SOURCE });
    await log(`Applied from your answers: ${u.label}`);
    return save({ ...u, status: 'applied', undo });
  }
  if (act === 'undo') {
    if (u.status !== 'applied') throw new Error('Only an applied update can be undone');
    const steps = await loadSteps(root);
    const now = await loadIdea(root, id) as WithAnswers;
    if (u.kind === 'builder' && u.builder) {
      // As it was, when nothing about the team has changed since; else only the builder role goes (and someone this
      // added to the team leaves it again), so other changes since stay.
      if (u.undo?.team && JSON.stringify(now.people.team) === JSON.stringify(u.undo.teamAfter)) {
        await saveIdea(root, { ...now, people: { ...now.people, team: u.undo.team } });
      } else {
        const wasOn = (u.undo?.team ?? []).some((p) => norm(p.name) === norm(u.builder!.name));
        const team = wasOn ? withoutRole(now.people.team, u.builder.name, 'builder') : now.people.team.filter((p) => norm(p.name) !== norm(u.builder!.name));
        await saveIdea(root, { ...now, people: { ...now.people, team } });
      }
    } else if (u.kind === 'participation') {
      const { participation: _p, ...rest } = now;
      const back = (u.undo?.participation ? { ...now, participation: u.undo.participation } : rest) as Idea;
      // Back to the form's value: nothing differs from the form any more.
      if (back.formWas?.participation !== undefined && back.formWas.participation === back.participation) {
        const { participation: _w, ...was } = back.formWas;
        if (Object.keys(was).length) back.formWas = was; else delete back.formWas;
      }
      await saveIdea(root, back);
    } else if (u.kind === 'flag' && u.flag && !now.flags.includes(u.flag)) {
      await saveIdea(root, { ...now, flags: [...now.flags, u.flag] });
    } else if (u.kind === 'facts' && u.facts) {
      const drop = new Set(u.facts.map((f) => norm(f.answer)));
      await saveIdea(root, { ...now, answers: [...(now.answers ?? []).filter((a) => !(a.source === REVIEW_SOURCE && drop.has(norm(a.answer)))), ...(u.undo?.replaced ?? [])] } as Idea);
    } else if (u.kind === 'link' && u.undo?.edgeId) {
      await setAiLinkStatus(root, u.undo.edgeId, 'removed').catch(() => {});
    }
    for (const step of u.undo?.ticked ?? []) await tick(root, id, step, false, { by: 'operator', source: REVIEW_SOURCE, clock, steps });
    await log(`Undone: ${u.label}`);
    const { undo: _u, ...rest } = u;
    return save({ ...rest, status: 'proposed' });
  }
  throw new Error('Say yes, no or undo');
}

/** Take back one saved answer (wrong, out of date or a duplicate). Logged in the idea's history. */
export async function removeAnswer(root: string, id: string, question: string, answer: string, clock: Clock): Promise<{ removed: boolean }> {
  const idea = await loadIdea(root, id) as WithAnswers;
  const list = idea.answers ?? [];
  const i = list.findIndex((a) => a.question === question && a.answer === answer);
  if (i < 0) throw new Error('That answer is gone already');
  // The brief was written from this answer too: say it is out of date until the next re-evaluation.
  await saveIdea(root, { ...idea, answers: list.filter((_, k) => k !== i), ...(idea.learned ? { learned: { ...idea.learned, stale: true } } : {}) } as Idea);
  await appendHistory(await ideaDir(root, id), { at: clock(), action: 'answer-removed', by: 'operator', detail: `Answer removed: ${answer}`, ...(list[i].source ? { source: list[i].source } : {}) });
  return { removed: true };
}

/**
 * What a suggestion read in the answers, taken into the idea: its proposed updates (checked, each waiting for Yes,
 * on the one list the decision and the tool picker share) and its brief of what the answers add. Returns the fields
 * to save on the idea; a suggestion that wrote no brief keeps the one there.
 */
export async function takeInAnswers(
  root: string, idea: WithAnswers, out: { updates?: ReviewUpdates; learned?: { topic: string; text: string }[] },
  codes: Map<string, Coded>, provider: string, at: string, read: number, from: UpdateSource = 'decision',
): Promise<Pick<Idea, 'updates' | 'learned'>> {
  const updates = await planUpdates(root, idea, out.updates, codes, provider, idea.updates, from);
  const points = (out.learned ?? []).map((p) => ({ topic: p.topic.trim(), text: showNames(p.text, codes).trim() })).filter((p) => p.topic && p.text);
  const learned = points.length ? { at, provider, from: read, points } : idea.learned;
  // An emptied list is saved empty, so a waiting proposal that went does not linger.
  return { ...(updates.length || idea.updates?.length ? { updates } : {}), ...(learned ? { learned } : {}) };
}
