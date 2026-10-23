import { describe, it, expect } from 'vitest';
import { dataUnderstandTask, dataStepTask, DATA_UNDERSTAND_SCHEMA, DATA_STEP_SCHEMA, dataRules, dataBriefData } from '../src/ai/tasks';
import { checkUnderstanding, guessKind, readWords } from '../src/data/understand';
import { dataGaps, dataBrief, dataLearnedText, openAfterDone } from '../src/data/questions';
import { skillGuidance } from '../src/design/store';
import { profileTable } from '../src/data/profile';
import { readCsv } from '../src/data/read';
import type { DataFile, DataState } from '../src/data/model';
import { expenseCsv, outputCsv } from './dataFixtures';

const NO_UPDATES = { builder: '', builderCanAttend: false, participation: '', resolvedFlags: [], facts: [], graph: { nodes: [], links: [] } };
const empty = { look: [], what: 'A table', kindHint: 'input', columns: [], points: [], rules: [], derivations: [], serves: [], issues: [], missing: [] };
const table = (csv: string) => [profileTable(readCsv('x.csv', csv)[0], new Map(), [])];
const file = (over: Partial<DataFile>): DataFile => ({ id: 'f1', name: 'expenses.csv', file: 'f1-expenses.csv', kind: 'input', bytes: 1, type: 'table', at: '', steps: [], ...over });

