/**
 * The one tool for the whole proof of concept, and the feature list it is weighed against. Pure (no files), so the
 * server, the migration of older records and the UI all read the choice the same way.
 */

export type Pathway = 'Citizen-Led' | 'Assisted Citizen' | 'TTIA-Led';
export type FitLevel = 'yes' | 'partly' | 'no';
export const FIT_LEVELS: readonly FitLevel[] = ['yes', 'partly', 'no'];

/** How the tool covers one feature: "no" says what it can't do and, in the note, how to cover it. */
export interface ToolFit { feature: string; fit: FitLevel; note: string }

/** The one tool: suggested by the AI, or the operator's own choice (then evaluated by the AI for that tool). */
export interface ToolChoice {
  tool: string;
  pathway: Pathway;
  by: 'ai' | 'operator';
  reason: string;
  /** What the tool does well for the idea. */
  pros: string[];
  /** What it cannot do, or does poorly: the part named, and how to cover it when there is a way. */
  cons: string[];
  /** The facts and the rule the evaluation rested on ("why this tool"). */
  context: string[];
  flags: string[];
  /** One entry per feature the evaluation saw. */
  fit: ToolFit[];
  /** The feature names the evaluation was for: when the list changes, the evaluation is out of date. */
  evaluatedFor: string[];
  /** Chosen with no AI to evaluate it: pros, cons and fit are empty until it is evaluated. */
  needsAi?: boolean;
  at: string;
  provider?: string;
}

/**
 * A feature the design moved out of the build. "out": out of scope for the proof of concept (kept in the list, struck
 * through, with why). "outside": done with another tool (`by`, e.g. "Microsoft Copilot + SharePoint"), outside the
 * main tool's build.
 */
export interface FeatureScope { status: 'out' | 'outside'; by?: string; why?: string; at?: string; step?: number }

/** A feature as stored now: no tool of its own. */
export interface FeatureLike { id?: string; name: string; what?: string; flags?: string[]; scope?: FeatureScope }

const one = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Flags the app no longer has (the old reuse tag): an older record that carries one loads without it. */
const RETIRED_FLAGS = ['reuse-existing'];
export const dropRetiredFlags = (flags: string[]): string[] => flags.filter((f) => !RETIRED_FLAGS.includes(f));

/** A stored or sent scope made safe; undefined when it says nothing (an "outside" scope needs the other tool). */
export function scopeOf(raw: unknown): FeatureScope | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const status = r.status === 'out' || r.status === 'outside' ? r.status : undefined;
  const by = one(r.by, 60);
  if (!status || (status === 'outside' && !by)) return undefined;
  const why = one(r.why, 200); const at = one(r.at, 40);
  const step = Number.isInteger(r.step) && (r.step as number) > 0 ? (r.step as number) : undefined;
  return { status, ...(status === 'outside' ? { by } : {}), ...(why ? { why } : {}), ...(at ? { at } : {}), ...(step ? { step } : {}) };
}

/**
 * What sends part of the idea to the CSIC Repository instead of a Café build, read straight from the tool picker's
 * flags: a custom app, a tool flagged as needing a live system or personal data, and each in-scope feature flagged so.
 */
export function csicFlags(state: { features: FeatureLike[]; tool?: Pick<ToolChoice, 'tool' | 'flags'> }): string[] {
  const out: string[] = [];
  const t = state.tool;
  if (t?.tool.toLowerCase() === 'custom app') out.push('custom app');
  if (t?.flags.includes('needs-live-system')) out.push(`live system: ${t.tool}`);
  if (t?.flags.includes('personal-data')) out.push(`personal data: ${t.tool}`);
  for (const f of state.features) {
    if (f.scope?.status === 'out') continue;
    const name = f.name.replace(/\s+/g, ' ').trim();
    if (f.flags?.includes('needs-live-system')) out.push(`live system: ${name}`);
    if (f.flags?.includes('personal-data')) out.push(`personal data: ${name}`);
  }
  return [...new Set(out)];
}

/** In the main tool's build: not out of scope and not done with another tool. */
export const inBuild = (f: { scope?: FeatureScope }) => !f.scope;
/** In the proof of concept at all (an outside-tool feature still is). */
export const inScope = (f: { scope?: FeatureScope }) => f.scope?.status !== 'out';
/** How a moved feature is described: "out of scope" or "<by>, outside the <tool> build". */
export function scopeWords(scope: FeatureScope | undefined, tool?: string): string {
  if (!scope) return '';
  if (scope.status === 'out') return 'out of scope';
  return `${scope.by}, outside the ${tool ?? 'main'} build`;
}

