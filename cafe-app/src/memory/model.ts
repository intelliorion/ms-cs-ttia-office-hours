import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { unzipSync, zipSync } from 'fflate';

/**
 * Deep read's model on disk. The model ships with the repo (cafe-app/models, four files, checksummed in MANIFEST.json),
 * so a fresh clone runs Deep read with no download and no import. The app looks for it in this order: CAFE_MODEL_DIR
 * when set; ~/.cafe-ai/models when the four files are there; the bundled folder when the four files are there; else
 * ~/.cafe-ai/models as the place a download or an import would fill. The bundled folder is only ever read. The three
 * ways in when the hub is blocked and the bundled copy is gone (a firm mirror, a manual import, an export zip) are
 * here too. The library is never imported here; embed.ts applies `libraryEnv` to it. Nothing here contacts any host.
 */
export const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';

/** The files the q8 load fetches, relative to the model folder: what a mirror must serve and an import must hold. */
export const MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'] as const;
/** The app's record of where the files came from, written beside them by an import or a download. */
export const SOURCE_FILE = 'source.json';
/** The bundled folder's record: the model id, the licence, the download date and the sha256 of each file. */
export const MANIFEST_FILE = 'MANIFEST.json';

/** The model folder shipped in the repo, <app root>/models, found from this file's own path, never the working directory. */
export const BUNDLED_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'models');

/** The model's own folder inside a models folder: <dir>/Xenova/all-MiniLM-L6-v2, the layout the library's file cache uses. */
export const folderIn = (dir: string): string => path.join(dir, ...EMBED_MODEL.split('/'));
/** ~/.cafe-ai/models: outside the workspace, so data/ stays deletable. HOME in the environment given wins, for tests. */
export const homeModelDir = (env: NodeJS.ProcessEnv = process.env): string => path.join(env.HOME?.trim() || os.homedir(), '.cafe-ai', 'models');
/** Where a download or an import goes: CAFE_MODEL_DIR, or ~/.cafe-ai/models. Never the bundled folder. */
export const writableModelDir = (env: NodeJS.ProcessEnv = process.env): string => env.CAFE_MODEL_DIR?.trim() || homeModelDir(env);

const isFile = (p: string) => fs.stat(p).then((s) => s.isFile()).catch(() => false);
/** The required files not in one model folder. */
async function missingIn(folder: string): Promise<string[]> {
  const out: string[] = [];
  for (const f of MODEL_FILES) if (!(await isFile(path.join(folder, f)))) out.push(f);
  return out;
}

export type ModelPlace = 'custom' | 'home' | 'bundled';
export interface BundledModel { dir: string; folder: string; present: boolean }
export interface ModelPlacement {
  /** The models folder in use. */
  dir: string;
  /** The model's own folder inside it. */
  folder: string;
  place: ModelPlace;
  /** The required files not in `folder` (empty when the model is cached). */
  missing: string[];
  /** The folder shipped with the app, whether or not it won. */
  bundled: BundledModel;
}

/**
 * Where the model is: (a) CAFE_MODEL_DIR when set, cached or not; (b) ~/.cafe-ai/models when it holds the four files;
 * (c) the bundled folder when it holds them; (d) otherwise ~/.cafe-ai/models, the folder a download or import fills.
 */
export async function placeModel(env: NodeJS.ProcessEnv = process.env): Promise<ModelPlacement> {
  const bundledFolder = folderIn(BUNDLED_DIR);
  const bundled: BundledModel = { dir: BUNDLED_DIR, folder: bundledFolder, present: (await missingIn(bundledFolder)).length === 0 };
  const custom = env.CAFE_MODEL_DIR?.trim();
  if (custom) return { dir: custom, folder: folderIn(custom), place: 'custom', missing: await missingIn(folderIn(custom)), bundled };
  const home = homeModelDir(env);
  const homeMissing = await missingIn(folderIn(home));
  if (!homeMissing.length) return { dir: home, folder: folderIn(home), place: 'home', missing: [], bundled };
  if (bundled.present) return { dir: BUNDLED_DIR, folder: bundledFolder, place: 'bundled', missing: [], bundled };
  return { dir: home, folder: folderIn(home), place: 'home', missing: homeMissing, bundled };
}
/** The models folder in use (see placeModel). */
export const modelDir = async (env: NodeJS.ProcessEnv = process.env): Promise<string> => (await placeModel(env)).dir;
/** The model's own folder in use: <dir>/Xenova/all-MiniLM-L6-v2. */
export const modelFolder = async (env: NodeJS.ProcessEnv = process.env): Promise<string> => (await placeModel(env)).folder;
/** The required files not in the model folder in use (empty when the model is cached). */
export const missingFiles = async (env: NodeJS.ProcessEnv = process.env): Promise<string[]> => (await placeModel(env)).missing;
/** Is the model on this machine, every file the load fetches, in any of the three places (so a Run needs no download)? */
export const modelCached = async (env: NodeJS.ProcessEnv = process.env): Promise<boolean> => (await missingFiles(env)).length === 0;

