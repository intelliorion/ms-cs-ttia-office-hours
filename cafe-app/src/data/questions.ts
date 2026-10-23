/**
 * The data questions: once files are understood, the AI makes sure the understanding is complete (the input, the
 * output, the rules, the knowledge, the volumes), asking the operator ONE question at a time, the way the design
 * questions do: why it matters, 2–4 suggested answers, write your own, or "I don't know → ask the team" (the question
 * goes into the questions email). Answers save themselves on the idea (source "data questions"). What the answers and
 * the files imply for the record and the universe (a builder, a system the data comes from, facts) is applied by the
 * code after its checks, with no Yes/No, listed read-only and logged. When the AI says the understanding is complete,
 * the operator confirms it once ("Looks right"); only a confirmed understanding feeds what comes after.
 */
import type { Clock } from '../clock';
import type { Idea, PrepUpdate } from '../ideas/idea';
import { ideaDir, loadIdea, saveIdea } from '../ideas/store';
import { appendHistory } from '../workspace/files';
import { draftEmail, updateDraft } from '../comms/outbox';
import { addQuestion } from '../design/brainstorm';
import { sameQuestion } from '../inbox/question';
import { readDesign, skillGuidance } from '../design/store';
import { reviewInput, codeValue } from '../review/suggestInput';
import { showNames, type Coded } from '../command/names';
import { applyAnswerUpdates, planUpdates } from '../review/updates';
import type { DataStepInput, DataStepOutput } from '../ai/tasks';
import {
  columnsOf, dataPoints, DATA_TOPICS, isUsable, meaningOf, sizeWords, whatOf, type DataQuestion, type DataState, type DataTopic,
} from './model';
import { DataStepError, readData, reopenData, updateData } from './store';
import { DATA_SOURCE } from './understand';
import { fileBrief } from './brief';

export { dataBrief, fileBrief, codedDataBrief } from './brief';

export const ASKED_TEAM = '(not known yet; asked the team)';
export const DATA_QUESTIONS_MAX = 15;
const QUESTION_MAX = 200; const SUGGESTED_MAX = 120; const ANSWER_MAX = 1000; const SUMMARY_MAX = 600;
const one = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const isOpen = (s: DataQuestion) => !s.answer?.trim() && !s.askedTeam;

/** What the code sees still open, by topic. A topic an answered (or asked) question covers is not open. */
export function dataGaps(d: DataState): { topic: DataTopic; gap: string }[] {
  const usable = d.files.filter(isUsable);
  const has = (...kinds: string[]) => usable.some((f) => kinds.includes(f.kind));
  // A file that says nothing yet is open whatever was asked.
  const files: { topic: DataTopic; gap: string }[] = [];
  if (!d.files.length) files.push({ topic: 'input', gap: 'No data dropped yet' });
  for (const f of d.files) {
    if (f.check?.status === 'held') files.push({ topic: 'input', gap: `${f.name} is held for personal data: nothing in it is known yet` });
    else if (f.unreadable) files.push({ topic: 'input', gap: `${f.name} could not be read: ${f.unreadable}` });
    else if (!f.understanding && !f.edits?.what) files.push({ topic: 'input', gap: `${f.name} is not understood yet` });
  }
  // The topics: closed by a file, or by a question on that topic answered or asked of the team.
  const topics: { topic: DataTopic; gap: string }[] = [];
  if (d.files.length && !has('input')) topics.push({ topic: 'input', gap: 'No sample input: what the proof of concept reads' });
  if (!has('output', 'today')) topics.push({ topic: 'output', gap: 'No sample of the output: what it should produce' });
  if (!has('rules', 'process') && !usable.some((f) => f.understanding?.rules.length)) topics.push({ topic: 'rules', gap: 'No rules, policy or reference: the rule is not written down' });
  const unclear = usable.flatMap((f) => columnsOf(f).filter((c) => c.type !== 'empty' && !meaningOf(f, c.name)).map((c) => c.name));
  if (unclear.length) topics.push({ topic: 'codes', gap: `Columns with no meaning yet: ${unclear.slice(0, 10).join(', ')}${unclear.length > 10 ? ` and ${unclear.length - 10} more` : ''}` });
  topics.push({ topic: 'volumes', gap: 'How much data a real run has, and how often' });
  const covered = new Set(d.steps.filter((s) => s.topic && (s.answer?.trim() || s.askedTeam)).map((s) => s.topic));
  // What each file's understanding says is missing, for the AI to weigh (a few per file).
  const missing = usable.flatMap((f) => (f.understanding?.missing ?? []).slice(0, 3).map((m) => ({ topic: 'other' as DataTopic, gap: `${f.name}: ${m}` })));
  return [...files, ...topics.filter((g) => !covered.has(g.topic)), ...missing].slice(0, 16);
}

