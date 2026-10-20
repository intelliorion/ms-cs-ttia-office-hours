import { useEffect, useState } from 'react';
import { designPost } from '../api';
import { useStore } from '../state/store';
import { NO_AI_TIP } from '../popouts/aiUi';
import {
  AI_WAIT, approvedTools, CUSTOM_APP, CUSTOM_APP_NOTE, emptyRow, featureRows, features, flagsFor, flagWord, mergeRows,
  pathwayText, picksBody, picksProblem, type FeatureRow,
} from './designHelpers';
import type { DesignCall, DesignView } from './DesignSection';

/**
 * Tool picker: one row per feature (name, what, approved tool, pathway, flags). "Suggest with AI" adds rows marked
 * as suggestions; nothing is saved until Save. A custom-app pick carries the CSIC note.
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
      ai: 'tools', ok: (x: any) => `Features suggested by ${aiName(x.provider)}. Nothing is saved until you press Save.`,
    });
    if (r) { setRows((rs) => mergeRows(rs, featureRows(r.features, { fromAi: true, tools }))); setDirty(true); }
  };
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
        <button className="btn" data-action="tools-suggest" disabled={noAi || off || !design} title={noAi ? NO_AI_TIP : undefined} onClick={() => void suggest()}>
          {aiWorking ? 'Working…' : 'Suggest with AI'}</button>
        <button className="btn" data-action="tools-add" disabled={off || rows.length >= 12} onClick={() => { setRows((rs) => [...rs, emptyRow()]); setDirty(true); }}>Add feature</button>
        {aiWorking && <span className="ai-busy" role="status">{AI_WAIT}</span>}
      </div>
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
