/**
 * The firm deck template (Settings → Project configuration → Firm deck template). The app cannot fill a PowerPoint
 * template's masters, so it says so honestly; what it can do is read the template's theme (its colours and fonts) and
 * draw the deck with them. A .pptx, .potx or .thmx file is read for its theme only, nothing else.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import type { TemplateNote } from './store';

export interface DeckTheme {
  /** The main colour (titles' accent, bars), as #rrggbb. */
  accent: string;
  /** A second colour (highlights, the timeline). */
  accent2: string;
  /** The dark text colour on light slides. */
  ink: string;
  headFont: string;
  bodyFont: string;
}

export const DEFAULT_THEME: DeckTheme = {
  accent: '#2563eb', accent2: '#0d9488', ink: '#0f172a',
  headFont: '"Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif',
  bodyFont: '"Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif',
};

const TEMPLATE_EXTS = ['.pptx', '.potx', '.thmx'];
const TEMPLATE_MAX = 100 * 1024 * 1024;
const NONE = "No firm template is set (Settings → Project configuration → Firm deck template), so the deck uses the app's own clean look.";

/** A colour from the theme's colour scheme (an sRGB value, or a system colour's last value). */
function colour(xml: string, name: string): string | undefined {
  const m = new RegExp(`<a:${name}>\\s*<a:(?:srgbClr val|sysClr [^>]*?lastClr)="([0-9A-Fa-f]{6})"`).exec(xml);
  return m ? `#${m[1].toLowerCase()}` : undefined;
}
function font(xml: string, which: 'majorFont' | 'minorFont'): string | undefined {
  const m = new RegExp(`<a:${which}>\\s*<a:latin typeface="([^"]{1,60})"`).exec(xml);
  return m && !/^\+/.test(m[1]) ? m[1].replace(/[^\p{L}\p{N} .-]/gu, '') : undefined;
}

/** A colour light enough to vanish on a white slide is no accent. */
const tooLight = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 200;
};

/** The theme a template file holds, or undefined when it holds none the app can read. */
export function themeFromTemplate(bytes: Uint8Array): Partial<DeckTheme> | undefined {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes, { filter: (f) => /^(ppt\/theme\/theme\d+\.xml|theme\/theme\/theme\d+\.xml)$/.test(f.name) }); } catch { return undefined; }
  const name = Object.keys(files).sort()[0];
  if (!name) return undefined;
  const xml = strFromU8(files[name]);
  const accent = colour(xml, 'accent1');
  const accent2 = colour(xml, 'accent2');
  const ink = colour(xml, 'dk2') ?? colour(xml, 'dk1');
  const head = font(xml, 'majorFont');
  const body = font(xml, 'minorFont');
  const out: Partial<DeckTheme> = {
    ...(accent && !tooLight(accent) ? { accent } : {}), ...(accent2 && !tooLight(accent2) ? { accent2 } : {}),
    ...(ink && !tooLight(ink) ? { ink } : {}),
    ...(head ? { headFont: `"${head}", ${DEFAULT_THEME.headFont}` } : {}), ...(body ? { bodyFont: `"${body}", ${DEFAULT_THEME.bodyFont}` } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

/** The deck's theme from the firm template setting, with an honest note on what was (and was not) applied. */
export async function readTemplateTheme(setting: string | undefined): Promise<{ theme: DeckTheme; template: TemplateNote }> {
  const given = (setting ?? '').trim().replace(/^(["'])(.*)\1$/, '$2').trim();
  if (!given) return { theme: DEFAULT_THEME, template: { applied: false, note: NONE } };
  const ext = path.extname(given).toLowerCase();
  const plain = (why: string) => ({ theme: DEFAULT_THEME, template: { applied: false, note: `The firm template is set to "${given}", ${why} The deck uses the app's own clean look. Put the full path of the firm's .potx or .pptx there to use its colours and fonts.` } });
  if (!path.isAbsolute(given) || !TEMPLATE_EXTS.includes(ext)) return plain('which is not the full path of a .potx, .pptx or .thmx file on this computer.');
  let bytes: Uint8Array;
  try {
    const st = await fs.stat(given);
    if (!st.isFile() || st.size > TEMPLATE_MAX) return plain('but that is not a file the app can read.');
    bytes = new Uint8Array(await fs.readFile(given));
  } catch { return plain('but there is no file there.'); }
  const t = themeFromTemplate(bytes);
  if (!t) return plain('but the app found no colours or fonts in it.');
  return {
    theme: { ...DEFAULT_THEME, ...t },
    template: {
      applied: true, file: path.basename(given),
      note: `The firm template's colours and fonts are used (from ${path.basename(given)}). Its slide masters, logos and layouts are not: the app draws its own slides. To put the slides on the firm's masters, open the template in PowerPoint and use Home → New Slide → Reuse Slides with deck.pptx.`,
    },
  };
}
