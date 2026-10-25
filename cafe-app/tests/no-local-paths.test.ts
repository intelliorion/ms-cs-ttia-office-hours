import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The repo is public: no committed file in cafe-app may carry a path from one person's machine (a home folder or a
 * session's temp folder). Placeholders such as /Users/you or C:\Users\you are fine.
 */
const APP = path.resolve(__dirname, '..');
const TEXT = /\.(ts|tsx|mts|mjs|js|json|md|txt|yaml|yml|css|html|ps1|sh)$/;
const LOCAL = [
  /\/private\/tmp\/claude-\d+/,
  /\/Users\/(?!(?:you|me|x|name|username)\b)[A-Za-z][\w.-]*\//,
  /[A-Za-z]:\\\\?Users\\\\?(?!(?:you|me|x|name|username)\b)[A-Za-z][\w.-]*\\/,
];

function committed(): string[] | null {
  try { return execFileSync('git', ['ls-files'], { cwd: APP, encoding: 'utf8' }).split('\n').filter(Boolean); } catch { return null; }
}

describe('no machine-local paths in the committed app', () => {
  const files = committed();
  it.skipIf(!files)('no file names a home folder or a session temp folder', () => {
    const hits: string[] = [];
    for (const f of files!) {
      if (!TEXT.test(f) || f.startsWith('web/') || f.endsWith('package-lock.json')) continue;
      const lines = readFileSync(path.join(APP, f), 'utf8').split('\n');
      lines.forEach((l, i) => { if (LOCAL.some((re) => re.test(l))) hits.push(`${f}:${i + 1}`); });
    }
    expect(hits).toEqual([]);
  });
});
