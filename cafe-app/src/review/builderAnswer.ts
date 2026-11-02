import { matchPerson, plainName } from '../ideas/people';

/**
 * The review's builder and attendance questions, read by the code, not the AI: a bare name, a list of names, "yes" or
 * "no", or a name with "yes, she can attend" is simple enough to read exactly. Anything longer is left to the AI.
 * A leaf module (it imports only the people helpers).
 */

/** The question asks who builds it. */
export const asksBuilder = (s: string) => /\bbuild(?:s|er|ers)?\b/i.test(s);
/** The question asks whether they can attend the sessions. */
export const asksAttend = (s: string) => /\battend|\bevery session|\ball (?:the |design )?sessions|\bjoin (?:the |every |all )?(?:design )?sessions?/i.test(s);

const NO = /\b(?:no|nope|not|cannot|can't|cant|unable|won't|wont)\b/i;
const YES = /\b(?:yes|yep|yeah|yup|sure|ok|okay|correct|confirmed|can|will|able|both|all)\b/i;
/** Words that say who or whether, never part of a name. */
const FILLER = new Set(('yes yep yeah yup sure ok okay correct confirmed no nope not cannot cant can\'t unable won\'t wont '
  + 'he she they them him her both all everyone each and or also too can could will would shall should is are am be '
  + 'being able attend attends attending every session sessions design build builds builder builders building '
  + 'the it this that a an of to for from in on at with as our my me i we us who which please thanks thank you '
  + 'available availability join joining time full part named name person people one two three mr mrs ms dr '
  + 'make makes come comes there present go goes do does did lead leads help helps work works own owns sure fine happy').split(/\s+/));
const key = (s: string) => plainName(s) || s.trim().toLowerCase();
const bare = (w: string) => w.toLowerCase().replace(/’/g, '\'').replace(/[.!?,]+$/g, '');

export interface BuilderReading {
  /** The whole answer was names and yes or no: the code read it all, the AI is not needed for it. */
  simple: boolean;
  /** The builders it names, as the Café knows them (or as typed, for a full name the Café has not seen). */
  builders: string[];
  /** Full names the Café did not know yet: they join the team. */
  newPeople: string[];
  canAttend?: boolean;
  /** Why the answer cannot be used as it is, in plain words for the operator. */
  problem?: string;
}

/** The names a short answer gives, each as written, split at commas, "and", "&", "/", dashes and new lines. */
function namesIn(answer: string, known: readonly string[]): { names: string[]; simple: boolean } {
  const knownWords = new Set(known.flatMap((k) => key(k).split(' ')));
  const parts = answer.split(/[,;\n/&+]|\s[-–—]\s|[()]|:|\.\s|\band\b|\bor\b/i).map((p) => p.trim()).filter(Boolean);
  const names: string[] = [];
  let simple = true;
  for (const part of parts) {
    const words = part.replace(/[.!?]+$/g, '').split(/\s+/).filter(Boolean);
    const kept = words.filter((w) => !FILLER.has(bare(w)));
    if (!kept.length) continue;
    // A name is one to four words, none with a digit; anything else is a sentence for the AI.
    if (kept.length > 4 || kept.some((w) => /\d|@/.test(w))) { simple = false; continue; }
    // A word in lower case that is no one's name ("our analyst") makes it a phrase, not a name.
    if (kept.some((w) => !/^\p{Lu}/u.test(w) && !knownWords.has(key(w)))) { simple = false; continue; }
    names.push(kept.join(' '));
  }
  return { names, simple };
}


/**
 * The person a written name means among `known`: the same name, a fuller or misspelt one (matchPerson), or, for one
 * word, the only person with that first or last name. Two people with that word, or nobody, is a problem to say.
 */
