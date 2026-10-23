import { useStore } from '../state/store';
import { useEffect, useRef, useState } from 'react';
import { copyText, designPost } from '../api';
import { NO_AI_TIP } from '../popouts/aiUi';
import {
  AI_WAIT, buildInstruction, designPhase, hasAgentKit, openStep, stepStatus, suggestedLines, SUMMARY_MAX,
} from './designHelpers';

/** GET …/design: the state, the live design.md and the idea folder relative to the workspace (newer servers). */
export interface DesignView { state: any; designMd: string; folder?: string }
export interface PlanView { planMd?: string; files: string[] }
/** Runs one design call: busy state, notice, and a refresh after. `ai` names the section waiting on the AI. Null on failure. */
export type DesignCall = <T = any>(fn: () => Promise<T>, o: { ai?: string; ok: (r: T) => string | undefined }) => Promise<T | null>;

export function StepItem({ step, off, onAnswer, onIdk, onSendQuestions, prefix = 'Q' }: {
  step: any; off: boolean; onAnswer: (body: any) => Promise<unknown>; onIdk: () => void; onSendQuestions: () => void;
  /** Before the number: Q for a design question, D for a data question. */
  prefix?: string;
}) {
  const [text, setText] = useState('');
  /** Changing a saved answer: the box reopens with the answer in it. */
  const [changing, setChanging] = useState(false);
  const st = stepStatus(step);
  return (
    <li className={`ds-step ${st.kind}`} data-step={step.n}>
      <div className="ds-h">
        <span className="ds-n">{prefix}{step.n}</span>
        <span className="ds-q">{step.question}</span>
      </div>
      {step.why && <div className="ds-why">{step.why}</div>}
      {st.kind === 'answered' && changing ? (
        <div className="ds-own">
          <textarea rows={2} value={text} aria-label={`New answer to question ${step.n}`} disabled={off} onChange={(e) => setText(e.target.value)} />
          <div className="ds-own-acts">
            <button className="btn sm ghost" data-action="cancel-change" disabled={off} onClick={() => { setChanging(false); setText(''); }}>Cancel</button>
            <button className="btn sm primary" data-action="save-changed-answer" disabled={off || !text.trim()}
              onClick={async () => { if (await onAnswer({ answer: text })) { setChanging(false); setText(''); } }}>Save answer</button>
          </div>
        </div>
      ) : st.kind === 'answered' ? (
        <div className="ds-a">
          <span className="ds-st">{st.label}</span>{step.answer}
          <button className="link-btn ds-change" data-action="change-answer" disabled={off} onClick={() => { setText(step.answer ?? ''); setChanging(true); }}>Change answer</button>
        </div>
      ) : (
        <>
          {st.kind === 'asked' && (
            <div className="ds-asked" data-testid="asked-team">
              <span>{st.label}</span>
              <button className="link-btn" data-action="send-questions" disabled={off} onClick={onSendQuestions}>Open the questions email in Outlook</button>
            </div>
          )}
          {step.suggested?.length > 0 && (
            <div className="ds-sugs">
              {step.suggested.map((s: string, i: number) => (
                <button key={i} className="btn sm ds-sug" data-action="pick-suggested" disabled={off} onClick={() => void onAnswer({ suggestedIndex: i })}>{s}</button>
              ))}
            </div>
          )}
          <div className="ds-own">
            <textarea rows={2} value={text} placeholder="Or write the answer" aria-label={`Answer to question ${step.n}`} disabled={off} onChange={(e) => setText(e.target.value)} />
            <div className="ds-own-acts">
              {st.kind === 'open' && <button className="btn sm amber" data-action="idk" disabled={off} title="Adds the question to the questions email (E2), sent from ✉ Emails" onClick={onIdk}>I don't know → ask the team</button>}
              <button className="btn sm primary" data-action="save-answer" disabled={off || !text.trim()}
                onClick={async () => { if (await onAnswer({ answer: text })) setText(''); }}>Save answer</button>
            </div>
          </div>
        </>
      )}
    </li>
  );
}

/** The design series' stage: Redesign is offered there only. */
const DESIGN_STAGE = 3;
export const REDESIGN_ASK = 'Start the design again? The questions, answers, summary, approval and diagram are cleared; the features and the tool stay.';
/** What the plan says after a Redesign, until it is written again from the new design. */
export const planStaleText = (at: string, approved: boolean) => `The design was started again on ${at}: plan.md and the kits are out of date. ${approved
  ? 'Write them again from the new design.' : 'Write them again once the new design is approved.'}`;

/** Opens the design pack: everything the design series made, with each file and how to use it. */
export function SeeDesign({ id }: { id: string }) {
  const openPopout = useStore((s) => s.openPopout);
  return (
    <div className="ds-see">
      <button className="btn primary" data-action="see-design" onClick={() => openPopout({ kind: 'design-pack', id })}>See the design</button>
      <span className="hint">The proof of concept, the tool, and every file with how to use it.</span>
    </div>
  );
}

/**
 * The design questions side by side, one in view: ‹ › move between them, the dots jump. It opens on the question
 * waiting for an answer (else the newest), and moves to a new one when it is added.
 */
export function StepCarousel({ steps, render, testId = 'design-carousel' }: { steps: any[]; render: (step: any) => React.ReactNode; testId?: string }) {
  const start = () => { const k = steps.findIndex((st) => !st.answer?.trim() && !st.askedTeam); return k >= 0 ? k : steps.length - 1; };
  const [at, setAt] = useState(start);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setAt(start()); }, [steps.length]);
  const i = Math.min(Math.max(at, 0), steps.length - 1);
  return (
    <div className="ds-carousel" data-testid={testId}>
      <div className="ds-nav">
        <button className="ds-arrow" data-action="prev-question" aria-label="Previous question" disabled={i <= 0} onClick={() => setAt(i - 1)}>‹</button>
        <span className="ds-pos" data-testid="design-pos">Question {i + 1} of {steps.length}</span>
        <span className="ds-dots">
          {steps.map((st, k) => (
            <button key={st.n} data-action="go-question" className={`ds-dot${k === i ? ' on' : ''}${st.answer?.trim() ? ' done' : ''}`} aria-label={`Question ${k + 1}`}
              aria-current={k === i ? 'step' : undefined} onClick={() => setAt(k)} />
          ))}
        </span>
        <button className="ds-arrow" data-action="next-step" aria-label="Next question" disabled={i >= steps.length - 1} onClick={() => setAt(i + 1)}>›</button>
      </div>
      <ol className="ds-steps one">{render(steps[i])}</ol>
    </div>
  );
}

