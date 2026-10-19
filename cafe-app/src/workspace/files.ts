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

export async function writeFileAtomic(file: string, content: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, file);
}

export async function writeYaml(file: string, data: unknown): Promise<void> {
  await writeFileAtomic(file, YAML.stringify(data));
}

export interface HistoryEntry {
  at: string;
  action: string;
  by: 'operator' | 'app';
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
