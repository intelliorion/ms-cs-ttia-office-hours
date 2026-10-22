import type { StageNo } from '../rules/stages';

export type Closure = 'reuse' | 'csic' | 'notnow' | 'pattern' | 'stop';

export const CLOSURE_LABELS: Record<Closure, string> = {
  reuse: 'Reuse',
  csic: 'Routed to CSIC',
  notnow: 'Not this round',
  pattern: 'Café pattern',
  stop: 'Stopped, learning kept',
};

export type PersonRole = 'lead' | 'sponsor' | 'member';

export interface Person {
  name: string;
  role: PersonRole;
  note?: string;
}

export interface StepState {
  done: boolean;
  by: 'operator' | 'app';
  at: string;
  source?: string;
}

export type Decision = 'select' | 'reuse' | 'csic' | 'notnow' | 'ask';

export interface ReviewRecord {
  criteria: Record<string, boolean>;
  decision: Decision;
  reason: string;
  at: string;
}

export interface Idea {
  id: string;
  slug: string;
  title: string;
  round: string;
  stage: StageNo;
  closed?: { as: Closure; at: string; followUp?: string };
  entity?: string;
  function?: string;
  region?: string;
  participation?: string;
  challenge?: string;
  outcomes: string[];
  current_process?: string;
  support: string[];
  experimented?: string;
  maturity?: string;
  business_impact?: string;
  beneficiaries: string[];
  use_case_category: string[];
  additional_context?: string;
  people: { submitter?: string; team: Person[] };
  checklist: Record<string, StepState>;
  /** step id → ISO due date */
  due: Record<string, string>;
  /** template id → ISO date it was marked sent */
  sent: Record<string, string>;
  review?: ReviewRecord;
  flags: string[];
  route?: string;
  /** feature name → approved tool, derived from approach.md (the tool picker). Replaced whole on every save. */
  tools?: Record<string, string>;
  source?: { file: string; row: number };
  dedupe_key: string;
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = (v: unknown): object => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

const toolMap = (v: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries(obj(v)).filter(([k, t]) => k.trim() && typeof t === 'string' && t.trim()));

export function normalizeIdea(raw: Partial<Idea>): Idea {
  const stage = Number(raw.stage);
  return {
    ...raw,
    id: String(raw.id ?? ''),
    slug: String(raw.slug ?? ''),
    title: String(raw.title ?? ''),
    round: String(raw.round ?? ''),
    stage: ([1, 2, 3, 4].includes(stage) ? stage : 1) as StageNo,
    outcomes: arr(raw.outcomes),
    support: arr(raw.support),
    beneficiaries: arr(raw.beneficiaries),
    use_case_category: arr(raw.use_case_category),
    people: { ...obj(raw.people), team: arr(raw.people?.team) },
    checklist: raw.checklist ?? {},
    due: raw.due ?? {},
    sent: raw.sent ?? {},
    flags: arr(raw.flags),
    ...(raw.tools !== undefined ? { tools: toolMap(raw.tools) } : {}),
    dedupe_key: String(raw.dedupe_key ?? ''),
  };
}
