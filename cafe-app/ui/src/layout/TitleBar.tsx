import { useStore } from '../state/store';
import { post } from '../api';
import { baseName, unsentCount } from '../popouts/titleHelpers';

export function TitleBar() {
  const { openPopout, refresh, setNotice, state } = useStore();
  const n = unsentCount(state?.outbox);
  /** Writes a file through the server and says only its name. */
  const write = async (url: string) => {
    try {
      const r = await post(url);
      setNotice({ text: `Written: ${baseName(r.file)}`, kind: 'ok' });
      void refresh();
    } catch (e) { setNotice({ text: (e as Error).message, kind: 'error' }); }
  };
  return (
    <header className="titlebar">
      <div><span className="name">Creators' Café</span><span className="sub">Operator console{state ? ` · ${state.today}` : ''}</span></div>
      <div className="btns">
        <button className="pill" data-action="import" onClick={() => openPopout({ kind: 'import' })}>Import</button>
        <button className="pill" data-action="round" onClick={() => openPopout({ kind: 'round' })}>Round</button>
        <button className="pill" data-action="outbox" onClick={() => openPopout({ kind: 'outbox' })}>Outbox ({n})</button>
        <button className="pill" data-action="review-pack" onClick={() => void write('/api/review-pack')}>Review pack</button>
        <button className="pill" data-action="status-csv" onClick={() => void write('/api/status-export')}>status.csv</button>
        <button className="pill" data-action="ai" onClick={() => openPopout({ kind: 'ai' })}>AI</button>
      </div>
    </header>
  );
}
