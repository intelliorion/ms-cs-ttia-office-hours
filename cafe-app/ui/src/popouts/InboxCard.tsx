import { useState } from 'react';
import { inboxPost } from '../api';
import { useStore } from '../state/store';
import { importReportLines, type ImportReport } from './titleHelpers';
import {
  STEP_ORDER, STEP_WORDS, RULE_WORDS, stepGlyph, heldChoices, groupActions, applyableIds, canUndo, askCandidates, isAsking, typeWord, dayOf,
  confidenceWord, handProblems, needsHand, itemHeadline, type ActionRecord, type InboxItemView, type Step,
} from './inboxHelpers';

export const TYPE_ICON: Record<string, string> = { export: '▦', email: '✉', transcript: '☰', document: '▤', note: '✎', unknown: '◇' };
export type Note = { text: string; kind?: 'ok' | 'error' };
export type Run = <T>(label: string, fn: () => Promise<T>, ok?: (r: T) => string | null, say?: (n: Note | null) => void) => Promise<void>;

/** The label of the star a held proposal looks like: from the graph, else the id's slug ("capability:slot-finding" → "slot finding"). */
export function starLabel(nodes: { id: string; label?: string }[] | undefined, id: string): string {
  const n = nodes?.find((x) => x.id === id);
  if (n?.label) return n.label;
  const slug = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
  return slug.replace(/[-_]+/g, ' ');
}

const secs = (ms: number | undefined) => (ms ? `${(ms / 1000).toFixed(1)} s` : '');

/**
 * One dropped file: its eight steps, what the AI understood, what waits for the operator, and what was applied.
 * Everything the AI wrote is rendered as plain text and nothing else.
 */
