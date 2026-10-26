import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { memoryPost } from '../api';
import { Modal } from './Modal';
import { Ring } from '../layout/DeepReadButton';
import { buttonsFor, COPY, IDEA_STATUS, kindCounts, ringShare, statusLine, type DeepReadButton as Control } from './deepReadHelpers';

/**
 * Deep read: what the assistant has read. The ring and the controls at the top, the counts, each idea, then the short
 * blocks on why. Polls while a read runs; the job runs on when this closes.
 */
export function DeepReadPopout() {
  const { memory, refreshMemory, closePopout } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void refreshMemory(); }, [refreshMemory]);
  const running = memory?.job.status === 'running';
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { void refreshMemory(); }, 1500);
    return () => clearInterval(t);
  }, [running, refreshMemory]);

  const press = async (what: Control) => {
    setBusy(true); setError(null);
    try { useStore.setState({ memory: await memoryPost(what) }); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  const v = memory;
  const pct = v ? (running ? Math.floor(ringShare(v) * 100) : v.summary.percent) : 0;
  return (
    <Modal title={<><div className="pop-id">Deep read</div><h2>What the assistant has read</h2></>} label="Deep read" onClose={closePopout} width={860} height={760} className="deep-pop">
      <div className="pop-single scroll">
        {!v && <div className="dr-wait">Asking the Café…</div>}
        {v && (
          <>
            <section className="dr-top" data-testid="deep-read-top">
              <Ring share={ringShare(v)} size={96} width={5}><b className="dr-big">{pct}%</b></Ring>
              <div className="dr-lines">
                <div className="dr-n"><b>{running ? v.job.done : v.summary.embedded}</b> of <b>{running ? v.job.total : v.summary.chunks}</b> passages read</div>
                <div className="dr-status" data-testid="deep-read-status">{statusLine(v)}</div>
                <div className="dr-btns">
                  {buttonsFor(v).map((b) => (
                    <button key={b.id} className={`btn${b.primary ? ' primary' : ''}`} data-action={`deep-read-${b.id}`} disabled={busy || b.disabled} onClick={() => void press(b.id)}>{b.label}</button>
                  ))}
                </div>
                {error && <div className="pop-notice error" role="status">{error}</div>}
              </div>
            </section>
            {kindCounts(v.summary).length > 0 && (
              <div className="dr-kinds" data-testid="deep-read-kinds">
                {kindCounts(v.summary).map((k) => <span key={k.label} className={k.embedded === k.chunks ? 'all' : ''}>{k.label} <b>{k.embedded}</b>/{k.chunks}</span>)}
              </div>
            )}
            {v.summary.ideas.length > 0 && (
              <section className="sec">
                <h3>Each idea <span className="sec-n">{v.summary.ideas.filter((i) => i.status === 'read').length} of {v.summary.ideas.length} read</span></h3>
                <ul className="dr-ideas" data-testid="deep-read-ideas">
                  {v.summary.ideas.map((i) => (
                    <li key={i.id} className={`st-${i.status}`}>
                      <span className="dr-dot" aria-hidden="true" /><span className="iid">{i.id.replace('CAFE-', '')}</span><span className="ttl" title={i.title}>{i.title}</span>
                      <span className="dr-count">{i.embedded}/{i.chunks}</span><span className="dr-st">{IDEA_STATUS[i.status]}</span>
                    </li>
                  ))}
                </ul>
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
