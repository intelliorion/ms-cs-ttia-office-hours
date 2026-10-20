import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './helpers';

let close: (() => void) | undefined;
afterEach(() => close?.());

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');

// A raw socket request: the path goes out exactly as written. The server runs it through new URL(),
// which collapses literal /../ and /%2e%2e/ segments, so the traversal targets below use encoded slashes (%2f).
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

function rawGetBody(base: string, p: string): Promise<{ status: number; body: string }> {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path: p, method: 'GET' }, (r) => {
      let body = '';
      r.on('data', (c) => (body += c));
      r.on('end', () => resolve({ status: r.statusCode ?? 0, body }));
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
    // Real files outside web/ with an allowed extension, so only the folder guard can stop them.
    const targets: [string, string][] = [
      ['/assets/..%2f..%2fvscode-helper%2fextension.js', 'vscode-helper/extension.js'],
      ['/assets/%2e%2e%2f%2e%2e%2fvscode-helper%2flib.js', 'vscode-helper/lib.js'],
    ];
    for (const [p, rel] of targets) {
      const file = path.resolve(WEB, '..', rel);
      expect(fs.existsSync(file), rel).toBe(true);
      const r = await rawGetBody(s.base, p);
      expect(r.status, p).not.toBe(200);
      expect(r.body, p).not.toBe(fs.readFileSync(file, 'utf8'));
    }
    expect((await fetch(`${s.base}/assets/nope.js`)).status).toBe(404);
  });

  it('refuses file types the build never produces', async () => {
    const s = await startServer();
    close = () => s.server.close();
    // index.html really exists under web/, so only the extension list refuses it.
    expect((await rawGet(s.base, '/assets/..%2findex.html')).status).toBe(404);
  });

  it('has no route at /index.html', async () => {
    const s = await startServer();
    close = () => s.server.close();
    expect((await rawGet(s.base, '/index.html')).status).toBe(404);
  });
});
