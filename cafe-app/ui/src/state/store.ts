import { create } from 'zustand';
import { getState, getGraph, getAiStatus, getInbox } from '../api';
import type { AiStatus } from '../popouts/aiUi';
import type { InboxView } from '../popouts/inboxHelpers';
import { DEFAULT_LABELS, nextLabelMode, paletteFor, type LabelMode } from '../universe/graphView';

export type Popout =
  | null
  | { kind: 'import' }
  | { kind: 'round' }
  | { kind: 'inbox' }
  | { kind: 'ai' }
  | { kind: 'config' }
  /** Everything the design series made for one idea. */
  | { kind: 'design-pack'; id: string };

/** A move the app offers after a review or a sent email. Applied only when the operator says yes. */
export interface Suggest { id: string; stage?: number; closeAs?: string; label: string }
export type Drawer = 'ideas' | 'charts' | null;
/** Pill label for the Focus button. */
export const focusLabel = (on: boolean) => (on ? 'Show panels' : 'Focus');
/** The look: Default (the night sky) or Frost (a light winter morning). Remembered in this browser only. */
export type Theme = 'default' | 'frost' | 'blueprint' | 'workshop';
export const THEMES: { id: Theme; name: string; note: string }[] = [
  { id: 'default', name: 'Default', note: 'Night sky: glowing stars on dark' },
  { id: 'frost', name: 'Frost', note: 'Winter morning: baubles on light' },
  { id: 'blueprint', name: 'Blueprint', note: 'Drafting table: wireframes on blue' },
  { id: 'workshop', name: 'Workshop', note: 'Hardware store: gears, hammers, pegboard' },
];
const THEME_KEY = 'cafe-theme';
/** The stage colours for the theme in use (light themes need deeper ones). */
export const useStageRing = (): Record<string, string> => paletteFor(useStore((s) => s.theme)).ring;
export function readTheme(): Theme {
  try { const t = localStorage.getItem(THEME_KEY); // 'mech' was the robot theme Workshop replaced.
    return t === 'frost' || t === 'blueprint' || t === 'workshop' ? t : t === 'mech' ? 'workshop' : 'default'; } catch { return 'default'; }
}
function writeTheme(t: Theme) { try { localStorage.setItem(THEME_KEY, t); } catch { /* storage unavailable */ } }
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

