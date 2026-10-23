import { paths } from '../workspace/paths';
import { writeYaml } from '../workspace/files';
import { loadSettings } from '../round/store';
import { AI_CHOICES, type AiChoice, type Settings } from '../round/round';
import { AiError } from './schema';
import { lookName, type Task, type LookTask, type LookOutput } from './tasks';
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
  /** Reads one picture or scanned PDF at `file` (an absolute path) with the prompt; absent when this AI can't see files. */
  look?(file: string, prompt: string, opts: { timeoutMs: number }): Promise<string>;
  /** Used only when the settings pin it, never by 'auto'. */
  pinOnly?: boolean;
  /** Shown next to the provider in the status, e.g. a caution. */
  note?: string;
}

export interface AiStatus { provider: ProviderId | null; label: string; note?: string }
export interface Connector {
  status(): Promise<AiStatus>;
  choices(): Promise<{ id: AiChoice; label: string; available: boolean; note?: string }[]>;
  run<T>(task: Task<T>, input: unknown): Promise<T>;
  /** Like run, but also says which provider answered. */
  runWith<T>(task: Task<T>, input: unknown, opts?: { timeoutMs?: number }): Promise<{ provider: ProviderId; label: string; output: T }>;
  /** The chosen provider opens one file and answers the look task; AiError('This AI cannot read pictures') when it can't. */
  look(file: string, task: LookTask, opts?: { timeoutMs?: number }): Promise<{ provider: ProviderId; label: string; output: LookOutput; ms: number }>;
}

export const CANNOT_LOOK = 'This AI cannot read pictures';

export const DEFAULT_TIMEOUT_MS = 90_000;
/** The triage reads long emails and can take Claude Code more than 90 s. */
export const TRIAGE_TIMEOUT_MS = 120_000;
/** The longest any one task may ask for: the roadshow deck writes every slide and its script in one reply. */
export const LONGEST_TIMEOUT_MS = 300_000;
export const NO_AI_LABEL = 'No AI: working by hand';
const CHOICE_LABELS: Record<AiChoice, string> = {
  auto: 'Automatic', claude: 'Claude Code', copilot: 'Copilot CLI', vscode: 'Copilot (VS Code)', none: 'No AI: work by hand',
};

/** Claude Code, Copilot CLI, then the VS Code helper. The fake comes first only when CAFE_AI_FAKE=1. */
export function defaultProviders(env: NodeJS.ProcessEnv = process.env): Provider[] {
  const real = [claudeProvider(), copilotProvider(), vscodeProvider()];
  return env.CAFE_AI_FAKE === '1' ? [fakeProvider(), ...real] : real;
}

/** The least time worth asking again in, after a reply the checker refused. */
export const RETRY_MIN_MS = 15_000;
const isRefusedReply = (e: unknown) => e instanceof AiError && /^invalid output: /.test(e.message) && !/longer than/.test(e.message);
/** The same prompt, headed by what was wrong with the last reply (only the checker's words, kept plain and short). */
export function retryPrompt(prompt: string, why: string): string {
  const plain = why.replace(/^invalid output: /, '').replace(/[^\w$.\[\] ,;:'"()-]/g, ' ').slice(0, 300);
  return `Your last reply to this was refused by the checker (${plain}). Reply again, following the instructions below exactly: one JSON object matching the schema, nothing else.\n\n${prompt}`;
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
  const ceiling = opts.timeoutMs ?? LONGEST_TIMEOUT_MS;
  const settings = async () => (typeof opts.settings === 'function' ? opts.settings() : opts.settings);

  async function pick(): Promise<Provider | null> {
    const choice = (await settings()).ai?.provider ?? 'auto';
    if (choice === 'none') return null;
    const candidates = choice === 'auto' ? opts.providers.filter((p) => !p.pinOnly) : opts.providers.filter((p) => p.id === choice);
    for (const p of candidates) if (await isAvailable(p)) return p;
    return null;
  }

  async function runWith<T>(task: Task<T>, input: unknown, run: { timeoutMs?: number } = {}): Promise<{ provider: ProviderId; label: string; output: T }> {
    const p = await pick();
    if (!p) throw new AiError('No AI available');
    const ms = Math.min(run.timeoutMs ?? task.timeoutMs ?? timeoutMs, ceiling);
    const t0 = Date.now();
    const prompt = task.prompt(input);
    const raw = await withTimeout(p.complete(prompt, { timeoutMs: ms }), ms, p.label);
    if (typeof raw !== 'string') throw new AiError('invalid output: the reply was not text');
    try {
      return { provider: p.id, label: p.label, output: task.parse(raw) };
    } catch (e) {
      // A reply the checker refused (wrong shape, a key too many, too few items) is asked for once more, in the time
      // the task has left, with what was wrong. Nothing from the refused reply is used. A timeout is never re-asked.
      const left = ms - (Date.now() - t0);
      if (!isRefusedReply(e) || left < RETRY_MIN_MS) throw e;
      const again = await withTimeout(p.complete(retryPrompt(prompt, (e as Error).message), { timeoutMs: left }), left, p.label);
      if (typeof again !== 'string') throw new AiError('invalid output: the reply was not text');
      return { provider: p.id, label: p.label, output: task.parse(again) };
    }
  }

  async function look(file: string, task: LookTask, run: { timeoutMs?: number } = {}) {
    const p = await pick();
    if (!p) throw new AiError('No AI available');
    if (!p.look) throw new AiError(CANNOT_LOOK);
    const ms = Math.min(run.timeoutMs ?? task.timeoutMs ?? timeoutMs, ceiling);
    const t0 = Date.now();
    const raw = await withTimeout(p.look(file, task.prompt({ name: lookName(file) }), { timeoutMs: ms }), ms, p.label);
    if (typeof raw !== 'string') throw new AiError('invalid output: the reply was not text');
    return { provider: p.id, label: p.label, output: task.parse(raw), ms: Date.now() - t0 };
  }

  return {
    async status() {
      const p = await pick();
      return p ? { provider: p.id, label: p.label, ...(p.note ? { note: p.note } : {}) } : { provider: null, label: NO_AI_LABEL };
    },
    async choices() {
      const avail = await Promise.all(opts.providers.map(async (p) => ({ p, ok: await isAvailable(p) })));
      return AI_CHOICES.map((id) => {
        const hit = avail.find(({ p, ok }) => p.id === id && ok);
        const note = opts.providers.find((p) => p.id === id)?.note;
        const available = id === 'none' || (id === 'auto' ? avail.some(({ p, ok }) => ok && !p.pinOnly) : !!hit);
        return { id, label: CHOICE_LABELS[id], available, ...(note ? { note } : {}) };
      });
    },
    run: async <T>(task: Task<T>, input: unknown) => (await runWith(task, input)).output,
    runWith,
    look,
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
