import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { post } from '../api';
import { Modal } from './Modal';
import { roundFieldsUnblock } from './titleHelpers';

type Pairs = readonly (readonly [string, string])[];

export function RoundPopout() {
  const { state, closePopout, refresh, notice, setNotice } = useStore();
  const roundFields: Pairs = state?.fields?.round ?? [];
  const settingFields: Pairs = state?.fields?.settings ?? [];
  const [round, setRound] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [capacity, setCapacity] = useState({ ideasPerRound: '3', sessionsPerWeek: '2' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNotice(null);
    if (!state) return;
    setRound(Object.fromEntries(roundFields.map(([k]) => [k, state.round?.[k] ?? ''])));
    setSettings(Object.fromEntries(settingFields.map(([k]) => [k, state.settings?.[k] ?? ''])));
    setCapacity({ ideasPerRound: String(state.settings?.capacity?.ideasPerRound ?? 3), sessionsPerWeek: String(state.settings?.capacity?.sessionsPerWeek ?? 2) });
    // Load once per opening; later refreshes must not overwrite what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(state)]);

  const save = async (url: string, body: unknown, what: string) => {
    setBusy(true);
    try { await post(url, body); setNotice({ text: `${what} saved.`, kind: 'ok' }); await refresh(); }
    catch (e) { setNotice({ text: (e as Error).message, kind: 'error' }); }
    setBusy(false);
  };

  const title = <><div className="pop-id">{state?.round?.id ?? 'Round'}</div><h2>Round dates and settings</h2></>;
  return (
    <Modal title={title} label="Round" onClose={closePopout} width={1100} height={860}>
      {notice && <div className="pop-strip"><div className={`pop-notice ${notice.kind ?? 'ok'}`} role="status">{notice.text}</div></div>}
      <div className="pop-grid">
        <form className="pop-col" onSubmit={(e) => { e.preventDefault(); void save('/api/round', round, 'Round dates'); }}>
          <section className="sec">
            <h3>Round dates</h3>
            <p className="hint lead">Emails stay in draft until the dates they quote are set.</p>
            {roundFields.map(([k, label]) => (
              <label key={k} className="rf">
                <span className="rf-h"><span className="rf-l">{label}</span><span className="rf-u">{roundFieldsUnblock(k)}</span></span>
                <input type="date" value={round[k] ?? ''} data-field={k} data-autofocus={k === roundFields[0]?.[0] ? true : undefined} onChange={(e) => setRound((x) => ({ ...x, [k]: e.target.value }))} />
              </label>
            ))}
            <div className="rf-foot"><button className="btn primary" type="submit" data-action="save-round" disabled={busy}>Save dates</button></div>
          </section>
        </form>
        <form className="pop-col" onSubmit={(e) => {
          e.preventDefault();
          void save('/api/settings', { ...settings, capacity: { ideasPerRound: Number(capacity.ideasPerRound), sessionsPerWeek: Number(capacity.sessionsPerWeek) } }, 'Settings');
        }}>
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
    </Modal>
  );
}
