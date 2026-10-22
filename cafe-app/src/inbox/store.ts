import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { paths } from '../workspace/paths';
import { readText, writeFileAtomic } from '../workspace/files';
import { slugify } from '../ideas/store';
import { systemClock, type Clock } from '../clock';
import { typeOfName, type InboxMeta, type InboxType } from './parse';

export type InboxStatus = 'new' | 'triaged' | 'applied' | 'held' | 'dismissed';

/**
 * One dropped item. The dropped file stays as-is under inbox/ (or inbox/held/);
 * this sidecar JSON in inbox/.items/<id>.json is the only metadata (no database).
 */
export interface InboxItem {
  id: string;
  /** Workspace-relative path with forward slashes, e.g. inbox/2026-10-20-reply.eml */
  file: string;
  name: string;
  type: InboxType;
  /** sha256 of the dropped bytes; the dedupe key. */
  hash: string;
  receivedAt: string;
  status: InboxStatus;
  text?: string;
  meta?: InboxMeta;
  hold?: { reasons: string[] };
  /** Filled by Task 2 (triage). */
  triage?: unknown;
  /** Filled by Task 3 (actions). */
  actions?: unknown[];
  problems?: string[];
  /** The run, step by step (src/inbox/steps.ts). */
  steps?: import('./steps').Step[];
  /** Where a held file was before it moved to inbox/held/ (lets an interrupted hold finish the move). */
  heldFrom?: string;
  /** Only on the value saveDrop returns for a repeat drop; never stored. */
  duplicate?: true;
}

const ID = /^in-[0-9a-f]{12}$/;

export const itemsDir = (root: string) => path.join(paths(root).inbox, '.items');
const sidecar = (root: string, id: string) => {
  if (!ID.test(id)) throw new Error(`Not an inbox item: ${id}`);
  return path.join(itemsDir(root), `${id}.json`);
};
const abs = (root: string, rel: string) => path.join(root, ...rel.split('/'));
const exists = (p: string) => fs.access(p).then(() => true, () => false);

async function writeItem(root: string, item: InboxItem): Promise<void> {
  const { duplicate: _omit, ...stored } = item;
  await writeFileAtomic(sidecar(root, item.id), `${JSON.stringify(stored, null, 2)}\n`);
}

async function freeName(dir: string, base: string, ext: string): Promise<string> {
  for (let n = 1; ; n++) {
    const name = `${base}${n === 1 ? '' : `-${n}`}${ext}`;
    if (!(await exists(path.join(dir, name)))) return name;
  }
}

/** Store a dropped file (bytes) or pasted text. The same content dropped again returns the first item with duplicate: true. */
export async function saveDrop(root: string, name: string, data: Uint8Array | string, clock: Clock = systemClock): Promise<InboxItem> {
  const isText = typeof data === 'string';
  const bytes = isText ? new TextEncoder().encode(data) : data;
  const hash = createHash('sha256').update(bytes).digest('hex');
  const existing = (await listItems(root)).find((i) => i.hash === hash);
  if (existing) return { ...existing, duplicate: true };

  const fileName = isText && !/\.(txt|md)$/i.test(name) ? `${name}.txt` : name;
  const ext = path.extname(fileName).toLowerCase();
  const base = `${clock()}-${slugify(path.basename(fileName, path.extname(fileName)))}`;
  const inbox = paths(root).inbox;
  const stored = await freeName(inbox, base, ext);
  await writeFileAtomic(path.join(inbox, stored), bytes);

  // Only what identifies the file: its text and meta are written by triage once the screen has passed.
  const item: InboxItem = {
    id: `in-${hash.slice(0, 12)}`,
    file: `inbox/${stored}`,
    name,
    type: typeOfName(fileName),
    hash,
    receivedAt: `${clock()}T${new Date().toISOString().slice(11)}`, // the clock's date, the real time of day
    status: 'new',
  };
  await writeItem(root, item);
  return item;
}

