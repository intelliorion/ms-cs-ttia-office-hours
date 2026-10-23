import { useEffect, useState } from 'react';
import { designPost } from '../api';
import { useStore } from '../state/store';
import { NO_AI_TIP } from '../popouts/aiUi';
import {
  AI_WAIT, approvedTools, CUSTOM_APP, CUSTOM_APP_NOTE, emptyRow, featureRows, features, flagsFor, flagWord, mergeRows,
  askedWithAnswers, pathwayText, picksBody, picksProblem, suggestWaiting, type FeatureRow,
} from './designHelpers';
import type { DesignCall, DesignView } from './DesignSection';

/**
 * Tool picker: one row per feature (name, what, approved tool, pathway, flags, why this tool). "Suggest with AI" asks
 * for the one tool for the proof of concept: it comes back as one suggested row with the context it rests on, or, when
 * the form says too little, as the questions the team must answer, all of them in one E2 draft. Nothing is saved until
 * Save, and the tool drop-down is always the operator's. A custom-app pick carries the CSIC note.
 */
export function ToolPickerSection({ idea, design, busy, aiWorking, noAi, aiName, call }: {
  idea: any; design: DesignView | null; busy: boolean; aiWorking: boolean; noAi: boolean; aiName: (p?: string) => string; call: DesignCall;
}) {
  const saved = design?.state.features;
  // The server's approved list is the source of truth; the local copy covers an older server.
  const tools = approvedTools(useStore((x) => x.state));
  const [rows, setRows] = useState<FeatureRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const savedKey = JSON.stringify(saved ?? null);
  // Saved picks fill the rows, unless the operator has unsaved changes.
  useEffect(() => { if (!dirty) setRows(featureRows(saved, { tools })); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const edit = (key: string, patch: Partial<FeatureRow>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch, flags: patch.tool !== undefined ? flagsFor(patch.tool, r.flags) : r.flags } : r)));
    setDirty(true);
  };
  const suggest = async () => {
    const r = await call(() => designPost(idea.id, 'tools/suggest'), {
      ai: 'tools',
      ok: (x: any) => (x.questions?.length
        ? `${aiName(x.provider)} needs ${x.questions.length} answer${x.questions.length === 1 ? '' : 's'} first. The questions are in one questions email (E2): send it from ✉ Emails. Nothing is suggested until the team replies.`
        : `One tool suggested by ${aiName(x.provider)}. Check why below, change the tool if you like, then Save.`),
    });
    if (r?.features) { setRows((rs) => mergeRows(rs, featureRows(r.features, { fromAi: true, tools }))); setDirty(true); }
  };
  const forget = () => call(() => designPost(idea.id, 'tools/questions/clear'), { ok: () => 'Questions forgotten. You can ask the AI again.' });
  const asked: { questions: string[]; at: string } | undefined = design?.state.toolQuestions;
  const waiting = suggestWaiting(design?.state, idea);
  const problem = dirty ? picksProblem(rows) : null;
  const save = async () => {
    const body = picksBody(rows);
    const r = await call(() => designPost(idea.id, 'tools', body), {
      ok: () => `Saved ${features(body.features.length)}. approach.md is written and the universe shows the tools.`,
    });
    if (r) { setDirty(false); setRows(featureRows(r.state.features, { tools })); }
  };
  const builder = idea.people?.builder;
  const off = busy || aiWorking;

  return (
    <section className="sec" data-testid="tool-picker">
      <h3>Tool picker <span className="sec-n">{saved?.length ? `${features(saved.length)} saved` : 'nothing saved yet'}</span></h3>
      <div className="ai-row">
        <button className="btn" data-action="tools-suggest" disabled={noAi || off || !design || waiting}
          title={noAi ? NO_AI_TIP : waiting ? 'Questions are out to the team. Mark the reply received in Emails, or forget the questions below.' : undefined} onClick={() => void suggest()}>
          {aiWorking ? 'Working…' : 'Suggest with AI'}</button>
        <button className="btn" data-action="tools-add" disabled={off || rows.length >= 12} onClick={() => { setRows((rs) => [...rs, emptyRow()]); setDirty(true); }}>Add feature</button>
        {aiWorking && <span className="ai-busy" role="status">{AI_WAIT}</span>}
      </div>
      {asked && (
        <div className="tp-asked" data-testid="tool-questions">
          <div className="tp-asked-h">Asked the team {asked.at} <span className="sec-n">{waiting ? 'waiting for the reply' : 'reply received'}</span></div>
          <ol>{askedWithAnswers(asked.questions, idea).map((x, i) => (
            <li key={i}>{x.question}{x.answer && <div className="tp-answer" data-testid="tool-answer">↳ {x.answer}</div>}</li>
          ))}</ol>
          <div className="hint">All in one questions email (E2), sent from ✉ Emails. {waiting ? 'The AI suggests nothing until the team replies; you can still pick by hand.' : 'The answers go to the AI with the form: press Suggest with AI again, or pick by hand.'}
            {' '}<button className="link-btn" data-action="tools-forget" disabled={off} onClick={() => void forget()}>Forget these questions</button></div>
        </div>
      )}
      {!design ? <div className="hint">Loading…</div> : rows.length === 0 ? (
        <div className="hint">No features yet. Add one by hand, or ask the AI to suggest some.</div>
      ) : (
        <ul className="tp-rows" aria-label="Features and tools">
          {rows.map((r) => (
            <li key={r.key} className={`tp-row${r.suggested ? ' suggested' : ''}`} data-feature={r.name}>
              <div className="tp-r1">
                <input type="text" className="tp-name" value={r.name} placeholder="Feature name" aria-label="Feature name" disabled={off}
                  onChange={(e) => edit(r.key, { name: e.target.value })} />
                <select className="tp-tool" value={r.tool} aria-label={`Tool for ${r.name || 'this feature'}`} disabled={off} data-action="tool"
                  onChange={(e) => edit(r.key, { tool: e.target.value })}>
                  <option value="">Pick a tool…</option>
                  {tools.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <button className="tp-x" aria-label={`Remove ${r.name || 'this feature'}`} title="Remove" disabled={off}
                  onClick={() => { setRows((rs) => rs.filter((x) => x.key !== r.key)); setDirty(true); }}>×</button>
              </div>
              <input type="text" className="tp-what" value={r.what} placeholder="What it does, in one line" aria-label="What it does" disabled={off}
                onChange={(e) => edit(r.key, { what: e.target.value })} />
              {(r.tool || r.flags.length > 0) && (
                <div className="tp-r3">
                  {r.tool && <span className="tp-path">{pathwayText(r.tool, builder)}</span>}
                  {r.flags.map((f) => <span key={f} className="tp-flag">{flagWord(f)}</span>)}
                </div>
              )}
              {r.reason && <div className="tp-why">{r.reason}</div>}
              {r.context.length > 0 && (
                <details className="tp-ctx" open={r.suggested} data-testid="tool-context">
                  <summary>Why this tool</summary>
                  <ul>{r.context.map((c, i) => <li key={i}>{c}</li>)}</ul>
                </details>
              )}
              {r.tool === CUSTOM_APP && <div className="tp-csic" data-testid="csic-note">{CUSTOM_APP_NOTE}</div>}
            </li>
          ))}
        </ul>
      )}
      {rows.some((r) => r.suggested) && <div className="sg-by">Suggested by the AI. Check each row, change what you like, then save.</div>}
      {dirty && (
        <div className="rv-foot">
          <span className={`hint${problem ? ' warn' : ''}`}>{problem ?? 'Saving writes approach.md and links each feature to its tool.'}</span>
          <span className="tp-acts">
            <button className="btn ghost" data-action="tools-undo" disabled={off} onClick={() => { setRows(featureRows(saved, { tools })); setDirty(false); }}>Undo changes</button>
            <button className="btn primary" data-action="tools-save" disabled={off || Boolean(problem)} onClick={() => void save()}>Save</button>
          </span>
        </div>
      )}
    </section>
  );
}
