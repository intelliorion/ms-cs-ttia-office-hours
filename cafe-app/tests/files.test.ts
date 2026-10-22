import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeYaml, readYaml, appendHistory, readHistory, writeFileAtomic } from '../src/workspace/files';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'cafe-files-')); });

describe('files', () => {
  it('round-trips YAML and leaves no temp files', async () => {
    const file = path.join(dir, 'a', 'idea.yaml');
    await writeYaml(file, { title: 'Email scheduler', support: ['Agent Design Guidance'] });
    expect(await readYaml(file)).toEqual({ title: 'Email scheduler', support: ['Agent Design Guidance'] });
    expect(await readdir(path.join(dir, 'a'))).toEqual(['idea.yaml']);
  });

  it('returns undefined for a missing file', async () => {
    expect(await readYaml(path.join(dir, 'nope.yaml'))).toBeUndefined();
  });

  it('appends history as JSON lines', async () => {
    await appendHistory(dir, { at: '2026-10-19', action: 'tick', by: 'app', step: 's1d', source: 'export.csv' });
    await appendHistory(dir, { at: '2026-10-19', action: 'untick', by: 'operator', step: 's1d' });
    expect((await readHistory(dir)).map((h) => h.action)).toEqual(['tick', 'untick']);
  });
});

describe('Windows: a file held for a moment by antivirus or OneDrive', () => {
  const busy = (code: string) => Object.assign(new Error(`${code}: operation not permitted, rename`), { code });
  afterEach(() => { vi.restoreAllMocks(); });

  it('retries the rename and then succeeds, leaving no temp file', async () => {
    const real = fsp.rename;
    let calls = 0;
    vi.spyOn(fsp, 'rename').mockImplementation(async (a, b) => { calls++; if (calls <= 2) throw busy('EPERM'); return real(a, b); });
    const file = path.join(dir, 'in', 'mail.eml');
    await writeFileAtomic(file, 'hello');
    expect(calls).toBe(3);
    expect(await readFile(file, 'utf8')).toBe('hello');
    expect(await readdir(path.join(dir, 'in'))).toEqual(['mail.eml']);
  });

  it('still blocked after the retries: copies instead, and leaves no temp file', async () => {
    vi.spyOn(fsp, 'rename').mockRejectedValue(busy('EBUSY'));
    const file = path.join(dir, 'in', 'mail.eml');
    await writeFileAtomic(file, 'hello', { retryMs: 30 });
    expect(await readFile(file, 'utf8')).toBe('hello');
    expect(await readdir(path.join(dir, 'in'))).toEqual(['mail.eml']);
  });

  it('any other error is not retried', async () => {
    vi.spyOn(fsp, 'rename').mockRejectedValue(busy('ENOSPC'));
    await expect(writeFileAtomic(path.join(dir, 'x.txt'), 'hi')).rejects.toThrow(/ENOSPC/);
  });
});
