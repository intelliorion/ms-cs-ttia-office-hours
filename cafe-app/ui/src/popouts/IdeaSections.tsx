import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { shortDate } from '../panels/filterIdeas';
import { applySuggestion, type ReviewSuggestion } from './aiUi';
import {
  DECISION_EMAIL, IDEA_TEMPLATES, reviewKey, shouldResetReview, TEMPLATE_TITLES, emailAction, emailStatus, historyLine, type HistoryEntry,
} from './ideaHelpers';

/** The sections of an idea's details (shown in the left panel): Decision, the stage button, Emails, Details and History. */

const ROLE: Record<string, string> = { lead: 'Lead', sponsor: 'Sponsor', member: 'Member' };

/**
 * The stage badge in the idea head is a button; it opens this small menu of the stages and the close-as reasons.
 * Picking one applies at once (the server returns the notice and any suggestion). Esc or a click elsewhere closes it.
 */
export function StageButton({ state, value, label, colour, busy, onPick }: {
  state: any; value: string; label: string; colour: string; busy: boolean; onPick: (t: { stage?: number; closeAs?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  // The panel clips its overflow, so the menu is pinned to the viewport under the button.
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const toggle = () => {
    if (!open) { const r = btn.current?.getBoundingClientRect(); if (r) setAt({ top: r.bottom + 6, right: window.innerWidth - r.right }); }
    setOpen((o) => !o);
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { const t = e.target as Node; if (!box.current?.contains(t) && !menu.current?.contains(t)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc, true); };
  }, [open]);
  const pick = (v: string) => {
    setOpen(false);
    if (v === value) return;
    const [k, n] = v.split(':');
    onPick(k === 'close' ? { closeAs: n } : { stage: Number(n) });
  };
  const item = (v: string, text: string) => (
    <li key={v} role="menuitemradio" aria-checked={v === value}>
      <button className={`stage-opt${v === value ? ' on' : ''}`} data-action="stage-pick" data-value={v} disabled={busy} onClick={() => pick(v)}>
        <span className="tick">{v === value ? '✓' : ''}</span>{text}
      </button>
    </li>
  );
  return (
    <div className="stage-wrap" ref={box}>
      <button ref={btn} className="stg stg-btn" style={{ ['--c' as string]: colour }} data-action="stage" aria-haspopup="menu" aria-expanded={open}
        title="Change the stage" disabled={busy} onClick={toggle}>{label} <span className="caret">▾</span></button>
      {open && at && createPortal(
        <ul ref={menu} className="stage-pop" role="menu" aria-label="Stage" data-testid="stage-menu" style={{ position: 'fixed', top: at.top, right: at.right }}>
          <li className="stage-h">Stages</li>
          {Object.keys(state.stageNames).map((n) => item(`stage:${n}`, `${n} · ${state.stageNames[n]}`))}
          <li className="stage-h">Close as</li>
          {Object.keys(state.closures).map((c) => item(`close:${c}`, state.closures[c]))}
        </ul>, document.body)}
    </div>
  );
}

export function History({ history, steps }: { history: HistoryEntry[] | null; steps: any }) {
  return (
    <section className="sec">
      <h3>History <span className="sec-n">last 10</span></h3>
      {history === null ? <div className="hint">Couldn’t read the history.</div>
        : !history.length ? <div className="hint">Nothing logged yet.</div>
          : (
            <ol className="history">
              {history.slice(-10).reverse().map((h, i) => (
                <li key={`${h.at}-${i}`}>
                  <span className="when">{shortDate(h.at)}</span>
                  <span className="what">{historyLine(h, steps)}</span>
                  <span className="who">{h.by === 'app' ? 'app' : 'you'}</span>
                </li>
              ))}
            </ol>
          )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="field"><div className="f-l">{label}</div><div className="f-v">{children}</div></div>;
}

const tags = (xs: string[] | undefined, cls = '') =>
  xs?.length ? <div className="tags">{xs.map((t) => <span key={t} className={`tg ${cls}`}>{t}</span>)}</div> : <span className="none">Not given</span>;

export function Details({ idea }: { idea: any }) {
  const team: any[] = idea.people?.team ?? [];
  return (
    <section className="sec">
      <h3>Details</h3>
      <Field label="Business challenge">{idea.challenge || <span className="none">Not given</span>}</Field>
      <Field label="Current process">{idea.current_process || <span className="none">Not given</span>}</Field>
      <Field label="Desired outcomes">{tags(idea.outcomes)}</Field>
      <Field label="Support requested">{tags(idea.support, 'teal')}</Field>
      <div className="field-row">
        <Field label="Team">
          {team.length
            ? <div className="tags">{team.map((p) => <span key={p.name + p.role} className="tg person">{p.name}<em>{ROLE[p.role] ?? p.role}</em></span>)}</div>
            : idea.people?.submitter ? <span>{idea.people.submitter}<em className="role"> Submitter</em></span> : <span className="none">Not given</span>}
        </Field>
        <Field label="Tried it already">{idea.experimented || <span className="none">Not given</span>}</Field>
      </div>
    </section>
  );
}

export function Review({ idea, state, busy, onSave, aiReview, aiName, onClearAi, aiBar }: {
  idea: any; state: any; busy: boolean; onSave: (b: unknown) => void;
  aiReview: ReviewSuggestion | null; aiName: string; onClearAi: () => void; aiBar: React.ReactNode;
}) {
  const [suggested, setSuggested] = useState(false);
  const [criteria, setCriteria] = useState<Record<string, boolean>>({});
  const [decision, setDecision] = useState('');
  const [reason, setReason] = useState('');
  // Reset the form only for another idea or a newly saved review; a refresh after any other action keeps what was typed.
  const key = reviewKey(idea);
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (!shouldResetReview(lastKey.current, key)) return;
    lastKey.current = key;
    setCriteria({ ...(idea.review?.criteria ?? {}) });
    setDecision(idea.review?.decision ?? '');
    setReason(idea.review?.reason ?? '');
    setSuggested(false);
  }, [key, idea.review]);
  // A suggestion fills the form but is not saved; the highlight stays until the operator edits or saves.
  useEffect(() => {
    if (!aiReview) return;
    const f = applySuggestion({ criteria, decision, reason }, aiReview);
    setCriteria(f.criteria); setDecision(f.decision); setReason(f.reason); setSuggested(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiReview]);
  const edited = () => { if (suggested) { setSuggested(false); onClearAi(); } };
  // The checks start open until a decision is picked; a suggestion opens them so its ticks are seen.
  const [checksOpen, setChecksOpen] = useState(!idea.review?.decision);
  useEffect(() => { if (aiReview) setChecksOpen(true); }, [aiReview]);
  const closed = Boolean(idea.closed);
  const off = closed || busy;
  return (
    <section className="sec" data-testid="review">
      <h3>Decision {idea.review && <span className="sec-n">saved {shortDate(idea.review.at)}</span>}</h3>
      <div className="hint lead">Pick what happens to this idea. Saving drafts the matching email into the Outbox; nothing moves until you say yes.</div>
      {aiBar}
      <div className={`decisions${suggested ? ' suggested' : ''}`} role="radiogroup" aria-label="Decision" data-action="decision">
        {Object.entries(state.decisions ?? {}).map(([k, v]) => (
          <label key={k} className={`dc${decision === k ? ' on' : ''}`}>
            <input type="radio" name={`decision-${idea.id}`} value={k} checked={decision === k} disabled={off}
              onChange={() => { edited(); setDecision(k); }} />
            <span className="dc-l">{String(v)}</span>
            <span className="dc-h">{DECISION_HINTS[k] ?? ''}</span>
          </label>
        ))}
      </div>
      <textarea className={`reason${suggested ? ' suggested-box' : ''}`} rows={2} placeholder="Reason, in a sentence the team will read" value={reason} disabled={off}
        onChange={(e) => { edited(); setReason(e.target.value); }} aria-label="Reason" />
      <details className="checks" open={checksOpen} onToggle={(e) => setChecksOpen((e.target as HTMLDetailsElement).open)}>
        <summary>Before you decide <span className="sec-n">{Object.values(criteria).filter(Boolean).length} of {(state.criteria ?? []).length} ticked, for your own notes</span></summary>
        <ul className={`criteria${suggested ? ' suggested' : ''}`}>
          {(state.criteria ?? []).map((c: any) => (
            <li key={c.id}>
              <label>
                <input type="checkbox" checked={criteria[c.id] === true} disabled={off}
                  onChange={(e) => { edited(); setCriteria((x) => ({ ...x, [c.id]: e.target.checked })); }} />
                <span>{c.text}</span>
              </label>
            </li>
          ))}
        </ul>
      </details>
      {suggested && <div className="sg-by" data-testid="ai-review-by">Suggested by {aiName}. Check it, change what you like, then save.</div>}
      <div className="rv-foot">
        <span className="hint">{decision ? SAVE_HINTS[decision] ?? '' : 'Pick a decision and give a reason.'}</span>
        <button className="btn primary" data-action="save-review" disabled={off || !decision || !reason.trim()}
          onClick={() => onSave({ criteria, decision, reason })}>
          {decision ? `Save and draft ${DECISION_EMAIL[decision] ?? ''}`.trim() : 'Save decision'}
        </button>
      </div>
    </section>
  );
}

/** One line per decision: what it means for the team. */
export const DECISION_HINTS: Record<string, string> = {
  select: 'Into the design series: tools, brainstorm, plan.',
  reuse: 'Something that exists already covers it.',
  csic: 'Needs a live system or custom build: the CSIC Repository takes it.',
  notnow: 'Parked; can come back in a later round.',
  ask: 'Not decidable yet: questions go to the team first.',
};

/** What Save does for each decision, shown by the button. */
export const SAVE_HINTS: Record<string, string> = {
  select: 'Drafts E3 and offers the move to the design series.',
  reuse: 'Drafts E4 and offers to close the idea as reused.',
  csic: 'Drafts E5, writes the CSIC handoff and offers to close the idea.',
  notnow: 'Drafts E6 and offers to close the idea for this round.',
  ask: 'Drafts E2 with your questions; the idea stays here.',
};

export function Emails({ idea, outbox, busy, onDraft, onReply, onSetFirst, onApprove, onCopy, onSent }: {
  idea: any; outbox: any[]; busy: boolean;
  onDraft: (t: string) => void; onReply: () => void; onSetFirst: () => void;
  onApprove: (key: string) => void; onCopy: (m: any) => void; onSent: (key: string) => void;
}) {
  const [pick, setPick] = useState('E1');
  const mails = outbox.filter((m) => m.idea === idea.id);
  const replyDue = idea.due?.s2d && !idea.checklist?.s2d?.done;
  return (
    <section className="sec">
      <h3>Emails</h3>
      {mails.length ? (
        <ul className="mails">
          {mails.map((m) => {
            const a = emailAction(m);
            const left = m.contentPlaceholders?.length ?? 0;
            return (
              <li key={m.key} data-key={m.key}>
                <div className="mr1">
                  <span className="tpl">{m.template}</span>
                  <span className="subj" title={m.view?.subject}>{TEMPLATE_TITLES[m.template] ?? m.view?.subject}</span>
                  <span className={`st st-${m.status}`}>{emailStatus(m.status)}</span>
                </div>
                <div className="mr2">
                  <span className="hint">{m.status !== 'sent' && left > 0 ? `${left} placeholder${left > 1 ? 's' : ''} to fill in Outlook` : ''}</span>
                  <span className="acts">
                    {a.kind === 'set-first' && <button className="link-btn" data-action="set-first" title="Opens Round" onClick={onSetFirst}>{a.label}</button>}
                    {a.kind === 'approve' && <button className="btn primary sm" data-action="approve" disabled={busy} onClick={() => onApprove(m.key)}>{a.label}</button>}
                    {a.kind === 'sent' && (
                      <>
                        <button className="btn sm" data-action="copy" disabled={busy} onClick={() => onCopy(m)}>Copy again</button>
                        <button className="btn primary sm" data-action="sent" disabled={busy} onClick={() => onSent(m.key)}>{a.label}</button>
                      </>
                    )}
                    {a.kind === 'none' && <span className="done">{a.label}</span>}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : <div className="hint">No emails for this idea yet.</div>}
      <div className="draft-row">
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Email to draft" disabled={busy}>
          {IDEA_TEMPLATES.map((t) => <option key={t} value={t}>{t} · {TEMPLATE_TITLES[t]}</option>)}
        </select>
        <button className="btn" data-action="draft" disabled={busy} onClick={() => onDraft(pick)}>Draft</button>
        {replyDue && <button className="btn" data-action="reply" disabled={busy} onClick={onReply}>Reply received</button>}
        {idea.offerE2R && <button className="btn amber" data-action="draft-e2r" disabled={busy} onClick={() => onDraft('E2R')}>Draft reminder (E2R)</button>}
      </div>
    </section>
  );
}
