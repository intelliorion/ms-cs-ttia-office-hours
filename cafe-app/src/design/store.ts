import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readYaml, writeYaml, writeFileAtomic } from '../workspace/files';
import { ideaDir } from '../ideas/store';
import type { Idea, PrepNeed } from '../ideas/idea';
import { csicFlags, dropRetiredFlags, legacyChoice, scopeOf, toolFeatures, type FeatureScope, type Pathway, type ToolChoice } from './choice';
import { BASE_TAGS, BUILD_TAGS, isDesignTag, pointOf, POINT_LABELS, NOT_ANSWERED, type DesignTag } from './points';
import { diagramOf, type StoredDiagram } from './diagram';
import { designedBeforeText } from './ready';
import { retiredToolNote } from '../graph/ontology';
import { columnsOf, dataOf, KIND_LABELS, meaningOf, settleInterrupted, sizeWords, TOPIC_WORDS, whatOf, type DataState } from '../data/model';

export type { Pathway, ToolChoice, DesignTag, StoredDiagram, FeatureScope };
export type DesignStatus = 'not-started' | 'picking' | 'designing' | 'approved';
export type StepSource = 'operator' | 'e2' | 'ai-suggested';

/** One feature of the proof of concept. It has no tool of its own: the one tool is DesignState.tool (see toolFeatures). */
export interface DesignFeature {
  id: string;
  name: string;
  /** One line on what the feature does. */
  what?: string;
  /** Feature flags (needs-live-system, personal-data). */
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

  approvedAt?: string;
  /** Older records: the picker's questions as sent. Read into toolPrep. */
  toolQuestions?: ToolQuestions;
  /** The tool picker's to-do list (what the AI needs to be sure of the tool), as the decision has. */
  toolPrep?: { at: string; provider?: string; needs: PrepNeed[] };
  /**
   * When the design was started again (Redesign) after plan.md and the kits were written: the plan is out of date until
   * it is written again from the new, approved design. Cleared when the plan is written.
   */
  planStale?: string;
  /**
   * Set when the operator started the design with "Design anyway" while the readiness check had gaps (src/design/ready):
   * when, and what was missing then. design.md and the design pack say "Designed before: …"; the questions aim at the
   * gaps. Cleared by Redesign (the new design is checked again).
   */
  forcedAt?: string;
  forcedMissing?: string[];
  /** "Understand the data": the dropped files, what they hold, the data questions and the one confirmation (src/data). */
  data?: DataState;
}

/** Said in design.md and on approval when the tool choice has a CSIC flag (csicFlags). */
export const CSIC_NOTE = 'This idea has a CSIC feature, so that part goes to the CSIC Repository, not a Café build.';

/** A line that goes on with more after it ends with a full stop. */
const stop = (text: string, more: boolean) => (more && !/[.!?:)]$/.test(text) ? `${text}.` : text);

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

/** An older record's choice may carry a retired field (what the old reuse tag named): dropped. */
const withoutRetired = <T extends object>(t: T): T => {
  const { reuses: _r, ...rest } = t as T & { reuses?: unknown };
  return rest as T;
};

