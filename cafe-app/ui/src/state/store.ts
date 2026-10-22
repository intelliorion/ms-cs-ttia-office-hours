import { create } from 'zustand';
import { getState, getGraph, getAiStatus, getInbox } from '../api';
import type { AiStatus } from '../popouts/aiUi';
import type { InboxView } from '../popouts/inboxHelpers';

export type Popout =
  | null
  | { kind: 'import' }
  | { kind: 'round' }
  | { kind: 'outbox' }
  | { kind: 'inbox' }
  | { kind: 'ai' };

/** A move the app offers after a review or a sent email. Applied only when the operator says yes. */
export interface Suggest { id: string; stage?: number; closeAs?: string; label: string }
export type Drawer = 'ideas' | 'charts' | null;
/** Pill label for the Focus button. */
export const focusLabel = (on: boolean) => (on ? 'Show panels' : 'Focus');
const FOCUS_KEY = 'cafe-focus';
export function readFocus(): boolean { try { return localStorage.getItem(FOCUS_KEY) === '1'; } catch { return false; } }
function writeFocus(on: boolean) { try { localStorage.setItem(FOCUS_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ } }
/** Should the F shortcut act? Not while typing, with a modifier, or with a pop-out open. */
export function focusKeyApplies(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target?: any }, popoutOpen: boolean): boolean {
  if ((e.key !== 'f' && e.key !== 'F') || e.ctrlKey || e.metaKey || e.altKey || popoutOpen) return false;
  const t = e.target; const tag = String(t?.tagName ?? '').toUpperCase();
  return !(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable);
}

/** How much the universe draws: Full (bloom), Lite (no post-processing, soft halos), Flat (the 2D map). */
export type Quality = 'full' | 'lite' | 'flat';
const QUALITIES: Quality[] = ['full', 'lite', 'flat'];
const QUALITY_KEY = 'cafe-quality';
const QUALITY_HAND_KEY = 'cafe-quality-by-hand';
export const nextQuality = (q: Quality): Quality => QUALITIES[(QUALITIES.indexOf(q) + 1) % QUALITIES.length];
export const qualityLabel = (q: Quality) => `Quality: ${q[0].toUpperCase()}${q.slice(1)}`;
/** The stored quality, or null when this browser has none yet. */
export function readQuality(): Quality | null {
  try { const v = localStorage.getItem(QUALITY_KEY); return QUALITIES.includes(v as Quality) ? (v as Quality) : null; } catch { return null; }
}
/** Was the stored quality picked by the operator (so nothing switches it automatically)? */
export function readQualityByHand(): boolean { try { return localStorage.getItem(QUALITY_HAND_KEY) === '1'; } catch { return false; } }
export function writeQuality(q: Quality, byHand: boolean) {
  try { localStorage.setItem(QUALITY_KEY, q); localStorage.setItem(QUALITY_HAND_KEY, byHand ? '1' : '0'); } catch { /* storage unavailable */ }
}
/** A software WebGL renderer (virtual desktops, headless browsers): full quality draws a few frames a second there. */
export function detectSoftwareGl(renderer: string | null): boolean {
  if (!renderer) return false;
  return /swiftshader|llvmpipe|softpipe|software|mesa offscreen|microsoft basic render|gdi generic|apple software/i.test(renderer);
}
export const SOFTWARE_NOTICE = 'Lite quality picked for this browser (software graphics). Change it with the Quality button.';
export const SLOW_NOTICE = 'Switched to Lite quality: this browser was drawing under 20 fps.';

/** The rest of the universe starts 80% hidden each time something new comes into view; 50% at least, 100% only what is in view. */
export const DEFAULT_HIDE = 0.8;
export const MIN_HIDE = 0.5;
export const clampHide = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(MIN_HIDE, Math.round(v * 100) / 100)) : DEFAULT_HIDE);
/** Something new in view (a click, a pick, a lit answer): the slider starts again at the default. */
const FRESH = { hideUnlit: DEFAULT_HIDE };

export interface Notice { text: string; kind?: 'ok' | 'error' }

/** What the left (Ideas) panel shows: the list, or one idea's details with a Back button. */
export type LeftView = { kind: 'list' } | { kind: 'idea'; id: string };
export const LIST_VIEW: LeftView = { kind: 'list' };
/** Below 1000px the side panels are drawers (see theme.css). */
export function isNarrow(): boolean { try { return window.matchMedia('(max-width: 999px)').matches; } catch { return false; } }
/**
 * Opening an idea: the left panel shows its details, its star is selected (the universe flies to it),
 * any modal closes, Focus turns off so the panel shows, and on a narrow window the Ideas drawer opens to host it.
 */
