import type { Clock } from '../clock';
import type { Idea, PrepUpdate, UpdateSource } from '../ideas/idea';
import { loadIdea, saveIdea, ideaDir } from '../ideas/store';
import { addPerson, hasRole, personOn, withAddedRole, withoutRole, withRoleOn } from '../ideas/people';
import { joinNames, resolvePerson, splitNames } from './builderAnswer';
import { sameQuestion } from '../inbox/question';
import { appendHistory } from '../workspace/files';
import { tick } from '../checklist/checklist';
import { loadSteps } from '../rules/stages';
import { showNames, type Coded } from '../command/names';
import { planAiLinks } from '../ai/apply';
import { starMatcher } from '../memory/lookup';
import { loadRegistry } from '../graph/registryFile';
import { rebuildGraph, readAiLinks, appendAiLink, updateAiLinks } from '../graph/store';
import { edgeId, NODE_LABELS, type AiLink, type NodeType } from '../graph/ontology';
import type { ReviewUpdates } from '../ai/tasks';
import { confirmAt } from '../ai/confirm';
import { loadSettings } from '../round/store';


/** Where a proposal came from; older ones, from before there were sources, came from the decision. */
export const sourceOf = (u: Pick<PrepUpdate, 'from'>): UpdateSource => u.from ?? 'decision';

type WithAnswers = Idea & { answers?: { question: string; answer: string; source?: string }[] };
/** Where answers saved from the review list say they came from. */
export const REVIEW_SOURCE = 'review answers';
/** A link, read as a sentence. */
const REL_WORDS: Record<string, string> = { NEEDS: 'needs', REPLACES: 'replaces the problem', USES_DATA: 'uses data from', BUILT_WITH: 'is built with' };
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * What the code read itself and how to file each update. `direct`: the builders and attendance the code read in a simple
 * answer (names, yes or no): they win over the AI's. `basis`: the answers the suggestion read, kept on each update so
 * taking one of them back undoes it. `notes` collects why a builder the AI named could not be used.
 */
export interface PlanOptions {
  direct?: { builders: string[]; canAttend?: boolean; basis: string[] };
  basis?: string[];
  notes?: string[];
}

/**
 * The AI's proposed updates, checked against the idea as it is: only real changes, each once, in plain words.
 * Names come back from their codes. A change applied before is not made again; one said no to (before updates were
 * applied by themselves) is never made. Facts restating an answer already on the idea from elsewhere (the team's
 * reply, the design or data questions) are left out.
 */
