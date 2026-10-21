export interface AiStatus {
  provider: string | null;
  label: string;
  note?: string;
  choices?: { id: string; label: string; available: boolean; note?: string }[];
}
export interface ReviewForm { criteria: Record<string, boolean>; decision: string; reason: string }
export interface ReviewSuggestion { criteria: Record<string, boolean>; decision: string; reason: string; provider?: string }

export const NO_AI_TIP = 'No AI connected: working by hand';
const NAMES: Record<string, string> = { claude: 'Claude Code', copilot: 'Copilot CLI', vscode: 'Copilot (VS Code)', fake: 'Fake (test)' };

/** Text on the title-bar chip. */
export function chipText(s: AiStatus | null | undefined): string {
  if (!s || !s.provider) return 'No AI: working by hand';
  return `${s.label || NAMES[s.provider] || s.provider} ✓`;
}

/** Plain name for a provider id, for the "Suggested by" line. */
export const providerName = (id: string | undefined, s?: AiStatus | null): string =>
  (id && NAMES[id]) || (id && s?.provider === id ? s.label : '') || id || 'the AI';

/** The notice after "Grow the universe". */
export function extractNotice(r: { added?: number; held?: unknown[]; suggestions?: { newNodes?: { label: string }[] } }): string {
  const added = r.added ?? 0;
  const held = r.held?.length ?? 0;
  if (added === 0 && held === 0) return 'Added 0 links: nothing new to add.';
  return `${added} link${added === 1 ? '' : 's'} added to the universe${held ? `, ${held} waiting on you` : ''}.`;
}

/** The review form with the AI's suggestion laid over it. Only known criteria and a non-empty decision or reason are taken. */
export function applySuggestion(form: ReviewForm, s: ReviewSuggestion): ReviewForm {
  const criteria = { ...form.criteria };
  for (const [k, v] of Object.entries(s.criteria ?? {})) if (typeof v === 'boolean') criteria[k] = v;
  return { criteria, decision: s.decision || form.decision, reason: s.reason?.trim() ? s.reason : form.reason };
}

/** The radio value after a save attempt: the server's saved value on success, the previous one on failure. */
export const nextProviderChoice = (prev: string, saved: string | undefined, ok: boolean): string => (ok && saved ? saved : prev);

/** The AI pop-out's Test result. */
export const aiTestText = (r: { ok?: boolean; provider?: string; label?: string; ms?: number }): string =>
  `Connected: ${r.label || providerName(r.provider)} (${Math.round(r.ms ?? 0)} ms)`;
