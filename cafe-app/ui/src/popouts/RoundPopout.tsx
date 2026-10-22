import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { post } from '../api';
import { Modal } from './Modal';
import { defaultRoundName, ideaCount, roundFieldsUnblock } from './titleHelpers';

type Pairs = readonly (readonly [string, string])[];
interface RoundRow { id: string; name: string; created?: string; [date: string]: string | undefined }
interface IdeaRow { id: string; title?: string; round?: string }

/**
 * The Rounds pop-out: on the left every round (newest first) with its dates and its ideas, then New round;
 * on the right the ideas in no round, to put in one, then the Settings form.
 */
export function RoundPopout() {
  const { state, closePopout, refresh, notice, setNotice } = useStore();
  // Newest first by the day made, then by id (the server's order too, kept here so the list never depends on it).
  const rounds: RoundRow[] = [...(state?.rounds ?? [])].sort((a: RoundRow, b: RoundRow) =>
    String(b.created ?? '').localeCompare(String(a.created ?? '')) || b.id.localeCompare(a.id));
  const ideas: IdeaRow[] = state?.ideas ?? [];
  const roundFields: Pairs = state?.fields?.round ?? [];
  const settingFields: Pairs = state?.fields?.settings ?? [];
  const known = new Set(rounds.map((r) => r.id));
  const unassigned = ideas.filter((i) => !i.round || !known.has(i.round));

  const [dates, setDates] = useState<Record<string, Record<string, string>>>({});
  const [newName, setNewName] = useState('');
  const [ticked, setTicked] = useState<string[]>([]);
  const [target, setTarget] = useState('');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [capacity, setCapacity] = useState({ ideasPerRound: '3', sessionsPerWeek: '2' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNotice(null);
    if (!state) return;
    setNewName(defaultRoundName(state.today));
    setSettings(Object.fromEntries(settingFields.map(([k]) => [k, state.settings?.[k] ?? ''])));
    setCapacity({ ideasPerRound: String(state.settings?.capacity?.ideasPerRound ?? 3), sessionsPerWeek: String(state.settings?.capacity?.sessionsPerWeek ?? 2) });
    // Load once per opening; later refreshes must not overwrite what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(state)]);

  // A round's dates as typed, else as saved.
  const dateOf = (r: RoundRow, k: string) => dates[r.id]?.[k] ?? r[k] ?? '';
  const setDate = (id: string, k: string, v: string) => setDates((d) => ({ ...d, [id]: { ...d[id], [k]: v } }));
  // The picker defaults to the newest round.
  const pickTarget = rounds.some((r) => r.id === target) ? target : rounds[0]?.id ?? '';
  const targetName = rounds.find((r) => r.id === pickTarget)?.name ?? '';
  const picked = ticked.filter((id) => unassigned.some((i) => i.id === id));

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await fn(); setNotice({ text: done, kind: 'ok' }); await refresh(); return true; }
    catch (e) { setNotice({ text: (e as Error).message, kind: 'error' }); return false; }
    finally { setBusy(false); }
  };
  const create = async () => {
    const name = newName.trim();
    if (await run(() => post('/api/rounds', { name }), name ? `${name} created.` : 'Round created.')) setNewName('');
  };
  const assign = async () => {
    const ids = picked;
    if (await run(() => post(`/api/rounds/${encodeURIComponent(pickTarget)}/ideas`, { ideaIds: ids }), `${ideaCount(ids.length)} put in ${targetName}.`)) setTicked([]);
  };
  const takeOut = (i: IdeaRow) => run(() => post(`/api/ideas/${encodeURIComponent(i.id)}/round`, { round: '' }), `${i.id} taken out of its round.`);
  const saveDates = (r: RoundRow) => run(
    () => post(`/api/rounds/${encodeURIComponent(r.id)}`, Object.fromEntries(roundFields.map(([k]) => [k, dateOf(r, k)]))),
    `${r.name} dates saved.`,
  );
  const saveSettings = () => run(
    () => post('/api/settings', { ...settings, capacity: { ideasPerRound: Number(capacity.ideasPerRound), sessionsPerWeek: Number(capacity.sessionsPerWeek) } }),
    'Settings saved.',
  );

  const title = <><div className="pop-id">Rounds</div><h2>Rounds, their ideas and settings</h2></>;
  return (
    <Modal title={title} label="Rounds" onClose={closePopout} width={1100} height={860}>
      {notice && <div className="pop-strip"><div className={`pop-notice ${notice.kind ?? 'ok'}`} role="status">{notice.text}</div></div>}
      <div className="pop-grid">
        <div className="pop-col">
          <section className="sec">
            <h3>Rounds <span className="sec-n">newest first</span></h3>
            <p className="hint lead">Emails stay in draft until the dates they quote are set.</p>
            {!rounds.length && <div className="hint">No rounds yet. Make the first one below.</div>}
            {rounds.map((r, n) => {
              const mine = ideas.filter((i) => i.round === r.id);
              return (
                <div key={r.id} className="rnd" data-round={r.id}>
                  <div className="rnd-head">
                    <span className="rnd-name">{r.name}</span>
                    <span className="iid">{r.id}</span>
                    <span className="rnd-n">{ideaCount(mine.length)}</span>
                  </div>
                  <details className="rnd-dates" open={n === 0}>
                    <summary>Dates</summary>
                    <form onSubmit={(e) => { e.preventDefault(); void saveDates(r); }}>
                      {roundFields.map(([k, label]) => (
                        <label key={k} className="rf">
                          <span className="rf-h"><span className="rf-l">{label}</span><span className="rf-u">{roundFieldsUnblock(k)}</span></span>
                          <input type="date" value={dateOf(r, k)} data-field={k} onChange={(e) => setDate(r.id, k, e.target.value)} />
                        </label>
                      ))}
                      <div className="rf-foot"><button className="btn primary" type="submit" data-action="save-round" disabled={busy}>Save dates</button></div>
                    </form>
                  </details>
                  {mine.length > 0 && (
                    <ul className="rnd-ideas">
                      {mine.map((i) => (
                        <li key={i.id} data-idea={i.id}>
                          <span className="iid">{i.id}</span><span className="rnd-t">{i.title || 'Untitled idea'}</span>
                          <button className="btn sm" data-action="take-out" data-idea={i.id} disabled={busy} onClick={() => void takeOut(i)}>Take out</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </section>
          <form className="sec rnd-new" onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <h3>New round</h3>
            <label className="rf"><span className="rf-l">Name</span>
              <input type="text" value={newName} data-field="round-name" data-autofocus onChange={(e) => setNewName(e.target.value)} /></label>
            <div className="rf-foot"><button className="btn primary" type="submit" data-action="create-round" disabled={busy}>Create</button></div>
          </form>
        </div>
        <div className="pop-col">
          <section className="sec rnd-free">
            <h3>Unassigned ideas <span className="sec-n">{unassigned.length}</span></h3>
            {!unassigned.length ? <div className="hint">Every idea is in a round.</div> : (
              <ul className="rnd-ideas">
                {unassigned.map((i) => (
                  <li key={i.id} data-idea={i.id}>
                    <label>
                      <input type="checkbox" value={i.id} checked={ticked.includes(i.id)}
                        onChange={(e) => setTicked((t) => (e.target.checked ? [...t, i.id] : t.filter((x) => x !== i.id)))} />
                      <span className="iid">{i.id}</span><span className="rnd-t">{i.title || 'Untitled idea'}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div className="rnd-assign">
              <select value={pickTarget} data-field="assign-round" aria-label="Round to put them in" disabled={!rounds.length} onChange={(e) => setTarget(e.target.value)}>
                {rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <button className="btn primary" data-action="assign" disabled={busy || !picked.length || !pickTarget} onClick={() => void assign()}>
                {`Put ${ideaCount(picked.length)} in ${targetName || 'a round'}`}</button>
            </div>
          </section>
          <form onSubmit={(e) => { e.preventDefault(); void saveSettings(); }}>
            <section className="sec">
              <h3>Settings</h3>
              <p className="hint lead">Kept in settings.yaml, never sent anywhere.</p>
              {settingFields.map(([k, label]) => (
                <label key={k} className="rf">
                  <span className="rf-h"><span className="rf-l">{label}</span><span className="rf-u">{roundFieldsUnblock(k)}</span></span>
                  <input type="text" value={settings[k] ?? ''} data-field={k} onChange={(e) => setSettings((x) => ({ ...x, [k]: e.target.value }))} />
                </label>
              ))}
            </section>
            <section className="sec">
              <h3>Capacity</h3>
              <div className="cap">
                <label className="rf"><span className="rf-l">Ideas per round</span>
                  <input type="number" min={1} step={1} value={capacity.ideasPerRound} data-field="ideasPerRound" onChange={(e) => setCapacity((c) => ({ ...c, ideasPerRound: e.target.value }))} /></label>
                <label className="rf"><span className="rf-l">Sessions per week</span>
                  <input type="number" min={1} step={1} value={capacity.sessionsPerWeek} data-field="sessionsPerWeek" onChange={(e) => setCapacity((c) => ({ ...c, sessionsPerWeek: e.target.value }))} /></label>
              </div>
              <div className="rf-foot"><button className="btn primary" type="submit" data-action="save-settings" disabled={busy}>Save settings</button></div>
            </section>
          </form>
        </div>
      </div>
    </Modal>
  );
}
