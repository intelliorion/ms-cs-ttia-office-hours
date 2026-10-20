'use strict';
// Exposes the user's Copilot model to the local Café app. Never reads workspace files or runs commands.
const vscode = require('vscode');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { handleRequest } = require('./lib');

const DIR = path.join(os.homedir(), '.cafe-ai');
const FILE = path.join(DIR, 'vscode-helper.json');

let server = null;
let myToken = '';
let state = { port: 0, model: null, reason: '' };
const inflight = new Set();

// Only remove the helper file if it still holds this window's token (another window may have rewritten it).
function removeFile() {
  try {
    if (JSON.parse(fs.readFileSync(FILE, 'utf8')).token === myToken) fs.rmSync(FILE, { force: true });
  } catch { /* gone or not ours */ }
}

async function pickModel() {
  let models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  if (!models.length) models = await vscode.lm.selectChatModels();
  return models[0] || null;
}

async function activate(context) {
  let model = await pickModel().catch(() => null);
  const reason = () => 'no language model available (sign in to GitHub Copilot in VS Code)';
  console.log(model ? `Café AI helper: using ${model.name}` : `Café AI helper: ${reason()}`);
  myToken = crypto.randomBytes(32).toString('hex');
  const ctx = {
    token: myToken,
    reason,
    async getModel() {
      if (!model) { model = await pickModel().catch(() => null); if (model) state.model = model.name || model.id; }
      const m = model;
      return m && {
        name: m.name || m.id,
        vendor: m.vendor,
        async complete(prompt, signal) {
          const cts = new vscode.CancellationTokenSource();
          inflight.add(cts);
          const onAbort = () => cts.cancel();
          if (signal) { if (signal.aborted) cts.cancel(); else signal.addEventListener('abort', onAbort); }
          try {
            const res = await m.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, cts.token);
            let text = '';
            for await (const part of res.text) text += part;
            return text;
          } finally { inflight.delete(cts); if (signal) signal.removeEventListener('abort', onAbort); cts.dispose(); }
        },
      };
    },
  };
  server = http.createServer((req, res) => { handleRequest(ctx, req, res); });
  server.on('close', removeFile);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  state = { port: server.address().port, model: model ? model.name || model.id : null };
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(DIR, 0o700);
  fs.writeFileSync(FILE, JSON.stringify({ port: state.port, token: myToken, model: state.model }), { mode: 0o600 });
  fs.chmodSync(FILE, 0o600);

  context.subscriptions.push(
    vscode.commands.registerCommand('cafe.aiHelper.status', () => {
      vscode.window.showInformationMessage(
        `Café AI helper: port ${state.port}, model ${state.model || 'none (' + reason() + ')'}, helper file ${fs.existsSync(FILE) ? 'present' : 'missing'} (${FILE})`);
    }),
    { dispose: deactivate },
  );
}

function deactivate() {
  for (const cts of inflight) cts.cancel();
  inflight.clear();
  removeFile();
  if (server) { server.close(); server = null; }
}

module.exports = { activate, deactivate };
