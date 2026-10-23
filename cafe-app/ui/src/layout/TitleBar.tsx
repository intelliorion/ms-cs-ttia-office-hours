import { useEffect } from 'react';
import { useStore } from '../state/store';
import { post } from '../api';
import { SettingsMenu } from './SettingsMenu';
import { baseName } from '../popouts/titleHelpers';
import { inboxCount } from '../popouts/inboxHelpers';
import { AssistantLauncher } from './Assistant';

export function TitleBar() {
  const { openPopout, refresh, setNotice, state, refreshAi, inbox, refreshInbox } = useStore();
  useEffect(() => { void refreshAi(); void refreshInbox(); }, [refreshAi, refreshInbox]);
  const waiting = inboxCount(inbox?.counts);
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
      <div><span className="name"><span className="org">CS TTIA</span>Creators' Café</span></div>
      <div className="btns">
        <AssistantLauncher />
        <button className={`pill inbox${waiting ? ' waiting' : ''}`} data-action="inbox" title="Drop anything: exports, emails, transcripts, Word, PDF and pictures" onClick={() => openPopout({ kind: 'inbox' })}>
          <span className="ib-icon" aria-hidden="true">⤓</span>Import{waiting > 0 && <span className="ib-badge">{waiting}</span>}</button>
        <button className="pill" data-action="round" onClick={() => openPopout({ kind: 'round' })}>Rounds</button>
        <button className="pill" data-action="review-pack" onClick={() => void write('/api/review-pack')}>Review pack</button>
        <SettingsMenu />
      </div>
    </header>
  );
}
