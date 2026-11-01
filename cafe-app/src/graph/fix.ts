import YAML from 'yaml';
import { canonId, canonEdit, canonLink, type AiLink, type GEdge, type OperatorEdit } from './ontology';
import { readEdits, writeEdits } from './operator';
import { appendConfirmation, readAiLinks, readConfirmationLines, readConfirmations, rebuildGraph, signConfirmations, updateAiLinks } from './store';
import { aiReads } from '../ai/reads';
import { placeQuote } from '../ai/apply';
import { confirmAt } from '../ai/confirm';
import { loadSettings } from '../round/store';
import { loadOntology } from './ontologyFile';
import { buildGraph } from './build';
import { registryFrom } from './registryFile';
import { DEFAULT_RULES, readRules, readRuleList, type Rule } from './rules';
import { checkWorkspace, scopeCandidates, type Unscoped } from './check';
import { listIdeas } from '../ideas/store';
import { listRounds } from '../round/store';
import { paths } from '../workspace/paths';
import { readText, writeFileAtomic } from '../workspace/files';
import type { Clock } from '../clock';

/**
 * `cafe ontology fix`: brings a workspace made before the graph's reasoning was made exact in line with it. A dry run
 * by default (it says what it would change, and how the derived links would change); --apply writes it. It never
 * guesses: a fact two or more ideas could own and none confirms is listed with the command that settles it.
 *
 * - An operator link made with no idea on screen (op-9: Policy question answering uses the T&E policy) gets the idea it
 *   is for: the ideas whose own facts confirm it, else the one idea that needs the capability, else `--stamp op-9=ID`.
 *   The edit keeps its id and date; `stamped` records when the idea was added.
 * - An AI link confirmed on arrival below the confidence threshold goes back to waiting for the operator's Do it.
 * - A derived relation stored by hand (refused by the build since) is switched off (undone, kept in the log).
 * - rules/inference.yaml's chain rules get their scope written out, so the file says what the build does.
 * - Star ids written before a name had one normal form ("system:t-e-policy", "capability:…-and-…") are written in
 *   it, so the files say what the build reads (the build already reads them so: nothing in the graph changes).
 */
export interface FixPlan {
  stamps: { where: string; edit?: string; line?: number; edge: string; ideas: string[]; why: string }[];
  ambiguous: string[];
  unconfirm: { line: number; edge: string; confidence: number }[];
  undo: { edit: string; what: string }[];
  rules: string[];
  /** Star ids written in an older form, per file line or edit: what each becomes. */
  ids: { where: string; line?: number; edit?: string; was: string[]; now: string[] }[];
  /** Derived links that go, and that come, once the plan is applied (computed in memory for the dry run). */
  preview: { gone: string[]; added: string[]; waiting: string[] };
  /**
   * Stale operator edits (their star is gone): never changed without the operator's say. Each lists the stars it could
   * be repointed to (the stars of its kind its idea has, closest in words first); --repoint op-N=<star id> repoints it,
   * --retire op-N switches it off (kept in the log).
   */
  stale: { edit: string; what: string; missing: string[]; candidates: { id: string; label: string }[] }[];
  repoint: { edit: string; from: string; to: string; label: string }[];
  retire: { edit: string; what: string }[];
  /** AI links whose source names a field the passage is not in: the field it is in (the source is corrected to it). */
  fields: { line: number; edge: string; was: string; now: string; by: 'quote' | 'label' }[];
  /** AI links that say the operator confirmed them with no Do it recorded: --confirm line-N records your Do it now. */
  forged: { line: number; edge: string; confidence: number }[];
  confirm: { line: number; edge: string; idea?: string }[];
  /**
   * Do-it records in graph/confirmations.jsonl to sign with the workspace's key (kept outside the workspace): those
   * written before records were signed; with --resign also those whose signature does not match (a workspace moved
   * to a machine without its key). Signing is you vouching for the records as they stand: read the list first.
   */
  sign: { line: number; edge: string; idea?: string; why: 'unsigned' | 'bad' }[];
}

