import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, chmod, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { tmpWorkspace, sampleIdea, startServer } from './helpers';
import { saveIdea } from '../src/ideas/store';
import { appendAiLink, rebuildGraph } from '../src/graph/store';
import { fixedClock } from '../src/clock';
import { createConnector } from '../src/ai/connector';
import { DEFAULT_SETTINGS } from '../src/round/round';
import { fakeProvider } from '../src/ai/providers/fake';
import { runCommand, doActions } from '../src/command/chat';
import { runQuery } from '../src/command/query';
import {
  NETWORK_SCRIPT, PYTHON_NEEDED, VENDOR_DIR, clearNetworkCache, networkCheck, networkFor, networkLines, networkRuns, pickWheel, pythonCandidates,
  readManifest, resolveStar, runNetwork, toNodeLink, verifyVendored, writeNetworkxExport, NetworkError,
} from '../src/graph/network';
import type { AiLink } from '../src/graph/ontology';

const run = promisify(execFile);
const APP = path.resolve(__dirname, '..');
const clock = fixedClock('2026-10-30');
/** The python3 this machine has. The suite needs one: on this machine it must run, elsewhere it is skipped with this reason. */
const PY = spawnSync('python3', ['-c', 'import sys;print(sys.executable)'], { encoding: 'utf8' }).stdout?.trim();
const SKIP = PY ? '' : 'no python3 on this machine: the NetworkX tests need Python 3.9+';
if (SKIP) console.warn(`tests/network.test.ts skipped: ${SKIP}`);
/** macOS's own Python 3.9, for the older vendored wheel, when there is one. */
const OLD_PY = ['/usr/bin/python3'].find((p) => /^3\.(9|10|11)\./.test(spawnSync(p, ['-c', 'import sys;print("%d.%d.%d" % sys.version_info[:3])'], { encoding: 'utf8' }).stdout ?? ''));

/**
 * Four ideas: three share capabilities (the third lacks Booking update, which both its peers need), a fourth whose
 * submitter's team has nothing else, so it sits apart. An AI link says Request handling uses the Shared mailbox.
 */
/** A second peer of the travel and desk assistants: link prediction wants two peers that each share two capabilities. */
const PEER = sampleIdea({ id: 'CAFE-2026-005', slug: 'rooms', title: 'Room booking helper', function: 'BSI', entity: 'CS', dedupe_key: 'e', features: ['Request handling', 'Policy answering', 'Booking update'], people: { submitter: 'Hana Kobayashi', team: [] } });
const IDEAS = [
  sampleIdea({ id: 'CAFE-2026-001', slug: 'desk', title: 'Desk booking assistant', function: 'BSI', entity: 'CS', dedupe_key: 'a', features: ['Request handling', 'Booking update'],
    people: { submitter: 'Avery Chen', team: [{ name: 'Avery Chen', roles: ['lead'] }] } }),
  sampleIdea({ id: 'CAFE-2026-002', slug: 'faq', title: 'Procurement FAQ bot', function: 'GSS', entity: 'CS', dedupe_key: 'b', features: ['Request handling', 'Policy answering', 'Booking update'],
    people: { submitter: 'Kwame Mensah', team: [{ name: 'Kwame Mensah', roles: ['lead'] }] } }),
  sampleIdea({ id: 'CAFE-2026-003', slug: 'travel', title: 'Travel policy assistant', function: 'GSS', entity: 'CS', dedupe_key: 'c', features: ['Request handling', 'Policy answering'],
    people: { submitter: 'Zainab Okafor', team: [] } }),
  sampleIdea({ id: 'CAFE-2026-004', slug: 'lonely', title: 'Lonely ledger tool', function: 'TAX', entity: 'CS', dedupe_key: 'd',
    people: { submitter: 'Ingrid Solberg', team: [] } }),
];
const LINK: AiLink = { from: 'capability:request-handling', rel: 'USES_DATA', to: 'system:shared-mailbox', description: 'Requests arrive there', source: 'ai:test', confidence: 0.9, status: 'confirmed', newNodes: [{ id: 'system:shared-mailbox', type: 'System', label: 'Shared mailbox' }] };

async function workspace(): Promise<string> {
  const root = await tmpWorkspace();
  for (const i of IDEAS) await saveIdea(root, i);
  // The AI read each of the three ideas that need Request handling and found the mailbox for each: one fact, three ideas.
  for (const idea of ['CAFE-2026-001', 'CAFE-2026-002', 'CAFE-2026-003']) await appendAiLink(root, { ...LINK, idea });
  return root;
}

