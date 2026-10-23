import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { ideaGet, ideaPost, post } from '../api';
import { NO_AI_TIP, providerName } from '../popouts/aiUi';
import { ideaCardModel } from '../popouts/ideaHelpers';
import { RoundChip, StageButton } from '../popouts/IdeaSections';
import { ReviewSelect } from './ReviewSelect';
import { EmailMenu } from './EmailMenu';
import { downloadEml, openedText } from './outlook';
import { ToolPickerSection } from './ToolPickerSection';
import { DesignSection, PlanSection, type DesignCall, type DesignView, type PlanView } from './DesignSection';
import { sectionsFor, type SectionKey } from './stageGate';
import { DesignCard, PlanCard, ReviewCard, ToolsCard } from './StageSummaries';

/**
 * One idea, in the left panel in place of the list: what to do now. Back, its ID, round and stage, then the suggestion
 * strip, the action sections the stage calls for (Decision at stage 2; Tool picker, Design, Plan and kits at stage 3;
 * cards for the earlier ones after that). Emails open in Outlook from the head's Email menu and the sections' own
 * buttons; the Outbox keeps every one. What was submitted, its links and its history are on the right
 * (ContextPanels); the universe beside it stays focused on its star.
 */
export function IdeaDetails({ id }: { id: string }) {
  const { state, graph, refresh, openPopout, backToList, notice, setNotice, suggest, setSuggest, ai } = useStore();
  const [aiBusy, setAiBusy] = useState(false);
  const idea = state?.ideas.find((i: any) => i.id === id);
  const [busy, setBusy] = useState(false);
  /** The email just opened in Outlook (and counted as sent), for the notice's Undo. */
  const [undoKey, setUndoKey] = useState<string | null>(null);
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
    setNotice(null); setUndoKey(null); setEditing([]);
    scroller.current?.scrollTo({ top: 0 });
    backBtn.current?.focus({ preventScroll: true });
  }, [id, setNotice]);

  /** Runs one change, says what happened in plain words, then refreshes state, graph and history. */
  const act = async <T,>(fn: () => Promise<T>, ok: (r: T) => string | undefined) => {
    if (busy) return;
    setBusy(true); setUndoKey(null);
    try {
      const r = await fn();
      const t = ok(r);
      setNotice(t ? { text: t, kind: 'ok' } : null);
      const s = (r as any)?.suggest;
      if (s) setSuggest({ id, ...s });
    } catch (e) {
      const msg = (e as Error).message;
      // A setting the email needs (such as your signature name) is set in Rounds; say where.
      setNotice({ text: msg.startsWith('Set first:') ? `${msg}. Set it in Rounds, then try again.` : msg, kind: 'error' });
    }
    await refresh();
    setBusy(false);
  };

  const noAi = !ai?.provider;
  /** One AI call at a time: it can take a minute and holds the server's write lock. */
  const runAi = async (url: string, onOk: (r: any) => void) => {
    if (aiBusy || busy || noAi) return;
    setAiBusy(true); setNotice(null);
    try { onOk(await post(url, { id })); }
    catch (e) { setNotice({ text: (e as Error).message, kind: 'error' }); }
    await refresh();
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
    try { await Promise.all([refresh(), loadDesign()]); } finally {
      inFlight.current = false;
      if (o.ai) { setAiBusy(false); setAiFor(null); } else setBusy(false);
    }
    return out;
  };
  const hadPrep = Boolean(idea?.prep);
  const suggestReview = () => runAi('/api/ai/review-suggest', (r) => {
    const open = (r.needs ?? []).filter((n: any) => !n.met).length;
    setNotice({ text: `${hadPrep ? 'Re-evaluated' : 'Suggested'} by ${providerName(r.provider, ai)}: ${open ? `${open} thing${open > 1 ? 's' : ''} to find out first` : 'nothing more needed, ready to decide'}. Nothing is saved until you press Save decision.`, kind: 'ok' });
  });
  /** An email went to Outlook: the file is downloaded, the notice says so and offers Undo. */
  const opened = (o: any) => { downloadEml(o); setUndoKey(o.email.key); return o; };
  const answer = async (need: string, text: string) => {
    try { await post(`/api/ideas/${encodeURIComponent(id)}/prep/answer`, { need, answer: text }); }
    catch (e) { setNotice({ text: (e as Error).message, kind: 'error' }); }
    await refresh();
  };
  const openTemplate = (template: string) => void act(
    async () => opened(await post(`/api/ideas/${encodeURIComponent(id)}/email-open`, { template })), (o: any) => openedText(o.email.template));
  const undoOpen = (key: string) => void act(() => post('/api/outbox/unopen', { key }), (r: any) => `Undone: ${r.template} is back in the Outbox, not sent.`);

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
  const gates = sectionsFor(idea, design?.state, editing, plan);
  const edit = (k: SectionKey) => (idea.closed ? undefined : () => setEditing((xs) => (xs.includes(k) ? xs : [...xs, k])));
  const mine = suggest && suggest.id === id ? suggest : null;

  return (
    <div className="idea-detail" data-testid="idea-details" role="region" aria-label={`${idea.id} ${idea.title}`}>
      {head(<>
        <RoundChip ideaId={id} round={idea.round ?? ''} onDone={() => void refresh()} />
        <StageButton state={state} value={stageValue} label={m.stageLabel} colour={m.stageColour} busy={busy} onPick={setStage} />
      </>)}
      <h3 className="id-title">{idea.title || 'Untitled idea'}</h3>
      <div className="pop-sub">
        {[idea.function, idea.region, idea.participation].filter(Boolean).join(' · ') || 'Function and region not given'}
        {idea.flags?.length > 0 && <span className="flagn" title={idea.flags.join('\n')}>⚑ {idea.flags.length} flag{idea.flags.length > 1 ? 's' : ''}</span>}
        <EmailMenu idea={idea} steps={state.steps ?? []} busy={busy} onOpen={openTemplate} onOutbox={() => openPopout({ kind: 'outbox' })} />
      </div>
      {(mine || notice || (!idea.closed && idea.overdue?.length > 0)) && (
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
          {notice && (
            <div className={`pop-notice ${notice.kind ?? 'ok'}`} role="status">
              {notice.text}
              {undoKey && notice.kind !== 'error' && <> <button className="link-btn" data-action="undo-open" disabled={busy} onClick={() => undoOpen(undoKey)}>Undo</button></>}
            </div>
          )}
          {!idea.closed && idea.overdue?.map((o: any) => <div key={o.step} className="late">{o.text}</div>)}
        </div>
      )}
      <div className="id-scroll" ref={scroller}>
        {gates.review === 'active' && (
          <ReviewSelect idea={idea} state={state} busy={busy} aiBusy={aiBusy && !aiFor} noAi={noAi} noAiTip={NO_AI_TIP}
            aiName={providerName(idea.prep?.provider, ai)} onSuggest={() => void suggestReview()} onAnswer={answer}
            onDraftEmail={() => void act(async () => opened(await post(`/api/ideas/${encodeURIComponent(id)}/prep/email`)), (o: any) => openedText(o.email.template))}
            onSave={(body) => void act(async () => {
              const r = await ideaPost(id, 'review', body);
              // The decision is saved; its email then goes to Outlook. If it can't yet (a setting missing), it waits in the Outbox.
              try { const o = opened(await post('/api/outbox/open', { key: r.email.key })); return { ...r, opened: o, suggest: o.suggest ?? r.suggest }; }
              catch (e) { return { ...r, openError: (e as Error).message }; }
            }, (r: any) => [
              'Decision saved.',
              r.opened ? openedText(r.email.template) : `${r.email.template} is in the Outbox. ${r.openError}`,
              r.handoff ? 'CSIC handoff written.' : '', ...(r.warnings ?? []),
            ].filter(Boolean).join(' '))} />
        )}
        {gates.review === 'summary' && <ReviewCard idea={idea} state={state} onEdit={edit('review')} />}
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
      </div>
    </div>
  );
}
