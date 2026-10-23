/**
 * The Data step's Check: the Café data rule, in code, before anything reaches the AI. A proof of concept uses
 * synthetic, sample, masked or aggregated data only, so a dropped file is looked through for personal or client data:
 * email addresses, phone numbers, card and bank numbers, employee or account numbers, people's names (the idea's
 * people, or a name column) and sensitive details. A table is checked column by column; a document with the Import's
 * screen. Anything found holds the file until the operator says it is masked or synthetic (or removes it), and the
 * columns found are masked in everything the AI sees, even then. No AI here.
 */
import { PERSON_NAME } from '../inbox/parse';
import { screen } from '../inbox/screen';
import type { DataCheck, Finding, FindingKind } from './model';
import type { ReadResult, ReadTable } from './read';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EMAIL_ONE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
/** Reserved for examples (RFC 2606): an address there is made up. */
const EXAMPLE_DOMAIN = /@(?:[\w-]+\.)*(?:example\.(?:com|org|net)|[\w-]+\.(?:test|example|invalid))$/i;
const ROLE_MAILBOX = /^(no-?reply|do-?not-?reply|info|admin|support|help|helpdesk|team|cafe|office|enquiries|contact|service|mailbox|postmaster|notifications?|finance|expenses|hr)$/i;
const PHONE = /(?<![\w+])(?:\+\d{1,3}[ .-]?)?(?:\(\d{1,5}\)[ .-]?)?\d{2,6}(?:[ .-]\d{2,6}){1,4}(?![\w])/g;
const NOT_PHONES = [
  /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/g,
  /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g,
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
  /\b\d{1,3}(?:\.\d{1,3}){3}\b/g,
  /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g,
];
const CARD = /\b(?:\d[ -]?){12,18}\d\b/g;
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g;

/** A made-up stand-in for a person: "Person 3", "Employee_12", "EMP-0042". Never a name. */
export const PLACEHOLDER = /^(person|employee|emp|user|staff|client|customer|cust|member|approver|manager|requester|claimant|submitter|traveller|traveler|vendor|supplier)[ _-]?#?\d+$/i;
/** A value that is visibly masked: stars, XXX, ###, <tags>, REDACTED, or a hash. */
export const MASKED_VALUE = /^(?:.*\*{2,}.*|.*[Xx]{3,}.*|.*#{2,}.*|<[^>]{1,20}>|redacted|masked|withheld|anonymi[sz]ed|[0-9a-f]{16,})$/i;

const NAME_HEADER = /(^|[\s_-])(full[\s_-]?name|first[\s_-]?name|last[\s_-]?name|surname|name|employee|staff|approver|manager|requester|submitter|claimant|traveller|traveler|owner|person|client|customer|payee|beneficiary)([\s_-]|$)/i;
const NOT_NAME_HEADER = /(id|number|no|code|ref|type|count|role|team|dept|department|grade|level|category|status|date)$/i;
const ID_HEADER = /(^|[\s_-])(employee|emp|staff|person|user|customer|client|member|account|acct|payroll|national[\s_-]?insurance|ni|ssn|social[\s_-]?security|passport|sort[\s_-]?code|iban|card)([\s_-]*(id|no|num|number|code|ref))?$/i;
const SENSITIVE_HEADER = /(salary|wage|date[\s_-]?of[\s_-]?birth|\bdob\b|birth[\s_-]?date|passport|ssn|social[\s_-]?security|national[\s_-]?insurance|home[\s_-]?address|postcode|zip[\s_-]?code|gender|ethnicity|religion|health|medical|sickness|disability)/i;
const EMAIL_HEADER = /e-?mail/i;
const PHONE_HEADER = /(phone|mobile|tel\b|telephone|cell)/i;

export const luhn = (digits: string): boolean => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return digits.length >= 13 && digits.length <= 19 && sum % 10 === 0;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function phonesIn(text: string): string[] {
  const t = NOT_PHONES.reduce((x, re) => x.replace(re, ' ; '), text);
  return (t.match(PHONE) ?? []).map((p) => p.replace(/\D/g, '')).filter((d) => d.length >= 9 && d.length <= 15);
}
const cardsIn = (text: string) => (text.match(CARD) ?? []).map((c) => c.replace(/\D/g, '')).filter(luhn);
const ibansIn = (text: string) => (text.match(IBAN) ?? []).map((x) => x.replace(/\s/g, '')).filter((x) => x.length >= 15 && /\d{6,}/.test(x));
const personalEmails = (text: string) => [...new Set((text.match(EMAIL) ?? []).map((e) => e.toLowerCase()))]
  .filter((e) => !EXAMPLE_DOMAIN.test(e) && !ROLE_MAILBOX.test(e.split('@')[0]));

/**
 * Masks what the check looks for in any text the AI or the page sees: email addresses, card and bank numbers, phone
 * numbers. (Columns the check flagged are masked whole, by maskTable.)
 */
export function maskText(text: string): string {
  let out = text.replace(EMAIL, '<email>');
  out = out.replace(CARD, (m) => (luhn(m.replace(/\D/g, '')) ? '<card>' : m));
  out = out.replace(IBAN, (m) => (m.replace(/\s/g, '').length >= 15 && /\d{6,}/.test(m) ? '<bank>' : m));
  // Phones last, on what is left, never touching dates, times or amounts.
  const keep: string[] = [];
  const shielded = NOT_PHONES.reduce((x, re) => x.replace(re, (m) => { keep.push(m); return `\u0000${keep.length - 1}\u0000`; }), out);
  const masked = shielded.replace(PHONE, (m) => { const d = m.replace(/\D/g, ''); return d.length >= 9 && d.length <= 15 ? '<phone>' : m; });
  return masked.replace(/\u0000(\d+)\u0000/g, (_, i: string) => keep[Number(i)]);
}

/** The known people's names in a text, masked as <name> (the idea's people, everyone on any idea). */
export function maskNames(text: string, known: string[]): string {
  let out = text;
  for (const n of [...known].filter((x) => x.trim().length >= 3).sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'giu'), '<name>');
  }
  return out;
}

