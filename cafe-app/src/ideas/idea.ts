import { FIRST_STAGE, toStage, type StageNo } from '../rules/stages';

export type Closure = 'reuse' | 'csic' | 'notnow' | 'pattern' | 'stop';

export const CLOSURE_LABELS: Record<Closure, string> = {
  reuse: 'Reuse',
  csic: 'Routed to CSIC',
  notnow: 'Not this round',
  pattern: 'Café pattern',
  stop: 'Stopped, learning kept',
};

/** What someone does on an idea. One person can have several (a lead who also builds it); "member" only when nothing else. */
export type PersonRole = 'lead' | 'sponsor' | 'builder' | 'member';

export interface Person {
  name: string;
  roles: PersonRole[];
  /** The form's own words for them, as typed ("Lead, Builder"). */
  note?: string;
  /** Roles given after the form (by an answer, an email or the assistant), so they show apart from what was submitted. */
  added?: PersonRole[];
  /** Not on the form: added later. */
  joined?: boolean;
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

/** One item on the Review and Select to-do list. */
export interface PrepNeed {
  id: string;
  /** What is needed, in a few words. */
  need: string;
  /** The question for the team. */
  ask: string;
  /** The last evaluation found it covered. */
  met: boolean;
  /** What covered it, in the AI's words (names restored). */
  note?: string;
  /** What the operator pasted or typed. */
  answer?: string;
  /** When it went to the team in an E2. */
  askedAt?: string;
}
/** The last decision suggestion and its to-do list. Saved on the idea so answers survive a reload; the decision itself is saved only by Save decision. */
/**
 * One change the answers justify, proposed after a suggestion or a re-evaluation: nothing changes until the operator
 * says Yes. `key` names the change, so one said no to is not proposed again; `undo` is how an applied one goes back.
 */
/** Where a proposal came from: the decision, the tool picker or the design questions. */
export type UpdateSource = 'decision' | 'tools' | 'design';

export interface PrepUpdate {
  id: string;
  key: string;
  kind: 'builder' | 'participation' | 'flag' | 'facts' | 'link';
  /** Which suggestion proposed it: each section lists only its own. Older records came from the decision. */
  from?: UpdateSource;
  label: string;
  status: 'proposed' | 'applied' | 'dismissed';
  builder?: { name: string; canAttend: boolean; typed?: string; instead?: string[] };
  participation?: string;
  flag?: string;
  facts?: { question: string; answer: string }[];
  link?: { from: string; to: string; rel: string; description: string; confidence: number; source: string; newNodes?: { id: string; type: string; label: string }[] };
  undo?: { team?: Person[]; teamAfter?: Person[]; ticked?: string[]; participation?: string | null; edgeId?: string; replaced?: { question: string; answer: string; source?: string }[] };
}

export interface ReviewPrep {
  at: string;
  decision: Decision;
  reason: string;
  criteria: Record<string, boolean>;
  needs: PrepNeed[];
  basis: string;
  provider?: string;
  /** Older records only: the proposals now live on the idea (Idea.updates). */
  updates?: PrepUpdate[];
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
  /**
   * What the answers add to the submission, as the AI's short brief (one point per topic), written at the last
   * suggestion or re-evaluation. `stale` once an answer it was written from is removed.
   */
  learned?: { at: string; provider?: string; from: number; points: { topic: string; text: string }[]; stale?: boolean };
  /**
   * What the answers would change in the record ("From your answers"), from the decision's and the tool picker's
   * re-evaluations alike, each waiting for the operator's Yes (or applied, or said no to).
   */
  updates?: PrepUpdate[];
  /** What the form said for a field that was changed later (field → the form's value), so both can be shown. */
  formWas?: Record<string, string>;
  checklist: Record<string, StepState>;
  /** step id → ISO due date */
  due: Record<string, string>;
  /** template id → ISO date it was marked sent */
  sent: Record<string, string>;
  review?: ReviewRecord;
  prep?: ReviewPrep;
  flags: string[];
  route?: string;
  /** feature name → approved tool, derived from approach.md (the tool picker). Replaced whole on every save. */
  tools?: Record<string, string>;
  source?: { file: string; row: number };
  dedupe_key: string;
}

import { normalizePeople } from './people';

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
    stage: toStage(stage) ?? FIRST_STAGE,
    outcomes: arr(raw.outcomes),
    support: arr(raw.support),
    beneficiaries: arr(raw.beneficiaries),
    use_case_category: arr(raw.use_case_category),
    people: normalizePeople(raw.people),
    // Proposals kept on the decision before they were shared with the tool picker.
    ...(raw.updates === undefined && raw.prep?.updates?.length ? { updates: raw.prep.updates } : {}),
    ...(raw.prep?.updates ? { prep: (({ updates: _u, ...p }) => p)(raw.prep) } : {}),
    checklist: raw.checklist ?? {},
    due: raw.due ?? {},
    sent: raw.sent ?? {},
    flags: arr(raw.flags),
    ...(raw.tools !== undefined ? { tools: toolMap(raw.tools) } : {}),
    dedupe_key: String(raw.dedupe_key ?? ''),
  };
}
