import type { GNode, NodeType } from '../graph/ontology';
import type { Query, QueryMemory, QueryStep } from '../command/query';
import { cosine, embedderName, getEmbedder, type Embedder } from './embed';
import { groupByIdea, ideaCentroids, indexAvailable, labelVectors, nearestChunks, readIndex, type Hit, type IndexRow } from './index';

/**
 * What the index feeds, prepared ahead of the synchronous callers: every text a query will need is embedded in one
 * call here, so runQuery and planAiLinks stay plain functions. With no index (or one built with another model) each
 * helper returns undefined and the caller behaves exactly as it did before Deep read existed.
 */

/** Cosine cut-offs. The fake's word-hash vectors score lower than the model's, so each has its own. */
export interface Thresholds { search: number; ideas: number; label: number; reuse: number; near: number }
export const THRESHOLDS: Record<'fake' | 'model', Thresholds> = {
  model: { search: 0.25, ideas: 0.30, label: 0.45, reuse: 0.85, near: 0.70 },
  fake: { search: 0.10, ideas: 0.25, label: 0.35, reuse: 0.80, near: 0.60 },
};
export const thresholdsFor = (env = process.env): Thresholds => (embedderName(env) === 'fake' ? THRESHOLDS.fake : THRESHOLDS.model);

const matchTexts = (steps: QueryStep[]): string[] => steps.flatMap((s) => [...(s.match ? [s.match] : []), ...matchTexts(s.with ?? [])]);

/** Everything a query needs from the index, or undefined when there is no index to use. */
export async function prepareMemory(root: string, query: Query, graph: { nodes: GNode[] }, env = process.env): Promise<QueryMemory | undefined> {
  if (!(await indexAvailable(root, env))) return undefined;
  const embedder = getEmbedder(env);
  const texts = [...new Set(matchTexts(query.steps))];
  const vectors = await embedder.embed(texts);
  const byText = new Map(texts.map((t, i) => [t, vectors[i]]));
  const rows = await readIndex(root);
  const labels = await labelVectors(root, embedder, graph.nodes);
  return queryMemory(rows, byText, labels, graph.nodes, thresholdsFor(env));
}

/** The synchronous lookups over vectors already in hand (tests build one directly). */
export function queryMemory(rows: IndexRow[], byText: Map<string, number[]>, labels: Map<string, number[]>, nodes: GNode[], t: Thresholds): QueryMemory {
  const centres = ideaCentroids(rows);
  const typeOf = new Map(nodes.map((n) => [n.id, n.type]));
  const vectorOf = (text: string) => byText.get(text);
  const nearestIdeas = (v: number[], limit: number, except?: string) =>
    [...centres.entries()].filter(([id]) => id !== except).map(([id, c]) => ({ id: `idea:${id}`, score: cosine(c, v) }))
      .filter((x) => x.score >= t.ideas).sort((a, b) => b.score - a.score).slice(0, limit);
  const nearestLabels = (v: number[], type: NodeType | undefined, limit: number, except?: string) =>
    [...labels.entries()].filter(([id]) => id !== except && (!type || typeOf.get(id) === type)).map(([id, lv]) => ({ id, score: cosine(lv, v) }))
      .filter((x) => x.score >= t.label).sort((a, b) => b.score - a.score).slice(0, limit);
  return {
    search(text, limit) {
      const v = vectorOf(text); if (!v) return [];
      return groupByIdea(nearestChunks(rows, v, limit * 3, t.search)).slice(0, limit);
    },
    similar(from, type, limit) {
      if ('text' in from) {
        const v = vectorOf(from.text); if (!v) return [];
        return type && type !== 'Idea' ? nearestLabels(v, type, limit) : nearestIdeas(v, limit);
      }
      const n = from.node;
      if (n.type === 'Idea') { const c = centres.get(n.id.slice(5)); return c ? nearestIdeas(c, limit, n.id.slice(5)) : []; }
      const lv = labels.get(n.id); if (!lv) return [];
      return nearestLabels(lv, type ?? n.type, limit, n.id);
    },
    nearestLabels(text, type, limit) {
      const v = vectorOf(text); if (!v) return [];
      return nearestLabels(v, type, limit);
    },
  };
}

export interface RankedIdea { id: string; score: number; section: string }

/** The ideas panel's "by meaning": ideas ranked by their nearest passage to the text. Null with no index. */
export async function rankIdeas(root: string, text: string, limit = 12, env = process.env): Promise<RankedIdea[] | null> {
  const q = text.trim();
  if (!q || !(await indexAvailable(root, env))) return null;
  const [v] = await getEmbedder(env).embed([q]);
  const rows = await readIndex(root);
  return groupByIdea(nearestChunks(rows, v, limit * 3, thresholdsFor(env).ideas)).slice(0, limit)
    .map((g) => ({ id: g.ideaId, score: Math.round(g.score * 100) / 100, section: g.hits[0].section }));
}

export type NearestStar = (type: NodeType, label: string) => { node: GNode; score: number } | undefined;

/**
 * For extraction: the nearest existing star of a type to a proposed label, by label vector. Prepared once per
 * extraction (the proposed labels embedded together); undefined with no index, so planAiLinks runs as before.
 */
export async function starMatcher(root: string, labels: string[], nodes: GNode[], env = process.env): Promise<{ nearest: NearestStar; thresholds: Thresholds } | undefined> {
  if (!labels.length || !(await indexAvailable(root, env))) return undefined;
  const embedder: Embedder = getEmbedder(env);
  const uniq = [...new Set(labels.map((l) => l.trim()).filter(Boolean))];
  const vectors = await embedder.embed(uniq);
  const byLabel = new Map(uniq.map((l, i) => [l, vectors[i]]));
  const stars = nodes.filter((n) => n.type !== 'Idea' && n.type !== 'Person');
  const starVectors = await labelVectors(root, embedder, stars);
  const thresholds = thresholdsFor(env);
  const nearest: NearestStar = (type, label) => {
    const v = byLabel.get(label.trim()); if (!v) return undefined;
    let best: { node: GNode; score: number } | undefined;
    for (const n of stars) {
      if (n.type !== type) continue;
      const sv = starVectors.get(n.id); if (!sv) continue;
      const score = cosine(sv, v);
      if (!best || score > best.score) best = { node: n, score };
    }
    return best && best.score >= thresholds.near ? best : undefined;
  };
  return { nearest, thresholds };
}

export type { Hit };
