import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

const api = vi.hoisted(() => ({
  dataUpload: vi.fn(), dataFilePost: vi.fn(), dataPost: vi.fn(),
  designPost: vi.fn(), ideaGet: vi.fn(), ideaPost: vi.fn(), getHistory: vi.fn(async () => []), post: vi.fn(async () => ({})), copyText: vi.fn(async () => true),
}));
vi.mock('../api', () => api);

import { useStore } from '../state/store';
import { DataSection, DataCard, uploadNotice } from './DataSection';
import type { DesignCall } from './DesignSection';
import { dataGate } from './stageGate';
import { columnRows, currentCard, dataPhase, glyphOf, mergeFiles, stepCards } from './dataHelpers';
import { pointRows } from '../popouts/designPack';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const ID = 'CAFE-2026-004';
const IDEA = { id: ID, title: 'Expense anomaly finder', stage: 3, people: { team: [] }, flags: [] };
const done = (id: string, detail = 'ok') => ({ id, status: 'done', detail });
const STEPS = ['read', 'check', 'profile', 'understand', 'saved'].map((s) => done(s, `${s} found it`));
const TABLE = { name: '', rows: 40, columns: [{ name: 'claim_id', type: 'id', filled: 40, emptyPct: 0, distinct: 40 }, { name: 'policy_type', type: 'category', filled: 40, emptyPct: 0, distinct: 3 }], examples: [], issues: ['claim_id: 1 repeated value'] };
const FILE = {
  id: 'f1', name: 'expenses.csv', file: 'f1-expenses.csv', kind: 'input', bytes: 10, type: 'table', at: '2026-10-20', steps: STEPS, check: { status: 'clear', findings: [], masked: [], notes: [] },
  tables: [TABLE], understanding: { what: 'Masked claims', columns: [{ name: 'claim_id', meaning: 'The claim' }, { name: 'policy_type', meaning: 'The policy', codes: 'T travel, M meals' }], points: [], rules: [{ rule: 'amount under the cap', columns: ['amount'] }], derivations: [], serves: [], issues: [], missing: ['What H means'], looked: ['policy_type'], at: '' },
};
const HELD = { ...FILE, id: 'f2', name: 'claims.csv', file: 'f2-claims.csv', steps: [done('read'), { id: 'check', status: 'needs-you', detail: 'Held: staff_email holds 6 email addresses' }, ...['profile', 'understand', 'saved'].map((s) => ({ id: s, status: 'skipped', detail: 'waiting' }))],
  check: { status: 'held', findings: [{ kind: 'email', column: 'staff_email', count: 6, why: 'staff_email holds 6 email addresses' }], masked: ['staff_email'], notes: [] }, tables: undefined, understanding: undefined };
const state = (data: any) => ({ version: 1, status: 'not-started', features: [], steps: [], ...(data ? { data } : {}) });

let el: HTMLDivElement;
let root: Root;
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };
const click = async (sel: string) => {
  const b = el.querySelector(sel) as HTMLButtonElement | null;
  if (!b) throw new Error(`no ${sel}`);
  await act(async () => { b.click(); });
  await flush();
};
const call: DesignCall = async (fn) => { try { return await fn(); } catch { return null; } };
const mount = async (data: any, opts: { noAi?: boolean } = {}) => {
  await act(async () => root.render(<DataSection idea={IDEA} design={{ state: state(data), designMd: '' }} busy={false} aiWorking={false} noAi={Boolean(opts.noAi)} call={call} onSendQuestions={() => {}} />));
};

