import path from 'node:path';
import { plusDays, formatDate, type Clock } from '../clock';
import type { Decision, Idea, ReviewRecord } from '../ideas/idea';
import { loadIdea, saveIdea, ideaDir, listIdeas } from '../ideas/store';
import { writeFileAtomic, appendHistory } from '../workspace/files';
import { paths } from '../workspace/paths';
import { loadSettings, currentRoundId } from '../round/store';
import type { Settings } from '../round/round';
import { withTick, progress } from '../checklist/checklist';
import type { StepDef } from '../rules/stages';
import { draftEmail, type EmailRecord } from '../comms/outbox';

export const CRITERIA = [
  { id: 'feasible', text: 'A proof of concept is feasible with approved tools and no live non-Microsoft system' },
  { id: 'builder', text: 'A builder is named and can attend' },
  { id: 'data', text: 'Synthetic, aggregated or sample data is enough' },
  { id: 'theme', text: 'It fits a theme or cohort' },
  { id: 'reuse', text: 'It could be reused beyond the submitting team' },
] as const;

export const DECISION_EMAIL: Record<Decision, string> = { select: 'E3', reuse: 'E4', csic: 'E5', notnow: 'E6', ask: 'E2' };

export const DECISION_LABELS: Record<Decision, string> = {
  select: 'Select for the design series (E3)',
  reuse: 'Reuse what exists (E4)',
  csic: 'Route to the CSIC Repository (E5)',
  notnow: 'Not this round (E6)',
  ask: 'Ask first (E2)',
};

export interface ReviewInput {
  criteria?: Record<string, unknown>;
  decision?: unknown;
  reason?: unknown;
}

export interface ReviewResult {
  idea: Idea;
  email: EmailRecord;
  warnings: string[];
  handoff?: string;
}

const NOT_IN_RECORD = 'Not in the Café record. Ask the team.';

export function renderReview(idea: Idea, r: ReviewRecord): string {
  return [
    `# Review: ${idea.id} ${idea.title}`, '',
    `Date: ${r.at}`, '',
    '## Criteria', '',
    ...CRITERIA.map((c) => `- [${r.criteria[c.id] ? 'x' : ' '}] ${c.text}`), '',
    '## Decision', '', DECISION_LABELS[r.decision], '',
    '## Reason', '', r.reason, '',
  ].join('\n');
}

export function renderHandoff(idea: Idea, settings: Settings): string {
  const sponsor = idea.people.team.find((p) => p.role === 'sponsor');
  const field = (title: string, value: string | undefined, source: string) => {
    const v = value?.trim();
    return [`## ${title}`, '', v || NOT_IN_RECORD, '', `Source: ${v ? source : 'none'}`, ''];
  };
  return [
    `# CSIC Repository intake draft: ${idea.title}`, '',
    `From Creators' Café record ${idea.id}. Every field says where it came from. Check each one before you paste it into the intake form: ${settings.csicLink?.trim() || '[CSIC REPOSITORY INTAKE LINK]'}`, '',
    ...field('Opportunity description', idea.challenge, 'form, Business Challenge'),
    ...field('Current process', idea.current_process, 'form, Current Process'),
    ...field('Who would use it', undefined, ''),
    ...field(
      'Sponsor',
      sponsor
        ? `${sponsor.name}, named as sponsor in Team Members and Lead. MD status: not confirmed.`
        : 'No sponsor named in the form. The CSIC Repository needs an MD sponsor who has agreed.',
      'form, Team Members and Lead',
    ),
    ...field('Expected change (no figures)', idea.outcomes.join('; '), 'form, Desired Outcomes'),
    ...field('Systems and data', undefined, ''),
    '## Café history', '',
    ...(idea.source ? [`- Submitted: ${idea.source.file}, row ${idea.source.row}`] : []),
    ...(idea.review ? [`- ${idea.review.at}: reviewed and routed to the CSIC Repository. Reason: ${idea.review.reason}`] : []),
    '',
    '## Follow up', '',
    `On ${idea.closed?.followUp ? formatDate(idea.closed.followUp) : '[FOLLOW-UP DATE]'}: did it reach the CSIC Repository?`, '',
  ].join('\n');
}

