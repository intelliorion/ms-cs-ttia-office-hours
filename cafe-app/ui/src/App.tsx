import { useCallback, useEffect, useMemo } from 'react';
import { Stage } from './layout/Stage';
import { Panel } from './layout/Panel';
import { TitleBar } from './layout/TitleBar';
import { Drawers } from './layout/Drawers';
import { relatedGraph } from './universe/graphView';
import { useStore } from './state/store';
import { IdeasPane } from './panels/IdeasPane';
import { StageChart, SupportChart, FunctionChart, Waiting } from './panels/Charts';
import { Universe } from './universe/Universe';
import { ImportPopout } from './popouts/ImportPopout';
import { RoundPopout } from './popouts/RoundPopout';
import { OutboxPopout } from './popouts/OutboxPopout';
import { InboxPopout } from './popouts/InboxPopout';
import { AiPopout } from './popouts/AiPopout';
import { NodeCard } from './popouts/NodeCard';
import { focusLabel, focusKeyApplies, escAction, isNarrow, qualityLabel } from './state/store';

declare global { interface Window { __cafe?: Record<string, (...a: any[]) => void> } }

export default function App() {
  const { state, graph, popout, openPopout, closePopout, notice, refresh, selectedId, hoverId, labels, focus, toggleFocus, viewNonce, select, hover, toggleLabels, resetView,
    leftView, openIdea, backToList, onlyRelated, toggleOnlyRelated, drawer, setDrawer, quality, qualitySetByHand, setQuality, cycleQuality, autoPickQuality, slowQuality, setNotice } = useStore();
  // Any star, an idea included, is only selected; its card offers "Open idea", which shows the idea in the left panel.
  const onSelect = select;
  // No card for the idea whose details are already showing in the panel.
  const showingDetails = leftView.kind === 'idea' && selectedId === `idea:${leftView.id}`;
  const cardFor = selectedId && !popout && !showingDetails && graph?.nodes.some((n: any) => n.id === selectedId) ? selectedId : null;
  // "Only related" in the idea panel: the universe gets the one-hop neighbourhood instead of the whole graph.
  const shown = useMemo(() => (graph && onlyRelated && leftView.kind === 'idea' ? relatedGraph(graph, `idea:${leftView.id}`) : graph), [graph, onlyRelated, leftView]);
  useEffect(() => { void refresh(); }, [refresh]);
  // Lite drops the panels' backdrop blur too (theme.css), so the quality is on the root element.
  useEffect(() => { document.documentElement.dataset.quality = quality; }, [quality]);
  useEffect(() => {
    // Hooks for the screenshot tour; only on this machine.
    if (import.meta.env.DEV || location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      window.__cafe = { select, click: onSelect, openIdea, backToList, hover, toggleLabels, resetView, toggleFocus, openPopout, closePopout, setQuality, setNotice, refresh };
    }
  }, [select, onSelect, openIdea, backToList, hover, toggleLabels, resetView, toggleFocus, openPopout, closePopout, setQuality, setNotice, refresh]);
  useEffect(() => {
    // One Esc handler: idea details go Back, then a drawer closes, then the star card closes. A modal handles its own Esc.
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const detailsVisible = !focus && (!isNarrow() || drawer === 'ideas');
      const a = escAction({ modal: !!popout, leftView, detailsVisible, drawer, card: !!cardFor, target: e.target });
      if (a === 'none') return;
      e.preventDefault();
      if (a === 'blur') (e.target as HTMLElement).blur?.();
      else if (a === 'back') backToList();
      else if (a === 'drawer') setDrawer(null);
      else select(null);
    };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, [cardFor, popout, select, focus, drawer, leftView, backToList, setDrawer]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (focusKeyApplies(e, !!popout)) { e.preventDefault(); toggleFocus(); } };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, [popout, toggleFocus]);
  return (
    <>
      <Stage focus={focus}>
        {shown && (
          <Universe graph={shown} layout={shown.layout ?? {}} selectedId={selectedId} hoverId={hoverId} labels={labels} focus={focus}
            viewNonce={viewNonce} onSelect={onSelect} onHover={hover}
            quality={quality} onProbe={autoPickQuality} watchFps={quality === 'full' && !qualitySetByHand} onSlow={slowQuality} />
        )}
        <TitleBar />
        {notice && !popout && leftView.kind !== 'idea' && <div className="notice" role="status">{notice.text}</div>}
        {cardFor && <NodeCard nodeId={cardFor} />}
        {!focus && <>
        <Panel title="Ideas" style={{ left: 20, top: 92, width: 440, height: 'calc(var(--sh) - 112px)' }}>
          <IdeasPane />
        </Panel>
        <Panel title="Pipeline" side="right" style={{ left: 'calc(var(--sw) - 460px)', top: 92, width: 440, height: 460 }}>
          <div className="sub-h">Ideas by stage</div>
          <StageChart />
          <div className="sub-h">Waiting on you</div>
          <Waiting />
        </Panel>
        <Panel title="Demand" side="right" style={{ left: 'calc(var(--sw) - 460px)', top: 572, width: 440, height: 'calc(var(--sh) - 592px)' }}>
          <div className="sub-h">Support requested</div>
          <SupportChart />
          <div className="sub-h">Function · region</div>
          <FunctionChart />
        </Panel>
        </>}
        <div className="abs" style={{ left: 480, top: 'calc(var(--sh) - 70px)', width: 'calc(var(--sw) - 960px)', display: 'flex', justifyContent: 'center', gap: 16 }}>
          <button className="pill" data-action="reset-view" onClick={resetView}>Reset view</button>
          <button className={`pill${labels ? ' on' : ''}`} data-action="labels" aria-pressed={labels} onClick={toggleLabels}>Labels</button>
          <button className={`pill${focus ? ' on' : ''}`} data-action="focus" aria-pressed={focus} title="Hide the panels (F)" onClick={toggleFocus}>{focusLabel(focus)}</button>
          <button className="pill" data-action="quality" data-quality={quality} title="Cycle Full → Lite → Flat" onClick={cycleQuality}>{qualityLabel(quality)}</button>
          {leftView.kind === 'idea' && (
            <button className={`pill${onlyRelated ? ' on' : ''}`} data-action="only-related" aria-pressed={onlyRelated}
              title={onlyRelated ? 'Show the whole universe again' : 'Show only this idea and what it links to'} onClick={toggleOnlyRelated}>
              {onlyRelated ? 'Show all' : 'Only related'}</button>
          )}
        </div>
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
