import { NODE_COLOURS } from '../universe/graphView';
import { confidenceText, type LinkRow } from './ideaHelpers';

const TYPE_KEY: Record<string, string> = { 'Pain point': 'PainPoint', 'System or data': 'System' };

/** Links with relation, the other star, source and confidence. Unconfirmed links get Confirm; every AI link gets Remove. */
export function LinkTable({ rows, busy, onConfirm, onRemove, compact = false }: {
  rows: LinkRow[]; busy: boolean; onConfirm: (edgeId: string) => void; onRemove: (edgeId: string) => void; compact?: boolean;
}) {
  if (!rows.length) return <div className="hint">No links yet.</div>;
  return (
    <ul className={`links${compact ? ' compact' : ''}`}>
      {rows.map((r) => {
        const colour = (NODE_COLOURS as Record<string, string>)[TYPE_KEY[r.other.type] ?? r.other.type] ?? '#9fb0ae';
        return (
          <li key={r.edge.id} className={r.confirmed ? '' : 'unconfirmed'} data-edge={r.edge.id}>
            <div className="lk-main">
              <span className="rel">{r.out ? `${r.rel} →` : `← ${r.rel}`}</span>
              <span className="dot" style={{ background: colour }} aria-hidden="true" />
              <span className="other" title={`${r.other.label} (${r.other.type})`}>{r.other.label}</span>
              {r.other.unapproved && <span className="tag amber" data-testid="not-approved">Not on the approved list</span>}
              <span className={`conf${r.confirmed ? '' : ' low'}`}>{confidenceText(r.confidence)}</span>
            </div>
            <div className="lk-sub">
              <span className="src" title={r.edge.description || r.source}>{r.source}</span>
              {(!r.confirmed || r.source.startsWith('ai:')) && (
                <span className="lk-acts">
                  {!r.confirmed && <span className="tag">Waiting on you</span>}
                  {!r.confirmed && <button className="btn sm primary" disabled={busy} data-action="confirm-link" onClick={() => onConfirm(r.edge.id)}>Add it anyway</button>}
                  <button className="btn sm" disabled={busy} data-action="remove-link" onClick={() => onRemove(r.edge.id)}>Remove</button>
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
