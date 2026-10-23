import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

// The api module, mocked: every call is recorded.
const api = vi.hoisted(() => ({
  designPost: vi.fn(),
  ideaGet: vi.fn(),
  ideaPost: vi.fn(),
  getHistory: vi.fn(async () => []),
  post: vi.fn(async (): Promise<any> => ({})),
  copyText: vi.fn(async () => true),
  roadshowUpload: vi.fn(async () => ({})),
}));
vi.mock('../api', () => api);

import { useStore } from '../state/store';
import { IdeaDetails } from './IdeaDetails';
import { RoadshowSection } from './RoadshowSection';
import type { DesignCall } from './DesignSection';
import { deckFileUrl, mmss, roadshowNote, roadshowUrl, staleText } from './roadshowHelpers';
import { roadshowGate } from './stageGate';
import { fileNote, packFiles } from '../popouts/designPack';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};

const ID = 'CAFE-2026-001';
const IDEA = { id: ID, title: 'Weekend claim checker', slug: 'weekend-claim-checker', stage: 4, outcomes: [], support: [], people: { team: [] }, flags: [], overdue: [], answers: [] };
const STATE = { ideas: [IDEA], outbox: [], criteria: [], decisions: {}, steps: [], stageNames: { 2: 'Review', 3: 'Design series', 4: 'Launch and Learn' }, closures: {} };
const PEOPLE = [
  { key: 'person-1', name: 'Person 1', roles: 'Lead · Submitted the idea', initials: 'P1', photo: { url: '/api/ideas/CAFE-2026-001/roadshow/photos/person-1.png?v=1', from: 'path', at: '2026-10-23' } },
  { key: 'person-2', name: 'Person 2', roles: 'Builder', initials: 'P2' },
];
const DECK = {
  title: 'Weekend claim checker', at: '2026-10-23', provider: 'fake', renderedAt: '2026-10-23', files: ['deck.html', 'script.md', 'run-of-show.md', 'deck.pptx'],
  warnings: ['Slide 2: took out "Saves 300 hours" (a figure the record does not hold)'], template: { applied: false, note: 'No firm template is set.' },
  slides: [{ kind: 'title', title: 'Weekend claim checker', minutes: 0.5 }, { kind: 'team', title: 'The team', minutes: 0.5, visual: 'team' }, { kind: 'demo', title: 'The demo', minutes: 3 }],
  minutes: 4,
};
const view = (extra: any = {}) => ({ people: PEOPLE, stale: { record: false, photos: false }, ...extra });

let el: HTMLDivElement;
let root: Root;
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };
const click = async (sel: string) => {
  const b = el.querySelector(sel) as HTMLButtonElement | null;
  if (!b) throw new Error(`no ${sel}`);
  await act(async () => { b.click(); });
};
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  for (const f of Object.values(api)) f.mockClear();
  useStore.setState({ state: STATE, graph: { nodes: [], edges: [] }, ai: { provider: 'fake', label: 'Fake (test)' }, notice: null, suggest: null, refresh: async () => {} } as any);
});
afterEach(() => { act(() => root.unmount()); el.remove(); vi.restoreAllMocks(); });

describe('the roadshow helpers', () => {
  it('links to the deck files: the deck, the print window for the PDF, the PowerPoint as a download', () => {
    expect(roadshowUrl(ID, 'build')).toBe('/api/ideas/CAFE-2026-001/roadshow/build');
    expect(deckFileUrl(ID, 'deck.html')).toBe('/api/ideas/CAFE-2026-001/roadshow/files/deck.html');
    expect(deckFileUrl(ID, 'deck.html', { print: true })).toBe('/api/ideas/CAFE-2026-001/roadshow/files/deck.html?print=1');
    expect(deckFileUrl(ID, 'deck.pptx', { download: true })).toBe('/api/ideas/CAFE-2026-001/roadshow/files/deck.pptx?download=1');
  });
  it('says what is out of date and what fixes it', () => {
    expect(staleText(view())).toBeNull();
    expect(staleText(view({ deck: DECK, stale: { record: true, photos: true } }))).toMatchObject({ fix: 'build' });
    expect(staleText(view({ deck: DECK, stale: { record: false, photos: true } }))).toMatchObject({ fix: 'render', text: expect.stringMatching(/no AI needed/) });
    expect(roadshowNote(view({ deck: DECK }))).toBe('3 slides · about 4:00');
    expect(roadshowNote(view())).toBe('not started');
    expect(mmss(10.5)).toBe('10:30');
  });
  it('the section lives in Launch and Learn only; in the Design series it is hidden even with a deck', () => {
    expect(roadshowGate({ stage: 4 }, null)).toBe('active');
    expect(roadshowGate({ stage: 3 }, null)).toBe('hidden');
    expect(roadshowGate({ stage: 3 }, { deck: {}, prep: {} })).toBe('hidden');
    expect(roadshowGate({ stage: 2 }, { deck: {} })).toBe('hidden');
    expect(roadshowGate({ stage: 3, closed: {} }, { deck: {} })).toBe('hidden');
    expect(roadshowGate({ stage: 4, closed: {} }, { prep: {} })).toBe('hidden');
    expect(roadshowGate({ stage: 4, closed: {} }, { deck: {} })).toBe('summary');
  });
  it('the design pack leaves the roadshow files to the Roadshow section', () => {
    expect(fileNote('roadshow/script.md').title).toBe('roadshow/script.md');
    expect(packFiles(['plan.md', 'roadshow/script.md', 'roadshow/run-of-show.md'], true)).toEqual(['design.md', 'approach.md', 'plan.md']);
  });
});

