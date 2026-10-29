import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync } from 'fflate';
import {
  BUNDLED_DIR, EMBED_MODEL, MODEL_FILES, exportModel, findModelRoot, folderIn, homeModelDir, importModel, isWaysIn, libraryEnv, mirrorUrl, missingFiles,
  modelCached, modelDir, modelFolder, modelOptions, modelStatus, placeModel, readManifest, readSource, sizeText, statusLines, verifyBundled, waysIn,
  writableModelDir,
} from '../src/memory/model';
import { realEmbedder } from '../src/memory/embed';
import { sampleIdea, startServer } from './helpers';
import { saveIdea } from '../src/ideas/store';
import { writeYaml } from '../src/workspace/files';
import { paths } from '../src/workspace/paths';

/**
 * Deep read's model: the folder shipped with the repo and the order the app looks in (CAFE_MODEL_DIR, ~/.cafe-ai/models,
 * the bundled folder), its manifest checksums, and the three ways in when the firm blocks the Hugging Face hub: the
 * mirror mapping, the offline switch, import (folder and zip), export, status and the one message. Nothing here
 * downloads anything: the fabricated model files have the right names, the one real load against the hub points the
 * mirror at a port nothing listens on, and the one real load that succeeds reads the bundled folder offline.
 */
const tmp = async () => fs.mkdtemp(path.join(os.tmpdir(), 'cafe-model-'));
const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true }); });
const envWith = (over: Record<string, string | undefined>): NodeJS.ProcessEnv => {
  const e: NodeJS.ProcessEnv = { ...process.env, CAFE_EMBED_FAKE: undefined, CAFE_MODEL_MIRROR: undefined, CAFE_MODEL_MIRROR_TOKEN: undefined, CAFE_MODEL_OFFLINE: undefined, ...over };
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return e;
};

/** A fabricated model: the four files the load fetches, with the right names, a few bytes each. */
async function fabricate(root: string, prefix = ''): Promise<string> {
  for (const f of MODEL_FILES) {
    const p = path.join(root, ...prefix.split('/').filter(Boolean), ...f.split('/'));
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, f.endsWith('.onnx') ? Buffer.alloc(2048, 7) : JSON.stringify({ file: f }));
  }
  return root;
}

/** An environment with no CAFE_MODEL_DIR (the tests set one) and HOME at an empty folder: the order is seen from the top. */
const bare = (home: string, over: Record<string, string | undefined> = {}) => envWith({ CAFE_MODEL_DIR: undefined, HOME: home, ...over });

