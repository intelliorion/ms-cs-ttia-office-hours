import { useEffect, useRef, useState } from 'react';
import { dataFilePost, dataPost, dataUpload } from '../api';
import { NO_AI_TIP } from '../popouts/aiUi';
import { AI_WAIT, openStep } from './designHelpers';
import { StepCarousel, StepItem, type DesignCall, type DesignView } from './DesignSection';
import {
  ACCEPT, columnRows, currentCard, DATA_KIND_OPTIONS, dataPhase, glyphOf, guessKind, isRunning, KIND_LABELS, mergeFiles, sizeWords, stepCards, whatOf,
} from './dataHelpers';

/** What the folded part of a file card holds, in a few words ("6 columns, 4 rules, 3 issues, 2 missing"). */
export function detailWords(file: any, cols: number): string {
  const u = file.understanding;
  const n = (k: number, one: string, many = `${one}s`) => (k ? `${k} ${k === 1 ? one : many}` : '');
  const issues = [...(file.tables ?? []).flatMap((t: any) => t.issues), ...(u?.issues ?? [])].length;
  return [n(cols, 'column'), n(u?.points?.length ?? 0, 'key fact'), n(u?.rules?.length ?? 0, 'rule'), n(u?.derivations?.length ?? 0, 'output column worked out', 'output columns worked out'),
    n(issues, 'issue'), n(u?.missing?.length ?? 0, 'thing missing', 'things missing')].filter(Boolean).join(', ') || 'Details';
}

/** A file staged for upload: the drop-down says what it is before it goes up. */
interface Staged { key: string; file: File; kind: string }

/** The five step cards of one file, the Import's dots, with what the current one found under them. */
function StepDots({ file }: { file: any }) {
  const cur = currentCard(file);
  return (
    <>
      <ol className="ib-steps da-steps" aria-label="Steps">
        {stepCards(file).map((c) => (
          <li key={c.id} className={`ib-step st-${glyphOf(c.status)}${c.id === 'understand' ? ' who-ai' : ''}`} data-step={c.id} data-status={c.status} title={c.detail || c.word}>
            <span className="dot" aria-hidden="true" />
            <span className="w">{c.word}</span>
            {c.id === 'understand' && <span className="ai-tag">AI</span>}
          </li>
        ))}
      </ol>
      {/* Once understood, the card below says what the AI found: the line is not said twice. */}
      {cur?.detail && !(cur.id === 'understand' && cur.status === 'done' && file.understanding) && <div className={`ib-detail da-detail${cur.status === 'needs-you' ? ' you' : cur.status === 'failed' ? ' bad' : ''}`} data-testid="data-step-detail">{cur.detail}</div>}
    </>
  );
}

