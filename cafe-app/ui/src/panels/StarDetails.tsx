import { useStore } from '../state/store';
import { NODE_COLOURS } from '../universe/graphView';
import { starProfile } from './starProfile';

const dot = (type: string) => (NODE_COLOURS as Record<string, string>)[type] ?? '#9fb0ae';

/**
 * A star that is not an idea, in the left panel (the list waits behind it): what it is, its facts, a person's roles
 * on each idea, and the other stars it links to. A click on any of them goes there; Back comes here again.
 */
export function StarDetails({ id }: { id: string }) {
  const { graph, state, trail, goBack, select, followLink, hover } = useStore();
  const p = starProfile(graph, state, id);
  if (!p) return null;
  return (
    <div className="idea-detail star-detail" data-testid="star-details" role="region" aria-label={`${p.kind} ${p.label}`}>
      <div className="id-head">
        <button className="btn back" data-action="star-back" title={trail.length ? 'Back to where you were (Esc)' : 'Back to the list (Esc)'}
          onClick={() => (trail.length ? goBack() : select(null))}>← Back</button>
      </div>
      <div className="sd-scroll">
        <div className="nc-type"><span className="dot" style={{ background: dot(p.type) }} />{p.kind}</div>
        <h2 className="sd-title">{p.label}</h2>
        {p.about && <p className="hint lead">{p.about}</p>}
        <dl className="sd-facts">
          {p.facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
        {p.roles.length > 0 && (
          <section className="sec">
            <h3>On ideas <span className="sec-n">{p.roles.length}</span></h3>
            <ul className="sd-list">
              {p.roles.map((r) => (
                <li key={r.ideaId}>
                  <button className="sd-go" data-go={`idea:${r.ideaId}`} onClick={() => followLink(`idea:${r.ideaId}`)}
                    onMouseEnter={() => hover(`idea:${r.ideaId}`)} onMouseLeave={() => hover(null)}>
                    <span className="iid">{r.ideaId}</span><span className="sd-l">{r.title}</span><em className="sd-roles">{r.roles.join(' · ')}</em>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {p.groups.map((g) => (
          <section key={g.type} className="sec" data-group={g.type}>
            <h3>{g.kind} <span className="sec-n">{g.items.length}</span></h3>
            <ul className="sd-list">
              {g.items.map((x) => (
                <li key={x.id}>
                  <button className="sd-go" data-go={x.id} onClick={() => followLink(x.id)} onMouseEnter={() => hover(x.id)} onMouseLeave={() => hover(null)}>
                    <span className="dot" style={{ background: dot(g.type) }} /><span className="sd-l">{x.label}</span><span className="rel">{x.rel}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {!p.roles.length && !p.groups.length && <p className="hint">Linked only to ideas: they are listed on the right.</p>}
      </div>
    </div>
  );
}
