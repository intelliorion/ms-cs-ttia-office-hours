import { useCallback, useEffect } from 'react';
import { Stage } from './layout/Stage';
import { Panel } from './layout/Panel';
import { TitleBar } from './layout/TitleBar';
import { Drawers } from './layout/Drawers';
import { useStore } from './state/store';
import { IdeasList } from './panels/IdeasList';
import { StageChart, SupportChart, FunctionChart, Waiting } from './panels/Charts';
import { Universe } from './universe/Universe';
import { IdeaPopout } from './popouts/IdeaPopout';
import { ImportPopout } from './popouts/ImportPopout';
import { RoundPopout } from './popouts/RoundPopout';
import { OutboxPopout } from './popouts/OutboxPopout';
import { InboxPopout } from './popouts/InboxPopout';
import { AiPopout } from './popouts/AiPopout';
import { NodeCard } from './popouts/NodeCard';
import { focusLabel, focusKeyApplies } from './state/store';

declare global { interface Window { __cafe?: Record<string, (...a: any[]) => void> } }

export default function App() {
  const { state, graph, popout, openPopout, closePopout, notice, refresh, selectedId, hoverId, labels, focus, toggleFocus, viewNonce, select, hover, toggleLabels, resetView } = useStore();
  // Any star, an idea included, is only selected; its card offers "Open idea" for the pop-out.
  const onSelect = select;
  const cardFor = selectedId && !popout && graph?.nodes.some((n: any) => n.id === selectedId) ? selectedId : null;
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    // Hooks for the screenshot tour; only on this machine.
    if (import.meta.env.DEV || location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      window.__cafe = { select, click: onSelect, openIdea: (id: string) => { select(`idea:${id}`); openPopout({ kind: 'idea', id }); }, hover, toggleLabels, resetView, toggleFocus, openPopout, closePopout };
    }
  }, [select, onSelect, hover, toggleLabels, resetView, toggleFocus, openPopout, closePopout]);
  useEffect(() => {
    if (!cardFor || popout) return;
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') select(null); };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, [cardFor, popout, select]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (focusKeyApplies(e, !!popout)) { e.preventDefault(); toggleFocus(); } };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, [popout, toggleFocus]);
  return (
    <>
      <Stage focus={focus}>
        {graph && (
          <Universe graph={graph} layout={graph.layout ?? {}} selectedId={selectedId} hoverId={hoverId} labels={labels} focus={focus}
            viewNonce={viewNonce} onSelect={onSelect} onHover={hover} />
        )}
        <TitleBar />
        {notice && !popout && <div className="notice" role="status">{notice.text}</div>}
        {cardFor && <NodeCard nodeId={cardFor} />}
        {!focus && <>
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
        </>}
        <div className="abs" style={{ left: 480, top: 1010, width: 960, display: 'flex', justifyContent: 'center', gap: 16 }}>
          <button className="pill" data-action="reset-view" onClick={resetView}>Reset view</button>
          <button className={`pill${labels ? ' on' : ''}`} data-action="labels" aria-pressed={labels} onClick={toggleLabels}>Labels</button>
          <button className={`pill${focus ? ' on' : ''}`} data-action="focus" aria-pressed={focus} title="Hide the panels (F)" onClick={toggleFocus}>{focusLabel(focus)}</button>
        </div>
        {popout?.kind === 'idea' && <IdeaPopout id={popout.id} />}
        {popout?.kind === 'import' && <ImportPopout />}
        {popout?.kind === 'round' && <RoundPopout />}
        {popout?.kind === 'outbox' && <OutboxPopout />}
        {popout?.kind === 'inbox' && <InboxPopout />}
        {popout?.kind === 'ai' && <AiPopout />}
      </Stage>
      {!focus && <Drawers />}
    </>
  );
}
