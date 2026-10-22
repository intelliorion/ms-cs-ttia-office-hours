import { useEffect, useRef, useState } from 'react';
import { chatPost, chatSend, getChat } from '../api';
import { useStore } from '../state/store';
import { EXAMPLES, STATUS_WORD, canUndo, waitingCount, type ChatEntryView } from './commandHelpers';

/**
 * The command bar: the operator tells the Café what to do in their own words. The AI reads the command with every
 * name the app knows replaced by a code, proposes actions, and the app checks them; nothing changes until "Do it".
 * The agent keeps no conversation, so the panel shows only the current command: a new one replaces it.
 */
export function CommandBar() {
  const { refresh, ai } = useStore();
  const [current, setCurrent] = useState<ChatEntryView | null>(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [thinking, setThinking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // After a reload, the last command comes back only while it still has something waiting for you.
  useEffect(() => { getChat().then((r) => { const last = r.entries.at(-1); if (last && waitingCount([last])) setCurrent(last); }).catch(() => {}); }, []);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!thinking && wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open, thinking]);

  const send = async () => {
    const t = text.trim();
    if (!t || thinking) return;
    setOpen(true); setThinking(t); setText(''); setError(null);
    try { setCurrent(await chatSend(t)); } catch (e) { setError((e as Error).message); setText(t); } finally { setThinking(null); }
  };
  const act = async (id: string, what: 'do' | 'cancel' | 'undo', actionId?: string) => {
    setBusy(true); setError(null);
    try { setCurrent(await chatPost(id, what, actionId)); if (what !== 'cancel') void refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const waiting = current ? waitingCount([current]) : 0;
  const entries = thinking || !current ? [] : [current];

  return (
    <div className={`cmd${open ? ' open' : ''}${thinking ? ' thinking' : ''}`} ref={wrap}>
      <div className="cmd-bar">
        <span className="cmd-spark" aria-hidden="true">✦</span>
        <input ref={input} value={text} onChange={(e) => setText(e.target.value)} onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void send(); }
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false); input.current?.blur(); }
          }}
          placeholder="Tell the Café what to do…" aria-label="Command" data-testid="command-input" maxLength={600} disabled={!!thinking} />
        {waiting > 0 && !open && <span className="cmd-badge" title="Actions waiting for you">{waiting}</span>}
        <button className="cmd-send" data-action="command-send" aria-label="Send" disabled={!text.trim() || !!thinking} onClick={() => void send()}>↵</button>
      </div>
      {open && (
        <div className="cmd-panel" role="dialog" aria-label="Command chat" data-testid="command-panel">
          <div className="cmd-list" ref={list}>
            {!current && !thinking && (
              <div className="cmd-empty">
                <div className="cmd-empty-h">Tell the Café what to do</div>
                {EXAMPLES.map((x) => <button key={x} className="cmd-eg" onClick={() => { setText(x); input.current?.focus(); }}>{x}</button>)}
              </div>
            )}
            {entries.map((e) => (
              <div key={e.id} className="cmd-entry" data-entry={e.id}>
                <div className="cmd-me">{e.text}</div>
                <div className="cmd-ai">
                  {e.error ? <div className="cmd-err">{e.error}</div> : <div className="cmd-reply">{e.reply}</div>}
                  {e.problems.map((p, i) => <div key={i} className="cmd-problem">{p}</div>)}
                  {e.actions.map((a) => (
                    <div key={a.id} className={`cmd-card s-${a.status}`} data-action-id={a.id}>
                      <div className="cmd-card-l">
                        <div className="cmd-card-t">{a.label}</div>
                        <div className="cmd-card-s">{STATUS_WORD[a.status]}{a.note ? ` · ${a.note}` : ''}</div>
                      </div>
                      {a.status === 'proposed' && <>
                        <button className="btn primary sm" data-action="command-do" disabled={busy} onClick={() => void act(e.id, 'do', a.id)}>Do it</button>
                        <button className="btn sm" data-action="command-cancel" disabled={busy} onClick={() => void act(e.id, 'cancel', a.id)}>Cancel</button>
                      </>}
                      {canUndo(a) && <button className="btn sm" data-action="command-undo" disabled={busy} onClick={() => void act(e.id, 'undo', a.id)}>Undo</button>}
                    </div>
                  ))}
                  {e.actions.filter((a) => a.status === 'proposed').length > 1 && (
                    <button className="btn primary sm cmd-all" data-action="command-do-all" disabled={busy} onClick={() => void act(e.id, 'do')}>Do all</button>
                  )}
                </div>
              </div>
            ))}
            {thinking && (
              <div className="cmd-entry">
                <div className="cmd-me">{thinking}</div>
                <div className="cmd-ai cmd-think who-ai" role="status" data-testid="command-thinking">
                  <span className="ib-orb" aria-hidden="true"><i /><b /></span>
                  <span>{ai?.provider ? `${ai.label ?? 'The AI'} is reading your command…` : 'Reading your command…'}</span>
                </div>
              </div>
            )}
          </div>
          {error && <div className="cmd-err" role="status">{error}</div>}
          <div className="cmd-foot">Names the Café knows are coded before the AI sees them. Nothing changes until you press Do it.</div>
        </div>
      )}
    </div>
  );
}
