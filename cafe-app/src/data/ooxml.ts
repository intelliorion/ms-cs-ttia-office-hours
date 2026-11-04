/**
 * A small, forgiving XML reader for Office Open XML parts (a .pptx's slides, charts, SmartArt and relationships), and
 * the zip and container checks the readers share. No dependency: the parts are machine-written and simple, so a
 * tolerant tokenizer that never throws is safer than a strict parser. DTDs are skipped and never expanded (no entity
 * tricks); only the five XML entities and numeric references are decoded.
 */
import { unzipSync } from 'fflate';

export interface XNode { name: string; local: string; attrs: Record<string, string>; kids: (XNode | string)[] }

const localOf = (name: string) => name.slice(name.indexOf(':') + 1);

/** XML entities decoded: &lt; &gt; &amp; &quot; &apos; and numeric references (an invalid one is dropped). */
export function decodeXml(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'amp') return '&';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    const n = k.startsWith('#x') ? parseInt(k.slice(2), 16) : Number(k.slice(1));
    return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
  });
}

const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Parses XML into a tree. Never throws: an unclosed element ends with the text, a stray close tag is ignored. */
export function parseXml(xml: string): XNode {
  const root: XNode = { name: '#root', local: '#root', attrs: {}, kids: [] };
  const stack: XNode[] = [root];
  const top = () => stack[stack.length - 1];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    const textEnd = lt < 0 ? n : lt;
    if (textEnd > i && stack.length > 1) top().kids.push(decodeXml(xml.slice(i, textEnd)));
    if (lt < 0) break;
    if (xml.startsWith('<!--', lt)) { const e = xml.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (xml.startsWith('<![CDATA[', lt)) {
      const e = xml.indexOf(']]>', lt + 9);
      if (stack.length > 1) top().kids.push(xml.slice(lt + 9, e < 0 ? n : e));
      i = e < 0 ? n : e + 3; continue;
    }
    if (xml.startsWith('<?', lt)) { const e = xml.indexOf('?>', lt + 2); i = e < 0 ? n : e + 2; continue; }
    if (xml.startsWith('<!', lt)) {
      // A DOCTYPE, maybe with an internal subset in [...]: skipped whole, never expanded.
      let depth = 0; let j = lt + 2;
      for (; j < n; j++) { const c = xml[j]; if (c === '[') depth++; else if (c === ']') depth--; else if (c === '>' && depth <= 0) break; }
      i = j + 1; continue;
    }
    // A tag: its end is the first > outside quotes.
    let j = lt + 1; let q = '';
    for (; j < n; j++) { const c = xml[j]; if (q) { if (c === q) q = ''; } else if (c === '"' || c === "'") q = c; else if (c === '>') break; }
    const body = xml.slice(lt + 1, j);
    i = j + 1;
    if (body.startsWith('/')) {
      const name = body.slice(1).trim();
      for (let at = stack.length - 1; at > 0; at--) if (stack[at].name === name) { stack.length = at; break; }
      continue;
    }
    const self = body.endsWith('/');
    const inner = self ? body.slice(0, -1) : body;
    const m = /^\s*([^\s/>]+)/.exec(inner);
    if (!m) continue;
    const attrs: Record<string, string> = {};
    ATTR.lastIndex = m[0].length;
    for (let a = ATTR.exec(inner); a; a = ATTR.exec(inner)) attrs[a[1]] = decodeXml(a[2] ?? a[3] ?? '');
    const el: XNode = { name: m[1], local: localOf(m[1]), attrs, kids: [] };
    top().kids.push(el);
    if (!self) stack.push(el);
  }
  return root;
}

