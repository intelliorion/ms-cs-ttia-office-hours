import { promises as fs } from 'node:fs';
import path from 'node:path';
import { paths } from '../workspace/paths';
import { readYaml, writeYaml } from '../workspace/files';
import { DEFAULT_SETTINGS, ROUND_FIELDS, SETTING_FIELDS, type Round, type Settings } from './round';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function currentRoundId(root: string): Promise<string> {
  const names = (await fs.readdir(paths(root).rounds).catch(() => [] as string[]))
    .filter((n) => n.startsWith('ROUND-'))
    .sort();
  const last = names.at(-1);
  if (!last) throw new Error('No round yet. Run "cafe init" first.');
  return last;
}

export async function loadRound(root: string, id?: string): Promise<Round> {
  const rid = id ?? (await currentRoundId(root));
  const raw = (await readYaml<Partial<Round>>(path.join(paths(root).rounds, rid, 'round.yaml'))) ?? {};
  return { ...raw, id: rid };
}

export async function saveRound(root: string, patch: Record<string, unknown>): Promise<Round> {
  const round = await loadRound(root);
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
  await writeYaml(path.join(paths(root).rounds, round.id, 'round.yaml'), next);
  return next;
}

export async function loadSettings(root: string): Promise<Settings> {
  const raw = (await readYaml<Partial<Settings>>(paths(root).settings)) ?? {};
  return { ...DEFAULT_SETTINGS, ...raw, capacity: { ...DEFAULT_SETTINGS.capacity, ...(raw.capacity ?? {}) } };
}

export async function saveSettings(root: string, patch: Record<string, unknown>): Promise<Settings> {
  const settings = await loadSettings(root);
  for (const [key] of SETTING_FIELDS) {
    if (!(key in patch)) continue;
    const value = String(patch[key] ?? '').trim();
    if (value) settings[key] = value;
    else delete settings[key];
  }
  const capacity = patch.capacity as Record<string, unknown> | undefined;
  if (capacity) {
    for (const key of ['ideasPerRound', 'sessionsPerWeek'] as const) {
      if (!(key in capacity)) continue;
      const n = Number(capacity[key]);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(`${key === 'ideasPerRound' ? 'Ideas per round' : 'Sessions per week'} must be a whole number of 1 or more`);
      }
      settings.capacity[key] = n;
    }
  }
  await writeYaml(paths(root).settings, settings);
  return settings;
}