/** What the code still sees open once the AI says complete: its gaps, and the questions waiting for the team. */
export function openAfterDone(d: DataState): string[] {
  const asked = d.steps.filter((s) => s.askedTeam && !s.answer?.trim()).map((s) => `Asked the team: ${s.question}`);
  return [...dataGaps(d).filter((g) => g.topic !== 'other').map((g) => g.gap), ...asked].slice(0, 10);
}

/** Every answered data question on the idea, at once (the decision, the tool, the design and the roadshow read them). */
export async function saveDataAnswers(root: string, id: string, d: DataState): Promise<void> {
  const idea = await loadIdea(root, id) as Idea & { answers?: { question: string; answer: string; source?: string }[] };
  const mine = d.steps.filter((s) => s.answer?.trim()).map((s) => ({ question: s.question, answer: s.answer!.trim(), source: DATA_SOURCE }));
  const others = (idea.answers ?? []).filter((a) => a.source !== DATA_SOURCE);
  if (JSON.stringify((idea.answers ?? []).filter((a) => a.source === DATA_SOURCE)) === JSON.stringify(mine)) return;
  await saveIdea(root, { ...idea, answers: [...others, ...mine] } as Idea);
}

/**
 * What the AI's reply says the data changes in the record, applied by the code: each update checked the way every
 * section's are (planUpdates: real changes only, names from their codes, nothing applied twice), then applied at once
 * (applyAnswerUpdates), listed on the data section and logged in history. No Yes, No or Undo.
 */
export async function applyDataUpdates(root: string, id: string, out: Pick<DataStepOutput, 'updates'>, codes: Map<string, Coded>, provider: string, clock: Clock): Promise<PrepUpdate[]> {
  const idea = await loadIdea(root, id) as Idea & { answers?: { question: string; answer: string; source?: string }[] };
  // The data answers are on the idea already (saveDataAnswers): facts restating them, or the team's earlier answers in
  // other words, would only repeat them. The builder, participation, flags and the universe's links are kept.
  const updates = out.updates ? { ...out.updates, facts: [] } : undefined;
  const planned = await planUpdates(root, idea, updates, codes, provider, idea.updates ?? [], 'data');
  if (!planned.some((u) => u.status === 'proposed' && u.from === 'data')) return [];
  await saveIdea(root, { ...(await loadIdea(root, id)), updates: planned });
  const done = await applyAnswerUpdates(root, id, 'data', clock, DATA_SOURCE);
  const at = clock();
  if (done.length) await updateData(root, id, (d) => { d.applied = [...(d.applied ?? []), ...done.map((u) => ({ at, kind: u.kind, label: u.label, key: u.key }))]; });
  return done;
}

