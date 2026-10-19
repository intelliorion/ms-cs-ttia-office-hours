import { useStore, type Popout } from '../state/store';

const BUTTONS: { label: string; action: string; popout?: Exclude<Popout, null> }[] = [
  { label: 'Import', action: 'import', popout: { kind: 'import' } },
  { label: 'Round', action: 'round', popout: { kind: 'round' } },
  { label: 'Outbox', action: 'outbox', popout: { kind: 'outbox' } },
  { label: 'AI', action: 'ai', popout: { kind: 'ai' } },
  { label: 'Refresh', action: 'refresh' },
  { label: 'Help', action: 'help' },
];

export function TitleBar() {
  const { openPopout, refresh, setNotice, state } = useStore();
  const click = (b: (typeof BUTTONS)[number]) => {
    if (b.popout) openPopout(b.popout);
    else if (b.action === 'refresh') void refresh();
    else setNotice({ text: 'The operator sets every stage; the app never sends email.' });
  };
  return (
    <header className="titlebar">
      <div><span className="name">Creators' Café</span><span className="sub">Operator console{state ? ` · ${state.today}` : ''}</span></div>
      <div className="btns">
        {BUTTONS.map((b) => <button key={b.action} className="pill" data-action={b.action} onClick={() => click(b)}>{b.label}</button>)}
      </div>
    </header>
  );
}