export async function saveReview(
  root: string, id: string, input: ReviewInput, ctx: { clock: Clock; steps: StepDef[] },
): Promise<ReviewResult> {
  const decision = input.decision as Decision;
  if (typeof decision !== 'string' || !Object.hasOwn(DECISION_EMAIL, decision)) throw new Error('Pick a decision');
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason) throw new Error('Give a reason for the decision');

  let idea = await loadIdea(root, id);
  if (idea.closed) throw new Error(`${id} is already closed`);
  const today = ctx.clock();
  const dir = await ideaDir(root, id);
  const criteria = Object.fromEntries(CRITERIA.map((c) => [c.id, input.criteria?.[c.id] === true]));
  const review: ReviewRecord = { criteria, decision, reason, at: today };
  idea = { ...idea, review };
  const warnings: string[] = [];

  const s2a = ctx.steps.find((s) => s.id === 's2a');
  if (decision !== 'ask' && s2a && !idea.checklist.s2a?.done) {
    idea = withTick(idea, s2a, true, 'operator', today, 'review.md');
    await appendHistory(dir, { at: today, action: 'tick', by: 'operator', step: 's2a', source: 'review.md' });
  }

  if (decision === 'select') {
    const { ideas } = await listIdeas(root);
    const selected = ideas.filter((i) => i.id !== id && i.round === idea.round && i.review?.decision === 'select').length + 1;
    const cap = (await loadSettings(root)).capacity.ideasPerRound;
    if (selected > cap) warnings.push(`This makes ${selected} ideas selected this round; your limit is ${cap}.`);
  }

  let handoff: string | undefined;
  if (decision === 'csic') {
    idea = { ...idea, closed: { as: 'csic', at: today, followUp: plusDays(today, 28) }, route: 'CSIC Repository' };
    handoff = path.join(dir, 'csic-handoff.md');
    await writeFileAtomic(handoff, renderHandoff(idea, await loadSettings(root)));
  } else if (decision === 'reuse' || decision === 'notnow') {
    idea = { ...idea, closed: { as: decision, at: today } };
  }

  await writeFileAtomic(path.join(dir, 'review.md'), renderReview(idea, review));
  await saveIdea(root, idea);
  await appendHistory(dir, { at: today, action: 'review', by: 'operator', detail: `${decision}: ${reason}`, source: 'review.md' });
  const email = await draftEmail(root, { template: DECISION_EMAIL[decision], ideaId: id }, ctx.clock);
  return { idea, email, warnings, ...(handoff ? { handoff } : {}) };
}

export async function writeReviewPack(root: string, clock: Clock, steps: StepDef[]): Promise<string> {
  const round = await currentRoundId(root);
  const today = clock();
  const open = (await listIdeas(root)).ideas.filter((i) => i.round === round && !i.closed && i.stage <= 2);
  const lines = [
    `# Review pack: ${round}`, '',
    `Written ${formatDate(today)} for the TTIA review meeting. ${open.length} idea${open.length === 1 ? '' : 's'} to decide.`, '',
  ];
  for (const i of open) {
    const r = i.review;
    lines.push(
      `## ${i.id} ${i.title}`, '',
      [i.function, i.region, i.participation, i.experimented ? `experimented: ${i.experimented}` : undefined].filter(Boolean).join(' · '), '',
      `- Support requested: ${i.support.join(', ') || 'none given'}`,
      `- Flags: ${i.flags.join('; ') || 'none'}`,
      `- Criteria: ${r ? CRITERIA.map((c) => `${r.criteria[c.id] ? 'yes' : 'no'}: ${c.text}`).join('; ') : 'not reviewed yet'}`,
      `- Decision: ${r ? `${DECISION_LABELS[r.decision]}. ${r.reason}` : 'not decided yet'}`,
      `- Where it is: ${progress(i, steps).label}`, '',
    );
  }
  const file = path.join(paths(root).rounds, round, `review-pack-${today}.md`);
  await writeFileAtomic(file, lines.join('\n'));
  return file;
}
