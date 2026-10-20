'use strict';
// Pure request handling for the helper. Does not import `vscode`, so it can be tested with a fake model.
const crypto = require('node:crypto');

const MAX_BODY = 200 * 1024;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function send(res, status, body, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
}

function sameToken(given, expected) {
  const a = crypto.createHash('sha256').update(String(given ?? '')).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function hostOk(header) {
  if (!header) return false;
  const host = String(header).toLowerCase().replace(/:\d+$/, '');
  return HOSTS.has(host);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (c) => {
      if (over) return; // keep draining so the client can still read our 413, but keep nothing
      size += c.length;
      if (size > MAX_BODY) { over = true; chunks.length = 0; reject(Object.assign(new Error('too big'), { status: 413 })); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function tooBig(req, res) {
  send(res, 413, { error: 'too big' }, { connection: 'close' });
  // Give the client a moment to read the answer, then drop the rest of the upload.
  const t = setTimeout(() => req.socket && req.socket.destroy(), 500);
  t.unref();
  res.on('close', () => clearTimeout(t));
}

/** ctx: { token, getModel(): Promise<{ name, vendor?, complete(prompt, signal): Promise<string> } | null>, reason?() } */
async function handleRequest(ctx, req, res) {
  try {
    if (!LOOPBACK.has(req.socket?.remoteAddress) || !hostOk(req.headers.host)) return send(res, 403, { error: 'forbidden' });
    const url = (req.url || '').split('?')[0];
    const model = await ctx.getModel();
    const reason = () => (typeof ctx.reason === 'function' ? ctx.reason() : ctx.reason) || 'no language model available';
    if (req.method === 'GET' && url === '/health') {
      return model ? send(res, 200, { ok: true, model: model.name, vendor: model.vendor }) : send(res, 503, { ok: false, reason: reason() });
    }
    if (req.method === 'POST' && url === '/complete') {
      if (!sameToken(req.headers['x-cafe-token'], ctx.token)) return send(res, 403, { error: 'bad token' });
      if (Number(req.headers['content-length']) > MAX_BODY) return tooBig(req, res);
      let prompt;
      try { prompt = JSON.parse(await readBody(req)).prompt; } catch (e) {
        if (e.status === 413) return tooBig(req, res);
        return send(res, 400, { error: 'bad json' });
      }
      if (typeof prompt !== 'string' || !prompt) return send(res, 400, { error: 'prompt must be a string' });
      if (!model) return send(res, 503, { error: reason() });
      // Cancel the model request if the client goes away before we answer.
      const ac = new AbortController();
      res.on('close', () => { if (!res.writableFinished) ac.abort(); });
      req.on('aborted', () => ac.abort());
      const text = await model.complete(prompt, ac.signal);
      if (ac.signal.aborted) return;
      return send(res, 200, { text });
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    if (!res.headersSent) send(res, 502, { error: String(e && e.message ? e.message : e) });
    else res.end();
  }
}

module.exports = { handleRequest, MAX_BODY };
