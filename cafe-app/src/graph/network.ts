import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { APP_DIR, paths } from '../workspace/paths';
import { writeFileAtomic } from '../workspace/files';
import { rebuildGraph } from './store';
import { slug, type GEdge, type GNode, type NodeType, type Relation } from './ontology';
import type { Clock } from '../clock';
import type { NetworkStepRun, Query, QueryStep } from '../command/query';

/**
 * NetworkX for whole-network analysis: the app builds the graph (build.ts, rules.ts), NetworkX analyses it.
 * The graph goes to py/network.py as node-link JSON on stdin; the answer comes back as JSON on stdout. NetworkX is
 * vendored (vendor/networkx, the official pure-Python wheels, imported from the zip) and run with `python -I -S`, so
 * nothing is downloaded and nothing the machine has installed is used. It never writes the graph: a suggested link
 * is only ever a proposal the operator accepts with Do it.
 *
 * By default the analysis reads the STORED facts only (the form, the AI links, the operator's edits: every link
 * without `derived`); withDerived adds the links the rules derive. Every result says which.
 */

export const NETWORK_ANALYSES = ['stats', 'central', 'clusters', 'path', 'isolated', 'suggest', 'cycles'] as const;
export type NetworkAnalysis = (typeof NETWORK_ANALYSES)[number];
export const VENDOR_DIR = path.join(APP_DIR, 'vendor', 'networkx');
export const NETWORK_SCRIPT = path.join(APP_DIR, 'py', 'network.py');
export const MIN_PYTHON = '3.9';
const TIMEOUT_MS = 60_000;

/** The one message every NetworkX feature shows when Python is missing or too old. The rest of the app is unaffected. */
export const PYTHON_NEEDED = 'Network analysis needs Python 3.9 or later on this machine.';
const PYTHON_HOW = 'Install Python 3.9+ (python.org, or the firm\'s software centre) or set CAFE_PYTHON to its path, then try again. Everything else in the Café works without it.';

export class NetworkError extends Error {
  constructor(message: string, readonly kind: 'python' | 'vendor' | 'failed' | 'timeout' | 'input' = 'failed') { super(message); }
}

/* ---------- the node-link JSON ---------- */

export interface NodeLinkNode { id: string; type: NodeType; label: string; attrs?: GNode['attrs'] }
export interface NodeLinkEdge { source: string; target: string; key: string; rel: Relation; derived?: boolean; confirmed?: boolean; fact_source?: string; ideas?: string[] }
export interface NodeLink {
  directed: true; multigraph: true;
  graph: { name: string; scope: 'stored' | 'with-derived'; exported?: string };
  nodes: NodeLinkNode[]; edges: NodeLinkEdge[];
}

/** Which facts an analysis read, in words: said in every output. */
export const scopeText = (withDerived: boolean) => (withDerived ? 'stored facts and derived links' : 'stored facts');

/**
 * The app's graph as node-link JSON (networkx.node_link_graph reads it: directed, multigraph, edges keyed by relation).
 * Stored facts only unless withDerived. `full` keeps the attributes and where each fact came from, for the export.
 */
export function toNodeLink(graph: { nodes: GNode[]; edges: GEdge[] }, withDerived: boolean, full = false): NodeLink {
  const edges = graph.edges.filter((e) => withDerived || !e.derived);
  return {
    directed: true, multigraph: true,
    graph: { name: 'creators-cafe', scope: withDerived ? 'with-derived' : 'stored' },
    nodes: graph.nodes.map((n) => ({ id: n.id, type: n.type, label: n.label, ...(full && n.attrs ? { attrs: n.attrs } : {}) })),
    edges: edges.map((e) => ({
      source: e.from, target: e.to, key: e.rel, rel: e.rel,
      ...(e.derived ? { derived: true } : {}),
      ...(full ? { confirmed: e.confirmed, fact_source: e.source, ...(e.ideas?.length ? { ideas: e.ideas } : {}) } : {}),
    })),
  };
}

