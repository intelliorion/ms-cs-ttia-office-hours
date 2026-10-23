import path from 'node:path';
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
  needs: [
    { need: 'A builder who can attend every session', ask: 'Who in your team would build the proof of concept, and can they attend every session?', met: false },
  ],
  updates: { builder: '', builderCanAttend: false, participation: '', resolvedFlags: [], facts: [], graph: { nodes: [], links: [] } },
  learned: [],
};

/** Fits tests/fixtures/inbox/reply.eml: Person 2 answering the two E2 questions on CAFE-2026-001. */
const REPLY_FACTS = {
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
  };
const UNDERSTAND_REPLY = {
  what: 'A reply from the team answering our two questions about the email scheduler',
  understood: ['About 40 requests a week, mostly from one desk, peaking at month end', 'Two people triage them by hand in a shared mailbox today'],
  kind: 'reply', ideaId: 'CAFE-2026-001', matchConfidence: 0.95, facts: REPLY_FACTS,
  uncertain: ['Whether the month-end peak needs a different flow'],
};
const UNDERSTAND_CONFLICT = {
  what: 'A reply naming a different builder and describing slot finding',
  understood: ['The team wants a different person to build it', 'Finding a free slot across time zones is the hard part'],
  kind: 'reply', ideaId: 'CAFE-2026-001', matchConfidence: 0.9,
  facts: {
    answers: [], replyReceived: true, builderNamed: 'Person 9', newFlags: [], stageHint: null,
    graph: { nodes: [{ type: 'Capability', label: 'Slot findings' }], links: [{ from: 'idea', to: 'Slot findings', rel: 'NEEDS', description: 'Needs to find a slot', confidence: 0.85 }] },
  },
  uncertain: [],
};
const UNDERSTAND_TRANSCRIPT = {
  what: 'A session transcript: the team attended and walked through the current process',
  understood: ['The team attended the session', 'Requests are re-keyed into a tracker by hand'],
  kind: 'transcript', ideaId: 'CAFE-2026-001', matchConfidence: 0.8,
  facts: {
    answers: [], replyReceived: false, builderNamed: null, attendanceConfirmed: true, newFlags: [], stageHint: null,
    graph: { nodes: [{ type: 'PainPoint', label: 'Re-keying into a tracker' }], links: [{ from: 'idea', to: 'Re-keying into a tracker', rel: 'REPLACES', description: 'Removes the re-keying', confidence: 0.75 }] },
  },
  uncertain: [],
};
/** The kit's 14-whiteboard.png and 15-scanned.pdf, as the AI reads them. */
export const WHITEBOARD_TEXT = [
  'CAFE-2026-002 DESK BOOKING',
  'NEEDS: FIND A FREE DESK, SWAP A BOOKING, RELEASE NO-SHOWS',
  'TOOL: COPILOT STUDIO',
  'DATA: FLOOR PLAN SYSTEM',
].join('\n');
/** A picture of a 12-person tracker (synthetic): the screen must hold it. */
const TRACKER_TEXT = ['Name, Employee ID, Phone', ...Array.from({ length: 12 }, (_, i) => `Person ${i + 1}, EMP-${String(i + 1).padStart(4, '0')}, 555-${String(101 + i).padStart(4, '0')}`)].join('\n');
function lookFor(file: string) {
  const name = path.basename(file).toLowerCase();
  if (/whiteboard|scanned/.test(name)) return { text: WHITEBOARD_TEXT, notes: 'A whiteboard photo with a bulleted list', readable: true };
  if (name.includes('tracker')) return { text: TRACKER_TEXT, notes: 'A photo of a printed team tracker', readable: true };
  return { text: '', notes: 'A blank picture', readable: false };
}
const UNDERSTAND_WHITEBOARD = {
  what: 'A whiteboard photo listing what the desk booking idea needs',
  understood: ['It needs to find a free desk, swap a booking and release no-shows', 'Built with Copilot Studio on the floor plan system'],
  kind: 'update', ideaId: 'CAFE-2026-002', matchConfidence: 0.95,
  facts: {
    answers: [], replyReceived: false, builderNamed: null, newFlags: [], stageHint: null,
    graph: {
      nodes: [{ type: 'Capability', label: 'Desk finding' }, { type: 'System', label: 'Floor plan system' }, { type: 'Tool', label: 'Copilot Studio' }],
      links: [
        { from: 'idea', to: 'Desk finding', rel: 'NEEDS', description: 'Finds a free desk', confidence: 0.9 },
        { from: 'Desk finding', to: 'Floor plan system', rel: 'USES_DATA', description: 'Reads the floor plan', confidence: 0.8 },
        { from: 'Desk finding', to: 'Copilot Studio', rel: 'BUILT_WITH', description: 'Built in Copilot Studio', confidence: 0.8 },
      ],
    },
  },
  uncertain: [],
};
/** The kit's 12-text.pdf: a memo on CAFE-2026-004. */
const UNDERSTAND_MEMO = {
  what: 'A memo on the expense anomaly finder: its data, a capability and what finance wants',
  understood: ['The data is the monthly expense system export', 'It needs duplicate claim spotting', 'Finance wants a weekly digest of flagged claims'],
  kind: 'update', ideaId: 'CAFE-2026-004', matchConfidence: 0.95,
  facts: {
    answers: [], replyReceived: false, builderNamed: null, newFlags: [], stageHint: null,
    graph: {
      nodes: [{ type: 'Capability', label: 'Duplicate claim spotting' }, { type: 'System', label: 'Expense system export' }],
      links: [
        { from: 'idea', to: 'Duplicate claim spotting', rel: 'NEEDS', description: 'Spots duplicate claims', confidence: 0.9 },
        { from: 'Duplicate claim spotting', to: 'Expense system export', rel: 'USES_DATA', description: 'Reads the monthly expense export', confidence: 0.8 },
      ],
    },
  },
  uncertain: [],
};
function understandFor(prompt: string) {
  if (prompt.includes('DESK BOOKING')) return UNDERSTAND_WHITEBOARD;
  if (prompt.includes('Duplicate claim spotting')) return UNDERSTAND_MEMO;
  if (/second builder/i.test(prompt)) return UNDERSTAND_CONFLICT;
  if (/"type":"transcript"|-->/.test(prompt)) return UNDERSTAND_TRANSCRIPT;
  return UNDERSTAND_REPLY;
}

