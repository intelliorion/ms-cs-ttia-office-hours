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

/** The command bar: the operator's commands, the agent's replies and the actions waiting for "Do it". */
export const getChat = () => fetch('/api/chat').then((r) => handle<{ entries: any[] }>(r));
export const chatSend = (text: string, focus?: string | null, mentions: string[] = []) =>
  post('/api/chat', { text, ...(focus ? { focus } : {}), ...(mentions.length ? { mentions } : {}) });
export const chatPost = (id: string, what: 'do' | 'cancel' | 'undo', actionId?: string) =>
  post(`/api/chat/${encodeURIComponent(id)}/${what}`, actionId ? { actionId } : {});
