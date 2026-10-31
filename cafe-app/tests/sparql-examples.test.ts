import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildGraph } from '../src/graph/build';
import { exportJsonLd } from '../src/graph/jsonld';
import { makeRegistry, defaultEntries } from '../src/graph/registry';
import { sampleIdea } from './helpers';
import type { AiLink } from '../src/graph/ontology';

// docs/sparql-examples.rq: every query runs on an export, and the newcomer traps it documents hold.
const require = createRequire(import.meta.url);
const jsonld = require('jsonld');
const ox = require('oxigraph');
const FILE = fileURLToPath(new URL('../docs/sparql-examples.rq', import.meta.url));
const ai = (l: Partial<AiLink> & Pick<AiLink, 'from' | 'rel' | 'to'>): AiLink => ({ description: 'read', source: 'ai:fake:challenge', confidence: 0.9, status: 'confirmed', ...l });
const ideas = [
  sampleIdea({ id: 'CAFE-2026-004', slug: 'exp', title: 'Expense anomaly finder', function: 'GSS', entity: 'CS', dedupe_key: 'e', people: { submitter: 'Ingrid Solberg', team: [] }, features: ['Policy compliance checking', 'Document text extraction'] }),
  sampleIdea({ id: 'CAFE-2026-006', slug: 'travel', title: 'Travel policy assistant', function: 'GSS', entity: 'CS', dedupe_key: 't', people: { submitter: 'Lucía Fernández', team: [] }, features: ['Document text extraction', 'Policy compliance checking'] }),
  sampleIdea({ id: 'CAFE-2026-007', slug: 'faq', title: 'Procurement FAQ bot', function: 'GSS', entity: 'CS', dedupe_key: 'g', people: { submitter: 'Kwame Mensah', team: [] }, features: ['Document text extraction', 'Request handling'] }),
];
const links: AiLink[] = [
  ai({ from: 'capability:policy-compliance-checking', rel: 'USES_DATA', to: 'system:travel-expense-policy', idea: 'CAFE-2026-004', newNodes: [{ id: 'system:travel-expense-policy', type: 'System', label: 'Travel & Expense policy' }] }),
  ai({ from: 'capability:request-handling', rel: 'USES_DATA', to: 'system:email', idea: 'CAFE-2026-007', confidence: 0.6, newNodes: [{ id: 'system:email', type: 'System', label: 'Email' }] }),
  ai({ from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:email', idea: 'CAFE-2026-004' }),
];
const registry = makeRegistry(defaultEntries(), [{ id: 'op-4', at: '', status: 'active', t: 'alias', node: 'system:travel-expense-policy', label: 'T&E policy', of: 'Travel & Expense policy' }]);

async function queries() {
  const text = await readFile(FILE, 'utf8');
  const prefixes = text.split('\n').filter((l) => l.startsWith('PREFIX')).join('\n');
  return text.split(/^# --- /m).slice(1).map((p) => {
    const [head, ...rest] = p.split('\n');
    return { name: head.split(' ')[0], head, query: `${prefixes}\n${rest.filter((l) => !l.startsWith('#')).join('\n')}`, comment: rest.filter((l) => l.startsWith('# Answer')).join('') };
  });
}

describe('docs/sparql-examples.rq', () => {
  it('every query runs on an export and is documented with the app\'s answer', async () => {
    const graph = buildGraph(ideas, links, [], [], { registry });
    const nq: string = await jsonld.toRDF(exportJsonLd(graph, { kind: 'all' }, '2026-10-31T00:00:00.000Z'), { format: 'application/n-quads', safe: true });
    const store = new ox.Store();
    store.load(nq, { format: 'application/n-quads' });
    const qs = await queries();
    expect(qs.length).toBeGreaterThanOrEqual(20);
    const rows: Record<string, any[]> = {};
    for (const q of qs) {
      expect(q.comment, q.head).toMatch(/^# Answer: /);
      rows[q.name] = [...store.query(q.query)];
    }
    const col = (name: string, v: string) => rows[name].map((r) => r.get(v).value);
    // A plain triple is a confirmed fact: the bot's Email dependency rests on an AI link at 0.6 and is only a Link.
    expect(col('N1', 'idea')).toEqual(['Expense anomaly finder']);
    expect(rows.N1b.map((r) => `${r.get('idea').value} ${r.get('confirmed').value}`)).toEqual(['Expense anomaly finder true', 'Procurement FAQ bot false']);
    expect(rows.N14).toEqual([]);
    // Other names are skos:altLabel.
    expect(col('N5', 'label')).toEqual(['Travel & Expense policy']);
    // SIMILAR_TO both ways, from either idea.
    const sim = [...store.query(`${(await readFile(FILE, 'utf8')).split('\n').filter((l) => l.startsWith('PREFIX')).join('\n')} SELECT ?x WHERE { star:idea:CAFE-2026-006 cafe:SIMILAR_TO ?x }`)].map((r: any) => r.get('x').value);
    expect(sim).toContain('https://example.invalid/creators-cafe/id/idea:CAFE-2026-004');
  });
});
