/** Pure helpers for the Tool picker, Design and Plan sections of an idea's details. */
export { outOfDate } from '../../../src/design/choice';

/** The approved tools, canonical labels in the server's order (src/graph/ontology.ts APPROVED_TOOLS). */
export const APPROVED_TOOLS = ['Microsoft Copilot', 'Copilot Studio', 'Power Apps', 'Dataiku', 'UiPath', 'custom app'] as const;
export const CUSTOM_APP = 'custom app';

/** The approved tools: the server's list from /api/state when it sent one, else the local copy. */
export function approvedTools(state?: { approvedTools?: unknown } | null): string[] {
  const list = state?.approvedTools;
  if (Array.isArray(list)) {
    const tools = list.filter((t): t is string => typeof t === 'string' && t.trim() !== '');
    if (tools.length) return tools;
  }
  return [...APPROVED_TOOLS];
}
/** The server rejects a longer summary (POST …/design/finish). */
export const SUMMARY_MAX = 600;
export const AGENT_FILE = 'kit/custom-app/BUILD-WITH-AGENT.md';
export const CUSTOM_APP_NOTE = 'Custom app is TTIA-Led: this proof of concept goes to the CSIC Repository, not a Café build.';
export const AI_WAIT = 'Asking the AI, this can take a minute…';

const PATHWAYS: Record<string, string> = {
  'Microsoft Copilot': 'Citizen-Led (no build)',
  'Copilot Studio': 'Citizen-Led',
  'Power Apps': 'Citizen-Led',
  'Dataiku': 'Citizen-Led',
  'UiPath': 'Citizen-Led',
  'custom app': 'TTIA-Led (CSIC Repository)',
};

/** The pathway as the server words it (src/design/tools.ts pathwayLabel); '' when no tool is picked. */
export function pathwayText(tool: string | undefined, builder?: string): string {
  if (!tool || !PATHWAYS[tool]) return '';
  const base = PATHWAYS[tool];
  const assisted = tool !== 'custom app' && tool !== 'Microsoft Copilot' && !builder?.trim();
  return assisted ? `${base} (Assisted Citizen until a builder is named)` : base;
}

const FLAG_WORDS: Record<string, string> = {
  'needs-live-system': 'Needs a live system',
  'personal-data': 'Personal data',
  'custom-app': 'Custom app',
  'reuse-existing': 'Reuse what exists',
  'no-build': 'No build',
};
export const flagWord = (f: string) => FLAG_WORDS[f] ?? f;

/** One feature row of the Tool picker, as the operator edits it. Features have no tool: the one tool is the ToolView. */
export interface FeatureRow {
  key: string;
  name: string;
  what: string;
  /** Feature flags (live system, personal data, reuse what exists). */
  flags: string[];
  /** Filled by the AI and not saved yet: shown with a highlighted border. */
  suggested: boolean;
  /** Where the design moved it: out of scope, or another tool outside the build. Kept on save; "Put it back" clears it. */
  scope?: FeatureScope;
}

/** What the design said about a feature (the server's FeatureScope). */
export interface FeatureScope { status: 'out' | 'outside'; by?: string; why?: string; at?: string; step?: number }

/** "Out of scope" or "<other tool>, outside the <tool> build", for a badge. */
export function scopeLabel(scope: FeatureScope | undefined, tool?: string): string {
  if (!scope) return '';
  return scope.status === 'out' ? 'Out of scope' : `${scope.by}, outside the ${tool ?? 'main'} build`;
}