describe('the model shipped with the app', () => {
  it('is in cafe-app/models, found from the module path, with the four files and a manifest whose sha256 match the files on disk', async () => {
    expect(BUNDLED_DIR).toBe(path.resolve(__dirname, '..', 'models'));
    expect(folderIn(BUNDLED_DIR)).toBe(path.join(BUNDLED_DIR, 'Xenova', 'all-MiniLM-L6-v2'));
    const m = await readManifest();
    expect(m).toMatchObject({ model: EMBED_MODEL, licence: 'Apache-2.0' });
    expect(m!.downloadedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(m!.files).sort()).toEqual(MODEL_FILES.map((f) => `${EMBED_MODEL}/${f}`).sort());
    for (const [rel, { sha256, bytes }] of Object.entries(m!.files)) {
      const data = await fs.readFile(path.join(BUNDLED_DIR, ...rel.split('/')));
      expect(data.byteLength, rel).toBe(bytes);
      expect(createHash('sha256').update(data).digest('hex'), rel).toBe(sha256);
    }
    expect(await verifyBundled()).toEqual([]);
    // A corrupt clone is named: a copy with one file changed, and one with no manifest.
    const copy = await tmp(); dirs.push(copy);
    for (const f of MODEL_FILES) { const to = path.join(copy, 'Xenova', 'all-MiniLM-L6-v2', ...f.split('/')); await fs.mkdir(path.dirname(to), { recursive: true }); await fs.copyFile(path.join(folderIn(BUNDLED_DIR), ...f.split('/')), to); }
    await fs.copyFile(path.join(BUNDLED_DIR, 'MANIFEST.json'), path.join(copy, 'MANIFEST.json'));
    await fs.writeFile(path.join(copy, 'Xenova', 'all-MiniLM-L6-v2', 'config.json'), '{}');
    expect(await verifyBundled(copy)).toEqual([`${EMBED_MODEL}/config.json`]);
    await fs.rm(path.join(copy, 'MANIFEST.json'));
    expect(await verifyBundled(copy)).toEqual(MODEL_FILES.map((f) => `${EMBED_MODEL}/${f}`));
    expect(await fs.readFile(path.join(BUNDLED_DIR, 'LICENCE-NOTICE.md'), 'utf8')).toContain('Apache License, Version 2.0');
  });

  it('the order: CAFE_MODEL_DIR when set, ~/.cafe-ai/models when it holds the model, the bundled folder when it does, else ~/.cafe-ai/models', async () => {
    const home = await tmp(); dirs.push(home);
    expect(homeModelDir(bare(home))).toBe(path.join(home, '.cafe-ai', 'models'));
    // (c) nothing at home: the bundled folder, cached.
    const c = await placeModel(bare(home));
    expect(c).toMatchObject({ dir: BUNDLED_DIR, folder: folderIn(BUNDLED_DIR), place: 'bundled', missing: [], bundled: { dir: BUNDLED_DIR, present: true } });
    expect(await modelCached(bare(home))).toBe(true);
    expect(await modelDir(bare(home))).toBe(BUNDLED_DIR);
    // The download and import target is never the bundled folder.
    expect(writableModelDir(bare(home))).toBe(path.join(home, '.cafe-ai', 'models'));
    // (b) the model at home wins over the bundled one.
    await fabricate(path.join(home, '.cafe-ai', 'models'), EMBED_MODEL);
    const b = await placeModel(bare(home));
    expect(b).toMatchObject({ dir: path.join(home, '.cafe-ai', 'models'), place: 'home', missing: [] });
    // Half a model at home does not: the bundled one is used, and the home folder is left alone.
    await fs.rm(path.join(home, '.cafe-ai', 'models', 'Xenova', 'all-MiniLM-L6-v2', 'tokenizer.json'));
    expect((await placeModel(bare(home))).place).toBe('bundled');
    // (a) CAFE_MODEL_DIR wins even without the model, and says what is missing; the bundled copy is noted as present.
    const custom = await tmp(); dirs.push(custom);
    const a = await placeModel(bare(home, { CAFE_MODEL_DIR: custom }));
    expect(a).toMatchObject({ dir: custom, place: 'custom', missing: [...MODEL_FILES], bundled: { present: true } });
    expect(await modelCached(bare(home, { CAFE_MODEL_DIR: custom }))).toBe(false);
    expect(await missingFiles(bare(home, { CAFE_MODEL_DIR: custom }))).toEqual([...MODEL_FILES]);
    expect(writableModelDir(bare(home, { CAFE_MODEL_DIR: custom }))).toBe(custom);
  });

  it('status says bundled with the path, checked against the manifest, and the pop-out and the CLI see it as on this machine', async () => {
    const home = await tmp(); dirs.push(home);
    const s = await modelStatus(bare(home, { CAFE_MODEL_OFFLINE: '1' }));
    expect(s).toMatchObject({ place: 'bundled', dir: BUNDLED_DIR, cached: true, missing: [], source: { kind: 'bundled', from: BUNDLED_DIR }, corrupt: [], offline: true });
    expect(s.source!.at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.bytes).toBeGreaterThan(20 * 1024 * 1024);
    const lines = statusLines(s);
    expect(lines[1]).toBe(`Folder:  ${folderIn(BUNDLED_DIR)} (shipped with the app)`);
    expect(lines[2]).toMatch(/^Cached:  yes \(\d+\.\d MB on disk\)$/);
    expect(lines[3]).toBe(`Source:  bundled (${BUNDLED_DIR}, ${s.source!.at})`);
    expect(lines[4]).toBe('Checked: the four files match MANIFEST.json');
    expect(lines[5]).toBe('Mirror:  none');
    expect(lines.join('\n')).not.toContain('Three ways in');
    expect(await readSource(bare(home))).toBeUndefined();
  });

  it('a real load against the bundled folder, offline, embeds and writes nothing into the repo folder', async () => {
    const home = await tmp(); dirs.push(home);
    const listing = async () => { const out: string[] = []; const walk = async (d: string) => { for (const e of (await fs.readdir(d, { withFileTypes: true })).sort((x, y) => x.name.localeCompare(y.name))) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else out.push(`${path.relative(BUNDLED_DIR, p)}:${(await fs.stat(p)).size}`); } }; await walk(BUNDLED_DIR); return out; };
    const before = await listing();
    expect(before.filter((l) => !l.startsWith('MANIFEST.json') && !l.startsWith('LICENCE-NOTICE.md')).map((l) => l.split(':')[0].split(path.sep).join('/')).sort()).toEqual(MODEL_FILES.map((f) => `${EMBED_MODEL}/${f}`).sort());
    const asked: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((input: string | URL, init?: RequestInit) => { asked.push(String(input)); return realFetch(input, init); }) as typeof fetch;
    try {
      const emb = realEmbedder(bare(home, { CAFE_MODEL_OFFLINE: '1' }));
      const [v] = await emb.embed(['contracts are summarised by hand every week']);
      expect(v).toHaveLength(384);
      expect(Math.abs(v.reduce((s, x) => s + x * x, 0) - 1)).toBeLessThan(0.01);
    } finally { globalThis.fetch = realFetch; }
    expect(asked).toEqual([]);
    expect(await listing()).toEqual(before);
    expect(await fs.stat(path.join(home, '.cafe-ai')).catch(() => null)).toBeNull();
  }, 60_000);
});