/** The operator's say on stale edits and unrecorded confirmations: repoint, retire, confirm. */
export interface FixChoices { repoint?: Record<string, string>; retire?: string[]; confirm?: number[]; resign?: boolean }

const wordsOf = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));
/** How many words two names share (for ordering the stars a stale edit could be repointed to). */
const overlap = (a: string, b: string) => { const x = wordsOf(a); return [...wordsOf(b)].filter((w) => x.has(w)).length; };

const words = (id: string) => id.replace(/\|/g, ' ');

/** The plan for a workspace. `stamp` names the ideas for an unscoped fact by its edit id (op-9) or AI line (line-12). */
export async function planFix(root: string, stamp: Record<string, string[]> = {}, choices: FixChoices = {}): Promise<FixPlan> {
  const check = await checkWorkspace(root);
  const graph = await rebuildGraph(root);
  const plan: FixPlan = { stamps: [], ambiguous: [], unconfirm: [], undo: [], rules: [], ids: [], preview: { gone: [], added: [], waiting: [] }, stale: [], repoint: [], retire: [], fields: [], forged: [], confirm: [], sign: [] };
  for (const l of (await readConfirmationLines(root)).lines) {
    if (!l.record || l.state === 'signed') continue;
    if (l.state === 'unsigned' || choices.resign) plan.sign.push({ line: l.line, edge: l.record.edge, ...(l.record.idea ? { idea: l.record.idea } : {}), why: l.state === 'unsigned' ? 'unsigned' : 'bad' });
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const allEdits = await readEdits(root);
  // Stale edits: listed with what they could be repointed to; changed only as the operator says.
  for (const st of check.stale) {
    const e = allEdits.find((x) => x.id === st.id);
    const idea = e && e.t === 'link' ? e.idea : undefined;
    const cands = st.missing.flatMap((m) => {
      const kind = m.split(':')[0];
      const mine = idea ? new Set(graph.edges.filter((x) => x.from === `idea:${idea}` && !x.derived).map((x) => x.to)) : undefined;
      return graph.nodes.filter((n) => n.id.startsWith(`${kind}:`) && (!mine || mine.has(n.id)))
        .map((n) => ({ id: n.id, label: n.label, score: overlap(m.slice(kind.length + 1).replace(/-/g, ' '), n.label) }))
        .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, 4).map(({ id, label }) => ({ id, label }));
    });
    plan.stale.push({ edit: st.id, what: st.what, missing: st.missing, candidates: cands });
    const to = choices.repoint?.[st.id];
    if (to) {
      if (!byId.has(to)) plan.ambiguous.push(`operator.jsonl ${st.id}: --repoint ${st.id}=${to}: ${to} is not in the graph; left as it is`);
      else if (st.missing.length !== 1 || to.split(':')[0] !== st.missing[0].split(':')[0]) plan.ambiguous.push(`operator.jsonl ${st.id}: --repoint ${st.id}=${to}: it must name one star of the same kind as ${st.missing.join(', ')}; left as it is`);
      else plan.repoint.push({ edit: st.id, from: st.missing[0], to, label: byId.get(to)!.label });
    } else if (choices.retire?.includes(st.id)) plan.retire.push({ edit: st.id, what: st.what });
  }
  for (const id of [...Object.keys(choices.repoint ?? {}), ...(choices.retire ?? [])]) if (!check.stale.some((x) => x.id === id)) plan.ambiguous.push(`operator.jsonl ${id}: not a stale edit; --repoint and --retire are only for those`);
  const ideaIds = new Set(graph.nodes.filter((n) => n.type === 'Idea').map((n) => n.id.slice('idea:'.length)));

  for (const u of check.unscoped ?? []) {
    const key = u.where.startsWith('operator.jsonl ') ? u.where.slice('operator.jsonl '.length) : `line-${u.where.replace(/^ai-links\.jsonl line /, '')}`;
    const asked = stamp[key];
    const bad = (asked ?? []).filter((i) => !ideaIds.has(i));
    if (bad.length) { plan.ambiguous.push(`${u.where}: --stamp ${key}=${asked!.join(',')}: ${bad.join(', ')} ${bad.length === 1 ? 'is' : 'are'} not an idea`); continue; }
    const pick = asked?.length ? { ideas: asked, why: 'as you said with --stamp' }
      : u.confirming.length ? { ideas: u.confirming, why: `${u.confirming.join(', ')} ${u.confirming.length === 1 ? 'confirms' : 'confirm'} it: ${u.confirming.length === 1 ? 'its' : 'their'} own facts already say so` }
        : u.needers.length === 1 ? { ideas: u.needers, why: `${u.needers[0]} is the one idea that needs ${u.from}` }
          : undefined;
    if (!pick) {
      plan.ambiguous.push(u.needers.length
        ? `${u.where}: ${words(u.edge)}: ${u.needers.join(', ')} need ${u.from} and none confirms it: say which with --stamp ${key}=${u.needers.join(',')} (or a part of that list); left as it is`
        : `${u.where}: ${words(u.edge)}: no idea ${u.from.startsWith('capability:') ? 'needs' : 'reaches'} ${u.from}; left as it is`);
      continue;
    }
    plan.stamps.push({ where: u.where, ...(u.where.startsWith('operator') ? { edit: key } : { line: Number(key.slice(5)) }), edge: u.edge, ideas: [...pick.ideas].sort(), why: pick.why });
  }
  // A Do it whose record is signed by this fix (one from before records were signed) stands: its link is not sent back.
  const signing = new Set(plan.sign.map((x) => (x.idea ? `${x.edge}#${x.idea}` : x.edge)));
  const signed = (edge: string, idea?: string) => signing.has(`${edge}#${idea ?? ''}`) || signing.has(edge);
  for (const l of check.lowConfidence ?? []) if (!signed(l.edge, l.idea)) plan.unconfirm.push({ line: l.line, edge: l.edge, confidence: l.confidence });
  // AI links whose source names a field the passage (or, read before passages were kept, the star's own name) is not in.
  {
    const { ideas } = await listIdeas(root);
    const text = new Map(ideas.map((i) => [i.id, i as unknown as Record<string, unknown>]));
    const confirmations = await readConfirmations(root);
    const threshold = confirmAt(await loadSettings(root).catch(() => ({})));
    const lineNos0 = await aiLineNumbers(root);
    (await readAiLinks(root)).links.forEach((raw, i) => {
      const l = canonLink(raw); const line = lineNos0[i];
      const edge = `${l.from}|${l.rel}|${l.to}`;
      if (l.status === 'confirmed' && l.confirmedBy === 'operator' && typeof l.confidence === 'number' && l.confidence < threshold && !confirmations.has(`${edge}#${l.idea ?? ''}`) && !confirmations.has(edge) && !signed(edge, l.idea)) {
        plan.forged.push({ line, edge, confidence: l.confidence });
        if (choices.confirm?.includes(line)) plan.confirm.push({ line, edge, ...(l.idea ? { idea: l.idea } : {}) });
      }
      const m = /^ai:([^:]+):(.+)$/.exec(String(l.source ?? ''));
      const t = l.idea ? text.get(l.idea) : undefined;
      if (!m || !t || l.status === 'removed') return;
      const named = m[2];
      if (l.quote) {
        const placed = placeQuote(l.quote, named, t);
        if (placed.field !== named) plan.fields.push({ line, edge, was: named, now: placed.field, by: 'quote' });
        return;
      }
      // No passage kept: the star's own name (the far end, not the idea) is looked for in the text, a whole-word match.
      const far = l.to.startsWith('idea:') ? l.from : l.to;
      const star = far ? (byId.get(far)?.label ?? l.newNodes?.find((n) => n.id === far)?.label) : undefined;
      if (!star) return;
      const placed = placeQuote(star, named, t);
      if (placed.found && placed.field !== named) plan.fields.push({ line, edge, was: named, now: placed.field, by: 'label' });
    });
  }
  for (const e of await readEdits(root)) {
    if (e.status === 'active' && e.t === 'link' && graph.schema.derived.includes(e.rel)) plan.undo.push({ edit: e.id, what: `${e.from} ${e.rel} ${e.to}: ${e.rel} is derived by the rules, never stored by hand` });
  }
  // Ids in an older form: listed per line and edit, so the files read as the build reads them.
  const ends = (x: { from?: string; to?: string; into?: string; node?: string; newNodes?: { id: string }[] }) =>
    [x.from, x.to, x.into, x.node, ...(x.newNodes ?? []).map((n) => n.id)].filter((v): v is string => typeof v === 'string');
  const lineNos = await aiLineNumbers(root);
  /** The ids that change, each once, in order: [was, now]. */
  const changed = (a: string[], b: string[]) => { const m = new Map<string, string>(); a.forEach((x, k) => { if (x !== b[k]) m.set(x, b[k]); }); return { was: [...m.keys()], now: [...m.values()] }; };
  (await readAiLinks(root)).links.forEach((l, i) => {
    const c = canonLink(l); if (c === l) return;
    plan.ids.push({ where: `ai-links.jsonl line ${lineNos[i]}`, line: lineNos[i], ...changed(ends(l), ends(c)) });
  });
  for (const e of await readEdits(root)) {
    const c = canonEdit(e); if (c === e) continue;
    plan.ids.push({ where: `operator.jsonl ${e.id}`, edit: e.id, ...changed(ends(e as never), ends(c as never)) });
  }
  const file = await readRuleFile(root);
  if (file) for (const r of file.rules) {
    if (r && typeof r === 'object' && r.scope === undefined && r.kind !== 'shared-stars' && Array.isArray(r.chain)) {
      const builtin = DEFAULT_RULES.find((d) => d.name === r.name && d.kind === 'chain') as Extract<Rule, { kind: 'chain' }> | undefined;
      plan.rules.push(`inference.yaml: ${r.name}: scope: ${builtin?.scope ?? 'same-idea'} written out (the build already reads it so)`);
    }
  }

  // What the derived links would be after: the same build, over the edits and links as the plan leaves them.
  const after = await simulate(root, plan);
  const was = new Set(graph.edges.filter((e) => e.derived).map((e) => e.id));
  const now = new Set(after.filter((e) => e.derived).map((e) => e.id));
  const sure = new Set(graph.edges.filter((e) => e.derived && e.confirmed).map((e) => e.id));
  plan.preview = {
    gone: [...was].filter((x) => !now.has(x)).sort(), added: [...now].filter((x) => !was.has(x)).sort(),
    // Derived links that rest on a link going back to waiting: they stay, unconfirmed, until you confirm it.
    waiting: after.filter((e) => e.derived && !e.confirmed && sure.has(e.id)).map((e) => e.id).sort(),
  };
  return plan;
}

