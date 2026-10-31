import YAML from 'yaml';
import { paths } from '../workspace/paths';
import { readText } from '../workspace/files';
import { BUILTIN_ONTOLOGY, applyOntology, currentOntology, resetOntology, type Ontology } from './ontology';

/** rules/ontology.yaml as written, or undefined when it is absent or unreadable (the built-in ontology then applies). */
export async function readOntologyFile(root: string): Promise<Ontology | undefined> {
  return (await readOntologyText(root)).file;
}

/** The file and, when it is there but cannot be taken, why (a YAML error, not a mapping). */
async function readOntologyText(root: string): Promise<{ file?: Ontology; problem?: string }> {
  const text = await readText(paths(root).ontology);
  if (text === undefined) return {};
  try {
    const v = YAML.parse(text);
    if (v === null || v === undefined) return {};
    return v && typeof v === 'object' && !Array.isArray(v) ? { file: v as Ontology } : { problem: 'ontology.yaml is not a mapping of nodes and relations: the built-in ontology applies until it is fixed' };
  } catch (e) {
    return { problem: `ontology.yaml could not be read (${String((e as Error).message ?? e).split('\n')[0]}): the built-in ontology applies until it is fixed` };
  }
}

/** Applies the workspace's ontology file over the built-in one (in place, for every module), and says what it could not take. */
export async function loadOntology(root: string): Promise<{ ontology: Ontology; problems: string[] }> {
  resetOntology();
  const { file, problem } = await readOntologyText(root);
  const problems = file ? applyOntology(file) : problem ? [problem] : [];
  return { ontology: currentOntology(), problems };
}

/** What init writes: the built-in ontology, for the operator to read and adjust. */
export const seedOntology = (): Ontology => JSON.parse(JSON.stringify(BUILTIN_ONTOLOGY));
