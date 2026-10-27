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

/** The DATA block of a prompt, parsed (empty when it is not JSON). */
function dataOf(prompt: string): Record<string, any> {
  try { return JSON.parse(prompt.slice(prompt.lastIndexOf('<<<DATA') + '<<<DATA'.length, prompt.lastIndexOf('DATA>>>'))); } catch { return {}; }
}

/** Three features for any idea; a feature the operator already has is never suggested again. */
const FEATURES = [
  { name: 'Request intake', what: 'Takes each request in one place', flags: [] },
  { name: 'Send-slot scheduling', what: 'Works out a send slot for each request across time zones', flags: [] },
  { name: 'Weekly summary', what: 'Shows the week\'s requests and their slots on one page', flags: [] },
];
function featuresFor(prompt: string) {
  const have = new Set(((dataOf(prompt).existingFeatures ?? []) as { name: string }[]).map((f) => f.name.toLowerCase()));
  const left = FEATURES.filter((f) => !have.has(f.name.toLowerCase()));
  return { features: left.length ? left : [{ name: 'Sample data set', what: 'Twenty made-up requests to show it on', flags: [] }] };
}

/** One tool for the whole list, with the context it rests on and a fit line per feature; when the data carries no challenge text and no team answers yet, the questions instead. */
const TOOL_PICK = {
  pick: {
    tool: 'custom app',
    reason: 'No approved low-code tool does the scheduling logic; the form part alone would not show the idea', flags: ['custom-app'],
    context: [
      'The challenge describes requests arriving by email and a slot worked out across time zones',
      'Support requested includes Agent Design Guidance, so an agent-shaped build is expected',
      'builderNamed is true, so a Citizen-Led pathway would be possible for a simpler tool',
      'The scheduling logic needs code, which no approved low-code tool provides → custom app, TTIA-Led, CSIC flag',
    ],
    pros: ['Can hold the time-zone scheduling logic the idea needs', 'One place for every request'],
    cons: ['Not a Café build: a custom app is TTIA-Led and goes to the CSIC Repository', 'Needs a developer; no citizen builder can run it'],
    fit: [] as { feature: string; fit: string; note: string }[],
  },
  needs: [],
  updates: { builder: '', builderCanAttend: false, participation: '', resolvedFlags: [], facts: [], graph: { nodes: [], links: [] } },
  learned: [],
};
/** The operator's own tool, evaluated: never another tool. Every feature but the first fits only partly. */
function toolPickFor(prompt: string) {
  const data = dataOf(prompt);
  const features: { name: string }[] = data.features ?? [];
  const tool: string = data.evaluate ?? TOOL_PICK.pick.tool;
  const fit = features.map((f, i) => (i === 0 || tool === 'custom app'
    ? { feature: f.name, fit: 'yes', note: '' }
    : { feature: f.name, fit: 'partly', note: `${tool} cannot do all of this on its own: add Power Automate` }));
  if (!data.evaluate) return { ...TOOL_PICK, pick: { ...TOOL_PICK.pick, fit } };
  return {
    ...TOOL_PICK,
    pick: {
      tool, reason: `The operator chose ${tool}; evaluated for the features`, flags: tool === 'custom app' ? ['custom-app'] : [],
      context: [`Evaluated ${tool} for ${features.length} feature${features.length === 1 ? '' : 's'}`],
      pros: [`${tool} is on the approved list`], cons: tool === 'custom app' ? TOOL_PICK.pick.cons : [`${tool} cannot work out send slots on its own: add Power Automate`],
      fit,
    },
  };
}
const TOOL_QUESTIONS = {
  needs: [
    { need: 'How a request arrives', ask: 'What does a request look like when it arrives: an email, a form, a chat message?', met: false },
    { need: 'What the proof of concept must show', ask: 'What must the proof of concept show working on a sample: the intake, the sorting, or the scheduling?', met: false },
    { need: 'Whether a live system is involved', ask: 'Is any live non-Microsoft system involved, or can a published extract in SharePoint stand in?', met: false },
    { need: 'Who builds it', ask: 'Who on the team would build it and attend the sessions?', met: false },
  ],
  updates: { builder: '', builderCanAttend: false, participation: '', resolvedFlags: [], facts: [], graph: { nodes: [], links: [] } },
  learned: [],
};

/** What the design answers change: nothing, in the script (the design-step reply always carries both). */
const NO_ANSWER_PARTS = {
  updates: { builder: '', builderCanAttend: false, participation: '', resolvedFlags: [], facts: [], graph: { nodes: [], links: [] } },
  learned: [],
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
  summary: 'A proof of concept that shows the one thing agreed above, using a small synthetic sample, built by the team with the one tool picked for the features.',
  // The build points the scripted answers settle though no question asked about them.
  settled: {
    'input-shape': 'Twenty made-up requests in one sheet: date, type, requester role and text; no real names.',
    logic: 'Sort each request by its type column against the team\'s list of types.',
    output: 'A sorted list with the type added, in the same sheet, refreshed on demand.',
    'done-when': 'Five planted requests of each type all land in the right group.',
    environment: 'The team\'s own workspace, sample data only, the builder already has access.',
  },
};

