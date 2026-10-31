import path from 'node:path';
import { BUILTIN_SCHEMA, type GEdge, type GNode, type NodeType, type Relation, type Schema } from './ontology';
import { paths } from '../workspace/paths';
import { writeFileAtomic } from '../workspace/files';
import { rebuildGraph } from './store';
import { loadSettings } from '../round/store';
import type { Clock } from '../clock';
import { shapesTurtle, vocabularyTurtle } from './schema';

/**
 * The graph as JSON-LD, readable as RDF by any JSON-LD processor in safe mode: the document is only @context and
 * @graph, so everything sits in the default graph and a plain SPARQL query finds it with no GRAPH clause.
 * - two namespaces under one configurable base (settings export.base; an honest example.invalid by default): the
 *   vocabulary, <base>ontology# (prefix cafe:, classes and properties, written out as RDFS and SHACL beside the data),
 *   and the stars and links, <base>id/ (prefix star:);
 * - each star a resource with its label, its other names (skos:altLabel: "T&E policy" finds the Travel & Expense
 *   policy), attributes and outgoing links as plain triples, CONFIRMED facts only: a link waiting for the operator's
 *   Do it (and anything derived from one) is there only as a reified Link with cafe:confirmed false. SIMILAR_TO is
 *   symmetric (owl:SymmetricProperty) and written both ways. A capability-level fact
 *   (USES_DATA, BUILT_WITH) holds only for the ideas it is stated for, so it is a plain triple only when it holds for
 *   every idea that needs the capability; what it gives each idea is the plain triple the rules derive for that idea
 *   (idea DEPENDS_ON system, idea USES tool), so a plain SPARQL query never reads a fact for an idea it is not true of;
 * - each link also a resource of type Link (reified, every one: per-idea facts included), its ends as IRIs, with where
 *   it came from, its confidence, whether it is confirmed and the ideas it is stated for; a derived link says how with
 *   PROV-O: prov:wasDerivedFrom the links it rests on (other ways as cafe:alternative), prov:wasGeneratedBy the rule;
 * - the export itself (star:export), with its scope and prov:generatedAtTime;
 * - in a CSIC hand-off, NetworkX's analysis as one Analysis node whose content is a JSON literal (rdf:JSON): there to
 *   read, labelled analysis, and never triples about the stars (it is not a stored fact).
 */