export async function planUpdates(
  root: string, idea: WithAnswers, u: ReviewUpdates | undefined, codes: Map<string, Coded>, provider: string, before: PrepUpdate[] = [],
  from: UpdateSource = 'decision', opts: PlanOptions = {},
): Promise<PrepUpdate[]> {
  // A new suggestion replaces only its own section's waiting proposals; the other sections' stay as they are.
  const kept = before.filter((x) => x.status !== 'proposed' || sourceOf(x) !== from);
  const known = new Set(kept.map((x) => x.key));
  const out: Omit<PrepUpdate, 'id'>[] = [];
  const add = (x: Omit<PrepUpdate, 'id' | 'status' | 'from'>) => {
    if (known.has(x.key)) return;
    known.add(x.key);
    const basis = x.basis ?? opts.basis;
    out.push({ ...x, from, status: 'proposed', ...(basis?.length ? { basis } : {}) });
  };
  let graph: Awaited<ReturnType<typeof rebuildGraph>> | undefined;
  const graphNow = async () => (graph ??= await rebuildGraph(root));
  const direct = opts.direct && (opts.direct.builders.length || opts.direct.canAttend !== undefined) ? opts.direct : undefined;
  if (u || direct) {
    // The builder(s): what the code read in a simple answer, else the names the AI wrote (several allowed), each the
    // person already on the team or in the universe when the name fits one of them, so no one is added twice.
    const current = withRoleOn(idea, 'builder').map((p) => p.name);
    let names: string[] = []; let typed = ''; let canAttend = u?.builderCanAttend === true; let basis: string[] | undefined;
    if (direct) {
      names = [...direct.builders]; basis = direct.basis;
      if (direct.canAttend !== undefined) canAttend = direct.canAttend;
    } else if (u?.builder?.trim()) {
      typed = showNames(u.builder, codes).replace(/[[\]]/g, '').trim();
      const people = [...idea.people.team.map((p) => p.name), idea.people.submitter ?? '', ...(await graphNow()).nodes.filter((n) => n.type === 'Person').map((n) => n.label)];
      for (const piece of splitNames(typed)) {
        const r = resolvePerson(piece, people);
        if (r.name && !names.some((n) => norm(n) === norm(r.name!))) names.push(r.name);
        else if (r.problem) opts.notes?.push(r.problem);
      }
    }
    // "Yes, they can attend" is about the builder the idea has.
    if (!names.length && canAttend && current.length) names = current;
    if (names.length) {
      const instead = current.filter((x) => !names.some((n) => norm(n) === norm(x)));
      const missing = names.filter((n) => !hasRole(personOn(idea, n), 'builder'));
      const tick = canAttend && !idea.checklist.s2e?.done;
      const said = typed && norm(typed) !== norm(names.join(', ')) ? typed : '';
      if (missing.length || instead.length || tick) {
        const label = missing.length || instead.length ? [
          `Make ${joinNames(names)} the builder${names.length > 1 ? 's' : ''}`,
          said ? ` (the answer says "${said}")` : '',
          instead.length ? ` instead of ${instead.join(' and ')}` : '',
          names.some((n) => !personOn(idea, n)) ? ' (adds them to the team)' : '',
          tick ? ', and tick "Builder named, can attend every session"' : '',
        ].join('') : `Tick "Builder named, can attend every session" (the answer says ${joinNames(names)} can attend)`;
        add({ key: `builder:${names.map(norm).join('+')}${tick && !missing.length && !instead.length ? ':attends' : ''}`, kind: 'builder', label, ...(basis ? { basis } : {}),
          builder: { name: names[0], ...(names.length > 1 ? { others: names.slice(1) } : {}), canAttend, ...(said ? { typed: said } : {}), ...(instead.length ? { instead } : {}) } });
      }
    }
  }
  if (u) {
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
      .filter((f) => f.answer.trim() && !have.some((h) => norm(h.answer) === norm(f.answer) || (sameQuestion(h.question, f.question) && norm(h.answer).replace(/\W/g, '') === norm(f.answer).replace(/\W/g, ''))))
      // A question answered already in the team's reply or another section's questions: the answer is on the idea.
      .filter((f) => !have.some((h) => h.source !== REVIEW_SOURCE && sameQuestion(h.question, f.question)));
    // One answer per question from your review: a newer one replaces the one before, it is not added beside it.
    const replacing = have.filter((h) => h.source === REVIEW_SOURCE && facts.some((f) => sameQuestion(f.question, h.question))).length;
    if (facts.length) {
      add({ key: `facts:${facts.map((f) => norm(f.answer)).join('|')}`, kind: 'facts', facts,
        label: `Save ${facts.length === 1 ? 'this answer' : `these ${facts.length} answers`} on the idea${replacing ? ` (in place of ${replacing} saved before)` : ''}, for the design series and later suggestions: ${facts.map((f) => f.answer).join(' · ')}` });
    }
    if (u.graph?.nodes?.length || u.graph?.links?.length) {
      const graph = await graphNow();
      const matcher = await starMatcher(root, (u.graph.nodes ?? []).map((n) => n.label), graph.nodes);
      // The same threshold as every AI read (settings graph.confirmAt): a link the AI is less sure of waits for Do it.
      const { links } = planAiLinks(idea.id, u.graph, graph, (await readAiLinks(root)).links, provider, { status: 'confirmed', nearest: matcher?.nearest, reuseAt: matcher?.thresholds.reuse, registry: await loadRegistry(root), confirmAt: confirmAt(await loadSettings(root).catch(() => ({}))) });
      const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label;
      for (const l of links) {
        const id = edgeId(l.from, l.rel, l.to);
        const fresh = new Map((l.newNodes ?? []).map((n) => [n.id, n]));
        const name = (nid: string) => fresh.get(nid)?.label ?? label(nid) ?? nid;
        const neu = [...fresh.values()].map((n) => `${n.label} (${NODE_LABELS[n.type as NodeType].toLowerCase()})`);
        add({ key: `link:${id}`, kind: 'link', link: { ...l, source: `ai:${provider}:review-answers` },
          label: `${name(l.from)} ${REL_WORDS[l.rel] ?? l.rel} ${name(l.to)}${neu.length ? `; adds a new star: ${neu.join(', ')}` : ''}${l.status === 'pending' ? ` (waits for your Do it in the universe: the AI is ${l.confidence} sure)` : ''}` });
      }
    }
  }
  let n = Math.max(0, ...before.map((x) => Number(/^u(\d+)$/.exec(x.id)?.[1] ?? 0)));
  return [...kept, ...out.map((x) => ({ ...x, id: `u${++n}` }) as PrepUpdate)];
}

