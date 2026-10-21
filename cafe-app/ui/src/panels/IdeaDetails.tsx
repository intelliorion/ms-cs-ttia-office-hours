import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { copyText, getHistory, ideaGet, ideaPost, post } from '../api';
import { extractNotice, NO_AI_TIP, providerName, type ReviewSuggestion } from '../popouts/aiUi';
import { LinkTable } from '../popouts/LinkTable';
import { APPROVED_NOTICE, approveAndCopy, clipText, ideaCardModel, ideaLinks, type HistoryEntry } from '../popouts/ideaHelpers';
import { Details, Emails, History, Review, StageMenu } from '../popouts/IdeaSections';
import { ToolPickerSection } from './ToolPickerSection';
import { DesignSection, PlanSection, type DesignCall, type DesignView, type PlanView } from './DesignSection';
import { sectionsFor, type SectionKey } from './stageGate';
import { DesignCard, PlanCard, ReviewCard, ToolsCard } from './StageSummaries';

/**
 * One idea, in the left panel in place of the list: Back, its ID and stage, then (one column) the suggestion strip,
 * the action sections the stage calls for (Decision at stage 2; Tool picker, Design, Plan and kits at stage 3; cards for
 * the earlier ones after that), Stage, Emails, Graph links, Details and History. The universe beside it stays focused on its star.
 */
