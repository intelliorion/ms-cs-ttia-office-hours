import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useChat } from '../state/chat';
import { NODE_COLOURS } from '../universe/graphView';
import { NODE_LABELS } from '../../../src/graph/ontology';
import { inboxCount } from '../popouts/inboxHelpers';
import {
  KIND_WORD, STATUS_WORD, canUndo, chipSegments, insertMention, mentionQuery, searchStars, slashMatches, suggestionsFor, waitingCount,
  type ChatEntryView, type SlashCmd, type StarHit,
} from './commandHelpers';

/** What "this" means: the idea open on the left, else the star clicked in the universe. */
function useFocus() {
  const { leftView, selectedId, graph } = useStore();
  const id = leftView.kind === 'idea' ? `idea:${leftView.id}` : selectedId;
  const node = id ? graph?.nodes.find((n: any) => n.id === id) : undefined;
  return node ? { id: node.id as string, label: node.label as string, type: node.type as string } : null;
}

/** The title-bar AI button: opens the assistant (also Ctrl/⌘+K), counts the changes waiting, and clears a highlight. */
export function AssistantLauncher() {
  const { open, setOpen, entries } = useChat();
  const { highlight, setHighlight } = useStore();
  const waiting = waitingCount(entries);
  const mac = /Mac/i.test(typeof navigator !== 'undefined' ? navigator.platform : '');
  return (
    <>
      {highlight && (
        <button className="cmd-lit" data-action="command-clear-lit" title="Clear the highlight" onClick={() => setHighlight(null)}>
          {highlight.length} star{highlight.length === 1 ? '' : 's'} lit <span aria-hidden="true">✕</span>
        </button>
      )}
      <button className={`pill ai-pill${open ? ' on' : ''}`} data-action="assistant-open" aria-expanded={open}
        title={`Café assistant (${mac ? '⌘K' : 'Ctrl+K'}): ask about the programme, or tell it what to change`} onClick={() => setOpen(!open)}>
        <span className="cmd-spark" aria-hidden="true">✦</span>AI{waiting > 0 && <span className="cmd-badge" title="Changes waiting for you">{waiting}</span>}
      </button>
    </>
  );
}

/**
 * The Café assistant, docked on the right while open. A conversation keeps its context; each message is worked in
 * steps over the knowledge graph (live as they happen); answers light their stars; changes wait for Do it.
 */
