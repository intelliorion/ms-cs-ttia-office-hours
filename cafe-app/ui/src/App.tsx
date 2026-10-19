import { useEffect } from 'react';
import { Stage } from './layout/Stage';
import { Panel } from './layout/Panel';
import { TitleBar } from './layout/TitleBar';
import { useStore } from './state/store';
import { IdeasList } from './panels/IdeasList';
import { StageChart, SupportChart, FunctionChart, Waiting } from './panels/Charts';
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
  return (
    <Stage>
      {graph && (
        <Universe graph={graph} layout={graph.layout ?? {}} selectedId={selectedId} hoverId={hoverId} labels={labels}
          viewNonce={viewNonce} onSelect={select} onHover={hover} />
      )}
      <TitleBar />
      {notice && <div className="notice" role="status">{notice.text}</div>}
      <Panel title="Ideas" style={{ left: 20, top: 92, width: 440, height: 968 }}>
        <IdeasList />
      </Panel>
      <Panel title="Pipeline" side="right" style={{ left: 1460, top: 92, width: 440, height: 460 }}>
        <div className="sub-h">Ideas by stage</div>
        <StageChart />
        <div className="sub-h">Waiting on you</div>
        <Waiting />
      </Panel>
      <Panel title="Demand" side="right" style={{ left: 1460, top: 572, width: 440, height: 488 }}>
        <div className="sub-h">Support requested</div>
        <SupportChart />
        <div className="sub-h">Function · region</div>
        <FunctionChart />
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