/**
 * What the last design answer changes in the feature list, by rule: "leave … out" drops the first feature the tool
 * fits only partly; "… with Copilot" moves it to Microsoft Copilot, outside the build. Nothing otherwise.
 */
function featureChangesFor(prompt: string) {
  const data = dataOf(prompt) as { stepsSoFar?: { answer: string }[]; features?: { name: string; scope?: string }[]; tool?: { gaps?: { feature: string }[] } };
  const last = data.stepsSoFar?.[data.stepsSoFar.length - 1]?.answer ?? '';
  const open = (data.tool?.gaps ?? []).map((g) => g.feature).find((n) => !(data.features ?? []).some((f) => f.name === n && f.scope));
  if (!open) return [];
  if (/\bleave\b.*\bout\b/i.test(last)) return [{ name: open, change: 'drop', why: 'Left out of the proof of concept' }];
  if (/\bwith (microsoft )?copilot\b/i.test(last)) return [{ name: open, change: 'outside-tool', by: 'Microsoft Copilot', why: 'Drafted with Copilot instead' }];
  return [];
}

/** A diagram for any finished design: the data lane, the tool lane with each feature, the output and who reads it. */
function diagramFor(prompt: string) {
  const data = dataOf(prompt) as { tool?: { tool: string }; features?: { name: string; scope?: string }[] };
  const built = (data.features ?? []).filter((f) => !f.scope).slice(0, 6);
  const nodes = [
    { id: 'input', lane: 'data', label: 'Sample requests', kind: 'input', detail: 'Twenty made-up requests in one sheet.' },
    ...built.map((f, i) => ({ id: `s${i + 1}`, lane: 'tool', label: f.name.slice(0, 40), kind: 'step', detail: `Builds ${f.name}.`, feature: f.name })),
    { id: 'out', lane: 'tool', label: 'Sorted list', kind: 'output', detail: 'The list with a type on every request.' },
    { id: 'team', lane: 'people', label: 'The team', kind: 'person', detail: 'Reads the sorted list.' },
  ];
  return {
    lanes: [{ id: 'data', label: 'Data', kind: 'data' }, { id: 'tool', label: data.tool?.tool ?? 'The tool', kind: 'tool' }, { id: 'people', label: 'People', kind: 'person' }],
    nodes,
    edges: [
      ...built.map((_, i) => ({ from: 'input', to: `s${i + 1}` })), ...built.map((_, i) => ({ from: `s${i + 1}`, to: 'out' })),
      { from: 'out', to: 'team', label: 'reads' },
    ],
  };
}

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

/**
 * A filled-in kit for any approved design: a request sample (with ten weekend requests seeded), a check per built
 * feature, the picked tool's own section and a short setup for each outside tool.
 */
