import { describe, it, expect } from 'vitest';
import { readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { tmpWorkspace, FIXTURE } from './helpers';
import { importExport } from '../src/import/importRows';
import { saveRound, saveSettings } from '../src/round/store';
import { draftEmail, approve, markSent, listOutbox } from '../src/comms/outbox';
import { tick, advance, progress } from '../src/checklist/checklist';
import { saveReview } from '../src/review/review';
import { overdue, needsE2R } from '../src/reminders/due';
import { writeStatusCsv } from '../src/exports/status';
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
    await saveRound(root, { reviewBy: '2026-11-02' });

    const send = async (template: string, ideaId: string) => {
      const d = await draftEmail(root, { template, ideaId }, clock);
      await approve(root, d.key, clock);
      return markSent(root, d.key, clock, steps);
    };

    for (const id of ids) {
      await send('E1', id);
      await tick(root, id, 's1a', true, { by: 'operator', clock, steps });
      await tick(root, id, 's1b', true, { by: 'operator', clock, steps });
      expect((await advance(root, id, steps, clock)).stage).toBe(2);
    }

    const ask = await saveReview(root, ids[0], { decision: 'ask', reason: 'Did they try Copilot in Outlook?' }, { clock, steps });
    await approve(root, ask.email.key, clock);
    await markSent(root, ask.email.key, clock, steps);

    const csic = await saveReview(root, ids[1], { decision: 'csic', reason: 'Defined, sponsored, serves people beyond the team.' }, { clock, steps });
    await approve(root, csic.email.key, clock);
    await markSent(root, csic.email.key, clock, steps);
    await access(path.join(await ideaDir(root, ids[1]), 'csic-handoff.md'));

    const sel = await saveReview(root, ids[2], {
      criteria: { feasible: true, builder: true, data: true, theme: true }, decision: 'select', reason: 'Redacted sample invoices are enough.',
    }, { clock, steps });
    await approve(root, sel.email.key, clock);
    await markSent(root, sel.email.key, clock, steps);
    await tick(root, ids[2], 's2e', true, { by: 'operator', clock, steps });
    expect((await advance(root, ids[2], steps, clock)).stage).toBe(3);

    const labels = (await listIdeas(root)).ideas.map((i) => progress(i, steps).label);
    expect(labels).toEqual([
      'Review and Select · 5 of 25',
      'Closed · Routed to CSIC · 6 of 11',
      'Design series · 7 of 25',
    ]);
    expect((await listOutbox(root)).every((m) => m.status === 'sent')).toBe(true);

    today = '2026-10-26';
    const late = overdue(await loadIdea(root, ids[0]), steps, today);
    expect(late[0].text).toBe('E2 sent 7 days ago · reply due 24 October 2026');
    expect(needsE2R(late)).toBe(true);

    const csv = await readFile(await writeStatusCsv(root, clock), 'utf8');
    expect(csv).toContain('CAFE-2026-001,Email scheduler,Under review · decision by 2 November 2026,2026-10-26');
    expect(csv).toContain('CAFE-2026-002,RFx CoE Intelligent Intake & Ticketing Agent,Routed to CSIC,2026-10-26');
    expect(csv).toContain('CAFE-2026-003,Third Party Invoice Assessment,Selected · design series,2026-10-26');
    expect(csv).not.toMatch(/Person/);
  });

  it('the CLI sets up a workspace and imports an export', async () => {
    const root = path.join(await tmpWorkspace(), 'cli-ws');
    const run = (...args: string[]) =>
      execFileSync(process.execPath, ['--import', 'tsx', path.join(APP_DIR, 'bin', 'cafe.ts'), ...args, '--workspace', root], {
        cwd: APP_DIR, encoding: 'utf8', env: { ...process.env, CAFE_TODAY: '2026-10-19' },
      });
    expect(run('init')).toContain('rules/settings.yaml');
    expect(JSON.parse(run('import', FIXTURE)).created).toHaveLength(3);
    expect(run('status').trim()).toBe(path.join(root, 'exports', 'status.csv'));
  });
});
