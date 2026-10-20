import { formatDate } from '../clock';

export interface Round {
  id: string;
  open?: string;
  deadline?: string;
  reviewBy?: string;
  seriesStart?: string;
  roadshow?: string;
}

export interface Settings {
  operatorName?: string;
  formLink?: string;
  csicLink?: string;
  teamsLink?: string;
  distList?: string;
  deckTemplate?: string;
  capacity: { ideasPerRound: number; sessionsPerWeek: number };
  /** Which coding tool lends the app an LLM. 'auto' tries Claude Code, Copilot CLI, then VS Code. */
  ai?: { provider?: AiChoice };
}

export type AiChoice = 'auto' | 'claude' | 'copilot' | 'vscode' | 'none';
export const AI_CHOICES: AiChoice[] = ['auto', 'claude', 'copilot', 'vscode', 'none'];

export const DEFAULT_SETTINGS: Settings = { capacity: { ideasPerRound: 3, sessionsPerWeek: 2 } };

export const ROUND_FIELDS = [
  ['open', 'Round opens'],
  ['deadline', 'Submission deadline'],
  ['reviewBy', 'Decisions by'],
  ['seriesStart', 'Design series starts'],
  ['roadshow', 'Roadshow'],
] as const;

export const SETTING_FIELDS = [
  ['operatorName', 'Your name (email signature)'],
  ['formLink', 'Café form link'],
  ['csicLink', 'CSIC Repository intake link'],
  ['teamsLink', 'Teams link for sessions'],
  ['distList', 'Distribution list for the call for ideas'],
  ['deckTemplate', 'Firm deck template'],
] as const;

export interface TokenDef {
  from: 'round' | 'settings';
  key: string;
  label: string;
  date?: boolean;
}

export const TOKENS: Record<string, TokenDef> = {
  '[DEADLINE]': { from: 'round', key: 'deadline', label: 'Submission deadline', date: true },
  '[REVIEW DATE]': { from: 'round', key: 'reviewBy', label: 'Decisions by', date: true },
  '[FORM LINK]': { from: 'settings', key: 'formLink', label: 'Café form link' },
  '[CSIC REPOSITORY INTAKE LINK]': { from: 'settings', key: 'csicLink', label: 'CSIC Repository intake link' },
  '[ROOM OR TEAMS LINK]': { from: 'settings', key: 'teamsLink', label: 'Teams link for sessions' },
  '[DISTRIBUTION LIST]': { from: 'settings', key: 'distList', label: 'Distribution list for the call for ideas' },
  '[YOUR NAME]': { from: 'settings', key: 'operatorName', label: 'Your name (email signature)' },
};

export function resolveToken(token: string, round: Round, settings: Settings): string | undefined {
  const def = TOKENS[token];
  if (!def) return undefined;
  const source = (def.from === 'round' ? round : settings) as unknown as Record<string, unknown>;
  const value = source[def.key];
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  return def.date ? formatDate(value.trim()) : value.trim();
}