/**
 * Applies one checked update to the idea (the builder, participation, a flag, the answers as facts, a graph link).
 * Every section that takes in answers does this by itself, right after the suggestion that proposed it
 * (applyAnswerUpdates). `source` is where saved answers and ticks say they came from.
 */
export async function applyUpdate(
  root: string, id: string, u: PrepUpdate, clock: Clock, opts: { by: 'operator' | 'app'; source: string },
): Promise<PrepUpdate['undo']> {
  const idea = await loadIdea(root, id) as WithAnswers;
  const steps = await loadSteps(root);
  const tickIf = async (step: string, ok: boolean): Promise<string[]> => {
    const now = await loadIdea(root, id);
    if (!ok || now.checklist[step]?.done) return [];
    await tick(root, id, step, true, { by: opts.by, source: opts.source, clock, steps });
    return [step];
  };
  if (u.kind === 'builder' && u.builder) {
    // The builders: the ones named take the role; anyone else who had it keeps their other roles.
    const set = [u.builder.name, ...(u.builder.others ?? [])];
    const before = idea.people.team;
    const named = (n: string) => set.some((x) => norm(x) === norm(n));
    let team = before;
    const removedRole = withRoleOn(idea, 'builder').map((p) => p.name).filter((n) => !named(n));
    for (const other of removedRole) team = withoutRole(team, other, 'builder');
    for (const n of set) team = withAddedRole(team, n, 'builder');
    await saveIdea(root, { ...idea, people: { ...idea.people, team } });
    const had = (n: string) => before.find((p) => norm(p.name) === norm(n));
    const ticked = await tickIf('s2e', u.builder.canAttend);
    return {
      addedRole: set.filter((n) => !hasRole(had(n), 'builder')), joined: set.filter((n) => !had(n)),
      ...(removedRole.length ? { removedRole } : {}), ...(ticked.length ? { ticked } : {}),
    };
  } else if (u.kind === 'participation' && u.participation) {
    // Keep what the form said, the first time the field changes.
    const first = idea.formWas?.participation === undefined && !!idea.participation;
    const formWas = first ? { ...idea.formWas, participation: idea.participation! } : idea.formWas;
    await saveIdea(root, { ...idea, participation: u.participation, ...(formWas ? { formWas } : {}) });
    return { participation: idea.participation ?? null, ...(first ? { formWas: true } : {}) };
  } else if (u.kind === 'flag' && u.flag) {
    await saveIdea(root, { ...idea, flags: idea.flags.filter((f) => f !== u.flag) });
    return { flag: u.flag };
  } else if (u.kind === 'facts' && u.facts) {
    const replaced = (idea.answers ?? []).filter((a) => a.source === opts.source && u.facts!.some((f) => sameQuestion(f.question, a.question)));
    const kept = (idea.answers ?? []).filter((a) => !replaced.includes(a));
    await saveIdea(root, { ...idea, answers: [...kept, ...u.facts.map((f) => ({ ...f, source: opts.source }))] } as Idea);
    // The team answered our questions: the reply is in.
    const ticked = await tickIf('s2d', !!(idea.sent?.E2 || idea.sent?.E2R));
    return { ...(replaced.length ? { replaced } : {}), ...(ticked.length ? { ticked } : {}) };
  } else if (u.kind === 'link' && u.link) {
    // As planned: confirmed only at or above the threshold; below it the link waits for the operator's Do it.
    const l = u.link as AiLink;
    const threshold = confirmAt(await loadSettings(root).catch(() => ({})));
    await appendAiLink(root, { ...l, status: l.status === 'pending' || l.confidence < threshold ? 'pending' : 'confirmed' });
    return { edgeId: edgeId(l.from, l.rel, l.to) };
  }
  return undefined;
}

/**
 * Takes back one applied update, exactly as far as it went (its `undo` record): the builder role it gave (and the
 * person, when it added them to the team and they have no other role), the builders it replaced, the "can attend"
 * tick, the participation and flag as they were, the answers it saved, the AI link it added. Something changed by hand
 * since is left as it is. Returns what was undone, in a few words.
 */
