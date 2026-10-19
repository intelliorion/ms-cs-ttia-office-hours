import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { ApiError, copyText, getHistory, ideaPost, post } from '../api';
import { shortDate } from '../panels/filterIdeas';
import { Modal } from './Modal';
import { LinkTable } from './LinkTable';
import {
  DECISION_EMAIL, IDEA_TEMPLATES, TEMPLATE_TITLES, clipText, emailAction, emailStatus, historyLine, ideaLinks, type HistoryEntry,
} from './ideaHelpers';

const ROLE: Record<string, string> = { lead: 'Lead', sponsor: 'Sponsor', member: 'Member' };

export function IdeaPopout({ id }: { id: string }) {
  const { state, graph, refresh, closePopout, openPopout, notice, setNotice, suggest, setSuggest } = useStore();
  const idea = state?.ideas.find((i: any) => i.id === id);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);

  const loadHistory = useCallback(() => getHistory(id).then(setHistory, () => setHistory(null)), [id]);
  useEffect(() => { setNotice(null); setFallback(null); void loadHistory(); }, [id, loadHistory, setNotice]);
  useEffect(() => { if (fallback) { fallbackRef.current?.focus(); fallbackRef.current?.select(); } }, [fallback]);

  /** Runs one change, says what happened in plain words, then refreshes state, graph and history. */
  const act = async <T,>(fn: () => Promise<T>, ok: (r: T) => string | undefined) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fn();
      const t = ok(r);
      setNotice(t ? { text: t, kind: 'ok' } : null);
      const s = (r as any)?.suggest;
      if (s) setSuggest({ id, ...s });
    } catch (e) {
      setNotice({ text: (e as Error).message, kind: 'error' });
    }
    await Promise.all([refresh(), loadHistory()]);
    setBusy(false);
  };

  if (!idea) {
    return (
      <Modal title={<h2>{id}</h2>} label={id} onClose={closePopout} width={720} height={260}>
        <div className="modal-body"><p>This idea is no longer in the workspace.</p></div>
      </Modal>
    );
  }

  const where = (t: { stage?: number; closeAs?: string }) =>
    t.closeAs ? `Closed: ${state.closures[t.closeAs]}` : `Moved to ${state.stageNames[t.stage!]}`;
  const setStage = (t: { stage?: number; closeAs?: string }) => {
    setSuggest(null);
    void act(() => ideaPost(id, 'stage', t.closeAs ? { closeAs: t.closeAs } : { stage: t.stage }), () => `${where(t)}.`);
  };
  const stageValue = idea.closed ? `close:${idea.closed.as}` : `stage:${idea.stage}`;
  const mine = suggest && suggest.id === id ? suggest : null;

  return (
    <Modal
      label={`${idea.id} ${idea.title}`}
      onClose={closePopout}
      className="idea-pop"
      title={(
        <>
          <div className="pop-id">{idea.id}</div>
          <h2>{idea.title || 'Untitled idea'}</h2>
          <div className="pop-sub">
            {[idea.function, idea.region, idea.participation].filter(Boolean).join(' · ') || 'Function and region not given'}
            {idea.flags?.length > 0 && <span className="flagn" title={idea.flags.join('\n')}>⚑ {idea.flags.length} flag{idea.flags.length > 1 ? 's' : ''}</span>}
          </div>
        </>
      )}
      actions={(
        <label className="stage-menu">
          <span>Stage</span>
          <select value={stageValue} disabled={busy} data-action="stage" aria-label="Stage"
            onChange={(e) => {
              const [k, v] = e.target.value.split(':');
              setStage(k === 'close' ? { closeAs: v } : { stage: Number(v) });
            }}>
            <optgroup label="Stages">
              {Object.keys(state.stageNames).map((n) => <option key={n} value={`stage:${n}`}>{n} · {state.stageNames[n]}</option>)}
            </optgroup>
            <optgroup label="Close as">
              {Object.keys(state.closures).map((c) => <option key={c} value={`close:${c}`}>Closed: {state.closures[c]}</option>)}
            </optgroup>
          </select>
        </label>
      )}
    >
      {(mine || notice || fallback || idea.overdue?.length > 0) && (
        <div className="pop-strip">
          {mine && (
            <div className="suggest-bar" role="group" aria-label="Suggested move" data-testid="suggest">
              <span className="sg-k">Suggested</span>
              <span className="sg-t">{mine.label}</span>
              <button className="btn primary" data-action="suggest-yes" disabled={busy}
                onClick={() => setStage(mine.closeAs ? { closeAs: mine.closeAs } : { stage: mine.stage })}>Yes</button>
              <button className="btn" data-action="suggest-no" onClick={() => setSuggest(null)}>No</button>
            </div>
          )}
          {notice && <div className={`pop-notice ${notice.kind ?? 'ok'}`} role="status">{notice.text}</div>}
          {fallback && (
            <div className="copy-fallback">
              <div>The browser would not copy. The email is selected below: press Ctrl+C (⌘C on a Mac).</div>
              <textarea ref={fallbackRef} readOnly value={fallback} rows={4} aria-label="Email text to copy" />
            </div>
          )}
          {!idea.closed && idea.overdue?.map((o: any) => <div key={o.step} className="late">{o.text}</div>)}
        </div>
      )}
      <div className="pop-grid">
        <div className="pop-col">
          <Details idea={idea} />
          <Review idea={idea} state={state} busy={busy}
            onSave={(body) => act(() => ideaPost(id, 'review', body), (r: any) =>
              [`Saved. ${r.email.template} is drafted in the Outbox.`, r.handoff ? 'CSIC handoff written.' : '', ...(r.warnings ?? [])].filter(Boolean).join(' '))} />
        </div>
        <div className="pop-col">
          <Emails idea={idea} outbox={state.outbox ?? []} busy={busy}
            onDraft={(template) => act(() => ideaPost(id, 'draft', { template }), (r: any) => `${r.template} is drafted in the Outbox.`)}
            onReply={() => act(() => ideaPost(id, 'reply'), () => 'Reply received. The answers step is done.')}
            onSetFirst={() => openPopout({ kind: 'round' })}
            onApprove={(key) => act(async () => {
              setFallback(null);
              try {
                const r = await post('/api/outbox/approve', { key });
                const text = clipText(r);
                if (!(await copyText(text))) setFallback(text);
                return r;
              } catch (e) {
                if (e instanceof ApiError && e.missing?.length) throw new ApiError(`Set first: ${e.missing.join(', ')}. Open Round to fill them in.`);
                throw e;
              }
            }, (r: any) => `${r.template} approved and copied. Paste it into Outlook, send it, then mark it as sent.`)}
            onCopy={async (m) => { const text = clipText(m.view); if (await copyText(text)) setNotice({ text: `${m.template} copied again.`, kind: 'ok' }); else setFallback(text); }}
            onSent={(key) => act(() => post('/api/outbox/sent', { key }), (r: any) => `${r.template} marked sent.`)} />
          <section className="sec">
            <h3>Graph <span className="sec-n">{ideaLinks(graph, id).length} links</span></h3>
            <LinkTable rows={ideaLinks(graph, id)} busy={busy}
              onConfirm={(edgeId) => act(() => post('/api/graph/confirm', { edgeId }), () => 'Link confirmed.')}
              onRemove={(edgeId) => act(() => post('/api/graph/remove', { edgeId }), () => 'Link removed.')} />
          </section>
          <section className="sec">
            <h3>History <span className="sec-n">last 10</span></h3>
            {history === null ? <div className="hint">Couldn’t read the history.</div>
              : !history.length ? <div className="hint">Nothing logged yet.</div>
                : (
                  <ol className="history">
                    {history.slice(-10).reverse().map((h, i) => (
                      <li key={`${h.at}-${i}`}>
                        <span className="when">{shortDate(h.at)}</span>
                        <span className="what">{historyLine(h, state.steps)}</span>
                        <span className="who">{h.by === 'app' ? 'app' : 'you'}</span>
                      </li>
                    ))}
                  </ol>
                )}
          </section>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="field"><div className="f-l">{label}</div><div className="f-v">{children}</div></div>;
}

