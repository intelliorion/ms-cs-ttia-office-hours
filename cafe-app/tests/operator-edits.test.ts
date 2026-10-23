import { describe, it, expect } from 'vitest';
import { buildGraph } from '../src/graph/build';
import { appendEdit, readEdits, setEditStatus } from '../src/graph/operator';
import { rebuildGraph } from '../src/graph/store';
import { saveIdea } from '../src/ideas/store';
import { tmpWorkspace, sampleIdea } from './helpers';
import type { OperatorEdit } from '../src/graph/ontology';

const a = sampleIdea({
  id: 'CAFE-2026-001', slug: 'a', title: 'Desk finder', function: 'BSI', entity: 'CS', support: ['Agent Design Guidance'],
  people: { submitter: 'Person 1', team: [{ name: 'Person 1', roles: ['lead'] }, { name: 'Person 2', roles: ['member'] }] },
});
const b = sampleIdea({
  id: 'CAFE-2026-002', slug: 'b', title: 'FAQ bot', function: 'GSS', entity: 'CS', support: ['Agent design guidance support'], dedupe_key: 'b',
  people: { submitter: 'Person 3', team: [] },
});
const edit = (e: Partial<OperatorEdit> & Pick<OperatorEdit, 't'>, n = 1): OperatorEdit => ({ id: `op-${n}`, at: '2026-10-22', status: 'active', ...e } as OperatorEdit);
const rels = (g: { edges: { from: string; rel: string; to: string }[] }) => g.edges.map((e) => `${e.from} ${e.rel} ${e.to}`);

describe('operator edits on the graph', () => {
  it('a link the operator made shows, sourced "operator", confirmed', () => {
    const g = buildGraph([a, b], [], [], [edit({ t: 'link', from: 'team:gss', rel: 'HAS_MEMBER', to: 'person:person-2' })]);
    const e = g.edges.find((x) => x.id === 'team:gss|HAS_MEMBER|person:person-2')!;
    expect(e).toMatchObject({ source: 'operator', confirmed: true, confidence: 1 });
  });

  it('a link between stars that are gone, or with the wrong types, is skipped', () => {
    const g = buildGraph([a], [], [], [
      edit({ t: 'link', from: 'team:gss', rel: 'HAS_MEMBER', to: 'person:person-2' }),
      edit({ t: 'link', from: 'person:person-2', rel: 'HAS_MEMBER', to: 'team:bsi' }, 2),
    ]);
    expect(rels(g).filter((r) => r.includes('person:person-2') && r.includes('HAS_MEMBER'))).toEqual([]);
  });

  it('unlink hides a form link; rename relabels a star; an undone edit does nothing', () => {
    const g = buildGraph([a], [], [], [
      edit({ t: 'unlink', from: 'person:person-2', rel: 'RELATED', to: 'idea:CAFE-2026-001' }),
      edit({ t: 'rename', node: 'team:bsi', label: 'Business Services & Innovation' }, 2),
      edit({ t: 'rename', node: 'team:bsi', label: 'Ignored' }, 3),
    ].map((e, i) => (i === 2 ? { ...e, status: 'undone' as const } : e)));
    expect(rels(g)).not.toContain('person:person-2 RELATED idea:CAFE-2026-001');
    expect(g.nodes.find((n) => n.id === 'team:bsi')?.label).toBe('Business Services & Innovation');
  });

  it('merge moves every link onto the star kept and removes the duplicate; never across types', () => {
    const g = buildGraph([a, b], [], [], [
      edit({ t: 'merge', from: 'support:agent-design-guidance-support', into: 'support:agent-design-guidance' }),
      edit({ t: 'merge', from: 'team:gss', into: 'person:person-1' }, 2),
    ]);
    expect(g.nodes.some((n) => n.id === 'support:agent-design-guidance-support')).toBe(false);
    expect(rels(g)).toContain('idea:CAFE-2026-002 ASKS_FOR support:agent-design-guidance');
    expect(g.nodes.some((n) => n.id === 'team:gss')).toBe(true);
  });

  it('edits are kept in graph/operator.jsonl, survive a rebuild, and can be undone', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, a); await saveIdea(root, b);
    await appendEdit(root, edit({ t: 'link', from: 'team:gss', rel: 'HAS_MEMBER', to: 'person:person-2' }));
    expect(rels(await rebuildGraph(root))).toContain('team:gss HAS_MEMBER person:person-2');
    await setEditStatus(root, 'op-1', 'undone');
    expect((await readEdits(root))[0].status).toBe('undone');
    expect(rels(await rebuildGraph(root))).not.toContain('team:gss HAS_MEMBER person:person-2');
  });
});