/** The AI's input: the files as understood (corrections in), the gaps, the questions so far, the answers and the brief, coded. */
async function dataStepInput(root: string, id: string, d: DataState): Promise<{ input: DataStepInput; codes: Map<string, Coded>; read: number }> {
  const idea = await loadIdea(root, id);
  const brief = idea.learned?.points ?? [];
  const { input: seen, codes } = await reviewInput(root, id, brief.map((p) => ({ question: p.topic, answer: p.text })), { skipSource: DATA_SOURCE });
  const all = seen.answers ?? [];
  const teamAnswers = all.slice(0, all.length - brief.length);
  const learned = all.slice(all.length - brief.length).map((a) => ({ topic: a.question, text: a.answer }));
  const features = (await readDesign(root, id)).features.map((f) => ({ name: f.name, ...(f.what ? { what: f.what } : {}) }));
  const files = d.files.map((f) => ({ ...fileBrief(f), ...(f.check?.status === 'held' ? { held: true } : {}), ...(f.understanding?.missing.length ? { missing: f.understanding.missing } : {}) }));
  const coded = await codeValue(root, id, {
    files, stepsSoFar: d.steps.map((s) => ({ question: s.question, answer: s.answer?.trim() || ASKED_TEAM, ...(s.topic ? { topic: s.topic } : {}) })),
  }, codes);
  const input: DataStepInput = {
    idea: { ...seen.idea, business_impact: undefined }, ...(features.length ? { features } : {}),
    files: coded.files, gaps: dataGaps(d), stepsSoFar: coded.stepsSoFar,
    ...(teamAnswers.length ? { teamAnswers } : {}), ...(learned.length ? { learned } : {}),
    guidance: skillGuidance('cafe-data'),
    ...(seen.form?.participation ? { form: { participation: seen.form.participation } } : {}),
    ...(seen.flags ? { flags: seen.flags } : {}), ...(seen.graph ? { graph: seen.graph } : {}),
  };
  return { input, codes, read: teamAnswers.length + d.steps.filter((s) => s.answer?.trim()).length };
}

export function assertNoOpenDataStep(d: DataState): void {
  const open = d.steps.find(isOpen);
  if (open) throw new DataStepError(`Answer data question ${open.n} first, or say "I don't know"`);
}

const decode = (t: string | undefined, codes: Map<string, Coded>) => (t === undefined ? t : showNames(t, codes));

/**
 * Next data question (the AI), or the understanding complete. The reply's updates are applied by the code, its brief
 * becomes "Learned since the form", and a finished one waits for the operator's one confirmation.
 */
export async function nextDataStep(
  root: string, id: string, run: (input: DataStepInput) => Promise<{ provider: string; output: DataStepOutput }>, clock: Clock,
): Promise<{ data: DataState; step?: DataQuestion; done?: boolean; applied: PrepUpdate[] }> {
  const d = await readData(root, id);
  if (d.files.some((f) => f.steps.some((s) => s.status === 'running'))) throw new DataStepError('A file is still being read: wait for it to finish');
  assertNoOpenDataStep(d);
  if (d.summary) return { data: d, done: true, applied: [] };
  if (d.steps.length >= DATA_QUESTIONS_MAX) throw new DataStepError(`That is ${DATA_QUESTIONS_MAX} data questions: finish by hand with a summary`);
  const { input, codes, read } = await dataStepInput(root, id, d);
  const { provider, output } = await run(input);
  if (output.done && !d.files.length && !d.steps.some((s) => s.answer?.trim())) throw new DataStepError('The AI called it complete with no data and no answers: drop a file or ask a question by hand');
  const applied = await applyDataUpdates(root, id, output, codes, provider, clock);
  // The brief of what the answers add, as after every suggestion (a reply with none keeps the one there).
  const points = (output.learned ?? []).map((p) => ({ topic: p.topic.trim(), text: showNames(p.text, codes).trim() })).filter((p) => p.topic && p.text);
  if (points.length) { const now = await loadIdea(root, id); await saveIdea(root, { ...now, learned: { at: clock(), provider, from: read, points } }); }
  const { data, out } = await updateData(root, id, (x) => {
    if (output.done && output.summary) {
      const s = output.summary;
      x.summary = {
        text: one(decode(s.text, codes), SUMMARY_MAX), input: one(decode(s.input, codes), 600), output: one(decode(s.output, codes), 600),
        knowledge: one(decode(s.knowledge, codes), 600), rules: one(decode(s.rules, codes), 600),
        gapsClosed: s.gapsClosed.map((g) => one(decode(g, codes), 200)).filter(Boolean), open: openAfterDone(x), at: clock(), provider,
      };
      reopenData(x);
      return undefined;
    }
    const n = x.steps.reduce((m, s) => Math.max(m, s.n), 0) + 1;
    const topic = output.topic && (DATA_TOPICS as readonly string[]).includes(output.topic) ? output.topic : undefined;
    const step: DataQuestion = {
      n, question: one(decode(output.question, codes), QUESTION_MAX), suggested: (output.suggested ?? []).map((s) => one(decode(s, codes), SUGGESTED_MAX)).filter(Boolean).slice(0, 4),
      source: 'ai-suggested', ...(output.why ? { why: one(decode(output.why, codes), 160) } : {}), ...(topic ? { topic } : {}),
    };
    x.steps.push(step);
    reopenData(x, { summary: true });
    return step;
  });
  return { data, ...(out ? { step: out } : { done: true }), applied };
}

