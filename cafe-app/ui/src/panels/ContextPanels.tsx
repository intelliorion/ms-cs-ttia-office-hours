import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { getHistory, post } from '../api';
import { Panel } from '../layout/Panel';
import { StageChart, SupportChart, FunctionChart } from './Charts';
import { LinkTable } from '../popouts/LinkTable';
import { Details, History } from '../popouts/IdeaSections';
import { ideaCardModel, ideaLinks, nodeLinks, type HistoryEntry } from '../popouts/ideaHelpers';
import { NODE_COLOURS } from '../universe/graphView';
import { NODE_LABELS } from '../../../src/graph/ontology';
import { ideasAround, inCommon, rightContext, type RightContext } from './contextHelpers';

const TOP = { left: 'calc(var(--sw) - 460px)', top: 92, width: 440, height: 460 } as const;
const BOTTOM = { left: 'calc(var(--sw) - 460px)', top: 572, width: 440, height: 'calc(var(--sh) - 592px)' } as const;

export function useRightContext(): RightContext {
  const leftView = useStore((s) => s.leftView);
  const selectedId = useStore((s) => s.selectedId);
  const selectedIds = useStore((s) => s.selectedIds);
  const graph = useStore((s) => s.graph);
  return rightContext({ leftView, selectedId, selectedIds }, graph);
}

/**
 * The right side follows what you are looking at: the overview (Pipeline, Demand) with nothing chosen; an idea's
 * submission and connections when an idea is open or its star is clicked; a star's links and the ideas around it
 * when any other star is clicked.
 */
export function RightPanels() {
  const ctx = useRightContext();
  if (ctx.kind === 'idea') {
    return <>
      <Panel title="Submission" side="right" style={TOP}><IdeaSubmission id={ctx.id} /></Panel>
      <Panel title="Connections" side="right" style={BOTTOM}><IdeaConnections id={ctx.id} /></Panel>
    </>;
  }
  if (ctx.kind === 'multi') {
    return <>
      <Panel title="Selected" side="right" style={TOP}><MultiSelected ids={ctx.ids} /></Panel>
      <Panel title="In common" side="right" style={BOTTOM}><InCommon ids={ctx.ids} /></Panel>
    </>;
  }
  if (ctx.kind === 'star') {
    return <>
      <Panel title="Star" side="right" style={TOP}><StarLinks nodeId={ctx.nodeId} /></Panel>
      <Panel title="Ideas around it" side="right" style={BOTTOM}><IdeasAround nodeId={ctx.nodeId} /></Panel>
    </>;
  }
  return <>
    <Panel title="Pipeline" side="right" style={TOP}><Overview part="pipeline" /></Panel>
    <Panel title="Demand" side="right" style={BOTTOM}><Overview part="demand" /></Panel>
  </>;
}

/** The same content stacked, for the narrow-screen drawer. */
export function ContextStack() {
  const ctx = useRightContext();
  if (ctx.kind === 'idea') return <><div className="sub-h">Submission</div><IdeaSubmission id={ctx.id} /><div className="sub-h">Connections</div><IdeaConnections id={ctx.id} /></>;
  if (ctx.kind === 'multi') return <><MultiSelected ids={ctx.ids} /><div className="sub-h">In common</div><InCommon ids={ctx.ids} /></>;
  if (ctx.kind === 'star') return <><StarLinks nodeId={ctx.nodeId} /><div className="sub-h">Ideas around it</div><IdeasAround nodeId={ctx.nodeId} /></>;
  return <><Overview part="pipeline" /><Overview part="demand" /></>;
}

function Overview({ part }: { part: 'pipeline' | 'demand' }) {
  return part === 'pipeline'
    ? <><div className="sub-h">Ideas by stage</div><StageChart /></>
    : <><div className="sub-h">Support requested</div><SupportChart /><div className="sub-h">Function · region</div><FunctionChart /></>;
}

/** What was submitted: the form's answers, read-only, and the import's flags. */
function IdeaSubmission({ id }: { id: string }) {
  const idea = useStore((s) => s.state?.ideas?.find((i: any) => i.id === id));
  if (!idea) return <p className="hint">This idea is no longer in the workspace.</p>;
  return (
    <div className="ctx-scroll" data-testid="ctx-submission">
      <div className="ctx-title"><span className="iid">{idea.id}</span> {idea.title || 'Untitled idea'}</div>
      {idea.flags?.length > 0 && <ul className="ctx-flags">{idea.flags.map((f: string) => <li key={f}>⚑ {f}</li>)}</ul>}
      <Details idea={idea} />
    </div>
  );
}

