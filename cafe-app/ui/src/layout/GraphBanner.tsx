import { useState } from 'react';
import { useStore } from '../state/store';

/**
 * What the graph's rules and ontology files could not take, and what the build refused, as /api/graph lists them.
 * The files' problems are said first (the build then runs on the built-in ontology or rules, so the operator must
 * know); the rest is a count with the command that lists them.
 */
export function graphFileProblems(graph: { problems?: { message: string }[] } | null): { files: string[]; refused: string[]; other: number } {
  const all = (graph?.problems ?? []).map((p) => String(p?.message ?? '')).filter(Boolean);
  // A rules file the build could not take (it runs on the built-in one where so); a re-paired relation's dropped links
  // and a built-in rule left unlisted are what the build did with the file, said with the refusals.
  const files = all.filter((m) => /^(ontology|inference)\.yaml\b/.test(m) && !/\(dropped by the build\)$/.test(m) && !/is not listed, so it still runs/.test(m));
  const refused = all.filter((m) => !files.includes(m) && (/\((refused|dropped|not used) by the build\)$/.test(m) || /counts as waiting for your Do it/.test(m)
    || /^(confirmations\.jsonl|settings\.yaml|ideas\/)/.test(m) || /is not listed, so it still runs/.test(m) || /\(not used as written by the build;/.test(m)));
  return { files, refused, other: all.length - files.length - refused.length };
}

export function GraphBanner() {
  const graph = useStore((s) => s.graph);
  const [open, setOpen] = useState(false);
  const { files, refused } = graphFileProblems(graph);
  if (!files.length && !refused.length) return null;
  const head = files.length
    ? `${files.length === 1 ? 'A rules file has a problem' : `The rules files have ${files.length} problems`}: the graph is built with the built-in ${files.some((f) => f.startsWith('ontology')) ? 'ontology' : 'rules'} where they could not be read.`
    : `${refused.length} thing${refused.length === 1 ? '' : 's'} in the workspace's files ${refused.length === 1 ? 'was' : 'were'} refused or read otherwise than written: what the build did, and why.`;
  const lines = [...files, ...refused];
  return (
    <div className="graph-banner" role="alert" data-testid="graph-banner">
      <span>{head}</span>{' '}
      <button className="link" data-action="graph-problems" onClick={() => setOpen(!open)}>{open ? 'Hide' : `Show ${lines.length}`}</button>
      {open && <ul>{lines.slice(0, 12).map((l, i) => <li key={i}>{l}</li>)}{lines.length > 12 && <li>… and {lines.length - 12} more: run cafe ontology check</li>}</ul>}
    </div>
  );
}
