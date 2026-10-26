import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore, useStageRing } from '../state/store';
import { useChat } from '../state/chat';
import { filterIdeas, stageKey, emailChips, byMeaning } from './filterIdeas';
import { memoryIdeas } from '../api';

/** The list stays mounted while an idea's details show (hidden), so its search, chips and scroll are kept for Back. */
export function IdeasList({ hidden = false }: { hidden?: boolean }) {
  const { state, hover, openIdea, selectedId, selectedIds, clickStar, setHighlight } = useStore();
  const ring = useStageRing();
  const picked = new Set(selectedIds);
  const listRef = useRef<HTMLUListElement>(null);
  const scrollTop = useRef(0);
  // A hidden (display:none) list can lose its scroll offset; put it back when the list shows again.
  useLayoutEffect(() => { if (!hidden && listRef.current) listRef.current.scrollTop = scrollTop.current; }, [hidden]);
  const [q, setQ] = useState('');
  const [stages, setStages] = useState<string[]>([]);
  const ideas: any[] = state?.ideas ?? [];
  const filtered = useMemo(() => filterIdeas(ideas, q, stages), [ideas, q, stages]);
  // Deep read: when the words match nothing and the index exists, ask for the ideas nearest in meaning (debounced).
  const canMean = useStore((s) => !!s.memory?.summary.available);
  const [ranked, setRanked] = useState<{ q: string; ideas: { id: string }[] } | null>(null);
  const wantMeaning = canMean && q.trim().length > 0 && filtered.length === 0;
  useEffect(() => {
    if (!wantMeaning) return;
    const want = q.trim();
    const t = setTimeout(() => { memoryIdeas(want).then((r) => setRanked({ q: want, ideas: r.ideas ?? [] })).catch(() => setRanked({ q: want, ideas: [] })); }, 300);
    return () => clearTimeout(t);
  }, [wantMeaning, q]);
  const meaning = wantMeaning && ranked?.q === q.trim() ? byMeaning(ideas, ranked.ideas, stages) : [];
  const shown = filtered.length ? filtered : meaning;
  const showingMeaning = !filtered.length && meaning.length > 0;
  if (!state) return null;
  if (!ideas.length) {
    return (
      <div className="ideas-empty">
        <p>No ideas yet</p>
      </div>
    );
  }
  const chips: [string, string][] = [...Object.keys(state.stageNames).map((k): [string, string] => [k, state.stageNames[k]]), ['closed', 'Closed']];
  const toggle = (k: string) => setStages((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  return (
    <div className="ideas" hidden={hidden} style={hidden ? { display: 'none' } : undefined}>
      <input className="search" type="search" placeholder="Search ID, title or function" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search ideas" />
      <div className="chips">
        {chips.map(([k, n]) => (
          <button key={k} className={`chip${stages.includes(k) ? ' on' : ''}`} style={{ ['--c' as string]: ring[k] }} aria-pressed={stages.includes(k)} onClick={() => toggle(k)}>{n}</button>
        ))}
      </div>
      <div className="count">{shown.length} of {ideas.length} ideas{showingMeaning && <span className="dr-mark" data-testid="by-meaning" title="Deep read: the nearest in meaning, since no ID, title or function has these words">by meaning</span>}</div>
      {selectedIds.length >= 2 && (
        <div className="multi-strip" data-testid="multi-strip">
          <span className="grow"><b>{selectedIds.length}</b> selected</span>
          <button className="btn sm primary" data-action="multi-ask" onClick={() => { setHighlight(null); useChat.getState().setOpen(true); }}>Ask the AI about these</button>
          <button className="link-btn" data-action="multi-clear" onClick={() => clickStar(null)}>Clear</button>
        </div>
      )}
      <ul className="idea-list" ref={listRef} onScroll={(e) => { scrollTop.current = e.currentTarget.scrollTop; }}>
        {shown.map((i) => {
          const key = stageKey(i);
          const id = `idea:${i.id}`;
          const mails = emailChips(i, state.outbox ?? []);
          const late = i.overdue?.[0];
          return (
            <li key={i.id} className={`${picked.has(id) ? 'sel sel-many' : selectedId === id ? 'sel' : ''}${showingMeaning ? ' by-meaning' : ''}`} onMouseEnter={() => hover(id)} onMouseLeave={() => hover(null)}
              onClick={(e) => (e.ctrlKey || e.metaKey ? clickStar(id, true) : openIdea(i.id))}>
              <div className="r1" title={i.title}><span className="iid">{i.id.replace('CAFE-', '')}</span><span className="ttl">{i.title}</span></div>
              <div className="r2">
                <span className="fr">{[i.function, i.region].filter(Boolean).join(' · ') || '—'}</span>
                <span className="stg" style={{ ['--c' as string]: ring[key] }}>{i.closed ? 'Closed' : state.stageNames[i.stage]}</span>
              </div>
              {(mails.length > 0 || i.flags?.length > 0) && (
                <div className="r3">
                  {mails.map((m) => <span key={m} className={`mail${m.includes('✓') ? ' done' : ''}`}>{m}</span>)}
                  {i.flags?.length > 0 && <span className="flagn" title={i.flags.join('\n')}>⚑ {i.flags.length}</span>}
                </div>
              )}
              {late && !i.closed && <div className="late">{late.text}{i.overdue.length > 1 ? ` (+${i.overdue.length - 1} more)` : ''}</div>}
            </li>
          );
        })}
        {!shown.length && <li className="none">No ideas match.</li>}
      </ul>
    </div>
  );
}
