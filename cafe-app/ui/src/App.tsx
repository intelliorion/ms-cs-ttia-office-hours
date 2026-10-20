import { useCallback, useEffect } from 'react';
import { Stage } from './layout/Stage';
import { Panel } from './layout/Panel';
import { TitleBar } from './layout/TitleBar';
import { useStore } from './state/store';
import { IdeasList } from './panels/IdeasList';
import { StageChart, SupportChart, FunctionChart, Waiting } from './panels/Charts';
import { Universe } from './universe/Universe';
import { IdeaPopout } from './popouts/IdeaPopout';
import { ImportPopout } from './popouts/ImportPopout';
import { RoundPopout } from './popouts/RoundPopout';
import { OutboxPopout } from './popouts/OutboxPopout';
import { AiPopout } from './popouts/AiPopout';
import { NodeCard } from './popouts/NodeCard';
import { cafeIdOf } from './popouts/ideaHelpers';

declare global { interface Window { __cafe?: Record<string, (...a: any[]) => void> } }

export default function App() {
  const { state, graph, popout, openPopout, closePopout, notice, refresh, selectedId, hoverId, labels, viewNonce, select, hover, toggleLabels, resetView } = useStore();
  // An idea star opens its pop-out; any other star shows its card.
  const onSelect = useCallback((id: string | null) => {
    select(id);
    const cafe = cafeIdOf(id);
    if (cafe) openPopout({ kind: 'idea', id: cafe });
  }, [select, openPopout]);
  const cardFor = selectedId && !cafeIdOf(selectedId) && !popout && graph?.nodes.some((n: any) => n.id === selectedId) ? selectedId : null;
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    // Hooks for the screenshot tour; only on this machine.
    if (import.meta.env.DEV || location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      window.__cafe = { select, click: onSelect, hover, toggleLabels, resetView, openPopout, closePopout };
    }
  }, [select, onSelect, hover, toggleLabels, resetView, openPopout, closePopout]);
  return (
    <Stage>
      {graph && (
        <Universe graph={graph} layout={graph.layout ?? {}} selectedId={selectedId} hoverId={hoverId} labels={labels}
          viewNonce={viewNonce} onSelect={onSelect} onHover={hover} />
      )}
      <TitleBar />
      {notice && !popout && <div className="notice" role="status">{notice.text}</div>}
      {cardFor && <NodeCard nodeId={cardFor} />}
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
      {popout?.kind === 'idea' && <IdeaPopout id={popout.id} />}
      {popout?.kind === 'import' && <ImportPopout />}
      {popout?.kind === 'round' && <RoundPopout />}
      {popout?.kind === 'outbox' && <OutboxPopout />}
      {popout?.kind === 'ai' && <AiPopout />}
    </Stage>
  );
}
