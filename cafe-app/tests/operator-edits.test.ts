import { describe, it, expect } from 'vitest';
import { buildGraph } from '../src/graph/build';
import { appendEdit, readEdits, setEditStatus } from '../src/graph/operator';
import { rebuildGraph, mergeStars } from '../src/graph/store';
import { loadRegistry } from '../src/graph/registryFile';
import { fixedClock } from '../src/clock';
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

describe('a merge records an alias, so the twin cannot come back', () => {
  it('mergeStars appends the merge and an alias of the merged label on the target; both undo together', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, a); await saveIdea(root, b);
    const r = await mergeStars(root, 'support:agent-design-guidance-support', 'support:agent-design-guidance', fixedClock('2026-10-26'));
    expect(r).toMatchObject({ from: 'Agent design guidance support', into: 'Agent Design Guidance', edits: ['op-1', 'op-2'] });
    const edits = await readEdits(root);
    expect(edits[0]).toMatchObject({ t: 'merge', from: 'support:agent-design-guidance-support', into: 'support:agent-design-guidance' });
    expect(edits[1]).toMatchObject({ t: 'alias', node: 'support:agent-design-guidance', label: 'Agent design guidance support', of: 'Agent Design Guidance' });
    expect((await rebuildGraph(root)).nodes.some((n) => n.id === 'support:agent-design-guidance-support')).toBe(false);
    expect((await loadRegistry(root)).resolve('Support', 'agent design guidance support')).toEqual({ id: 'support:agent-design-guidance', label: 'Agent Design Guidance' });
    await expect(mergeStars(root, 'team:gss', 'person:person-1', fixedClock('2026-10-26'))).rejects.toThrow(/cannot be merged/);
    for (const id of r.edits) await setEditStatus(root, id, 'undone');
    expect((await rebuildGraph(root)).nodes.some((n) => n.id === 'support:agent-design-guidance-support')).toBe(true);
    expect((await loadRegistry(root)).resolve('Support', 'agent design guidance support')).toBeUndefined();
  });
  it('an alias edit on its own changes no node or link in the build', () => {
    const g = buildGraph([a, b], [], [], [edit({ t: 'alias', node: 'team:gss', label: 'Global Sourcing' })]);
    expect(g).toEqual(buildGraph([a, b], []));
  });
});

import { staleEdits } from '../src/graph/build';
import { checkWorkspace } from '../src/graph/check';

describe('edits that follow a merge, and edits that point at stars gone', () => {
  const merged = [
    edit({ t: 'add', node: 'system:t-e-policy', type: 'System', label: 'T&E policy' }, 1),
    edit({ t: 'add', node: 'system:travel-policy', type: 'System', label: 'Travel policy' }, 2),
    edit({ t: 'merge', from: 'system:t-e-policy', into: 'system:travel-policy' }, 3),
    // Made after the merge, at the merged star's old id: it follows the merge.
    edit({ t: 'link', from: 'capability:policy-answers', rel: 'USES_DATA', to: 'system:t-e-policy' }, 4),
    edit({ t: 'rename', node: 'system:t-e-policy', label: 'Travel & Expense policy' }, 5),
    // A capability that is not there any more: reported, never applied, never deleted.
    edit({ t: 'link', from: 'capability:document-parsing', rel: 'USES_DATA', to: 'system:t-e-policy' }, 6),
    edit({ t: 'alias', node: 'capability:gone', label: 'Gone', of: 'Gone' }, 7),
  ];
  const withCap = sampleIdea({ ...a, features: ['Policy answers'] });
  it('an edit made after a merge at the merged star lands on the star kept', () => {
    const g = buildGraph([withCap], [], [], merged);
    expect(rels(g)).toContain('capability:policy-answers USES_DATA system:travel-policy');
    expect(g.nodes.find((n) => n.id === 'system:travel-policy')?.label).toBe('Travel & Expense policy');
    expect(g.nodes.some((n) => n.id === 'system:t-e-policy')).toBe(false);
  });
  it('the stale ones are named with the star they miss; the merged star is never the reason', () => {
    const g = buildGraph([withCap], [], [], merged);
    expect(staleEdits(g.nodes, merged)).toEqual([
      { id: 'op-6', what: 'link capability:document-parsing USES_DATA system:travel-policy', missing: ['capability:document-parsing'] },
      { id: 'op-7', what: 'alias "Gone" on capability:gone', missing: ['capability:gone'] },
    ]);
  });
  it('ontology check lists them apart from the violations, and changes nothing', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, withCap);
    for (const e of merged) await appendEdit(root, e);
    const r = await checkWorkspace(root);
    expect(r.violations).toEqual([]);
    expect(r.stale.map((s) => s.id)).toEqual(['op-6', 'op-7']);
    expect((await readEdits(root))).toHaveLength(merged.length);
  });
});

import { checkReport } from '../src/graph/check';
import { startServer } from './helpers';

describe('the check report and the graph route name the stale edits', () => {
  const result = { violations: [], checked: { nodes: 3, edges: 2, derived: 1 }, stale: [{ id: 'op-6', what: 'link capability:document-parsing USES_DATA system:travel-policy', missing: ['capability:document-parsing'] }] };
  it('stale edits are listed under their own heading; the exit code is 0 unless --strict', () => {
    const r = checkReport(result, false);
    expect(r.lines).toEqual([
      'No violations: 3 stars, 2 links and 1 derived links checked against the ontology.',
      'Stale operator edits (1): they point at stars the graph no longer holds, so the build skips them (nothing was changed):',
      'operator.jsonl op-6: link capability:document-parsing USES_DATA system:travel-policy: capability:document-parsing is not in the graph',
    ]);
    expect(r.code).toBe(0);
    expect(checkReport(result, true).code).toBe(1);
    expect(checkReport({ ...result, stale: [] }, true)).toEqual({ lines: ['No violations: 3 stars, 2 links and 1 derived links checked against the ontology.'], code: 0 });
  });
  it('/api/graph lists them as problems', async () => {
    const s = await startServer();
    try {
      await saveIdea(s.root, a);
      await appendEdit(s.root, edit({ t: 'link', from: 'capability:gone', rel: 'NEEDS', to: 'idea:CAFE-2026-001' } as any, 1));
      const g = await (await fetch(`${s.base}/api/graph`)).json() as any;
      expect(g.problems).toContainEqual({ line: 0, message: 'operator.jsonl op-1: link capability:gone NEEDS idea:CAFE-2026-001: capability:gone is not in the graph' });
      expect(g.stale).toBe(1);
    } finally { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); }
  });
});
