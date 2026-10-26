import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpWorkspace, sampleIdea } from './helpers';
import { saveIdea } from '../src/ideas/store';
import { chunkIdea, chunkWorkspace, splitText, CHUNK_MAX, CHUNK_OVERLAP, hashOf } from '../src/memory/chunks';

/** One idea with every kind of file Deep read looks at. */
export async function fullIdea(root: string) {
  const idea = sampleIdea({
    title: 'Vendor contract summariser',
    challenge: 'Contracts run to 80 pages and the notice date is missed.',
    current_process: 'A paralegal reads each contract end to end.',
    business_impact: 'Six renewals rolled over last year.',
    additional_context: 'Scanned PDFs and Word files.',
    outcomes: ['Reduce Manual Effort', 'Save Time'],
    review: { criteria: {}, decision: 'select', reason: 'Clear data access and a named builder.', at: '2026-10-19' },
    prep: { at: '2026-10-19', decision: 'select', reason: 'r', criteria: {}, needs: [{ id: 'n1', need: 'Sample contracts', ask: 'Can you share two?', met: true, answer: 'Yes, two redacted ones.' }], basis: '' },
    ...({ answers: [{ question: 'How many a month?', answer: 'About 40 contracts a month.' }] } as object),
  });
  const dir = await saveIdea(root, idea);
  await mkdir(path.join(dir, 'emails', 'in'), { recursive: true });
  await mkdir(path.join(dir, 'notes'), { recursive: true });
  await mkdir(path.join(dir, 'roadshow'), { recursive: true });
  await writeFile(path.join(dir, 'emails', '001-E2.md'), '---\ntemplate: E2\nstatus: sent\n---\nHello team, who will build this?\n');
  await writeFile(path.join(dir, 'emails', 'in', '2026-10-20-reply.eml'), 'raw');
  await writeFile(path.join(dir, 'emails', 'in', '2026-10-20-reply.summary.md'), 'Reply from the team: data access is through the contract register export.\n');
  await writeFile(path.join(dir, 'notes', '2026-10-21-minutes.summary.md'), 'Minutes: the sponsor wants a weekly digest.\n');
  await writeFile(path.join(dir, 'design.yaml'), 'version: 1\nstatus: designing\nfeatures:\n  - id: f1\n    name: Renewal date extraction\n    what: Finds the renewal date in a contract\n    flags: []\ntool:\n  tool: Copilot Studio\n  why: Fits a Q&A over documents\n  pros: [Quick to build]\n  cons: [No OCR]\nsteps:\n  - n: 1\n    question: Where do contracts arrive?\n    suggested: []\n    source: operator\n    answer: In a shared mailbox, as PDF.\nsummary: A reader over the contract register.\n');
  await writeFile(path.join(dir, 'approach.md'), '# Approach\nCopilot Studio for the Q&A.\n');
  await writeFile(path.join(dir, 'roadshow', 'script.md'), '# Script\nGood morning. Today we show the contract summariser.\n');
  await writeFile(path.join(dir, 'csic-handoff.md'), '# CSIC handoff\nNeeds the live contract system.\n');
  await writeFile(path.join(dir, 'history.log'), '{"at":"2026-10-19","action":"review","by":"operator","detail":"select: Clear data access"}\n{"at":"2026-10-19","action":"tick","by":"operator","step":"s2a"}\n');
  return { idea, dir };
}

describe('splitText', () => {
  it('keeps short text whole and cuts long text at sentence ends with an overlap', () => {
    expect(splitText('  short \r\n text ')).toEqual(['short\ntext']);
    expect(splitText('')).toEqual([]);
    const long = Array.from({ length: 60 }, (_, i) => `Sentence ${i + 1}: the paralegal reads contract ${i + 1} and notes its renewal date. `).join('');
    const parts = splitText(long);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(CHUNK_MAX);
    // Each piece ends on a sentence, and the next starts inside the overlap of the one before.
    expect(parts[0].endsWith('.')).toBe(true);
    expect(long.indexOf(parts[1].slice(0, 40))).toBeLessThan(parts[0].length);
    expect(long.indexOf(parts[1].slice(0, 40))).toBeGreaterThanOrEqual(parts[0].length - CHUNK_OVERLAP - 1);
  });
  it('a hash changes with the text or the section', () => {
    expect(hashOf('a', 'x')).toBe(hashOf('a', 'x'));
    expect(hashOf('a', 'x')).not.toBe(hashOf('a', 'y'));
    expect(hashOf('a', 'x')).not.toBe(hashOf('b', 'x'));
  });
});

describe('chunkIdea', () => {
  it('one passage per field or section, each with its kind, file and section', async () => {
    const root = await tmpWorkspace();
    const { idea, dir } = await fullIdea(root);
    const chunks = await chunkIdea(root, idea, dir);
    const sections = chunks.map((c) => `${c.kind}|${c.file}|${c.section}`);
    expect(sections).toEqual([
      'submission|idea.yaml|title+challenge', 'submission|idea.yaml|current_process', 'submission|idea.yaml|business_impact',
      'submission|idea.yaml|additional_context', 'submission|idea.yaml|outcomes', 'submission|idea.yaml|answers',
      'review|idea.yaml|review',
      'email|emails/001-E2.md|email E2', 'email|emails/in/2026-10-20-reply.summary.md|email in',
      'other|notes/2026-10-21-minutes.summary.md|note',
      'design|design.yaml|design features', 'design|design.yaml|design Q&A', 'design|design.yaml|design summary', 'design|approach.md|approach',
      'roadshow|roadshow/script.md|roadshow script', 'other|csic-handoff.md|handoff', 'other|history.log|history',
    ]);
    expect(chunks[0].text).toBe('Vendor contract summariser\nContracts run to 80 pages and the notice date is missed.');
    expect(chunks[0].id).toBe('CAFE-2026-001:idea.yaml:title+challenge:0');
    // The email's front matter is not a passage; the review names the decision; the answers are Q/A pairs.
    expect(chunks.find((c) => c.section === 'email E2')!.text).toBe('Hello team, who will build this?');
    expect(chunks.find((c) => c.section === 'review')!.text).toContain('Decision: Select for the design series');
    expect(chunks.find((c) => c.section === 'review')!.text).toContain('Need: Sample contracts — Yes, two redacted ones.');
    expect(chunks.find((c) => c.section === 'answers')!.text).toBe('Q: How many a month?\nA: About 40 contracts a month.');
    expect(chunks.find((c) => c.section === 'design features')!.text).toContain('Renewal date extraction: Finds the renewal date');
    expect(chunks.find((c) => c.section === 'design features')!.text).toContain('- No OCR');
    expect(chunks.find((c) => c.section === 'history')!.text).toBe('select: Clear data access');
    expect(chunks.every((c) => c.ideaId === 'CAFE-2026-001' && c.hash.length === 40)).toBe(true);
  });

  it('a bare idea gives only the title passage; the workspace lists every idea in order', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-002', title: 'Desk booking', outcomes: [] }));
    await fullIdea(root);
    const { chunks, ideas } = await chunkWorkspace(root);
    expect(ideas.map((i) => i.id)).toEqual(['CAFE-2026-001', 'CAFE-2026-002']);
    expect(chunks.filter((c) => c.ideaId === 'CAFE-2026-002').map((c) => c.section)).toEqual(['title+challenge']);
    expect(chunks.filter((c) => c.ideaId === 'CAFE-2026-001')).toHaveLength(17);
  });
});
