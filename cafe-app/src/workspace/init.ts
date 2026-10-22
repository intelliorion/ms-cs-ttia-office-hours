import { promises as fs } from 'node:fs';
import path from 'node:path';
import { paths, BUNDLED_TEMPLATES } from './paths';
import { readYaml, writeYaml } from './files';
import { DEFAULT_STEPS } from '../rules/stages';
import { DEFAULT_SETTINGS } from '../round/round';
import type { Clock } from '../clock';

/** Creates the folders, rules and templates. It never makes a round: the operator does that. */
export async function initWorkspace(root: string, _clock: Clock): Promise<{ created: string[] }> {
  const p = paths(root);
  const created: string[] = [];
  for (const dir of [p.rounds, p.inbox, p.held, p.ideas, p.cohorts, p.roadshows, p.graph, p.templates, p.rules, p.exports, p.skills]) {
    await fs.mkdir(dir, { recursive: true });
  }
  if (!(await readYaml(p.stages))) {
    await writeYaml(p.stages, { steps: DEFAULT_STEPS });
    created.push('rules/stages.yaml');
  }
  if (!(await readYaml(p.settings))) {
    await writeYaml(p.settings, DEFAULT_SETTINGS);
    created.push('rules/settings.yaml');
  }
  for (const name of (await fs.readdir(BUNDLED_TEMPLATES)).filter((n) => n.endsWith('.md'))) {
    try {
      await fs.copyFile(path.join(BUNDLED_TEMPLATES, name), path.join(p.templates, name), fs.constants.COPYFILE_EXCL);
      created.push(`templates/${name}`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
  return { created };
}
