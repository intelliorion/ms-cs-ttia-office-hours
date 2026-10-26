import { describe, it, expect } from 'vitest';
import { neighbourhood, throughFeatures, edgeStyle, LINK_IN_VIEW } from './graphView';

const g = {
  nodes: [
    { id: 'idea:A', type: 'Idea', label: 'A' }, { id: 'capability:f1', type: 'Capability', label: 'F1' }, { id: 'capability:f2', type: 'Capability', label: 'F2' },
    { id: 'tool:dataiku', type: 'Tool', label: 'Dataiku' }, { id: 'system:excel', type: 'System', label: 'Excel' }, { id: 'idea:B', type: 'Idea', label: 'B' },
  ] as any[],
  edges: [
    { id: 'e1', from: 'idea:A', rel: 'NEEDS', to: 'capability:f1', confirmed: true }, { id: 'e2', from: 'idea:A', rel: 'NEEDS', to: 'capability:f2', confirmed: true },
    { id: 'e3', from: 'capability:f1', rel: 'BUILT_WITH', to: 'tool:dataiku', confirmed: true }, { id: 'e4', from: 'capability:f2', rel: 'BUILT_WITH', to: 'tool:dataiku', confirmed: true },
    { id: 'e5', from: 'capability:f1', rel: 'USES_DATA', to: 'system:excel', confirmed: true }, { id: 'e6', from: 'idea:B', rel: 'NEEDS', to: 'capability:f1', confirmed: true },
  ] as any[],
};

describe('an idea and what its features stand on', () => {
  it('a selected idea keeps its features\' tool and systems in view, but not other ideas', () => {
    expect([...neighbourhood(g, 'idea:A')].sort()).toEqual(['capability:f1', 'capability:f2', 'idea:A', 'system:excel', 'tool:dataiku']);
    // Any other star: only its own links, as before.
    expect([...neighbourhood(g, 'capability:f1')].sort()).toEqual(['capability:f1', 'idea:A', 'idea:B', 'system:excel', 'tool:dataiku']);
  });
  it('the feature-to-tool links stay in view, without the pulse the idea\'s own links have', () => {
    const hood = neighbourhood(g, 'idea:A');
    expect(edgeStyle(g.edges[2], 'idea:A', null, 0.2, hood)).toEqual({ opacity: LINK_IN_VIEW, dashed: false, derived: false, pulse: false });
    expect(edgeStyle(g.edges[5], 'idea:A', null, 0.2, hood).opacity).toBeLessThan(LINK_IN_VIEW);
  });
  it('lists the tool and systems with how many features lead there', () => {
    expect(throughFeatures(g, 'idea:A').map((r) => [r.node.label, r.rel, r.via])).toEqual([['Dataiku', 'BUILT_WITH', 2], ['Excel', 'USES_DATA', 1]]);
  });
});
