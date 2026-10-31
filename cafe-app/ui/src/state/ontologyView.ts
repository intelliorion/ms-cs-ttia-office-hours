import { BUILTIN_SCHEMA, compileOntology, type NodeType } from '../../../src/graph/ontology';

/**
 * The ontology as this page shows it: the kinds' labels, colours and descriptions, from the workspace's
 * rules/ontology.yaml as /api/state sends it. The server compiles one ontology per build and never changes a shared
 * table; the page is one workspace's, so it keeps its own copy here and refreshes it in place when the state arrives.
 */
export const NODE_TYPES: NodeType[] = [...BUILTIN_SCHEMA.types];
export const NODE_LABELS: Record<NodeType, string> = { ...BUILTIN_SCHEMA.labels } as Record<NodeType, string>;
export const NODE_COLOURS: Record<NodeType, string> = { ...BUILTIN_SCHEMA.colours } as Record<NodeType, string>;
export const NODE_DESCRIPTIONS: Record<NodeType, string> = { ...BUILTIN_SCHEMA.descriptions } as Record<NodeType, string>;

/** Takes the workspace's ontology (the file as the server compiled it) into the page's tables; returns what it could not take. */
export function applyOntology(file: unknown): string[] {
  const { schema, problems } = compileOntology(file);
  NODE_TYPES.splice(0, NODE_TYPES.length, ...schema.types);
  for (const t of Object.keys(NODE_LABELS)) if (!schema.types.includes(t as NodeType)) { delete (NODE_LABELS as Record<string, string>)[t]; delete (NODE_COLOURS as Record<string, string>)[t]; delete (NODE_DESCRIPTIONS as Record<string, string>)[t]; }
  Object.assign(NODE_LABELS, schema.labels); Object.assign(NODE_COLOURS, schema.colours); Object.assign(NODE_DESCRIPTIONS, schema.descriptions);
  return problems;
}
