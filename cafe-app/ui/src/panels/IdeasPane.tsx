import { useStore } from '../state/store';
import { IdeasList } from './IdeasList';
import { IdeaDetails } from './IdeaDetails';

/** The Ideas panel (and the narrow Ideas drawer): the list, or one idea's details in its place. */
export function IdeasPane() {
  const leftView = useStore((s) => s.leftView);
  return (
    <>
      <IdeasList hidden={leftView.kind !== 'list'} />
      {leftView.kind === 'idea' && <IdeaDetails key={leftView.id} id={leftView.id} />}
    </>
  );
}