interface ColumnHit { kind: FindingKind; count: number; why: string }

/** What one column holds that the Café rule cares about; undefined when nothing. Also says when it looks masked. */
export function checkColumn(header: string, values: string[], known: Set<string>): { hit?: ColumnHit; note?: string } {
  const filled = values.map((v) => v.trim()).filter(Boolean);
  if (!filled.length) return {};
  const distinct = [...new Set(filled)];
  const masked = filled.filter((v) => MASKED_VALUE.test(v) || PLACEHOLDER.test(v)).length;
  const looksMasked = masked >= filled.length * 0.8;
  const knownHits = distinct.filter((v) => known.has(norm(v)));
  if (knownHits.length) return { hit: { kind: 'name', count: knownHits.length, why: `${header} names people on the Café's ideas` } };
  if (SENSITIVE_HEADER.test(header) && !looksMasked) return { hit: { kind: 'sensitive', count: distinct.length, why: `${header} looks like a sensitive personal detail` } };
  const emails = personalEmails(filled.join('\n'));
  if (emails.length >= 3 || (EMAIL_HEADER.test(header) && emails.length >= 1)) return { hit: { kind: 'email', count: emails.length, why: `${header} holds ${emails.length} email address${emails.length === 1 ? '' : 'es'}` } };
  const phones = [...new Set(phonesIn(filled.join(' ; ')))];
  if (phones.length >= 3 || (PHONE_HEADER.test(header) && phones.length >= 1)) return { hit: { kind: 'phone', count: phones.length, why: `${header} holds ${phones.length} phone number${phones.length === 1 ? '' : 's'}` } };
  const cards = [...new Set(cardsIn(filled.join(' ; ')))];
  if (cards.length) return { hit: { kind: 'card', count: cards.length, why: `${header} holds ${cards.length} card number${cards.length === 1 ? '' : 's'}` } };
  const ibans = [...new Set(ibansIn(filled.join(' ; ')))];
  if (ibans.length) return { hit: { kind: 'bank', count: ibans.length, why: `${header} holds ${ibans.length} bank account number${ibans.length === 1 ? '' : 's'}` } };
  if (looksMasked) return { note: `${header} looks masked or made up` };
  // A personal number is one per person: a short list of codes (a cost account) is not one.
  if (ID_HEADER.test(header.trim()) && (distinct.length >= 10 || distinct.length >= filled.length * 0.5)) return { hit: { kind: 'id', count: distinct.length, why: `${header} looks like ${/account|acct|iban|sort|card/i.test(header) ? 'account' : 'employee or personal'} numbers` } };
  if (NAME_HEADER.test(header) && !NOT_NAME_HEADER.test(header.trim())) {
    const names = distinct.filter((v) => PERSON_NAME.test(v) && !PLACEHOLDER.test(v));
    if (names.length >= 3 && names.length >= distinct.length * 0.5) return { hit: { kind: 'name', count: names.length, why: `${header} lists ${names.length} people by name` } };
  }
  return {};
}

