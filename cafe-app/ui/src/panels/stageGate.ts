/**
 * Which action sections an idea's panel shows, by stage. Each section has one home stage: before it the section is
 * hidden, at it the section is the full form, after it (or once the idea is closed) a compact read-only card.
 * Data wins over stage: anything already saved is never hidden. "Edit" on a card reopens the form while the idea is open.
 */
export type Gate = 'hidden' | 'active' | 'summary';
export type SectionKey = 'review' | 'tools' | 'design' | 'plan';
export type Gates = Record<SectionKey, Gate>;

export const HOME_STAGE: Record<SectionKey, number> = { review: 2, tools: 3, design: 3, plan: 3 };

interface IdeaLike { stage: number; closed?: unknown; review?: unknown }
interface DesignLike { features?: unknown[]; steps?: unknown[]; summary?: string; approvedAt?: string }

export function sectionsFor(idea: IdeaLike, design: DesignLike | null | undefined, editing: readonly string[], plan?: { files?: unknown[] } | null): Gates {
  const closed = Boolean(idea.closed);
  const stage = idea.stage;
  const has: Record<SectionKey, boolean> = {
    review: Boolean(idea.review),
    tools: Boolean(design?.features?.length),
    design: Boolean(design?.steps?.length || design?.summary),
    // Plan files outlive the approval: reopening the design drops approvedAt but keeps plan.md and the kits.
    plan: Boolean(design?.approvedAt) || Boolean(plan?.files?.length),
  };
  // The design and the plan only open once the step before them is done, or once they hold data of their own.
  const open: Record<SectionKey, boolean> = {
    review: true, tools: true, design: Boolean(design?.features?.length) || has.design, plan: has.plan,
  };
  const gate = (k: SectionKey): Gate => {
    const home = HOME_STAGE[k];
    if (closed) return has[k] ? 'summary' : 'hidden';
    if (editing.includes(k) && open[k]) return 'active';
    if (stage === home) return open[k] ? 'active' : 'hidden';
    if (stage > home) return has[k] || k === 'review' || k === 'tools' ? 'summary' : 'hidden';
    return has[k] ? 'summary' : 'hidden';
  };
  return { review: gate('review'), tools: gate('tools'), design: gate('design'), plan: gate('plan') };
}
