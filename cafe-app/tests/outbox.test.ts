import { describe, it, expect } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpWorkspace, sampleIdea } from './helpers';
import { saveIdea, loadIdea } from '../src/ideas/store';
import { saveRound, saveSettings } from '../src/round/store';
import { draftEmail, listOutbox, listOutboxChecked, approve, markSent, updateDraft, MissingSettingsError } from '../src/comms/outbox';
import { readHistory } from '../src/workspace/files';
import { DEFAULT_STEPS as steps } from '../src/rules/stages';
import { fixedClock } from '../src/clock';

const clock = fixedClock('2026-10-19');

async function setup() {
  const root = await tmpWorkspace();
  const dir = await saveIdea(root, sampleIdea());
  return { root, dir };
}

describe('outbox', () => {
  it('drafts an email into the idea folder, once', async () => {
    const { root } = await setup();
    const a = await draftEmail(root, { template: 'E1', ideaId: 'CAFE-2026-001' }, clock);
    const b = await draftEmail(root, { template: 'E1', ideaId: 'CAFE-2026-001' }, clock);
    expect(a.key).toBe('ideas/CAFE-2026-001-email-scheduler/emails/001-E1.md');
    expect(b.key).toBe(a.key);
    expect(a).toMatchObject({ status: 'draft', to: 'Person 1', subject: "Creators' Café: we have your idea (CAFE-2026-001)" });
  });

  it('blocks approval until the settings it needs are set', async () => {
    const { root } = await setup();
    const { key } = await draftEmail(root, { template: 'E1', ideaId: 'CAFE-2026-001' }, clock);
    const err = await approve(root, key, clock).catch((e) => e);
    expect(err).toBeInstanceOf(MissingSettingsError);
    expect(err.message).toBe('Set first: Decisions by, Your name (email signature)');
    const [item] = await listOutbox(root);
    expect(item.missingSettings.map((m) => m.label)).toEqual(['Decisions by', 'Your name (email signature)']);
  });

  it('fills settings into drafts, and freezes them on approval', async () => {
    const { root } = await setup();
    const { key } = await draftEmail(root, { template: 'E1', ideaId: 'CAFE-2026-001' }, clock);
    await saveRound(root, { reviewBy: '2026-11-02' });
    await saveSettings(root, { operatorName: 'Café operator' });
    expect((await listOutbox(root))[0].view.body).toContain('by 2 November 2026');
    const approved = await approve(root, key, clock);
    expect(approved.status).toBe('approved');
    await saveRound(root, { reviewBy: '2026-11-09' });
    const [item] = await listOutbox(root);
    expect(item.view.body).toContain('by 2 November 2026');
    expect(await readFile(path.join(root, ...key.split('/')), 'utf8')).toContain('2 November 2026');
  });

  it('shows a new setting in open drafts', async () => {
    const { root } = await setup();
    await draftEmail(root, { template: 'E1', ideaId: 'CAFE-2026-001' }, clock);
    await saveRound(root, { reviewBy: '2026-11-02' });
    expect((await listOutbox(root))[0].view.body).toContain('2 November 2026');
    await saveRound(root, { reviewBy: '2026-11-09' });
    expect((await listOutbox(root))[0].view.body).toContain('9 November 2026');
  });

  it('marks sent only after approval, ticks the step once, and records the date', async () => {
    const { root, dir } = await setup();
    await saveRound(root, { reviewBy: '2026-11-02' });
    await saveSettings(root, { operatorName: 'Café operator' });
    const { key } = await draftEmail(root, { template: 'E1', ideaId: 'CAFE-2026-001' }, clock);
    await expect(markSent(root, key, clock, steps)).rejects.toThrow('Approve the email before marking it as sent');
    await approve(root, key, clock);
    const sent = await markSent(root, key, clock, steps);
    const again = await markSent(root, key, fixedClock('2026-10-25'), steps);
    expect(again.sentAt).toBe(sent.sentAt);
    const idea = await loadIdea(root, 'CAFE-2026-001');
    expect(idea.checklist.s1e).toEqual({ done: true, by: 'app', at: '2026-10-19', source: key });
    expect(idea.sent.E1).toBe('2026-10-19');
    expect((await readHistory(dir)).filter((h) => h.action === 'tick' && h.step === 's1e')).toHaveLength(1);
  });

  it('starts a five-day reply clock when E2 is sent', async () => {
    const { root } = await setup();
    await saveSettings(root, { operatorName: 'Café operator' });
    const { key } = await draftEmail(root, { template: 'E2', ideaId: 'CAFE-2026-001' }, clock);
    await approve(root, key, clock);
    await markSent(root, key, clock, steps);
    const idea = await loadIdea(root, 'CAFE-2026-001');
    expect(idea.due.s2d).toBe('2026-10-24');
    expect(idea.checklist.s2c?.done).toBe(true);
  });

  it('drafts the call for ideas for the round, addressed to the list', async () => {
    const { root } = await setup();
    const e0 = await draftEmail(root, { template: 'E0' }, clock);
    expect(e0.key).toBe('rounds/ROUND-2026-Q4/emails/001-E0.md');
    await saveSettings(root, { distList: 'CS all staff' });
    const item = (await listOutbox(root)).find((m) => m.key === e0.key)!;
    expect(item.view.to).toBe('CS all staff');
    expect(item.missingSettings.map((m) => m.label)).toEqual(['Submission deadline', 'Café form link', 'Your name (email signature)']);
  });

  it('lets the operator edit a draft but not an approved email', async () => {
    const { root } = await setup();
    await saveRound(root, { reviewBy: '2026-11-02' });
    await saveSettings(root, { operatorName: 'Café operator' });
    const { key } = await draftEmail(root, { template: 'E1', ideaId: 'CAFE-2026-001' }, clock);
    expect((await updateDraft(root, key, { subject: 'New subject' })).subject).toBe('New subject');
    await approve(root, key, clock);
    await expect(updateDraft(root, key, { body: 'x' })).rejects.toThrow('Only drafts can be edited');
  });

  it('refuses a key outside the Outbox', async () => {
    const { root } = await setup();
    await expect(approve(root, '../../etc/passwd', clock)).rejects.toThrow('Not an Outbox item');
  });
  it('reports an unreadable email file and still lists the good ones', async () => {
    const { root, dir } = await setup();
    const { key } = await draftEmail(root, { template: 'E1', ideaId: 'CAFE-2026-001' }, clock);
    await writeFile(path.join(dir, 'emails', '002-E2.md'), 'not an email at all');
    const { items, problems } = await listOutboxChecked(root);
    expect(items.map((i) => i.key)).toEqual([key]);
    expect(problems).toEqual([{ file: 'ideas/CAFE-2026-001-email-scheduler/emails/002-E2.md', message: expect.stringContaining('missing front matter') }]);
    expect(await listOutbox(root)).toHaveLength(1);
  });
});
