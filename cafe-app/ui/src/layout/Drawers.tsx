import { useStore } from '../state/store';
import { IdeasPane } from '../panels/IdeasPane';
import { StageChart, SupportChart, FunctionChart, Waiting } from '../panels/Charts';

/**
 * Below 1000px wide (see theme.css) the side panels are hidden and these edge tabs open them as drawers
 * over the universe. At 1000px and wider none of this shows.
 */
export function Drawers() {
  const { drawer, setDrawer } = useStore();
  // Esc is handled in App (escAction): idea details go Back first, then the drawer closes.
  return (
    <>
      <button className="edge-tab left" data-action="drawer-ideas" aria-expanded={drawer === 'ideas'} onClick={() => setDrawer(drawer === 'ideas' ? null : 'ideas')}>Ideas</button>
      <button className="edge-tab right" data-action="drawer-charts" aria-expanded={drawer === 'charts'} onClick={() => setDrawer(drawer === 'charts' ? null : 'charts')}>Charts</button>
      {drawer && (
        <section className={`panel drawer ${drawer === 'ideas' ? 'left' : 'right'}`} role="dialog" aria-label={drawer === 'ideas' ? 'Ideas' : 'Charts'} data-testid="drawer">
          <div className="drawer-head">
            <h2>{drawer === 'ideas' ? 'Ideas' : 'Charts'}</h2>
            <button className="x" aria-label="Close" onClick={() => setDrawer(null)}>✕</button>
          </div>
          {drawer === 'ideas' ? (
            <div className="panel-body"><IdeasPane /></div>
          ) : (
            <div className="panel-body drawer-scroll">
              <div className="sub-h">Ideas by stage</div>
              <StageChart />
              <div className="sub-h">Waiting on you</div>
              <Waiting />
              <div className="sub-h">Support requested</div>
              <SupportChart />
              <div className="sub-h">Function · region</div>
              <FunctionChart />
            </div>
          )}
        </section>
      )}
    </>
  );
}
