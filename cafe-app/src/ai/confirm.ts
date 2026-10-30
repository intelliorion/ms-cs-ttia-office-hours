import { CONFIRMED_AT } from '../graph/ontology';
import type { Settings } from '../round/round';

/**
 * The confidence at or above which an AI link is stored as confirmed; below it the link waits for the operator's
 * Do it. rules/settings.yaml `graph: { confirmAt: 0.7 }` sets it (0 to 1); the default is CONFIRMED_AT, 0.7.
 */
export function confirmAt(settings: Partial<Settings> | undefined): number {
  const v = Number(settings?.graph?.confirmAt);
  return settings?.graph?.confirmAt !== undefined && Number.isFinite(v) && v >= 0 && v <= 1 ? v : CONFIRMED_AT;
}