export function checkTable(t: ReadTable, known: Set<string>): { findings: Finding[]; masked: string[]; notes: string[] } {
  const findings: Finding[] = []; const masked: string[] = []; const notes: string[] = [];
  t.header.forEach((h, i) => {
    const { hit, note } = checkColumn(h, t.rows.map((r) => r[i] ?? ''), known);
    if (hit) { findings.push({ ...hit, column: h }); masked.push(h); }
    if (note) notes.push(note);
  });
  return { findings, masked, notes };
}

/** A document, an email or a picture's text: the Import's screen, plus card and bank numbers. */
export function checkText(text: string, r: Pick<ReadResult, 'meta'>, fileName: string, known: string[]): Finding[] {
  const out: Finding[] = [];
  const s = screen(text, { from: r.meta.from, to: r.meta.to, cc: r.meta.cc, attachments: r.meta.attachments, fileName, knownParticipants: known });
  for (const why of s.reasons) {
    const kind: FindingKind = /email/.test(why) ? 'email' : /phone/.test(why) ? 'phone' : /ID numbers/.test(why) ? 'id' : /by name|names|tracker/.test(why) ? 'name' : 'sensitive';
    out.push({ kind, count: Number(/\d+/.exec(why)?.[0] ?? 1), why });
  }
  const cards = [...new Set(cardsIn(text))];
  if (cards.length) out.push({ kind: 'card', count: cards.length, why: `Has ${cards.length} card number${cards.length === 1 ? '' : 's'}` });
  const ibans = [...new Set(ibansIn(text))];
  if (ibans.length) out.push({ kind: 'bank', count: ibans.length, why: `Has ${ibans.length} bank account number${ibans.length === 1 ? '' : 's'}` });
  return out;
}

/** The whole check of a read file: held when anything is found (the operator decides), clear otherwise. */
export function checkRead(r: ReadResult, fileName: string, known: string[]): DataCheck {
  const knownSet = new Set(known.map(norm).filter((x) => x.length >= 3));
  if (r.tables?.length) {
    const all = r.tables.map((t) => checkTable(t, knownSet));
    const qualify = r.tables.length > 1;
    const findings = all.flatMap((x, i) => x.findings.map((f) => ({ ...f, ...(qualify ? { column: `${r.tables![i].name}: ${f.column}` } : {}) })));
    return { status: findings.length ? 'held' : 'clear', findings, masked: [...new Set(all.flatMap((x) => x.masked))], notes: [...new Set(all.flatMap((x) => x.notes))] };
  }
  const findings = checkText(r.text ?? '', r, fileName, known);
  return { status: findings.length ? 'held' : 'clear', findings, masked: [], notes: [] };
}

/** The one-line reason a held file shows. */
export const heldWords = (c: DataCheck) => c.findings.map((f) => f.why).slice(0, 3).join('; ');
