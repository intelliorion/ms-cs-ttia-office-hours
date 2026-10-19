import { create } from 'zustand';
import { getState, getGraph } from '../api';
import { neighbourhood } from '../universe/graphView';

export type Popout =
  | null
  | { kind: 'idea'; id: string }
  | { kind: 'import' }
  | { kind: 'round' }
  | { kind: 'outbox' }
  | { kind: 'ai' };

export interface Notice { text: string; suggest?: unknown }

export interface AppState {
  state: any | null;
  graph: any | null;
  selectedId: string | null;
  hoverId: string | null;
  /** Show every label in the universe, not only ideas, teams, tools and entities. */
  labels: boolean;
  /** Bumped by Reset view; the universe flies home when it changes. */
  viewNonce: number;
  popout: Popout;
  notice: Notice | null;
  refresh: () => Promise<void>;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  toggleLabels: () => void;
  resetView: () => void;
  openPopout: (p: Exclude<Popout, null>) => void;
  closePopout: () => void;
  setNotice: (n: Notice | null) => void;
}

export const useStore = create<AppState>((set) => ({
  state: null, graph: null, selectedId: null, hoverId: null, labels: false, viewNonce: 0, popout: null, notice: null,
  refresh: async () => {
    try {
      const [state, graph] = await Promise.all([getState(), getGraph().catch(() => null)]);
      set({ state, graph });
    } catch (e) { set({ notice: { text: (e as Error).message } }); }
  },
  select: (id) => set({ selectedId: id }),
  hover: (id) => set({ hoverId: id }),
  toggleLabels: () => set((s) => ({ labels: !s.labels })),
  resetView: () => set((s) => ({ selectedId: null, viewNonce: s.viewNonce + 1 })),
  openPopout: (p) => set({ popout: p }),
  closePopout: () => set({ popout: null }),
  setNotice: (n) => set({ notice: n }),
}));

const isOpen = (i: any) => !i.closed;
const tally = (keys: string[]): [string, number][] => {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

export function ideasByStage(s: any): [string, number][] {
  const out: [string, number][] = Object.keys(s.stageNames).map((n) => [s.stageNames[n], s.ideas.filter((i: any) => isOpen(i) && i.stage === Number(n)).length]);
  out.push(['Closed', s.ideas.filter((i: any) => !isOpen(i)).length]);
  return out;
}

export function waitingSummary(s: any) {
  const open = s.ideas.filter(isOpen);
  const late = open.filter((i: any) => i.overdue.length > 0);
  return {
    drafts: s.outbox.filter((m: any) => m.status === 'draft').length,
    approved: s.outbox.filter((m: any) => m.status === 'approved').length,
    repliesDue: open.filter((i: any) => i.due?.s2d).length,
    late: late.length,
    lateIdeas: late.map((i: any) => i.id as string),
  };
}

export function supportCounts(s: any): [string, number][] {
  return tally(s.ideas.filter(isOpen).flatMap((i: any) => i.support as string[]));
}

export function functionRegion(s: any): [string, number][] {
  return tally(s.ideas.map((i: any) => `${i.function || '—'} · ${i.region || '—'}`));
}

/** The selected node and its direct neighbours, or null when nothing is selected. */
export function selectedNeighbourhood(s: Pick<AppState, 'graph' | 'selectedId'>): Set<string> | null {
  if (!s.selectedId || !s.graph) return null;
  return neighbourhood(s.graph, s.selectedId);
}