/** A question written by hand (no AI): one at a time, like the AI's. */
export async function addDataQuestion(root: string, id: string, body: { question?: unknown; suggested?: unknown; topic?: unknown }) {
  const question = one(body.question, QUESTION_MAX);
  if (!question) throw new DataStepError('Write the question first');
  const suggested = (Array.isArray(body.suggested) ? body.suggested : []).map((s) => one(s, SUGGESTED_MAX)).filter(Boolean).slice(0, 4);
  return (await updateData(root, id, (d) => {
    assertNoOpenDataStep(d);
    const n = d.steps.reduce((m, s) => Math.max(m, s.n), 0) + 1;
    const topic = (DATA_TOPICS as readonly string[]).includes(String(body.topic)) ? body.topic as DataTopic : undefined;
    const step: DataQuestion = { n, question, suggested, source: 'operator', ...(topic ? { topic } : {}) };
    d.steps.push(step);
    reopenData(d, { summary: true });
    return step;
  }));
}

/** An answer to a data question: written, a suggested one picked, or "I don't know" (asked the team in the E2). */
export async function answerDataStep(root: string, id: string, body: { n?: unknown; answer?: unknown; suggestedIndex?: unknown; idk?: unknown }, clock: Clock) {
  const n = Number(body.n);
  const given = [typeof body.answer === 'string', body.suggestedIndex !== undefined, body.idk === true].filter(Boolean).length;
  if (given !== 1) throw new DataStepError('Send one of: an answer, a suggested answer or "I don\'t know"');
  if (body.idk === true) return askTeamData(root, id, n, clock);
  const { data } = await updateData(root, id, (d) => {
    const s = d.steps.find((x) => x.n === n);
    if (!s) throw new DataStepError(`No data question ${n}`);
    let answer: string;
    if (typeof body.answer === 'string') { answer = one(body.answer, ANSWER_MAX); s.source = 'operator'; } else {
      const i = Number(body.suggestedIndex);
      if (!Number.isInteger(i) || i < 0 || i >= s.suggested.length) throw new DataStepError('Pick one of the suggested answers');
      answer = s.suggested[i]; s.source = 'ai-suggested';
    }
    if (!answer) throw new DataStepError('Write an answer first');
    s.answer = answer;
    reopenData(d, { summary: true });
  });
  await saveDataAnswers(root, id, data);
  return { data };
}

/** "I don't know": the question goes into the idea's questions email (E2) and the step waits for the team's reply. */
export async function askTeamData(root: string, id: string, n: number, clock: Clock) {
  const d = await readData(root, id);
  const s = d.steps.find((x) => x.n === n);
  if (!s) throw new DataStepError(`No data question ${n}`);
  if (s.answer?.trim()) throw new DataStepError(`Data question ${n} already has an answer`);
  const rec = await draftEmail(root, { template: 'E2', ideaId: id }, clock);
  if (rec.status !== 'draft') throw new DataStepError('An E2 is approved and waiting to be sent. Send it first, then ask again');
  const body = addQuestion(rec.body, s.question);
  if (body !== rec.body) await updateDraft(root, rec.key, { body });
  const { data } = await updateData(root, id, (x) => { const y = x.steps.find((z) => z.n === n)!; y.askedTeam = { emailKey: rec.key }; reopenData(x, { summary: true }); });
  return { data, emailKey: rec.key };
}

