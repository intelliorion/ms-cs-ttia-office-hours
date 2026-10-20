import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { STAGE_RING } from '../universe/graphView';
import { filterIdeas, stageKey, emailChips } from './filterIdeas';

/** The list stays mounted while an idea's details show (hidden), so its search, chips and scroll are kept for Back. */
export function IdeasList({ hidden = false }: { hidden?: boolean }) {
  const { state, hover, openPopout, openIdea, selectedId } = useStore();
  const listRef = useRef<HTMLUListElement>(null);
  const scrollTop = useRef(0);
  // A hidden (display:none) list can lose its scroll offset; put it back when the list shows again.
  useLayoutEffect(() => { if (!hidden && listRef.current) listRef.current.scrollTop = scrollTop.current; }, [hidden]);
  const [q, setQ] = useState('');
  const [stages, setStages] = useState<string[]>([]);
  const ideas: any[] = state?.ideas ?? [];
  const shown = useMemo(() => filterIdeas(ideas, q, stages), [ideas, q, stages]);
  if (!state) return null;
  if (!ideas.length) {
    return (
      <div className="ideas-empty">
        <p>Import an export to light up the universe</p>
        <button className="pill" data-action="import-empty" onClick={() => openPopout({ kind: 'import' })}>Import</button>
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
          <button key={k} className={`chip${stages.includes(k) ? ' on' : ''}`} style={{ ['--c' as string]: STAGE_RING[k] }} aria-pressed={stages.includes(k)} onClick={() => toggle(k)}>{n}</button>
        ))}
      </div>
      <div className="count">{shown.length} of {ideas.length} ideas</div>
      <ul className="idea-list" ref={listRef} onScroll={(e) => { scrollTop.current = e.currentTarget.scrollTop; }}>
        {shown.map((i) => {
          const key = stageKey(i);
          const id = `idea:${i.id}`;
          const mails = emailChips(i, state.outbox ?? []);
          const late = i.overdue?.[0];
          return (
            <li key={i.id} className={selectedId === id ? 'sel' : ''} onMouseEnter={() => hover(id)} onMouseLeave={() => hover(null)}
              onClick={() => openIdea(i.id)}>
              <div className="r1" title={i.title}><span className="iid">{i.id.replace('CAFE-', '')}</span><span className="ttl">{i.title}</span></div>
              <div className="r2">
                <span className="fr">{[i.function, i.region].filter(Boolean).join(' · ') || '—'}</span>
                <span className="stg" style={{ ['--c' as string]: STAGE_RING[key] }}>{i.closed ? 'Closed' : state.stageNames[i.stage]}</span>
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
