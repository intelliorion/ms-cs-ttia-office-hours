import type { Provider } from '../connector';
import { onPath, runCli } from './cli';

/**
 * GitHub Copilot CLI in non-interactive mode (`-p`). In that mode a tool needs
 * --allow-tool / --allow-all-tools to run; we pass neither and deny shell and
 * write explicitly, so the model has no shell or file access.
 * Not verified locally: the Copilot CLI was not installed when this was written.
 */
export const copilotArgs = (prompt: string) => ['-p', prompt, '--deny-tool', 'shell', '--deny-tool', 'write'];

export function copilotProvider(): Provider {
  return {
    id: 'copilot',
    label: 'Copilot CLI',
    available: () => onPath('copilot'),
    complete: (prompt, { timeoutMs }) => runCli('copilot', copilotArgs(prompt), { timeoutMs }),
  };
}
