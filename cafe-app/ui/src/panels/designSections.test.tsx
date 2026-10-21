import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

// The api module, mocked: every call is recorded; each test says what the design routes answer.
const api = vi.hoisted(() => ({
  designPost: vi.fn(),
  ideaGet: vi.fn(),
  ideaPost: vi.fn(),
  getHistory: vi.fn(async () => []),
  post: vi.fn(async () => ({})),
  copyText: vi.fn(async () => true),
}));
vi.mock('../api', () => api);

import { useStore } from '../state/store';
import { IdeaDetails } from './IdeaDetails';
import { ToolPickerSection } from './ToolPickerSection';
import type { DesignCall } from './DesignSection';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no scrolling.
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};

const ID = 'CAFE-2026-001';
const IDEA = { id: ID, title: 'Desk request sorter', slug: 'desk-request-sorter', stage: 3, outcomes: [], support: [], people: { team: [] }, flags: [], overdue: [] };
const STATE = {
  ideas: [IDEA], outbox: [], criteria: [], decisions: {}, steps: [],
  stageNames: { 1: 'Submit', 2: 'Review', 3: 'Design series' }, closures: { csic: 'Routed to CSIC' },
};
const CHECK = { valueWords: [], dataFlags: [], csicFlags: ['custom app'], ok: false };
const designState = (extra: any = {}) => ({
  version: 1, status: 'designing', cafeCheck: CHECK,
  features: [{ id: 'request-form', name: 'Request form', what: 'Collects requests', tool: 'Power Apps', reason: 'A simple form', pathway: 'Assisted Citizen', flags: [] }],
  steps: [
    { n: 1, question: 'What must it show?', suggested: ['Sorting', 'Drafting'], source: 'ai-suggested', why: 'One thing well.' },
    { n: 2, question: 'Smallest input?', suggested: [], source: 'operator', askedTeam: { emailKey: 'k1' } },
  ],
  ...extra,
});

let el: HTMLDivElement;
let root: Root;
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };
const click = async (sel: string) => {
  const b = el.querySelector(sel) as HTMLButtonElement | null;
  if (!b) throw new Error(`no ${sel}`);
  await act(async () => { b.click(); });
};

