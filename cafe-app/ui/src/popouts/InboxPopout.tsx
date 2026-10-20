import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { inboxDropFile, inboxDropText, inboxPost } from '../api';
import { Modal } from './Modal';
import { importReportLines, type ImportReport } from './titleHelpers';
import {
  applyableIds, askCandidates, canUndo, confidenceWord, dayOf, duplicateNotice, groupActions, handProblems, isAsking, itemHeadline,
  needsHand, typeWord, type ActionRecord, type InboxItemView,
} from './inboxHelpers';

const TYPE_ICON: Record<string, string> = { export: '▦', email: '✉', transcript: '☰', document: '▤', note: '✎', unknown: '◇' };

/**
 * The Inbox: drop anything, the app sorts it. Everything dropped is data, never instructions:
 * the AI's words (summary, answers, flags, names) are rendered as text and nothing else.
 */
export function InboxPopout() {
  const { state, inbox, refreshInbox, refresh, closePopout, openPopout, select, notice, setNotice } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [paste, setPaste] = useState('');
  const [dupes, setDupes] = useState<Record<string, string>>({});
  const [showDismissed, setShowDismissed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const slow = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { setNotice(null); void refreshInbox(); return () => { if (slow.current) clearTimeout(slow.current); }; }, [setNotice, refreshInbox]);

  const items: InboxItemView[] = inbox?.items ?? [];
  const shown = items.filter((i) => showDismissed || i.status !== 'dismissed');
  const dismissedN = items.length - items.filter((i) => i.status !== 'dismissed').length;
  const ideaTitle = (id: string) => state?.ideas?.find((i: any) => i.id === id)?.title ?? '';

  /** Runs one inbox call, then reads the inbox, the ideas and the universe again so new stars and links show. */
  const run = async <T,>(label: string, fn: () => Promise<T>, ok?: (r: T) => string | null) => {
    if (busy) return;
    setBusy(label);
    try {
      const r = await fn();
      const text = ok?.(r);
      setNotice(text ? { text, kind: 'ok' } : null);
    } catch (e) { setNotice({ text: (e as Error).message, kind: 'error' }); }
    await Promise.all([refreshInbox(), refresh()]);
    setBusy(null);
  };

  /** A drop can wait on the AI for up to 90 seconds; say which part it is on. */
  const dropping = async (fn: () => Promise<any>) => {
    if (busy) return;
    setBusy('Reading…');
    slow.current = setTimeout(() => setBusy('Asking the AI… (this can take a minute)'), 1500);
    let res: any = null;
    try { res = await fn(); } catch (e) { setNotice({ text: (e as Error).message, kind: 'error' }); }
    if (slow.current) clearTimeout(slow.current);
    if (res?.item) {
      if (res.duplicate) {
        setDupes((d) => ({ ...d, [res.item.id]: duplicateNotice(res.item) }));
        setNotice({ text: `${duplicateNotice(res.item)}. Nothing was done again.`, kind: 'ok' });
      } else setNotice({ text: `${res.item.name} is in the Inbox.`, kind: 'ok' });
    }
    await Promise.all([refreshInbox(), refresh()]);
    setBusy(null);
  };
  const dropFiles = async (files: FileList | File[] | null | undefined) => {
    for (const f of [...(files ?? [])]) await dropping(() => inboxDropFile(f));
    if (input.current) input.current.value = '';
  };
  const addNote = async () => {
    const text = paste.trim();
    if (!text) return;
    await dropping(() => inboxDropText(text));
    setPaste('');
  };

  const openIdea = (id: string) => { select(`idea:${id}`); openPopout({ kind: 'idea', id }); };
  const waiting = (inbox?.counts.new ?? 0) + (inbox?.counts.ok ?? 0) + (inbox?.counts.held ?? 0);

  return (
    <Modal title={<><div className="pop-id">Inbox</div><h2>{waiting ? `${waiting} waiting on you` : 'Nothing waiting'}</h2></>}
      label="Inbox" onClose={closePopout} width={1060} height={900} className="inbox-pop">
      <div className="pop-strip ib-top">
        <div
          className={`dropzone ib-drop${over ? ' over' : ''}${busy ? ' busy' : ''}`} data-testid="inbox-drop"
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); void dropFiles(e.dataTransfer.files); }}
        >
          <div className="dz-t">{busy ?? 'Drop anything: exports, emails, transcripts, notes'}</div>
          <div className="hint">Or paste below. Everything dropped here is read as data, never as instructions. Lists of people are held, not read.</div>
          <input ref={input} type="file" multiple data-testid="inbox-file" aria-label="Choose files for the Inbox" disabled={!!busy}
            onChange={(e) => void dropFiles(e.target.files)} />
        </div>
        <div className="ib-paste">
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={2} placeholder="Paste an email, meeting notes or a quick note"
            aria-label="Paste a note" data-testid="inbox-paste" disabled={!!busy} data-autofocus />
          <button className="btn primary" data-action="add-note" disabled={!!busy || !paste.trim()} onClick={() => void addNote()}>Add note</button>
        </div>
        {notice && <div className={`pop-notice ${notice.kind ?? 'ok'}`} role="status">{notice.text}</div>}
        {(inbox?.problems.length ?? 0) > 0 && (
          <div className="problems"><div className="sg-k">Could not read</div>{inbox!.problems.map((p, i) => <div key={i} className="late">{p}</div>)}</div>
        )}
      </div>
      <div className="pop-single scroll">
        {inbox === null && <div className="hint">Reading the Inbox…</div>}
        {inbox && !shown.length && <div className="hint">Nothing dropped yet. Drop a reply, a meeting transcript or a Café export above.</div>}
        <ul className="ib-items">
          {shown.map((it) => (
            <InboxItem key={it.id} item={it} busy={!!busy} dupe={dupes[it.id]} ideaTitle={ideaTitle} openIdea={openIdea} run={run} />
          ))}
        </ul>
        {dismissedN > 0 && (
          <button className="link-btn ib-more" data-action="show-dismissed" onClick={() => setShowDismissed((v) => !v)}>
            {showDismissed ? 'Hide dismissed' : `Show dismissed (${dismissedN})`}
          </button>
        )}
      </div>
    </Modal>
  );
}

