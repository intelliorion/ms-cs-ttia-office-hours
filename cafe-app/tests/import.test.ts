import { describe, it, expect } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { tmpWorkspace, FIXTURE } from './helpers';
import { importExport } from '../src/import/importRows';
import { parseTeam, splitMulti, parseSubmitter } from '../src/import/columns';
import { listIdeas, loadIdea } from '../src/ideas/store';
import { DEFAULT_STEPS as steps } from '../src/rules/stages';
import { fixedClock } from '../src/clock';

const opts = { clock: fixedClock('2026-10-19'), steps };

describe('parsing', () => {
  it('splits SharePoint multi-select values', () => {
    expect(splitMulti(';#Save time;#Improve quality;#')).toEqual(['Save time', 'Improve quality']);
    expect(splitMulti('')).toEqual([]);
  });

  it('reads the submitter and their organisation', () => {
    expect(parseSubmitter('Person 1 (CS)')).toEqual({ name: 'Person 1', entity: 'CS' });
  });

  it('reads team roles from the form wording', () => {
    expect(parseTeam('Person 2 (Lead); Person 3 (Sponsor); Person 4')).toEqual([
      { name: 'Person 2', roles: ['lead'], note: 'Lead' },
      { name: 'Person 3', roles: ['sponsor'], note: 'Sponsor' },
      { name: 'Person 4', roles: ['member'] },
    ]);
    expect(parseTeam('Person 6 - Team lead\nAnne-Marie Person')).toEqual([
      { name: 'Person 6', roles: ['lead'], note: 'Team lead' },
      { name: 'Anne-Marie Person', roles: ['member'] },
    ]);
  });
});

