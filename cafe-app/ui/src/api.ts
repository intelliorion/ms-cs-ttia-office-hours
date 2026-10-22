import { filenameHeader } from './popouts/inboxHelpers';

export class ApiError extends Error {
  missing?: string[];
  constructor(message: string, missing?: string[]) { super(message); this.missing = missing; }
}

async function handle<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, data.missing);
  return data as T;
}

export const getState = () => fetch('/api/state').then((r) => handle<any>(r));
export const getGraph = () => fetch('/api/graph').then((r) => handle<any>(r));
export const post = (url: string, body: unknown = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => handle<any>(r));
export const getHistory = (id: string) => fetch(`/api/ideas/${encodeURIComponent(id)}/history`).then((r) => handle<any[]>(r));
export const ideaPost = (id: string, what: 'stage' | 'review' | 'draft' | 'reply', body: unknown = {}) =>
  post(`/api/ideas/${encodeURIComponent(id)}/${what}`, body);

/** Puts text on the clipboard. False when the browser refuses, so the caller can show it selected instead. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export const getAiStatus = () => fetch('/api/ai/status').then((r) => handle<any>(r));

export const getInbox = () => fetch('/api/inbox').then((r) => handle<any>(r));
/** A dropped file goes up as its own bytes; the server keeps it as dropped. */
export const inboxDropFile = (file: File) =>
  fetch('/api/inbox/drop', { method: 'POST', headers: { 'x-filename': filenameHeader(file.name), 'content-type': 'application/octet-stream' }, body: file }).then((r) => handle<any>(r));
export const inboxPost = (id: string, what: 'apply' | 'undo' | 'choose' | 'dismiss' | 'delete' | 'draft-held-reply' | 'process' | 'dismiss-action', body: unknown = {}) =>
  post(`/api/inbox/${encodeURIComponent(id)}/${what}`, body);

/** The design series: GET an idea's design (state + live design.md) or its plan (plan.md + kit files). */
export const ideaGet = (id: string, what: 'design' | 'plan') => fetch(`/api/ideas/${encodeURIComponent(id)}/${what}`).then((r) => handle<any>(r));
export type DesignRoute = 'tools/suggest' | 'tools' | 'design/step' | 'design/answer' | 'design/finish' | 'design/approve' | 'plan' | 'tools/questions/clear';
export const designPost = (id: string, what: DesignRoute, body: unknown = {}) => post(`/api/ideas/${encodeURIComponent(id)}/${what}`, body);

/** The Café assistant: conversations, one conversation's messages, and a message sent with live progress. */
export const getChat = () => fetch('/api/chat').then((r) => handle<{ threads: any[]; current: { thread: any; entries: any[] } }>(r));
export const getThread = (id: string) => fetch(`/api/chat/threads/${encodeURIComponent(id)}`).then((r) => handle<{ thread: any; entries: any[] }>(r));
export const chatPost = (id: string, what: 'do' | 'cancel' | 'undo', actionId?: string) =>
  post(`/api/chat/${encodeURIComponent(id)}/${what}`, actionId ? { actionId } : {});
/**
 * Sends one message and reads the server's progress lines as they come (each step the agent takes), then the message.
 * Aborting the signal is Stop: the server finishes the step it is on and stops.
 */
export async function chatStream(body: { text: string; focus?: string | null; mentions?: string[]; thread?: string | null }, onProgress: (p: any) => void, signal?: AbortSignal): Promise<any> {
  const res = await fetch('/api/chat', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
    body: JSON.stringify({ text: body.text, ...(body.focus ? { focus: body.focus } : {}), ...(body.mentions?.length ? { mentions: body.mentions } : {}), ...(body.thread ? { thread: body.thread } : {}) }),
  });
  if (!res.ok || !res.body) return handle<any>(res);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      if (ev.type === 'progress') onProgress(ev);
      else if (ev.type === 'done') return ev.data;
      else if (ev.type === 'error') throw new ApiError(ev.error);
    }
  }
  throw new ApiError('The answer was cut off. Try again.');
}