/**
 * Design: the brainstorm as a conversation, one question at a time; every answer is saved on the idea at once (nothing
 * to say yes to); Approve. Works by hand with no AI: the operator adds questions, answers them and
 * writes the summary.
 */
export function DesignSection({ idea, design, busy, aiWorking, noAi, call, onSendQuestions }: {
  idea: any; design: DesignView | null; busy: boolean; aiWorking: boolean; noAi: boolean; call: DesignCall; onSendQuestions: () => void;
}) {
  const openPopout = useStore((x) => x.openPopout);
  const [handQ, setHandQ] = useState<{ question: string; suggested: string } | null>(null);
  const [finish, setFinish] = useState<string | null>(null);
  /** Redesign asks first: it clears the questions, the answers, the summary, the approval and the diagram. */
  const [redo, setRedo] = useState(false);
  const qRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (handQ && !handQ.question) qRef.current?.focus(); }, [handQ]);
  const id = idea.id;
  const off = busy || aiWorking;
  if (!design) return <section className="sec"><h3>Design</h3><div className="hint">Loading…</div></section>;
  const s = design.state;
  const phase = designPhase(s);
  const steps: any[] = s.steps ?? [];
  const waiting = openStep(steps);

  const answer = (n: number, body: any) => call(() => designPost(id, 'design/answer', { n, ...body }), { ok: () => `Answer to question ${n} saved.` });
  const next = () => call(() => designPost(id, 'design/step', {}), {
    ai: 'design', ok: (r: any) => (r.step ? `Question ${r.step.n} added.` : r.state?.summary
      ? `Design complete. Check the summary, then approve it.${r.diagramError ? ' The diagram could not be drawn this time: open See the design and press Redraw.' : ''}` : undefined),
  });
  const addHand = async () => {
    if (!handQ) return;
    const r = await call(() => designPost(id, 'design/step', { question: handQ.question, suggested: suggestedLines(handQ.suggested) }), {
      ok: (x: any) => `Question ${x.step?.n ?? ''} added.`.replace('  ', ' '),
    });
    if (r) setHandQ(null);
  };
  const doFinish = async () => {
    if (finish === null) return;
    const r = await call(() => designPost(id, 'design/finish', { summary: finish }), { ok: () => 'Design complete. Check the summary, then approve it.' });
    if (r) setFinish(null);
  };
  // Redesign: offered in the Design series once the design has questions (in progress, complete or approved).
  const canRedo = idea.stage === DESIGN_STAGE && !idea.closed && (steps.length > 0 || Boolean(s.summary));
  const doRedo = async () => {
    const r = await call(() => designPost(id, 'design/redesign'), {
      ok: (x: any) => `Design started again: the features and the tool are kept.${x.planStale ? ' plan.md and the kits are out of date: write them again once the new design is approved.' : ''}`,
    });
    if (r) setRedo(false);
  };

  return (
    <section className="sec" data-testid="design">
      <h3>Design <span className="sec-n">{phase === 'approved' ? `approved ${s.approvedAt}` : phase === 'done' ? 'complete' : `${steps.length} question${steps.length === 1 ? '' : 's'}`}</span></h3>
      {(!s.features?.length || !s.tool) && <div className="hint ds-lead">List the features and pick the tool first: the questions build on them, and on what the tool can't do.</div>}
      {steps.length > 0 && (
        <StepCarousel steps={steps} render={(st) => (
          <StepItem key={st.n} step={st} off={off} onSendQuestions={onSendQuestions}
            onAnswer={(body) => answer(st.n, body)}
            onIdk={() => void call(() => designPost(id, 'design/answer', { n: st.n, idk: true }), { ok: () => `Question ${st.n} added to the questions email (E2): send it from ✉ Emails. Carry on with the next question.` })} />
        )} />
      )}
      {(phase === 'done' || phase === 'approved') && (
        <div className="ds-done" data-testid="design-complete">
          <div className="ds-done-h">Design complete</div>
          <div className="ds-sum">{s.summary}</div>
        </div>
      )}
      {/* What the design answers change in the record: the same list as the decision's and the tool picker's, each waiting for Yes. */}
      {handQ && (
        <div className="ds-form" data-testid="hand-question">
          <input ref={qRef} type="text" value={handQ.question} maxLength={200} placeholder="The question" aria-label="Question" disabled={off}
            onChange={(e) => setHandQ({ ...handQ, question: e.target.value })} />
          <textarea rows={2} value={handQ.suggested} placeholder="Suggested answers, one per line (optional, up to 4)" aria-label="Suggested answers" disabled={off}
            onChange={(e) => setHandQ({ ...handQ, suggested: e.target.value })} />
          <div className="ds-form-acts">
            <button className="btn ghost" onClick={() => setHandQ(null)}>Cancel</button>
            <button className="btn primary" data-action="add-question" disabled={off || !handQ.question.trim()} onClick={() => void addHand()}>Add question</button>
          </div>
        </div>
      )}
      {finish !== null && (
        <div className="ds-form" data-testid="hand-finish">
          <textarea rows={3} value={finish} maxLength={SUMMARY_MAX} placeholder="Summary: what the proof of concept shows, with what input, built by whom" aria-label="Design summary" disabled={off}
            onChange={(e) => setFinish(e.target.value)} />
          <div className="ds-form-acts">
            <span className="hint">{finish.length}/{SUMMARY_MAX}</span>
            <button className="btn ghost" onClick={() => setFinish(null)}>Cancel</button>
            <button className="btn primary" data-action="finish-design" disabled={off || !finish.trim()} onClick={() => void doFinish()}>Finish design</button>
          </div>
        </div>
      )}
      {(phase === 'done' || phase === 'approved') && (
        // The two things to do with a finished design, side by side: look at it, then approve it.
        <div className="ai-row ds-final" data-testid="design-final">
          <button className="btn primary" data-action="see-design" onClick={() => openPopout({ kind: 'design-pack', id })}>See the design</button>
          {phase === 'done' && (
            <button className="btn primary" data-action="approve-design" disabled={off}
              onClick={() => void call(() => designPost(id, 'design/approve'), { ok: (r: any) => r.notice ?? 'Design approved.' })}>Approve design</button>
          )}
        </div>
      )}
      <div className="ai-row ds-acts">
        {phase !== 'done' && phase !== 'approved' && (
          <button className="btn primary" data-action="next-question" disabled={noAi || off || Boolean(waiting)}
            title={noAi ? NO_AI_TIP : waiting ? `Answer question ${waiting.n} first, or say "I don't know"` : undefined} onClick={() => void next()}>
            {aiWorking ? 'Working…' : steps.length ? 'Next question' : 'Start with the first question'}</button>
        )}
        {!handQ && <button className="btn" data-action="hand-question" disabled={off} onClick={() => setHandQ({ question: '', suggested: '' })}>Add a question by hand</button>}
        {finish === null && steps.length > 0 && (
          <button className="btn" data-action="hand-finish" disabled={off} onClick={() => setFinish(s.summary ?? '')}>Finish by hand</button>
        )}
        {canRedo && !redo && <button className="btn" data-action="redesign" disabled={off} onClick={() => setRedo(true)}>Redesign</button>}
        {aiWorking && <span className="ai-busy" role="status">{AI_WAIT}</span>}
      </div>
      {canRedo && redo && (
        <div className="ds-form ds-redo" data-testid="redesign-confirm" role="group" aria-label="Start the design again">
          <div>{REDESIGN_ASK}</div>
          <div className="ds-form-acts">
            <button className="btn ghost" data-action="redesign-cancel" onClick={() => setRedo(false)}>Cancel</button>
            <button className="btn primary" data-action="redesign-yes" disabled={off} onClick={() => void doRedo()}>Start again</button>
          </div>
        </div>
      )}
      {phase === 'done' && <div className="hint">Adding a question by hand reopens the design.</div>}
    </section>
  );
}

