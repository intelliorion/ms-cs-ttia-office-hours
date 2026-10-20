import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Clock } from '../clock';
import type { AddRoute } from './server';
import { paths } from '../workspace/paths';
import { loadSteps, STAGE_NAMES } from '../rules/stages';
import { ROUND_FIELDS, SETTING_FIELDS } from '../round/round';
import { loadRound, saveRound, loadSettings, saveSettings } from '../round/store';
import { listIdeas, ideaDir, loadIdea } from '../ideas/store';
import { CLOSURE_LABELS } from '../ideas/idea';
import { tick } from '../checklist/checklist';
import { setStage } from '../ideas/stage';
import { writeFileAtomic, readHistory } from '../workspace/files';
import { importExport } from '../import/importRows';
import { draftEmail, listOutboxChecked, approve, markSent, updateDraft } from '../comms/outbox';
import { saveReview, writeReviewPack, CRITERIA, DECISION_LABELS, type ReviewInput } from '../review/review';
import { overdue, needsE2R } from '../reminders/due';
import { writeStatusCsv } from '../exports/status';
import { rebuildGraph, setAiLinkStatus, readAiLinks, appendAiLink } from '../graph/store';
import { layoutFor } from '../graph/layout';
import { createConnector, defaultProviders, saveAiProvider, type Connector } from '../ai/connector';
import { extractTask, reviewSuggestTask, pingTask, toolPickTask, designStepTask } from '../ai/tasks';
import { readDesign, renderDesignMd } from '../design/store';
import { saveToolPicks, toolPickInput, mergeSuggestions } from '../design/tools';
import {
  applyDesignEvent, approveDesign, askTeam, assertNoOpenStep, designStepInput, isDone, stepEvent, DesignError,
} from '../design/brainstorm';
import { extractInput, planAiLinks } from '../ai/apply';
import { edgeId } from '../graph/ontology';
import { processDrop, applyRecords, undoRecord, chooseIdea, dismissItem, deleteItem, draftHeldReply, inboxView } from '../inbox/flow';


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
    const [round, settings, st, list, { items: outbox, problems: outboxProblems }] = await Promise.all([
      loadRound(root), loadSettings(root), steps(), listIdeas(root), listOutboxChecked(root),
    ]);
    const today = clock();
    return {
      today, round, settings, steps: st, stageNames: STAGE_NAMES, closures: CLOSURE_LABELS, problems: list.problems, outboxProblems,
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
    };
  });

  add('POST', '/api/round', async ({ body }) => saveRound(root, body));
  add('POST', '/api/settings', async ({ body }) => saveSettings(root, body));

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

  add('POST', '/api/outbox/approve', async ({ body }) => approve(root, String(body.key), clock));
  add('POST', '/api/outbox/sent', async ({ body }) => markSent(root, String(body.key), clock, await steps()));
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
  add('POST', '/api/ai/extract', async ({ body }) => byHand(async () => {
    const idea = await loadIdea(root, String(body.id));
    const before = await rebuildGraph(root);
    const { provider, output } = await ai.runWith(extractTask, extractInput(idea, before.nodes));
    const { links, newNodes } = planAiLinks(idea.id, output, before, (await readAiLinks(root)).links, provider);
    for (const l of links) await appendAiLink(root, l);
    const after = await rebuildGraph(root);
    const ids = new Set(links.map((l) => edgeId(l.from, l.rel, l.to)));
    const added = after.edges.filter((e) => ids.has(e.id));
    return { added: added.length, unconfirmed: added.filter((e) => !e.confirmed).length, links: added, suggestions: { newNodes } };
  })());
  add('POST', '/api/ai/review-suggest', async ({ body }) => byHand(async () => {
    const idea = await loadIdea(root, String(body.id));
    const { provider, output } = await ai.runWith(reviewSuggestTask, { idea: extractInput(idea, []).idea });
    return { ...output, provider };
  })());
  // Design series: the tool picker. The AI only suggests; the operator's save is what counts.
  add('GET', '/api/ideas/:id/design', async ({ params }) => {
    const idea = await loadIdea(root, params.id);
    const state = await readDesign(root, idea.id);
    return { state, designMd: renderDesignMd(idea, state) };
  });
  add('POST', '/api/ideas/:id/tools/suggest', async ({ params }) => {
    const idea = await loadIdea(root, params.id);
    const state = await readDesign(root, idea.id);
    return byHand(async () => {
      const { provider, output } = await ai.runWith(toolPickTask, toolPickInput(idea, state));
      return { features: mergeSuggestions(state.features, output.features), provider };
    })();
  });
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
  add('POST', '/api/ideas/:id/design/approve', async ({ params }) => approveDesign(root, params.id, clock));
  // Inbox. Every POST runs behind the server's lock; a drop triages and applies the Safe actions in one request.
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
    return { item: await applyRecords(root, params.id, ids, clock) };
  });
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

  add('POST', '/api/status-export', async () => ({ file: await writeStatusCsv(root, clock) }));
}
