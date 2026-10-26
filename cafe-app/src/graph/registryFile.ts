import YAML from 'yaml';
import { paths } from '../workspace/paths';
import { readText } from '../workspace/files';
import { readEdits } from './operator';
import { defaultEntries, makeRegistry, setCurrentRegistry, type Registry, type RegistryEntries } from './registry';

/** rules/entities.yaml as written, or undefined when it is absent or unreadable (the built-in tools then apply). */
export async function readEntities(root: string): Promise<RegistryEntries | undefined> {
  const text = await readText(paths(root).entities);
  if (text === undefined) return undefined;
  try {
    const v = YAML.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as RegistryEntries) : undefined;
  } catch { return undefined; }
}

/** The workspace's registry: the entities file plus the alias edits. It becomes the one `canonicalTool` reads. */
export async function loadRegistry(root: string): Promise<Registry> {
  const r = makeRegistry((await readEntities(root)) ?? defaultEntries(), await readEdits(root));
  setCurrentRegistry(r);
  return r;
}
