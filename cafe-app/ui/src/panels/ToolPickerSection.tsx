import { useEffect, useState } from 'react';
import { designPost } from '../api';
import { useStore } from '../state/store';
import { NO_AI_TIP } from '../popouts/aiUi';
import {
  AI_WAIT, approvedTools, CUSTOM_APP, CUSTOM_APP_NOTE, emptyRow, featureRows, features, featuresBody, FIT_MARK, FIT_WORD, flagWord,
  mergeRows, NEEDS_AI_NOTE, outOfDate, overrideTool, pathwayText, picksBody, picksProblem, STALE_NOTE, toolView,
  type FeatureRow, type ToolView,
} from './designHelpers';
import { TodoList, Updates, updatesFrom } from './ReviewSelect';
import { post } from '../api';
import { openedText } from './outlook';
import { isOpenNeed, awaitsReevaluation } from '../../../src/review/needs';
import type { DesignCall, DesignView } from './DesignSection';
import { buildersOf } from '../popouts/IdeaSections';

/**
 * Features and tool, in that order. 1. Features: a list of rows (name, what it does), added and removed by hand, or
 * filled by "Suggest features with AI" (new names only; the operator's rows stay). 2. Tool: ONE approved tool for the
 * whole list. "Suggest a tool" asks the AI for it, with its reason, pros, cons and how it fits each feature, plus the
 * to-do list of what it still needs (Draft email sends the open questions as an E2; Re-evaluate reads the answers).
 * The drop-down is the operator's: changing it asks the AI to evaluate THAT tool for the features (the AI may not
 * change it); with no AI the tool still changes, with its pros and cons cleared. Changing the features after a tool
 * is chosen marks its evaluation out of date. Nothing is saved until Save. A custom app carries the CSIC note.
 */
