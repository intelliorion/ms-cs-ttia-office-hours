import { useRef, useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { copyText, post } from '../api';
import { Modal } from './Modal';
import { APPROVED_NOTICE, TEMPLATE_TITLES, approveAndCopy, clipText, emailAction, emailStatus } from './ideaHelpers';
import { groupOutbox } from './titleHelpers';

const GROUPS = [['draft', 'Drafts'], ['approved', 'Approved, waiting to be sent'], ['sent', 'Sent']] as const;

export function OutboxPopout() {
  const { state, closePopout, openPopout, refresh, notice, setNotice } = useStore();
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const [pick, setPick] = useState('E0');
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setNotice(null); }, [setNotice]);
  useEffect(() => { if (fallback) { fallbackRef.current?.focus(); fallbackRef.current?.select(); } }, [fallback]);

  const items: any[] = state?.outbox ?? [];
  const problems: any[] = state?.outboxProblems ?? [];
  const g = groupOutbox(items);
  const ideaTitle = (id?: string) => (id ? state?.ideas.find((i: any) => i.id === id)?.title ?? id : 'Round email');

  const act = async <T,>(fn: () => Promise<T>, ok: (r: T) => string) => {
    if (busy) return;
    setBusy(true);
    try { const r = await fn(); setNotice({ text: ok(r), kind: 'ok' }); } catch (e) { setNotice({ text: (e as Error).message, kind: 'error' }); }
    await refresh();
    setBusy(false);
  };
  const approve = (key: string) => act(async () => {
    setFallback(null);
    const r = await approveAndCopy(key);
    setFallback(r.fallback);
    return r.item;
  }, (r: any) => APPROVED_NOTICE(r.template));

  const unsent = g.draft.length + g.approved.length;
  return (
    <Modal title={<><div className="pop-id">Outbox</div><h2>{unsent ? `${unsent} email${unsent > 1 ? 's' : ''} waiting` : 'Nothing waiting'}</h2></>}
      label="Outbox" onClose={closePopout} width={980} height={820}
      actions={(
        <div className="draft-row">
          <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Round email to draft" disabled={busy}>
            {['E0', 'E0B'].map((t) => <option key={t} value={t}>{t} · {TEMPLATE_TITLES[t]}</option>)}
          </select>
          <button className="btn" data-action="draft-round" disabled={busy}
            onClick={() => void act(() => post('/api/round/draft', { template: pick }), (r: any) => `${r.template ?? pick} is drafted.`)}>Draft</button>
        </div>
      )}>
      {(notice || fallback || problems.length > 0) && (
        <div className="pop-strip">
          {notice && <div className={`pop-notice ${notice.kind ?? 'ok'}`} role="status">{notice.text}</div>}
          {fallback && (
            <div className="copy-fallback">
              <div>The browser would not copy. The email is selected below: press Ctrl+C (⌘C on a Mac).</div>
              <textarea ref={fallbackRef} readOnly value={fallback} rows={4} aria-label="Email text to copy" />
            </div>
          )}
          {problems.length > 0 && (
            <div className="problems" data-testid="outbox-problems">
              <div className="sg-k">Could not read</div>
              {problems.map((p, i) => <div key={i} className="late">{typeof p === 'string' ? p : `${p.file ?? p.key ?? ''}${p.file || p.key ? ': ' : ''}${p.message ?? p.error ?? JSON.stringify(p)}`}</div>)}
            </div>
          )}
        </div>
      )}
      <div className="pop-single scroll">
        {!items.length && <div className="hint">No emails yet. Draft one from an idea, or draft the call for ideas above.</div>}
        {GROUPS.map(([k, label]) => g[k].length > 0 && (
          <section className="sec" key={k} data-group={k}>
            <h3>{label} <span className="sec-n">{g[k].length}</span></h3>
            <ul className="mails">
              {g[k].map((m: any) => {
                const a = emailAction(m);
                const left = m.contentPlaceholders?.length ?? 0;
                return (
                  <li key={m.key} data-key={m.key}>
                    <div className="mr1">
                      <span className="tpl">{m.template}</span>
                      <span className="subj" title={m.view?.subject}>{TEMPLATE_TITLES[m.template] ?? m.view?.subject}<em className="for"> · {m.idea ? `${m.idea} ${ideaTitle(m.idea)}` : 'Round email'}</em></span>
                      <span className={`st st-${m.status}`}>{emailStatus(m.status)}</span>
                    </div>
                    <div className="mr2">
                      <span className="hint">{m.status !== 'sent' && left > 0 ? `${left} placeholder${left > 1 ? 's' : ''} to fill in Outlook` : ''}</span>
                      <span className="acts">
                        {a.kind === 'set-first' && <button className="link-btn" data-action="set-first" title="Opens Rounds" onClick={() => openPopout({ kind: 'round' })}>{a.label}</button>}
                        {a.kind === 'approve' && <button className="btn primary sm" data-action="approve" disabled={busy} onClick={() => void approve(m.key)}>{a.label}</button>}
                        {a.kind === 'sent' && (
                          <>
                            <button className="btn sm" data-action="copy" disabled={busy}
                              onClick={async () => { const t = clipText(m.view); if (await copyText(t)) setNotice({ text: `${m.template} copied again.`, kind: 'ok' }); else setFallback(t); }}>Copy again</button>
                            <button className="btn primary sm" data-action="sent" disabled={busy}
                              onClick={() => void act(() => post('/api/outbox/sent', { key: m.key }), (r: any) => `${r.template} marked sent.`)}>{a.label}</button>
                          </>
                        )}
                        {a.kind === 'none' && <span className="done">{a.label}</span>}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