export function Assistant() {
  const chat = useChat();
  const { graph, select, hover, setHighlight, openPopout, refresh, inbox } = useStore();
  const focus = useFocus();
  const list = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);

  useEffect(() => { void useChat.getState().load(); }, []);
  // Ctrl/⌘+K opens or closes the assistant from anywhere.
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); useChat.getState().toggle(); } };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, []);
  useEffect(() => { list.current?.scrollTo?.({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [chat.entries.length, chat.running?.steps.length, chat.running, chat.open]);

  const stars = useMemo(() => (graph?.nodes ?? []).map((n: any) => ({ id: n.id as string, label: n.label as string })), [graph]);
  const typeOf = useMemo(() => new Map<string, string>((graph?.nodes ?? []).map((n: any) => [n.id, n.type])), [graph]);
  const send = async (m: { text: string; mentions?: string[]; noFocus?: boolean }) => {
    setHighlight(null);
    const e = await chat.send({ text: m.text, focus: m.noFocus ? null : focus?.id, about: m.noFocus ? undefined : focus?.label, mentions: m.mentions });
    if (e?.highlight?.length) setHighlight(e.highlight);
  };
  const act = async (id: string, what: 'do' | 'cancel' | 'undo', actionId?: string) => {
    const e = await chat.act(id, what, actionId);
    if (e && what !== 'cancel') void refresh();
  };
  const slash = (cmd: SlashCmd) => {
    if (cmd === '/new') { chat.newChat(); setHighlight(null); }
    else if (cmd === '/grow') void send({ text: 'grow it' });
    else if (cmd === '/import') openPopout({ kind: 'inbox' });
    else if (cmd === '/rounds') openPopout({ kind: 'round' });
    else if (cmd === '/undo') {
      const last = [...chat.entries].reverse().flatMap((e) => [...e.actions].reverse().filter(canUndo).map((a) => ({ e, a })))[0];
      if (last) void act(last.e.id, 'undo', last.a.id);
    }
  };
  if (!chat.open) return null;

  /** Text with every star name as a chip: hover lights the star, click flies to it. */
  const chips = (text: string) => chipSegments(text, stars).map((s, i) => (typeof s === 'string' ? <span key={i}>{s}</span> : (
    <button key={i} className="star-chip" data-star={s.id} onMouseEnter={() => hover(s.id)} onMouseLeave={() => hover(null)} onClick={() => select(s.id)}>
      <span className="dot" style={{ background: (NODE_COLOURS as Record<string, string>)[typeOf.get(s.id) ?? ''] ?? '#9fb0ae' }} />{s.label}
    </button>
  )));

  return (
    <section className="panel assistant abs" role="complementary" aria-label="Café assistant" data-testid="assistant">
      <header className="as-head">
        <div className="as-title"><span className="cmd-spark" aria-hidden="true">✦</span> Café assistant
          {chat.thread && <span className="as-thread" title={chat.thread.title}>{chat.thread.title}</span>}
        </div>
        <div className="as-tools">
          <button className="as-btn" data-action="assistant-new" title="New chat" onClick={() => { chat.newChat(); setHighlight(null); }}>New chat</button>
          <button className="as-btn" data-action="assistant-history" aria-expanded={menu} title="Earlier chats" onClick={() => setMenu(!menu)}>⋯</button>
          <button className="x" aria-label="Close the assistant" onClick={() => chat.setOpen(false)}>✕</button>
        </div>
        {menu && (
          <ul className="as-menu" role="menu" data-testid="assistant-threads">
            {chat.threads.length === 0 && <li className="hint">No earlier chats yet.</li>}
            {chat.threads.map((t) => (
              <li key={t.id}><button role="menuitem" className={chat.thread?.id === t.id ? 'on' : ''} onClick={() => { setMenu(false); setHighlight(null); void chat.openThread(t.id); }}>
                <span className="as-mt">{t.title}</span><span className="as-mm">{t.count} message{t.count === 1 ? '' : 's'} · {ago(t.updated)}</span>
              </button></li>
            ))}
          </ul>
        )}
      </header>

      <div className="as-list" ref={list}>
        {!chat.entries.length && !chat.running && (
          <div className="as-empty">
            <div className="as-hello">Ask about the programme, or tell me what to change.</div>
            <div className="as-sub">I search the knowledge graph for every answer, and nothing changes until you press Do it.</div>
            <div className="as-sugg">
              {suggestionsFor({ focusType: focus?.type, waiting: inboxCount(inbox?.counts) }).filter((s) => !s.includes('…')).map((s) => (
                <button key={s} className="cmd-eg" onClick={() => void send({ text: s })}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {chat.entries.map((e) => (
          <Message key={e.id} e={e} chips={chips} busy={chat.busy || !!chat.running} onAct={act} onSend={(t) => void send({ text: t })}
            onRetry={() => void send({ text: e.text })} onLight={(ids) => setHighlight(ids)} />
        ))}
        {chat.running && (
          <div className="as-msg">
            <div className="cmd-me">{chat.running.about && <span className="cmd-me-about">About {chat.running.about}</span>}{chips(chat.running.text)}</div>
            <div className="cmd-ai who-ai" data-testid="command-thinking">
              <Steps steps={chat.running.steps} />
              <div className="as-live" role="status">
                <span className="ib-orb" aria-hidden="true"><i /><b /></span>
                <span>{chat.running.steps.length ? 'Looking at what that found…' : 'Reading your message…'}</span>
              </div>
            </div>
          </div>
        )}
        {chat.error && <div className="cmd-err" role="status">{chat.error}</div>}
      </div>

      <Composer focus={focus} onSend={send} onSlash={slash} />
      <div className="cmd-foot">Names the Café knows are coded before the AI sees them. Nothing changes until you press Do it.</div>
    </section>
  );
}

function Steps({ steps }: { steps?: { kind: 'search' | 'read'; text: string; found?: number }[] }) {
  if (!steps?.length) return null;
  return (
    <ol className="as-steps" data-testid="assistant-steps">
      {steps.map((s, i) => (
        <li key={i}><span className="as-tick" aria-hidden="true">{s.kind === 'read' ? '◧' : '⌕'}</span><span>{s.text}</span>{s.found !== undefined && <b>{s.found} found</b>}</li>
      ))}
    </ol>
  );
}

function Message({ e, chips, busy, onAct, onSend, onRetry, onLight }: {
  e: ChatEntryView; chips: (text: string) => React.ReactNode; busy: boolean;
  onAct: (id: string, what: 'do' | 'cancel' | 'undo', actionId?: string) => void; onSend: (t: string) => void; onRetry: () => void; onLight: (ids: string[]) => void;
}) {
  const { highlight, setHighlight } = useStore();
  const lit = !!highlight && !!e.highlight?.length && highlight.length === e.highlight.length && highlight.every((x, i) => x === e.highlight![i]);
  return (
    <div className="as-msg cmd-entry" data-entry={e.id}>
      <div className="cmd-me">{e.about && <span className="cmd-me-about">About {e.about}</span>}{chips(e.text)}</div>
      <div className={`cmd-ai k-${e.kind ?? 'command'}`}>
        {e.kind && <div className="cmd-kind">{KIND_WORD[e.kind]}</div>}
        <Steps steps={e.steps} />
        {e.error ? <div className="cmd-err">{e.error} <button className="link-btn" data-action="assistant-retry" onClick={onRetry}>Retry</button></div>
          : e.reply && <div className="cmd-reply">{chips(e.reply)}</div>}
        {e.problems.map((p, i) => <div key={i} className="cmd-problem">{p}</div>)}
        {e.actions.map((a) => (
          <div key={a.id} className={`cmd-card s-${a.status}`} data-action-id={a.id}>
            <div className="cmd-card-l">
              <div className="cmd-card-t">{a.label}</div>
              <div className="cmd-card-s">{STATUS_WORD[a.status]}{a.note ? ` · ${a.note}` : ''}</div>
            </div>
            {a.status === 'proposed' && <>
              <button className="btn primary sm" data-action="command-do" disabled={busy} onClick={() => onAct(e.id, 'do', a.id)}>Do it</button>
              <button className="btn sm" data-action="command-cancel" disabled={busy} onClick={() => onAct(e.id, 'cancel', a.id)}>Cancel</button>
            </>}
            {canUndo(a) && <button className="btn sm" data-action="command-undo" disabled={busy} onClick={() => onAct(e.id, 'undo', a.id)}>Undo</button>}
          </div>
        ))}
        {e.actions.filter((a) => a.status === 'proposed').length > 1 && (
          <button className="btn primary sm cmd-all" data-action="command-do-all" disabled={busy} onClick={() => onAct(e.id, 'do')}>Do all</button>
        )}
        {(e.highlight?.length ?? 0) > 0 && (
          <div className="cmd-lit-note">{e.highlight!.length} star{e.highlight!.length === 1 ? '' : 's'} {lit ? 'lit in the universe' : 'found'}
            {lit ? <button className="link-btn" onClick={() => setHighlight(null)}>Clear</button> : <button className="link-btn" data-action="assistant-light" onClick={() => onLight(e.highlight!)}>Light them</button>}
          </div>
        )}
        {(e.trace?.length ?? 0) > 0 && (
          <details className="cmd-trace" data-testid="command-trace">
            <summary>How I found it in the graph</summary>
            {e.trace!.map((steps, qi) => <ol key={qi}>{steps.map((st, si) => <li key={si}><span>{st.text}</span><b>{st.size}</b></li>)}</ol>)}
          </details>
        )}
        {(e.followups?.length ?? 0) > 0 && (
          <div className="as-follow" data-testid="assistant-followups">
            {e.followups!.map((f) => <button key={f} className="cmd-eg" disabled={busy} onClick={() => onSend(f)}>{f}</button>)}
          </div>
        )}
      </div>
    </div>
  );
}

/** The box to type in: grows to four lines, @ picks a star (narrow with @idea:, @person:…), / offers shortcuts, ↑ brings back the last message. */
function Composer({ focus, onSend, onSlash }: {
  focus: { id: string; label: string } | null;
  onSend: (m: { text: string; mentions?: string[]; noFocus?: boolean }) => Promise<void>;
  onSlash: (cmd: SlashCmd) => void;
}) {
  const chat = useChat();
  const { graph } = useStore();
  const [text, setText] = useState('');
  const [at, setAt] = useState<{ start: number; query: string } | null>(null);
  const [hi, setHi] = useState(0);
  const [mentions, setMentions] = useState<StarHit[]>([]);
  const [noFocus, setNoFocus] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const caretTo = useRef<number | null>(null);
  useEffect(() => { setNoFocus(false); }, [focus?.id]);
  useEffect(() => { box.current?.focus(); }, [chat.focusNonce]);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 4 * 22 + 16)}px`;
    if (caretTo.current !== null) { el.focus(); el.setSelectionRange(caretTo.current, caretTo.current); caretTo.current = null; }
  }, [text]);

  const hits = at && graph ? searchStars(graph.nodes, at.query) : [];
  const slashes = !at ? slashMatches(text) : [];
  const menuLen = hits.length || slashes.length;
  const pick = (h: StarHit) => {
    if (!at || !box.current) return;
    const next = insertMention(text, at.start, box.current.selectionStart ?? text.length, h.label);
    caretTo.current = next.caret;
    setText(next.text); setAt(null); setHi(0);
    setMentions((ms) => (ms.some((m) => m.id === h.id) ? ms : [...ms, h]));
  };
  const submit = async () => {
    const t = text.trim();
    if (!t || chat.running) return;
    const exact = slashMatches(t).find((s) => s.cmd === t.toLowerCase());
    if (exact) { setText(''); onSlash(exact.cmd); return; }
    const ids = mentions.filter((m) => t.includes(`@${m.label}`)).map((m) => m.id);
    setText(''); setMentions([]); setAt(null);
    await onSend({ text: t, mentions: ids, noFocus });
  };
  const lastMine = [...chat.entries].reverse()[0]?.text;

  return (
    <div className="as-compose">
      {hits.length > 0 && (
        <ul className="cmd-mentions" role="listbox" aria-label="Stars" data-testid="command-mentions">
          {hits.map((h, i) => (
            <li key={h.id} role="option" aria-selected={i === hi} className={i === hi ? 'on' : ''}
              onMouseDown={(e) => { e.preventDefault(); pick(h); }} onMouseEnter={() => setHi(i)}>
              <span className="dot" style={{ background: (NODE_COLOURS as Record<string, string>)[h.type] ?? '#9fb0ae' }} />
              <span className="cm-l">{h.label}</span>
              <span className="cm-t">{NODE_LABELS[h.type as keyof typeof NODE_LABELS] ?? h.type}</span>
            </li>
          ))}
        </ul>
      )}
      {slashes.length > 0 && (
        <ul className="cmd-mentions" role="listbox" aria-label="Shortcuts" data-testid="command-slash">
          {slashes.map((s, i) => (
            <li key={s.cmd} role="option" aria-selected={i === hi} className={i === hi ? 'on' : ''}
              onMouseDown={(e) => { e.preventDefault(); setText(''); onSlash(s.cmd); }} onMouseEnter={() => setHi(i)}>
              <span className="cm-l"><b>{s.cmd}</b></span><span className="cm-t cm-hint">{s.hint}</span>
            </li>
          ))}
        </ul>
      )}
      {focus && !noFocus && (
        <div className="as-about"><span className="cmd-about" data-testid="assistant-about">About: {focus.label}</span>
          <button className="as-x" aria-label="Ask in general instead" title="Ask in general instead" onClick={() => setNoFocus(true)}>✕</button>
        </div>
      )}
      <div className="as-box">
        <textarea ref={box} value={text} rows={1} placeholder="Message the Café… (@ a star, / for shortcuts)" aria-label="Message" data-testid="command-input" maxLength={600}
          onChange={(e) => { setText(e.target.value); setAt(mentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length)); setHi(0); }}
          onKeyDown={(e) => {
            if (menuLen) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi((i) => (i + 1) % menuLen); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => (i - 1 + menuLen) % menuLen); return; }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                if (hits.length) pick(hits[hi] ?? hits[0]); else { setText(''); onSlash((slashes[hi] ?? slashes[0]).cmd); }
                return;
              }
              if (e.key === 'Escape') { e.preventDefault(); setAt(null); if (slashes.length) setText(''); return; }
            }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); return; }
            if (e.key === 'ArrowUp' && !text && lastMine) { e.preventDefault(); setText(lastMine); return; }
            if (e.key === 'Escape') { e.preventDefault(); chat.setOpen(false); }
          }} />
        {chat.running
          ? <button className="cmd-send stop" data-action="assistant-stop" aria-label="Stop" title="Stop" onClick={() => chat.stop()}>■</button>
          : <button className="cmd-send" data-action="command-send" aria-label="Send" disabled={!text.trim()} onClick={() => void submit()}>↵</button>}
      </div>
    </div>
  );
}

function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}
