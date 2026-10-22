import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initWorkspace } from '../src/workspace/init';
import { fixedClock } from '../src/clock';
import { normalizeIdea, type Idea } from '../src/ideas/idea';

export const FIXTURE = fileURLToPath(new URL('./fixtures/sample-export.csv', import.meta.url));

export async function tmpWorkspace(today = '2026-10-19'): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cafe-ws-'));
  await initWorkspace(root);
  return root;
}

export function sampleIdea(over: Partial<Idea> = {}): Idea {
  return normalizeIdea({
    id: 'CAFE-2026-001',
    slug: 'email-scheduler',
    title: 'Email scheduler',
    round: 'ROUND-2026-Q4',
    stage: 1,
    function: 'BSI',
    region: 'AMER',
    people: { submitter: 'Person 1', team: [] },
    dedupe_key: 'email scheduler|person 1',
    ...over,
  });
}

import type { AddressInfo } from 'node:net';
import { createApp, type ServerOptions } from '../src/server/server';

export async function startServer(today = '2026-10-19', extra: Partial<ServerOptions> = {}) {
  const root = await tmpWorkspace(today);
  const server = createApp({ root, clock: fixedClock(today), ...extra });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { root, server, base: `http://127.0.0.1:${port}` };
}

import { deflateSync } from 'node:zlib';

/** A tiny PDF from its objects (object 1 is the catalog); offsets are counted in bytes, so binary streams are safe. */
function pdfOf(objs: (string | Buffer)[], trailer = ''): Uint8Array {
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  let size = parts[0].length;
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(size);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), typeof o === 'string' ? Buffer.from(o, 'latin1') : o, Buffer.from('\nendobj\n', 'latin1')]);
    parts.push(b); size += b.length;
  });
  parts.push(Buffer.from(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R${trailer} >>\nstartxref\n${size}\n%%EOF\n`, 'latin1'));
  return new Uint8Array(Buffer.concat(parts));
}

/** A one-page PDF with Helvetica text, one line per entry. */
export function textPdf(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const stream = `BT /F1 12 Tf 72 720 Td 16 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`;
  return pdfOf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

/** A one-page PDF holding only an image (an 8×8 RGB square, FlateDecode) and no text layer: a "scan". */
export function imagePdf(): Uint8Array {
  const pixels = Buffer.alloc(8 * 8 * 3, 0xff);
  for (let i = 0; i < 8; i++) pixels.fill(0, (i * 8 + i) * 3, (i * 8 + i) * 3 + 3);
  const img = deflateSync(pixels);
  const content = 'q 200 0 0 200 72 500 cm /Im1 Do Q';
  return pdfOf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${img.length} >>\nstream\n`, 'latin1'),
      img, Buffer.from('\nendstream', 'latin1'),
    ]),
  ]);
}

/** A PDF locked with a password that is not empty (the stored password checks fail, so pdf.js asks for one). */
export function protectedPdf(): Uint8Array {
  const h = 'ab'.repeat(32);
  return pdfOf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [] /Count 0 >>',
    `<< /Filter /Standard /V 1 /R 2 /O <${h}> /U <${h}> /P -4 >>`,
  ], ` /Encrypt 3 0 R /ID [<${'01'.repeat(16)}> <${'01'.repeat(16)}>]`);
}

/** The memo of the kit's 12-text.pdf (CAFE-2026-004, three facts). */
export const MEMO_LINES = [
  'Memo: CAFE-2026-004 Expense anomaly finder',
  'Data source: the expense system export.',
  'It needs a capability for duplicate claim spotting.',
  'The finance team wants a weekly digest.',
];
