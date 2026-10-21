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

const singular = (w: string) => (w.length > 3 && w.endsWith('es') && !w.endsWith('ses') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

export function normaliseLabel(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w && !STOP.has(w)).map(singular).join(' ').trim();
}

export function wordOverlap(a: string, b: string): number {
  const x = new Set(normaliseLabel(a).split(' ').filter(Boolean)); const y = new Set(normaliseLabel(b).split(' ').filter(Boolean));
  if (!x.size || !y.size) return 0;
  let n = 0; for (const w of x) if (y.has(w)) n++;
  return n / Math.min(x.size, y.size);
}

export function isPersonLabel(label: string, ctx: ConflictContext): boolean {
  const k = normaliseLabel(label);
  const people = [
    ...ctx.peoplePresent, ...(ctx.idea?.people.team.map((p) => p.name) ?? []),
    ctx.idea?.people.submitter ?? '', (ctx.idea?.people as { builder?: string } | undefined)?.builder ?? '',
  ];
  return people.some((p) => p && normaliseLabel(p) === k);
}

const pct = (c: number) => `${Math.round(c * 100)}%`;

/** One link → null (fine) or the held reason. */
function checkLink(l: AiLink, ctx: ConflictContext): Omit<Held, 'action'> | null {
  for (const n of l.newNodes ?? []) {
    if (n.type === 'Person' || isPersonLabel(n.label, ctx)) return { rule: 'person-star', why: 'People come from the form only, never from text' };
    const k = normaliseLabel(n.label);
    const twin = ctx.nodes.find((x) => x.type === n.type && x.id !== n.id && (normaliseLabel(x.label) === k || wordOverlap(x.label, n.label) >= NEAR_DUPLICATE));
    if (twin) return { rule: 'near-duplicate-star', why: `Looks like ${twin.label}: merge or keep both?`, existing: twin.id };
  }
  if (l.confidence < LOW_CONFIDENCE) return { rule: 'low-confidence', why: `The AI was not sure (${pct(l.confidence)})` };
  return null;
}

function stageBack(idea: Idea, a: Extract<Action, { t: 'suggest_stage' }>): boolean {
  if (a.closeAs) return true;
  return a.stage !== undefined && a.stage <= idea.stage;
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
        if (have && normaliseLabel(have) !== normaliseLabel(a.name)) hold.push({ action: a, rule: 'contradicts-fact', why: 'A second builder is named: the form names one already' });
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
        const k = normaliseLabel(a.fields.title);
        const twin = ctx.ideas.find((i) => normaliseLabel(i.title) === k);
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