export async function undoUpdate(root: string, id: string, u: PrepUpdate, clock: Clock): Promise<string[]> {
  let idea = await loadIdea(root, id) as WithAnswers;
  const steps = await loadSteps(root);
  const said: string[] = [];
  const untick = async (step: string) => {
    if (!(await loadIdea(root, id)).checklist[step]?.done) return;
    await tick(root, id, step, false, { by: 'operator', source: 'answer taken back', clock, steps });
    if (step === 's2e') said.push('the "can attend" tick');
  };
  const x = u.undo ?? {};
  if (u.kind === 'builder' && u.builder) {
    // An older record has no undo record: the role it gave is the one marked as given after the form.
    const named = [u.builder.name, ...(u.builder.others ?? [])];
    const given = x.addedRole ?? named.filter((n) => personOn(idea, n)?.added?.includes('builder'));
    let team = idea.people.team;
    const gone: string[] = [];
    for (const n of given) {
      const p = team.find((t) => norm(t.name) === norm(n));
      if (!p?.roles.includes('builder')) continue;
      // Someone the answer added to the team, with no other role now, leaves the team again.
      if (x.joined?.some((j) => norm(j) === norm(n)) && p.roles.length === 1) team = team.filter((t) => t !== p);
      else team = withoutRole(team, p.name, 'builder');
      gone.push(p.name);
    }
    for (const n of x.removedRole ?? []) if (team.some((t) => norm(t.name) === norm(n))) team = addPerson(team, { name: n, roles: ['builder'] });
    if (gone.length || x.removedRole?.length) {
      await saveIdea(root, { ...idea, people: { ...idea.people, team } });
      if (gone.length) said.push(`${joinNames(gone)} as builder`);
      if (x.removedRole?.length) said.push(`${joinNames(x.removedRole)} back as builder`);
    }
    for (const step of x.ticked ?? (u.builder.canAttend ? ['s2e'] : [])) await untick(step);
  } else if (u.kind === 'participation' && u.participation) {
    if (idea.participation === u.participation) {
      const back = x.participation ?? idea.formWas?.participation;
      const { participation: _p, ...restWas } = idea.formWas ?? {};
      const formWas = x.formWas || back === idea.formWas?.participation ? restWas : idea.formWas;
      const { participation: _old, formWas: _fw, ...rest } = idea;
      await saveIdea(root, { ...rest, ...(back ? { participation: back } : {}), ...(formWas && Object.keys(formWas).length ? { formWas } : {}) } as Idea);
      said.push(`participation ${u.participation}${back ? ` (back to ${back})` : ''}`);
    }
  } else if (u.kind === 'flag' && u.flag) {
    if (!idea.flags.includes(u.flag)) { await saveIdea(root, { ...idea, flags: [...idea.flags, u.flag] }); said.push(`the flag "${u.flag}" is back`); }
  } else if (u.kind === 'facts' && u.facts) {
    const mine = (a: { question: string; answer: string; source?: string }) => a.source === REVIEW_SOURCE && u.facts!.some((f) => f.question === a.question && f.answer === a.answer);
    const left = (idea.answers ?? []).filter((a) => !mine(a));
    const n = (idea.answers ?? []).length - left.length;
    if (n || x.replaced?.length) {
      await saveIdea(root, { ...idea, answers: [...left, ...(x.replaced ?? [])] } as Idea);
      if (n) said.push(`${n} saved answer${n === 1 ? '' : 's'}`);
    }
  } else if (u.kind === 'link' && u.link) {
    // The AI link it added leaves ai-links.jsonl (that one statement, for this idea), so the graph and NetworkX lose it.
    const eid = x.edgeId ?? edgeId(u.link.from, u.link.rel as AiLink['rel'], u.link.to);
    const n = await updateAiLinks(root, (l) => (edgeId(l.from, l.rel, l.to) === eid && l.source === u.link!.source && (l.idea ?? id) === (u.link!.idea ?? id) ? [] : l));
    if (n) said.push('1 link');
  }
  idea = await loadIdea(root, id) as WithAnswers;
  return said;
}

