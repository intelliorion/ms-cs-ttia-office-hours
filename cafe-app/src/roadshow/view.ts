/** What the Roadshow section shows: the to-do list, each person with their photo, the last deck and whether it is out of date. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { FileReply } from '../server/fileReply';
import { ideaDir } from '../ideas/store';
import { DECK_FILES, roadshowDir, rosterOf, rolesLine, type RoadshowState } from './store';
import { gatherRoadshow } from './source';
import { deckStale } from './deck';
import { IMAGE_MIME, readStoredPhoto } from './photos';

export interface RoadshowView {
  prep?: RoadshowState['prep'];
  people: { key: string; name: string; roles: string; initials: string; photo?: { file: string; at: string; from: string; url: string } }[];
  deck?: {
    title: string; subtitle: string; at: string; provider?: string; renderedAt: string; files: string[]; warnings: string[];
    template?: { applied: boolean; note: string };
    slides: { kind: string; title: string; minutes: number; visual?: string }[];
    minutes: number;
  };
  stale: { record: boolean; photos: boolean };
}

const base = (id: string) => `/api/ideas/${encodeURIComponent(id)}/roadshow`;

export async function roadshowView(root: string, id: string): Promise<RoadshowView> {
  const src = await gatherRoadshow(root, id);
  const { state } = src;
  const d = state.deck;
  return {
    ...(state.prep ? { prep: state.prep } : {}),
    people: rosterOf(src.idea).map((p) => {
      const ph = state.photos[p.key];
      return {
        key: p.key, name: p.name, roles: rolesLine(p.roles), initials: p.initials,
        // The photo's link changes with the photo, so the browser never shows an old one.
        ...(ph ? { photo: { file: ph.file, at: ph.at, from: ph.from, url: `${base(id)}/photos/${encodeURIComponent(ph.file)}?v=${encodeURIComponent(ph.hash ?? ph.at)}` } } : {}),
      };
    }),
    ...(d ? {
      deck: {
        title: d.spec.title, subtitle: d.spec.subtitle, at: d.at, ...(d.provider ? { provider: d.provider } : {}), renderedAt: d.renderedAt,
        files: d.files, warnings: d.warnings, ...(d.template ? { template: d.template } : {}),
        slides: d.spec.slides.map((s) => ({ kind: s.kind, title: s.title, minutes: s.minutes, ...(s.visual ? { visual: s.visual } : {}) })),
        minutes: Math.round(d.spec.slides.reduce((t, s) => t + s.minutes, 0) * 100) / 100,
      },
    } : {}),
    stale: deckStale(src),
  };
}

const TYPES: Record<string, string> = {
  'deck.html': 'text/html; charset=utf-8',
  'script.md': 'text/plain; charset=utf-8',
  'run-of-show.md': 'text/plain; charset=utf-8',
  'deck.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** One of the deck's files, to open in a tab (or download). Only the four files a build writes. */
export async function deckFile(root: string, id: string, name: string, download: boolean): Promise<FileReply> {
  if (!(DECK_FILES as readonly string[]).includes(name)) throw new Error('Not a roadshow file');
  const file = path.join(roadshowDir(await ideaDir(root, id)), name);
  const body = await fs.readFile(file).catch(() => null);
  if (!body) throw new Error(`${name} is not written yet: Build the deck first`);
  const attach = download || name === 'deck.pptx';
  return new FileReply(body, TYPES[name], attach ? `${id}-roadshow-${name.replace(/^deck\./, 'deck.')}` : undefined);
}

/** A person's stored photo, for the preview in the Roadshow section. */
export async function photoFile(root: string, id: string, file: string): Promise<FileReply> {
  const got = await readStoredPhoto(await ideaDir(root, id), file);
  if (!got) throw new Error('No such photo');
  return new FileReply(Buffer.from(got.bytes), IMAGE_MIME[got.kind]);
}