export const DEFAULT_BASE = 'https://example.invalid/creators-cafe/';
/** The vocabulary and data namespaces of a base (one that does not end in / or # gets a /). */
export function namespaces(base = DEFAULT_BASE): { base: string; vocab: string; data: string } {
  const b = /[/#]$/.test(base.trim()) ? base.trim() : `${base.trim()}/`;
  return { base: b, vocab: `${b}ontology#`, data: `${b}id/` };
}
/** The vocabulary IRI at the default base (a test and the docs read it). */
export const CAFE_VOCAB = namespaces().vocab;
/** The base a workspace's export uses: settings export.base when it is an absolute http(s) or urn IRI, else the default. */
export async function exportBase(root: string): Promise<string> {
  const b = String((await loadSettings(root).catch(() => ({})) as { export?: { base?: string } }).export?.base ?? '').trim();
  return /^(https?:\/\/[^\s<>"{}|\\^`]+|urn:[a-z0-9][a-z0-9-]{0,31}:[^\s<>"{}|\\^`]+)$/i.test(b) ? b : DEFAULT_BASE;
}

const PROV = 'http://www.w3.org/ns/prov#';
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const SKOS = 'http://www.w3.org/2004/02/skos/core#';
/** Relations that hold both ways: written both ways as plain triples, declared owl:SymmetricProperty. */
export const SYMMETRIC: Relation[] = ['SIMILAR_TO'];
export type ExportScope = { kind: 'all' } | { kind: 'idea'; id: string };
export interface JsonLdDoc { '@context': Record<string, unknown>; '@graph': Record<string, unknown>[] }
/** The export node of a document: its scope ("all" or the Café ID) and when it was made. */
export function exportInfo(doc: JsonLdDoc): { scope: string; exported: string } {
  const n = doc['@graph'].find((x) => x['@id'] === 'star:export') ?? {};
  return { scope: String(n.exportScope ?? ''), exported: String(n.generatedAtTime ?? '') };
}

/** A star's IRI, compact (star:idea:CAFE-2026-001): the hand-off's analysis names stars this way too. */
export const starIri = (id: string) => `star:${id}`;
const iri = starIri;
const unIri = (s: string) => s.replace(/^star:/, '');
/** A link's IRI: its id (from|REL|to) made safe for an IRI. */
export const linkIri = (id: string) => `star:link/${encodeURIComponent(id)}`;
const unLink = (s: string) => decodeURIComponent(s.replace(/^star:link\//, ''));
const ruleIri = (name: string) => `star:rule/${encodeURIComponent(name)}`;
const ref = (id: string) => ({ '@id': id });

export function jsonLdContext(base = DEFAULT_BASE, schema: Schema = BUILTIN_SCHEMA): Record<string, unknown> {
  const { vocab, data } = namespaces(base);
  return {
    '@vocab': vocab, cafe: vocab, star: data, prov: PROV, xsd: XSD, skos: SKOS,
    label: 'http://www.w3.org/2000/01/rdf-schema#label', attrs: `${vocab}attrs`,
    altLabel: { '@id': `${SKOS}altLabel`, '@container': '@set' },
    quote: `${vocab}quote`, quoteFound: { '@id': `${vocab}quoteFound`, '@type': `${XSD}boolean` },
    readAt: { '@id': `${vocab}readAt`, '@type': `${XSD}dateTime` },
    ...Object.fromEntries(schema.types.map((t) => [t, `${vocab}${t}`])),
    ...Object.fromEntries((Object.keys(schema.allowed) as Relation[]).map((r) => [r, { '@id': `${vocab}${r}`, '@type': '@id' }])),
    Link: `${vocab}Link`, Rule: `${vocab}Rule`, Export: `${vocab}Export`, Derivation: `${vocab}Derivation`,
    from: { '@id': `${vocab}from`, '@type': '@id' }, to: { '@id': `${vocab}to`, '@type': '@id' },
    rel: { '@id': `${vocab}rel`, '@type': '@vocab' },
    confidence: { '@id': `${vocab}confidence`, '@type': `${XSD}double` },
    confirmed: { '@id': `${vocab}confirmed`, '@type': `${XSD}boolean` },
    statedFor: { '@id': `${vocab}statedFor`, '@type': '@id', '@container': '@set' },
    wasDerivedFrom: { '@id': `${PROV}wasDerivedFrom`, '@type': '@id', '@container': '@set' },
    wasGeneratedBy: { '@id': `${PROV}wasGeneratedBy`, '@type': '@id' },
    alternative: { '@id': `${vocab}alternative`, '@container': '@set' },
    generatedAtTime: { '@id': `${PROV}generatedAtTime`, '@type': `${XSD}dateTime` },
    Analysis: `${vocab}Analysis`, content: { '@id': `${vocab}content`, '@type': '@json' },
  };
}

/**
 * Whether a stored capability-level fact is true for every idea that needs its capability (so it can stand as a plain
 * triple): it is stated for each of them. A fact of another relation always is.
 */
function holdsForAll(e: GEdge, needers: Map<string, Set<string>>, schema: Schema): boolean {
  if (e.derived || !schema.ideaScoped.includes(e.rel)) return true;
  const stated = new Set(e.ideas ?? []);
  return [...(needers.get(e.from) ?? [])].every((i) => stated.has(i));
}

export function exportJsonLd(graph: { nodes: GNode[]; edges: GEdge[]; schema?: Schema }, scope: ExportScope, exported = new Date().toISOString(), base = DEFAULT_BASE): JsonLdDoc {
  const schema = graph.schema ?? BUILTIN_SCHEMA;
  const out = new Map<string, Record<string, unknown>>();
  for (const n of graph.nodes) {
    const { aliases, ...attrs } = n.attrs ?? {};
    const alt = String(aliases ?? '').split(';').map((a) => a.trim()).filter((a) => a && a !== n.label);
    out.set(n.id, { '@id': iri(n.id), '@type': n.type, label: n.label, ...(alt.length ? { altLabel: [...new Set(alt)] } : {}), ...(Object.keys(attrs).length ? { attrs } : {}) });
  }
  const needers = new Map<string, Set<string>>();
  for (const e of graph.edges) if (e.rel === 'NEEDS' && !e.derived) needers.set(e.to, new Set([...(needers.get(e.to) ?? []), e.from.slice('idea:'.length)]));
  const plain = (from: string, rel: Relation, to: string) => {
    const n = out.get(from); if (!n || !out.has(to)) return;
    const list = (n[rel] as { '@id': string }[] | undefined) ?? [];
    if (!list.some((x) => x['@id'] === iri(to))) list.push(ref(iri(to)));
    n[rel] = list;
  };
  for (const e of graph.edges) {
    // A plain triple is a settled fact: confirmed, and true for every idea it would be read for.
    if (!e.confirmed || !holdsForAll(e, needers, schema)) continue;
    plain(e.from, e.rel, e.to);
    if (SYMMETRIC.includes(e.rel)) plain(e.to, e.rel, e.from);
  }
  const links = graph.edges.map((e) => ({
    '@id': linkIri(e.id), '@type': 'Link', from: iri(e.from), rel: e.rel, to: iri(e.to),
    description: e.description, source: e.source, confidence: e.confidence, confirmed: e.confirmed,
    ...(e.quote ? { quote: e.quote, quoteFound: e.quoteFound !== false } : {}),
    ...(e.readAt ? { readAt: e.readAt } : {}),
    ...(e.ideas?.length ? { statedFor: e.ideas.map((i) => iri(`idea:${i}`)) } : {}),
    ...(e.derived ? {
      wasGeneratedBy: ruleIri(e.derived.rule), wasDerivedFrom: e.derived.inputs.map(linkIri),
      ...(e.derived.alternatives?.length ? { alternative: e.derived.alternatives.map((w) => ({ '@type': 'Derivation', wasDerivedFrom: w.map(linkIri) })) } : {}),
    } : {}),
  }));
  const rules = [...new Set(graph.edges.flatMap((e) => (e.derived ? [e.derived.rule] : [])))].sort()
    .map((name) => ({ '@id': ruleIri(name), '@type': ['Rule', 'prov:Activity'], label: name }));
  const scopeText = scope.kind === 'all' ? 'all' : scope.id;
  const meta = { '@id': 'star:export', '@type': 'Export', label: `Creators' Café graph (${scopeText})`, exportScope: scopeText, generatedAtTime: exported };
  return { '@context': jsonLdContext(base, schema), '@graph': [meta, ...out.values(), ...links, ...rules] };
}

/** An analysis beside the facts (NetworkX's, in a hand-off): one node, its content a JSON literal, labelled as analysis. */
export function analysisNode(id: string, label: string, content: Record<string, unknown>): Record<string, unknown> {
  return { '@id': `star:analysis/${id}`, '@type': 'Analysis', label, content };
}

/** The graph back from a document this module wrote (the round-trip the tests check). */
export function fromJsonLd(doc: JsonLdDoc, schema: Schema = BUILTIN_SCHEMA): { nodes: GNode[]; edges: GEdge[] } {
  const items = doc['@graph'];
  const nodes: GNode[] = items.filter((n) => schema.types.includes(n['@type'] as NodeType)).map((n) => {
    const attrs = { ...(n.attrs as GNode['attrs'] ?? {}), ...(Array.isArray(n.altLabel) && n.altLabel.length ? { aliases: (n.altLabel as string[]).join('; ') } : {}) };
    return { id: unIri(String(n['@id'])), type: String(n['@type']) as NodeType, label: String(n.label), ...(Object.keys(attrs).length ? { attrs } : {}) };
  });
  const edges: GEdge[] = items.filter((n) => n['@type'] === 'Link').map((l) => {
    const ways = (l.alternative as { wasDerivedFrom: string[] }[] | undefined)?.map((w) => w.wasDerivedFrom.map(unLink));
    return {
      id: unLink(String(l['@id'])), from: unIri(String(l.from)), to: unIri(String(l.to)), rel: l.rel as Relation,
      description: String(l.description), source: String(l.source), confidence: Number(l.confidence), confirmed: l.confirmed === true,
      ...(l.quote ? { quote: String(l.quote), ...(l.quoteFound === false ? { quoteFound: false } : {}) } : {}), ...(l.readAt ? { readAt: String(l.readAt) } : {}),
      ...(l.statedFor ? { ideas: (l.statedFor as string[]).map((x) => unIri(x).replace(/^idea:/, '')) } : {}),
      ...(l.wasGeneratedBy ? { derived: { rule: decodeURIComponent(String(l.wasGeneratedBy).replace(/^star:rule\//, '')), inputs: (l.wasDerivedFrom as string[]).map(unLink), ...(ways ? { alternatives: ways } : {}) } } : {}),
    };
  });
  return { nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)), edges: edges.sort((a, b) => a.id.localeCompare(b.id)) };
}

/** One idea's subgraph: its star, every star it links to (derived links included), and the links among those stars. */
export function subgraphOf(graph: { nodes: GNode[]; edges: GEdge[]; schema?: Schema }, ideaId: string): { nodes: GNode[]; edges: GEdge[]; schema?: Schema } {
  const me = `idea:${ideaId}`;
  if (!graph.nodes.some((n) => n.id === me)) return { nodes: [], edges: [], schema: graph.schema };
  const keep = new Set([me]);
  for (const e of graph.edges) { if (e.from === me) keep.add(e.to); if (e.to === me) keep.add(e.from); }
  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    edges: graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
    schema: graph.schema,
  };
}

const stamp = (clock: Clock) => { const d = new Date(); const two = (n: number) => String(n).padStart(2, '0'); return `${clock().replace(/-/g, '')}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`; };

/**
 * Writes data/exports/<stamp>-<scope>.jsonld and, beside it, the schema the data is written in: the RDFS vocabulary
 * (<stamp>-vocabulary.ttl) and the SHACL shapes (<stamp>-shapes.ttl), both from the ontology as it stands (the
 * workspace's declarations included). Returns the data file's path; `schema` names the other two.
 */
export async function writeExport(root: string, scope: ExportScope, clock: Clock): Promise<string> {
  return (await writeExportFiles(root, scope, clock)).data;
}
export async function writeExportFiles(root: string, scope: ExportScope, clock: Clock): Promise<{ data: string; vocabulary: string; shapes: string; base: string }> {
  const graph = await rebuildGraph(root);
  const base = await exportBase(root);
  const part = scope.kind === 'all' ? graph : subgraphOf(graph, scope.id);
  const at = stamp(clock);
  const dir = paths(root).exports;
  const data = path.join(dir, `${at}-${scope.kind === 'all' ? 'all' : scope.id}.jsonld`);
  const vocabulary = path.join(dir, `${at}-vocabulary.ttl`);
  const shapes = path.join(dir, `${at}-shapes.ttl`);
  await writeFileAtomic(data, JSON.stringify(exportJsonLd(part, scope, undefined, base), null, 1));
  await writeFileAtomic(vocabulary, vocabularyTurtle(base, graph.schema));
  await writeFileAtomic(shapes, shapesTurtle(base, graph.schema));
  return { data, vocabulary, shapes, base };
}