beforeEach(() => {
  el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el);
  for (const f of Object.values(api)) f.mockReset();
  useStore.setState({ state: { ideas: [IDEA] }, ai: { provider: 'fake', label: 'Fake' } } as any);
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

describe('the Data step\'s small rules', () => {
  it('the gate: active in the Design series, a card after it when there is data, hidden when there is none', () => {
    expect(dataGate({ stage: 3 }, null)).toBe('active');
    expect(dataGate({ stage: 2 }, null)).toBe('hidden');
    expect(dataGate({ stage: 4 }, { files: [FILE] })).toBe('summary');
    expect(dataGate({ stage: 4 }, { files: [] })).toBe('hidden');
    expect(dataGate({ stage: 3, closed: {} }, { files: [FILE] })).toBe('summary');
  });
  it('cards, the current one, the live copies, the phase', () => {
    expect(stepCards({ steps: [done('read')] }).map((c) => c.status)).toEqual(['done', 'todo', 'todo', 'todo', 'todo']);
    expect(currentCard(HELD)!.id).toBe('check');
    expect(glyphOf('needs-you')).toBe('you');
    expect(mergeFiles([FILE], { f1: { ...FILE, name: 'new' }, f9: { id: 'f9' } }).map((f) => f.name ?? f.id)).toEqual(['new', 'f9']);
    expect(dataPhase(undefined).kind).toBe('none');
    expect(dataPhase({ files: [FILE], summary: {} }).word).toBe('complete, not confirmed');
    expect(dataPhase({ files: [FILE], confirmedAt: '2026-10-20' }).word).toBe('confirmed 2026-10-20');
    expect(columnRows({ ...FILE, edits: { columns: { claim_id: 'Mine' } } })[0]).toMatchObject({ name: 'claim_id', meaning: 'Mine', mine: true });
  });
  it('the pack\'s build points read the confirmed data after the answers', () => {
    const rows = pointRows({ steps: [], data: { confirmedAt: '2026-10-20', points: { 'input-shape': 'expenses.csv: claim_id' } } }, 'build');
    expect(rows.find((r) => r.tag === 'input-shape')).toMatchObject({ text: 'expenses.csv: claim_id', open: false });
    expect(pointRows({ steps: [], data: { points: { 'input-shape': 'x' } } }, 'build')[0].open).toBe(true);
  });
});

describe('DataSection', () => {
  it('drop or pick files: each waits with a guessed kind to change, then goes up with it; the step cards stream in', async () => {
    await mount(undefined);
    expect(el.querySelector('[data-testid="data-drop"]')).not.toBeNull();
    const input = el.querySelector('[data-testid="data-file-input"]') as HTMLInputElement;
    const files = [new File(['a,b\n1,2'], 'policy caps.csv'), new File(['x'], 'claims.csv')];
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    const selects = [...el.querySelectorAll('[data-testid="data-staged"] select')] as HTMLSelectElement[];
    expect(selects.map((s) => s.value)).toEqual(['rules', 'input']);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(selects[1], 'output');
      selects[1].dispatchEvent(new Event('change', { bubbles: true }));
    });
    let progress: ((f: any) => void) | undefined;
    let finish: (v: any) => void = () => {};
    api.dataUpload.mockImplementation((_id: string, _f: File, _k: string, p: (f: any) => void) => { progress = p; return new Promise((r) => { finish = r; }); });
    await act(async () => { (el.querySelector('[data-action="data-upload"]') as HTMLButtonElement).click(); });
    expect(api.dataUpload.mock.calls[0].slice(0, 3)).toEqual([ID, files[0], 'rules']);
    await act(async () => { progress!({ ...FILE, steps: [done('read'), { id: 'check', status: 'running', detail: 'Checking…' }] }); });
    expect([...el.querySelectorAll('[data-file="f1"] .ib-step')].map((x) => x.getAttribute('data-status'))).toEqual(['done', 'running', 'todo', 'todo', 'todo']);
    expect(el.querySelector('[data-file="f1"] [data-testid="data-step-detail"]')!.textContent).toBe('Checking…');
    await act(async () => { finish({ state: state({ files: [FILE], steps: [] }) }); });
    await flush();
    expect(api.dataUpload.mock.calls[1].slice(2, 3)).toEqual(['output']);
  });

  it('a file understood: what it is, every column with its meaning and codes, the rules, the issues and what is missing; Edit saves the operator\'s words', async () => {
    await mount({ files: [FILE], steps: [] });
    const card = el.querySelector('[data-file="f1"]')!;
    expect(card.querySelector('.da-what')!.textContent).toBe('Masked claims');
    expect(card.querySelector('.da-cols')!.textContent).toContain('policy_type categoryThe policy. Codes: T travel, M meals');
    expect(card.textContent).toContain('amount under the cap');
    expect(card.textContent).toContain('claim_id: 1 repeated value');
    expect(card.textContent).toContain('What H means');
    api.dataFilePost.mockResolvedValue({ state: state({ files: [FILE], steps: [] }) });
    await click('[data-action="data-edit"]');
    const inputs = [...el.querySelectorAll('[data-testid="data-edit"] input')] as HTMLInputElement[];
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(inputs[1], 'The claim number');
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('[data-action="data-save-edit"]');
    expect(api.dataFilePost).toHaveBeenCalledWith(ID, 'f1', 'edit', { what: 'Masked claims', columns: { claim_id: 'The claim number', policy_type: 'The policy' } }, undefined);
  });

  it('a held file says why, and offers "It is masked / synthetic — continue" or Remove; nothing else on it', async () => {
    await mount({ files: [HELD], steps: [] });
    expect(el.querySelector('[data-testid="data-held"]')!.textContent).toMatch(/staff_email holds 6 email addresses.*Nothing in it has gone to the AI/);
    expect(el.querySelector('[data-action="data-edit"]')).toBeNull();
    api.dataFilePost.mockResolvedValue({});
    await click('[data-action="data-release"]');
    expect(api.dataFilePost.mock.calls[0].slice(0, 3)).toEqual([ID, 'f2', 'release']);
    expect(typeof api.dataFilePost.mock.calls[0][4]).toBe('function');
  });

  it('the questions one at a time (D1…), then the summary and one confirmation; what the answers changed is listed, read-only', async () => {
    const q = { n: 1, question: 'What should it produce?', why: 'No output sample yet', suggested: ['A list of flagged rows'], topic: 'output', source: 'ai-suggested' };
    await mount({ files: [FILE], steps: [q] });
    expect(el.querySelector('[data-testid="data-carousel"] .ds-n')!.textContent).toBe('D1');
    expect((el.querySelector('[data-action="data-next"]') as HTMLButtonElement).disabled).toBe(true);
    api.dataPost.mockResolvedValue({});
    await click('[data-testid="data-carousel"] [data-action="pick-suggested"]');
    expect(api.dataPost).toHaveBeenCalledWith(ID, 'answer', { n: 1, suggestedIndex: 0 });
    await click('[data-testid="data-carousel"] [data-action="idk"]');
    expect(api.dataPost).toHaveBeenCalledWith(ID, 'answer', { n: 1, idk: true });

    const summary = { text: 'Masked claims checked against the caps.', input: 'expenses.csv', output: 'A flagged list', knowledge: '', rules: 'The caps', gapsClosed: ['The output'], open: ['How much data a real run has'], at: '2026-10-20' };
    const applied = [{ at: '2026-10-20', kind: 'link', key: 'link:x', label: 'Sample data check uses data from Expense System' }];
    await mount({ files: [FILE], steps: [{ ...q, answer: 'A list of flagged rows' }], summary, applied });
    expect(el.querySelector('[data-testid="data-summary"]')!.textContent).toMatch(/complete.*Masked claims.*Still open: How much data/);
    expect(el.querySelector('[data-action="data-next"]')).toBeNull();
    expect(el.querySelector('[data-testid="data-applied"]')!.textContent).toContain('Sample data check uses data from Expense System');
    expect(el.querySelector('[data-testid="data-applied"] button')).toBeNull();
    await click('[data-action="data-confirm"]');
    expect(api.dataPost).toHaveBeenCalledWith(ID, 'confirm');
    await mount({ files: [FILE], steps: [], summary, confirmedAt: '2026-10-20' });
    expect(el.querySelector('[data-action="data-confirm"]')).toBeNull();
    expect(el.querySelector('h3')!.textContent).toContain('confirmed 2026-10-20');
  });

  it('several files are one line each (name, kind, state) that opens; one that needs you stays open', async () => {
    const more = [FILE, { ...FILE, id: 'f3', name: 'rules.xlsx', kind: 'rules' }, { ...FILE, id: 'f4', name: 'out.csv', kind: 'output' }, HELD];
    await mount({ files: more, steps: [] });
    const row = (fid: string) => el.querySelector(`[data-file="${fid}"]`)!;
    expect(row('f1').querySelector('.da-row')!.textContent).toBe('▸expenses.csvSample inputUnderstood');
    expect(row('f1').querySelector('[data-testid="data-understanding"]')).toBeNull();
    expect(row('f2').querySelector('.da-state')!.textContent).toBe('Held');
    expect(row('f2').querySelector('[data-testid="data-held"]')).not.toBeNull();
    await click('[data-file="f1"] [data-action="data-file-toggle"]');
    expect(row('f1').querySelector('.da-what')!.textContent).toBe('Masked claims');
    expect(row('f1').querySelector('select.da-kind')).not.toBeNull();
    await click('[data-file="f1"] [data-action="data-file-toggle"]');
    expect(row('f1').querySelector('.da-what')).toBeNull();
  });

  it('the summary folds to a few lines with "more"; topics earlier answers settle are shown with their source', async () => {
    const summary = { text: 'Masked claims checked against the caps.', input: 'expenses.csv', output: 'A flagged list', knowledge: '', rules: 'The caps', gapsClosed: ['The output'], open: [], at: '2026-10-20' };
    const settled = [{ topic: 'volumes', answer: 'About 12,000 claims a month.', question: 'How many claims?', source: 'inbox/2026-10-20-reply.eml' }];
    await mount({ files: [FILE], steps: [], summary, settled });
    expect(el.querySelector('[data-testid="data-summary"] .ds-sum')!.className).toContain('da-fold');
    expect(el.querySelector('.da-sum-dl')).toBeNull();
    await click('[data-action="data-summary-more"]');
    expect(el.querySelector('.da-sum-dl')!.textContent).toContain('A flagged list');
    expect(el.querySelector('[data-testid="data-settled"]')!.textContent).toBe('Settled by earlier answers: Volumes: “About 12,000 claims a month.” (2026-10-20-reply.eml)');
  });

  it('a file held at the personal-data check is never "read and understood": the notice says it is held and what to do', async () => {
    const said: string[] = [];
    const say: DesignCall = async (fn, o) => { const r = await fn(); said.push(o.ok(r) ?? ''); return r; };
    await act(async () => root.render(<DataSection idea={IDEA} design={{ state: state({ files: [], steps: [] }), designMd: '' }} busy={false} aiWorking={false} noAi={false} call={say} onSendQuestions={() => {}} />));
    const input = el.querySelector('[data-testid="data-file-input"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'claims.csv')], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    api.dataUpload.mockResolvedValue({ file: HELD, state: state({ files: [HELD], steps: [] }) });
    await click('[data-action="data-upload"]');
    expect(said[0]).toMatch(/^claims\.csv is held at the personal-data check: nothing in it has gone to the AI\. Confirm it is masked or synthetic/);
    expect(said[0]).toMatch(/or remove it\.$/);
    expect(said[0]).not.toMatch(/understood/);
    // Mixed: one understood, one held.
    expect(uploadNotice([FILE, HELD])).toBe('expenses.csv is read and understood. Check what the AI made of it, then ask about the data. '
      + 'claims.csv is held at the personal-data check: nothing in it has gone to the AI. Confirm it is masked or synthetic ("It is masked / synthetic — continue"), or remove it.');
  });

  it('with no AI: no Understand or Next question; by hand works', async () => {
    await mount({ files: [FILE], steps: [] }, { noAi: true });
    expect((el.querySelector('[data-action="data-next"]') as HTMLButtonElement).disabled).toBe(true);
    expect((el.querySelector('[data-action="data-understand"]') as HTMLButtonElement).disabled).toBe(true);
    await click('[data-action="data-hand-finish"]');
    expect(el.querySelector('[data-testid="data-hand-finish"]')).not.toBeNull();
  });

  it('the read-only card in Launch and Learn says when it was never confirmed', async () => {
    await act(async () => root.render(<DataCard design={{ state: state({ files: [FILE], steps: [] }), designMd: '' }} />));
    expect(el.textContent).toContain('expenses.csv');
    expect(el.textContent).toContain('Not confirmed');
    expect(el.querySelector('select, button')).toBeNull();
  });
});
