'use strict';
// Runs inside a real VS Code extension host (npm run test:vscode).
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vscode = require('vscode');

const DIR = process.env.CAFE_AI_HELPER_DIR;
const FILE = DIR && path.join(DIR, 'vscode-helper.json');

function call(port, method, urlPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { let json = null; try { json = JSON.parse(data); } catch { /* not json */ } resolve({ status: res.statusCode, json, data }); });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
const waitFor = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return fn(); };

suite('Café AI helper in a real extension host', () => {
  let info;
  const ext = () => vscode.extensions.getExtension('cafe-local.cafe-ai-helper');

  suiteSetup(() => assert.ok(DIR, 'CAFE_AI_HELPER_DIR must be set (use npm run test:vscode)'));

  test('activates and writes the helper file in the temp dir', async () => {
    assert.ok(ext(), 'extension is registered');
    await ext().activate();
    assert.strictEqual(ext().isActive, true);
    assert.ok(await waitFor(() => fs.existsSync(FILE), 10000), 'helper file appears');
    info = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    assert.ok(Number.isInteger(info.port) && info.port > 0);
    assert.match(info.token, /^[0-9a-f]{64}$/);
    assert.ok('model' in info);
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(FILE).mode & 0o777, 0o600);
  });

  test('GET /health reflects model availability', async () => {
    const r = await call(info.port, 'GET', '/health');
    if (info.model) { assert.strictEqual(r.status, 200); assert.strictEqual(r.json.ok, true); }
    else { assert.strictEqual(r.status, 503); assert.strictEqual(r.json.ok, false); assert.ok(r.json.reason); }
  });

  const post = (headers) => call(info.port, 'POST', '/complete', { headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ prompt: 'hi' }) });

  test('POST /complete with a wrong token is 403', async () => {
    assert.strictEqual((await post({ 'x-cafe-token': 'nope' })).status, 403);
  });

  test('POST /complete with the right token and no model is 503', async function () {
    if (info.model) return this.skip();
    assert.strictEqual((await post({ 'x-cafe-token': info.token })).status, 503);
  });

  test('a foreign Host header is 403', async () => {
    assert.strictEqual((await post({ 'x-cafe-token': info.token, host: 'evil.example.com' })).status, 403);
  });

  test('status command runs', async () => {
    await vscode.commands.executeCommand('cafe.aiHelper.status');
  });

  test('deactivate removes the helper file and stops the server', async () => {
    require('../extension.js').deactivate(); // same module instance the host loaded
    assert.ok(await waitFor(() => !fs.existsSync(FILE), 5000), 'helper file removed');
    await assert.rejects(call(info.port, 'GET', '/health'));
  });
});
