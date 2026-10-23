/**
 * What a design question settles, and where each point's answer is read from. Pure (no files), so the server's
 * design.md and the UI's design pack show the same thing.
 */

/** The five points every design settles. */
export const BASE_TAGS = ['must-show', 'smallest-input', 'users', 'replaces', 'builder'] as const;
/** The build points: what a builder needs before the first session (the input's shape, the rule, the output, the check, the access). */
export const BUILD_TAGS = ['input-shape', 'logic', 'output', 'done-when', 'environment'] as const;
export const DESIGN_TAGS = [...BASE_TAGS, ...BUILD_TAGS] as const;
export type DesignTag = (typeof DESIGN_TAGS)[number];

/** How each point is headed in design.md and the pack. */
export const POINT_LABELS: Record<DesignTag, string> = {
  'must-show': 'Must show', 'smallest-input': 'Smallest input', users: 'Who uses it', replaces: 'What it replaces', builder: 'Who builds it',
  'input-shape': 'Input', logic: 'Logic', output: 'Output', 'done-when': 'Done when', environment: 'Environment',
};

/** One line on what each build point holds, for the pack's "(not yet answered)" rows and the prompt. */
export const BUILD_HINTS: Record<(typeof BUILD_TAGS)[number], string> = {
  'input-shape': 'the sample file: its fields, format, how many rows, how it is masked',
  logic: 'the exact rule: what is checked, against what, the exceptions, the rules sheet columns',
  output: 'the result: its columns, its form (dataset, dashboard, Excel), where it lands, how often',
  'done-when': 'the check: a seeded sample and what must come out of it',
  environment: 'where it is built: the instance or project, the data approval, the builder access',
};

export const NOT_ANSWERED = '(not yet answered)';
export const POINT_MAX = 300;

export const isDesignTag = (t: unknown): t is DesignTag => typeof t === 'string' && (DESIGN_TAGS as readonly string[]).includes(t);

interface PointSource {
  steps: { tag?: string; answer?: string }[];
  /** What the AI's done reply said the earlier answers already settle, by tag. */
  settled?: Partial<Record<string, string>>;
  /** The confirmed data's points (input-shape, output, logic): what the dropped files settle, after any answer. */
  data?: { confirmedAt?: string; points?: Partial<Record<string, string>> };
}

/**
 * The answer that settles a point: the answered questions tagged with it (several join with "; "), else what the done
 * reply said the answers settle, else what the confirmed data settles, else, with no tags at all (hand-written
 * questions), the first answer for the smallest input. Undefined when the point is still open.
 */
export function pointOf(state: PointSource, tag: DesignTag): string | undefined {
  const hits = state.steps.filter((s) => s.tag === tag && s.answer?.trim()).map((s) => s.answer!.trim());
  if (hits.length) return hits.join('; ');
  const said = state.settled?.[tag];
  if (typeof said === 'string' && said.trim()) return said.trim();
  const fromData = state.data?.confirmedAt ? state.data.points?.[tag] : undefined;
  if (typeof fromData === 'string' && fromData.trim()) return fromData.trim();
  if (tag === 'smallest-input' && !state.steps.some((s) => s.tag)) return state.steps[0]?.answer?.trim() || undefined;
  return undefined;
}

/** The build points still open, in order. */
export const openBuildPoints = (state: PointSource): DesignTag[] => BUILD_TAGS.filter((t) => !pointOf(state, t));