/** The settings keys under deepRead in rules/settings.yaml; the environment variables of the same meaning win. */
export interface ModelSettings { modelMirror?: string; modelMirrorToken?: string; offline?: boolean }

export interface ModelOptions {
  /** The models folder in use: the library's cache folder, and the download target when the model is not there. */
  dir: string;
  place: ModelPlace;
  bundled: BundledModel;
  /** The base URL of the firm's mirror, with one trailing slash; absent means the hub. */
  mirror?: string;
  /** A bearer token the mirror wants, sent as Authorization on every request to it. */
  token?: string;
  /** Never contact any host. */
  offline: boolean;
}

const onFlag = (v: unknown): boolean => v === true || v === 1 || /^(1|true|yes|on)$/i.test(String(v ?? '').trim());

/** The model options: where it is, then the environment (CAFE_MODEL_MIRROR, CAFE_MODEL_MIRROR_TOKEN, CAFE_MODEL_OFFLINE) over the workspace settings. */
export async function modelOptions(env: NodeJS.ProcessEnv = process.env, settings: ModelSettings | undefined = undefined): Promise<ModelOptions> {
  const mirror = (env.CAFE_MODEL_MIRROR ?? settings?.modelMirror ?? '').trim();
  const token = (env.CAFE_MODEL_MIRROR_TOKEN ?? settings?.modelMirrorToken ?? '').trim();
  const offline = env.CAFE_MODEL_OFFLINE !== undefined ? onFlag(env.CAFE_MODEL_OFFLINE) : onFlag(settings?.offline);
  const { dir, place, bundled } = await placeModel(env);
  return { dir, place, bundled, ...(mirror ? { mirror: mirror.replace(/\/*$/, '/') } : {}), ...(token ? { token } : {}), offline };
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
export function libraryEnv(opts: Pick<ModelOptions, 'dir' | 'offline' | 'mirror' | 'token'>, baseFetch: typeof fetch = fetch): LibraryEnv {
  // The library binds the global fetch once at import; the fetch of the moment is always set, so a wrapper from an
  // earlier load (a token) never lingers on its singleton env, and a test can see every request.
  const out: LibraryEnv = { cacheDir: opts.dir, allowRemoteModels: !opts.offline, fetch: baseFetch };
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

export interface ModelSource { kind: 'hub' | 'mirror' | 'import' | 'bundled'; from: string; at: string; bytes?: number }
export interface ModelStatus {
  id: string;
  dir: string;
  folder: string;
  place: ModelPlace;
  /** The folder shipped with the app, whether or not it is the one in use. */
  bundled: BundledModel;
  cached: boolean;
  /** The required files not on disk. */
  missing: string[];
  /** Size on disk of the model folder, all files. */
  bytes: number;
  source?: ModelSource;
  /** With the bundled model: the files that differ from MANIFEST.json (empty when all four match). */
  corrupt?: string[];
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

/** source.json in the model folder in use (none for the bundled model: its record is MANIFEST.json). */
export async function readSource(env: NodeJS.ProcessEnv = process.env): Promise<ModelSource | undefined> {
  try { return JSON.parse(await fs.readFile(path.join(await modelFolder(env), SOURCE_FILE), 'utf8')) as ModelSource; } catch { return undefined; }
}
/** Records where a download or an import put the files: in the writable folder, never the bundled one. */
export async function writeSource(env: NodeJS.ProcessEnv, source: ModelSource): Promise<void> {
  const folder = folderIn(writableModelDir(env));
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, SOURCE_FILE), JSON.stringify(source, null, 2) + '\n');
}

export interface Manifest { model: string; licence: string; downloadedAt: string; files: Record<string, { sha256: string; bytes: number }> }
export async function readManifest(dir: string = BUNDLED_DIR): Promise<Manifest | undefined> {
  try { return JSON.parse(await fs.readFile(path.join(dir, MANIFEST_FILE), 'utf8')) as Manifest; } catch { return undefined; }
}
const sha256 = async (p: string): Promise<string> => createHash('sha256').update(await fs.readFile(p)).digest('hex');
/** The files of the bundled folder that are missing or differ from MANIFEST.json (all four when the manifest itself is missing). */
export async function verifyBundled(dir: string = BUNDLED_DIR): Promise<string[]> {
  const m = await readManifest(dir);
  if (!m) return MODEL_FILES.map((f) => `${EMBED_MODEL}/${f}`);
  const bad: string[] = [];
  for (const f of MODEL_FILES) {
    const rel = `${EMBED_MODEL}/${f}`;
    const want = m.files[rel];
    const got = await sha256(path.join(dir, ...rel.split('/'))).catch(() => undefined);
    if (!want || got !== want.sha256) bad.push(rel);
  }
  return bad;
}

/** Where the model is, whether it is cached, its size, and where it came from. Never contacts any host. */
export async function modelStatus(env: NodeJS.ProcessEnv = process.env, settings?: ModelSettings): Promise<ModelStatus> {
  const opts = await modelOptions(env, settings);
  const { folder, place, missing, bundled: shipped } = await placeModel(env);
  const bundled = place === 'bundled';
  const manifest = bundled ? await readManifest(opts.dir) : undefined;
  const source: ModelSource | undefined = bundled ? { kind: 'bundled', from: opts.dir, at: manifest?.downloadedAt ?? 'date not recorded' } : await readSource(env);
  return {
    id: EMBED_MODEL, dir: opts.dir, folder, place, bundled: shipped, cached: missing.length === 0, missing, bytes: await sizeOf(folder),
    ...(source ? { source } : {}), ...(bundled ? { corrupt: await verifyBundled(opts.dir) } : {}),
    ...(opts.mirror ? { mirror: opts.mirror } : {}), offline: opts.offline,
  };
}

/** The one message the operator can act on when the model is not here and cannot be downloaded: the three ways in. */
export function waysIn(opts: Pick<ModelOptions, 'dir' | 'bundled' | 'offline' | 'mirror'>, why?: string): string {
  const folder = folderIn(opts.dir);
  const reason = opts.offline ? 'downloads are off (CAFE_MODEL_OFFLINE=1)'
    : opts.mirror ? (why ? `the mirror ${opts.mirror} did not answer (${why})` : `the first Run would download it from the mirror ${opts.mirror}`)
      : why ? `huggingface.co could not be reached (${why})` : 'the first Run would download it from huggingface.co (if the firm blocks that, use one of these)';
  // The bundled copy is present only when CAFE_MODEL_DIR points elsewhere; otherwise it would have been used.
  const shipped = opts.bundled.present
    ? `CAFE_MODEL_DIR is set to ${opts.dir}, so the model shipped with the app (${opts.bundled.folder}) is not used`
    : `The model shipped with the app was not found at ${opts.bundled.folder} (a fresh clone of the repo has it)`;
  return [
    `${shipped}, and the reading model (${EMBED_MODEL}, about 23 MB) is not in ${folder} either; ${reason}. Three ways in${opts.bundled.present ? ' (or unset CAFE_MODEL_DIR)' : ''}:`,
    `1. Firm mirror: set CAFE_MODEL_MIRROR (or deepRead.modelMirror in rules/settings.yaml) to an internal store that serves ${EMBED_MODEL}/config.json, tokenizer.json, tokenizer_config.json and onnx/model_quantized.onnx under one base URL, then Run again.`,
    `2. Import by hand: on any machine with access, run Deep read once (or download those four files), then here run  cafe model import <folder-or-zip>  which copies them into ${folder}.`,
    `3. Export from a colleague: on a machine that has the model, run  cafe model export model.zip  and import that zip with the command above.`,
    `Nothing else changes; the index is built once the model is in ${folder}.`,
  ].join('\n');
}
const WAYS_IN_OPENERS = ['The model shipped with the app was not found at ', 'CAFE_MODEL_DIR is set to '];
/** Is this job error the model-missing message (so the pop-out shows the ways in rather than a plain failure)? */
export const isWaysIn = (message: string | undefined): boolean => !!message && WAYS_IN_OPENERS.some((o) => message.startsWith(o));

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
  const folder = folderIn(writableModelDir(env));
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
  const { folder, missing } = await placeModel(env);
  if (missing.length) throw new Error(`The model is not on this machine (missing ${missing.join(', ')} in ${folder}); nothing to export.`);
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
    `Folder:  ${s.folder}${s.place === 'bundled' ? ' (shipped with the app)' : s.place === 'custom' ? ' (CAFE_MODEL_DIR)' : ''}`,
    `Cached:  ${s.cached ? `yes (${sizeText(s.bytes)} on disk)` : `no (missing ${s.missing.join(', ')}${s.bytes ? `; ${sizeText(s.bytes)} of other files there` : ''})`}`,
    `Source:  ${s.source ? `${s.source.kind} (${s.source.from}, ${s.source.at})` : s.cached ? 'not recorded (downloaded before the app kept a record, or copied by hand)' : '—'}`,
  ];
  if (s.corrupt) lines.push(s.corrupt.length ? `Checked: NO: ${s.corrupt.join(', ')} differ from ${MANIFEST_FILE} (a corrupt clone; restore the folder with git checkout -- cafe-app/models)` : `Checked: the four files match ${MANIFEST_FILE}`);
  lines.push(
    `Mirror:  ${s.mirror ?? (s.cached ? 'none' : 'none (huggingface.co on the first Run)')}`,
    `Offline: ${s.offline ? 'yes (CAFE_MODEL_OFFLINE: no host is ever contacted)' : 'no'}`,
  );
  if (!s.cached) lines.push('', waysIn({ dir: s.dir, bundled: s.bundled, offline: s.offline, ...(s.mirror ? { mirror: s.mirror } : {}) }));
  return lines;
}