describe('importExport', () => {
  it('imports the three real submissions and reports the rest', async () => {
    const root = await tmpWorkspace();
    const r = await importExport(root, FIXTURE, opts);
    expect(r.created.map((c) => c.id)).toEqual(['CAFE-2026-001', 'CAFE-2026-002', 'CAFE-2026-003']);
    expect(r.errors).toEqual([{ row: 5, message: 'Title is empty' }]);
    // ID is SharePoint's own column: skipped without a mention.
    expect(r.ignoredColumns).toEqual([]);
    expect(r.flags.filter((f) => f.id === 'CAFE-2026-003').map((f) => f.message)).toEqual([
      'Cut off in the export, check the full text: Desired Outcomes "Save time; Imp…"',
      'Participation is Individual but 6 people are listed',
    ]);
    expect(r.flags.filter((f) => f.id === 'CAFE-2026-002').map((f) => f.message)).toContain(
      'Cut off in the export, check the full text: Support Requested "Agent Design Guidance; Collab…"',
    );

    const rfx = await loadIdea(root, 'CAFE-2026-002');
    expect(rfx).toMatchObject({ function: 'GSS', region: 'APAC', entity: 'CS', round: '', stage: 2 });
    expect(rfx.people.submitter).toBe('Person 2');
    expect(rfx.people.team.map((p) => p.roles)).toEqual([['lead'], ['sponsor'], ['member']]);
    expect(rfx.support).toEqual(['Agent Design Guidance', 'Collab…']);
    expect(rfx.experimented).toBe('No');
    expect(rfx.checklist.s1d).toEqual({ done: true, by: 'app', at: '2026-10-19', source: 'sample-export.csv row 3' });
  });

  it('never imports the same row twice', async () => {
    const root = await tmpWorkspace();
    await importExport(root, FIXTURE, opts);
    const again = await importExport(root, FIXTURE, opts);
    expect(again.created).toEqual([]);
    expect(again.duplicates.map((d) => d.id)).toEqual(['CAFE-2026-001', 'CAFE-2026-002', 'CAFE-2026-003']);
    expect((await listIdeas(root)).ideas).toHaveLength(3);
  });

  it('maps columns by name, in any order', async () => {
    const root = await tmpWorkspace();
    const rows = parse(await readFile(FIXTURE), { bom: true }) as string[][];
    const reversed = rows.map((r) => [...r].reverse());
    const file = path.join(root, 'data', 'inbox', 'reordered.csv');
    await writeFile(file, reversed.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n'));
    const r = await importExport(root, file, opts);
    expect(r.created.map((c) => c.title)).toEqual([
      'Email scheduler', 'RFx CoE Intelligent Intake & Ticketing Agent', 'Third Party Invoice Assessment',
    ]);
  });

  it('reads an .xlsx export the same way', async () => {
    const root = await tmpWorkspace();
    const rows = parse(await readFile(FIXTURE), { bom: true }) as string[][];
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Ideas');
    rows.forEach((r) => ws.addRow(r));
    const file = path.join(root, 'data', 'inbox', 'export.xlsx');
    await wb.xlsx.writeFile(file);
    const r = await importExport(root, file, opts);
    expect(r.created).toHaveLength(3);
    expect((await loadIdea(root, 'CAFE-2026-001')).support).toEqual(['Agent Design Guidance', 'AI Solution Brainstorming']);
  });

  it('refuses a file with no Title column and writes nothing', async () => {
    const root = await tmpWorkspace();
    const file = path.join(root, 'data', 'inbox', 'wrong.csv');
    await writeFile(file, 'Name,Region\nX,AMER\n');
    await expect(importExport(root, file, opts)).rejects.toThrow('has no Title column');
    expect((await listIdeas(root)).ideas).toEqual([]);
  });

  it('refuses a file type it cannot read', async () => {
    const root = await tmpWorkspace();
    const file = path.join(root, 'data', 'inbox', 'notes.txt');
    await writeFile(file, 'hello');
    await expect(importExport(root, file, opts)).rejects.toThrow('use a .csv or .xlsx export');
  });

  it('never reissues the ID of a broken idea folder', async () => {
    const root = await tmpWorkspace();
    const broken = path.join(root, 'data', 'ideas', 'CAFE-2026-001-broken');
    await mkdir(broken, { recursive: true });
    const brokenYaml = 'title: [unclosed\n';
    await writeFile(path.join(broken, 'idea.yaml'), brokenYaml);
    const r = await importExport(root, FIXTURE, opts);
    expect(r.created.map((c) => c.id)).toEqual(['CAFE-2026-002', 'CAFE-2026-003', 'CAFE-2026-004']);
    expect(await readFile(path.join(broken, 'idea.yaml'), 'utf8')).toBe(brokenYaml);
  });
  it('keeps row numbers true after a blank line in a CSV', async () => {
    const root = await tmpWorkspace();
    const file = path.join(root, 'gap.csv');
    await writeFile(file, 'Title,Submitter Name\nFirst,Person 1 (CS)\n\n,Person 2 (CS)\nLast,Person 3 (CS)\n');
    const r = await importExport(root, file, opts);
    expect(r.errors).toEqual([{ row: 4, message: 'Title is empty' }]);
    expect((await loadIdea(root, r.created[1].id)).source).toEqual({ file: 'gap.csv', row: 5 });
  });
});

describe('the newer form columns', () => {
  const csv = (header: string[], row: string[]) => [header, row].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
  it('keeps solution maturity, business impact, beneficiaries, use case category and additional context; skips SharePoint\'s own columns', async () => {
    const root = await tmpWorkspace();
    const file = path.join(root, 'data', 'inbox', 'newer.csv');
    await writeFile(file, csv(
      ['ID', 'Title', 'Submitter Name', 'Solution Maturity', 'Business Impact', 'Beneficiaries', 'Use Case Category', 'Additional Context', 'Item Type', 'Path', 'Created', 'Modified', 'Created By', 'Content Type', 'Favourite colour'],
      ['4', 'Desk finder', 'Person 1 (CS)', 'Prototype', 'Saves about 2 hours a week per office manager', 'Employees;#Office managers', 'Workplace services', 'Pilot runs in one office first.', 'Item', 'sites/cafe/Lists/Submissions', '2026-10-01', '2026-10-02', 'Person 1', 'Item', 'Teal'],
    ));
    const r = await importExport(root, file, opts);
    expect(r.ignoredColumns).toEqual(['Favourite colour']);
    const idea = await loadIdea(root, r.created[0].id);
    expect(idea).toMatchObject({
      maturity: 'Prototype',
      business_impact: 'Saves about 2 hours a week per office manager',
      beneficiaries: ['Employees', 'Office managers'],
      use_case_category: ['Workplace services'],
      additional_context: 'Pilot runs in one office first.',
    });
  });

  it('a multi-choice answer in a text column reads "A; B", and a missing column leaves the field out', async () => {
    const root = await tmpWorkspace();
    const file = path.join(root, 'data', 'inbox', 'multi.csv');
    await writeFile(file, csv(['Title', 'Solution Maturity', 'Business Impact'], ['Desk finder', ';#Idea;#Prototype;#', '']));
    const r = await importExport(root, file, opts);
    const idea = await loadIdea(root, r.created[0].id);
    expect(idea.maturity).toBe('Idea; Prototype');
    expect(idea.business_impact).toBeUndefined();
    expect(idea.beneficiaries).toEqual([]);
    expect(idea.use_case_category).toEqual([]);
  });
});

describe('the real form export: team lists and names as people type them', () => {
  it('"Lead: Name(he/him)", "Sponsor: Name", "Team Member: Name", one per line: roles kept, pronouns dropped', async () => {
    const { parseTeam } = await import('../src/import/columns');
    expect(parseTeam('Lead: Person One(he/him)\nSponsor: Person Two\nTeam Member: Person Three')).toEqual([
      { name: 'Person One', roles: ['lead'], note: 'Lead' }, { name: 'Person Two', roles: ['sponsor'], note: 'Sponsor' }, { name: 'Person Three', roles: ['member'] },
    ]);
  });
  it('"Name (Lead)" then plain names on their own lines; "Name (she/her) (Sponsor)"; "Doe, Jane" turns to "Jane Doe"', async () => {
    const { parseTeam } = await import('../src/import/columns');
    expect(parseTeam('Person Four (Lead)\nPerson Five\nPerson Six')).toEqual([
      { name: 'Person Four', roles: ['lead'], note: 'Lead' }, { name: 'Person Five', roles: ['member'] }, { name: 'Person Six', roles: ['member'] },
    ]);
    expect(parseTeam('Person Seven (she/her) (Sponsor)')).toEqual([{ name: 'Person Seven', roles: ['sponsor'], note: 'Sponsor' }]);
    expect(parseTeam('Doe, Jane (Lead)')).toEqual([{ name: 'Jane Doe', roles: ['lead'], note: 'Lead' }]);
  });
  it('the submitter "Doe, Jane (CS)" is stored as "Jane Doe" with entity CS', async () => {
    const { parseSubmitter } = await import('../src/import/columns');
    expect(parseSubmitter('Doe, Jane (CS)')).toEqual({ name: 'Jane Doe', entity: 'CS' });
    expect(parseSubmitter('Person 1 (CS)')).toEqual({ name: 'Person 1', entity: 'CS' });
  });
});