describe.skipIf(!!SKIP)('NetworkX: the vendored copy', () => {
  it('ships two official wheels whose sha256 match the manifest, with the BSD-3 licence notice', async () => {
    const m = await readManifest();
    expect(m.licence).toBe('BSD-3-Clause');
    expect(m.wheels.map((w) => w.version)).toEqual(['3.7', '3.2.1']);
    expect((await verifyVendored()).every((v) => v.ok)).toBe(true);
    expect(await readFile(path.join(VENDOR_DIR, 'LICENCE-NOTICE.md'), 'utf8')).toMatch(/3-clause BSD/);
  });

  it('picks the newest wheel the Python supports: 3.7 from 3.12 (not 3.14.1), 3.2.1 for 3.9 to 3.11, none below 3.9', async () => {
    const m = await readManifest();
    expect(pickWheel(m, '3.14.2')?.version).toBe('3.7');
    expect(pickWheel(m, '3.12.0')?.version).toBe('3.7');
    expect(pickWheel(m, '3.14.1')?.version).toBe('3.2.1');
    expect(pickWheel(m, '3.9.6')?.version).toBe('3.2.1');
    expect(pickWheel(m, '3.8.10')).toBeUndefined();
  });

  it('looks for CAFE_PYTHON alone when set, else python3 then python (Windows: python, py -3, python3)', () => {
    expect(pythonCandidates({ CAFE_PYTHON: '/opt/py/bin/python3' }, 'darwin')).toEqual([{ cmd: '/opt/py/bin/python3', args: [] }]);
    expect(pythonCandidates({}, 'linux').map((c) => c.cmd)).toEqual(['python3', 'python']);
    expect(pythonCandidates({}, 'win32')).toEqual([{ cmd: 'python', args: [] }, { cmd: 'py', args: ['-3'] }, { cmd: 'python3', args: [] }]);
  });

  it('the check names the Python, the wheel it imports with -I -S, and the checksums', async () => {
    const { lines, ok } = await networkCheck();
    expect(ok).toBe(true);
    expect(lines.join('\n')).toMatch(/Python: 3\.\d+\.\d+/);
    expect(lines.join('\n')).toMatch(/NetworkX: 3\.(7|2\.1), imported from networkx-3\.(7|2\.1)-py3-none-any\.whl with python -I -S/);
    expect(lines.join('\n')).toMatch(/sha256 matches MANIFEST\.json/);
    expect(lines.at(-1)).toBe('Network analysis is ready.');
  });
});

