import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpWorkspace, sampleIdea } from './helpers';
import { saveIdea, loadIdea, ideaDir } from '../src/ideas/store';
import { appendAiLink } from '../src/graph/store';
import { fixedClock } from '../src/clock';
import { reviewInput } from '../src/review/suggestInput';
import { suggestPrep } from '../src/review/prep';
import { saveReview } from '../src/review/review';
import { similarStarsChecked } from '../src/design/tools';
import { clearNetworkCache } from '../src/graph/network';
import { DEFAULT_STEPS } from '../src/rules/stages';
import type { AiLink } from '../src/graph/ontology';
import type { ReviewSuggestInput } from '../src/ai/tasks';

const PY = spawnSync('python3', ['-c', 'print(1)'], { encoding: 'utf8' }).stdout?.trim() === '1';
if (!PY) console.warn('tests/network-stages.test.ts skipped: no python3 on this machine (the NetworkX stages need Python 3.9+)');
const clock = fixedClock('2026-10-30');
const NAMES = /Avery|Kwame|Zainab|Ingrid/;

/** The three related ideas of tests/network.test.ts; the travel assistant also has Avery Chen on its team, so a person binds the cluster too. */
const IDEAS = [
  sampleIdea({ id: 'CAFE-2026-001', slug: 'desk', title: 'Desk booking assistant', function: 'BSI', entity: 'CS', dedupe_key: 'a', features: ['Request handling', 'Booking update'],
    people: { submitter: 'Avery Chen', team: [{ name: 'Avery Chen', roles: ['lead'] }] } }),
  sampleIdea({ id: 'CAFE-2026-002', slug: 'faq', title: 'Procurement FAQ bot', function: 'GSS', entity: 'CS', dedupe_key: 'b', features: ['Request handling', 'Policy answering', 'Booking update'],
    people: { submitter: 'Kwame Mensah', team: [{ name: 'Kwame Mensah', roles: ['lead'] }] } }),
  sampleIdea({ id: 'CAFE-2026-003', slug: 'travel', title: 'Travel policy assistant', function: 'GSS', entity: 'CS', dedupe_key: 'c', stage: 2, features: ['Request handling', 'Policy answering'],
    people: { submitter: 'Zainab Okafor', team: [{ name: 'Avery Chen', roles: ['builder'] }] } }),
  sampleIdea({ id: 'CAFE-2026-004', slug: 'lonely', title: 'Lonely ledger tool', function: 'TAX', entity: 'CS', dedupe_key: 'd', people: { submitter: 'Ingrid Solberg', team: [] } }),
];
const LINK: AiLink = { from: 'capability:request-handling', rel: 'USES_DATA', to: 'system:shared-mailbox', description: '', source: 'ai:test', confidence: 0.9, status: 'confirmed', newNodes: [{ id: 'system:shared-mailbox', type: 'System', label: 'Shared mailbox' }] };
async function workspace() {
  const root = await tmpWorkspace();
  for (const i of IDEAS) await saveIdea(root, i);
  // The AI read each of the three ideas that need Request handling and found the mailbox for each: one fact, three ideas.
  for (const idea of ['CAFE-2026-001', 'CAFE-2026-002', 'CAFE-2026-003']) await appendAiLink(root, { ...LINK, idea });
  return root;
}
async function noPython<T>(f: () => Promise<T>): Promise<T> {
  const was = process.env.CAFE_PYTHON; process.env.CAFE_PYTHON = '/nowhere/python3'; clearNetworkCache();
  try { return await f(); } finally { if (was === undefined) delete process.env.CAFE_PYTHON; else process.env.CAFE_PYTHON = was; clearNetworkCache(); }
}

