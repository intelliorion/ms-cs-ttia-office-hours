import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_DIR = fileURLToPath(new URL('../../', import.meta.url));
export const BUNDLED_TEMPLATES = path.join(APP_DIR, 'templates');

/**
 * A workspace keeps the operator's setup apart from the Café's data:
 *   data/       everything the Café made or was given (ideas, rounds, the inbox, the graph, chat, exports).
 *               Safe to delete, all of it or any part, even while the app runs: it starts again empty.
 *   rules/      settings.yaml and stages.yaml: the operator's configuration.
 *   templates/  the email templates (any missing one is copied back at start).
 * Every stored reference to a data file (an email's key, an import's file) is relative to data/.
 */
export function paths(root: string) {
  const data = path.join(root, 'data');
  return {
    root,
    data,
    rounds: path.join(data, 'rounds'),
    inbox: path.join(data, 'inbox'),
    held: path.join(data, 'inbox', 'held'),
    ideas: path.join(data, 'ideas'),
    cohorts: path.join(data, 'cohorts'),
    roadshows: path.join(data, 'roadshows'),
    graph: path.join(data, 'graph'),
    chat: path.join(data, 'chat'),
    exports: path.join(data, 'exports'),
    /** Deep read: the reading index (index.jsonl, state.json, labels.jsonl). Rebuilt by a Run; safe to delete. */
    memory: path.join(data, 'memory'),
    templates: path.join(root, 'templates'),
    rules: path.join(root, 'rules'),
    settings: path.join(root, 'rules', 'settings.yaml'),
    stages: path.join(root, 'rules', 'stages.yaml'),
    /** The knowledge graph's rules: stable identities with aliases, the inference rules, the ontology. */
    entities: path.join(root, 'rules', 'entities.yaml'),
    inference: path.join(root, 'rules', 'inference.yaml'),
    ontology: path.join(root, 'rules', 'ontology.yaml'),
  };
}

/** The folders under data/, by name: what an older workspace kept at its top level. */
export const DATA_FOLDERS = ['ideas', 'rounds', 'inbox', 'graph', 'chat', 'cohorts', 'roadshows', 'exports', 'memory'] as const;

/** A data file as a stored reference: relative to data/, forward slashes ("ideas/CAFE-2026-001-x/emails/001-E2.md"). */
export const dataKey = (root: string, file: string) => path.relative(paths(root).data, file).split(path.sep).join('/');
/** A stored reference back to the file. */
export const fromDataKey = (root: string, key: string) => path.join(paths(root).data, ...key.split('/'));
