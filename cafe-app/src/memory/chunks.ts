import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { paths } from '../workspace/paths';
import { readText, readYaml } from '../workspace/files';
import { listIdeas } from '../ideas/store';
import type { Idea } from '../ideas/idea';
import { DECISION_LABELS } from '../review/review';

/**
 * What Deep read reads: everything long in an idea folder that never becomes a star, cut into passages ("chunks"),
 * one per field or section, each split at CHUNK_MAX with CHUNK_OVERLAP so a sentence on a seam is in both halves.
 * A chunk's hash is of its section and text, so a change anywhere in a field makes that field's chunks stale and
 * nothing else.
 */
export type ChunkKind = 'submission' | 'email' | 'design' | 'review' | 'roadshow' | 'other';
export interface Chunk {
  /** `<ideaId>:<file>:<section>:<n>` */
  id: string;
  ideaId: string;
  /** Relative to the idea folder ("idea.yaml", "emails/001-E2.md"). */
  file: string;
  section: string;
  kind: ChunkKind;
  text: string;
  hash: string;
}

export const CHUNK_MAX = 1200;
export const CHUNK_OVERLAP = 150;

export const hashOf = (section: string, text: string) => createHash('sha1').update(`${section}\n${text}`).digest('hex');

/** Splits long text at a sentence or line end near the limit, carrying the last CHUNK_OVERLAP characters over. */
export function splitText(text: string, max = CHUNK_MAX, overlap = CHUNK_OVERLAP): string[] {
  const t = text.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).join('\n').trim();
  if (!t) return [];
  if (t.length <= max) return [t];
  const out: string[] = [];
  let start = 0;
  while (start < t.length) {
    let end = Math.min(start + max, t.length);
    if (end < t.length) {
      const window = t.slice(start, end);
      const cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '));
      if (cut > max * 0.5) end = start + cut + 1;
    }
    out.push(t.slice(start, end).trim());
    if (end >= t.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out.filter(Boolean);
}

/** Pairs or lines batched into texts no longer than max (each item on its own line). */
function batched(items: string[], max = CHUNK_MAX): string[] {
  const out: string[] = [];
  let cur = '';
  for (const it of items) {
    const next = cur ? `${cur}\n${it}` : it;
    if (next.length > max && cur) { out.push(cur); cur = it; } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

const clean = (s: unknown) => String(s ?? '').replace(/\r\n/g, '\n').trim();
const stripFrontMatter = (s: string) => s.replace(/^---\n[\s\S]*?\n---\n/, '');

function make(ideaId: string, file: string, section: string, kind: ChunkKind, texts: string[]): Chunk[] {
  return texts.flatMap((t) => splitText(t)).map((text, n) => ({ id: `${ideaId}:${file}:${section}:${n}`, ideaId, file, section, kind, text, hash: hashOf(section, text) }));
}

const listDir = async (dir: string) => (await fs.readdir(dir).catch(() => [] as string[])).sort();

/** Every passage of one idea, from its record and its folder. Reads files only; nothing is embedded here. */
export async function chunkIdea(root: string, idea: Idea, dir: string): Promise<Chunk[]> {
  const out: Chunk[] = [];
  const id = idea.id;
  const field = (section: string, text: unknown) => { const t = clean(text); if (t) out.push(...make(id, 'idea.yaml', section, 'submission', [t])); };
  field('title+challenge', [idea.title, clean(idea.challenge)].filter(Boolean).join('\n'));
  field('current_process', idea.current_process);
  field('business_impact', idea.business_impact);
  field('additional_context', idea.additional_context);
  field('outcomes', idea.outcomes.join('\n'));
  const answers = ((idea as { answers?: { question: string; answer: string }[] }).answers ?? []).map((a) => `Q: ${clean(a.question)}\nA: ${clean(a.answer)}`);
  if (answers.length) out.push(...make(id, 'idea.yaml', 'answers', 'submission', batched(answers)));

  if (idea.review || idea.prep) {
    const lines: string[] = [];
    if (idea.review) lines.push(`Decision: ${DECISION_LABELS[idea.review.decision] ?? idea.review.decision}`, clean(idea.review.reason));
    else if (idea.prep) lines.push(`Suggested: ${DECISION_LABELS[idea.prep.decision] ?? idea.prep.decision}`, clean(idea.prep.reason));
    for (const n of idea.prep?.needs ?? []) lines.push(`Need: ${clean(n.need)}${n.answer ? ` — ${clean(n.answer)}` : n.note ? ` — ${clean(n.note)}` : ''}`);
    out.push(...make(id, 'idea.yaml', 'review', 'review', [lines.filter(Boolean).join('\n')]));
  }

  // The app's own emails (drafts and sent), each one chunk; filed emails and notes by their summaries.
  for (const name of await listDir(path.join(dir, 'emails'))) {
    if (!/^\d{3}-[A-Z0-9]+\.md$/.test(name)) continue;
    const text = stripFrontMatter(clean(await readText(path.join(dir, 'emails', name))));
    const template = name.slice(4, -3);
    if (text) out.push(...make(id, `emails/${name}`, `email ${template}`, 'email', [text]));
  }
  for (const sub of ['in', 'out'] as const) {
    for (const name of await listDir(path.join(dir, 'emails', sub))) {
      if (!name.endsWith('.summary.md')) continue;
      const text = clean(await readText(path.join(dir, 'emails', sub, name)));
      if (text) out.push(...make(id, `emails/${sub}/${name}`, `email ${sub}`, 'email', [text]));
    }
  }
  for (const name of await listDir(path.join(dir, 'notes'))) {
    if (!name.endsWith('.summary.md')) continue;
    const text = clean(await readText(path.join(dir, 'notes', name)));
    if (text) out.push(...make(id, `notes/${name}`, 'note', 'other', [text]));
  }

  const design = await readYaml<{ features?: { name: string; what?: string }[]; tool?: { tool?: string; pros?: string[]; cons?: string[]; why?: string }; steps?: { question: string; answer?: string }[]; summary?: string }>(path.join(dir, 'design.yaml')).catch(() => undefined);
  if (design) {
    const feats = (design.features ?? []).map((f) => `${clean(f.name)}${f.what ? `: ${clean(f.what)}` : ''}`);
    const tool = design.tool?.tool ? [`Tool: ${clean(design.tool.tool)}${design.tool.why ? `. ${clean(design.tool.why)}` : ''}`, ...(design.tool.pros ?? []).map((p) => `+ ${clean(p)}`), ...(design.tool.cons ?? []).map((c) => `- ${clean(c)}`)] : [];
    if (feats.length || tool.length) out.push(...make(id, 'design.yaml', 'design features', 'design', batched([...feats, ...tool])));
    const qa = (design.steps ?? []).filter((s) => s.answer).map((s) => `Q: ${clean(s.question)}\nA: ${clean(s.answer)}`);
    if (qa.length) out.push(...make(id, 'design.yaml', 'design Q&A', 'design', batched(qa)));
    if (clean(design.summary)) out.push(...make(id, 'design.yaml', 'design summary', 'design', [clean(design.summary)]));
  }
  const approach = clean(await readText(path.join(dir, 'approach.md')));
  if (approach) out.push(...make(id, 'approach.md', 'approach', 'design', [approach]));

  const script = clean(await readText(path.join(dir, 'roadshow', 'script.md')));
  if (script) out.push(...make(id, 'roadshow/script.md', 'roadshow script', 'roadshow', [script]));
  const handoff = clean(await readText(path.join(dir, 'csic-handoff.md')));
  if (handoff) out.push(...make(id, 'csic-handoff.md', 'handoff', 'other', [handoff]));

  const history = clean(await readText(path.join(dir, 'history.log')));
  if (history) {
    const details = history.split('\n').map((l) => { try { return clean((JSON.parse(l) as { detail?: string }).detail); } catch { return ''; } }).filter(Boolean);
    if (details.length) out.push(...make(id, 'history.log', 'history', 'other', batched(details)));
  }
  return out;
}

export interface WorkspaceChunks { chunks: Chunk[]; ideas: { id: string; title: string }[] }

/** Every passage of every idea in the workspace, in idea order. */
export async function chunkWorkspace(root: string): Promise<WorkspaceChunks> {
  const base = paths(root).ideas;
  const { ideas } = await listIdeas(root);
  const names = await listDir(base);
  const chunks: Chunk[] = [];
  for (const idea of ideas) {
    const folder = names.find((n) => n === idea.id || n.startsWith(`${idea.id}-`));
    if (!folder) continue;
    chunks.push(...(await chunkIdea(root, idea, path.join(base, folder))));
  }
  return { chunks, ideas: ideas.map((i) => ({ id: i.id, title: i.title })) };
}
