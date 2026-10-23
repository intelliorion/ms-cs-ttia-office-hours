import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readYaml, writeYaml, writeFileAtomic } from '../workspace/files';
import { ideaDir } from '../ideas/store';
import type { Idea, PrepNeed } from '../ideas/idea';
import { cafeCheck, type CafeCheck } from './cafecheck';

export type Pathway = 'Citizen-Led' | 'Assisted Citizen' | 'TTIA-Led';
export type DesignStatus = 'not-started' | 'picking' | 'designing' | 'approved';
export type StepSource = 'operator' | 'e2' | 'ai-suggested';

export interface DesignFeature {
  id: string;
  name: string;
  /** One line on what the feature does. */
  what?: string;
  tool?: string;
  reason?: string;
  /** The facts and the rule the suggestion rested on ("why this tool"), 1 to 6 lines; the operator can edit or drop them. */
  context?: string[];
  /** What this tool does well for the idea. */
  pros?: string[];
  /** What it cannot do, or does poorly, for the idea: the part named, and how to cover it when there is a way. */
  cons?: string[];
  pathway?: Pathway;
  flags: string[];
}

/** Questions the tool picker sent to the team in one E2 because the form said too little to pick. */
export interface ToolQuestions { questions: string[]; emailKey: string; at: string }

/** What a brainstorm question settles (the AI says; a hand-written question has none). */
export type DesignTag = 'must-show' | 'smallest-input' | 'users' | 'replaces' | 'builder';

export interface DesignStep {
  n: number;
  question: string;
  suggested: string[];
  /** Before an answer: who wrote the question. After: where the answer came from. */
  source: StepSource;
  answer?: string;
  why?: string;
  tag?: DesignTag;
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
  /** Older records: the picker's questions as sent. Read into toolPrep. */
  toolQuestions?: ToolQuestions;
  /** The tool picker's to-do list (what the AI needs to be sure of the tool), as the decision has. */
  toolPrep?: { at: string; provider?: string; needs: PrepNeed[] };
}

/** Said in design.md and on approval when the Café check has a CSIC flag. */
export const CSIC_NOTE = 'This idea has a CSIC feature, so that part goes to the CSIC Repository, not a Café build.';

export function emptyDesign(): DesignState {
  return { version: 1, status: 'not-started', features: [], steps: [] };
}

const STATUSES: DesignStatus[] = ['not-started', 'picking', 'designing', 'approved'];
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Questions the picker sent before it had a to-do list become open items, asked on the day they went out. */
function toolPrepOf(raw: Partial<DesignState>): Pick<DesignState, 'toolPrep'> {
  if (raw.toolPrep) return { toolPrep: { ...raw.toolPrep, needs: arr<PrepNeed>(raw.toolPrep.needs) } };
  const q = raw.toolQuestions;
  if (!q?.questions?.length) return {};
  return { toolPrep: { at: q.at, needs: q.questions.map((x, i) => ({ id: `n${i + 1}`, need: x, ask: x, met: false, askedAt: q.at })) } };
}

function normalize(raw: Partial<DesignState>): DesignState {
  // The old questions live on as the to-do list.
  const { toolQuestions: _old, ...rest } = raw;
  return {
    ...rest,
    version: 1,
    status: STATUSES.includes(raw.status as DesignStatus) ? (raw.status as DesignStatus) : 'not-started',
    features: arr<DesignFeature>(raw.features).map((f) => ({ ...f, flags: arr<string>(f.flags), ...(f.context ? { context: arr<string>(f.context) } : {}) })),
    ...toolPrepOf(raw),
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

/** Free text as one Markdown line: whitespace runs collapse and a leading # or - is escaped, so it can never add a heading or a field. */
export const mdLine = (text: string | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim().replace(/^([#>*+-]|\d+[.)])/, '\\$1');

/** The answer to the step tagged `tag`; with no tags at all (hand-written steps), the first step stands for the smallest input. */
function tagged(state: DesignState, tag: DesignTag): string | undefined {
  const hit = state.steps.find((s) => s.tag === tag && s.answer?.trim());
  if (hit) return hit.answer;
  if (tag === 'smallest-input' && !state.steps.some((s) => s.tag)) return state.steps[0]?.answer;
  return undefined;
}

export function renderDesignMd(idea: Idea, state: DesignState): string {
  const check = cafeCheck(idea, state);
  const out: string[] = [`# ${idea.title}`, ''];
  if (state.status === 'approved' && state.approvedAt) out.push(`Approved on ${state.approvedAt}.`, '');
  const mustShow = mdLine(state.summary) || mdLine(tagged(state, 'must-show'));
  out.push('## What it must show', '', mustShow || idea.outcomes.map((o) => `- ${mdLine(o)}`).join('\n') || '(not yet answered)', '');
  out.push('## Smallest input', '', mdLine(tagged(state, 'smallest-input')) || '(not yet answered)', '');
  out.push('## Features and tools', '');
  if (state.features.length === 0) out.push('(not yet answered)');
  for (const f of state.features) {
    const bits = [f.tool ?? 'no tool picked', f.pathway].filter(Boolean).join(', ');
    out.push(`- **${f.name}** (${bits})${f.reason ? `: ${f.reason}` : ''}${f.flags.length ? ` [${f.flags.join('; ')}]` : ''}`);
  }
  out.push('', '## Decisions so far', '');
  if (state.steps.length === 0) out.push('(not yet answered)');
  for (const s of state.steps) {
    const open = s.askedTeam ? '(asked the team in an E2; waiting for the reply)' : '(not yet answered)';
    out.push(`**Q${s.n}. ${mdLine(s.question).replace(/\*/g, '')}**`, '', mdLine(s.answer) || open, '');
  }
  out.push(renderCafeCheckMd(check));
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** The "## Café check" section, as design.md and plan.md both end with it (one renderer, so the copy is verbatim). */
export function renderCafeCheckMd(check: CafeCheck): string {
  const out: string[] = ['## Café check', ''];
  out.push('**Value words**', check.valueWords.length ? bullets(check.valueWords) : '- Clean', '');
  out.push('**Data flags**', check.dataFlags.length ? bullets(check.dataFlags) : '- Clean', '');
  out.push('**CSIC flags**', check.csicFlags.length ? bullets(check.csicFlags) : '- Clean', '');
  if (check.csicFlags.length) out.push(CSIC_NOTE, '');
  return out.join('\n');
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
