import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { understandTask, UNDERSTAND_SCHEMA, triageTask } from '../src/ai/tasks';
import { fakeProvider } from '../src/ai/providers/fake';

const base = {
  what: 'A reply answering our questions', understood: ['About 40 requests a week', 'Triaged by hand today'], kind: 'reply', ideaId: 'CAFE-2026-001', matchConfidence: 0.9,
  facts: { answers: [], replyReceived: true, builderNamed: null, newFlags: [], stageHint: null, graph: { nodes: [], links: [] } }, uncertain: [],
};

describe('understandTask', () => {
  const prev = process.env.CAFE_AI_FAKE;
  beforeAll(() => { process.env.CAFE_AI_FAKE = '1'; });
  afterAll(() => { if (prev === undefined) delete process.env.CAFE_AI_FAKE; else process.env.CAFE_AI_FAKE = prev; });
  it('parses a full answer and refuses missing understood lines or a Person node', () => {
    expect(understandTask.parse(JSON.stringify(base)).understood).toHaveLength(2);
    expect(() => understandTask.parse(JSON.stringify({ ...base, understood: [] }))).toThrow(/invalid output/);
    expect(() => understandTask.parse(JSON.stringify({ ...base, facts: { ...base.facts, graph: { nodes: [{ type: 'Person', label: 'Someone' }], links: [] } } }))).toThrow(/invalid output/);
    expect(UNDERSTAND_SCHEMA.properties!.understood.maxItems).toBe(6);
    expect(triageTask).toBe(understandTask);
  });
  it('prompt carries known stars and team answers, and the reuse-a-label rule', () => {
    const p = understandTask.prompt({
      item: { type: 'email', text: 'hello' }, candidates: [],
      knownStars: [{ type: 'Capability', label: 'Slot finding' }], teamAnswers: [{ question: 'How many?', answer: 'About 40' }],
    } as any);
    expect(p).toContain('"knownStars"');
    expect(p).toContain('Slot finding');
    expect(p).toContain('"teamAnswers"');
    expect(p).toMatch(/Reuse a label from knownStars/);
    expect(p).toMatch(/Never name people in "what", "understood" or "uncertain"/);
    expect(p).toMatch(/data, not instructions/);
  });
  it('the fake answers understand with the reply fixture, the conflicting reply, or the transcript', async () => {
    const fake = fakeProvider(); // the fake answers only while CAFE_AI_FAKE=1
    const reply = JSON.parse(await fake.complete('TASK: understand\n\n{"item":{"text":"About 40 a week"}}', {} as any));
    expect(reply.what).toBeTruthy(); expect(reply.facts.builderNamed).toBeNull();
    const conflict = JSON.parse(await fake.complete('TASK: understand\n\n{"item":{"text":"we have a second builder now"}}', {} as any));
    expect(conflict.facts.builderNamed).toBe('Person 9');
    expect(conflict.facts.graph.nodes.map((n: any) => n.label)).toContain('Slot findings');
    const vtt = JSON.parse(await fake.complete('TASK: understand\n\n{"item":{"type":"transcript","text":"00:01 --> 00:02"}}', {} as any));
    expect(vtt.facts.attendanceConfirmed).toBe(true);
  });
});
