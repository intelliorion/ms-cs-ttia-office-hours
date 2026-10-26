import YAML from 'yaml';
import { paths } from '../workspace/paths';
import { readText } from '../workspace/files';
import { BUILTIN_ONTOLOGY, applyOntology, currentOntology, resetOntology, type Ontology } from './ontology';

/** rules/ontology.yaml as written, or undefined when it is absent or unreadable (the built-in ontology then applies). */
export async function readOntologyFile(root: string): Promise<Ontology | undefined> {
  const text = await readText(paths(root).ontology);
  if (text === undefined) return undefined;
  try {
    const v = YAML.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Ontology) : undefined;
  } catch { return undefined; }
}

/** Applies the workspace's ontology file over the built-in one (in place, for every module), and says what it could not take. */
export async function loadOntology(root: string): Promise<{ ontology: Ontology; problems: string[] }> {
  resetOntology();
  const file = await readOntologyFile(root);
  const problems = file ? applyOntology(file) : [];
  return { ontology: currentOntology(), problems };
}

/** What init writes: the built-in ontology, for the operator to read and adjust. */
export const seedOntology = (): Ontology => JSON.parse(JSON.stringify(BUILTIN_ONTOLOGY));
