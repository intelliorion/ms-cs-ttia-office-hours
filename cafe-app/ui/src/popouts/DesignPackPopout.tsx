import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { designPost, ideaGet, post } from '../api';
import { NO_AI_TIP } from './aiUi';
import { DesignDiagram } from './DesignDiagram';
import { isStale, plainDiagram } from '../../../src/design/diagram';
import { Modal } from './Modal';
import { fileNote, FLOW_HTML, FLOW_JSON, kitSlug, packFiles, pointRows, opensInTab, diagramUrl } from './designPack';
import { RecipeFlowDiagram } from './RecipeFlowDiagram';
import { checkFlow, type RecipeFlow } from '../../../src/design/recipeFlow';
import { approvedTools, FIT_MARK, retiredNote, scopeLabel } from '../panels/designHelpers';
import { columnRows, dataPhase, KIND_LABELS, meaningWithCodes, sizeWords, whatOf } from '../panels/dataHelpers';

/**
 * Everything the design series made for one idea, laid out to read: the proof of concept, the tool with its pros and
 * cons, and each file it wrote with what it is and how to use it (open any one to read it here).
 */
export function DesignPackPopout({ id }: { id: string }) {
  const { state, closePopout, ai } = useStore();
  const noAi = !ai?.provider;
  const [drawing, setDrawing] = useState(false);
  const idea = (state?.ideas ?? []).find((i: any) => i.id === id);
  const [design, setDesign] = useState<any>(null);
  const [plan, setPlan] = useState<{ files: string[]; older?: string[] } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [open, setOpen] = useState<Record<string, string | undefined>>({});
  const [flow, setFlow] = useState<RecipeFlow | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    ideaGet(id, 'design').then((d) => { if (live) setDesign(d); }, () => {});
    ideaGet(id, 'plan').then((p) => { if (live) setPlan(p); }, () => {});
    return () => { live = false; };
  }, [id]);
  const s = design?.state;
  const steps: any[] = s?.steps ?? [];
  const features: any[] = s?.features ?? [];
  const tool: any = s?.tool;
  const data: any = s?.data;
  const main = kitSlug(tool?.tool);
  // The design's files only: the roadshow has its own section in Launch and Learn, with Present, the script and the exports.
  // Older kit files (written before the app kept its list of what it wrote) are listed apart, for the operator to remove.
  const older = plan?.older ?? [];
  const files = packFiles((plan?.files ?? []).filter((f) => !older.includes(f)), features.length > 0 || Boolean(tool), main, Boolean(s?.diagram));
  const removeOlder = async () => {
    setRemoving(true); setMsg(null);
    try { const r = await post(`/api/ideas/${encodeURIComponent(id)}/plan/remove-older`); setPlan(r); setMsg(`${r.removed.length} older kit file${r.removed.length === 1 ? '' : 's'} removed.`); }
    catch (e) { setMsg((e as Error).message); }
    finally { setRemoving(false); }
  };
  // The Dataiku kit's recipe flow, drawn here from its flow.json (checked again, as the server checked it).
  const hasFlow = (plan?.files ?? []).includes(FLOW_JSON);
  const featureNames = features.map((f) => String(f.name)).join('\n');
  useEffect(() => {
    let live = true;
    if (!hasFlow) { setFlow(null); return; }
    post(`/api/ideas/${encodeURIComponent(id)}/design-file`, { path: FLOW_JSON }).then((r) => {
      if (!live) return;
      try { const raw = JSON.parse(r.text); setFlow(checkFlow(raw, String(raw?.project ?? ''), featureNames.split('\n').filter(Boolean)) ?? null); } catch { setFlow(null); }
    }, () => {});
    return () => { live = false; };
  }, [id, hasFlow, featureNames]);
  // The AI's diagram when there is one, else a plain one drawn here from the design, so the pack never shows nothing.
  const stored = s?.diagram;
  const spec = stored?.spec ?? (s ? plainDiagram(s) : null);
  const stale = Boolean(s && stored && isStale(stored, s));
  const redraw = async () => {
    setDrawing(true); setMsg(null);
    try { const r = await designPost(id, 'design/diagram'); setDesign((d: any) => ({ ...d, state: r.state })); setMsg('Diagram redrawn.'); }
    catch (e) { setMsg((e as Error).message); }
    finally { setDrawing(false); }
  };
  const view = async (f: string) => {
    if (open[f] !== undefined) { setOpen((o) => ({ ...o, [f]: undefined })); return; }
    try { const r = await post(`/api/ideas/${encodeURIComponent(id)}/design-file`, { path: f }); setOpen((o) => ({ ...o, [f]: r.text })); }
    catch (e) { setMsg((e as Error).message); }
  };
  const openFolder = async () => {
    try { const r = await post(`/api/ideas/${encodeURIComponent(id)}/open-folder`); setMsg(`Opened ${r.folder}.`); }
    catch (e) { setMsg((e as Error).message); }
  };
  const title = <><div className="pop-id">{id}</div><h2>{idea?.title ?? 'The design'}</h2></>;
  return (
    <Modal title={title} label="The design" onClose={closePopout} width={1180} height={880}
      actions={<button className="btn" data-action="open-idea-folder" onClick={() => void openFolder()}>Open the folder</button>}>
      {msg && <div className="pop-strip"><div className="pop-notice ok" role="status">{msg}</div></div>}
      {!s ? <div className="hint" style={{ padding: 24 }}>Loading…</div> : (
        <div className="dp-body" data-testid="design-pack">
          <section className="sec dp-sec">
            <h3>The proof of concept <span className="sec-n">{s.approvedAt ? `approved ${s.approvedAt}` : 'complete, not approved yet'}</span></h3>
            {s.summary && <p className="dp-summary">{s.summary}</p>}
            <dl className="dp-settles">
              {pointRows(s, 'base').filter((r) => !r.open).map((r) => <div key={r.tag} data-point={r.tag}><dt>{r.label}</dt><dd>{r.text}</dd></div>)}
            </dl>
          </section>
          <section className="sec dp-sec" data-testid="pack-build">
            <h3>To build it <span className="sec-n">what the builder needs before the first session</span></h3>
            <dl className="dp-settles">
              {pointRows(s, 'build').map((r) => (
                <div key={r.tag} data-point={r.tag} className={r.open ? 'open' : undefined}>
                  <dt>{r.label}</dt>
                  <dd>{r.text}{r.open && r.hint && <span className="dp-hint"> {r.hint}</span>}</dd>
                </div>
              ))}
            </dl>
          </section>
          {data && (data.files?.length > 0 || data.steps?.length > 0) && (
            <section className="sec dp-sec" data-testid="pack-data">
              <h3>The data <span className="sec-n">{dataPhase(data).word}</span></h3>
              {!data.confirmedAt && <div className="hint warn">Not confirmed yet: the features, the tool, the design and the kits do not use it until it is confirmed in the Data step.</div>}
              {data.summary?.text && <p className="dp-summary">{data.summary.text}</p>}
              <ul className="dp-data">
                {data.files.map((f: any) => {
                  const cols = columnRows(f);
                  const issues = [...(f.tables ?? []).flatMap((t: any) => t.issues), ...(f.understanding?.issues ?? [])];
                  return (
                    <li key={f.id} data-file={f.id}>
                      <div className="dp-file-h"><span className="dp-file-t">{f.name}</span><span className="sec-n">{KIND_LABELS[f.kind as keyof typeof KIND_LABELS]}{sizeWords(f) ? ` · ${sizeWords(f)}` : ''}</span></div>
                      {f.check?.status === 'held' ? <div className="hint warn">Held: it may hold personal data, so nothing in it is used.</div> : (
                        <>
                          {whatOf(f) && <div className="dp-file-u">{whatOf(f)}</div>}
                          {cols.length > 0 && <dl className="dp-settles dp-cols">{cols.map((c) => <div key={c.name}><dt><code>{c.name}</code> {c.type}</dt><dd>{meaningWithCodes(c.meaning || '(meaning not said)', c.codes)}</dd></div>)}</dl>}
                          {f.understanding?.rules?.length > 0 && <div className="dp-file-u">Rules: {f.understanding.rules.map((r: any) => String(r.rule).replace(/[.;\s]+$/, '')).join('; ')}</div>}
                          {f.understanding?.derivations?.length > 0 && <div className="dp-file-u">How the output is worked out: {f.understanding.derivations.map((x: any) => `${x.output}: ${String(x.how).replace(/[.;\s]+$/, '')}`).join('; ')}</div>}
                          {issues.length > 0 && <div className="hint warn">Issues: {issues.slice(0, 6).map((x: string) => x.replace(/[.;\s]+$/, '')).join('; ')}</div>}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {spec && (
            <section className="sec dp-sec" data-testid="pack-diagram">
              <h3>The design, drawn <span className="sec-n">{stored ? `drawn by the AI${stored.at ? ` on ${stored.at}` : ''}` : 'a plain diagram from the design'}</span></h3>
              {(stale || !stored) && (
                <div className={`hint dd-note${stale ? ' warn' : ''}`} data-testid={stale ? 'diagram-stale' : 'diagram-plain'}>
                  {stale ? 'The design changed since this was drawn.' : 'Drawn from the features and the answers. The AI can draw it in more detail.'}{' '}
                  <button className="link-btn" data-action="diagram-redraw" disabled={noAi || drawing || !s.summary} title={noAi ? NO_AI_TIP : !s.summary ? 'Finish the design first' : undefined}
                    onClick={() => void redraw()}>{drawing ? 'Drawing…' : stored ? 'Redraw' : 'Draw it with AI'}</button>
                </div>
              )}
              {stored && !stale && (
                <div className="dd-redraw"><button className="link-btn" data-action="diagram-redraw" disabled={noAi || drawing} title={noAi ? NO_AI_TIP : undefined} onClick={() => void redraw()}>{drawing ? 'Drawing…' : 'Redraw'}</button></div>
              )}
              <DesignDiagram spec={spec} ctx={{ features, fit: tool?.fit ?? [], steps, tool: tool?.tool }} />
            </section>
          )}
          {(features.length > 0 || tool) && (
            <section className="sec dp-sec">
              <h3>The tool</h3>
              <div className="dp-tool">
                <div className="dp-tool-h"><b>{tool?.tool ?? 'No tool yet'}</b>{tool?.pathway && <span className="sec-n"> {tool.pathway}</span>}</div>
                {retiredNote(tool, approvedTools(state)) && <div className="hint warn" data-testid="pack-tool-retired">{retiredNote(tool, approvedTools(state))}</div>}
                {tool?.reason && <div className="dp-why">{tool.reason}</div>}
                {(tool?.pros?.length > 0 || tool?.cons?.length > 0) && (
                  <div className="tp-pc">
                    {tool.pros?.length > 0 && <div className="tp-pros"><div className="tp-pc-h">Pros</div><ul>{tool.pros.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul></div>}
                    {tool.cons?.length > 0 && <div className="tp-cons"><div className="tp-pc-h">Cons: what it can't do</div><ul>{tool.cons.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul></div>}
                  </div>
                )}
                {features.length > 0 && (
                  <ul className="tp-fit" data-testid="pack-fit" aria-label="The features and how the tool fits each">
                    {features.map((f) => {
                      const x = (tool?.fit ?? []).find((y: any) => y.feature?.toLowerCase() === String(f.name).toLowerCase());
                      if (f.scope) {
                        return (
                          <li key={f.id ?? f.name} data-fit={f.scope.status} data-scope={f.scope.status} className={`scope-${f.scope.status}`}>
                            <span className={`tp-fit-m ${f.scope.status}`}>{f.scope.status === 'out' ? 'out' : 'other'}</span>
                            <span className="tp-fit-f">{f.name}</span>
                            <span className="tp-fit-n">{scopeLabel(f.scope, tool?.tool)}{f.scope.why ? `: ${f.scope.why}` : ''}</span>
                          </li>
                        );
                      }
                      return (
                        <li key={f.id ?? f.name} data-fit={x?.fit ?? 'unknown'}>
                          <span className={`tp-fit-m ${x?.fit ?? 'unknown'}`}>{x ? FIT_MARK[x.fit] : '–'}</span>
                          <span className="tp-fit-f">{f.name}</span>
                          <span className="tp-fit-n">{x?.note || f.what || ''}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>
          )}
          {flow && (
            <section className="sec dp-sec" data-testid="pack-recipe-flow">
              <h3>Starter kit: the Dataiku recipe flow <span className="sec-n">{FLOW_HTML}</span></h3>
              <p className="dp-summary">The recipes in the Dataiku kit, as Dataiku draws its Flow: the sample and the rules sheet go in, each recipe's steps are in flow.md, and the outputs come out.</p>
              <RecipeFlowDiagram flow={flow} />
            </section>
          )}
          <section className="sec dp-sec">
            <h3>How to use this pack</h3>
            <ol className="dp-how">
              <li>Share <b>design.md</b> with the team before the first design session, so everyone builds the same thing.</li>
              <li>The builder reads <b>approach.md</b> for the tool, its limits and how to cover them.</li>
              {files.includes('plan.md')
                ? <li>Work through <b>plan.md</b> task by task in the sessions, using the <b>starter kit</b> for the tool; tick each task off when its "done when" is true.</li>
                : <li>Approve the design, then write the plan and kits: <b>plan.md</b> and a <b>starter kit</b> for the tool.</li>}
              <li>Run it only on sample, synthetic or aggregated data. Anything flagged for the CSIC Repository goes there, not into the Café build.</li>
            </ol>
          </section>
          <section className="sec dp-sec">
            <h3>Files <span className="sec-n">{files.length + (data?.files?.length ?? 0)} in the idea's folder</span></h3>
            <ul className="dp-files">
              {files.map((f) => {
                const n = fileNote(f, main);
                return (
                  <li key={f} data-file={f}>
                    <div className="dp-file-h">
                      <span className="dp-file-t">{n.title}</span>
                      <code>{f}</code>
                      {opensInTab(f)
                        ? <button className="link-btn" data-action="open-file" onClick={() => window.open(diagramUrl(id, f), '_blank', 'noopener')}>Open</button>
                        : <button className="link-btn" data-action="view-file" onClick={() => void view(f)}>{open[f] !== undefined ? 'Hide' : 'Read it'}</button>}
                    </div>
                    {n.use && <div className="dp-file-u">{n.use}</div>}
                    {open[f] !== undefined && <pre className="dp-file-text">{open[f]}</pre>}
                  </li>
                );
              })}
              {(data?.files ?? []).map((f: any) => (
                <li key={f.id} data-file={`data-files/${f.file}`}>
                  <div className="dp-file-h"><span className="dp-file-t">The team's data: {KIND_LABELS[f.kind as keyof typeof KIND_LABELS]}</span><code>data-files/{f.file}</code></div>
                  <div className="dp-file-u">{whatOf(f) ?? f.name}. A copy of what the team gave, checked for personal data; its summary is in design.md's Data section. Open the folder to see it.</div>
                </li>
              ))}
            </ul>
            {older.length > 0 && (
              <div className="dp-older" data-testid="older-kit-files">
                <div className="dp-file-t">Older kit files</div>
                <div className="dp-file-u">The kits had these files before the layout changed, and the plan no longer writes them. They may be out of date, or you may have edited them: remove them when you no longer need them.</div>
                <ul className="dp-older-list">{older.map((f) => <li key={f}><code>{f}</code></li>)}</ul>
                <button className="btn sm" data-action="remove-older-kit-files" disabled={removing} onClick={() => void removeOlder()}>{removing ? 'Removing…' : 'Remove older kit files'}</button>
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