/* ---------- Python and the vendored NetworkX ---------- */

export interface PythonFound { cmd: string; args: string[]; version: string; path?: string }
export interface VendorWheel { file: string; version: string; sha256: string; bytes: number; minPython: string; excludePython?: string[] }
export interface Manifest { package: string; licence: string; origin: string; downloadedAt: string; wheels: VendorWheel[] }

const vparts = (v: string) => v.split('.').map((x) => Number.parseInt(x, 10) || 0);
/** a >= b, comparing major.minor.patch. */
export const atLeast = (a: string, b: string) => { const x = vparts(a); const y = vparts(b); for (let i = 0; i < 3; i++) { if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0); } return true; };

interface Ran { code: number | null; out: string; err: string; timedOut: boolean; spawnError?: string }
function run(cmd: string, args: string[], input: string | undefined, timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<Ran> {
  return new Promise((resolve) => {
    let out = ''; let err = ''; let timedOut = false; let done = false;
    let child: ReturnType<typeof spawn>;
    const finish = (r: { code: number | null; spawnError?: string }) => { if (done) return; done = true; clearTimeout(t); resolve({ ...r, out, err, timedOut }); };
    try {
      child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: env ?? process.env });
    } catch (e) { resolve({ code: null, out: '', err: '', timedOut: false, spawnError: (e as Error).message }); return; }
    const t = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout!.setEncoding('utf8'); child.stderr!.setEncoding('utf8');
    child.stdout!.on('data', (d: string) => { out += d; });
    child.stderr!.on('data', (d: string) => { err += d; });
    child.on('error', (e) => finish({ code: null, spawnError: e.message }));
    child.on('close', (code) => finish({ code }));
    child.stdin!.on('error', () => { /* the child went before reading: its exit says why */ });
    child.stdin!.end(input ?? '');
  });
}

/** The commands tried, in order: CAFE_PYTHON when set (and only it), then python3, then python (Windows: python, py -3, python3). */
export function pythonCandidates(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): { cmd: string; args: string[] }[] {
  if (env.CAFE_PYTHON?.trim()) return [{ cmd: env.CAFE_PYTHON.trim(), args: [] }];
  return platform === 'win32'
    ? [{ cmd: 'python', args: [] }, { cmd: 'py', args: ['-3'] }, { cmd: 'python3', args: [] }]
    : [{ cmd: 'python3', args: [] }, { cmd: 'python', args: [] }];
}

const PROBE = 'import sys;print("%d.%d.%d" % sys.version_info[:3]);print(sys.executable)';
const pythonCache = new Map<string, Promise<PythonFound>>();

/** The Python to run, checked once per process (per CAFE_PYTHON and PATH). A NetworkError of kind python when none will do. */
export function findPython(env: NodeJS.ProcessEnv = process.env): Promise<PythonFound> {
  const key = `${env.CAFE_PYTHON ?? ''}|${env.PATH ?? ''}`;
  let p = pythonCache.get(key);
  if (!p) { p = probePython(env); pythonCache.set(key, p); p.catch(() => pythonCache.delete(key)); }
  return p;
}

async function probePython(env: NodeJS.ProcessEnv): Promise<PythonFound> {
  const tooOld: string[] = [];
  for (const c of pythonCandidates(env)) {
    const r = await run(c.cmd, [...c.args, '-I', '-S', '-c', PROBE], undefined, 10_000, env);
    if (r.code !== 0) continue;
    const [version, exe] = r.out.trim().split(/\r?\n/);
    if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) continue;
    if (!atLeast(version, MIN_PYTHON)) { tooOld.push(`${c.cmd} is ${version}`); continue; }
    return { cmd: c.cmd, args: c.args, version, ...(exe?.trim() ? { path: exe.trim() } : {}) };
  }
  const set = env.CAFE_PYTHON?.trim();
  const found = tooOld.length ? `Found ${tooOld.join(', ')}.` : set ? `CAFE_PYTHON is set to ${set}, which could not be run.` : 'No python3 or python was found.';
  throw new NetworkError(`${PYTHON_NEEDED} ${found} ${PYTHON_HOW}`, 'python');
}

