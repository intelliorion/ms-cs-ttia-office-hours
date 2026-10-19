import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_DIR = fileURLToPath(new URL('../../', import.meta.url));
export const BUNDLED_TEMPLATES = path.join(APP_DIR, 'templates');

export function paths(root: string) {
  return {
    root,
    rounds: path.join(root, 'rounds'),
    inbox: path.join(root, 'inbox'),
    held: path.join(root, 'inbox', 'held'),
    ideas: path.join(root, 'ideas'),
    cohorts: path.join(root, 'cohorts'),
    roadshows: path.join(root, 'roadshows'),
    graph: path.join(root, 'graph'),
    templates: path.join(root, 'templates'),
    rules: path.join(root, 'rules'),
    exports: path.join(root, 'exports'),
    skills: path.join(root, 'skills'),
    settings: path.join(root, 'rules', 'settings.yaml'),
    stages: path.join(root, 'rules', 'stages.yaml'),
  };
}
