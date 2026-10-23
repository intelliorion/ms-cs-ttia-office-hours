import { describe, it, expect } from 'vitest';
import { readFile, access, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpWorkspace, FIXTURE } from './helpers';
import { importExport } from '../src/import/importRows';
import { saveReview, writeReviewPack } from '../src/review/review';
import { loadIdea, saveIdea, ideaDir } from '../src/ideas/store';
import { createRound, saveSettings, setIdeaRound } from '../src/round/store';
import { paths } from '../src/workspace/paths';
import { listOutbox } from '../src/comms/outbox';
import { DEFAULT_STEPS as steps } from '../src/rules/stages';
import { fixedClock } from '../src/clock';
import { setStage } from '../src/ideas/stage';

const clock = fixedClock('2026-10-19');
const ctx = { clock, steps };

async function setup() {
  const root = await tmpWorkspace();
  await importExport(root, FIXTURE, ctx);
  // Most reviews happen at Review and Select, so move the imported ideas there.
  for (const id of ['CAFE-2026-001', 'CAFE-2026-002', 'CAFE-2026-003']) {
    await saveIdea(root, { ...(await loadIdea(root, id)), stage: 2 });
  }
  return root;
}

describe('saveReview', () => {
  it('reviews a newly imported idea: it starts in Review and Select', async () => {
    const root = await tmpWorkspace();
    await importExport(root, FIXTURE, ctx);
    const r = await saveReview(root, 'CAFE-2026-003', { decision: 'select', reason: 'Looks good' }, ctx);
    expect(r.idea.stage).toBe(2);
    expect(r.suggest).toEqual({ stage: 3, label: 'Move it to Design series?' });
    const idea = await loadIdea(root, 'CAFE-2026-003');
    expect(idea.stage).toBe(2);
    expect(idea.review?.decision).toBe('select');
    await access(path.join(await ideaDir(root, 'CAFE-2026-003'), 'review.md'));
    expect((await listOutbox(root)).map((m) => m.template)).toEqual(['E3']);
  });

  it('needs a reason and writes nothing without one', async () => {
    const root = await setup();
    await expect(saveReview(root, 'CAFE-2026-003', { decision: 'select', reason: '  ' }, ctx)).rejects.toThrow('Give a reason');
    await expect(access(path.join(await ideaDir(root, 'CAFE-2026-003'), 'review.md'))).rejects.toThrow();
  });

  it('selects an idea: review.md, s2a ticked, E3 drafted, still open, a move suggested', async () => {
    const root = await setup();
    const r = await saveReview(root, 'CAFE-2026-003', {
      criteria: { feasible: true, builder: true, data: true, theme: true, reuse: false, bogus: true },
      decision: 'select', reason: 'Feasible on redacted sample invoices.',
    }, ctx);
    expect(r.email.template).toBe('E3');
    expect(r.idea.closed).toBeUndefined();
    expect(r.idea.stage).toBe(2);
    expect(r.suggest).toEqual({ stage: 3, label: 'Move it to Design series?' });
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
    expect(r.suggest).toBeUndefined();
    expect((await loadIdea(root, 'CAFE-2026-001')).checklist.s2a).toBeUndefined();
  });

  it('routes to CSIC: suggests closing, does not close, and writes the handoff', async () => {
    const root = await setup();
    const r = await saveReview(root, 'CAFE-2026-002', { decision: 'csic', reason: 'Defined, sponsored, serves people beyond the team.' }, ctx);
    expect(r.email.template).toBe('E5');
    expect(r.idea.closed).toBeUndefined();
    expect((await loadIdea(root, 'CAFE-2026-002')).closed).toBeUndefined();
    expect(r.suggest).toEqual({ closeAs: 'csic', label: 'Close it as Routed to CSIC?' });
    const handoff = await readFile(r.handoff!, 'utf8');
    expect(handoff).toContain('Requests arrive in a shared mailbox');
    expect(handoff).toContain('Source: form, Business Challenge');
    expect(handoff).toContain('Person 3, named as sponsor in Team Members and Lead. MD status: not confirmed.');
    expect(handoff).toContain('## Who would use it\n\nNot in the Café submission. Ask the team.\n\nSource: none');
    expect(handoff).toContain('[CSIC REPOSITORY INTAKE LINK]');
    expect(handoff).toContain('On [FOLLOW-UP DATE]: did it reach the CSIC Repository?');
  });

  it('suggests closing for reuse and not this round, and never closes', async () => {
    const root = await setup();
    const reuse = await saveReview(root, 'CAFE-2026-001', { decision: 'reuse', reason: 'Copilot does this.' }, ctx);
    const notnow = await saveReview(root, 'CAFE-2026-003', { decision: 'notnow', reason: 'Full round.' }, ctx);
    expect(reuse.suggest).toEqual({ closeAs: 'reuse', label: 'Close it as Reuse?' });
    expect(notnow.suggest).toEqual({ closeAs: 'notnow', label: 'Close it as Not this round?' });
    expect((await loadIdea(root, 'CAFE-2026-001')).closed).toBeUndefined();
    expect((await loadIdea(root, 'CAFE-2026-003')).closed).toBeUndefined();
  });

  it('does not suggest a move the idea has already made', async () => {
    const root = await setup();
    await saveIdea(root, { ...(await loadIdea(root, 'CAFE-2026-003')), stage: 3 });
    const r = await saveReview(root, 'CAFE-2026-003', { decision: 'select', reason: 'Still good.' }, ctx);
    expect(r.suggest).toBeUndefined();
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

  it('will not review a closed idea until it is reopened', async () => {
    const root = await setup();
    await saveReview(root, 'CAFE-2026-002', { decision: 'csic', reason: 'a' }, ctx);
    await setStage(root, 'CAFE-2026-002', { closeAs: 'csic' }, clock);
    await expect(saveReview(root, 'CAFE-2026-002', { decision: 'select', reason: 'b' }, ctx)).rejects.toThrow('Reopen it first (set its stage)');
    await setStage(root, 'CAFE-2026-002', { stage: 2 }, clock);
    expect((await saveReview(root, 'CAFE-2026-002', { decision: 'select', reason: 'b' }, ctx)).idea.review?.decision).toBe('select');
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
    await setStage(root, 'CAFE-2026-002', { closeAs: 'csic' }, clock);
    await createRound(root, 'Older', fixedClock('2026-09-01'));
    await createRound(root, 'Autumn', clock);
    await setIdeaRound(root, 'CAFE-2026-001', 'ROUND-002', clock);
    const file = await writeReviewPack(root, clock);
    expect(path.relative(root, file)).toBe(path.join('data', 'rounds', 'ROUND-002', 'review-pack-2026-10-19.md'));
    const md = await readFile(file, 'utf8');
    expect(md).toContain('2 ideas to decide');
    // Grouped by round, newest first; a round with no open idea is left out; ideas in no round come last.
    const headings = md.split('\n').filter((l) => /^##? /.test(l));
    expect(headings).toEqual(['# Review pack', '## Autumn (ROUND-002)', '## No round yet']);
    expect(md.indexOf('CAFE-2026-001')).toBeLessThan(md.indexOf('## No round yet'));
    expect(md.indexOf('CAFE-2026-003')).toBeGreaterThan(md.indexOf('## No round yet'));
    expect(md).toContain('\n### CAFE-2026-001 Email scheduler\n');
    expect(md).toContain('\n### CAFE-2026-003 Third Party Invoice Assessment\n');
    expect(md).not.toContain('CAFE-2026-002');
    expect(md).toContain('Participation is Individual but 6 people are listed');
    expect(md).toContain('- Where it is: Review and Select');
    expect(md).not.toMatch(/ of 25/);
  });

  it('with no round at all it still builds: one "No round yet" group and a notice to create a round', async () => {
    const root = await setup();
    const file = await writeReviewPack(root, clock);
    expect(path.relative(root, file)).toBe(path.join('data', 'exports', 'review-pack-2026-10-19.md'));
    const md = await readFile(file, 'utf8');
    expect(md.split('\n').filter((l) => /^##? /.test(l))).toEqual(['# Review pack', '## No round yet']);
    expect(md).toContain('\nCreate a round first (Rounds button).\n');
    for (const id of ['CAFE-2026-001', 'CAFE-2026-002', 'CAFE-2026-003']) expect(md).toContain(`\n### ${id} `);
  });
});
