import { useEffect } from 'react';
import { useStore } from '../state/store';
import { SettingsMenu } from './SettingsMenu';
import { inboxCount } from '../popouts/inboxHelpers';
import { AssistantLauncher } from './Assistant';

export function TitleBar() {
  const { openPopout, refreshAi, inbox, refreshInbox } = useStore();
  useEffect(() => { void refreshAi(); void refreshInbox(); }, [refreshAi, refreshInbox]);
  const waiting = inboxCount(inbox?.counts);
  return (
    <header className="titlebar">
      <div><span className="name"><span className="org">CS TTIA</span>Creators' Café</span></div>
      <div className="btns">
        <AssistantLauncher />
        <button className={`pill inbox${waiting ? ' waiting' : ''}`} data-action="inbox" title="Drop anything: exports, emails, transcripts, Word, PDF and pictures" onClick={() => openPopout({ kind: 'inbox' })}>
          <span className="ib-icon" aria-hidden="true">⤓</span>Import{waiting > 0 && <span className="ib-badge">{waiting}</span>}</button>
        <button className="pill" data-action="round" onClick={() => openPopout({ kind: 'round' })}>Rounds</button>
        <SettingsMenu />
      </div>
    </header>
  );
}