export async function readManifest(dir = VENDOR_DIR): Promise<Manifest> {
  try { return JSON.parse(await readFile(path.join(dir, 'MANIFEST.json'), 'utf8')) as Manifest; } catch {
    throw new NetworkError(`The NetworkX copy shipped with the app is missing (${path.join(dir, 'MANIFEST.json')}). Restore it with: git checkout -- cafe-app/vendor`, 'vendor');
  }
}

/** The newest vendored wheel this Python can run (3.7 needs Python 3.12+; 3.2.1 runs on 3.9 to 3.11). */
export function pickWheel(m: Manifest, pythonVersion: string): VendorWheel | undefined {
  return [...m.wheels].sort((a, b) => (atLeast(a.version, b.version) ? -1 : 1))
    .find((w) => atLeast(pythonVersion, w.minPython) && !(w.excludePython ?? []).includes(pythonVersion));
}

const sha256 = async (file: string) => createHash('sha256').update(await readFile(file)).digest('hex');

/** Each vendored wheel checked against the manifest: a corrupt or edited clone is named. */
export async function verifyVendored(dir = VENDOR_DIR): Promise<{ file: string; version: string; ok: boolean; bytes: number; problem?: string }[]> {
  const m = await readManifest(dir);
  return Promise.all(m.wheels.map(async (w) => {
    try {
      const got = await sha256(path.join(dir, w.file));
      return { file: w.file, version: w.version, bytes: w.bytes, ok: got === w.sha256, ...(got === w.sha256 ? {} : { problem: `sha256 ${got.slice(0, 12)}… does not match the manifest (git checkout -- cafe-app/vendor restores it)` }) };
    } catch { return { file: w.file, version: w.version, bytes: w.bytes, ok: false, problem: 'missing (git checkout -- cafe-app/vendor restores it)' }; }
  }));
}

/* ---------- running an analysis ---------- */

export interface NetworkOptions { top?: number; a?: string; b?: string; types?: NodeType[]; limit?: number }
export interface NetworkRunOptions { withDerived?: boolean; env?: NodeJS.ProcessEnv; timeoutMs?: number }
export interface NetworkOutput {
  networkx: string; python: string; scope: 'stored' | 'with-derived'; scopeText: string;
  results: Partial<Record<NetworkAnalysis, any>>;
  /** True when this came from the cache (same graph, same question). */
  cached?: boolean;
}

const resultCache = new Map<string, NetworkOutput>();
const CACHE_MAX = 40;
/** How many times NetworkX actually ran (the tests read it to see the cache work). */
export const networkRuns = { count: 0 };
export function clearNetworkCache(): void { resultCache.clear(); pythonCache.clear(); }
const lastLine = (s: string) => s.trim().split(/\r?\n/).at(-1)!.slice(0, 200);
const malformed = (r: Ran) => new NetworkError(`NetworkX did not answer in the expected form${r.err.trim() ? `: ${lastLine(r.err)}` : ''}.`, 'failed');

