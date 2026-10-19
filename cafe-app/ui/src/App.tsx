import { useEffect } from 'react';
import { Stage } from './layout/Stage';
import { Panel } from './layout/Panel';
import { TitleBar } from './layout/TitleBar';
import { useStore, ideasByStage, waitingSummary, supportCounts } from './state/store';
import { Universe } from './universe/Universe';

declare global { interface Window { __cafe?: Record<string, (...a: any[]) => void> } }

export default function App() {
  const { state, graph, popout, closePopout, notice, refresh, selectedId, hoverId, labels, viewNonce, select, hover, toggleLabels, resetView } = useStore();
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    // Hooks for the screenshot tour; only on this machine.
    if (import.meta.env.DEV || location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      window.__cafe = { select, hover, toggleLabels, resetView };
    }
  }, [select, hover, toggleLabels, resetView]);
  const rows = state ? ideasByStage(state) : [];
  const w = state ? waitingSummary(state) : null;
  const sup = state ? supportCounts(state) : [];
  return (
    <Stage>
      {graph && (
        <Universe graph={graph} layout={graph.layout ?? {}} selectedId={selectedId} hoverId={hoverId} labels={labels}
          viewNonce={viewNonce} onSelect={select} onHover={hover} />
      )}
      <TitleBar />
      {notice && <div className="notice" role="status">{notice.text}</div>}
      <Panel title="Ideas" style={{ left: 20, top: 92, width: 440, height: 968 }}>
        {rows.map(([n, c]) => <div key={n}>{n}: {c}</div>)}
      </Panel>
      <Panel title="Waiting" side="right" style={{ left: 1460, top: 92, width: 440, height: 460 }}>
        {w && <div>{w.drafts} drafts · {w.approved} approved · {w.late} late</div>}
      </Panel>
      <Panel title="Support" side="right" style={{ left: 1460, top: 572, width: 440, height: 488 }}>
        {sup.map(([n, c]) => <div key={n}>{n}: {c}</div>)}
      </Panel>
      <div className="abs" style={{ left: 480, top: 1010, width: 960, display: 'flex', justifyContent: 'center', gap: 16 }}>
        <button className="pill" data-action="reset-view" onClick={resetView}>Reset view</button>
        <button className={`pill${labels ? ' on' : ''}`} data-action="labels" aria-pressed={labels} onClick={toggleLabels}>Labels</button>
      </div>
      {popout && (
        <div className="modal-back" onClick={closePopout}>
          <div className="panel modal" onClick={(e) => e.stopPropagation()}>
            <h2>{popout.kind}</h2>
            <div className="panel-body">Coming next.<div><button className="pill" onClick={closePopout}>Close</button></div></div>
          </div>
        </div>
      )}
    </Stage>
  );
}
