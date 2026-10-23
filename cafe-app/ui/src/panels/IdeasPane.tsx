import { useStore } from '../state/store';
import { IdeasList } from './IdeasList';
import { IdeaDetails } from './IdeaDetails';
import { StarDetails } from './StarDetails';

/** The star (not an idea) the left panel shows: the one picked on its own, while no idea is open. */
export function leftStar(s: { leftView: { kind: string }; selectedId: string | null; selectedIds: string[] }, graph: { nodes: { id: string; type: string }[] } | null): string | null {
  if (s.leftView.kind !== 'list' || s.selectedIds.length >= 2 || !s.selectedId) return null;
  const n = graph?.nodes.find((x) => x.id === s.selectedId);
  return n && n.type !== 'Idea' ? n.id : null;
}

/** The Ideas panel (and the narrow Ideas drawer): the list, one idea's details, or the picked star's, in its place. */
export function IdeasPane() {
  const leftView = useStore((s) => s.leftView);
  const star = useStore((s) => leftStar(s, s.graph));
  return (
    <>
      <IdeasList hidden={leftView.kind !== 'list' || !!star} />
      {leftView.kind === 'idea' && <IdeaDetails key={leftView.id} id={leftView.id} />}
      {star && <StarDetails key={star} id={star} />}
    </>
  );
}
