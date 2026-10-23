import { describe, it, expect } from 'vitest';
import { access, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { tmpWorkspace, FIXTURE } from './helpers';
import { importExport } from '../src/import/importRows';
import { createRound, saveRound, saveSettings, setIdeaRound } from '../src/round/store';
import { draftEmail, approve, markSent, listOutbox } from '../src/comms/outbox';
import { setStage } from '../src/ideas/stage';
import { saveReview } from '../src/review/review';
import { overdue, needsE2R } from '../src/reminders/due';
import { listIdeas, loadIdea, ideaDir } from '../src/ideas/store';
import { DEFAULT_STEPS as steps } from '../src/rules/stages';
import { APP_DIR } from '../src/workspace/paths';

describe('a round, end to end', () => {
  it('runs the three real submissions from import to decisions', async () => {
    let today = '2026-10-19';
    const clock = () => today;
    const root = await tmpWorkspace(today);
    const ids = ['CAFE-2026-001', 'CAFE-2026-002', 'CAFE-2026-003'];

    expect((await importExport(root, FIXTURE, { clock, steps })).created).toHaveLength(3);
    await saveSettings(root, { operatorName: 'Café operator', csicLink: 'https://csic.example/intake' });
    const round = await createRound(root, '', clock);
    for (const id of ids) await setIdeaRound(root, id, round.id, clock);
    await saveRound(root, round.id, { reviewBy: '2026-11-02' });

    const send = async (template: string, ideaId: string) => {
      const d = await draftEmail(root, { template, ideaId }, clock);
      await approve(root, d.key, clock);
      return markSent(root, d.key, clock, steps);
    };

    for (const id of ids) {
      await send('E1', id);
      expect((await setStage(root, id, { stage: 2 }, clock)).stage).toBe(2);
    }

    // Saving a decision sends nothing; its email is drafted and sent as a step of its own.
    await saveReview(root, ids[0], { decision: 'ask', reason: 'Did they try Copilot in Outlook?' }, { clock, steps });
    const ask = await draftEmail(root, { template: 'E2', ideaId: ids[0] }, clock);
    await approve(root, ask.key, clock);
    await markSent(root, ask.key, clock, steps);

    const csic = await saveReview(root, ids[1], { decision: 'csic', reason: 'Defined, sponsored, serves people beyond the team.' }, { clock, steps });
    expect(csic.suggest).toEqual({ closeAs: 'csic', label: 'Close it as Routed to CSIC?' });
    const e5 = await draftEmail(root, { template: 'E5', ideaId: ids[1] }, clock);
    await approve(root, e5.key, clock);
    await markSent(root, e5.key, clock, steps);
    // The operator says yes to the suggestion.
    await setStage(root, ids[1], { closeAs: 'csic' }, clock);
    await access(path.join(await ideaDir(root, ids[1]), 'csic-handoff.md'));

    await saveReview(root, ids[2], {
      criteria: { feasible: true, builder: true, data: true, theme: true }, decision: 'select', reason: 'Redacted sample invoices are enough.',
    }, { clock, steps });
    const e3 = await draftEmail(root, { template: 'E3', ideaId: ids[2] }, clock);
    await approve(root, e3.key, clock);
    const sent = await markSent(root, e3.key, clock, steps);
    expect(sent.suggest).toEqual({ stage: 3, label: 'Move it to Design series?' });
    expect((await setStage(root, ids[2], sent.suggest!, clock)).stage).toBe(3);

    const where = (await listIdeas(root)).ideas.map((i) => ({ stage: i.stage, closed: i.closed }));
    expect(where).toEqual([
      { stage: 2, closed: undefined },
      { stage: 2, closed: { as: 'csic', at: '2026-10-19', followUp: '2026-11-16' } },
      { stage: 3, closed: undefined },
    ]);
    expect((await listOutbox(root)).every((m) => m.status === 'sent')).toBe(true);

    today = '2026-10-26';
    const late = overdue(await loadIdea(root, ids[0]), steps, today);
    expect(late[0].text).toBe('E2 sent 7 days ago · reply due 24 October 2026');
    expect(needsE2R(late)).toBe(true);
  });

  it('the CLI sets up a workspace and imports an export', async () => {
    const root = path.join(await tmpWorkspace(), 'cli-ws');
    const run = (...args: string[]) =>
      execFileSync(process.execPath, ['--import', 'tsx', path.join(APP_DIR, 'bin', 'cafe.ts'), ...args, '--workspace', root], {
        cwd: APP_DIR, encoding: 'utf8', env: { ...process.env, CAFE_TODAY: '2026-10-19' },
      });
    expect(run('init')).toContain('rules/settings.yaml');
    expect(JSON.parse(run('import', FIXTURE)).created).toHaveLength(3);
    expect(await readdir(path.join(root, 'data', 'rounds'))).toEqual([]);
  });
});