describe.skipIf(!!SKIP)('NetworkX: the analyses', () => {
  let root: string;
  beforeAll(async () => { root = await workspace(); clearNetworkCache(); });

  it('the node-link JSON holds the stored facts only unless derived links are asked for, and says which', async () => {
    const g = await rebuildGraph(root);
    const stored = toNodeLink(g, false); const all = toNodeLink(g, true);
    expect(stored.edges.some((e) => e.derived)).toBe(false);
    expect(all.edges.filter((e) => e.derived).map((e) => e.rel)).toEqual(expect.arrayContaining(['DEPENDS_ON', 'SIMILAR_TO']));
    expect(stored.edges.length).toBe(g.edges.filter((e) => !e.derived).length);
    expect(stored.graph.scope).toBe('stored'); expect(all.graph.scope).toBe('with-derived');
    expect(stored).toMatchObject({ directed: true, multigraph: true });
  });

  it('stats: size, density, components, clustering; rounds and the division are left out of the analysis', async () => {
    const o = await networkFor(root, 'stats');
    const r = o.results.stats;
    expect(o.scopeText).toBe('confirmed stored facts');
    expect(r.nodes).toBe((await rebuildGraph(root)).nodes.length);
    expect(r.analysed.nodes).toBe(r.nodes - (r.byType.Round ?? 0) - (r.byType.Entity ?? 0));
    expect(r.components).toBe(2);
    expect(r.density).toBeGreaterThan(0);
    expect(networkLines(o).at(-1)).toMatch(/^NetworkX 3\.\S+ \(Python 3\.\d+\.\d+\), confirmed stored facts$/);
  });

  it('central: betweenness and degree, top stars with type and score, and per type', async () => {
    const r = (await networkFor(root, 'central', { top: 3 })).results.central;
    expect(r.betweenness[0]).toMatchObject({ id: 'capability:request-handling', type: 'Capability', label: 'Request handling', ideas: 3 });
    expect(r.betweenness).toHaveLength(3);
    expect(r.byType.Capability[0].id).toBe('capability:request-handling');
    expect(r.byType.System[0].id).toBe('system:shared-mailbox');
    expect(r.betweenness.every((x: any) => x.type !== 'Idea')).toBe(true);
  });

  it('clusters: Louvain over the ideas with the stars that bind each group; an idea sharing nothing is on its own; the same twice (seeded)', async () => {
    const r = (await networkFor(root, 'clusters')).results.clusters;
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0].ideas.map((x: any) => x.id)).toEqual(['idea:CAFE-2026-001', 'idea:CAFE-2026-002', 'idea:CAFE-2026-003']);
    expect(r.clusters[0].binding[0]).toMatchObject({ id: 'capability:request-handling', ideas: 3 });
    expect(r.alone.map((x: any) => x.id)).toEqual(['idea:CAFE-2026-004']);
    clearNetworkCache();
    expect((await networkFor(root, 'clusters')).results.clusters).toEqual(r);
  });

  it('path: by label or Café ID, with the link on each hop', async () => {
    const o = await networkFor(root, 'path', { a: 'CAFE-2026-001', b: 'Shared mailbox' });
    const r = o.results.path;
    expect(r).toMatchObject({ found: true, length: 2, count: 1 });
    expect(r.paths[0].hops.map((h: any) => h.rels[0].rel)).toEqual(['NEEDS', 'USES_DATA']);
    expect(networkLines(o).join('\n')).toMatch(/Desk booking assistant needs Request handling/);
    const none = await networkFor(root, 'path', { a: 'Lonely ledger tool', b: 'Shared mailbox' });
    expect(none.results.path).toMatchObject({ found: false, reason: 'no chain of links joins them' });
    await expect(networkFor(root, 'path', { a: 'nothing like this', b: 'Shared mailbox' })).rejects.toThrow('No star is named like "nothing like this"');
  });

  it('isolated: the idea, team and person not connected to the rest', async () => {
    const r = (await networkFor(root, 'isolated')).results.isolated;
    expect(r.components).toBe(2);
    expect(r.outside.map((x: any) => x.id)).toEqual(['idea:CAFE-2026-004', 'team:tax']);
    expect(r.apart[0].stars.map((x: any) => x.id).sort()).toEqual(['idea:CAFE-2026-004', 'person:ingrid-solberg', 'team:tax']);
  });

  it('suggest: the capability two peers need (each sharing two capabilities), with the peers and shared stars as the reason; the graph is not changed', async () => {
    // One peer alone is no evidence: with the fixture's three related ideas nothing is suggested; a second peer makes it.
    expect((await networkFor(root, 'suggest')).results.suggest.suggestions).toEqual([]);
    const root2 = await workspace(); await saveIdea(root2, PEER);
    const before = (await rebuildGraph(root2)).edges.length;
    const r = (await networkFor(root2, 'suggest')).results.suggest;
    // Two hold at 100 %: the travel assistant lacks Booking update and the desk assistant Policy answering, each needed by both its peers.
    expect(r.suggestions.slice(0, 2).map((x: any) => `${x.from.id} ${x.to.id}`).sort()).toEqual(['idea:CAFE-2026-001 capability:policy-answering', 'idea:CAFE-2026-003 capability:booking-update']);
    const top = r.suggestions.find((x: any) => x.from.id === 'idea:CAFE-2026-003');
    expect(top).toMatchObject({ from: { id: 'idea:CAFE-2026-003' }, rel: 'NEEDS', to: { id: 'capability:booking-update' }, share: 1 });
    expect(top.because.map((b: any) => b.peer.id).sort()).toEqual(['idea:CAFE-2026-002', 'idea:CAFE-2026-005']);
    expect(top.because[0].shared.map((s: any) => s.id)).toEqual(['capability:policy-answering', 'capability:request-handling']);
    expect(top.adamicAdar).toBeGreaterThan(0); expect(top.jaccard).toBeGreaterThan(0);
    expect(r).toMatchObject({ minShared: 2, minPeers: 2, formChoices: 'left out' });
    expect((await rebuildGraph(root2)).edges.length).toBe(before);
  });

  it('cycles: with the built-in ontology no relation can form one, and the analysis says it has nothing to look for', async () => {
    const stored = await networkFor(root, 'cycles');
    const derived = await networkFor(root, 'cycles', {}, { withDerived: true });
    expect(stored.results.cycles).toMatchObject({ applicable: false, count: 0, cycles: [], relations: [] });
    expect(stored.results.cycles.why).toMatch(/^no relation in this ontology can form a cycle/);
    expect(networkLines(stored)[0]).toMatch(/^Nothing to look for: no relation in this ontology can form a cycle/);
    expect(derived.scopeText).toBe('confirmed stored facts and derived links');
    expect(networkLines(derived).at(-1)).toMatch(/confirmed stored facts and derived links$/);
  });

  it('results are cached per graph version: the same question runs NetworkX once, a changed graph runs it again', async () => {
    clearNetworkCache();
    const n0 = networkRuns.count;
    await networkFor(root, 'stats'); const again = await networkFor(root, 'stats');
    expect(again.cached).toBe(true);
    expect(networkRuns.count - n0).toBe(1);
    const other = await workspace();
    await saveIdea(other, sampleIdea({ id: 'CAFE-2026-005', slug: 'more', title: 'One more idea', dedupe_key: 'e', people: { submitter: 'Avery Chen', team: [] } }));
    await networkFor(other, 'stats');
    expect(networkRuns.count - n0).toBe(2);
  });

  it('the script is deterministic: two runs of every analysis give the same bytes', async () => {
    const g = await rebuildGraph(root);
    const payload = JSON.stringify({ graph: toNodeLink(g, false), analyses: ['stats', 'central', 'clusters', 'isolated', 'suggest', 'cycles'], options: {} });
    const wheel = path.join(VENDOR_DIR, pickWheel(await readManifest(), spawnSync('python3', ['-c', 'import sys;print("%d.%d.%d" % sys.version_info[:3])'], { encoding: 'utf8' }).stdout.trim())!.file);
    const once = () => spawnSync('python3', ['-I', '-S', NETWORK_SCRIPT, wheel], { input: payload, encoding: 'utf8' });
    const a = once(); const b = once();
    expect(a.status).toBe(0);
    expect(a.stdout).toBe(b.stdout);
    expect(a.stderr).toBe('');
    // A wrong input is one line of JSON, never a stack trace.
    const bad = spawnSync('python3', ['-I', '-S', NETWORK_SCRIPT, wheel], { input: JSON.stringify({ graph: { nodes: [], edges: [] }, analyses: ['nope'] }), encoding: 'utf8' });
    expect(JSON.parse(bad.stdout)).toEqual({ error: 'ValueError: unknown analysis nope' });
    expect(bad.stderr).toBe('');
    // (Three Python runs in a row: slower than the default 20 s when the whole suite runs in parallel.)
  }, 60_000);

  it.skipIf(!OLD_PY)('Python 3.9 (macOS\'s own) runs the older wheel and gets the same answers', async () => {
    clearNetworkCache();
    const env = { ...process.env, CAFE_PYTHON: OLD_PY };
    for (const a of ['stats', 'central', 'isolated', 'suggest', 'cycles'] as const) {
      const old = await networkFor(root, a, {}, { env });
      expect(old.networkx).toBe('3.2.1');
      const now = await networkFor(root, a);
      expect(old.results).toEqual(now.results);
    }
    expect((await networkFor(root, 'clusters', {}, { env })).results.clusters.clusters[0].ideas).toHaveLength(3);
  });
});

