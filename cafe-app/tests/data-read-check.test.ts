import { describe, it, expect } from 'vitest';
import { checkDataFile, readDataFile, readCsv, delimiterOf, cleanHeader, DataError } from '../src/data/read';
import { checkColumn, checkRead, maskText, maskNames, luhn } from '../src/data/check';
import { profileTable, profileDoc, lookAt, shapeOf } from '../src/data/profile';
import { dataPoints, dataOf, meaningOf, sizeWords, type DataFile } from '../src/data/model';
import { textPdf } from './helpers';
import { expenseCsv, personalCsv, rulesXlsx, outputCsv, processDocx, exampleEml } from './dataFixtures';

const enc = (s: string) => new TextEncoder().encode(s);
const known = new Set<string>();

describe('Read: the file is checked before it is read, then read by type', () => {
  it('refuses a wrong extension, an old .xls, an empty file, an oversize one and a file whose bytes do not match its name', () => {
    expect(() => checkDataFile('x.exe', enc('hi'))).toThrow(DataError);
    expect(() => checkDataFile('x.xls', enc('hi'))).toThrow(/save it as \.xlsx/);
    expect(() => checkDataFile('x.csv', new Uint8Array())).toThrow(/empty/);
    expect(() => checkDataFile('x.csv', new Uint8Array(11 * 1024 * 1024))).toThrow(/over 10 MB/);
    expect(() => checkDataFile('x.xlsx', enc('a,b\n1,2'))).toThrow(/not a real \.xlsx/);
    expect(() => checkDataFile('x.pdf', enc('hello'))).toThrow(/not a real \.pdf/);
    expect(() => checkDataFile('x.csv', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0]))).toThrow(/not a real \.csv/);
    expect(checkDataFile('x.CSV', enc('a,b'))).toBe('csv');
  });
  it('reads a CSV with any delimiter, header names made unique and never empty', async () => {
    expect(delimiterOf('a;b;c\n1;2;3', 'csv')).toBe(';');
    const [t] = readCsv('x.csv', expenseCsv(10, ';'));
    expect(t.header).toEqual(['claim_id', 'claim_date', 'employee_ref', 'policy_type', 'amount', 'receipt']);
    expect(t.rows).toHaveLength(10);
    expect(cleanHeader(['a', '', 'A', ' b '])).toEqual(['a', 'column_2', 'A_2', 'b']);
    const r = await readDataFile('/nowhere/x.csv', 'x.csv', enc(expenseCsv(5)));
    expect(r.type).toBe('table');
    expect(r.tables![0].total).toBe(5);
  });
  it('reads every sheet of a workbook, dates as YYYY-MM-DD', async () => {
    const r = await readDataFile('/nowhere/rules.xlsx', 'rules.xlsx', await rulesXlsx());
    expect(r.tables!.map((t) => t.name)).toEqual(['caps', 'days']);
    expect(r.tables![0].rows[0]).toEqual(['T', '150', '25']);
    expect(r.tables![1].rows[0][2]).toBe('2026-01-01');
  });
  it('reads Word, email, PDF and text with the Import readers', async () => {
    const d = await readDataFile('/nowhere/p.docx', 'p.docx', processDocx());
    expect(d.type).toBe('document');
    expect(d.text).toContain('Step 2: compare each claim');
    const e = await readDataFile('/nowhere/e.eml', 'e.eml', enc(exampleEml()));
    expect(e.type).toBe('email');
    expect(e.meta.subject).toBe('Weekly expense check');
    expect(e.text).toContain('send the flagged ones');
    const p = await readDataFile('/nowhere/p.pdf', 'p.pdf', textPdf(['Expense policy', 'Travel is capped at 150 a claim.', 'Meals are capped at 40.', 'Receipts over 25 are needed.']));
    expect(p.meta.pages).toBe(1);
    expect(p.text).toContain('capped at 150');
    const t = await readDataFile('/nowhere/n.txt', 'n.txt', enc('Just a note about the rules.'));
    expect(t.text).toBe('Just a note about the rules.');
  });
  it('a picture with no AI is unreadable (it says why), a CSV with no header row too', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
    const r = await readDataFile('/nowhere/x.png', 'x.png', png, null);
    expect(r.unreadable).toMatch(/Claude Code/);
    expect((await readDataFile('/nowhere/x.csv', 'x.csv', enc('justone\n1\n2'))).unreadable).toMatch(/header row/);
  });
});

