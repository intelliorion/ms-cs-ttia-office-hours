import path from 'node:path';
import { paths } from '../workspace/paths';
import { readText, writeFileAtomic } from '../workspace/files';
import { listIdeas } from '../ideas/store';
import { listRounds } from '../round/store';
import { buildGraph } from './build';
import { appendEdit, nextEditId, readEdits } from './operator';
import { MERGEABLE, type AiLink, type GEdge, type GNode } from './ontology';
import type { Clock } from '../clock';
import { registryFrom } from './registryFile';
import { loadRules } from './rules';

const file = (root: string, name: string) => path.join(paths(root).graph, name);

export interface LineProblem { line: number; message: string }

/** Lines of ai-links.jsonl: each parsed link, or the raw text of a line that would not parse. */
async function readLines(root: string): Promise<{ raw: string; n: number; link?: AiLink }[]> {
  const text = await readText(file(root, 'ai-links.jsonl'));
  return (text ?? '').split('\n').map((raw, i) => ({ raw, n: i + 1 })).filter((l) => l.raw.trim()).map((l) => {
    try {
      const v = JSON.parse(l.raw) as unknown;
      return v && typeof v === 'object' && !Array.isArray(v) ? { ...l, link: v as AiLink } : l;
    } catch { return l; }
  });
}

/** The AI links, skipping any line that does not parse; those come back as problems with their line number. */
export async function readAiLinks(root: string): Promise<{ links: AiLink[]; problems: LineProblem[] }> {
  const links: AiLink[] = []; const problems: LineProblem[] = [];
  for (const l of await readLines(root)) {
    if (l.link) links.push(l.link);
    else problems.push({ line: l.n, message: `ai-links.jsonl line ${l.n} could not be read and was skipped` });
  }
  return { links, problems };
}

/** Rewrites the whole file atomically, so it is never torn. Unreadable lines are kept as they were. */
async function writeLines(root: string, lines: { raw: string; link?: AiLink }[]): Promise<void> {
  const text = lines.map((l) => (l.link ? JSON.stringify(l.link) : l.raw)).join('\n');
  await writeFileAtomic(file(root, 'ai-links.jsonl'), text + (lines.length ? '\n' : ''));
}

export async function appendAiLink(root: string, link: AiLink): Promise<void> {
  await writeLines(root, [...(await readLines(root)), { raw: '', n: 0, link }]);
}

/** Rewrites ai-links.jsonl with the new status for the link whose edge id matches. */
export async function setAiLinkStatus(root: string, edgeId: string, status: AiLink['status']): Promise<void> {
  const lines = await readLines(root);
  const [from, rel, to] = edgeId.split('|');
  const hit = lines.filter(({ link: l }) => l && l.from === from && l.rel === rel && l.to === to);
  if (!hit.length) throw new Error(`No AI link ${edgeId}`);
  for (const l of hit) l.link!.status = status;
  await writeLines(root, lines);
}

export async function rebuildGraph(root: string): Promise<{ nodes: GNode[]; edges: GEdge[]; problems: LineProblem[] }> {
  const { ideas } = await listIdeas(root);
  const { links, problems } = await readAiLinks(root);
  const edits = await readEdits(root);
  const graph = buildGraph(ideas, links, await listRounds(root), edits, { registry: await registryFrom(root, edits), rules: await loadRules(root) });
  await writeFileAtomic(file(root, 'nodes.jsonl'), graph.nodes.map((n) => JSON.stringify(n)).join('\n') + '\n');
  await writeFileAtomic(file(root, 'edges.jsonl'), graph.edges.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return { ...graph, problems };
}

/**
 * Merges one star into another: its links move over and it goes. The merged label is recorded as an alias of the star
 * kept, so the twin cannot come back at the next import or re-read. Two edits, undone together.
 */
export async function mergeStars(root: string, from: string, into: string, clock: Clock): Promise<{ from: string; into: string; edits: string[] }> {
  const graph = await rebuildGraph(root);
  const a = graph.nodes.find((n) => n.id === from); const b = graph.nodes.find((n) => n.id === into);
  if (!a || !b || a.id === b.id || a.type !== b.type || !MERGEABLE.includes(a.type)) throw new Error('Those two stars cannot be merged');
  const mergeId = await nextEditId(root);
  await appendEdit(root, { id: mergeId, at: clock(), status: 'active', t: 'merge', from, into });
  const aliasId = await nextEditId(root);
  await appendEdit(root, { id: aliasId, at: clock(), status: 'active', t: 'alias', node: into, label: a.label, of: b.label });
  return { from: a.label, into: b.label, edits: [mergeId, aliasId] };
}
