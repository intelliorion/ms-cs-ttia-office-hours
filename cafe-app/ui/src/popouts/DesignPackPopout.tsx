import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { ideaGet, post } from '../api';
import { Modal } from './Modal';
import { CafeCheckCard } from '../panels/DesignSection';
import { fileNote, packFiles, pointRows } from './designPack';
import { FIT_MARK, scopeLabel } from '../panels/designHelpers';

/**
 * Everything the design series made for one idea, laid out to read: the proof of concept, the tool with its pros and
 * cons, the Café check, and each file it wrote with what it is and how to use it (open any one to read it here).
 */
export function DesignPackPopout({ id }: { id: string }) {
  const { state, closePopout } = useStore();
  const idea = (state?.ideas ?? []).find((i: any) => i.id === id);
  const [design, setDesign] = useState<any>(null);
  const [plan, setPlan] = useState<{ files: string[] } | null>(null);
  const [open, setOpen] = useState<Record<string, string | undefined>>({});
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
  const files = packFiles(plan?.files ?? [], features.length > 0 || Boolean(tool));
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
    <Modal title={title} label="The design" onClose={closePopout} width={1000} height={860}
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
          {(features.length > 0 || tool) && (
            <section className="sec dp-sec">
              <h3>The tool</h3>
              <div className="dp-tool">
                <div className="dp-tool-h"><b>{tool?.tool ?? 'No tool yet'}</b>{tool?.pathway && <span className="sec-n"> {tool.pathway}</span>}</div>
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
            <h3>Files <span className="sec-n">{files.length} in the idea's folder</span></h3>
            <ul className="dp-files">
              {files.map((f) => {
                const n = fileNote(f);
                return (
                  <li key={f} data-file={f}>
                    <div className="dp-file-h">
                      <span className="dp-file-t">{n.title}</span>
                      <code>{f}</code>
                      <button className="link-btn" data-action="view-file" onClick={() => void view(f)}>{open[f] !== undefined ? 'Hide' : 'Read it'}</button>
                    </div>
                    {n.use && <div className="dp-file-u">{n.use}</div>}
                    {open[f] !== undefined && <pre className="dp-file-text">{open[f]}</pre>}
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="sec dp-sec"><CafeCheckCard check={s.cafeCheck} /></section>
        </div>
      )}
    </Modal>
  );
}