/** How much of the rest of the universe is hidden while something is in view: 80% at first, 50% at least, 100% only what is in view. */
export const DEFAULT_HIDE = 0.8;
export const MIN_HIDE = 0.5;
export const clampHide = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(MIN_HIDE, Math.round(v * 100) / 100)) : DEFAULT_HIDE);
/** The picture's settings are remembered in this browser: the slider level, the labels, the kinds of star switched off. */
const HIDE_KEY = 'cafe-hide';
const LABELS_KEY = 'cafe-labels';
const HIDDEN_TYPES_KEY = 'cafe-hidden-types';
const remember = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
const recall = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
export function readHide(): number { const v = recall(HIDE_KEY); return v === null ? DEFAULT_HIDE : clampHide(Number(v)); }
export function readLabels(): LabelMode { const v = recall(LABELS_KEY); return v === 'full' || v === 'smart' || v === 'none' ? v : DEFAULT_LABELS; }
export function readHiddenTypes(): string[] {
  try { const v = JSON.parse(recall(HIDDEN_TYPES_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : []; } catch { return []; }
}
const writeHiddenTypes = (t: string[]) => { remember(HIDDEN_TYPES_KEY, JSON.stringify(t)); return t; };

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
/** Where the panels were before a link was followed: what the left panel showed and which star was picked. */
export interface Spot { leftView: LeftView; selectedId: string | null }
/** Most links followed in a row that Back remembers. */
export const TRAIL_MAX = 30;
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
  /** While something is in view: how much of the rest is hidden, 0.5 to 1 (1 shows only what is in view). Remembered in this browser. */
  hideUnlit: number;
  /** Kinds of star switched off in the picture only (the bottom bar's Show filter). Not remembered. */
  hiddenTypes: string[];
  toggleType: (type: string) => void;
  showAllTypes: () => void;
  setHideUnlit: (v: number) => void;
  hoverId: string | null;
  /** Show every label in the universe, not only ideas, teams, tools and entities. */
  labels: LabelMode;
  setLabels: (m: LabelMode) => void;
  /** Bumped by Reset view; the universe flies home when it changes. */
  viewNonce: number;
  /** Only the open idea's one-hop neighbourhood is drawn; off again on Back. */
  /** Focus mode: only the universe (and the title bar) show. */
  focus: boolean;
  toggleFocus: () => void;
  quality: Quality;
  theme: Theme;
  setTheme: (t: Theme) => void;
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
  /** Where Back goes after following links from the Connections or Star panel, newest last. Any other move clears it. */
  trail: Spot[];
  /** A click on a link: remember where the panels are, then go to that star as a click on it would. */
  followLink: (id: string) => void;
  /** Back along the trail: the panels and the picked star as they were before the last link was followed. */
  goBack: () => void;
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

/** What a click on a star changes (see clickStar). */
function clickPatch(s: AppState, id: string | null, additive = false): Partial<AppState> {
  if (!id) return { selectedId: null, selectedIds: [] };
  if (additive) {
    const now = s.selectedIds.length ? s.selectedIds : s.selectedId ? [s.selectedId] : [];
    const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
    if (next.length >= 2) return { ...(s.leftView.kind === 'idea' && !s.focus ? backPatch() : {}), selectedIds: next, selectedId: next[next.length - 1], highlight: null };
    return { selectedIds: [], selectedId: next[0] ?? null, highlight: null };
  }
  if (s.focus) return { selectedId: id, selectedIds: [], highlight: null };
  if (id.startsWith('idea:')) return { ...openIdeaPatch(id.slice(5), isNarrow()), highlight: null };
  return { ...(s.leftView.kind === 'idea' ? backPatch() : {}), selectedId: id, selectedIds: [], highlight: null };
}

export const useStore = create<AppState>((set) => ({
  state: null, graph: null, selectedId: null, selectedIds: [], highlight: null, hideUnlit: readHide(), hiddenTypes: readHiddenTypes(), hoverId: null, labels: readLabels(), viewNonce: 0, focus: readFocus(), quality: readQuality() ?? 'full', theme: readTheme(), qualitySetByHand: readQualityByHand(), popout: null, leftView: LIST_VIEW, trail: [], notice: null, suggest: null, ai: null, inbox: null, drawer: null,
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
  select: (id) => set({ selectedId: id, selectedIds: [], trail: [] }),
  hover: (id) => set({ hoverId: id }),
  toggleLabels: () => set((s) => { const labels = nextLabelMode(s.labels); remember(LABELS_KEY, labels); return { labels }; }),
  setLabels: (m) => { remember(LABELS_KEY, m); set({ labels: m }); },
  resetView: () => set((s) => ({ selectedId: null, selectedIds: [], trail: [], viewNonce: s.viewNonce + 1 })),
  // Entering focus starts clean; leaving it keeps the star clicked in focus mode, so the panels show it.
  toggleFocus: () => set((s) => { writeFocus(!s.focus); return { focus: !s.focus, drawer: null, selectedId: s.focus ? s.selectedId : null, selectedIds: s.focus ? s.selectedIds : [], viewNonce: s.viewNonce + 1 }; }),
  setQuality: (q) => { writeQuality(q, true); set({ quality: q, qualitySetByHand: true }); },
  setTheme: (t) => { writeTheme(t); set({ theme: t }); },
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
  openIdea: (id) => set((s) => { if (s.focus) writeFocus(false); return { ...openIdeaPatch(id, isNarrow()), trail: [] }; }),
  backToList: () => set({ ...backPatch(), trail: [] }),
  clickStar: (id, additive = false) => set((s) => ({ ...clickPatch(s, id, additive), trail: [] })),
  followLink: (id) => set((s) => ({
    ...clickPatch(s, id),
    trail: [...s.trail, { leftView: s.leftView, selectedId: s.selectedId }].slice(-TRAIL_MAX),
  })),
  goBack: () => set((s) => {
    const to = s.trail.at(-1); if (!to) return {};
    return { leftView: to.leftView, selectedId: to.selectedId, selectedIds: [], highlight: null, notice: null, suggest: null, trail: s.trail.slice(0, -1) };
  }),
  closePopout: () => set({ popout: null, suggest: null, notice: null }),
  setNotice: (n) => set({ notice: n }),
  setHighlight: (ids) => set({ highlight: ids?.length ? ids : null }),
  setHideUnlit: (v) => { const hideUnlit = clampHide(v); remember(HIDE_KEY, String(hideUnlit)); set({ hideUnlit }); },
  toggleType: (type) => set((s) => ({ hiddenTypes: writeHiddenTypes(s.hiddenTypes.includes(type) ? s.hiddenTypes.filter((t) => t !== type) : [...s.hiddenTypes, type]) })),
  showAllTypes: () => set({ hiddenTypes: writeHiddenTypes([]) }),
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


export function supportCounts(s: any): [string, number][] {
  return tally(s.ideas.filter(isOpen).flatMap((i: any) => i.support as string[]));
}

export function functionRegion(s: any): [string, number][] {
  return tally(s.ideas.map((i: any) => `${i.function || '—'} · ${i.region || '—'}`));
}

