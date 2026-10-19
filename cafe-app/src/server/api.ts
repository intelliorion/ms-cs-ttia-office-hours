import path from 'node:path';
import type { Clock } from '../clock';
import type { AddRoute } from './server';
import { paths } from '../workspace/paths';
import { loadSteps, STAGE_NAMES } from '../rules/stages';
import { ROUND_FIELDS, SETTING_FIELDS } from '../round/round';
import { loadRound, saveRound, loadSettings, saveSettings } from '../round/store';
import { listIdeas, ideaDir } from '../ideas/store';
import { CLOSURE_LABELS } from '../ideas/idea';
import { tick } from '../checklist/checklist';
import { setStage } from '../ideas/stage';
import { writeFileAtomic, readHistory } from '../workspace/files';
import { importExport } from '../import/importRows';
import { draftEmail, listOutboxChecked, approve, markSent, updateDraft } from '../comms/outbox';
import { saveReview, writeReviewPack, CRITERIA, DECISION_LABELS, type ReviewInput } from '../review/review';
import { overdue, needsE2R } from '../reminders/due';
import { writeStatusCsv } from '../exports/status';

export function registerApi(add: AddRoute, { root, clock }: { root: string; clock: Clock }): void {
  const steps = () => loadSteps(root);

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
  add('POST', '/api/status-export', async () => ({ file: await writeStatusCsv(root, clock) }));
}
