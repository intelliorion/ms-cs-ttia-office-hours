import { describe, it, expect } from 'vitest';
import { readFile, access, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpWorkspace, FIXTURE } from './helpers';
import { importExport } from '../src/import/importRows';
import { saveReview, writeReviewPack } from '../src/review/review';
import { loadIdea, ideaDir } from '../src/ideas/store';
import { saveSettings } from '../src/round/store';
import { paths } from '../src/workspace/paths';
import { DEFAULT_STEPS as steps } from '../src/rules/stages';
import { fixedClock } from '../src/clock';

const clock = fixedClock('2026-10-19');
const ctx = { clock, steps };

async function setup() {
  const root = await tmpWorkspace();
  await importExport(root, FIXTURE, ctx);
  return root;
}

describe('saveReview', () => {
  it('needs a reason and writes nothing without one', async () => {
    const root = await setup();
    await expect(saveReview(root, 'CAFE-2026-003', { decision: 'select', reason: '  ' }, ctx)).rejects.toThrow('Give a reason');
    await expect(access(path.join(await ideaDir(root, 'CAFE-2026-003'), 'review.md'))).rejects.toThrow();
  });

  it('selects an idea: review.md, s2a ticked, E3 drafted, still open', async () => {
    const root = await setup();
    const r = await saveReview(root, 'CAFE-2026-003', {
      criteria: { feasible: true, builder: true, data: true, theme: true, reuse: false, bogus: true },
      decision: 'select', reason: 'Feasible on redacted sample invoices.',
    }, ctx);
    expect(r.email.template).toBe('E3');
    expect(r.idea.closed).toBeUndefined();
    expect(r.idea.review?.criteria).toEqual({ feasible: true, builder: true, data: true, theme: true, reuse: false });
    expect((await loadIdea(root, 'CAFE-2026-003')).checklist.s2a?.done).toBe(true);
    const md = await readFile(path.join(await ideaDir(root, 'CAFE-2026-003'), 'review.md'), 'utf8');
    expect(md).toContain('- [x] A builder is named and can attend');
    expect(md).toContain('- [ ] It could be reused beyond the submitting team');
    expect(md).toContain('Feasible on redacted sample invoices.');
  });

  it('asks first: E2 drafted, feasibility not ticked', async () => {
    const root = await setup();
    const r = await saveReview(root, 'CAFE-2026-001', { decision: 'ask', reason: 'Did they try Copilot in Outlook?' }, ctx);
    expect(r.email.template).toBe('E2');
    expect((await loadIdea(root, 'CAFE-2026-001')).checklist.s2a).toBeUndefined();
  });

  it('routes to CSIC: closes with a four-week follow-up and writes the handoff', async () => {
    const root = await setup();
    const r = await saveReview(root, 'CAFE-2026-002', { decision: 'csic', reason: 'Defined, sponsored, serves people beyond the team.' }, ctx);
    expect(r.email.template).toBe('E5');
    expect(r.idea.closed).toEqual({ as: 'csic', at: '2026-10-19', followUp: '2026-11-16' });
    const handoff = await readFile(r.handoff!, 'utf8');
    expect(handoff).toContain('Requests arrive in a shared mailbox');
    expect(handoff).toContain('Source: form, Business Challenge');
    expect(handoff).toContain('Person 3, named as sponsor in Team Members and Lead. MD status: not confirmed.');
    expect(handoff).toContain('## Who would use it\n\nNot in the Café submission. Ask the team.\n\nSource: none');
    expect(handoff).toContain('[CSIC REPOSITORY INTAKE LINK]');
    expect(handoff).toContain('On 16 November 2026: did it reach the CSIC Repository?');
  });

  it('warns when a selection goes over capacity', async () => {
    const root = await setup();
    await saveSettings(root, { capacity: { ideasPerRound: 1 } });
    const first = await saveReview(root, 'CAFE-2026-001', { decision: 'select', reason: 'a' }, ctx);
    const second = await saveReview(root, 'CAFE-2026-003', { decision: 'select', reason: 'b' }, ctx);
    expect(first.warnings).toEqual([]);
    expect(second.warnings).toEqual(['This makes 2 ideas selected this round; your limit is 1.']);
  });

  it('a failed email draft leaves the idea open and writes nothing', async () => {
    const root = await setup();
    await rm(path.join(paths(root).templates, 'E5.md'));
    await expect(saveReview(root, 'CAFE-2026-002', { decision: 'csic', reason: 'a' }, ctx)).rejects.toThrow();
    expect((await loadIdea(root, 'CAFE-2026-002')).closed).toBeUndefined();
    expect((await loadIdea(root, 'CAFE-2026-002')).checklist.s2a).toBeUndefined();
    const dir = await ideaDir(root, 'CAFE-2026-002');
    await expect(access(path.join(dir, 'review.md'))).rejects.toThrow();
    await expect(access(path.join(dir, 'csic-handoff.md'))).rejects.toThrow();
  });

  it('will not review a closed idea again', async () => {
    const root = await setup();
    await saveReview(root, 'CAFE-2026-002', { decision: 'csic', reason: 'a' }, ctx);
    await expect(saveReview(root, 'CAFE-2026-002', { decision: 'select', reason: 'b' }, ctx)).rejects.toThrow('already closed');
  });

  it('refuses an unknown decision', async () => {
    const root = await setup();
    await expect(saveReview(root, 'CAFE-2026-001', { decision: 'maybe', reason: 'a' }, ctx)).rejects.toThrow('Pick a decision');
  });
});

describe('writeReviewPack', () => {
  it('lists the open ideas for the TTIA meeting', async () => {
    const root = await setup();
    await saveReview(root, 'CAFE-2026-002', { decision: 'csic', reason: 'a' }, ctx);
    const file = await writeReviewPack(root, clock, steps);
    expect(path.basename(file)).toBe('review-pack-2026-10-19.md');
    const md = await readFile(file, 'utf8');
    expect(md).toContain('2 ideas to decide');
    expect(md).toContain('## CAFE-2026-001 Email scheduler');
    expect(md).toContain('## CAFE-2026-003 Third Party Invoice Assessment');
    expect(md).not.toContain('CAFE-2026-002');
    expect(md).toContain('Participation is Individual but 6 people are listed');
  });
});
