import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { shortDate } from '../panels/filterIdeas';
import { post } from '../api';
import { useStore } from '../state/store';
import { historyLine, type HistoryEntry } from './ideaHelpers';

/** Pieces of an idea's panels: the stage button, the round chip, Details, History, and what each decision means. */

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
    <div className="stg-wrap" ref={box}>
      <button ref={btn} className="stg stg-btn" style={{ ['--c' as string]: colour }} data-action="stage" aria-haspopup="menu" aria-expanded={open}
        title="Change the stage" disabled={busy} onClick={toggle}>{label} <span className="caret">▾</span></button>
      {open && at && createPortal(
        <ul ref={menu} className="stage-pop" role="menu" aria-label="Stage" data-testid="stage-menu" style={{ position: 'fixed', top: at.top, right: at.right }}>
          <li className="stage-h">Stages</li>
          {Object.keys(state.stageNames).map((n, i) => item(`stage:${n}`, `${i + 1} · ${state.stageNames[n]}`))}
          <li className="stage-h">Close as</li>
          {Object.keys(state.closures).map((c) => item(`close:${c}`, state.closures[c]))}
        </ul>, document.body)}
    </div>
  );
}

/**
 * The round chip in the idea head, next to the stage button: the idea's round (or "No round") as a small menu of every
 * round plus "No round". Picking one writes the idea's round at once, then everything is read again.
 */
export function RoundChip({ ideaId, round, onDone }: { ideaId: string; round: string; onDone?: () => void }) {
  const { state, refresh, setNotice } = useStore();
  const rounds: { id: string; name: string }[] = state?.rounds ?? [];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Pinned to the viewport under the chip, like the stage menu (the panel clips its overflow).
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
  const pick = async (v: string) => {
    setOpen(false);
    if (v === round) return;
    setBusy(true);
    try {
      await post(`/api/ideas/${encodeURIComponent(ideaId)}/round`, { round: v });
      setNotice({ text: v ? `Put in ${rounds.find((r) => r.id === v)?.name ?? v}.` : 'Taken out of its round.', kind: 'ok' });
    } catch (e) { setNotice({ text: (e as Error).message, kind: 'error' }); }
    finally {
      // The store's refresh reports its own errors; whatever happens, the chip is usable again.
      try { await refresh(); onDone?.(); } catch { /* reported by the store */ } finally { setBusy(false); }
    }
  };
  const label = round ? rounds.find((r) => r.id === round)?.name ?? round : 'No round';
  const item = (v: string, text: string) => (
    <li key={v || 'none'} role="menuitemradio" aria-checked={v === round}>
      <button className={`stage-opt${v === round ? ' on' : ''}`} data-action="round-pick" data-value={v} disabled={busy} onClick={() => void pick(v)}>
        <span className="tick">{v === round ? '✓' : ''}</span>{text}
      </button>
    </li>
  );
  return (
    <div className="rnd-wrap" ref={box}>
      <button ref={btn} className={`rnd-chip${round ? '' : ' none'}`} data-action="round-chip" aria-haspopup="menu" aria-expanded={open}
        title="Change the round" disabled={busy} onClick={toggle}>{label} <span className="caret">▾</span></button>
      {open && at && createPortal(
        <ul ref={menu} className="stage-pop" role="menu" aria-label="Round" data-testid="round-menu" style={{ position: 'fixed', top: at.top, right: at.right }}>
          <li className="stage-h">Rounds</li>
          {rounds.map((r) => item(r.id, r.name))}
          {item('', 'No round')}
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
      <Field label="Business impact">{idea.business_impact || <span className="none">Not given</span>}</Field>
      <Field label="Beneficiaries">{tags(idea.beneficiaries)}</Field>
      <div className="field-row">
        <Field label="Use case category">{tags(idea.use_case_category)}</Field>
        <Field label="Solution maturity">{idea.maturity || <span className="none">Not given</span>}</Field>
      </div>
      <Field label="Support requested">{tags(idea.support, 'teal')}</Field>
      {idea.additional_context && <Field label="Additional context">{idea.additional_context}</Field>}
      <div className="field-row">
        <Field label="Team">
          {team.length
            ? <div className="tags">{team.map((p) => <span key={p.name + p.role} className="tg person">{p.name}<em>{ROLE[p.role] ?? p.role}</em></span>)}</div>
            : idea.people?.submitter ? <span>{idea.people.submitter}<em className="role"> Submitter</em></span> : <span className="none">Not given</span>}
        </Field>
        <Field label="Tried it already">{idea.experimented || <span className="none">Not given</span>}</Field>
      </div>
      <div className="field-row">
        <Field label="Builder">{idea.people?.builder || <span className="none">Not named yet</span>}</Field>
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
