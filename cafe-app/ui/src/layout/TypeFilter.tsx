import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { NODE_COLOURS } from '../universe/graphView';
import { NODE_LABELS, NODE_TYPES } from '../../../src/graph/ontology';

/** "Show: All", or how many kinds are on when some are switched off. */
export function showLabel(present: string[], hidden: string[]): string {
  const on = present.filter((t) => !hidden.includes(t)).length;
  return on === present.length ? 'Show: All' : `Show: ${on} of ${present.length}`;
}

/** Bottom-bar filter: switch kinds of star off when the picture is busy. The chat and panels still see them all. */
export function TypeFilter() {
  const graph = useStore((s) => s.graph);
  const hidden = useStore((s) => s.hiddenTypes);
  const toggleType = useStore((s) => s.toggleType);
  const showAllTypes = useStore((s) => s.showAllTypes);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const n of graph?.nodes ?? []) c.set(n.type, (c.get(n.type) ?? 0) + 1);
    return c;
  }, [graph]);
  const present = NODE_TYPES.filter((t) => counts.has(t));
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    // Capture, so Esc closes this list before the app's own Esc (deselect, back) sees it.
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc, true); };
  }, [open]);
  const filtered = present.some((t) => hidden.includes(t));
  return (
    <div className="type-filter" ref={box}>
      <button className={`pill${filtered ? ' on' : ''}`} data-action="type-filter" aria-expanded={open} aria-haspopup="true"
        title="Hide kinds of star from the picture" onClick={() => setOpen((o) => !o)}>{showLabel(present, hidden)}</button>
      {open && (
        <div className="tf-menu" role="group" aria-label="Kinds of star shown">
          {present.map((t) => (
            <label key={t} className="tf-row">
              <input type="checkbox" checked={!hidden.includes(t)} onChange={() => toggleType(t)} />
              <span className="dot" style={{ background: (NODE_COLOURS as Record<string, string>)[t] }} />
              <span className="tf-name">{NODE_LABELS[t]}</span>
              <span className="tf-n">{counts.get(t)}</span>
            </label>
          ))}
          <div className="tf-foot">
            <span>Picture only: the chat and panels still use every star.</span>
            <button className="link" disabled={!filtered} onClick={showAllTypes}>Show all</button>
          </div>
        </div>
      )}
    </div>
  );
}
