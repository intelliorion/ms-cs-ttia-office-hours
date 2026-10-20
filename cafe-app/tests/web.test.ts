import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './helpers';

let close: (() => void) | undefined;
afterEach(() => close?.());

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');

// A raw socket request: the path goes out exactly as written, with no URL normalisation.
function rawGet(base: string, p: string): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path: p, method: 'GET' }, (r) => {
      r.resume();
      resolve({ status: r.statusCode ?? 0, headers: r.headers });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('web page', () => {
  it('serves the built page, never cached', async () => {
    const s = await startServer();
    close = () => s.server.close();
    const res = await fetch(`${s.base}/`);
    const html = await res.text();
    expect(html).toContain('<div id="root">');
    expect(html).toMatch(/<script type="module"[^>]* src="\/assets\//);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('serves hashed assets as immutable', async () => {
    const s = await startServer();
    close = () => s.server.close();
    const js = fs.readdirSync(path.join(WEB, 'assets')).find((f) => f.endsWith('.js'))!;
    const res = await fetch(`${s.base}/assets/${js}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(res.headers.get('content-type')).toContain('text/javascript');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('serves assets only from the build folder', async () => {
    const s = await startServer();
    close = () => s.server.close();
    for (const p of ['/assets/..%2f..%2fpackage.json', '/assets/%2e%2e/%2e%2e/package.json', '/assets/../package.json', '/assets/..%2f..%2fsrc%2fserver%2fserver.ts']) {
      expect((await rawGet(s.base, p)).status, p).not.toBe(200);
    }
    expect((await fetch(`${s.base}/assets/nope.js`)).status).toBe(404);
  });

  it('refuses file types the build never produces', async () => {
    const s = await startServer();
    close = () => s.server.close();
    expect((await rawGet(s.base, '/assets/x.html')).status).toBe(404);
    expect((await rawGet(s.base, '/index.html')).status).toBe(404);
  });
});
