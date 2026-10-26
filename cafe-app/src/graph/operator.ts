import path from 'node:path';
import { paths } from '../workspace/paths';
import { readText, writeFileAtomic } from '../workspace/files';
import type { OperatorEdit } from './ontology';
import { touched } from '../memory/touch';

const file = (root: string) => path.join(paths(root).graph, 'operator.jsonl');

/** The operator's edits, oldest first. A line that does not parse is skipped. */
export async function readEdits(root: string): Promise<OperatorEdit[]> {
  const text = (await readText(file(root))) ?? '';
  const out: OperatorEdit[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { const v = JSON.parse(line); if (v && typeof v === 'object' && typeof v.t === 'string') out.push(v as OperatorEdit); } catch { /* skipped */ }
  }
  return out;
}

async function writeEdits(root: string, edits: OperatorEdit[]): Promise<void> {
  await writeFileAtomic(file(root), edits.map((e) => JSON.stringify(e)).join('\n') + (edits.length ? '\n' : ''));
}

export async function appendEdit(root: string, edit: OperatorEdit): Promise<void> {
  await writeEdits(root, [...(await readEdits(root)), edit]);
  // Deep read's upkeep refreshes the star labels (a rename or merge changes no passage).
  if (edit.t === 'rename' || edit.t === 'merge') touched(root, [], 'stars');
}

export async function setEditStatus(root: string, id: string, status: OperatorEdit['status']): Promise<OperatorEdit> {
  const edits = await readEdits(root);
  const hit = edits.find((e) => e.id === id);
  if (!hit) throw new Error(`No edit ${id}`);
  hit.status = status;
  await writeEdits(root, edits);
  return hit;
}

/** The next free edit id: op-1, op-2, … */
export async function nextEditId(root: string): Promise<string> {
  const n = Math.max(0, ...(await readEdits(root)).map((e) => Number(e.id.replace(/^op-/, '')) || 0));
  return `op-${n + 1}`;
}
