import path from 'node:path';
import { ALLOWED, NODE_TYPES, type GEdge, type GNode, type NodeType, type Relation } from './ontology';
import { paths } from '../workspace/paths';
import { writeFileAtomic } from '../workspace/files';
import { rebuildGraph } from './store';
import type { Clock } from '../clock';

/**
 * The graph as JSON-LD: each star a resource with its label, attributes and outgoing links as properties, every link
 * in full under `links` (source, confidence, confirmed, derived), and an @context mapping the ontology's types and
 * relations to the Café vocabulary. Local, for hand-offs and other tools; names stay as in the files.
 */
export const CAFE_VOCAB = 'https://creators-cafe.local/ontology#';
export type ExportScope = { kind: 'all' } | { kind: 'idea'; id: string };
export interface JsonLdDoc {
  '@context': Record<string, unknown>; scope: string; exported: string;
  '@graph': Record<string, unknown>[]; links: GEdge[];
}

const iri = (id: string) => `cafe:${id}`;
const unIri = (s: string) => s.replace(/^cafe:/, '');

export function exportJsonLd(graph: { nodes: GNode[]; edges: GEdge[] }, scope: ExportScope, exported = new Date().toISOString()): JsonLdDoc {
  const context: Record<string, unknown> = {
    '@vocab': CAFE_VOCAB, cafe: CAFE_VOCAB, label: 'http://www.w3.org/2000/01/rdf-schema#label', attrs: `${CAFE_VOCAB}attrs`,
    ...Object.fromEntries(NODE_TYPES.map((t) => [t, `${CAFE_VOCAB}${t}`])),
    ...Object.fromEntries((Object.keys(ALLOWED) as Relation[]).map((r) => [r, { '@id': `${CAFE_VOCAB}${r}`, '@type': '@id' }])),
  };
  const out = new Map<string, Record<string, unknown>>();
  for (const n of graph.nodes) out.set(n.id, { '@id': iri(n.id), '@type': n.type, label: n.label, ...(n.attrs ? { attrs: n.attrs } : {}) });
  for (const e of graph.edges) {
    const n = out.get(e.from); if (!n) continue;
    const list = (n[e.rel] as { '@id': string }[] | undefined) ?? [];
    list.push({ '@id': iri(e.to) });
    n[e.rel] = list;
  }
  return { '@context': context, scope: scope.kind === 'all' ? 'all' : scope.id, exported, '@graph': [...out.values()], links: graph.edges };
}

/** The graph back from a document this module wrote (the round-trip the tests check). */
export function fromJsonLd(doc: JsonLdDoc): { nodes: GNode[]; edges: GEdge[] } {
  const nodes: GNode[] = doc['@graph'].map((n) => ({
    id: unIri(String(n['@id'])), type: String(n['@type']) as NodeType, label: String(n.label),
    ...(n.attrs ? { attrs: n.attrs as GNode['attrs'] } : {}),
  }));
  return { nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)), edges: [...doc.links].sort((a, b) => a.id.localeCompare(b.id)) };
}

/** One idea's subgraph: its star, every star it links to (derived links included), and the links among those stars. */
export function subgraphOf(graph: { nodes: GNode[]; edges: GEdge[] }, ideaId: string): { nodes: GNode[]; edges: GEdge[] } {
  const me = `idea:${ideaId}`;
  if (!graph.nodes.some((n) => n.id === me)) return { nodes: [], edges: [] };
  const keep = new Set([me]);
  for (const e of graph.edges) { if (e.from === me) keep.add(e.to); if (e.to === me) keep.add(e.from); }
  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    edges: graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
  };
}

const stamp = (clock: Clock) => { const d = new Date(); const two = (n: number) => String(n).padStart(2, '0'); return `${clock().replace(/-/g, '')}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`; };

/** Writes data/exports/<stamp>-<scope>.jsonld and returns its path. */
export async function writeExport(root: string, scope: ExportScope, clock: Clock): Promise<string> {
  const graph = await rebuildGraph(root);
  const part = scope.kind === 'all' ? graph : subgraphOf(graph, scope.id);
  const file = path.join(paths(root).exports, `${stamp(clock)}-${scope.kind === 'all' ? 'all' : scope.id}.jsonld`);
  await writeFileAtomic(file, JSON.stringify(exportJsonLd(part, scope), null, 1));
  return file;
}
