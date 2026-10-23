import type { Clock } from '../clock';
import type { Idea, PrepUpdate } from '../ideas/idea';
import { loadIdea, saveIdea, ideaDir } from '../ideas/store';
import { hasRole, personOn, withRole, withoutRole } from '../ideas/people';
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
  if (u) {
    const name = showNames(u.builder ?? '', codes).replace(/[[\]]/g, '').trim();
    if (name.split(/\s+/).length >= 2 && !hasRole(personOn(idea, name), 'builder')) {
      const also = personOn(idea, name) ? '' : ' (adds them to the team)';
      add({ key: `builder:${norm(name)}`, kind: 'builder', builder: { name, canAttend: u.builderCanAttend === true },
        label: `Make ${name} the builder${also}${u.builderCanAttend ? ', and tick "Builder named, can attend every session"' : ''}` });
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
      .filter((f) => f.answer.trim() && !have.some((h) => norm(h.answer) === norm(f.answer)));
    if (facts.length) {
      add({ key: `facts:${facts.map((f) => norm(f.answer)).join('|')}`, kind: 'facts', facts,
        label: `Save ${facts.length === 1 ? 'this answer' : `these ${facts.length} answers`} on the idea, for the design series and later suggestions: ${facts.map((f) => f.answer).join(' · ')}` });
    }
    if (u.graph?.nodes?.length || u.graph?.links?.length) {
      const graph = await rebuildGraph(root);
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
      undo.team = idea.people.team;
      await saveIdea(root, { ...idea, people: { ...idea.people, team: withRole(idea.people.team, u.builder.name, 'builder') } });
      undo.ticked = await tickIf('s2e', u.builder.canAttend);
    } else if (u.kind === 'participation' && u.participation) {
      undo.participation = idea.participation ?? null;
      await saveIdea(root, { ...idea, participation: u.participation });
    } else if (u.kind === 'flag' && u.flag) {
      await saveIdea(root, { ...idea, flags: idea.flags.filter((f) => f !== u.flag) });
    } else if (u.kind === 'facts' && u.facts) {
      await saveIdea(root, { ...idea, answers: [...(idea.answers ?? []), ...u.facts.map((f) => ({ ...f, source: REVIEW_SOURCE }))] } as Idea);
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
      // Only the builder role goes; someone this added to the team leaves it again. Other team changes since stay.
      const wasOn = (u.undo?.team ?? []).some((p) => norm(p.name) === norm(u.builder!.name));
      const team = wasOn ? withoutRole(now.people.team, u.builder.name, 'builder') : now.people.team.filter((p) => norm(p.name) !== norm(u.builder!.name));
      await saveIdea(root, { ...now, people: { ...now.people, team } });
    } else if (u.kind === 'participation') {
      const { participation: _p, ...rest } = now;
      await saveIdea(root, (u.undo?.participation ? { ...now, participation: u.undo.participation } : rest) as Idea);
    } else if (u.kind === 'flag' && u.flag && !now.flags.includes(u.flag)) {
      await saveIdea(root, { ...now, flags: [...now.flags, u.flag] });
    } else if (u.kind === 'facts' && u.facts) {
      const drop = new Set(u.facts.map((f) => norm(f.answer)));
      await saveIdea(root, { ...now, answers: (now.answers ?? []).filter((a) => !(a.source === REVIEW_SOURCE && drop.has(norm(a.answer)))) } as Idea);
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
