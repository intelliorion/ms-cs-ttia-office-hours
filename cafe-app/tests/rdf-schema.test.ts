import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import SHACLValidator from 'rdf-validate-shacl';
import { buildGraph } from '../src/graph/build';
import { exportJsonLd, namespaces } from '../src/graph/jsonld';
import { shapesTurtle, vocabularyTurtle } from '../src/graph/schema';
import { sampleIdea } from './helpers';
import type { AiLink } from '../src/graph/ontology';

// The export checked as an outside tool would: jsonld (W3C processor) to N-Quads, N3.js to parse, rdf-validate-shacl
// to validate against the shapes the app writes beside it, oxigraph for SPARQL.
const require = createRequire(import.meta.url);
const jsonld = require('jsonld');
const ox = require('oxigraph');
const { Parser } = require('n3');

const ideas = [
  sampleIdea({ id: 'CAFE-2026-003', slug: 'onboarding', title: 'Onboarding checklist helper', function: 'BSI', entity: 'CS', dedupe_key: 'c', people: { submitter: 'Priya Nair', team: [] }, features: ['Document text extraction'], tools: {} }),
  sampleIdea({ id: 'CAFE-2026-006', slug: 'travel', title: 'Travel policy assistant', function: 'GSS', entity: 'CS', dedupe_key: 'f', people: { submitter: 'Lucía Fernández', team: [] }, features: ['Document text extraction', 'Policy question answering'], tools: { 'Policy question answering': 'Copilot Studio' } }),
  sampleIdea({ id: 'CAFE-2026-007', slug: 'faq', title: 'Procurement FAQ bot', function: 'GSS', entity: 'CS', dedupe_key: 'g', people: { submitter: 'Kwame Mensah', team: [] }, features: ['Policy question answering', 'Document text extraction'], tools: {} }),
];
const ai = (l: Partial<AiLink> & Pick<AiLink, 'from' | 'rel' | 'to'>): AiLink => ({ description: 'read', source: 'ai:fake:challenge', confidence: 0.9, status: 'confirmed', ...l });
// Document text extraction uses Email for 003 only; the mailbox (a kind of Email) for 007.
const links: AiLink[] = [
  ai({ from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:email', idea: 'CAFE-2026-003', newNodes: [{ id: 'system:email', type: 'System', label: 'Email' }] }),
  ai({ from: 'capability:policy-question-answering', rel: 'USES_DATA', to: 'system:procurement-mailbox', idea: 'CAFE-2026-007', newNodes: [{ id: 'system:procurement-mailbox', type: 'System', label: 'Procurement mailbox' }] }),
  // 007 also reads Email through Document text extraction: its DEPENDS_ON Email is derived two ways (an alternative).
  ai({ from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:email', idea: 'CAFE-2026-007' }),
];
const graph = buildGraph(ideas, links, [], [{ id: 'op-1', at: '2026-10-30', status: 'active', t: 'link', from: 'system:procurement-mailbox', rel: 'KIND_OF', to: 'system:email' }]);

const quads = (text: string, format?: string): any[] => new Parser(format ? { format } : {}).parse(text);
async function nquads(doc: object): Promise<string> { return jsonld.toRDF(doc, { format: 'application/n-quads', safe: true }); }
async function validate(nq: string) {
  const validator = new SHACLValidator(quads(shapesTurtle()) as any);
  const report = await validator.validate(validator.factory.dataset(quads(nq, 'N-Quads')) as any);
  return { conforms: report.conforms, results: report.results.map((r: any) => `${r.focusNode?.value} ${r.path?.value ?? ''} ${r.message?.map((m: any) => m.value).join('; ') ?? ''}`) };
}

describe('should 9: the export comes with its schema (RDFS and SHACL) and validates against it', () => {
  it('the vocabulary and the shapes parse as Turtle at a stable, honest base; every relation has its domain and range', () => {
    const v = quads(vocabularyTurtle());
    const { vocab } = namespaces();
    expect(vocab).toBe('https://example.invalid/creators-cafe/ontology#');
    const domain = (p: string) => v.find((q: any) => q.subject.value === `${vocab}${p}` && q.predicate.value.endsWith('#domain'))?.object.value;
    const range = (p: string) => v.find((q: any) => q.subject.value === `${vocab}${p}` && q.predicate.value.endsWith('#range'))?.object.value;
    expect([domain('NEEDS'), range('NEEDS')]).toEqual([`${vocab}Idea`, `${vocab}Capability`]);
    expect([domain('DEPENDS_ON'), range('DEPENDS_ON')]).toEqual([`${vocab}Idea`, `${vocab}System`]);
    expect(v.some((q: any) => q.subject.value === `${vocab}KIND_OF` && q.object.value === 'http://www.w3.org/2002/07/owl#TransitiveProperty')).toBe(true);
    expect(quads(shapesTurtle()).length).toBeGreaterThan(100);
    expect(namespaces('urn:example:cafe').vocab).toBe('urn:example:cafe/ontology#');
  });

  it('rdf-validate-shacl: the whole export conforms to the shapes, zero violations; a broken one does not', async () => {
    const doc = exportJsonLd(graph, { kind: 'all' }, '2026-10-30T00:00:00.000Z');
    expect(graph.edges.find((e) => e.id === 'idea:CAFE-2026-007|DEPENDS_ON|system:email')!.derived!.alternatives).toHaveLength(1);
    const ok = await validate(await nquads(doc));
    expect(ok.results).toEqual([]);
    expect(ok.conforms).toBe(true);
    // A link at confidence 1.5 and an idea that NEEDS a system break the shapes.
    const bad = JSON.parse(JSON.stringify(doc));
    bad['@graph'].find((n: any) => n['@type'] === 'Link').confidence = 1.5;
    bad['@graph'].find((n: any) => n['@id'] === 'star:idea:CAFE-2026-003').NEEDS.push({ '@id': 'star:system:email' });
    const broken = await validate(await nquads(bad));
    expect(broken.conforms).toBe(false);
    expect(broken.results.length).toBeGreaterThanOrEqual(2);
  });

  it('naive SPARQL gives the app\'s answers: one hop DEPENDS_ON (per idea, mailbox as a kind of email included); the two-hop path never reads a fact for an idea it is not stated for', async () => {
    const s = new ox.Store();
    s.load(await nquads(exportJsonLd(graph, { kind: 'all' })), { format: 'application/n-quads' });
    const P = 'PREFIX c: <https://example.invalid/creators-cafe/ontology#> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>';
    const labels = (q: string) => [...s.query(`${P} ${q}`)].map((r: any) => r.get('l').value).sort();
    const app = graph.edges.filter((e) => e.rel === 'DEPENDS_ON' && e.to === 'system:email').map((e) => graph.nodes.find((n) => n.id === e.from)!.label).sort();
    expect(app).toEqual(['Onboarding checklist helper', 'Procurement FAQ bot']);
    expect(labels('SELECT DISTINCT ?l WHERE { ?i c:DEPENDS_ON ?s . ?s rdfs:label "Email" . ?i rdfs:label ?l }')).toEqual(app);
    // The retest's naive path (NEEDS then USES_DATA): Document text extraction is needed by all three, but uses Email for 003 and 007 only.
    const naive = labels('SELECT DISTINCT ?l WHERE { ?i c:NEEDS ?c . ?c c:USES_DATA ?s . ?s rdfs:label "Email" . ?i rdfs:label ?l }');
    expect(naive.every((l) => app.includes(l))).toBe(true);
    expect(naive).not.toContain('Travel policy assistant');
    // The per-idea facts are all there, reified: a Link stated for the idea.
    expect(labels('SELECT DISTINCT ?l WHERE { ?k a c:Link ; c:rel c:USES_DATA ; c:from ?c ; c:to ?s ; c:statedFor ?i . ?i c:NEEDS ?c . ?s rdfs:label "Email" . ?i rdfs:label ?l }')).toEqual(['Onboarding checklist helper', 'Procurement FAQ bot']);
  });
});
