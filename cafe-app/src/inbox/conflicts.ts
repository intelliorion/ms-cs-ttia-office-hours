// cafe-app/src/inbox/conflicts.ts
import type { Action } from './actions';
import type { AiLink, GNode } from '../graph/ontology';
import type { Idea } from '../ideas/idea';
import type { DesignState } from '../design/store';

/**
 * The conflict rules: code, not AI, decides what waits for the operator. Everything else is applied at once
 * (ruling: only the conflicting item waits). One proposal → apply, or hold with the rule and a plain reason.
 */
export type HeldRule = 'contradicts-fact' | 'person-star' | 'near-duplicate-star' | 'low-confidence' | 'two-ideas' | 'duplicate-idea' | 'screened';
export interface Held {
  action: Action; rule: HeldRule; why: string;
  /** The existing node or idea this clashes with, when there is one. */
  existing?: string;
}
export interface ConflictContext {
  idea: Idea | null;
  ideas: Idea[];
  nodes: GNode[];
  /** Display names present in the file (To, Cc, From, speakers). */
  peoplePresent: string[];
  design: DesignState | null;
  match: { ideaId: string | null; confidence: number; candidates: string[] };
  aiIdeaId: string | null;
  /** The screen's reasons, when it flagged anything (the file was still read). */
  screened: string[];
}

export const LOW_CONFIDENCE = 0.5;
export const NEAR_DUPLICATE = 0.8;
const STOP = new Set(['the', 'a', 'an', 'of', 'for', 'to', 'in', 'on', 'and', 'or', 'by', 'with', 'into', 's']);

export function normaliseLabel(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w && !STOP.has(w)).join(' ').trim();
}

/** Same word, allowing a plain plural (s, es, ies/y, es/is) either way round. */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (l === `${s}s` || l === `${s}es`) return true;
  if (l.endsWith('ies') && s.endsWith('y') && l.slice(0, -3) === s.slice(0, -1)) return true;
  return [[a, b], [b, a]].some(([p, q]) => p.endsWith('es') && q.endsWith('is') && p.slice(0, -2) === q.slice(0, -2));
}

const words = (s: string) => normaliseLabel(s).split(' ').filter(Boolean);

export function sameLabel(a: string, b: string): boolean {
  const x = words(a); const y = words(b);
  return x.length === y.length && x.every((w, i) => sameWord(w, y[i]));
}

export function wordOverlap(a: string, b: string): number {
  const x = words(a); const y = words(b);
  if (!x.length || !y.length) return 0;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const n = short.filter((w) => long.some((v) => sameWord(w, v))).length;
  return n / long.length;
}

export function isPersonLabel(label: string, ctx: ConflictContext): boolean {
  const people = [
    ...ctx.peoplePresent, ...(ctx.idea?.people.team.map((p) => p.name) ?? []),
    ctx.idea?.people.submitter ?? '', (ctx.idea?.people as { builder?: string } | undefined)?.builder ?? '',
  ];
  return people.some((p) => p && sameLabel(p, label));
}

const pct = (c: number) => `${Math.round(c * 100)}%`;

/** One link → null (fine) or the held reason. */
function checkLink(l: AiLink, ctx: ConflictContext): Omit<Held, 'action'> | null {
  for (const n of l.newNodes ?? []) {
    if (n.type === 'Person' || isPersonLabel(n.label, ctx)) return { rule: 'person-star', why: 'People come from the form only, never from text' };
    const twin = ctx.nodes.find((x) => x.type === n.type && x.id !== n.id && (sameLabel(x.label, n.label) || wordOverlap(x.label, n.label) >= NEAR_DUPLICATE));
    if (twin) return { rule: 'near-duplicate-star', why: `Looks like ${twin.label}: merge or keep both?`, existing: twin.id };
  }
  if (l.confidence < LOW_CONFIDENCE) return { rule: 'low-confidence', why: `The AI was not sure (${pct(l.confidence)})` };
  return null;
}

function stageBack(idea: Idea, a: Extract<Action, { t: 'suggest_stage' }>): boolean {
  if (a.closeAs) return true;
  return a.stage !== undefined && a.stage < idea.stage;
}

export function checkProposals(ctx: ConflictContext, actions: Action[]): { apply: Action[]; hold: Held[] } {
  const apply: Action[] = []; const hold: Held[] = [];
  const split = ctx.match.candidates.length > 1 && ctx.match.confidence >= 0.7 && ctx.match.confidence < 1
    && ctx.aiIdeaId !== null && ctx.aiIdeaId !== ctx.match.ideaId;
  const twoIdeas = split ? `This could belong to ${ctx.match.candidates.slice(0, 2).join(' or ')}` : null;
  for (const a of actions) {
    if (a.t === 'ask_idea' || a.t === 'import_export' || a.t === 'file_email') { apply.push(a); continue; }
    if (ctx.screened.length) { hold.push({ action: a, rule: 'screened', why: ctx.screened[0] }); continue; }
    if (twoIdeas) { hold.push({ action: a, rule: 'two-ideas', why: twoIdeas }); continue; }
    switch (a.t) {
      case 'graph_links': {
        const ok: AiLink[] = [];
        for (const l of a.links) {
          const h = checkLink(l, ctx);
          if (h) hold.push({ action: { ...a, links: [l] }, ...h }); else ok.push(l);
        }
        if (ok.length) apply.push({ ...a, links: ok });
        break;
      }
      case 'name_builder': {
        const have = (ctx.idea?.people as { builder?: string } | undefined)?.builder;
        if (have && !sameLabel(have, a.name)) hold.push({ action: a, rule: 'contradicts-fact', why: 'A second builder is named: the form names one already' });
        else apply.push(a);
        break;
      }
      case 'suggest_stage': {
        if (ctx.idea && stageBack(ctx.idea, a)) {
          hold.push({ action: a, rule: 'contradicts-fact', why: a.closeAs ? 'The file points at closing the idea' : 'The file points at an earlier stage than the idea is in' });
        } else apply.push(a);
        break;
      }
      case 'create_idea': {
        const twin = ctx.ideas.find((i) => sameLabel(i.title, a.fields.title));
        if (twin) hold.push({ action: a, rule: 'duplicate-idea', why: `Looks like ${twin.id} (same title)`, existing: twin.id });
        else apply.push(a);
        break;
      }
      default:
        apply.push(a);
    }
  }
  return { apply, hold };
}