/** Plan and kits, once the design is approved: plan.md and a starter kit for the picked tool. The app writes no code. */
export function PlanSection({ idea, design, plan, busy, aiWorking, noAi, call }: {
  idea: any; design: DesignView | null; plan: PlanView | null; busy: boolean; aiWorking: boolean; noAi: boolean; call: DesignCall;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const fbRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (fallback) { fbRef.current?.focus(); fbRef.current?.select(); } }, [fallback]);
  const files = plan?.files ?? [];
  const approved = Boolean(design) && designPhase(design!.state) === 'approved';
  // Files written earlier stay on screen after the design is reopened; writing again waits for a new approval.
  if (!design || (!approved && files.length === 0)) return null;
  const off = busy || aiWorking || !approved;
  const write = () => call(() => designPost(idea.id, 'plan'), { ai: 'plan', ok: (r: any) => `Wrote ${r.files.length} file${r.files.length === 1 ? '' : 's'}: plan.md and the starter kits.${r.note ? ` ${r.note}` : ''}` });
  const copy = async () => {
    const text = buildInstruction(idea.id, idea.slug, design.folder);
    setFallback(null); setCopied(null);
    if (await copyText(text)) setCopied('Build instruction copied. Paste it into Claude Code or Copilot.');
    else setFallback(text);
  };
  return (
    <section className="sec" data-testid="plan-kits">
      <h3>Plan and kits {files.length > 0 && <span className="sec-n">{files.length} file{files.length === 1 ? '' : 's'}</span>}</h3>
      <div className="ai-row">
        <button className="btn primary" data-action="write-plan" disabled={noAi || off} title={noAi ? `${NO_AI_TIP}: plan.md needs the AI` : !approved ? 'Approve the design again first' : undefined} onClick={() => void write()}>
          {aiWorking ? 'Working…' : files.length ? 'Write the plan and kits again' : 'Write the plan and kits'}</button>
        {aiWorking && <span className="ai-busy" role="status">{AI_WAIT}</span>}
      </div>
      {files.length > 0 ? (
        <>
          <ul className="pk-files" aria-label="Plan and kit files">
            {files.map((f) => <li key={f}>{f}</li>)}
          </ul>
          <div className={`hint${design.state.planStale ? ' warn' : ''}`} data-testid={design.state.planStale ? 'plan-stale' : undefined}>
            {design.state.planStale ? planStaleText(design.state.planStale, approved)
              : approved ? 'Writing again rewrites plan.md and the kit files the app made; your own files are kept.' : 'The design was reopened: approve it again, then write the plan again.'}
          </div>
        </>
      ) : <div className="hint">{noAi ? 'plan.md and the kits need the AI. Connect one from the AI button in the title bar.' : 'Writes plan.md and a filled-in starter kit for the picked tool (and for any tool the design adds for its gaps): a synthetic sample, the tool\'s own files and a test checklist. No code.'}</div>}
      {hasAgentKit(files) && (
        <div className="pk-agent">
          <div className="hint">The custom-app part is built with a coding agent and goes to the CSIC Repository.</div>
          <button className="btn" data-action="copy-instruction" onClick={() => void copy()}>Copy build instruction</button>
          {copied && <div className="pk-ok" role="status">{copied}</div>}
          {fallback && (
            <div className="copy-fallback">
              <div>The browser would not copy. The instruction is selected below: press Ctrl+C (⌘C on a Mac).</div>
              <textarea ref={fbRef} readOnly value={fallback} rows={5} aria-label="Build instruction to copy" />
            </div>
          )}
        </div>
      )}
      {files.length > 0 && <SeeDesign id={idea.id} />}
    </section>
  );
}