/** "Alex Wang as builder, 2 links": what was undone, links counted. */
export function undoneWords(parts: string[]): string {
  const links = parts.filter((p) => p === '1 link').length;
  const rest = [...new Set(parts.filter((p) => p !== '1 link'))];
  return [...rest, ...(links ? [`${links} link${links === 1 ? '' : 's'}`] : [])].join(', ');
}

/**
 * Everything an answer led to, taken back: each applied update read from it (its basis holds the answer's words) is
 * undone and logged in the idea's history, and leaves the list (a later suggestion may make it again, from the answers
 * left). An older update with no basis is taken back when it is a builder the answer names. Returns what was undone.
 */
export async function undoFromAnswer(root: string, id: string, answer: string, clock: Clock, how: 'removed' | 'replaced'): Promise<string[]> {
  const k = norm(answer);
  if (!k) return [];
  const idea = await loadIdea(root, id);
  const from = (u: PrepUpdate) => u.status === 'applied' && (u.basis
    ? u.basis.some((b) => norm(b) === k)
    : u.kind === 'builder' && !!u.builder && [u.builder.name, u.builder.typed ?? ''].some((n) => n && k.includes(norm(n))));
  const hit = (idea.updates ?? []).filter(from);
  if (!hit.length) return [];
  const dir = await ideaDir(root, id);
  const said: string[] = [];
  for (const u of [...hit].reverse()) {
    try {
      const parts = await undoUpdate(root, id, u, clock);
      said.push(...parts);
      await appendHistory(dir, { at: clock(), action: 'answers-undone', by: 'operator', detail: `Undone, as its answer was ${how}: ${u.label}`, source: REVIEW_SOURCE });
    } catch (e) {
      await appendHistory(dir, { at: clock(), action: 'answers-undone', by: 'operator', detail: `Could not undo (${(e as Error).message}): ${u.label}`, source: REVIEW_SOURCE });
    }
  }
  const now = await loadIdea(root, id);
  const ids = new Set(hit.map((u) => u.id));
  await saveIdea(root, { ...now, updates: (now.updates ?? []).filter((u) => !ids.has(u.id)) });
  return said;
}

/** Each section's answers, as the idea's history names them. */
export const ANSWERS_OF: Record<UpdateSource, string> = {
  decision: 'decision answers', tools: 'tool answers', design: 'design answers', roadshow: 'roadshow answers', data: 'data answers',
};

/**
 * The updates one section's suggestion proposed (checked by planUpdates), applied by the code at once: no one says
 * yes to them. Each is logged in the idea's history (by the AI, with the section's answers as its source) and kept on
 * the idea as applied, for the read-only "Updated from your answers" list. One that cannot be applied is logged and
 * dropped. Returns the ones applied.
 */
export async function applyAnswerUpdates(root: string, id: string, from: UpdateSource, clock: Clock, source = REVIEW_SOURCE): Promise<PrepUpdate[]> {
  const waiting = ((await loadIdea(root, id)).updates ?? []).filter((u) => u.status === 'proposed' && sourceOf(u) === from);
  if (!waiting.length) return [];
  const at = clock();
  const dir = await ideaDir(root, id);
  const done = new Map<string, PrepUpdate>();
  const failed = new Set<string>();
  for (const u of waiting) {
    try {
      const undo = await applyUpdate(root, id, u, clock, { by: 'app', source });
      done.set(u.id, { ...u, status: 'applied', ...(undo ? { undo } : {}) });
      await appendHistory(dir, { at, action: 'answers-update', by: 'ai', detail: `Updated from the ${ANSWERS_OF[from]}: ${u.label}`, source: ANSWERS_OF[from] });
    } catch (e) {
      failed.add(u.id);
      await appendHistory(dir, { at, action: 'answers-update', by: 'ai', detail: `Not applied (${(e as Error).message}): ${u.label}`, source: ANSWERS_OF[from] });
    }
  }
  const now = await loadIdea(root, id);
  await saveIdea(root, { ...now, updates: (now.updates ?? []).filter((u) => !failed.has(u.id)).map((u) => done.get(u.id) ?? u) });
  return [...done.values()];
}

/**
 * The brief after an answer was taken back: gone when no answer is left (on the idea or pasted at review), else marked
 * out of date until the next Suggest or Re-evaluate rebuilds it.
 */
export function learnedAfter(idea: Idea & { answers?: unknown[] }): Pick<Idea, 'learned'> {
  if (!idea.learned) return {};
  const left = (idea.answers ?? []).length + (idea.prep?.needs ?? []).filter((n) => n.answer?.trim()).length;
  return left ? { learned: { ...idea.learned, stale: true } } : {};
}