async function readRuleFile(root: string): Promise<{ rules: Record<string, unknown>[]; raw: unknown } | undefined> {
  const text = await readText(paths(root).inference);
  if (text === undefined) return undefined;
  try {
    const raw = YAML.parse(text);
    return raw && Array.isArray(raw.rules) ? { rules: raw.rules, raw } : undefined;
  } catch { return undefined; }
}

function editsAfter(edits: OperatorEdit[], plan: FixPlan, clock?: Clock): OperatorEdit[] {
  const out: OperatorEdit[] = []; let next = Math.max(0, ...edits.map((e) => Number(e.id.replace(/^op-/, '')) || 0));
  const extra: OperatorEdit[] = [];
  for (let e of edits) {
    if (plan.ids.some((x) => x.edit === e.id)) e = canonEdit(e);
    if (plan.undo.some((u) => u.edit === e.id) || plan.retire.some((u) => u.edit === e.id)) { out.push({ ...e, status: 'undone' }); continue; }
    const rp = plan.repoint.find((x) => x.edit === e.id);
    if (rp) {
      const at = clock ? clock() : 'dry-run';
      const swap = (id: string) => (canonId(id) === rp.from || id === rp.from ? rp.to : id);
      if (e.t === 'link' || e.t === 'unlink') { out.push({ ...e, from: swap(e.from), to: swap(e.to), ...(e.t === 'link' ? { repointed: { at, was: [rp.from] } } : {}) } as OperatorEdit); continue; }
      if ('node' in e) { out.push({ ...e, node: swap(e.node) } as OperatorEdit); continue; }
      if (e.t === 'merge') { out.push({ ...e, into: swap(e.into) }); continue; }
    }
    const s = plan.stamps.find((x) => x.edit === e.id);
    if (s && e.t === 'link') {
      const stamped = clock ? clock() : 'dry-run';
      out.push({ ...e, idea: s.ideas[0], stamped });
      // One edit per idea: the others are new edits of the same fact on the same date, each stamped.
      for (const idea of s.ideas.slice(1)) extra.push({ ...e, id: `op-${++next}`, idea, stamped });
      continue;
    }
    out.push(e);
  }
  return [...out, ...extra];
}

