import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Provider } from '../connector';
import { AiError } from '../schema';

export const HELPER_FILE = path.join(os.homedir(), '.cafe-ai', 'vscode-helper.json');

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
        return res.ok;
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
      const body = (await res.json().catch(() => null)) as { text?: unknown } | null;
      if (typeof body?.text !== 'string') throw new AiError('the VS Code helper sent no text');
      return body.text;
    },
  };
}
