import { describe, it, expect } from 'vitest';
import { tmpWorkspace, sampleIdea } from './helpers';
import { saveIdea } from '../src/ideas/store';
import { fixedClock } from '../src/clock';
import { createConnector, type Provider } from '../src/ai/connector';
import { DEFAULT_SETTINGS } from '../src/round/round';
import { runCommand } from '../src/command/chat';
import { fakeProvider } from '../src/ai/providers/fake';
import { appendAiLink } from '../src/graph/store';
import { agentTask, type AgentInput } from '../src/ai/tasks';
import type { AiLink } from '../src/graph/ontology';

// Made-up people only: "Person N".
const clock = fixedClock('2026-10-27');
const IDEAS = [
  sampleIdea({ id: 'CAFE-2026-001', slug: 'desk', title: 'Desk finder', function: 'BSI', entity: 'CS', dedupe_key: 'a',
    current_process: 'People walk the floor to find a desk.', people: { submitter: 'Person 1', team: [{ name: 'Person 1', roles: ['lead'] }] } }),
  sampleIdea({ id: 'CAFE-2026-002', slug: 'faq', title: 'Policy bot', function: 'GSS', entity: 'CS', dedupe_key: 'b',
    current_process: 'A shared mailbox answers each question by hand.', people: { submitter: 'Person 2', team: [{ name: 'Person 2', roles: ['lead'] }, { name: 'Person 3', roles: ['member'] }] } }),
];
const link = (from: string, rel: AiLink['rel'], to: string, type: 'Capability' | 'System', label: string): AiLink =>
  ({ from, rel, to, description: '', source: 'ai:test', confidence: 0.9, status: 'confirmed', newNodes: [{ id: to, type, label }] });

type Turn = (data: any, prompt: string) => unknown;
async function setup(turns: Turn[], provider?: Provider) {
  const root = await tmpWorkspace();
  for (const i of IDEAS) await saveIdea(root, i);
  await appendAiLink(root, link('idea:CAFE-2026-001', 'NEEDS', 'capability:record-update', 'Capability', 'Record update'));
  await appendAiLink(root, link('idea:CAFE-2026-002', 'NEEDS', 'capability:record-update', 'Capability', 'Record update'));
  const prompts: string[] = [];
  let n = 0;
  const p: Provider = provider ?? {
    id: 'claude', label: 'Test AI', available: async () => true,
    complete: async (prompt: string) => {
      prompts.push(prompt);
      const data = JSON.parse(prompt.slice(prompt.indexOf('<<<DATA') + 7, prompt.indexOf('DATA>>>')));
      const out = turns[Math.min(n++, turns.length - 1)](data, prompt);
      return typeof out === 'string' ? out : JSON.stringify(out);
    },
  };
  return { root, prompts, ai: createConnector({ providers: [p], settings: DEFAULT_SETTINGS }) };
}
const dataOf = (prompt: string) => JSON.parse(prompt.slice(prompt.indexOf('<<<DATA') + 7, prompt.indexOf('DATA>>>')));
const code = (data: any, type: string, label?: string) => data.stars.find((s: any) => s.type === type && (!label || s.label === label))?.code;
const grouped = (d: any) => ({ next: 'search', thought: 'Capabilities and their ideas', query: { steps: [{ op: 'stars', type: 'Capability' }, { op: 'follow', rel: 'NEEDS', dir: 'in', type: 'Idea', group: true }] } });

describe('an empty reply never shows the planner\'s note', () => {
  it('the model is asked once more for the reply, with no new steps', async () => {
    const { root, prompts, ai } = await setup([
      grouped,
      () => ({ next: 'answer', thought: 'Answering with the capabilities' }),
      () => ({ next: 'answer', thought: 'Answering', reply: 'Both ideas need record update.' }),
    ]);
    const e = await runCommand(root, 'which capabilities are shared?', ai, clock);
    expect(e.reply).toBe('Both ideas need record update.');
    expect(prompts).toHaveLength(3);
    const third = dataOf(prompts[2]);
    expect(third.stepsLeft).toBe(1);
    expect(prompts[2]).toMatch(/NOTE FROM THE APP: your last step chose answer with no reply/);
  });
  it('still empty: a plain reply from the last results with "From the graph:" in front, never the thought', async () => {
    const { root, ai } = await setup([grouped, () => ({ next: 'answer', thought: 'Answering with the shared capabilities' })]);
    const e = await runCommand(root, 'which capabilities are shared?', ai, clock);
    expect(e.reply).toBe('From the graph: Record update: Desk finder, Policy bot.');
    expect(e.reply).not.toMatch(/Answering/);
    // What the AI sees next time is coded.
    expect(e.coded!.reply).toMatch(/^From the graph: \[C\d+\]: \[I\d+\], \[I\d+\]\.$/);
  });
  it('the prompt says reply is required with answer and propose', () => {
    const p = agentTask.prompt({ message: 'x', stars: [], steps: [], stepsLeft: 5 } as AgentInput);
    expect(p).toMatch(/reply is required with answer, propose and clarify/);
  });
});