/** Runs the analyses on the graph. Results are cached per graph version (a hash of the node-link JSON) and question. */
export async function runNetwork(graph: { nodes: GNode[]; edges: GEdge[] }, analyses: NetworkAnalysis[], options: NetworkOptions = {}, opts: NetworkRunOptions = {}): Promise<NetworkOutput> {
  for (const a of analyses) if (!NETWORK_ANALYSES.includes(a)) throw new NetworkError(`There is no analysis "${a}". Choose one of ${NETWORK_ANALYSES.join(', ')}.`, 'input');
  const withDerived = !!opts.withDerived;
  const payload = JSON.stringify({ graph: toNodeLink(graph, withDerived), analyses, options });
  const env = opts.env ?? process.env;
  const py = await findPython(env);
  const key = createHash('sha1').update(`${py.cmd}|${py.version}|${payload}`).digest('hex');
  const hit = resultCache.get(key);
  if (hit) return { ...hit, cached: true };

  const manifest = await readManifest();
  const wheel = pickWheel(manifest, py.version);
  if (!wheel) throw new NetworkError(`${PYTHON_NEEDED} ${py.cmd} is ${py.version}, which none of the shipped NetworkX copies supports. ${PYTHON_HOW}`, 'python');
  const timeoutMs = opts.timeoutMs ?? (Number(env.CAFE_NETWORK_TIMEOUT_MS) || TIMEOUT_MS);
  const r = await run(py.cmd, [...py.args, '-I', '-S', NETWORK_SCRIPT, path.join(VENDOR_DIR, wheel.file)], payload, timeoutMs, env);
  networkRuns.count++;
  if (r.timedOut) throw new NetworkError(`NetworkX took longer than ${Math.round(timeoutMs / 1000)} s and was stopped. Try again, or run one analysis at a time.`, 'timeout');
  if (r.spawnError) throw new NetworkError(`${PYTHON_NEEDED} ${py.cmd} could not be started (${r.spawnError}). ${PYTHON_HOW}`, 'python');
  let parsed: any;
  try { parsed = JSON.parse(r.out); } catch { throw malformed(r); }
  if (parsed?.error) throw new NetworkError(`NetworkX could not finish: ${String(parsed.error).slice(0, 300)}`, 'failed');
  if (r.code !== 0 || typeof parsed?.networkx !== 'string' || !parsed.results || typeof parsed.results !== 'object') throw malformed(r);
  for (const a of analyses) if (!parsed.results[a] || typeof parsed.results[a] !== 'object') throw new NetworkError(`NetworkX gave no ${a} result.`, 'failed');
  const out: NetworkOutput = { networkx: parsed.networkx, python: parsed.python, scope: withDerived ? 'with-derived' : 'stored', scopeText: scopeText(withDerived), results: parsed.results };
  resultCache.set(key, out);
  if (resultCache.size > CACHE_MAX) resultCache.delete(resultCache.keys().next().value!);
  return out;
}

/** A star named by id, by exact label or Café ID (case, spacing and accents ignored), or else by the shortest label containing the words. */
export function resolveStar(nodes: GNode[], text: string): GNode | undefined {
  const t = text.trim(); if (!t) return undefined;
  const byId = nodes.find((n) => n.id === t);
  if (byId) return byId;
  const k = slug(t);
  const exact = nodes.filter((n) => slug(n.label) === k || String(n.attrs?.cafeId ?? '').toLowerCase() === t.toLowerCase());
  if (exact.length) return exact[0];
  return nodes.filter((n) => n.label.toLowerCase().includes(t.toLowerCase()))
    .sort((a, b) => a.label.length - b.label.length || a.id.localeCompare(b.id))[0];
}

export type NetworkAnswer = NetworkOutput & { analysis: NetworkAnalysis; ends?: { a: GNode; b: GNode } };

/** One analysis on the workspace's graph, as it stands now. path takes a and b as ids, Café IDs or labels. */
export async function networkFor(root: string, analysis: NetworkAnalysis, options: NetworkOptions = {}, opts: NetworkRunOptions = {}): Promise<NetworkAnswer> {
  if (!NETWORK_ANALYSES.includes(analysis)) throw new NetworkError(`There is no analysis "${analysis}". Choose one of ${NETWORK_ANALYSES.join(', ')}.`, 'input');
  const graph = await rebuildGraph(root);
  if (analysis !== 'path') return { ...(await runNetwork(graph, [analysis], options, opts)), analysis };
  if (!options.a || !options.b) throw new NetworkError('A path needs two stars: cafe network path "<from>" "<to>".', 'input');
  const a = resolveStar(graph.nodes, options.a); const b = resolveStar(graph.nodes, options.b);
  const missing = [!a && options.a, !b && options.b].filter(Boolean);
  if (!a || !b) throw new NetworkError(`No star is named like ${missing.map((m) => `"${m}"`).join(' or ')}.`, 'input');
  return { ...(await runNetwork(graph, ['path'], { ...options, a: a.id, b: b.id }, opts)), analysis, ends: { a, b } };
}

