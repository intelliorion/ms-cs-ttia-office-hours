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
      { name: 'Person 2', role: 'lead', note: 'Lead' },
      { name: 'Person 3', role: 'sponsor', note: 'Sponsor' },
      { name: 'Person 4', role: 'member' },
    ]);
    expect(parseTeam('Person 6 - Team lead\nAnne-Marie Person')).toEqual([
      { name: 'Person 6', role: 'lead', note: 'Team lead' },
      { name: 'Anne-Marie Person', role: 'member' },
    ]);
  });
});

describe('importExport', () => {
  it('imports the three real submissions and reports the rest', async () => {
    const root = await tmpWorkspace();
    const r = await importExport(root, FIXTURE, opts);
    expect(r.created.map((c) => c.id)).toEqual(['CAFE-2026-001', 'CAFE-2026-002', 'CAFE-2026-003']);
    expect(r.errors).toEqual([{ row: 5, message: 'Title is empty' }]);
    expect(r.ignoredColumns).toEqual(['ID']);
    expect(r.flags.filter((f) => f.id === 'CAFE-2026-003').map((f) => f.message)).toEqual([
      'Cut off in the export, check the full text: Desired Outcomes "Save time; Imp…"',
      'Participation is Individual but 6 people are listed',
    ]);
    expect(r.flags.filter((f) => f.id === 'CAFE-2026-002').map((f) => f.message)).toContain(
      'Cut off in the export, check the full text: Support Requested "Agent Design Guidance; Collab…"',
    );

    const rfx = await loadIdea(root, 'CAFE-2026-002');
    expect(rfx).toMatchObject({ function: 'GSS', region: 'APAC', entity: 'CS', round: '', stage: 1 });
    expect(rfx.people.submitter).toBe('Person 2');
    expect(rfx.people.team.map((p) => p.role)).toEqual(['lead', 'sponsor', 'member']);
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
    const file = path.join(root, 'inbox', 'reordered.csv');
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
    const file = path.join(root, 'inbox', 'export.xlsx');
    await wb.xlsx.writeFile(file);
    const r = await importExport(root, file, opts);
    expect(r.created).toHaveLength(3);
    expect((await loadIdea(root, 'CAFE-2026-001')).support).toEqual(['Agent Design Guidance', 'AI Solution Brainstorming']);
  });

  it('refuses a file with no Title column and writes nothing', async () => {
    const root = await tmpWorkspace();
    const file = path.join(root, 'inbox', 'wrong.csv');
    await writeFile(file, 'Name,Region\nX,AMER\n');
    await expect(importExport(root, file, opts)).rejects.toThrow('has no Title column');
    expect((await listIdeas(root)).ideas).toEqual([]);
  });

  it('refuses a file type it cannot read', async () => {
    const root = await tmpWorkspace();
    const file = path.join(root, 'inbox', 'notes.txt');
    await writeFile(file, 'hello');
    await expect(importExport(root, file, opts)).rejects.toThrow('use a .csv or .xlsx export');
  });

  it('never reissues the ID of a broken idea folder', async () => {
    const root = await tmpWorkspace();
    const broken = path.join(root, 'ideas', 'CAFE-2026-001-broken');
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
