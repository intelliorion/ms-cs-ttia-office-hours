import { describe, it, expect } from 'vitest';
import { planAiLinks, REUSE_AT } from '../src/ai/apply';
import { checkProposals, type ConflictContext } from '../src/inbox/conflicts';
import type { ExtractOutput } from '../src/ai/tasks';
import { edgeId, type GNode } from '../src/graph/ontology';
import { tmpWorkspace, sampleIdea } from './helpers';
import { saveIdea } from '../src/ideas/store';
import { createDeepRead } from '../src/memory/job';
import { fakeEmbedder } from '../src/memory/embed';
import { starMatcher, type NearestStar } from '../src/memory/lookup';

const existing: GNode[] = [
  { id: 'idea:CAFE-2026-001', type: 'Idea', label: 'Vendor contract summariser' },
  { id: 'capability:invoice-matching', type: 'Capability', label: 'Invoice matching' },
  { id: 'system:contract-register', type: 'System', label: 'Contract register' },
];
const graph = { nodes: existing, edges: [{ id: edgeId('idea:CAFE-2026-001', 'NEEDS', 'capability:invoice-matching'), from: 'idea:CAFE-2026-001', to: 'capability:invoice-matching', rel: 'NEEDS' as const, description: '', source: 'form:x', confidence: 1, confirmed: true }] };
const out: ExtractOutput = {
  nodes: [{ type: 'Capability', label: 'Match invoices' }, { type: 'System', label: 'Vendor register' }, { type: 'PainPoint', label: 'Missed notice dates' }],
  links: [
    { from: 'idea', to: 'Match invoices', rel: 'NEEDS', description: 'd', confidence: 0.9 },
    { from: 'Match invoices', to: 'Vendor register', rel: 'USES_DATA', description: 'd', confidence: 0.9 },
    { from: 'idea', to: 'Missed notice dates', rel: 'REPLACES', description: 'd', confidence: 0.9 },
  ],
};
/** A stand-in for Deep read's lookup: "Match invoices" is a twin of Invoice matching; "Vendor register" is only near Contract register. */
const nearest: NearestStar = (type, label) => {
  if (type === 'Capability' && label === 'Match invoices') return { node: existing[1], score: 0.91 };
  if (type === 'System' && label === 'Vendor register') return { node: existing[2], score: 0.74 };
  return undefined;
};
const plan = (opts: Parameters<typeof planAiLinks>[5] = {}) => planAiLinks('CAFE-2026-001', out, graph, [], 'fake', { status: 'confirmed', ...opts });

describe('planAiLinks with Deep read', () => {
  it('reuses the existing star above the reuse threshold, keeps a merely near one and names its twin', () => {
    const p = plan({ nearest });
    // The capability link goes to the star already there: no new "Match invoices" star.
    expect(p.links.map((l) => `${l.from} ${l.rel} ${l.to}`)).toEqual([
      'capability:invoice-matching USES_DATA system:vendor-register',
      'idea:CAFE-2026-001 REPLACES painpoint:missed-notice-dates',
    ]);
    expect(p.newNodes.map((n) => n.id).sort()).toEqual(['painpoint:missed-notice-dates', 'system:vendor-register']);
    expect(p.near).toEqual({ 'system:vendor-register': 'system:contract-register' });
    // The link the idea already had is not proposed again (it was seen), as before.
    expect(p.links.some((l) => l.to === 'capability:invoice-matching' && l.rel === 'NEEDS')).toBe(false);
  });
  it('the threshold is the caller\'s: a lower one reuses the near star too', () => {
    const p = plan({ nearest, reuseAt: 0.7 });
    expect(p.links.map((l) => l.to)).toEqual(['system:contract-register', 'painpoint:missed-notice-dates']);
    expect(p.near).toEqual({});
    expect(REUSE_AT).toBe(0.85);
  });
  it('without a lookup nothing changes: both new stars are proposed and near is empty', () => {
    const p = plan();
    expect(p.links.map((l) => l.to)).toEqual(['capability:match-invoices', 'system:vendor-register', 'painpoint:missed-notice-dates']);
    expect(p.newNodes.map((n) => n.id)).toEqual(['capability:match-invoices', 'system:vendor-register', 'painpoint:missed-notice-dates']);
    expect(p.near).toEqual({});
    // Byte for byte what the old call returned, plus the empty near map.
    const { near: _n, ...rest } = p;
    expect(rest).toEqual((({ links, newNodes }) => ({ links, newNodes }))(planAiLinks('CAFE-2026-001', out, graph, [], 'fake', { status: 'confirmed' })));
  });
});

describe('the near-duplicate hold', () => {
  const ctx = (near?: Record<string, string>): ConflictContext => ({
    idea: sampleIdea({ id: 'CAFE-2026-001' }), ideas: [sampleIdea({ id: 'CAFE-2026-001' })], nodes: existing, peoplePresent: [], design: null,
    match: { ideaId: 'CAFE-2026-001', confidence: 1, candidates: ['CAFE-2026-001'] }, aiIdeaId: 'CAFE-2026-001', screened: [], ...(near ? { near } : {}),
  });
  it('holds the link to a star Deep read found near an existing one, with the existing rule and "merge or keep both?"', () => {
    const p = plan({ nearest });
    const { apply, hold } = checkProposals(ctx(p.near), [{ t: 'graph_links', ideaId: 'CAFE-2026-001', links: p.links }]);
    expect(hold).toHaveLength(1);
    expect(hold[0]).toMatchObject({ rule: 'near-duplicate-star', why: 'Looks like Contract register: merge or keep both?', existing: 'system:contract-register', node: 'system:vendor-register' });
    expect(apply.flatMap((a) => (a.t === 'graph_links' ? a.links.map((l) => l.to) : []))).toEqual(['painpoint:missed-notice-dates']);
  });
  it('without near the same links apply as before (word overlap alone does not catch "Vendor register")', () => {
    const p = plan({ nearest });
    const { apply, hold } = checkProposals(ctx(), [{ t: 'graph_links', ideaId: 'CAFE-2026-001', links: p.links }]);
    expect(hold).toEqual([]);
    expect(apply.flatMap((a) => (a.t === 'graph_links' ? a.links.map((l) => l.to) : []))).toEqual(['system:vendor-register', 'painpoint:missed-notice-dates']);
  });
});

describe('starMatcher', () => {
  it('is undefined with no index, and with one finds the nearest star of a type by label', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea({ challenge: 'Invoices are matched by hand.' }));
    const env = { ...process.env, CAFE_EMBED_FAKE: '1' };
    expect(await starMatcher(root, ['Match invoices'], existing, env)).toBeUndefined();
    const job = createDeepRead(root, fakeEmbedder);
    await job.run(); await job.idle();
    const m = await starMatcher(root, ['Invoice matching today', 'Something else entirely'], existing, env);
    expect(m).toBeDefined();
    const hit = m!.nearest('Capability', 'Invoice matching today');
    expect(hit?.node.id).toBe('capability:invoice-matching');
    expect(hit!.score).toBeGreaterThanOrEqual(m!.thresholds.near);
    expect(m!.nearest('System', 'Invoice matching today')).toBeUndefined();
    expect(m!.nearest('Capability', 'Something else entirely')).toBeUndefined();
    expect(await starMatcher(root, [], existing, env)).toBeUndefined();
  });
});
