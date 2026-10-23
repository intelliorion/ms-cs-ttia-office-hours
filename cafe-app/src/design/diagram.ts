/**
 * The design diagram: swim lanes (the tool, people, data, outside tools), nodes and arrows, as data (never an image or
 * diagram text). The AI proposes one; the code checks it here. Pure (no files), so the server and the UI's design pack
 * read it the same way, and the pack can draw a plain one from the design itself when no AI drew one.
 */
import { pointOf } from './points';
import type { FeatureScope } from './choice';

export const LANE_KINDS = ['tool', 'person', 'data', 'outside'] as const;
export const NODE_KINDS = ['input', 'step', 'output', 'person', 'store', 'gap'] as const;
export type LaneKind = (typeof LANE_KINDS)[number];
export type NodeKind = (typeof NODE_KINDS)[number];

export const LANES_MAX = 5;
export const NODES_MAX = 16;
export const EDGES_MAX = 30;
export const LABEL_MAX = 40;
export const DETAIL_MAX = 300;
export const EDGE_LABEL_MAX = 30;

export interface DiagramLane { id: string; label: string; kind: LaneKind }
export interface DiagramNode {
  id: string; lane: string; label: string; kind: NodeKind;
  /** What this part does, in a sentence or two. */
  detail?: string;
  /** The feature it belongs to, as the feature list names it. */
  feature?: string;
  /** The design question whose answer set it (its number). */
  step?: number;
}
export interface DiagramEdge { from: string; to: string; label?: string }
export interface DiagramSpec { lanes: DiagramLane[]; nodes: DiagramNode[]; edges: DiagramEdge[] }
/** As stored in design.yaml: who drew it, when, and the design it was drawn from (out of date when that changes). */
export interface StoredDiagram { spec: DiagramSpec; by: 'ai' | 'app'; at: string; provider?: string; basis: string }

/** What a diagram is drawn from: the design, as much of it as the diagram shows. */
export interface DiagramSource {
  features: { name: string; what?: string; scope?: FeatureScope }[];
  tool?: { tool: string; fit?: { feature: string; fit: string; note?: string }[] };
  steps: { n: number; question: string; answer?: string; tag?: string }[];
  summary?: string;
  settled?: Partial<Record<string, string>>;
}

const one = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const ID = /^[A-Za-z0-9_-]{1,24}$/;