/** Several analyses in one NetworkX run (the Network pop-out's overview). path is asked for on its own. */
export async function networkMany(root: string, analyses: NetworkAnalysis[], options: NetworkOptions = {}, opts: NetworkRunOptions = {}): Promise<NetworkOutput> {
  if (!analyses.length) throw new NetworkError(`Name an analysis: ${NETWORK_ANALYSES.join(', ')}.`, 'input');
  if (analyses.includes('path')) throw new NetworkError('Ask for a path on its own, with a and b.', 'input');
  return runNetwork(await rebuildGraph(root), analyses, options, opts);
}

/** What `cafe network check` reports: the Python, the vendored NetworkX it would use, and the checksums. */
export async function networkCheck(env: NodeJS.ProcessEnv = process.env): Promise<{ lines: string[]; ok: boolean }> {
  const lines: string[] = [];
  let ok = true;
  const manifest = await readManifest().catch((e: Error) => { lines.push(e.message); ok = false; return undefined; });
  let py: PythonFound | undefined;
  try { py = await findPython(env); lines.push(`Python: ${py.version} (${py.path ?? py.cmd}${env.CAFE_PYTHON ? ', from CAFE_PYTHON' : ''})`); } catch (e) { lines.push((e as Error).message); ok = false; }
  if (manifest) {
    for (const v of await verifyVendored()) {
      lines.push(`Vendored: ${v.file} (NetworkX ${v.version}, ${(v.bytes / 1e6).toFixed(1)} MB): ${v.ok ? 'sha256 matches MANIFEST.json' : v.problem}`);
      if (!v.ok) ok = false;
    }
    const wheel = py ? pickWheel(manifest, py.version) : undefined;
    if (py && !wheel) { lines.push(`No shipped NetworkX supports Python ${py.version}.`); ok = false; }
    if (py && wheel) {
      const probe = 'import sys;sys.path.insert(0, sys.argv[1]);import networkx as nx;print(nx.__version__);print(nx.__file__)';
      const r = await run(py.cmd, [...py.args, '-I', '-S', '-c', probe, path.join(VENDOR_DIR, wheel.file)], undefined, 30_000, env);
      const [ver, file] = r.out.trim().split(/\r?\n/);
      if (r.code === 0 && ver === wheel.version && file?.includes(wheel.file)) lines.push(`NetworkX: ${ver}, imported from ${wheel.file} with python -I -S (nothing installed on this machine is used; no numpy or scipy needed)`);
      else { lines.push(`NetworkX could not be imported from ${wheel.file}${r.err.trim() ? `: ${lastLine(r.err)}` : ''}`); ok = false; }
    }
    lines.push(`Licence: ${manifest.licence} (vendor/networkx/LICENCE-NOTICE.md)`);
  }
  lines.push(ok ? 'Network analysis is ready.' : 'Network analysis is not ready: see above.');
  return { lines, ok };
}

/* ---------- words ---------- */

const score = (x: number) => x.toFixed(3);
const named = (s: { label: string; type: string }) => `${s.label} (${s.type})`;
export const relWords = (r: string) => r.toLowerCase().replace(/_/g, ' ');