describe.skipIf(!!SKIP)('NetworkX: when Python is missing or too old', () => {
  it('a missing Python is one plain message, kind python, no stack trace', async () => {
    clearNetworkCache();
    const g = await rebuildGraph(await workspace());
    const e = await runNetwork(g, ['stats'], {}, { env: { ...process.env, CAFE_PYTHON: '/nowhere/python3' } }).then(() => { throw new Error("expected a failure"); }, (x) => x as NetworkError);
    expect(e).toBeInstanceOf(NetworkError);
    expect(e.kind).toBe('python');
    expect(e.message).toBe(`${PYTHON_NEEDED} CAFE_PYTHON is set to /nowhere/python3, which could not be run. Install Python 3.9+ (python.org, or the firm's software centre) or set CAFE_PYTHON to its path, then try again. Everything else in the Café works without it.`);
  });

  it('a Python older than 3.9 is named', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cafe-oldpy-'));
    const fake = path.join(dir, 'python3');
    await writeFile(fake, '#!/bin/sh\necho 3.8.10\necho /usr/local/bin/python3.8\n');
    await chmod(fake, 0o755);
    clearNetworkCache();
    const g = await rebuildGraph(await workspace());
    await expect(runNetwork(g, ['stats'], {}, { env: { ...process.env, CAFE_PYTHON: fake } })).rejects.toThrow(`${PYTHON_NEEDED} Found ${fake} is 3.8.10.`);
    const check = await networkCheck({ ...process.env, CAFE_PYTHON: fake });
    expect(check.ok).toBe(false);
    expect(check.lines.at(-1)).toBe('Network analysis is not ready: see above.');
  });

  it('a run that takes too long is stopped with a plain message', async () => {
    clearNetworkCache();
    const g = await rebuildGraph(await workspace());
    await expect(runNetwork(g, ['central'], {}, { timeoutMs: 1 })).rejects.toThrow(/NetworkX took longer than 0 s and was stopped/);
  });
});