/** Three tool picks for any idea, one of them a custom app (a CSIC flag). */
/** One pick with the context it rests on; when the data carries no challenge text and no team answers yet, the questions instead. */
const TOOL_PICK = {
  pick: {
    name: 'Request intake and scheduling', what: 'Takes each request in one place and works out a send slot across time zones', tool: 'custom app',
    reason: 'No approved low-code tool does the scheduling logic; the form part alone would not show the idea', flags: ['custom-app'],
    context: [
      'The challenge describes requests arriving by email and a slot worked out across time zones',
      'Support requested includes Agent Design Guidance, so an agent-shaped build is expected',
      'builderNamed is true, so a Citizen-Led pathway would be possible for a simpler tool',
      'The scheduling logic needs code, which no approved low-code tool provides → custom app, TTIA-Led, CSIC flag',
    ],
  },
};
const TOOL_QUESTIONS = {
  questions: [
    'What does a request look like when it arrives: an email, a form, a chat message?',
    'What must the proof of concept show working on a sample: the intake, the sorting, or the scheduling?',
    'Is any live non-Microsoft system involved, or can a published extract in SharePoint stand in?',
    'Who on the team would build it and attend the sessions?',
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

/** A plan for any approved design: four tasks across two tools (one a custom-app hand-off) and two risks. */
const DESIGN_PLAN = {
  tasks: [
    { title: 'Make the synthetic sample', detail: 'Write twenty made-up requests in a spreadsheet on SharePoint, with the fields the intake needs. No real names or client data.', tool: 'Power Apps', done_when: 'The sample list has twenty rows and no real data' },
    { title: 'Build the request form', detail: 'Make a canvas app on the sample list with one screen to add a request and one to see them all.', tool: 'Power Apps', done_when: 'A request added in the app shows up in the list' },
    { title: 'Hand the intake and scheduling to a coding agent', detail: 'Give Claude Code or GitHub Copilot the instruction in the custom app kit; it works only inside that folder, from design.md and plan.md.', tool: 'custom app', done_when: 'The agent has a running proof of concept on the sample inside the kit folder' },
    { title: 'Show it end to end', detail: 'Run the sample through the proof of concept and show the team the result.', tool: 'custom app', done_when: 'The team has seen the one thing to show work on the sample' },
  ],
  risks: [
    'The scheduling engine is a custom app, so anything beyond the proof of concept needs the CSIC Repository.',
    'The sample may miss a kind of request the team sees often; ask the team to check it.',
  ],
};

/** The scripted plan, with every task on a tool the prompt's features actually picked (so no task lands under Not picked). */
function planForPicks(prompt: string) {
  const picked = [...prompt.matchAll(/"tool"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  if (!picked.length) return DESIGN_PLAN;
  const home = (t: string) => (picked.includes(t) ? t : picked.includes('custom app') ? 'custom app' : picked[0]);
  return { ...DESIGN_PLAN, tasks: DESIGN_PLAN.tasks.map((t) => ({ ...t, tool: home(t.tool) })) };
}

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
/** The tour's hook: CAFE_AI_FAKE_DELAY=<ms> makes every answer slow enough to see a step running. */
async function fakeDelay() {
  const delay = Number(process.env.CAFE_AI_FAKE_DELAY);
  if (delay > 0) await new Promise((r) => setTimeout(r, delay));
}

export function fakeProvider(): Provider {
  return {
    id: 'fake',
    label: 'Fake (test)',
    available: async () => enabled(),
    async complete(prompt) {
      if (!enabled()) throw new Error('The fake AI is off');
      await fakeDelay();
      if (prompt.startsWith('TASK: extract')) return `Here is the JSON:\n${JSON.stringify(EXTRACT)}`;
      if (prompt.startsWith('TASK: review-suggest')) return JSON.stringify(REVIEW);
      if (prompt.startsWith('TASK: understand') || prompt.startsWith('TASK: triage')) return JSON.stringify(understandFor(prompt));
      if (prompt.startsWith('TASK: tool-pick')) return JSON.stringify(/"challenge"\s*:\s*""/.test(prompt) && !/"teamAnswers"\s*:\s*\[\s*\{/.test(prompt) ? TOOL_QUESTIONS : TOOL_PICK);
      if (prompt.startsWith('TASK: design-step')) return JSON.stringify(DESIGN_STEPS[stepsSoFar(prompt)] ?? DESIGN_DONE);
      if (prompt.startsWith('TASK: design-plan')) return JSON.stringify(planForPicks(prompt));
      if (prompt.startsWith('TASK: agent')) return JSON.stringify(agentFor(prompt));
      if (prompt.startsWith('TASK: ping')) return '{"ok":true}';
      return '{}';
    },
    /** A canned transcription chosen by the file name (never opens the file). */
    async look(file) {
      if (!enabled()) throw new Error('The fake AI is off');
      await fakeDelay();
      return JSON.stringify(lookFor(file));
    },
  };
}

/** The Café assistant, by rule from the coded message: a question searches once then answers; link, unlink, put … in,
 * rename … to, merge … into, grow and move (a stage) are proposed; anything else asks what was meant. */
function agentFor(prompt: string) {
  const data = JSON.parse(prompt.slice(prompt.indexOf('<<<DATA') + 7, prompt.indexOf('DATA>>>')));
  const cmd: string = data.message ?? '';
  const codes = [...cmd.matchAll(/\[([A-Z]\d+)\]/g)].map((x) => x[1]);
  const [a, b] = codes;
  const focus: string | undefined = data.focus;
  const propose = (reply: string, actions: unknown[]) => ({ next: 'propose', thought: 'Working out the change', reply, actions });
  if (/\?\s*$/.test(cmd)) {
    const start = a ?? focus;
    if (!data.steps?.length && start) return { next: 'search', thought: `Looking at what links to [${start}]`, query: { steps: [{ op: 'stars', codes: [start] }, { op: 'follow' }] } };
    const found = data.steps?.[0]?.result?.total ?? 0;
    return { next: 'answer', thought: 'Answering', reply: found ? `The graph links [${start}] to ${found} stars.` : 'The graph does not hold that.', followups: ['Who leads them?', 'Which of those are in BSI?'] };
  }
  if (/^\s*grow/i.test(cmd) && (a ?? focus)) return propose(`You asked to grow [${a ?? focus}].`, [{ op: 'grow', a: a ?? focus }]);
  if (/^\s*(unlink|remove)/i.test(cmd) && a && b) return propose(`You asked to remove the link between [${a}] and [${b}].`, [{ op: 'unlink', a, b }]);
  if (/^\s*link/i.test(cmd) && a && b) return propose(`You asked to link [${a}] and [${b}].`, [{ op: 'link', a, b, ...(/sponsor/i.test(cmd) ? { rel: 'SPONSORS' } : {}) }]);
  if (/^\s*put/i.test(cmd)) {
    const ideas = codes.filter((c) => c.startsWith('I')); const round = codes.find((c) => c.startsWith('R'));
    const name = /in (?:a )?(?:new )?round (?:called )?"?([^"]+?)"?\s*$/i.exec(cmd)?.[1];
    return propose('You asked to put the ideas in a round.', [{ op: 'round', ideas, ...(round ? { b: round } : name ? { name } : {}) }]);
  }
  if (/^\s*rename/i.test(cmd) && a) return propose(`You asked to rename [${a}].`, [{ op: 'rename', a, name: /to\s+(.+)$/i.exec(cmd)?.[1]?.trim() || 'Renamed' }]);
  if (/^\s*merge/i.test(cmd) && a && b) return propose(`You asked to merge [${a}] into [${b}].`, [{ op: 'merge', a, b }]);
  if (/^\s*move/i.test(cmd) && a) return propose(`You asked to move [${a}] to another stage.`, [{ op: 'stage', a }]);
  return { next: 'clarify', thought: 'Not sure', reply: 'What would you like me to change, or what would you like to know?' };
}
