import YAML from 'yaml';
import { DERIVED_RELATIONS, canonEdit, canonLink, type AiLink, type GEdge, type OperatorEdit } from './ontology';
import { readEdits, writeEdits } from './operator';
import { readAiLinks, rebuildGraph, updateAiLinks } from './store';
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
}

const words = (id: string) => id.replace(/\|/g, ' ');

/** The plan for a workspace. `stamp` names the ideas for an unscoped fact by its edit id (op-9) or AI line (line-12). */
export async function planFix(root: string, stamp: Record<string, string[]> = {}): Promise<FixPlan> {
  const check = await checkWorkspace(root);
  const graph = await rebuildGraph(root);
  const plan: FixPlan = { stamps: [], ambiguous: [], unconfirm: [], undo: [], rules: [], ids: [], preview: { gone: [], added: [], waiting: [] } };
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
        : `${u.where}: ${words(u.edge)}: no idea needs ${u.from}; left as it is`);
      continue;
    }
    plan.stamps.push({ where: u.where, ...(u.where.startsWith('operator') ? { edit: key } : { line: Number(key.slice(5)) }), edge: u.edge, ideas: [...pick.ideas].sort(), why: pick.why });
  }
  for (const l of check.lowConfidence ?? []) plan.unconfirm.push({ line: l.line, edge: l.edge, confidence: l.confidence });
  for (const e of await readEdits(root)) {
    if (e.status === 'active' && e.t === 'link' && DERIVED_RELATIONS.includes(e.rel)) plan.undo.push({ edit: e.id, what: `${e.from} ${e.rel} ${e.to}: ${e.rel} is derived by the rules, never stored by hand` });
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
    if (plan.undo.some((u) => u.edit === e.id)) { out.push({ ...e, status: 'undone' }); continue; }
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
  if (plan.unconfirm.some((u) => u.line === line)) x = { ...x, status: 'pending' };
  const s = plan.stamps.find((y) => y.line === line);
  return s ? s.ideas.map((idea) => ({ ...x, idea })) : [x];
}

async function simulate(root: string, plan: FixPlan): Promise<GEdge[]> {
  const [{ ideas }, { links }, rounds, edits, rules] = await Promise.all([listIdeas(root), readAiLinks(root), listRounds(root), readEdits(root), readRules(root)]);
  const lineNos = await aiLineNumbers(root);
  const e2 = editsAfter(edits, plan);
  const g = buildGraph(ideas, linksAfter(links, lineNos, plan), rounds, e2, { registry: await registryFrom(root, e2), rules: rules.rules });
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
  if (plan.stamps.some((s) => s.edit) || plan.undo.length || plan.ids.some((x) => x.edit)) {
    const edits = await readEdits(root);
    await writeEdits(root, editsAfter(edits, plan, clock));
    for (const x of plan.ids.filter((y) => y.edit)) done.push(`${x.where}: ${x.was.join(', ')} written as ${x.now.join(', ')}`);
    for (const s of plan.stamps.filter((x) => x.edit)) done.push(`operator.jsonl ${s.edit}: stamped ${s.ideas.join(', ')}`);
    for (const u of plan.undo) done.push(`operator.jsonl ${u.edit}: switched off (${u.what})`);
  }
  if (plan.unconfirm.length || plan.stamps.some((s) => s.line) || plan.ids.some((x) => x.line)) {
    await updateAiLinks(root, (l, line) => changeLink(l, line, plan));
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
  const n = plan.stamps.length + plan.unconfirm.length + plan.undo.length + plan.rules.length + plan.ids.length;
  if (!n && !plan.ambiguous.length) return ['Nothing to fix: the workspace is in line with the graph\'s reasoning.'];
  if (applied) L.push(applied.length ? `Fixed (${applied.length}):` : 'Nothing was changed.');
  else L.push(n ? `Would fix (${n}); nothing is written without --apply:` : 'Nothing to fix without your say:');
  if (applied) L.push(...applied.map((x) => `  ${x}`));
  else {
    for (const s of plan.stamps) L.push(`  ${s.where}: ${words(s.edge)}: stamp ${s.ideas.join(', ')} (${s.why})`);
    for (const u of plan.unconfirm) L.push(`  ai-links.jsonl line ${u.line}: ${words(u.edge)} at ${u.confidence}: back to waiting for your Do it`);
    for (const u of plan.undo) L.push(`  operator.jsonl ${u.edit}: switch off: ${u.what}`);
    for (const r of plan.rules) L.push(`  ${r}`);
    for (const x of plan.ids) L.push(`  ${x.where}: write ${x.was.join(', ')} as ${x.now.join(', ')} (the build already reads it so)`);
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
