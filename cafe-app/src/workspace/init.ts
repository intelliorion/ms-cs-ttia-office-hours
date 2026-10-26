import { promises as fs } from 'node:fs';
import path from 'node:path';
import { paths, BUNDLED_TEMPLATES, DATA_FOLDERS } from './paths';
import { writeFileAtomic, writeYaml } from './files';
import { DEFAULT_STEPS } from '../rules/stages';
import { DEFAULT_SETTINGS } from '../round/round';
import { seedEntities } from '../graph/registry';

export const WORKSPACE_README = `Creators' Café workspace

data/        The Café's data: ideas, rounds, the inbox, the knowledge graph, chat, exports.
             Safe to delete, all of it or any part, even while the app runs: the Café starts again empty.
rules/       Your configuration: settings.yaml (your name, links, the AI choice), stages.yaml, and the knowledge
             graph's entities.yaml (stable names and their aliases). Keep it.
templates/   The email templates. Keep them; any that goes missing is copied back the next time the app starts.
`;

const exists = (f: string) => fs.access(f).then(() => true, () => false);

/** A folder moved in one go; on Windows a folder in use (antivirus, Explorer) can refuse for a moment, so it retries. */
async function moveDir(from: string, to: string): Promise<void> {
  for (let i = 0; ; i++) {
    try { await fs.rename(from, to); return; } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EXDEV') { await fs.cp(from, to, { recursive: true, errorOnExist: true }); await fs.rm(from, { recursive: true, force: true }); return; }
      if ((code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') && i < 15) { await new Promise((r) => setTimeout(r, 200)); continue; }
      throw e;
    }
  }
}

/**
 * An older workspace kept its data folders at the top: each moves into data/ once. Stored references are relative to
 * data/, so nothing else changes. A folder that is in both places is left alone and named, never merged or overwritten.
 */
export async function moveOldData(root: string): Promise<{ moved: string[]; left: string[] }> {
  const p = paths(root);
  const moved: string[] = []; const left: string[] = [];
  for (const name of DATA_FOLDERS) {
    const old = path.join(root, name);
    if (!(await exists(old))) continue;
    const now = path.join(p.data, name);
    if (await exists(now)) { left.push(name); continue; }
    await fs.mkdir(p.data, { recursive: true });
    await moveDir(old, now);
    moved.push(name);
  }
  // The skills folder was never used; an empty one goes.
  await fs.rmdir(path.join(root, 'skills')).catch(() => undefined);
  return { moved, left };
}

/** Creates the folders, rules and templates. It never makes a round: the operator does that. */
export async function initWorkspace(root: string): Promise<{ created: string[]; moved: string[]; left: string[] }> {
  const p = paths(root);
  const created: string[] = [];
  const { moved, left } = await moveOldData(root);
  for (const dir of [p.data, p.rounds, p.inbox, p.held, p.ideas, p.cohorts, p.roadshows, p.graph, p.chat, p.exports, p.memory, p.templates, p.rules]) {
    await fs.mkdir(dir, { recursive: true });
  }
  if (!(await exists(path.join(root, 'README.txt')))) {
    await writeFileAtomic(path.join(root, 'README.txt'), WORKSPACE_README);
    created.push('README.txt');
  }
  // Only a missing file is created: one that exists (even empty, or mid-write by an editor) is never overwritten,
  // so a start-up can't wipe the operator's settings or steps.
  const missing = (f: string) => fs.access(f).then(() => false, () => true);
  if (await missing(p.stages)) {
    await writeYaml(p.stages, { steps: DEFAULT_STEPS });
    created.push('rules/stages.yaml');
  }
  if (await missing(p.settings)) {
    await writeYaml(p.settings, DEFAULT_SETTINGS);
    created.push('rules/settings.yaml');
  }
  if (await missing(p.entities)) {
    await writeYaml(p.entities, seedEntities());
    created.push('rules/entities.yaml');
  }
  for (const name of (await fs.readdir(BUNDLED_TEMPLATES)).filter((n) => n.endsWith('.md'))) {
    try {
      await fs.copyFile(path.join(BUNDLED_TEMPLATES, name), path.join(p.templates, name), fs.constants.COPYFILE_EXCL);
      created.push(`templates/${name}`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
  return { created, moved, left };
}
