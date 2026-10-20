'use strict';
// Pure request handling for the helper. Does not import `vscode`, so it can be tested with a fake model.
const crypto = require('node:crypto');

const MAX_BODY = 200 * 1024;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
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
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('too big'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** ctx: { token, getModel(): { name, complete(prompt): Promise<string> } | null, reason? } */
async function handleRequest(ctx, req, res) {
  try {
    if (!LOOPBACK.has(req.socket?.remoteAddress) || !hostOk(req.headers.host)) return send(res, 403, { error: 'forbidden' });
    const url = (req.url || '').split('?')[0];
    const model = ctx.getModel();
    if (req.method === 'GET' && url === '/health') {
      return send(res, 200, model ? { ok: true, model: model.name } : { ok: false, reason: ctx.reason || 'no language model available' });
    }
    if (req.method === 'POST' && url === '/complete') {
      if (!sameToken(req.headers['x-cafe-token'], ctx.token)) return send(res, 403, { error: 'bad token' });
      if (Number(req.headers['content-length']) > MAX_BODY) return send(res, 413, { error: 'too big' });
      let prompt;
      try { prompt = JSON.parse(await readBody(req)).prompt; } catch (e) {
        if (e.status === 413) return send(res, 413, { error: 'too big' });
        return send(res, 400, { error: 'bad json' });
      }
      if (typeof prompt !== 'string' || !prompt) return send(res, 400, { error: 'prompt must be a string' });
      if (!model) return send(res, 503, { error: ctx.reason || 'no language model available' });
      return send(res, 200, { text: await model.complete(prompt) });
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    if (!res.headersSent) send(res, 502, { error: String(e && e.message ? e.message : e) });
    else res.end();
  }
}

module.exports = { handleRequest, MAX_BODY };
