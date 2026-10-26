/**
 * The touch bus: the one place the rest of the app tells Deep read that an idea changed. No imports, no embedder: a
 * module that writes an idea calls `touched` (or, for every file written into an idea folder, the workspace files layer
 * does it from the path) and the upkeep runner listens. With no listener a touch goes nowhere.
 */
export type TouchSource = 'import' | 'save' | 'design' | 'email' | 'roadshow' | 'handoff' | 'history' | 'file' | 'stars';
export interface Touch { root: string; ideas: string[]; source: TouchSource }

const listeners = new Set<(t: Touch) => void>();

export function touched(root: string, ideas: string[], source: TouchSource): void {
  const t: Touch = { root, ideas: [...ideas], source };
  for (const l of listeners) l(t);
}

export function onTouched(listener: (t: Touch) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const IDEA_PATH = /^(.*)[\\/]data[\\/]ideas[\\/](CAFE-\d{4}-\d{3})(?:-[^\\/]*)?[\\/](.+)$/;

/** Which idea a file path writes, and what kind of write it is; undefined when the path is not inside an idea folder. */
export function sourceOfPath(file: string): { root: string; ideaId: string; source: TouchSource } | undefined {
  const m = IDEA_PATH.exec(file);
  if (!m) return undefined;
  const rel = m[3].replace(/\\/g, '/');
  const source: TouchSource =
    rel === 'idea.yaml' ? 'save'
      : rel === 'design.yaml' || rel === 'approach.md' ? 'design'
        : rel.startsWith('emails/') ? 'email'
          : rel.startsWith('roadshow/') ? 'roadshow'
            : rel === 'csic-handoff.md' ? 'handoff'
              : rel === 'history.log' ? 'history'
                : 'file';
  return { root: m[1], ideaId: m[2], source };
}