/** One file: its steps, the hold (when the check found personal data), and what was understood, with Edit. */
function FileCard({ file, off, aiOff, readOnly, onKind, onRelease, onRemove, onUnderstand, onEdit }: {
  file: any; off: boolean; aiOff: boolean; readOnly: boolean;
  onKind: (kind: string) => void; onRelease: () => void; onRemove: () => void; onUnderstand: () => void; onEdit: (body: { what: string; columns: Record<string, string> }) => Promise<unknown>;
}) {
  const [edit, setEdit] = useState<{ what: string; columns: Record<string, string> } | null>(null);
  const [removing, setRemoving] = useState(false);
  const u = file.understanding;
  const cols = columnRows(file);
  const held = file.check?.status === 'held';
  const what = whatOf(file);
  const running = isRunning(file);
  return (
    <li className={`da-file${held ? ' held' : ''}${running ? ' running' : ''}`} data-file={file.id} data-testid="data-file">
      <div className="da-h">
        <span className="da-name" title={file.name}>{file.name}</span>
        <span className="sec-n">{sizeWords(file)}</span>
        {readOnly ? <span className="da-kind-ro">{KIND_LABELS[file.kind as keyof typeof KIND_LABELS]}</span> : (
          <select className="da-kind" aria-label={`What ${file.name} is`} value={file.kind} disabled={off || running} onChange={(e) => onKind(e.target.value)}>
            {DATA_KIND_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        )}
      </div>
      <StepDots file={file} />
      {held && !readOnly && (
        <div className="da-held" role="group" aria-label="Held for personal data" data-testid="data-held">
          <div><b>Held: it may hold personal data.</b> {(file.check.findings ?? []).map((f: any) => f.why).join('; ')}. The Café uses synthetic, sample, masked or aggregated data only. Nothing in it has gone to the AI.</div>
          <div className="ds-own-acts">
            <button className="btn sm" data-action="data-remove-held" disabled={off} onClick={onRemove}>Remove</button>
            <button className="btn sm amber" data-action="data-release" disabled={off} title="The flagged columns stay masked in everything the AI sees" onClick={onRelease}>It is masked / synthetic — continue</button>
          </div>
        </div>
      )}
      {file.stale && !readOnly && (
        <div className="hint warn">The kind changed since it was understood. <button className="link-btn" data-action="data-understand-again" disabled={aiOff} onClick={onUnderstand}>Understand again</button></div>
      )}
      {(u || file.edits) && !edit && (
        <div className="da-u" data-testid="data-understanding">
          <div className="da-what">{what}{file.edits?.what && <span className="da-mine"> (yours)</span>}</div>
          {u?.kindHint && u.kindHint !== file.kind && <div className="hint">The AI thinks this is {KIND_LABELS[u.kindHint as keyof typeof KIND_LABELS].toLowerCase()}. You decide: change the drop-down if so.</div>}
          {file.check?.masked?.length > 0 && <div className="hint">Masked for the AI: {file.check.masked.join(', ')}</div>}
          <details className="da-more" data-testid="data-more">
            <summary>{detailWords(file, cols.length)}</summary>
            {cols.length > 0 && (
              <ul className="card-list da-cols" aria-label={`Columns of ${file.name}`}>
                {cols.map((c) => (
                  <li key={`${c.name}`}><span className="card-k"><code>{c.name}</code> <span className="da-type">{c.type}</span></span>
                    <span className="card-v">{c.meaning || <span className="hint">(meaning not said)</span>}{c.mine && <span className="da-mine"> (yours)</span>}{c.codes && <span className="hint"> Codes: {c.codes}</span>}</span></li>
                ))}
              </ul>
            )}
            {u?.points?.length > 0 && <ul className="da-list">{u.points.map((p: string, i: number) => <li key={i}>{p}</li>)}</ul>}
            {u?.rules?.length > 0 && <div className="da-part"><div className="da-k">Rules</div><ul className="da-list">{u.rules.map((r: any, i: number) => <li key={i}>{r.rule}{r.columns.length ? <span className="hint"> ({r.columns.join(', ')})</span> : null}</li>)}</ul></div>}
            {u?.derivations?.length > 0 && <div className="da-part"><div className="da-k">How the output is worked out</div><ul className="da-list">{u.derivations.map((d: any, i: number) => <li key={i}><code>{d.output}</code>: {d.how}</li>)}</ul></div>}
            {u?.serves?.length > 0 && <div className="hint">Serves: {u.serves.join(', ')}</div>}
            {[...(file.tables ?? []).flatMap((t: any) => t.issues), ...(u?.issues ?? [])].length > 0 && (
              <div className="da-part"><div className="da-k warn">Issues</div><ul className="da-list">{[...(file.tables ?? []).flatMap((t: any) => t.issues), ...(u?.issues ?? [])].slice(0, 8).map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></div>
            )}
            {u?.missing?.length > 0 && <div className="da-part"><div className="da-k warn">Missing</div><ul className="da-list">{u.missing.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></div>}
            {u?.dropped?.length > 0 && <div className="hint">Left out of the AI's answer (not in the file): {u.dropped.join(', ')}</div>}
          </details>
        </div>
      )}
      {edit && (
        <div className="ds-form da-edit" data-testid="data-edit">
          <label className="hint">What it is
            <input type="text" value={edit.what} maxLength={200} aria-label={`What ${file.name} is, in one line`} onChange={(e) => setEdit({ ...edit, what: e.target.value })} />
          </label>
          {cols.map((c) => (
            <label key={c.name} className="da-edit-col"><code>{c.name}</code>
              <input type="text" value={edit.columns[c.name] ?? ''} maxLength={200} aria-label={`What ${c.name} means`} onChange={(e) => setEdit({ ...edit, columns: { ...edit.columns, [c.name]: e.target.value } })} />
            </label>
          ))}
          <div className="ds-form-acts">
            <button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
            <button className="btn primary" data-action="data-save-edit" disabled={off} onClick={async () => { if (await onEdit(edit)) setEdit(null); }}>Save</button>
          </div>
        </div>
      )}
      {!readOnly && !held && !edit && (
        <div className="da-acts">
          {(file.tables?.length || file.doc) && <button className="btn sm" data-action="data-edit" disabled={off || running}
            onClick={() => setEdit({ what: what ?? '', columns: Object.fromEntries(cols.map((c) => [c.name, c.meaning])) })}>Edit understanding</button>}
          {(file.tables?.length || file.doc) && <button className="btn sm" data-action="data-understand" disabled={aiOff || running} title={aiOff ? NO_AI_TIP : undefined} onClick={onUnderstand}>Understand again</button>}
          {!removing ? <button className="btn sm ghost" data-action="data-remove" disabled={off || running} onClick={() => setRemoving(true)}>Remove</button> : (
            <span className="da-confirm">Remove {file.name}? <button className="link-btn" data-action="data-remove-yes" onClick={onRemove}>Remove</button> <button className="link-btn" onClick={() => setRemoving(false)}>Keep</button></span>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Understand the data: the first step of the Design series. Drop the team's files (or pick them), say what each one is,
 * and the app reads, checks, profiles and has the AI understand each one, as step cards. Then the AI asks about the
 * data one question at a time until it is complete, and the operator confirms it once ("Looks right"): only then does
 * it feed the features, the tool, the design, the kits and the roadshow. Works by hand with no AI.
 */
export function DataSection({ idea, design, busy, aiWorking, noAi, call, onSendQuestions }: {
  idea: any; design: DesignView | null; busy: boolean; aiWorking: boolean; noAi: boolean; call: DesignCall; onSendQuestions: () => void;
}) {
  const [staged, setStaged] = useState<Staged[]>([]);
  const [live, setLive] = useState<Record<string, any>>({});
  const [over, setOver] = useState(false);
  const [handQ, setHandQ] = useState<{ question: string; suggested: string } | null>(null);
  const [finish, setFinish] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = idea.id;
  const off = busy || aiWorking;
  // A fresh design replaces what was streamed in.
  useEffect(() => { setLive({}); }, [design]);
  if (!design) return <section className="sec"><h3>Understand the data</h3><div className="hint">Loading…</div></section>;
  const d = design.state.data ?? { files: [], steps: [] };
  const files = mergeFiles(d.files ?? [], live);
  const steps: any[] = d.steps ?? [];
  const phase = dataPhase(d);
  const waiting = openStep(steps);
  const anyRunning = files.some(isRunning);
  const ai = noAi ? undefined : 'data';
  const progress = (f: any) => { if (f?.id) setLive((x) => ({ ...x, [f.id]: f })); };

  const stage = (list: FileList | File[] | null | undefined) => {
    const add = [...(list ?? [])].map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, file, kind: guessKind(file.name) }));
    if (add.length) setStaged((xs) => [...xs, ...add]);
  };
  const upload = async () => {
    const list = staged;
    await call(async () => {
      let last: any = null;
      for (const s of list) {
        last = await dataUpload(id, s.file, s.kind, progress);
        setStaged((xs) => xs.filter((x) => x.key !== s.key));
      }
      return last;
    }, { ai, ok: () => `${list.length === 1 ? `${list[0].file.name} is` : `${list.length} files are`} read and understood. Check what the AI made of ${list.length === 1 ? 'it' : 'them'}, then ask about the data.` });
  };
  const filePost = (fid: string, what: 'release' | 'understand' | 'kind' | 'edit' | 'remove', body: unknown, ok: string, stream = false) =>
    call(() => dataFilePost(id, fid, what, body, stream ? progress : undefined), { ...(stream ? { ai } : {}), ok: () => ok });
  const next = () => call(() => dataPost(id, 'step'), {
    ai: 'data', ok: (r: any) => [r.step ? `Data question ${r.step.n} added.` : r.done ? 'The AI says the understanding is complete. Check the summary, then confirm it.' : undefined,
      r.applied?.length ? `Updated from your answers: ${r.applied.join('; ')}.` : ''].filter(Boolean).join(' ') || undefined,
  });
  const answer = (n: number, body: any) => call(() => dataPost(id, 'answer', { n, ...body }), { ok: () => `Answer to data question ${n} saved.` });

  return (
    <section className="sec" data-testid="data">
      <h3>Understand the data <span className={`sec-n da-phase ${phase.kind}`}>{phase.word}</span></h3>
      {phase.kind === 'none' && <div className="hint ds-lead">Drop the team's sample data before the features: an export, the output it should make, the rules, a process document, an example email. Synthetic, sample, masked or aggregated data only.</div>}
      <div className={`da-well${over ? ' over' : ''}`} data-testid="data-drop"
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); if (!off) stage(e.dataTransfer?.files); }}>
        <div className="dz-t">{over ? 'Let go to add' : 'Drop data files here'}</div>
        <div className="hint">CSV, Excel, PDF, Word, text, email (.eml, .msg) or a picture of a report; up to 10 MB each. Each is copied into the idea folder and checked for personal data before anything else.</div>
        <input ref={input} type="file" multiple accept={ACCEPT} data-testid="data-file-input" aria-label="Choose data files" disabled={off}
          onChange={(e) => { stage(e.target.files); e.target.value = ''; }} />
      </div>
      {staged.length > 0 && (
        <div className="da-staged" data-testid="data-staged">
          <ul>
            {staged.map((s) => (
              <li key={s.key}>
                <span className="da-name" title={s.file.name}>{s.file.name}</span>
                <select aria-label={`What ${s.file.name} is`} value={s.kind} disabled={off} onChange={(e) => setStaged((xs) => xs.map((x) => (x.key === s.key ? { ...x, kind: e.target.value } : x)))}>
                  {DATA_KIND_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
                <button className="tp-x" aria-label={`Leave out ${s.file.name}`} disabled={off} onClick={() => setStaged((xs) => xs.filter((x) => x.key !== s.key))}>×</button>
              </li>
            ))}
          </ul>
          <div className="ai-row">
            <button className="btn primary" data-action="data-upload" disabled={off} onClick={() => void upload()}>
              {aiWorking ? 'Working…' : `Read and understand ${staged.length === 1 ? 'it' : `${staged.length} files`}`}</button>
            {noAi && <span className="hint">No AI: the files are read, checked and profiled; write what they mean with Edit understanding.</span>}
          </div>
        </div>
      )}
      {files.length > 0 && (
        <ul className="da-files" aria-label="Data files">
          {files.map((f) => (
            <FileCard key={f.id} file={f} off={off} aiOff={off || noAi} readOnly={false}
              onKind={(kind) => void filePost(f.id, 'kind', { kind }, `${f.name}: ${KIND_LABELS[kind as keyof typeof KIND_LABELS]}. Understand it again so the AI reads it as that.`)}
              onRelease={() => void filePost(f.id, 'release', {}, `${f.name} goes on as masked or synthetic data; the flagged columns stay masked for the AI.`, true)}
              onRemove={() => void filePost(f.id, 'remove', {}, `${f.name} removed, with its copy in the idea folder.`)}
              onUnderstand={() => void filePost(f.id, 'understand', {}, `${f.name} understood again.`, true)}
              onEdit={(body) => filePost(f.id, 'edit', body, `Your words for ${f.name} saved. Confirm the understanding again when it is right.`)} />
          ))}
        </ul>
      )}
      {(files.length > 0 || steps.length > 0) && (
        <div className="da-qs" data-testid="data-questions">
          <div className="da-k">Questions about the data</div>
          {steps.length > 0 && (
            <StepCarousel steps={steps} testId="data-carousel" render={(st) => (
              <StepItem key={st.n} step={st} off={off} prefix="D" onSendQuestions={onSendQuestions}
                onAnswer={(body) => answer(st.n, body)}
                onIdk={() => void call(() => dataPost(id, 'answer', { n: st.n, idk: true }), { ok: () => `Data question ${st.n} added to the questions email (E2): send it from ✉ Emails. Carry on with the next question.` })} />
            )} />
          )}
          {d.summary && (
            <div className={`ds-done da-sum${d.confirmedAt ? ' confirmed' : ''}`} data-testid="data-summary">
              <div className="ds-done-h">{d.confirmedAt ? `Confirmed on ${d.confirmedAt}` : 'The AI says the understanding is complete'}</div>
              <div className="ds-sum">{d.summary.text}</div>
              <dl className="dp-settles da-sum-dl">
                {[['Input', d.summary.input], ['Output', d.summary.output], ['Knowledge', d.summary.knowledge], ['Rules', d.summary.rules]].filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
              </dl>
              {d.summary.gapsClosed?.length > 0 && <div className="hint">Settled by your answers: {d.summary.gapsClosed.join('; ')}</div>}
              {d.summary.open?.length > 0 && !d.confirmedAt && <div className="hint warn">Still open: {d.summary.open.join('; ')}</div>}
              {d.confirmedAt
                ? <div className="hint">It now feeds the features, the tool, the design, the kits and the roadshow. Dropping a file or changing it asks for a new confirmation.</div>
                : (
                  <div className="ai-row">
                    <button className="btn primary" data-action="data-confirm" disabled={off || anyRunning}
                      onClick={() => void call(() => dataPost(id, 'confirm'), { ok: () => 'Data understanding confirmed. It now feeds the features, the tool, the design, the kits and the roadshow.' })}>Looks right</button>
                    <span className="hint">Confirm once: only a confirmed understanding is used after this.</span>
                  </div>
                )}
            </div>
          )}
          {(d.applied?.length ?? 0) > 0 && (
            <div className="da-applied" data-testid="data-applied">
              <div className="da-k">Updated from your answers</div>
              <ul className="da-list">{d.applied.map((a: any) => <li key={`${a.key}-${a.at}`}>{a.label}</li>)}</ul>
            </div>
          )}
          {handQ && (
            <div className="ds-form" data-testid="data-hand-question">
              <input type="text" value={handQ.question} maxLength={200} placeholder="The question" aria-label="Data question" disabled={off} onChange={(e) => setHandQ({ ...handQ, question: e.target.value })} />
              <textarea rows={2} value={handQ.suggested} placeholder="Suggested answers, one per line (optional, up to 4)" aria-label="Suggested answers" disabled={off} onChange={(e) => setHandQ({ ...handQ, suggested: e.target.value })} />
              <div className="ds-form-acts">
                <button className="btn ghost" onClick={() => setHandQ(null)}>Cancel</button>
                <button className="btn primary" data-action="data-add-question" disabled={off || !handQ.question.trim()}
                  onClick={async () => { if (await call(() => dataPost(id, 'step', { question: handQ.question, suggested: handQ.suggested.split('\n').map((x) => x.trim()).filter(Boolean) }), { ok: (r: any) => `Data question ${r.step?.n ?? ''} added.` })) setHandQ(null); }}>Add question</button>
              </div>
            </div>
          )}
          {finish !== null && (
            <div className="ds-form" data-testid="data-hand-finish">
              <textarea rows={3} value={finish} maxLength={600} placeholder="Summary: what goes in, what comes out, the rules and the reference" aria-label="Data summary" disabled={off} onChange={(e) => setFinish(e.target.value)} />
              <div className="ds-form-acts">
                <span className="hint">{finish.length}/600</span>
                <button className="btn ghost" onClick={() => setFinish(null)}>Cancel</button>
                <button className="btn primary" data-action="data-finish" disabled={off || !finish.trim()}
                  onClick={async () => { if (await call(() => dataPost(id, 'finish', { summary: finish }), { ok: () => 'Summary saved. Check it, then confirm it.' })) setFinish(null); }}>Save summary</button>
              </div>
            </div>
          )}
          <div className="ai-row ds-acts">
            {!d.summary && (
              <button className="btn primary" data-action="data-next" disabled={noAi || off || Boolean(waiting) || anyRunning}
                title={noAi ? NO_AI_TIP : waiting ? `Answer data question ${waiting.n} first, or say "I don't know"` : undefined} onClick={() => void next()}>
                {aiWorking ? 'Working…' : steps.length ? 'Next question' : 'Check the understanding'}</button>
            )}
            {!handQ && <button className="btn" data-action="data-hand-question" disabled={off} onClick={() => setHandQ({ question: '', suggested: '' })}>Add a question by hand</button>}
            {finish === null && !d.summary && <button className="btn" data-action="data-hand-finish" disabled={off} onClick={() => setFinish('')}>Finish by hand</button>}
            {aiWorking && <span className="ai-busy" role="status">{AI_WAIT}</span>}
          </div>
        </div>
      )}
    </section>
  );
}

/** The data after its stage (Launch and Learn, or closed): what it is and whether it was confirmed, read-only. */
export function DataCard({ design }: { design: DesignView | null }) {
  const d = design?.state?.data;
  if (!d?.files?.length && !d?.steps?.length) return null;
  const phase = dataPhase(d);
  return (
    <section className="sec sec-card" data-testid="data-card">
      <h3>The data <span className="sec-n">{phase.word}</span></h3>
      {d.summary?.text && <div className="card-text">{d.summary.text}</div>}
      <ul className="card-list">
        {d.files.map((f: any) => <li key={f.id}><span className="card-k">{f.name}</span><span className="card-v">{KIND_LABELS[f.kind as keyof typeof KIND_LABELS]}{whatOf(f) ? `: ${whatOf(f)}` : ''}</span></li>)}
      </ul>
      {!d.confirmedAt && <div className="hint warn">Not confirmed: the features, the tool, the design and the roadshow did not use it.</div>}
    </section>
  );
}