/** An analysis as plain lines, for the CLI. The last line says which NetworkX and which facts. */
export function networkLines(o: NetworkAnswer): string[] {
  const r = o.results[o.analysis];
  const L: string[] = [];
  if (o.analysis === 'stats') {
    L.push(`Stars: ${r.nodes}, links: ${r.links} (analysed without rounds and the division: ${r.analysed.nodes} stars, ${r.analysed.links} links)`);
    L.push(`Density: ${r.density} · components: ${r.components} (largest ${r.largestComponent}) · average clustering: ${r.averageClustering}`);
    L.push(`By type: ${Object.entries(r.byType).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  } else if (o.analysis === 'central') {
    L.push(`Betweenness centrality, top ${r.betweenness.length}${r.sampled ? ' (estimated from a fixed sample)' : ''}:`);
    r.betweenness.forEach((x: any, i: number) => L.push(`  ${i + 1}. ${named(x)}: ${score(x.betweenness)}, ${x.links} links, ${x.ideas} ideas`));
    L.push(`Degree centrality, top ${r.degree.length}:`);
    r.degree.forEach((x: any, i: number) => L.push(`  ${i + 1}. ${named(x)}: ${score(x.degree)} (${x.links} links)`));
    L.push('Per type (betweenness):');
    for (const [t, list] of Object.entries(r.byType as Record<string, any[]>)) L.push(`  ${t}: ${list.slice(0, 3).map((x) => `${x.label} ${score(x.betweenness)}`).join(', ')}`);
  } else if (o.analysis === 'clusters') {
    L.push(`${r.clusters.length} cluster${r.clusters.length === 1 ? '' : 's'} of ideas (${r.method}; modularity ${r.modularity}):`);
    r.clusters.forEach((c: any, i: number) => {
      L.push(`  ${i + 1}. ${c.ideas.map((x: any) => x.label).join(', ')}`);
      if (c.binding.length) L.push(`     bound by: ${c.binding.map((b: any) => `${b.label} (${b.type}, ${b.ideas} ideas)`).join(', ')}`);
    });
    if (r.alone.length) L.push(`On their own (no shared stars): ${r.alone.map((x: any) => x.label).join(', ')}`);
  } else if (o.analysis === 'path') {
    if (!r.found) L.push(`No path between ${o.ends?.a.label ?? '?'} and ${o.ends?.b.label ?? '?'}: ${r.reason}.`);
    else {
      L.push(`Shortest path from ${o.ends?.a.label} to ${o.ends?.b.label}: ${r.length} hop${r.length === 1 ? '' : 's'} (${r.count} path${r.count === 1 ? '' : 's'} of that length${r.count > r.paths.length ? `, ${r.paths.length} shown` : ''})`);
      r.paths.forEach((p: any, i: number) => {
        const lab = new Map<string, string>(p.stars.map((s: any) => [s.id, s.label]));
        L.push(`  ${i + 1}. ${p.stars.map(named).join(' — ')}`);
        for (const h of p.hops) L.push(`     ${h.rels.map((x: any) => `${lab.get(x.from)} ${relWords(x.rel)} ${lab.get(x.to)}`).join('; ')}`);
      });
    }
  } else if (o.analysis === 'isolated') {
    L.push(`${r.components} connected component${r.components === 1 ? '' : 's'}; the main one holds ${r.main} stars.`);
    if (!r.outside.length) L.push('No idea, team or system is cut off from the rest.');
    else L.push(`Not connected to the rest: ${r.outside.map(named).join(', ')}`);
    if (r.groupsApart) L.push(`${r.groupsApart} group${r.groupsApart === 1 ? '' : 's'} apart: ${r.apart.slice(0, 8).map((c: any) => `[${c.stars.map((s: any) => s.label).join(', ')}]`).join(' ')}`);
  } else if (o.analysis === 'suggest') {
    if (!r.suggestions.length) L.push('No link looks missing: no idea or capability has close peers with a link it lacks.');
    else L.push(`Links that are probably missing (proposals only; nothing is changed): ${r.suggestions.length} of ${r.found}, from ${r.considered} candidates:`);
    r.suggestions.forEach((s: any, i: number) => {
      L.push(`  ${i + 1}. ${s.from.label} ${relWords(s.rel)} ${s.to.label}: ${Math.round(s.share * 100)} % of its ${r.peers} closest peers by weight; Adamic-Adar ${s.adamicAdar}, Jaccard ${s.jaccard}`);
      for (const b of s.because) L.push(`     like ${b.peer.label} (shares ${b.shared.map((x: any) => x.label).join(', ')})`);
    });
  } else if (o.analysis === 'cycles') {
    L.push(r.count ? `${r.count} dependency cycle${r.count === 1 ? '' : 's'} along ${r.relations.join(', ')}:` : `No dependency cycles along ${r.relations.join(', ')} (${r.links} links checked).`);
    r.cycles.forEach((c: any[], i: number) => L.push(`  ${i + 1}. ${c.map((x) => x.label).join(' → ')} → ${c[0].label}`));
  }
  L.push(`NetworkX ${o.networkx} (Python ${o.python}), ${o.scopeText}${o.cached ? ', from the cache' : ''}`);
  return L;
}

/* ---------- export for analysts ---------- */

const stamp = (clock: Clock) => { const d = new Date(); const two = (n: number) => String(n).padStart(2, '0'); return `${clock().replace(/-/g, '')}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`; };

/**
 * Writes data/exports/<stamp>-all.networkx.json: the whole graph as node-link JSON that networkx.node_link_graph
 * loads (edges under "edges"), derived links included and marked derived: true, so an analyst can keep or drop them.
 */
export async function writeNetworkxExport(root: string, clock: Clock): Promise<string> {
  const graph = await rebuildGraph(root);
  const doc = toNodeLink(graph, true, true);
  doc.graph.exported = new Date().toISOString();
  const file = path.join(paths(root).exports, `${stamp(clock)}-all.networkx.json`);
  await writeFileAtomic(file, JSON.stringify(doc, null, 1));
  return file;
}

/* ---------- the assistant's network step ---------- */

/**
 * NetworkX's answers for the network steps of a query, run before the query (runQuery is synchronous and NetworkX
 * runs out of process). A step that cannot run (no Python, a path without two stars) gets its error, said in the trace.
 */
export async function prepareNetwork(q: Query, graph: { nodes: GNode[]; edges: GEdge[] }, idOf: (code: string) => string | undefined, opts: NetworkRunOptions = {}): Promise<((s: QueryStep) => NetworkStepRun | undefined) | undefined> {
  const steps = (q.steps ?? []).filter((s) => s.op === 'network');
  if (!steps.length) return undefined;
  const runs = new Map<QueryStep, NetworkStepRun>();
  for (const s of steps) {
    const analysis = s.analysis ?? 'central';
    try {
      const options: NetworkOptions = { top: s.limit ?? (analysis === 'central' || analysis === 'suggest' ? 5 : 10), ...(analysis === 'central' && s.type ? { types: [s.type] } : {}) };
      if (analysis === 'path') {
        const [a, b] = (s.codes ?? []).map(idOf);
        if (!a || !b) throw new NetworkError('a path needs two stars in codes', 'input');
        Object.assign(options, { a, b, limit: 3 });
      }
      runs.set(s, { ok: await runNetwork(graph, [analysis], options, { ...opts, withDerived: !!s.derived }) });
    } catch (e) { runs.set(s, { error: (e as Error).message }); }
  }
  return (s) => runs.get(s);
}

/* ---------- one idea's network facts, for the stages (decision, design, the CSIC hand-off) ---------- */

/** What NetworkX says about one idea, from stored facts: its cluster, the centrality of its capabilities and systems, its likely missing links. */
export type IdeaNetwork =
  | {
    available: true; networkx: string; scope: 'stored facts';
    /** The other ideas in its Louvain cluster and the stars that bind the cluster; none when it shares nothing. */
    cluster: { others: { id: string; label: string }[]; boundBy: { id: string; type: NodeType; label: string; ideas: number }[] } | null;
    /** Each of its capabilities and systems: betweenness rank among stars of its kind (1 = holds the most together). */
    centrality: { id: string; type: NodeType; label: string; rank: number; of: number; betweenness: number; ideas: number }[];
    /** Links it probably lacks (its closest peers have them), proposals only. */
    suggestions: { rel: Relation; to: { id: string; type: NodeType; label: string }; share: number; adamicAdar: number; jaccard: number; peers: { id: string; label: string; shared: string[] }[] }[];
  }
  | { available: false; reason: string };

/** Enough to rank every star and keep every suggestion: the stages read one idea out of the whole answer. */
const ALL = 100_000;

export async function ideaNetwork(graph: { nodes: GNode[]; edges: GEdge[] }, ideaId: string, opts: NetworkRunOptions = {}): Promise<IdeaNetwork> {
  const me = ideaId.startsWith('idea:') ? ideaId : `idea:${ideaId}`;
  let out: NetworkOutput;
  try {
    out = await runNetwork(graph, ['central', 'clusters', 'suggest'], { top: ALL, types: ['Capability', 'System'] }, { ...opts, withDerived: false });
  } catch (e) { return { available: false, reason: (e as Error).message }; }
  const { central, clusters, suggest } = out.results as any;
  const mine = new Set<string>();
  for (const e of graph.edges) {
    if (e.derived) continue;
    if (e.from === me && e.rel === 'NEEDS') mine.add(e.to);
  }
  // Its systems: those its capabilities use for it. A link stated for another idea is that idea's system, and one stated
  // for no idea is no idea's (the rules read it the same way), so neither is ranked as this one's.
  const cafeId = me.slice('idea:'.length);
  for (const e of graph.edges) if (!e.derived && mine.has(e.from) && e.rel === 'USES_DATA' && e.ideas?.includes(cafeId)) mine.add(e.to);
  const centrality: Extract<IdeaNetwork, { available: true }>['centrality'] = [];
  for (const t of ['Capability', 'System'] as const) {
    const list: any[] = central.byType?.[t] ?? [];
    list.forEach((x, i) => { if (mine.has(x.id)) centrality.push({ id: x.id, type: t, label: x.label, rank: i + 1, of: list.length, betweenness: x.betweenness, ideas: x.ideas }); });
  }
  const c = (clusters.clusters as any[]).find((k) => k.ideas.some((x: any) => x.id === me));
  return {
    available: true, networkx: out.networkx, scope: 'stored facts',
    cluster: c ? { others: c.ideas.filter((x: any) => x.id !== me).map((x: any) => ({ id: x.id, label: x.label })), boundBy: c.binding.map((b: any) => ({ id: b.id, type: b.type, label: b.label, ideas: b.ideas })) } : null,
    centrality,
    suggestions: (suggest.suggestions as any[]).filter((s) => s.from.id === me).slice(0, 5).map((s) => ({
      rel: s.rel, to: s.to, share: s.share, adamicAdar: s.adamicAdar, jaccard: s.jaccard,
      peers: s.because.map((b: any) => ({ id: b.peer.id, label: b.peer.label, shared: b.shared.map((x: any) => x.label) })),
    })),
  };
}

/** The idea's network facts in one line, for a basis or a hand-off. */
export function ideaNetworkLine(n: IdeaNetwork): string {
  if (!n.available) return 'network analysis unavailable';
  const parts = [
    n.cluster ? `a cluster with ${n.cluster.others.length} other idea${n.cluster.others.length === 1 ? '' : 's'}` : 'no cluster',
    `${n.centrality.length} centrality rank${n.centrality.length === 1 ? '' : 's'}`,
    `${n.suggestions.length} likely missing link${n.suggestions.length === 1 ? '' : 's'}`,
  ];
  return `NetworkX ${n.networkx} over stored facts (${parts.join(', ')})`;
}
