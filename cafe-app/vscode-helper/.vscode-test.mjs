import { defineConfig } from '@vscode/test-cli';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The cache and helper folders: CAFE_VSCODE_TEST_DIR when set, else the system temp folder (never a path on one machine).
const base = process.env.CAFE_VSCODE_TEST_DIR || path.join(os.tmpdir(), 'cafe-vscode-test');
fs.mkdirSync(base, { recursive: true });

// The test host gets its own helper folder, user-data and extensions dirs; the real ~/.cafe-ai and your VS Code are never touched.
process.env.CAFE_AI_HELPER_DIR = fs.mkdtempSync(path.join(base, 'helper-'));

// Download (or reuse) stable VS Code into the cache dir, never into a real install.
const vscodeExecutablePath = await downloadAndUnzipVSCode({ version: 'stable', cachePath: path.join(base, 'cache') });
// macOS unix sockets need a short path (<103 chars), so the user-data dir lives under a short temp path.
const short = fs.mkdtempSync(path.join('/tmp', 'cvh-'));

export default defineConfig({
  files: 'test/**/*.test.js',
  useInstallation: { fromPath: vscodeExecutablePath },
  installExtensions: [],
  launchArgs: [
    '--disable-gpu',
    '--disable-extensions',
    '--user-data-dir=' + path.join(short, 'ud'),
    '--extensions-dir=' + path.join(short, 'ext'),
  ],
  mocha: { ui: 'tdd', timeout: 30000 },
});
