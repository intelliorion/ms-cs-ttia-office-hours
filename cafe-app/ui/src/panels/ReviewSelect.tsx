import { useEffect, useState } from 'react';
import { emailAnswerFor, isOpenNeed, awaitsReevaluation } from '../../../src/review/needs';
import { shortDate } from './filterIdeas';
import { DECISION_HINTS } from '../popouts/IdeaSections';
import { DECISION_EMAIL } from '../popouts/ideaHelpers';

/**
 * Review and Select: Suggest a decision lists what is still needed, one item at a time, each with a box for the
 * answer. Draft email sends the open questions to the team (in Outlook); Re-evaluate reads the answers again. Once
 * nothing is open, Save decision appears with the suggestion filled in.
 */
export interface ReviewSelectProps {
  idea: any;
  state: any;
  busy: boolean;
  aiBusy: boolean;
  noAi: boolean;
  noAiTip: string;
  aiName: string;
  onSuggest: () => void;
  onAnswer: (need: string, answer: string) => Promise<void>;
  onDraftEmail: () => void;
  onSave: (body: { criteria: Record<string, boolean>; decision: string; reason: string }) => void;
}

type Status = 'open' | 'answered' | 'met';
export function needStatus(need: any, answers: any[] = []): Status {
  if (need.met) return 'met';
  return awaitsReevaluation(need, answers) ? 'answered' : 'open';
}

export function ReviewSelect({ idea, state, busy, aiBusy, noAi, noAiTip, aiName, onSuggest, onAnswer, onDraftEmail, onSave }: ReviewSelectProps) {
  const prep = idea.prep;
  const answers = idea.answers ?? [];
  const needs: any[] = prep?.needs ?? [];
  const open = needs.filter((n) => isOpenNeed(n, answers));
  const waiting = needs.filter((n) => awaitsReevaluation(n, answers));
  const clear = !!prep && !open.length && !waiting.length;
  const [anyway, setAnyway] = useState(false);
  const off = busy || aiBusy || !!idea.closed;
  const showForm = clear || anyway || (!prep && !!idea.review);
  return (
    <section className="sec rs" data-testid="review">
      <h3>Decision {idea.review && <span className="sec-n">saved {shortDate(idea.review.at)}</span>}</h3>
      {!prep && (
        <div className="hint lead">Let the AI read the form, any answers and the graph, and list what you still need before deciding.</div>
      )}
      {prep && (
        <div className="rs-sugg" data-testid="rs-suggestion">
          <div className="rs-k">Suggested</div>
          <div className="rs-d">{state.decisions?.[prep.decision] ?? prep.decision}</div>
          <div className="rs-r">{prep.reason}</div>
          <div className="rs-by">By {aiName} on {shortDate(prep.at)}. {prep.basis}.</div>
        </div>
      )}
      {prep && (
        <div className="rs-todo">
          <div className="rs-th">
            <span>What you need</span>
            <span className="sec-n" data-testid="rs-count">{needs.length === 0 ? 'nothing' : open.length ? `${open.length} open` : waiting.length ? `${waiting.length} to re-evaluate` : 'all clear'}</span>
          </div>
          {needs.length === 0 && <div className="hint">Nothing more is needed to decide.</div>}
          <ol className="rs-list">
            {needs.map((n) => <Need key={n.id} need={n} answers={answers} disabled={off} onAnswer={onAnswer} />)}
          </ol>
        </div>
      )}
      <div className="rs-acts">
        {!prep ? (
          <button className="btn primary" data-action="ai-suggest-review" disabled={noAi || off} title={noAi ? noAiTip : undefined} onClick={onSuggest}>
            {aiBusy ? 'Working…' : 'Suggest a decision'}</button>
        ) : (
          <>
            <button className="btn" data-action="draft-questions" disabled={off || !open.length}
              title={open.length ? 'The open questions as one email, opened in Outlook' : 'Nothing open to ask'} onClick={onDraftEmail}>✉ Draft email</button>
            <button className={`btn${waiting.length ? ' primary' : ''}`} data-action="reevaluate" disabled={noAi || off} title={noAi ? noAiTip : 'Read everything again, with the answers'} onClick={onSuggest}>
              {aiBusy ? 'Working…' : 'Re-evaluate'}</button>
          </>
        )}
      </div>
      {prep && !showForm && (
        <div className="rs-wait hint">
          {waiting.length ? 'Answers are in: Re-evaluate to check them.' : 'Send the questions, paste the answers when they come, then Re-evaluate.'}
          {' '}<button className="link-btn" data-action="decide-anyway" disabled={off} onClick={() => setAnyway(true)}>Decide anyway</button>
        </div>
      )}
      {showForm && <DecisionForm idea={idea} state={state} prep={prep} disabled={off} onSave={onSave} />}
    </section>
  );
}

