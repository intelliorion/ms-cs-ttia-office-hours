import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Keeps the machine awake while an answer runs. A Mac on idle goes into maintenance sleep for about fifteen minutes at
 * a time (pmset -g log: "Entering Sleep state due to 'Maintenance Sleep'"), and every process sleeps with it: a
 * 60-second AI call that started just before took fifteen minutes on the clock, which is what the retest saw. While at
 * least one hold is open the app runs `/usr/bin/caffeinate -i -w <pid>` (no idle sleep while this process lives), and
 * stops it when the last hold is released. Elsewhere, or with CAFE_NO_CAFFEINATE=1, it does nothing.
 */
let holds = 0;
let child: ChildProcess | undefined;
type Spawner = (cmd: string, args: string[]) => ChildProcess;
let spawner: Spawner = (cmd, args) => spawn(cmd, args, { stdio: 'ignore', detached: false });

/** For tests: who starts caffeinate, and on which platform. */
export const awakeHooks = { platform: process.platform as NodeJS.Platform, setSpawner(s: Spawner): Spawner { const was = spawner; spawner = s; return was; } };

export function holdAwake(env: NodeJS.ProcessEnv = process.env): () => void {
  const on = awakeHooks.platform === 'darwin' && env.CAFE_NO_CAFFEINATE !== '1';
  if (!on) return () => undefined;
  holds++;
  if (holds === 1 && !child) {
    try {
      child = spawner('/usr/bin/caffeinate', ['-i', '-w', String(process.pid)]);
      child.on('error', () => { child = undefined; });
      child.on('exit', () => { child = undefined; });
    } catch { child = undefined; }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
    if (holds === 0 && child) { child.kill(); child = undefined; }
  };
}
/** How many holds are open (for tests). */
export const awakeHolds = () => holds;
