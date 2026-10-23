import { promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { paths } from '../workspace/paths';
import { TOKENS, resolveToken, type Round, type Settings } from '../round/round';
import type { Idea } from '../ideas/idea';

export interface Template {
  id: string;
  title: string;
  step?: string;
  to: 'submitter' | 'list' | 'cohort';
  subject: string;
  body: string;
}

export const SIGNATURE = "\n\n[YOUR NAME]\nCS TTIA Creators' Café · http://cscreatorscafe/";

const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
const PLACEHOLDER = /\[[^\]\n]+\]/g;

export function parseTemplate(text: string, file: string): Template {
  const m = FRONT_MATTER.exec(text.replace(/\r\n/g, '\n'));
  if (!m) throw new Error(`${file}: missing front matter`);
  const meta = YAML.parse(m[1]) as Partial<Template>;
  if (!meta.id || !meta.title || !meta.to || !meta.subject) {
    throw new Error(`${file}: front matter needs id, title, to and subject`);
  }
  const tpl: Template = { id: meta.id, title: meta.title, to: meta.to, subject: meta.subject, body: m[2].trim() };
  if (meta.step) tpl.step = meta.step;
  return tpl;
}

export async function loadTemplatesFrom(dir: string): Promise<Record<string, Template>> {
  const out: Record<string, Template> = {};
  for (const name of (await fs.readdir(dir)).filter((n) => n.endsWith('.md')).sort()) {
    const tpl = parseTemplate(await fs.readFile(path.join(dir, name), 'utf8'), name);
    out[tpl.id] = tpl;
  }
  return out;
}

export const loadTemplates = (root: string) => loadTemplatesFrom(paths(root).templates);

export interface RenderContext {
  idea?: Idea;
  round?: Partial<Round>;
  settings?: Settings;
}

export function fillText(text: string, ctx: RenderContext): string {
  let out = text;
  if (ctx.idea) {
    const { id, title } = ctx.idea;
    out = out.replaceAll('[CAFE ID]', () => id).replaceAll('[IDEA TITLE]', () => title);
    const first = ctx.idea.people.submitter?.trim().split(/\s+/)[0];
    if (first) out = out.replaceAll('[FIRST NAME]', () => first);
  }
  if (ctx.round && ctx.settings) {
    for (const token of Object.keys(TOKENS)) {
      const value = resolveToken(token, ctx.round, ctx.settings);
      if (value !== undefined) out = out.replaceAll(token, () => value);
    }
  }
  return out;
}

export function analyse(view: { to: string; subject: string; body: string }) {
  const all = `${view.to}\n${view.subject}\n${view.body}`;
  const missingSettings = Object.entries(TOKENS)
    .filter(([token]) => all.includes(token))
    .map(([token, def]) => ({ token, label: def.label }));
  const contentPlaceholders = [...new Set(all.match(PLACEHOLDER) ?? [])].filter((p) => !(p in TOKENS));
  return { missingSettings, contentPlaceholders };
}

function toLine(tpl: Template, idea?: Idea): string {
  if (tpl.to === 'list') return '[DISTRIBUTION LIST]';
  // A session email for one idea goes to its people (the submitter and the team); with no idea, the operator fills it in.
  if (tpl.to === 'cohort') {
    const names = idea ? [...new Set([idea.people.submitter ?? '', ...idea.people.team.map((p) => p.name)].map((n) => n.trim()).filter(Boolean))] : [];
    return names.length ? names.join('; ') : '[SESSION ATTENDEES]';
  }
  return idea?.people.submitter?.trim() || '[SUBMITTER]';
}

export function render(tpl: Template, ctx: RenderContext) {
  const view = {
    to: fillText(toLine(tpl, ctx.idea), ctx),
    subject: fillText(tpl.subject, ctx),
    body: fillText(tpl.body + SIGNATURE, ctx),
  };
  return { ...view, ...analyse(view) };
}