type Run = <T>(label: string, fn: () => Promise<T>, ok?: (r: T) => string | null) => Promise<void>;

function InboxItem({ item, busy, dupe, ideaTitle, openIdea, run }: {
  item: InboxItemView; busy: boolean; dupe?: string; ideaTitle: (id: string) => string; openIdea: (id: string) => void; run: Run;
}) {
  const g = groupActions(item.actions);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [sureDelete, setSureDelete] = useState(false);
  const pending = applyableIds(item.actions);
  const chosen = picked ? pending.filter((id) => picked.has(id)) : pending;
  const toggle = (id: string) => setPicked((p) => { const s = new Set(p ?? pending); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  const t = item.triage;
  const held = item.status === 'held';
  const asking = isAsking(item);
  const hand = needsHand(item);
  const matched = !held && !asking && t?.ideaId ? t.ideaId : null;
  const conf = t && !t.export && !held ? confidenceWord(t.confidence) : null;
  const apply = (ids: string[]) => run('Applying…', () => inboxPost(item.id, 'apply', { actionIds: ids }), () => `Applied ${ids.length === 1 ? 'one change' : `${ids.length} changes`}.`);

  return (
    <li className={`ib-item st-${item.status}`} data-item={item.id} data-status={item.status}>
      <div className="ib-r1">
        <span className="ib-type" title={item.name}><span aria-hidden="true">{TYPE_ICON[item.type] ?? '◇'}</span> {typeWord(item.type)}</span>
        <span className="ib-head">{itemHeadline(item)}</span>
        <span className="ib-when">{dayOf(item.receivedAt)}</span>
        {!held && item.status !== 'dismissed' && (
          <button className="btn sm ghost" data-action="dismiss" disabled={busy} title="Hide it from the Inbox; nothing is undone"
            onClick={() => void run('Dismissing…', () => inboxPost(item.id, 'dismiss'), () => `${item.name} dismissed.`)}>Dismiss</button>
        )}
        {item.status === 'dismissed' && <span className="st st-sent">Dismissed</span>}
      </div>
      <div className="ib-r2">
        <span className="ib-file">{item.name}</span>
        {matched && (
          <>
            <span className="ib-for">for</span>
            <button className="ib-idea" data-action="open-idea" title="Open the idea" onClick={() => openIdea(matched)}>
              <span className="iid">{matched}</span>{ideaTitle(matched)}
            </button>
          </>
        )}
        {conf && !asking && <span className={`ib-conf c-${conf}`} title="How sure the app is about the idea">{conf}</span>}
        {hand && <span className="ib-hand" data-testid="needs-hand">Working by hand</span>}
        {dupe && <span className="ib-dupe">{dupe}</span>}
      </div>

      {hand && handProblems(item).length > 0 && (
        <ul className="ib-problems">{handProblems(item).map((p, i) => <li key={i}>{p}</li>)}</ul>
      )}

      {asking && (
        <div className="ib-ask" data-testid="which-idea">
          <div className="ib-g-h"><span className="ib-g-k">Which idea?</span><span className="hint">The app couldn't tell which idea this belongs to. Pick one and it carries on.</span></div>
          <div className="ib-cands">
            {askCandidates(item).map((c) => (
              <button key={c.id} className="btn sm" data-action="choose" data-idea={c.id} disabled={busy}
                onClick={() => void run('Asking the AI…', () => inboxPost(item.id, 'choose', { ideaId: c.id }), () => `Filed under ${c.id}.`)}>
                <span className="iid">{c.id}</span>{c.title}{t?.suggested === c.id && <em className="ib-guess"> · best guess</em>}
              </button>
            ))}
            {!askCandidates(item).length && <span className="hint">No idea looks close. Dismiss it, or add the idea first.</span>}
          </div>
        </div>
      )}

      {g.applied.length + g.undone.length > 0 && (
        <section className="ib-group g-applied" data-group="applied">
          <div className="ib-g-h"><span className="ib-g-k">Applied</span><span className="sec-n">{g.applied.length}</span></div>
          <ul>
            {g.applied.map((r) => (
              <li key={r.id} data-record={r.id}>
                <div className="ib-act">
                  <span className="ib-lbl">{r.label}</span>
                  {canUndo(r) && (
                    <button className="btn sm" data-action="undo" disabled={busy}
                      onClick={() => void run('Undoing…', () => inboxPost(item.id, 'undo', { recordId: r.id }), () => 'Undone.')}>Undo</button>
                  )}
                </div>
                <ImportLines r={r} />
              </li>
            ))}
            {g.undone.map((r) => (
              <li key={r.id} data-record={r.id} className="undone"><div className="ib-act"><span className="ib-lbl">{r.label}</span><span className="ib-undone">Undone</span></div></li>
            ))}
          </ul>
        </section>
      )}

      {g.ok.length > 0 && (
        <section className="ib-group g-ok" data-group="ok">
          <div className="ib-g-h">
            <span className="ib-g-k">Needs your OK</span><span className="sec-n">{g.ok.length}</span>
            {g.ok.length > 1 && (
              <button className="btn primary sm ib-all" data-action="apply-all" disabled={busy || !chosen.length} onClick={() => void apply(chosen)}>
                {chosen.length === pending.length ? 'Apply all' : `Apply ${chosen.length} selected`}
              </button>
            )}
          </div>
          <ul>
            {g.ok.map((r) => (
              <li key={r.id} data-record={r.id} className={r.status === 'failed' ? 'failed' : ''}>
                <div className="ib-act">
                  {g.ok.length > 1 && (
                    <input type="checkbox" aria-label={`Include: ${r.label}`} checked={chosen.includes(r.id)} onChange={() => toggle(r.id)} disabled={busy} />
                  )}
                  <span className="ib-lbl">{r.label}</span>
                  <button className="btn primary sm" data-action="apply" disabled={busy} onClick={() => void apply([r.id])}>{r.status === 'failed' ? 'Try again' : 'Apply'}</button>
                </div>
                {r.error && <div className="ib-err">Didn't work: {r.error}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {held && (
        <section className="ib-group g-held" data-group="held">
          <div className="ib-g-h"><span className="ib-g-k">Held</span><span className="hint">Not read further and never copied into an idea.</span></div>
          <ul className="ib-reasons">{(item.hold?.reasons ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul>
          <div className="ib-held-acts">
            <button className="btn sm" data-action="draft-held-reply" disabled={busy}
              onClick={() => void run('Drafting…', () => inboxPost(item.id, 'draft-held-reply'), (r: any) => `${r.email?.template ?? 'PD'} drafted in the Outbox.`)}>Draft reply asking for counts</button>
            {!sureDelete
              ? <button className="btn sm danger" data-action="delete" disabled={busy} onClick={() => setSureDelete(true)}>Delete</button>
              : (
                <>
                  <span className="ib-sure">Delete the file for good?</span>
                  <button className="btn sm danger on" data-action="delete-yes" disabled={busy}
                    onClick={() => void run('Deleting…', () => inboxPost(item.id, 'delete'), () => `${item.name} deleted.`)}>Yes, delete</button>
                  <button className="btn sm" data-action="delete-no" onClick={() => setSureDelete(false)}>Keep it</button>
                </>
              )}
          </div>
        </section>
      )}
    </li>
  );
}

/** What an import did, under its Applied line. */
function ImportLines({ r }: { r: ActionRecord }) {
  if (r.action.t !== 'import_export' || !r.result) return null;
  const lines = importReportLines(r.result as ImportReport);
  return <ul className="report ib-report">{lines.slice(0, 8).map((l, i) => <li key={i} className={`rp-${l.kind}`}>{l.text}</li>)}</ul>;
}
