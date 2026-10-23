/** The Roadshow section's words and links. A leaf module, so it can be tested on its own. */

export type RoadshowRoute = 'suggest' | 'prep/answer' | 'prep/email' | 'photo' | 'photo/remove' | 'build' | 'render';
/** A roadshow route of one idea. */
export const roadshowUrl = (id: string, what: RoadshowRoute) => `/api/ideas/${encodeURIComponent(id)}/roadshow/${what}`;

export type DeckFile = 'deck.html' | 'script.md' | 'run-of-show.md' | 'deck.pptx';
/** One of the deck's files: opened in a tab (the deck, the script) or downloaded (the PowerPoint). `print` opens the print window (Export PDF). */
export function deckFileUrl(id: string, file: DeckFile, opts: { print?: boolean; download?: boolean } = {}): string {
  const q = opts.print ? '?print=1' : opts.download ? '?download=1' : '';
  return `/api/ideas/${encodeURIComponent(id)}/roadshow/files/${file}${q}`;
}

export interface RoadshowViewLike {
  prep?: { at: string; provider?: string; needs: any[] };
  people?: { key: string; name: string; roles: string; initials: string; photo?: { url: string; from: string; at: string } }[];
  deck?: { title: string; at: string; provider?: string; renderedAt: string; files: string[]; warnings: string[]; template?: { applied: boolean; note: string }; slides: { kind: string; title: string; minutes: number; visual?: string }[]; minutes: number };
  stale?: { record: boolean; photos: boolean };
}

/** "10:30": minutes as minutes and seconds. */
export const mmss = (min: number) => { const s = Math.round(min * 60); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** The section's heading note. */
export function roadshowNote(v: RoadshowViewLike | null | undefined): string {
  const d = v?.deck;
  if (!d) return v?.prep ? 'no deck yet' : 'not started';
  return `${d.slides.length} slides · about ${mmss(d.minutes)}${v?.stale?.record || v?.stale?.photos ? ' · out of date' : ''}`;
}

/** Why the deck is out of date, in plain words, and what fixes it; null when it is not. */
export function staleText(v: RoadshowViewLike | null | undefined): { text: string; fix: 'build' | 'render' } | null {
  if (!v?.deck || !v.stale) return null;
  if (v.stale.record) return { text: 'The record changed since the deck was built (an answer, the design, the team or the plan). Rebuild to rewrite it.', fix: 'build' };
  if (v.stale.photos) return { text: 'The photos changed since the deck was drawn. Update the files to put them in (no AI needed).', fix: 'render' };
  return null;
}

/** The hint under the photo box. */
export const PHOTO_HINT = 'The full path of a picture on this computer (PNG, JPG, WebP or GIF, at most 5 MB), or choose the file. The app copies it into the idea folder.';
export const PHOTO_PLACEHOLDER = '/Users/you/Pictures/photo.jpg or C:\\Users\\you\\photo.png';

/** The label over each kind of slide in the section's slide list. */
export const SLIDE_KIND: Record<string, string> = {
  title: 'Title', problem: 'Problem', today: 'Today', team: 'Team', solution: 'Solution', demo: 'Demo', diagram: 'Design', tool: 'Tool',
  headaches: 'Headaches', lessons: 'Lessons', reuse: 'Reuse', next: 'Next', question: 'Question', thanks: 'Thanks',
};
