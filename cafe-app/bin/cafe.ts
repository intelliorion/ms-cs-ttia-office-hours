#!/usr/bin/env -S npx tsx
import path from 'node:path';
import { initWorkspace } from '../src/workspace/init';
import { createApp } from '../src/server/server';
import { importExport } from '../src/import/importRows';
import { loadSteps } from '../src/rules/stages';
import { systemClock } from '../src/clock';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : undefined;
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const [command, ...rest] = positional;
const root = path.resolve(flag('workspace') ?? process.env.CAFE_WORKSPACE ?? 'cafe-workspace');
const clock = systemClock;

const USAGE = 'Usage: cafe <init | start | import <file>> [--workspace DIR] [--port N]';

async function main(): Promise<void> {
  switch (command) {
    case 'init': {
      const { created } = await initWorkspace(root, clock);
      console.log(created.length ? `Created in ${root}:\n  ${created.join('\n  ')}` : `${root} is already set up.`);
      return;
    }
    case 'start': {
      await initWorkspace(root, clock);
      const port = Number(flag('port') ?? 4100);
      const server = createApp({ root, clock });
      server.on('error', (e: NodeJS.ErrnoException) => {
        console.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Stop the other Café or use --port N.` : e.message);
        process.exit(1);
      });
      server.listen(port, '127.0.0.1', () => {
        console.log(`Creators' Café is running at http://localhost:${port}\nWorkspace: ${root}\nStop with Ctrl+C.`);
      });
      return;
    }
    case 'import': {
      if (!rest[0]) throw new Error('Usage: cafe import <export.csv|export.xlsx>');
      const report = await importExport(root, path.resolve(rest[0]), { clock, steps: await loadSteps(root) });
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    case undefined:
      console.log(USAGE);
      return;
    default:
      console.error(`Unknown command "${command}".\n${USAGE}`);
      process.exit(1);
  }
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
