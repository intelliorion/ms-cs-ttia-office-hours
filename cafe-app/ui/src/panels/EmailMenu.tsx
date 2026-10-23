import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TEMPLATE_TITLES } from '../popouts/ideaHelpers';
import { shortDate } from './filterIdeas';
import { stageEmails } from './outlook';

/** The idea head's ✉ Email menu: this stage's emails, each opened in Outlook. The Outbox keeps every one. */
export function EmailMenu({ idea, steps, busy, onOpen, onOutbox }: {
  idea: any; steps: any[]; busy: boolean; onOpen: (template: string) => void; onOutbox: () => void;
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
  const list = stageEmails(idea, steps);
  return (
    <div className="email-menu" ref={box}>
      <button ref={btn} className="stg stg-btn em-btn" data-action="email-menu" aria-haspopup="menu" aria-expanded={open} disabled={busy}
        title="Emails for this stage, opened in Outlook" onClick={toggle}>✉ Emails <span className="caret">▾</span></button>
      {open && at && createPortal(
        <ul ref={menu} className="stage-pop em-pop" role="menu" aria-label="Emails" style={{ position: 'fixed', top: at.top, right: at.right }}>
          <li className="stage-h">This stage</li>
          {list.length === 0 && <li className="em-none">No emails for this stage.</li>}
          {list.map((t) => (
            <li key={t}>
              <button role="menuitem" data-template={t} onClick={() => { setOpen(false); onOpen(t); }}>
                <span className="tpl">{t}</span> {TEMPLATE_TITLES[t] ?? t}
                {idea.sent?.[t] && <span className="em-sent">sent {shortDate(idea.sent[t])}</span>}
              </button>
            </li>
          ))}
          <li className="em-foot"><button role="menuitem" data-action="open-outbox" onClick={() => { setOpen(false); onOutbox(); }}>All emails in the Outbox →</button></li>
        </ul>, document.body)}
    </div>
  );
}
