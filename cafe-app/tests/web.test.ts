import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { startServer } from './helpers';

let close: (() => void) | undefined;
afterEach(() => close?.());

function rawGet(base: string, p: string): Promise<number> {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    http.get({ host: u.hostname, port: u.port, path: p }, (r) => { r.resume(); resolve(r.statusCode ?? 0); }).on('error', reject);
  });
}

describe('web page', () => {
  it('serves the built page', async () => {
    const s = await startServer();
    close = () => s.server.close();
    const html = await (await fetch(`${s.base}/`)).text();
    expect(html).toContain('<div id="root">');
    expect(html).toMatch(/<script type="module"[^>]* src="\/assets\//);
  });

  it('serves assets only from the build folder', async () => {
    const s = await startServer();
    close = () => s.server.close();
    expect(await rawGet(s.base, '/assets/../package.json')).not.toBe(200);
    expect(await rawGet(s.base, '/assets/%2e%2e/package.json')).not.toBe(200);
    expect((await fetch(`${s.base}/assets/nope.js`)).status).toBe(404);
  });
});
