import { shortDate } from './filterIdeas';
import { planStaleText, SeeDesign, type DesignView, type PlanView } from './DesignSection';
import { hasAgentKit } from './designHelpers';

/**
 * Compact read-only cards for sections whose stage has passed: the decision, the tool picks, the design and the plan.
 * Each card carries an Edit link that reopens the full form while the idea is open; a closed idea shows no link.
 */
function Card({ title, note, testId, onEdit, children }: {
  title: string; note?: string; testId: string; onEdit?: () => void; children: React.ReactNode;
}) {
  return (
    <section className="sec sec-card" data-testid={testId}>
      <h3>{title} {note && <span className="sec-n">{note}</span>}
        {onEdit && <button className="link-btn card-edit" data-action={`edit-${testId}`} onClick={onEdit}>Edit</button>}
      </h3>
      {children}
    </section>
  );
}

export function ReviewCard({ idea, state, onEdit }: { idea: any; state: any; onEdit?: () => void }) {
  const r = idea.review;
  const criteria: any[] = state.criteria ?? [];
  const ticked = criteria.filter((c) => r?.criteria?.[c.id]);
  return (
    <Card title="Decision" note={r ? `saved ${shortDate(r.at)}` : undefined} testId="review-card" onEdit={onEdit}>
      {r ? (
        <>
          <div className="card-main">{state.decisions?.[r.decision] ?? r.decision}</div>
          <div className="card-text">{r.reason}</div>
          <div className="hint">{ticked.length ? `Checks passed: ${ticked.map((c) => c.short ?? c.text).join('; ')}.` : 'No checks ticked.'}</div>
        </>
      ) : <div className="hint warn">No decision recorded for this idea. Use Edit to record one; the decision email is drafted from it.</div>}
    </Card>
  );
}

export function ToolsCard({ design, onEdit }: { design: DesignView | null; onEdit?: () => void }) {
  const feats: any[] = design?.state?.features ?? [];
  const tool = design?.state?.tool;
  const note = [feats.length ? `${feats.length} feature${feats.length === 1 ? '' : 's'}` : '', tool?.tool ?? ''].filter(Boolean).join(' · ') || undefined;
  return (
    <Card title="Features and tool" note={note} testId="tools-card" onEdit={onEdit}>
      {!design ? <div className="hint">Reading the design files…</div> : feats.length || tool ? (
        <>
          <div className="card-main">{tool ? `${tool.tool}${tool.pathway ? ` · ${tool.pathway}` : ''}` : 'No tool picked'}</div>
          <ul className="card-list">
            {feats.map((f) => {
              const fit = (tool?.fit ?? []).find((x: any) => x.feature?.toLowerCase() === String(f.name).toLowerCase());
              return <li key={f.id ?? f.name}><span className="card-k">{f.name}</span><span className="card-v">{fit ? (fit.fit === 'yes' ? '✓' : fit.fit === 'no' ? `✗ ${fit.note}` : `partly: ${fit.note}`) : f.what ?? ''}</span></li>;
            })}
          </ul>
        </>
      ) : <div className="hint warn">No features or tool yet. Use Edit to list the features and pick the tool.</div>}
    </Card>
  );
}

export function DesignCard({ id, design, onEdit }: { id: string; design: DesignView | null; onEdit?: () => void }) {
  const s = design?.state ?? {};
  const steps: any[] = s.steps ?? [];
  const note = s.approvedAt ? `approved ${s.approvedAt}` : s.summary ? 'complete, not approved' : `${steps.length} question${steps.length === 1 ? '' : 's'}, not finished`;
  return (
    <Card title="Design" note={note} testId="design-card" onEdit={onEdit}>
      {s.summary ? <div className="card-text">{s.summary}</div> : (
        <ol className="card-list card-steps">
          {steps.map((st) => <li key={st.n}><span className="card-k">{st.question}</span><span className="card-v">{st.answer ?? (st.askedTeam ? 'asked the team' : 'not answered')}</span></li>)}
        </ol>
      )}
      {s.summary && <SeeDesign id={id} />}
    </Card>
  );
}

export function PlanCard({ id, plan, stale, onEdit }: { id: string; plan: PlanView | null; stale?: { at: string; approved: boolean }; onEdit?: () => void }) {
  const files = plan?.files ?? [];
  return (
    <Card title="Plan and kits" note={files.length ? `${files.length} file${files.length === 1 ? '' : 's'}` : undefined} testId="plan-card" onEdit={onEdit}>
      {files.length ? (
        <>
          <ul className="pk-files" aria-label="Plan and kit files">{files.map((f) => <li key={f}>{f}</li>)}</ul>
          {stale && <div className="hint warn" data-testid="plan-stale">{planStaleText(stale.at, stale.approved)}</div>}
          {hasAgentKit(files) && <div className="hint">The custom-app part goes to the CSIC Repository with its build instruction (under Edit).</div>}
          <SeeDesign id={id} />
        </>
      ) : <div className="hint warn">The plan was never written. Use Edit to write plan.md and the kits.</div>}
    </Card>
  );
}
