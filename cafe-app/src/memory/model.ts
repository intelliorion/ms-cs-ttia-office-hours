import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { unzipSync, zipSync } from 'fflate';

/**
 * Deep read's model on disk, and the three ways it gets there when the firm blocks the Hugging Face hub: a firm
 * mirror (an internal store that serves the same folder layout over HTTPS), a manual import (a folder or a zip copied
 * in by hand) and an export zip (one person with access hands it to the others). The library is never imported here;
 * embed.ts applies `libraryEnv` to it. Nothing here contacts any host.
 */
export const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';

/** The files the q8 load fetches, relative to the model folder: what a mirror must serve and an import must hold. */
export const MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'] as const;
/** The app's record of where the files came from, written beside them by an import or a download. */
export const SOURCE_FILE = 'source.json';

/** Where the model lives: CAFE_MODEL_DIR, or ~/.cafe-ai/models. Outside the workspace: data/ stays deletable. */
export const modelDir = (env: NodeJS.ProcessEnv = process.env): string => env.CAFE_MODEL_DIR?.trim() || path.join(os.homedir(), '.cafe-ai', 'models');
/** The model's own folder inside it: <dir>/Xenova/all-MiniLM-L6-v2, the layout the library's file cache uses. */
export const modelFolder = (env: NodeJS.ProcessEnv = process.env): string => path.join(modelDir(env), ...EMBED_MODEL.split('/'));

/** The settings keys under deepRead in rules/settings.yaml; the environment variables of the same meaning win. */
export interface ModelSettings { modelMirror?: string; modelMirrorToken?: string; offline?: boolean }

export interface ModelOptions {
  dir: string;
  /** The base URL of the firm's mirror, with one trailing slash; absent means the hub. */
  mirror?: string;
  /** A bearer token the mirror wants, sent as Authorization on every request to it. */
  token?: string;
  /** Never contact any host. */
  offline: boolean;
}

const onFlag = (v: unknown): boolean => v === true || v === 1 || /^(1|true|yes|on)$/i.test(String(v ?? '').trim());

