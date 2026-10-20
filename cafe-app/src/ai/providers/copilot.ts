import type { Provider } from '../connector';
import { onPath, runCli } from './cli';

/**
 * GitHub Copilot CLI in non-interactive mode (`-p`).
 *
 * SANDBOX NOT VERIFIED: the Copilot CLI was not installed on the machine this was
 * written on, so `copilot --help` could not be checked. The flags below are taken
 * from the Copilot CLI documentation and are UNVERIFIED:
 *   --deny-tool shell|write|read|view|fetch|url   deny every built-in tool we can name
 *   --disable-builtin-mcps                         no built-in MCP servers (GitHub MCP)
 * In `-p` mode a tool also needs --allow-tool / --allow-all-tools to run; we pass neither.
 * If any flag is wrong the CLI exits non-zero and the app falls back to working by hand.
 * Because of this, Copilot CLI is never chosen by 'auto': only when the settings pin it.
 */
export const DENIED_TOOLS = ['shell', 'write', 'read', 'view', 'fetch', 'url'];
export const copilotArgs = (prompt: string) => [
  '-p', prompt,
  ...DENIED_TOOLS.flatMap((t) => ['--deny-tool', t]),
  '--disable-builtin-mcps',
];
export const COPILOT_NOTE = 'Sandbox not yet verified on this machine';

export function copilotProvider(): Provider {
  return {
    id: 'copilot',
    label: 'Copilot CLI',
    pinOnly: true,
    note: COPILOT_NOTE,
    available: () => onPath('copilot'),
    complete: (prompt, { timeoutMs }) => runCli('copilot', copilotArgs(prompt), { timeoutMs }),
  };
}