describe('Check: the Café data rule in code', () => {
  it('flags email, phone, card, bank, sensitive and name columns, and leaves made-up ones alone', () => {
    expect(checkColumn('staff_email', ['a.b@corp.co.uk', 'c.d@corp.co.uk', 'e@corp.co.uk'], known).hit?.kind).toBe('email');
    expect(checkColumn('contact', ['x@example.com', 'y@example.com', 'z@example.com'], known).hit).toBeUndefined();
    expect(checkColumn('mobile', ['07700 900101'], known).hit?.kind).toBe('phone');
    expect(checkColumn('card', ['4111 1111 1111 1111'], known).hit?.kind).toBe('card');
    expect(checkColumn('payee_iban', ['GB82WEST12345698765432'], known).hit?.kind).toBe('bank');
    expect(checkColumn('date_of_birth', ['1990-01-01'], known).hit?.kind).toBe('sensitive');
    expect(checkColumn('approver', ['Jane Doe', 'Sam Lee', 'Alex Kim', 'Max Fry'], known).hit?.kind).toBe('name');
    expect(checkColumn('approver', ['Person 1', 'Person 2', 'Person 3'], known).hit).toBeUndefined();
    expect(checkColumn('employee_id', ['E10023', 'E10024', 'E10025', 'E10026'], known).hit?.kind).toBe('id');
    expect(checkColumn('employee_ref', ['EMP-****1', 'EMP-****2', 'EMP-****3'], known)).toEqual({ note: 'employee_ref looks masked or made up' });
    // A cost account code: a short list of codes, not one per person.
    expect(checkColumn('account_code', Array.from({ length: 40 }, (_, i) => `GL${4000 + (i % 5)}`), known).hit).toBeUndefined();
    expect(checkColumn('policy_type', ['Hotel Stay', 'Train Fare', 'Team Lunch'], known).hit).toBeUndefined();
    expect(checkColumn('requester', ['Ava Ng'], new Set(['ava ng'])).hit?.kind).toBe('name');
    expect(luhn('4111111111111111')).toBe(true);
    expect(luhn('4111111111111112')).toBe(false);
  });
  it('holds a table with personal data and masks only the flagged columns; a clean one is clear', () => {
    const held = checkRead({ type: 'table', tables: readCsv('p.csv', personalCsv()), meta: {} }, 'p.csv', []);
    expect(held.status).toBe('held');
    expect(held.masked).toEqual(['staff_email', 'mobile']);
    const clear = checkRead({ type: 'table', tables: readCsv('e.csv', expenseCsv(20)), meta: {} }, 'e.csv', []);
    expect(clear).toMatchObject({ status: 'clear', findings: [], notes: ['employee_ref looks masked or made up'] });
  });
  it('a document is screened like the Import, plus card and bank numbers', () => {
    const r = checkRead({ type: 'document', text: 'Pay the refund to card 4111 1111 1111 1111 please.', meta: {} }, 'n.txt', []);
    expect(r.status).toBe('held');
    expect(r.findings[0].kind).toBe('card');
    expect(checkRead({ type: 'email', text: 'Please check the claims.', meta: { from: 'finance@example.com' } }, 'e.eml', []).status).toBe('clear');
  });
  it('masks emails, phones, cards and bank numbers, never dates, times or amounts; known names become <name>', () => {
    expect(maskText('Mail a.b@corp.com or call 07700 900123 on 2026-10-05 at 09:30 for 1,250.00 to card 4111111111111111 or GB82WEST12345698765432'))
      .toBe('Mail <email> or call <phone> on 2026-10-05 at 09:30 for 1,250.00 to card <card> or <bank>');
    expect(maskNames('Ava Ng signed it; ava ng again.', ['Ava Ng'])).toBe('<name> signed it; <name> again.');
  });
});