function linksAfter(links: AiLink[], lines: number[], plan: FixPlan): AiLink[] {
  return links.flatMap((l, i) => changeLink(l, lines[i], plan));
}
function changeLink(l: AiLink, line: number, plan: FixPlan): AiLink[] {
  let x = plan.ids.some((y) => y.line === line) ? canonLink(l) : l;
  if (plan.unconfirm.some((u) => u.line === line) && !plan.confirm.some((c) => c.line === line)) x = { ...x, status: 'pending' };
  const f = plan.fields.find((y) => y.line === line);
  if (f) x = { ...x, source: x.source.replace(/^(ai:[^:]+:).+$/, `$1${f.now}`) };
  const s = plan.stamps.find((y) => y.line === line);
  return s ? s.ideas.map((idea) => ({ ...x, idea })) : [x];
}

async function simulate(root: string, plan: FixPlan): Promise<GEdge[]> {
  const extra = new Set([...plan.confirm, ...plan.sign].map((c) => (c.idea ? `${c.edge}#${c.idea}` : c.edge)));
  const { schema } = await loadOntology(root);
  const [{ ideas }, { links }, rounds, edits, rules, confirmations] = await Promise.all([listIdeas(root), readAiLinks(root), listRounds(root), readEdits(root), readRules(root, schema), readConfirmations(root)]);
  const lineNos = await aiLineNumbers(root);
  const e2 = editsAfter(edits, plan);
  const g = buildGraph(ideas, linksAfter(links, lineNos, plan), rounds, e2, { registry: await registryFrom(root, e2, schema), rules: rules.rules, schema, confirmations: new Set([...confirmations, ...extra]), reads: await aiReads(root) });
  return g.edges;
}

