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
import { keyPath, sameMac, sign, signingKey } from './sign';
import { aiReads } from '../ai/reads';
import { confirmAtProblem } from '../ai/confirm';

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
 * form, so a line written with an older id is found), for one idea when `idea` is given (a fact two ideas' reads
 * found is confirmed for each on its own), else for every idea it was read for. Confirming is the operator's Do it,
 * and is recorded as such, one signed record per (fact, idea): a link below the confidence threshold counts as
 * confirmed only then.
 */
export async function setAiLinkStatus(root: string, edgeId: string, status: AiLink['status'], at?: string, idea?: string): Promise<void> {
  const lines = await readLines(root);
  const [from, rel, to] = edgeId.split('|');
  const hit = lines.filter(({ link: l }) => { if (!l) return false; const c = canonLink(l); return c.from === from && c.rel === rel && c.to === to && (idea === undefined || (l.idea ?? '') === idea); });
  if (!hit.length) throw new Error(`No AI link ${edgeId}${idea ? ` for ${idea}` : ''}`);
  const day = at ?? new Date().toISOString().slice(0, 10);
  for (const l of hit) {
    l.link!.status = status;
    if (status === 'confirmed') { l.link!.confirmedBy = 'operator'; l.link!.confirmedAt = day; } else { delete l.link!.confirmedBy; delete l.link!.confirmedAt; }
  }
  // The Do it's own record, signed: the build believes a confirmedBy only when this file has it (a hand-written one is refused).
  if (status === 'confirmed') {
    for (const i of [...new Set(hit.map((l) => l.link!.idea ?? ''))]) await appendConfirmation(root, { edge: `${from}|${rel}|${to}`, ...(i ? { idea: i } : {}), at: day, by: 'operator', ts: new Date().toISOString() });
  }
  await writeLines(root, lines);
}

/**
 * graph/confirmations.jsonl: one line per Do it that confirmed an AI link (a fact, for an idea), written only by
 * setAiLinkStatus (and `cafe ontology fix --confirm`). Each line is signed with the workspace's key, kept outside the
 * workspace (see sign.ts), and chained to the line before it, so a line written or changed by hand, in this file and
 * ai-links.jsonl together, is not believed, and a removed line breaks the chain where it was. A line from before
 * lines were signed counts as waiting until `cafe ontology fix --apply` signs it.
 */
export interface Confirmation { edge: string; idea?: string; at: string; by: 'operator'; ts: string; prev?: string; mac?: string }
const confirmationsFile = (root: string) => file(root, 'confirmations.jsonl');
const confirmationFields = (c: Confirmation) => [c.edge, c.idea ?? '', c.at, c.by, c.ts];
/** One line of the file as read: the record, whether its signature holds, and what is wrong with it. */
export interface ConfirmationLine { line: number; raw: string; record?: Confirmation; state: 'signed' | 'unsigned' | 'bad' | 'unreadable'; chain: boolean }

export async function readConfirmationLines(root: string): Promise<{ lines: ConfirmationLine[]; key: boolean }> {
  const key = await signingKey(root);
  const out: ConfirmationLine[] = [];
  let prev = '';
  ((await readText(confirmationsFile(root))) ?? '').split('\n').forEach((raw, i) => {
    if (!raw.trim()) return;
    let v: Confirmation | undefined;
    try { const p = JSON.parse(raw); if (p && typeof p.edge === 'string' && p.by === 'operator') v = p as Confirmation; } catch { /* unreadable */ }
    if (!v) { out.push({ line: i + 1, raw, state: 'unreadable', chain: true }); return; }
    if (typeof v.mac !== 'string') { out.push({ line: i + 1, raw, record: v, state: 'unsigned', chain: true }); return; }
    const ok = !!key && sameMac(sign(key, confirmationFields(v), String(v.prev ?? '')), v.mac);
    out.push({ line: i + 1, raw, record: v, state: ok ? 'signed' : 'bad', chain: (v.prev ?? '') === prev });
    if (ok) prev = v.mac;
  });
  return { lines: out, key: !!key };
}

