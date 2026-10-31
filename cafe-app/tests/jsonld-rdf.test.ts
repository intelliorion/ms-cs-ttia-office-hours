import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { buildGraph } from '../src/graph/build';
import { analysisNode, exportJsonLd, fromJsonLd, subgraphOf } from '../src/graph/jsonld';
import { sampleIdea } from './helpers';
import type { AiLink } from '../src/graph/ontology';

// jsonld (the W3C JSON-LD processor) and oxigraph (an RDF store with SPARQL), as an outside tool would read the export.
const require = createRequire(import.meta.url);
const jsonld = require('jsonld');
const ox = require('oxigraph');

const ideas = [
  sampleIdea({ id: 'CAFE-2026-003', slug: 'onboarding', title: 'Onboarding checklist helper', function: 'BSI', entity: 'CS', dedupe_key: 'c', people: { submitter: 'Priya Nair', team: [] }, features: ['Document text extraction'], tools: {} }),
  sampleIdea({ id: 'CAFE-2026-007', slug: 'faq', title: 'Procurement FAQ bot', function: 'GSS', entity: 'CS', dedupe_key: 'g', people: { submitter: 'Kwame Mensah', team: [] }, features: ['Policy question answering', 'Document text extraction'], tools: { 'Policy question answering': 'Copilot Studio' } }),
];
const ai = (l: Partial<AiLink> & Pick<AiLink, 'from' | 'rel' | 'to'>): AiLink => ({ description: 'read', source: 'ai:fake:challenge', confidence: 0.9, status: 'confirmed', ...l });
const links: AiLink[] = [
  ai({ from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:email', idea: 'CAFE-2026-003', newNodes: [{ id: 'system:email', type: 'System', label: 'Email' }] }),
  ai({ from: 'capability:policy-question-answering', rel: 'USES_DATA', to: 'system:email', idea: 'CAFE-2026-007', confidence: 0.6 }),
  ai({ from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:email', idea: 'CAFE-2026-007' }),
];
const graph = buildGraph(ideas, links);
const PREFIX = 'PREFIX c: <https://example.invalid/creators-cafe/ontology#> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> PREFIX prov: <http://www.w3.org/ns/prov#>';

async function store(doc: object) {
  const nq: string = await jsonld.toRDF(doc, { format: 'application/n-quads', safe: true });
  const s = new ox.Store();
  s.load(nq, { format: 'application/n-quads' });
  const q = (text: string) => [...s.query(`${PREFIX} ${text}`)] as any[];
  return { nq, q };
}

describe('the JSON-LD export as RDF: the default graph, IRIs for provenance, PROV-O', () => {
  it('converts in safe mode with every quad in the default graph; a plain SPARQL query finds the ideas that depend on Email', async () => {
    const { nq, q } = await store(exportJsonLd(graph, { kind: 'all' }, '2026-10-30T00:00:00.000Z'));
    expect(nq.trim().split('\n').length).toBeGreaterThan(50);
    expect(q('SELECT (COUNT(*) AS ?n) WHERE { GRAPH ?g { ?s ?p ?o } }')[0].get('n').value).toBe('0');
    const rows = q('SELECT ?label WHERE { ?i c:DEPENDS_ON ?s . ?s rdfs:label "Email" . ?i rdfs:label ?label } ORDER BY ?label');
    expect(rows.map((r) => r.get('label').value)).toEqual(['Onboarding checklist helper', 'Procurement FAQ bot']);
  });
  it('a derived link\'s provenance joins node IRIs: prov:wasDerivedFrom the stored links, prov:wasGeneratedBy the rule, every way kept', async () => {
    const { q } = await store(exportJsonLd(graph, { kind: 'all' }, '2026-10-30T00:00:00.000Z'));
    // From the derived link to the capability it went through, by IRI, and the rule as a prov:Activity.
    const rows = q(`SELECT ?cap ?rule WHERE {
      ?l a c:Link ; c:rel c:DEPENDS_ON ; c:from ?i ; c:to ?s ; prov:wasDerivedFrom ?in ; prov:wasGeneratedBy ?r .
      ?i rdfs:label "Procurement FAQ bot" . ?s rdfs:label "Email" .
      ?in c:rel c:USES_DATA ; c:from ?c . ?c a c:Capability ; rdfs:label ?cap . ?r a prov:Activity ; rdfs:label ?rule } ORDER BY ?cap`);
    expect(rows.map((r) => [r.get('cap').value, r.get('rule').value])).toEqual([['Document text extraction', 'needs+uses_data']]);
    const alt = q(`SELECT ?cap WHERE { ?l c:rel c:DEPENDS_ON ; c:from ?i ; c:alternative ?w . ?i rdfs:label "Procurement FAQ bot" . ?w prov:wasDerivedFrom ?in . ?in c:rel c:USES_DATA ; c:from ?c . ?c rdfs:label ?cap }`);
    expect(alt.map((r) => r.get('cap').value)).toEqual(['Policy question answering']);
    // The ideas a stored fact is stated for are idea IRIs.
    const stated = q(`SELECT ?idea WHERE { ?l c:rel c:USES_DATA ; c:from ?c ; c:statedFor ?i . ?c rdfs:label "Document text extraction" . ?i rdfs:label ?idea } ORDER BY ?idea`);
    expect(stated.map((r) => r.get('idea').value)).toEqual(['Onboarding checklist helper', 'Procurement FAQ bot']);
    // The export node: its scope and when, as prov:generatedAtTime xsd:dateTime.
    const meta = q('SELECT ?scope ?t WHERE { ?e a c:Export ; c:exportScope ?scope ; prov:generatedAtTime ?t }');
    expect(meta.map((r) => [r.get('scope').value, r.get('t').value, r.get('t').datatype.value])).toEqual([['all', '2026-10-30T00:00:00Z', 'http://www.w3.org/2001/XMLSchema#dateTime']]);
  });
  it('a hand-off\'s NetworkX analysis is one Analysis node with a JSON literal: in the default graph, never triples about the stars', async () => {
    const doc = exportJsonLd(subgraphOf(graph, 'CAFE-2026-007'), { kind: 'idea', id: 'CAFE-2026-007' });
    doc['@graph'].push(analysisNode('network', 'NetworkX network analysis (analysis, not stored facts)', { kind: 'analysis', cluster: { otherIdeas: [{ '@id': 'star:idea:CAFE-2026-042' }] } }));
    const { q } = await store(doc);
    expect(q('SELECT (COUNT(*) AS ?n) WHERE { GRAPH ?g { ?s ?p ?o } }')[0].get('n').value).toBe('0');
    const lit = q('SELECT ?c WHERE { ?a a c:Analysis ; c:content ?c }');
    expect(lit).toHaveLength(1);
    expect(lit[0].get('c').datatype.value).toBe('http://www.w3.org/1999/02/22-rdf-syntax-ns#JSON');
    // The idea the analysis names is no fact: nothing links to it.
    expect(q('SELECT ?p WHERE { ?s ?p <https://example.invalid/creators-cafe/id/idea:CAFE-2026-042> }')).toHaveLength(0);
    expect(q('SELECT ?s WHERE { ?e c:exportScope "CAFE-2026-007" }')).toHaveLength(1);
  });
  it('round-trips through the JSON, derived ways and stated ideas included', () => {
    expect(fromJsonLd(exportJsonLd(graph, { kind: 'all' }))).toEqual({ nodes: graph.nodes, edges: graph.edges });
    expect(graph.edges.find((e) => e.id === 'idea:CAFE-2026-007|DEPENDS_ON|system:email')!.derived!.alternatives).toHaveLength(1);
  });
});
