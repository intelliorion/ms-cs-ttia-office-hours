import type { Provider } from '../connector';

/**
 * Test hook for the tour and the tests. It exists only when CAFE_AI_FAKE=1 is set
 * in the server's environment (see defaultProviders), and even then refuses to
 * answer if the variable has since been removed. It never reads the submission.
 */
const EXTRACT = {
  nodes: [
    { type: 'Capability', label: 'Document parsing' },
    { type: 'Capability', label: 'Workflow routing' },
    { type: 'System', label: 'Shared mailbox' },
    { type: 'Tool', label: 'Microsoft Planner' },
  ],
  links: [
    { from: 'idea', to: 'Document parsing', rel: 'NEEDS', description: 'Reads the incoming requests', confidence: 0.9 },
    { from: 'idea', to: 'Workflow routing', rel: 'NEEDS', description: 'Sends each request to the right team', confidence: 0.9 },
    { from: 'Document parsing', to: 'Shared mailbox', rel: 'USES_DATA', description: 'Requests arrive in a shared mailbox', confidence: 0.6 },
    { from: 'Workflow routing', to: 'Microsoft Planner', rel: 'BUILT_WITH', description: 'Tasks tracked in Planner', confidence: 0.8 },
  ],
};
const REVIEW = {
  criteria: { feasible: true, builder: false, data: true, theme: true, reuse: true },
  decision: 'ask',
  reason: 'Looks feasible with sample data and could be reused, but no builder is named yet. Ask the team who will build it.',
};

/** Fits tests/fixtures/inbox/reply.eml: Person 2 answering the two E2 questions on CAFE-2026-001. */
const TRIAGE = {
  summary: 'Person 2 answers our two questions about the email scheduler: about 40 requests a week, triaged by hand.',
  kind: 'reply',
  ideaId: 'CAFE-2026-001',
  matchConfidence: 0.95,
  facts: {
    answers: [
      { question: 'How many requests a week?', answer: 'About 40 a week, mostly from the EMEA desk, peaking at month end.' },
      { question: 'Who does it today?', answer: 'Two people triage them by hand in a shared mailbox, about half a day each week.' },
    ],
    replyReceived: true,
    builderNamed: null,
    newFlags: [],
    stageHint: null,
    graph: {
      nodes: [{ type: 'PainPoint', label: 'Manual request triage' }, { type: 'System', label: 'Shared mailbox' }],
      links: [{ from: 'idea', to: 'Manual request triage', rel: 'REPLACES', description: 'Requests are triaged by hand today', confidence: 0.8 }],
    },
  },
};

/** Three tool picks for any idea, one of them a custom app (a CSIC flag). */
const TOOL_PICK = {
  features: [
    { name: 'Request intake form', what: 'Collects each request in one place with the fields the team needs', tool: 'Power Apps', reason: 'A simple form on a SharePoint list, built by a citizen builder', flags: [] },
    { name: 'Draft replies', what: 'Drafts a first reply to each request for a person to check', tool: 'Microsoft Copilot', reason: 'Copilot can draft from the request text with no build', flags: ['no-build'] },
    { name: 'Scheduling engine', what: 'Works out a send slot for each request across time zones', tool: 'custom app', reason: 'No approved low-code tool does this scheduling logic', flags: ['custom-app'] },
  ],
};

/** A scripted brainstorm: must-show, smallest input, builder, then done. Which one depends on how many Q/A pairs the prompt carries. */
const DESIGN_STEPS = [
  {
    done: false, tag: 'must-show', question: 'What is the one thing this proof of concept must show?',
    why: 'A proof of concept proves one thing well; everything else can wait.',
    suggested: ['That requests can be sorted automatically', 'That a first reply can be drafted for a person to check', 'That the team can see every request in one place'],
  },
  {
    done: false, tag: 'smallest-input', question: 'What is the smallest input it needs to show that?',
    why: 'Synthetic or aggregated data keeps the proof of concept a Café build.',
    suggested: ['Twenty made-up sample requests in a spreadsheet', 'A weekly count of requests by type', 'Three example emails written for the test'],
  },
  {
    done: false, tag: 'builder', question: 'Who in the team will build the proof of concept?',
    why: 'A named builder makes it Citizen-Led; without one it stays Assisted Citizen.',
    suggested: ['A citizen builder in the team', 'Someone to be named after the first session', 'The team with TTIA help'],
  },
];
const DESIGN_DONE = {
  done: true,
  summary: 'A proof of concept that shows the one thing agreed above, using a small synthetic sample, built by the team with the tools picked for each feature.',
};

/** How many Q/A pairs the design-step prompt carries (its DATA block's stepsSoFar). */
function stepsSoFar(prompt: string): number {
  const start = prompt.lastIndexOf('<<<DATA');
  const end = prompt.lastIndexOf('DATA>>>');
  try {
    const data = JSON.parse(prompt.slice(start + '<<<DATA'.length, end)) as { stepsSoFar?: unknown[] };
    return Array.isArray(data.stepsSoFar) ? data.stepsSoFar.length : 0;
  } catch { return 0; }
}

const enabled = () => process.env.CAFE_AI_FAKE === '1';

export function fakeProvider(): Provider {
  return {
    id: 'fake',
    label: 'Fake (test)',
    available: async () => enabled(),
    async complete(prompt) {
      if (!enabled()) throw new Error('The fake AI is off');
      if (prompt.startsWith('TASK: extract')) return `Here is the JSON:\n${JSON.stringify(EXTRACT)}`;
      if (prompt.startsWith('TASK: review-suggest')) return JSON.stringify(REVIEW);
      if (prompt.startsWith('TASK: triage')) return JSON.stringify(TRIAGE);
      if (prompt.startsWith('TASK: tool-pick')) return JSON.stringify(TOOL_PICK);
      if (prompt.startsWith('TASK: design-step')) return JSON.stringify(DESIGN_STEPS[stepsSoFar(prompt)] ?? DESIGN_DONE);
      if (prompt.startsWith('TASK: ping')) return '{"ok":true}';
      return '{}';
    },
  };
}
