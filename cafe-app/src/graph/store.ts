import path from 'node:path';
import { promises as fs } from 'node:fs';
import { paths } from '../workspace/paths';
import { readText, writeFileAtomic } from '../workspace/files';
import { listIdeas } from '../ideas/store';
import { buildGraph } from './build';
import type { AiLink, GEdge, GNode } from './ontology';

const file = (root: string, name: string) => path.join(paths(root).graph, name);

export async function readAiLinks(root: string): Promise<AiLink[]> {
  const text = await readText(file(root, 'ai-links.jsonl'));
  return text ? text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as AiLink) : [];
}

export async function appendAiLink(root: string, link: AiLink): Promise<void> {
  await fs.mkdir(paths(root).graph, { recursive: true });
  await fs.appendFile(file(root, 'ai-links.jsonl'), `${JSON.stringify(link)}\n`, 'utf8');
}

/** Rewrites ai-links.jsonl with the new status for the link whose edge id matches. */
export async function setAiLinkStatus(root: string, edgeId: string, status: AiLink['status']): Promise<void> {
  const links = await readAiLinks(root);
  const [from, rel, to] = edgeId.split('|');
  const hit = links.filter((l) => l.from === from && l.rel === rel && l.to === to);
  if (!hit.length) throw new Error(`No AI link ${edgeId}`);
  for (const l of hit) l.status = status;
  await writeFileAtomic(file(root, 'ai-links.jsonl'), links.map((l) => JSON.stringify(l)).join('\n') + (links.length ? '\n' : ''));
}

export async function rebuildGraph(root: string): Promise<{ nodes: GNode[]; edges: GEdge[] }> {
  const { ideas } = await listIdeas(root);
  const graph = buildGraph(ideas, await readAiLinks(root));
  await writeFileAtomic(file(root, 'nodes.jsonl'), graph.nodes.map((n) => JSON.stringify(n)).join('\n') + '\n');
  await writeFileAtomic(file(root, 'edges.jsonl'), graph.edges.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return graph;
}
