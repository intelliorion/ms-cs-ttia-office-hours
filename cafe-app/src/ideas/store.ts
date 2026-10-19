import { promises as fs } from 'node:fs';
import path from 'node:path';
import { paths } from '../workspace/paths';
import { readYaml, writeYaml } from '../workspace/files';
import { normalizeIdea, type Idea } from './idea';

export const ID_PATTERN = /^CAFE-\d{4}-\d{3}$/;

export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '');
  return slug || 'idea';
}

export function nextId(existing: string[], year: number): string {
  const prefix = `CAFE-${year}-`;
  const max = existing
    .filter((id) => id.startsWith(prefix))
    .map((id) => Number(id.slice(prefix.length, prefix.length + 3)))
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

async function findFolder(root: string, id: string): Promise<string | undefined> {
  const base = paths(root).ideas;
  const names = await fs.readdir(base).catch(() => [] as string[]);
  const name = names.find((n) => n === id || n.startsWith(`${id}-`));
  return name ? path.join(base, name) : undefined;
}

export async function ideaDir(root: string, id: string): Promise<string> {
  if (!ID_PATTERN.test(id)) throw new Error(`Not a Café ID: ${id}`);
  const dir = await findFolder(root, id);
  if (!dir) throw new Error(`No idea ${id}`);
  return dir;
}

export async function saveIdea(root: string, idea: Idea): Promise<string> {
  if (!ID_PATTERN.test(idea.id)) throw new Error(`Not a Café ID: ${idea.id}`);
  const dir = (await findFolder(root, idea.id)) ?? path.join(paths(root).ideas, `${idea.id}-${idea.slug || 'idea'}`);
  await writeYaml(path.join(dir, 'idea.yaml'), idea);
  return dir;
}

export async function loadIdea(root: string, id: string): Promise<Idea> {
  const dir = await ideaDir(root, id);
  const raw = await readYaml<Partial<Idea>>(path.join(dir, 'idea.yaml'));
  if (!raw) throw new Error(`${path.basename(dir)}: idea.yaml is missing`);
  return normalizeIdea(raw);
}

export interface ListResult {
  ideas: Idea[];
  problems: { folder: string; message: string }[];
}

export async function listIdeas(root: string): Promise<ListResult> {
  const base = paths(root).ideas;
  const names = (await fs.readdir(base).catch(() => [] as string[])).filter((n) => /^CAFE-\d{4}-\d{3}/.test(n)).sort();
  const result: ListResult = { ideas: [], problems: [] };
  for (const folder of names) {
    try {
      const raw = await readYaml<Partial<Idea>>(path.join(base, folder, 'idea.yaml'));
      if (!raw) throw new Error('idea.yaml is missing');
      const idea = normalizeIdea(raw);
      if (!ID_PATTERN.test(idea.id) || !folder.startsWith(idea.id)) throw new Error(`id "${idea.id}" does not match the folder`);
      result.ideas.push(idea);
    } catch (e) {
      result.problems.push({ folder, message: (e as Error).message });
    }
  }
  return result;
}
