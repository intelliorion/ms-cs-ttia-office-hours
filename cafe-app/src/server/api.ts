import path from 'node:path';
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
import { extractTask, reviewSuggestTask, pingTask } from '../ai/tasks';
import { extractInput, planAiLinks } from '../ai/apply';
import { edgeId } from '../graph/ontology';

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
    const name = path.basename(String(headers['x-filename'] ?? ''));
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
  add('POST', '/api/status-export', async () => ({ file: await writeStatusCsv(root, clock) }));
}