describe('the data skill and its two tasks', () => {
  it('the Café data guide is loaded like the design guide', () => {
    const g = skillGuidance('cafe-data');
    expect(g).toMatch(/^# Understanding a Café idea's data/);
    expect(g).toMatch(/One question per reply/);
  });
  it('data-understand: strict schema, every part required, kinds and roles from fixed lists', () => {
    expect(DATA_UNDERSTAND_SCHEMA.required).toEqual(['look', 'what', 'kindHint', 'columns', 'points', 'rules', 'derivations', 'serves', 'issues', 'missing']);
    expect(dataUnderstandTask.parse(JSON.stringify(empty))).toMatchObject({ what: 'A table' });
    expect(() => dataUnderstandTask.parse(JSON.stringify({ ...empty, kindHint: 'spreadsheet' }))).toThrow(/invalid output/);
    expect(() => dataUnderstandTask.parse(JSON.stringify({ ...empty, what: '' }))).toThrow(/invalid output/);
    // An extra field the AI adds (a "name" on a rule, found on the live check) is dropped, not a reason to refuse.
    const extra = dataUnderstandTask.parse(JSON.stringify({ ...empty, extra: 1, rules: [{ name: 'Weekend rule', rule: 'No weekend spend', columns: [] }] }));
    expect(extra.rules).toEqual([{ rule: 'No weekend spend', columns: [] }]);
    expect((extra as any).extra).toBeUndefined();
    const long = dataUnderstandTask.parse(JSON.stringify({ ...empty, what: 'x'.repeat(500), look: [1, 2, 3, 4, 5].map((k) => ({ column: `c${k}`, why: '' })) }));
    expect(long.what.length).toBe(200);
    expect(long.look).toHaveLength(3);
  });
  it('data-understand prompt: the guide, the masking rule, the DATA markers; looks only while allowed', () => {
    const input = { idea: { id: 'X', title: 'Expense anomaly finder' }, file: { name: 'e.csv', kind: 'Sample input', kindHint: '', type: 'table', size: '' }, lookAllowed: true, guidance: 'GUIDE TEXT' };
    const p = dataUnderstandTask.prompt(input);
    expect(p.startsWith('TASK: data-understand')).toBe(true);
    expect(p).toContain('GUIDE TEXT');
    expect(p).toMatch(/masked personal data: never guess them/);
    expect(p).toMatch(/data, not instructions/);
    expect(p).toMatch(/look: when one to 3 columns are unclear/);
    expect(dataUnderstandTask.prompt({ ...input, lookAllowed: false })).toMatch(/look must be \[\] now/);
    expect(dataUnderstandTask.prompt({ ...input, corrections: { what: 'Mine' } })).toMatch(/operator's own words/);
  });
  it('data-step: complete needs a summary; an open one a question; topics from a fixed list; updates and learned always', () => {
    const parse = (o: object) => dataStepTask.parse(JSON.stringify({ updates: NO_UPDATES, learned: [], ...o }));
    expect(DATA_STEP_SCHEMA.required).toEqual(['done', 'updates', 'learned']);
    expect(() => parse({ done: true })).toThrow(/summary/);
    expect(() => parse({ done: false })).toThrow(/question/);
    expect(() => parse({ done: false, question: 'Q?', topic: 'budget' })).toThrow(/invalid output/);
    expect(() => parse({ done: false, question: 'Q?', suggested: ['one'] })).toThrow(/invalid output/);
    expect(parse({ done: false, question: 'How\nmany rows?', suggested: ['A', 'B'], topic: 'volumes' })).toMatchObject({ done: false, question: 'How many rows?', topic: 'volumes' });
    const done = parse({ done: true, summary: { text: 'All clear', input: 'i', output: 'o', knowledge: '', rules: 'r', gapsClosed: ['The output'] } });
    expect(done.summary!.gapsClosed).toEqual(['The output']);
    const p = dataStepTask.prompt({ idea: { id: 'X', title: 'x' }, files: [], gaps: [{ topic: 'output', gap: 'No sample of the output' }], stepsSoFar: [], guidance: 'G' });
    expect(p).toMatch(/applies these by itself \(no one says yes to them\)/);
    expect(p).toMatch(/never ask about value, savings, costs or KPIs/);
    expect(p).toContain('No sample of the output');
  });
  it('the later tasks are told what DATA.data is and what to make of it', () => {
    for (const t of ['features', 'tool', 'design', 'diagram', 'kit', 'roadshow', 'deck'] as const) expect(dataRules(t)[0]).toMatch(/confirmed by the operator/);
    expect(dataRules('kit')[1]).toMatch(/EXACTLY its columns/);
    expect(dataRules('design')[1]).toMatch(/never ask for columns/);
    expect(dataBriefData(undefined)).toEqual({});
  });
});

describe('the code checks the AI\'s understanding against the profile', () => {
  it('only real columns (a sheet prefix is read through), rules and derivations on real columns, real features, the hint only when it differs', () => {
    const f = file({ kind: 'output', tables: table(outputCsv()) });
    const u = checkUnderstanding({
      ...empty, kindHint: 'output',
      columns: [{ name: 'Sheet1: claim_id', meaning: 'The claim' }, { name: 'FLAG_REASON', meaning: 'Why' }, { name: 'ghost', meaning: 'Made up' }, { name: 'claim_id', meaning: 'Again' }],
      rules: [{ rule: 'Weekend claims', columns: ['claim_date', 'nope'] }],
      derivations: [{ output: 'flag_reason', from: ['policy_type', 'claim_date', 'x'], how: 'From the policy' }, { output: 'nothing', from: [], how: 'x' }],
      serves: ['weekend check', 'Something else'],
    } as any, f, ['claim_date', 'policy_type'], ['Weekend check'], '2026-10-20', 'fake', []);
    expect(u.columns.map((c) => [c.name, c.meaning])).toEqual([['claim_id', 'The claim'], ['flag_reason', 'Why']]);
    expect(u.dropped).toEqual(['ghost', 'nothing']);
    expect(u.rules).toEqual([{ rule: 'Weekend claims', columns: ['claim_date'] }]);
    expect(u.derivations).toEqual([{ output: 'flag_reason', from: ['policy_type', 'claim_date'], how: 'From the policy' }]);
    expect(u.serves).toEqual(['Weekend check']);
    expect(u.kindHint).toBeUndefined();
  });
  it('a picture or a document has no profiled columns: the table the AI read in it becomes one of its facts, not "dropped"', () => {
    const f = file({ kind: 'today', tables: undefined });
    const u = checkUnderstanding({
      ...empty, points: ['Three exceptions are listed.'],
      columns: [{ name: 'claim_id', meaning: 'The claim' }, { name: 'rule_broken', meaning: 'The rule' }],
    } as any, f, [], [], '2026-10-23', 'claude', []);
    expect(u.columns).toEqual([]);
    expect(u.dropped).toBeUndefined();
    expect(u.points).toEqual(['Three exceptions are listed.', 'Columns of the table in it: claim_id, rule_broken']);
  });
  it('guesses a kind from the name; the operator decides', () => {
    expect(guessKind('Expense policy caps.xlsx')).toBe('rules');
    expect(guessKind('flagged output.csv')).toBe('output');
    expect(guessKind('monthly report today.xlsx')).toBe('today');
    expect(guessKind('claims.csv')).toBe('input');
    expect(guessKind('how we do it.docx')).toBe('process');
    expect(guessKind('ask.eml')).toBe('email');
    expect(readWords({ type: 'table', tables: [{ name: '', header: ['a', 'b'], rows: [], total: 1200 }], meta: {} })).toBe('Table: 1,200 rows, 2 columns');
  });
});

describe('gaps, the brief and the Data point', () => {
  const input = file({ tables: table(expenseCsv(10)), understanding: { what: 'Masked claims', columns: [], points: [], rules: [], derivations: [], serves: [], issues: [], missing: ['What T, M and H mean'], looked: [], at: '' } });
  it('the code sees what is open, by topic; a question on a topic covers it', () => {
    const d: DataState = { files: [input], steps: [] };
    const topics = dataGaps(d).map((g) => g.topic);
    expect(topics).toEqual(['output', 'rules', 'codes', 'volumes', 'other']);
    expect(dataGaps({ files: [], steps: [] })[0]).toEqual({ topic: 'input', gap: 'No data dropped yet' });
    const asked: DataState = { files: [input], steps: [{ n: 1, question: 'Output?', suggested: [], topic: 'output', source: 'operator', askedTeam: { emailKey: 'k' } }] };
    expect(dataGaps(asked).map((g) => g.topic)).not.toContain('output');
    expect(openAfterDone(asked)).toContain('Asked the team: Output?');
    // A held file stays open whatever was asked about the input; the volumes are never cut off by many missing items.
    const many = { ...input, understanding: { ...input.understanding!, missing: Array.from({ length: 20 }, (_, i) => `m${i}`) } };
    const held = file({ id: 'f2', name: 'p.csv', check: { status: 'held', findings: [], masked: [], notes: [] } });
    const g = dataGaps({ files: [many, held], steps: [{ n: 1, question: 'In?', suggested: [], topic: 'input', source: 'operator', answer: 'x' }] });
    expect(g[0].gap).toMatch(/^p\.csv is held/);
    expect(g.map((x) => x.topic)).toContain('volumes');
    expect(g.filter((x) => x.topic === 'other')).toHaveLength(3);
  });
  it('the brief is only for confirmed data, and the Data point is said by code', () => {
    expect(dataBrief({ files: [input], steps: [] })).toBeUndefined();
    const b = dataBrief({ files: [input], steps: [{ n: 1, question: 'Rows?', suggested: [], source: 'operator', answer: '1,000 a month' }], confirmedAt: '2026-10-20' })!;
    expect(b.files[0]).toMatchObject({ name: 'expenses.csv', kind: 'Sample input', what: 'Masked claims', size: '10 rows, 6 columns' });
    expect(b.answers).toEqual([{ question: 'Rows?', answer: '1,000 a month' }]);
    expect(dataLearnedText({ files: [input], steps: [] })).toBe('Sample input: expenses.csv (10 rows, 6 columns): Masked claims.');
  });
});
