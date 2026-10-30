import path from 'node:path';
import { ALLOWED, NODE_TYPES, type GEdge, type GNode, type NodeType, type Relation } from './ontology';
import { paths } from '../workspace/paths';
import { writeFileAtomic } from '../workspace/files';
import { rebuildGraph } from './store';
import type { Clock } from '../clock';

/**
 * The graph as JSON-LD, readable as RDF by any JSON-LD processor in safe mode: the document is only @context and
 * @graph, so everything sits in the default graph and a plain SPARQL query finds it with no GRAPH clause.
 * - each star a resource with its label, attributes and outgoing links as properties (derived ones included);
 * - each link also a resource of type Link, its ends as IRIs (not strings), with where it came from, its confidence,
 *   whether it is confirmed and the ideas it is stated for; a derived link says how with PROV-O:
 *   prov:wasDerivedFrom the links it rests on (other ways as cafe:alternative), prov:wasGeneratedBy the rule;
 * - the export itself (cafe:export), with its scope and prov:generatedAtTime;
 * - in a CSIC hand-off, NetworkX's analysis as one Analysis node whose content is a JSON literal (rdf:JSON): there to
 *   read, labelled analysis, and never triples about the stars (it is not a stored fact).
 * Local, for hand-offs and other tools; names stay as in the files.
 */
export const CAFE_VOCAB = 'https://creators-cafe.local/ontology#';
const PROV = 'http://www.w3.org/ns/prov#';
const XSD = 'http://www.w3.org/2001/XMLSchema#';
export type ExportScope = { kind: 'all' } | { kind: 'idea'; id: string };
export interface JsonLdDoc { '@context': Record<string, unknown>; '@graph': Record<string, unknown>[] }
/** The export node of a document: its scope ("all" or the Café ID) and when it was made. */
export function exportInfo(doc: JsonLdDoc): { scope: string; exported: string } {
  const n = doc['@graph'].find((x) => x['@id'] === 'cafe:export') ?? {};
  return { scope: String(n.exportScope ?? ''), exported: String(n.generatedAtTime ?? '') };
}

