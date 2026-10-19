import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { startServer } from './helpers';
import { APP_DIR } from '../src/workspace/paths';

let close: (() => void) | undefined;
afterEach(() => close?.());

describe('web page', () => {
  it('serves the page, its script and its styles', async () => {
    const s = await startServer();
    close = () => s.server.close();
    const html = await (await fetch(`${s.base}/`)).text();
    expect(html).toContain("<title>Creators' Café</title>");
    expect(html).toContain('<script src="/app.js"></script>');
    expect((await fetch(`${s.base}/app.js`)).headers.get('content-type')).toContain('javascript');
    expect((await fetch(`${s.base}/style.css`)).status).toBe(200);
  });

  it('ships a script that parses', () => {
    expect(() => execFileSync(process.execPath, ['--check', path.join(APP_DIR, 'web', 'app.js')])).not.toThrow();
  });
});
