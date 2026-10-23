import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readYaml, writeYaml, writeFileAtomic } from '../workspace/files';
import { ideaDir } from '../ideas/store';
import type { Idea, PrepNeed } from '../ideas/idea';
import { cafeCheck, type CafeCheck } from './cafecheck';
import { legacyChoice, scopeOf, toolFeatures, type FeatureScope, type Pathway, type ToolChoice } from './choice';
import { BASE_TAGS, BUILD_TAGS, isDesignTag, pointOf, POINT_LABELS, NOT_ANSWERED, type DesignTag } from './points';
import { diagramOf, type StoredDiagram } from './diagram';

export type { Pathway, ToolChoice, DesignTag, StoredDiagram, FeatureScope };
export type DesignStatus = 'not-started' | 'picking' | 'designing' | 'approved';
export type StepSource = 'operator' | 'e2' | 'ai-suggested';

/** One feature of the proof of concept. It has no tool of its own: the one tool is DesignState.tool (see toolFeatures). */
export interface DesignFeature {
  id: string;
  name: string;
  /** One line on what the feature does. */
  what?: string;
  /** Feature flags (needs-live-system, personal-data, reuse-existing). */
  flags: string[];
  /** Set when a design answer moved the feature out of the build: dropped, or done with another tool outside it. */
  scope?: FeatureScope;
}


/** Questions the tool picker sent to the team in one E2 because the form said too little to pick. */
export interface ToolQuestions { questions: string[]; emailKey: string; at: string }


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
  /** The one tool for the whole proof of concept, with its pros, cons and how it fits each feature. */
  tool?: ToolChoice;
  steps: DesignStep[];
  summary?: string;
  /** What the done reply said the earlier answers already settle, for points no question was tagged with (tag → one line). */
  settled?: Partial<Record<DesignTag, string>>;
  /** The design diagram (the AI's, or the app's plain one), with the design it was drawn from (`basis`). */
  diagram?: StoredDiagram;
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

/** A stored choice with its lists made safe; null when it names no tool. */
function choiceOf(raw: unknown): ToolChoice | undefined {
  const t = raw as Partial<ToolChoice> | undefined;
  if (!t || typeof t !== 'object' || typeof t.tool !== 'string' || !t.tool) return undefined;
  return {
    ...t, tool: t.tool, pathway: t.pathway ?? 'Assisted Citizen', by: t.by === 'ai' ? 'ai' : 'operator', reason: String(t.reason ?? ''),
    pros: arr<string>(t.pros), cons: arr<string>(t.cons), context: arr<string>(t.context), flags: arr<string>(t.flags),
    fit: arr<ToolChoice['fit'][number]>(t.fit), evaluatedFor: arr<string>(t.evaluatedFor), at: String(t.at ?? ''),
  };
}

/** The done reply's settled points, design tags only, one line each. */
function settledOf(raw: unknown): DesignState['settled'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Partial<Record<DesignTag, string>> = {};
  for (const [k, v] of Object.entries(raw)) {
    const text = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (isDesignTag(k) && text) out[k] = text;
  }
  return Object.keys(out).length ? out : undefined;
}

