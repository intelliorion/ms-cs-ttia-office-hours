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
  people: { submitter?: string; team: Person[] };
  checklist: Record<string, StepState>;
  /** step id → ISO due date */
  due: Record<string, string>;
  /** template id → ISO date it was marked sent */
  sent: Record<string, string>;
  review?: ReviewRecord;
  flags: string[];
  route?: string;
  source?: { file: string; row: number };
  dedupe_key: string;
}

export function normalizeIdea(raw: Partial<Idea>): Idea {
  const stage = Number(raw.stage);
  return {
    ...raw,
    id: String(raw.id ?? ''),
    slug: String(raw.slug ?? ''),
    title: String(raw.title ?? ''),
    round: String(raw.round ?? ''),
    stage: ([1, 2, 3, 4].includes(stage) ? stage : 1) as StageNo,
    outcomes: raw.outcomes ?? [],
    support: raw.support ?? [],
    people: { team: [], ...(raw.people ?? {}) },
    checklist: raw.checklist ?? {},
    due: raw.due ?? {},
    sent: raw.sent ?? {},
    flags: raw.flags ?? [],
    dedupe_key: String(raw.dedupe_key ?? ''),
  };
}
