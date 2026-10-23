/**
 * Each person's photo for the team slide. The operator types the path of a picture on this computer (or picks the file):
 * the app checks it is a picture (named and shaped as one, at most 5 MB, never a folder), then COPIES it into the idea
 * folder's roadshow/photos/<person>.<ext>, so the deck never depends on the original. Nothing that is not a picture is
 * read: the name and size are checked first, then the first bytes, and only then the rest. Photos never go to the AI.
 */
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { Clock } from '../clock';
import { writeFileAtomic } from '../workspace/files';
import { ideaDir, loadIdea } from '../ideas/store';
import { PHOTO_DIR, readRoadshow, roadshowDir, rosterOf, writeRoadshow, type RoadshowState } from './store';

export const PHOTO_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif'] as const;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export type ImageKind = 'png' | 'jpg' | 'webp' | 'gif';
export const IMAGE_MIME: Record<ImageKind, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

export class PhotoError extends Error {}

const ONLY = 'Only a picture can be used: a .png, .jpg, .jpeg, .webp or .gif file';

/** The kind of picture the bytes are, by their signature; undefined for anything else. */
export function imageKind(b: Uint8Array): ImageKind | undefined {
  const at = (i: number, ...xs: number[]) => xs.every((x, k) => b[i + k] === x);
  if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return 'jpg';
  if (b.length >= 6 && (at(0, 0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || at(0, 0x47, 0x49, 0x46, 0x38, 0x39, 0x61))) return 'gif';
  if (b.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp';
  return undefined;
}

/** A picture's width and height from its header (PNG, GIF, JPEG, WebP); undefined when it cannot tell. */
export function imageSize(b: Uint8Array): { w: number; h: number } | undefined {
  const kind = imageKind(b);
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u16le = (i: number) => b[i] | (b[i + 1] << 8);
  const u32be = (i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const ok = (s?: { w: number; h: number }) => (s && s.w > 0 && s.h > 0 ? s : undefined);
  if (kind === 'png' && b.length >= 24) return ok({ w: u32be(16), h: u32be(20) });
  if (kind === 'gif' && b.length >= 10) return ok({ w: u16le(6), h: u16le(8) });
  if (kind === 'webp' && b.length >= 30) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === 'VP8X') return ok({ w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) });
    if (chunk === 'VP8 ') return ok({ w: u16le(26) & 0x3fff, h: u16le(28) & 0x3fff });
    if (chunk === 'VP8L') { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return ok({ w: 1 + (v & 0x3fff), h: 1 + ((v >>> 14) & 0x3fff) }); }
    return undefined;
  }
  if (kind === 'jpg') {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return ok({ h: u16be(i + 5), w: u16be(i + 7) });
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      i += 2 + u16be(i + 2);
    }
  }
  return undefined;
}

/**
 * A path as the operator pasted it: surrounding quotes taken off (Windows' "Copy as path" adds them), "~" for the home
 * folder, and a file:// link read as its path. Must be a full path on this computer.
 */