/** An idea in the universe: its links and its history, as two tabs. To grow it, ask the command bar ("grow it"). */
function IdeaConnections({ id }: { id: string }) {
  const { graph, state, refresh } = useStore();
  const [tab, setTab] = useState<'links' | 'history'>('links');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  // Re-read the history whenever the workspace changes, so it follows what the left panel does.
  useEffect(() => { let live = true; getHistory(id).then((h) => { if (live) setHistory(h); }, () => { if (live) setHistory(null); }); return () => { live = false; }; }, [id, state]);
  useEffect(() => { setMsg(null); setTab('links'); }, [id]);
  const links = ideaLinks(graph, id);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); setMsg({ text: ok, kind: 'ok' }); } catch (e) { setMsg({ text: (e as Error).message, kind: 'error' }); }
    await refresh(); setBusy(false);
  };
  return (
    <div className="ctx-scroll" data-testid="ctx-connections">
      <div className="ctx-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'links'} className={tab === 'links' ? 'on' : ''} data-tab="links" onClick={() => setTab('links')}>Links <span className="sec-n">{links.length}</span></button>
        <button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'on' : ''} data-tab="history" onClick={() => setTab('history')}>History</button>
      </div>
      {msg && <div className={`pop-notice ${msg.kind}`} role="status">{msg.text}</div>}
      {tab === 'links' ? <>
        <LinkTable rows={links} busy={busy} compact
          onConfirm={(edgeId) => act(() => post('/api/graph/confirm', { edgeId }), 'Link confirmed.')}
          onRemove={(edgeId) => act(() => post('/api/graph/remove', { edgeId }), 'Link removed.')} />
      </> : <History history={history} steps={state?.steps} />}
    </div>
  );
}

/** Any star that is not an idea: what it is, its links and where each came from. */
function StarLinks({ nodeId }: { nodeId: string }) {
  const { graph, refresh, select } = useStore();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  useEffect(() => setMsg(null), [nodeId]);
  const node = graph?.nodes.find((n: any) => n.id === nodeId);
  if (!node) return null;
  const rows = nodeLinks(graph, nodeId);
  const unconfirmed = rows.filter((r) => !r.confirmed).length;
  const act = async (what: 'confirm' | 'remove', edgeId: string) => {
    setBusy(true);
    try { await post(`/api/graph/${what}`, { edgeId }); setMsg({ text: what === 'confirm' ? 'Link confirmed.' : 'Link removed.', kind: 'ok' }); }
    catch (e) { setMsg({ text: (e as Error).message, kind: 'error' }); }
    await refresh(); setBusy(false);
  };
  const colour = (NODE_COLOURS as Record<string, string>)[node.type] ?? '#9fb0ae';
  return (
    <div className="ctx-scroll" data-testid="ctx-star">
      <div className="ctx-star-h">
        <div>
          <div className="nc-type"><span className="dot" style={{ background: colour }} />{NODE_LABELS[node.type as keyof typeof NODE_LABELS] ?? node.type}</div>
          <div className="ctx-star-t">{node.label}</div>
          {node.type === 'Tool' && node.attrs?.approved === false && <span className="tag amber" data-testid="not-approved">Not on the approved list</span>}
          <div className="nc-sub">{rows.length} link{rows.length === 1 ? '' : 's'}{unconfirmed ? ` · ${unconfirmed} unconfirmed` : ''}</div>
        </div>
        <button className="x" aria-label="Back to the overview" title="Back to the overview" onClick={() => select(null)}>✕</button>
      </div>
      {msg && <div className={`pop-notice ${msg.kind}`} role="status">{msg.text}</div>}
      <LinkTable rows={rows} busy={busy} compact onConfirm={(id) => act('confirm', id)} onRemove={(id) => act('remove', id)} />
    </div>
  );
}