describe.skipIf(!!SKIP)('NetworkX: resolving stars by name', () => {
  it('by id, Café ID, exact label (accents and case ignored), or the shortest label containing the words', () => {
    const nodes = [
      { id: 'idea:CAFE-2026-001', type: 'Idea' as const, label: 'Desk booking assistant', attrs: { cafeId: 'CAFE-2026-001' } },
      { id: 'system:cafe', type: 'System' as const, label: 'Café ledger' },
      { id: 'system:ledger-archive', type: 'System' as const, label: 'Café ledger archive' },
    ];
    expect(resolveStar(nodes, 'system:cafe')?.id).toBe('system:cafe');
    expect(resolveStar(nodes, 'cafe-2026-001')?.id).toBe('idea:CAFE-2026-001');
    expect(resolveStar(nodes, 'CAFE LEDGER')?.id).toBe('system:cafe');
    expect(resolveStar(nodes, 'ledger')?.id).toBe('system:cafe');
    expect(resolveStar(nodes, 'nothing')).toBeUndefined();
  });
});

describe.skipIf(!!SKIP)('NetworkX: the CLI', () => {
  const cafe = (args: string[], env: NodeJS.ProcessEnv = process.env) => run(process.execPath, [path.join(APP, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(APP, 'bin', 'cafe.ts'), ...args], { cwd: APP, env, timeout: 60_000 }).catch((e) => e as { stdout: string; stderr: string; code: number });

  it('cafe network stats | central | path A B | suggest, plain and --json, saying the facts read', async () => {
    const root = await workspace();
    const stats = await cafe(['network', 'stats', '--workspace', root]);
    expect(stats.stdout).toMatch(/^Stars: \d+, links: \d+/);
    expect(stats.stdout.trim().split('\n').at(-1)).toMatch(/^NetworkX 3\.\S+ \(Python [\d.]+\), confirmed stored facts$/);
    const path_ = await cafe(['network', 'path', 'Desk booking assistant', 'Shared mailbox', '--with-derived', '--workspace', root]);
    expect(path_.stdout).toMatch(/Shortest path from Desk booking assistant to Shared mailbox: 1 hop/);
    expect(path_.stdout).toMatch(/Desk booking assistant depends on Shared mailbox/);
    expect(path_.stdout).toMatch(/confirmed stored facts and derived links/);
    await saveIdea(root, PEER);
    const json = JSON.parse((await cafe(['network', 'suggest', '--json', '--workspace', root])).stdout);
    expect(json).toMatchObject({ analysis: 'suggest', scope: 'stored', scopeText: 'confirmed stored facts' });
    expect(json.results.suggest.suggestions.map((x: any) => x.to.id)).toContain('capability:booking-update');
    const all = await cafe(['network', 'central', '--with-form-choices', '--workspace', root]);
    expect(all.stdout).not.toMatch(/form choices \(outcomes, support, categories, beneficiaries\) left out/);
    // Four CLI runs, each starting tsx and Python: under a full parallel run they take longer than the default 20 s.
  }, 90_000);

  it('cafe network check, a wrong analysis, and a missing Python each say so plainly', async () => {
    const check = await cafe(['network', 'check']);
    expect(check.stdout).toMatch(/Network analysis is ready\./);
    const wrong = await cafe(['network', 'pagerank']) as { stderr: string; code: number };
    expect(wrong.code).toBe(1);
    expect(wrong.stderr).toMatch(/^Usage: cafe network <check \| stats \| central/);
    const root = await workspace();
    const nopy = await cafe(['network', 'stats', '--workspace', root], { ...process.env, CAFE_PYTHON: '/nowhere/python3' }) as { stderr: string; code: number };
    expect(nopy.code).toBe(1);
    expect(nopy.stderr.trim()).toMatch(/^Network analysis needs Python 3\.9 or later on this machine\./);
    expect(nopy.stderr).not.toMatch(/\n\s+at /);
  });

  it('cafe export --format networkx writes node-link JSON that networkx.node_link_graph loads, and the example script reads it', async () => {
    const root = await workspace();
    const out = await cafe(['export', '--format', 'networkx', '--workspace', root]);
    const file = /Written: (.+\.networkx\.json)/.exec(out.stdout)![1];
    const doc = JSON.parse(await readFile(file, 'utf8'));
    expect(doc).toMatchObject({ directed: true, multigraph: true, graph: { name: 'creators-cafe', scope: 'with-derived' } });
    expect(doc.edges.some((e: any) => e.derived)).toBe(true);
    expect(doc.nodes.find((n: any) => n.id === 'idea:CAFE-2026-001').attrs.cafeId).toBe('CAFE-2026-001');
    const wheel = path.join(VENDOR_DIR, pickWheel(await readManifest(), spawnSync('python3', ['-c', 'import sys;print("%d.%d.%d" % sys.version_info[:3])'], { encoding: 'utf8' }).stdout.trim())!.file);
    const ex = spawnSync('python3', [path.join(APP, 'docs', 'networkx-example.py'), file], { env: { ...process.env, PYTHONPATH: wheel }, encoding: 'utf8' });
    expect(ex.stderr).toBe('');
    expect(ex.stdout).toMatch(/MultiDiGraph named 'creators-cafe' with \d+ nodes and \d+ edges \| stored facts: \d+ links/);
    expect(ex.stdout).toMatch(/Most central: \[\('[^']+', 0\.\d+\)/);
    expect((await readFile(path.join(APP, 'docs', 'networkx-example.py'), 'utf8')).trim().split('\n')).toHaveLength(15);
    const again = await writeNetworkxExport(root, clock);
    expect(again).toMatch(/-all\.networkx\.json$/);
    expect(await readdir(path.join(root, 'data', 'exports'))).toContain(path.basename(again));
  });
});

describe.skipIf(!!SKIP)('NetworkX: the API', () => {
  it('GET /api/network: one analysis or several, stored facts unless withDerived; read-only; a wrong name is a plain 400', async () => {
    const s = await startServer();
    try {
      for (const i of IDEAS) await saveIdea(s.root, i);
      for (const idea of ['CAFE-2026-001', 'CAFE-2026-002', 'CAFE-2026-003']) await appendAiLink(s.root, { ...LINK, idea });
      const one = await (await fetch(`${s.base}/api/network?analysis=central&top=3`)).json() as any;
      expect(one).toMatchObject({ analysis: 'central', scope: 'stored', scopeText: 'confirmed stored facts' });
      expect(one.results.central.betweenness[0].id).toBe('capability:request-handling');
      const many = await (await fetch(`${s.base}/api/network?analysis=stats,clusters,isolated,suggest&withDerived=1`)).json() as any;
      expect(many.analyses).toEqual(['stats', 'clusters', 'isolated', 'suggest']);
      expect(Object.keys(many.results).sort()).toEqual(['clusters', 'isolated', 'stats', 'suggest']);
      expect(many.scopeText).toBe('confirmed stored facts and derived links');
      const p = await (await fetch(`${s.base}/api/network?analysis=path&a=${encodeURIComponent('Travel policy assistant')}&b=${encodeURIComponent('Shared mailbox')}`)).json() as any;
      expect(p.results.path.found).toBe(true);
      const bad = await fetch(`${s.base}/api/network?analysis=pagerank`);
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as any).error).toMatch(/There is no analysis "pagerank"/);
      expect((await fetch(`${s.base}/api/network?analysis=stats`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404);
    } finally { s.server.close(); }
  });

  it('POST /api/network/propose puts the suggested link in the assistant as a proposal; only Do it makes it', async () => {
    const s = await startServer();
    try {
      for (const i of [...IDEAS, PEER]) await saveIdea(s.root, i);
      const post = (url: string, body: unknown) => fetch(`${s.base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const entry = await (await post('/api/network/propose', { from: 'idea:CAFE-2026-003', rel: 'NEEDS', to: 'capability:booking-update', why: 'like Procurement FAQ bot' })).json() as any;
      expect(entry).toMatchObject({ kind: 'command', actions: [{ status: 'proposed', label: 'Link Travel policy assistant → Booking update (needs) · suggested by NetworkX', action: { t: 'link', from: 'idea:CAFE-2026-003', rel: 'NEEDS', to: 'capability:booking-update' } }] });
      expect(entry.reply).toMatch(/nothing changes until you press Do it/);
      const has = async () => (await rebuildGraph(s.root)).edges.some((e) => e.id === 'idea:CAFE-2026-003|NEEDS|capability:booking-update');
      expect(await has()).toBe(false);
      const done = await (await post(`/api/chat/${entry.id}/do`, {})).json() as any;
      expect(done.actions[0].status).toBe('done');
      expect(await has()).toBe(true);
      const again = await post('/api/network/propose', { from: 'idea:CAFE-2026-003', rel: 'NEEDS', to: 'capability:booking-update' });
      expect(again.status).toBe(400);
      expect(((await again.json()) as any).error).toBe('Travel policy assistant and Booking update are already linked.');
      expect((await post('/api/network/propose', { from: 'idea:CAFE-2026-003', rel: 'DEPENDS_ON', to: 'capability:booking-update' })).status).toBe(400);
    } finally { s.server.close(); }
  });
});

describe.skipIf(!!SKIP)('NetworkX in the assistant (the fake provider plans the network steps)', () => {
  const withFake = async <T>(f: () => Promise<T>) => { const was = process.env.CAFE_AI_FAKE; process.env.CAFE_AI_FAKE = '1'; try { return await f(); } finally { process.env.CAFE_AI_FAKE = was; } };
  const ai = () => createConnector({ providers: [fakeProvider()], settings: DEFAULT_SETTINGS });

  it('"which capability holds the most ideas together?": betweenness over stored facts, said in the trace and the reply', () => withFake(async () => {
    const root = await workspace();
    const e = await runCommand(root, 'which capability holds the most ideas together?', ai(), clock);
    expect(e.kind).toBe('question');
    expect(e.trace![0][0].text).toBe('NetworkX betweenness centrality over confirmed stored facts: top 3 capabilities');
    expect(e.trace![0][1].text).toMatch(/^Request handling: 0\.\d{3} \(3 ideas, \d+ links\)$/);
    expect(e.reply).toMatch(/^By NetworkX 3\.\S+, confirmed stored facts, Request handling holds the most ideas together/);
    expect(e.highlight).toContain('capability:request-handling');
  }));

  it('"which ideas naturally group together?" and "is anything isolated?" answer from Louvain and the components', () => withFake(async () => {
    const root = await workspace();
    const groups = await runCommand(root, 'which ideas naturally group together?', ai(), clock);
    // One group is no grouping: NetworkX's modularity says so, and the reply says there are no clear groups.
    expect(groups.trace![0][0].text).toBe('NetworkX Louvain communities over confirmed stored facts: no clear groups: the ideas fall into one group or none, so there is nothing to tell apart');
    expect(groups.trace![0][1].text).toBe('1 tentative group (not a finding, shown for reference):');
    expect(groups.trace![0][2].text).toBe('Cluster 1: Desk booking assistant, Procurement FAQ bot, Travel policy assistant, bound by Request handling, Booking update, Policy answering');
    expect(groups.reply).toMatch(/^No clear groups \(NetworkX 3\.\S+, confirmed stored facts\): the ideas fall into one group or none/);
    const alone = await runCommand(root, 'is anything isolated?', ai(), clock);
    expect(alone.reply).toMatch(/Not connected to the rest .*: Lonely ledger tool, TAX\./);
  }));

  it('"how is @Avery Chen connected to @Shared mailbox?": the path with the link on each hop', () => withFake(async () => {
    const root = await workspace();
    const e = await runCommand(root, 'how is @Avery Chen connected to @Shared mailbox?', ai(), clock, { mentions: ['person:avery-chen', 'system:shared-mailbox'] });
    expect(e.trace![0].map((t) => t.text)).toEqual([
      'NetworkX shortest paths over confirmed stored facts: 3 hops',
      'Avery Chen leads Desk booking assistant; Avery Chen submitted Desk booking assistant',
      'Desk booking assistant needs Request handling',
      'Request handling uses data Shared mailbox (stated for Desk booking assistant, Procurement FAQ bot, Travel policy assistant only)',
    ]);
    expect(e.reply).toMatch(/3 hops/);
  }));

  it('"what links are probably missing?": suggestions come back as proposals with Do it; nothing is applied until then', () => withFake(async () => {
    const root = await workspace(); await saveIdea(root, PEER);
    const before = (await rebuildGraph(root)).edges.length;
    const e = await runCommand(root, 'what links are probably missing?', ai(), clock);
    expect(e.trace![0][0].text).toMatch(/^NetworkX link prediction \(Adamic-Adar, Jaccard\) over confirmed stored facts: \d+ links? probably missing, proposals only$/);
    expect(e.actions.every((a) => a.status === 'proposed' && a.label.endsWith('· suggested by NetworkX'))).toBe(true);
    const travel = e.actions.find((a) => a.action.t === 'link' && a.action.from === 'idea:CAFE-2026-003')!;
    expect(travel).toMatchObject({ status: 'proposed', label: 'Link Travel policy assistant → Booking update (needs) · suggested by NetworkX', action: { t: 'link', from: 'idea:CAFE-2026-003', rel: 'NEEDS', to: 'capability:booking-update' } });
    expect(e.reply).toMatch(/each is a proposal below for you to accept or not/);
    expect((await rebuildGraph(root)).edges.length).toBe(before);
    await doActions(root, e.id, travel.id, clock);
    expect((await rebuildGraph(root)).edges.some((x) => x.id === 'idea:CAFE-2026-003|NEEDS|capability:booking-update')).toBe(true);
  }));

  it('the AI sees the network facts in codes, never a person\'s name', async () => {
    const root = await workspace();
    const prompts: string[] = [];
    let n = 0;
    const provider = {
      id: 'claude' as const, label: 'Test AI', available: async () => true,
      complete: async (prompt: string) => {
        prompts.push(prompt);
        return JSON.stringify(n++ === 0 ? { next: 'search', thought: 'Asking NetworkX', query: { steps: [{ op: 'network', analysis: 'central', type: 'Person', limit: 3 }] } } : { next: 'answer', thought: 'Answering', reply: 'Done.' });
      },
    };
    await runCommand(root, 'which person holds the most together?', createConnector({ providers: [provider], settings: DEFAULT_SETTINGS }), clock);
    expect(prompts[1]).toMatch(/"network":\[\{"analysis":"central","by":"NetworkX 3\.\S+","scope":"confirmed stored facts","facts":\{"measure":"betweenness centrality","type":"Person","top":\[\{"star":"P\d+"/);
    expect(prompts.join('\n')).not.toMatch(/Avery|Kwame|Zainab|Ingrid/);
  });

  it('with no Python the step is not run and the trace says why; the rest of the assistant works', () => withFake(async () => {
    const root = await workspace();
    clearNetworkCache();
    const was = process.env.CAFE_PYTHON; process.env.CAFE_PYTHON = '/nowhere/python3';
    try {
      const e = await runCommand(root, 'which ideas naturally group together?', ai(), clock);
      expect(e.trace![0][0].text).toMatch(/^Not run: Network analysis needs Python 3\.9 or later on this machine\./);
      expect(e.reply).toMatch(/^Network analysis needs Python 3\.9 or later/);
      expect(e.error).toBeUndefined();
    } finally { if (was === undefined) delete process.env.CAFE_PYTHON; else process.env.CAFE_PYTHON = was; clearNetworkCache(); }
  }));
});

describe('the network step in runQuery (NetworkX prepared beforehand)', () => {
  it('without a prepared answer it is not run, and other steps are untouched', () => {
    const r = runQuery({ steps: [{ op: 'network', analysis: 'isolated' }] }, { graph: { nodes: [], edges: [] }, ideas: [], rounds: [], idOf: () => undefined });
    expect(r.trace).toEqual([{ text: 'Not run: NetworkX was not run for this step', size: 0 }]);
    expect(r.final).toEqual([]);
  });

  it('with derived: true the trace says stored facts and derived links', () => {
    const nodes = [{ id: 'team:a', type: 'Team' as const, label: 'A' }];
    const step = { op: 'network' as const, analysis: 'isolated' as const, derived: true };
    const r = runQuery({ steps: [step] }, {
      graph: { nodes, edges: [] }, ideas: [], rounds: [], idOf: () => undefined,
      network: () => ({ ok: { networkx: '3.7', scopeText: 'stored facts and derived links', results: { isolated: { components: 2, main: 3, outside: [{ id: 'team:a', type: 'Team', label: 'A' }], apart: [] } } } }),
    });
    expect(r.trace.map((t) => t.text)).toEqual(['NetworkX connected components over stored facts and derived links: 2 components, the main one 3 stars', 'Not connected to the rest: A']);
    expect(r.final).toEqual(['team:a']);
    expect(r.network![0]).toMatchObject({ analysis: 'isolated', scope: 'stored facts and derived links', facts: { notConnected: ['team:a'] } });
  });
});
