import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import type { Clock } from '../clock';
import type { AddRoute } from './server';
import { dataKey, paths } from '../workspace/paths';
import { loadSteps, STAGE_NAMES } from '../rules/stages';
import { ROUND_FIELDS, SETTING_FIELDS } from '../round/round';
import { listRoundsChecked, createRound, saveRound, setIdeaRound, assignIdeas, loadSettings, saveSettings } from '../round/store';
import { listIdeas, ideaDir, loadIdea } from '../ideas/store';
import { CLOSURE_LABELS } from '../ideas/idea';
import { tick } from '../checklist/checklist';
import { setStage } from '../ideas/stage';
import { writeFileAtomic, readHistory } from '../workspace/files';
import { importExport } from '../import/importRows';
import { draftEmail, listOutboxChecked, approve, markSent, updateDraft, openEmail, unopenEmail, listOutbox } from '../comms/outbox';
import { openFolder } from '../workspace/reveal';
import { suggestPrep, answerNeed, draftNeedsEmail, markAsked, unmarkAsked } from '../review/prep';
import { saveReview, writeReviewPack, CRITERIA, DECISION_LABELS, type ReviewInput } from '../review/review';
import { overdue, needsE2R } from '../reminders/due';
import { rebuildGraph, setAiLinkStatus, readAiLinks, appendAiLink } from '../graph/store';
import { layoutFor } from '../graph/layout';
import { createConnector, defaultProviders, saveAiProvider, type Connector } from '../ai/connector';
import { extractTask, reviewSuggestTask, pingTask, toolPickTask, designStepTask, designPlanTask } from '../ai/tasks';
import { readDesign, renderDesignMd } from '../design/store';
import { saveToolPicks, toolPickInput, mergeSuggestions , askToolQuestions, clearToolQuestions } from '../design/tools';
import {
  applyDesignEvent, approveDesign, askTeam, assertNoOpenStep, designStepInput, isDone, stepEvent, DesignError, SUMMARY_MAX,
} from '../design/brainstorm';
import { designPlanInput, writePlan, readPlan, NOT_APPROVED, PLAN_NEEDS_AI } from '../design/kits';
import { extractInput, planAiLinks } from '../ai/apply';
import { growIdea } from '../ai/grow';
import { reviewInput } from '../review/suggestInput';
import { showNames } from '../command/names';
import { listThreads, readThread, runCommand, doActions, cancelActions, undoChatAction } from '../command/chat';
import { checkProposals, type ConflictContext } from '../inbox/conflicts';
import { edgeId, APPROVED_TOOLS } from '../graph/ontology';
import {
  processDrop, applyRecords, undoRecord, chooseIdea, dismissItem, deleteItem, draftHeldReply, inboxView, reprocessItem, dropRecord, viewOf, type Resolve,
} from '../inbox/flow';


/**
 * The file name from the x-filename header. The UI sends it percent-encoded (headers carry Latin-1 only);
 * a raw name that isn't valid encoding is kept as given. Any folder part is dropped.
 */
