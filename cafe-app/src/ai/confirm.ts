import { CONFIRMED_AT } from '../graph/ontology';
import type { Settings } from '../round/round';

/**
 * The lowest threshold the app takes: below it nearly every AI read would count as confirmed with no Do it (0 would
 * confirm them all). A lower value in settings is said and not used.
 */
export const CONFIRM_AT_MIN = 0.5;

/**
 * The confidence at or above which an AI link is stored as confirmed; below it the link waits for the operator's
 * Do it. rules/settings.yaml `graph: { confirmAt: 0.7 }` sets it (0.5 to 1); the default is CONFIRMED_AT, 0.7. A value
 * that is not a number from 0.5 to 1 is not used (confirmAtProblem says so).
 */
export function confirmAt(settings: Partial<Settings> | undefined): number {
  const v = Number(settings?.graph?.confirmAt);
  return settings?.graph?.confirmAt !== undefined && Number.isFinite(v) && v >= CONFIRM_AT_MIN && v <= 1 ? v : CONFIRMED_AT;
}

/** What is wrong with settings graph.confirmAt, or undefined: said with the graph's problems and by `cafe ontology check`. */
export function confirmAtProblem(settings: Partial<Settings> | undefined): string | undefined {
  const raw = settings?.graph?.confirmAt;
  if (raw === undefined) return undefined;
  const v = Number(raw);
  if (typeof raw !== 'number' || !Number.isFinite(v) || v > 1) return `settings.yaml: graph.confirmAt ${JSON.stringify(raw)} is not a number from ${CONFIRM_AT_MIN} to 1, so ${CONFIRMED_AT} is used until it is fixed (refused by the build)`;
  if (v < CONFIRM_AT_MIN) return `settings.yaml: graph.confirmAt ${v} is below ${CONFIRM_AT_MIN}: nearly every AI read would count as confirmed with no Do it, so ${CONFIRMED_AT} is used until it is fixed (refused by the build)`;
  return undefined;
}