beforeEach(() => {
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  for (const f of Object.values(api)) f.mockClear();
  api.ideaGet.mockImplementation(async (_id: string, what: string) => (what === 'design' ? { state: designState(), designMd: '# Design' } : { files: [] }));
  useStore.setState({
    state: STATE, graph: { nodes: [], edges: [] }, ai: { provider: 'fake', label: 'Fake (test)' },
    notice: null, suggest: null, refresh: async () => {},
  });
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

describe('ToolPickerSection', () => {
  it('Save posts only name, what, tool, reason and flags (no id or pathway)', async () => {
    api.designPost.mockImplementation(async (_id: string, what: string) => {
      if (what === 'tools/suggest') {
        return { provider: 'fake', features: [
          designState().features[0],
          { name: 'Scheduler', what: 'Picks a slot', tool: 'custom app', reason: 'No low-code tool', flags: [] },
        ] };
      }
      return { state: designState(), designMd: '' };
    });
    const call: DesignCall = async (fn) => { try { return await fn(); } catch { return null; } };
    await act(async () => root.render(
      <ToolPickerSection idea={IDEA} design={{ state: designState(), designMd: '' }} busy={false} aiWorking={false} noAi={false} aiName={() => 'Fake'} call={call} />,
    ));
    await click('[data-action="tools-suggest"]');
    await flush();
    expect(el.querySelectorAll('.tp-row.suggested')).toHaveLength(1);
    await click('[data-action="tools-save"]');
    await flush();
    const saved = api.designPost.mock.calls.find((c) => c[1] === 'tools');
    expect(saved).toBeTruthy();
    expect(saved![0]).toBe(ID);
    expect(saved![2]).toEqual({ features: [
      { name: 'Request form', what: 'Collects requests', tool: 'Power Apps', reason: 'A simple form', flags: [] },
      { name: 'Scheduler', what: 'Picks a slot', tool: 'custom app', reason: 'No low-code tool', flags: ['custom-app'] },
    ] });
  });
});

describe('IdeaDetails design sections', () => {
  // Buttons that only show or open something (design.md, the Outbox) stay usable; everything that changes data waits.
  const actionButtons = () => [...el.querySelectorAll('[data-testid="tool-picker"] button, [data-testid="design"] button')]
    .filter((b) => !/^(toggle-|open-outbox)/.test(b.getAttribute('data-action') ?? '')) as HTMLButtonElement[];

  it('while a call is in flight every action button in Tool picker and Design is disabled', async () => {
    let finish!: (v: unknown) => void;
    api.designPost.mockImplementation(() => new Promise((r) => { finish = r; }));
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    expect(el.querySelector('[data-testid="design"] .ds-step')).toBeTruthy();
    expect(actionButtons().some((b) => !b.disabled)).toBe(true);
    // A plain (non-AI) call: pick a suggested answer.
    await click('.ds-step[data-step="1"] [data-action="pick-suggested"]');
    const stuck = actionButtons();
    expect(stuck.length).toBeGreaterThan(5);
    expect(stuck.filter((b) => !b.disabled).map((b) => b.getAttribute('data-action') ?? b.textContent)).toEqual([]);
    // A second click in the same moment is ignored.
    await click('.ds-step[data-step="1"] [data-action="pick-suggested"]');
    expect(api.designPost).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ state: designState(), designMd: '' }); });
    await flush();
    // An AI call: Suggest with AI.
    await click('[data-action="tools-suggest"]');
    expect(actionButtons().filter((b) => !b.disabled)).toEqual([]);
    expect(el.querySelector('[data-testid="tool-picker"] .ai-busy')?.textContent).toContain('Asking the AI');
    await act(async () => { finish({ provider: 'fake', features: [] }); });
    await flush();
  });

  it('Approve shows the notice and the CSIC Yes/No; Yes moves the stage with closeAs csic', async () => {
    const done = designState({ summary: 'A small proof of concept on synthetic data.' });
    api.ideaGet.mockImplementation(async (_id: string, what: string) => (what === 'design' ? { state: done, designMd: '' } : { files: [] }));
    api.designPost.mockImplementation(async () => ({
      state: { ...done, status: 'approved', approvedAt: '2026-10-20' }, designMd: '',
      notice: 'Design approved. This idea has a CSIC feature.', suggest: { closeAs: 'csic', label: 'Close it as Routed to CSIC?' },
    }));
    api.ideaPost.mockImplementation(async () => ({}));
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    await click('[data-action="approve-design"]');
    await flush();
    expect(api.designPost).toHaveBeenCalledWith(ID, 'design/approve');
    expect(el.querySelector('.pop-notice')?.textContent).toBe('Design approved. This idea has a CSIC feature.');
    expect(el.querySelector('[data-testid="suggest"]')?.textContent).toContain('Close it as Routed to CSIC?');
    expect(api.ideaPost).not.toHaveBeenCalled();
    await click('[data-action="suggest-yes"]');
    await flush();
    expect(api.ideaPost).toHaveBeenCalledWith(ID, 'stage', { closeAs: 'csic' });
  });

  it('No dismisses the suggestion without moving the stage', async () => {
    const done = designState({ summary: 'S' });
    api.ideaGet.mockImplementation(async (_id: string, what: string) => (what === 'design' ? { state: done, designMd: '' } : { files: [] }));
    api.designPost.mockImplementation(async () => ({ state: { ...done, approvedAt: '2026-10-20' }, designMd: '', notice: 'Design approved.', suggest: { closeAs: 'csic', label: 'Close it as Routed to CSIC?' } }));
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    await click('[data-action="approve-design"]');
    await flush();
    await click('[data-action="suggest-no"]');
    expect(el.querySelector('[data-testid="suggest"]')).toBeNull();
    expect(api.ideaPost).not.toHaveBeenCalled();
  });

  it('Change answer reopens the box with the answer in it and saving posts the new answer', async () => {
    const answered = designState({ steps: [{ n: 1, question: 'What must it show?', suggested: ['Sorting'], source: 'operator', answer: 'Sorting' }] });
    api.ideaGet.mockImplementation(async (_id: string, what: string) => (what === 'design' ? { state: answered, designMd: '' } : { files: [] }));
    api.designPost.mockImplementation(async () => ({ state: answered, designMd: '' }));
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    await click('.ds-step[data-step="1"] [data-action="change-answer"]');
    const box = el.querySelector('.ds-step[data-step="1"] textarea') as HTMLTextAreaElement;
    expect(box.value).toBe('Sorting');
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(box, 'Sorting by due date');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('.ds-step[data-step="1"] [data-action="save-changed-answer"]');
    await flush();
    expect(api.designPost).toHaveBeenCalledWith(ID, 'design/answer', { n: 1, answer: 'Sorting by due date' });
    expect(el.querySelector('.ds-step[data-step="1"] [data-action="change-answer"]')).toBeTruthy();
  });

  it('Finish by hand shows whenever there is a step, even with no features picked', async () => {
    const noFeatures = designState({ features: [] });
    api.ideaGet.mockImplementation(async (_id: string, what: string) => (what === 'design' ? { state: noFeatures, designMd: '' } : { files: [] }));
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    expect(el.querySelector('[data-action="hand-finish"]')).toBeTruthy();
  });

  it('Copy build instruction uses the folder the server sent', async () => {
    const approved = designState({ summary: 'S', approvedAt: '2026-10-20', status: 'approved' });
    const folder = 'ideas/CAFE-2026-001-real-folder-name';
    api.ideaGet.mockImplementation(async (_id: string, what: string) => (what === 'design'
      ? { state: approved, designMd: '', folder } : { files: ['kit/custom-app/BUILD-WITH-AGENT.md', 'plan.md'] }));
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    await click('[data-action="copy-instruction"]');
    await flush();
    const text = (api.copyText.mock.calls as any[])[0][0] as string;
    expect(text).toContain(`${folder}/design.md`);
    expect(text).not.toContain('desk-request-sorter');
  });

  it('the tool list comes from /api/state when the server sends one', async () => {
    useStore.setState({ state: { ...STATE, approvedTools: ['Power Apps', 'Server-only tool'] } });
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    const opts = [...el.querySelectorAll('[data-testid="tool-picker"] select option')].map((o) => o.textContent);
    expect(opts).toContain('Server-only tool');
    expect(opts).not.toContain('Dataiku');
  });

  it('a failed re-read keeps the design on screen', async () => {
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    api.ideaGet.mockImplementation(async () => { throw new Error('offline'); });
    api.designPost.mockImplementation(async () => { throw new Error('Pick one of the suggested answers'); });
    await click('.ds-step[data-step="1"] [data-action="pick-suggested"]');
    await flush();
    expect(el.querySelector('.pop-notice.error')?.textContent).toBe('Pick one of the suggested answers');
    expect(el.querySelector('[data-testid="design"] .ds-step')).toBeTruthy();
    expect(el.querySelector('[data-testid="design"]')?.textContent).not.toContain('Loading');
  });

  it('stage 1 shows no action section, only the Next hint', async () => {
    useStore.setState({ state: { ...STATE, ideas: [{ ...IDEA, stage: 1 }] } } as any);
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    expect(el.querySelector('[data-testid="review"]')).toBeNull();
    expect(el.querySelector('[data-testid="tool-picker"]')).toBeNull();
    expect(el.querySelector('[data-testid="design"]')).toBeNull();
    expect(el.textContent).toContain('The decision opens at stage 2');
  });

  it('stage 2 shows the Decision form and nothing from the design series', async () => {
    useStore.setState({ state: { ...STATE, decisions: { select: 'Select (E3)' }, ideas: [{ ...IDEA, stage: 2 }] } } as any);
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    expect(el.querySelector('[data-testid="review"] input[type="radio"][value="select"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="tool-picker"]')).toBeNull();
  });

  it('stage 3 shows the decision as a card above the tool picker; Edit reopens the form', async () => {
    useStore.setState({ state: { ...STATE, decisions: { select: 'Select (E3)' },
      ideas: [{ ...IDEA, stage: 3, review: { decision: 'select', reason: 'Good fit.', criteria: {}, at: '2026-10-20' } }] } } as any);
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    const card = el.querySelector('[data-testid="review-card"]')!;
    expect(card.textContent).toContain('Select (E3)');
    expect(card.textContent).toContain('Good fit.');
    expect(el.querySelector('[data-testid="tool-picker"]')).toBeTruthy();
    await click('[data-action="edit-review-card"]');
    expect(el.querySelector('[data-testid="review-card"]')).toBeNull();
    expect(el.querySelector('[data-testid="review"] textarea.reason')).toBeTruthy();
  });

  it('stage 4 shows cards for tools, design and plan, with no editable form', async () => {
    api.ideaGet.mockImplementation(async (_id: string, what: string) => (what === 'design'
      ? { state: designState({ summary: 'Shows sorted requests.', approvedAt: '2026-10-20' }), designMd: '# Design' } : { files: ['plan.md'], planMd: '# Plan' }));
    useStore.setState({ state: { ...STATE, ideas: [{ ...IDEA, stage: 4 }] } } as any);
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    expect(el.querySelector('[data-testid="tools-card"]')!.textContent).toContain('Power Apps');
    expect(el.querySelector('[data-testid="design-card"]')!.textContent).toContain('Shows sorted requests.');
    expect(el.querySelector('[data-testid="plan-card"]')!.textContent).toContain('plan.md');
    expect(el.querySelector('[data-testid="tool-picker"]')).toBeNull();
    expect(el.querySelector('[data-action="write-plan"]')).toBeNull();
    expect(el.querySelector('[data-testid="review-card"]')!.textContent).toContain('No decision recorded');
  });

  it('a closed idea shows cards without Edit links', async () => {
    useStore.setState({ state: { ...STATE, ideas: [{ ...IDEA, stage: 3, closed: { as: 'csic' } }] } } as any);
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    expect(el.querySelector('[data-testid="tools-card"]')).toBeTruthy();
    expect(el.querySelector('[data-action^="edit-"]')).toBeNull();
  });

  it('plan files written earlier stay on screen after the design is reopened; writing again waits for approval', async () => {
    api.ideaGet.mockImplementation(async (_id: string, what: string) => (what === 'design'
      ? { state: designState({ summary: 'Done.' }), designMd: '# Design' } : { files: ['plan.md', 'kit/power-apps/screens.md'] }));
    useStore.setState({ state: { ...STATE, ideas: [{ ...IDEA, stage: 3 }] } } as any);
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    const plan = el.querySelector('[data-testid="plan-kits"]')!;
    expect(plan.textContent).toContain('kit/power-apps/screens.md');
    expect((plan.querySelector('[data-action="write-plan"]') as HTMLButtonElement).disabled).toBe(true);
    expect(plan.textContent).toContain('approve it again');
  });

  it('a suggested pick shows its "why this tool" lines open, and Save posts them with the row', async () => {
    api.designPost.mockImplementation(async (_id: string, route: string, body: any) => (route === 'tools/suggest'
      ? { features: [{ name: 'Intake', what: 'Takes requests', tool: 'Power Apps', reason: 'Form-shaped', flags: [], context: ['Form-shaped input', 'No live system → Power Apps'] }], provider: 'fake' }
      : { state: designState({ features: body.features.map((f: any, i: number) => ({ id: `f${i}`, ...f })) }), designMd: '# Design' }));
    api.ideaGet.mockImplementation(async (_id: string, what: string) => (what === 'design' ? { state: designState({ features: [] }), designMd: '# Design' } : { files: [] }));
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    await click('[data-action="tools-suggest"]');
    await flush();
    const ctx = el.querySelector('[data-testid="tool-context"]') as HTMLDetailsElement;
    expect(ctx.open).toBe(true);
    expect(ctx.textContent).toContain('No live system → Power Apps');
    expect(el.querySelectorAll('.tp-row')).toHaveLength(1);
    await click('[data-action="tools-save"]');
    await flush();
    const saveCall = api.designPost.mock.calls.find((c: any[]) => c[1] === 'tools')!;
    expect(saveCall[2].features[0].context).toEqual(['Form-shaped input', 'No live system → Power Apps']);
  });

  it('questions out to the team: listed in the picker, Suggest disabled until the reply is marked received, Forget clears', async () => {
    const tq = { questions: ['What arrives?', 'Who builds?'], emailKey: 'k9', at: '2026-10-21' };
    api.ideaGet.mockImplementation(async (_id: string, what: string) => (what === 'design' ? { state: designState({ features: [], toolQuestions: tq }), designMd: '# Design' } : { files: [] }));
    api.designPost.mockImplementation(async () => ({ state: designState({ features: [] }) }));
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    const box = el.querySelector('[data-testid="tool-questions"]')!;
    expect(box.textContent).toContain('Who builds?');
    expect(box.textContent).toContain('waiting for the reply');
    expect((el.querySelector('[data-action="tools-suggest"]') as HTMLButtonElement).disabled).toBe(true);
    await click('[data-action="tools-forget"]');
    await flush();
    expect(api.designPost.mock.calls.some((c: any[]) => c[1] === 'tools/questions/clear')).toBe(true);
  });

  it('with the reply marked received the picker says so and Suggest is enabled again', async () => {
    const tq = { questions: ['What arrives?'], emailKey: 'k9', at: '2026-10-21' };
    api.ideaGet.mockImplementation(async (_id: string, what: string) => (what === 'design' ? { state: designState({ features: [], toolQuestions: tq }), designMd: '# Design' } : { files: [] }));
    useStore.setState({ state: { ...STATE, ideas: [{ ...IDEA, checklist: { s2d: { done: true } } }] } } as any);
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    expect(el.querySelector('[data-testid="tool-questions"]')!.textContent).toContain('reply received');
    expect((el.querySelector('[data-action="tools-suggest"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('answers the Inbox recorded show under the asked questions and re-enable Suggest', async () => {
    const tq = { questions: ['What does a request look like when it arrives?', 'Who builds?'], emailKey: 'k9', at: '2026-10-21' };
    api.ideaGet.mockImplementation(async (_id: string, what: string) => (what === 'design' ? { state: designState({ features: [], toolQuestions: tq }), designMd: '# Design' } : { files: [] }));
    useStore.setState({ state: { ...STATE, ideas: [{ ...IDEA, answers: [{ question: 'What does a request look like when it arrives', answer: 'An email to the shared mailbox', source: 'r.eml' }] }] } } as any);
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    expect(el.querySelector('[data-testid="tool-answer"]')!.textContent).toContain('An email to the shared mailbox');
    expect(el.querySelectorAll('[data-testid="tool-answer"]')).toHaveLength(1);
    expect((el.querySelector('[data-action="tools-suggest"]') as HTMLButtonElement).disabled).toBe(false);
    expect(el.querySelector('[data-testid="tool-questions"]')!.textContent).toContain('press Suggest with AI again');
  });
});
