/**
 * Launch and Learn's roadshow: what it keeps beside the design files in the idea folder. roadshow.yaml holds the
 * to-do list (what the story still needs from the team), each person's photo (copied into roadshow/photos/) and the
 * last deck the AI wrote (its slides and script, as data); the files the app draws from it live in roadshow/.
 */
import path from 'node:path';
import { readYaml, writeYaml } from '../workspace/files';
import { ideaDir } from '../ideas/store';
import type { Idea, PrepNeed, PersonRole } from '../ideas/idea';
import { cleanRoles } from '../ideas/people';
import { slug } from '../graph/ontology';
import type { DeckSpec } from '../ai/tasks';

export const ROADSHOW_YAML = 'roadshow.yaml';
/** The folder in the idea folder the roadshow's files are written to (and only there). */
export const ROADSHOW_DIR = 'roadshow';
export const PHOTO_DIR = 'photos';
/** The files a build writes, in reading order. */
export const DECK_FILES = ['deck.html', 'script.md', 'run-of-show.md', 'deck.pptx'] as const;
export type DeckFile = (typeof DECK_FILES)[number];

/** One person's photo, as copied into the idea folder (`file` is relative to roadshow/photos/). */
export interface RoadshowPhoto { file: string; at: string; bytes: number; from: 'path' | 'upload'; /** Of the picture's bytes. */ hash?: string }

/** What the firm template gave the deck: its colours and fonts when it could be read, and a plain note either way. */
export interface TemplateNote { applied: boolean; note: string; file?: string }

/** The last deck: the AI's slides (checked), what it was written from, and what the app drew from it. */
export interface RoadshowDeck {
  spec: DeckSpec;
  /** When the AI wrote it, and which AI. */
  at: string;
  provider?: string;
  /** A fingerprint of the record the words were written from: when it changes, the deck is out of date. */
  basis: string;
  /** A fingerprint of the photos the files were drawn with. */
  photos: string;
  /** When the files were last drawn (a build, or an update of the files with no AI). */
  renderedAt: string;
  files: string[];
  /** What the code took out or changed in the AI's reply, in plain words. */
  warnings: string[];
  template?: TemplateNote;
}

export interface RoadshowState {
  version: 1;
  /** The to-do list: what the story still needs from the team (the decision's and the tool picker's pattern). */
  prep?: { at: string; provider?: string; needs: PrepNeed[] };
  /** person key → their photo. */
  photos: Record<string, RoadshowPhoto>;
  deck?: RoadshowDeck;
}

export const emptyRoadshow = (): RoadshowState => ({ version: 1, photos: {} });

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const PHOTO_FILE = /^[a-z0-9-]{1,80}\.(png|jpg|webp|gif)$/;

/** A stored roadshow made safe (an older or hand-edited roadshow.yaml). */
export function normalizeRoadshow(raw: unknown): RoadshowState {
  const r = obj(raw);
  const photos: Record<string, RoadshowPhoto> = {};
  for (const [k, v] of Object.entries(obj(r.photos))) {
    const p = obj(v);
    // Only a file the app itself named, in its own folder: a hand edit cannot point the deck at anything else.
    if (/^[a-z0-9-]{1,80}$/.test(k) && typeof p.file === 'string' && PHOTO_FILE.test(p.file)) {
      photos[k] = {
        file: p.file, at: String(p.at ?? ''), bytes: Number(p.bytes) || 0, from: p.from === 'upload' ? 'upload' : 'path',
        ...(typeof p.hash === 'string' && p.hash ? { hash: p.hash } : {}),
      };
    }
  }
  const prep = obj(r.prep);
  const deck = obj(r.deck);
  const spec = obj(deck.spec);
  return {
    version: 1,
    ...(r.prep ? { prep: { at: String(prep.at ?? ''), ...(prep.provider ? { provider: String(prep.provider) } : {}), needs: arr<PrepNeed>(prep.needs) } } : {}),
    photos,
    ...(Array.isArray(spec.slides) && spec.slides.length ? {
      deck: {
        spec: { title: String(spec.title ?? ''), subtitle: String(spec.subtitle ?? ''), slides: arr(spec.slides) },
        at: String(deck.at ?? ''), ...(deck.provider ? { provider: String(deck.provider) } : {}),
        basis: String(deck.basis ?? ''), photos: String(deck.photos ?? ''), renderedAt: String(deck.renderedAt ?? deck.at ?? ''),
        files: arr<string>(deck.files).filter((f) => (DECK_FILES as readonly string[]).includes(f)), warnings: arr<string>(deck.warnings).map(String),
        ...(deck.template ? { template: { applied: obj(deck.template).applied === true, note: String(obj(deck.template).note ?? '') } } : {}),
      } as RoadshowDeck,
    } : {}),
  };
}