export function IdeaDetails({ id }: { id: string }) {
  const { state, graph, refresh, openPopout, backToList, notice, setNotice, suggest, setSuggest, ai } = useStore();
  const [aiBusy, setAiBusy] = useState(false);
  const [aiReview, setAiReview] = useState<ReviewSuggestion | null>(null);
  const idea = state?.ideas.find((i: any) => i.id === id);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const backBtn = useRef<HTMLButtonElement>(null);
  /** The design series: design.yaml (+ live design.md) and plan.md + kit files, read when the idea opens and after each change. */
  const [design, setDesign] = useState<DesignView | null>(null);
  const [plan, setPlan] = useState<PlanView | null>(null);
  /** Which design section is waiting on the AI ('tools', 'design', 'plan'); null for the Review and Graph AI calls. */
  const [aiFor, setAiFor] = useState<string | null>(null);
  /** Cards the operator reopened with Edit; cleared when another idea opens. */
  const [editing, setEditing] = useState<SectionKey[]>([]);
  const idRef = useRef(id);
  const inFlight = useRef(false);
  idRef.current = id;

  const loadHistory = useCallback(() => getHistory(id).then(setHistory, () => setHistory(null)), [id]);
  const loadDesign = useCallback(async () => {
    const [d, p] = await Promise.all([ideaGet(id, 'design').catch(() => null), ideaGet(id, 'plan').catch(() => null)]);
    if (idRef.current !== id) return; // another idea opened meanwhile
    // A failed re-read keeps what is already shown.
    if (d) setDesign(d);
    if (p) setPlan(p);
  }, [id]);
  useEffect(() => {
    setDesign(null); setPlan(null); void loadDesign();
  }, [loadDesign]);
  useEffect(() => {
    setNotice(null); setFallback(null); setAiReview(null); setEditing([]); void loadHistory();
    scroller.current?.scrollTo({ top: 0 });
    backBtn.current?.focus({ preventScroll: true });
  }, [id, loadHistory, setNotice]);
  useEffect(() => { if (fallback) { fallbackRef.current?.focus(); fallbackRef.current?.select(); } }, [fallback]);

  /** Runs one change, says what happened in plain words, then refreshes state, graph and history. */
  const act = async <T,>(fn: () => Promise<T>, ok: (r: T) => string | undefined) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fn();
      const t = ok(r);
      setNotice(t ? { text: t, kind: 'ok' } : null);
      const s = (r as any)?.suggest;
      if (s) setSuggest({ id, ...s });
    } catch (e) {
      setNotice({ text: (e as Error).message, kind: 'error' });
    }
    await Promise.all([refresh(), loadHistory()]);
    setBusy(false);
  };

  const noAi = !ai?.provider;
  /** One AI call at a time: it can take a minute and holds the server's write lock. */
  const runAi = async (url: string, onOk: (r: any) => void) => {
    if (aiBusy || busy || noAi) return;
    setAiBusy(true); setNotice(null);
    try { onOk(await post(url, { id })); }
    catch (e) { setNotice({ text: (e as Error).message, kind: 'error' }); }
    await Promise.all([refresh(), loadHistory()]);
    setAiBusy(false);
  };
  /** One design-series call: busy (or the AI wait) while it runs, a notice, the CSIC suggestion, then everything re-read. */
  const designCall: DesignCall = async (fn, o) => {
    // A ref, not only state: two clicks in one frame must not both get through.
    if (inFlight.current || busy || aiBusy || (o.ai && noAi)) return null;
    inFlight.current = true;
    if (o.ai) { setAiBusy(true); setAiFor(o.ai); } else setBusy(true);
    setNotice(null);
    let out = null;
    try {
      const r: any = await fn();
      out = r;
      if (r?.state && typeof r.designMd === 'string' && idRef.current === id) setDesign({ state: r.state, designMd: r.designMd });
      const t = o.ok(r);
      if (idRef.current === id) {
        setNotice(t ? { text: t, kind: 'ok' } : null);
        if (r?.suggest) setSuggest({ id, ...r.suggest });
      }
    } catch (e) {
      if (idRef.current === id) setNotice({ text: (e as Error).message, kind: 'error' });
    }
    try { await Promise.all([refresh(), loadHistory(), loadDesign()]); } finally {
      inFlight.current = false;
      if (o.ai) { setAiBusy(false); setAiFor(null); } else setBusy(false);
    }
    return out;
  };
  const grow = () => runAi('/api/ai/extract', (r) => setNotice({ text: extractNotice(r), kind: 'ok' }));
  const suggestReview = () => runAi('/api/ai/review-suggest', (r) => {
    setAiReview(r);
    setNotice({ text: `Review suggested by ${providerName(r.provider, ai)}. Nothing is saved until you press Save.`, kind: 'ok' });
  });

  const head = (extra?: React.ReactNode) => (
    <div className="id-head">
      <button ref={backBtn} className="btn back" data-action="back" aria-label="Back to the ideas list" title="Back to the list (Esc)" onClick={backToList}>← Back</button>
      <span className="iid">{id}</span>
      {extra}
    </div>
  );

  if (!state) return null;
  if (!idea) {
    return (
      <div className="idea-detail" data-testid="idea-details" role="region" aria-label={id}>
        {head()}
        <p className="hint">This idea is no longer in the workspace.</p>
      </div>
    );
  }

  const m = ideaCardModel(idea, graph, state.outbox ?? []);
  const where = (t: { stage?: number; closeAs?: string }) =>
    t.closeAs ? `Closed: ${state.closures[t.closeAs]}` : `Moved to ${state.stageNames[t.stage!]}`;
  // The suggestion goes away only once the move is saved; on failure it stays so the operator can try again.
  const setStage = (t: { stage?: number; closeAs?: string }) =>
    void act(async () => {
      const r = await ideaPost(id, 'stage', t.closeAs ? { closeAs: t.closeAs } : { stage: t.stage });
      setSuggest(null);
      return r;
    }, () => `${where(t)}.`);
  const stageValue = idea.closed ? `close:${idea.closed.as}` : `stage:${idea.stage}`;
  const gates = sectionsFor(idea, design?.state, editing);
  const edit = (k: SectionKey) => (idea.closed ? undefined : () => setEditing((xs) => (xs.includes(k) ? xs : [...xs, k])));
  const mine = suggest && suggest.id === id ? suggest : null;
  const links = ideaLinks(graph, id);

  return (
    <div className="idea-detail" data-testid="idea-details" role="region" aria-label={`${idea.id} ${idea.title}`}>
      {head(<span className="stg" style={{ ['--c' as string]: m.stageColour }}>{m.stageLabel}</span>)}
      <h3 className="id-title">{idea.title || 'Untitled idea'}</h3>
      <div className="pop-sub">
        {[idea.function, idea.region, idea.participation].filter(Boolean).join(' · ') || 'Function and region not given'}
        {idea.flags?.length > 0 && <span className="flagn" title={idea.flags.join('\n')}>⚑ {idea.flags.length} flag{idea.flags.length > 1 ? 's' : ''}</span>}
      </div>
      {(mine || notice || fallback || (!idea.closed && idea.overdue?.length > 0)) && (
        <div className="pop-strip">
          {mine && (
            <div className="suggest-bar" role="group" aria-label="Suggested move" data-testid="suggest">
              <span className="sg-k">Suggested</span>
              <span className="sg-t">{mine.label}</span>
              <button className="btn primary" data-action="suggest-yes" disabled={busy}
                onClick={() => setStage(mine.closeAs ? { closeAs: mine.closeAs } : { stage: mine.stage })}>Yes</button>
              <button className="btn" data-action="suggest-no" onClick={() => setSuggest(null)}>No</button>
            </div>
          )}
          {notice && <div className={`pop-notice ${notice.kind ?? 'ok'}`} role="status">{notice.text}</div>}
          {fallback && (
            <div className="copy-fallback">
              <div>The browser would not copy. The email is selected below: press Ctrl+C (⌘C on a Mac).</div>
              <textarea ref={fallbackRef} readOnly value={fallback} rows={4} aria-label="Email text to copy" />
            </div>
          )}
          {!idea.closed && idea.overdue?.map((o: any) => <div key={o.step} className="late">{o.text}</div>)}
        </div>
      )}
      <div className="id-scroll" ref={scroller}>
        {gates.review === 'active' && (
          <Review idea={idea} state={state} busy={busy || aiBusy} aiReview={aiReview} aiName={providerName(aiReview?.provider, ai)}
            onClearAi={() => setAiReview(null)} aiBar={(
              <div className="ai-row">
                <button className="btn" data-action="ai-suggest-review" disabled={noAi || aiBusy || busy || Boolean(idea.closed)} title={noAi ? NO_AI_TIP : undefined} onClick={() => void suggestReview()}>
                  {aiBusy && !aiFor ? 'Working…' : 'Suggest a decision'}</button>
              </div>
            )}
            onSave={(body) => act(() => ideaPost(id, 'review', body), (r: any) =>
              [`Saved. ${r.email.template} is drafted in the Outbox.`, r.handoff ? 'CSIC handoff written.' : '', ...(r.warnings ?? [])].filter(Boolean).join(' '))} />
        )}
        {gates.review === 'summary' && <ReviewCard idea={idea} state={state} onEdit={edit('review')} />}
        {idea.stage === 1 && !idea.closed && (
          <section className="sec"><h3>Next</h3><div className="hint">Send the acknowledgement (E1) from Emails below. The decision opens at stage 2.</div></section>
        )}
        {gates.tools === 'active' && (
          <ToolPickerSection key={`tools-${id}`} idea={idea} design={design} busy={busy || (aiBusy && aiFor !== 'tools')} aiWorking={aiFor === 'tools'}
            noAi={noAi} aiName={(p) => providerName(p, ai)} call={designCall} />
        )}
        {gates.tools === 'summary' && <ToolsCard design={design} onEdit={edit('tools')} />}
        {gates.design === 'active' && (
          <DesignSection key={`design-${id}`} idea={idea} design={design} busy={busy || (aiBusy && aiFor !== 'design')} aiWorking={aiFor === 'design'}
            noAi={noAi} call={designCall} onOutbox={() => openPopout({ kind: 'outbox' })} />
        )}
        {gates.design === 'summary' && <DesignCard design={design} onEdit={edit('design')} />}
        {gates.plan === 'active' && (
          <PlanSection key={`plan-${id}`} idea={idea} design={design} plan={plan} busy={busy || (aiBusy && aiFor !== 'plan')} aiWorking={aiFor === 'plan'}
            noAi={noAi} call={designCall} />
        )}
        {gates.plan === 'summary' && <PlanCard plan={plan} onEdit={edit('plan')} />}
        <section className="sec">
          <h3>Stage</h3>
          <StageMenu state={state} value={stageValue} busy={busy} onPick={setStage} />
        </section>
        <Emails idea={idea} outbox={state.outbox ?? []} busy={busy}
          onDraft={(template) => act(() => ideaPost(id, 'draft', { template }), (r: any) => `${r.template} is drafted in the Outbox.`)}
          onReply={() => act(() => ideaPost(id, 'reply'), () => 'Reply received. The answers step is done.')}
          onSetFirst={() => openPopout({ kind: 'round' })}
          onApprove={(key) => act(async () => {
            setFallback(null);
            const r = await approveAndCopy(key);
            setFallback(r.fallback);
            return r.item;
          }, (r: any) => APPROVED_NOTICE(r.template))}
          onCopy={async (mm) => { const text = clipText(mm.view); if (await copyText(text)) setNotice({ text: `${mm.template} copied again.`, kind: 'ok' }); else setFallback(text); }}
          onSent={(key) => act(() => post('/api/outbox/sent', { key }), (r: any) => `${r.template} marked sent.`)} />
        <section className="sec">
          <h3>Graph <span className="sec-n">{links.length} links</span></h3>
          <div className="ai-row">
            <button className="btn" data-action="ai-grow" disabled={noAi || aiBusy || busy} title={noAi ? NO_AI_TIP : undefined} onClick={() => void grow()}>
              {aiBusy && !aiFor ? 'Working…' : 'Grow the universe from this idea'}</button>
            {aiBusy && !aiFor && <span className="ai-busy" role="status">Asking the AI, this can take a minute…</span>}
          </div>
          <LinkTable rows={links} busy={busy} compact
            onConfirm={(edgeId) => act(() => post('/api/graph/confirm', { edgeId }), () => 'Link confirmed.')}
            onRemove={(edgeId) => act(() => post('/api/graph/remove', { edgeId }), () => 'Link removed.')} />
        </section>
        <Details idea={idea} />
        <History history={history} steps={state.steps} />
      </div>
    </div>
  );
}
