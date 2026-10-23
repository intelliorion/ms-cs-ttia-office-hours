import { describe, it, expect } from 'vitest';
import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { tmpWorkspace, sampleIdea } from './helpers';
import { saveIdea } from '../src/ideas/store';
import { fixedClock } from '../src/clock';
import { parseDrop, splitQuoted, msgFieldsToParsed } from '../src/inbox/parse';
import { screen, screenDrop, knownParticipants } from '../src/inbox/screen';
import { saveDrop, listItems, getItem, updateItem, holdItem, deleteHeld, itemsDir } from '../src/inbox/store';
import { writeFile } from 'node:fs/promises';

const FIX = (name: string) => fileURLToPath(new URL(`./fixtures/inbox/${name}`, import.meta.url));
const bytes = async (name: string) => new Uint8Array(await readFile(FIX(name)));
const exists = (p: string) => access(p).then(() => true, () => false);

function buildDocx(paragraphs: string[]): Uint8Array {
  return docxFromBody(paragraphs.map(para).join(''));
}
const para = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const table = (rows: string[][]) =>
  `<w:tbl>${rows.map((r) => `<w:tr>${r.map((c) => `<w:tc><w:tcPr/>${para(c)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;

function docxFromBody(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    'word/document.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        `<w:body>${body}</w:body></w:document>`,
    ),
  });
}

describe('parseDrop', () => {
  it('reads an Outlook reply: headers, the plain part, and the quoted E2 split off', async () => {
    const p = parseDrop('reply.eml', await bytes('reply.eml'));
    expect(p.type).toBe('email');
    expect(p.meta.from).toBe('Person 2 <person.2@example.com>');
    expect(p.meta.to).toEqual(["Creators' Café <cafe@example.com>"]);
    expect(p.meta.cc).toEqual(['Person 3 <person.3@example.com>']);
    expect(p.meta.subject).toBe('RE: CAFE-2026-001 Email scheduler: two quick questions');
    expect(p.meta.date).toBe('2026-10-20T09:30:00.000Z');
    expect(p.text).toContain('Hi Café team,');
    expect(p.text).toContain('About 40 a week, mostly from the EMEA desk, and it peaks at month end.');
    expect(p.text).toContain('shared mailbox. I’d say it takes us half a day');
    expect(p.text).not.toContain('Two quick questions before review');
    expect(p.text).not.toContain('____');
    expect(p.text).not.toContain('HTML version');
    expect(p.meta.quoted).toContain("From: Creators' Café <cafe@example.com>");
    expect(p.meta.quoted).toContain('Two quick questions before review');
  });

  it('takes a base64 latin-1 text part and lists attachments', () => {
    const raw = [
      'From: Person 4 <person.4@example.com>',
      'Subject: Notes',
      'Content-Type: multipart/mixed; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/plain; charset=iso-8859-1',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('Caf\xe9 notes here', 'latin1').toString('base64'),
      '--b1',
      'Content-Type: application/vnd.ms-excel; name="team tracker.xlsx"',
      'Content-Disposition: attachment; filename="team tracker.xlsx"',
      'Content-Transfer-Encoding: base64',
      '',
      'AAAA',
      '--b1--',
      '',
    ].join('\r\n');
    const p = parseDrop('notes.eml', strToU8(raw));
    expect(p.text).toBe('Café notes here');
    expect(p.meta.attachments).toEqual(['team tracker.xlsx']);
  });

  it('splits quoted replies at "On … wrote:", Original Message, or ">" lines', () => {
    expect(splitQuoted('Yes please.\n\nOn Mon, 19 Oct 2026, Person 1 wrote:\n> Shall we?')).toEqual({
      text: 'Yes please.',
      quoted: 'On Mon, 19 Oct 2026, Person 1 wrote:\n> Shall we?',
    });
    expect(splitQuoted('Fine.\n-----Original Message-----\nFrom: x').text).toBe('Fine.');
    expect(splitQuoted('Agreed.\n> earlier line\n> more').quoted).toBe('> earlier line\n> more');
    expect(splitQuoted('No quote here.')).toEqual({ text: 'No quote here.', quoted: undefined });
  });

  it('adapts an Outlook .msg read by msgreader', () => {
    const p = msgFieldsToParsed({
      subject: 'RE: CAFE-2026-001 Email scheduler',
      senderName: 'Person 2',
      senderEmail: 'person.2@example.com',
      messageDeliveryTime: 'Tue, 20 Oct 2026 09:30:00 GMT',
      body: "Answers below.\r\n\r\nFrom: Creators' Café <cafe@example.com>\r\nSent: 20 October 2026 09:12\r\nOur questions",
      recipients: [
        { name: "Creators' Café", smtpAddress: 'cafe@example.com', recipType: 'to' },
        { name: 'Person 3', email: 'person.3@example.com', recipType: 'cc' },
      ],
      attachments: [{ fileName: 'minutes.docx' }],
    });
    expect(p.type).toBe('email');
    expect(p.meta.from).toBe('Person 2 <person.2@example.com>');
    expect(p.meta.to).toEqual(["Creators' Café <cafe@example.com>"]);
    expect(p.meta.cc).toEqual(['Person 3 <person.3@example.com>']);
    expect(p.meta.date).toBe('2026-10-20T09:30:00.000Z');
    expect(p.text).toBe('Answers below.');
    expect(p.meta.quoted).toContain('Our questions');
    expect(p.meta.attachments).toEqual(['minutes.docx']);
  });

  it('reads a REAL Outlook .msg file (msgreader test fixture, Apache-2.0)', async () => {
    const p = parseDrop('outlook-sample.msg', new Uint8Array(Buffer.from(await readFile(FIX('outlook-sample.msg.b64'), 'utf8'), 'base64')));
    expect(p.type).toBe('email');
    expect(p.problems).toBeUndefined();
    expect(p.text.trim().length).toBeGreaterThan(0);
    expect(p.text).toBe('attachmentFiles');
    expect(p.meta.subject).toBe('attachmentFiles');
    expect(p.meta.from).toBe('hmailuser <hmailuser@hmailserver.test>');
    expect(p.meta.attachments).toEqual(['jpg.jpg', 'png.png', 'tif.tif']);
    expect(screenDrop('outlook-sample.msg', p, []).hold).toBe(false);
  });

  it('reports a .msg it cannot open instead of throwing', () => {
    const p = parseDrop('broken.msg', strToU8('not an outlook file'));
    expect(p.type).toBe('email');
    expect(p.text).toBe('');
    expect(p.problems?.[0]).toMatch(/couldn't read this Outlook email/i);
    expect(p.problems?.[0]).not.toMatch(/constructor|undefined/); // msgreader itself loaded and rejected it
  });

  it('turns a Teams .vtt into "Speaker: text" lines and lists the speakers', async () => {
    const p = parseDrop('transcript.vtt', await bytes('transcript.vtt'));
    expect(p.type).toBe('transcript');
    const lines = p.text.split('\n');
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe('Person 2: Thanks for joining. This is about the email scheduler idea.');
    expect(lines[2]).toBe('Person 9: Could the catalogue team classify them first?');
    expect(p.meta.speakers).toEqual(['Person 2', 'Person 3', 'Person 9']);
  });

  it('keeps .txt and .md notes as they are', async () => {
    const p = parseDrop('note.txt', await bytes('note.txt'));
    expect(p.type).toBe('note');
    expect(p.text).toContain('Person 3 offered to help build the first version.');
    expect(parseDrop('n.md', strToU8('# Heading\nbody')).text).toBe('# Heading\nbody');
  });

  it('reads the paragraphs of a .docx', () => {
    const p = parseDrop('minutes.docx', buildDocx(['Minutes: email scheduler', 'Person 9 &amp; Person 3 agreed next steps.']));
    expect(p.type).toBe('document');
    expect(p.text).toBe('Minutes: email scheduler\nPerson 9 & Person 3 agreed next steps.');
  });

  it('marks .csv and .xlsx as exports with no text, and anything else as unknown', async () => {
    const csv = parseDrop('held-tracker.csv', await bytes('held-tracker.csv'));
    expect(csv).toMatchObject({ type: 'export', text: '' });
    expect(csv.screenText).toContain('Person 21');
    expect(parseDrop('list.xlsx', new Uint8Array([1, 2]))).toMatchObject({ type: 'export', text: '' });
    expect(parseDrop('scan.pdf', new Uint8Array([1, 2]))).toEqual({ type: 'document', text: '', meta: { pending: 'pdf' } });
    for (const n of ['a.png', 'a.jpg', 'a.JPEG', 'a.gif', 'a.webp']) {
      expect(parseDrop(n, new Uint8Array([1]))).toEqual({ type: 'note', text: '', meta: { pending: 'picture' } });
    }
    for (const n of ['a.bmp', 'a.tif', 'a.tiff', 'a.heic']) {
      expect(parseDrop(n, new Uint8Array([1])).unreadable).toBe("This picture format isn't supported; save it as PNG or JPG");
    }
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    expect(parseDrop('big.png', big).unreadable).toBe('Pictures and PDFs up to 10 MB only');
    expect(parseDrop('big.pdf', big).unreadable).toBe('Pictures and PDFs up to 10 MB only');
    expect(parseDrop('ok.png', new Uint8Array(10 * 1024 * 1024)).meta.pending).toBe('picture');
    expect(parseDrop('thing.bin', new Uint8Array([1])).type).toBe('unknown');
  });
});

describe('screen', () => {
  it('holds the tracker with plain-English reasons', async () => {
    const result = screenDrop('held-tracker.csv', parseDrop('held-tracker.csv', await bytes('held-tracker.csv')), []);
    expect(result.hold).toBe(true);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        'Lists 12 people by name',
        'Has 12 employee or ID numbers',
        'Has 12 phone numbers',
        'Looks like a tracker with 12 names in it',
      ]),
    );
  });

  it('the tracker count is the number of names found, for 15 rows', () => {
    const csv = ['Name,Employee ID', ...Array.from({ length: 15 }, (_, i) => `Person ${i + 40},AB${12000 + i}`)].join('\n');
    const r = screenDrop('team tracker.csv', parseDrop('team tracker.csv', new TextEncoder().encode(csv)), []);
    expect(r.reasons).toContain('Looks like a tracker with 15 names in it');
  });

  it('passes a normal reply from known participants, and a transcript', async () => {
    const p = parseDrop('reply.eml', await bytes('reply.eml'));
    expect(screenDrop('reply.eml', p, ['Person 2', 'Person 3'])).toEqual({ hold: false, reasons: [] });
    const t = parseDrop('transcript.vtt', await bytes('transcript.vtt'));
    expect(screenDrop('transcript.vtt', t, [])).toEqual({ hold: false, reasons: [] });
  });

  it('holds what it cannot read', () => {
    const r = screenDrop('scan.bmp', parseDrop('scan.bmp', new Uint8Array([1])), []);
    expect(r.hold).toBe(true);
    expect(r.reasons[0]).toMatch(/format isn't supported/);
  });

  it('counts personal email addresses that are not known participants', () => {
    const others = ['a.one', 'b.two', 'c.three', 'd.four', 'e.five'].map((x) => `${x}@example.com`).join(', ');
    expect(screen(`Please add ${others}`, {}).reasons).toEqual(['Has 5 personal email addresses']);
    const withKnown = 'person.2@example.com person.3@example.com noreply@example.com a.one@example.com b.two@example.com';
    expect(screen(withKnown, { knownParticipants: ['Person 2', 'Person 3'] }).hold).toBe(false);
  });

  it('flags sensitive words and name tables, ignoring known people', () => {
    expect(screen('His salary and date of birth are attached', {}).reasons).toEqual(['Mentions salary, date of birth']);
    const team = 'Name | Role\n--- | ---\nPerson 2 | lead\nPerson 3 | member\nPerson 4 | sponsor';
    expect(screen(team, { knownParticipants: ['Person 2', 'Person 3', 'Person 4'] }).hold).toBe(false);
    expect(screen(team, {}).reasons).toEqual(['Lists 3 people by name']);
    expect(screen('Client\tRegion\nAcme Ltd\tEMEA\nBeta plc\tAPAC\nGamma Inc\tAMER', {}).reasons).toEqual(['Lists 3 clients by name']);
  });

  it('builds known participants from every idea', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea({ people: { submitter: 'Person 1', team: [{ name: 'Person 5', role: 'member' }] } }));
    expect(await knownParticipants(root)).toEqual(['Person 1', 'Person 5']);
  });
});

describe('inbox store', () => {
  const clock = fixedClock('2026-10-20');

  it('saves a drop with a JSON sidecar and lists it', async () => {
    const root = await tmpWorkspace();
    const item = await saveDrop(root, 'reply.eml', await bytes('reply.eml'), clock);
    expect(item.file).toBe('inbox/2026-10-20-reply.eml');
    expect(item).toMatchObject({ name: 'reply.eml', type: 'email', status: 'new' });
    expect(item.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(item.text).toBeUndefined(); // stored only after the screen (triage)
    expect(item.meta).toBeUndefined();
    expect(item.duplicate).toBeUndefined();
    expect(await readFile(path.join(root, 'data', item.file))).toEqual(Buffer.from(await bytes('reply.eml')));
    const sidecar = JSON.parse(await readFile(path.join(itemsDir(root), `${item.id}.json`), 'utf8'));
    expect(sidecar.id).toBe(item.id);
    expect(await listItems(root)).toEqual([item]);
    expect(await getItem(root, item.id)).toEqual(item);
    const updated = await updateItem(root, item.id, { status: 'triaged' });
    expect(updated.status).toBe('triaged');
    expect((await getItem(root, item.id))?.status).toBe('triaged');
  });

  it('saves pasted text as a note', async () => {
    const root = await tmpWorkspace();
    const item = await saveDrop(root, 'Pasted note', 'Person 2 called about CAFE-2026-001.', clock);
    expect(item.type).toBe('note');
    expect(item.file).toBe('inbox/2026-10-20-pasted-note.txt');
    expect(item.text).toBeUndefined();
    expect(await readFile(path.join(root, 'data', item.file), 'utf8')).toBe('Person 2 called about CAFE-2026-001.');
  });

  it('recognises the same content dropped twice', async () => {
    const root = await tmpWorkspace();
    const first = await saveDrop(root, 'reply.eml', await bytes('reply.eml'), clock);
    const again = await saveDrop(root, 'copy of reply.eml', await bytes('reply.eml'), clock);
    expect(again.id).toBe(first.id);
    expect(again.duplicate).toBe(true);
    expect(await listItems(root)).toHaveLength(1);
    expect((await readdir(path.join(root, 'data', 'inbox'))).filter((n) => n.endsWith('.eml'))).toEqual(['2026-10-20-reply.eml']);
    const other = await saveDrop(root, 'reply.eml', strToU8('different'), clock);
    expect(other.file).toBe('inbox/2026-10-20-reply-2.eml');
  });

  it('holds an item: file moved to inbox/held and text cleared; delete removes it', async () => {
    const root = await tmpWorkspace();
    const item = await saveDrop(root, 'held-tracker.csv', await bytes('held-tracker.csv'), clock);
    const held = await holdItem(root, item.id, ['Lists 12 people by name']);
    expect(held.status).toBe('held');
    expect(held.file).toBe('inbox/held/2026-10-20-held-tracker.csv');
    expect(held.text).toBeUndefined();
    expect(held.hold).toEqual({ reasons: ['Lists 12 people by name'] });
    expect(await exists(path.join(root, 'data', item.file))).toBe(false);
    expect(await exists(path.join(root, 'data', held.file))).toBe(true);
    const sidecar = await readFile(path.join(itemsDir(root), `${item.id}.json`), 'utf8');
    expect(sidecar).not.toContain('AB12366');

    const note = await saveDrop(root, 'note.txt', await bytes('note.txt'), clock);
    await expect(deleteHeld(root, note.id)).rejects.toThrow(/only held/i);
    await deleteHeld(root, item.id);
    expect(await exists(path.join(root, 'data', held.file))).toBe(false);
    expect(await getItem(root, item.id)).toBeUndefined();
  });

  it('keeps metadata only in sidecar JSON files', async () => {
    const root = await tmpWorkspace();
    await saveDrop(root, 'note.txt', await bytes('note.txt'), clock);
    await saveDrop(root, 'transcript.vtt', await bytes('transcript.vtt'), clock);
    expect((await readdir(path.join(root, 'data', 'inbox'))).sort()).toEqual(['.items', '2026-10-20-note.txt', '2026-10-20-transcript.vtt', 'held']);
    const sidecars = await readdir(itemsDir(root));
    expect(sidecars).toHaveLength(2);
    expect(sidecars.every((n) => n.endsWith('.json'))).toBe(true);
  });
});

describe('fix round 1', () => {
  const clock = fixedClock('2026-10-20');

  it('keeps .docx tables as tab-separated rows, so a name table is held', () => {
    const body = para('Team list') + table([['Name', 'Role'], ['Person 41', 'lead'], ['Person 42', 'member'], ['Person 43', 'member'], ['Person 44', 'sponsor']]);
    const p = parseDrop('team.docx', docxFromBody(body));
    expect(p.text).toBe('Team list\nName\tRole\nPerson 41\tlead\nPerson 42\tmember\nPerson 43\tmember\nPerson 44\tsponsor');
    expect(screenDrop('team.docx', p, [])).toEqual({ hold: true, reasons: ['Lists 4 people by name'] });
  });

  it('a held email keeps only the subject and the sender display name', async () => {
    const root = await tmpWorkspace();
    const item = await saveDrop(root, 'reply.eml', await bytes('reply.eml'), clock);
    await holdItem(root, item.id, ['Has 5 personal email addresses'], parseDrop('reply.eml', await bytes('reply.eml')).meta);
    const sidecar = await readFile(path.join(itemsDir(root), `${item.id}.json`), 'utf8');
    expect(sidecar).not.toContain('@');
    expect(sidecar).not.toContain('Person 3');
    expect(JSON.parse(sidecar).meta).toEqual({ subject: 'RE: CAFE-2026-001 Email scheduler: two quick questions', from: 'Person 2' });

    const t = await saveDrop(root, 'transcript.vtt', await bytes('transcript.vtt'), clock);
    await holdItem(root, t.id, ['x'], parseDrop('transcript.vtt', await bytes('transcript.vtt')).meta);
    const tSidecar = await readFile(path.join(itemsDir(root), `${t.id}.json`), 'utf8');
    expect(tSidecar).not.toMatch(/Person [239]/);
  });

  it('does not count timestamps or IP addresses as phone numbers', () => {
    expect(screen('Sessions: 2026-10-20 10:30, 2026-10-21 11:45, 2026-10-22 09:15 and 2026-10-23T14:00', {}).hold).toBe(false);
    expect(screen('Servers 10.0.0.12, 192.168.1.20, 172.16.4.33 and 10.20.30.40', {}).hold).toBe(false);
    expect(screen('Call +44 20 7946 0001, +44 20 7946 0002 or +44 20 7946 0003', {}).reasons).toEqual(['Has 3 phone numbers']);
  });

  it('does not count addresses on quoted From/To/Cc lines', async () => {
    const raw = [
      'From: Person 2 <person.2@example.com>',
      'To: cafe@example.com',
      'Subject: RE: CAFE-2026-001',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Yes, Thursday works.',
      '',
      'From: Creators\' Café <cafe@example.com>',
      'Sent: 20 October 2026 09:12',
      'To: Person 2 <person.2@example.com>',
      'Cc: a.one@example.com; b.two@example.com; c.three@example.com;',
      ' d.four@example.com; e.five@example.com',
      'Subject: CAFE-2026-001',
      '',
      'Does Thursday work?',
    ].join('\r\n');
    const p = parseDrop('r.eml', strToU8(raw));
    expect(p.text).toBe('Yes, Thursday works.');
    expect(screenDrop('r.eml', p, ['Person 2'])).toEqual({ hold: false, reasons: [] });
  });

  it('joins a wrapped "On … wrote:" line and only treats a real From: header as a quote', () => {
    expect(splitQuoted('Yes.\n\nOn Mon, 19 Oct 2026 at 10:00, Person 1 <person.1@example.com>\nwrote:\n> Shall we?')).toEqual({
      text: 'Yes.',
      quoted: 'On Mon, 19 Oct 2026 at 10:00, Person 1 <person.1@example.com>\nwrote:\n> Shall we?',
    });
    expect(splitQuoted('Sounds good.\nFrom: Monday we can start.\nThanks')).toEqual({
      text: 'Sounds good.\nFrom: Monday we can start.\nThanks',
      quoted: undefined,
    });
  });

  it('holdItem is idempotent and recovers when the move did not finish', async () => {
    const root = await tmpWorkspace();
    const item = await saveDrop(root, 'held-tracker.csv', await bytes('held-tracker.csv'), clock);
    const first = await holdItem(root, item.id, ['Lists 12 people by name']);
    const second = await holdItem(root, item.id, ['Lists 12 people by name']);
    expect(second).toEqual(first);
    expect(await exists(path.join(root, 'data', first.file))).toBe(true);
    expect((await readdir(path.join(root, 'data', 'inbox', 'held')))).toEqual(['2026-10-20-held-tracker.csv']);

    // a crash after the sidecar write but before the rename: the file is still in inbox/
    const other = await saveDrop(root, 'note.txt', await bytes('note.txt'), clock);
    const sidecarPath = path.join(itemsDir(root), `${other.id}.json`);
    const half = { ...other, status: 'held', file: 'inbox/held/2026-10-20-note.txt', heldFrom: other.file, hold: { reasons: ['x'] } };
    delete (half as { text?: string }).text;
    await writeFile(sidecarPath, JSON.stringify(half));
    const recovered = await holdItem(root, other.id, ['x']);
    expect(recovered.file).toBe('inbox/held/2026-10-20-note.txt');
    expect(await exists(path.join(root, 'data', recovered.file))).toBe(true);
    expect(await exists(path.join(root, 'data', other.file))).toBe(false);
  });

  it('vtt fallback speakers must look like names', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nPerson 5: hello\n\n00:00:02.000 --> 00:00:03.000\nNote: this is not a speaker';
    const p = parseDrop('t.vtt', strToU8(vtt));
    expect(p.meta.speakers).toEqual(['Person 5']);
    expect(p.text).toBe('Person 5: hello\nNote: this is not a speaker');
  });

  it('skips a corrupt sidecar and reports it; receivedAt uses the clock date', async () => {
    const root = await tmpWorkspace();
    const item = await saveDrop(root, 'note.txt', await bytes('note.txt'), clock);
    expect(item.receivedAt.startsWith('2026-10-20T')).toBe(true);
    await writeFile(path.join(itemsDir(root), 'in-000000000000.json'), '{ not json');
    const problems: string[] = [];
    expect(await listItems(root, problems)).toHaveLength(1);
    expect(problems).toEqual(["Couldn't read inbox/.items/in-000000000000.json"]);
  });

  it('refuses a .docx whose text part inflates past 20 MB', () => {
    const big = docxFromBody(para('x'.repeat(21 * 1024 * 1024)));
    const p = parseDrop('big.docx', big);
    expect(p.text).toBe('');
    expect(p.problems?.[0]).toMatch(/too big/);
  });
});