/** The Do-it records the build believes (signed by this workspace's key): `edge#idea`, and `edge` for one made for no idea. */
export async function readConfirmations(root: string): Promise<Set<string>> {
  return (await readConfirmationRecords(root)).confirmed;
}
/** The believed records, and a line for each record that is not believed or breaks the chain. */
export async function readConfirmationRecords(root: string): Promise<{ confirmed: Set<string>; problems: string[] }> {
  const { lines, key } = await readConfirmationLines(root);
  const confirmed = new Set<string>(); const problems: string[] = [];
  const at = (l: ConfirmationLine) => `confirmations.jsonl line ${l.line}`;
  for (const l of lines) {
    if (l.state === 'unreadable') { problems.push(`${at(l)}: could not be read (skipped)`); continue; }
    const c = l.record!;
    const [f, r, t] = c.edge.split('|');
    const k = canonLink({ from: f, rel: r as AiLink['rel'], to: t } as AiLink);
    const id = `${k.from}|${k.rel}|${k.to}`;
    if (l.state === 'unsigned') { problems.push(`${at(l)}: ${c.edge.replace(/\|/g, ' ')}${c.idea ? ` for ${c.idea}` : ''}: not signed (written before Do-it records were signed), so it counts as waiting for your Do it until cafe ontology fix --apply signs it`); continue; }
    if (l.state === 'bad') { problems.push(`${at(l)}: ${c.edge.replace(/\|/g, ' ')}${c.idea ? ` for ${c.idea}` : ''}: ${key ? 'its signature does not match: it was written or changed by hand, not by a Do it' : `there is no key to check it with (${(await keyPath(root)) ?? '~/.cafe-ai/keys'} is missing)`}, so it counts as waiting for your Do it (refused by the build)`); continue; }
    if (!l.chain) problems.push(`${at(l)}: a line before it was removed or changed (the chain of Do-it records is broken there)`);
    confirmed.add(c.idea ? `${id}#${c.idea}` : id);
  }
  return { confirmed, problems };
}
export async function appendConfirmation(root: string, c: Confirmation): Promise<void> {
  const key = (await signingKey(root, true))!;
  const { lines } = await readConfirmationLines(root);
  const prev = [...lines].reverse().find((l) => l.state === 'signed')?.record?.mac ?? '';
  const rec: Confirmation = { edge: c.edge, ...(c.idea ? { idea: c.idea } : {}), at: c.at, by: 'operator', ts: c.ts };
  const text = (await readText(confirmationsFile(root))) ?? '';
  await writeFileAtomic(confirmationsFile(root), `${text}${text && !text.endsWith('\n') ? '\n' : ''}${JSON.stringify({ ...rec, prev, mac: sign(key, confirmationFields(rec), prev) })}\n`);
}
/**
 * Writes the file again with every line the operator vouches for signed and the chain whole: the signed lines as they
 * are, the unsigned (older) ones signed, and, with `all`, the ones whose signature does not match too (a workspace
 * moved to a machine without its key). Lines that cannot be read are kept as they were. Returns the lines signed.
 */
export async function signConfirmations(root: string, all = false): Promise<number[]> {
  const key = (await signingKey(root, true))!;
  const { lines } = await readConfirmationLines(root);
  let prev = ''; const out: string[] = []; const signed: number[] = [];
  for (const l of lines) {
    if (!l.record || (l.state === 'bad' && !all)) { out.push(l.raw); continue; }
    const { prev: _p, mac: _m, ...rec } = l.record;
    const mac = sign(key, confirmationFields(rec), prev);
    if (l.state !== 'signed' || (l.record.prev ?? '') !== prev) signed.push(l.line);
    out.push(JSON.stringify({ ...rec, prev, mac }));
    prev = mac;
  }
  if (signed.length) await writeFileAtomic(confirmationsFile(root), `${out.join('\n')}\n`);
  return signed;
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
  const listed = await listIdeas(root);
  const { ideas } = listed;
  const { links, problems } = await readAiLinks(root);
  const edits = await readEdits(root);
  // The rules file's problems (a broken file, a rule it cannot take) go with the graph's: said in the app, never silent.
  const rules = await readRules(root, ontology.schema);
  const settings = await loadSettings(root).catch(() => ({}));
  const registry = await registryFrom(root, edits, ontology.schema);
  const signed = await readConfirmationRecords(root);
  const { refused, ...graph } = buildGraph(ideas, links, await listRounds(root), edits, { registry, rules: rules.rules, cache: cacheFor(root), confirmAt: confirmAt(settings), schema: ontology.schema, confirmations: signed.confirmed, reads: await aiReads(root) });
  await writeFileAtomic(file(root, 'nodes.jsonl'), graph.nodes.map((n) => JSON.stringify(n)).join('\n') + '\n');
  await writeFileAtomic(file(root, 'edges.jsonl'), graph.edges.map((e) => JSON.stringify(e)).join('\n') + '\n');
  // Every idea folder the build could not take (two folders with one Café ID, an idea.yaml that will not read) is said too.
  const ideaProblems = listed.problems.map((p) => `ideas/${p.folder}: ${p.message}`);
  const threshold = confirmAtProblem(settings);
  return { ...graph, schema: ontology.schema, problems: [...problems, ...[...ontology.problems, ...rules.problems, ...registry.refused, ...ideaProblems, ...(threshold ? [threshold] : []), ...signed.problems, ...refused].map((message) => ({ line: 0, message }))] };
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
