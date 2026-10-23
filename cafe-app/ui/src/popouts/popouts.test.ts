import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), post: vi.fn(async () => ({})) }));
import { ApiError, post } from '../api';
import { useStore } from '../state/store';
import { TitleBar } from '../layout/TitleBar';
import { RoundPopout } from './RoundPopout';
import { RoundChip } from './IdeaSections';
import { importReportLines, roundFieldsUnblock, baseName } from './titleHelpers';

describe('importReportLines', () => {
  it('words new ideas, skipped rows, unread rows, unused columns and flags', () => {
    const lines = importReportLines({
      created: [{ id: 'CAFE-2026-001', title: 'Faster onboarding' }],
      duplicates: [{ row: 3, id: 'CAFE-2026-000', title: 'Old one' }],
      errors: [{ row: 5, message: 'No title' }],
      flags: [{ id: 'CAFE-2026-001', message: 'Cut off in the export' }],
      ignoredColumns: ['Colour', 'Mood'],
    }).map((l) => l.text);
    expect(lines).toContain('1 new idea added');
    expect(lines).toContain('CAFE-2026-001: Faster onboarding');
    expect(lines).toContain('1 row skipped because it is already in the Café');
    expect(lines).toContain('Row 3 skipped: already CAFE-2026-000 (Old one)');
    expect(lines).toContain('Row 5 not read: No title');
    expect(lines).toContain('2 columns not used: Colour, Mood');
    expect(lines).toContain('CAFE-2026-001: Cut off in the export');
  });
  it('says plainly when nothing was added', () => {
    const lines = importReportLines({ created: [], duplicates: [], errors: [], flags: [], ignoredColumns: [] });
    expect(lines).toEqual([{ kind: 'ok', text: 'No new ideas added' }]);
  });
});

describe('roundFieldsUnblock', () => {
  it('maps each field to the emails it unblocks', () => {
    expect(roundFieldsUnblock('deadline')).toBe('Needed for E0, E0B');
    expect(roundFieldsUnblock('reviewBy')).toBe('Needed for E1');
    expect(roundFieldsUnblock('seriesStart')).toBe('Used for session dates later');
    expect(roundFieldsUnblock('roadshow')).toBe('Used for the roadshow later');
    expect(roundFieldsUnblock('formLink')).toBe('Needed for E0, E0B');
    expect(roundFieldsUnblock('csicLink')).toBe('Needed for E5, E9, E11');
    expect(roundFieldsUnblock('teamsLink')).toBe('Needed for E7, E10, RS, SR');
    expect(roundFieldsUnblock('distList')).toBe('Needed for E0, E0B');
    expect(roundFieldsUnblock('deckTemplate')).toBe('Used for the roadshow deck later');
    expect(roundFieldsUnblock('operatorName')).toBe('Needed for every email');
    expect(roundFieldsUnblock('open')).toBe('');
  });
});

describe('small helpers', () => {
  it('shows only the file name', () => {
    expect(baseName('/Users/me/cafe/exports/review-pack.md')).toBe('review-pack.md');
    expect(baseName('C:\\x\\review-pack.md')).toBe('review-pack.md');
  });
});

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = () => ({
  today: '2026-10-22',
  rounds: [
    { id: 'ROUND-002', name: 'Spring pilots', created: '2026-10-20' },
    { id: 'ROUND-001', name: '2026 Q4', created: '2026-10-01', deadline: '2026-11-01' },
  ],
  ideas: [
    { id: 'CAFE-2026-001', title: 'Faster onboarding', round: 'ROUND-001' },
    { id: 'CAFE-2026-002', title: 'Badge kiosk', round: '' },
    { id: 'CAFE-2026-003', title: 'Desk finder', round: '' },
  ],
  outbox: [],
  fields: { round: [['open', 'Round opens'], ['deadline', 'Submission deadline']], settings: [['operatorName', 'Your name']] },
  settings: { capacity: { ideasPerRound: 3, sessionsPerWeek: 2 } },
});

