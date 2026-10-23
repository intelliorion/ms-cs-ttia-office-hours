/**
 * Where the Data step keeps things: the copies of the dropped files in the idea folder's data-files/ (never anywhere
 * else), and what was made of them in design.yaml's data section. Every change re-renders design.md.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { ideaDir, loadIdea } from '../ideas/store';
import { readDesign, writeDesign, writeDesignMd, type DesignState } from '../design/store';
import { DATA_DIR, emptyData, type DataFile, type DataState } from './model';

export class DataStepError extends Error {}

export const dataFolder = async (root: string, id: string) => path.join(await ideaDir(root, id), DATA_DIR);

/** A stored copy's name: the file id and the name as dropped, made safe for any file system. */
export const copyName = (fid: string, name: string) =>
  `${fid}-${path.basename(name).replace(/[^\w.() -]+/g, '_').replace(/^[.\s]+/, '').slice(-80) || 'file'}`;

/** The copy of a dropped file, by its stored name (checked: inside data-files/, no folders). */
export async function copyPath(root: string, id: string, file: string): Promise<string> {
  if (!/^f\d{1,4}-[\w.() -]{1,90}$/.test(file) || file.includes('..')) throw new DataStepError('Not a data file');
  return path.join(await dataFolder(root, id), file);
}

export async function readData(root: string, id: string): Promise<DataState> {
  return (await readDesign(root, id)).data ?? emptyData();
}

/** Reads the design, lets `fn` change its data section, writes both design.yaml and design.md. */
export async function updateData<T>(root: string, id: string, fn: (data: DataState, design: DesignState) => T): Promise<{ data: DataState; state: DesignState; out: T }> {
  const state = await readDesign(root, id);
  const data = state.data ?? emptyData();
  const out = fn(data, state);
  state.data = data;
  await writeDesign(root, id, state);
  await writeDesignMd(root, await loadIdea(root, id), state);
  return { data, state, out };
}

export function fileOf(data: DataState, fid: string): DataFile {
  const f = data.files.find((x) => x.id === fid);
  if (!f) throw new DataStepError('That file is gone: drop it again');
  return f;
}

/** A change to what the data holds: the confirmation goes (it was for what it said before), and with `summary` the AI's "complete" too. */
export function reopenData(data: DataState, opts: { summary?: boolean } = {}): void {
  delete data.confirmedAt;
  delete data.points;
  if (opts.summary) delete data.summary;
}

export const nextFileId = (data: DataState) => `f${data.files.reduce((m, f) => Math.max(m, Number(f.id.slice(1)) || 0), 0) + 1}`;

/** Removes a copy (only ever inside data-files/). */
export async function removeCopy(root: string, id: string, file: string): Promise<void> {
  await fs.rm(await copyPath(root, id, file), { force: true });
}
