import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Provider } from '../connector';
import { AiError } from '../schema';

export const MAX_REPLY = 256 * 1024;
export const HELPER_FILE = path.join(os.homedir(), '.cafe-ai', 'vscode-helper.json');

/** Reads the response body as text, giving up (and cancelling) past `max` bytes. */
async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => undefined); throw new AiError(`the VS Code helper replied with more than ${Math.round(max / 1024)} KB`); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

interface HelperConfig { port: number; token: string; model?: string }

async function readConfig(file: string): Promise<HelperConfig | null> {
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<HelperConfig>;
    const port = Number(raw.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    if (typeof raw.token !== 'string' || raw.token.length < 16) return null;
    return { port, token: raw.token, model: typeof raw.model === 'string' ? raw.model : undefined };
  } catch { return null; }
}

/** The VS Code helper extension: one localhost endpoint, protected by the token it wrote to the helper file. */
export function vscodeProvider({ configPath = HELPER_FILE }: { configPath?: string } = {}): Provider {
  return {
    id: 'vscode',
    label: 'Copilot (VS Code)',
    async available() {
      const cfg = await readConfig(configPath);
      if (!cfg) return false;
      try {
        const res = await fetch(`http://127.0.0.1:${cfg.port}/health`, { headers: { 'x-cafe-token': cfg.token }, signal: AbortSignal.timeout(1500) });
        if (!res.ok) return false;
        // The helper answers 200 { ok: false, reason } when VS Code has no language model.
        const body = JSON.parse(await readCapped(res, 4096)) as { ok?: unknown };
        return body?.ok === true;
      } catch { return false; }
    },
    async complete(prompt, { timeoutMs }) {
      const cfg = await readConfig(configPath);
      if (!cfg) throw new AiError('the VS Code helper is not running');
      let res: Response;
      try {
        res = await fetch(`http://127.0.0.1:${cfg.port}/complete`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-cafe-token': cfg.token },
          body: JSON.stringify({ prompt, model: cfg.model }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        throw new AiError(`the VS Code helper did not answer: ${(e as Error).message}`);
      }
      if (!res.ok) throw new AiError(`the VS Code helper said ${res.status}`);
      const raw = await readCapped(res, MAX_REPLY);
      let body: { text?: unknown } | null = null;
      try { body = JSON.parse(raw) as { text?: unknown } | null; } catch { /* handled below */ }
      if (typeof body?.text !== 'string') throw new AiError('the VS Code helper sent no text');
      return body.text;
    },
  };
}