/** The file line of each parsed AI link, in order (unreadable lines skipped, as readAiLinks skips them). */
async function aiLineNumbers(root: string): Promise<number[]> {
  const text = (await readText(`${paths(root).graph}/ai-links.jsonl`)) ?? '';
  const out: number[] = [];
  text.split('\n').forEach((raw, i) => { if (!raw.trim()) return; try { const v = JSON.parse(raw); if (v && typeof v === 'object' && !Array.isArray(v)) out.push(i + 1); } catch { /* skipped */ } });
  return out;
}

/** Writes the plan: the operator log, the AI links and the rules file. Returns one line per change made. */
export async function applyFix(root: string, plan: FixPlan, clock: Clock): Promise<string[]> {
  const done: string[] = [];
  if (plan.sign.length) {
    const signed = await signConfirmations(root, plan.sign.some((x) => x.why === 'bad'));
    for (const x of plan.sign) if (signed.includes(x.line)) done.push(`confirmations.jsonl line ${x.line}: ${words(x.edge)}${x.idea ? ` for ${x.idea}` : ''}: signed (${x.why === 'unsigned' ? 'written before records were signed' : 'its signature did not match; signed again as you said with --resign'})`);
  }
  for (const c of plan.confirm) {
    await appendConfirmation(root, { edge: c.edge, ...(c.idea ? { idea: c.idea } : {}), at: clock(), by: 'operator', ts: new Date().toISOString() });
    done.push(`ai-links.jsonl line ${c.line}: your Do it recorded (cafe ontology fix --confirm)`);
  }
  if (plan.stamps.some((s) => s.edit) || plan.undo.length || plan.ids.some((x) => x.edit) || plan.repoint.length || plan.retire.length) {
    const edits = await readEdits(root);
    await writeEdits(root, editsAfter(edits, plan, clock));
    for (const r of plan.repoint) done.push(`operator.jsonl ${r.edit}: repointed from ${r.from} to ${r.to} (${r.label})`);
    for (const r of plan.retire) done.push(`operator.jsonl ${r.edit}: switched off (${r.what}), kept in the log`);
    for (const x of plan.ids.filter((y) => y.edit)) done.push(`${x.where}: ${x.was.join(', ')} written as ${x.now.join(', ')}`);
    for (const s of plan.stamps.filter((x) => x.edit)) done.push(`operator.jsonl ${s.edit}: stamped ${s.ideas.join(', ')}`);
    for (const u of plan.undo) done.push(`operator.jsonl ${u.edit}: switched off (${u.what})`);
  }
  if (plan.unconfirm.length || plan.stamps.some((s) => s.line) || plan.ids.some((x) => x.line) || plan.fields.length) {
    await updateAiLinks(root, (l, line) => changeLink(l, line, plan));
    for (const f of plan.fields) done.push(`ai-links.jsonl line ${f.line}: source field ${f.was} corrected to ${f.now} (the ${f.by === 'quote' ? 'quoted passage' : "star's name"} is there)`);
    for (const x of plan.ids.filter((y) => y.line)) done.push(`${x.where}: ${x.was.join(', ')} written as ${x.now.join(', ')}`);
    for (const u of plan.unconfirm) done.push(`ai-links.jsonl line ${u.line}: waiting for your Do it (${u.confidence})`);
    for (const s of plan.stamps.filter((x) => x.line)) done.push(`ai-links.jsonl line ${s.line}: stamped ${s.ideas.join(', ')}`);
  }
  if (plan.rules.length) {
    const file = await readRuleFile(root);
    if (file) {
      const rules = file.rules.map((r) => {
        if (!r || typeof r !== 'object' || r.scope !== undefined || r.kind === 'shared-stars' || !Array.isArray(r.chain)) return r;
        const builtin = DEFAULT_RULES.find((d) => d.name === r.name && d.kind === 'chain') as Extract<Rule, { kind: 'chain' }> | undefined;
        return { ...r, scope: builtin?.scope ?? 'same-idea' };
      });
      // Checked before it is written: the file must read back as the same rules.
      const next = { ...(file.raw as object), rules };
      if (readRuleList(next).problems.length <= readRuleList(file.raw).problems.length) {
        await writeFileAtomic(paths(root).inference, YAML.stringify(next));
        done.push(...plan.rules);
      }
    }
  }
  return done;
}

