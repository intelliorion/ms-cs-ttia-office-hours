import { NODE_COLOURS } from '../universe/graphView';
import { confidenceText, type LinkRow } from './ideaHelpers';

const TYPE_KEY: Record<string, string> = { 'Pain point': 'PainPoint', 'System or data': 'System', 'Support requested': 'Support', 'Desired outcome': 'Outcome', 'Use case category': 'Category' };

/**
 * Links with relation, the other star, source and confidence. A click on a row goes to the other star (selected, so it is
 * flown to and lit). Unconfirmed links get "Add it anyway"; no link is removed from here. A derived link says which rule
 * derived it and has no action: it waits on its inputs, never on you.
 */
export function LinkTable({ rows, busy, onConfirm, onOpen, compact = false }: {
  rows: LinkRow[]; busy: boolean; onConfirm: (edgeId: string) => void; onOpen: (nodeId: string) => void; compact?: boolean;
}) {
  if (!rows.length) return <div className="hint">No links yet.</div>;
  return (
    <ul className={`links${compact ? ' compact' : ''}`}>
      {rows.map((r) => {
        const colour = (NODE_COLOURS as Record<string, string>)[TYPE_KEY[r.other.type] ?? r.other.type] ?? '#9fb0ae';
        return (
          <li key={r.edge.id} className={`${r.confirmed ? '' : 'unconfirmed'}${r.derived ? ' derived' : ''}`} data-edge={r.edge.id}>
            <button type="button" className="lk-main lk-go" data-action="go-link" title={`Go to ${r.other.label}`} onClick={() => onOpen(r.other.id)}>
              <span className="rel">{r.out ? `${r.rel} →` : `← ${r.rel}`}</span>
              <span className="dot" style={{ background: colour }} aria-hidden="true" />
              <span className="other" title={`${r.other.label} (${r.other.type})`}>{r.other.label}</span>
              {r.other.unapproved && <span className="tag amber" data-testid="not-approved">Not on the approved list</span>}
              <span className={`conf${r.confirmed ? '' : ' low'}`}>{confidenceText(r.confidence)}</span>
            </button>
            <div className="lk-sub">
              {r.derived
                ? <span className="lk-derived" title={r.edge.description}>derived by {r.derived.rule}</span>
                : <span className="src" title={r.edge.description || r.source}>{r.source}</span>}
              {r.derived && !r.confirmed && <span className="lk-acts"><span className="tag">Waits on its inputs</span></span>}
              {!r.confirmed && !r.derived && (
                <span className="lk-acts">
                  <span className="tag">Waiting on you</span>
                  <button className="btn sm primary" disabled={busy} data-action="confirm-link" onClick={() => onConfirm(r.edge.id)}>Add it anyway</button>
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
