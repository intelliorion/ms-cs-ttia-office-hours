import path from 'node:path';
import { paths } from '../workspace/paths';
import { readText, writeFileAtomic } from '../workspace/files';
import { listIdeas } from '../ideas/store';
import { listRounds } from '../round/store';
import { buildGraph, BundleCache } from './build';
import { onTouched } from '../memory/touch';
import { appendEdit, nextEditId, readEdits } from './operator';
import { canonLink, type AiLink, type GEdge, type GNode, type Schema } from './ontology';
import { confirmAt } from '../ai/confirm';
import { loadSettings } from '../round/store';
import type { Clock } from '../clock';
import { registryFrom } from './registryFile';
import { readRules } from './rules';
import { loadOntology } from './ontologyFile';

const file = (root: string, name: string) => path.join(paths(root).graph, name);

export interface LineProblem { line: number; message: string }

/** Lines of ai-links.jsonl: each parsed link, or the raw text of a line that would not parse. */
async function readLines(root: string): Promise<{ raw: string; n: number; link?: AiLink }[]> {
  const text = await readText(file(root, 'ai-links.jsonl'));
  return (text ?? '').split('\n').map((raw, i) => ({ raw, n: i + 1 })).filter((l) => l.raw.trim()).map((l) => {
    try {
      const v = JSON.parse(l.raw) as unknown;
      return v && typeof v === 'object' && !Array.isArray(v) ? { ...l, link: v as AiLink } : l;
    } catch { return l; }
  });
}

/** The AI links, skipping any line that does not parse; those come back as problems with their line number. */
export async function readAiLinks(root: string): Promise<{ links: AiLink[]; problems: LineProblem[] }> {
  const links: AiLink[] = []; const problems: LineProblem[] = [];
  for (const l of await readLines(root)) {
    if (l.link) links.push(l.link);
    else problems.push({ line: l.n, message: `ai-links.jsonl line ${l.n} could not be read and was skipped` });
  }
  return { links, problems };
}

/** Rewrites the whole file atomically, so it is never torn. Unreadable lines are kept as they were. */
async function writeLines(root: string, lines: { raw: string; link?: AiLink }[]): Promise<void> {
  const text = lines.map((l) => (l.link ? JSON.stringify(l.link) : l.raw)).join('\n');
  await writeFileAtomic(file(root, 'ai-links.jsonl'), text + (lines.length ? '\n' : ''));
}

export async function appendAiLink(root: string, link: AiLink): Promise<void> {
  await writeLines(root, [...(await readLines(root)), { raw: '', n: 0, link }]);
}

/**
 * Rewrites ai-links.jsonl with the new status for the link whose edge id matches (ids compared in today's normal
 * form, so a line written with an older id is found). Confirming is the operator's Do it, and is recorded as such:
 * a link below the confidence threshold counts as confirmed only then.
 */
export async function setAiLinkStatus(root: string, edgeId: string, status: AiLink['status'], at?: string): Promise<void> {
  const lines = await readLines(root);
  const [from, rel, to] = edgeId.split('|');
  const hit = lines.filter(({ link: l }) => { if (!l) return false; const c = canonLink(l); return c.from === from && c.rel === rel && c.to === to; });
  if (!hit.length) throw new Error(`No AI link ${edgeId}`);
  const day = at ?? new Date().toISOString().slice(0, 10);
  for (const l of hit) {
    l.link!.status = status;
    if (status === 'confirmed') { l.link!.confirmedBy = 'operator'; l.link!.confirmedAt = day; } else { delete l.link!.confirmedBy; delete l.link!.confirmedAt; }
  }
  // The Do it's own record: the build believes a confirmedBy only when this file has it (a hand-written one is refused).
  if (status === 'confirmed') await appendConfirmation(root, { edge: `${from}|${rel}|${to}`, at: day, by: 'operator', ts: new Date().toISOString() });
  await writeLines(root, lines);
}

/**
 * graph/confirmations.jsonl: one line per Do it that confirmed an AI link, written only by setAiLinkStatus. A link in
 * ai-links.jsonl that says confirmedBy: operator with no Do it here is a confirmation nobody gave: the build counts the
 * link as waiting and says so. (Both are plain files on the operator's machine: someone who edits both can still
 * forge one; the point is that one edited line no longer can.)
 */