/** A short fingerprint of everything the diagram shows: when it changes, the drawing is out of date. */
export function basisOf(d: DiagramSource): string {
  const text = JSON.stringify([
    d.features.map((f) => [f.name, f.what ?? '', f.scope?.status ?? '', f.scope?.by ?? '']),
    d.tool ? [d.tool.tool, (d.tool.fit ?? []).map((x) => [x.feature, x.fit])] : null,
    d.steps.map((s) => [s.question, s.answer ?? '']), d.summary ?? '', d.settled ?? {},
  ]);
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${text.length.toString(36)}-${h.toString(36)}`;
}

export const isStale = (stored: Pick<StoredDiagram, 'basis'> | undefined, d: DiagramSource) => Boolean(stored) && stored!.basis !== basisOf(d);

export class DiagramError extends Error {}

/**
 * Checks a diagram against the design: lane and node ids unique, every node in a lane that exists, a feature only when
 * the list has it (named as the list names it), a question number only when that question exists, arrows only between
 * nodes that exist (no loops on one node, no repeats), and the size caps. Throws when nothing drawable is left.
 */
export function checkDiagram(raw: unknown, d: Pick<DiagramSource, 'features' | 'steps'>): DiagramSpec {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const lanes: DiagramLane[] = [];
  for (const l of Array.isArray(r.lanes) ? r.lanes : []) {
    const id = one(l?.id, 24); const label = one(l?.label, LABEL_MAX);
    if (!ID.test(id) || !label || !(LANE_KINDS as readonly string[]).includes(l?.kind) || lanes.some((x) => x.id === id)) continue;
    if (lanes.length < LANES_MAX) lanes.push({ id, label, kind: l.kind });
  }
  const features = new Map(d.features.map((f) => [one(f.name, 60).toLowerCase(), f.name]));
  const steps = new Set(d.steps.map((s) => s.n));
  const nodes: DiagramNode[] = [];
  for (const n of Array.isArray(r.nodes) ? r.nodes : []) {
    const id = one(n?.id, 24); const label = one(n?.label, LABEL_MAX); const lane = one(n?.lane, 24);
    if (!ID.test(id) || !label || !lanes.some((l) => l.id === lane) || !(NODE_KINDS as readonly string[]).includes(n?.kind) || nodes.some((x) => x.id === id)) continue;
    if (nodes.length >= NODES_MAX) break;
    const detail = one(n?.detail, DETAIL_MAX);
    const feature = features.get(one(n?.feature, 60).toLowerCase());
    const step = Number.isInteger(n?.step) && steps.has(n.step) ? (n.step as number) : undefined;
    nodes.push({ id, lane, label, kind: n.kind, ...(detail ? { detail } : {}), ...(feature ? { feature } : {}), ...(step ? { step } : {}) });
  }
  if (!nodes.length) throw new DiagramError('The diagram has no parts the app could use');
  const has = new Set(nodes.map((n) => n.id));
  const edges: DiagramEdge[] = [];
  for (const e of Array.isArray(r.edges) ? r.edges : []) {
    const from = one(e?.from, 24); const to = one(e?.to, 24); const label = one(e?.label, EDGE_LABEL_MAX);
    if (!has.has(from) || !has.has(to) || from === to || edges.some((x) => x.from === from && x.to === to)) continue;
    if (edges.length >= EDGES_MAX) break;
    edges.push({ from, to, ...(label ? { label } : {}) });
  }
  // A lane nobody stands in is left out.
  return { lanes: lanes.filter((l) => nodes.some((n) => n.lane === l.id)), nodes, edges };
}

/** A stored diagram made safe (older or hand-edited design.yaml); undefined when it holds nothing drawable. */
export function diagramOf(raw: unknown): StoredDiagram | undefined {
  const r = raw as Partial<StoredDiagram> | undefined;
  if (!r || typeof r !== 'object' || !r.spec) return undefined;
  const spec = r.spec as DiagramSpec;
  const lanes = Array.isArray(spec.lanes) ? spec.lanes : [];
  const nodes = Array.isArray(spec.nodes) ? spec.nodes : [];
  if (!lanes.length || !nodes.length) return undefined;
  return {
    spec: { lanes, nodes, edges: Array.isArray(spec.edges) ? spec.edges : [] },
    by: r.by === 'ai' ? 'ai' : 'app', at: String(r.at ?? ''), ...(r.provider ? { provider: String(r.provider) } : {}), basis: String(r.basis ?? ''),
  };
}

const short = (text: string | undefined, max = LABEL_MAX) => {
  const t = one(text, 400);
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};

/**
 * The plain diagram the app draws from the design itself, with no AI: the input in the data lane, each feature the
 * tool builds in the tool lane, the output, the people who use it, and any feature done with another tool in its own
 * lane. Out-of-scope features are left out. Never empty.
 */
export function plainDiagram(d: DiagramSource): DiagramSpec {
  const tool = d.tool?.tool ?? 'The tool';
  const live = d.features.filter((f) => f.scope?.status !== 'out');
  const built = live.filter((f) => !f.scope).slice(0, 9);
  const outside = live.filter((f) => f.scope?.status === 'outside').slice(0, 3);
  const stepFor = (tag: string) => d.steps.find((s) => s.tag === tag && s.answer?.trim())?.n;
  const input = pointOf(d, 'input-shape') ?? pointOf(d, 'smallest-input');
  const output = pointOf(d, 'output');
  const users = pointOf(d, 'users');
  const lanes: DiagramLane[] = [
    { id: 'data', label: 'Data', kind: 'data' },
    { id: 'tool', label: tool, kind: 'tool' },
    ...(outside.length ? [{ id: 'outside', label: 'Outside the build', kind: 'outside' as const }] : []),
    { id: 'people', label: 'People', kind: 'person' },
  ];
  const nodes: DiagramNode[] = [
    { id: 'input', lane: 'data', kind: 'input', label: 'Sample input', ...(input ? { detail: input } : { detail: 'The sample input is not settled yet.' }), ...(stepFor('input-shape') ?? stepFor('smallest-input') ? { step: stepFor('input-shape') ?? stepFor('smallest-input') } : {}) },
  ];
  built.forEach((f, i) => nodes.push({ id: `f${i + 1}`, lane: 'tool', kind: 'step', label: short(f.name), feature: f.name, ...(f.what ? { detail: f.what } : {}) }));
  if (!built.length) nodes.push({ id: 'f1', lane: 'tool', kind: 'step', label: short(tool), detail: 'No feature is listed for the tool yet.' });
  nodes.push({ id: 'output', lane: 'tool', kind: 'output', label: 'Output', ...(output ? { detail: output } : { detail: 'The output is not settled yet.' }), ...(stepFor('output') ? { step: stepFor('output') } : {}) });
  outside.forEach((f, i) => nodes.push({
    id: `o${i + 1}`, lane: 'outside', kind: 'step', label: short(f.name), feature: f.name,
    detail: [`Done with ${f.scope!.by}, outside the ${tool} build.`, f.what ?? ''].filter(Boolean).join(' '), ...(f.scope?.step ? { step: f.scope.step } : {}),
  }));
  nodes.push({ id: 'users', lane: 'people', kind: 'person', label: short(users ?? 'Who uses it', 30), ...(users ? { detail: users } : { detail: 'Who uses it is not settled yet.' }), ...(stepFor('users') ? { step: stepFor('users') } : {}) });
  const steps = nodes.filter((n) => n.lane === 'tool' && n.kind === 'step');
  const edges: DiagramEdge[] = [
    ...steps.map((n) => ({ from: 'input', to: n.id })),
    ...steps.map((n) => ({ from: n.id, to: 'output' })),
    { from: 'output', to: 'users', label: 'reads' },
    ...outside.map((_, i) => ({ from: 'output', to: `o${i + 1}` })),
  ];
  return { lanes, nodes, edges: edges.slice(0, EDGES_MAX) };
}
