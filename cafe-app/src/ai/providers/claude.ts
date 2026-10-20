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

export function claudeProvider(): Provider {
  return {
    id: 'claude',
    label: 'Claude Code',
    available: () => onPath('claude'),
    complete: (prompt, { timeoutMs }) => runCli('claude', CLAUDE_ARGS, { stdin: prompt, timeoutMs }),
  };
}