export interface Confirmation { edge: string; at: string; by: 'operator'; ts: string }
const confirmationsFile = (root: string) => file(root, 'confirmations.jsonl');
export async function readConfirmations(root: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (const raw of ((await readText(confirmationsFile(root))) ?? '').split('\n')) {
    if (!raw.trim()) continue;
    try { const v = JSON.parse(raw) as Confirmation; if (v && typeof v.edge === 'string' && v.by === 'operator') { const [f, r, t] = v.edge.split('|'); const c = canonLink({ from: f, rel: r as AiLink['rel'], to: t } as AiLink); out.add(`${c.from}|${c.rel}|${c.to}`); } } catch { /* skipped */ }
  }
  return out;
}
export async function appendConfirmation(root: string, c: Confirmation): Promise<void> {
  const text = (await readText(confirmationsFile(root))) ?? '';
  await writeFileAtomic(confirmationsFile(root), `${text}${text && !text.endsWith('\n') ? '\n' : ''}${JSON.stringify(c)}\n`);
}

/**
 * Rewrites ai-links.jsonl line by line: `change` returns the link as it should now be (the same object to keep it, an
 * array to put several in its place). Unreadable lines are kept as they were. Returns how many links changed.
 */
export async function updateAiLinks(root: string, change: (link: AiLink, line: number) => AiLink | AiLink[]): Promise<number> {
  const lines = await readLines(root);
  let n = 0;
  const out: { raw: string; n: number; link?: AiLink }[] = [];
  for (const l of lines) {
    if (!l.link) { out.push(l); continue; }
    const before = JSON.stringify(l.link);
    const next = change(structuredClone(l.link), l.n);
    const list = Array.isArray(next) ? next : [next];
    if (list.length !== 1 || JSON.stringify(list[0]) !== before) n++;
    for (const x of list) out.push({ raw: '', n: l.n, link: x });
  }
  if (n) await writeLines(root, out);
  return n;
}

/** One bundle cache per workspace; an idea's bundle goes when its folder is touched (Deep read's bus), or when its record changes. */
const caches = new Map<string, BundleCache>();
onTouched((t) => { const c = caches.get(t.root); if (c) for (const id of t.ideas) c.drop(id); });
const cacheFor = (root: string) => { let c = caches.get(root); if (!c) caches.set(root, (c = new BundleCache())); return c; };

/** A built graph: its stars and links, what the build could not take, and the ontology (Schema) it was built with. */
export interface BuiltGraph { nodes: GNode[]; edges: GEdge[]; problems: LineProblem[]; schema: Schema }

export async function rebuildGraph(root: string): Promise<BuiltGraph> {
  // The workspace's ontology first: the words and pairs every layer below reads. What it could not take is said with
  // the graph's problems, like the rules file's: in the app, never silent.
  const ontology = await loadOntology(root);
  const { ideas } = await listIdeas(root);
  const { links, problems } = await readAiLinks(root);
  const edits = await readEdits(root);
  // The rules file's problems (a broken file, a rule it cannot take) go with the graph's: said in the app, never silent.
  const rules = await readRules(root, ontology.schema);
  const settings = await loadSettings(root).catch(() => ({}));
  const registry = await registryFrom(root, edits, ontology.schema);
  const { refused, ...graph } = buildGraph(ideas, links, await listRounds(root), edits, { registry, rules: rules.rules, cache: cacheFor(root), confirmAt: confirmAt(settings), schema: ontology.schema, confirmations: await readConfirmations(root) });
  await writeFileAtomic(file(root, 'nodes.jsonl'), graph.nodes.map((n) => JSON.stringify(n)).join('\n') + '\n');
  await writeFileAtomic(file(root, 'edges.jsonl'), graph.edges.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return { ...graph, schema: ontology.schema, problems: [...problems, ...[...ontology.problems, ...rules.problems, ...registry.refused, ...refused].map((message) => ({ line: 0, message }))] };
}

/**
 * Merges one star into another: its links move over and it goes. The merged label is recorded as an alias of the star
 * kept, so the twin cannot come back at the next import or re-read. Two edits, undone together.
 */
export async function mergeStars(root: string, from: string, into: string, clock: Clock): Promise<{ from: string; into: string; edits: string[] }> {
  const graph = await rebuildGraph(root);
  const a = graph.nodes.find((n) => n.id === from); const b = graph.nodes.find((n) => n.id === into);
  if (!a || !b || a.id === b.id || a.type !== b.type || !graph.schema.mergeable.includes(a.type)) throw new Error('Those two stars cannot be merged');
  const mergeId = await nextEditId(root);
  await appendEdit(root, { id: mergeId, at: clock(), status: 'active', t: 'merge', from, into });
  const aliasId = await nextEditId(root);
  await appendEdit(root, { id: aliasId, at: clock(), status: 'active', t: 'alias', node: into, label: a.label, of: b.label });
  return { from: a.label, into: b.label, edits: [mergeId, aliasId] };
}
