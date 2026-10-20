import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve(__dirname, '..', 'vscode-helper');
const require = createRequire(import.meta.url);
const { handleRequest } = require(path.join(dir, 'lib.js')) as { handleRequest: (ctx: unknown, req: unknown, res: unknown) => Promise<void> };

describe('vscode helper package', () => {
  it('has the required manifest fields', () => {
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('cafe-ai-helper');
    expect(pkg.engines.vscode).toBe('^1.95.0');
    expect(pkg.activationEvents).toEqual(['onStartupFinished']);
    expect(pkg.main).toBe('./extension.js');
    expect(pkg.contributes.commands[0].command).toBe('cafe.aiHelper.status');
    expect(pkg.dependencies).toBeUndefined();
  });
  it('passes node --check', () => {
    for (const f of ['extension.js', 'lib.js']) execFileSync(process.execPath, ['--check', path.join(dir, f)]);
  });
});

describe('vscode helper request handling', () => {
  const TOKEN = 'a'.repeat(64);
  const model = { name: 'fake-model', vendor: 'fake', complete: async (p: string, _s?: AbortSignal) => `echo:${p}` };
  async function run(ctx: object, f: (base: string) => Promise<void>) {
    const s = http.createServer((q, r) => { void handleRequest({ token: TOKEN, reason: '', getModel: async () => model, ...ctx }, q, r); });
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    try { await f(`http://127.0.0.1:${(s.address() as AddressInfo).port}`); } finally { s.close(); }
  }
  const post = (base: string, body: string, headers: Record<string, string> = {}) =>
    fetch(`${base}/complete`, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-cafe-token': TOKEN, ...headers } });

  it('reports health with and without a model', async () => {
    await run({}, async (b) => { expect(await (await fetch(`${b}/health`)).json()).toEqual({ ok: true, model: 'fake-model', vendor: 'fake' }); });
    await run({ getModel: async () => null, reason: () => 'none' }, async (b) => {
      const res = await fetch(`${b}/health`);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, reason: 'none' });
    });
  });
  it('completes with a good token', () => run({}, async (b) => {
    const res = await post(b, JSON.stringify({ prompt: 'hi' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'echo:hi' });
  }));
  it('rejects a bad or missing token with 403', () => run({}, async (b) => {
    expect((await post(b, '{"prompt":"x"}', { 'x-cafe-token': 'nope' })).status).toBe(403);
    const res = await fetch(`${b}/complete`, { method: 'POST', body: '{"prompt":"x"}' });
    expect(res.status).toBe(403);
  }));
  it('rejects oversize bodies with 413 and bad JSON with 400', () => run({}, async (b) => {
    expect((await post(b, JSON.stringify({ prompt: 'x'.repeat(201 * 1024) }))).status).toBe(413);
    expect((await post(b, '{nope')).status).toBe(400);
    expect((await post(b, '{"prompt":5}')).status).toBe(400);
  }));
  it('404s other paths and 403s a foreign Host header', () => run({}, async (b) => {
    expect((await fetch(`${b}/other`)).status).toBe(404);
    const port = new URL(b).port;
    const status = await new Promise<number>((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port, path: '/health', headers: { host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode!); });
      r.on('error', reject); r.end();
    });
    expect(status).toBe(403);
  }));

  it('delivers 413 for a chunked body over the cap (no content-length)', () => run({}, async (b) => {
    const port = Number(new URL(b).port);
    const status = await new Promise<number>((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/complete', headers: { 'x-cafe-token': TOKEN, 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, (res) => { res.resume(); resolve(res.statusCode!); });
      r.on('error', reject);
      r.write('{"prompt":"');
      for (let i = 0; i < 30; i++) r.write('x'.repeat(10 * 1024));
      r.end('"}');
    });
    expect(status).toBe(413);
  }));
  it('cancels the model request when the client disconnects', async () => {
    let cancelled!: () => void;
    const seen = new Promise<void>((r) => { cancelled = r; });
    const slow = { name: 'slow', vendor: 'fake', complete: (_p: string, signal: AbortSignal) => new Promise<string>((resolve) => { signal.addEventListener('abort', () => { cancelled(); resolve(''); }); }) };
    await run({ getModel: async () => slow }, async (b) => {
      const req = http.request({ host: '127.0.0.1', port: Number(new URL(b).port), method: 'POST', path: '/complete', headers: { 'x-cafe-token': TOKEN, 'content-type': 'application/json' } });
      req.on('error', () => {});
      req.end('{"prompt":"y"}');
      await new Promise((r) => setTimeout(r, 150));
      req.destroy();
      await seen;
    });
  });
});
