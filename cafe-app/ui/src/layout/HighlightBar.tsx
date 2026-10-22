import { useStore } from '../state/store';

/**
 * While stars are lit (an answer from the assistant), a bar above the bottom buttons sets how much of the rest of the
 * universe is hidden: 10% leaves it almost as it is, 100% shows only the lit stars. Clear ends the highlight.
 */
export function HighlightBar() {
  const { highlight, setHighlight, hideUnlit, setHideUnlit, selectedId } = useStore();
  if (!highlight) return null;
  const pct = Math.round(hideUnlit * 100);
  return (
    <div className="hl-bar abs" role="group" aria-label="Highlight" data-testid="highlight-bar">
      <span className="hl-n"><span className="cmd-spark" aria-hidden="true">✦</span>{highlight.length} star{highlight.length === 1 ? '' : 's'} lit</span>
      <label className="hl-slide">
        <span>Hide the rest</span>
        <input type="range" min={10} max={100} step={5} value={pct} aria-label="Hide the rest of the universe" data-testid="highlight-hide"
          onChange={(e) => setHideUnlit(Number(e.target.value) / 100)} />
        <b>{pct === 100 ? 'Only these' : `${pct}%`}</b>
      </label>
      {selectedId && <span className="hl-note">A star is selected: its own links show</span>}
      <button className="link-btn" data-action="highlight-clear" onClick={() => setHighlight(null)}>Clear</button>
    </div>
  );
}
