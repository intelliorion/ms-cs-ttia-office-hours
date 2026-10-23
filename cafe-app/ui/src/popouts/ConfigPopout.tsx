import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { post } from '../api';
import { Modal } from './Modal';
import { roundFieldsUnblock } from './titleHelpers';

type Pairs = readonly (readonly [string, string])[];

/**
 * Settings → Project configuration: the values emails and reminders fill in (your name, the Café form link,
 * the Teams link…) and the capacity limits. Kept in rules/settings.yaml, never sent anywhere.
 */
export function ConfigPopout() {
  const { state, closePopout, refresh, notice, setNotice } = useStore();
  const settingFields: Pairs = state?.fields?.settings ?? [];
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [capacity, setCapacity] = useState({ ideasPerRound: '3', sessionsPerWeek: '2' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setNotice(null);
    if (!state) return;
    setSettings(Object.fromEntries(settingFields.map(([k]) => [k, state.settings?.[k] ?? ''])));
    setCapacity({ ideasPerRound: String(state.settings?.capacity?.ideasPerRound ?? 3), sessionsPerWeek: String(state.settings?.capacity?.sessionsPerWeek ?? 2) });
    // Load once per opening; later refreshes must not overwrite what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(state)]);
  const save = async () => {
    setBusy(true);
    try {
      await post('/api/settings', { ...settings, capacity: { ideasPerRound: Number(capacity.ideasPerRound), sessionsPerWeek: Number(capacity.sessionsPerWeek) } });
      setNotice({ text: 'Project configuration saved.', kind: 'ok' });
      await refresh();
    } catch (e) { setNotice({ text: (e as Error).message, kind: 'error' }); }
    finally { setBusy(false); }
  };
  const openData = async () => {
    try { await post('/api/workspace/open'); setNotice({ text: 'Opened the data folder.', kind: 'ok' }); }
    catch (e) { setNotice({ text: (e as Error).message, kind: 'error' }); }
  };
  const title = <><div className="pop-id">Settings</div><h2>Project configuration</h2></>;
  return (
    <Modal title={title} label="Project configuration" onClose={closePopout} width={720} height={820}>
      {notice && <div className="pop-strip"><div className={`pop-notice ${notice.kind ?? 'ok'}`} role="status">{notice.text}</div></div>}
      <div className="pop-grid one">
        <div className="pop-col">
        <section className="sec">
          <h3>Data folder</h3>
          <p className="hint lead">Everything the Café keeps (ideas, rounds, emails, the graph, settings) is in this folder on this computer.</p>
          <div className="data-dir">
            <code title={state?.workspace ?? ''}><bdi>{state?.workspace ?? ''}</bdi></code>
            <button className="btn" type="button" data-action="open-data-folder" disabled={busy} onClick={() => void openData()}>Open data folder</button>
          </div>
        </section>
        <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <section className="sec">
            <h3>Filled into emails</h3>
            <p className="hint lead">Kept in settings.yaml on this computer, never sent anywhere.</p>
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
            <div className="rf-foot"><button className="btn primary" type="submit" data-action="save-settings" disabled={busy}>Save</button></div>
          </section>
        </form>
        </div>
      </div>
    </Modal>
  );
}
