import { describe, it, expect } from 'vitest';
import { tmpWorkspace } from './helpers';
import { saveDrop, getItem } from '../src/inbox/store';
import { markStep, resetStepsFrom, skipRest, STEP_ORDER, isRunning, stepOf } from '../src/inbox/steps';

const ws = () => tmpWorkspace('2026-10-21');
const drop = async (root: string) => saveDrop(root, 'reply.eml', 'Subject: x\n\nhello', () => '2026-10-21');

describe('inbox steps', () => {
  it('appends steps in order and replaces a running step with its result', async () => {
    const root = await ws(); const item = await drop(root);
    await markStep(root, item.id, { id: 'receive', status: 'done', detail: 'reply.eml, 1 KB' });
    await markStep(root, item.id, { id: 'read', status: 'running', detail: 'Reading…' });
    expect(isRunning((await getItem(root, item.id))!)).toBe(true);
    const after = await markStep(root, item.id, { id: 'read', status: 'done', detail: 'Email, 1 paragraph', ms: 12 });
    expect(after.steps!.map((s) => `${s.id}:${s.status}`)).toEqual(['receive:done', 'read:done']);
    expect(stepOf(after, 'read')!.ms).toBe(12);
    expect(after.steps![1].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(isRunning(after)).toBe(false);
  });
  it('skipRest marks every later step skipped with the given detail', async () => {
    const root = await ws(); const item = await drop(root);
    await markStep(root, item.id, { id: 'receive', status: 'done', detail: 'x' });
    await markStep(root, item.id, { id: 'read', status: 'done', detail: 'x' });
    await markStep(root, item.id, { id: 'screen', status: 'needs-you', detail: 'Looks like a list of people' });
    const after = await skipRest(root, item.id, 'screen', 'held at the screen');
    expect(after.steps!.map((s) => s.status)).toEqual(['done', 'done', 'needs-you', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped']);
    expect(after.steps!.at(-1)).toMatchObject({ id: 'check', detail: 'held at the screen' });
  });
  it('resetStepsFrom drops the step and everything after it, keeping earlier ones', async () => {
    const root = await ws(); const item = await drop(root);
    for (const id of STEP_ORDER) await markStep(root, item.id, { id, status: 'done', detail: id });
    const after = await resetStepsFrom(root, item.id, 'match');
    expect(after.steps!.map((s) => s.id)).toEqual(['receive', 'read', 'screen']);
  });
  it('STEP_ORDER is the eight steps of the spec', () => {
    expect(STEP_ORDER).toEqual(['receive', 'read', 'screen', 'match', 'understand', 'context', 'graph', 'check']);
  });
});
