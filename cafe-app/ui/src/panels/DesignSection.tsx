import { useEffect, useRef, useState } from 'react';
import { copyText, designPost } from '../api';
import { NO_AI_TIP } from '../popouts/aiUi';
import {
  AI_WAIT, buildInstruction, cafeCheckRows, designPhase, hasAgentKit, openStep, stepStatus, suggestedLines, SUMMARY_MAX,
} from './designHelpers';

/** GET …/design: the state, the live design.md and the idea folder relative to the workspace (newer servers). */
export interface DesignView { state: any; designMd: string; folder?: string }
export interface PlanView { planMd?: string; files: string[] }
/** Runs one design call: busy state, notice, and a refresh after. `ai` names the section waiting on the AI. Null on failure. */
export type DesignCall = <T = any>(fn: () => Promise<T>, o: { ai?: string; ok: (r: T) => string | undefined }) => Promise<T | null>;

export function Toggle({ label, text, action }: { label: string; text: string | undefined; action: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className="md-toggle">
      <button className="link-btn" data-action={action} aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? `Hide ${label}` : `Show ${label}`}</button>
      {open && <pre className="md-pre" aria-label={label}>{text}</pre>}
    </div>
  );
}

export function CafeCheckCard({ check }: { check: any }) {
  const rows = cafeCheckRows(check);
  const clean = rows.every((r) => r.clean);
  return (
    <div className={`cc-card${clean ? ' clean' : ''}`} data-testid="cafe-check">
      <div className="cc-h">Café check <span className={`cc-all ${clean ? 'ok' : 'warn'}`}>{clean ? 'Clean' : 'Look at the amber rows'}</span></div>
      {rows.map((r) => (
        <div key={r.key} className={`cc-row ${r.clean ? 'ok' : 'warn'}`} data-row={r.key}>
          <span className="cc-l">{r.label}</span>
          <span className="cc-v">{r.clean ? 'Clean' : r.items.join(', ')}</span>
        </div>
      ))}
    </div>
  );
}

function StepItem({ step, off, onAnswer, onIdk, onOutbox }: {
  step: any; off: boolean; onAnswer: (body: any) => Promise<unknown>; onIdk: () => void; onOutbox: () => void;
}) {
  const [text, setText] = useState('');
  /** Changing a saved answer: the box reopens with the answer in it. */
  const [changing, setChanging] = useState(false);
  const st = stepStatus(step);
  return (
    <li className={`ds-step ${st.kind}`} data-step={step.n}>
      <div className="ds-h">
        <span className="ds-n">Q{step.n}</span>
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
              <button className="link-btn" data-action="open-outbox" onClick={onOutbox}>Open the Outbox</button>
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
              {st.kind === 'open' && <button className="btn sm amber" data-action="idk" disabled={off} title="Adds the question to the E2 draft in the Outbox" onClick={onIdk}>I don't know → ask the team</button>}
              <button className="btn sm primary" data-action="save-answer" disabled={off || !text.trim()}
                onClick={async () => { if (await onAnswer({ answer: text })) setText(''); }}>Save answer</button>
            </div>
          </div>
        </>
      )}
    </li>
  );
}

/**
 * Design: the brainstorm as a conversation, one question at a time; the Café check; Approve. Works by hand with no AI:
 * the operator adds questions, answers them and writes the summary.
 */
export function DesignSection({ idea, design, busy, aiWorking, noAi, call, onOutbox }: {
  idea: any; design: DesignView | null; busy: boolean; aiWorking: boolean; noAi: boolean; call: DesignCall; onOutbox: () => void;
}) {
  const [handQ, setHandQ] = useState<{ question: string; suggested: string } | null>(null);
  const [finish, setFinish] = useState<string | null>(null);
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
    ai: 'design', ok: (r: any) => (r.step ? `Question ${r.step.n} added.` : r.state?.summary ? 'Design complete. Check the summary, then approve it.' : undefined),
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

  return (
    <section className="sec" data-testid="design">
      <h3>Design <span className="sec-n">{phase === 'approved' ? `approved ${s.approvedAt}` : phase === 'done' ? 'complete' : `${steps.length} question${steps.length === 1 ? '' : 's'}`}</span></h3>
      {!s.features?.length && <div className="hint ds-lead">Pick tools for the features first: the questions build on them.</div>}
      {steps.length > 0 && (
        <ol className="ds-steps">
          {steps.map((st) => (
            <StepItem key={st.n} step={st} off={off} onOutbox={onOutbox}
              onAnswer={(body) => answer(st.n, body)}
              onIdk={() => void call(() => designPost(id, 'design/answer', { n: st.n, idk: true }), { ok: () => `Question ${st.n} added to the E2 draft in the Outbox. Carry on with the next question.` })} />
          ))}
        </ol>
      )}
      {(phase === 'done' || phase === 'approved') && (
        <div className="ds-done" data-testid="design-complete">
          <div className="ds-done-h">Design complete</div>
          <div className="ds-sum">{s.summary}</div>
        </div>
      )}
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
        {phase === 'done' && (
          <button className="btn primary" data-action="approve-design" disabled={off}
            onClick={() => void call(() => designPost(id, 'design/approve'), { ok: (r: any) => r.notice ?? 'Design approved.' })}>Approve design</button>
        )}
        {aiWorking && <span className="ai-busy" role="status">{AI_WAIT}</span>}
      </div>
      {phase === 'done' && <div className="hint">Adding a question by hand reopens the design.</div>}
      <CafeCheckCard check={s.cafeCheck} />
      <Toggle label="design.md" text={design.designMd} action="toggle-design-md" />
    </section>
  );
}

/** Plan and kits, once the design is approved: plan.md and a starter kit per picked tool. The app writes no code. */
export function PlanSection({ idea, design, plan, busy, aiWorking, noAi, call }: {
  idea: any; design: DesignView | null; plan: PlanView | null; busy: boolean; aiWorking: boolean; noAi: boolean; call: DesignCall;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const fbRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (fallback) { fbRef.current?.focus(); fbRef.current?.select(); } }, [fallback]);
  if (!design || designPhase(design.state) !== 'approved') return null;
  const files = plan?.files ?? [];
  const off = busy || aiWorking;
  const write = () => call(() => designPost(idea.id, 'plan'), { ai: 'plan', ok: (r: any) => `Wrote ${r.files.length} file${r.files.length === 1 ? '' : 's'}: plan.md and the starter kits.` });
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
        <button className="btn primary" data-action="write-plan" disabled={noAi || off} title={noAi ? `${NO_AI_TIP}: plan.md needs the AI` : undefined} onClick={() => void write()}>
          {aiWorking ? 'Working…' : files.length ? 'Write the plan and kits again' : 'Write the plan and kits'}</button>
        {aiWorking && <span className="ai-busy" role="status">{AI_WAIT}</span>}
      </div>
      {files.length > 0 ? (
        <>
          <ul className="pk-files" aria-label="Plan and kit files">
            {files.map((f) => <li key={f}>{f}</li>)}
          </ul>
          <div className="hint">Writing again rewrites plan.md and the kit files the app made; your own files are kept.</div>
        </>
      ) : <div className="hint">{noAi ? 'plan.md and the kits need the AI. Connect one from the AI button in the title bar.' : 'Writes plan.md and a starter kit for each picked tool. No code: the kits are templates.'}</div>}
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
      <Toggle label="plan.md" text={plan?.planMd} action="toggle-plan-md" />
    </section>
  );
}