/** A stored choice with its lists made safe; null when it names no tool. */
function choiceOf(raw: unknown): ToolChoice | undefined {
  const t = raw as Partial<ToolChoice> | undefined;
  if (!t || typeof t !== 'object' || typeof t.tool !== 'string' || !t.tool) return undefined;
  return {
    ...withoutRetired(t), tool: t.tool, pathway: t.pathway ?? 'Assisted Citizen', by: t.by === 'ai' ? 'ai' : 'operator', reason: String(t.reason ?? ''),
    pros: arr<string>(t.pros), cons: arr<string>(t.cons), context: arr<string>(t.context), flags: dropRetiredFlags(arr<string>(t.flags)),
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
  // The old questions live on as the to-do list. Older records' Café check is dropped (it is no longer worked out).
  const { toolQuestions: _old, tool: _tool, cafeCheck: _check, ...rest } = raw as Partial<DesignState> & { cafeCheck?: unknown };
  // Older records had a tool on each feature: they become one tool for the whole proof of concept.
  const rawFeatures = arr<Record<string, unknown>>(raw.features);
  const legacy = !raw.tool && rawFeatures.some((f) => typeof f?.tool === 'string' && f.tool)
    ? legacyChoice(rawFeatures, raw.approvedAt ?? raw.toolPrep?.at ?? '') : undefined;
  const tool = legacy?.tool ?? choiceOf(raw.tool);
  const features: DesignFeature[] = rawFeatures.map((f) => {
    const scope = scopeOf(f.scope);
    // An older record's retired flags (and the name that came with them) are dropped.
    const flags = dropRetiredFlags(arr<string>(f.flags)).filter((x) => !legacy || (x !== 'custom-app' && x !== 'no-build'));
    return {
      id: String(f.id ?? ''), name: String(f.name ?? ''), ...(typeof f.what === 'string' && f.what ? { what: f.what } : {}),
      flags,
      ...(scope ? { scope } : {}),
    };
  });
  const { settled: rawSettled, diagram: rawDiagram, data: rawData, forcedAt: rawForcedAt, forcedMissing: rawMissing, ...others } = rest;
  const forcedAt = typeof rawForcedAt === 'string' && rawForcedAt ? rawForcedAt : undefined;
  const settled = settledOf(rawSettled);
  const diagram = diagramOf(rawDiagram);
  const data = dataOf(rawData);
  return {
    ...others,
    ...(data ? { data } : {}),
    ...(forcedAt ? { forcedAt, forcedMissing: arr<unknown>(rawMissing).map((x) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)).filter(Boolean).slice(0, 8) } : {}),
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
  const state = raw ? normalize(raw) : emptyDesign();
  if (state.data) settleInterrupted(id, state.data);
  return state;
}

export async function writeDesign(root: string, id: string, state: DesignState): Promise<void> {
  const dir = await ideaDir(root, id);
  await writeYaml(path.join(dir, 'design.yaml'), state);
}


/** Free text as one Markdown line: whitespace runs collapse and a leading # or - is escaped, so it can never add a heading or a field. */
export const mdLine = (text: string | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim().replace(/^([#>*+-]|\d+[.)])/, '\\$1');

/** One feature as a design.md line: its tool and fit, or, once the design moved it, out of scope (struck through) or outside the build. */
export function featureMdLine(f: DesignFeature & { tool?: string }, state: Pick<DesignState, 'tool'>): string {
  const name = mdLine(f.name).replace(/[*~]/g, '');
  const flags = f.flags.length ? ` [${f.flags.map((x) => mdLine(x)).join('; ')}]` : '';
  const why = f.scope?.why ? ` (${mdLine(f.scope.why)})` : '';
  if (f.scope?.status === 'out') return `- ~~**${name}**~~ — out of scope${why}${f.what ? `: ~~${mdLine(f.what)}~~` : ''}`;
  if (f.scope?.status === 'outside') return `- **${name}** (${mdLine(f.scope.by)}, outside the ${state.tool?.tool ?? 'main'} build)${f.what ? `: ${mdLine(f.what)}` : ''}${why}${flags}`;
  const fit = (state.tool?.fit ?? []).find((x) => x.feature.toLowerCase() === f.name.toLowerCase());
  const how = fit && fit.fit !== 'yes' ? ` (${fit.fit === 'no' ? 'the tool cannot do this' : 'partly'}${fit.note ? `: ${mdLine(fit.note)}` : ''})` : '';
  return `- **${name}** (${f.tool ?? 'no tool picked'})${f.what ? `: ${mdLine(f.what)}` : ''}${how}${flags}`;
}

export function renderDesignMd(idea: Idea, state: DesignState): string {
  const out: string[] = [`# ${idea.title}`, ''];
  if (state.status === 'approved' && state.approvedAt) out.push(`Approved on ${state.approvedAt}.`, '');
  if (state.forcedAt) out.push(`**${mdLine(designedBeforeText(state.forcedMissing ?? []))}** (Design anyway, ${mdLine(state.forcedAt)}.)`, '');
  const mustShow = mdLine(state.summary) || mdLine(pointOf(state, 'must-show'));
  out.push('## What it must show', '', mustShow || idea.outcomes.map((o) => `- ${mdLine(o)}`).join('\n') || NOT_ANSWERED, '');
  out.push('## Smallest input', '', mdLine(pointOf(state, 'smallest-input')) || NOT_ANSWERED, '');
  if (state.data?.files.length || state.data?.steps.length) out.push(...renderDataMd(state.data), '');
  // Who uses it, what it replaces, who builds it: one line each (the summary covers them in prose too).
  const who = BASE_TAGS.filter((t) => t !== 'must-show' && t !== 'smallest-input');
  out.push('## Who and what', '', ...who.map((t) => `- **${POINT_LABELS[t]}**: ${mdLine(pointOf(state, t)) || NOT_ANSWERED}`), '');
  // The build points: what a builder needs before the first session.
  for (const t of BUILD_TAGS) out.push(`## ${POINT_LABELS[t]}`, '', mdLine(pointOf(state, t)) || NOT_ANSWERED, '');
  out.push('## Features and tools', '');
  const t = state.tool;
  if (t) out.push(`One tool for the whole proof of concept: **${t.tool}** (${t.pathway})${t.reason ? `: ${mdLine(t.reason)}` : ''}`, '');
  const retired = retiredToolNote(t?.tool);
  if (retired) out.push(`**${retired}.**`, '');
  if (state.features.length === 0) out.push(t ? '(no features listed yet)' : NOT_ANSWERED);
  for (const f of toolFeatures(state)) out.push(featureMdLine(f, state));
  // A custom app, or a live system or personal data the tool picker flagged, goes to the CSIC Repository.
  const csic = csicFlags(state);
  if (csic.length) out.push('', `${CSIC_NOTE} (${csic.map(mdLine).join(', ')})`);
  out.push('', '## Decisions so far', '');
  if (state.steps.length === 0) out.push('(not yet answered)');
  for (const s of state.steps) {
    const open = s.askedTeam ? '(asked the team in an E2; waiting for the reply)' : '(not yet answered)';
    out.push(`**Q${s.n}. ${mdLine(s.question).replace(/\*/g, '')}**`, '', mdLine(s.answer) || open, '');
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/** design.md's Data section: each file (kind, what it is, columns and meaning, rules, issues), the data questions and whether it is confirmed. */
export function renderDataMd(d: DataState): string[] {
  const out: string[] = ['## Data', ''];
  out.push(d.confirmedAt ? `Confirmed by the operator on ${d.confirmedAt}.` : d.summary ? 'Not confirmed yet: the AI calls it complete; the operator confirms it in the Data step.' : 'Not confirmed yet: the understanding is still being worked out.', '');
  if (d.summary?.text) out.push(mdLine(d.summary.text), '');
  for (const f of d.files) {
    out.push(`### ${mdLine(f.name).replace(/[*~]/g, '')} (${KIND_LABELS[f.kind]})`, '');
    if (f.check?.status === 'held') { out.push('Held: it may hold personal data, so nothing in it is used yet.', ''); continue; }
    if (f.unreadable) { out.push(`Not read: ${mdLine(f.unreadable)}`, ''); continue; }
    const what = whatOf(f);
    out.push(`${what ? mdLine(what).replace(/\.?$/, '.') : '(not understood yet)'}${sizeWords(f) ? ` ${sizeWords(f)}.` : ''}`, '');
    if (f.check?.masked.length) out.push(`Masked (never shown to the AI): ${f.check.masked.map((c) => `\`${c}\``).join(', ')}.`, '');
    const cols = columnsOf(f);
    if (cols.length) {
      for (const c of cols.slice(0, 60)) {
        const codes = f.understanding?.columns.find((x) => x.name === c.name)?.codes;
        out.push(`- \`${c.name.replace(/`/g, "'")}\` (${c.type}): ${stop(mdLine(meaningOf(f, c.name)) || '(meaning not said)', !!codes)}${codes ? ` Codes: ${mdLine(codes)}` : ''}`);
      }
      out.push('');
    }
    const u = f.understanding;
    if (u?.points.length) out.push(...u.points.map((p) => `- ${mdLine(p)}`), '');
    if (u?.rules.length) out.push('Rules:', '', ...u.rules.map((r) => `- ${mdLine(r.rule)}${r.columns.length ? ` (${r.columns.map(mdLine).join(', ')})` : ''}`), '');
    if (u?.derivations.length) out.push('How the output is worked out:', '', ...u.derivations.map((x) => `- \`${x.output}\`: ${mdLine(x.how)}${x.from.length ? ` (from ${x.from.map(mdLine).join(', ')})` : ''}`), '');
    const issues = [...(f.tables?.flatMap((t) => t.issues) ?? []), ...(u?.issues ?? [])];
    if (issues.length) out.push('Issues:', '', ...issues.slice(0, 8).map((x) => `- ${mdLine(x)}`), '');
  }
  const answered = d.steps.filter((x) => x.answer?.trim() || x.askedTeam);
  if (answered.length) {
    out.push('### Data questions', '');
    for (const x of answered) out.push(`**D${x.n}. ${mdLine(x.question).replace(/\*/g, '')}**`, '', mdLine(x.answer) || '(asked the team in an E2; waiting for the reply)', '');
  }
  if (d.settled?.length) out.push('Settled by earlier answers:', '', ...d.settled.map((x) => `- ${TOPIC_WORDS[x.topic] ?? x.topic}: "${mdLine(x.answer)}"${x.source ? ` (${mdLine(x.source.split(/[\\/]/).pop() ?? x.source)})` : ''}`), '');
  if (d.summary?.open.length && !d.confirmedAt) out.push('Still open:', '', ...d.summary.open.map((x) => `- ${mdLine(x)}`), '');
  return out.slice(0, out[out.length - 1] === '' ? -1 : undefined);
}

export async function writeDesignMd(root: string, idea: Idea, state: DesignState): Promise<string> {
  const dir = await ideaDir(root, idea.id);
  const file = path.join(dir, 'design.md');
  await writeFileAtomic(file, renderDesignMd(idea, state));
  return file;
}

// ---- embedded skills (guidance text for prompts, never executed) ----
/** cafe-design and cafe-data are written for the app; writing-plans is the Superpowers skill, copied. */
export type SkillName = 'cafe-design' | 'cafe-data' | 'writing-plans';
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
