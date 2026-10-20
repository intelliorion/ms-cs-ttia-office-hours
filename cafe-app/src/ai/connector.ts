import { paths } from '../workspace/paths';
import { writeYaml } from '../workspace/files';
import { loadSettings } from '../round/store';
import { AI_CHOICES, type AiChoice, type Settings } from '../round/round';
import { AiError } from './schema';
import type { Task } from './tasks';
import { claudeProvider } from './providers/claude';
import { copilotProvider } from './providers/copilot';
import { vscodeProvider } from './providers/vscode';
import { fakeProvider } from './providers/fake';

export type ProviderId = 'claude' | 'copilot' | 'vscode' | 'fake';

export interface Provider {
  id: ProviderId;
  label: string;
  available(): Promise<boolean>;
  complete(prompt: string, opts: { timeoutMs: number }): Promise<string>;
}

export interface AiStatus { provider: ProviderId | null; label: string }
export interface Connector {
  status(): Promise<AiStatus>;
  choices(): Promise<{ id: AiChoice; label: string; available: boolean }[]>;
  run<T>(task: Task<T>, input: unknown): Promise<T>;
  /** Like run, but also says which provider answered. */
  runWith<T>(task: Task<T>, input: unknown): Promise<{ provider: ProviderId; output: T }>;
}

export const DEFAULT_TIMEOUT_MS = 90_000;
export const NO_AI_LABEL = 'No AI: working by hand';
const CHOICE_LABELS: Record<AiChoice, string> = {
  auto: 'Automatic', claude: 'Claude Code', copilot: 'Copilot CLI', vscode: 'Copilot (VS Code)', none: 'No AI: work by hand',
};

/** Claude Code, Copilot CLI, then the VS Code helper. The fake comes first only when CAFE_AI_FAKE=1. */
export function defaultProviders(env: NodeJS.ProcessEnv = process.env): Provider[] {
  const real = [claudeProvider(), copilotProvider(), vscodeProvider()];
  return env.CAFE_AI_FAKE === '1' ? [fakeProvider(), ...real] : real;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<never>((_r, reject) => { timer = setTimeout(() => reject(new AiError(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms); });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

const isAvailable = (p: Provider) => p.available().then((ok) => ok === true, () => false);

export function createConnector(opts: {
  providers: Provider[];
  settings: Settings | (() => Settings | Promise<Settings>);
  timeoutMs?: number;
}): Connector {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const settings = async () => (typeof opts.settings === 'function' ? opts.settings() : opts.settings);

  async function pick(): Promise<Provider | null> {
    const choice = (await settings()).ai?.provider ?? 'auto';
    if (choice === 'none') return null;
    const candidates = choice === 'auto' ? opts.providers : opts.providers.filter((p) => p.id === choice);
    for (const p of candidates) if (await isAvailable(p)) return p;
    return null;
  }

  async function runWith<T>(task: Task<T>, input: unknown): Promise<{ provider: ProviderId; output: T }> {
    const p = await pick();
    if (!p) throw new AiError('No AI available');
    const raw = await withTimeout(p.complete(task.prompt(input), { timeoutMs }), timeoutMs, p.label);
    if (typeof raw !== 'string') throw new AiError('invalid output: the reply was not text');
    return { provider: p.id, output: task.parse(raw) };
  }

  return {
    async status() {
      const p = await pick();
      return p ? { provider: p.id, label: p.label } : { provider: null, label: NO_AI_LABEL };
    },
    async choices() {
      const avail = await Promise.all(opts.providers.map(async (p) => [p.id, await isAvailable(p)] as const));
      const has = (id: string) => avail.some(([pid, ok]) => pid === id && ok);
      return AI_CHOICES.map((id) => ({ id, label: CHOICE_LABELS[id], available: id === 'none' || (id === 'auto' ? avail.some(([, ok]) => ok) : has(id)) }));
    },
    run: async <T>(task: Task<T>, input: unknown) => (await runWith(task, input)).output,
    runWith,
  };
}

/** Saves the operator's choice in rules/settings.yaml. 'fake' can never be chosen here. */
export async function saveAiProvider(root: string, provider: unknown): Promise<Settings> {
  if (typeof provider !== 'string' || !(AI_CHOICES as string[]).includes(provider)) {
    throw new Error(`Choose one of: ${AI_CHOICES.join(', ')}`);
  }
  const settings = await loadSettings(root);
  const next: Settings = { ...settings, ai: { ...(settings.ai ?? {}), provider: provider as AiChoice } };
  await writeYaml(paths(root).settings, next);
  return next;
}
