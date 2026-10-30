import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { useChat } from '../state/chat';
import { getNetwork, networkPropose } from '../api';
import { NODE_COLOURS } from '../universe/graphView';
import { Modal } from './Modal';
import { NETWORK_ANALYSES, barShare, becauseText, clusterIds, footerLine, relText, statsLine, type NetStar, type NetView } from './networkHelpers';

/**
 * Network: what NetworkX finds across the whole graph the app built. The size line, the stars that hold the most
 * ideas together, the clusters of ideas with what binds them, anything cut off, and links that are probably missing.
 * A star or a cluster lights in the universe; a suggested link goes to the assistant as a proposal, made only with Do it.
 * Read-only: nothing here changes the graph.
 */
export function NetworkPopout() {
  const { closePopout, select, setHighlight } = useStore();
  const [derived, setDerived] = useState(false);
  const [v, setV] = useState<NetView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [proposed, setProposed] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    setError(null);
    getNetwork(NETWORK_ANALYSES, derived).then((x) => { if (live) setV(x); }, (e) => { if (live) { setV(null); setError((e as Error).message); } });
    return () => { live = false; };
  }, [derived]);

  const show = (id: string) => { closePopout(); select(id); };
  const light = (ids: string[]) => { closePopout(); setHighlight(ids); };
  const propose = async (s: NonNullable<NetView['results']['suggest']>['suggestions'][number]) => {
    setBusy(true); setError(null);
    try {
      const entry = await networkPropose({ from: s.from.id, rel: s.rel, to: s.to.id, why: becauseText(s), thread: useChat.getState().thread?.id });
      setProposed((xs) => [...xs, `${s.from.id}|${s.to.id}`]);
      await useChat.getState().openThread(entry.thread);
      useChat.getState().setOpen(true);
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const chip = (s: NetStar) => (
    <button key={s.id} className="star-chip" data-star={s.id} title={`${s.type}: show it in the universe`} onClick={() => show(s.id)}>
      <span className="dot" style={{ background: (NODE_COLOURS as Record<string, string>)[s.type] ?? '#9fb0ae' }} />{s.label}
    </button>
  );
  const r = v?.results;
  const top = r?.central?.betweenness ?? [];
  const max = top[0]?.betweenness ?? 0;
  return (
    <Modal title={<><div className="pop-id">Network</div><h2>What NetworkX finds in the graph</h2></>} label="Network" onClose={closePopout} width={900} height={800} className="net-pop"
      actions={<button className={`pill net-derived${derived ? ' on' : ''}`} data-action="network-derived" aria-pressed={derived} title="Stored facts are the form, the AI's links and your edits; derived links are what the rules add" onClick={() => setDerived(!derived)}>Derived links: {derived ? 'included' : 'left out'}</button>}>
      <div className="pop-single scroll" data-testid="network-popout">
        {!v && !error && <div className="dr-wait">Asking NetworkX…</div>}
        {error && <div className="pop-notice error" role="status" data-testid="network-error">{error}</div>}
        {v && r && (
          <>
            <section className="sec net-stats">
              <p className="net-lede">The app builds the graph; NetworkX analyses it as a whole. Nothing here changes the graph.</p>
              <div className="net-line" data-testid="network-stats">{statsLine(v)}</div>
            </section>

            <section className="sec" data-testid="network-central">
              <h3>Holds the most together <span className="sec-n">betweenness centrality{r.central?.sampled ? ', estimated' : ''}</span></h3>
              <ul className="net-bars">
                {top.map((x) => (
                  <li key={x.id}>
                    {chip(x)}
                    <span className="net-track"><span className="net-bar" style={{ width: `${barShare(x.betweenness, max)}%` }} /></span>
                    <span className="net-n" title={`${x.links} links, ${x.ideas} ideas`}>{x.betweenness.toFixed(3)} · {x.ideas} idea{x.ideas === 1 ? '' : 's'}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="sec" data-testid="network-clusters">
              <h3>Ideas that group together <span className="sec-n">Louvain communities · {r.clusters?.clusters.length ?? 0} cluster{r.clusters?.clusters.length === 1 ? '' : 's'}</span></h3>
              <div className="net-clusters">
                {(r.clusters?.clusters ?? []).map((c, i) => (
                  <div key={i} className="net-cluster" data-cluster={i + 1}>
                    <button className="net-cluster-h" data-action="network-light-cluster" title="Light this cluster in the universe" onClick={() => light(clusterIds(c))}>Cluster {i + 1} · {c.ideas.length} ideas <span>Light them</span></button>
                    <div className="net-chips">{c.ideas.map(chip)}</div>
                    {c.binding.length > 0 && <div className="net-bound"><span>Bound by</span>{c.binding.slice(0, 5).map(chip)}</div>}
                  </div>
                ))}
              </div>
              {(r.clusters?.alone.length ?? 0) > 0 && <div className="net-alone"><span>On their own:</span> {r.clusters!.alone.map(chip)}</div>}
            </section>

            <section className="sec" data-testid="network-isolated">
              <h3>Cut off from the rest <span className="sec-n">connected components · {r.isolated?.components ?? 0}</span></h3>
              {r.isolated?.outside.length ? <div className="net-chips">{r.isolated.outside.map(chip)}</div> : <p className="hint">No idea, team or system is cut off: everything is in one connected group.</p>}
            </section>

            <section className="sec" data-testid="network-suggest">
              <h3>Links that are probably missing <span className="sec-n">link prediction · Adamic-Adar, Jaccard · proposals only</span></h3>
              {!r.suggest?.suggestions.length && <p className="hint">No link looks missing.</p>}
              <ul className="net-sugg">
                {(r.suggest?.suggestions ?? []).map((s) => {
                  const done = proposed.includes(`${s.from.id}|${s.to.id}`);
                  return (
                    <li key={`${s.from.id}|${s.to.id}`}>
                      <div className="net-sugg-l">
                        <div>{chip(s.from)} <span className="net-rel">{relText(s.rel)}</span> {chip(s.to)}</div>
                        <div className="net-why">{becauseText(s)}</div>
                      </div>
                      <button className="btn sm primary" data-action="network-propose" disabled={busy || done} title="Send it to the assistant as a proposal: nothing changes until you press Do it there" onClick={() => void propose(s)}>{done ? 'Proposed' : 'Propose'}</button>
                    </li>
                  );
                })}
              </ul>
            </section>
          </>
        )}
        {v && <div className="dr-model net-foot" data-testid="network-footer">{footerLine(v)}</div>}
      </div>
    </Modal>
  );
}