/** The ideas a star touches, with how many sit at each stage, each one a click from opening. */
function IdeasAround({ nodeId }: { nodeId: string }) {
  const { graph, state, openIdea } = useStore();
  if (!graph) return null;
  const around = ideasAround(graph, nodeId);
  const rows = around.map((a) => {
    const idea = (state?.ideas ?? []).find((i: any) => `idea:${i.id}` === a.id);
    return idea ? { ...a, idea, m: ideaCardModel(idea, graph, state?.outbox ?? []) } : null;
  }).filter((r): r is NonNullable<typeof r> => !!r);
  if (!rows.length) return <p className="hint" data-testid="ctx-around">No idea links to this star yet.</p>;
  const byStage = new Map<string, number>();
  for (const r of rows) byStage.set(r.m.stageLabel, (byStage.get(r.m.stageLabel) ?? 0) + 1);
  return (
    <div className="ctx-scroll" data-testid="ctx-around">
      <div className="ctx-stages">{[...byStage].map(([s, n]) => <span key={s} className="ctx-stage"><b>{n}</b> {s}</span>)}</div>
      <ul className="ctx-ideas">
        {rows.map((r) => (
          <li key={r.id}>
            <button className="ctx-idea" data-idea={r.idea.id} onClick={() => openIdea(r.idea.id)}>
              <span className="iid">{r.idea.id}</span>
              <span className="ctx-idea-t">{r.m.title}</span>
              <span className="stg" style={{ ['--c' as string]: r.m.stageColour }}>{r.m.stageLabel}</span>
            </button>
            {r.hops === 2 && <span className="ctx-via">through a linked star</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

const dotOf = (type: string) => (NODE_COLOURS as Record<string, string>)[type] ?? '#9fb0ae';
const kindOf = (type: string) => NODE_LABELS[type as keyof typeof NODE_LABELS] ?? type;

/** Two or more stars picked with Ctrl/⌘+click: each one (click to keep just it, ✕ to drop it), and the ideas side by side. */
function MultiSelected({ ids }: { ids: string[] }) {
  const { graph, state, clickStar } = useStore();
  const nodes = ids.map((id) => graph?.nodes.find((n: any) => n.id === id)).filter(Boolean) as any[];
  const ideas = nodes.filter((n) => n.type === 'Idea').map((n) => (state?.ideas ?? []).find((i: any) => `idea:${i.id}` === n.id)).filter(Boolean) as any[];
  const roundName = (id: string) => (state?.rounds ?? []).find((r: any) => r.id === id)?.name ?? '—';
  return (
    <div className="ctx-scroll" data-testid="ctx-multi">
      <div className="hint">Ctrl/⌘+click a star to add it or take it out. A plain click keeps just that one.</div>
      <ul className="ctx-picked">
        {nodes.map((n) => (
          <li key={n.id}>
            <button className="ctx-pick" data-pick={n.id} title="Keep just this one" onClick={() => clickStar(n.id)}>
              <span className="dot" style={{ background: dotOf(n.type) }} /><span className="ctx-pick-t">{n.label}</span><span className="cm-t">{kindOf(n.type)}</span>
            </button>
            <button className="as-x" aria-label={`Take ${n.label} out`} title="Take it out" onClick={() => clickStar(n.id, true)}>✕</button>
          </li>
        ))}
      </ul>
      {ideas.length >= 2 && (
        <table className="ctx-compare" data-testid="ctx-compare">
          <thead><tr><th>Idea</th><th>Stage</th><th>Function</th><th>Region</th><th>Round</th></tr></thead>
          <tbody>{ideas.map((i) => (
            <tr key={i.id}><td title={i.title}>{i.title}</td><td>{state?.stageNames?.[i.stage] ?? i.stage}</td><td>{i.function ?? '—'}</td><td>{i.region ?? '—'}</td><td>{i.round ? roundName(i.round) : '—'}</td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

/** What the picked stars share: every star linked to two or more of them, most shared first; a click adds it. */
function InCommon({ ids }: { ids: string[] }) {
  const { graph, clickStar, hover } = useStore();
  if (!graph) return null;
  const rows = inCommon(graph, ids);
  const label = (id: string) => graph.nodes.find((n: any) => n.id === id)?.label ?? id;
  if (!rows.length) return <p className="hint" data-testid="ctx-common">Nothing links to more than one of them.</p>;
  return (
    <div className="ctx-scroll" data-testid="ctx-common">
      <ul className="ctx-picked">
        {rows.map((r) => {
          const n = graph.nodes.find((x: any) => x.id === r.id);
          return (
            <li key={r.id}>
              <button className="ctx-pick" data-common={r.id} title={`Linked to ${r.with.map(label).join(', ')}. Click to add it.`}
                onMouseEnter={() => hover(r.id)} onMouseLeave={() => hover(null)} onClick={() => clickStar(r.id, true)}>
                <span className="dot" style={{ background: dotOf(n?.type) }} /><span className="ctx-pick-t">{n?.label ?? r.id}</span>
                <span className="ctx-share">{r.with.length} of {ids.length}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
