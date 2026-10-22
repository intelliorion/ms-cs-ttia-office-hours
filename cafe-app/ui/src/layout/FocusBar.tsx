import { useStore } from '../state/store';
import { neighbourhood } from '../universe/graphView';

/**
 * Whatever is in view (an answer's lit stars, or the star you clicked and what it links to), a bar above the bottom
 * buttons sets how much of the rest of the universe is hidden: 10% leaves it almost as it is, 100% shows only what is
 * in view. Clear ends the highlight, or lets go of the star.
 */
export function FocusBar() {
  const { highlight, setHighlight, hideUnlit, setHideUnlit, selectedId, select, graph } = useStore();
  const node = selectedId ? graph?.nodes.find((n: any) => n.id === selectedId) : undefined;
  if (!highlight && !node) return null;
  const pct = Math.round(hideUnlit * 100);
  const what = highlight
    ? `${highlight.length} star${highlight.length === 1 ? '' : 's'} lit`
    : (() => { const k = neighbourhood(graph, node.id).size - 1; return `${node.label} and its ${k} link${k === 1 ? '' : 's'}`; })();
  return (
    <div className="hl-bar abs" role="group" aria-label="What is in view" data-testid="highlight-bar">
      <span className="hl-n" title={what}><span className="cmd-spark" aria-hidden="true">✦</span>{what}</span>
      <label className="hl-slide">
        <span>Hide the rest</span>
        <input type="range" min={10} max={100} step={5} value={pct} aria-label="Hide the rest of the universe" data-testid="highlight-hide"
          onChange={(e) => setHideUnlit(Number(e.target.value) / 100)} />
        <b>{pct === 100 ? 'Only these' : `${pct}%`}</b>
      </label>
      <button className="link-btn" data-action="highlight-clear" onClick={() => (highlight ? setHighlight(null) : select(null))}>Clear</button>
    </div>
  );
}
