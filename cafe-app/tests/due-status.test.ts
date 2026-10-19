import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { tmpWorkspace, sampleIdea, FIXTURE } from './helpers';
import { overdue, needsE2R } from '../src/reminders/due';
import { publicStatus, writeStatusCsv } from '../src/exports/status';
import { importExport } from '../src/import/importRows';
import { saveIdea } from '../src/ideas/store';
import { DEFAULT_STEPS as steps } from '../src/rules/stages';
import { fixedClock } from '../src/clock';

const waiting = sampleIdea({ stage: 2, sent: { E2: '2026-10-19' }, due: { s2d: '2026-10-24' } });

describe('overdue', () => {
  it('is not overdue on the due date', () => expect(overdue(waiting, steps, '2026-10-24')).toEqual([]));

  it('shows how long the reply has been waiting', () => {
    const o = overdue(waiting, steps, '2026-10-26');
    expect(o).toEqual([{ step: 's2d', due: '2026-10-24', daysLate: 2, text: 'E2 sent 7 days ago · reply due 24 October 2026' }]);
    expect(needsE2R(o)).toBe(true);
  });

  it('stops once the answer is in, or the idea is closed', () => {
    const answered = { ...waiting, checklist: { s2d: { done: true, by: 'operator' as const, at: '2026-10-25' } } };
    expect(overdue(answered, steps, '2026-10-26')).toEqual([]);
    expect(overdue({ ...waiting, closed: { as: 'notnow', at: '2026-10-25' } }, steps, '2026-10-26')).toEqual([]);
  });
});

describe('status', () => {
  const round = { id: 'ROUND-2026-Q4', reviewBy: '2026-11-02' };

  it('says what a submitter may see', () => {
    expect(publicStatus(sampleIdea(), { id: 'ROUND-2026-Q4' })).toBe('Received · decision by date to be confirmed');
    expect(publicStatus(sampleIdea({ stage: 2 }), round)).toBe('Under review · decision by 2 November 2026');
    expect(publicStatus(sampleIdea({ stage: 3 }), round)).toBe('Selected · design series');
    expect(publicStatus(sampleIdea({ stage: 2, closed: { as: 'csic', at: '2026-10-19' } }), round)).toBe('Routed to CSIC');
  });

  it('writes status.csv with no names', async () => {
    const root = await tmpWorkspace();
    await importExport(root, FIXTURE, { clock: fixedClock('2026-10-19'), steps });
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-009', slug: 'x', title: 'Intake, triage and "routing"' }));
    const csv = await readFile(await writeStatusCsv(root, fixedClock('2026-10-19')), 'utf8');
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('Café ID,Title,Status,Updated');
    expect(lines[1]).toBe('CAFE-2026-001,Email scheduler,Received · decision by date to be confirmed,2026-10-19');
    expect(lines[4]).toBe('CAFE-2026-009,"Intake, triage and ""routing""",Received · decision by date to be confirmed,2026-10-19');
    expect(csv).not.toMatch(/Person/);
  });
  it('neutralises spreadsheet formulas and quotes line breaks in status.csv', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-001', slug: 'a', title: '=HYPERLINK("x")' }));
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-002', slug: 'b', title: '@cmd', dedupe_key: 'b' }));
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-003', slug: 'c', title: 'two\rlines', dedupe_key: 'c' }));
    const csv = await readFile(await writeStatusCsv(root, fixedClock('2026-10-19')), 'utf8');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain("'@cmd");
    expect(csv).toContain('"two\rlines"');
  });
});
