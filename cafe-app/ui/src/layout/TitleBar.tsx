import { useEffect } from 'react';
import { useStore } from '../state/store';
import { post } from '../api';
import { chipText } from '../popouts/aiUi';
import { baseName, titleSub, unsentCount } from '../popouts/titleHelpers';
import { inboxCount } from '../popouts/inboxHelpers';

export function TitleBar() {
  const { openPopout, refresh, setNotice, state, ai, refreshAi, inbox, refreshInbox } = useStore();
  useEffect(() => { void refreshAi(); void refreshInbox(); }, [refreshAi, refreshInbox]);
  const waiting = inboxCount(inbox?.counts);
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
      <div><span className="name">Creators' Café</span><span className="sub">{titleSub(state)}</span></div>
      <div className="btns">
        <button className={`pill${waiting ? ' waiting' : ''}`} data-action="inbox" title="Drop anything: exports, emails, transcripts, notes" onClick={() => openPopout({ kind: 'inbox' })}>Inbox ({waiting})</button>
        <button className="pill" data-action="import" onClick={() => openPopout({ kind: 'import' })}>Import</button>
        <button className="pill" data-action="round" onClick={() => openPopout({ kind: 'round' })}>Round</button>
        <button className="pill" data-action="outbox" onClick={() => openPopout({ kind: 'outbox' })}>Outbox ({n})</button>
        <button className="pill" data-action="review-pack" onClick={() => void write('/api/review-pack')}>Review pack</button>
        <button className="pill" data-action="status-csv" onClick={() => void write('/api/status-export')}>status.csv</button>
        <button className="pill" data-action="ai" title="AI helper" onClick={() => openPopout({ kind: 'ai' })}>
          <span className="ai-dot" data-on={ai?.provider ? 'true' : 'false'} aria-hidden="true" />{chipText(ai)}
        </button>
      </div>
    </header>
  );
}
