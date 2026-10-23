/**
 * A reply that is a file rather than JSON: the roadshow's deck, script and photos, opened in a tab or downloaded.
 * Never cached; an HTML file gets a policy that lets it load nothing from anywhere (it carries its own CSS, script and
 * pictures), and any other file a policy that lets it run nothing.
 */
export class FileReply {
  constructor(readonly body: Buffer | Uint8Array | string, readonly type: string, readonly download?: string) {}
}
export const FILE_CSP = {
  html: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
  other: "default-src 'none'; img-src data: 'self'; style-src 'unsafe-inline'; sandbox",
};