describe('RoadshowSection', () => {
  const call: DesignCall = async (fn) => { try { return await fn(); } catch { return null; } };
  const mount = async (v: any, opts: { noAi?: boolean; idea?: any } = {}) => {
    await act(async () => root.render(
      <RoadshowSection idea={opts.idea ?? IDEA} view={v} busy={false} aiWorking={false} noAi={Boolean(opts.noAi)} aiName={() => 'Fake'} call={call} />,
    ));
  };

  it('one row per person: the photo, or the initials; a typed path is sent for that person', async () => {
    await mount(view());
    const rows = [...el.querySelectorAll('.rsh-person')];
    expect(rows.map((r) => r.getAttribute('data-person'))).toEqual(['person-1', 'person-2']);
    expect((rows[0].querySelector('img') as HTMLImageElement).getAttribute('src')).toBe(PEOPLE[0].photo!.url);
    expect(rows[1].querySelector('.rsh-ph.ini')!.textContent).toBe('P2');
    expect(rows[1].textContent).toContain('Builder');
    const input = rows[1].querySelector('input[type=text]') as HTMLInputElement;
    expect((rows[1].querySelector('[data-action="photo-use"]') as HTMLButtonElement).disabled).toBe(true);
    await type(input, '/Users/me/Pictures/p2.png');
    await click('.rsh-person[data-person="person-2"] [data-action="photo-use"]');
    expect(api.post).toHaveBeenCalledWith('/api/ideas/CAFE-2026-001/roadshow/photo', { person: 'person-2', path: '/Users/me/Pictures/p2.png' });
    await click('.rsh-person[data-person="person-1"] [data-action="photo-remove"]');
    expect(api.post).toHaveBeenLastCalledWith('/api/ideas/CAFE-2026-001/roadshow/photo/remove', { person: 'person-1' });
    expect(el.querySelector('.rsh-person[data-person="person-2"] [data-action="photo-remove"]')).toBeNull();
  });

  it('a file chosen with the picker goes up for that person', async () => {
    await mount(view());
    const input = el.querySelector('.rsh-person[data-person="person-2"] input[type=file]') as HTMLInputElement;
    const file = new File([new Uint8Array([0x89, 0x50])], 'p2.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await flush();
    expect(api.roadshowUpload).toHaveBeenCalledWith(ID, 'person-2', file);
  });

  it('first Suggest; then the to-do list with Draft email and Re-evaluate, as the decision has', async () => {
    await mount(view());
    expect(el.querySelector('[data-testid="rsh-todo"] [data-testid="rs-count"]')).toBeNull();
    await click('[data-action="roadshow-suggest"]');
    expect(api.post).toHaveBeenLastCalledWith('/api/ideas/CAFE-2026-001/roadshow/suggest');
    await mount(view({ prep: { at: '2026-10-23', provider: 'fake', needs: [{ id: 'n1', need: 'What was hard', ask: 'What was hard?', met: false }, { id: 'n2', need: 'The demo', ask: 'How will you demo it?', met: true, note: 'A link' }] } }));
    expect(el.querySelector('[data-testid="rsh-todo"] [data-testid="rs-count"]')!.textContent).toBe('1 open');
    await click('[data-action="roadshow-draft-questions"]');
    expect(api.post).toHaveBeenLastCalledWith('/api/ideas/CAFE-2026-001/roadshow/prep/email');
    await click('[data-action="roadshow-reevaluate"]');
    expect(api.post).toHaveBeenLastCalledWith('/api/ideas/CAFE-2026-001/roadshow/suggest');
    // A pasted answer is saved on blur.
    const box = el.querySelector('.rs-need[data-need="n1"] textarea') as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, 'Finding weekend claims in the sample');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { box.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    expect(api.post).toHaveBeenLastCalledWith('/api/ideas/CAFE-2026-001/roadshow/prep/answer', { need: 'n1', answer: 'Finding weekend claims in the sample' });
  });

  it('Build the deck; once built: the slides, Present, the script, PowerPoint and PDF, the template note and what the code took out', async () => {
    await mount(view());
    expect(el.querySelector('[data-testid="deck-links"]')).toBeNull();
    await click('[data-action="deck-build"]');
    expect(api.post).toHaveBeenLastCalledWith('/api/ideas/CAFE-2026-001/roadshow/build');
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    await mount(view({ deck: DECK }));
    expect([...el.querySelectorAll('[data-testid="deck-slides"] li')].map((li) => li.getAttribute('data-kind'))).toEqual(['title', 'team', 'demo']);
    expect(el.querySelector('[data-action="deck-build"]')!.textContent).toBe('Rebuild the deck');
    await click('[data-action="deck-present"]');
    expect(open).toHaveBeenLastCalledWith('/api/ideas/CAFE-2026-001/roadshow/files/deck.html', '_blank', 'noopener');
    await click('[data-action="deck-script"]');
    expect(open).toHaveBeenLastCalledWith('/api/ideas/CAFE-2026-001/roadshow/files/script.md', '_blank', 'noopener');
    await click('[data-action="deck-pdf"]');
    expect(open).toHaveBeenLastCalledWith('/api/ideas/CAFE-2026-001/roadshow/files/deck.html?print=1', '_blank', 'noopener');
    const pptx = el.querySelector('[data-action="deck-pptx"]') as HTMLAnchorElement;
    expect(pptx.getAttribute('href')).toBe('/api/ideas/CAFE-2026-001/roadshow/files/deck.pptx?download=1');
    expect(pptx.hasAttribute('download')).toBe(true);
    expect(el.querySelector('[data-testid="deck-template"]')!.textContent).toBe('No firm template is set.');
    expect(el.querySelector('[data-testid="deck-warnings"]')!.textContent).toContain('Saves 300 hours');
    await click('[data-action="open-idea-folder"]');
    expect(api.post).toHaveBeenLastCalledWith('/api/ideas/CAFE-2026-001/open-folder');
  });

  it('out of date: new photos offer Update the files (no AI); a changed record offers Rebuild', async () => {
    await mount(view({ deck: DECK, stale: { record: false, photos: true } }));
    expect(el.querySelector('[data-testid="deck-stale"]')!.textContent).toMatch(/photos changed/);
    await click('[data-action="deck-render"]');
    expect(api.post).toHaveBeenLastCalledWith('/api/ideas/CAFE-2026-001/roadshow/render');
    await mount(view({ deck: DECK, stale: { record: true, photos: false } }));
    expect(el.querySelector('[data-action="deck-rebuild"]')).toBeTruthy();
  });

  it('with no AI, Suggest and Build wait; the photos still work', async () => {
    await mount(view(), { noAi: true });
    expect((el.querySelector('[data-action="roadshow-suggest"]') as HTMLButtonElement).disabled).toBe(true);
    expect((el.querySelector('[data-action="deck-build"]') as HTMLButtonElement).disabled).toBe(true);
    expect((el.querySelector('.rsh-person input[type=text]') as HTMLInputElement).disabled).toBe(false);
  });
});

describe('in the idea panel', () => {
  const ideaGet = (roadshow: any) => async (_id: string, what: string) => (what === 'design'
    ? { state: { version: 1, status: 'approved', features: [], steps: [], summary: 'Done.', approvedAt: '2026-10-20' }, designMd: '' }
    : what === 'roadshow' ? roadshow : { files: [] });

  it('Launch and Learn: the Roadshow section is the active work, under the read-only cards', async () => {
    api.ideaGet.mockImplementation(ideaGet(view()));
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    expect(api.ideaGet).toHaveBeenCalledWith(ID, 'roadshow');
    expect(el.querySelector('[data-testid="roadshow"]')).toBeTruthy();
    expect(el.querySelector('[data-action="edit-design-card"]')).toBeNull();
    const order = [...el.querySelectorAll('.id-scroll > section')].map((s) => s.getAttribute('data-testid'));
    expect(order.at(-1)).toBe('roadshow');
  });

  it('before Launch and Learn there is no Roadshow; a closed idea with a deck shows it as a card', async () => {
    api.ideaGet.mockImplementation(ideaGet(view()));
    useStore.setState({ state: { ...STATE, ideas: [{ ...IDEA, stage: 3 }] } } as any);
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    expect(el.querySelector('[data-testid="roadshow"]')).toBeNull();
    act(() => root.unmount());
    api.ideaGet.mockImplementation(ideaGet(view({ deck: DECK })));
    useStore.setState({ state: { ...STATE, ideas: [{ ...IDEA, closed: { as: 'pattern' } }] } } as any);
    root = createRoot(el);
    await act(async () => root.render(<IdeaDetails id={ID} />));
    await flush();
    expect(el.querySelector('[data-testid="roadshow"]')).toBeNull();
    expect(el.querySelector('[data-testid="roadshow-card"] [data-action="deck-present"]')).toBeTruthy();
  });
});
