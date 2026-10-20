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
let state = { port: 0, model: null, reason: '' };

function removeFile() { try { fs.rmSync(FILE, { force: true }); } catch { /* already gone */ } }

async function pickModel() {
  let models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  if (!models.length) models = await vscode.lm.selectChatModels();
  return models[0] || null;
}

async function activate(context) {
  const model = await pickModel().catch(() => null);
  const reason = model ? '' : 'no language model available (sign in to GitHub Copilot in VS Code)';
  console.log(model ? `Café AI helper: using ${model.name}` : `Café AI helper: ${reason}`);
  const token = crypto.randomBytes(32).toString('hex');
  const ctx = {
    token,
    reason,
    getModel: () => model && {
      name: model.name || model.id,
      async complete(prompt) {
        const cts = new vscode.CancellationTokenSource();
        try {
          const res = await model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, cts.token);
          let text = '';
          for await (const part of res.text) text += part;
          return text;
        } finally { cts.dispose(); }
      },
    },
  };
  server = http.createServer((req, res) => { handleRequest(ctx, req, res); });
  server.on('close', removeFile);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  state = { port: server.address().port, model: model ? model.name || model.id : null, reason };
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(FILE, JSON.stringify({ port: state.port, token, model: state.model }), { mode: 0o600 });
  fs.chmodSync(FILE, 0o600);

  context.subscriptions.push(
    vscode.commands.registerCommand('cafe.aiHelper.status', () => {
      vscode.window.showInformationMessage(
        `Café AI helper: port ${state.port}, model ${state.model || 'none (' + state.reason + ')'}, helper file ${fs.existsSync(FILE) ? 'present' : 'missing'} (${FILE})`);
    }),
    { dispose: deactivate },
  );
}

function deactivate() {
  removeFile();
  if (server) { server.close(); server = null; }
}

module.exports = { activate, deactivate };
