import { useStore } from '../state/store';

/** One line over the universe while a chat change flashes: "Updated: Alex Wang → Lead on Procurement FAQ bot". */
export function ChangeNote() {
  const flash = useStore((s) => s.flash);
  if (!flash?.note) return null;
  return <div key={flash.key} className="change-note" role="status" data-testid="change-note">{flash.note}</div>;
}
