import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Idea } from '../ideas/idea';
import { ideaDir } from '../ideas/store';
import { readText } from '../workspace/files';
import { readDesign } from '../design/store';
import { meaningOf, whatOf } from '../data/model';
import { DECISION_LABELS } from '../review/review';

/**
 * What the assistant's read_idea step returns: the form, and everything added after it that the idea's Details show
 * in the added colour (people and roles given later, a field changed from the form, the features and tool picked, the
 * AI's brief of what the answers add, the answers), plus the design, the data understanding, the email replies and the
 * approach. Every text goes through `code`, so a person's name never reaches the AI. Sizes are capped, so the prompt
 * stays bounded whatever an idea holds.
 */
export const READ_TEXT_MAX = 600;
export const READ_TOTAL_MAX = 10_000;
const ANSWERS_MAX = 20;
const STEPS_MAX = 20;
const FILES_MAX = 6;
const COLUMNS_MAX = 25;
const EMAILS_MAX = 5;

type WithAnswers = Idea & { answers?: { question: string; answer: string; source?: string }[] };

const cut = (s: string | undefined, max: number) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const listDir = async (dir: string) => (await fs.readdir(dir).catch(() => [] as string[])).sort();

/** The idea's division as the graph holds it: its name and the people who lead it (LEADS_DIVISION). */
export interface DivisionLed { name: string; leaders: string[] }

