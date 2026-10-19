import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeYaml, readYaml, appendHistory, readHistory } from '../src/workspace/files';

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