function kitFor(prompt: string) {
  const data = dataOf(prompt) as { tool?: { tool: string }; features?: { name: string; status: string }[]; outsideTools?: string[] };
  const tool = data.tool?.tool ?? '';
  const built = (data.features ?? []).filter((f) => f.status === 'built').map((f) => f.name);
  const first = built[0] ?? 'The rule';
  const kit: Record<string, unknown> = {
    sample: {
      name: 'Synthetic requests',
      columns: [
        { name: 'request_id', kind: 'id', about: 'The request number, REQ-001 on' },
        { name: 'received_on', kind: 'date', about: 'The day it came in, YYYY-MM-DD' },
        { name: 'desk', kind: 'category', about: 'The desk it is for: EMEA, AMER or APAC' },
        { name: 'requester', kind: 'person', about: 'Who sent it (a role, never a name)' },
        { name: 'amount', kind: 'money', about: 'The amount asked for, a plain number' },
      ],
      rows: [
        ['REQ-001', '2026-10-05', 'EMEA', 'analyst', '120.50'],
        ['REQ-002', '2026-10-06', 'AMER', 'associate', '80'],
        ['REQ-003', '2026-10-07', 'APAC', 'analyst', '45.25'],
      ],
      seeded: [{ label: 'Weekend request', count: 10, row: ['REQ-900', '2026-10-10', 'EMEA', 'analyst', '60'], expect: 'All 10 are flagged as weekend requests' }],
    },
    checks: [
      { check: 'Run the whole sample through it.', expected: 'The 10 rows marked T1 are flagged and no other row is' },
      ...built.map((f) => ({ check: `Use ${f} on the sample.`, expected: `${f} works on all 34 rows`, feature: f })),
    ],
    outside: (data.outsideTools ?? []).map((t) => ({ tool: t, setup: [`Set up ${t} on the sample only.`], test: [`${t} gives the same result as the main build on the sample.`] })),
  };
  if (tool === 'Microsoft Copilot') kit.copilot = { prompts: built.map((f) => ({ title: `Try ${f}`, feature: f, prompt: `Using only the attached sample-data.csv, list the requests where received_on falls on a Saturday or Sunday (${f}).`, expected: 'The 10 requests REQ-025 to REQ-034' })) };
  if (tool === 'Copilot Studio') {
    kit.studio = {
      name: 'Request helper', purpose: 'Answers questions about the requests in the sample and flags weekend ones.', tone: 'Plain, short and friendly.',
      must: ['Say which rows an answer comes from'], mustNot: ['Guess an answer the sample does not hold'], handover: ['A request is not in the sample: hand over to the desk lead'],
      skills: built.map((f) => ({ feature: f, name: f, triggers: ['Which requests came in at the weekend?', 'Show weekend requests', 'Any Saturday requests?'], inputs: ['The desk (optional)'], steps: ['Read the sample', 'Pick the rows whose received_on is a Saturday or Sunday'], answer: 'A short list of the request ids', action: 'none' })),
      knowledge: [{ source: 'sample-data.csv', holds: 'The synthetic requests', add: true }, { source: 'The live request mailbox', holds: 'Real requests', add: false, why: 'Real data: never in a proof of concept' }],
      tests: [{ question: 'Which requests came in at the weekend?', expected: 'REQ-025 to REQ-034' }],
    };
  }
  if (tool === 'custom app') {
    kit.customApp = {
      screens: built.map((f) => ({ name: f, feature: f, shows: `The requests, with what ${f} finds`, columns: ['request_id', 'received_on', 'desk', 'amount'], action: 'Export the flagged list' })),
      rules: [{ name: 'Weekend request', feature: first, logic: 'Flag a request when received_on is a Saturday or Sunday', columns: ['received_on'] }],
    };
  }
  if (tool === 'Power Apps') {
    kit.powerApps = {
      tables: [{ name: 'Requests', purpose: 'The sample, one row per request', columns: [{ name: 'request_id', type: 'Single line of text', note: '' }, { name: 'received_on', type: 'Date only', note: '' }, { name: 'Weekend', type: 'Yes/No', note: 'Set by the app' }] }],
      screens: [{ name: 'Browse', purpose: 'Every request, weekend ones first', feature: first, controls: [{ name: 'galRequests', kind: 'Gallery', does: 'Lists the requests', formula: 'SortByColumns(Requests, "received_on")' }, { name: 'tglWeekend', kind: 'Toggle', does: 'Shows weekend requests only', formula: 'Filter(Requests, Weekday(received_on) in [1, 7])' }] }],
      flows: [{ name: 'Weekly summary', trigger: 'Every Monday at 08:00', steps: ['Get the requests of the last week', 'Post the count of weekend ones to the team chat'] }],
    };
  }
  if (tool === 'Dataiku') {
    kit.dataiku = {
      datasets: [
        { id: 'requests', name: 'requests_sample', kind: 'input', about: 'Uploaded from sample-data.csv', columns: [{ name: 'request_id', type: 'string' }, { name: 'received_on', type: 'date' }, { name: 'amount', type: 'double' }] },
        { id: 'rules', name: 'desk_rules', kind: 'rules', about: 'Which desks work weekends', columns: [{ name: 'desk', type: 'string' }, { name: 'weekend_ok', type: 'boolean' }] },
        { id: 'joined', name: 'requests_with_rules', kind: 'intermediate', about: '', columns: [] },
        { id: 'flagged', name: 'weekend_flags', kind: 'output', about: 'One row per flagged request', columns: [{ name: 'request_id', type: 'string' }, { name: 'reason', type: 'string' }] },
      ],
      recipes: [
        { id: 'r1', name: 'Join the desk rules', kind: 'join', inputs: ['requests', 'rules'], outputs: ['joined'], steps: ['Left join requests_sample to desk_rules on desk'] },
        { id: 'r2', name: first, kind: 'prepare', inputs: ['joined'], outputs: ['flagged'], steps: ['Formula: is_weekend = weekday(received_on) >= 6', 'Filter: keep rows where is_weekend and not weekend_ok'], feature: first },
      ],
      dashboard: { name: 'Weekend requests', shows: ['The count of flagged requests by desk'], from: ['flagged'] },
      rules: { columns: ['desk', 'weekend_ok'], rows: [['EMEA', 'false'], ['AMER', 'false'], ['APAC', 'true']] },
    };
  }
  return kit;
}

/** How many Q/A pairs the design-step prompt carries (its DATA block's stepsSoFar). */
function stepsSoFar(prompt: string): number {
  const data = dataOf(prompt) as { stepsSoFar?: unknown[] };
  return Array.isArray(data.stepsSoFar) ? data.stepsSoFar.length : 0;
}

