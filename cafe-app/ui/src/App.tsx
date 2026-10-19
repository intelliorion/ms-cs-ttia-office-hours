import { useEffect } from 'react';
import { Stage } from './layout/Stage';
import { Panel } from './layout/Panel';
import { TitleBar } from './layout/TitleBar';
import { useStore, ideasByStage, waitingSummary, supportCounts } from './state/store';

export default function App() {
  const { state, popout, closePopout, notice, refresh } = useStore();
  useEffect(() => { void refresh(); }, [refresh]);
  const rows = state ? ideasByStage(state) : [];
  const w = state ? waitingSummary(state) : null;
  const sup = state ? supportCounts(state) : [];
  return (
    <Stage>
      <div id="universe-slot" />
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
        <button className="pill" data-action="reset-view">Reset view</button>
        <button className="pill" data-action="labels">Labels</button>
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
