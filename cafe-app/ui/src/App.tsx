import { useEffect, useMemo } from 'react';
import { Stage } from './layout/Stage';
import { Panel } from './layout/Panel';
import { TitleBar } from './layout/TitleBar';
import { RightPanels } from './panels/ContextPanels';
import { Assistant } from './layout/Assistant';
import { FocusBar } from './layout/FocusBar';
import { useChat } from './state/chat';
import { Welcome } from './layout/Welcome';
import { Drawers } from './layout/Drawers';
import { useStore } from './state/store';
import { IdeasPane } from './panels/IdeasPane';
import { Universe } from './universe/Universe';
import { ImportPopout } from './popouts/ImportPopout';
import { RoundPopout } from './popouts/RoundPopout';
import { InboxPopout } from './popouts/InboxPopout';
import { AiPopout } from './popouts/AiPopout';
import { ConfigPopout } from './popouts/ConfigPopout';
import { TypeFilter } from './layout/TypeFilter';
import { labelModeText, visibleGraph } from './universe/graphView';
import { focusLabel, focusKeyApplies, escAction, isNarrow, qualityLabel } from './state/store';

declare global { interface Window { __cafe?: Record<string, (...a: any[]) => void> } }

export default function App() {
  const { state, graph, popout, openPopout, closePopout, notice, refresh, selectedId, selectedIds, highlight, hideUnlit, hoverId, labels, focus, toggleFocus, viewNonce, select, hover, toggleLabels, setLabels, resetView,
    leftView, openIdea, backToList, trail, goBack, clickStar, drawer, setDrawer, quality, qualitySetByHand, setQuality, cycleQuality, autoPickQuality, slowQuality, setNotice } = useStore();
  // A click shows what was clicked, with no card in between (see clickStar).
  const onSelect = clickStar;
  const chatOpen = useChat((c) => c.open);
  const showingDetails = leftView.kind === 'idea' && selectedId === `idea:${leftView.id}`;
  // A star selected without its idea open: Esc deselects it.
  const cardFor = selectedId && !popout && !showingDetails && graph?.nodes.some((n: any) => n.id === selectedId) ? selectedId : null;
  const hiddenTypes = useStore((s) => s.hiddenTypes);
  // The Show filter thins the picture only; everything else reads the whole graph from the store.
  const shown = useMemo(() => graph && visibleGraph(graph, hiddenTypes, [selectedId, ...selectedIds].filter(Boolean) as string[]), [graph, hiddenTypes, selectedId, selectedIds]);
  useEffect(() => { void refresh(); }, [refresh]);
  // Lite drops the panels' backdrop blur too (theme.css), so the quality is on the root element.
  useEffect(() => { document.documentElement.dataset.quality = quality; }, [quality]);
  const theme = useStore((s) => s.theme);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    // Hooks for the screenshot tour; only on this machine.
    if (import.meta.env.DEV || location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      window.__cafe = { select, click: onSelect, openIdea, backToList, hover, toggleLabels, setLabels, resetView, toggleFocus, openPopout, closePopout, setQuality, setNotice, refresh };
    }
  }, [select, onSelect, openIdea, backToList, hover, toggleLabels, setLabels, resetView, toggleFocus, openPopout, closePopout, setQuality, setNotice, refresh]);
  useEffect(() => {
    // One Esc handler: idea details go Back, then a drawer closes, then the star card closes. A modal handles its own Esc.
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const detailsVisible = !focus && (!isNarrow() || drawer === 'ideas');
      const a = escAction({ modal: !!popout, leftView, detailsVisible, drawer, card: !!cardFor, target: e.target });
      if (a === 'none') return;
      e.preventDefault();
      if (a === 'blur') (e.target as HTMLElement).blur?.();
      // After following links, Esc steps back along them first.
      else if ((a === 'back' || a === 'deselect') && trail.length) goBack();
      else if (a === 'back') backToList();
      else if (a === 'drawer') setDrawer(null);
      else select(null);
    };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, [cardFor, popout, select, focus, drawer, leftView, backToList, trail, goBack, setDrawer]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (focusKeyApplies(e, !!popout)) { e.preventDefault(); toggleFocus(); } };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, [popout, toggleFocus]);
  return (
    <>
      <Stage focus={focus}>
        {shown && (
          <Universe graph={shown} layout={shown.layout ?? {}} selectedId={selectedId} selectedIds={selectedIds} highlight={highlight} hideUnlit={hideUnlit} hoverId={hoverId} labels={labels} focus={focus}
            viewNonce={viewNonce} onSelect={onSelect} onHover={hover}
            quality={quality} theme={theme} onProbe={autoPickQuality} watchFps={quality === 'full' && !qualitySetByHand} onSlow={slowQuality} />
        )}
        <Welcome onStart={() => openPopout({ kind: 'inbox' })} />
        <TitleBar />
        {notice && !popout && leftView.kind !== 'idea' && <div className="notice" role="status">{notice.text}</div>}
        {!focus && <>
        <Panel title="Ideas" style={{ left: 20, top: 92, width: 440, height: 'calc(var(--sh) - 112px)' }}>
          <IdeasPane />
        </Panel>
        {/* The assistant docks in the right column while open; the context panels come back when it closes. */}
        {!chatOpen && <RightPanels />}
        </>}
        <FocusBar />
        <div className="abs" style={{ left: 480, top: 'calc(var(--sh) - 70px)', width: 'calc(var(--sw) - 960px)', display: 'flex', justifyContent: 'center', gap: 16 }}>
          <button className="pill" data-action="reset-view" onClick={resetView}>Reset view</button>
          <button className="pill" data-action="labels" data-labels={labels} title="Cycle Full → Smart → None" onClick={toggleLabels}>{labelModeText(labels)}</button>
          <button className={`pill${focus ? ' on' : ''}`} data-action="focus" aria-pressed={focus} title="Hide the panels (F)" onClick={toggleFocus}>{focusLabel(focus)}</button>
          <button className="pill" data-action="quality" data-quality={quality} title="Cycle Full → Lite → Flat" onClick={cycleQuality}>{qualityLabel(quality)}</button>
          <TypeFilter />
        </div>
        <Assistant />
        {popout?.kind === 'import' && <ImportPopout />}
        {popout?.kind === 'round' && <RoundPopout />}
        {popout?.kind === 'inbox' && <InboxPopout />}
        {popout?.kind === 'ai' && <AiPopout />}
        {popout?.kind === 'config' && <ConfigPopout />}
      </Stage>
      {!focus && <Drawers />}
    </>
  );
}