/** The hand path to a complete understanding (no AI): the operator writes the summary. */
export async function finishDataByHand(root: string, id: string, raw: unknown, clock: Clock) {
  const text = one(raw, 4000);
  if (!text) throw new DataStepError('Write the summary first');
  if (text.length > SUMMARY_MAX) throw new DataStepError(`Keep the summary to ${SUMMARY_MAX} characters`);
  return updateData(root, id, (d) => {
    assertNoOpenDataStep(d);
    d.summary = { text, input: '', output: '', knowledge: '', rules: '', gapsClosed: [], open: openAfterDone(d), at: clock() };
    reopenData(d);
  });
}

/** "Data" in the "Learned since the form" brief: what the confirmed data is, in one short point (by code). */
export function dataLearnedText(d: DataState): string {
  const usable = d.files.filter(isUsable);
  const part = (kinds: string[], label: string) => {
    const fs = usable.filter((f) => kinds.includes(f.kind));
    return fs.length ? `${label}: ${fs.map((f) => `${f.name}${sizeWords(f) ? ` (${sizeWords(f)})` : ''}${whatOf(f) ? `: ${whatOf(f)!.replace(/\.$/, '')}` : ''}`).join('; ')}.` : '';
  };
  const text = [part(['input'], 'Sample input'), part(['output', 'today'], 'Output'), part(['rules', 'process', 'email', 'other'], 'Reference')].filter(Boolean).join(' ')
    || d.summary?.text || '';
  return text.length <= 280 ? text : `${text.slice(0, 279).replace(/\s+\S*$/, '')}…`;
}

/**
 * "Looks right": the operator's one confirmation of a complete understanding. Only now is the data final: it settles
 * the design's input and output points, feeds the features, the tool, the design, the kits and the roadshow, and adds
 * a Data point to "Learned since the form".
 */
export async function confirmData(root: string, id: string, clock: Clock) {
  const before = await readData(root, id);
  if (!before.summary) throw new DataStepError('The understanding is not complete yet: answer the data questions first');
  const held = before.files.find((f) => f.check?.status === 'held');
  if (held) throw new DataStepError(`${held.name} is held for personal data: say it is masked or synthetic, or remove it, first`);
  if (before.files.some((f) => f.steps.some((s) => s.status === 'running'))) throw new DataStepError('A file is still being read: wait for it to finish');
  const at = clock();
  const out = await updateData(root, id, (d) => { d.confirmedAt = at; d.points = dataPoints(d); });
  const text = dataLearnedText(out.data);
  if (text) {
    const idea = await loadIdea(root, id);
    const points = [...(idea.learned?.points ?? []).filter((p) => p.topic.trim().toLowerCase() !== 'data'), { topic: 'Data', text }];
    await saveIdea(root, { ...idea, learned: { ...(idea.learned ?? { from: 0 }), at, points } });
  }
  await appendHistory(await ideaDir(root, id), { at, action: 'data', by: 'operator', detail: `Data understanding confirmed: ${out.data.files.length} file${out.data.files.length === 1 ? '' : 's'}, ${out.data.steps.filter((s) => s.answer?.trim()).length} answers`, source: 'design.md' });
  return out;
}

/** The Import hook: answers the team sent back fill the data questions asked in an E2. Never throws. */
export async function fillDataAnswers(root: string, id: string, answers: { question: string; answer: string }[]): Promise<number> {
  try {
    const d = await readData(root, id);
    let k = 0;
    const next = d.steps.map((s) => {
      if (s.answer?.trim() || !s.askedTeam) return s;
      const a = answers.find((x) => sameQuestion(s.question, x.question) && one(x.answer, ANSWER_MAX));
      if (!a) return s;
      k++;
      return { ...s, answer: one(a.answer, ANSWER_MAX), source: 'e2' as const };
    });
    if (!k) return 0;
    const { data } = await updateData(root, id, (x) => { x.steps = next; reopenData(x, { summary: true }); });
    await saveDataAnswers(root, id, data);
    return k;
  } catch { return 0; }
}