describe('Profile: by code, masked', () => {
  it('types, ranges, the commonest values, shapes and issues', () => {
    const [t] = readCsv('e.csv', `${expenseCsv(30)}CLM-0001,2026-10-05,EMP-****1,T,abc,yes\n`);
    const p = profileTable(t, new Map(), []);
    const col = (n: string) => p.columns.find((c) => c.name === n)!;
    expect(col('claim_id')).toMatchObject({ type: 'id', pattern: 'AAA-9999' });
    expect(col('claim_date')).toMatchObject({ type: 'date', min: '2026-10-05', max: '2026-10-11' });
    expect(col('policy_type').type).toBe('category');
    expect(col('policy_type').top!.map((x) => x.value).sort()).toEqual(['H', 'M', 'T']);
    expect(col('amount').type).toBe('money');
    expect(col('receipt').type).toBe('yes-no');
    expect(p.issues).toEqual(expect.arrayContaining(['amount: 1 value is not a number', 'claim_id: 1 repeated value']));
    expect(p.examples).toHaveLength(3);
    expect(shapeOf('CLM-0042')).toBe('AAA-9999');
  });
  it('a flagged column shows no values anywhere: typed masked, examples <email>', () => {
    const [t] = readCsv('p.csv', personalCsv());
    const p = profileTable(t, new Map([['staff_email', 'email' as const]]), []);
    expect(p.columns[1]).toMatchObject({ name: 'staff_email', type: 'masked', masked: 'email' });
    expect(p.columns[1].top).toBeUndefined();
    expect(p.examples[0][1]).toBe('<email>');
    // The phone column was not flagged here, but the example still masks the value itself.
    expect(p.examples[0][2]).toBe('<phone>');
    expect(lookAt(t, 'staff_email', 'email', [])!.values).toEqual([]);
    expect(lookAt(t, 'AMOUNT', undefined, [])!.values.length).toBe(6);
  });
  it('a document: words, headings, tables', () => {
    const d = profileDoc({ type: 'document', text: '# Expense policy\nTravel\tCap\tReceipt\nT\t150\t25\nM\t40\t15\nH\t220\t0\nSome words here.', meta: { pages: 2 } });
    expect(d).toMatchObject({ pages: 2, tables: 1 });
    expect(d.headings).toContain('Expense policy');
  });
});

describe('The data section as stored', () => {
  const file = (over: Partial<DataFile>): DataFile => ({ id: 'f1', name: 'x.csv', file: 'f1-x.csv', kind: 'input', bytes: 1, type: 'table', at: '2026-10-20', steps: [], ...over });
  it('is made safe from an older or hand-edited design.yaml', () => {
    expect(dataOf(undefined)).toBeUndefined();
    expect(dataOf({ files: [{ id: 'f1', file: 'f1-x.csv', kind: 'nonsense' }] })!.files[0]).toMatchObject({ kind: 'other', steps: [], name: 'f1-x.csv' });
  });
  it('the operator\'s corrections win; the points come from the confirmed files only', () => {
    const [t] = readCsv('e.csv', expenseCsv(10));
    const tables = [profileTable(t, new Map(), [])];
    const input = file({ tables, understanding: { what: 'AI words', columns: [{ name: 'amount', meaning: 'AI meaning' }], points: [], rules: [{ rule: 'amount under the cap per policy_type', columns: ['amount'] }], derivations: [], serves: [], issues: [], missing: [], looked: [], at: '' }, edits: { columns: { amount: 'Claimed amount in GBP' }, at: '' }, check: { status: 'clear', findings: [], masked: ['employee_ref'], notes: [] } });
    expect(meaningOf(input, 'amount')).toBe('Claimed amount in GBP');
    expect(sizeWords(input)).toBe('10 rows, 6 columns');
    const out = file({ id: 'f2', name: 'flagged.csv', kind: 'output', tables: [profileTable(readCsv('o.csv', outputCsv())[0], new Map(), [])] });
    const held = file({ id: 'f3', name: 'p.csv', check: { status: 'held', findings: [], masked: [], notes: [] }, tables });
    const pts = dataPoints({ files: [input, out, held], steps: [] });
    expect(pts['input-shape']).toBe('x.csv (10 rows, 6 columns): claim_id, claim_date, employee_ref, policy_type, amount, receipt; masked: employee_ref');
    expect(pts.output).toBe('Like flagged.csv: claim_id, flag_reason, amount_over');
    expect(pts.logic).toBe('amount under the cap per policy_type');
  });
});