describe('the step budget is said exactly, and a false "ran out of steps" is refused', () => {
  it('the prompt says which step this is and how many remain after it', () => {
    const p = agentTask.prompt({ message: 'x', stars: [], steps: [], stepsLeft: 4 } as AgentInput);
    expect(p).toMatch(/This is step 2 of 5\. After it you have 3 more steps\. You have not run out of steps/);
    expect(dataOf(p).stepsLeft).toBe(4);
    const last = agentTask.prompt({ message: 'x', stars: [], steps: [], stepsLeft: 1 } as AgentInput);
    expect(last).toMatch(/This is step 5 of 5, your last: you must answer, propose or clarify now\./);
  });
  it('an answer claiming a step limit with steps left is sent back once, and the next step runs', async () => {
    const { root, prompts, ai } = await setup([
      grouped,
      () => ({ next: 'answer', thought: 'Answering', reply: 'I ran out of steps before checking the leads.' }),
      (d) => ({ next: 'search', thought: 'Leads', query: { steps: [{ op: 'stars', type: 'Idea' }, { op: 'role', role: 'lead' }] } }),
      () => ({ next: 'answer', thought: 'Answering', reply: 'Both ideas have a lead.' }),
    ]);
    const e = await runCommand(root, 'which capabilities are shared, and does each idea have a lead?', ai, clock);
    expect(e.reply).toBe('Both ideas have a lead.');
    expect(dataOf(prompts[2]).steps[1].result.error).toMatch(/You have 3 steps left/);
    expect(e.trace!.flat().map((t) => t.text)).toContain('Asked again: the answer said it ran out of steps with 3 left');
  });
});

describe('a team claim comes from a step that returned it', () => {
  it('a reply naming a team no step returned is sent back once to follow OWNS', async () => {
    const { root, prompts, ai } = await setup([
      (d) => ({ next: 'search', thought: 'The idea', query: { steps: [{ op: 'stars', codes: [code(d, 'Idea', 'Policy bot')] }] } }),
      (d) => ({ next: 'answer', thought: 'Answering', reply: `[${code(d, 'Team', 'GSS')}] owns it.` }),
      (d) => ({ next: 'search', thought: 'Owner', query: { steps: [{ op: 'stars', codes: [code(d, 'Idea', 'Policy bot')] }, { op: 'follow', rel: 'OWNS', dir: 'in', type: 'Team' }] } }),
      (d) => ({ next: 'answer', thought: 'Answering', reply: `[${code(d, 'Team', 'GSS')}] owns it.` }),
    ]);
    const e = await runCommand(root, 'who is behind the policy bot?', ai, clock);
    expect(e.reply).toBe('GSS owns it.');
    expect(dataOf(prompts[2]).steps[1].result.error).toMatch(/follow OWNS \(dir in, type Team\)/);
    expect(e.trace!.flat().some((t) => /GSS owns Policy bot: derived by/.test(t.text))).toBe(true);
  });
});

describe('every step shows in the trace, an error with its words', () => {
  it('a malformed query and a repeated one are traced with their error text', async () => {
    const { root, ai } = await setup([
      () => ({ next: 'search', thought: 'Oops', query: { oops: true } }),
      grouped, grouped,
      () => ({ next: 'answer', thought: 'Answering', reply: 'Done.' }),
    ]);
    const e = await runCommand(root, 'which capabilities are shared?', ai, clock);
    const lines = e.trace!.flat().map((t) => t.text);
    expect(lines.some((t) => /^Not run: The query was malformed/.test(t))).toBe(true);
    expect(lines.some((t) => /^Not run: You already ran this exact search/.test(t))).toBe(true);
  });
});

describe('shared by two teams, what each submitter said: the fake, with Deep read off', () => {
  it('the scoped search reads the current process from each idea\'s record, and the reply quotes each', async () => {
    const root = await tmpWorkspace();
    for (const i of IDEAS) await saveIdea(root, i);
    await appendAiLink(root, link('idea:CAFE-2026-001', 'NEEDS', 'capability:record-update', 'Capability', 'Record update'));
    await appendAiLink(root, link('idea:CAFE-2026-002', 'NEEDS', 'capability:record-update', 'Capability', 'Record update'));
    process.env.CAFE_AI_FAKE = '1';
    try {
      const ai = createConnector({ providers: [fakeProvider()], settings: DEFAULT_SETTINGS });
      const e = await runCommand(root, 'Is there any capability shared by @GSS and @BSI ideas? If so, which ideas, and what did each submitter say the current process is?', ai, clock, { mentions: ['team:gss', 'team:bsi'] });
      expect(e.reply).toContain('Record update');
      expect(e.reply).toContain('Desk finder: "People walk the floor to find a desk."');
      expect(e.reply).toContain('Policy bot: "A shared mailbox answers each question by hand."');
      expect(e.trace!.flat().map((t) => t.text)).toContain('Read current process from the records of 2 ideas');
    } finally { delete process.env.CAFE_AI_FAKE; }
  });
});
