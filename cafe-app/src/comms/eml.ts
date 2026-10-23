/**
 * An email as an Outlook draft file: a .eml with X-Unsent: 1, which Outlook opens as a new message to edit
 * and send, rather than as a received one. Plain text, UTF-8, so any length and any character goes through.
 */
const encodeWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

/** "Avery Chen" or "[SUBMITTER]" goes in as a display name for Outlook to resolve; an address stays as it is. */
function toHeader(to: string): string {
  return oneLine(to).split(/\s*[;,]\s*/).filter(Boolean).map((t) => (t.includes('@') ? t : encodeWord(t))).join(', ');
}

export function toEml(view: { to: string; subject: string; body: string }): string {
  const body = Buffer.from(view.body.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return [
    'X-Unsent: 1',
    `To: ${toHeader(view.to)}`,
    `Subject: ${encodeWord(oneLine(view.subject))}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
    '',
  ].join('\r\n');
}

/** A safe file name for the download: the template and the subject. */
export function emlName(template: string, subject: string): string {
  const s = oneLine(subject).replace(/[^\p{L}\p{N} _-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `${template}${s ? ` - ${s}` : ''}.eml`;
}