/** What the CLI prints for a plan, dry run or applied. */
export function fixLines(plan: FixPlan, applied?: string[]): string[] {
  const L: string[] = [];
  const n = plan.stamps.length + plan.unconfirm.length + plan.undo.length + plan.rules.length + plan.ids.length + plan.repoint.length + plan.retire.length + plan.fields.length + plan.confirm.length + plan.sign.length;
  const waitingOnYou = plan.stale.filter((s) => !plan.repoint.some((r) => r.edit === s.edit) && !plan.retire.some((r) => r.edit === s.edit));
  const forgedLeft = plan.forged.filter((f) => !plan.confirm.some((c) => c.line === f.line));
  if (!n && !plan.ambiguous.length && !waitingOnYou.length && !forgedLeft.length) return ['Nothing to fix: the workspace is in line with the graph\'s reasoning.'];
  if (applied) L.push(applied.length ? `Fixed (${applied.length}):` : 'Nothing was changed.');
  else L.push(n ? `Would fix (${n}); nothing is written without --apply:` : 'Nothing to fix without your say:');
  if (applied) L.push(...applied.map((x) => `  ${x}`));
  else {
    for (const s of plan.stamps) L.push(`  ${s.where}: ${words(s.edge)}: stamp ${s.ideas.join(', ')} (${s.why})`);
    for (const u of plan.unconfirm) L.push(`  ai-links.jsonl line ${u.line}: ${words(u.edge)} at ${u.confidence}: back to waiting for your Do it`);
    for (const u of plan.undo) L.push(`  operator.jsonl ${u.edit}: switch off: ${u.what}`);
    for (const r of plan.rules) L.push(`  ${r}`);
    for (const x of plan.ids) L.push(`  ${x.where}: write ${x.was.join(', ')} as ${x.now.join(', ')} (the build already reads it so)`);
    for (const f of plan.fields) L.push(`  ai-links.jsonl line ${f.line}: ${words(f.edge)}: source field ${f.was} → ${f.now} (the ${f.by === 'quote' ? 'quoted passage' : "star's name"} is in ${f.now}, not ${f.was})`);
    for (const r of plan.repoint) L.push(`  operator.jsonl ${r.edit}: repoint ${r.from} → ${r.to} (${r.label}), as you said`);
    for (const r of plan.retire) L.push(`  operator.jsonl ${r.edit}: switch off (${r.what}), as you said; kept in the log`);
    for (const c of plan.confirm) L.push(`  ai-links.jsonl line ${c.line}: ${words(c.edge)}: record your Do it, as you said`);
    for (const x of plan.sign) L.push(`  confirmations.jsonl line ${x.line}: ${words(x.edge)}${x.idea ? ` for ${x.idea}` : ''}: sign it with this workspace's key (${x.why === 'unsigned' ? 'written before records were signed' : 'its signature does not match: --resign, as you said'})`);
  }
  if (waitingOnYou.length) {
    L.push(`Stale edits, waiting on your say (${waitingOnYou.length}): their star is gone, so the build skips them. Repoint or switch off each:`);
    for (const s of waitingOnYou) L.push(`  operator.jsonl ${s.edit}: ${s.what}: ${s.missing.join(', ')} is not in the graph. ${s.candidates.length ? `Repoint: ${s.candidates.map((c) => `--repoint ${s.edit}=${c.id} (${c.label})`).join(' or ')}; or ` : ''}--retire ${s.edit}`);
  }
  if (forgedLeft.length) {
    L.push(`AI links that say you confirmed them, with no Do it recorded (${forgedLeft.length}): they count as waiting. If you did confirm one, say so:`);
    for (const f of forgedLeft) L.push(`  ai-links.jsonl line ${f.line}: ${words(f.edge)} at ${f.confidence}: --confirm line-${f.line}`);
  }
  if (plan.ambiguous.length) { L.push(`Left for you (${plan.ambiguous.length}):`); L.push(...plan.ambiguous.map((x) => `  ${x}`)); }
  const { gone, added, waiting } = plan.preview;
  if (gone.length || added.length) {
    L.push(`Derived links ${applied ? 'changed' : 'that would change'}: ${gone.length} go, ${added.length} come`);
    L.push(...gone.map((x) => `  - ${words(x)}`), ...added.map((x) => `  + ${words(x)}`));
  } else L.push('No derived link comes or goes.');
  if (waiting.length) {
    L.push(`Derived links that ${applied ? 'now wait' : 'would wait'} on a link you have not confirmed (${waiting.length}):`);
    L.push(...waiting.map((x) => `  ~ ${words(x)}`));
  }
  return L;
}

export type { Unscoped };
export { scopeCandidates };