export function fileNameOf(header: unknown): string {
  const sent = String(header ?? '');
  let decoded = sent;
  try { decoded = decodeURIComponent(sent); } catch { /* not encoded */ }
  return path.basename(decoded.replace(/\\/g, '/'));
}
export function registerApi(add: AddRoute, { root, clock, connector }: { root: string; clock: Clock; connector?: Connector }): void {
  const steps = () => loadSteps(root);
  const ai = connector ?? createConnector({ providers: defaultProviders(), settings: () => loadSettings(root) });
  /** AI failures never change anything; they tell the operator to carry on by hand. */
  const byHand = <T>(fn: () => Promise<T>) => async () => {
    try { return await fn(); } catch (e) { throw new Error(`Working by hand: ${(e as Error).message}`); }
  };

  add('GET', '/api/state', async () => {
    const [{ rounds, problems: roundProblems }, settings, st, list, { items: outbox, problems: outboxProblems }] = await Promise.all([
      listRoundsChecked(root), loadSettings(root), steps(), listIdeas(root), listOutboxChecked(root),
    ]);
    const today = clock();
    return {
      today, workspace: root, dataFolder: paths(root).data, rounds, roundProblems, settings, steps: st, stageNames: STAGE_NAMES, closures: CLOSURE_LABELS, problems: list.problems, outboxProblems,
      ideas: list.ideas.map((i) => {
        const late = overdue(i, st, today);
        return {
          ...i,
          overdue: late,
          offerE2R: needsE2R(late) && !outbox.some((m) => m.idea === i.id && m.template === 'E2R' && m.status !== 'sent'),
        };
      }),
      outbox,
      criteria: CRITERIA,
      decisions: DECISION_LABELS,
      fields: { round: ROUND_FIELDS, settings: SETTING_FIELDS },
      approvedTools: APPROVED_TOOLS,
    };
  });

  // The command bar: the operator's own instructions. The AI proposes; nothing changes until the operator says "Do it".
  // The Café assistant: conversations, and one message at a time (streamed when the client asks for progress).
  add('GET', '/api/chat', async () => {
    const threads = await listThreads(root);
    return { threads, current: threads[0] ? await readThread(root, threads[0].id) : { thread: null, entries: [] } };
  });
  add('GET', '/api/chat/threads/:id', async ({ params }) => readThread(root, params.id));
  add('POST', '/api/chat', async ({ body, progress, stopped }) => runCommand(root, String(body.text ?? ''), ai, clock, {
    focus: Array.isArray(body.focus) ? body.focus.slice(0, 30).map(String) : body.focus ? String(body.focus) : undefined,
    mentions: Array.isArray(body.mentions) ? body.mentions.slice(0, 20).map(String) : [],
    thread: body.thread ? String(body.thread) : undefined,
    progress, stopped,
  }));
  add('POST', '/api/chat/:id/do', async ({ params, body }) => doActions(root, params.id, body.actionId ? String(body.actionId) : undefined, clock, ai));
  add('POST', '/api/chat/:id/cancel', async ({ params, body }) => cancelActions(root, params.id, body.actionId ? String(body.actionId) : undefined));
  add('POST', '/api/chat/:id/undo', async ({ params, body }) => undoChatAction(root, params.id, String(body.actionId ?? ''), clock));

  add('GET', '/api/rounds', async () => {
    const [{ rounds, problems }, { ideas }] = await Promise.all([listRoundsChecked(root), listIdeas(root)]);
    return { rounds: rounds.map((r) => ({ ...r, ideas: ideas.filter((i) => i.round === r.id).length })), problems };
  });
  add('POST', '/api/rounds', async ({ body }) => createRound(root, String(body.name ?? ''), clock));
  add('POST', '/api/rounds/:id', async ({ params, body }) => saveRound(root, params.id, body));
  add('POST', '/api/rounds/:id/ideas', async ({ params, body }) => {
    const ids = body.ideaIds;
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) throw new Error('Pick the ideas to put in the round');
    return { updated: await assignIdeas(root, params.id, ids, clock) };
  });
  add('POST', '/api/ideas/:id/round', async ({ params, body }) => setIdeaRound(root, params.id, String(body.round ?? ''), clock));
  add('POST', '/api/settings', async ({ body }) => saveSettings(root, body));
  // Project configuration: show the workspace (the data folder) in Finder or File Explorer, on this computer.
  add('POST', '/api/workspace/open', async () => {
    const { data } = paths(root);
    await mkdir(data, { recursive: true });
    await openFolder(data);
    return { folder: data };
  });

  add('POST', '/api/import', async ({ raw, headers }) => {
    const name = fileNameOf(headers['x-filename']);
    if (!/\.(csv|xlsx)$/i.test(name)) throw new Error('Drop a .csv or .xlsx export');
    const file = path.join(paths(root).inbox, `${clock()}-${name}`);
    await writeFileAtomic(file, raw);
    return importExport(root, file, { clock, steps: await steps() });
  });

  add('POST', '/api/ideas/:id/tick', async ({ params, body }) =>
    tick(root, params.id, String(body.step), body.done === true, { by: 'operator', clock, steps: await steps() }));
  add('POST', '/api/ideas/:id/stage', async ({ params, body }) => setStage(root, params.id, body as never, clock));
  add('POST', '/api/ideas/:id/reply', async ({ params }) =>
    tick(root, params.id, 's2d', true, { by: 'operator', source: 'reply received', clock, steps: await steps() }));
  add('GET', '/api/ideas/:id/history', async ({ params }) => readHistory(await ideaDir(root, params.id)));
  add('POST', '/api/ideas/:id/review', async ({ params, body }) =>
    saveReview(root, params.id, body as ReviewInput, { clock, steps: await steps() }));
  add('POST', '/api/ideas/:id/draft', async ({ params, body }) =>
    draftEmail(root, { template: String(body.template), ideaId: params.id }, clock));
  add('POST', '/api/round/draft', async ({ body }) => draftEmail(root, { template: String(body.template) }, clock));
  // A round's own emails (the call for ideas and the deadline reminder), from Rounds: drafted for that round, opened in Outlook.
  add('POST', '/api/rounds/:id/email-open', async ({ params, body }) => {
    const template = String(body.template);
    if (template !== 'E0' && template !== 'E0B') throw new Error('Rounds send the call for ideas (E0) and the deadline reminder (E0B)');
    const rec = await draftEmail(root, { template, round: params.id }, clock);
    return openEmail(root, rec.key, clock, await steps());
  });

  add('POST', '/api/outbox/approve', async ({ body }) => approve(root, String(body.key), clock));
  add('POST', '/api/outbox/sent', async ({ body }) => markSent(root, String(body.key), clock, await steps()));
  add('POST', '/api/outbox/open', async ({ body }) => openEmail(root, String(body.key), clock, await steps()));
  add('POST', '/api/outbox/unopen', async ({ body }) => {
    const before = (await listOutbox(root)).find((m) => m.key === String(body.key));
    const out = await unopenEmail(root, String(body.key), clock);
    if (before?.idea && before.template === 'E2' && before.sentAt) await unmarkAsked(root, before.idea, before.sentAt);
    return out;
  });
  add('POST', '/api/outbox/update', async ({ body }) => updateDraft(root, String(body.key), body));

  add('POST', '/api/review-pack', async () => ({ file: await writeReviewPack(root, clock) }));
  add('GET', '/api/graph', async () => {
    const graph = await rebuildGraph(root);
    const layout = await layoutFor(root, graph);
    return { ...graph, layout, unconfirmed: graph.edges.filter((e) => !e.confirmed).length };
  });
  add('POST', '/api/graph/confirm', async ({ body }) => { await setAiLinkStatus(root, String(body.edgeId), 'confirmed'); return { ok: true }; });
  add('POST', '/api/graph/remove', async ({ body }) => { await setAiLinkStatus(root, String(body.edgeId), 'removed'); return { ok: true }; });

  add('GET', '/api/ai/status', async () => ({ ...(await ai.status()), choices: await ai.choices() }));
  add('POST', '/api/ai/provider', async ({ body }) => {
    const settings = await saveAiProvider(root, body.provider);
    return { ...(await ai.status()), choice: settings.ai?.provider };
  });
  add('POST', '/api/ai/test', async () => byHand(async () => {
    const t0 = Date.now();
    const { provider, label } = await ai.runWith(pingTask, {}, { timeoutMs: 30_000 });
    return { ok: true, provider, label, ms: Date.now() - t0 };
  })());
  add('POST', '/api/ai/extract', async ({ body }) => byHand(() => growIdea(root, ai, String(body.id)))());
  // Suggest a decision with its to-do list, or re-evaluate both: everything the idea now holds (email answers, what the
  // operator pasted, a builder, flags, its graph links) is read; names are coded on the way out and restored on the way back.
  add('POST', '/api/ai/review-suggest', async ({ body }) => byHand(() =>
    suggestPrep(root, String(body.id), (input) => ai.runWith(reviewSuggestTask, input), clock))());
  add('POST', '/api/ideas/:id/prep/answer', async ({ params, body }) => answerNeed(root, params.id, String(body.need ?? ''), body.answer));
  // Draft email: the open to-dos become the questions email (E2), opened in Outlook and counted as sent.
  add('POST', '/api/ideas/:id/prep/email', async ({ params }) => {
    const rec = await draftNeedsEmail(root, params.id, clock);
    const out = await openEmail(root, rec.key, clock, await steps());
    await markAsked(root, params.id, out.email.sentAt ?? clock());
    return out;
  });
  // Any of an idea's emails, from the header's Email menu: drafted if need be, then opened in Outlook.
  add('POST', '/api/ideas/:id/email-open', async ({ params, body }) => {
    const rec = await draftEmail(root, { template: String(body.template), ideaId: params.id }, clock);
    return openEmail(root, rec.key, clock, await steps());
  });
  // Design series: the tool picker. The AI only suggests; the operator's save is what counts.
  add('GET', '/api/ideas/:id/design', async ({ params }) => {
    const idea = await loadIdea(root, params.id);
    const state = await readDesign(root, idea.id);
    const folder = `data/${dataKey(root, await ideaDir(root, idea.id))}`;
    return { state, designMd: renderDesignMd(idea, state), folder };
  });
  add('POST', '/api/ideas/:id/tools/suggest', async ({ params }) => {
    const idea = await loadIdea(root, params.id);
    const state = await readDesign(root, idea.id);
    return byHand(async () => {
      const { provider, output } = await ai.runWith(toolPickTask, toolPickInput(idea, state));
      // Not enough in the form: every question goes to the team in one E2 draft; nothing is suggested.
      if (output.questions?.length) return { ...(await askToolQuestions(root, idea, output.questions, clock)), provider };
      return { features: mergeSuggestions(state.features, output.pick ? [output.pick] : []), provider };
    })();
  });
  add('POST', '/api/ideas/:id/tools/questions/clear', async ({ params }) => ({ state: await clearToolQuestions(root, params.id) }));
  add('POST', '/api/ideas/:id/tools', async ({ params, body }) => {
    const { state, designFile } = await saveToolPicks(root, params.id, body.features, { clock, steps: await steps() });
    return { state, designMd: await readFile(designFile, 'utf8') };
  });
  // Design series: the brainstorm. One question at a time; every change re-renders design.md and the Café check.
  add('POST', '/api/ideas/:id/design/step', async ({ params, body }) => {
    const idea = await loadIdea(root, params.id);
    const state = await readDesign(root, idea.id);
    if (body.question !== undefined) {
      // A hand-written question, for when no AI is available.
      if (typeof body.question !== 'string' || !body.question.trim()) throw new DesignError('Write the question first');
      assertNoOpenStep(state);
      const suggested = Array.isArray(body.suggested) ? body.suggested.filter((x: unknown) => typeof x === 'string') : [];
      const out = await applyDesignEvent(root, idea, { t: 'step', question: String(body.question), suggested, source: 'operator' }, clock);
      return { ...out, step: out.state.steps[out.state.steps.length - 1] };
    }
    if (isDone(state)) return { state, designMd: renderDesignMd(idea, state) };
    assertNoOpenStep(state);
    const { output } = await byHand(() => ai.runWith(designStepTask, designStepInput(idea, state)))();
    const out = await applyDesignEvent(root, idea, stepEvent(output), clock);
    return output.done ? out : { ...out, step: out.state.steps[out.state.steps.length - 1] };
  });
  add('POST', '/api/ideas/:id/design/answer', async ({ params, body }) => {
    const idea = await loadIdea(root, params.id);
    const n = Number(body.n);
    const given = [typeof body.answer === 'string', body.suggestedIndex !== undefined, body.idk === true].filter(Boolean).length;
    if (given !== 1) throw new DesignError('Send one of: an answer, a suggested answer or "I don\'t know"');
    if (body.idk === true) return askTeam(root, idea, n, clock);
    if (typeof body.answer === 'string') return applyDesignEvent(root, idea, { t: 'answer', n, answer: body.answer, source: 'operator' }, clock);
    const step = (await readDesign(root, idea.id)).steps.find((s) => s.n === n);
    if (!step) throw new DesignError(`No question ${n}`);
    const i = Number(body.suggestedIndex);
    if (!Number.isInteger(i) || i < 0 || i >= step.suggested.length) throw new DesignError('Pick one of the suggested answers');
    return applyDesignEvent(root, idea, { t: 'answer', n, answer: step.suggested[i], source: 'ai-suggested' }, clock);
  });
  // The hand path to a finished design (no AI): the operator writes the summary, as the AI's done reply would.
  add('POST', '/api/ideas/:id/design/finish', async ({ params, body }) => {
    const idea = await loadIdea(root, params.id);
    const summary = typeof body.summary === 'string' ? body.summary.replace(/\s+/g, ' ').trim() : '';
    if (!summary) throw new DesignError('Write the summary first');
    if (summary.length > SUMMARY_MAX) throw new DesignError(`Keep the summary to ${SUMMARY_MAX} characters`);
    return applyDesignEvent(root, idea, { t: 'done', summary }, clock);
  });
  add('POST', '/api/ideas/:id/design/approve', async ({ params }) => approveDesign(root, params.id, clock));
  // Design series: plan.md and the starter kits, from an approved design. The kits are templates; the app writes no code.
  add('POST', '/api/ideas/:id/plan', async ({ params }) => {
    const idea = await loadIdea(root, params.id);
    const state = await readDesign(root, idea.id);
    if (!state.approvedAt) throw new DesignError(NOT_APPROVED);
    let output;
    try { ({ output } = await ai.runWith(designPlanTask, designPlanInput(idea, state))); } catch { throw new DesignError(PLAN_NEEDS_AI); }
    const { files } = await writePlan(root, idea, state, output);
    return { files };
  });
  add('GET', '/api/ideas/:id/plan', async ({ params }) => readPlan(root, params.id));
  // Import. Every POST runs behind the server's lock; a drop triages and applies the Safe actions in one request.
  add('GET', '/api/inbox', async () => inboxView(root));
  add('POST', '/api/inbox/drop', async ({ body, raw, headers }) => {
    if (headers['x-filename'] !== undefined) {
      const name = fileNameOf(headers['x-filename']);
      if (!name) throw new Error('The file needs a name');
      if (!raw.length) throw new Error('Nothing was dropped');
      return processDrop(root, name, new Uint8Array(raw), ai, clock);
    }
    const text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) throw new Error('Paste something first');
    const name = typeof body.name === 'string' && body.name.trim() ? path.basename(body.name.trim()) : 'Pasted note';
    return processDrop(root, name, text, ai, clock);
  });
  add('POST', '/api/inbox/:id/apply', async ({ params, body }) => {
    const ids = Array.isArray(body.actionIds) ? body.actionIds.map(String) : [];
    const resolve = body.resolve ?? {};
    if (typeof resolve !== 'object' || Array.isArray(resolve) || Object.values(resolve).some((v) => v !== 'use-existing' && v !== 'take-file')) {
      throw new Error('Unknown resolve');
    }
    return { item: await applyRecords(root, params.id, ids, clock, resolve as Record<string, Resolve>) };
  });
  // With an idea: the same checks as a pick (the idea exists, nothing applied yet).
  add('POST', '/api/inbox/:id/process', async ({ params, body }) =>
    ({ item: viewOf(body.ideaId ? await chooseIdea(root, params.id, String(body.ideaId), ai, clock) : await reprocessItem(root, params.id, ai, clock)) }));
  add('POST', '/api/inbox/:id/dismiss-action', async ({ params, body }) =>
    ({ item: viewOf(await dropRecord(root, params.id, String(body.actionId ?? ''))) }));
  add('POST', '/api/inbox/:id/undo', async ({ params, body }) => {
    const recordId = String(body.recordId ?? '');
    const item = await undoRecord(root, params.id, recordId, clock);
    const note = (item.actions as { id: string; note?: string }[] | undefined)?.find((r) => r.id === recordId)?.note;
    return note ? { item, note } : { item };
  });
  add('POST', '/api/inbox/:id/choose', async ({ params, body }) => ({ item: await chooseIdea(root, params.id, String(body.ideaId ?? ''), ai, clock) }));
  add('POST', '/api/inbox/:id/dismiss', async ({ params }) => ({ item: await dismissItem(root, params.id) }));
  add('POST', '/api/inbox/:id/delete', async ({ params }) => deleteItem(root, params.id));
  add('POST', '/api/inbox/:id/draft-held-reply', async ({ params, body }) =>
    draftHeldReply(root, params.id, clock, typeof body.ideaId === 'string' ? body.ideaId : undefined));

}
