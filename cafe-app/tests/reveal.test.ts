import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { openerFor, openFolder, openEmailFile } from '../src/workspace/reveal';

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

function fakeMac(codes: number[]) {
  const calls: string[][] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    const child = Object.assign(new EventEmitter(), { unref: () => {} });
    const code = codes.shift() ?? 1;
    queueMicrotask(() => child.emit('exit', code));
    return child;
  };
  return { run: run as any, calls };
}

describe('opening an email in Outlook', () => {
  it('on a Mac asks for Outlook by name first', async () => {
    const f = fakeMac([0]);
    await openEmailFile('/w/data/exports/outlook/E2 x.eml', 'darwin', f.run);
    expect(f.calls).toEqual([['open', '-a', 'Microsoft Outlook', '/w/data/exports/outlook/E2 x.eml']]);
  });
  it('on a Mac without Outlook uses the app that opens .eml files; says so when nothing can', async () => {
    const f = fakeMac([1, 0]);
    await openEmailFile('/w/a.eml', 'darwin', f.run);
    expect(f.calls).toEqual([['open', '-a', 'Microsoft Outlook', '/w/a.eml'], ['open', '/w/a.eml']]);
    await expect(openEmailFile('/w/a.eml', 'darwin', fakeMac([1, 1]).run)).rejects.toThrow("Couldn't open the email in Outlook");
  });
  it('on Windows hands the file to the app that opens .eml files', async () => {
    const f = fakeSpawn('spawn');
    await openEmailFile('C:\\w\\a.eml', 'win32', undefined, f.run);
    expect(f.calls[0]).toMatchObject({ cmd: 'explorer.exe', args: ['C:\\w\\a.eml'] });
    await expect(openEmailFile('C:\\w\\a.eml', 'win32', undefined, fakeSpawn('error').run)).rejects.toThrow("Couldn't open the email in Outlook");
  });
});
