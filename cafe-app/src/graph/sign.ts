import os from 'node:os';
import path from 'node:path';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { paths } from '../workspace/paths';
import { readText, writeFileAtomic } from '../workspace/files';

/**
 * The key that signs the operator's Do it records (graph/confirmations.jsonl). It is kept outside the workspace, in
 * ~/.cafe-ai/keys/<workspace id> (CAFE_KEYS_DIR when set, for tests), readable by the operator's account only, so
 * editing the workspace's files (ai-links.jsonl and confirmations.jsonl together) cannot make a confirmation the
 * app did not record: the signature would not match. The workspace id is rules/workspace-id, written once.
 *
 * What it does not stop, said plainly: anyone who can run code as the operator's account can read the key and sign a
 * line, as the app does. It proves a record came from this app on this account, not that a person pressed Do it.
 */
const ID_FILE = (root: string) => path.join(paths(root).rules, 'workspace-id');
const keysDir = (env: NodeJS.ProcessEnv = process.env) => env.CAFE_KEYS_DIR?.trim() || path.join(env.HOME?.trim() || os.homedir(), '.cafe-ai', 'keys');

/** The workspace's id (rules/workspace-id), made when first needed and `create` is set. */
export async function workspaceId(root: string, create = false): Promise<string | undefined> {
  const have = (await readText(ID_FILE(root)))?.trim();
  if (have && /^[A-Za-z0-9-]{8,64}$/.test(have)) return have;
  if (!create) return undefined;
  const id = randomUUID();
  await writeFileAtomic(ID_FILE(root), `${id}\n`);
  return id;
}

/** Where the workspace's key is (shown in messages), or undefined with no workspace id yet. */
export async function keyPath(root: string): Promise<string | undefined> {
  const id = await workspaceId(root);
  return id ? path.join(keysDir(), id) : undefined;
}

const keys = new Map<string, Buffer>();
/** The workspace's signing key: read from outside the workspace, made (with the id) when `create` is set and there is none. */
export async function signingKey(root: string, create = false): Promise<Buffer | undefined> {
  const id = await workspaceId(root, create);
  if (!id) return undefined;
  const file = path.join(keysDir(), id);
  const cached = keys.get(file);
  if (cached) return cached;
  const text = (await readText(file).catch(() => undefined))?.trim();
  if (text && /^[0-9a-f]{64}$/.test(text)) { const k = Buffer.from(text, 'hex'); keys.set(file, k); return k; }
  if (!create) return undefined;
  const k = randomBytes(32);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, `${k.toString('hex')}\n`, { mode: 0o600, flag: 'wx' }).catch(async (e: NodeJS.ErrnoException) => {
    if (e.code !== 'EEXIST') throw e;
  });
  // Another process may have made it first: the file wins.
  const back = (await readText(file))?.trim();
  const key = back && /^[0-9a-f]{64}$/.test(back) ? Buffer.from(back, 'hex') : k;
  keys.set(file, key);
  return key;
}
/** Forgets cached keys (tests that move the keys folder). */
export const forgetKeys = () => keys.clear();

/** The signature of one record, chained to the one before it (prev: its signature, '' for the first). */
export function sign(key: Buffer, fields: unknown[], prev: string): string {
  return createHmac('sha256', key).update(JSON.stringify([...fields, prev])).digest('hex');
}
export function sameMac(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !/^[0-9a-f]+$/.test(a)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
