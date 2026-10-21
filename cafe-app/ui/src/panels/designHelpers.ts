/** Pure helpers for the Tool picker, Design and Plan sections of an idea's details. */
import { sameQuestion } from '../../../src/inbox/question';

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
export const CUSTOM_APP_NOTE = 'Custom app is TTIA-Led: this feature goes to the CSIC Repository, not a Café build.';
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

/** One row of the Tool picker, as the operator edits it. */
export interface FeatureRow {
  key: string;
  name: string;
  what: string;
  tool: string;
  reason: string;
  flags: string[];
  /** "Why this tool": the facts and the rule the suggestion rested on; kept with the saved pick. */
  context: string[];
  /** Filled by the AI and not saved yet: shown with a highlighted border. */
  suggested: boolean;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
let seq = 0;
const newKey = () => `row-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** The custom-app flag follows the tool, as the server does on save. */
export function flagsFor(tool: string, flags: string[]): string[] {
  const rest = flags.filter((f) => f !== 'custom-app');
  return tool === CUSTOM_APP ? ['custom-app', ...rest] : rest;
}

/**
 * Rows from either shape: a saved DesignFeature ({id, name, what?, tool?, reason?, pathway?, flags}) or an AI
 * ToolPickFeature ({name, what, tool, reason, flags}). `suggested` marks the rows the AI added (no saved id).
 */
export function featureRows(raw: unknown, opts: { fromAi?: boolean; tools?: readonly string[] } = {}): FeatureRow[] {
  if (!Array.isArray(raw)) return [];
  const known: readonly string[] = opts.tools ?? APPROVED_TOOLS;
  return raw.filter((f) => f && typeof f === 'object' && str((f as any).name).trim()).map((f: any) => {
    const tool = known.includes(f.tool) ? f.tool : '';
    const flags = Array.isArray(f.flags) ? f.flags.filter((x: unknown): x is string => typeof x === 'string') : [];
    return {
      key: str(f.id) || newKey(),
      name: str(f.name), what: str(f.what), tool, reason: str(f.reason),
      flags: flagsFor(tool, flags),
      context: Array.isArray(f.context) ? f.context.filter((x: unknown): x is string => typeof x === 'string' && x.trim() !== '').slice(0, 6) : [],
      suggested: Boolean(opts.fromAi) && !str(f.id),
    };
  });
}

export const emptyRow = (): FeatureRow => ({ key: newKey(), name: '', what: '', tool: '', reason: '', flags: [], context: [], suggested: false });

/** The body for POST …/tools: name, what, tool, reason, flags and the context lines; rows with no name and nothing else are dropped. */
export function picksBody(rows: FeatureRow[]): { features: { name: string; what?: string; tool?: string; reason?: string; flags: string[]; context?: string[] }[] } {
  return {
    features: rows
      .filter((r) => r.name.trim() || r.what.trim() || r.tool)
      .map((r) => ({
        name: r.name.trim(),
        ...(r.what.trim() ? { what: r.what.trim() } : {}),
        ...(r.tool ? { tool: r.tool } : {}),
        ...(r.reason.trim() ? { reason: r.reason.trim() } : {}),
        flags: flagsFor(r.tool, r.flags),
        ...(r.context.length ? { context: r.context } : {}),
      })),
  };
}

/** What stops a save, in plain words, or null. */
export function picksProblem(rows: FeatureRow[]): string | null {
  const body = picksBody(rows).features;
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

/** After "Suggest with AI": the operator's rows stay as they are; only features with a new name are added. */
export function mergeRows(local: FeatureRow[], incoming: FeatureRow[]): FeatureRow[] {
  const names = new Set(local.map((r) => r.name.trim().toLowerCase()).filter(Boolean));
  return [...local, ...incoming.filter((r) => !names.has(r.name.trim().toLowerCase()))];
}

/** "1 feature" / "3 features". */
export const features = (n: number) => `${n} feature${n === 1 ? '' : 's'}`;

/** Suggested answers typed one per line in the hand question form: blanks dropped, at most 4. */
export const suggestedLines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4);

/** Each question the picker asked, with the team's answer the Inbox recorded for it (matched loosely), if any. */
export function askedWithAnswers(questions: string[], idea: { answers?: { question: string; answer: string }[] }): { question: string; answer?: string }[] {
  const answers = idea.answers ?? [];
  return questions.map((q) => ({ question: q, ...(answers.find((a) => sameQuestion(a.question, q)) ? { answer: answers.find((a) => sameQuestion(a.question, q))!.answer } : {}) }));
}

/** The Suggest button waits while questions are out to the team and nothing has come back: no reply marked received (s2d) and no recorded answer matching any of them. */
export const suggestWaiting = (design: { toolQuestions?: { questions: string[] } } | null | undefined, idea: { checklist?: Record<string, { done?: boolean }>; answers?: { question: string; answer: string }[] }): boolean => {
  const qs = design?.toolQuestions?.questions ?? [];
  if (!qs.length || idea.checklist?.s2d?.done) return false;
  return !askedWithAnswers(qs, idea).some((x) => x.answer);
};
