import { describe, it, expect } from 'vitest';
import { tmpWorkspace, sampleIdea } from './helpers';
import { saveIdea } from '../src/ideas/store';
import { saveDrop, getItem, updateItem } from '../src/inbox/store';
import { triageItem, type TriageRecord } from '../src/inbox/triage';
import { growIdea } from '../src/ai/grow';
import { readAiLinks } from '../src/graph/store';
import { createConnector, type Provider } from '../src/ai/connector';
import { DEFAULT_SETTINGS } from '../src/round/round';
import type { ExtractOutput, Understanding } from '../src/ai/tasks';

/**
 * "Names are coded before anything reaches the AI": the Import (understand) and /grow (extract) prompts carry no
 * name, known or not, and no email address; the codes in the reply come back as the real names.
 * Person 7 is on the idea (known); Person 8 is only ever a sender (unknown to the universe); Person 9 only an address.
 */
function recorder(reply: (prompt: string) => unknown) {
  const calls: string[] = [];
  const provider: Provider = {
    id: 'claude', label: 'Recording fake', available: async () => true,
    complete: async (prompt) => { calls.push(prompt); return JSON.stringify(reply(prompt)); },
  };
  return { calls, connector: createConnector({ providers: [provider], settings: DEFAULT_SETTINGS }) };
}

const LEAKS = /Person [789]|person\.[789]|@example\.com/;
/** The code just before `words` in the prompt's DATA (the instructions' own "[P1]" examples left out). */
const codeBefore = (prompt: string, words: string) => new RegExp(`(\\[P\\d+\\]) ${words}`).exec(prompt.slice(prompt.indexOf('<<<DATA')))?.[1] ?? 'none';

const IDEA = sampleIdea({
  people: { submitter: 'Person 7', team: [{ name: 'Person 7', roles: ['lead'] }] },
  challenge: 'Person 7 and Person 8 type the actions up by hand; questions go to person.9@example.com.',
});

const EML = [
  'From: Person 8 <person.8@example.com>',
  "To: Creators' Cafe <cafe@example.com>",
  'Cc: Person 7 <person.7@example.com>',
  'Subject: RE: CAFE-2026-001 Email scheduler',
  'Content-Type: text/plain; charset="utf-8"',
  '',
  'Hi team,',
  'Person 7 and Person 8 type the actions up by hand. Person 8 will build it.',
  'For the sample, write to person.9@example.com (Person 9 keeps the list).',
  '',
  'Thanks,',
  'Person 8',
].join('\r\n');

describe('the Import codes names before the AI reads a file', () => {
  it('no name and no address in the understand prompt; the stored triage has the real names', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, IDEA);
    const { calls, connector } = recorder((prompt): Understanding => {
      const builder = codeBefore(prompt, 'will build it');
      return {
        what: 'A reply about the email scheduler.', understood: [`${codeBefore(prompt, 'and')} and ${builder} type the actions up by hand`], uncertain: [],
        kind: 'reply', ideaId: 'CAFE-2026-001', matchConfidence: 0.9,
        facts: { builderNamed: builder, graph: { nodes: [], links: [] } },
      };
    });
    const item = await saveDrop(root, 'reply.eml', EML);
    await triageItem(root, item.id, connector);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/\[P\d+\] will build it/);
    expect(calls[0]).toMatch(/<email>/);
    expect(calls[0]).not.toMatch(LEAKS);
    const ai = ((await getItem(root, item.id))!.triage as TriageRecord).ai!;
    expect(ai.facts.builderNamed).toBe('Person 8');
    expect(ai.understood).toEqual(['Person 7 and Person 8 type the actions up by hand']);
  });
});

describe('/grow codes names before the AI reads the idea', () => {
  it('no name and no address in the extract prompt; the links saved have the real names', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, IDEA);
    // Person 8 is known to the app only as the sender of an earlier import.
    const drop = await saveDrop(root, 'earlier.eml', 'x');
    await updateItem(root, drop.id, { meta: { from: 'Person 8 <person.8@example.com>' } });
    const { calls, connector } = recorder((prompt): ExtractOutput => ({
      nodes: [{ type: 'PainPoint', label: 'Actions typed by hand' }],
      links: [{ from: 'idea', to: 'Actions typed by hand', rel: 'REPLACES', description: `${codeBefore(prompt, 'type the actions')} types them up`, confidence: 0.9 }],
    }));
    await growIdea(root, connector, 'CAFE-2026-001');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/\[P\d+\] and \[P\d+\] type the actions up by hand; questions go to <email>\./);
    expect(calls[0]).not.toMatch(LEAKS);
    const links = (await readAiLinks(root)).links;
    expect(links.map((l) => l.description)).toContain('Person 8 types them up');
  });
});

describe('the shared coder (review, data, design, kit and roadshow calls) masks addresses and import-only names too', () => {
  it('reviewInput: no address, no name an import gave, no name an address gives', async () => {
    const { reviewInput, codeValue } = await import('../src/review/suggestInput');
    const root = await tmpWorkspace();
    await saveIdea(root, IDEA);
    const drop = await saveDrop(root, 'earlier.eml', 'x');
    await updateItem(root, drop.id, { meta: { from: 'Person 8 <person.8@example.com>' } });
    const { input, codes } = await reviewInput(root, 'CAFE-2026-001', [{ question: 'Who keeps the list?', answer: 'Person 9, at person.9@example.com.' }]);
    expect(JSON.stringify(input)).not.toMatch(LEAKS);
    expect(input.idea.challenge).toMatch(/^\[P\d+\] and \[P\d+\] type the actions up by hand; questions go to <email>\.$/);
    expect(JSON.stringify(await codeValue(root, 'CAFE-2026-001', { note: 'Ask Person 8 (person.8@example.com)' }, codes))).not.toMatch(LEAKS);
  });

  it('a first.last address gives its name; a mailbox gives none', async () => {
    const { namesInAddresses } = await import('../src/inbox/names');
    expect(namesInAddresses('write to person.9@example.com or help@example.com or x@example.com')).toEqual(['Person 9']);
  });
});

describe('the assistant masks addresses too', () => {
  it('an address typed in a command, or in an idea it reads, never reaches the AI', async () => {
    const { runCommand } = await import('../src/command/chat');
    const { fixedClock } = await import('../src/clock');
    const root = await tmpWorkspace();
    await saveIdea(root, IDEA);
    const { calls, connector } = recorder(() => ({ next: 'propose', thought: 'Noted', reply: 'Noted.', actions: [] }));
    await runCommand(root, 'what does Person 7 want? write to person.7@example.com', connector, fixedClock('2026-10-22'));
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c).not.toMatch(/@example\.com|Person 7/);
  });
});
