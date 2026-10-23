import { useEffect, useRef, useState } from 'react';
import { useStore, THEMES } from '../state/store';
import { chipText } from '../popouts/aiUi';

/** ⚙ Settings at the top right: the AI connector (opens the AI window) and the theme. */
export function SettingsMenu() {
  const { ai, openPopout, theme, setTheme } = useStore();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); setOpen(false); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc, true); };
  }, [open]);
  return (
    <div className="settings" ref={box}>
      <button className={`pill${open ? ' on' : ''}`} data-action="settings" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="ai-dot" data-on={ai?.provider ? 'true' : 'false'} aria-hidden="true" />⚙ Settings <span className="caret">▾</span>
      </button>
      {open && (
        <div className="set-menu" role="menu" aria-label="Settings">
          <div className="set-h">AI connector</div>
          <button className="set-row" role="menuitem" data-action="ai" onClick={() => { setOpen(false); openPopout({ kind: 'ai' }); }}>
            <span className="ai-dot" data-on={ai?.provider ? 'true' : 'false'} aria-hidden="true" />
            <span className="set-main">{chipText(ai)}</span><span className="set-go">Change →</span>
          </button>
          <div className="set-h">Project</div>
          <button className="set-row" role="menuitem" data-action="config" onClick={() => { setOpen(false); openPopout({ kind: 'config' }); }}>
            <span className="set-ico" aria-hidden="true">⚙</span>
            <span className="set-main"><b>Project configuration</b><small>Your name, form and Teams links, data folder</small></span>
          </button>
          <div className="set-h">Theme</div>
          {THEMES.map((t) => (
            <button key={t.id} className={`set-row theme-row${theme === t.id ? ' on' : ''}`} role="menuitemradio" aria-checked={theme === t.id} data-theme-id={t.id} onClick={() => setTheme(t.id)}>
              <span className={`swatch sw-${t.id}`} aria-hidden="true"><i /><i /><i /></span>
              <span className="set-main"><b>{t.name}</b><small>{t.note}</small></span>
              <span className="tick">{theme === t.id ? '✓' : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