export interface TakenBack {
  removed: true;
  /** What went with the answer, in a few words ("Alex Wang as builder, 1 link"). */
  undone: string;
  /** What became of the brief: "cleared", or "out of date" until it is rebuilt. */
  learned?: 'cleared' | 'out of date' | 'rebuilt';
}

/**
 * Take back one saved answer (wrong, out of date or a duplicate), with everything it led to: the builder and the tick
 * it set, participation and flags it changed, the answers saved from it and the AI links it added (undoFromAnswer).
 * With `next`, the answer is replaced by that text (same question, same source). Each step is logged in the history.
 */
export async function removeAnswer(root: string, id: string, question: string, answer: string, clock: Clock, next?: string): Promise<TakenBack> {
  const idea = await loadIdea(root, id) as WithAnswers;
  const list = idea.answers ?? [];
  const i = list.findIndex((a) => a.question === question && a.answer === answer);
  if (i < 0) throw new Error('That answer is gone already');
  const replacing = next?.trim() ? next.trim().slice(0, 4000) : '';
  if (replacing && replacing === answer.trim()) throw new Error('That is the answer already: change it before saving');
  const how = replacing ? 'replaced' : 'removed';
  const undone = await undoFromAnswer(root, id, answer, clock, how);
  const now = await loadIdea(root, id) as WithAnswers;
  const left = (now.answers ?? []).filter((a) => !(a.question === question && a.answer === answer));
  const answers = replacing ? [...left, { question, answer: replacing, ...(list[i].source ? { source: list[i].source } : {}) }] : left;
  const after = { ...now, answers } as WithAnswers;
  const { learned: _l, ...rest } = after;
  const brief = learnedAfter(after);
  await saveIdea(root, { ...rest, ...brief } as Idea);
  await appendHistory(await ideaDir(root, id), {
    at: clock(), action: replacing ? 'answer-replaced' : 'answer-removed', by: 'operator',
    detail: replacing ? `Answer replaced: ${answer} → ${replacing}` : `Answer removed: ${answer}`, ...(list[i].source ? { source: list[i].source } : {}),
  });
  return { removed: true, undone: undoneWords(undone), ...(now.learned ? { learned: brief.learned ? 'out of date' : 'cleared' } : {}) };
}

/** The line the page shows after a remove or a replace: "Removed: Alex Wang as builder, 1 link; the learned brief was rebuilt". */
export function takenBackLine(how: 'removed' | 'replaced', t: Pick<TakenBack, 'undone' | 'learned'>): string {
  const head = how === 'replaced' ? 'Answer replaced' : 'Answer removed';
  const brief = t.learned === 'rebuilt' ? 'the learned brief was rebuilt' : t.learned === 'cleared' ? 'the learned brief was cleared (no answers left)'
    : t.learned === 'out of date' ? 'the learned brief is out of date: Re-evaluate to rebuild it' : '';
  return `${head}. ${t.undone ? `Undone: ${t.undone}` : 'Nothing else came from it'}${brief ? `; ${brief}` : ''}.`;
}

/**
 * What a suggestion read in the answers, taken into the idea: its updates (checked, on the one list every section
 * shares, to be applied by applyAnswerUpdates once these fields are saved) and its brief of what the answers add.
 * Returns the fields to save on the idea; a suggestion that wrote no brief keeps the one there.
 */
export async function takeInAnswers(
  root: string, idea: WithAnswers, out: { updates?: ReviewUpdates; learned?: { topic: string; text: string }[] },
  codes: Map<string, Coded>, provider: string, at: string, read: number, from: UpdateSource = 'decision', opts: PlanOptions = {},
): Promise<Pick<Idea, 'updates' | 'learned'>> {
  const updates = await planUpdates(root, idea, out.updates, codes, provider, idea.updates, from, opts);
  const points = (out.learned ?? []).map((p) => ({ topic: p.topic.trim(), text: showNames(p.text, codes).trim() })).filter((p) => p.topic && p.text);
  const learned = points.length ? { at, provider, from: read, points } : idea.learned;
  // An emptied list is saved empty, so a waiting proposal that went does not linger.
  return { ...(updates.length || idea.updates?.length ? { updates } : {}), ...(learned ? { learned } : {}) };
}