/** Types into a controlled input or select the way React hears it. */
function typeInto(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

describe('title bar and the Rounds pop-out', () => {
  let el: HTMLDivElement;
  let root: Root;
  let refresh: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.mocked(post).mockClear();
    refresh = vi.fn(async () => {});
    useStore.setState({ state: fixture() as any, refresh, refreshAi: vi.fn(async () => {}), refreshInbox: vi.fn(async () => {}), inbox: null, ai: null, notice: null, popout: null });
    el = document.createElement('div'); document.body.appendChild(el);
    root = createRoot(el);
  });
  afterEach(() => { act(() => root.unmount()); el.remove(); });
  const q = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector(sel) as T;
  const flush = () => act(async () => { await Promise.resolve(); });

  it('has Import and Rounds buttons and no status.csv', () => {
    act(() => root.render(createElement(TitleBar)));
    const labels = [...el.querySelectorAll('.btns button')].map((b) => b.textContent);
    expect(labels).toContain('⤓Import'); // the icon is kept
    expect(labels).toContain('Rounds');
    expect(labels.some((t) => /status\.csv|Inbox/.test(t ?? ''))).toBe(false);
    expect(el.querySelector('[data-action="status-csv"]')).toBeNull();
    act(() => q<HTMLButtonElement>('[data-action="round"]').click());
    expect(useStore.getState().popout).toEqual({ kind: 'round' });
  });

  it('lists the rounds newest first with their idea counts', () => {
    // Handed over oldest first: the pop-out must still show the newest (by created) at the top.
    const st = fixture();
    useStore.setState({ state: { ...st, rounds: [...st.rounds].reverse() } as any });
    act(() => root.render(createElement(RoundPopout)));
    const rows = [...el.querySelectorAll('[data-round]')];
    expect(rows.map((r) => r.getAttribute('data-round'))).toEqual(['ROUND-002', 'ROUND-001']);
    expect(rows.map((r) => r.querySelector('.rnd-name')?.textContent)).toEqual(['Spring pilots', '2026 Q4']);
    expect(rows.map((r) => r.querySelector('.rnd-n')?.textContent)).toEqual(['0 ideas', '1 idea']);
    expect(rows[1].querySelector('[data-idea="CAFE-2026-001"]')?.textContent).toContain('Faster onboarding');
    expect([...el.querySelectorAll('.rnd-free [data-idea]')].map((x) => x.getAttribute('data-idea'))).toEqual(['CAFE-2026-002', 'CAFE-2026-003']);
  });

  it('names a round.yaml it could not read', () => {
    useStore.setState({ state: { ...fixture(), roundProblems: [{ folder: 'ROUND-003', message: 'bad yaml' }] } as any });
    act(() => root.render(createElement(RoundPopout)));
    expect(q('[data-testid="round-problem"]').textContent).toBe('Could not read rounds/ROUND-003/round.yaml');
  });

  it('creates a round with the typed name', async () => {
    act(() => root.render(createElement(RoundPopout)));
    const name = q<HTMLInputElement>('[data-field="round-name"]');
    // "2026 Q4" is taken by ROUND-001, so the name offered is numbered on.
    expect(name.value).toBe('2026 Q4 (2)');
    act(() => typeInto(name, 'Winter clinic'));
    act(() => q<HTMLButtonElement>('[data-action="create-round"]').click());
    await flush();
    expect(post).toHaveBeenCalledWith('/api/rounds', { name: 'Winter clinic' });
    expect(refresh).toHaveBeenCalled();
    expect(name.value).toBe(''); // no second round with the same name by a second click
  });

  it('puts the ticked ideas in the picked round', async () => {
    act(() => root.render(createElement(RoundPopout)));
    const assign = () => q<HTMLButtonElement>('[data-action="assign"]');
    expect(assign().disabled).toBe(true);
    expect(assign().textContent).toBe('Pick ideas to put in Spring pilots');
    act(() => { q<HTMLInputElement>('.rnd-free input[value="CAFE-2026-002"]').click(); q<HTMLInputElement>('.rnd-free input[value="CAFE-2026-003"]').click(); });
    act(() => typeInto(q<HTMLSelectElement>('[data-field="assign-round"]'), 'ROUND-001'));
    expect(assign().textContent).toBe('Put 2 ideas in 2026 Q4');
    act(() => assign().click());
    await flush();
    expect(post).toHaveBeenCalledWith('/api/rounds/ROUND-001/ideas', { ideaIds: ['CAFE-2026-002', 'CAFE-2026-003'] });
    expect(refresh).toHaveBeenCalled();
  });

  it('takes an idea out of its round', async () => {
    act(() => root.render(createElement(RoundPopout)));
    act(() => q<HTMLButtonElement>('[data-round="ROUND-001"] [data-action="take-out"][data-idea="CAFE-2026-001"]').click());
    await flush();
    expect(post).toHaveBeenCalledWith('/api/ideas/CAFE-2026-001/round', { round: '' });
  });

  it('saves one round\'s dates to its own route', async () => {
    act(() => root.render(createElement(RoundPopout)));
    const box = q('[data-round="ROUND-001"]');
    expect((box.querySelector('[data-field="deadline"]') as HTMLInputElement).value).toBe('2026-11-01');
    act(() => (box.querySelector('[data-action="save-round"]') as HTMLButtonElement).click());
    await flush();
    expect(post).toHaveBeenCalledWith('/api/rounds/ROUND-001', { open: '', deadline: '2026-11-01' });
  });

  it('the round chip names the round and moves the idea', async () => {
    act(() => root.render(createElement(RoundChip, { ideaId: 'CAFE-2026-001', round: 'ROUND-001' })));
    const chip = q<HTMLButtonElement>('.rnd-wrap [data-action="round-chip"]');
    expect(chip.textContent).toContain('2026 Q4');
    act(() => chip.click());
    expect([...document.querySelectorAll('[data-testid="round-menu"] [data-action="round-pick"]')].map((b) => b.textContent))
      .toEqual(['Spring pilots', '✓2026 Q4', 'No round']);
    act(() => q<HTMLButtonElement>('[data-testid="round-menu"] [data-value=""]').click());
    await flush();
    expect(post).toHaveBeenCalledWith('/api/ideas/CAFE-2026-001/round', { round: '' });
    expect(refresh).toHaveBeenCalled();
  });

  it('the round chip comes back from busy even when the refresh fails', async () => {
    refresh.mockRejectedValueOnce(new Error('offline'));
    act(() => root.render(createElement(RoundChip, { ideaId: 'CAFE-2026-001', round: 'ROUND-001' })));
    act(() => q<HTMLButtonElement>('.rnd-wrap [data-action="round-chip"]').click());
    act(() => q<HTMLButtonElement>('[data-testid="round-menu"] [data-value=""]').click());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(q<HTMLButtonElement>('.rnd-wrap [data-action="round-chip"]').disabled).toBe(false);
  });

  it('the round chip says No round when the idea has none', () => {
    act(() => root.render(createElement(RoundChip, { ideaId: 'CAFE-2026-002', round: '' })));
    expect(q('.rnd-wrap [data-action="round-chip"]').textContent).toContain('No round');
  });
});
