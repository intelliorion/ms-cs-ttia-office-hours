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

type SpawnWithExit = (cmd: string, args: string[], opts: { detached: boolean; stdio: 'ignore'; windowsHide: boolean }) => {
  once(ev: 'error', fn: (e: Error) => void): unknown; once(ev: 'exit', fn: (code: number | null) => void): unknown; unref(): void;
};

/** Runs `open` on a Mac and waits for its answer: it exits 0 once the app has the file, 1 when it can't. */
function openOnMac(args: string[], run: SpawnWithExit): Promise<boolean> {
  return new Promise((resolve) => {
    const child = run('open', args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', () => resolve(false));
    child.once('exit', (code) => resolve(code === 0));
  });
}

/**
 * Opens an Outlook draft file (.eml marked unsent) in Outlook, so a new message shows ready to check and send.
 * On a Mac, Outlook by name (the default mail app may be Apple Mail), else whatever opens .eml files; on Windows and
 * Linux, the app the computer opens .eml files with. The path goes as one argument, never through a shell.
 */
export async function openEmailFile(
  file: string, platform: NodeJS.Platform = process.platform,
  run: SpawnWithExit = spawn as unknown as SpawnWithExit, runDetached: Spawn = spawn as unknown as Spawn,
): Promise<void> {
  if (platform === 'darwin') {
    if (await openOnMac(['-a', 'Microsoft Outlook', file], run) || await openOnMac([file], run)) return;
    throw new Error("Couldn't open the email in Outlook. Is Outlook installed?");
  }
  try { await openFolder(file, platform, runDetached); } catch { throw new Error("Couldn't open the email in Outlook. Is Outlook installed?"); }
}
