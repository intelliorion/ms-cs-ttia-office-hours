import { promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export async function readText(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}

export async function readYaml<T>(file: string): Promise<T | undefined> {
  const text = await readText(file);
  return text === undefined ? undefined : (YAML.parse(text) as T);
}

/** Windows refuses a rename while another program has the file open: antivirus scanning a file just written, or OneDrive syncing it. */
const HELD = new Set(['EPERM', 'EACCES', 'EBUSY']);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Moves a file. A rename Windows refuses for a moment is tried again for up to `retryMs`, backing off; if it is
 * still refused, the file is copied over and the original removed (best effort), so the operator never has to.
 */
export async function moveFile(from: string, to: string, opts: { retryMs?: number } = {}): Promise<void> {
  const until = Date.now() + (opts.retryMs ?? 3000);
  for (let wait = 25; ; wait = Math.min(wait * 2, 500)) {
    try { await fs.rename(from, to); return; } catch (e) {
      if (!HELD.has((e as NodeJS.ErrnoException).code ?? '')) throw e;
      if (Date.now() >= until) break;
      await pause(wait);
    }
  }
  await fs.copyFile(from, to);
  await fs.rm(from, { force: true }).catch(() => {});
}

export async function writeFileAtomic(file: string, content: string | Uint8Array, opts: { retryMs?: number } = {}): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await fs.writeFile(tmp, content);
  try { await moveFile(tmp, file, opts); } catch (e) { await fs.rm(tmp, { force: true }).catch(() => {}); throw e; }
}

export async function writeYaml(file: string, data: unknown): Promise<void> {
  await writeFileAtomic(file, YAML.stringify(data));
}

export interface HistoryEntry {
  at: string;
  action: string;
  /** 'ai': a change the AI proposed and the code checked and applied (updates from answers). */
  by: 'operator' | 'app' | 'ai';
  step?: string;
  source?: string;
  detail?: string;
}

export async function appendHistory(dir: string, entry: HistoryEntry): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.appendFile(path.join(dir, 'history.log'), `${JSON.stringify(entry)}\n`, 'utf8');
}

export async function readHistory(dir: string): Promise<HistoryEntry[]> {
  const text = await readText(path.join(dir, 'history.log'));
  if (!text) return [];
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as HistoryEntry);
}
