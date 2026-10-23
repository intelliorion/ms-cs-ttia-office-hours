/** Synthetic files for the Data step's tests: made-up rows and words only, never real data. */
import ExcelJS from 'exceljs';
import { strToU8, zipSync } from 'fflate';

const DAYS = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-10', '2026-10-11'];
const TYPES = ['T', 'M', 'H'];

/** A masked expense export: claim_id, claim_date, employee_ref (masked), policy_type (a code), amount, receipt. */
export function expenseCsv(rows = 40, sep = ','): string {
  const out = [['claim_id', 'claim_date', 'employee_ref', 'policy_type', 'amount', 'receipt'].join(sep)];
  for (let i = 1; i <= rows; i++) out.push([`CLM-${String(i).padStart(4, '0')}`, DAYS[i % DAYS.length], `EMP-****${i % 7}`, TYPES[i % 3], (12.5 * (i % 9) + 3).toFixed(2), i % 4 ? 'yes' : 'no'].join(sep));
  return `${out.join('\n')}\n`;
}

/** The same export with obvious fake personal data in it (fake emails and phones): the check must hold it. */
export function personalCsv(): string {
  const out = ['claim_id,staff_email,mobile,amount'];
  for (let i = 1; i <= 6; i++) out.push(`CLM-${i},person${i}@corp-mail.co.uk,07700 900${String(100 + i)},${10 * i}`);
  return `${out.join('\n')}\n`;
}

/** A rules workbook: one sheet of policy caps, one of weekday rules (a date cell too). */
export async function rulesXlsx(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const a = wb.addWorksheet('caps');
  a.addRow(['policy_type', 'max_amount', 'receipt_over']);
  a.addRow(['T', 150, 25]); a.addRow(['M', 40, 15]); a.addRow(['H', 220, 0]);
  const b = wb.addWorksheet('days');
  b.addRow(['policy_type', 'weekend_ok', 'from']);
  b.addRow(['T', 'yes', new Date(Date.UTC(2026, 0, 1))]); b.addRow(['M', 'no', new Date(Date.UTC(2026, 0, 1))]);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** A sample output: the claims flagged, with a reason. */
export function outputCsv(): string {
  return 'claim_id,flag_reason,amount_over\nCLM-0004,Weekend claim on a weekday-only policy,0\nCLM-0007,Over the cap,12.50\n';
}

/** A short process document as a .docx (only word/document.xml, which is all the reader needs). */
export function processDocx(lines = ['How we check expenses today', 'Step 1: export the claims every Monday.', 'Step 2: compare each claim with the policy caps.']): Uint8Array {
  const body = lines.map((l) => `<w:p><w:r><w:t>${l}</w:t></w:r></w:p>`).join('');
  return zipSync({ 'word/document.xml': strToU8(`<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`) });
}

/** An example email asking for a check. */
export function exampleEml(): string {
  return [
    'From: Finance Team <finance@example.com>', 'To: Cafe <cafe@example.com>', 'Subject: Weekly expense check', 'Date: Mon, 5 Oct 2026 09:00:00 +0000',
    'Content-Type: text/plain; charset=utf-8', '', 'Hello,', '', 'Please check last week\'s claims against the caps and send the flagged ones by Friday.', '', 'Thanks',
  ].join('\r\n');
}
