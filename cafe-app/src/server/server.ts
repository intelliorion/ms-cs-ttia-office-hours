import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Clock } from '../clock';
import { APP_DIR } from '../workspace/paths';
import { MissingSettingsError } from '../comms/outbox';
import { registerApi } from './api';

export interface ServerOptions {
  root: string;
  clock: Clock;
}

export interface RequestInfo {
  body: Record<string, unknown>;
  raw: Buffer;
  params: Record<string, string>;
  headers: http.IncomingHttpHeaders;
}

export type Handler = (req: RequestInfo) => Promise<unknown>;
export type AddRoute = (method: 'GET' | 'POST', route: string, handler: Handler) => void;

const STATIC: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
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

export function createApp({ root, clock }: ServerOptions): http.Server {
  const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler }[] = [];
  const add: AddRoute = (method, route, handler) => {
    const keys: string[] = [];
    const pattern = new RegExp(`^${route.replace(/:(\w+)/g, (_m, k: string) => { keys.push(k); return '([^/]+)'; })}$`);
    routes.push({ method, pattern, keys, handler });
  };
  registerApi(add, { root, clock });
  // Every POST waits for the one before it, so two clicks cannot interleave their file writes.
  let lock: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = lock.then(fn, fn);
    lock = run.catch(() => undefined);
    return run;
  };

  return http.createServer(async (req, res) => {
    try {
      const origin = req.headers.origin;
      if (!LOCAL_HOST.test(req.headers.host ?? '') || (origin !== undefined && !LOCAL_ORIGIN.test(origin))) return send(res, 403, { error: 'This app only answers on localhost' });
      const url = new URL(req.url ?? '/', 'http://localhost');
      const asset = STATIC[url.pathname];
      if (req.method === 'GET' && asset) {
        res.writeHead(200, { 'content-type': asset[1], 'cache-control': 'no-store' });
        res.end(await fs.readFile(path.join(APP_DIR, 'web', asset[0])));
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
      const call = () => route.handler({ body, raw, params, headers: req.headers });
      return send(res, 200, await (req.method === 'POST' ? exclusive(call) : call()));
    } catch (e) {
      const err = e as Error;
      return send(res, 400, { error: err.message, ...(err instanceof MissingSettingsError ? { missing: err.labels } : {}) });
    }
  });
}
