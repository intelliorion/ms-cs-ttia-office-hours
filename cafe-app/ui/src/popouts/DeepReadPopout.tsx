import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { memoryPost, memoryUpkeep } from '../api';
import { Modal } from './Modal';
import { Ring } from '../layout/DeepReadButton';
import {
  buttonsFor, COPY, dashboard, decisionLine, FILTERS, filterIdeas, IDEA_STATUS, KEEPS_CURRENT, kindBars, ringShare, staleKinds, statusLine, whenText,
  type DeepReadButton as Control,
} from './deepReadHelpers';

/**
 * Deep read: a dashboard of where things stand. The ring and the controls, the three tiles (read · changed since ·
 * not yet), how it keeps itself current and what it last decided, the by-kind bars, then every idea in a table (not yet
 * first), and the short blocks on why. Polls while a read runs or upkeep waits; the job runs on when this closes.
 */
export function DeepReadPopout() {
  const { memory, refreshMemory, closePopout, openIdea, deepReadView, setDeepReadView } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void refreshMemory(); }, [refreshMemory]);
  const running = memory?.job.status === 'running';
  const live = running || !!memory?.upkeep?.waiting;
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => { void refreshMemory(); }, 1500);
    return () => clearInterval(t);
  }, [live, refreshMemory]);

  const press = async (what: Control) => {
    setBusy(true); setError(null);
    try { useStore.setState({ memory: await memoryPost(what) }); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const flip = async (on: boolean) => {
    setBusy(true); setError(null);
    try { useStore.setState({ memory: await memoryUpkeep(on) }); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  const v = memory;
  const pct = v ? (running ? Math.floor(ringShare(v) * 100) : v.summary.percent) : 0;
  const d = v ? dashboard(v.summary) : null;
  const hasRun = !!v?.job.embedder;
  const rows = v ? filterIdeas(v.summary.ideas, deepReadView.filter, deepReadView.q) : [];
  const last = decisionLine(v?.job.lastDecision);
  return (
    <Modal title={<><div className="pop-id">Deep read</div><h2>What the assistant has read</h2></>} label="Deep read" onClose={closePopout} width={900} height={800} className="deep-pop">
      <div className="pop-single scroll">
        {!v && <div className="dr-wait">Asking the Café…</div>}
        {v && d && (
          <>
            <section className="dr-top" data-testid="deep-read-top">
              <Ring share={ringShare(v)} size={96} width={5}><b className="dr-big">{pct}%</b></Ring>
              <div className="dr-lines">
                <div className="dr-n"><b>{running ? v.job.done : v.summary.embedded}</b> of <b>{running ? v.job.total : v.summary.chunks}</b> passages read</div>
                <div className="dr-status" data-testid="deep-read-status">{statusLine(v)}</div>
                <div className="dr-togo" data-testid="deep-read-togo">passages to go: {d.toGo} ({d.toGoPercent} %)</div>
                <div className="dr-btns">
                  {buttonsFor(v).map((b) => (
                    <button key={b.id} className={`btn${b.primary ? ' primary' : ''}`} data-action={`deep-read-${b.id}`} disabled={busy || b.disabled} onClick={() => void press(b.id)}>{b.label}</button>
                  ))}
                </div>
                {error && <div className="pop-notice error" role="status">{error}</div>}
              </div>
              <div className="dr-tiles" data-testid="deep-read-tiles" role="group" aria-label="Ideas by reading status">
                <div className="dr-tile t-read"><b>{d.read}</b><span>Read</span><i>{d.shares.read} %</i></div>
                <div className="dr-tile t-stale"><b>{d.stale}</b><span>Changed since</span><i>{d.shares.stale} %</i></div>
                <div className="dr-tile t-new"><b>{d.new}</b><span>Not yet</span><i>{d.shares.new} %</i></div>
              </div>
            </section>

            {hasRun && (
              <section className="sec dr-keeps" data-testid="deep-read-keeps">
                <h3>Keeps itself current</h3>
                <p>{KEEPS_CURRENT}</p>
                <div className="dr-keeps-row">
                  <button className={`pill dr-switch${v.upkeep.on ? ' on' : ''}`} data-action="deep-read-upkeep" aria-pressed={v.upkeep.on} disabled={busy} onClick={() => void flip(!v.upkeep.on)}>
                    Automatic upkeep: {v.upkeep.on ? 'on' : 'off'}
                  </button>
                  {v.upkeep.waiting && <span className="dr-waiting">waiting for changes to settle…</span>}
                  {last && <span className={`dr-last a-${v.job.lastDecision?.act}`} data-testid="deep-read-last">{last}</span>}
                </div>
              </section>
            )}

            {kindBars(v.summary).length > 0 && (
              <section className="sec dr-bykind">
                <h3>By kind <span className="sec-n">read of present</span></h3>
                <ul className="beams dr-beams" data-testid="deep-read-bars">
                  {kindBars(v.summary).map((k) => (
                    <li key={k.label} title={`${k.label}: ${k.embedded} of ${k.chunks} read`} className={k.embedded === k.chunks ? 'all' : ''}>
                      <span className="beam-l">{k.label}</span>
                      <span className="beam-track"><span className="beam-total" /><span className="beam" style={{ width: `${k.chunks ? Math.max(k.embedded ? 4 : 0, (k.embedded / k.chunks) * 100) : 0}%` }}><i className="beam-dot" /></span></span>
                      <span className="beam-n">{k.embedded} / {k.chunks}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {v.summary.ideas.length > 0 && (
              <section className="sec dr-ideas-sec">
                <div className="dr-table-h">
                  <h3>Each idea <span className="sec-n">{rows.length} of {v.summary.ideas.length}</span></h3>
                  <div className="ib-chips" role="group" aria-label="Filter the ideas">
                    {FILTERS.map((f) => (
                      <button key={f.id} className={`chip${deepReadView.filter === f.id ? ' on' : ''}`} data-chip={f.id} aria-pressed={deepReadView.filter === f.id} onClick={() => setDeepReadView({ filter: f.id })}>{f.label}</button>
                    ))}
                  </div>
                  <input className="search dr-search" type="search" value={deepReadView.q} onChange={(e) => setDeepReadView({ q: e.target.value })} placeholder="Search ID or title" aria-label="Search the ideas" />
                </div>
                <div className="dr-table-wrap">
                  <table className="dr-table" data-testid="deep-read-table">
                    <thead><tr><th>Café ID</th><th>Title</th><th>Status</th><th className="num">Passages</th><th>Still to read</th><th>Last read</th></tr></thead>
                    <tbody>
                      {rows.map((i) => (
                        <tr key={i.id} className={`st-${i.status}`} data-idea={i.id} role="button" tabIndex={0} title={`Open ${i.id}`}
                          onClick={() => openIdea(i.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openIdea(i.id); } }}>
                          <td className="iid">{i.id.replace('CAFE-', '')}</td>
                          <td className="ttl"><span title={i.title}>{i.title}</span></td>
                          <td><span className="dr-pill">{IDEA_STATUS[i.status]}</span></td>
                          <td className="num dr-count">{i.embedded} / {i.chunks}</td>
                          <td className="dr-stale">{staleKinds(i)}</td>
                          <td className="dr-when">{i.lastRead ? whenText(i.lastRead) : '—'}</td>
                        </tr>
                      ))}
                      {!rows.length && <tr className="dr-none"><td colSpan={6}>No idea matches.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="sec dr-copy">
              {COPY.map((c) => <div key={c.title} className="dr-block"><h4>{c.title}</h4><p>{c.text}</p></div>)}
            </section>
            <div className="dr-model">
              Model: <code>{v.model.id}</code>{v.model.id === 'fake' ? ' (the test stub: nothing is downloaded)' : v.model.cached ? ', on this machine' : ', downloaded on the first Run'} · kept in <code>{v.model.dir}</code> · the index is in the data folder under memory/ and can be deleted at any time.
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