export async function readIdeaForAgent(root: string, idea: WithAnswers, code: (s: unknown) => string, division?: DivisionLed): Promise<Record<string, unknown>> {
  const build = async (max: number): Promise<Record<string, unknown>> => {
    const t = (s: unknown) => cut(code(s), max);
    const out: Record<string, unknown> = {
      title: idea.title, challenge: t(idea.challenge), current_process: t(idea.current_process),
      outcomes: idea.outcomes, business_impact: t(idea.business_impact), beneficiaries: idea.beneficiaries, additional_context: t(idea.additional_context),
      answers: (idea.answers ?? []).slice(-ANSWERS_MAX).map((a) => ({ question: t(a.question), answer: t(a.answer), ...(a.source ? { from: a.source === 'review answers' ? 'the operator, at review' : 'a team email' } : {}) })),
    };
    // People: who submitted it, and each person's roles, the ones given after the form apart.
    const team = idea.people.team.map((p) => ({
      person: code(p.name), roles: p.roles,
      ...(p.added?.length ? { rolesAddedAfterForm: p.added } : {}), ...(p.joined ? { notOnForm: true } : {}),
    }));
    out.people = { ...(idea.people.submitter ? { submitter: code(idea.people.submitter) } : {}), team };
    if (idea.participation) out.participation = idea.participation;
    // The division it came from and who leads it (the operator's statement, not the form's), names coded.
    if (division) out.division = { name: division.name, leaders: division.leaders.map((l) => code(l)) };
    // A field changed from the form: both values.
    const was = Object.entries(idea.formWas ?? {});
    if (was.length) out.changedFromForm = was.map(([field, form]) => ({ field, form: form || 'not given', now: String((idea as unknown as Record<string, unknown>)[field] ?? '') }));
    // The tool picker's saved picks: each feature and the tool that builds it (none: not covered).
    const tools = idea.tools ?? {};
    const features = idea.features ?? Object.keys(tools);
    if (features.length) out.toolPicks = features.map((f) => ({ feature: f, tool: tools[f] ?? 'not covered by the tool' }));
    if (idea.learned?.points?.length) {
      out.learned = {
        note: 'The AI\'s brief of what the answers add to the form', at: idea.learned.at, ...(idea.learned.stale ? { outOfDate: 'an answer it was written from was removed since' } : {}),
        points: idea.learned.points.map((p) => ({ topic: p.topic, text: t(p.text) })),
      };
    }
    if (idea.review || idea.prep) {
      out.review = {
        ...(idea.review ? { decision: DECISION_LABELS[idea.review.decision] ?? idea.review.decision, reason: t(idea.review.reason) } : {}),
        ...(idea.prep ? { suggested: DECISION_LABELS[idea.prep.decision] ?? idea.prep.decision, needs: idea.prep.needs.map((n) => ({ need: n.need, met: n.met, ...(n.answer ? { answer: t(n.answer) } : n.note ? { answer: t(n.note) } : {}) })) } : {}),
      };
    }
    if (idea.flags.length) out.flags = idea.flags;

    const dir = await ideaDir(root, idea.id).catch(() => undefined);
    if (!dir) return out;
    const design = await readDesign(root, idea.id).catch(() => undefined);
    if (design) {
      const d: Record<string, unknown> = {};
      if (design.status !== 'not-started') d.status = design.status;
      if (design.features.length) d.features = design.features.map((f) => ({ name: f.name, ...(f.what ? { what: t(f.what) } : {}), ...(f.scope ? { scope: f.scope } : {}) }));
      if (design.tool) d.tool = { tool: design.tool.tool, pathway: design.tool.pathway, why: t(design.tool.reason), pros: design.tool.pros.map(t), cons: design.tool.cons.map(t) };
      const qa = design.steps.filter((s) => s.answer?.trim()).slice(-STEPS_MAX);
      if (qa.length) d.questions = qa.map((s) => ({ question: t(s.question), answer: t(s.answer) }));
      if (design.summary?.trim()) d.summary = t(design.summary);
      if (Object.keys(d).length) out.design = d;
      const data = design.data;
      if (data) {
        const x: Record<string, unknown> = {};
        const files = data.files.slice(0, FILES_MAX).map((f) => {
          const u = f.understanding;
          const cols = (u?.columns ?? []).slice(0, COLUMNS_MAX).map((c) => ({ column: c.name, meaning: t(meaningOf(f, c.name) ?? c.meaning), ...(c.codes ? { codes: t(c.codes) } : {}) }));
          return {
            file: f.name, kind: f.kind, ...(whatOf(f) ? { what: t(whatOf(f)) } : {}), ...(cols.length ? { columns: cols } : {}),
            ...(u?.rules?.length ? { rules: u.rules.map((r) => t(r.rule)) } : {}),
            ...(u?.points?.length ? { points: u.points.map(t) } : {}),
            ...(u?.derivations?.length ? { derivations: u.derivations.map((r) => t(`${r.output} from ${r.from.join(', ')}: ${r.how}`)) } : {}),
            ...(u?.missing?.length ? { stillUnknown: u.missing.map(t) } : {}),
          };
        });
        if (files.length) x.files = files;
        const qs = data.steps.filter((s) => s.answer?.trim()).slice(-STEPS_MAX);
        if (qs.length) x.questions = qs.map((s) => ({ question: t(s.question), answer: t(s.answer) }));
        if (data.summary?.text) x.summary = t(data.summary.text);
        if (data.confirmedAt) x.confirmed = data.confirmedAt;
        if (Object.keys(x).length) out.data = x;
      }
    }
    // The team's email replies, by the summaries the import wrote.
    const replies: string[] = [];
    for (const name of (await listDir(path.join(dir, 'emails', 'in'))).filter((n) => n.endsWith('.summary.md')).slice(-EMAILS_MAX)) {
      const text = await readText(path.join(dir, 'emails', 'in', name));
      if (text?.trim()) replies.push(t(text));
    }
    if (replies.length) out.emailReplies = replies;
    const approach = await readText(path.join(dir, 'approach.md'));
    if (approach?.trim()) out.approach = cut(code(approach), max * 2);
    return out;
  };
  // Shorter texts when an idea holds a lot, so the step never floods the prompt.
  let out = await build(READ_TEXT_MAX);
  if (JSON.stringify(out).length > READ_TOTAL_MAX) out = { ...(await build(200)), shortened: 'texts cut to 200 characters: this idea holds a lot' };
  return out;
}