export function openIdeaPatch(id: string, narrow: boolean) {
  return { leftView: { kind: 'idea', id } as LeftView, selectedId: `idea:${id}`, selectedIds: [] as string[], popout: null, focus: false, drawer: (narrow ? 'ideas' : null) as Drawer };
}
/** Back to the list: the selection and the camera stay; the idea's notice and suggestion go. */
export function backPatch() { return { leftView: LIST_VIEW, notice: null, suggest: null }; }
export type EscAction = 'none' | 'blur' | 'back' | 'drawer' | 'deselect';
/** What Esc does, in order: a modal handles its own; a text field lets go; idea details go back; a drawer closes; a star card closes. */
export function escAction(s: { modal: boolean; leftView: LeftView; detailsVisible: boolean; drawer: Drawer; card: boolean; target?: any }): EscAction {
  if (s.modal) return 'none';
  const t = s.target; const tag = String(t?.tagName ?? '').toUpperCase();
  const typing = tag === 'TEXTAREA' || (tag === 'INPUT' && !/^(checkbox|radio|button|submit)$/i.test(String(t?.type ?? ''))) || t?.isContentEditable;
  if (typing && s.leftView.kind === 'idea' && s.detailsVisible) return 'blur';
  if (s.leftView.kind === 'idea' && s.detailsVisible) return 'back';
  if (s.drawer) return 'drawer';
  if (s.card) return 'deselect';
  return 'none';
}

export interface AppState {
  state: any | null;
  graph: any | null;
  selectedId: string | null;
  /** Two or more stars picked with Ctrl/⌘+click (empty otherwise; selectedId is then the one star, or the last one picked). */
  selectedIds: string[];
  /** The stars a command-bar answer rests on, lit in the universe until cleared. */
  highlight: string[] | null;
  setHighlight: (ids: string[] | null) => void;
  /** While something is in view: how much of the rest is hidden, 0.5 to 1 (1 shows only what is in view). Back to 80% when something new comes into view. */
  hideUnlit: number;
  /** Kinds of star switched off in the picture only (the bottom bar's Show filter). Not remembered. */
  hiddenTypes: string[];
  toggleType: (type: string) => void;
  showAllTypes: () => void;
  setHideUnlit: (v: number) => void;
  hoverId: string | null;
  /** Show every label in the universe, not only ideas, teams, tools and entities. */
  labels: boolean;
  /** Bumped by Reset view; the universe flies home when it changes. */
  viewNonce: number;
  /** Only the open idea's one-hop neighbourhood is drawn; off again on Back. */
  /** Focus mode: only the universe (and the title bar) show. */
  focus: boolean;
  toggleFocus: () => void;
  quality: Quality;
  /** The operator picked the quality with the button: never switch it automatically. */
  qualitySetByHand: boolean;
  setQuality: (q: Quality) => void;
  cycleQuality: () => void;
  /** First load only (nothing stored): a software renderer starts in Lite, with a notice. */
  autoPickQuality: (renderer: string | null) => void;
  /** The fps watchdog: Full drew under 20 fps, so drop to Lite once (unless set by hand). */
  slowQuality: () => void;
  popout: Popout;
  leftView: LeftView;
  /** Show an idea's details in the left panel (and select its star). */
  openIdea: (id: string) => void;
  /**
   * A click on a star: an idea opens; any other star shows on the right with the list on the left; a lit answer ends.
   * In focus mode the panels stay hidden: the click only selects the star (its neighbourhood shows in the universe).
   * With Ctrl/⌘ (additive) the star joins the selection, or leaves it if it was in; two or more make a multi-selection.
   */
  clickStar: (id: string | null, additive?: boolean) => void;
  backToList: () => void;
  notice: Notice | null;
  suggest: Suggest | null;
  ai: AiStatus | null;
  /** What GET /api/inbox said last; null until read or when it can't be read. */
  inbox: InboxView | null;
  refreshInbox: () => Promise<void>;
  /** Below 1000px wide the side panels become drawers; which one is open. */
  drawer: Drawer;
  setDrawer: (d: Drawer) => void;
  refreshAi: () => Promise<void>;
  refresh: () => Promise<void>;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  toggleLabels: () => void;
  resetView: () => void;
  openPopout: (p: Exclude<Popout, null>) => void;
  closePopout: () => void;
  setNotice: (n: Notice | null) => void;
  setSuggest: (s: Suggest | null) => void;
}

