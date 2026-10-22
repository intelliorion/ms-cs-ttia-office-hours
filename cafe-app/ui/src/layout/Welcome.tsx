import { useStore } from '../state/store';

/**
 * The first-run card in the middle of the universe: only while the workspace has no ideas and no pop-out is open.
 * Its one button opens the Import pop-out; the card goes the moment the first idea exists.
 */
export function Welcome({ onStart }: { onStart?: () => void }) {
  const empty = useStore((s) => !!s.state && (s.state.ideas ?? []).length === 0);
  const popout = useStore((s) => s.popout);
  const openPopout = useStore((s) => s.openPopout);
  if (!empty || popout) return null;
  return (
    <section className="welcome" data-testid="welcome">
      <h2>Nothing here but dark matter.</h2>
      <p>Drop the first submissions export and watch the stars come out. The app sorts them; you drink the coffee.</p>
      <button className="btn primary" data-action="welcome-import" onClick={onStart ?? (() => openPopout({ kind: 'inbox' }))}>Start: import submissions</button>
    </section>
  );
}
