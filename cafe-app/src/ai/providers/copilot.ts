import type { Provider } from '../connector';
import { onPath, runCli } from './cli';

/**
 * GitHub Copilot CLI in non-interactive mode. Verified with Copilot CLI 1.0.100.
 *
 * - The prompt goes on stdin (`-p -` is rejected by the CLI), never on the command line.
 * - `-s` prints only the answer; `--no-ask-user` stops it asking questions; `--disable-builtin-mcps` removes the GitHub MCP server.
 * - Sandbox: `--available-tools` with no value is IGNORED (every tool stays on), and with a made-up tool name the model
 *   writes fake tool calls as its answer. What works is `--excluded-tools` naming every built-in tool: asked to run `ls`,
 *   read /etc/hosts, read a file in the cwd or fetch a URL, the model says it has no way to. `--deny-tool` is added as a second lock.
 *   If a future CLI adds a tool that is not in EXCLUDED_TOOLS it would be available, so re-check on a CLI upgrade.
 * - cwd is a fresh empty temp folder and the environment has no CAFE_* variables (see runCli).
 * - `CAFE_COPILOT_BIN` (path to the binary) is used when `copilot` is not on PATH; handy for tests and odd installs.
 */
export const EXCLUDED_TOOLS = [
  'bash', 'read_bash', 'stop_bash', 'list_bash', 'view', 'web_fetch', 'fetch_copilot_cli_documentation',
  'search_code_subagent', 'semantic_code_search', 'skill', 'run_dynamic_workflow', 'dynamic_workflows_manage',
  'sql', 'session_store_sql', 'task', 'read_agent', 'list_agents', 'write_agent', 'rg', 'glob', 'apply_patch', 'multi_tool_use.parallel',
];
export const DENIED_TOOLS = ['shell', 'write', 'url', 'memory'];
export const COPILOT_ARGS = [
  '-s', '--output-format', 'text', '--no-ask-user', '--disable-builtin-mcps',
  `--excluded-tools=${EXCLUDED_TOOLS.join(',')}`,
  ...DENIED_TOOLS.map((t) => `--deny-tool=${t}`),
];
export const COPILOT_NOTE = 'Verified with Copilot CLI 1.0.100';

const bin = () => process.env.CAFE_COPILOT_BIN?.trim() || 'copilot';

export function copilotProvider(): Provider {
  return {
    id: 'copilot',
    label: 'Copilot CLI',
    note: COPILOT_NOTE,
    available: async () => (process.env.CAFE_COPILOT_BIN?.trim() ? true : onPath('copilot')),
    complete: (prompt, { timeoutMs }) => runCli(bin(), COPILOT_ARGS, { stdin: prompt, timeoutMs }),
  };
}
