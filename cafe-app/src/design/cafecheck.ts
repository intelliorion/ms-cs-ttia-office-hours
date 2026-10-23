import type { Idea } from '../ideas/idea';
import type { DesignState } from './store';
import { toolFeatures } from './choice';

export interface CafeCheck {
  valueWords: string[];
  dataFlags: string[];
  csicFlags: string[];
  ok: boolean;
}

export const VALUE_RE = /\b(?:roi|savings?|benefits?|kpi|hours saved|fte|costs?)\b|[%$£€]\s?\d[\d,.]*|\d[\d,.]*\s?[%$£€]/gi;
const DATA_RE = /\b(?:personal|client|customer|third[\s\-.]party|hr data|employee record|pii)\b/gi;
const CSIC_RE = /\blive (?:connection|integration)\b|\bapi to\b|\b(?:sap|salesforce|servicenow|workday|oracle)\b|\bnon-microsoft\b|\btechnology squad\b/gi;

function matches(re: RegExp, text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const w = m[0].trim().toLowerCase();
    if (!seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  }
  return out;
}

/** The value words in any text, as the Café check reports them (lowercase, de-duplicated, in order). */
export const valueWordsIn = (text: string): string[] => matches(VALUE_RE, text);

/** Everything the idea and its design say, as one searchable text. */
export function designText(idea: Idea, state: DesignState): string {
  const parts: string[] = [idea.title, idea.challenge ?? '', ...idea.outcomes, idea.current_process ?? '', state.summary ?? ''];
  for (const f of toolFeatures(state)) parts.push(f.name, f.what ?? '', f.tool ?? '');
  if (state.tool) parts.push(state.tool.reason);
  for (const s of state.steps) parts.push(s.answer ?? '');
  return parts.filter(Boolean).join('\n');
}

export function cafeCheck(idea: Idea, state: DesignState): CafeCheck {
  const text = designText(idea, state);
  const csic = matches(CSIC_RE, text);
  const data = matches(DATA_RE, text);
  // The feature flags the tool picker set (AI or operator) count as much as the words.
  const flagged: string[] = [];
  for (const f of state.features) {
    const name = f.name.replace(/\s+/g, ' ').trim();
    if (f.flags.includes('needs-live-system')) flagged.push(`live system: ${name}`);
    if (f.flags.includes('personal-data')) {
      flagged.push(`personal data: ${name}`);
      data.push(`personal data: ${name}`);
    }
  }
  // The one tool: a custom app is a CSIC flag, and so is a live system the tool's evaluation flagged.
  const tool = state.tool;
  if (tool?.tool.toLowerCase() === 'custom app') csic.unshift('custom app');
  if (tool?.flags.includes('needs-live-system')) flagged.push(`live system: ${tool.tool}`);
  if (tool?.flags.includes('personal-data')) { flagged.push(`personal data: ${tool.tool}`); data.push(`personal data: ${tool.tool}`); }
  const csicFlags = [...new Set([...csic, ...flagged])];
  const dataFlags = [...new Set(data)];
  return { valueWords: valueWordsIn(text), dataFlags, csicFlags, ok: csicFlags.length === 0 };
}
