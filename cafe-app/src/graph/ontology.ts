export type NodeType = 'Entity' | 'Team' | 'Person' | 'Idea' | 'PainPoint' | 'Capability' | 'Tool' | 'System' | 'Round' | 'Support' | 'Outcome' | 'Beneficiary' | 'Category';
export const NODE_TYPES: NodeType[] = ['Entity', 'Team', 'Person', 'Idea', 'PainPoint', 'Capability', 'Tool', 'System', 'Round', 'Support', 'Outcome', 'Beneficiary', 'Category'];
export const NODE_LABELS: Record<NodeType, string> = {
  Entity: 'Division', Team: 'Team', Person: 'Person', Idea: 'Idea', PainPoint: 'Pain point',
  Capability: 'Capability', Tool: 'Tool', System: 'System or data', Round: 'Round', Support: 'Support requested',
  Outcome: 'Desired outcome', Beneficiary: 'Beneficiary', Category: 'Use case category',
};
export const NODE_COLOURS: Record<NodeType, string> = {
  Entity: '#6366f1', Team: '#0ea5e9', Person: '#8b5cf6', Idea: '#f97316',
  PainPoint: '#14b8a6', Capability: '#f59e0b', Tool: '#ef4444', System: '#10b981', Round: '#e7d8b1', Support: '#f472b6',
  Outcome: '#a3e635', Beneficiary: '#facc15', Category: '#93c5fd',
};
export type Relation = 'HAS_TEAM' | 'HAS_MEMBER' | 'SUBMITTED' | 'LEADS' | 'SPONSORS' | 'BUILDS' | 'RELATED' | 'REPLACES' | 'NEEDS' | 'BUILT_WITH' | 'USES_DATA' | 'IN_ROUND' | 'ASKS_FOR' | 'WANTS' | 'BENEFITS' | 'IN_CATEGORY';
export const ALLOWED: Record<Relation, [NodeType, NodeType]> = {
  HAS_TEAM: ['Entity', 'Team'], HAS_MEMBER: ['Team', 'Person'],
  SUBMITTED: ['Person', 'Idea'], LEADS: ['Person', 'Idea'], SPONSORS: ['Person', 'Idea'], BUILDS: ['Person', 'Idea'], RELATED: ['Person', 'Idea'],
  REPLACES: ['Idea', 'PainPoint'], NEEDS: ['Idea', 'Capability'],
  BUILT_WITH: ['Capability', 'Tool'], USES_DATA: ['Capability', 'System'],
  IN_ROUND: ['Idea', 'Round'], ASKS_FOR: ['Idea', 'Support'],
  WANTS: ['Idea', 'Outcome'], BENEFITS: ['Idea', 'Beneficiary'], IN_CATEGORY: ['Idea', 'Category'],
};
/** Relations the AI may propose. People links come only from the form. */
export const AI_RELATIONS: Relation[] = ['REPLACES', 'NEEDS', 'BUILT_WITH', 'USES_DATA'];
export const AI_NODE_TYPES: NodeType[] = ['PainPoint', 'Capability', 'Tool', 'System'];
export const CONFIRMED_AT = 0.7;

export interface GNode { id: string; type: NodeType; label: string; attrs?: Record<string, string | number | boolean> }
export interface GEdge {
  id: string; from: string; to: string; rel: Relation; description: string;
  source: string; confidence: number; confirmed: boolean;
}
/**
 * A change the operator asked for in the command bar, kept in graph/operator.jsonl and laid over the graph built
 * from the ideas and AI links, in file order. "undone" edits are kept for the record and do nothing.
 */
export type OperatorEdit = { id: string; at: string; status: 'active' | 'undone' } & (
  | { t: 'link'; from: string; rel: Relation; to: string }
  | { t: 'unlink'; from: string; rel: Relation; to: string }
  | { t: 'rename'; node: string; label: string }
  | { t: 'merge'; from: string; into: string }
  | { t: 'add'; node: string; type: NodeType; label: string }
  | { t: 'remove'; node: string }
);
/** Stars the operator can create or remove from the command bar. The rest come from the form, the rounds or the tool picker. */
export const OPERATOR_STARS: NodeType[] = ['PainPoint', 'Capability', 'System', 'Support', 'Outcome', 'Beneficiary', 'Category'];
/** Star types that can be merged: never ideas, rounds or the division. */
export const MERGEABLE: NodeType[] = ['Team', 'Person', 'PainPoint', 'Capability', 'System', 'Support', 'Outcome', 'Beneficiary', 'Category', 'Tool'];

export interface AiLink {
  from: string; to: string; rel: Relation; description: string; source: string; confidence: number;
  status: 'pending' | 'confirmed' | 'removed'; newNodes?: GNode[];
}

function fnv1a32(str: string): number {
  let h = 2166136261;
  for (const c of str) { h ^= c.codePointAt(0)!; h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const slug = (s: string) =>
  s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || `h${fnv1a32(s).toString(16)}`;
export function nodeId(type: NodeType, label: string): string {
  if (type === 'Idea') return `idea:${label}`;
  return `${type.toLowerCase()}:${slug(label)}`;
}
export const edgeId = (from: string, rel: Relation, to: string) => `${from}|${rel}|${to}`;

/** The Café's approved tools (app design section 6). Anything else is "not on the approved list". */
export const APPROVED_TOOLS: string[] = ['Microsoft Copilot', 'Copilot Studio', 'Power Apps', 'Dataiku', 'custom app'];
const TOOL_ALIASES: Record<string, string> = {
  'microsoft copilot': 'Microsoft Copilot', 'copilot': 'Microsoft Copilot', 'm365 copilot': 'Microsoft Copilot', 'microsoft 365 copilot': 'Microsoft Copilot',
  'copilot studio': 'Copilot Studio', 'microsoft copilot studio': 'Copilot Studio',
  'power apps': 'Power Apps', 'powerapps': 'Power Apps', 'microsoft power apps': 'Power Apps',
  'dataiku': 'Dataiku', 'dataiku dss': 'Dataiku',
  'custom app': 'custom app', 'custom application': 'custom app', 'custom code': 'custom app', 'custom-built app': 'custom app', 'bespoke app': 'custom app',
};
/** The canonical approved label for a tool name, or undefined when it is not on the list. */
export function canonicalTool(label: string): string | undefined {
  return TOOL_ALIASES[label.trim().toLowerCase().replace(/\s+/g, ' ')];
}
export const isApprovedTool = (label: string) => canonicalTool(label) !== undefined;
export const NOT_APPROVED_NOTE = ' — not on the approved list';
/**
 * Said wherever an older record's tool is shown that has since left the approved list (UiPath did). The record loads
 * as it is: the tool is never swapped for another one; the picker needs a new pick.
 */
export const noLongerApproved = (tool: string) => `${tool} is no longer on the approved list: pick another tool`;
/** The stored tool's note when it is not (or no longer) approved; undefined for an approved tool or none. */
export const retiredToolNote = (tool: string | undefined) => (tool && !isApprovedTool(tool) ? noLongerApproved(tool) : undefined);