export function InboxCard({ item, busy, ideaTitle, openIdea, run, expanded = false, dupe }: {
  item: InboxItemView; busy: boolean; ideaTitle: (id: string) => string; openIdea: (id: string) => void; run: Run; expanded?: boolean; dupe?: string;
}) {
  const [msg, setMsg] = useState<Note | null>(null);
  const nodes = useStore((s) => s.graph?.nodes) as { id: string; label?: string }[] | undefined;
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [sureDelete, setSureDelete] = useState(false);
  const go = <T,>(label: string, fn: () => Promise<T>, ok?: (r: T) => string | null) => run(label, fn, ok, setMsg);

  const steps = item.steps ?? [];
  const current: Step | undefined = steps.find((s) => s.status === 'running') ?? [...steps].reverse().find((s) => s.status !== 'skipped') ?? steps.at(-1);
  const g = groupActions(item.actions);
  const heldActs = (item.actions ?? []).filter((a) => a.status === 'pending' && !!a.held);
  const okActs = g.ok.filter((a) => !a.held);
  const pending = applyableIds(item.actions).filter((id) => okActs.some((a) => a.id === id));
  const chosen = picked ? pending.filter((id) => picked.has(id)) : pending;
  const toggle = (id: string) => setPicked((p) => { const s = new Set(p ?? pending); if (s.has(id)) s.delete(id); else s.add(id); return s; });

  const t = item.triage;
  const ai = t?.ai;
  const heldFile = item.status === 'held';
  const asking = isAsking(item);
  const hand = needsHand(item);
  const matched = !heldFile && !asking && t?.ideaId ? t.ideaId : null;
  const conf = t && !t.export && !heldFile ? confidenceWord(t.confidence) : null;

  const applyIds = (ids: string[]) => go('Applying…', () => inboxPost(item.id, 'apply', { actionIds: ids }), () => `Applied ${ids.length === 1 ? 'one change' : `${ids.length} changes`}.`);
  const applyHeld = (id: string, resolve?: 'use-existing' | 'take-file') =>
    go('Applying…', () => inboxPost(item.id, 'apply', { actionIds: [id], ...(resolve ? { resolve: { [id]: resolve } } : {}) }), () => 'Applied.');
  const drop = (id: string) => go('Dropping…', () => inboxPost(item.id, 'dismiss-action', { actionId: id }), () => 'Dropped.');

  return (
    <li className={`ib-card ib-item st-${item.status}${expanded ? ' open' : ''}`} data-item={item.id} data-status={item.status}>
      <div className="ib-r1">
        <span className="ib-type" title={item.name}><span aria-hidden="true">{TYPE_ICON[heldFile ? 'unknown' : item.type] ?? '◇'}</span> {typeWord(heldFile ? 'unknown' : item.type)}</span>
        <span className="ib-file">{item.name}</span>
        {matched && (
          <button className="ib-idea" data-action="open-idea" title="Open the idea" onClick={() => openIdea(matched)}>
            <span className="iid">{matched}</span>{ideaTitle(matched)}
          </button>
        )}
        <span className="ib-when">{dayOf(item.receivedAt)}</span>
        {!heldFile && item.status !== 'dismissed' && (
          <button className="btn sm ghost" data-action="dismiss" disabled={busy} title="Hide it from the Inbox; nothing is undone"
            onClick={() => void go('Dismissing…', () => inboxPost(item.id, 'dismiss'), () => `${item.name} dismissed.`)}>Dismiss</button>
        )}
        {item.status === 'dismissed' && <span className="st st-sent">Dismissed</span>}
      </div>
      <div className="ib-r2">
        <span className="ib-head">{itemHeadline(item)}</span>
        {conf && !asking && <span className={`ib-conf c-${conf}`} title="How sure the app is about the idea">{conf}</span>}
        {hand && <span className="ib-hand" data-testid="needs-hand">Working by hand</span>}
        {dupe && <span className="ib-dupe">{dupe}</span>}
      </div>

      {steps.length > 0 && (
        <>
          <ol className="ib-steps" aria-label="Steps">
            {STEP_ORDER.map((id) => {
              const s = steps.find((x) => x.id === id);
              const st = s?.status ?? 'todo';
              return (
                <li key={id} className={`ib-step st-${stepGlyph(st)}`} data-step={id} data-status={st} title={s ? `${STEP_WORDS[id]}: ${s.detail}` : STEP_WORDS[id]}>
                  <i className="dot" /><span className="w">{STEP_WORDS[id]}</span>
                  {id === 'understand' && s?.ms ? <span className="ms">{secs(s.ms)}</span> : null}
                </li>
              );
            })}
          </ol>
          {current && <div className="ib-detail" data-testid="step-detail">{current.detail}{current.id === 'understand' && current.ms ? ` · ${secs(current.ms)}` : ''}</div>}
        </>
      )}

      {msg && <div className={`pop-notice ${msg.kind ?? 'ok'}`} role="status" data-testid="item-notice">{msg.text}</div>}

      {hand && handProblems(item).length > 0 && (
        <ul className="ib-problems">{handProblems(item).map((p, i) => <li key={i}>{p}</li>)}</ul>
      )}

      {ai?.understood?.length ? (
        <details className="ib-understood" open={expanded}>
          <summary>What the AI understood</summary>
          <ul>{ai.understood.map((l, i) => <li key={i}>{l}</li>)}</ul>
          {ai.uncertain?.length ? <><div className="ib-g-k">Not sure about</div><ul className="unsure">{ai.uncertain.map((l, i) => <li key={i}>{l}</li>)}</ul></> : null}
        </details>
      ) : null}

      {heldActs.length > 0 && (
        <section className="ib-group g-needs" data-group="needs-you">
          <div className="ib-g-h"><span className="ib-g-k">Needs you</span><span className="sec-n">{heldActs.length}</span></div>
          <ul>
            {heldActs.map((r) => (
              <li key={r.id} data-record={r.id} data-testid="held" data-rule={r.held!.rule}>
                <div className="ib-act"><span className="ib-rule">{RULE_WORDS[r.held!.rule] ?? 'Check'}</span><span className="ib-lbl">{r.label}</span></div>
                <div className="ib-why">{r.held!.why}</div>
                {r.held!.existing && <div className="ib-existing" data-testid="existing-star">Existing star: <b>{starLabel(nodes, r.held!.existing)}</b></div>}
                <div className="ib-choices">
                  {heldChoices(r.held!).map((c) => (
                    <button key={c.label} className={`btn sm${c.kind === 'apply' ? ' primary' : ''}`} data-action={c.kind === 'apply' ? 'apply' : 'drop-action'}
                      data-resolve={c.resolve ?? ''} disabled={busy} onClick={() => void (c.kind === 'apply' ? applyHeld(r.id, c.resolve) : drop(r.id))}>{c.label}</button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {asking && (
        <div className="ib-ask" data-testid="which-idea">
          <div className="ib-g-h"><span className="ib-g-k">Which idea?</span><span className="hint">The app couldn't tell which idea this belongs to. Pick one and it carries on.</span></div>
          <div className="ib-cands">
            {askCandidates(item).map((c) => (
              <button key={c.id} className="btn sm" data-action="choose" data-idea={c.id} disabled={busy}
                onClick={() => void go('Asking the AI…', () => inboxPost(item.id, 'choose', { ideaId: c.id }), () => `Chose ${c.id}.`)}>
                <span className="iid">{c.id}</span>{c.title}{t?.suggested === c.id && <em className="ib-guess"> · best guess</em>}
              </button>
            ))}
            {!askCandidates(item).length && <span className="hint">No idea looks close. Dismiss it, or add the idea first.</span>}
          </div>
        </div>
      )}

      {okActs.length > 0 && (
        <section className="ib-group g-ok" data-group="ok">
          <div className="ib-g-h">
            <span className="ib-g-k">Needs your OK</span><span className="sec-n">{okActs.length}</span>
            {okActs.length > 1 && (
              <button className="btn primary sm ib-all" data-action="apply-all" disabled={busy || !chosen.length} onClick={() => void applyIds(chosen)}>
                {chosen.length === pending.length ? 'Apply all' : `Apply ${chosen.length} selected`}
              </button>
            )}
          </div>
          <ul>
            {okActs.map((r) => (
              <li key={r.id} data-record={r.id} className={r.status === 'failed' ? 'failed' : ''}>
                <div className="ib-act">
                  {okActs.length > 1 && (
                    <input type="checkbox" aria-label={`Include: ${r.label}`} checked={chosen.includes(r.id)} onChange={() => toggle(r.id)} disabled={busy} />
                  )}
                  <span className="ib-lbl">{r.label}</span>
                  <button className="btn primary sm" data-action="apply" disabled={busy} onClick={() => void applyIds([r.id])}>{r.status === 'failed' ? 'Try again' : 'Apply'}</button>
                </div>
                {r.error && <div className="ib-err">Didn't work: {r.error}</div>}
              </li>
            ))}
          </ul>
        </section>
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
                      onClick={() => void go('Undoing…', () => inboxPost(item.id, 'undo', { recordId: r.id }), (x: any) => (x?.note ? `Undone. ${x.note}` : 'Undone.'))}>Undo</button>
                  )}
                </div>
                {r.note && <div className="ib-note">{r.note}</div>}
                <ImportLines r={r} />
              </li>
            ))}
            {g.undone.map((r) => (
              <li key={r.id} data-record={r.id} className="undone"><div className="ib-act"><span className="ib-lbl">{r.label}</span><span className="ib-undone">Undone</span></div>{r.note && <div className="ib-note">{r.note}</div>}</li>
            ))}
          </ul>
        </section>
      )}

      {heldFile && (
        <section className="ib-group g-held" data-group="held">
          <div className="ib-g-h"><span className="ib-g-k">Held</span><span className="hint">Not read further and never copied into an idea.</span></div>
          <ul className="ib-reasons">{(item.hold?.reasons ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul>
          <div className="ib-held-acts">
            <button className="btn sm" data-action="draft-held-reply" disabled={busy}
              onClick={() => void go('Drafting…', () => inboxPost(item.id, 'draft-held-reply'), (r: any) => `${r.email?.template ?? 'PD'} drafted in the Outbox.`)}>Draft reply asking for counts</button>
            {!sureDelete
              ? <button className="btn sm danger" data-action="delete" disabled={busy} onClick={() => setSureDelete(true)}>Delete</button>
              : (
                <>
                  <span className="ib-sure">Delete the file for good?</span>
                  <button className="btn sm danger on" data-action="delete-yes" disabled={busy}
                    onClick={() => void go('Deleting…', () => inboxPost(item.id, 'delete'), () => `${item.name} deleted.`)}>Yes, delete</button>
                  <button className="btn sm" data-action="delete-no" onClick={() => setSureDelete(false)}>Keep it</button>
                </>
              )}
          </div>
        </section>
      )}

      {expanded && !heldFile && item.status !== 'dismissed' && (
        <div className="ib-again">
          <button className="btn sm" data-action="run-again" disabled={busy} title="Run steps 4 to 8 again; what was applied stays applied"
            onClick={() => void go('Running again…', () => inboxPost(item.id, 'process'), () => 'Ran again.')}>Run again</button>
        </div>
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
