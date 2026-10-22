import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, chmod, readdir, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createConnector, type Provider } from '../src/ai/connector';
import { lookTask } from '../src/ai/tasks';
import { AiError } from '../src/ai/schema';
import { fakeProvider } from '../src/ai/providers/fake';
import { claudeProvider } from '../src/ai/providers/claude';
import { DEFAULT_SETTINGS } from '../src/round/round';

afterEach(() => { vi.unstubAllEnvs(); });

const connectorWith = (p: Provider) => createConnector({ providers: [p], settings: DEFAULT_SETTINGS });

describe('look', () => {
  it('the fake reads the whiteboard and finds a blank picture unreadable', async () => {
    vi.stubEnv('CAFE_AI_FAKE', '1');
    const ai = connectorWith(fakeProvider());
    const wb = await ai.look('/somewhere/2026-10-21-14-whiteboard.png', lookTask);
    expect(wb.provider).toBe('fake');
    expect(wb.output.readable).toBe(true);
    expect(wb.output.text.split('\n')).toEqual([
      'CAFE-2026-002 DESK BOOKING', 'NEEDS: FIND A FREE DESK, SWAP A BOOKING, RELEASE NO-SHOWS', 'TOOL: COPILOT STUDIO', 'DATA: FLOOR PLAN SYSTEM',
    ]);
    expect(wb.output.notes).toBe('A whiteboard photo with a bulleted list');
    expect(wb.ms).toBeGreaterThanOrEqual(0);
    const blank = await ai.look('/somewhere/blank.png', lookTask);
    expect(blank.output).toMatchObject({ readable: false, notes: 'A blank picture' });
  });

  it('a provider that cannot look is refused with a plain message', async () => {
    const p: Provider = { id: 'copilot', label: 'Copilot CLI', available: async () => true, complete: async () => '{}' };
    const err = await connectorWith(p).look('/x/a.png', lookTask).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.message).toBe('This AI cannot read pictures');
  });

  it('the look prompt names the file by its base name and asks for the three fields', () => {
    const prompt = lookTask.prompt({ name: 'scan.png' });
    expect(prompt).toMatch(/^TASK: look/);
    expect(prompt).toContain('Open ./scan.png with the Read tool.');
    expect(lookTask.timeoutMs).toBe(90_000);
    expect(() => lookTask.parse('{"text":"x","notes":"y"}')).toThrow(/readable/);
  });
});

describe('Claude Code look', () => {
  /** A stand-in `claude` on PATH that reports its folder, what is in it and its arguments. */
  async function stub(script: string) {
    const bin = await mkdtemp(path.join(os.tmpdir(), 'cafe-stub-'));
    await writeFile(path.join(bin, 'claude'), `#!/bin/sh\ncat > /dev/null\n${script}\n`);
    await chmod(path.join(bin, 'claude'), 0o755);
    vi.stubEnv('PATH', `${bin}${path.delimiter}${process.env.PATH}`);
    const src = await mkdtemp(path.join(os.tmpdir(), 'cafe-src-'));
    const file = path.join(src, 'note.png');
    await writeFile(file, 'png bytes');
    await writeFile(path.join(src, 'other.txt'), 'must not be copied');
    return file;
  }
  const exists = (p: string) => access(p).then(() => true, () => false);

  it('copies only the file into a fresh folder, allows Read on it alone, and removes the folder', async () => {
    const file = await stub('printf "%s\\n%s\\n%s" "$PWD" "$(ls -A)" "$*"');
    const out = await claudeProvider().look!(file, 'prompt', { timeoutMs: 10_000 });
    const [dir, listing, args] = out.split('\n');
    expect(path.basename(dir)).toMatch(/^cafe-look-/);
    expect(listing).toBe('note.png');
    expect(args).toBe('-p --output-format text --tools Read --allowedTools Read(./note.png) --max-turns 3 --strict-mcp-config --no-session-persistence');
    expect(await exists(dir)).toBe(false);
  });

  it('removes the folder when the CLI fails too', async () => {
    const file = await stub('echo "$PWD" >&2; exit 3');
    const err = (await claudeProvider().look!(file, 'prompt', { timeoutMs: 10_000 }).catch((e) => e)) as Error;
    expect(err.message).toMatch(/exit 3/);
    const dir = /stopped \(exit 3\): (\S+)/.exec(err.message)?.[1] ?? '';
    expect(path.basename(dir)).toMatch(/^cafe-look-/);
    expect(await exists(dir)).toBe(false);
    expect((await readdir(path.dirname(file))).sort()).toEqual(['note.png', 'other.txt']);
  });
});