/** The stored pathway for a tool: custom app is TTIA-Led; a citizen tool with no builder named yet is Assisted Citizen. */
export function pathwayOf(tool: string, builder?: string): Pathway {
  if (tool === 'custom app') return 'TTIA-Led';
  if (tool === 'Microsoft Copilot') return 'Citizen-Led';
  return builder ? 'Citizen-Led' : 'Assisted Citizen';
}

const key = (name: string) => name.replace(/\s+/g, ' ').trim().toLowerCase();

/** True when the feature list is not the one the tool was evaluated for (names compared, order and case aside). */
export function outOfDate(features: { name: string }[], choice: Pick<ToolChoice, 'evaluatedFor'> | undefined | null): boolean {
  if (!choice) return false;
  const now = new Set(features.map((f) => key(f.name)).filter(Boolean));
  const then = new Set((choice.evaluatedFor ?? []).map(key).filter(Boolean));
  return now.size !== then.size || [...now].some((n) => !then.has(n));
}

/**
 * THE helper for everything downstream that thinks per feature (kits, plan input, design.md, approach.md, graph
 * links): every feature gets the one chosen tool and its pathway. With no tool chosen, no feature has one.
 */
export function toolFeatures<F extends FeatureLike>(state: { features: F[]; tool?: Pick<ToolChoice, 'tool' | 'pathway'> }): (F & { tool?: string; pathway?: Pathway })[] {
  const t = state.tool;
  // A feature the design moved out of the build is not the tool's: an out-of-scope one has no tool, an outside one has
  // the other tool it is done with.
  return state.features.map((f) => (f.scope?.status === 'out' ? { ...f }
    : f.scope?.status === 'outside' ? { ...f, tool: f.scope.by }
    : t ? { ...f, tool: t.tool, pathway: t.pathway } : { ...f }));
}

/** The tools that have a kit: the one chosen (a list, so the kit code can stay per tool). */
export const pickedTools = (state: { tool?: Pick<ToolChoice, 'tool'> }): string[] => (state.tool ? [state.tool.tool] : []);

/** Flags that belong to the tool, not to a feature. */
export const TOOL_ONLY_FLAGS = ['custom-app', 'no-build'];
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * Older records had a tool on each feature. They load as features (name, what, flags kept) and one tool: the most
 * common one (the first feature's on a tie), with the pros, cons and reason of the first feature that had it, by the
 * operator (they saved it). A feature that had another tool, or none, is fitted "partly", with why.
 */
export function legacyChoice(raw: unknown[], at: string): { features: { id: string; name: string; what?: string; flags: string[] }[]; tool?: ToolChoice } {
  const old = raw.filter((f): f is Record<string, unknown> => !!f && typeof f === 'object');
  const features = old.map((f) => {
    const flags = strs(f.flags).filter((x) => !TOOL_ONLY_FLAGS.includes(x));
    return { id: String(f.id ?? ''), name: String(f.name ?? ''), ...(typeof f.what === 'string' && f.what ? { what: f.what } : {}), flags };
  });
  const tools = old.map((f) => (typeof f.tool === 'string' && f.tool ? f.tool : ''));
  const count = new Map<string, number>();
  for (const t of tools) if (t) count.set(t, (count.get(t) ?? 0) + 1);
  if (!count.size) return { features };
  let best = '';
  for (const t of tools) if (t && (!best || count.get(t)! > count.get(best)!)) best = t;
  const src = old[tools.indexOf(best)];
  const flags = [...new Set(old.filter((_, i) => tools[i] === best).flatMap((f) => strs(f.flags)).filter((x) => TOOL_ONLY_FLAGS.includes(x)))];
  if (best === 'custom app' && !flags.includes('custom-app')) flags.push('custom-app');
  const pathway = (['Citizen-Led', 'Assisted Citizen', 'TTIA-Led'] as Pathway[]).includes(src.pathway as Pathway) ? (src.pathway as Pathway) : pathwayOf(best);
  return {
    features,
    tool: {
      tool: best, pathway, by: 'operator',
      reason: typeof src.reason === 'string' ? src.reason : '',
      pros: strs(src.pros), cons: strs(src.cons), context: strs(src.context), flags,
      fit: features.map((f, i): ToolFit => (tools[i] === best ? { feature: f.name, fit: 'yes', note: '' }
        : { feature: f.name, fit: 'partly', note: tools[i] ? `Was picked for ${tools[i]} before the one-tool picker` : 'Had no tool before the one-tool picker' })),
      evaluatedFor: features.map((f) => f.name),
      at,
    },
  };
}