export function ToolPickerSection({ idea, design, busy, aiWorking, noAi, aiName, call }: {
  idea: any; design: DesignView | null; busy: boolean; aiWorking: boolean; noAi: boolean; aiName: (p?: string) => string; call: DesignCall;
}) {
  const saved = design?.state.features;
  // The server's approved list is the source of truth; the local copy covers an older server.
  const tools = approvedTools(useStore((x) => x.state));
  const savedTool = design?.state.tool;
  const [rows, setRows] = useState<FeatureRow[]>([]);
  const [choice, setChoice] = useState<ToolView | null>(null);
  const [dirty, setDirty] = useState(false);
  /** The tool the operator just picked, while the AI evaluates it. */
  const [pending, setPending] = useState<string | null>(null);
  const savedKey = JSON.stringify([saved ?? null, savedTool ?? null]);
  const reset = () => { setRows(featureRows(saved)); setChoice(toolView(savedTool, tools)); };
  // The saved features and tool fill the panel, unless the operator has unsaved changes.
  useEffect(() => { if (!dirty) reset(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const edit = (key: string, patch: Partial<FeatureRow>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const prep = design?.state.toolPrep;
  const answers: any[] = idea.answers ?? [];
  const needs: any[] = prep?.needs ?? [];
  const open = needs.filter((n) => isOpenNeed(n, answers));
  const answered = needs.filter((n) => awaitsReevaluation(n, answers));
  const body = featuresBody(rows);
  const stale = Boolean(choice) && !choice!.needsAi && outOfDate(body, choice);

  const suggestFeatures = async () => {
    const r = await call(() => designPost(idea.id, 'tools/features/suggest', { features: body }), {
      ai: 'tools',
      ok: (x: any) => {
        const added = (x.features ?? []).length - body.length;
        return `Suggested by ${aiName(x.provider)}: ${added > 0 ? `${features(added)} added below` : 'nothing new to add'}. Nothing is saved until you Save.`;
      },
    });
    if (r?.features) { setRows((rs) => mergeRows(rs, featureRows(r.features, { fromAi: true }))); setDirty(true); }
  };
  /** Suggest (no tool given) or evaluate the operator's tool for the features as they are now. */
  const askTool = async (evaluate?: string) => {
    const again = !!prep;
    const r = await call(() => designPost(idea.id, 'tools/suggest', { features: body, ...(evaluate ? { tool: evaluate } : {}) }), {
      ai: 'tools',
      ok: (x: any) => {
        const left = (x.state?.toolPrep?.needs ?? []).filter((n: any) => !n.met).length;
        const what = evaluate ? `${evaluate} evaluated for the features` : x.tool ? 'one tool suggested below' : 'no tool yet';
        return `${evaluate ? 'Evaluated' : again ? 'Re-evaluated' : 'Suggested'} by ${aiName(x.provider)}: ${what}${left ? `, ${left} thing${left > 1 ? 's' : ''} to find out` : ''}. Nothing is saved until you Save.`;
      },
    });
    const t = toolView(r?.tool, tools);
    if (t) { setChoice(t); setDirty(true); }
    return r;
  };
  /** The operator's own tool: evaluated by the AI, or kept with no pros and cons when there is no AI (or it failed). */
  const pickTool = async (tool: string) => {
    if (!tool || tool === choice?.tool) return;
    setPending(tool);
    const done = !noAi && (await askTool(tool))?.tool;
    setPending(null);
    if (!done) { setChoice(overrideTool(tool, rows)); setDirty(true); }
  };
  // Re-evaluate: the operator's own tool is evaluated again; an AI suggestion is suggested again.
  const reevaluate = () => void askTool(choice?.by === 'operator' ? choice.tool : undefined);
  const answer = async (need: string, text: string) => { await call(() => designPost(idea.id, 'tools/prep/answer', { need, answer: text }), { ok: () => undefined }); };
  const draftEmail = () => call(() => designPost(idea.id, 'tools/prep/email'), { ok: (o: any) => openedText(o.email.template) });
  const problem = dirty ? picksProblem(rows) : null;
  /** After a save: saved features that look like a star the idea already had. Merge, or keep both. */
  const [similar, setSimilar] = useState<{ feature: string; featureId: string; star: string; starId: string }[]>([]);
  const merge = async (x: { feature: string; featureId: string; star: string; starId: string }) => {
    const r = await call(() => post('/api/graph/merge', { from: x.starId, into: x.featureId }), { ok: () => `Merged ${x.star} into ${x.feature}: its links moved over.` });
    if (r) setSimilar((xs) => xs.filter((y) => y.starId !== x.starId));
  };
  const save = async () => {
    const b = picksBody(rows, choice);
    const r = await call(() => designPost(idea.id, 'tools', b), {
      ok: () => `Saved ${features(b.features.length)}${choice ? ` and ${choice.tool}` : ''}. approach.md is written and the universe shows the tool.`,
    });
    if (r) { setDirty(false); setRows(featureRows(r.state.features)); setChoice(toolView(r.state.tool, tools)); setSimilar(r.similar ?? []); }
  };
  const builder = buildersOf(idea)[0];
  const off = busy || aiWorking;
  const fits = new Map((choice?.fit ?? []).map((f) => [f.feature.trim().toLowerCase(), f]));
  const head = [saved?.length ? `${features(saved.length)} saved` : '', savedTool?.tool ? `tool: ${savedTool.tool}` : ''].filter(Boolean).join(' · ') || 'nothing saved yet';

  return (
    <section className="sec" data-testid="tool-picker">
      <h3>Features and tool <span className="sec-n">{head}</span></h3>

      <div className="tp-step" data-testid="tp-features">
        <div className="tp-step-h"><span className="tp-step-n">1</span>Features <span className="sec-n">what the proof of concept must do</span></div>
        {!design ? <div className="hint">Loading…</div> : rows.length === 0 ? (
          <div className="hint">No features yet. Add one by hand, or ask the AI to suggest some.</div>
        ) : (
          <ul className="tp-rows" aria-label="Features">
            {rows.map((r) => (
              <li key={r.key} className={`tp-row${r.suggested ? ' suggested' : ''}`} data-feature={r.name}>
                <div className="tp-r1">
                  <input type="text" className="tp-name" value={r.name} placeholder="Feature name" aria-label="Feature name" disabled={off}
                    onChange={(e) => edit(r.key, { name: e.target.value })} />
                  <button className="tp-x" aria-label={`Remove ${r.name || 'this feature'}`} title="Remove" disabled={off} data-action="feature-remove"
                    onClick={() => { setRows((rs) => rs.filter((x) => x.key !== r.key)); setDirty(true); }}>×</button>
                </div>
                <input type="text" className="tp-what" value={r.what} placeholder="What it does, in one line" aria-label="What it does" disabled={off}
                  onChange={(e) => edit(r.key, { what: e.target.value })} />
                {r.flags.length > 0 && <div className="tp-r3">{r.flags.map((f) => <span key={f} className="tp-flag">{flagWord(f)}</span>)}</div>}
              </li>
            ))}
          </ul>
        )}
        {rows.some((r) => r.suggested) && <div className="sg-by">Suggested by the AI. Change or remove what you like, then save.</div>}
        <div className="ai-row rs-acts">
          <button className="btn" data-action="features-suggest" disabled={noAi || off || !design || rows.length >= 12}
            title={noAi ? NO_AI_TIP : 'Adds features from the idea, its answers and what was learned since the form; yours stay'} onClick={() => void suggestFeatures()}>
            {aiWorking ? 'Working…' : 'Suggest features with AI'}</button>
          <button className="btn" data-action="tools-add" disabled={off || rows.length >= 12} onClick={() => { setRows((rs) => [...rs, emptyRow()]); setDirty(true); }}>Add feature</button>
        </div>
      </div>

      <div className="tp-step" data-testid="tp-tool">
        <div className="tp-step-h"><span className="tp-step-n">2</span>Tool <span className="sec-n">one tool for the whole proof of concept</span></div>
        {prep && (
          <div data-testid="tool-todo">
            <TodoList needs={needs} answers={answers} disabled={off} onAnswer={answer} none="Nothing more is needed to pick the tool." />
            <div className="rs-by">By {aiName(prep.provider)} on {prep.at}.</div>
          </div>
        )}
        {/* What the answers change in the record: the same list as the decision's, each waiting for Yes. */}
        <Updates updates={updatesFrom(idea, 'tools')} disabled={off} onUpdate={(update, what) => void call(
          () => post(`/api/ideas/${encodeURIComponent(idea.id)}/prep/update`, { update, do: what }),
          { ok: (u: any) => (what === 'yes' ? `Done: ${u.label}` : what === 'no' ? 'Left as it is.' : `Undone: ${u.label}`) })} />
        <div className="ai-row rs-acts">
          {!prep ? (
            <button className="btn" data-action="tools-suggest" disabled={noAi || off || !design}
              title={noAi ? NO_AI_TIP : 'One tool for the features above'} onClick={() => void askTool()}>{aiWorking ? 'Working…' : 'Suggest a tool'}</button>
          ) : (
            <>
              <button className="btn" data-action="tools-draft-questions" disabled={off || !open.length}
                title={open.length ? 'The open questions as one email, opened in Outlook' : 'Nothing open to ask'} onClick={() => void draftEmail()}>✉ Draft email</button>
              <button className={`btn${answered.length ? ' primary' : ''}`} data-action="tools-reevaluate" disabled={noAi || off || !design}
                title={noAi ? NO_AI_TIP : 'Read everything again, with the answers'} onClick={reevaluate}>{aiWorking ? 'Working…' : 'Re-evaluate'}</button>
            </>
          )}
          <select className="tp-tool" value={pending ?? choice?.tool ?? ''} aria-label="The tool" disabled={off || !design} data-action="tool"
            title="Your choice: the AI evaluates the tool you pick" onChange={(e) => void pickTool(e.target.value)}>
            <option value="" disabled>Pick a tool…</option>
            {tools.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {aiWorking && <span className="ai-busy" role="status">{AI_WAIT}</span>}
        </div>
        {prep && !open.length && answered.length > 0 && <div className="hint">Answers are in: Re-evaluate to check them.</div>}
        {choice && (
          <div className={`tp-choice${dirty && choice.by === 'ai' ? ' suggested' : ''}`} data-testid="tool-choice" data-tool={choice.tool} data-by={choice.by}>
            <div className="tp-r3">
              <span className="tp-path">{pathwayText(choice.tool, builder)}</span>
              <span className="tp-by">{choice.by === 'ai' ? 'Suggested by the AI' : 'Your choice'}</span>
              {choice.flags.map((f) => <span key={f} className="tp-flag">{flagWord(f)}</span>)}
            </div>
            {stale && (
              <div className="hint warn tp-stale" data-testid="tool-stale">
                {STALE_NOTE}{' '}
                <button className="link-btn" data-action="tools-evaluate-features" disabled={noAi || off} title={noAi ? NO_AI_TIP : undefined}
                  onClick={() => void askTool(choice.tool)}>Re-evaluate the tool for the new features</button>
              </div>
            )}
            {choice.needsAi && <div className="hint warn" data-testid="tool-needs-ai">{NEEDS_AI_NOTE}</div>}
            {choice.reason && <div className="tp-why">{choice.reason}</div>}
            {(choice.pros.length > 0 || choice.cons.length > 0) && (
              <div className="tp-pc" data-testid="tool-pros-cons">
                {choice.pros.length > 0 && <div className="tp-pros"><div className="tp-pc-h">Pros</div><ul>{choice.pros.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
                {choice.cons.length > 0 && <div className="tp-cons"><div className="tp-pc-h">Cons: what it can't do</div><ul>{choice.cons.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
              </div>
            )}
            {body.length > 0 && !choice.needsAi && (
              <ul className="tp-fit" data-testid="tool-fit" aria-label="How the tool fits each feature">
                {body.map((f) => {
                  const x = fits.get(f.name.toLowerCase());
                  return (
                    <li key={f.name} data-fit={x?.fit ?? 'unknown'} title={x ? FIT_WORD[x.fit] : 'Not evaluated'}>
                      <span className={`tp-fit-m ${x?.fit ?? 'unknown'}`}>{x ? FIT_MARK[x.fit] : '–'}</span>
                      <span className="tp-fit-f">{f.name}</span>
                      {x?.note && <span className="tp-fit-n">{x.note}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
            {choice.context.length > 0 && (
              <details className="tp-ctx" data-testid="tool-context">
                <summary>Why this tool</summary>
                <ul>{choice.context.map((c, i) => <li key={i}>{c}</li>)}</ul>
              </details>
            )}
            {choice.tool === CUSTOM_APP && <div className="tp-csic" data-testid="csic-note">{CUSTOM_APP_NOTE}</div>}
          </div>
        )}
      </div>

      {dirty && (
        <div className="rv-foot">
          <span className={`hint${problem ? ' warn' : ''}`}>{problem ?? 'Saving writes approach.md and links each feature the tool covers to it.'}</span>
          <span className="tp-acts">
            <button className="btn ghost" data-action="tools-undo" disabled={off} onClick={() => { reset(); setDirty(false); }}>Undo changes</button>
            <button className="btn primary" data-action="tools-save" disabled={off || Boolean(problem)} onClick={() => void save()}>Save</button>
          </span>
        </div>
      )}
      {similar.length > 0 && (
        <div className="tp-similar" data-testid="similar-stars">
          <div className="rs-th"><span>Already in the universe?</span></div>
          <ul>
            {similar.map((x) => (
              <li key={x.starId} data-similar={x.starId}>
                <span><b>{x.feature}</b> looks like <b>{x.star}</b>, which the AI found in the submission.</span>
                <span className="tp-acts">
                  <button className="btn sm primary" data-action="merge-star" disabled={off} onClick={() => void merge(x)}>Merge</button>
                  <button className="btn sm" data-action="keep-both" disabled={off} onClick={() => setSimilar((xs) => xs.filter((y) => y.starId !== x.starId))}>Keep both</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
