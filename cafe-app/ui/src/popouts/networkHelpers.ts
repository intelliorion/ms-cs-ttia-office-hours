/** The Network pop-out's words, kept apart from the component so they can be tested. Shapes as /api/network sends them. */

export interface NetStar { id: string; type: string; label: string }
export interface NetView {
  networkx: string; python: string; scope: 'stored' | 'with-derived'; scopeText: string;
  results: {
    stats?: { nodes: number; links: number; density: number; components: number; largestComponent: number; averageClustering: number; analysed: { nodes: number; links: number } };
    central?: { betweenness: (NetStar & { betweenness: number; degree: number; links: number; ideas: number })[]; sampled: boolean };
    clusters?: { clusters: { ideas: NetStar[]; binding: (NetStar & { ideas: number })[]; weight: number }[]; alone: NetStar[]; modularity: number; verdict?: 'no-groups' | 'some-groups' | 'clear-groups'; verdictText?: string };
    isolated?: { components: number; main: number; outside: NetStar[] };
    suggest?: { suggestions: { from: NetStar; rel: string; to: NetStar; share: number; adamicAdar: number; jaccard: number; because: { peer: NetStar; shared: NetStar[] }[] }[]; found: number; evidence?: string };
  };
}
export const NETWORK_ANALYSES = ['stats', 'central', 'clusters', 'isolated', 'suggest'];

export function statsLine(v: NetView): string {
  const s = v.results.stats;
  if (!s) return '';
  return `${s.nodes} stars · ${s.links} links · density ${s.density.toFixed(3)} · ${s.components} component${s.components === 1 ? '' : 's'} · average clustering ${s.averageClustering.toFixed(3)}`;
}
/** "NetworkX 3.7, stored facts": the footer, always saying which facts were read. */
export const footerLine = (v: NetView) => `NetworkX ${v.networkx}, ${v.scopeText} · Python ${v.python}`;
/** What a cluster lights in the universe: its ideas and the stars that bind them. */
export const clusterIds = (c: { ideas: NetStar[]; binding: NetStar[] }) => [...c.ideas.map((x) => x.id), ...c.binding.slice(0, 4).map((x) => x.id)];
export const relText = (rel: string) => (rel === 'NEEDS' ? 'needs' : rel === 'USES_DATA' ? 'uses the data' : rel.toLowerCase().replace(/_/g, ' '));
/** Why NetworkX suggests a link: the share of its closest peers' weight, and who they are with what they share. */
export function becauseText(s: NonNullable<NetView['results']['suggest']>['suggestions'][number]): string {
  return `${Math.round(s.share * 100)} % of its closest peers by weight: ${s.because.map((b) => `${b.peer.label} (shares ${b.shared.map((x) => x.label).join(', ')})`).join('; ')}`;
}
/** The bar width of a centrality score against the highest one shown. */
export const barShare = (x: number, max: number) => (max > 0 ? Math.max(4, Math.round((x / max) * 100)) : 0);