export function cleanPhotoPath(raw: unknown): string {
  let p = String(raw ?? '').trim().replace(/^(["'])(.*)\1$/, '$2').trim();
  if (/^file:\/\//i.test(p)) { try { p = decodeURIComponent(new URL(p).pathname); if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1); } catch { /* left as typed */ } }
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(1));
  if (!p) throw new PhotoError('Type the path of a picture on this computer, such as /Users/you/Pictures/photo.jpg or C:\\Users\\you\\photo.png');
  if (!path.isAbsolute(p) && !/^[A-Za-z]:[\\/]/.test(p)) throw new PhotoError('Type the full path of the picture, from the top: /Users/… on a Mac, C:\\… on Windows');
  return p;
}

const extOf = (name: string) => path.extname(name).slice(1).toLowerCase();

/** Name, then size: checked before a single byte is read. */
function checkName(name: string): void {
  if (!(PHOTO_EXTS as readonly string[]).includes(extOf(name))) throw new PhotoError(ONLY);
}
function checkSize(bytes: number): void {
  if (bytes === 0) throw new PhotoError('That picture is empty');
  if (bytes > PHOTO_MAX_BYTES) throw new PhotoError('That picture is over 5 MB: pick a smaller one');
}
function checkBytes(b: Uint8Array): ImageKind {
  const kind = imageKind(b);
  if (!kind) throw new PhotoError(`That file is not a picture: its contents are not PNG, JPEG, WebP or GIF. ${ONLY}`);
  return kind;
}

/** Reads a picture from a path on this computer, after every check. */
export async function readPhotoFile(raw: unknown): Promise<{ bytes: Uint8Array; kind: ImageKind; file: string }> {
  const file = cleanPhotoPath(raw);
  checkName(file);
  let st;
  try { st = await fs.stat(file); } catch { throw new PhotoError(`No file at ${file}`); }
  if (st.isDirectory()) throw new PhotoError('That is a folder, not a picture');
  if (!st.isFile()) throw new PhotoError('That is not a file');
  checkSize(st.size);
  // The first bytes first: a file that is not a picture is never read further.
  const fh = await fs.open(file, 'r');
  try {
    const head = new Uint8Array(16);
    await fh.read(head, 0, 16, 0);
    checkBytes(head);
    const bytes = new Uint8Array(st.size);
    const { bytesRead } = await fh.read(bytes, 0, st.size, 0);
    const got = bytes.subarray(0, bytesRead);
    checkSize(got.length);
    return { bytes: got, kind: checkBytes(got), file };
  } finally { await fh.close(); }
}

/** Checks a picture sent from the file picker (its name and bytes). */
export function checkPhotoUpload(name: string, bytes: Uint8Array): ImageKind {
  checkName(name);
  checkSize(bytes.length);
  return checkBytes(bytes);
}

/** The person on this idea with that key, or an error. */
async function personOf(root: string, id: string, key: string) {
  const idea = await loadIdea(root, id);
  const p = rosterOf(idea).find((x) => x.key === key);
  if (!p) throw new PhotoError('That person is not on this idea');
  return p;
}

/** Stores the picture as roadshow/photos/<key>.<ext> (any other picture of theirs goes) and records it. */
async function store(root: string, id: string, key: string, bytes: Uint8Array, kind: ImageKind, from: 'path' | 'upload', clock: Clock): Promise<RoadshowState> {
  await personOf(root, id, key);
  const dir = path.join(roadshowDir(await ideaDir(root, id)), PHOTO_DIR);
  const name = `${key}.${kind}`;
  await writeFileAtomic(path.join(dir, name), bytes);
  for (const k of ['png', 'jpg', 'webp', 'gif'] as const) if (k !== kind) await fs.rm(path.join(dir, `${key}.${k}`), { force: true });
  const state = await readRoadshow(root, id);
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  state.photos[key] = { file: name, at: clock(), bytes: bytes.length, from, hash };
  await writeRoadshow(root, id, state);
  return state;
}

/** A person's photo from a path on this computer: checked, then copied into the idea folder. */
export async function setPhotoFromPath(root: string, id: string, key: string, rawPath: unknown, clock: Clock): Promise<RoadshowState> {
  await personOf(root, id, key);
  const { bytes, kind } = await readPhotoFile(rawPath);
  return store(root, id, key, bytes, kind, 'path', clock);
}

/** A person's photo from the file picker: checked, then saved in the idea folder. */
export async function setPhotoFromUpload(root: string, id: string, key: string, name: string, bytes: Uint8Array, clock: Clock): Promise<RoadshowState> {
  await personOf(root, id, key);
  const kind = checkPhotoUpload(name, bytes);
  return store(root, id, key, bytes, kind, 'upload', clock);
}

/** Takes a person's photo off the deck (the copy in the idea folder goes too; the original is never touched). */
export async function removePhoto(root: string, id: string, key: string): Promise<RoadshowState> {
  const state = await readRoadshow(root, id);
  const had = state.photos[key];
  if (!had) return state;
  await fs.rm(path.join(roadshowDir(await ideaDir(root, id)), PHOTO_DIR, had.file), { force: true });
  delete state.photos[key];
  await writeRoadshow(root, id, state);
  return state;
}

/** A stored photo's bytes, read back from the idea folder (and checked again); undefined when it is gone or spoilt. */
export async function readStoredPhoto(ideaFolder: string, file: string): Promise<{ bytes: Uint8Array; kind: ImageKind } | undefined> {
  if (!/^[a-z0-9-]{1,80}\.(png|jpg|webp|gif)$/.test(file)) return undefined;
  try {
    const p = path.join(roadshowDir(ideaFolder), PHOTO_DIR, file);
    const st = await fs.stat(p);
    if (!st.isFile() || st.size > PHOTO_MAX_BYTES) return undefined;
    const bytes = new Uint8Array(await fs.readFile(p));
    const kind = imageKind(bytes);
    return kind ? { bytes, kind } : undefined;
  } catch { return undefined; }
}