/** The one tool for the whole proof of concept, as the panel holds it (the server's ToolChoice). */
export interface ToolView {
  tool: string;
  pathway?: string;
  by: 'ai' | 'operator';
  reason: string;
  pros: string[];
  cons: string[];
  context: string[];
  flags: string[];
  fit: { feature: string; fit: 'yes' | 'partly' | 'no'; note: string }[];
  evaluatedFor: string[];
  needsAi?: boolean;
  at?: string;
  provider?: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
let seq = 0;
const newKey = () => `row-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** The custom-app flag follows the tool, as the server does on save. */
export function flagsFor(tool: string, flags: string[]): string[] {
  const rest = flags.filter((f) => f !== 'custom-app');
  return tool === CUSTOM_APP ? ['custom-app', ...rest] : rest;
}

const lines = (v: unknown, max: number): string[] => (Array.isArray(v) ? v.filter((x: unknown): x is string => typeof x === 'string' && x.trim() !== '').slice(0, max) : []);
const FEATURE_FLAGS = ['needs-live-system', 'personal-data', 'reuse-existing'];

/**
 * Rows from a saved feature ({id, name, what?, flags}) or an AI suggestion ({name, what, flags}). Only feature flags
 * are kept (the tool's own flags belong to the tool). `suggested` marks the rows the AI added (no saved id).
 */
export function featureRows(raw: unknown, opts: { fromAi?: boolean } = {}): FeatureRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((f) => f && typeof f === 'object' && str((f as any).name).trim()).map((f: any) => ({
    key: str(f.id) || newKey(),
    name: str(f.name), what: str(f.what),
    flags: lines(f.flags, 5).filter((x) => FEATURE_FLAGS.includes(x)),
    suggested: Boolean(opts.fromAi) && !str(f.id),
    ...(f.scope && (f.scope.status === 'out' || (f.scope.status === 'outside' && str(f.scope.by))) ? { scope: { ...f.scope } } : {}),
  }));
}

export const emptyRow = (): FeatureRow => ({ key: newKey(), name: '', what: '', flags: [], suggested: false });

/** The tool from the server (saved or suggested), or null when it names no approved tool. */
export function toolView(raw: any, tools: readonly string[] = APPROVED_TOOLS): ToolView | null {
  if (!raw || typeof raw !== 'object' || !tools.includes(raw.tool)) return null;
  const fit = (Array.isArray(raw.fit) ? raw.fit : [])
    .filter((x: any) => x && str(x.feature) && ['yes', 'partly', 'no'].includes(x.fit))
    .map((x: any) => ({ feature: str(x.feature), fit: x.fit, note: str(x.note) }));
  return {
    tool: raw.tool, ...(str(raw.pathway) ? { pathway: raw.pathway } : {}), by: raw.by === 'ai' ? 'ai' : 'operator', reason: str(raw.reason),
    pros: lines(raw.pros, 5), cons: lines(raw.cons, 5), context: lines(raw.context, 6), flags: flagsFor(raw.tool, lines(raw.flags, 5)),
    fit, evaluatedFor: lines(raw.evaluatedFor, 12), ...(raw.needsAi ? { needsAi: true } : {}),
    ...(str(raw.at) ? { at: raw.at } : {}), ...(str(raw.provider) ? { provider: raw.provider } : {}),
  };
}

/** The operator's own tool with no AI to evaluate it: kept, with pros, cons and fit cleared until it is evaluated. */
export function overrideTool(tool: string, rows: FeatureRow[]): ToolView {
  return {
    tool, by: 'operator', reason: '', pros: [], cons: [], context: [], flags: flagsFor(tool, []), fit: [],
    evaluatedFor: featuresBody(rows).map((f) => f.name), needsAi: true,
  };
}

export const NEEDS_AI_NOTE = 'Pros, cons and fit need the AI: connect one and Re-evaluate.';
export const STALE_NOTE = 'The features changed since the tool was evaluated.';
export const FIT_MARK: Record<string, string> = { yes: '✓', partly: 'partly', no: '✗' };
export const FIT_WORD: Record<string, string> = { yes: 'Does it', partly: 'Partly', no: "Can't do it" };

/** The features to send: name, what and flags, trimmed; rows with no name and nothing else are dropped. */
export function featuresBody(rows: FeatureRow[]): { name: string; what?: string; flags: string[]; scope?: FeatureScope }[] {
  return rows
    .filter((r) => r.name.trim() || r.what.trim())
    .map((r) => ({ name: r.name.trim(), ...(r.what.trim() ? { what: r.what.trim() } : {}), flags: r.flags, ...(r.scope ? { scope: r.scope } : {}) }));
}

/** The body for POST …/tools: the features, and the one tool when there is one. */
export function picksBody(rows: FeatureRow[], tool: ToolView | null = null): { features: ReturnType<typeof featuresBody>; tool?: ToolView } {
  return { features: featuresBody(rows), ...(tool ? { tool } : {}) };
}

/** What stops a save, in plain words, or null. */
export function picksProblem(rows: FeatureRow[]): string | null {
  const body = featuresBody(rows);
  if (body.some((f) => !f.name)) return 'Every feature needs a name.';
  const seen = new Set<string>();
  for (const f of body) {
    const k = f.name.toLowerCase();
    if (seen.has(k)) return `Two features are called ${f.name}.`;
    seen.add(k);
  }
  if (body.length > 12) return 'Keep it to 12 features.';
  return null;
}

/** The Café check card: three rows, each clean (green) or with what was found (amber). */
export interface CheckRow { key: 'value' | 'data' | 'csic'; label: string; items: string[]; clean: boolean }
export function cafeCheckRows(check: { valueWords?: string[]; dataFlags?: string[]; csicFlags?: string[] } | null | undefined): CheckRow[] {
  const row = (key: CheckRow['key'], label: string, items: string[] | undefined): CheckRow =>
    ({ key, label, items: items ?? [], clean: !(items ?? []).length });
  return [
    row('value', 'Value words', check?.valueWords),
    row('data', 'Data flags', check?.dataFlags),
    row('csic', 'CSIC flags', check?.csicFlags),
  ];
}

export interface StepLike { n: number; question: string; answer?: string; source?: string; askedTeam?: { emailKey: string } }
export type StepKind = 'answered' | 'asked' | 'open';
/** Where a step stands, and the words for it. */
export function stepStatus(s: StepLike): { kind: StepKind; label: string } {
  if (s.answer) {
    const by = s.source === 'e2' ? 'Answered by the team' : s.source === 'ai-suggested' ? 'Picked a suggested answer' : 'Answered';
    return { kind: 'answered', label: by };
  }
  if (s.askedTeam) return { kind: 'asked', label: 'Asked the team · E2 drafted' };
  return { kind: 'open', label: 'Waiting for an answer' };
}

/** The step the AI is waiting on (unanswered and not asked of the team), if any. */
export const openStep = <T extends StepLike>(steps: T[]): T | undefined => steps.find((s) => stepStatus(s).kind === 'open');

export type DesignPhase = 'no-features' | 'designing' | 'done' | 'approved';
export function designPhase(state: { features?: unknown[]; summary?: string; approvedAt?: string } | null | undefined): DesignPhase {
  if (!state) return 'no-features';
  if (state.approvedAt) return 'approved';
  if (state.summary) return 'done';
  return state.features?.length ? 'designing' : 'no-features';
}

export const hasAgentKit = (files: string[] | undefined) => (files ?? []).includes(AGENT_FILE);

/**
 * The idea's folder in the workspace. `folder` is the real one the server sent (GET …/design); without it,
 * the name the server would give it (ideas/<id>-<slug>).
 */
export const ideaFolder = (ideaId: string, slug?: string, folder?: string) =>
  (folder?.trim() ? folder.trim().replace(/\/+$/, '') : `ideas/${slug ? `${ideaId}-${slug}` : ideaId}`);

/** The instruction an operator pastes into Claude Code or Copilot to build the custom-app part. */
export function buildInstruction(ideaId: string, slug?: string, folder?: string): string {
  const dir = ideaFolder(ideaId, slug, folder);
  return [
    `Build the custom-app proof of concept for Café idea ${ideaId}.`,
    `Read ${dir}/design.md, ${dir}/plan.md and ${dir}/${AGENT_FILE} first, and follow ${AGENT_FILE}.`,
    `Write only inside ${dir}/kit/custom-app/. Use synthetic sample data only: no personal, client or third-party data.`,
    'Custom app is TTIA-Led, so this part goes to the CSIC Repository; keep it a small proof of concept.',
    `When it works, add ${dir}/kit/custom-app/RUN.md saying how to run it.`,
  ].join('\n');
}

/** After "Suggest features with AI": the operator's rows stay as they are; only features with a new name are added. */
export function mergeRows(local: FeatureRow[], incoming: FeatureRow[]): FeatureRow[] {
  const names = new Set(local.map((r) => r.name.trim().toLowerCase()).filter(Boolean));
  return [...local, ...incoming.filter((r) => !names.has(r.name.trim().toLowerCase()))];
}

/** "1 feature" / "3 features". */
export const features = (n: number) => `${n} feature${n === 1 ? '' : 's'}`;

/** Suggested answers typed one per line in the hand question form: blanks dropped, at most 4. */
export const suggestedLines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4);

