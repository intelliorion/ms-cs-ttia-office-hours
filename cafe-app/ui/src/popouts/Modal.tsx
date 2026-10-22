import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Centred glass pop-out over the dimmed universe. Esc, ✕ or a click on the backdrop closes it; focus stays inside.
 * `locked` (the reason) keeps it open: ✕ is disabled with the reason as its tooltip, and Esc and the backdrop do nothing.
 */
export function Modal({ title, label, actions, onClose, children, width = 1100, height = 820, className = '', onDragOver, onDrop, locked }: {
  title: ReactNode; label: string; actions?: ReactNode; onClose: () => void; children: ReactNode; width?: number; height?: number; className?: string;
  onDragOver?: (e: React.DragEvent) => void; onDrop?: (e: React.DragEvent) => void; locked?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = locked ? () => {} : onClose;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = box.current!;
    (el.querySelector<HTMLElement>('[data-autofocus]') ?? el).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close.current(); return; }
      if (e.key !== 'Tab') return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (!items.length) { e.preventDefault(); el.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      const inside = el.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside || document.activeElement === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); before?.focus?.(); };
  }, []);

  return (
    <div className="modal-back" data-testid="modal-back" onDragOver={onDragOver} onDrop={onDrop} onMouseDown={(e) => { if (e.target === e.currentTarget) close.current(); }}>
      <div ref={box} className={`panel modal ${className}`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
        style={{ width, height }}>
        <div className="modal-head">
          <div className="modal-title" title={typeof title === 'string' ? title : undefined}>{title}</div>
          {actions && <div className="modal-actions">{actions}</div>}
          <button className="x" aria-label="Close" data-action="close" onClick={onClose} disabled={!!locked} title={locked}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
