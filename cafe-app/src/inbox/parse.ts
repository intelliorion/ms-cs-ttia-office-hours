import * as msgreaderModule from '@kenjiuno/msgreader';
import type { FieldsData } from '@kenjiuno/msgreader';
import { unzipSync, strFromU8 } from 'fflate';

export type InboxType = 'export' | 'email' | 'transcript' | 'document' | 'note' | 'unknown';

export interface InboxMeta {
  from?: string;
  to?: string[];
  cc?: string[];
  subject?: string;
  date?: string;
  /** Quoted earlier messages split off a reply (our own words, not the sender's). */
  quoted?: string;
  /** Transcript speakers in order of first appearance. */
  speakers?: string[];
  /** Attachment file names of an email (never read). */
  attachments?: string[];
}

export interface ParsedDrop {
  type: InboxType;
  text: string;
  meta: InboxMeta;
  /** Raw text for the personal-data screen only (exports); never stored or sent anywhere. */
  screenText?: string;
  /** Set when the file can't be read at all yet (PDFs, images); the item should be held with this reason. */
  unreadable?: string;
  problems?: string[];
}

const ext = (name: string) => (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
const nl = (s: string) => s.replace(/\r\n?/g, '\n');

export function parseDrop(name: string, bytes: Uint8Array): ParsedDrop {
  switch (ext(name)) {
    case 'eml':
      return parseEml(bytes);
    case 'msg':
      return parseMsg(bytes);
    case 'vtt':
      return parseVtt(decode(bytes, 'utf-8'));
    case 'txt':
    case 'md':
      return { type: 'note', text: nl(decode(bytes, 'utf-8')).trim(), meta: {} };
    case 'docx':
      return parseDocx(bytes);
    case 'csv':
      return { type: 'export', text: '', meta: {}, screenText: nl(decode(bytes, 'utf-8')) };
    case 'xlsx':
      return { type: 'export', text: '', meta: {} };
    case 'pdf': case 'png': case 'jpg': case 'jpeg': case 'gif': case 'heic': case 'webp': case 'bmp': case 'tif': case 'tiff':
      return { type: 'unknown', text: '', meta: {}, unreadable: "Can't read PDFs or images yet, so it's held for you to check by hand" };
    default:
      return { type: 'unknown', text: '', meta: {}, problems: ["Can't read this kind of file"] };
  }
}

// ---------- shared helpers ----------

function decode(bytes: Uint8Array, charset = 'utf-8'): string {
  const cs = charset.toLowerCase().replace(/^"|"$/g, '');
  const label = /^(iso-8859-1|latin-?1|us-ascii|ascii)$/.test(cs) ? 'latin1' : cs;
  try {
    return new TextDecoder(label).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** A person-looking name: capitalised words, e.g. "Person 21" or "Jane Doe". */
export const PERSON_NAME = /^[A-Z][a-zA-Z'’-]+(?:\s+[A-Z0-9][a-zA-Z0-9'’-]*){1,3}$/;

const QUOTE_HEADER = /^(Sent|To|Subject|Date|Cc):/i;

function quoteStartsAt(lines: string[], i: number): boolean {
  const l = lines[i];
  if (/^>/.test(l) || /^-{3,}\s*Original Message\s*-{3,}/i.test(l)) return true;
  if (/^From: /.test(l)) return lines.slice(i + 1, i + 4).some((n) => QUOTE_HEADER.test(n.trim()));
  const t = l.trim();
  if (!/^On /.test(t)) return false;
  // Gmail wraps a long "On …, Name <addr>" line before "wrote:"
  return /^On .* wrote:$/.test(t) || (i + 1 < lines.length && /^On .* wrote:$/.test(`${t} ${lines[i + 1].trim()}`));
}

/** Split a reply into the new text and the quoted earlier message(s). */
export function splitQuoted(text: string): { text: string; quoted: string | undefined } {
  const lines = nl(text).split('\n');
  const start = lines.findIndex((_, i) => quoteStartsAt(lines, i));
  if (start < 0) return { text: text.trim(), quoted: undefined };
  let cut = start;
  while (cut > 0 && /^\s*(_{5,}|-{5,})?\s*$/.test(lines[cut - 1])) cut--; // Outlook's ____ rule and blank lines
  return { text: lines.slice(0, cut).join('\n').trim(), quoted: lines.slice(start).join('\n').trim() };
}

function withQuoted(type: InboxType, body: string, meta: InboxMeta): ParsedDrop {
  const { text, quoted } = splitQuoted(body);
  return { type, text, meta: quoted ? { ...meta, quoted } : meta };
}

function isoDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? raw.trim() : new Date(t).toISOString();
}

function compact(meta: InboxMeta): InboxMeta {
  for (const k of Object.keys(meta) as (keyof InboxMeta)[]) {
    const v = meta[k];
    if (v === undefined || (Array.isArray(v) && v.length === 0)) delete meta[k];
  }
  return meta;
}

// ---------- .eml ----------

type Headers = Map<string, string>;

function splitHead(raw: string): { headers: Headers; body: string } {
  const at = raw.indexOf('\n\n');
  const head = at < 0 ? raw : raw.slice(0, at);
  const body = at < 0 ? '' : raw.slice(at + 2);
  const headers: Headers = new Map();
  for (const line of head.replace(/\n[ \t]+/g, ' ').split('\n')) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m && !headers.has(m[1].toLowerCase())) headers.set(m[1].toLowerCase(), m[2].trim());
  }
  return { headers, body };
}

