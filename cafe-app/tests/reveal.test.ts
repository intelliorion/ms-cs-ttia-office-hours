import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { openerFor, openFolder } from '../src/workspace/reveal';

function fakeSpawn(outcome: 'spawn' | 'error') {
  const calls: { cmd: string; args: string[]; opts: unknown }[] = [];
  let unref = false;
  const run = (cmd: string, args: string[], opts: any) => {
    calls.push({ cmd, args, opts });
    const child = Object.assign(new EventEmitter(), { unref: () => { unref = true; } });
    queueMicrotask(() => (outcome === 'spawn' ? child.emit('spawn') : child.emit('error', new Error('spawn xdg-open ENOENT'))));
    return child;
  };
  return { run: run as any, calls, unrefd: () => unref };
}

describe('opening the data folder', () => {
  it("uses Finder, File Explorer or the desktop's opener", () => {
    expect(openerFor('darwin').cmd).toBe('open');
    expect(openerFor('win32').cmd).toBe('explorer.exe');
    expect(openerFor('linux').cmd).toBe('xdg-open');
  });
  it('passes the folder as one argument (no shell), and leaves the file manager running on its own', async () => {
    const f = fakeSpawn('spawn');
    await openFolder('C:\\Users\\me\\Café data; rm x', 'win32', f.run);
    expect(f.calls).toEqual([{ cmd: 'explorer.exe', args: ['C:\\Users\\me\\Café data; rm x'], opts: { detached: true, stdio: 'ignore', windowsHide: false } }]);
    expect(f.unrefd()).toBe(true);
  });
  it('says so plainly when no file manager can start', async () => {
    await expect(openFolder('/tmp/x', 'linux', fakeSpawn('error').run)).rejects.toThrow("Couldn't open the folder: spawn xdg-open ENOENT");
  });
});
