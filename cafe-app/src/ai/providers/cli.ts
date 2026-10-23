import { spawn, execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AiError } from '../schema';

const MAX_OUT = 1024 * 1024;

/** The environment for a provider process: the operator's, minus every CAFE_* variable. */
export function scrubbedEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !k.toUpperCase().startsWith('CAFE_')));
}

/** True when the command is on PATH. */
export function onPath(cmd: string): Promise<boolean> {
  const which = process.platform === 'win32' ? 'where' : 'which';
  return new Promise((resolve) => {
    execFile(which, [cmd], { timeout: 3000, env: scrubbedEnv() }, (err, out) => resolve(!err && String(out).trim() !== ''));
  });
}

/**
 * Runs a CLI in a fresh empty temp folder (removed afterwards), with no shell, a scrubbed environment and a hard timeout.
 * opts.cwd: run there instead; the caller made that folder and removes it.
 */
export async function runCli(cmd: string, args: string[], opts: { stdin?: string; timeoutMs: number; cwd?: string }): Promise<string> {
  if (opts.cwd) return spawnIn(opts.cwd, cmd, args, opts);
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cafe-ai-'));
  try {
    return await spawnIn(cwd, cmd, args, opts);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true }).catch(() => undefined);
  }
}

function spawnIn(cwd: string, cmd: string, args: string[], { stdin, timeoutMs }: { stdin?: string; timeoutMs: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: scrubbedEnv(), stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true });
    let out = ''; let err = ''; let done = false;
    const finish = (fn: () => void) => { if (!done) { done = true; clearTimeout(timer); fn(); } };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(() => reject(new AiError(`${cmd} timed out after ${Math.round(timeoutMs / 1000)} s`))); }, timeoutMs);
    child.stdout.on('data', (c: Buffer) => { out += c.toString('utf8'); if (out.length > MAX_OUT) { child.kill('SIGKILL'); finish(() => reject(new AiError(`${cmd} replied with too much text`))); } });
    child.stderr.on('data', (c: Buffer) => { if (err.length < 4000) err += c.toString('utf8'); });
    child.on('error', (e) => finish(() => reject(new AiError(`${cmd} could not start: ${e.message}`))));
    // A CLI that says why it stopped on stdout only (Claude Code's "You've hit your session limit · resets 4:40pm")
    // gets that line in the error, so the notice says why instead of ending at "exit 1:".
    child.on('close', (code) => finish(() => (code === 0 ? resolve(out) : reject(new AiError(`${cmd} stopped (exit ${code}): ${(err.trim() || out.trim().split('\n')[0] || '').slice(0, 200)}`)))));
    child.stdin.on('error', () => undefined);
    child.stdin.end(stdin ?? '');
  });
}
