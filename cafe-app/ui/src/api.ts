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
  fetch('/api/inbox/drop', { method: 'POST', headers: { 'x-filename': file.name, 'content-type': 'application/octet-stream' }, body: file }).then((r) => handle<any>(r));
export const inboxDropText = (text: string, name?: string) => post('/api/inbox/drop', name ? { text, name } : { text });
export const inboxPost = (id: string, what: 'apply' | 'undo' | 'choose' | 'dismiss' | 'delete' | 'draft-held-reply', body: unknown = {}) =>
  post(`/api/inbox/${encodeURIComponent(id)}/${what}`, body);
