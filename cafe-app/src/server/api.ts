import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import type { Clock } from '../clock';
import type { AddRoute } from './server';
import { dataKey, paths } from '../workspace/paths';
import { loadSteps, STAGE_NAMES } from '../rules/stages';
import { ROUND_FIELDS, SETTING_FIELDS } from '../round/round';
import { listRoundsChecked, createRound, saveRound, setIdeaRound, assignIdeas, loadSettings, saveSettings } from '../round/store';
import { listIdeas, ideaDir, loadIdea, saveIdea } from '../ideas/store';
import { CLOSURE_LABELS } from '../ideas/idea';
import { tick } from '../checklist/checklist';
import { setStage } from '../ideas/stage';
import { writeFileAtomic, readHistory, readText, appendHistory } from '../workspace/files';
import { importExport } from '../import/importRows';
import { draftEmail, listOutboxChecked, approve, markSent, updateDraft, openEmail, unopenEmail, listOutbox } from '../comms/outbox';
import { openFolder, openEmailFile } from '../workspace/reveal';
import { decideUpdate, removeAnswer, takeInAnswers } from '../review/updates';
import { suggestPrep, answerNeed, draftNeedsEmail, markAsked, unmarkAsked } from '../review/prep';
import { saveReview, CRITERIA, DECISION_LABELS, type ReviewInput } from '../review/review';
import { overdue, needsE2R } from '../reminders/due';
import { rebuildGraph, setAiLinkStatus, readAiLinks, appendAiLink } from '../graph/store';
import { appendEdit, nextEditId } from '../graph/operator';
import { layoutFor } from '../graph/layout';
import { createConnector, defaultProviders, saveAiProvider, type Connector } from '../ai/connector';
import { extractTask, reviewSuggestTask, pingTask, toolPickTask, featureListTask, designStepTask, designPlanTask, designDiagramTask, designKitTask, roadshowPrepTask, roadshowDeckTask, dataStepTask, type DesignKitOutput } from '../ai/tasks';
import { applyFeatureChanges } from '../design/scope';
import { readDesign, renderDesignMd, writeDesign } from '../design/store';
import { saveToolPicks, similarStars, suggestTools, suggestFeatures, answerToolNeed, draftToolNeedsEmail, markToolAsked } from '../design/tools';
import {
  applyDesignEvent, approveDesign, askTeam, assertNoOpenStep, codedDesignInput, decodeStep, drawDiagram, isDone, redesign, stepEvent, DesignError, SUMMARY_MAX,
} from '../design/brainstorm';
import { writePlan, readPlan, NOT_APPROVED, PLAN_NEEDS_AI, KIT_NO_AI } from '../design/kits';
import { codedKitInput, codedPlanInput, decodeKit, decodePlan } from '../design/kitInput';
import { extractInput, planAiLinks } from '../ai/apply';
import { suggestRoadshowPrep, answerRoadshowNeed, draftRoadshowNeedsEmail, markRoadshowAsked } from '../roadshow/prep';
import { setPhotoFromPath, setPhotoFromUpload, removePhoto } from '../roadshow/photos';
import { buildDeck, redrawDeck } from '../roadshow/deck';
import { diagramReply } from '../design/diagramFile';
import { roadshowView, deckFile, photoFile } from '../roadshow/view';
import { growIdea } from '../ai/grow';
import { dropDataFile, editDataFile, releaseDataFile, removeDataFile, runDataFile, setDataKind, type DataProgress } from '../data/understand';
import { addDataQuestion, answerDataStep, confirmData, finishDataByHand, nextDataStep } from '../data/questions';
import { reviewInput } from '../review/suggestInput';
import { showNames } from '../command/names';
import { listThreads, readThread, runCommand, doActions, cancelActions, undoChatAction } from '../command/chat';
import { checkProposals, type ConflictContext } from '../inbox/conflicts';
import { edgeId, APPROVED_TOOLS, MERGEABLE, retiredToolNote } from '../graph/ontology';
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
/** The files the design pack may show: the design, the approach, the plan, the kit and the roadshow's script and run of show. */
const DESIGN_FILE = /^(design\.md|design-diagram\.html|approach\.md|plan\.md|roadshow\/(script|run-of-show)\.md|kit\/[\w .()-]+(\/[\w .()-]+)*\.(md|txt|json|yaml|csv|html))$/;

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

  /**
   * Opens an email in Outlook from this computer: its draft file (.eml, marked unsent) is written under
   * data/exports/outlook and handed to Outlook, nothing is downloaded. If Outlook can't open it, an email this click
   * counted as sent goes back to unsent. CAFE_NO_OUTLOOK=1 (tests, the UI tour) writes the file and opens nothing.
   */
  const inOutlook = async (key: string, open: () => Promise<Awaited<ReturnType<typeof openEmail>>>) => {
    const wasSent = (await listOutbox(root)).find((m) => m.key === key)?.status === 'sent';
    const out = await open();
    const dir = path.join(paths(root).exports, 'outlook');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, out.filename.replace(/\.eml$/i, `-${Date.now()}.eml`));
    try {
      await writeFileAtomic(file, out.eml);
      if (process.env.CAFE_NO_OUTLOOK !== '1') await openEmailFile(file);
    } catch (e) {
      if (!wasSent) await unopenEmail(root, key, clock);
      throw e;
    }
    const { eml: _eml, ...rest } = out;
    return { ...rest, file: `data/${dataKey(root, file)}` };
  };

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
    return inOutlook(rec.key, async () => openEmail(root, rec.key, clock, await steps()));
  });

  add('POST', '/api/outbox/approve', async ({ body }) => approve(root, String(body.key), clock));
  add('POST', '/api/outbox/sent', async ({ body }) => markSent(root, String(body.key), clock, await steps()));
  add('POST', '/api/outbox/open', async ({ body }) => inOutlook(String(body.key), async () => openEmail(root, String(body.key), clock, await steps())));
  add('POST', '/api/outbox/unopen', async ({ body }) => {
    const before = (await listOutbox(root)).find((m) => m.key === String(body.key));
    const out = await unopenEmail(root, String(body.key), clock);
    if (before?.idea && before.template === 'E2' && before.sentAt) {
      await unmarkAsked(root, before.idea, before.sentAt);
      await markToolAsked(root, before.idea, before.sentAt, false);
      await markRoadshowAsked(root, before.idea, before.sentAt, false);
    }
    return out;
  });
  add('POST', '/api/outbox/update', async ({ body }) => updateDraft(root, String(body.key), body));

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
  // What the answers would change (a builder, participation, a flag, the answers, graph links): Yes, No or Undo, one at a time.
  add('POST', '/api/ideas/:id/prep/update', async ({ params, body }) => decideUpdate(root, params.id, String(body.update ?? ''), body.do, clock));
  // Take back one saved answer (a wrong or duplicate one) from the Submission's "Learned since the form".
  add('POST', '/api/ideas/:id/answers/remove', async ({ params, body }) => removeAnswer(root, params.id, String(body.question ?? ''), String(body.answer ?? ''), clock));
  add('POST', '/api/ideas/:id/prep/answer', async ({ params, body }) => answerNeed(root, params.id, String(body.need ?? ''), body.answer));
  // Draft email: the open to-dos become the questions email (E2), opened in Outlook and counted as sent.
  add('POST', '/api/ideas/:id/prep/email', async ({ params }) => {
    const rec = await draftNeedsEmail(root, params.id, clock);
    const out = await inOutlook(rec.key, async () => openEmail(root, rec.key, clock, await steps()));
    await markAsked(root, params.id, out.email.sentAt ?? clock());
    return out;
  });
  // Any of an idea's emails, from the header's Email menu: drafted if need be, then opened in Outlook.
  add('POST', '/api/ideas/:id/email-open', async ({ params, body }) => {
    const rec = await draftEmail(root, { template: String(body.template), ideaId: params.id }, clock);
    return inOutlook(rec.key, async () => openEmail(root, rec.key, clock, await steps()));
  });
  // Design series, first: "Understand the data". A dropped file runs Read → Check → Profile → Understand → Saved, its
  // step cards streamed as it goes (Accept: application/x-ndjson); every reply is the design as it now is.
  const designNow = async (id: string, extra: Record<string, unknown> = {}) => {
    const idea = await loadIdea(root, id);
    const state = await readDesign(root, id);
    return { state, designMd: renderDesignMd(idea, state), ...extra };
  };
  const aiOrNull = async () => ((await ai.status()).provider ? ai : null);
  const fileProgress = (progress?: (e: unknown) => void): DataProgress | undefined => (progress ? (e) => progress({ file: e.file }) : undefined);
  add('POST', '/api/ideas/:id/data/drop', async ({ params, raw, headers, progress }) => {
    const name = fileNameOf(headers['x-filename']);
    if (!name) throw new Error('The file needs a name');
    const file = await dropDataFile(root, params.id, name, new Uint8Array(raw), String(headers['x-kind'] ?? ''), await aiOrNull(), clock, fileProgress(progress));
    return designNow(params.id, { file });
  });
  // "It is masked / synthetic — continue": a held file goes on from the profile, its flagged columns still masked.
  add('POST', '/api/ideas/:id/data/:fid/release', async ({ params, progress }) =>
    designNow(params.id, { file: await releaseDataFile(root, params.id, params.fid, await aiOrNull(), clock, fileProgress(progress)) }));
  add('POST', '/api/ideas/:id/data/:fid/understand', async ({ params, progress }) =>
    designNow(params.id, { file: await runDataFile(root, params.id, params.fid, 'understand', await aiOrNull(), clock, fileProgress(progress)) }));
  add('POST', '/api/ideas/:id/data/:fid/read', async ({ params, progress }) =>
    designNow(params.id, { file: await runDataFile(root, params.id, params.fid, 'read', await aiOrNull(), clock, fileProgress(progress)) }));
  add('POST', '/api/ideas/:id/data/:fid/kind', async ({ params, body }) => { await setDataKind(root, params.id, params.fid, body.kind); return designNow(params.id); });
  add('POST', '/api/ideas/:id/data/:fid/edit', async ({ params, body }) => { await editDataFile(root, params.id, params.fid, body, clock); return designNow(params.id); });
  add('POST', '/api/ideas/:id/data/:fid/remove', async ({ params }) => { await removeDataFile(root, params.id, params.fid, clock); return designNow(params.id); });
  // The data questions: the next one from the AI (or a hand-written one), an answer, the hand summary, the confirmation.
  add('POST', '/api/ideas/:id/data/step', async ({ params, body }) => {
    if (body.question !== undefined) { const { out } = await addDataQuestion(root, params.id, body); return designNow(params.id, { step: out }); }
    const r = await byHand(() => nextDataStep(root, params.id, (input) => ai.runWith(dataStepTask, input), clock))();
    return designNow(params.id, { ...(r.step ? { step: r.step } : {}), ...(r.done ? { done: true } : {}), applied: r.applied.map((u) => u.label) });
  });
  add('POST', '/api/ideas/:id/data/answer', async ({ params, body }) => { const r = await answerDataStep(root, params.id, body, clock); return designNow(params.id, 'emailKey' in r ? { emailKey: r.emailKey } : {}); });
  add('POST', '/api/ideas/:id/data/finish', async ({ params, body }) => { await finishDataByHand(root, params.id, body.summary, clock); return designNow(params.id); });
  add('POST', '/api/ideas/:id/data/confirm', async ({ params }) => { await confirmData(root, params.id, clock); return designNow(params.id); });
  // Design series: the tool picker. The AI only suggests; the operator's save is what counts.
  add('GET', '/api/ideas/:id/design', async ({ params }) => {
    const idea = await loadIdea(root, params.id);
    const state = await readDesign(root, idea.id);
    const folder = `data/${dataKey(root, await ideaDir(root, idea.id))}`;
    return { state, designMd: renderDesignMd(idea, state), folder };
  });
  // Suggest with AI, or Re-evaluate: the pick it can stand behind and the to-do list of what it still needs, as the decision's.
  // With `tool`, the operator's own tool is evaluated for the features sent (the AI may not change it).
  add('POST', '/api/ideas/:id/tools/suggest', async ({ params, body }) => byHand(() =>
    suggestTools(root, params.id, (input) => ai.runWith(toolPickTask, input), clock, { features: body.features, tool: body.tool }))());
  // Suggest features with AI: new names only, merged after the rows sent; nothing saved until Save.
  add('POST', '/api/ideas/:id/tools/features/suggest', async ({ params, body }) => byHand(() =>
    suggestFeatures(root, params.id, body.features, (input) => ai.runWith(featureListTask, input)))());
  add('POST', '/api/ideas/:id/tools/prep/answer', async ({ params, body }) => ({ state: await answerToolNeed(root, params.id, String(body.need ?? ''), body.answer) }));
  // Draft email: the picker's open questions as the questions email (E2), opened in Outlook and counted as sent.
  add('POST', '/api/ideas/:id/tools/prep/email', async ({ params }) => {
    const rec = await draftToolNeedsEmail(root, params.id, clock);
    const out = await inOutlook(rec.key, async () => openEmail(root, rec.key, clock, await steps()));
    await markToolAsked(root, params.id, out.email.sentAt ?? clock());
    return out;
  });
  add('POST', '/api/ideas/:id/tools', async ({ params, body }) => {
    const { state, designFile } = await saveToolPicks(root, params.id, { features: body.features, tool: body.tool }, { clock, steps: await steps() });
    // Saved features that look like a star the idea already has: listed for Merge or Keep both, never merged here.
    return { state, designMd: await readFile(designFile, 'utf8'), similar: await similarStars(root, await loadIdea(root, params.id)) };
  });
  // Merge one star into another (its links move): the same operator edit the assistant's merge makes, so it can be undone there.
  add('POST', '/api/graph/merge', async ({ body }) => {
    const from = String(body.from ?? ''); const into = String(body.into ?? '');
    const graph = await rebuildGraph(root);
    const a = graph.nodes.find((n) => n.id === from); const b = graph.nodes.find((n) => n.id === into);
    if (!a || !b || a.id === b.id || a.type !== b.type || !MERGEABLE.includes(a.type)) throw new Error('Those two stars cannot be merged');
    const id = await nextEditId(root);
    await appendEdit(root, { id, at: clock(), status: 'active', t: 'merge', from, into } as never);
    return { merged: true, from: a.label, into: b.label, edit: id };
  });
  // Design series: the brainstorm. One question at a time; every change re-renders design.md.
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
    // The features, the one tool (its cons and gaps), the brief and the answers so far go in, names coded; the reply
    // comes back decoded.
    const { input, codes, read } = await codedDesignInput(root, idea, state);
    const { provider, output: raw } = await byHand(() => ai.runWith(designStepTask, input))();
    const output = decodeStep(raw, codes);
    // The design answers save themselves (nothing to say yes to); the reply only rewrites the brief of what the answers add.
    // The record is read again: nothing between the AI call and here may be lost.
    const now = await loadIdea(root, idea.id);
    await saveIdea(root, { ...now, ...(await takeInAnswers(root, now, { learned: raw.learned }, codes, provider, clock(), read, 'design')) });
    // The feature list follows the answers: a feature they leave out, move to another tool or change is changed at once.
    const changed = await applyFeatureChanges(root, idea.id, output.features, clock);
    const out = await applyDesignEvent(root, await loadIdea(root, idea.id), stepEvent(output), clock);
    const said = changed.length ? { featureChanges: changed } : {};
    if (!output.done) return { ...out, ...said, step: out.state.steps[out.state.steps.length - 1] };
    // A finished design is drawn at once: tried twice, as one AI reply can miss. If it still cannot, say why (the
    // pack draws a plain one meanwhile and offers Redraw); never fail the finished design for it.
    let why = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const state = await drawDiagram(root, idea.id, (input) => ai.runWith(designDiagramTask, input), clock);
        return { ...out, ...said, state };
      } catch (e) { why = (e as Error).message; }
    }
    console.error(`Design diagram for ${idea.id} not drawn: ${why}`);
    await appendHistory(await ideaDir(root, idea.id), { at: clock(), action: 'design', by: 'app', detail: `Diagram not drawn: ${why.slice(0, 200)}` });
    return { ...out, ...said, diagramError: why };
  });
  // Redraw the design diagram with the AI (on demand, or when the design changed since it was drawn).
  add('POST', '/api/ideas/:id/design/diagram', async ({ params }) => {
    const state = await readDesign(root, params.id);
    if (!isDone(state)) throw new DesignError('Finish the design first');
    return { state: await byHand(() => drawDiagram(root, params.id, (input) => ai.runWith(designDiagramTask, input), clock))() };
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
  // Redesign: the design starts again from the first question; the features and the tool stay, plan.md and the kits are
  // not touched (marked out of date). Never moves the stage.
  add('POST', '/api/ideas/:id/design/redesign', async ({ params }) => redesign(root, params.id, clock));
  // Design series: plan.md and the starter kits, from an approved design. The kits are templates; the app writes no code.
  add('POST', '/api/ideas/:id/plan', async ({ params }) => {
    const idea = await loadIdea(root, params.id);
    const state = await readDesign(root, idea.id);
    if (!state.approvedAt) throw new DesignError(NOT_APPROVED);
    const retired = retiredToolNote(state.tool?.tool);
    if (retired) throw new DesignError(retired);
    let output;
    // Names coded on the way out (as every other task), put back in the reply.
    const plan = await codedPlanInput(root, idea, state);
    try { output = decodePlan((await ai.runWith(designPlanTask, plan.input)).output, plan.codes); } catch { throw new DesignError(PLAN_NEEDS_AI); }
    // The kits' content: the AI fills them in from the design (names coded, then put back). If it fails, the kits are
    // still written from the design alone, and say so.
    let kit: DesignKitOutput | undefined;
    try {
      const { input, codes } = await codedKitInput(root, idea, state, output);
      kit = decodeKit((await ai.runWith(designKitTask, input)).output, codes);
    } catch { kit = undefined; }
    const { files } = await writePlan(root, idea, state, output, kit);
    // Written from the new design: the plan is no longer out of date (read again, the design may have moved meanwhile).
    const now = await readDesign(root, idea.id);
    if (now.planStale) { delete now.planStale; await writeDesign(root, idea.id, now); }
    return { files, ...(kit ? {} : { note: KIT_NO_AI }) };
  });
  add('GET', '/api/ideas/:id/plan', async ({ params }) => readPlan(root, params.id));
  // The design pack: one of the files the design series wrote (design.md, approach.md, plan.md, kit/...), read-only.
  add('POST', '/api/ideas/:id/design-file', async ({ params, body }) => {
    const rel = String(body.path ?? '');
    if (!DESIGN_FILE.test(rel) || rel.split('/').some((p) => p === '..' || p === '.' || !p)) throw new Error('Not a design file');
    const text = await readText(path.join(await ideaDir(root, params.id), ...rel.split('/')));
    if (text === undefined) throw new Error(`${rel} is not written yet`);
    return { path: rel, text };
  });
  // Launch and Learn: the roadshow. The to-do list, each person's photo, the deck the AI writes and the app draws.
  add('GET', '/api/ideas/:id/roadshow', async ({ params }) => roadshowView(root, params.id));
  // Suggest or Re-evaluate: what the story still needs from the team (the AI reads everything the idea holds).
  add('POST', '/api/ideas/:id/roadshow/suggest', async ({ params }) => {
    await byHand(() => suggestRoadshowPrep(root, params.id, (input) => ai.runWith(roadshowPrepTask, input), clock))();
    return roadshowView(root, params.id);
  });
  // An answer pasted against the to-do list: saved there and on the idea at once (nothing to say yes to).
  add('POST', '/api/ideas/:id/roadshow/prep/answer', async ({ params, body }) => {
    await answerRoadshowNeed(root, params.id, String(body.need ?? ''), body.answer);
    return roadshowView(root, params.id);
  });
  // Draft email: the open items as the questions email (E2), opened in Outlook and counted as sent.
  add('POST', '/api/ideas/:id/roadshow/prep/email', async ({ params }) => {
    const rec = await draftRoadshowNeedsEmail(root, params.id, clock);
    const out = await inOutlook(rec.key, async () => openEmail(root, rec.key, clock, await steps()));
    await markRoadshowAsked(root, params.id, out.email.sentAt ?? clock());
    return out;
  });
  // A person's photo: from a path on this computer (checked, then copied into the idea folder), or from the file picker.
  add('POST', '/api/ideas/:id/roadshow/photo', async ({ params, body }) => {
    await setPhotoFromPath(root, params.id, String(body.person ?? ''), body.path, clock);
    return roadshowView(root, params.id);
  });
  add('POST', '/api/ideas/:id/roadshow/photo-upload', async ({ params, raw, headers }) => {
    const name = fileNameOf(headers['x-filename']);
    await setPhotoFromUpload(root, params.id, String(headers['x-person'] ?? ''), name, new Uint8Array(raw), clock);
    return roadshowView(root, params.id);
  });
  add('POST', '/api/ideas/:id/roadshow/photo/remove', async ({ params, body }) => {
    await removePhoto(root, params.id, String(body.person ?? ''));
    return roadshowView(root, params.id);
  });
  // Build the deck (AI): the slides and the script, checked, then deck.html, script.md, run-of-show.md and deck.pptx drawn.
  add('POST', '/api/ideas/:id/roadshow/build', async ({ params }) => {
    await byHand(() => buildDeck(root, params.id, (input) => ai.runWith(roadshowDeckTask, input), clock))();
    return roadshowView(root, params.id);
  });
  // Draw the files again from the slides already written (new photos), with no AI.
  add('POST', '/api/ideas/:id/roadshow/render', async ({ params }) => {
    await redrawDeck(root, params.id, clock);
    return roadshowView(root, params.id);
  });
  // The deck's files, to open in a tab (Present, the script) or download (the PowerPoint); and the photos' previews.
  add('GET', '/api/ideas/:id/roadshow/files/:name', async ({ params, query }) => deckFile(root, params.id, params.name, query?.download === '1'));
  add('GET', '/api/ideas/:id/roadshow/photos/:file', async ({ params }) => photoFile(root, params.id, params.file));
  // The design pack's two diagrams, opened in a browser tab: the design diagram and the Dataiku recipe flow.
  add('GET', '/api/ideas/:id/design/view/:name', async ({ params }) => diagramReply(root, params.id, params.name, (await loadIdea(root, params.id)).title));
  // Show the idea's folder (where those files are) in Finder or File Explorer.
  add('POST', '/api/ideas/:id/open-folder', async ({ params }) => { const dir = await ideaDir(root, params.id); await openFolder(dir); return { folder: `data/${dataKey(root, dir)}` }; });
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
