import { useState } from 'react';
import { useStore } from '../state/store';
import { post } from '../api';
import { NODE_COLOURS } from '../universe/graphView';
import { NODE_LABELS } from '../../../src/graph/ontology';
import { nodeLinks } from './ideaHelpers';
import { LinkTable } from './LinkTable';

/** Small floating card for any star that is not an idea: its links and where each came from. */
export function NodeCard({ nodeId }: { nodeId: string }) {
  const { graph, select, refresh } = useStore();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const node = graph?.nodes.find((n: any) => n.id === nodeId);
  if (!node) return null;
  const rows = nodeLinks(graph, nodeId);
  const unconfirmed = rows.filter((r) => !r.confirmed).length;
  const act = async (what: 'confirm' | 'remove', edgeId: string) => {
    setBusy(true);
    try {
      await post(`/api/graph/${what}`, { edgeId });
      setMsg({ text: what === 'confirm' ? 'Link confirmed.' : 'Link removed.', kind: 'ok' });
    } catch (e) { setMsg({ text: (e as Error).message, kind: 'error' }); }
    await refresh();
    setBusy(false);
  };
  const colour = (NODE_COLOURS as Record<string, string>)[node.type] ?? '#9fb0ae';
  return (
    <section className="panel nodecard abs" role="region" aria-label={`${node.label}: links`} data-testid="nodecard">
      <div className="nc-head">
        <div>
          <div className="nc-type"><span className="dot" style={{ background: colour }} />{NODE_LABELS[node.type as keyof typeof NODE_LABELS] ?? node.type}</div>
          <h2>{node.label}</h2>
          <div className="nc-sub">{rows.length} link{rows.length === 1 ? '' : 's'}{unconfirmed ? ` · ${unconfirmed} unconfirmed` : ''}</div>
        </div>
        <button className="x" aria-label="Close" onClick={() => select(null)}>✕</button>
      </div>
      {msg && <div className={`pop-notice ${msg.kind}`} role="status">{msg.text}</div>}
      <div className="nc-body">
        <LinkTable rows={rows} busy={busy} compact onConfirm={(id) => act('confirm', id)} onRemove={(id) => act('remove', id)} />
      </div>
    </section>
  );
}
