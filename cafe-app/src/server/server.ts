import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Clock } from '../clock';
import { APP_DIR } from '../workspace/paths';
import { MissingSettingsError } from '../comms/outbox';
import { DesignNotReadyError } from '../design/brainstorm';
import { registerApi } from './api';
import { FileReply, FILE_CSP } from './fileReply';

export { FileReply };
import type { Connector } from '../ai/connector';

export interface ServerOptions {
  root: string;
  clock: Clock;
  /** The AI connector. Tests inject one; otherwise it is built from the settings and the installed tools. */
  connector?: Connector;
  /** Deep read upkeep's quiet time and cap (ms); the tests shorten them. */
  upkeep?: { quietMs?: number; maxMs?: number };
}

export interface RequestInfo {
  body: Record<string, unknown>;
  raw: Buffer;
  params: Record<string, string>;
  /** The URL's query (?download=1). */
  query?: Record<string, string>;
  headers: http.IncomingHttpHeaders;
  /** Present when the client asked for progress (Accept: application/x-ndjson): each call sends one line before the result. */
  progress?: (event: unknown) => void;
  /** True once the client has gone (it pressed Stop or closed the page). */
  stopped?: () => boolean;
}

export type Handler = (req: RequestInfo) => Promise<unknown>;

function sendFile(res: http.ServerResponse, f: FileReply): void {
  const ascii = (f.download ?? '').replace(/[^\w .()-]/g, '_');
  res.writeHead(200, {
    'content-type': f.type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'content-security-policy': f.type.startsWith('text/html') ? FILE_CSP.html : FILE_CSP.other,
    ...(f.download ? { 'content-disposition': `attachment; filename="${ascii}"` } : {}),
  });
  res.end(f.body);
}
export type AddRoute = (method: 'GET' | 'POST', route: string, handler: Handler) => void;

const WEB_DIR = path.join(APP_DIR, 'web');
const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const MAX_BODY = 20 * 1024 * 1024;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

function send(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('That file is too large (limit 20 MB)'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function createApp({ root, clock, connector, upkeep }: ServerOptions): http.Server {
  const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler }[] = [];
  const add: AddRoute = (method, route, handler) => {
    const keys: string[] = [];
    const pattern = new RegExp(`^${route.replace(/:(\w+)/g, (_m, k: string) => { keys.push(k); return '([^/]+)'; })}$`);
    routes.push({ method, pattern, keys, handler });
  };
  const hooks = registerApi(add, { root, clock, connector, upkeep });
  // Every POST waits for the one before it, so two clicks cannot interleave their file writes.
  let lock: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = lock.then(fn, fn);
    lock = run.catch(() => undefined);
    return run;
  };

  const server = http.createServer(async (req, res) => {
    try {
      const origin = req.headers.origin;
      if (!LOCAL_HOST.test(req.headers.host ?? '') || (origin !== undefined && !LOCAL_ORIGIN.test(origin))) return send(res, 403, { error: 'This app only answers on localhost' });
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        res.end(await fs.readFile(path.join(WEB_DIR, 'index.html')));
        return;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
        const file = path.resolve(WEB_DIR, '.' + decodeURIComponent(url.pathname));
        const type = TYPES[path.extname(file).toLowerCase()];
        const body = type && file.startsWith(WEB_DIR + path.sep) ? await fs.readFile(file).catch(() => null) : null;
        if (!body || !type) return send(res, 404, { error: 'Not found' });
        res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
        res.end(body);
        return;
      }
      const route = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
      if (!route) return send(res, 404, { error: 'Not found' });
      const media = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      const isJson = media === 'application/json';
      if (req.method === 'POST' && !isJson && !req.headers['x-filename']) {
        return send(res, 415, { error: 'Send JSON' });
      }
      const m = route.pattern.exec(url.pathname)!;
      const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const raw = await readBody(req);
      const body = isJson && raw.length
        ? (JSON.parse(raw.toString('utf8')) as Record<string, unknown>)
        : {};
      // Streaming: progress lines as the work goes, then the result as the last line. Opt-in, so every other caller is unchanged.
      if (String(req.headers.accept ?? '').includes('application/x-ndjson')) {
        let gone = false;
        res.on('close', () => { if (!res.writableEnded) gone = true; });
        res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        const line = (v: unknown) => { if (!gone) res.write(JSON.stringify(v) + '\n'); };
        const call = () => route.handler({ body, raw, params, query: Object.fromEntries(url.searchParams), headers: req.headers, progress: (e) => line({ type: 'progress', ...(e as object) }), stopped: () => gone });
        try { line({ type: 'done', data: await (req.method === 'POST' ? exclusive(call) : call()) }); }
        catch (e) { line({ type: 'error', error: (e as Error).message }); }
        return res.end();
      }
      const call = () => route.handler({ body, raw, params, query: Object.fromEntries(url.searchParams), headers: req.headers });
      const out = await (req.method === 'POST' ? exclusive(call) : call());
      return out instanceof FileReply ? sendFile(res, out) : send(res, 200, out);
    } catch (e) {
      const err = e as Error;
      return send(res, 400, { error: err.message, ...(err instanceof MissingSettingsError ? { missing: err.labels } : err instanceof DesignNotReadyError ? { missing: err.missing } : {}) });
    }
  });
  // Deep read's start-up read waits until the server is listening, so start-up never waits on it.
  server.once('listening', () => hooks.listening());
  server.once('close', () => hooks.close());
  return server;
}
