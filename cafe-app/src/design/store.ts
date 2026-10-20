import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readYaml, writeYaml, writeFileAtomic } from '../workspace/files';
import { ideaDir } from '../ideas/store';
import type { Idea } from '../ideas/idea';
import { cafeCheck, type CafeCheck } from './cafecheck';

export type Pathway = 'Citizen-Led' | 'Assisted Citizen' | 'TTIA-Led';
export type DesignStatus = 'not-started' | 'picking' | 'designing' | 'approved';
export type StepSource = 'operator' | 'e2' | 'ai-suggested';

export interface DesignFeature {
  id: string;
  name: string;
  tool?: string;
  reason?: string;
  pathway?: Pathway;
  flags: string[];
}

export interface DesignStep {
  n: number;
  question: string;
  suggested: string[];
  answer?: string;
  source: StepSource;
  askedTeam?: { emailKey: string };
}

export interface DesignState {
  version: 1;
  status: DesignStatus;
  features: DesignFeature[];
  steps: DesignStep[];
  summary?: string;
  cafeCheck?: CafeCheck;
  approvedAt?: string;
}

export function emptyDesign(): DesignState {
  return { version: 1, status: 'not-started', features: [], steps: [] };
}

const STATUSES: DesignStatus[] = ['not-started', 'picking', 'designing', 'approved'];
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function normalize(raw: Partial<DesignState>): DesignState {
  return {
    ...raw,
    version: 1,
    status: STATUSES.includes(raw.status as DesignStatus) ? (raw.status as DesignStatus) : 'not-started',
    features: arr<DesignFeature>(raw.features).map((f) => ({ ...f, flags: arr<string>(f.flags) })),
    steps: arr<DesignStep>(raw.steps).map((s) => ({ ...s, suggested: arr<string>(s.suggested) })),
  };
}

export async function readDesign(root: string, id: string): Promise<DesignState> {
  const dir = await ideaDir(root, id);
  const raw = await readYaml<Partial<DesignState>>(path.join(dir, 'design.yaml'));
  return raw ? normalize(raw) : emptyDesign();
}

export async function writeDesign(root: string, id: string, state: DesignState): Promise<void> {
  const dir = await ideaDir(root, id);
  await writeYaml(path.join(dir, 'design.yaml'), state);
}

const bullets = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join('\n') : '- (none yet)');

export function renderDesignMd(idea: Idea, state: DesignState): string {
  const check = cafeCheck(idea, state);
  const out: string[] = [`# ${idea.title}`, ''];
  out.push('## What it must show', '', state.summary?.trim() || idea.outcomes.map((o) => `- ${o}`).join('\n') || '(not yet answered)', '');
  const first = state.steps[0];
  out.push('## Smallest input', '', first?.answer?.trim() || '(not yet answered)', '');
  out.push('## Features and tools', '');
  if (state.features.length === 0) out.push('(not yet answered)');
  for (const f of state.features) {
    const bits = [f.tool ?? 'no tool picked', f.pathway].filter(Boolean).join(', ');
    out.push(`- **${f.name}** (${bits})${f.reason ? `: ${f.reason}` : ''}${f.flags.length ? ` [${f.flags.join('; ')}]` : ''}`);
  }
  out.push('', '## Decisions so far', '');
  if (state.steps.length === 0) out.push('(not yet answered)');
  for (const s of state.steps) out.push(`**Q${s.n}. ${s.question}**`, '', s.answer?.trim() || '(not yet answered)', '');
  out.push('## Café check', '');
  out.push('**Value words**', check.valueWords.length ? bullets(check.valueWords) : '- Clean', '');
  out.push('**Data flags**', check.dataFlags.length ? bullets(check.dataFlags) : '- Clean', '');
  out.push('**CSIC flags**', check.csicFlags.length ? bullets(check.csicFlags) : '- Clean', '');
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

export async function writeDesignMd(root: string, idea: Idea, state: DesignState): Promise<string> {
  const dir = await ideaDir(root, idea.id);
  const file = path.join(dir, 'design.md');
  await writeFileAtomic(file, renderDesignMd(idea, state));
  return file;
}

// ---- embedded skills (guidance text for prompts, never executed) ----
export type SkillName = 'brainstorming' | 'writing-plans';
const SKILLS_DIR = fileURLToPath(new URL('../../skills/', import.meta.url));
const skillCache = new Map<SkillName, string>();

export function loadSkill(name: SkillName): string {
  const hit = skillCache.get(name);
  if (hit !== undefined) return hit;
  const text = readFileSync(path.join(SKILLS_DIR, `${name}.md`), 'utf8');
  skillCache.set(name, text);
  return text;
}

export function skillGuidance(name: SkillName, maxChars = 12000): string {
  const text = loadSkill(name);
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const nl = cut.lastIndexOf('\n');
  return (nl > 0 ? cut.slice(0, nl) : cut).trimEnd();
}
