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
import { DesignSection, PlanSection, type DesignCall } from './DesignSection';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no scrolling.
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};

const ID = 'CAFE-2026-001';
const IDEA = { id: ID, title: 'Desk request sorter', slug: 'desk-request-sorter', stage: 3, outcomes: [], support: [], people: { team: [] }, flags: [], overdue: [] };
const STATE = {
  ideas: [IDEA], outbox: [], criteria: [], decisions: {}, steps: [],
  stageNames: { 1: 'Submit', 2: 'Review', 3: 'Design series' }, closures: { csic: 'Routed to CSIC' },
};
const designState = (extra: any = {}) => ({
  version: 1, status: 'designing',
  features: [{ id: 'request-form', name: 'Request form', what: 'Collects requests', flags: [] }],
  tool: { tool: 'Power Apps', pathway: 'Assisted Citizen', by: 'ai', reason: 'A simple form', pros: ['Quick to build'], cons: [], context: [], flags: [],
    fit: [{ feature: 'Request form', fit: 'yes', note: '' }], evaluatedFor: ['Request form'], at: '2026-10-20' },
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

/** Types into a controlled input the way React sees it. */
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
/** Picks an option in the tool drop-down. */
const choose = async (value: string) => {
  const sel = el.querySelector('[data-action="tool"]') as HTMLSelectElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, value);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
};
const SUGGESTED = { tool: 'Power Apps', by: 'ai', reason: 'Form-shaped', pros: ['Quick to build'], cons: ["Can't send reminders on its own: add Power Automate"],
  context: ['Form-shaped input', 'No live system → Power Apps'], flags: [],
  fit: [{ feature: 'Request form', fit: 'yes', note: '' }, { feature: 'Reminders', fit: 'no', note: 'Add Power Automate' }], evaluatedFor: ['Request form', 'Reminders'] };

describe('ToolPickerSection', () => {
  const mount = async (opts: { noAi?: boolean; state?: any } = {}) => {
    const call: DesignCall = async (fn) => { try { return await fn(); } catch { return null; } };
    await act(async () => root.render(
      <ToolPickerSection idea={IDEA} design={{ state: opts.state ?? designState(), designMd: '' }} busy={false} aiWorking={false} noAi={Boolean(opts.noAi)} aiName={() => 'Fake'} call={call} />,
    ));
  };
  const names = () => [...el.querySelectorAll('.tp-row .tp-name')].map((i) => (i as HTMLInputElement).value);

  it('an older record that chose UiPath: no tool shown, the drop-down waits for a new pick and says why', async () => {
    await mount({ state: designState({ tool: { ...designState().tool, tool: 'UiPath' } }) });
    expect(el.querySelector('[data-testid="tool-choice"]')).toBeNull();
    expect((el.querySelector('[data-action="tool"]') as HTMLSelectElement).value).toBe('');
    expect([...el.querySelectorAll('[data-action="tool"] option')].map((o) => o.textContent)).not.toContain('UiPath');
    expect(el.querySelector('[data-testid="tool-retired"]')!.textContent).toBe('UiPath is no longer on the approved list: pick another tool');
  });

  it('the reuse tag says what is reused, or that an older record named nothing', async () => {
    await mount({ state: designState({ features: [
      { id: 'dup', name: 'Duplicate check', what: 'Finds duplicates', flags: ['reuse-existing'], reuses: "EKG Expenses' duplicate check" },
      { id: 'weekend', name: 'Weekend check', what: 'Flags weekend spend', flags: ['reuse-existing'] },
    ] }) });
    const tags = [...el.querySelectorAll('.tp-row .tp-flag[data-flag="reuse-existing"]')].map((t) => t.textContent);
    expect(tags).toEqual(["Reuses: EKG Expenses' duplicate check", 'Reuses something that exists (not named)']);
    expect(el.textContent).not.toContain('Reuse what exists');
  });

  it('features first, then the tool: two steps in that order', async () => {
    await mount();
    const steps = [...el.querySelectorAll('[data-testid="tool-picker"] .tp-step')].map((x) => x.getAttribute('data-testid'));
    expect(steps).toEqual(['tp-features', 'tp-tool']);
    expect(el.querySelector('[data-testid="tp-features"] [data-action="tool"]')).toBeNull();
    expect(el.querySelector('[data-testid="tp-tool"] [data-testid="tool-choice"]')!.getAttribute('data-tool')).toBe('Power Apps');
  });

  it('Suggest features with AI keeps the operator rows and adds only new names; add and remove work by hand', async () => {
    api.designPost.mockImplementation(async (_id: string, what: string) => (what === 'tools/features/suggest'
      ? { provider: 'fake', features: [{ id: 'request-form', name: 'Request form', what: 'Collects requests', flags: [] }, { name: 'request FORM', what: 'dup', flags: [] }, { name: 'Reminders', what: 'Sends reminders', flags: [] }] }
      : {}));
    await mount();
    await click('[data-action="features-suggest"]');
    await flush();
    expect(api.designPost.mock.calls[0]).toEqual([ID, 'tools/features/suggest', { features: [{ name: 'Request form', what: 'Collects requests', flags: [] }] }]);
    expect(names()).toEqual(['Request form', 'Reminders']);
    expect(el.querySelectorAll('.tp-row.suggested')).toHaveLength(1);
    await click('[data-action="tools-add"]');
    await type([...el.querySelectorAll('.tp-row .tp-name')].pop() as HTMLInputElement, 'Summary');
    expect(names()).toEqual(['Request form', 'Reminders', 'Summary']);
    await click('.tp-row[data-feature="Request form"] [data-action="feature-remove"]');
    expect(names()).toEqual(['Reminders', 'Summary']);
  });

  it('changing the features after a tool is chosen marks it out of date; Re-evaluate sends the tool fixed with the new list', async () => {
    api.designPost.mockImplementation(async () => ({ provider: 'fake', tool: { ...SUGGESTED, by: 'operator', evaluatedFor: ['Request form', 'Reminders'] }, state: designState() }));
    await mount();
    expect(el.querySelector('[data-testid="tool-stale"]')).toBeNull();
    await click('[data-action="tools-add"]');
    await type([...el.querySelectorAll('.tp-row .tp-name')].pop() as HTMLInputElement, 'Reminders');
    expect(el.querySelector('[data-testid="tool-stale"]')!.textContent).toContain('Re-evaluate the tool for the new features');
    await click('[data-action="tools-evaluate-features"]');
    await flush();
    expect(api.designPost.mock.calls[0]).toEqual([ID, 'tools/suggest', { features: [{ name: 'Request form', what: 'Collects requests', flags: [] }, { name: 'Reminders', flags: [] }], tool: 'Power Apps' }]);
    expect(el.querySelector('[data-testid="tool-stale"]')).toBeNull();
  });

  it('overriding the tool asks the AI to evaluate THAT tool, and shows its pros, cons and fit as the operator\'s choice', async () => {
    let finish!: (v: unknown) => void;
    api.designPost.mockImplementation(() => new Promise((r) => { finish = r; }));
    await mount();
    await choose('Dataiku');
    expect(api.designPost.mock.calls[0]).toEqual([ID, 'tools/suggest', { features: [{ name: 'Request form', what: 'Collects requests', flags: [] }], tool: 'Dataiku' }]);
    // While the AI works the drop-down shows the tool picked.
    expect((el.querySelector('[data-action="tool"]') as HTMLSelectElement).value).toBe('Dataiku');
    await act(async () => { finish({ provider: 'fake', tool: { tool: 'Dataiku', by: 'operator', reason: 'Clicks', pros: ['Copies the clicks'], cons: ['Cannot read a form'], context: ['c'], flags: [],
      fit: [{ feature: 'Request form', fit: 'partly', note: 'Needs a sample form' }], evaluatedFor: ['Request form'] }, state: designState() }); });
    await flush();
    const c = el.querySelector('[data-testid="tool-choice"]')!;
    expect(c.getAttribute('data-tool')).toBe('Dataiku');
    expect(c.getAttribute('data-by')).toBe('operator');
    expect(c.textContent).toContain('Your choice');
    expect(c.querySelector('.tp-cons li')!.textContent).toBe('Cannot read a form');
    expect([...c.querySelectorAll('[data-testid="tool-fit"] li')].map((li) => [li.getAttribute('data-fit'), li.textContent])).toEqual([['partly', 'partlyRequest formNeeds a sample form']]);
  });

  it('with no AI the override still applies, with pros and cons cleared and a note that they need the AI; Save posts it', async () => {
    api.designPost.mockImplementation(async () => ({ state: designState(), designMd: '' }));
    await mount({ noAi: true });
    await choose('Dataiku');
    expect(api.designPost.mock.calls.filter((c: any[]) => c[1] === 'tools/suggest')).toEqual([]);
    const c = el.querySelector('[data-testid="tool-choice"]')!;
    expect(c.getAttribute('data-tool')).toBe('Dataiku');
    expect(c.querySelector('[data-testid="tool-pros-cons"]')).toBeNull();
    expect(c.querySelector('[data-testid="tool-needs-ai"]')!.textContent).toContain('need the AI');
    await click('[data-action="tools-save"]');
    await flush();
    const saved = api.designPost.mock.calls.find((x: any[]) => x[1] === 'tools')!;
    expect(saved[2]).toEqual({
      features: [{ name: 'Request form', what: 'Collects requests', flags: [] }],
      tool: { tool: 'Dataiku', by: 'operator', reason: '', pros: [], cons: [], context: [], flags: [], fit: [], evaluatedFor: ['Request form'], needsAi: true },
    });
  });
});

describe('DesignSection', () => {
  it('a finished design shows See the design and Approve design side by side', async () => {
    const call: DesignCall = async (fn) => { try { return await fn(); } catch { return null; } };
    const done = designState({ summary: 'A proof of concept that shows the flagged list.', steps: [{ n: 1, question: 'Q?', answer: 'A', suggested: [] }] });
    await act(async () => root.render(<DesignSection idea={IDEA} design={{ state: done, designMd: '' }} busy={false} aiWorking={false} noAi={false} call={call} onSendQuestions={() => {}} />));
    const row = el.querySelector('[data-testid="design-final"]')!;
    expect([...row.querySelectorAll('button')].map((x) => x.getAttribute('data-action'))).toEqual(['see-design', 'approve-design']);
    expect(el.querySelectorAll('[data-action="approve-design"]')).toHaveLength(1);
  });

  it('the design shows no "From your answers" list: its answers save themselves', async () => {
    const call: DesignCall = async (fn) => { try { return await fn(); } catch { return null; } };
    const idea = { ...IDEA, updates: [{ id: 'u1', kind: 'builder', label: 'Make Person 2 the builder', status: 'proposed', from: 'design' }] };
    await act(async () => root.render(<DesignSection idea={idea} design={{ state: designState(), designMd: '' }} busy={false} aiWorking={false} noAi={false} call={call} onSendQuestions={() => {}} />));
    expect(el.querySelector('[data-testid="design"] [data-testid="rs-updates"]')).toBeNull();
  });

  it('Redesign asks first; Cancel does nothing; Start again posts design/redesign and says the plan is out of date', async () => {
    const calls: string[] = [];
    const call: DesignCall = async (fn, o) => { try { const r = await fn(); calls.push(o.ok(r) ?? ''); return r; } catch { return null; } };
    api.designPost.mockImplementation(async () => ({ state: designState({ steps: [], status: 'picking', planStale: '2026-10-20' }), designMd: '', planStale: true }));
    const approved = designState({ summary: 'Shows the list.', approvedAt: '2026-10-19', status: 'approved' });
    await act(async () => root.render(<DesignSection idea={IDEA} design={{ state: approved, designMd: '' }} busy={false} aiWorking={false} noAi={false} call={call} onSendQuestions={() => {}} />));
    expect(el.querySelector('[data-testid="redesign-confirm"]')).toBeNull();
    await click('[data-action="redesign"]');
    expect(el.querySelector('[data-testid="redesign-confirm"]')!.textContent).toContain(
      'Start the design again? The questions, answers, summary, approval and diagram are cleared; the features and the tool stay.');
    await click('[data-action="redesign-cancel"]');
    expect(el.querySelector('[data-testid="redesign-confirm"]')).toBeNull();
    expect(api.designPost).not.toHaveBeenCalled();
    await click('[data-action="redesign"]');
    await click('[data-action="redesign-yes"]');
    await flush();
    expect(api.designPost.mock.calls).toEqual([[ID, 'design/redesign']]);
    expect(calls[0]).toMatch(/^Design started again: the features and the tool are kept\. plan\.md and the kits are out of date/);
    expect(el.querySelector('[data-testid="redesign-confirm"]')).toBeNull();
  });

  it('Redesign shows in the Design series only, and only once the design has questions', async () => {
    const call: DesignCall = async () => null;
    const render = async (idea: any, state: any) => act(async () => root.render(
      <DesignSection idea={idea} design={{ state, designMd: '' }} busy={false} aiWorking={false} noAi={false} call={call} onSendQuestions={() => {}} />));
    await render(IDEA, designState());
    expect(el.querySelector('[data-action="redesign"]')).not.toBeNull();
    await render(IDEA, designState({ steps: [] }));
    expect(el.querySelector('[data-action="redesign"]')).toBeNull();
    await render({ ...IDEA, stage: 4 }, designState());
    expect(el.querySelector('[data-action="redesign"]')).toBeNull();
    await render({ ...IDEA, closed: { as: 'csic' } }, designState());
    expect(el.querySelector('[data-action="redesign"]')).toBeNull();
  });
});

describe('PlanSection after a Redesign', () => {
  it('says plan.md and the kits are out of date until written again', async () => {
    const call: DesignCall = async () => null;
    await act(async () => root.render(<PlanSection idea={IDEA} design={{ state: designState({ steps: [], planStale: '2026-10-20' }), designMd: '' }}
      plan={{ files: ['plan.md', 'kit/power-apps/README.md'] }} busy={false} aiWorking={false} noAi={false} call={call} />));
    expect(el.querySelector('[data-testid="plan-stale"]')!.textContent).toBe(
      'The design was started again on 2026-10-20: plan.md and the kits are out of date. Write them again once the new design is approved.');
    expect((el.querySelector('[data-action="write-plan"]') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('IdeaDetails design sections', () => {
  // Buttons that only show or open something (moving between questions, the design pack) stay usable; everything that changes data waits.
  const actionButtons = () => [...el.querySelectorAll('[data-testid="tool-picker"] button, [data-testid="design"] button')]
    .filter((b) => !/^(toggle-|open-outbox|prev-question|next-step|go-question|see-design)/.test(b.getAttribute('data-action') ?? '')) as HTMLButtonElement[];

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

  it('stage 2 (Review and Select, the first stage) shows Suggest a decision at once, the Email menu, no Emails section and nothing from the design series', async () => {
    useStore.setState({ state: { ...STATE, decisions: { select: 'Select (E3)' }, ideas: [{ ...IDEA, stage: 2 }] } } as any);
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    expect(el.querySelector('[data-testid="review"] [data-action="ai-suggest-review"]')).toBeTruthy();
    expect(el.querySelector('[data-action="email-menu"]')).toBeTruthy();
    expect([...el.querySelectorAll('h3')].map((h) => h.textContent)).not.toContain('Emails');
    expect(el.querySelector('[data-testid="tool-picker"]')).toBeNull();
    expect(el.textContent).not.toContain('The decision opens');
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
    // The saved decision is picked, with no reason box (the record keeps the reason it was saved with).
    expect((el.querySelector('[data-testid="review"] input[value="select"]') as HTMLInputElement).checked).toBe(true);
    expect(el.querySelector('[data-testid="review"] textarea.reason')).toBeNull();
  });

  it('stage 4 shows cards for tools, design and plan, with no editable form', async () => {
    api.ideaGet.mockImplementation(async (_id: string, what: string) => (what === 'design'
      ? { state: designState({ summary: 'Shows sorted requests.', approvedAt: '2026-10-20' }), designMd: '# Design' } : { files: ['plan.md'], planMd: '# Plan' }));
    useStore.setState({ state: { ...STATE, ideas: [{ ...IDEA, stage: 4 }] } } as any);
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    const card = el.querySelector('[data-testid="tools-card"]')!;
    expect(card.textContent).toContain('Power Apps · Assisted Citizen');
    expect(card.textContent).toContain('Request form');
    expect(el.querySelector('[data-testid="design-card"]')!.textContent).toContain('Shows sorted requests.');
    expect(el.querySelector('[data-testid="plan-card"]')!.textContent).toContain('plan.md');
    expect(el.querySelector('[data-testid="tool-picker"]')).toBeNull();
    expect(el.querySelector('[data-action="write-plan"]')).toBeNull();
    expect(el.querySelector('[data-testid="review-card"]')!.textContent).toContain('No decision recorded');
  });

  it('in Launch and Learn the decision, the tool and the design are shown without Edit; the plan can still be written again', async () => {
    api.ideaGet.mockImplementation(async (_id: string, what: string) => (what === 'design'
      ? { state: designState({ summary: 'Done.', approvedAt: '2026-10-20' }), designMd: '# Design' } : { files: ['plan.md'] }));
    useStore.setState({ state: { ...STATE, ideas: [{ ...IDEA, stage: 4 }] } } as any);
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    for (const card of ['review-card', 'tools-card', 'design-card']) {
      expect(el.querySelector(`[data-testid="${card}"]`)).toBeTruthy();
      expect(el.querySelector(`[data-action="edit-${card}"]`)).toBeNull();
    }
    expect(el.querySelector('[data-action="edit-plan-card"]')).toBeTruthy();
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

  it('the one suggested tool shows its pros, cons and fit per feature (why this tool folded), and Save posts it with the features', async () => {
    api.designPost.mockImplementation(async (_id: string, route: string, body: any) => (route === 'tools/suggest'
      ? { tool: SUGGESTED, provider: 'fake', state: designState({ features: [] }) }
      : { state: designState({ features: body.features.map((f: any, i: number) => ({ id: `f${i}`, ...f })), tool: body.tool }), designMd: '# Design' }));
    api.ideaGet.mockImplementation(async (_id: string, what: string) => (what === 'design' ? { state: designState({ features: [], tool: undefined }), designMd: '# Design' } : { files: [] }));
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    await click('[data-action="tools-add"]');
    await type(el.querySelector('.tp-row .tp-name') as HTMLInputElement, 'Request form');
    await click('[data-action="tools-add"]');
    await type([...el.querySelectorAll('.tp-row .tp-name')].pop() as HTMLInputElement, 'Reminders');
    await click('[data-action="tools-suggest"]');
    await flush();
    expect(api.designPost.mock.calls[0][2]).toEqual({ features: [{ name: 'Request form', flags: [] }, { name: 'Reminders', flags: [] }] });
    const pc = el.querySelector('[data-testid="tool-pros-cons"]')!;
    expect(pc.querySelector('.tp-pros li')!.textContent).toBe('Quick to build');
    expect(pc.querySelector('.tp-cons li')!.textContent).toBe("Can't send reminders on its own: add Power Automate");
    expect([...el.querySelectorAll('[data-testid="tool-fit"] li')].map((li) => li.getAttribute('data-fit'))).toEqual(['yes', 'no']);
    expect(el.querySelector('[data-testid="tool-fit"] li[data-fit="no"]')!.textContent).toContain('Add Power Automate');
    const ctx = el.querySelector('[data-testid="tool-context"]') as HTMLDetailsElement;
    expect(ctx.open).toBe(false);
    expect(ctx.textContent).toContain('No live system → Power Apps');
    await click('[data-action="tools-save"]');
    await flush();
    const saveCall = api.designPost.mock.calls.find((c: any[]) => c[1] === 'tools')!;
    expect(saveCall[2].features.map((f: any) => f.name)).toEqual(['Request form', 'Reminders']);
    expect(saveCall[2].tool).toMatchObject({ tool: 'Power Apps', by: 'ai', pros: ['Quick to build'], context: ['Form-shaped input', 'No live system → Power Apps'], fit: SUGGESTED.fit });
  });

  const toolPrep = (needs: any[]) => ({ at: '2026-10-21', provider: 'fake', needs });
  const OPEN = [{ id: 'n1', need: 'How a request arrives', ask: 'What does a request look like when it arrives?', met: false }, { id: 'n2', need: 'Who builds it', ask: 'Who builds?', met: false }];
  const withPrep = (needs: any[]) => api.ideaGet.mockImplementation(async (_id: string, what: string) => (what === 'design' ? { state: designState({ features: [], toolPrep: toolPrep(needs) }), designMd: '# Design' } : { files: [] }));

  it('the picker keeps a to-do list like the decision\'s: each item with its question and an answer box; Draft email and Re-evaluate', async () => {
    withPrep(OPEN);
    api.designPost.mockImplementation(async () => ({ state: designState({ features: [], toolPrep: toolPrep(OPEN) }), email: { template: 'E2' } }));
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    const todo = el.querySelector('[data-testid="tool-todo"]')!;
    expect([...todo.querySelectorAll('[data-need]')].map((n) => n.getAttribute('data-need'))).toEqual(['n1', 'n2']);
    expect(todo.querySelector('[data-testid="rs-count"]')!.textContent).toBe('2 open');
    expect(el.querySelector('[data-action="tools-suggest"]')).toBeNull();
    await click('[data-action="tools-draft-questions"]');
    await flush();
    expect(api.designPost.mock.calls.some((c: any[]) => c[1] === 'tools/prep/email')).toBe(true);
    // An answer typed in the box is saved against its item.
    const box = todo.querySelector('[data-need="n2"] textarea') as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, 'Person 2');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { box.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    await flush();
    expect(api.designPost.mock.calls.find((c: any[]) => c[1] === 'tools/prep/answer')?.[2]).toEqual({ need: 'n2', answer: 'Person 2' });
    await click('[data-action="tools-reevaluate"]');
    await flush();
    expect(api.designPost.mock.calls.filter((c: any[]) => c[1] === 'tools/suggest')).toHaveLength(1);
  });

  it('an answer from a team email counts against its item: it waits for Re-evaluate, and Draft email has nothing left to ask', async () => {
    withPrep([OPEN[0]]);
    useStore.setState({ state: { ...STATE, ideas: [{ ...IDEA, answers: [{ question: 'What does a request look like when it arrives', answer: 'An email to the shared mailbox', source: 'r.eml' }] }] } } as any);
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    expect(el.querySelector('[data-testid="tool-todo"] [data-testid="rs-from-email"]')!.textContent).toContain('An email to the shared mailbox');
    expect(el.querySelector('[data-testid="tool-todo"] [data-testid="rs-count"]')!.textContent).toBe('1 to re-evaluate');
    expect((el.querySelector('[data-action="tools-draft-questions"]') as HTMLButtonElement).disabled).toBe(true);
    expect(el.querySelector('[data-action="tools-reevaluate"]')!.className).toContain('primary');
  });
});