function normalize(raw: Partial<DesignState>): DesignState {
  // The old questions live on as the to-do list.
  const { toolQuestions: _old, tool: _tool, ...rest } = raw;
  // Older records had a tool on each feature: they become one tool for the whole proof of concept.
  const rawFeatures = arr<Record<string, unknown>>(raw.features);
  const legacy = !raw.tool && rawFeatures.some((f) => typeof f?.tool === 'string' && f.tool)
    ? legacyChoice(rawFeatures, raw.approvedAt ?? raw.toolPrep?.at ?? '') : undefined;
  const tool = legacy?.tool ?? choiceOf(raw.tool);
  const features: DesignFeature[] = rawFeatures.map((f) => {
    const scope = scopeOf(f.scope);
    return {
      id: String(f.id ?? ''), name: String(f.name ?? ''), ...(typeof f.what === 'string' && f.what ? { what: f.what } : {}),
      flags: arr<string>(f.flags).filter((x) => !legacy || (x !== 'custom-app' && x !== 'no-build')),
      ...(scope ? { scope } : {}),
    };
  });
  const { settled: rawSettled, diagram: rawDiagram, ...others } = rest;
  const settled = settledOf(rawSettled);
  const diagram = diagramOf(rawDiagram);
  return {
    ...others,
    ...(settled ? { settled } : {}),
    ...(diagram ? { diagram } : {}),
    version: 1,
    status: STATUSES.includes(raw.status as DesignStatus) ? (raw.status as DesignStatus) : 'not-started',
    features,
    ...(tool ? { tool } : {}),
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

/** One feature as a design.md line: its tool and fit, or, once the design moved it, out of scope (struck through) or outside the build. */
export function featureMdLine(f: DesignFeature & { tool?: string }, state: Pick<DesignState, 'tool'>): string {
  const name = mdLine(f.name).replace(/[*~]/g, '');
  const flags = f.flags.length ? ` [${f.flags.join('; ')}]` : '';
  const why = f.scope?.why ? ` (${mdLine(f.scope.why)})` : '';
  if (f.scope?.status === 'out') return `- ~~**${name}**~~ — out of scope${why}${f.what ? `: ~~${mdLine(f.what)}~~` : ''}`;
  if (f.scope?.status === 'outside') return `- **${name}** (${mdLine(f.scope.by)}, outside the ${state.tool?.tool ?? 'main'} build)${f.what ? `: ${mdLine(f.what)}` : ''}${why}${flags}`;
  const fit = (state.tool?.fit ?? []).find((x) => x.feature.toLowerCase() === f.name.toLowerCase());
  const how = fit && fit.fit !== 'yes' ? ` (${fit.fit === 'no' ? 'the tool cannot do this' : 'partly'}${fit.note ? `: ${mdLine(fit.note)}` : ''})` : '';
  return `- **${name}** (${f.tool ?? 'no tool picked'})${f.what ? `: ${mdLine(f.what)}` : ''}${how}${flags}`;
}

export function renderDesignMd(idea: Idea, state: DesignState): string {
  const check = cafeCheck(idea, state);
  const out: string[] = [`# ${idea.title}`, ''];
  if (state.status === 'approved' && state.approvedAt) out.push(`Approved on ${state.approvedAt}.`, '');
  const mustShow = mdLine(state.summary) || mdLine(pointOf(state, 'must-show'));
  out.push('## What it must show', '', mustShow || idea.outcomes.map((o) => `- ${mdLine(o)}`).join('\n') || NOT_ANSWERED, '');
  out.push('## Smallest input', '', mdLine(pointOf(state, 'smallest-input')) || NOT_ANSWERED, '');
  // Who uses it, what it replaces, who builds it: one line each (the summary covers them in prose too).
  const who = BASE_TAGS.filter((t) => t !== 'must-show' && t !== 'smallest-input');
  out.push('## Who and what', '', ...who.map((t) => `- **${POINT_LABELS[t]}**: ${mdLine(pointOf(state, t)) || NOT_ANSWERED}`), '');
  // The build points: what a builder needs before the first session.
  for (const t of BUILD_TAGS) out.push(`## ${POINT_LABELS[t]}`, '', mdLine(pointOf(state, t)) || NOT_ANSWERED, '');
  out.push('## Features and tools', '');
  const t = state.tool;
  if (t) out.push(`One tool for the whole proof of concept: **${t.tool}** (${t.pathway})${t.reason ? `: ${mdLine(t.reason)}` : ''}`, '');
  if (state.features.length === 0) out.push(t ? '(no features listed yet)' : NOT_ANSWERED);
  for (const f of toolFeatures(state)) out.push(featureMdLine(f, state));
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
/** cafe-design is written for the app; writing-plans is the Superpowers skill, copied. */
export type SkillName = 'cafe-design' | 'writing-plans';
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
