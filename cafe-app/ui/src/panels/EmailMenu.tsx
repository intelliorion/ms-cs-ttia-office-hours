import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TEMPLATE_TITLES } from '../popouts/ideaHelpers';
import { shortDate } from './filterIdeas';
import { stageEmails, unsentFor } from './outlook';

/** The idea's ✉ Emails menu: anything drafted and not sent yet, then this stage's emails; each opens in Outlook. */
export function EmailMenu({ idea, steps, outbox = [], busy, onOpen }: {
  idea: any; steps: any[]; outbox?: any[]; busy: boolean; onOpen: (template: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  // Like the stage menu: drawn over everything, so the panel's edge never cuts it.
  const toggle = () => {
    if (!open) { const r = btn.current?.getBoundingClientRect(); if (r) setAt({ top: r.bottom + 6, right: window.innerWidth - r.right }); }
    setOpen((o) => !o);
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { const t = e.target as Node; if (!box.current?.contains(t) && !menu.current?.contains(t)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); setOpen(false); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc, true); };
  }, [open]);
  const waiting = unsentFor(idea, outbox);
  const list = stageEmails(idea, steps).filter((t) => !waiting.some((w) => w.template === t));
  const item = (t: string, note?: string) => (
    <li key={t}>
      <button role="menuitem" data-template={t} onClick={() => { setOpen(false); onOpen(t); }}>
        <span className="tpl">{t}</span> {TEMPLATE_TITLES[t] ?? t}
        {note ? <span className="em-note">{note}</span> : idea.sent?.[t] && <span className="em-sent">sent {shortDate(idea.sent[t])}</span>}
      </button>
    </li>
  );
  return (
    <div className="email-menu" ref={box}>
      <button ref={btn} className="stg stg-btn em-btn" data-action="email-menu" aria-haspopup="menu" aria-expanded={open} disabled={busy}
        title="This idea's emails, opened in Outlook" onClick={toggle}>✉ Emails{waiting.length > 0 && <span className="em-dot" aria-label={`${waiting.length} not sent`} />} <span className="caret">▾</span></button>
      {open && at && createPortal(
        <ul ref={menu} className="stage-pop em-pop" role="menu" aria-label="Emails" style={{ position: 'fixed', top: at.top, right: at.right }}>
          {waiting.length > 0 && <li className="stage-h">Not sent yet</li>}
          {waiting.map((w) => item(w.template, 'draft'))}
          {(list.length > 0 || !waiting.length) && <li className="stage-h">This stage</li>}
          {list.length === 0 && !waiting.length && <li className="em-none">No emails for this stage.</li>}
          {list.map((t) => item(t))}
        </ul>, document.body)}
    </div>
  );
}