/** The model options: the environment first (CAFE_MODEL_MIRROR, CAFE_MODEL_MIRROR_TOKEN, CAFE_MODEL_OFFLINE), then the workspace settings. */
export function modelOptions(env: NodeJS.ProcessEnv = process.env, settings: ModelSettings | undefined = undefined): ModelOptions {
  const mirror = (env.CAFE_MODEL_MIRROR ?? settings?.modelMirror ?? '').trim();
  const token = (env.CAFE_MODEL_MIRROR_TOKEN ?? settings?.modelMirrorToken ?? '').trim();
  const offline = env.CAFE_MODEL_OFFLINE !== undefined ? onFlag(env.CAFE_MODEL_OFFLINE) : onFlag(settings?.offline);
  return { dir: modelDir(env), ...(mirror ? { mirror: mirror.replace(/\/*$/, '/') } : {}), ...(token ? { token } : {}), offline };
}

/** The fields to set on the library's `env` (@huggingface/transformers 4.x): the cache folder, and the host or no host. */
export interface LibraryEnv {
  cacheDir: string;
  allowRemoteModels: boolean;
  remoteHost?: string;
  /** With a mirror: the model id and a slash, so <mirror>/Xenova/all-MiniLM-L6-v2/<file>, the same layout as the folder on disk. */
  remotePathTemplate?: string;
  fetch?: (input: string | URL, init?: RequestInit) => Promise<Response>;
}
export function libraryEnv(opts: ModelOptions, baseFetch: typeof fetch = fetch): LibraryEnv {
  const out: LibraryEnv = { cacheDir: opts.dir, allowRemoteModels: !opts.offline };
  if (opts.offline) return out;
  if (opts.mirror) {
    out.remoteHost = opts.mirror;
    out.remotePathTemplate = '{model}/';
    if (opts.token) {
      const { token, mirror } = opts;
      out.fetch = (input, init) => {
        if (!String(input).startsWith(mirror)) return baseFetch(input, init);
        const headers = new Headers(init?.headers);
        headers.set('Authorization', `Bearer ${token}`);
        return baseFetch(input, { ...init, headers });
      };
    }
  }
  return out;
}

/** The URL the mirror must answer for one of the model's files. */
export const mirrorUrl = (mirror: string, file: string): string => `${mirror.replace(/\/*$/, '/')}${EMBED_MODEL}/${file}`;

export interface ModelSource { kind: 'hub' | 'mirror' | 'import'; from: string; at: string; bytes?: number }
export interface ModelStatus {
  id: string;
  dir: string;
  folder: string;
  cached: boolean;
  /** The required files not on disk. */
  missing: string[];
  /** Size on disk of the model folder, all files. */
  bytes: number;
  source?: ModelSource;
  mirror?: string;
  offline: boolean;
}

async function sizeOf(dir: string): Promise<number> {
  let total = 0;
  const walk = async (d: string) => {
    for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) total += (await fs.stat(p)).size;
    }
  };
  await walk(dir);
  return total;
}
const isFile = (p: string) => fs.stat(p).then((s) => s.isFile()).catch(() => false);

/** The required files not in the model folder (empty when the model is cached). */
export async function missingFiles(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const folder = modelFolder(env);
  const out: string[] = [];
  for (const f of MODEL_FILES) if (!(await isFile(path.join(folder, f)))) out.push(f);
  return out;
}
/** Is the model already in the cache folder, every file the load fetches (so a Run needs no download)? */
export const modelCached = async (env: NodeJS.ProcessEnv = process.env): Promise<boolean> => (await missingFiles(env)).length === 0;

export async function readSource(env: NodeJS.ProcessEnv = process.env): Promise<ModelSource | undefined> {
  try { return JSON.parse(await fs.readFile(path.join(modelFolder(env), SOURCE_FILE), 'utf8')) as ModelSource; } catch { return undefined; }
}
export async function writeSource(env: NodeJS.ProcessEnv, source: ModelSource): Promise<void> {
  const folder = modelFolder(env);
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, SOURCE_FILE), JSON.stringify(source, null, 2) + '\n');
}

/** Where the model is, whether it is cached, its size, and where it came from. Never contacts any host. */
export async function modelStatus(env: NodeJS.ProcessEnv = process.env, settings?: ModelSettings): Promise<ModelStatus> {
  const opts = modelOptions(env, settings);
  const missing = await missingFiles(env);
  const folder = modelFolder(env);
  const source = await readSource(env);
  return {
    id: EMBED_MODEL, dir: opts.dir, folder, cached: missing.length === 0, missing, bytes: await sizeOf(folder),
    ...(source ? { source } : {}), ...(opts.mirror ? { mirror: opts.mirror } : {}), offline: opts.offline,
  };
}

/** The one message the operator can act on when the model is not here and cannot be downloaded: the three ways in. */
export function waysIn(opts: ModelOptions, why?: string): string {
  const folder = path.join(opts.dir, ...EMBED_MODEL.split('/'));
  const reason = opts.offline ? 'downloads are off (CAFE_MODEL_OFFLINE=1)'
    : opts.mirror ? (why ? `the mirror ${opts.mirror} did not answer (${why})` : `the first Run would download it from the mirror ${opts.mirror}`)
      : why ? `huggingface.co could not be reached (${why})` : 'the first Run would download it from huggingface.co (if the firm blocks that, use one of these)';
  return [
    `The reading model (${EMBED_MODEL}, about 23 MB) is not on this machine and ${reason}. Three ways in:`,
    `1. Firm mirror: set CAFE_MODEL_MIRROR (or deepRead.modelMirror in rules/settings.yaml) to an internal store that serves ${EMBED_MODEL}/config.json, tokenizer.json, tokenizer_config.json and onnx/model_quantized.onnx under one base URL, then Run again.`,
    `2. Import by hand: on any machine with access, run Deep read once (or download those four files), then here run  cafe model import <folder-or-zip>  which copies them into ${folder}.`,
    `3. Export from a colleague: on a machine that has the model, run  cafe model export model.zip  and import that zip with the command above.`,
    `Nothing else changes; the index is built once the model is in ${folder}.`,
  ].join('\n');
}
/** Is this job error the model-missing message (so the pop-out shows the ways in rather than a plain failure)? */
export const isWaysIn = (message: string | undefined): boolean => !!message && message.startsWith('The reading model (');

export interface ImportReport { folder: string; files: string[]; bytes: number; from: string }

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(p, base)));
    else if (e.isFile()) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/**
 * Finds the model among a set of relative paths: the prefix under which config.json sits with the other required
 * files beside it. A folder of the model itself, of Xenova/all-MiniLM-L6-v2, or of a whole models cache all work.
 */