const tags = (xs: string[] | undefined, cls = '') =>
  xs?.length ? <div className="tags">{xs.map((t) => <span key={t} className={`tg ${cls}`}>{t}</span>)}</div> : <span className="none">Not given</span>;

function Details({ idea }: { idea: any }) {
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

function Review({ idea, state, busy, onSave }: { idea: any; state: any; busy: boolean; onSave: (b: unknown) => void }) {
  const [criteria, setCriteria] = useState<Record<string, boolean>>({});
  const [decision, setDecision] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => {
    setCriteria({ ...(idea.review?.criteria ?? {}) });
    setDecision(idea.review?.decision ?? '');
    setReason(idea.review?.reason ?? '');
  }, [idea.id, idea.review]);
  const closed = Boolean(idea.closed);
  return (
    <section className="sec">
      <h3>Review {idea.review && <span className="sec-n">saved {shortDate(idea.review.at)}</span>}</h3>
      <ul className="criteria">
        {(state.criteria ?? []).map((c: any) => (
          <li key={c.id}>
            <label>
              <input type="checkbox" checked={criteria[c.id] === true} disabled={closed || busy}
                onChange={(e) => setCriteria((x) => ({ ...x, [c.id]: e.target.checked }))} />
              <span>{c.text}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="rv-row">
        <select value={decision} disabled={closed || busy} onChange={(e) => setDecision(e.target.value)} aria-label="Decision" data-action="decision">
          <option value="">Pick a decision…</option>
          {Object.entries(state.decisions ?? {}).map(([k, v]) => <option key={k} value={k}>{String(v)}</option>)}
        </select>
      </div>
      <textarea className="reason" rows={2} placeholder="Reason, in a sentence the team will read" value={reason} disabled={closed || busy}
        onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
      <div className="rv-foot">
        <span className="hint">{closed ? 'Closed. Set a stage to reopen it before reviewing.' : 'Saving drafts the decision email. Nothing moves until you say yes.'}</span>
        <button className="btn primary" data-action="save-review" disabled={closed || busy || !decision || !reason.trim()}
          onClick={() => onSave({ criteria, decision, reason })}>
          {decision ? `Save and draft ${DECISION_EMAIL[decision] ?? ''}`.trim() : 'Save decision'}
        </button>
      </div>
    </section>
  );
}

function Emails({ idea, outbox, busy, onDraft, onReply, onSetFirst, onApprove, onCopy, onSent }: {
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
