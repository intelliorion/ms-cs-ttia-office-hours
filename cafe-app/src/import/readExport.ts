import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';

export interface Table {
  header: string[];
  rows: string[][];
}

export async function readTable(file: string): Promise<Table> {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.csv') {
    const records = parse(await fs.readFile(file), { bom: true, relax_column_count: true, skip_empty_lines: true }) as string[][];
    const [header = [], ...rows] = records;
    return { header: header.map((h) => h.trim()), rows };
  }
  if (ext === '.xlsx') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.worksheets[0];
    if (!ws) return { header: [], rows: [] };
    const all: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) cells.push(row.getCell(c).text ?? '');
      all.push(cells);
    });
    const [header = [], ...rows] = all;
    return { header: header.map((h) => h.trim()), rows };
  }
  throw new Error(`Can't read ${path.basename(file)}: use a .csv or .xlsx export`);
}
