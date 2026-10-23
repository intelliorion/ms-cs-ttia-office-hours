import type { Clock } from '../clock';
import type { Idea, PrepUpdate } from '../ideas/idea';
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
): Promise<PrepUpdate[]> {
  const kept = before.filter((x) => x.status !== 'proposed');
  const known = new Set(kept.map((x) => x.key));
  const out: Omit<PrepUpdate, 'id'>[] = [];
  const add = (x: Omit<PrepUpdate, 'id' | 'status'>) => { if (!known.has(x.key)) { known.add(x.key); out.push({ ...x, status: 'proposed' }); } };
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

/** Yes, No or Undo on one proposed update. Each change goes in the idea's history; Undo puts back only what it changed. */
export async function decideUpdate(root: string, id: string, uid: string, act: unknown, clock: Clock): Promise<PrepUpdate> {
  const idea = await loadIdea(root, id) as WithAnswers;
  const all = idea.prep?.updates ?? [];
  const u = all.find((x) => x.id === uid);
  if (!u) throw new Error('That update is gone; re-evaluate again');
  const at = clock();
  const dir = await ideaDir(root, id);
  const log = (detail: string) => appendHistory(dir, { at, action: 'review-update', by: 'operator', detail, source: REVIEW_SOURCE });
  const save = async (next: PrepUpdate, changed?: WithAnswers) => {
    const base = changed ?? (await loadIdea(root, id) as WithAnswers);
    await saveIdea(root, { ...base, prep: { ...base.prep!, updates: (base.prep?.updates ?? all).map((x) => (x.id === uid ? next : x)) } } as Idea);
    return next;
  };
  if (act === 'no') {
    if (u.status !== 'proposed') throw new Error('Only a proposed update can be said no to');
    return save({ ...u, status: 'dismissed' });
  }
  const steps = await loadSteps(root);
  const tickIf = async (step: string, ok: boolean): Promise<string[]> => {
    const now = await loadIdea(root, id);
    if (!ok || now.checklist[step]?.done) return [];
    await tick(root, id, step, true, { by: 'operator', source: REVIEW_SOURCE, clock, steps });
    return [step];
  };
  if (act === 'yes') {
    if (u.status !== 'proposed') throw new Error(`That update is already ${u.status}`);
    let undo: PrepUpdate['undo'] = {};
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
      const replaced = (idea.answers ?? []).filter((a) => a.source === REVIEW_SOURCE && u.facts!.some((f) => sameQuestion(f.question, a.question)));
      const kept = (idea.answers ?? []).filter((a) => !replaced.includes(a));
      undo.replaced = replaced;
      await saveIdea(root, { ...idea, answers: [...kept, ...u.facts.map((f) => ({ ...f, source: REVIEW_SOURCE }))] } as Idea);
      // The team answered our questions: the reply is in.
      undo.ticked = await tickIf('s2d', !!(idea.sent?.E2 || idea.sent?.E2R));
    } else if (u.kind === 'link' && u.link) {
      await appendAiLink(root, { ...(u.link as AiLink), status: 'confirmed' });
      undo.edgeId = edgeId(u.link.from, u.link.rel as AiLink['rel'], u.link.to);
    }
    await log(`Applied from your answers: ${u.label}`);
    return save({ ...u, status: 'applied', undo });
  }
  if (act === 'undo') {
    if (u.status !== 'applied') throw new Error('Only an applied update can be undone');
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
  await saveIdea(root, { ...idea, answers: list.filter((_, k) => k !== i) } as Idea);
  await appendHistory(await ideaDir(root, id), { at: clock(), action: 'answer-removed', by: 'operator', detail: `Answer removed: ${answer}`, ...(list[i].source ? { source: list[i].source } : {}) });
  return { removed: true };
}