export function resolvePerson(name: string, known: readonly string[]): { name?: string; isNew?: boolean; problem?: string } {
  const people = [...new Set(known.map((k) => k.trim()).filter(Boolean))];
  const n = key(name);
  const same = people.filter((k) => key(k) === n);
  if (same.length === 1) return { name: same[0] };
  if (n.split(' ').length >= 2) {
    const hit = matchPerson(name, people);
    if (hit) return { name: hit };
    // A full name the Café has not seen: a new person, as written (a lower-case one is a phrase, not a name).
    return /^\p{Lu}/u.test(name.trim()) ? { name: name.trim(), isNew: true } : { problem: `"${name}" does not read as a person's name: give the builder's full name.` };
  }
  const hits = people.filter((k) => key(k).split(' ').includes(n)).sort((a, b) => a.localeCompare(b));
  if (hits.length === 1) return { name: hits[0] };
  if (hits.length > 1) {
    const list = hits.length > 2 ? `${hits.slice(0, -1).join(', ')} or ${hits.at(-1)}` : hits.join(' or ');
    return { problem: `Give the builder's full name: "${name}" could be ${list}.` };
  }
  return { problem: `Give the builder's full name: no one called "${name}" is known to the Café yet, and one name alone is not enough to add them.` };
}

/** Several names in one string ("[P1], [P2]" decoded, "A and B"): each piece, as written. */
export const splitNames = (s: string): string[] => s.split(/[,;\n/&+]|\band\b/i).map((x) => x.trim()).filter(Boolean);

/** One answer to the builder or attendance question, read by the code. */
export function readBuilderAnswer(answer: string, ask: string, known: readonly string[]): BuilderReading {
  const text = answer.trim();
  const out: BuilderReading = { simple: false, builders: [], newPeople: [] };
  if (!text) return out;
  const hasNo = NO.test(text);
  const hasYes = YES.test(text);
  if (asksAttend(ask) && (hasNo || hasYes)) out.canAttend = !hasNo;
  if (!asksBuilder(ask)) {
    out.simple = out.canAttend !== undefined && text.split(/\s+/).length <= 12;
    return out;
  }
  const { names, simple } = namesIn(text, known);
  out.simple = simple && (names.length > 0 || out.canAttend !== undefined);
  if (!out.simple) return out;
  for (const raw of names) {
    const r = resolvePerson(raw, known);
    if (r.problem) { out.problem ??= r.problem; continue; }
    if (r.name && !out.builders.includes(r.name)) { out.builders.push(r.name); if (r.isNew) out.newPeople.push(r.name); }
  }
  return out;
}

export const joinNames = (xs: readonly string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0] ?? '');

export interface BuilderCheck {
  ok: boolean;
  /** What the page says under the answer: how it was read, or why it cannot be used. */
  text: string;
  /** Every part of the question is answered (the builder, and attendance when it is asked). */
  complete: boolean;
  builders: string[];
  canAttend?: boolean;
}

/** How the code read an answer to the builder or attendance question, in the operator's words. `current`: the builders the idea has. */
export function builderCheck(r: BuilderReading, ask: string, current: readonly string[]): BuilderCheck {
  const base = { builders: r.builders, ...(r.canAttend !== undefined ? { canAttend: r.canAttend } : {}) };
  if (r.problem) return { ...base, ok: false, text: r.problem, complete: false };
  const wantsBuilder = asksBuilder(ask);
  const wantsAttend = asksAttend(ask);
  // "Yes" to "can they attend" is about the builder the idea has.
  const builders = r.builders.length ? r.builders : [...current];
  const at = { ...base, builders };
  if (!builders.length) {
    return { ...at, ok: false, complete: false, text: wantsBuilder
      ? 'Name the builder too: the answer says whether they can attend, not who builds it.'
      : `"${r.canAttend ? 'Yes' : 'No'}" noted, but no builder is named yet: answer who builds it first.` };
  }
  const who = `${builders.length > 1 ? 'builders' : 'builder'} ${joinNames(builders)}${r.newPeople.length ? ` (new to the Café, added to the team: ${joinNames(r.newPeople)})` : ''}`;
  if (wantsAttend && r.canAttend === undefined) {
    return { ...at, ok: true, complete: false, text: `Read as: ${who}. Not said yet: can ${builders.length > 1 ? 'they' : 'they'} attend every session? Add "yes" or "no".` };
  }
  if (r.canAttend === false) {
    return { ...at, ok: true, complete: true, text: `Read as: ${who}; cannot attend every session. This stays open: the design series needs the builder at every session.` };
  }
  return { ...at, ok: true, complete: true, text: `Read as: ${who}${wantsAttend ? '; can attend every session' : ''}.` };
}
