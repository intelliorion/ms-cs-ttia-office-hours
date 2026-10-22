import { create } from 'zustand';
import { chatPost, chatStream, getChat, getThread } from '../api';
import type { ChatEntryView } from '../layout/commandHelpers';

export interface ChatStepView { kind: 'search' | 'read'; text: string; found?: number }
export interface ThreadMeta { id: string; title: string; updated: number; count: number }

/** The message being worked on: what was sent and the steps the agent has taken so far, live from the server. */
export interface Running { text: string; about?: string; steps: ChatStepView[]; thinking: boolean }

interface ChatState {
  open: boolean;
  thread: { id: string; title: string } | null;
  entries: ChatEntryView[];
  threads: ThreadMeta[];
  running: Running | null;
  busy: boolean;
  error: string | null;
  /** Bumped to ask the composer to take focus (Ctrl/⌘+K, a follow-up, a new chat). */
  focusNonce: number;
  load: () => Promise<void>;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  newChat: () => void;
  openThread: (id: string) => Promise<void>;
  send: (m: { text: string; focus?: string[] | null; about?: string; mentions?: string[] }) => Promise<ChatEntryView | null>;
  stop: () => void;
  act: (id: string, what: 'do' | 'cancel' | 'undo', actionId?: string) => Promise<ChatEntryView | null>;
}

let controller: AbortController | null = null;

export const useChat = create<ChatState>((set, get) => ({
  open: false, thread: null, entries: [], threads: [], running: null, busy: false, error: null, focusNonce: 0,
  load: async () => {
    try {
      const r = await getChat();
      // A conversation already on screen stays; otherwise the latest one comes back.
      set((s) => (s.thread || s.entries.length || s.running ? { threads: r.threads } : { threads: r.threads, thread: r.current.thread, entries: r.current.entries }));
    } catch { /* the panel opens empty */ }
  },
  setOpen: (open) => set((s) => ({ open, focusNonce: open ? s.focusNonce + 1 : s.focusNonce })),
  toggle: () => get().setOpen(!get().open),
  newChat: () => set((s) => ({ thread: null, entries: [], error: null, focusNonce: s.focusNonce + 1 })),
  openThread: async (id) => {
    try { const r = await getThread(id); set({ thread: r.thread, entries: r.entries, error: null }); } catch (e) { set({ error: (e as Error).message }); }
  },
  send: async ({ text, focus, about, mentions }) => {
    const t = text.trim();
    if (!t || get().running) return null;
    controller = new AbortController();
    set({ running: { text: t, about, steps: [], thinking: true }, error: null });
    try {
      const entry = await chatStream({ text: t, focus, mentions, thread: get().thread?.id }, (p) => {
        const r = get().running; if (!r) return;
        if (p.stage === 'step') set({ running: { ...r, steps: [...r.steps, p.step], thinking: false } });
        else set({ running: { ...r, thinking: true } });
      }, controller.signal);
      set((s) => ({
        entries: [...s.entries, entry], running: null,
        thread: s.thread ?? { id: entry.thread, title: t.slice(0, 60) },
      }));
      void getChat().then((r) => set({ threads: r.threads })).catch(() => {});
      return entry;
    } catch (e) {
      const stopped = (e as Error).name === 'AbortError';
      set({ running: null, error: stopped ? 'Stopped. Nothing was changed.' : (e as Error).message });
      return null;
    } finally { controller = null; }
  },
  stop: () => { controller?.abort(); },
  act: async (id, what, actionId) => {
    set({ busy: true, error: null });
    try {
      const e = await chatPost(id, what, actionId);
      set((s) => ({ entries: s.entries.map((x) => (x.id === e.id ? e : x)) }));
      return e;
    } catch (err) { set({ error: (err as Error).message }); return null; } finally { set({ busy: false }); }
  },
}));