export const useStore = create<AppState>((set) => ({
  state: null, graph: null, selectedId: null, selectedIds: [], highlight: null, hideUnlit: DEFAULT_HIDE, hiddenTypes: [], hoverId: null, labels: false, viewNonce: 0, focus: readFocus(), quality: readQuality() ?? 'full', qualitySetByHand: readQualityByHand(), popout: null, leftView: LIST_VIEW, notice: null, suggest: null, ai: null, inbox: null, drawer: null,
  setDrawer: (d) => set({ drawer: d }),
  refreshInbox: async () => { try { set({ inbox: await getInbox() }); } catch { /* keep the last one */ } },
  refreshAi: async () => { try { set({ ai: await getAiStatus() }); } catch { set({ ai: null }); } },
  refresh: async () => {
    try {
      let graphError: string | null = null;
      const [state, graph] = await Promise.all([getState(), getGraph().catch((e: Error) => { graphError = e.message; return null; })]);
      // Keep the old graph (or its layout) when nothing changed, so the universe and its camera stay where they are.
      // A graph that cannot be read never blanks a universe that is already loaded.
      set((s) => ({
        state, graph: graph ? keepSame(s.graph, graph) : s.graph,
        ...(graphError ? { notice: { text: `Couldn't refresh the universe: ${graphError}`, kind: 'error' as const } } : {}),
      }));
    } catch (e) { set({ notice: { text: (e as Error).message, kind: 'error' } }); }
  },
  select: (id) => set({ selectedId: id, selectedIds: [], ...FRESH }),
  hover: (id) => set({ hoverId: id }),
  toggleLabels: () => set((s) => ({ labels: !s.labels })),
  resetView: () => set((s) => ({ selectedId: null, selectedIds: [], viewNonce: s.viewNonce + 1 })),
  // Entering focus starts clean; leaving it keeps the star clicked in focus mode, so the panels show it.
  toggleFocus: () => set((s) => { writeFocus(!s.focus); return { focus: !s.focus, drawer: null, selectedId: s.focus ? s.selectedId : null, selectedIds: s.focus ? s.selectedIds : [], viewNonce: s.viewNonce + 1 }; }),
  setQuality: (q) => { writeQuality(q, true); set({ quality: q, qualitySetByHand: true }); },
  cycleQuality: () => set((s) => { const q = nextQuality(s.quality); writeQuality(q, true); return { quality: q, qualitySetByHand: true }; }),
  autoPickQuality: (renderer) => {
    if (readQuality() !== null || !detectSoftwareGl(renderer)) return;
    writeQuality('lite', false);
    set({ quality: 'lite', qualitySetByHand: false, notice: { text: SOFTWARE_NOTICE, kind: 'ok' } });
  },
  slowQuality: () => set((s) => {
    if (s.quality !== 'full' || s.qualitySetByHand) return {};
    writeQuality('lite', false);
    return { quality: 'lite', notice: { text: SLOW_NOTICE, kind: 'ok' } };
  }),
  openPopout: (p) => set({ popout: p, drawer: null }),
  openIdea: (id) => set((s) => { if (s.focus) writeFocus(false); return { ...openIdeaPatch(id, isNarrow()), ...FRESH }; }),
  backToList: () => set(backPatch()),
  clickStar: (id, additive = false) => set((s) => {
    if (!id) return { selectedId: null, selectedIds: [] };
    // Something new in view: the slider starts again at the default.
    if (additive) {
      const now = s.selectedIds.length ? s.selectedIds : s.selectedId ? [s.selectedId] : [];
      const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
      if (next.length >= 2) return { ...(s.leftView.kind === 'idea' && !s.focus ? backPatch() : {}), selectedIds: next, selectedId: next[next.length - 1], highlight: null, ...FRESH };
      return { selectedIds: [], selectedId: next[0] ?? null, highlight: null, ...FRESH };
    }
    if (s.focus) return { selectedId: id, selectedIds: [], highlight: null, ...FRESH };
    if (id.startsWith('idea:')) return { ...openIdeaPatch(id.slice(5), isNarrow()), highlight: null, ...FRESH };
    return { ...(s.leftView.kind === 'idea' ? backPatch() : {}), selectedId: id, selectedIds: [], highlight: null, ...FRESH };
  }),
  closePopout: () => set({ popout: null, suggest: null, notice: null }),
  setNotice: (n) => set({ notice: n }),
  setHighlight: (ids) => set({ highlight: ids?.length ? ids : null, ...(ids?.length ? FRESH : {}) }),
  setHideUnlit: (v) => set({ hideUnlit: clampHide(v) }),
  toggleType: (type) => set((s) => ({ hiddenTypes: s.hiddenTypes.includes(type) ? s.hiddenTypes.filter((t) => t !== type) : [...s.hiddenTypes, type] })),
  showAllTypes: () => set({ hiddenTypes: [] }),
  setSuggest: (x) => set({ suggest: x }),
}));

/** Structural sharing for the graph: same content keeps the same object, and an unchanged layout keeps its object. */
export function keepSame(prev: any, next: any): any {
  if (!prev || !next) return next;
  if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
  if (prev.layout && JSON.stringify(prev.layout) === JSON.stringify(next.layout)) return { ...next, layout: prev.layout };
  return next;
}

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
    repliesDue: open.filter((i: any) => i.due?.s2d && !i.checklist?.s2d?.done).length,
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