function Need({ need, answers, disabled, onAnswer }: { need: any; answers: any[]; disabled: boolean; onAnswer: (need: string, answer: string) => Promise<void> }) {
  const [text, setText] = useState(need.answer ?? '');
  useEffect(() => { setText(need.answer ?? ''); }, [need.id, need.answer]);
  const status = needStatus(need, answers);
  const emailed = emailAnswerFor(need, answers);
  const save = () => { if (text.trim() !== (need.answer ?? '').trim()) void onAnswer(need.id, text); };
  return (
    <li className={`rs-need st-${status}`} data-need={need.id}>
      <span className="rs-mark" aria-label={status === 'met' ? 'Done' : status === 'answered' ? 'Answered, to re-evaluate' : 'Open'}>
        {status === 'met' ? '✓' : status === 'answered' ? '◐' : '○'}</span>
      <div className="rs-body">
        <div className="rs-need-t">{need.need}</div>
        <div className="rs-ask">Ask: {need.ask}{need.askedAt && <span className="rs-asked"> · asked {shortDate(need.askedAt)}</span>}</div>
        {need.met && need.note && <div className="rs-note">{need.note}</div>}
        {emailed && !need.answer && <div className="rs-email" data-testid="rs-from-email"><b>From email:</b> {emailed.answer}</div>}
        {!need.met && (
          <textarea className="rs-ans" rows={2} placeholder="Paste or type the answer" value={text} disabled={disabled}
            aria-label={`Answer: ${need.need}`} onChange={(e) => setText(e.target.value)} onBlur={save} />
        )}
      </div>
    </li>
  );
}

function DecisionForm({ idea, state, prep, disabled, onSave }: { idea: any; state: any; prep: any; disabled: boolean; onSave: ReviewSelectProps['onSave'] }) {
  // The latest suggestion is picked for you (not saved); without one, the decision saved before. "Ask first" is what the
  // to-do list does now, so it is not a choice here.
  const suggested = prep?.decision && prep.decision !== 'ask' ? prep.decision : '';
  const start = suggested || idea.review?.decision || '';
  const [decision, setDecision] = useState<string>(start);
  useEffect(() => { setDecision(start); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [idea.id, prep?.at, prep?.decision, prep?.reason, idea.review?.at, idea.review?.decision]);
  const choices = Object.entries(state.decisions ?? {}).filter(([k]) => k !== 'ask' || idea.review?.decision === 'ask');
  const email = DECISION_EMAIL[decision];
  const saved = idea.review?.decision === decision;
  const label = (k: string) => String(state.decisions?.[k] ?? k);
  return (
    <div className="rs-form" data-testid="rs-form">
      <div className="decisions" role="radiogroup" aria-label="Decision" data-action="decision">
        {choices.map(([k, v]) => (
          <label key={k} className={`dc${decision === k ? ' on' : ''}`}>
            <input type="radio" name={`decision-${idea.id}`} value={k} checked={decision === k} disabled={disabled} onChange={() => setDecision(k)} />
            <span className="dc-l">{String(v)}{k === suggested && <span className="dc-s">suggested</span>}</span>
            <span className="dc-h">{DECISION_HINTS[k] ?? ''}</span>
          </label>
        ))}
      </div>
      <div className="rv-foot">
        <span className="hint" data-testid="rs-saved">{!decision ? 'Pick a decision.'
          : saved ? `Saved ${shortDate(idea.review.at)}.`
          : `Not saved yet. Saving sends nothing and moves nothing; ${email} waits under ✉ Emails.`}</span>
        <button className="btn primary" data-action="save-review" disabled={disabled || !decision || saved}
          onClick={() => onSave({ criteria: prep?.criteria ?? idea.review?.criteria ?? {}, decision, reason: reasonFor(decision, prep, idea.review, label) })}>Save decision</button>
      </div>
    </div>
  );
}

/**
 * The reason kept with the decision (review.md, the CSIC handoff); the emails leave [REASON] for you to write in Outlook.
 * The suggestion's own reason when you take it; when you pick something else, the record says so.
 */
export function reasonFor(decision: string, prep: any, review: any, label: (k: string) => string): string {
  if (prep?.reason && prep.decision === decision) return prep.reason;
  if (prep?.reason) return `${label(decision)}, chosen by the operator (the suggestion was ${label(prep.decision)}: ${prep.reason})`;
  if (review?.reason && review.decision === decision) return review.reason;
  return `${label(decision)}, chosen by the operator`;
}
