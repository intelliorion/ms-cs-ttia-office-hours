import { Fragment, useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { inboxDropFile, inboxDropText } from '../api';
import { Modal } from './Modal';
import { InboxCard, TYPE_ICON, type Note, type Run } from './InboxCard';
import {
  CHIPS, byYou, duplicateNotice, dropSummary, filterItems, groupByDay, inFlight, isRunning, needsYou, resultLine, shouldPoll, statusWord,
  timeOf, tooLargeNotice, type Chip, type DropOutcome, type InboxItemView,
} from './inboxHelpers';

/** "CAFE-2026-001", or for an export what it made. */
function rowIdea(i: InboxItemView): string {
  if (i.triage?.export || i.type === 'export') {
    const made = (i.actions ?? []).find((a) => a.action?.t === 'import_export' && a.status === 'applied')?.result as { created?: unknown[] } | undefined;
    return made?.created ? `export: ${made.created.length} idea${made.created.length === 1 ? '' : 's'}` : 'export';
  }
  return i.triage?.ideaId ?? '';
}

/**
 * The Import, in three zones: the drop well, the items in flight (running or waiting on the operator),
 * and the full history. Everything dropped is data, never instructions: the AI's words are rendered as text only.
 */
export function InboxPopout() {
  const { openPopout, state, inbox, refreshInbox, refresh, closePopout, openIdea, notice, setNotice } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const going = useRef(false); // set at once, so a second click in the same tick cannot start a second call
  const [over, setOver] = useState(false);
  const [paste, setPaste] = useState('');
  const [dupes, setDupes] = useState<Record<string, string>>({});
  const [chip, setChip] = useState<Chip>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const dropPoll = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    setNotice(null); void refreshInbox();
    return () => { if (dropPoll.current) clearInterval(dropPoll.current); };
  }, [setNotice, refreshInbox]);

  // Live steps: read the Import every second while any step runs; when the run ends, read the universe once.
  const polling = shouldPoll(inbox);
  useEffect(() => {
    if (!polling) return;
    const t = setInterval(() => { void refreshInbox(); }, 1000);
    return () => clearInterval(t);
  }, [polling, refreshInbox]);
  const wasPolling = useRef(false);
  useEffect(() => { if (wasPolling.current && !polling) void refresh(); wasPolling.current = polling; }, [polling, refresh]);

  const items: InboxItemView[] = inbox?.items ?? [];
  const flight = items.filter(inFlight).sort((a, b) => (b.receivedAt ?? '').localeCompare(a.receivedAt ?? ''));
  const ideaTitle = (id: string) => state?.ideas?.find((i: any) => i.id === id)?.title ?? '';
  const days = groupByDay(filterItems(items, chip, q, ideaTitle));
  const counts = {
    processed: items.filter((i) => !isRunning(i)).length,
    you: items.filter(needsYou).length,
    held: items.filter((i) => i.status === 'held').length,
  };

  /** Runs one inbox call, then reads the inbox, the ideas and the universe again so new stars and links show. */
  const run: Run = async (label, fn, ok, say) => {
    if (going.current) return;
    going.current = true;
    setBusy(label);
    const tell = say ?? ((n: Note | null) => setNotice(n));
    try {
      const r = await fn();
      const text = ok?.(r);
      tell(text ? { text, kind: 'ok' } : null);
    } catch (e) { tell({ text: (e as Error).message, kind: 'error' }); }
    try { await Promise.all([refreshInbox(), refresh()]); } finally { going.current = false; setBusy(null); }
  };

  /** One drop. The Import is read every 400 ms until the request comes back, so the card shows its steps while the server runs them. */
  const dropping = async (name: string, fn: () => Promise<any>): Promise<DropOutcome | null> => {
    if (going.current) return null;
    going.current = true;
    setBusy('Reading…');
    let out: DropOutcome;
    if (dropPoll.current) clearInterval(dropPoll.current);
    dropPoll.current = setInterval(() => { void refreshInbox(); }, 400);
    try {
      const res = await fn();
      if (res?.duplicate && res.item) {
        setDupes((d) => ({ ...d, [res.item.id]: duplicateNotice(res.item) }));
        out = { kind: 'duplicate', name: res.item.name, text: duplicateNotice(res.item) };
      } else out = { kind: 'added', name: res?.item?.name ?? name };
      // Show what happened: a finished item has no card in flight, so open its history row.
      if (res?.item?.id && !inFlight(res.item)) setOpen(res.item.id);
    } catch (e) { out = { kind: 'failed', name, text: (e as Error).message }; }
    finally { if (dropPoll.current) { clearInterval(dropPoll.current); dropPoll.current = null; } }
    try { await Promise.all([refreshInbox(), refresh()]); } finally { going.current = false; setBusy(null); }
    return out;
  };
  /** Any drop on the pop-out or its backdrop is read here; the window listener below stops the browser opening the file. */
  const onDropAnywhere = (e: { preventDefault: () => void; dataTransfer: DataTransfer | null }) => {
    e.preventDefault(); setOver(false);
    if (going.current) { setNotice({ text: 'Wait for the current item to finish.', kind: 'error' }); return; }
    void dropFiles(e.dataTransfer?.files);
  };
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setOver(false); };
    window.addEventListener('dragover', stop); window.addEventListener('drop', stop); window.addEventListener('dragleave', leave);
    return () => { window.removeEventListener('dragover', stop); window.removeEventListener('drop', stop); window.removeEventListener('dragleave', leave); };
  }, []);
  const dropFiles = async (files: FileList | File[] | null | undefined) => {
    const outcomes: DropOutcome[] = [];
    for (const f of [...(files ?? [])]) {
      const big = tooLargeNotice(f);
      if (big) { outcomes.push({ kind: 'too-large', name: f.name, text: big }); continue; }
      const out = await dropping(f.name, () => inboxDropFile(f));
      if (out) outcomes.push(out);
    }
    setNotice(dropSummary(outcomes));
    if (input.current) input.current.value = '';
  };
  const addNote = async () => {
    const text = paste.trim();
    if (!text) return;
    const out = await dropping('Your note', () => inboxDropText(text));
    if (out) setNotice(dropSummary([out]));
    setPaste('');
  };

  const waiting = (inbox?.counts.new ?? 0) + (inbox?.counts.ok ?? 0) + (inbox?.counts.held ?? 0);
  const card = (it: InboxItemView, expanded = false) => (
    <InboxCard key={it.id} item={it} busy={!!busy} dupe={dupes[it.id]} ideaTitle={ideaTitle} openIdea={openIdea} run={run} expanded={expanded} />
  );

  return (
    <Modal title={<><div className="pop-id">Import</div><h2>{waiting ? `${waiting} waiting on you` : 'Nothing waiting'}</h2></>}
      label="Import" onClose={closePopout} width={1120} height={940} className="inbox-pop"
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDrop={onDropAnywhere}>
      <div className="ib-body scroll">
        {/* Zone 1: the drop well */}
        <div className={`ib-well${over ? ' over' : ''}${busy ? ' busy' : ''}`} data-testid="inbox-drop">
          {(busy || polling) && <div className="ib-progress" aria-hidden="true" />}
          <div className="ib-well-l">
            <div className="dz-t">{over ? 'Let go to drop' : 'Drop anything'}</div>
            <div className="hint">Café form exports, emails, transcripts, meeting notes. Read as data, never as instructions; lists of people are held.</div>
            {busy && <div className="ib-busy" role="status">{busy}</div>}
          </div>
          <div className="ib-well-r">
            <input ref={input} type="file" multiple data-testid="inbox-file" aria-label="Choose files to import" disabled={!!busy}
              onChange={(e) => void dropFiles(e.target.files)} />
            <div className="ib-paste">
              <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={1} placeholder="Paste an email or a quick note"
                aria-label="Paste a note" data-testid="inbox-paste" disabled={!!busy} data-autofocus />
              <button className="btn primary sm" data-action="add-note" disabled={!!busy || !paste.trim()} onClick={() => void addNote()}>Add note</button>
            </div>
          </div>
          <div className="ib-under">
            <span>A form export imports its ideas; for a line-by-line report use <button className="link-btn" data-action="import" onClick={() => openPopout({ kind: 'import' })}>Import with a report</button></span>
            <span className="ib-counts" data-testid="inbox-counts"><b>{counts.processed}</b> processed · <b className={counts.you ? 'hot' : ''}>{counts.you}</b> need you · <b className={counts.held ? 'hot' : ''}>{counts.held}</b> held</span>
          </div>
        </div>
        {notice && <div className={`pop-notice ${notice.kind ?? 'ok'}`} role="status">{notice.text}</div>}
        {(inbox?.problems.length ?? 0) > 0 && (
          <div className="problems"><div className="sg-k">Could not read</div>{inbox!.problems.map((p, i) => <div key={i} className="late">{p}</div>)}</div>
        )}

        {/* Zone 2: in flight and needs you */}
        {flight.length > 0 && (
          <section className="ib-zone">
            <div className="ib-zone-h"><span className="ib-g-k">In flight</span><span className="sec-n">{flight.length}</span></div>
            <ul className="ib-items ib-flight">{flight.map((it) => card(it))}</ul>
          </section>
        )}

        {/* Zone 3: the history */}
        <section className="ib-zone ib-history">
          <div className="ib-zone-h">
            <span className="ib-g-k">History</span>
            <div className="ib-chips" role="group" aria-label="Filter the history">
              {CHIPS.map((c) => (
                <button key={c.id} className={`chip${chip === c.id ? ' on' : ''}`} data-chip={c.id} aria-pressed={chip === c.id} onClick={() => setChip(c.id)}>{c.label}</button>
              ))}
            </div>
            <input className="search ib-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or idea" aria-label="Search the history" />
          </div>
          {inbox === null && <div className="hint">Reading the imports…</div>}
          {inbox && !items.length && <div className="hint">Nothing dropped yet. Drop a reply, a meeting transcript or a Café export above.</div>}
          {inbox && items.length > 0 && !days.length && <div className="hint">Nothing matches.</div>}
          {days.map((d) => (
            <Fragment key={d.label}>
              <div className="ib-day">{d.label}</div>
              <ul className="ib-rows">
                {d.items.map((it) => {
                  const sw = statusWord(it);
                  const isOpen = open === it.id;
                  return (
                    <li key={it.id} className={isOpen ? 'open' : ''}>
                      <button className={`ib-row st-${it.status}`} data-row={it.id} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : it.id)}>
                        <span className="ic" aria-hidden="true">{TYPE_ICON[it.status === 'held' ? 'unknown' : it.type] ?? '◇'}</span>
                        <span className="nm">{it.name}</span>
                        <span className="tm">{timeOf(it.receivedAt)}</span>
                        <span className="idn">{rowIdea(it)}</span>
                        <span className="rs">{resultLine(it)}{byYou(it) && <em className="by"> · by you</em>}</span>
                        <span className={`ib-chip t-${sw.tone}`}>{sw.word}</span>
                      </button>
                      {isOpen && <ul className="ib-items ib-open">{card(it, true)}</ul>}
                    </li>
                  );
                })}
              </ul>
            </Fragment>
          ))}
        </section>
      </div>
    </Modal>
  );
}