const iri = (id: string) => `cafe:${id}`;
const unIri = (s: string) => s.replace(/^cafe:/, '');
/** A link's IRI: its id (from|REL|to) made safe for an IRI. */
export const linkIri = (id: string) => `cafe:link/${encodeURIComponent(id)}`;
const unLink = (s: string) => decodeURIComponent(s.replace(/^cafe:link\//, ''));
const ruleIri = (name: string) => `cafe:rule/${encodeURIComponent(name)}`;
const ref = (id: string) => ({ '@id': id });

export function jsonLdContext(): Record<string, unknown> {
  return {
    '@vocab': CAFE_VOCAB, cafe: CAFE_VOCAB, prov: PROV, xsd: XSD,
    label: 'http://www.w3.org/2000/01/rdf-schema#label', attrs: `${CAFE_VOCAB}attrs`,
    ...Object.fromEntries(NODE_TYPES.map((t) => [t, `${CAFE_VOCAB}${t}`])),
    ...Object.fromEntries((Object.keys(ALLOWED) as Relation[]).map((r) => [r, { '@id': `${CAFE_VOCAB}${r}`, '@type': '@id' }])),
    Link: `${CAFE_VOCAB}Link`, Rule: `${CAFE_VOCAB}Rule`, Export: `${CAFE_VOCAB}Export`, Derivation: `${CAFE_VOCAB}Derivation`,
    from: { '@id': `${CAFE_VOCAB}from`, '@type': '@id' }, to: { '@id': `${CAFE_VOCAB}to`, '@type': '@id' },
    rel: { '@id': `${CAFE_VOCAB}rel`, '@type': '@vocab' },
    statedFor: { '@id': `${CAFE_VOCAB}statedFor`, '@type': '@id', '@container': '@set' },
    wasDerivedFrom: { '@id': `${PROV}wasDerivedFrom`, '@type': '@id', '@container': '@set' },
    wasGeneratedBy: { '@id': `${PROV}wasGeneratedBy`, '@type': '@id' },
    alternative: { '@id': `${CAFE_VOCAB}alternative`, '@container': '@set' },
    generatedAtTime: { '@id': `${PROV}generatedAtTime`, '@type': `${XSD}dateTime` },
    Analysis: `${CAFE_VOCAB}Analysis`, content: { '@id': `${CAFE_VOCAB}content`, '@type': '@json' },
  };
}

export function exportJsonLd(graph: { nodes: GNode[]; edges: GEdge[] }, scope: ExportScope, exported = new Date().toISOString()): JsonLdDoc {
  const out = new Map<string, Record<string, unknown>>();
  for (const n of graph.nodes) out.set(n.id, { '@id': iri(n.id), '@type': n.type, label: n.label, ...(n.attrs ? { attrs: n.attrs } : {}) });
  for (const e of graph.edges) {
    const n = out.get(e.from); if (!n) continue;
    const list = (n[e.rel] as { '@id': string }[] | undefined) ?? [];
    list.push(ref(iri(e.to)));
    n[e.rel] = list;
  }
  const links = graph.edges.map((e) => ({
    '@id': linkIri(e.id), '@type': 'Link', from: iri(e.from), rel: e.rel, to: iri(e.to),
    description: e.description, source: e.source, confidence: e.confidence, confirmed: e.confirmed,
    ...(e.ideas?.length ? { statedFor: e.ideas.map((i) => iri(`idea:${i}`)) } : {}),
    ...(e.derived ? {
      wasGeneratedBy: ruleIri(e.derived.rule), wasDerivedFrom: e.derived.inputs.map(linkIri),
      ...(e.derived.alternatives?.length ? { alternative: e.derived.alternatives.map((w) => ({ '@type': 'Derivation', wasDerivedFrom: w.map(linkIri) })) } : {}),
    } : {}),
  }));
  const rules = [...new Set(graph.edges.flatMap((e) => (e.derived ? [e.derived.rule] : [])))].sort()
    .map((name) => ({ '@id': ruleIri(name), '@type': ['Rule', 'prov:Activity'], label: name }));
  const scopeText = scope.kind === 'all' ? 'all' : scope.id;
  const meta = { '@id': 'cafe:export', '@type': 'Export', label: `Creators' Café graph (${scopeText})`, exportScope: scopeText, generatedAtTime: exported };
  return { '@context': jsonLdContext(), '@graph': [meta, ...out.values(), ...links, ...rules] };
}

/** An analysis beside the facts (NetworkX's, in a hand-off): one node, its content a JSON literal, labelled as analysis. */
export function analysisNode(id: string, label: string, content: Record<string, unknown>): Record<string, unknown> {
  return { '@id': `cafe:analysis/${id}`, '@type': 'Analysis', label, content };
}

/** The graph back from a document this module wrote (the round-trip the tests check). */
export function fromJsonLd(doc: JsonLdDoc): { nodes: GNode[]; edges: GEdge[] } {
  const items = doc['@graph'];
  const nodes: GNode[] = items.filter((n) => NODE_TYPES.includes(n['@type'] as NodeType)).map((n) => ({
    id: unIri(String(n['@id'])), type: String(n['@type']) as NodeType, label: String(n.label),
    ...(n.attrs ? { attrs: n.attrs as GNode['attrs'] } : {}),
  }));
  const edges: GEdge[] = items.filter((n) => n['@type'] === 'Link').map((l) => {
    const ways = (l.alternative as { wasDerivedFrom: string[] }[] | undefined)?.map((w) => w.wasDerivedFrom.map(unLink));
    return {
      id: unLink(String(l['@id'])), from: unIri(String(l.from)), to: unIri(String(l.to)), rel: l.rel as Relation,
      description: String(l.description), source: String(l.source), confidence: Number(l.confidence), confirmed: l.confirmed === true,
      ...(l.statedFor ? { ideas: (l.statedFor as string[]).map((x) => unIri(x).replace(/^idea:/, '')) } : {}),
      ...(l.wasGeneratedBy ? { derived: { rule: decodeURIComponent(String(l.wasGeneratedBy).replace(/^cafe:rule\//, '')), inputs: (l.wasDerivedFrom as string[]).map(unLink), ...(ways ? { alternatives: ways } : {}) } } : {}),
    };
  });
  return { nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)), edges: edges.sort((a, b) => a.id.localeCompare(b.id)) };
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
