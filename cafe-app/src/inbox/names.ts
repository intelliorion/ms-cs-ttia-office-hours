import { listItems } from './store';
import { PERSON_NAME, type InboxMeta } from './parse';
import { splitAddress } from './match';

const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** A mailbox, not a person: its address gives no name. */
export const ROLE_LOCAL = /^(no-?reply|do-?not-?reply|info|admin|support|help|helpdesk|team|cafe|office|enquiries|contact|service|mailbox|postmaster|notifications?|finance|expenses|hr)$/i;

/**
 * The names email addresses give away: "first.last@…" is "First Last", so the name is coded wherever the text
 * writes it, not only the address masked. A role mailbox or a one-part address gives no name.
 */
export function namesInAddresses(text: string): string[] {
  const out = new Set<string>();
  for (const a of text.match(ADDRESS) ?? []) {
    const local = a.split('@')[0];
    if (ROLE_LOCAL.test(local)) continue;
    const parts = local.split(/[._-]+/).filter(Boolean);
    if (parts.length < 2 || parts.length > 3 || !parts.every((x) => /^[A-Za-z]{2,}$/.test(x) || /^\d{1,3}$/.test(x))) continue;
    if (!/^[A-Za-z]/.test(parts[0])) continue;
    out.add(parts.map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase()).join(' '));
  }
  return [...out];
}

/** A From, To or Cc line in a forwarded or quoted email inside the text. */
const HEADER_LINE = /^[ \t]*(?:>[ \t]*)*(?:From|To|Cc|Bcc|Reply-To)[ \t]*:[ \t]*(.+)$/gim;

const nameOf = (s: string) => splitAddress(s).name.replace(/^["']|["']$/g, '').trim();

/**
 * Who an address line is, for the AI: its display name, else the name a "first.last" address gives, else nothing.
 * Never the address or its local part ("person.8" would pass the coder untouched).
 */
export const personOf = (s: string): string => nameOf(s) || (s.includes('@') ? namesInAddresses(s)[0] ?? '' : s.trim());

/**
 * Every name an imported file gives for a person the app may not know: the sender, the To and Cc lines, a meeting's
 * speakers, the From/To/Cc lines of an email quoted inside it, and "first.last" addresses. Never an address.
 */
export function namesInDrop(meta: InboxMeta | undefined, text = ''): string[] {
  const m = meta ?? {};
  const whole = [text, m.quoted ?? ''].join('\n');
  const quoted = [...whole.matchAll(HEADER_LINE)].flatMap((x) => x[1].split(/[;,]/));
  const names = [
    // A mailbox's display name ("Creators' Café <cafe@…>") is not a person.
    ...[m.from ?? '', ...(m.to ?? []), ...(m.cc ?? []), ...quoted].filter((x) => !ROLE_LOCAL.test(splitAddress(x).addr.split('@')[0])).map(nameOf),
    ...(m.speakers ?? []).map((s) => s.trim()),
    ...namesInAddresses([m.from ?? '', ...(m.to ?? []), ...(m.cc ?? []), whole].join('\n')),
  ];
  return [...new Set(names.filter((n) => n.length >= 3 && !n.includes('@')))];
}

/**
 * The people every import so far has named, so a sender or a cc stays coded later, when the AI reads an idea's text
 * again. Person-shaped names only ("First Last"): a one-word sender such as "Expenses" would code an ordinary word.
 */
export async function importedNames(root: string): Promise<string[]> {
  const items = await listItems(root).catch(() => []);
  return [...new Set(items.flatMap((i) => namesInDrop(i.meta, i.text ?? '')).filter((n) => PERSON_NAME.test(n)))];
}
