import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initWorkspace } from '../src/workspace/init';
import { fixedClock } from '../src/clock';
import { normalizeIdea, type Idea } from '../src/ideas/idea';

export const FIXTURE = fileURLToPath(new URL('./fixtures/sample-export.csv', import.meta.url));

export async function tmpWorkspace(today = '2026-10-19'): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cafe-ws-'));
  await initWorkspace(root, fixedClock(today));
  return root;
}

export function sampleIdea(over: Partial<Idea> = {}): Idea {
  return normalizeIdea({
    id: 'CAFE-2026-001',
    slug: 'email-scheduler',
    title: 'Email scheduler',
    round: 'ROUND-2026-Q4',
    stage: 1,
    function: 'BSI',
    region: 'AMER',
    people: { submitter: 'Person 1', team: [] },
    dedupe_key: 'email scheduler|person 1',
    ...over,
  });
}

import type { AddressInfo } from 'node:net';
import { createApp, type ServerOptions } from '../src/server/server';

export async function startServer(today = '2026-10-19', extra: Partial<ServerOptions> = {}) {
  const root = await tmpWorkspace(today);
  const server = createApp({ root, clock: fixedClock(today), ...extra });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { root, server, base: `http://127.0.0.1:${port}` };
}