/** All items, newest first. A sidecar that can't be read is skipped and named in `problems` (if given). */
export async function listItems(root: string, problems?: string[]): Promise<InboxItem[]> {
  const names = (await fs.readdir(itemsDir(root)).catch(() => [] as string[])).filter((n) => /^in-[0-9a-f]{12}\.json$/.test(n));
  const items: InboxItem[] = [];
  for (const n of names.sort()) {
    try {
      const text = await readText(path.join(itemsDir(root), n));
      const item = text ? (JSON.parse(text) as InboxItem) : undefined;
      if (!item || typeof item.id !== 'string' || typeof item.hash !== 'string') throw new Error('not an item');
      items.push(item);
    } catch {
      problems?.push(`Couldn't read inbox/.items/${n}`);
    }
  }
  return items.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)) || a.id.localeCompare(b.id));
}

export async function getItem(root: string, id: string): Promise<InboxItem | undefined> {
  if (!ID.test(id)) return undefined;
  const text = await readText(sidecar(root, id));
  return text ? (JSON.parse(text) as InboxItem) : undefined;
}

export async function updateItem(root: string, id: string, patch: Partial<InboxItem>): Promise<InboxItem> {
  const item = await getItem(root, id);
  if (!item) throw new Error(`No inbox item ${id}`);
  const next: InboxItem = { ...item, ...patch, id: item.id, hash: item.hash };
  await writeItem(root, next);
  return next;
}

/**
 * Hold an item: keep only the subject and the sender's display name, drop the text and everything else
 * read from it, and move the file to inbox/held/. The cleared sidecar is written first, so a crash
 * mid-way never leaves personal data in it; calling again finishes the move and changes nothing else.
 */
export async function holdItem(root: string, id: string, reasons: string[], read?: InboxMeta): Promise<InboxItem> {
  const item = await getItem(root, id);
  if (!item) throw new Error(`No inbox item ${id}`);
  let file = item.file;
  let heldFrom = item.heldFrom;
  if (!file.startsWith('inbox/held/')) {
    const held = paths(root).held;
    await fs.mkdir(held, { recursive: true });
    const ext = path.extname(file);
    heldFrom = file;
    file = `inbox/held/${await freeName(held, path.basename(file, ext), ext)}`;
  }
  const seen = item.meta ?? read;
  const from = seen?.from?.replace(/<[^>]*>/g, '').replace(/^"|"$/g, '').trim();
  // Read by the AI (a picture): the transcription is not kept, and the sidecar says the AI read it.
  const byAi = (read?.readBy ?? seen?.readBy) === 'ai';
  const meta: InboxMeta = {
    ...(seen?.subject ? { subject: seen.subject } : {}),
    ...(from && !from.includes('@') ? { from } : {}),
    ...(byAi ? { readBy: 'ai' as const } : {}),
  };
  const next: InboxItem = {
    id: item.id,
    file,
    name: item.name,
    type: item.type,
    hash: item.hash,
    receivedAt: item.receivedAt,
    status: 'held',
    ...(byAi ? { text: '' } : {}),
    meta,
    hold: { reasons },
    ...(item.problems?.length ? { problems: item.problems } : {}),
    // The run so far (what the screen said), so the Import shows where it stopped.
    ...(item.steps?.length ? { steps: item.steps } : {}),
    ...(heldFrom ? { heldFrom } : {}),
  };
  await writeItem(root, next);
  if (heldFrom && !(await exists(abs(root, file))) && (await exists(abs(root, heldFrom)))) {
    await fs.rename(abs(root, heldFrom), abs(root, file));
  }
  return next;
}

/** Delete a held item's file and its sidecar. Only held items can be deleted. */
export async function deleteHeld(root: string, id: string): Promise<void> {
  const item = await getItem(root, id);
  if (!item) throw new Error(`No inbox item ${id}`);
  if (item.status !== 'held') throw new Error('Only held items can be deleted');
  await fs.rm(abs(root, item.file), { force: true });
  await fs.rm(sidecar(root, id), { force: true });
}