export async function readRoadshow(root: string, id: string): Promise<RoadshowState> {
  const dir = await ideaDir(root, id);
  return normalizeRoadshow(await readYaml(path.join(dir, ROADSHOW_YAML)));
}

export async function writeRoadshow(root: string, id: string, state: RoadshowState): Promise<void> {
  const dir = await ideaDir(root, id);
  await writeYaml(path.join(dir, ROADSHOW_YAML), state);
}

/** The roadshow folder of an idea folder. */
export const roadshowDir = (ideaFolder: string) => path.join(ideaFolder, ROADSHOW_DIR);

/* ---------- the people on the deck ---------- */

/** A person's key: their name as a slug (the photo's file name too). */
export const personKey = (name: string) => slug(name).slice(0, 80);

/** How a role reads on the team slide. */
export const ROLE_WORDS: Record<PersonRole | 'submitter', string> = {
  lead: 'Lead', sponsor: 'Sponsor', builder: 'Builder', member: 'Team member', submitter: 'Submitted the idea',
};

/** One person on the deck: the submitter and every team member, each once, with their roles. */
export interface RosterPerson { key: string; name: string; roles: (PersonRole | 'submitter')[]; initials: string }

export const initialsOf = (name: string) => {
  const parts = name.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
};

/** The idea's people for the roadshow: the team in its order, the submitter first among them (added when not listed). */
export function rosterOf(idea: Pick<Idea, 'people'>): RosterPerson[] {
  const out: RosterPerson[] = [];
  const sub = idea.people.submitter?.trim();
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  for (const p of idea.people.team) {
    if (!p.name?.trim() || out.some((x) => same(x.name, p.name))) continue;
    const roles: RosterPerson['roles'] = [...cleanRoles(p.roles)];
    if (sub && same(sub, p.name)) roles.push('submitter');
    out.push({ key: personKey(p.name), name: p.name.trim(), roles, initials: initialsOf(p.name) });
  }
  if (sub && !out.some((x) => same(x.name, sub))) out.unshift({ key: personKey(sub), name: sub, roles: ['submitter'], initials: initialsOf(sub) });
  // The one who submitted it opens the list.
  const i = out.findIndex((x) => x.roles.includes('submitter'));
  if (i > 0) out.unshift(...out.splice(i, 1));
  // Two names that slug the same keep apart.
  const seen = new Set<string>();
  for (const p of out) { let k = p.key || 'person'; while (seen.has(k)) k = `${k}-2`; seen.add(k); p.key = k; }
  return out;
}

/** "Lead · Builder": a person's roles in words, for the team slide. A "member" next to another role is left out. */
export const rolesLine = (roles: RosterPerson['roles']) => roles.filter((r) => r !== 'member' || roles.length === 1).map((r) => ROLE_WORDS[r]).join(' · ');

/** A short fingerprint of anything (the deck's basis). */
export function fingerprint(v: unknown): string {
  const text = JSON.stringify(v);
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${text.length.toString(36)}-${h.toString(36)}`;
}

/** What the photos are now: when it differs from the deck's, the files were drawn with other photos. */
export const photosBasis = (state: Pick<RoadshowState, 'photos'>) =>
  fingerprint(Object.entries(state.photos).sort(([a], [b]) => a.localeCompare(b)).map(([k, p]) => [k, p.file, p.bytes, p.hash ?? p.at]));
