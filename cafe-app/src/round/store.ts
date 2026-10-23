import { promises as fs } from 'node:fs';
import path from 'node:path';
import { paths } from '../workspace/paths';
import { readYaml, writeYaml, appendHistory } from '../workspace/files';
import { loadIdea, saveIdea, ideaDir } from '../ideas/store';
import type { Idea } from '../ideas/idea';
import type { Clock } from '../clock';
import { DEFAULT_SETTINGS, ROUND_FIELDS, SETTING_FIELDS, defaultRoundName, type Round, type Settings } from './round';
export { defaultRoundName } from './round';

/** What the operator is told when something needs a round and there is none. */
export const NO_ROUND = 'Create a round first (Rounds button)';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ROUND_FOLDER = /^ROUND-[A-Za-z0-9._-]+$/;
const NUMBERED = /^ROUND-(\d{3})$/;

const roundFile = (root: string, id: string) => path.join(paths(root).rounds, id, 'round.yaml');

async function roundFolders(root: string): Promise<string[]> {
  const entries = await fs.readdir(paths(root).rounds, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory() && ROUND_FOLDER.test(e.name)).map((e) => e.name);
}

async function hasRound(root: string, id: string): Promise<boolean> {
  return ROUND_FOLDER.test(id) && (await roundFolders(root)).includes(id);
}

function asRound(id: string, raw: Partial<Round>): Round {
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id;
  const created = typeof raw.created === 'string' ? raw.created : '';
  return { ...raw, id, name, created };
}

export interface RoundProblem { folder: string; message: string }

/**
 * Every round folder, newest first by the day it was made, then by id. A round without a day sorts last.
 * A round.yaml that cannot be read is left out and reported, so one bad file never hides the rest.
 */
export async function listRoundsChecked(root: string): Promise<{ rounds: Round[]; problems: RoundProblem[] }> {
  const rounds: Round[] = [];
  const problems: RoundProblem[] = [];
  for (const id of await roundFolders(root)) {
    try {
      rounds.push(asRound(id, (await readYaml<Partial<Round>>(roundFile(root, id))) ?? {}));
    } catch (e) {
      problems.push({ folder: id, message: (e as Error).message });
    }
  }
  rounds.sort((a, b) => b.created.localeCompare(a.created) || b.id.localeCompare(a.id));
  return { rounds, problems };
}

export async function listRounds(root: string): Promise<Round[]> {
  return (await listRoundsChecked(root)).rounds;
}

/** The newest round, or null when the operator has not made one yet. */
export async function currentRoundId(root: string): Promise<string | null> {
  return (await listRounds(root))[0]?.id ?? null;
}

/** Makes the next numbered round. Only ROUND-NNN folders count for the number. */
export async function createRound(root: string, name: string, clock: Clock): Promise<Round> {
  const highest = Math.max(0, ...(await roundFolders(root)).map((n) => Number(NUMBERED.exec(n)?.[1] ?? 0)));
  const created = clock();
  const existing = await listRounds(root);
  const taken = new Set(existing.map((r) => r.name.trim().toLowerCase()));
  // No name given: the default, numbered on when it is taken ("2026 Q4 (2)").
  let auto = defaultRoundName(created);
  for (let n = 2; taken.has(auto.toLowerCase()); n++) auto = `${defaultRoundName(created)} (${n})`;
  const round: Round = { id: `ROUND-${String(highest + 1).padStart(3, '0')}`, name: String(name ?? '').trim() || auto, created };
  // Two rounds with one name would read the same on every chip and star.
  const same = existing.find((r) => r.name.trim().toLowerCase() === round.name.toLowerCase());
  if (same) throw new Error(`There is already a round called ${same.name} (${same.id}); give this one another name`);
  await writeYaml(roundFile(root, round.id), round);
  return round;
}

export async function loadRound(root: string, id: string): Promise<Round> {
  if (!(await hasRound(root, id))) throw new Error(`Unknown round ${id}`);
  return asRound(id, (await readYaml<Partial<Round>>(roundFile(root, id))) ?? {});
}

export async function saveRound(root: string, id: string, patch: Record<string, unknown>): Promise<Round> {
  const round = await loadRound(root, id);
  const next: Round = { ...round };
  for (const [key, label] of ROUND_FIELDS) {
    if (!(key in patch)) continue;
    const value = String(patch[key] ?? '').trim();
    if (value && (!DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))) {
      throw new Error(`${label} must be a date (YYYY-MM-DD)`);
    }
    if (value) next[key] = value;
    else delete next[key];
  }
  await writeYaml(roundFile(root, round.id), next);
  return next;
}

/**
 * Puts several ideas in one round, all or nothing: the round and every idea are checked before anything is written.
 * Returns how many ideas actually changed round.
 */
export async function assignIdeas(root: string, roundId: string, ideaIds: string[], clock: Clock): Promise<number> {
  await loadRound(root, roundId);
  const ideas = await Promise.all([...new Set(ideaIds)].map((id) => loadIdea(root, id)));
  let changed = 0;
  for (const idea of ideas) {
    if (idea.round === roundId) continue;
    await setIdeaRound(root, idea.id, roundId, clock);
    changed++;
  }
  return changed;
}

/** Puts an idea in a round, or takes it out with ''. The stage never changes; the change is logged. */
export async function setIdeaRound(root: string, ideaId: string, round: string, clock: Clock): Promise<Idea> {
  const target = String(round ?? '').trim();
  const name = target ? (await loadRound(root, target)).name : '';
  const idea = await loadIdea(root, ideaId);
  if (idea.round === target) return idea;
  const next: Idea = { ...idea, round: target };
  await saveIdea(root, next);
  await appendHistory(await ideaDir(root, ideaId), {
    at: clock(), action: 'round', by: 'operator', detail: target ? `round set to ${name}` : 'round cleared',
  });
  return next;
}

export async function loadSettings(root: string): Promise<Settings> {
  // An older settings.yaml may still carry capacity limits; the app no longer has them, so they are left out (and
  // dropped from the file at the next save).
  const { capacity: _gone, ...raw } = ((await readYaml<Partial<Settings> & { capacity?: unknown }>(paths(root).settings)) ?? {});
  return { ...DEFAULT_SETTINGS, ...raw };
}

export async function saveSettings(root: string, patch: Record<string, unknown>): Promise<Settings> {
  const settings = await loadSettings(root);
  for (const [key] of SETTING_FIELDS) {
    if (!(key in patch)) continue;
    const value = String(patch[key] ?? '').trim();
    if (value) settings[key] = value;
    else delete settings[key];
  }
  await writeYaml(paths(root).settings, settings);
  return settings;
}
