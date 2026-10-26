import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

/**
 * Deep read's second, local model: a small sentence-embedding model run in this process on the CPU. The AI connector
 * is untouched; nothing here talks to it. The library is loaded only when a real embedding is first needed, so
 * `npm start` and the tests never load it, and the model is downloaded once, on the first Run, into the cache folder.
 */
export interface Embedder {
  /** Recorded in the index, so an index built with another model is known to be. */
  name: string;
  dims: number;
  embed(texts: string[]): Promise<number[][]>;
}

export const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const FAKE_DIMS = 256;

/** Where the model lives: CAFE_MODEL_DIR, or ~/.cafe-ai/models. Outside the workspace: data/ stays deletable. */
export const modelDir = (env: NodeJS.ProcessEnv = process.env): string => env.CAFE_MODEL_DIR?.trim() || path.join(os.homedir(), '.cafe-ai', 'models');

/** Is the model already in the cache folder (so a Run needs no download)? */
export async function modelCached(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const dir = path.join(modelDir(env), ...EMBED_MODEL.split('/'));
  try { return (await fs.readdir(path.join(dir, 'onnx'))).some((f) => f.endsWith('.onnx')); } catch { return false; }
}

export const fakeEnabled = (env: NodeJS.ProcessEnv = process.env) => env.CAFE_EMBED_FAKE === '1';

function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function normalise(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n ? v.map((x) => x / n) : v;
}

export const cosine = (a: number[], b: number[]): number => {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
};

/** The mean of unit vectors, normalised again: an idea's "centre" over its chunks. */
export function meanVector(vs: number[][]): number[] {
  if (!vs.length) return [];
  const out = new Array<number>(vs[0].length).fill(0);
  for (const v of vs) for (let i = 0; i < out.length; i++) out[i] += v[i];
  return normalise(out.map((x) => x / vs.length));
}

const WORD = /[\p{L}\p{N}]+/gu;

/** One text as a bag of hashed words: deterministic, no download; shared words give a high cosine. */
export function fakeVector(text: string, dims = FAKE_DIMS): number[] {
  const v = new Array<number>(dims).fill(0);
  for (const w of text.toLowerCase().match(WORD) ?? []) v[fnv1a(w) % dims] += 1;
  return normalise(v);
}

/** The test hook: present only with CAFE_EMBED_FAKE=1, like CAFE_AI_FAKE. */
export function fakeEmbedder(): Embedder {
  return { name: 'fake', dims: FAKE_DIMS, embed: async (texts) => texts.map((t) => fakeVector(t)) };
}

/**
 * The real embedder. The library is imported here and nowhere else, dynamically, so nothing loads until the first
 * call; the pipeline is built once and kept.
 */
export function realEmbedder(env: NodeJS.ProcessEnv = process.env): Embedder {
  let pipe: Promise<(texts: string[], opts: Record<string, unknown>) => Promise<{ tolist(): number[][] }>> | undefined;
  const load = () => {
    pipe ??= (async () => {
      const lib = await import('@huggingface/transformers');
      lib.env.cacheDir = modelDir(env);
      const p = await lib.pipeline('feature-extraction', EMBED_MODEL, { dtype: 'q8' });
      return p as unknown as (texts: string[], opts: Record<string, unknown>) => Promise<{ tolist(): number[][] }>;
    })();
    return pipe;
  };
  return {
    name: EMBED_MODEL, dims: 384,
    async embed(texts) {
      if (!texts.length) return [];
      const run = await load();
      const out = await run(texts, { pooling: 'mean', normalize: true });
      return out.tolist().map((v) => v.map((x) => Math.round(x * 1e5) / 1e5));
    },
  };
}

let shared: Embedder | undefined;
/** The embedder this process uses: the fake under CAFE_EMBED_FAKE=1, else the real one (built once). */
export function getEmbedder(env: NodeJS.ProcessEnv = process.env): Embedder {
  if (fakeEnabled(env)) return fakeEmbedder();
  shared ??= realEmbedder(env);
  return shared;
}
/** The name the index would be built with now, without loading anything. */
export const embedderName = (env: NodeJS.ProcessEnv = process.env) => (fakeEnabled(env) ? 'fake' : EMBED_MODEL);