export function findModelRoot(paths: string[]): { prefix: string; missing: string[] } {
  const set = new Set(paths.map((p) => p.replace(/\\/g, '/').replace(/^\.\//, '')));
  const prefixes = [...set].filter((p) => p === 'config.json' || p.endsWith('/config.json')).map((p) => p.slice(0, -'config.json'.length));
  let best: { prefix: string; missing: string[] } | undefined;
  for (const prefix of prefixes) {
    const missing = MODEL_FILES.filter((f) => !set.has(prefix + f));
    if (!best || missing.length < best.missing.length) best = { prefix, missing };
  }
  return best ?? { prefix: '', missing: [...MODEL_FILES] };
}

const notAModel = (from: string, missing: string[]) => new Error(`${from} does not hold the model: missing ${missing.join(', ')}. It needs ${EMBED_MODEL}'s ${MODEL_FILES.join(', ')} (a folder, or a zip, as downloaded on a machine with access, or as cafe model export writes it).`);

/** Copies a model folder, or a zip of one, into the model folder; verifies the required files; records the source. */
export async function importModel(src: string, env: NodeJS.ProcessEnv = process.env, at: string = new Date().toISOString()): Promise<ImportReport> {
  const from = path.resolve(src);
  const st = await fs.stat(from).catch(() => { throw new Error(`${from} does not exist.`); });
  const folder = modelFolder(env);
  const written: string[] = [];
  let bytes = 0;
  const put = async (rel: string, data: Uint8Array) => {
    const dest = path.join(folder, ...rel.split('/'));
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, data);
    written.push(rel); bytes += data.byteLength;
  };
  const inModel = (prefix: string) => (f: string) => f.startsWith(prefix) && f.slice(prefix.length) !== SOURCE_FILE;
  if (st.isDirectory()) {
    const files = await listFiles(from);
    const { prefix, missing } = findModelRoot(files);
    if (missing.length) throw notAModel(from, missing);
    for (const rel of files.filter(inModel(prefix))) await put(rel.slice(prefix.length), new Uint8Array(await fs.readFile(path.join(from, ...rel.split('/')))));
  } else {
    let entries: Record<string, Uint8Array>;
    try { entries = unzipSync(new Uint8Array(await fs.readFile(from))); } catch { throw new Error(`${from} is neither a folder nor a zip the app can read.`); }
    const names = Object.keys(entries).filter((n) => !n.endsWith('/'));
    const { prefix, missing } = findModelRoot(names);
    if (missing.length) throw notAModel(from, missing);
    for (const n of names.filter(inModel(prefix))) await put(n.slice(prefix.length), entries[n]);
  }
  await writeSource(env, { kind: 'import', from, at, bytes });
  return { folder, files: written.sort(), bytes, from };
}

export interface ExportReport { zip: string; files: string[]; bytes: number }

/** Zips the cached model folder (under its Xenova/all-MiniLM-L6-v2 path, so the zip imports anywhere) for another machine. */
export async function exportModel(zipPath: string, env: NodeJS.ProcessEnv = process.env): Promise<ExportReport> {
  const missing = await missingFiles(env);
  if (missing.length) throw new Error(`The model is not on this machine (missing ${missing.join(', ')} in ${modelFolder(env)}); nothing to export.`);
  const folder = modelFolder(env);
  const files = (await listFiles(folder)).filter((f) => f !== SOURCE_FILE).sort();
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const f of files) {
    const data = new Uint8Array(await fs.readFile(path.join(folder, ...f.split('/'))));
    // The ONNX weights barely compress; stored as they are, the zip is written and read faster.
    entries[`${EMBED_MODEL}/${f}`] = [data, { level: f.endsWith('.onnx') ? 0 : 6 }];
  }
  const zip = path.resolve(zipPath);
  const out = zipSync(entries);
  await fs.mkdir(path.dirname(zip), { recursive: true });
  await fs.writeFile(zip, out);
  return { zip, files, bytes: out.byteLength };
}

/** "23.4 MB", "812 kB", "40 B". */
export function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${bytes} B`;
}

/** The lines `cafe model status` prints. */
export function statusLines(s: ModelStatus): string[] {
  const lines = [
    `Model:   ${s.id}`,
    `Folder:  ${s.folder}`,
    `Cached:  ${s.cached ? `yes (${sizeText(s.bytes)} on disk)` : `no (missing ${s.missing.join(', ')}${s.bytes ? `; ${sizeText(s.bytes)} of other files there` : ''})`}`,
    `Source:  ${s.source ? `${s.source.kind} (${s.source.from}, ${s.source.at})` : s.cached ? 'not recorded (downloaded before the app kept a record, or copied by hand)' : '—'}`,
    `Mirror:  ${s.mirror ?? 'none (huggingface.co on the first Run)'}`,
    `Offline: ${s.offline ? 'yes (CAFE_MODEL_OFFLINE: no host is ever contacted)' : 'no'}`,
  ];
  if (!s.cached) lines.push('', waysIn({ dir: s.dir, offline: s.offline, ...(s.mirror ? { mirror: s.mirror } : {}) }));
  return lines;
}
