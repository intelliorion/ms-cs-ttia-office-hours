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
export function extractNotice(r: { added?: number; unconfirmed?: number; suggestions?: { newNodes?: { label: string }[] } }): string {
  const added = r.added ?? 0;
  const un = r.unconfirmed ?? 0;
  const head = added === 0 ? 'Added 0 links: nothing new to add.' : `Added ${added} link${added === 1 ? '' : 's'}, ${un} to confirm.`;
  const stars = (r.suggestions?.newNodes ?? []).map((n) => n.label).filter(Boolean);
  return stars.length ? `${head} New stars to confirm: ${stars.join(', ')}.` : head;
}

/** The review form with the AI's suggestion laid over it. Only known criteria and a non-empty decision or reason are taken. */
export function applySuggestion(form: ReviewForm, s: ReviewSuggestion): ReviewForm {
  const criteria = { ...form.criteria };
  for (const [k, v] of Object.entries(s.criteria ?? {})) if (typeof v === 'boolean') criteria[k] = v;
  return { criteria, decision: s.decision || form.decision, reason: s.reason?.trim() ? s.reason : form.reason };
}
