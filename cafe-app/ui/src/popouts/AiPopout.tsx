import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { post } from '../api';
import { Modal } from './Modal';
import { aiTestText, chipText, nextProviderChoice } from './aiUi';

const OPTIONS: [string, string][] = [
  ['auto', 'Auto'], ['claude', 'Claude Code'], ['copilot', 'Copilot CLI'], ['vscode', 'VS Code with Copilot'], ['none', 'None'],
];

export function AiPopout() {
  const { state, ai, refreshAi, refresh, closePopout } = useStore();
  const [choice, setChoice] = useState<string>(state?.settings?.ai?.provider ?? 'auto');
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);
  // Refresh on open so the saved setting is current, and follow it whenever it changes.
  useEffect(() => { void refreshAi(); void refresh(); }, [refreshAi, refresh]);
  const saved: string = state?.settings?.ai?.provider ?? 'auto';
  useEffect(() => { setChoice(saved); }, [saved]);

  const byId = Object.fromEntries((ai?.choices ?? []).map((c) => [c.id, c]));
  const note = (id: string) => byId[id]?.note ?? (id === 'copilot' ? ai?.note : undefined);

  const pick = async (id: string) => {
    const prev = choice;
    setBusy(true); setMsg(null);
    try {
      const r = await post('/api/ai/provider', { provider: id });
      setChoice(nextProviderChoice(prev, r?.choice ?? id, true));
      await Promise.all([refreshAi(), refresh()]);
      setMsg({ text: 'Saved.', kind: 'ok' });
    } catch (e) {
      setChoice(nextProviderChoice(prev, id, false));
      setMsg({ text: (e as Error).message, kind: 'error' });
    }
    setBusy(false);
  };
  const test = async () => {
    setBusy(true);
    setMsg({ text: 'Testing: asking the AI for a short reply…', kind: 'ok' });
    try {
      // A real round trip through the chosen provider, checked like any other answer.
      setMsg({ text: aiTestText(await post('/api/ai/test')), kind: 'ok' });
    } catch (e) { setMsg({ text: (e as Error).message, kind: 'error' }); }
    await refreshAi();
    setBusy(false);
  };

  return (
    <Modal title={<><div className="pop-id">AI helper</div><h2>{chipText(ai)}</h2></>} label="AI helper" onClose={closePopout} width={720} height={640} className="ai-pop">
      <div className="modal-body">
        <section className="sec">
          <h3>Which AI</h3>
          <div className="opts" role="radiogroup" aria-label="Which AI">
            {OPTIONS.map(([id, label]) => (
              <label key={id}>
                <input type="radio" name="ai-provider" value={id} checked={choice === id} disabled={busy} onChange={() => void pick(id)} />
                <span>{label}</span>
                {note(id) && <span className="off">{note(id)}</span>}
                {id !== 'auto' && id !== 'none' && byId[id] && !byId[id].available && !note(id) && <span className="off">not found</span>}
              </label>
            ))}
          </div>
          <div className="test-row">
            <button className="btn" data-action="ai-test" disabled={busy} onClick={() => void test()}>Test</button>
            {msg && <div className={`pop-notice ${msg.kind}`} role="status">{msg.text}</div>}
          </div>
        </section>
        <section className="sec">
          <h3>How it behaves</h3>
          <ul className="rules">
            <li>High-confidence links between stars you already have are added at once; anything that would add a new star waits for your Yes; you can remove any AI link from the idea pop-out.</li>
            <li>Submission text is treated as data, never as instructions.</li>
            <li>The AI has no file, shell or network access.</li>
          </ul>
          <div className="approval">Switch this on for real submissions only after Tech Governance &amp; Enablement has approved AI use.</div>
        </section>
      </div>
    </Modal>
  );
}