function param(value: string | undefined, key: string): string | undefined {
  const m = value?.match(new RegExp(`(?:^|;)\\s*${key}=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i'));
  return m ? decodeWords(m[1] ?? m[2]) : undefined;
}

function qpBytes(s: string): Uint8Array {
  const clean = s.replace(/=\n/g, '');
  const out: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    const hex = clean[i] === '=' ? clean.slice(i + 1, i + 3) : '';
    if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
      out.push(parseInt(hex, 16));
      i += 2;
    } else out.push(clean.charCodeAt(i) & 0xff);
  }
  return Uint8Array.from(out);
}

/** RFC 2047 encoded words in headers (=?utf-8?Q?…?= / =?utf-8?B?…?=). */
function decodeWords(s: string): string {
  return s
    .replace(/(=\?[^?]+\?[QB]\?[^?]*\?=)\s+(?==\?)/gi, '$1')
    .replace(/=\?([^?]+)\?([QB])\?([^?]*)\?=/gi, (_, cs: string, enc: string, data: string) =>
      decode(enc.toUpperCase() === 'B' ? Buffer.from(data, 'base64') : qpBytes(data.replace(/_/g, ' ')), cs),
    );
}

function bodyText(headers: Headers, body: string): string {
  const enc = (headers.get('content-transfer-encoding') ?? '').toLowerCase();
  const charset = param(headers.get('content-type'), 'charset') ?? 'utf-8';
  if (enc === 'base64') return nl(decode(Buffer.from(body.replace(/\s+/g, ''), 'base64'), charset));
  if (enc === 'quoted-printable') return nl(decode(qpBytes(body), charset));
  return nl(decode(Uint8Array.from(body, (c) => c.charCodeAt(0) & 0xff), charset));
}

interface Found { plain?: string; html?: string; attachments: string[] }

function walk(headers: Headers, body: string, found: Found): void {
  const type = (headers.get('content-type') ?? 'text/plain').toLowerCase();
  const disposition = headers.get('content-disposition') ?? '';
  const fileName = param(disposition, 'filename') ?? param(headers.get('content-type'), 'name');
  if (/^attachment/i.test(disposition) || (fileName && !type.startsWith('multipart/'))) {
    if (fileName) found.attachments.push(fileName);
    return;
  }
  if (type.startsWith('multipart/')) {
    const boundary = param(headers.get('content-type'), 'boundary');
    if (!boundary) return;
    for (const part of body.split(`--${boundary}`).slice(1)) {
      if (part.startsWith('--')) break;
      const sub = splitHead(part.replace(/^\n/, ''));
      walk(sub.headers, sub.body.replace(/\n$/, ''), found);
    }
  } else if (type.startsWith('text/plain') && found.plain === undefined) {
    found.plain = bodyText(headers, body);
  } else if (type.startsWith('text/html') && found.html === undefined) {
    found.html = bodyText(headers, body);
  }
}

function addressList(v: string | undefined): string[] | undefined {
  if (!v) return undefined;
  const list = decodeWords(v).match(/(?:"[^"]*"|[^,])+/g)?.map((s) => s.trim().replace(/^"([^"]*)"/, '$1')).filter(Boolean);
  return list?.length ? list : undefined;
}

function parseEml(bytes: Uint8Array): ParsedDrop {
  const raw = nl(decode(bytes, 'latin1')); // bytes kept 1:1; each part is decoded with its own charset
  const { headers, body } = splitHead(raw);
  const found: Found = { attachments: [] };
  walk(headers, body, found);
  const text = found.plain ?? (found.html ? htmlToText(found.html) : '');
  return withQuoted('email', text, compact({
    from: addressList(headers.get('from'))?.[0],
    to: addressList(headers.get('to')),
    cc: addressList(headers.get('cc')),
    subject: headers.has('subject') ? decodeWords(headers.get('subject')!) : undefined,
    date: isoDate(headers.get('date')),
    attachments: found.attachments,
  }));
}

function entities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function htmlToText(html: string): string {
  return entities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, ''))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------- .msg ----------

type MsgCtor = new (buf: ArrayBuffer | DataView) => { getFileData(): FieldsData };
// The package is CommonJS: under Node ESM the class sits at default.default, under bundlers at default.
const msgDefault = (msgreaderModule as unknown as { default: MsgCtor & { default?: MsgCtor } }).default;
const MsgReader: MsgCtor = msgDefault.default ?? msgDefault;

/** The msgreader fields the adapter uses; msgreader's FieldsData fits this shape. */
export interface MsgFields {
  subject?: string;
  senderName?: string;
  senderEmail?: string;
  senderSmtpAddress?: string;
  messageDeliveryTime?: string;
  clientSubmitTime?: string;
  body?: string;
  bodyHtml?: string;
  recipients?: { name?: string; email?: string; smtpAddress?: string; recipType?: 'to' | 'cc' | 'bcc' }[];
  attachments?: { fileName?: string; name?: string }[];
}

/** Adapter from msgreader's fields to a parsed email (exported for tests). */
export function msgFieldsToParsed(f: MsgFields): ParsedDrop {
  const who = (name?: string, email?: string) => (name && email && name !== email ? `${name} <${email}>` : (name ?? email));
  const recips = (kind: 'to' | 'cc') =>
    (f.recipients ?? [])
      .filter((r) => (r.recipType ?? 'to') === kind)
      .map((r) => who(r.name, r.smtpAddress ?? r.email))
      .filter((x): x is string => !!x);
  const body = nl(f.body ?? (f.bodyHtml ? htmlToText(f.bodyHtml) : ''));
  return withQuoted('email', body, compact({
    from: who(f.senderName, f.senderSmtpAddress ?? f.senderEmail),
    to: recips('to'),
    cc: recips('cc'),
    subject: f.subject,
    date: isoDate(f.messageDeliveryTime ?? f.clientSubmitTime),
    attachments: (f.attachments ?? []).map((a) => a.fileName ?? a.name).filter((x): x is string => !!x),
  }));
}

function parseMsg(bytes: Uint8Array): ParsedDrop {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const fields = new MsgReader(view).getFileData();
    if (fields.error) throw new Error(fields.error);
    return msgFieldsToParsed(fields);
  } catch (e) {
    return { type: 'email', text: '', meta: {}, problems: [`Couldn't read this Outlook email (${(e as Error).message})`] };
  }
}

// ---------- .vtt ----------

function parseVtt(raw: string): ParsedDrop {
  const lines: string[] = [];
  const speakers: string[] = [];
  for (const block of nl(raw).split(/\n{2,}/)) {
    const rows = block.split('\n');
    const timing = rows.findIndex((r) => r.includes('-->'));
    if (timing < 0) continue;
    const cue = rows.slice(timing + 1).join(' ').trim();
    if (!cue) continue;
    let speaker = cue.match(/^<v(?:\.[^ >]*)?\s+([^>]+)>/)?.[1].trim();
    let said = entities(cue.replace(/<[^>]+>/g, '')).trim();
    if (!speaker) {
      const m = said.match(/^([^:]{1,60}):\s+(.*)$/);
      if (m && PERSON_NAME.test(m[1].trim())) [speaker, said] = [m[1].trim(), m[2]];
    }
    if (speaker && !speakers.includes(speaker)) speakers.push(speaker);
    lines.push(speaker ? `${speaker}: ${said}` : said);
  }
  return { type: 'transcript', text: lines.join('\n'), meta: speakers.length ? { speakers } : {} };
}

// ---------- .docx ----------

const DOCX_XML_MAX = 20 * 1024 * 1024;

function parseDocx(bytes: Uint8Array): ParsedDrop {
  try {
    let tooBig = false;
    const xml = unzipSync(bytes, {
      filter: (f) => {
        if (f.name !== 'word/document.xml') return false;
        if (f.originalSize > DOCX_XML_MAX) tooBig = true;
        return !tooBig;
      },
    })['word/document.xml'];
    if (tooBig) throw new Error('its text is too big to read, over 20 MB');
    if (!xml) throw new Error('no word/document.xml');
    const text = entities(
      strFromU8(xml)
        .replace(/<w:tab\/>/g, '\t')
        .replace(/<\/w:p>(?=\s*<\/w:tc>)/g, '') // a cell's last paragraph ends with the cell
        .replace(/<\/w:tc>/g, '\t')
        .replace(/<\/w:tr>/g, '\n')
        .replace(/<w:br\/>|<\/w:p>/g, '\n')
        .replace(/<[^>]+>/g, ''),
    )
      .replace(/\t+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { type: 'document', text, meta: {} };
  } catch (e) {
    return { type: 'document', text: '', meta: {}, problems: [`Couldn't read this Word document (${(e as Error).message})`] };
  }
}
