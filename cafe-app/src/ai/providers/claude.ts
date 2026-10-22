import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Provider } from '../connector';
import { onPath, runCli } from './cli';

/**
 * Claude Code in headless mode. Verified against Claude Code 2.1.301:
 * `--tools ""` disables every built-in tool (no shell, file or web access),
 * `--strict-mcp-config` with no --mcp-config loads no MCP servers,
 * `--no-session-persistence` keeps the submission text out of saved sessions.
 * The prompt goes on stdin, never on the command line. cwd is a fresh empty temp folder.
 */
export const CLAUDE_ARGS = ['-p', '--output-format', 'text', '--tools', '', '--max-turns', '1', '--strict-mcp-config', '--no-session-persistence'];

/**
 * Reading one picture (verified on Claude Code 2.1.304 with a PNG): only the Read tool, allowed on that one file,
 * which sits alone in a fresh temp folder that is the working directory. Nothing else is reachable.
 */
export const lookArgs = (name: string) => ['-p', '--output-format', 'text', '--tools', 'Read', '--allowedTools', `Read(./${name})`, '--max-turns', '3', '--strict-mcp-config', '--no-session-persistence'];

export function claudeProvider(): Provider {
  return {
    id: 'claude',
    label: 'Claude Code',
    available: () => onPath('claude'),
    complete: (prompt, { timeoutMs }) => runCli('claude', CLAUDE_ARGS, { stdin: prompt, timeoutMs }),
    async look(file, prompt, { timeoutMs }) {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cafe-look-'));
      try {
        const name = path.basename(file);
        await fs.copyFile(file, path.join(dir, name));
        return await runCli('claude', lookArgs(name), { stdin: prompt, timeoutMs, cwd: dir });
      } finally {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}
