import { spawn } from 'node:child_process';

/** The command that shows a folder in this computer's file manager: Finder, File Explorer, or the Linux desktop's. */
export function openerFor(platform: NodeJS.Platform): { cmd: string; args: (dir: string) => string[] } {
  if (platform === 'darwin') return { cmd: 'open', args: (d) => [d] };
  if (platform === 'win32') return { cmd: 'explorer.exe', args: (d) => [d] };
  return { cmd: 'xdg-open', args: (d) => [d] };
}

type Spawn = (cmd: string, args: string[], opts: { detached: boolean; stdio: 'ignore'; windowsHide: boolean }) => {
  once(ev: 'error', fn: (e: Error) => void): unknown; once(ev: 'spawn', fn: () => void): unknown; unref(): void;
};

/**
 * Opens the folder in the file manager. The path goes as one argument, never through a shell. The file manager
 * keeps running on its own (File Explorer even exits with 1 on success), so only a failure to start counts.
 */
export function openFolder(dir: string, platform: NodeJS.Platform = process.platform, run: Spawn = spawn as unknown as Spawn): Promise<void> {
  const { cmd, args } = openerFor(platform);
  return new Promise((resolve, reject) => {
    const child = run(cmd, args(dir), { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', (e) => reject(new Error(`Couldn't open the folder: ${e.message}`)));
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