export const isEl = (k: XNode | string | undefined): k is XNode => typeof k === 'object' && k !== null;
/** Child elements, by local name ("sp" matches p:sp), or all of them. */
export const kids = (n: XNode | undefined, local?: string): XNode[] => (n ? n.kids.filter((k): k is XNode => isEl(k) && (!local || k.local === local)) : []);
export const kid = (n: XNode | undefined, local: string): XNode | undefined => n?.kids.find((k): k is XNode => isEl(k) && k.local === local);
/** The first element down a path of local names. */
export const path = (n: XNode | undefined, ...locals: string[]): XNode | undefined => locals.reduce<XNode | undefined>((x, l) => kid(x, l), n);
/** Every descendant element with this local name, in document order. */
export function all(n: XNode | undefined, local: string, out: XNode[] = []): XNode[] {
  for (const k of n?.kids ?? []) if (isEl(k)) { if (k.local === local) out.push(k); all(k, local, out); }
  return out;
}
/** The first descendant with this local name. */
export function first(n: XNode | undefined, local: string): XNode | undefined {
  for (const k of n?.kids ?? []) if (isEl(k)) { if (k.local === local) return k; const f = first(k, local); if (f) return f; }
  return undefined;
}
/** An attribute by its local name: the unprefixed one first, then a prefixed one. */
export function attr(n: XNode | undefined, local: string): string | undefined {
  if (!n) return undefined;
  if (local in n.attrs) return n.attrs[local];
  for (const [k, v] of Object.entries(n.attrs)) if (localOf(k) === local) return v;
  return undefined;
}
/** A prefixed attribute only ("r:id", "r:embed", "r:dm"): a relationship id, never the element's own id. */
export function relAttr(n: XNode | undefined, local: string): string | undefined {
  if (!n) return undefined;
  for (const [k, v] of Object.entries(n.attrs)) if (k.includes(':') && localOf(k) === local) return v;
  return undefined;
}
/** All the text under an element. */
export function textOf(n: XNode | undefined): string {
  if (!n) return '';
  return n.kids.map((k) => (typeof k === 'string' ? k : textOf(k))).join('');
}

/* ---------- containers ---------- */

const CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
export const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
export const isCfb = (b: Uint8Array) => CFB.every((x, i) => b[i] === x);

function hasUtf16(bytes: Uint8Array, word: string): boolean {
  const pat = new Uint8Array(word.length * 2);
  for (let i = 0; i < word.length; i++) pat[i * 2] = word.charCodeAt(i);
  outer: for (let i = 0; i + pat.length <= bytes.length; i++) {
    if (bytes[i] !== pat[0]) continue;
    for (let k = 1; k < pat.length; k++) if (bytes[i + k] !== pat[k]) continue outer;
    return true;
  }
  return false;
}

/**
 * What an OLE (CFB) container holds: an Office file saved with a password (the OOXML package encrypted inside it,
 * with its EncryptionInfo stream), an old binary PowerPoint, Word or Excel file, or something else.
 */
export function cfbKind(bytes: Uint8Array): 'encrypted' | 'ppt' | 'doc' | 'xls' | 'other' | undefined {
  if (!isCfb(bytes)) return undefined;
  if (hasUtf16(bytes, 'EncryptionInfo') || hasUtf16(bytes, 'EncryptedPackage')) return 'encrypted';
  if (hasUtf16(bytes, 'PowerPoint Document')) return 'ppt';
  if (hasUtf16(bytes, 'WordDocument')) return 'doc';
  if (hasUtf16(bytes, 'Workbook') || hasUtf16(bytes, 'Book')) return 'xls';
  return 'other';
}

/** The names in a zip's directory, read without unpacking anything; undefined when it is not a readable zip. */
export function zipNames(bytes: Uint8Array): string[] | undefined {
  const names: string[] = [];
  try { unzipSync(bytes, { filter: (f) => { names.push(f.name); return false; } }); } catch { return undefined; }
  return names;
}

export class ZipLimitError extends Error {}

export interface ZipLimits { entry: number; total: number; entries: number }
export const ZIP_LIMITS: ZipLimits = { entry: 25 * 1024 * 1024, total: 80 * 1024 * 1024, entries: 20_000 };

/**
 * Unzips the entries `want` picks, guarded against a zip bomb: each entry's and the total unpacked size (as the zip's
 * directory declares it, which also bounds what fflate unpacks into) and the number of entries are capped.
 */
export function unzipGuarded(bytes: Uint8Array, want: (name: string) => boolean, limits: ZipLimits = ZIP_LIMITS): Record<string, Uint8Array> {
  let total = 0; let count = 0; let over = '';
  const out = unzipSync(bytes, {
    filter: (f) => {
      count++;
      if (count > limits.entries) { over ||= `it has over ${limits.entries.toLocaleString('en-US')} parts`; return false; }
      if (over || !want(f.name)) return false;
      if (f.originalSize > limits.entry) { over = `${f.name} unpacks to over ${Math.round(limits.entry / 1048576)} MB`; return false; }
      total += f.originalSize;
      if (total > limits.total) { over = `its slides unpack to over ${Math.round(limits.total / 1048576)} MB`; return false; }
      return true;
    },
  });
  if (over) throw new ZipLimitError(over);
  return out;
}