describe.skipIf(!PY)('NetworkX feeds the decision suggestion', () => {
  it('the input gains a network block (cluster, centrality ranks, likely missing links), names coded; the basis says it was used', async () => {
    const root = await workspace();
    const { input, basis } = await reviewInput(root, 'CAFE-2026-003', [], { network: true });
    const n = input.network as Extract<ReviewSuggestInput['network'], { by: string }>;
    expect(n.by).toMatch(/^NetworkX 3\.\S+ over stored facts$/);
    expect(n.cluster!.otherIdeas.sort()).toEqual(['Desk booking assistant', 'Procurement FAQ bot']);
    expect(n.cluster!.boundBy[0]).toBe('Request handling (Capability, 3 ideas)');
    expect(n.cluster!.boundBy.some((b) => /^\[P\d+\] \(Person, 2 ideas\)$/.test(b))).toBe(true);
    expect(n.centrality).toEqual(expect.arrayContaining([{ star: 'Request handling', type: 'Capability', rank: '1 of 3', ideas: 3 }, expect.objectContaining({ star: 'Shared mailbox', type: 'System', rank: '1 of 1' })]));
    expect(n.likelyMissing[0]).toEqual({ link: 'needs Booking update', because: '100 % of its closest peers by weight have it: Procurement FAQ bot, Desk booking assistant' });
    expect(JSON.stringify(input)).not.toMatch(NAMES);
    expect(basis).toBe('Based on the form, a builder named, 3 graph links and NetworkX network analysis (a cluster with 2 other ideas, 3 centrality ranks, 1 likely missing link)');
    // The other stages that read reviewInput only for its codes are as they were.
    expect((await reviewInput(root, 'CAFE-2026-003')).input.network).toBeUndefined();
  });

  it('suggestPrep sends it to the AI and saves the basis', async () => {
    const root = await workspace();
    let seen: ReviewSuggestInput | undefined;
    const prep = await suggestPrep(root, 'CAFE-2026-003', async (input) => { seen = input; return { provider: 'fake', output: { decision: 'ask', reason: 'Ask', criteria: { feasible: true, builder: true, data: false, theme: true, reuse: true }, needs: [], updates: { builder: '', builderCanAttend: false, participation: '', resolvedFlags: [], facts: [], graph: { nodes: [], links: [] } }, learned: [] } as any }; }, clock);
    expect(seen!.network).toMatchObject({ cluster: { otherIdeas: expect.any(Array) } });
    expect(prep.basis).toMatch(/NetworkX network analysis \(a cluster with 2 other ideas/);
  });

  it('without Python the suggestion is made as today and the basis says network analysis was unavailable', () => noPython(async () => {
    const root = await workspace();
    const { input, basis } = await reviewInput(root, 'CAFE-2026-003', [], { network: true });
    expect(input.network).toEqual({ unavailable: expect.stringMatching(/^Network analysis needs Python 3\.9 or later on this machine\./) });
    expect(basis).toBe('Based on the form, a builder named, 3 graph links and no network analysis (unavailable: Network analysis needs Python 3.9 or later on this machine)');
    expect(input.graph).toHaveLength(3);
  }));
});

describe.skipIf(!PY)('NetworkX feeds the design duplicate check', () => {
  const travel = (features: string[]) => sampleIdea({ ...IDEAS[2], features });
  it('a feature that looks like a capability other ideas already need is flagged with those ideas; NetworkX\'s prediction lowers the wording bar', async () => {
    const root = await workspace();
    await saveIdea(root, travel(['Request handling', 'Policy answering', 'Booking amendment process']));
    const r = await similarStarsChecked(root, await loadIdea(root, 'CAFE-2026-003'));
    expect(r.network).toMatch(/^NetworkX 3\.\S+ over stored facts$/);
    expect(r.similar).toEqual([{
      feature: 'Booking amendment process', featureId: 'capability:booking-amendment-process', star: 'Booking update', starId: 'capability:booking-update',
      ideas: [{ id: 'idea:CAFE-2026-001', label: 'Desk booking assistant' }, { id: 'idea:CAFE-2026-002', label: 'Procurement FAQ bot' }],
      networkx: { version: expect.stringMatching(/^3\./), share: 1, peers: ['Procurement FAQ bot', 'Desk booking assistant'] },
    }]);
  });

  it('a close wording is flagged across ideas even when NetworkX does not predict it; without Python only the wording is used', () => noPython(async () => {
    const root = await workspace();
    await saveIdea(root, travel(['Request handling', 'Policy answering', 'Booking amendment process']));
    const off = await similarStarsChecked(root, await loadIdea(root, 'CAFE-2026-003'));
    expect(off.similar).toEqual([]);
    expect(off.network).toMatch(/^network analysis unavailable: Network analysis needs Python 3\.9/);
    await saveIdea(root, travel(['Request handling', 'Policy answering', 'Booking updates']));
    const close = await similarStarsChecked(root, await loadIdea(root, 'CAFE-2026-003'));
    expect(close.similar).toEqual([expect.objectContaining({ feature: 'Booking updates', starId: 'capability:booking-update', ideas: expect.any(Array) })]);
    expect(close.similar[0].networkx).toBeUndefined();
  }));
});

describe.skipIf(!PY)('NetworkX in the CSIC hand-off', () => {
  it('the JSON-LD carries the idea\'s network facts as labelled analysis, apart from @graph and links', async () => {
    const root = await workspace();
    await saveReview(root, 'CAFE-2026-003', { decision: 'csic', reason: 'Bigger than the Café' }, { clock, steps: DEFAULT_STEPS });
    const doc = JSON.parse(await readFile(path.join(await ideaDir(root, 'CAFE-2026-003'), 'csic-handoff.jsonld'), 'utf8'));
    expect(doc.networkAnalysis).toMatchObject({ kind: 'analysis', by: expect.stringMatching(/^NetworkX 3\./), scope: 'stored facts' });
    expect(doc.networkAnalysis.note).toMatch(/^Analysis, not stored facts/);
    expect(doc.networkAnalysis.cluster.otherIdeas.map((x: any) => x['@id']).sort()).toEqual(['cafe:idea:CAFE-2026-001', 'cafe:idea:CAFE-2026-002']);
    expect(doc.networkAnalysis.centrality[0]).toMatchObject({ '@id': 'cafe:capability:request-handling', measure: 'betweenness centrality', rank: 1 });
    expect(doc.networkAnalysis.likelyMissingLinks[0]).toMatchObject({ rel: 'NEEDS', to: { '@id': 'cafe:capability:booking-update' }, status: 'suggestion, not applied' });
    expect(doc['@graph'].some((n: any) => n['@id'] === 'cafe:idea:CAFE-2026-001')).toBe(false);
  });

  it('without Python the hand-off is written as today with the analysis marked unavailable', () => noPython(async () => {
    const root = await workspace();
    await saveReview(root, 'CAFE-2026-003', { decision: 'csic', reason: 'Bigger than the Café' }, { clock, steps: DEFAULT_STEPS });
    const doc = JSON.parse(await readFile(path.join(await ideaDir(root, 'CAFE-2026-003'), 'csic-handoff.jsonld'), 'utf8'));
    expect(doc.networkAnalysis).toEqual({ kind: 'analysis', note: expect.any(String), unavailable: expect.stringMatching(/^Network analysis needs Python 3\.9/) });
    expect(doc['@graph'].some((n: any) => n['@id'] === 'cafe:idea:CAFE-2026-003')).toBe(true);
  }));
});