/** The roadshow's to-do list: what was hard, the demo, the one question. An item is met once an answer asks its question. */
const ROADSHOW_NEEDS = [
  { need: 'What was hard', ask: 'What was the hardest part of building it, and how did you get past it?' },
  { need: 'How the demo runs', ask: 'How will you run the demo: a link to the proof of concept, or a recording?' },
  { need: 'One question for the room', ask: 'What one question would you like the room to answer?' },
];
function roadshowPrepFor(prompt: string) {
  const data = dataOf(prompt) as { answers?: { question: string; answer: string }[]; todo?: { need: string; ask: string }[] };
  const answered = (ask: string) => (data.answers ?? []).find((a) => a.question === ask && a.answer.trim());
  const items = data.todo?.length ? data.todo : ROADSHOW_NEEDS;
  return {
    needs: items.map((n) => { const a = answered(n.ask); return { ...n, met: !!a, ...(a ? { answer: a.answer.slice(0, 120) } : {}) }; }),
    learned: [],
  };
}

/** A whole deck from DATA: every kind of slide the data supports, the visuals it offers, about ten minutes. */
function roadshowDeckFor(prompt: string) {
  const data = dataOf(prompt) as { idea?: { title?: string; challenge?: string }; team?: { code: string }[]; visuals?: string[]; tool?: { tool: string }; roadshow?: { name?: string } };
  const v = new Set(data.visuals ?? []);
  const title = data.idea?.title || 'Our proof of concept';
  const lead = data.team?.[0]?.code ?? 'the team';
  const slide = (kind: string, t: string, points: string[], minutes: number, extra: object = {}) => ({ kind, title: t, points, notes: `${t}. We will talk this through in plain words. [click]`, minutes, ...extra });
  return {
    title, subtitle: `Presented by ${lead}${data.roadshow?.name ? ` at the ${data.roadshow.name} roadshow` : ''}`,
    slides: [
      slide('title', title, [], 0.5),
      slide('problem', 'The problem, in one sentence', [(data.idea?.challenge ?? 'The work is done by hand today').slice(0, 150)], 1),
      slide('today', 'How it works today', [], 1, { visual: 'before-after', before: ['Done by hand', 'Checked by eye'], after: ['Checked on sample data', 'One list to review'] }),
      ...(v.has('team') ? [slide('team', 'The team behind it', [], 0.5, { visual: 'team' })] : []),
      slide('solution', 'What we built', ['A proof of concept on sample data'], 1),
      ...(v.has('data') ? [slide('data', 'The data it runs on', ['Sample, masked data in; a list out'], 0.5, { visual: 'data' })] : []),
      ...(v.has('diagram') ? [slide('diagram', 'How it fits together', ['Sample data in, a list out'], 0.75, { visual: 'diagram' })] : []),
      ...(v.has('fit-table') ? [slide('tool', `Built with ${data.tool?.tool ?? 'one tool'}`, ['One tool for the whole proof of concept'], 0.75, { visual: 'fit-table' })] : []),
      { ...slide('demo', 'The demo', ['Load the sample', 'Run the check', 'Read the result'], 2.5), notes: `${lead} shows it. [switch to the demo] Load the sample, run the check, read the result. [back to the slides]` },
      slide('headaches', 'What was hard', ['Getting a realistic sample'], 0.75),
      slide('lessons', 'What we learned', ['Start with the smallest sample'], 0.5),
      slide('reuse', 'To reuse it', ['A licence for the tool', 'A builder', 'A data source'], 0.5),
      slide('question', 'One question for you', ['Who else has this problem?'], 0.5),
      slide('thanks', 'Thank you', [], 0.25),
    ],
  };
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
      if (prompt.startsWith('TASK: feature-list')) return JSON.stringify(featuresFor(prompt));
      if (prompt.startsWith('TASK: tool-pick')) return JSON.stringify(/"challenge"\s*:\s*""/.test(prompt) && !/"teamAnswers"\s*:\s*\[\s*\{/.test(prompt) ? TOOL_QUESTIONS : toolPickFor(prompt));
      if (prompt.startsWith('TASK: design-step')) return JSON.stringify({ ...(DESIGN_STEPS[stepsSoFar(prompt)] ?? DESIGN_DONE), ...NO_ANSWER_PARTS, features: featureChangesFor(prompt) });
      if (prompt.startsWith('TASK: design-diagram')) return JSON.stringify(diagramFor(prompt));
      if (prompt.startsWith('TASK: design-plan')) return JSON.stringify(planForPicks(prompt));
      if (prompt.startsWith('TASK: design-kit')) return JSON.stringify(kitFor(prompt));
      if (prompt.startsWith('TASK: roadshow-prep')) return JSON.stringify(roadshowPrepFor(prompt));
      if (prompt.startsWith('TASK: roadshow-deck')) return JSON.stringify(roadshowDeckFor(prompt));
      if (prompt.startsWith('TASK: data-understand')) return JSON.stringify(dataUnderstandFor(prompt));
      if (prompt.startsWith('TASK: data-step')) return JSON.stringify(dataStepFor(prompt));
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
  const legend: { code: string; type: string; label?: string }[] = data.stars ?? [];
  /** "which ideas depend on [S1]": the answer from a DEPENDS_ON (system) or USES (tool) step's result, the reasons in brackets, the reading (a second step) apart. */
  const dependAnswer = (subject: { code: string; type: string }, graphStep: any, readStep?: any) => {
    const rel = subject.type === 'Tool' ? 'USES' : 'DEPENDS_ON';
    const why: { from: string; to: string; why: string }[] = graphStep?.result?.reasons ?? [];
    const byGraph: { code: string }[] = graphStep?.result?.stars ?? [];
    const graphSet = new Set(byGraph.map((x) => x.code));
    const byReading: string[] = (readStep?.result?.stars ?? []).map((x: { code: string }) => x.code).filter((c: string) => !graphSet.has(c));
    const one = byGraph.length === 1;
    const verb = rel === 'USES' ? (one ? 'uses' : 'use') : (one ? 'depends on' : 'depend on');
    const list = byGraph.map((x) => { const r = why.find((w) => w.from === x.code); return `[${x.code}]${r ? ` (${r.why})` : ''}`; }).join(', ');
    return `By the graph, ${byGraph.length} idea${one ? '' : 's'} ${verb} [${subject.code}]${byGraph.length ? `: ${list}` : ''}.${byReading.length ? ` By reading, the text also names it in: ${byReading.map((c) => `[${c}]`).join(', ')}.` : ''}`;
  };
  const addStar = /^\s*add\s+(?:a|an|the)?\s*(pain point|capability|system|support|outcome|beneficiary|category)\s+(.+?)\s+to\s+\[/i;
  const addFor = (m: RegExpExecArray, home: string) => {
    const type = { 'pain point': 'PainPoint', capability: 'Capability', system: 'System', support: 'Support', outcome: 'Outcome', beneficiary: 'Beneficiary', category: 'Category' }[m[1].toLowerCase()];
    return { op: 'add_star', type, name: m[2].trim(), b: home };
  };
  // "add a system X to [I1], then tell me which ideas depend on [S1]": the question is searched first, then the add is proposed with the answer kept apart in answer.
  const twoPart = /^(.*?\]),?\s*(?:and\s+)?then\s+tell\s+me\s+(.+)$/i.exec(cmd);
  const subjectIn = (text: string) => { const c = /\[([A-Z]\d+)\]/.exec(text)?.[1]; return legend.find((x) => x.code === c && (x.type === 'System' || x.type === 'Tool')) ?? legend.find((x) => x.type === 'System' || x.type === 'Tool'); };
  if (twoPart && addStar.test(twoPart[1]) && a && /depend|rework|affect|retir|\bhit\b|break|rewrit/i.test(twoPart[2]) && subjectIn(twoPart[2])) {
    const subject = subjectIn(twoPart[2])!;
    const rel = subject.type === 'Tool' ? 'USES' : 'DEPENDS_ON';
    if (!data.steps?.length) return { next: 'search', thought: `Looking at what ${rel === 'USES' ? 'uses' : 'depends on'} [${subject.code}] first`, query: { steps: [{ op: 'stars', codes: [subject.code] }, { op: 'follow', rel, dir: 'in', type: 'Idea' }] } };
    const m = addStar.exec(twoPart[1])!;
    return { next: 'propose', thought: 'Proposing the add, the question answered', reply: `You asked to add a ${m[1]} to [${a}].`, answer: dependAnswer(subject, data.steps[0]), actions: [addFor(m, a)] };
  }
  // "is there a capability shared by [T1] and [T2] ideas? which ideas, and what did each submitter say the current process is?":
  // one grouped query (each side's ideas, their capabilities, the intersection, then back to the ideas per capability), then, once Deep read has run and the question asks what they wrote, a search kept to those ideas.
  const sharedBy = /shared by \[([A-Z]\d+)\] and \[([A-Z]\d+)\]/i.exec(cmd);
  const sides = sharedBy ? [sharedBy[1], sharedBy[2]].map((c) => legend.find((x) => x.code === c && x.type === 'Team')) : [];
  if (sharedBy && sides[0]?.label && sides[1]?.label) {
    const wrote = /current process|wrote|say|said|challenge|answer/i.test(cmd);
    const [x, y] = sides as { label: string }[];
    if (!data.steps?.length) {
      return { next: 'search', thought: `Looking for the capabilities both [${sharedBy[1]}] and [${sharedBy[2]}] ideas need, and which ideas`, query: { steps: [
        { op: 'stars', type: 'Idea', function: x.label }, { op: 'follow', rel: 'NEEDS', type: 'Capability' },
        { op: 'intersect', with: [{ op: 'stars', type: 'Idea', function: y.label }, { op: 'follow', rel: 'NEEDS', type: 'Capability' }] },
        { op: 'follow', rel: 'NEEDS', dir: 'in', type: 'Idea', group: true },
      ] } };
    }
    if (data.steps.length === 1 && wrote && data.deepRead?.on) return { next: 'search', thought: 'Reading what each submitter wrote about the current process', query: { steps: [{ op: 'search', match: 'current process', last: true, limit: 8 }] } };
    const groups: { from: string; to: string[] }[] = data.steps[0]?.result?.groups ?? [];
    const byGraph = groups.length ? `By the graph, ${groups.map((g) => `[${g.from}]: ${g.to.map((c) => `[${c}]`).join(', ')} (both need it)`).join('; ')}.` : `By the graph, no capability is needed by both a [${sharedBy[1]}] and a [${sharedBy[2]}] idea.`;
    const hits: { idea: string; section: string; text: string }[] = data.steps[1]?.result?.hits ?? [];
    const seen = new Set<string>();
    const quoted = hits.filter((h) => h.section === 'current_process' && !seen.has(h.idea) && seen.add(h.idea)).map((h) => `[${h.idea}]: "${h.text.slice(0, 80)}"`);
    const reading = !wrote ? '' : !data.deepRead?.on ? ' Deep read has not read what they wrote yet.' : quoted.length ? ` By reading, the current process: ${quoted.join('; ')}.` : ' By reading, no current process text was found for them.';
    return { next: 'answer', thought: 'Answering per capability, the reading apart', reply: `${byGraph}${reading}`, followups: ['Who leads each of them?'] };
  }
  if (/\?\s*$/.test(cmd)) {
    const start = a ?? focus;
    // "which ideas are similar to [I1]?": the derived SIMILAR_TO links first (facts, with the shared stars), then Deep read's reading when it has run.
    if (start && /similar|\blike\b|same as|overlap/i.test(cmd)) {
      if (!data.steps?.length) return { next: 'search', thought: `Looking for the ideas SIMILAR_TO [${start}] by shared stars`, query: { steps: [{ op: 'stars', codes: [start] }, { op: 'follow', rel: 'SIMILAR_TO', type: 'Idea' }] } };
      if (data.steps.length === 1 && data.deepRead?.on) return { next: 'search', thought: `Reading for ideas near [${start}]`, query: { steps: [{ op: 'similar', codes: [start], limit: 5 }] } };
      const shared: { from: string; to: string; why: string }[] = data.steps[0]?.result?.reasons ?? [];
      const byStars = shared.map((r) => ({ code: r.from === start ? r.to : r.from, why: r.why }));
      const seen = new Set([start, ...byStars.map((x) => x.code)]);
      const byReading: string[] = (data.steps[1]?.result?.stars ?? []).map((x: { code: string }) => x.code).filter((c: string) => !seen.has(c));
      const reply = `By shared stars: ${byStars.length ? byStars.map((x) => `[${x.code}] (${x.why})`).join(', ') : 'none'}.${byReading.length ? ` By reading, also: ${byReading.map((c) => `[${c}]`).join(', ')}.` : ''}`;
      return { next: 'answer', thought: 'Answering: the graph first, the reading second', reply, followups: [`What does [${start}] need?`] };
    }
    // "who is [P1]?": their roles per idea from the ideas' records, then their team star, then the answer states both.
    if (start && /who is\b/i.test(cmd)) {
      if (!data.steps?.length) return { next: 'search', thought: `Looking at what [${start}] does on each idea`, query: { steps: [{ op: 'stars', codes: [start] }, { op: 'role' }] } };
      if (data.steps.length === 1) return { next: 'search', thought: `Looking for the team of [${start}]`, query: { steps: [{ op: 'stars', codes: [start] }, { op: 'follow', rel: 'HAS_MEMBER', dir: 'in', type: 'Team' }] } };
      const facts: { code: string; roles: { idea: string; role: string }[]; team: string }[] = data.steps[0]?.result?.people ?? [];
      const me = facts.find((p) => p.code === start);
      if (!me) return { next: 'answer', thought: 'Answering', reply: `The graph holds no idea that [${start}] has a role on; no team recorded.`, followups: ['Which ideas are in BSI?'] };
      const byIdea = new Map<string, string[]>();
      for (const r of me.roles) byIdea.set(r.idea, [...(byIdea.get(r.idea) ?? []), r.role]);
      const roles = [...byIdea].map(([idea, rs]) => `the ${rs.join(' and ')} of [${idea}]`).join(', and ');
      const team = me.team === 'no team recorded' ? 'no team recorded' : `team: [${me.team}]`;
      return { next: 'answer', thought: 'Answering from the roles and the team', reply: `[${start}] is ${roles}; ${team}.`, followups: [`What else is [${start}] linked to?`] };
    }
    // "which team owns [I1]?": the derived OWNS link from the submitter's team, never worked out through a lead; the reason names the submitter.
    const owned = legend.find((x) => x.code === start && x.type === 'Idea') ?? legend.find((x) => x.type === 'Idea');
    if (owned && /\bowns?\b|\bwhose\b|behind/i.test(cmd)) {
      if (!data.steps?.length) return { next: 'search', thought: `Looking at which team owns [${owned.code}]`, query: { steps: [{ op: 'stars', codes: [owned.code] }, { op: 'follow', rel: 'OWNS', dir: 'in', type: 'Team' }] } };
      const why: { from: string; to: string; why: string }[] = data.steps[0]?.result?.reasons ?? [];
      const said = why.map((r) => `[${r.from}] owns [${r.to}] (via the submitter ${r.why.replace(/^via /, '')})`);
      return { next: 'answer', thought: 'Answering from the derived OWNS link', reply: said.length ? `By the graph, ${said.join('; ')}.` : `The graph records no team behind [${owned.code}]: no submitter with a team.`, followups: [`Who leads [${owned.code}]?`] };
    }
    // "which ideas depend on / would need rework if [S1] is rewritten?": the derived relation first (DEPENDS_ON for a system, USES for a tool),
    // so the trace names the rule; then, once Deep read has run, a search of the text, kept apart as a reading.
    const subject = legend.find((x) => x.code === start && (x.type === 'System' || x.type === 'Tool')) ?? legend.find((x) => x.type === 'System' || x.type === 'Tool');
    if (subject && /depend|rework|affect|retir|\bhit\b|break|rewrit/i.test(cmd)) {
      const rel = subject.type === 'Tool' ? 'USES' : 'DEPENDS_ON';
      if (!data.steps?.length) return { next: 'search', thought: `Looking at what ${rel === 'USES' ? 'uses' : 'depends on'} [${subject.code}]`, query: { steps: [{ op: 'stars', codes: [subject.code] }, { op: 'follow', rel, dir: 'in', type: 'Idea' }] } };
      if (data.steps.length === 1 && data.deepRead?.on && subject.label) return { next: 'search', thought: `Reading what the text says about [${subject.code}]`, query: { steps: [{ op: 'search', match: subject.label.toLowerCase().slice(0, 60) }] } };
      return { next: 'answer', thought: 'Answering: the derived links first, the reading second', reply: dependAnswer(subject, data.steps[0], data.steps[1]), followups: ['Who leads each of them?'] };
    }
    if (!data.steps?.length && start) return { next: 'search', thought: `Looking at what links to [${start}]`, query: { steps: [{ op: 'stars', codes: [start] }, { op: 'follow' }] } };
    // A plain question with no star: once Deep read has run, search what people wrote and answer from the hits.
    if (!start && data.deepRead?.on) {
      if (!data.steps?.length) return { next: 'search', thought: 'Searching what people wrote', query: { steps: [{ op: 'search', match: cmd.replace(/\?\s*$/, '').trim().slice(0, 60) }] } };
      const hits: { idea: string; section: string; text: string }[] = data.steps[0]?.result?.hits ?? [];
      const n: number = data.steps[0]?.result?.total ?? 0;
      return { next: 'answer', thought: 'Answering from the passages', reply: hits.length ? `${n} idea${n === 1 ? '' : 's'} mention${n === 1 ? 's' : ''} that. ${hits.slice(0, 2).map((h) => `[${h.idea}] (${h.section}): "${h.text.slice(0, 80)}"`).join(' ')}` : 'Nothing people wrote mentions that.', followups: ['Which of those are in BSI?'] };
    }
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
  if (/^\s*alias\s+(.+?)\s+as\s+\[/i.test(cmd) && a) return propose(`You asked to give [${a}] another name.`, [{ op: 'alias', a, name: /^\s*alias\s+(.+?)\s+as\s+\[/i.exec(cmd)![1].trim() }]);
  if (/^\s*move/i.test(cmd) && a) return propose(`You asked to move [${a}] to another stage.`, [{ op: 'stage', a }]);
  if (/^\s*export/i.test(cmd)) return propose(a ? `You asked to export [${a}] and what it touches.` : 'You asked to export the graph.', [{ op: 'export', ...(a ? { a } : {}) }]);
  if (addStar.test(cmd) && a) {
    const m = addStar.exec(cmd)!;
    return propose(`You asked to add a ${m[1]} to [${a}].`, [addFor(m, a)]);
  }
  return { next: 'clarify', thought: 'Not sure', reply: 'What would you like me to change, or what would you like to know?' };
}

/** The kind keys by their labels, as the prompt sends them. */
const KIND_BY_LABEL: Record<string, string> = {
  'Sample input': 'input', 'Sample output (what it should produce)': 'output', "Today's output or report": 'today', 'Rules or reference': 'rules',
  'Process document': 'process', 'Example email': 'email', Other: 'other',
};

/**
 * One file understood, by rule from its profile: first a closer look at its first category column (when it may look),
 * then every column with a plain meaning, a rule for a rules file, derivations for an output from the other files'
 * first column, and the features it serves (all of them). Never a column the profile does not have.
 */
function dataUnderstandFor(prompt: string) {
  const data = dataOf(prompt) as {
    file?: { name: string; kind: string; tables?: { name: string; columns: { name: string; type: string }[] }[]; doc?: { headings: string[] } };
    otherFiles?: { name: string; columns: string[] }[]; features?: { name: string }[]; lookAllowed?: boolean; looks?: unknown[];
  };
  const f = data.file ?? { name: 'file', kind: 'Other' };
  const cols = (f.tables ?? []).flatMap((t) => t.columns.map((c) => ({ ...c, table: (f.tables ?? []).length > 1 ? t.name : '' })));
  const cat = cols.find((c) => c.type === 'category' && /type|kind|code/.test(c.name)) ?? cols.find((c) => c.type === 'category');
  if (data.lookAllowed && !data.looks?.length && cat) return { look: [{ column: cat.name, why: 'To read its codes' }], what: 'A table', kindHint: KIND_BY_LABEL[f.kind] ?? 'other', columns: [], points: [], rules: [], derivations: [], serves: [], issues: [], missing: [] };
  const kind = KIND_BY_LABEL[f.kind] ?? 'other';
  const other = data.otherFiles?.[0]?.columns?.[0];
  return {
    look: [], what: cols.length ? `${f.kind} with ${cols.length} columns` : `${f.kind}: ${(f.doc?.headings ?? []).slice(0, 2).join(', ') || 'a short document'}`,
    kindHint: kind,
    columns: [...cols.map((c) => ({ name: c.name, table: c.table, meaning: `The ${c.name.replace(/_/g, ' ')} of each row`, role: c.type === 'money' ? 'amount' : c.type === 'date' ? 'date' : c.type === 'category' ? 'category' : 'input', ...(c === cat ? { codes: 'Each code is a kind of row' } : {}) })),
      { name: 'not_a_column', meaning: 'Made up by the AI' }],
    points: cols.length ? [] : ['It says how the work is done today'],
    rules: kind === 'rules' && cols.length >= 2 ? [{ rule: `${cols[1].name} per ${cols[0].name}`, columns: [cols[0].name, cols[1].name] }] : [],
    derivations: kind === 'output' && cols.length ? cols.slice(0, 2).map((c) => ({ output: c.name, from: other ? [other] : [], how: `Worked out from ${other ?? 'the input'}` })) : [],
    serves: (data.features ?? []).map((x) => x.name),
    issues: [], missing: kind === 'input' && cat ? [`What the codes in ${cat.name} mean`] : [],
  };
}

/** The data questions, by rule: the output first when no output file is there, then the volumes, then complete. */
function dataStepFor(prompt: string) {
  const data = dataOf(prompt) as { stepsSoFar?: { question: string; answer: string; topic?: string }[]; gaps?: { topic: string }[]; files?: { name: string; kind: string }[]; teamAnswers?: { question: string; answer: string }[] };
  const steps = data.stepsSoFar ?? [];
  // An earlier answer that gives a count per month, week or day settles the volumes: quoted, not asked again.
  const volume = (data.teamAnswers ?? []).find((a) => /\d[\d,.]*\s+\w+.*\b(a|per|each)\s+(month|week|day)\b/i.test(a.answer));
  const settled = volume ? [{ topic: 'volumes', answer: volume.answer }] : [];
  const asked = (t: string) => steps.some((s) => s.topic === t) || settled.some((s) => s.topic === t);
  const last = steps[steps.length - 1]?.answer ?? '';
  const from = /from (?:the )?([A-Z][A-Za-z ]{2,30}?)(?: export| system|[.,]|$)/.exec(last)?.[1];
  const updates = {
    ...NO_ANSWER_PARTS.updates,
    facts: /\d/.test(last) && steps[steps.length - 1]?.topic === 'volumes' ? [{ question: steps[steps.length - 1].question, answer: last }] : [],
    graph: from ? {
      nodes: [{ type: 'Capability', label: 'Sample data check' }, { type: 'System', label: from }],
      links: [{ from: 'idea', to: 'Sample data check', rel: 'NEEDS', description: 'Checks the sample data', confidence: 0.8 }, { from: 'Sample data check', to: from, rel: 'USES_DATA', description: 'The export comes from it', confidence: 0.8 }],
    } : { nodes: [], links: [] },
  };
  const gap = (t: string) => (data.gaps ?? []).some((g) => g.topic === t);
  if (gap('output') && !asked('output')) {
    return { done: false, topic: 'output', question: 'What should the proof of concept produce from the sample?', why: 'There is no sample of the output yet.', suggested: ['A list of flagged rows with a reason', 'A summary by category', 'I will drop a sample output'], updates, learned: [], settled };
  }
  if (!asked('volumes')) {
    return { done: false, topic: 'volumes', question: 'How many rows does a real run have, and how often?', why: 'The size and rhythm shape the build.', suggested: ['About 1,000 rows a month', 'About 200 rows a week', 'A few thousand rows a quarter'], updates, learned: [], settled };
  }
  const names = (data.files ?? []).map((x) => x.name).join(', ') || 'the answers';
  return {
    done: true,
    summary: { text: `The data is understood: ${names}.`, input: 'The sample input as dropped.', output: 'As the answers say.', knowledge: '', rules: 'As the rules file says.', gapsClosed: ['The output', 'The volumes'] },
    updates, learned: [], settled,
  };
}