describe('the model options and the library mapping', () => {
  it('the environment wins over the settings; the mirror gets one trailing slash; offline takes 1, true, yes, on', async () => {
    expect(await modelOptions(envWith({ CAFE_MODEL_DIR: '/m' }))).toMatchObject({ dir: '/m', place: 'custom', offline: false });
    expect((await modelOptions(envWith({ CAFE_MODEL_DIR: '/m' }))).mirror).toBeUndefined();
    expect(await modelOptions(envWith({ CAFE_MODEL_DIR: '/m' }), { modelMirror: 'https://artifacts.firm/hf', modelMirrorToken: 't1', offline: true })).toMatchObject({ dir: '/m', mirror: 'https://artifacts.firm/hf/', token: 't1', offline: true });
    expect(await modelOptions(envWith({ CAFE_MODEL_DIR: '/m', CAFE_MODEL_MIRROR: 'https://nexus.firm/hub//', CAFE_MODEL_MIRROR_TOKEN: 't2', CAFE_MODEL_OFFLINE: '0' }), { modelMirror: 'https://other/', modelMirrorToken: 't1', offline: true }))
      .toMatchObject({ dir: '/m', mirror: 'https://nexus.firm/hub/', token: 't2', offline: false });
    for (const v of ['1', 'true', 'YES', 'on']) expect((await modelOptions(envWith({ CAFE_MODEL_OFFLINE: v }))).offline).toBe(true);
    for (const v of ['', '0', 'false', 'no']) expect((await modelOptions(envWith({ CAFE_MODEL_OFFLINE: v }))).offline).toBe(false);
  });

  it('a mirror maps onto remoteHost and remotePathTemplate so the URL is <mirror>/Xenova/all-MiniLM-L6-v2/<file>; a token rides as a bearer header on the mirror only', async () => {
    const plain = libraryEnv({ dir: '/m', offline: false });
    expect(plain).toEqual({ cacheDir: '/m', allowRemoteModels: true, fetch: globalThis.fetch });
    const mirrored = libraryEnv({ dir: '/m', mirror: 'https://artifacts.firm/hf/', offline: false });
    expect(mirrored).toEqual({ cacheDir: '/m', allowRemoteModels: true, remoteHost: 'https://artifacts.firm/hf/', remotePathTemplate: '{model}/', fetch: globalThis.fetch });
    // What the library builds from those two fields (hub.js: remoteHost + template with {model} + filename).
    const built = (file: string) => mirrored.remoteHost! + mirrored.remotePathTemplate!.replaceAll('{model}', EMBED_MODEL) + file;
    expect(built('onnx/model_quantized.onnx')).toBe('https://artifacts.firm/hf/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx');
    expect(built('config.json')).toBe(mirrorUrl('https://artifacts.firm/hf', 'config.json'));
    const calls: { url: string; auth: string | null }[] = [];
    const fake = (async (input: string | URL, init?: RequestInit) => { calls.push({ url: String(input), auth: new Headers(init?.headers).get('authorization') }); return new Response('ok'); }) as typeof fetch;
    const withToken = libraryEnv({ dir: '/m', mirror: 'https://artifacts.firm/hf/', token: 'secret', offline: false }, fake);
    await withToken.fetch!(mirrorUrl('https://artifacts.firm/hf/', 'config.json'), { headers: { 'User-Agent': 'x' } });
    await withToken.fetch!('https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/config.json');
    expect(calls).toEqual([{ url: 'https://artifacts.firm/hf/Xenova/all-MiniLM-L6-v2/config.json', auth: 'Bearer secret' }, { url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/config.json', auth: null }]);
  });

  it('offline turns remote loading off and sets no host, mirror or not; the plain fetch of the moment is always set', () => {
    expect(libraryEnv({ dir: '/m', offline: true })).toEqual({ cacheDir: '/m', allowRemoteModels: false, fetch: globalThis.fetch });
    expect(libraryEnv({ dir: '/m', mirror: 'https://artifacts.firm/hf/', token: 't', offline: true })).toEqual({ cacheDir: '/m', allowRemoteModels: false, fetch: globalThis.fetch });
  });
});

describe('the message', () => {
  it('opens with the shipped copy not found, names the three ways in, the import command, the mirror setting and the folder, and says why', () => {
    const gone = { dir: '/app/models', folder: '/app/models/Xenova/all-MiniLM-L6-v2', present: false };
    const m = waysIn({ dir: '/home/me/.cafe-ai/models', bundled: gone, offline: true });
    expect(m.split('\n')).toHaveLength(5);
    expect(m.startsWith('The model shipped with the app was not found at /app/models/Xenova/all-MiniLM-L6-v2 (a fresh clone of the repo has it), and the reading model (Xenova/all-MiniLM-L6-v2, about 23 MB) is not in /home/me/.cafe-ai/models/Xenova/all-MiniLM-L6-v2 either; ')).toBe(true);
    expect(m).toContain('downloads are off (CAFE_MODEL_OFFLINE=1)');
    expect(m).toContain('CAFE_MODEL_MIRROR');
    expect(m).toContain('deepRead.modelMirror in rules/settings.yaml');
    expect(m).toContain('cafe model import <folder-or-zip>');
    expect(m).toContain('cafe model export model.zip');
    expect(m).toContain('/home/me/.cafe-ai/models/Xenova/all-MiniLM-L6-v2');
    expect(m).toContain('config.json, tokenizer.json, tokenizer_config.json and onnx/model_quantized.onnx');
    expect(waysIn({ dir: '/m', bundled: gone, mirror: 'https://artifacts.firm/hf/', offline: false }, 'fetch failed')).toContain('the mirror https://artifacts.firm/hf/ did not answer (fetch failed)');
    expect(waysIn({ dir: '/m', bundled: gone, offline: false }, 'fetch failed')).toContain('huggingface.co could not be reached (fetch failed)');
    expect(waysIn({ dir: '/m', bundled: gone, offline: false })).toContain('the first Run would download it from huggingface.co (if the firm blocks that, use one of these)');
    expect(waysIn({ dir: '/m', bundled: gone, mirror: 'https://artifacts.firm/hf/', offline: false })).toContain('the first Run would download it from the mirror https://artifacts.firm/hf/');
    expect(m).not.toMatch(/\n\s+at /);
    expect(isWaysIn(m)).toBe(true);
    // CAFE_MODEL_DIR set to a folder without the model while the shipped copy is there: the message says that instead.
    const set = waysIn({ dir: '/m', bundled: { ...gone, present: true }, offline: true });
    expect(set.startsWith('CAFE_MODEL_DIR is set to /m, so the model shipped with the app (/app/models/Xenova/all-MiniLM-L6-v2) is not used, and the reading model (')).toBe(true);
    expect(set).toContain('Three ways in (or unset CAFE_MODEL_DIR):');
    expect(isWaysIn(set)).toBe(true);
    expect(isWaysIn('Could not finish: boom')).toBe(false);
    expect(isWaysIn(undefined)).toBe(false);
  });
});

describe('import, export and status', () => {
  it('finds the model in a set of paths whatever the prefix, and says what is missing', () => {
    expect(findModelRoot(['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx', 'source.json'])).toEqual({ prefix: '', missing: [] });
    expect(findModelRoot(['Xenova/all-MiniLM-L6-v2/config.json', 'Xenova/all-MiniLM-L6-v2/tokenizer.json', 'Xenova/all-MiniLM-L6-v2/tokenizer_config.json', 'Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx'])).toEqual({ prefix: 'Xenova/all-MiniLM-L6-v2/', missing: [] });
    expect(findModelRoot(['all-MiniLM-L6-v2\\config.json', 'all-MiniLM-L6-v2\\tokenizer.json'])).toEqual({ prefix: 'all-MiniLM-L6-v2/', missing: ['tokenizer_config.json', 'onnx/model_quantized.onnx'] });
    expect(findModelRoot(['readme.md'])).toEqual({ prefix: '', missing: [...MODEL_FILES] });
  });

  it('a folder with the four files imports into the model folder; status flips to cached, records the source and the size', async () => {
    const [src, dir] = [await tmp(), await tmp()]; dirs.push(src, dir);
    await fabricate(src, 'all-MiniLM-L6-v2');
    await fs.writeFile(path.join(src, 'all-MiniLM-L6-v2', 'special_tokens_map.json'), '{}');
    const env = envWith({ CAFE_MODEL_DIR: dir });
    expect(await modelCached(env)).toBe(false);
    expect(await missingFiles(env)).toEqual([...MODEL_FILES]);
    const before = await modelStatus(env);
    expect(before).toMatchObject({ id: EMBED_MODEL, dir, folder: path.join(dir, 'Xenova', 'all-MiniLM-L6-v2'), place: 'custom', cached: false, bytes: 0, offline: false });
    expect(before.corrupt).toBeUndefined();
    expect(statusLines(before).join('\n')).toContain('Cached:  no (missing config.json');
    expect(statusLines(before).join('\n')).toContain('Three ways in (or unset CAFE_MODEL_DIR):');
    expect(statusLines(before)[1]).toBe(`Folder:  ${path.join(dir, 'Xenova', 'all-MiniLM-L6-v2')} (CAFE_MODEL_DIR)`);

    const r = await importModel(src, env, '2026-10-28T10:00:00.000Z');
    expect(r).toMatchObject({ folder: await modelFolder(env), from: src, files: ['config.json', 'onnx/model_quantized.onnx', 'special_tokens_map.json', 'tokenizer.json', 'tokenizer_config.json'] });
    expect(r.bytes).toBeGreaterThan(2048);
    expect(await modelCached(env)).toBe(true);
    expect(await readSource(env)).toEqual({ kind: 'import', from: src, at: '2026-10-28T10:00:00.000Z', bytes: r.bytes });
    const after = await modelStatus(env, { modelMirror: 'https://artifacts.firm/hf', offline: true });
    expect(after).toMatchObject({ cached: true, missing: [], mirror: 'https://artifacts.firm/hf/', offline: true, source: { kind: 'import' } });
    expect(after.bytes).toBeGreaterThan(r.bytes); // source.json is there too
    const lines = statusLines(after);
    expect(lines[2]).toMatch(/^Cached:  yes \(\d+ kB on disk\)$/);
    expect(lines[3]).toBe(`Source:  import (${src}, 2026-10-28T10:00:00.000Z)`);
    expect(lines[4]).toBe('Mirror:  https://artifacts.firm/hf/');
    expect(lines[5]).toBe('Offline: yes (CAFE_MODEL_OFFLINE: no host is ever contacted)');
    expect(lines.join('\n')).not.toContain('Three ways in');
    expect(sizeText(40)).toBe('40 B'); expect(sizeText(1536)).toBe('2 kB'); expect(sizeText(23.4 * 1024 * 1024)).toBe('23.4 MB');
  });

  it('a zip imports too, under any prefix; a folder or zip without the four files is refused and names them', async () => {
    const [src, dir] = [await tmp(), await tmp()]; dirs.push(src, dir);
    const env = envWith({ CAFE_MODEL_DIR: dir });
    const entries: Record<string, Uint8Array> = {};
    for (const f of MODEL_FILES) entries[`models/${EMBED_MODEL}/${f}`] = new Uint8Array(Buffer.from(f.endsWith('.onnx') ? Buffer.alloc(100, 1) : `{"f":"${f}"}`));
    await fs.writeFile(path.join(src, 'model.zip'), zipSync(entries));
    const r = await importModel(path.join(src, 'model.zip'), env);
    expect(r.files).toEqual(['config.json', 'onnx/model_quantized.onnx', 'tokenizer.json', 'tokenizer_config.json']);
    expect(await modelCached(env)).toBe(true);
    expect(JSON.parse(await fs.readFile(path.join(await modelFolder(env), 'tokenizer_config.json'), 'utf8'))).toEqual({ f: 'tokenizer_config.json' });

    const half = await tmp(); dirs.push(half);
    await fs.writeFile(path.join(half, 'config.json'), '{}');
    await expect(importModel(half, env)).rejects.toThrow(`${half} does not hold the model: missing tokenizer.json, tokenizer_config.json, onnx/model_quantized.onnx.`);
    await fs.writeFile(path.join(src, 'not.zip'), 'hello');
    await expect(importModel(path.join(src, 'not.zip'), env)).rejects.toThrow('neither a folder nor a zip');
    await expect(importModel(path.join(src, 'absent'), env)).rejects.toThrow('does not exist');
  });

  it('export zips the cached folder under Xenova/all-MiniLM-L6-v2 (without source.json), and that zip imports on another machine; nothing to export when not cached', async () => {
    const [a, b, out] = [await tmp(), await tmp(), await tmp()]; dirs.push(a, b, out);
    const envA = envWith({ CAFE_MODEL_DIR: a }); const envB = envWith({ CAFE_MODEL_DIR: b });
    await expect(exportModel(path.join(out, 'x.zip'), envA)).rejects.toThrow('nothing to export');
    await fabricate(a, EMBED_MODEL);
    await fs.writeFile(path.join(await modelFolder(envA), 'source.json'), JSON.stringify({ kind: 'hub', from: 'https://huggingface.co/', at: 't' }));
    const r = await exportModel(path.join(out, 'deep', 'model.zip'), envA);
    expect(r).toMatchObject({ zip: path.join(out, 'deep', 'model.zip'), files: ['config.json', 'onnx/model_quantized.onnx', 'tokenizer.json', 'tokenizer_config.json'] });
    const names = Object.keys(unzipSync(new Uint8Array(await fs.readFile(r.zip)))).filter((n) => !n.endsWith('/')).sort();
    expect(names).toEqual(MODEL_FILES.map((f) => `${EMBED_MODEL}/${f}`).sort());
    const imported = await importModel(r.zip, envB, '2026-10-28T11:00:00.000Z');
    expect(imported.files).toEqual(['config.json', 'onnx/model_quantized.onnx', 'tokenizer.json', 'tokenizer_config.json']);
    expect(await modelCached(envB)).toBe(true);
    expect(Buffer.from(await fs.readFile(path.join(await modelFolder(envB), 'onnx', 'model_quantized.onnx')))).toEqual(Buffer.alloc(2048, 7));
    expect(await readSource(envB)).toMatchObject({ kind: 'import', from: r.zip });
  });
});

describe('a Run with the model not here', () => {
  it('offline: fails fast with the message, before the library is loaded', async () => {
    const dir = await tmp(); dirs.push(dir);
    const t0 = Date.now();
    const emb = realEmbedder(envWith({ CAFE_MODEL_DIR: dir, CAFE_MODEL_OFFLINE: '1' }));
    await expect(emb.embed(['a passage'])).rejects.toThrow(waysIn(await modelOptions(envWith({ CAFE_MODEL_DIR: dir, CAFE_MODEL_OFFLINE: '1' }))));
    expect(Date.now() - t0).toBeLessThan(500);
    // The settings say offline when the environment says nothing.
    const emb2 = realEmbedder(envWith({ CAFE_MODEL_DIR: dir }), async () => ({ offline: true }));
    await expect(emb2.embed(['a passage'])).rejects.toThrow('downloads are off (CAFE_MODEL_OFFLINE=1)');
    expect(await modelCached(envWith({ CAFE_MODEL_DIR: dir }))).toBe(false);
  });

  it('the network blocked (a mirror at a port nothing listens on): the real load fails and the error is the message, not a stack trace; the hub is never asked', async () => {
    const dir = await tmp(); dirs.push(dir);
    const asked: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((input: string | URL, init?: RequestInit) => { asked.push(String(input)); return realFetch(input, init); }) as typeof fetch;
    try {
      const emb = realEmbedder(envWith({ CAFE_MODEL_DIR: dir, CAFE_MODEL_MIRROR: 'http://127.0.0.1:9/hf' }));
      const err = await emb.embed(['a passage']).then(() => null, (e: Error) => e);
      expect(err).not.toBeNull();
      expect(isWaysIn(err!.message)).toBe(true);
      expect(err!.message).toContain('the mirror http://127.0.0.1:9/hf/ did not answer (');
      expect(err!.message).toContain('cafe model import <folder-or-zip>');
      expect(err!.message).not.toMatch(/\n\s+at /);
      expect(asked.length).toBeGreaterThan(0);
      expect(asked.every((u) => u.startsWith('http://127.0.0.1:9/hf/Xenova/all-MiniLM-L6-v2/'))).toBe(true);
      expect(asked.some((u) => u.includes('huggingface.co'))).toBe(false);
    } finally { globalThis.fetch = realFetch; }
    expect(await modelCached(envWith({ CAFE_MODEL_DIR: dir }))).toBe(false);
    expect(await readSource(envWith({ CAFE_MODEL_DIR: dir }))).toBeUndefined();
  }, 60_000);
});

describe('the memory route', () => {
  const was = { embed: process.env.CAFE_EMBED_FAKE, offline: process.env.CAFE_MODEL_OFFLINE, ai: process.env.CAFE_AI_FAKE };
  beforeAll(() => { delete process.env.CAFE_EMBED_FAKE; process.env.CAFE_MODEL_OFFLINE = '1'; process.env.CAFE_AI_FAKE = '1'; });
  afterAll(() => { process.env.CAFE_EMBED_FAKE = was.embed; process.env.CAFE_MODEL_OFFLINE = was.offline; process.env.CAFE_AI_FAKE = was.ai; if (was.embed === undefined) delete process.env.CAFE_EMBED_FAKE; if (was.offline === undefined) delete process.env.CAFE_MODEL_OFFLINE; });
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => { await close?.(); close = undefined; });

  it('offline and the model not here: the view carries the message before any Run, the Run fails fast with it, and the settings file can set the mirror', async () => {
    const s = await startServer('2026-10-19', { upkeep: { quietMs: 60_000, maxMs: 60_000 } });
    close = () => new Promise<void>((resolve) => { s.server.close(() => resolve()); s.server.closeAllConnections(); });
    await saveIdea(s.root, sampleIdea({ challenge: 'Contracts are summarised by hand every week.' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const get = (): Promise<any> => fetch(`${s.base}/api/memory`).then((r) => r.json());
    const m = await get();
    expect(m.model).toMatchObject({ id: EMBED_MODEL, cached: false, offline: true });
    expect(m.model.mirror).toBeUndefined();
    expect(isWaysIn(m.model.help)).toBe(true);
    expect(m.model.help).toContain('downloads are off (CAFE_MODEL_OFFLINE=1)');
    await fetch(`${s.base}/api/memory/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    let after = await get();
    for (let i = 0; i < 100 && after.job.status === 'running'; i++) { await new Promise((r) => setTimeout(r, 20)); after = await get(); }
    expect(after.job.status).toBe('error');
    expect(after.job.error).toBe(after.model.help);
    expect(after.job.error).not.toMatch(/\n\s+at /);
    // The mirror from rules/settings.yaml shows in the view.
    await writeYaml(paths(s.root).settings, { deepRead: { modelMirror: 'https://artifacts.firm/hf' } });
    expect((await get()).model.mirror).toBe('https://artifacts.firm/hf/');
  });
});
