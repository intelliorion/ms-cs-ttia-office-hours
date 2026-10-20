# Creators' Café operator app, Plan 1 of 4: core (no AI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local web app that runs a Creators' Café round by hand with no AI: import the SharePoint export, track every idea's 25-step checklist, set round dates and links, review and route ideas, draft and gate emails, show overdue replies, and export `status.csv`.

**Architecture:** A Node and TypeScript app in `cafe-app/` reads and writes a plain-file workspace folder (YAML and Markdown, no database). Small modules each own one part (rules, ideas, checklist, import, templates, outbox, review, reminders, exports). A `node:http` server on 127.0.0.1:4100 exposes them as a JSON API to a vanilla-JS page.

**Tech Stack:** Node ≥ 20, TypeScript 5 (strict, ESM, run with `tsx`), vitest, `yaml`, `csv-parse`, `exceljs`. No other runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-19-creators-cafe-app-design.md`

### Scope: this is Plan 1 of 4

The spec covers four subsystems. Each one gets its own plan, and each plan ships working software:

1. **Core, no AI (this plan):** spec sections 2 (no-AI mode), 3, 4, 8, 11, 12 (import errors) and 13 (unit, settings-gating, due-date and end-to-end tests).
2. **AI layer and Inbox:** sections 5 and 10. Adapters for `claude -p`, Copilot CLI and the VS Code helper; schema-validated skill output; drop-anything triage (safe with Undo, needs your OK, held); prompt-injection tests; the AI pre-ticks review criteria and suggests a decision.
3. **Knowledge graph:** section 9. Structured pass, extraction and resolution agents, `nodes.jsonl` and `edges.jsonl`, the Orion-style view, Find a connection, Ask the graph, What if, and the graph updates that come from the Inbox.
4. **Tool picker, design, cohorts and roadshows:** sections 6 and 7. Features and tool picks (auto-ticks s3e), the design brainstorm (auto-ticks s3f), starter kits, cohorts, `.ics` invites, session reminders, the roadshow pack, and the end-of-series closures (Café pattern; stop, keep the learning).

Write Plans 2–4 after this plan ships.

## Global Constraints

- The app lives in `cafe-app/` at the repo root. Work on a branch called `cafe-app-core`, not on `main`.
- The repo has unrelated uncommitted changes (`CHANGELOG.md`, `README.md`, `skills/…`, `tests/preview-scenarios.md`, `copilot-studio-github-agent/…`). Never stage them. Commit only the files a task lists, with `git add <paths>`, never `git add -A` or `git add .`.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01P3ov37P2fF1cuhtF4wyed3
  ```
- Node ≥ 20. TypeScript `strict`. ESM (`"type": "module"`), extensionless relative imports (`moduleResolution: "Bundler"`).
- Runtime dependencies: only `yaml`, `csv-parse` and `exceljs`. Dev dependencies: only `typescript`, `tsx`, `vitest` and `@types/node`.
- The server binds to `127.0.0.1` only, default port `4100`, and refuses any request whose Host is not localhost.
- The app never sends email, posts anywhere or makes network calls. The operator sends from Outlook.
- "The AI fills what it knows from the idea and leaves every unknown date, link or contact as a `[PLACEHOLDER]`; it never invents one." The same rule applies to this no-AI code: an unknown value stays a bracketed placeholder and never becomes `undefined` or an empty string.
- "An email that still needs an unset setting cannot be approved."
- "The operator moves the stage, never the app." Steps may tick themselves (an email marked sent, the import's ID and duplicate check), but stage changes only happen through `advance`.
- "Every tick is logged in `history.log` with its source."
- `exports/status.csv` "lists each Café ID, title and public status … with no names."
- Café rules: no value, ROI, savings or KPI fields anywhere in the app.
- Every workspace write is atomic: write a temp file, then rename it.
- UI copy is plain English and sentence case. Say "the Café", "idea" and "step". Never say "ticket" or "record".

## Review Focus

1. **Re-importing the same export, or a later export with a few new rows.** Expected: no duplicate ideas; only the new rows become ideas; the report lists the skipped rows. *Test: Task 6.*
2. **An export whose columns are reordered, has extra columns, or uses the long form of a header ("Have you already experimented with AI for this idea?").** Expected: columns map by name prefix. With no Title column, the import fails with a clear message and writes nothing. *Test: Task 6.*
3. **The operator changes a setting after drafts exist.** Expected: open drafts show the new value; approved and sent emails keep the text they were approved with. *Test: Task 7.*
4. **Double-clicking "Mark as sent", or doing it in two tabs.** Expected: the second call does nothing. There is one tick in `history.log`, and neither `sentAt` nor the reply due date moves. *Test: Task 7.*
5. **A hand-edited `idea.yaml` with a typo, an unknown step id, or broken YAML.** Expected: the other ideas still list; the broken one is reported by folder name; unknown step ids are ignored in progress counts. *Tests: Task 4 (listing) and Task 5 (progress).*

---

## File map

```
cafe-app/
  package.json  tsconfig.json  vitest.config.ts  .gitignore  README.md
  bin/cafe.ts                     CLI: init, start, import, status
  src/clock.ts                    Clock type, plusDays, daysBetween, formatDate
  src/workspace/paths.ts          workspace layout, APP_DIR, BUNDLED_TEMPLATES
  src/workspace/files.ts          atomic writes, YAML, history.log
  src/workspace/init.ts           create a workspace, roundIdFor
  src/rules/stages.ts             the 25 steps, stage names, loadSteps
  src/round/round.ts              Round and Settings types, field lists, TOKENS, resolveToken
  src/round/store.ts              load and save round and settings
  src/ideas/idea.ts               Idea type, normalizeIdea, closure labels
  src/ideas/store.ts              slugify, nextId, save, load, list ideas
  src/checklist/checklist.ts      step status, progress, tick, advance
  src/import/readExport.ts        .csv and .xlsx into a table
  src/import/columns.ts           form column map, multi-select, people parsing
  src/import/importRows.ts        rows into ideas, dedupe, report
  src/comms/templates.ts          template files, render, fill, analyse
  src/comms/outbox.ts             draft, approve, mark sent, list
  src/review/review.ts            criteria, decisions, review.md, CSIC handoff, review pack
  src/reminders/due.ts            overdue steps, E2R offer
  src/exports/status.ts           public status, status.csv
  src/server/server.ts            http server, static files, guards
  src/server/api.ts               JSON routes
  templates/*.md                  E0, E0B, E1–E11, E2R, SR, RS, PD
  web/index.html  web/app.js  web/style.css
  tests/*.test.ts  tests/helpers.ts  tests/fixtures/sample-export.csv
```

---

### Task 1: Scaffold, clock and file helpers

**Files:**
- Create: `cafe-app/package.json`, `cafe-app/tsconfig.json`, `cafe-app/vitest.config.ts`, `cafe-app/.gitignore`
- Create: `cafe-app/src/clock.ts`, `cafe-app/src/workspace/paths.ts`, `cafe-app/src/workspace/files.ts`
- Test: `cafe-app/tests/clock.test.ts`, `cafe-app/tests/files.test.ts`

**Interfaces:**
- Produces:
  - `type Clock = () => string` (ISO `YYYY-MM-DD`)
  - `systemClock`, `fixedClock(iso)`, `plusDays(iso, n)`, `daysBetween(from, to)`, `formatDate(iso)` → "19 October 2026"
  - `paths(root)` → `{ root, rounds, inbox, held, ideas, cohorts, roadshows, graph, templates, rules, exports, skills, settings, stages }`
  - `APP_DIR`, `BUNDLED_TEMPLATES`
  - `readText(file)`, `readYaml<T>(file)` → `T | undefined`
  - `writeFileAtomic(file, content: string | Uint8Array)`, `writeYaml(file, data)`
  - `interface HistoryEntry { at; action; by: 'operator'|'app'; step?; source?; detail? }`
  - `appendHistory(dir, entry)`, `readHistory(dir)`

- [ ] **Step 1: Create the branch and the package files**

```bash
cd /Users/chongranhao/github/ms-cs-ttia-office-hours
git switch -c cafe-app-core
mkdir -p cafe-app/src/workspace cafe-app/tests
```

`cafe-app/package.json`:
```json
{
  "name": "cafe-app",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Creators' Café operator app",
  "bin": { "cafe": "./bin/cafe.ts" },
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "cafe": "tsx bin/cafe.ts"
  },
  "dependencies": {
    "csv-parse": "^5.5.6",
    "exceljs": "^4.4.0",
    "yaml": "^2.5.1"
  },
  "devDependencies": {
    "@types/node": "^22.9.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

`cafe-app/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "bin", "tests"]
}
```

`cafe-app/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], testTimeout: 20000 },
});
```

`cafe-app/.gitignore`:
```
node_modules/
cafe-workspace/
```

Run: `cd cafe-app && npm install`
Expected: installs with no errors and creates `package-lock.json`.

- [ ] **Step 2: Write the failing tests**

`cafe-app/tests/clock.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { plusDays, daysBetween, formatDate, fixedClock } from '../src/clock';

describe('clock', () => {
  it('adds days across a month end', () => expect(plusDays('2026-10-30', 5)).toBe('2026-11-04'));
  it('counts days between dates', () => expect(daysBetween('2026-10-19', '2026-10-26')).toBe(7));
  it('formats dates in plain English', () => expect(formatDate('2026-10-19')).toBe('19 October 2026'));
  it('fixed clock returns its date', () => expect(fixedClock('2026-10-19')()).toBe('2026-10-19'));
});
```

`cafe-app/tests/files.test.ts`:
```ts
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
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `cd cafe-app && npx vitest run tests/clock.test.ts tests/files.test.ts`
Expected: FAIL, "Failed to resolve import ../src/clock" (and the same for files).

- [ ] **Step 4: Write the implementation**

`cafe-app/src/clock.ts`:
```ts
export type Clock = () => string;

export const systemClock: Clock = () => process.env.CAFE_TODAY ?? new Date().toISOString().slice(0, 10);

export const fixedClock = (iso: string): Clock => () => iso;

export function plusDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${iso}T00:00:00Z`));
}
```

`cafe-app/src/workspace/paths.ts`:
```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_DIR = fileURLToPath(new URL('../../', import.meta.url));
export const BUNDLED_TEMPLATES = path.join(APP_DIR, 'templates');

export function paths(root: string) {
  return {
    root,
    rounds: path.join(root, 'rounds'),
    inbox: path.join(root, 'inbox'),
    held: path.join(root, 'inbox', 'held'),
    ideas: path.join(root, 'ideas'),
    cohorts: path.join(root, 'cohorts'),
    roadshows: path.join(root, 'roadshows'),
    graph: path.join(root, 'graph'),
    templates: path.join(root, 'templates'),
    rules: path.join(root, 'rules'),
    exports: path.join(root, 'exports'),
    skills: path.join(root, 'skills'),
    settings: path.join(root, 'rules', 'settings.yaml'),
    stages: path.join(root, 'rules', 'stages.yaml'),
  };
}
```

`cafe-app/src/workspace/files.ts`:
```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export async function readText(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}

export async function readYaml<T>(file: string): Promise<T | undefined> {
  const text = await readText(file);
  return text === undefined ? undefined : (YAML.parse(text) as T);
}

export async function writeFileAtomic(file: string, content: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, file);
}

export async function writeYaml(file: string, data: unknown): Promise<void> {
  await writeFileAtomic(file, YAML.stringify(data));
}

export interface HistoryEntry {
  at: string;
  action: string;
  by: 'operator' | 'app';
  step?: string;
  source?: string;
  detail?: string;
}

export async function appendHistory(dir: string, entry: HistoryEntry): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.appendFile(path.join(dir, 'history.log'), `${JSON.stringify(entry)}\n`, 'utf8');
}

export async function readHistory(dir: string): Promise<HistoryEntry[]> {
  const text = await readText(path.join(dir, 'history.log'));
  if (!text) return [];
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as HistoryEntry);
}
```

- [ ] **Step 5: Run the tests and the type check**

Run: `cd cafe-app && npx vitest run tests/clock.test.ts tests/files.test.ts && npx tsc --noEmit`
Expected: 7 tests PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add cafe-app/package.json cafe-app/package-lock.json cafe-app/tsconfig.json cafe-app/vitest.config.ts cafe-app/.gitignore cafe-app/src cafe-app/tests
git commit -m "cafe-app: scaffold, clock and atomic file helpers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P3ov37P2fF1cuhtF4wyed3"
```

---

### Task 2: Rules and models (steps, round, settings, tokens, idea)

**Files:**
- Create: `cafe-app/src/rules/stages.ts`, `cafe-app/src/round/round.ts`, `cafe-app/src/ideas/idea.ts`
- Test: `cafe-app/tests/rules.test.ts`

**Interfaces:**
- Consumes: `readYaml`, `paths` (Task 1); `formatDate` (Task 1).
- Produces:
  - `type Owner = 'Team'|'TTIA'`, `type StageNo = 1|2|3|4`
  - `interface StepDef { id; stage: StageNo; owner: Owner; text; needed: boolean; email?: string }`
  - `STAGE_NAMES: Record<StageNo,string>`, `DEFAULT_STEPS: StepDef[]` (25)
  - `validateSteps(raw: unknown): StepDef[]`, `loadSteps(root): Promise<StepDef[]>`
  - `interface Round { id; open?; deadline?; reviewBy?; seriesStart?; roadshow? }`
  - `interface Settings { operatorName?; formLink?; csicLink?; teamsLink?; distList?; deckTemplate?; capacity: { ideasPerRound: number; sessionsPerWeek: number } }`
  - `DEFAULT_SETTINGS`, `ROUND_FIELDS`, `SETTING_FIELDS` (readonly `[key, label]` tuples)
  - `interface TokenDef`, `TOKENS: Record<string, TokenDef>`, `resolveToken(token, round, settings): string | undefined`
  - `type Closure = 'reuse'|'csic'|'notnow'|'pattern'|'stop'`, `CLOSURE_LABELS`
  - `type PersonRole = 'lead'|'sponsor'|'member'`, `interface Person { name; role; note? }`
  - `interface StepState { done; by; at; source? }`
  - `type Decision = 'select'|'reuse'|'csic'|'notnow'|'ask'`
  - `interface ReviewRecord { criteria: Record<string, boolean>; decision; reason; at }`
  - `interface Idea` (fields below), `normalizeIdea(raw: Partial<Idea>): Idea`

- [ ] **Step 1: Write the failing test**

`cafe-app/tests/rules.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_STEPS, STAGE_NAMES, validateSteps } from '../src/rules/stages';
import { resolveToken, TOKENS, DEFAULT_SETTINGS } from '../src/round/round';
import { normalizeIdea } from '../src/ideas/idea';

describe('steps', () => {
  it('has 25 steps, 14 needed, in four stages', () => {
    expect(DEFAULT_STEPS).toHaveLength(25);
    expect(DEFAULT_STEPS.filter((s) => s.needed)).toHaveLength(14);
    expect([1, 2, 3, 4].map((n) => DEFAULT_STEPS.filter((s) => s.stage === n).length)).toEqual([5, 6, 9, 5]);
    expect(STAGE_NAMES[3]).toBe('Design series');
  });

  it('rejects duplicate step ids', () => {
    expect(() => validateSteps([...DEFAULT_STEPS, DEFAULT_STEPS[0]])).toThrow(/duplicate step id s1a/);
  });

  it('rejects a step with a bad stage', () => {
    expect(() => validateSteps([{ ...DEFAULT_STEPS[0], stage: 7 }])).toThrow(/stage/);
  });
});

describe('tokens', () => {
  const round = { id: 'ROUND-2026-Q4', reviewBy: '2026-11-02', deadline: '' };
  const settings = { ...DEFAULT_SETTINGS, csicLink: 'https://csic.example/intake' };

  it('fills a set date in plain English', () => expect(resolveToken('[REVIEW DATE]', round, settings)).toBe('2 November 2026'));
  it('fills a set link', () => expect(resolveToken('[CSIC REPOSITORY INTAKE LINK]', round, settings)).toBe('https://csic.example/intake'));
  it('leaves an empty value unresolved', () => expect(resolveToken('[DEADLINE]', round, settings)).toBeUndefined());
  it('leaves an unset value unresolved', () => expect(resolveToken('[FORM LINK]', round, settings)).toBeUndefined());
  it('knows the seven setting tokens', () => expect(Object.keys(TOKENS)).toHaveLength(7));
});

describe('normalizeIdea', () => {
  it('fills defaults for a hand-written idea', () => {
    const idea = normalizeIdea({ id: 'CAFE-2026-001', title: 'Email scheduler', stage: 9 as never });
    expect(idea.stage).toBe(1);
    expect(idea.checklist).toEqual({});
    expect(idea.people.team).toEqual([]);
    expect(idea.flags).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `cd cafe-app && npx vitest run tests/rules.test.ts`
Expected: FAIL, "Failed to resolve import ../src/rules/stages".

- [ ] **Step 3: Write the implementation**

`cafe-app/src/rules/stages.ts`:
```ts
import { readYaml } from '../workspace/files';
import { paths } from '../workspace/paths';

export type Owner = 'Team' | 'TTIA';
export type StageNo = 1 | 2 | 3 | 4;

export interface StepDef {
  id: string;
  stage: StageNo;
  owner: Owner;
  text: string;
  needed: boolean;
  /** Template that drafts this step's email, or 'decision' for E3, E4, E5 or E6. */
  email?: string;
}

export const STAGE_NAMES: Record<StageNo, string> = {
  1: 'Submit Idea',
  2: 'Review and Select',
  3: 'Design series',
  4: 'Launch and Learn',
};

const step = (id: string, stage: StageNo, owner: Owner, text: string, needed: boolean, email?: string): StepDef =>
  email ? { id, stage, owner, text, needed, email } : { id, stage, owner, text, needed };

export const DEFAULT_STEPS: StepDef[] = [
  step('s1a', 1, 'Team', 'Idea and desired outcome written in their own words', true),
  step('s1b', 1, 'Team', 'No personal, client or third-party data in the form', true),
  step('s1c', 1, 'Team', 'Checked the Café use cases for something that already exists', false),
  step('s1d', 1, 'TTIA', 'Café ID given, duplicates checked', true),
  step('s1e', 1, 'TTIA', 'Acknowledgement sent', true, 'E1'),
  step('s2a', 2, 'TTIA', 'Feasibility assessed: Café proof of concept or CSIC', true),
  step('s2b', 2, 'TTIA', 'Theme tagged for a cohort', false),
  step('s2c', 2, 'TTIA', 'Questions sent to the team, if needed', false, 'E2'),
  step('s2d', 2, 'Team', 'Answers received', false),
  step('s2e', 2, 'Team', 'Builder named, can attend every session', true),
  step('s2f', 2, 'TTIA', 'Decision email sent', true, 'decision'),
  step('s3a', 3, 'Team', 'Attendance confirmed', false),
  step('s3b', 3, 'TTIA', 'Session invites sent', false, 'E7'),
  step('s3c', 3, 'Team', 'The one thing the proof of concept must show, written down', true),
  step('s3d', 3, 'Team', 'Smallest input picked, synthetic or aggregated data', true),
  step('s3e', 3, 'TTIA', 'Tool picked for each feature', true),
  step('s3f', 3, 'TTIA', 'design.md approved', true),
  step('s3g', 3, 'Team', 'Builder has access to the picked tools', false),
  step('s3h', 3, 'TTIA', 'Session follow-up sent', false, 'E8'),
  step('s3i', 3, 'TTIA', 'Route agreed and sent', true, 'E9'),
  step('s4a', 4, 'TTIA', 'Roadshow booked', true, 'E10'),
  step('s4b', 4, 'Team', 'Slides and demo link received', false),
  step('s4c', 4, 'Team', 'Demo given, and the room asked the four feedback questions', false),
  step('s4d', 4, 'Team', 'Reuse write-up received', false),
  step('s4e', 4, 'TTIA', 'Feedback and decision sent', true, 'E11'),
];

export function validateSteps(raw: unknown): StepDef[] {
  if (!Array.isArray(raw)) throw new Error('rules/stages.yaml: "steps" must be a list');
  const seen = new Set<string>();
  return raw.map((s, i) => {
    const st = s as Partial<StepDef>;
    const where = `rules/stages.yaml step ${i + 1}`;
    if (typeof st.id !== 'string' || !st.id) throw new Error(`${where}: missing id`);
    if (seen.has(st.id)) throw new Error(`rules/stages.yaml: duplicate step id ${st.id}`);
    seen.add(st.id);
    if (![1, 2, 3, 4].includes(Number(st.stage))) throw new Error(`${where} (${st.id}): stage must be 1, 2, 3 or 4`);
    if (st.owner !== 'Team' && st.owner !== 'TTIA') throw new Error(`${where} (${st.id}): owner must be Team or TTIA`);
    if (typeof st.text !== 'string' || !st.text) throw new Error(`${where} (${st.id}): missing text`);
    return step(st.id, Number(st.stage) as StageNo, st.owner, st.text, st.needed === true, st.email);
  });
}

export async function loadSteps(root: string): Promise<StepDef[]> {
  const file = await readYaml<{ steps?: unknown }>(paths(root).stages);
  return validateSteps(file?.steps ?? DEFAULT_STEPS);
}
```

`cafe-app/src/round/round.ts`:
```ts
import { formatDate } from '../clock';

export interface Round {
  id: string;
  open?: string;
  deadline?: string;
  reviewBy?: string;
  seriesStart?: string;
  roadshow?: string;
}

export interface Settings {
  operatorName?: string;
  formLink?: string;
  csicLink?: string;
  teamsLink?: string;
  distList?: string;
  deckTemplate?: string;
  capacity: { ideasPerRound: number; sessionsPerWeek: number };
}

export const DEFAULT_SETTINGS: Settings = { capacity: { ideasPerRound: 3, sessionsPerWeek: 2 } };

export const ROUND_FIELDS = [
  ['open', 'Round opens'],
  ['deadline', 'Submission deadline'],
  ['reviewBy', 'Decisions by'],
  ['seriesStart', 'Design series starts'],
  ['roadshow', 'Roadshow'],
] as const;

export const SETTING_FIELDS = [
  ['operatorName', 'Your name (email signature)'],
  ['formLink', 'Café form link'],
  ['csicLink', 'CSIC Repository intake link'],
  ['teamsLink', 'Teams link for sessions'],
  ['distList', 'Distribution list for the call for ideas'],
  ['deckTemplate', 'Firm deck template'],
] as const;

export interface TokenDef {
  from: 'round' | 'settings';
  key: string;
  label: string;
  date?: boolean;
}

export const TOKENS: Record<string, TokenDef> = {
  '[DEADLINE]': { from: 'round', key: 'deadline', label: 'Submission deadline', date: true },
  '[REVIEW DATE]': { from: 'round', key: 'reviewBy', label: 'Decisions by', date: true },
  '[FORM LINK]': { from: 'settings', key: 'formLink', label: 'Café form link' },
  '[CSIC REPOSITORY INTAKE LINK]': { from: 'settings', key: 'csicLink', label: 'CSIC Repository intake link' },
  '[ROOM OR TEAMS LINK]': { from: 'settings', key: 'teamsLink', label: 'Teams link for sessions' },
  '[DISTRIBUTION LIST]': { from: 'settings', key: 'distList', label: 'Distribution list for the call for ideas' },
  '[YOUR NAME]': { from: 'settings', key: 'operatorName', label: 'Your name (email signature)' },
};

export function resolveToken(token: string, round: Round, settings: Settings): string | undefined {
  const def = TOKENS[token];
  if (!def) return undefined;
  const source = (def.from === 'round' ? round : settings) as unknown as Record<string, unknown>;
  const value = source[def.key];
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  return def.date ? formatDate(value.trim()) : value.trim();
}
```

`cafe-app/src/ideas/idea.ts`:
```ts
import type { StageNo } from '../rules/stages';

export type Closure = 'reuse' | 'csic' | 'notnow' | 'pattern' | 'stop';

export const CLOSURE_LABELS: Record<Closure, string> = {
  reuse: 'Reuse',
  csic: 'Routed to CSIC',
  notnow: 'Not this round',
  pattern: 'Café pattern',
  stop: 'Stopped, learning kept',
};

export type PersonRole = 'lead' | 'sponsor' | 'member';

export interface Person {
  name: string;
  role: PersonRole;
  note?: string;
}

export interface StepState {
  done: boolean;
  by: 'operator' | 'app';
  at: string;
  source?: string;
}

export type Decision = 'select' | 'reuse' | 'csic' | 'notnow' | 'ask';

export interface ReviewRecord {
  criteria: Record<string, boolean>;
  decision: Decision;
  reason: string;
  at: string;
}

export interface Idea {
  id: string;
  slug: string;
  title: string;
  round: string;
  stage: StageNo;
  closed?: { as: Closure; at: string; followUp?: string };
  entity?: string;
  function?: string;
  region?: string;
  participation?: string;
  challenge?: string;
  outcomes: string[];
  current_process?: string;
  support: string[];
  experimented?: string;
  people: { submitter?: string; team: Person[] };
  checklist: Record<string, StepState>;
  /** step id → ISO due date */
  due: Record<string, string>;
  /** template id → ISO date it was marked sent */
  sent: Record<string, string>;
  review?: ReviewRecord;
  flags: string[];
  route?: string;
  source?: { file: string; row: number };
  dedupe_key: string;
}

export function normalizeIdea(raw: Partial<Idea>): Idea {
  const stage = Number(raw.stage);
  return {
    ...raw,
    id: String(raw.id ?? ''),
    slug: String(raw.slug ?? ''),
    title: String(raw.title ?? ''),
    round: String(raw.round ?? ''),
    stage: ([1, 2, 3, 4].includes(stage) ? stage : 1) as StageNo,
    outcomes: raw.outcomes ?? [],
    support: raw.support ?? [],
    people: { team: [], ...(raw.people ?? {}) },
    checklist: raw.checklist ?? {},
    due: raw.due ?? {},
    sent: raw.sent ?? {},
    flags: raw.flags ?? [],
    dedupe_key: String(raw.dedupe_key ?? ''),
  };
}
```

- [ ] **Step 4: Run the test and the type check**

Run: `cd cafe-app && npx vitest run tests/rules.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add cafe-app/src/rules cafe-app/src/round/round.ts cafe-app/src/ideas/idea.ts cafe-app/tests/rules.test.ts
git commit -m "cafe-app: steps, round, settings, tokens and idea model" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P3ov37P2fF1cuhtF4wyed3"
```

---

### Task 3: Email templates and rendering

**Files:**
- Create: `cafe-app/templates/{E0,E0B,E1,E2,E2R,E3,E4,E5,E6,E7,E8,E9,E10,E11,SR,RS,PD}.md`
- Create: `cafe-app/src/comms/templates.ts`
- Test: `cafe-app/tests/templates.test.ts`

**Interfaces:**
- Consumes: `TOKENS`, `resolveToken`, `Round`, `Settings` (Task 2); `Idea` (Task 2); `paths`, `BUNDLED_TEMPLATES` (Task 1).
- Produces:
  - `interface Template { id; title; step?; to: 'submitter'|'list'|'cohort'; subject; body }`
  - `SIGNATURE`
  - `parseTemplate(text, file)`, `loadTemplatesFrom(dir)`, `loadTemplates(root)` → `Record<string, Template>`
  - `interface RenderContext { idea?; round?; settings? }`
  - `fillText(text, ctx): string`
  - `analyse(view: {to, subject, body})` → `{ missingSettings: {token, label}[]; contentPlaceholders: string[] }`
  - `render(tpl, ctx)` → `{ to, subject, body, missingSettings, contentPlaceholders }`

Each template's `step` front-matter field is the checklist step its "mark sent" ticks: E1 s1e, E2 s2c, E3–E6 s2f, E7 s3b, E8 s3h, E9 s3i, E10 s4a, E11 s4e. E0, E0B, E2R, SR, RS and PD tick nothing.

- [ ] **Step 1: Write the template files**

Copy each file exactly. E1–E11 are the submitter playbook's emails.

`cafe-app/templates/E0.md`:
```markdown
---
id: E0
title: Call for ideas
to: list
subject: "Creators' Café: submit your idea by [DEADLINE]"
---
Hi all,

The CS TTIA Creators' Café is open for ideas until [DEADLINE].

Tell us one idea and the outcome you want, in your own words. We help you find the right tool, build a proof of concept with you in a small group, and show it at a roadshow.

Submit with "Submit your idea now": [FORM LINK] (Café page: http://cscreatorscafe/).

Please don't include personal, client or third-party data.
```

`cafe-app/templates/E0B.md`:
```markdown
---
id: E0B
title: Deadline reminder
to: list
subject: "Creators' Café: submissions close on [DEADLINE]"
---
Hi all,

A reminder: Creators' Café submissions close on [DEADLINE]. One idea and one outcome is enough: [FORM LINK]. Ideas are reviewed in the order they arrive.
```

`cafe-app/templates/E1.md`:
```markdown
---
id: E1
title: Idea received
step: s1e
to: submitter
subject: "Creators' Café: we have your idea ([CAFE ID])"
---
Hi [FIRST NAME],

Thanks for submitting "[IDEA TITLE]" to the CS TTIA Creators' Café. Your reference is [CAFE ID]; please quote it if you write to us about this idea.

What happens next:
1. We review ideas in the order they arrive, looking at whether a proof of concept is feasible and at themes shared with other ideas.
2. If we need more detail, we'll send you a few short questions.
3. We'll let you know the outcome by [REVIEW DATE].

While you wait, it's worth checking the use cases on the Café page in case something similar already exists.

Please don't send personal, client or third-party data at any stage. Synthetic or aggregated examples are enough for everything the Café does.
```

`cafe-app/templates/E2.md`:
```markdown
---
id: E2
title: A few questions
step: s2c
to: submitter
subject: "[CAFE ID]: a few questions about your idea"
---
Hi [FIRST NAME],

We've started reviewing "[IDEA TITLE]" and want to make sure we've understood it. Could you reply with short answers to these?

1. [QUESTION 1, e.g. Who would use it day to day: which team or role?]
2. [QUESTION 2, e.g. What does it replace today?]
3. [QUESTION 3, e.g. Who in your team would build the proof of concept?]

A sentence each is plenty. If you don't know an answer yet, say so; that helps us too. A reply by [REPLY DATE] lets us include it in this review round.

Please don't send personal, client or third-party data at any stage. Synthetic or aggregated examples are enough for everything the Café does.
```

`cafe-app/templates/E2R.md`:
```markdown
---
id: E2R
title: Reminder about our questions
to: submitter
subject: "[CAFE ID]: a reminder about our questions"
---
Hi [FIRST NAME],

We sent a few questions about "[IDEA TITLE]" a week ago. A short reply by [REPLY DATE] keeps it in this round. If now is not a good time, tell us and we'll hold it for the next round.
```

`cafe-app/templates/E3.md`:
```markdown
---
id: E3
title: Selected for the design series
step: s2f
to: submitter
subject: "[CAFE ID]: selected for the Creators' Café design series"
---
Hi [FIRST NAME],

Good news: "[IDEA TITLE]" has been selected for the Creators' Café design series. You'll join the [COHORT NAME] cohort with [NUMBER] other ideas around [THEME]. Ideas in a cohort share a need, so you'll learn from each other and may build one pattern instead of several.

Sessions:
- [DATE 1, TIME, ROOM OR TEAMS LINK]: [TOPIC 1]
- [DATE 2, TIME, ROOM OR TEAMS LINK]: [TOPIC 2]
- [DATE 3, TIME, ROOM OR TEAMS LINK]: [TOPIC 3]

Before the first session, please:
1. Name the person who will build the proof of concept and can attend every session.
2. Write down the one thing the proof of concept must show.
3. Pick the smallest input that shows it, such as one document set or one team's data, using synthetic or aggregated data.
4. Check that your builder has access to [TOOL]. If not, ask Tech Governance & Enablement.

Please reply by [DATE] with your builder's name and confirmation that you can attend.
```

`cafe-app/templates/E4.md`:
```markdown
---
id: E4
title: Reuse what exists
step: s2f
to: submitter
subject: "[CAFE ID]: something that already does this"
---
Hi [FIRST NAME],

Thanks for "[IDEA TITLE]". While reviewing it we found [EXISTING PATTERN OR TOOL], which already [WHAT IT DOES]. Reusing it should get you to your outcome sooner than building something new.

To start using it: [HOW TO GET ACCESS, OR WHO RUNS IT].

If you try it and it doesn't cover your need, reply with what's missing and we'll look at the idea again with that in mind. What you learn either way is useful to the Café, so we'd like to hear how it goes.
```

`cafe-app/templates/E5.md`:
```markdown
---
id: E5
title: Route to the CSIC Repository
step: s2f
to: submitter
subject: "[CAFE ID]: the right route for your idea is the CSIC Repository"
---
Hi [FIRST NAME],

Thanks for "[IDEA TITLE]". A Café proof of concept can't show it, because it [REASON: needs a live connection to a non-Microsoft system / needs personal, client or third-party data to work / needs a Technology squad before anything can be built].

That isn't a judgement on the idea. The CSIC Repository is where ideas like this get an owner, a controls review and a measured case for going ahead.

To take it there: [CSIC REPOSITORY INTAKE LINK]. You'll need to say what you want built, who would use it and what you expect it to change, and you'll need an MD sponsor who has agreed to sponsor it.
```

`cafe-app/templates/E6.md`:
```markdown
---
id: E6
title: Not in this round
step: s2f
to: submitter
subject: "[CAFE ID]: not in this round"
---
Hi [FIRST NAME],

Thanks for "[IDEA TITLE]". We couldn't include it in this round of the design series because [REASON].

What happens now: [CHOOSE ONE: we'll hold it for the next round, starting [DATE] / please resubmit when you can say (a) who would use it and (b) what it replaces].

If it helps, the questions we'd most want answered are:
- [QUESTION 1]
- [QUESTION 2]
```

`cafe-app/templates/E7.md`:
```markdown
---
id: E7
title: Session invite
step: s3b
to: cohort
subject: "Creators' Café design series: [COHORT NAME], session [N]: [TOPIC]"
---
Hi all,

Session [N] of the [COHORT NAME] design series:

When: [DATE, TIME]
Where: [ROOM OR TEAMS LINK]

Agenda:
1. [ITEM 1]
2. [ITEM 2]
3. [ITEM 3]

Please bring: [WHAT TO BRING, e.g. your one-sentence "what the proof of concept must show", and access to the tool you'll build in].

Builders should attend every session. If you can't make this one, reply and tell us who will come instead.

Please don't send personal, client or third-party data at any stage. Synthetic or aggregated examples are enough for everything the Café does.
```

`cafe-app/templates/E8.md`:
```markdown
---
id: E8
title: Session follow-up
step: s3h
to: submitter
subject: "[CAFE ID]: notes and next steps from session [N]"
---
Hi [FIRST NAME],

Thanks for session [N]. Here's what we agreed for "[IDEA TITLE]".

Decided:
- [DECISION 1, e.g. Feature 1 (FAQ answers) will be built in Copilot Studio]
- [DECISION 2]

Before the next session on [DATE]:
- [ACTION], owned by [NAME]
- [ACTION], owned by [NAME]

Still open:
- [OPEN QUESTION]

The design notes are attached: [FILE NAME]. Reply if anything here doesn't match what you remember.
```

`cafe-app/templates/E9.md`:
```markdown
---
id: E9
title: Where your idea goes next
step: s3i
to: submitter
subject: "[CAFE ID]: where your idea goes next"
---
Hi [FIRST NAME],

The design series for "[IDEA TITLE]" is done. Thanks for the work you and [BUILDER NAME] put in. Here's the route we agreed:

[REUSE] The proof of concept showed that [EXISTING PATTERN] already does the job. Next: adopt it, and send us a few lines on what you learned so other teams can find it.

[KEEP AS A CAFÉ PATTERN] It works and stays within your team, so [BUILDER NAME] finishes it as a [Citizen-Led / Assisted Citizen] build and owns it. Next: show it at a Launch and Learn roadshow. We'll send the details.

[TAKE TO THE CSIC REPOSITORY] It now needs more than the Café gives: [REASON: an owner other than the builder / users beyond your team / a controls review / a measured return]. Next: take it to the CSIC Repository with an MD sponsor at [CSIC REPOSITORY INTAKE LINK], and say it comes from a Café proof of concept.

[STOP, KEEP THE LEARNING] The proof of concept showed [WHAT IT SHOWED]. That's a useful result: it saves someone else trying the same thing. Next: send us a short write-up of what you learned by [DATE].
```

`cafe-app/templates/E10.md`:
```markdown
---
id: E10
title: Roadshow booked
step: s4a
to: submitter
subject: "[CAFE ID]: your Launch and Learn roadshow on [DATE]"
---
Hi [FIRST NAME],

You're presenting "[IDEA TITLE]" at the [ROADSHOW NAME] roadshow.

When: [DATE, TIME]
Where: [ROOM OR TEAMS LINK]
Your slot: [LENGTH] minutes, including questions

A structure that works in ten minutes:
1. The problem, in one sentence, the way the people who have it would say it.
2. What it replaces, shown: the old mailbox or spreadsheet.
3. The demo, on realistic but non-sensitive data.
4. What it took: which tool, which pathway, how long, what was hard.
5. What someone else would need to reuse it: licences, access, a builder, a data source.
6. One question you want the room to answer.

Please send your slides and a demo link by [DATE]. Dry run: [DATE, TIME], optional but recommended.
```

`cafe-app/templates/E11.md`:
```markdown
---
id: E11
title: Feedback and decision
step: s4e
to: submitter
subject: "[CAFE ID]: what the room said, and what happens next"
---
Hi [FIRST NAME],

Thanks for presenting "[IDEA TITLE]". Here's what we heard.

Teams with the same problem: [TEAMS, OR "none mentioned"]
What would stop people using it tomorrow: [BLOCKERS]
Asked for, not promised: [REQUESTS]
Data concerns raised: [CONCERNS, OR "none"]

What happens next: [CHOOSE ONE]
- It stays a Café pattern, owned by [BUILDER NAME]. We'll check in on [DATE].
- People outside your team want to use it, or someone will rely on it daily, so it goes to the CSIC Repository as a pilot, where it gets an owner, a stopping condition and a measure: [CSIC REPOSITORY INTAKE LINK].
- We retire it. Please send a short write-up of what you learned by [DATE].
```

`cafe-app/templates/SR.md`:
```markdown
---
id: SR
title: Session reminder
to: cohort
subject: "Reminder: Creators' Café [COHORT NAME], session [N] tomorrow"
---
Hi all,

A reminder that session [N] of the [COHORT NAME] design series is tomorrow.

When: [DATE, TIME]
Where: [ROOM OR TEAMS LINK]

Please bring: [WHAT TO BRING].
```

`cafe-app/templates/RS.md`:
```markdown
---
id: RS
title: Session moved
to: cohort
subject: "Creators' Café [COHORT NAME], session [N] has moved"
---
Hi all,

Session [N] of the [COHORT NAME] design series has moved.

Was: [OLD DATE, TIME]
Now: [NEW DATE, TIME]
Where: [ROOM OR TEAMS LINK]

Reason: [REASON]. If the new time doesn't work for your builder, reply and tell us who will come instead.
```

`cafe-app/templates/PD.md`:
```markdown
---
id: PD
title: Data held
to: submitter
subject: "[CAFE ID]: please send headings and counts, not the file"
---
Hi [FIRST NAME],

We received [FILE NAME], which contains [WHAT KIND OF DATA, e.g. names of people]. We deleted it without using it.

For the Café, [WHAT IS ENOUGH, e.g. the column headings and monthly counts per activity] is enough. Synthetic or aggregated examples work for everything the Café does.
```

- [ ] **Step 2: Write the failing test**

`cafe-app/tests/templates.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { loadTemplatesFrom, render, SIGNATURE } from '../src/comms/templates';
import { BUNDLED_TEMPLATES } from '../src/workspace/paths';
import { normalizeIdea } from '../src/ideas/idea';
import { DEFAULT_SETTINGS } from '../src/round/round';

const idea = normalizeIdea({
  id: 'CAFE-2026-001', slug: 'email-scheduler', title: 'Email scheduler', round: 'ROUND-2026-Q4',
  people: { submitter: 'Person 1', team: [] },
});
const round = { id: 'ROUND-2026-Q4', reviewBy: '2026-11-02' };
const settings = { ...DEFAULT_SETTINGS, operatorName: 'Café operator' };

describe('templates', () => {
  it('ships all 17 templates', async () => {
    const t = await loadTemplatesFrom(BUNDLED_TEMPLATES);
    expect(Object.keys(t).sort()).toEqual(
      ['E0', 'E0B', 'E1', 'E10', 'E11', 'E2', 'E2R', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'PD', 'RS', 'SR'],
    );
    expect(t.E5.step).toBe('s2f');
    expect(t.E2R.step).toBeUndefined();
  });

  it('fills idea values and leaves settings as placeholders', async () => {
    const { E1 } = await loadTemplatesFrom(BUNDLED_TEMPLATES);
    const r = render(E1, { idea });
    expect(r.subject).toBe("Creators' Café: we have your idea (CAFE-2026-001)");
    expect(r.body.startsWith('Hi Person,')).toBe(true);
    expect(r.body).toContain('[REVIEW DATE]');
    expect(r.to).toBe('Person 1');
    expect(r.missingSettings.map((m) => m.label)).toEqual(['Decisions by', 'Your name (email signature)']);
  });

  it('fills round and settings values once they are set', async () => {
    const { E1 } = await loadTemplatesFrom(BUNDLED_TEMPLATES);
    const r = render(E1, { idea, round, settings });
    expect(r.body).toContain('by 2 November 2026');
    expect(r.body).toContain('Café operator');
    expect(r.missingSettings).toEqual([]);
  });

  it('never invents a value', async () => {
    const t = await loadTemplatesFrom(BUNDLED_TEMPLATES);
    for (const tpl of Object.values(t)) {
      const r = render(tpl, {});
      expect(r.body).toBe(tpl.body + SIGNATURE);
      expect(`${r.subject}${r.body}${r.to}`).not.toMatch(/undefined|null/);
    }
    expect(render(t.E1, {}).to).toBe('[SUBMITTER]');
    expect(render(t.E0, {}).to).toBe('[DISTRIBUTION LIST]');
  });

  it('counts the content placeholders left for Outlook', async () => {
    const { E2 } = await loadTemplatesFrom(BUNDLED_TEMPLATES);
    expect(render(E2, { idea, round, settings }).contentPlaceholders).toHaveLength(4);
  });
});
```

- [ ] **Step 3: Run the test to see it fail**

Run: `cd cafe-app && npx vitest run tests/templates.test.ts`
Expected: FAIL, "Failed to resolve import ../src/comms/templates".

- [ ] **Step 4: Write the implementation**

`cafe-app/src/comms/templates.ts`:
```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { paths } from '../workspace/paths';
import { TOKENS, resolveToken, type Round, type Settings } from '../round/round';
import type { Idea } from '../ideas/idea';

export interface Template {
  id: string;
  title: string;
  step?: string;
  to: 'submitter' | 'list' | 'cohort';
  subject: string;
  body: string;
}

export const SIGNATURE = "\n\n[YOUR NAME]\nCS TTIA Creators' Café · http://cscreatorscafe/";

const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
const PLACEHOLDER = /\[[^\]\n]+\]/g;

export function parseTemplate(text: string, file: string): Template {
  const m = FRONT_MATTER.exec(text.replace(/\r\n/g, '\n'));
  if (!m) throw new Error(`${file}: missing front matter`);
  const meta = YAML.parse(m[1]) as Partial<Template>;
  if (!meta.id || !meta.title || !meta.to || !meta.subject) {
    throw new Error(`${file}: front matter needs id, title, to and subject`);
  }
  const tpl: Template = { id: meta.id, title: meta.title, to: meta.to, subject: meta.subject, body: m[2].trim() };
  if (meta.step) tpl.step = meta.step;
  return tpl;
}

export async function loadTemplatesFrom(dir: string): Promise<Record<string, Template>> {
  const out: Record<string, Template> = {};
  for (const name of (await fs.readdir(dir)).filter((n) => n.endsWith('.md')).sort()) {
    const tpl = parseTemplate(await fs.readFile(path.join(dir, name), 'utf8'), name);
    out[tpl.id] = tpl;
  }
  return out;
}

export const loadTemplates = (root: string) => loadTemplatesFrom(paths(root).templates);

export interface RenderContext {
  idea?: Idea;
  round?: Round;
  settings?: Settings;
}

export function fillText(text: string, ctx: RenderContext): string {
  let out = text;
  if (ctx.idea) {
    out = out.replaceAll('[CAFE ID]', ctx.idea.id).replaceAll('[IDEA TITLE]', ctx.idea.title);
    const first = ctx.idea.people.submitter?.trim().split(/\s+/)[0];
    if (first) out = out.replaceAll('[FIRST NAME]', first);
  }
  if (ctx.round && ctx.settings) {
    for (const token of Object.keys(TOKENS)) {
      const value = resolveToken(token, ctx.round, ctx.settings);
      if (value !== undefined) out = out.replaceAll(token, value);
    }
  }
  return out;
}

export function analyse(view: { to: string; subject: string; body: string }) {
  const all = `${view.to}\n${view.subject}\n${view.body}`;
  const missingSettings = Object.entries(TOKENS)
    .filter(([token]) => all.includes(token))
    .map(([token, def]) => ({ token, label: def.label }));
  const contentPlaceholders = [...new Set(all.match(PLACEHOLDER) ?? [])].filter((p) => !(p in TOKENS));
  return { missingSettings, contentPlaceholders };
}

function toLine(tpl: Template, idea?: Idea): string {
  if (tpl.to === 'list') return '[DISTRIBUTION LIST]';
  if (tpl.to === 'cohort') return '[COHORT MEMBERS]';
  return idea?.people.submitter?.trim() || '[SUBMITTER]';
}

export function render(tpl: Template, ctx: RenderContext) {
  const view = {
    to: fillText(toLine(tpl, ctx.idea), ctx),
    subject: fillText(tpl.subject, ctx),
    body: fillText(tpl.body + SIGNATURE, ctx),
  };
  return { ...view, ...analyse(view) };
}
```

- [ ] **Step 5: Run the test and the type check**

Run: `cd cafe-app && npx vitest run tests/templates.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add cafe-app/templates cafe-app/src/comms/templates.ts cafe-app/tests/templates.test.ts
git commit -m "cafe-app: email templates E0-E11, E2R, SR, RS, PD and rendering" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P3ov37P2fF1cuhtF4wyed3"
```

---

### Task 4: Workspace init, idea store and round store

**Files:**
- Create: `cafe-app/src/workspace/init.ts`, `cafe-app/src/ideas/store.ts`, `cafe-app/src/round/store.ts`
- Create: `cafe-app/tests/helpers.ts`
- Test: `cafe-app/tests/store.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 (`paths`, `BUNDLED_TEMPLATES`, `readYaml`, `writeYaml`, `DEFAULT_STEPS`, `DEFAULT_SETTINGS`, `ROUND_FIELDS`, `SETTING_FIELDS`, `Idea`, `normalizeIdea`).
- Produces:
  - `roundIdFor(iso)` → `'ROUND-2026-Q4'`
  - `initWorkspace(root, clock)` → `{ created: string[] }` (idempotent, never overwrites)
  - `ID_PATTERN`, `slugify(title)`, `nextId(existing, year)`
  - `ideaDir(root, id)`: throws "Not a Café ID: …" or "No idea …"
  - `saveIdea(root, idea)` → folder path
  - `loadIdea(root, id)`
  - `listIdeas(root)` → `{ ideas: Idea[]; problems: { folder; message }[] }`
  - `currentRoundId(root)`, `loadRound(root, id?)`, `saveRound(root, patch)`, `loadSettings(root)`, `saveSettings(root, patch)`
  - Test helpers: `tmpWorkspace(today?)`, `sampleIdea(over?)`, `FIXTURE`

- [ ] **Step 1: Write the helpers and the failing test**

`cafe-app/tests/helpers.ts`:
```ts
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
```

`cafe-app/tests/store.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mkdir, readdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpWorkspace, sampleIdea } from './helpers';
import { initWorkspace, roundIdFor } from '../src/workspace/init';
import { fixedClock } from '../src/clock';
import { slugify, nextId, saveIdea, loadIdea, listIdeas } from '../src/ideas/store';
import { loadRound, saveRound, loadSettings, saveSettings } from '../src/round/store';

describe('workspace', () => {
  it('creates the layout, rules, templates and a round', async () => {
    const root = await tmpWorkspace();
    expect((await readdir(root)).sort()).toEqual(
      ['cohorts', 'exports', 'graph', 'ideas', 'inbox', 'roadshows', 'rounds', 'rules', 'skills', 'templates'],
    );
    expect(await readdir(path.join(root, 'templates'))).toHaveLength(17);
    expect(await readdir(path.join(root, 'rounds'))).toEqual(['ROUND-2026-Q4']);
  });

  it('is safe to run twice and keeps edits', async () => {
    const root = await tmpWorkspace();
    await saveSettings(root, { operatorName: 'Café operator' });
    expect((await initWorkspace(root, fixedClock('2026-10-19'))).created).toEqual([]);
    expect((await loadSettings(root)).operatorName).toBe('Café operator');
  });

  it('names rounds by quarter', () => {
    expect(roundIdFor('2026-10-19')).toBe('ROUND-2026-Q4');
    expect(roundIdFor('2027-01-02')).toBe('ROUND-2027-Q1');
  });
});

describe('ideas', () => {
  it('makes slugs and the next ID', () => {
    expect(slugify('RFx CoE Intelligent Intake & Ticketing Agent')).toBe('rfx-coe-intelligent-intake-ticketing-agent');
    expect(nextId(['CAFE-2026-002', 'CAFE-2026-001', 'CAFE-2025-009'], 2026)).toBe('CAFE-2026-003');
    expect(nextId([], 2026)).toBe('CAFE-2026-001');
  });

  it('saves and loads an idea in its own folder', async () => {
    const root = await tmpWorkspace();
    const dir = await saveIdea(root, sampleIdea());
    expect(path.basename(dir)).toBe('CAFE-2026-001-email-scheduler');
    expect((await loadIdea(root, 'CAFE-2026-001')).title).toBe('Email scheduler');
  });

  it('refuses an ID that is not a Café ID', async () => {
    const root = await tmpWorkspace();
    await expect(loadIdea(root, '../../etc')).rejects.toThrow('Not a Café ID');
  });

  it('lists good ideas and reports a broken one', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea());
    const broken = path.join(root, 'ideas', 'CAFE-2026-002-broken');
    await mkdir(broken, { recursive: true });
    await writeFile(path.join(broken, 'idea.yaml'), 'title: [unclosed\n');
    const { ideas, problems } = await listIdeas(root);
    expect(ideas.map((i) => i.id)).toEqual(['CAFE-2026-001']);
    expect(problems.map((p) => p.folder)).toEqual(['CAFE-2026-002-broken']);
  });
});

describe('round and settings', () => {
  it('saves dates and clears an emptied one', async () => {
    const root = await tmpWorkspace();
    await saveRound(root, { deadline: '2026-11-01', reviewBy: '2026-11-15' });
    await saveRound(root, { deadline: '' });
    expect(await loadRound(root)).toEqual({ id: 'ROUND-2026-Q4', reviewBy: '2026-11-15' });
  });

  it('rejects a date that is not YYYY-MM-DD', async () => {
    const root = await tmpWorkspace();
    await expect(saveRound(root, { deadline: '19/10/2026' })).rejects.toThrow('Submission deadline must be a date');
  });

  it('ignores fields it does not know', async () => {
    const root = await tmpWorkspace();
    await saveRound(root, { id: 'ROUND-HACK', deadline: '2026-11-01' });
    expect((await loadRound(root)).id).toBe('ROUND-2026-Q4');
  });

  it('merges settings and checks capacity', async () => {
    const root = await tmpWorkspace();
    await saveSettings(root, { csicLink: 'https://csic.example/intake', capacity: { ideasPerRound: 4 } });
    const s = await loadSettings(root);
    expect(s.capacity).toEqual({ ideasPerRound: 4, sessionsPerWeek: 2 });
    await expect(saveSettings(root, { capacity: { sessionsPerWeek: 0 } })).rejects.toThrow('Sessions per week');
    expect(await readFile(path.join(root, 'rules', 'settings.yaml'), 'utf8')).toContain('csic.example');
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `cd cafe-app && npx vitest run tests/store.test.ts`
Expected: FAIL, "Failed to resolve import ../src/workspace/init".

- [ ] **Step 3: Write the implementation**

`cafe-app/src/round/store.ts`:
```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { paths } from '../workspace/paths';
import { readYaml, writeYaml } from '../workspace/files';
import { DEFAULT_SETTINGS, ROUND_FIELDS, SETTING_FIELDS, type Round, type Settings } from './round';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function currentRoundId(root: string): Promise<string> {
  const names = (await fs.readdir(paths(root).rounds).catch(() => [] as string[]))
    .filter((n) => n.startsWith('ROUND-'))
    .sort();
  const last = names.at(-1);
  if (!last) throw new Error('No round yet. Run "cafe init" first.');
  return last;
}

export async function loadRound(root: string, id?: string): Promise<Round> {
  const rid = id ?? (await currentRoundId(root));
  const raw = (await readYaml<Partial<Round>>(path.join(paths(root).rounds, rid, 'round.yaml'))) ?? {};
  return { ...raw, id: rid };
}

export async function saveRound(root: string, patch: Record<string, unknown>): Promise<Round> {
  const round = await loadRound(root);
  const next: Round = { ...round };
  for (const [key, label] of ROUND_FIELDS) {
    if (!(key in patch)) continue;
    const value = String(patch[key] ?? '').trim();
    if (value && (!DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))) {
      throw new Error(`${label} must be a date (YYYY-MM-DD)`);
    }
    if (value) next[key] = value;
    else delete next[key];
  }
  await writeYaml(path.join(paths(root).rounds, round.id, 'round.yaml'), next);
  return next;
}

export async function loadSettings(root: string): Promise<Settings> {
  const raw = (await readYaml<Partial<Settings>>(paths(root).settings)) ?? {};
  return { ...DEFAULT_SETTINGS, ...raw, capacity: { ...DEFAULT_SETTINGS.capacity, ...(raw.capacity ?? {}) } };
}

export async function saveSettings(root: string, patch: Record<string, unknown>): Promise<Settings> {
  const settings = await loadSettings(root);
  for (const [key] of SETTING_FIELDS) {
    if (!(key in patch)) continue;
    const value = String(patch[key] ?? '').trim();
    if (value) settings[key] = value;
    else delete settings[key];
  }
  const capacity = patch.capacity as Record<string, unknown> | undefined;
  if (capacity) {
    for (const key of ['ideasPerRound', 'sessionsPerWeek'] as const) {
      if (!(key in capacity)) continue;
      const n = Number(capacity[key]);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(`${key === 'ideasPerRound' ? 'Ideas per round' : 'Sessions per week'} must be a whole number of 1 or more`);
      }
      settings.capacity[key] = n;
    }
  }
  await writeYaml(paths(root).settings, settings);
  return settings;
}
```

`cafe-app/src/ideas/store.ts`:
```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { paths } from '../workspace/paths';
import { readYaml, writeYaml } from '../workspace/files';
import { normalizeIdea, type Idea } from './idea';

export const ID_PATTERN = /^CAFE-\d{4}-\d{3}$/;

export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '');
  return slug || 'idea';
}

export function nextId(existing: string[], year: number): string {
  const prefix = `CAFE-${year}-`;
  const max = existing
    .filter((id) => id.startsWith(prefix))
    .map((id) => Number(id.slice(prefix.length, prefix.length + 3)))
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

async function findFolder(root: string, id: string): Promise<string | undefined> {
  const base = paths(root).ideas;
  const names = await fs.readdir(base).catch(() => [] as string[]);
  const name = names.find((n) => n === id || n.startsWith(`${id}-`));
  return name ? path.join(base, name) : undefined;
}

export async function ideaDir(root: string, id: string): Promise<string> {
  if (!ID_PATTERN.test(id)) throw new Error(`Not a Café ID: ${id}`);
  const dir = await findFolder(root, id);
  if (!dir) throw new Error(`No idea ${id}`);
  return dir;
}

export async function saveIdea(root: string, idea: Idea): Promise<string> {
  if (!ID_PATTERN.test(idea.id)) throw new Error(`Not a Café ID: ${idea.id}`);
  const dir = (await findFolder(root, idea.id)) ?? path.join(paths(root).ideas, `${idea.id}-${idea.slug || 'idea'}`);
  await writeYaml(path.join(dir, 'idea.yaml'), idea);
  return dir;
}

export async function loadIdea(root: string, id: string): Promise<Idea> {
  const dir = await ideaDir(root, id);
  const raw = await readYaml<Partial<Idea>>(path.join(dir, 'idea.yaml'));
  if (!raw) throw new Error(`${path.basename(dir)}: idea.yaml is missing`);
  return normalizeIdea(raw);
}

export interface ListResult {
  ideas: Idea[];
  problems: { folder: string; message: string }[];
}

export async function listIdeas(root: string): Promise<ListResult> {
  const base = paths(root).ideas;
  const names = (await fs.readdir(base).catch(() => [] as string[])).filter((n) => /^CAFE-\d{4}-\d{3}/.test(n)).sort();
  const result: ListResult = { ideas: [], problems: [] };
  for (const folder of names) {
    try {
      const raw = await readYaml<Partial<Idea>>(path.join(base, folder, 'idea.yaml'));
      if (!raw) throw new Error('idea.yaml is missing');
      const idea = normalizeIdea(raw);
      if (!ID_PATTERN.test(idea.id) || !folder.startsWith(idea.id)) throw new Error(`id "${idea.id}" does not match the folder`);
      result.ideas.push(idea);
    } catch (e) {
      result.problems.push({ folder, message: (e as Error).message });
    }
  }
  return result;
}
```

`cafe-app/src/workspace/init.ts`:
```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { paths, BUNDLED_TEMPLATES } from './paths';
import { readYaml, writeYaml } from './files';
import { DEFAULT_STEPS } from '../rules/stages';
import { DEFAULT_SETTINGS } from '../round/round';
import type { Clock } from '../clock';

export function roundIdFor(iso: string): string {
  const [year, month] = iso.split('-').map(Number);
  return `ROUND-${year}-Q${Math.ceil(month / 3)}`;
}

export async function initWorkspace(root: string, clock: Clock): Promise<{ created: string[] }> {
  const p = paths(root);
  const created: string[] = [];
  for (const dir of [p.rounds, p.inbox, p.held, p.ideas, p.cohorts, p.roadshows, p.graph, p.templates, p.rules, p.exports, p.skills]) {
    await fs.mkdir(dir, { recursive: true });
  }
  if (!(await readYaml(p.stages))) {
    await writeYaml(p.stages, { steps: DEFAULT_STEPS });
    created.push('rules/stages.yaml');
  }
  if (!(await readYaml(p.settings))) {
    await writeYaml(p.settings, DEFAULT_SETTINGS);
    created.push('rules/settings.yaml');
  }
  for (const name of (await fs.readdir(BUNDLED_TEMPLATES)).filter((n) => n.endsWith('.md'))) {
    try {
      await fs.copyFile(path.join(BUNDLED_TEMPLATES, name), path.join(p.templates, name), fs.constants.COPYFILE_EXCL);
      created.push(`templates/${name}`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
  if ((await fs.readdir(p.rounds)).filter((n) => n.startsWith('ROUND-')).length === 0) {
    const id = roundIdFor(clock());
    await writeYaml(path.join(p.rounds, id, 'round.yaml'), { id });
    created.push(`rounds/${id}/round.yaml`);
  }
  return { created };
}
```

- [ ] **Step 4: Run all tests and the type check**

Run: `cd cafe-app && npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add cafe-app/src/workspace/init.ts cafe-app/src/ideas/store.ts cafe-app/src/round/store.ts cafe-app/tests/helpers.ts cafe-app/tests/store.test.ts
git commit -m "cafe-app: workspace init, idea store, round and settings store" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P3ov37P2fF1cuhtF4wyed3"
```

---

### Task 5: Checklist engine

**Files:**
- Create: `cafe-app/src/checklist/checklist.ts`
- Test: `cafe-app/tests/checklist.test.ts`

**Interfaces:**
- Consumes: `Idea`, `Closure`, `CLOSURE_LABELS`, `StepDef`, `STAGE_NAMES`, `loadIdea`, `saveIdea`, `ideaDir`, `appendHistory`, `Clock`.
- Produces:
  - `type StepStatus = 'done'|'open'|'n/a'`
  - `stepStatus(idea, step)`
  - `progress(idea, steps)` → `{ done, total, label }`. Example labels: "Design series · 12 of 25", "Closed · Routed to CSIC · 6 of 11".
  - `missingToAdvance(idea, steps): StepDef[]`
  - `withTick(idea, step, done, by, at, source?): Idea` (pure)
  - `tick(root, id, stepId, done, { by, source?, clock, steps })`: idempotent
  - `advance(root, id, steps, clock)`
  - `closeIdea(root, id, as, clock, followUp?)`

- [ ] **Step 1: Write the failing test**

`cafe-app/tests/checklist.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { tmpWorkspace, sampleIdea } from './helpers';
import { DEFAULT_STEPS as steps } from '../src/rules/stages';
import { progress, missingToAdvance, stepStatus, tick, advance, closeIdea } from '../src/checklist/checklist';
import { saveIdea, loadIdea } from '../src/ideas/store';
import { readHistory } from '../src/workspace/files';
import { fixedClock } from '../src/clock';

const clock = fixedClock('2026-10-19');
const done = (by: 'app' | 'operator' = 'operator') => ({ done: true, by, at: '2026-10-19' });

describe('progress', () => {
  it('counts a fresh idea', () => {
    expect(progress(sampleIdea(), steps).label).toBe('Submit Idea · 0 of 25');
  });

  it('marks later stages not applicable once closed', () => {
    const idea = sampleIdea({ stage: 2, closed: { as: 'csic', at: '2026-10-19' }, checklist: { s1d: done('app') } });
    expect(stepStatus(idea, steps.find((s) => s.id === 's3a')!)).toBe('n/a');
    expect(progress(idea, steps).label).toBe('Closed · Routed to CSIC · 1 of 11');
  });

  it('ignores step ids it does not know', () => {
    const idea = sampleIdea({ checklist: { s9z: done(), s1a: done() } });
    expect(progress(idea, steps).done).toBe(1);
  });

  it('lists the needed steps still open in this stage', () => {
    expect(missingToAdvance(sampleIdea(), steps).map((s) => s.id)).toEqual(['s1a', 's1b', 's1d', 's1e']);
  });
});

describe('tick and advance', () => {
  it('logs a tick once, however often it is clicked', async () => {
    const root = await tmpWorkspace();
    const dir = await saveIdea(root, sampleIdea());
    await tick(root, 'CAFE-2026-001', 's1a', true, { by: 'operator', clock, steps });
    await tick(root, 'CAFE-2026-001', 's1a', true, { by: 'operator', clock, steps });
    expect((await readHistory(dir)).filter((h) => h.action === 'tick')).toHaveLength(1);
    expect((await loadIdea(root, 'CAFE-2026-001')).checklist.s1a.by).toBe('operator');
  });

  it('refuses an unknown step', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea());
    await expect(tick(root, 'CAFE-2026-001', 's9z', true, { by: 'operator', clock, steps })).rejects.toThrow('Unknown step s9z');
  });

  it('will not advance while needed steps are open', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea());
    await expect(advance(root, 'CAFE-2026-001', steps, clock)).rejects.toThrow(/Still needed before Review and Select/);
  });

  it('advances once the needed steps are done, and logs it', async () => {
    const root = await tmpWorkspace();
    const dir = await saveIdea(root, sampleIdea({ checklist: { s1a: done(), s1b: done(), s1d: done('app'), s1e: done('app') } }));
    expect((await advance(root, 'CAFE-2026-001', steps, clock)).stage).toBe(2);
    expect((await readHistory(dir)).at(-1)).toMatchObject({ action: 'advance', detail: 'Review and Select' });
  });

  it('closes an idea with a follow-up date', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea({ stage: 2 }));
    const idea = await closeIdea(root, 'CAFE-2026-001', 'csic', clock, '2026-11-16');
    expect(idea.closed).toEqual({ as: 'csic', at: '2026-10-19', followUp: '2026-11-16' });
    await expect(advance(root, 'CAFE-2026-001', steps, clock)).rejects.toThrow('is closed');
    expect(path.basename(root)).toMatch(/^cafe-ws-/);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `cd cafe-app && npx vitest run tests/checklist.test.ts`
Expected: FAIL, "Failed to resolve import ../src/checklist/checklist".

- [ ] **Step 3: Write the implementation**

`cafe-app/src/checklist/checklist.ts`:
```ts
import { CLOSURE_LABELS, type Closure, type Idea } from '../ideas/idea';
import { STAGE_NAMES, type StageNo, type StepDef } from '../rules/stages';
import { loadIdea, saveIdea, ideaDir } from '../ideas/store';
import { appendHistory } from '../workspace/files';
import type { Clock } from '../clock';

export type StepStatus = 'done' | 'open' | 'n/a';

export function stepStatus(idea: Idea, step: StepDef): StepStatus {
  if (idea.checklist[step.id]?.done) return 'done';
  if (idea.closed && step.stage > idea.stage) return 'n/a';
  return 'open';
}

export function progress(idea: Idea, steps: StepDef[]): { done: number; total: number; label: string } {
  const applicable = steps.filter((s) => stepStatus(idea, s) !== 'n/a');
  const done = applicable.filter((s) => stepStatus(idea, s) === 'done').length;
  const where = idea.closed ? `Closed · ${CLOSURE_LABELS[idea.closed.as]}` : STAGE_NAMES[idea.stage];
  return { done, total: applicable.length, label: `${where} · ${done} of ${applicable.length}` };
}

export function missingToAdvance(idea: Idea, steps: StepDef[]): StepDef[] {
  return steps.filter((s) => s.stage === idea.stage && s.needed && !idea.checklist[s.id]?.done);
}

export function withTick(
  idea: Idea, step: StepDef, done: boolean, by: 'operator' | 'app', at: string, source?: string,
): Idea {
  const state = source ? { done, by, at, source } : { done, by, at };
  return { ...idea, checklist: { ...idea.checklist, [step.id]: state } };
}

export async function tick(
  root: string, id: string, stepId: string, done: boolean,
  opts: { by: 'operator' | 'app'; source?: string; clock: Clock; steps: StepDef[] },
): Promise<Idea> {
  const step = opts.steps.find((s) => s.id === stepId);
  if (!step) throw new Error(`Unknown step ${stepId}`);
  const idea = await loadIdea(root, id);
  if (Boolean(idea.checklist[stepId]?.done) === done) return idea;
  const at = opts.clock();
  const next = withTick(idea, step, done, opts.by, at, opts.source);
  await saveIdea(root, next);
  await appendHistory(await ideaDir(root, id), {
    at, action: done ? 'tick' : 'untick', by: opts.by, step: stepId, ...(opts.source ? { source: opts.source } : {}),
  });
  return next;
}

export async function advance(root: string, id: string, steps: StepDef[], clock: Clock): Promise<Idea> {
  const idea = await loadIdea(root, id);
  if (idea.closed) throw new Error(`${id} is closed (${CLOSURE_LABELS[idea.closed.as]})`);
  if (idea.stage === 4) throw new Error(`${id} is already at the last stage`);
  const target = (idea.stage + 1) as StageNo;
  const missing = missingToAdvance(idea, steps);
  if (missing.length) {
    throw new Error(`Still needed before ${STAGE_NAMES[target]}: ${missing.map((s) => s.text).join('; ')}`);
  }
  const next: Idea = { ...idea, stage: target };
  await saveIdea(root, next);
  await appendHistory(await ideaDir(root, id), { at: clock(), action: 'advance', by: 'operator', detail: STAGE_NAMES[target] });
  return next;
}

export async function closeIdea(root: string, id: string, as: Closure, clock: Clock, followUp?: string): Promise<Idea> {
  const idea = await loadIdea(root, id);
  const at = clock();
  const next: Idea = { ...idea, closed: followUp ? { as, at, followUp } : { as, at } };
  await saveIdea(root, next);
  await appendHistory(await ideaDir(root, id), { at, action: 'close', by: 'operator', detail: CLOSURE_LABELS[as] });
  return next;
}
```

- [ ] **Step 4: Run all tests and the type check**

Run: `cd cafe-app && npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add cafe-app/src/checklist cafe-app/tests/checklist.test.ts
git commit -m "cafe-app: checklist ticks, progress, stage gating and closing" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P3ov37P2fF1cuhtF4wyed3"
```

---

### Task 6: Import the SharePoint or Forms export

**Files:**
- Create: `cafe-app/src/import/readExport.ts`, `cafe-app/src/import/columns.ts`, `cafe-app/src/import/importRows.ts`
- Create: `cafe-app/tests/fixtures/sample-export.csv`
- Test: `cafe-app/tests/import.test.ts`

**Interfaces:**
- Consumes: `listIdeas`, `saveIdea`, `slugify`, `nextId`, `normalizeIdea`, `currentRoundId`, `withTick`, `appendHistory`, `StepDef`, `Clock`, `Person`.
- Produces:
  - `interface Table { header: string[]; rows: string[][] }`, `readTable(file)`
  - `type Field`, `COLUMNS`, `mapHeader(header)` → `{ index, unknown }`
  - `splitMulti(v)`, `parseSubmitter(v)`, `parseTeam(v)`
  - `interface ImportReport { created: {id, title}[]; duplicates: {row, id, title}[]; errors: {row, message}[]; flags: {id, message}[]; ignoredColumns: string[] }`
  - `importExport(root, file, { clock, steps })` → `ImportReport`

Row numbers in reports count the header as row 1, matching what the operator sees in Excel.

- [ ] **Step 1: Write the fixture**

The fixture is the three real submissions with every person replaced by a numbered placeholder and the free text shortened. It has one extra column (`ID`), the long form of the experimented header, two cut-off values and one row with no title.

`cafe-app/tests/fixtures/sample-export.csv`:
```csv
ID,Title,Submitter Name,CS Function,Region,Participation Type,Team Members and Lead,Business Challenge,Desired Outcomes,Current Process,Support Requested,Have you already experimented with AI for this idea?
1,Email scheduler,Person 1 (CS),BSI,AMER,Individual,,Arranging meetings takes many back-and-forth emails.,;#Save time;#Improve quality;#,Emails go back and forth until a time suits everyone.,;#Agent Design Guidance;#AI Solution Brainstorming;#,Yes
2,RFx CoE Intelligent Intake & Ticketing Agent,Person 2 (CS),GSS,APAC,Team,Person 2 (Lead); Person 3 (Sponsor); Person 4,"Requests arrive in a shared mailbox, are re-keyed into an Excel tracker, and status is chased by hand.",;#Save time;#Improve visibility;#,"Read each email, type it into the tracker, reply by hand.",;#Agent Design Guidance;#Collab…;#,No
3,Third Party Invoice Assessment,Person 5 (CS),GSS,APAC,Individual,Person 5; Person 6; Person 7; Person 8; Person 9; Person 10,Each third-party invoice is researched by hand to find its category and risk record.,;#Save time;#Imp…;#,"Open the invoice, translate it, look up the category and the risk record.",;#AI Solution Brainstorming;#,Yes
4,,Person 11 (CS),BSI,AMER,Individual,,No title given,,,,No
```

- [ ] **Step 2: Write the failing test**

`cafe-app/tests/import.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { tmpWorkspace, FIXTURE } from './helpers';
import { importExport } from '../src/import/importRows';
import { parseTeam, splitMulti, parseSubmitter } from '../src/import/columns';
import { listIdeas, loadIdea } from '../src/ideas/store';
import { DEFAULT_STEPS as steps } from '../src/rules/stages';
import { fixedClock } from '../src/clock';

const opts = { clock: fixedClock('2026-10-19'), steps };

describe('parsing', () => {
  it('splits SharePoint multi-select values', () => {
    expect(splitMulti(';#Save time;#Improve quality;#')).toEqual(['Save time', 'Improve quality']);
    expect(splitMulti('')).toEqual([]);
  });

  it('reads the submitter and their organisation', () => {
    expect(parseSubmitter('Person 1 (CS)')).toEqual({ name: 'Person 1', entity: 'CS' });
  });

  it('reads team roles from the form wording', () => {
    expect(parseTeam('Person 2 (Lead); Person 3 (Sponsor); Person 4')).toEqual([
      { name: 'Person 2', role: 'lead', note: 'Lead' },
      { name: 'Person 3', role: 'sponsor', note: 'Sponsor' },
      { name: 'Person 4', role: 'member' },
    ]);
    expect(parseTeam('Person 6 - Team lead\nAnne-Marie Person')).toEqual([
      { name: 'Person 6', role: 'lead', note: 'Team lead' },
      { name: 'Anne-Marie Person', role: 'member' },
    ]);
  });
});

describe('importExport', () => {
  it('imports the three real submissions and reports the rest', async () => {
    const root = await tmpWorkspace();
    const r = await importExport(root, FIXTURE, opts);
    expect(r.created.map((c) => c.id)).toEqual(['CAFE-2026-001', 'CAFE-2026-002', 'CAFE-2026-003']);
    expect(r.errors).toEqual([{ row: 5, message: 'Title is empty' }]);
    expect(r.ignoredColumns).toEqual(['ID']);
    expect(r.flags.filter((f) => f.id === 'CAFE-2026-003').map((f) => f.message)).toEqual([
      'Cut off in the export, check the full text: Desired Outcomes ";#Save time;#Imp…;#"',
      'Participation is Individual but 6 people are listed',
    ]);

    const rfx = await loadIdea(root, 'CAFE-2026-002');
    expect(rfx).toMatchObject({ function: 'GSS', region: 'APAC', entity: 'CS', round: 'ROUND-2026-Q4', stage: 1 });
    expect(rfx.people.submitter).toBe('Person 2');
    expect(rfx.people.team.map((p) => p.role)).toEqual(['lead', 'sponsor', 'member']);
    expect(rfx.support).toEqual(['Agent Design Guidance', 'Collab…']);
    expect(rfx.experimented).toBe('No');
    expect(rfx.checklist.s1d).toEqual({ done: true, by: 'app', at: '2026-10-19', source: 'sample-export.csv row 3' });
  });

  it('never imports the same row twice', async () => {
    const root = await tmpWorkspace();
    await importExport(root, FIXTURE, opts);
    const again = await importExport(root, FIXTURE, opts);
    expect(again.created).toEqual([]);
    expect(again.duplicates.map((d) => d.id)).toEqual(['CAFE-2026-001', 'CAFE-2026-002', 'CAFE-2026-003']);
    expect((await listIdeas(root)).ideas).toHaveLength(3);
  });

  it('maps columns by name, in any order', async () => {
    const root = await tmpWorkspace();
    const rows = parse(await readFile(FIXTURE), { bom: true }) as string[][];
    const reversed = rows.map((r) => [...r].reverse());
    const file = path.join(root, 'inbox', 'reordered.csv');
    await writeFile(file, reversed.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n'));
    const r = await importExport(root, file, opts);
    expect(r.created.map((c) => c.title)).toEqual([
      'Email scheduler', 'RFx CoE Intelligent Intake & Ticketing Agent', 'Third Party Invoice Assessment',
    ]);
  });

  it('reads an .xlsx export the same way', async () => {
    const root = await tmpWorkspace();
    const rows = parse(await readFile(FIXTURE), { bom: true }) as string[][];
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Ideas');
    rows.forEach((r) => ws.addRow(r));
    const file = path.join(root, 'inbox', 'export.xlsx');
    await wb.xlsx.writeFile(file);
    const r = await importExport(root, file, opts);
    expect(r.created).toHaveLength(3);
    expect((await loadIdea(root, 'CAFE-2026-001')).support).toEqual(['Agent Design Guidance', 'AI Solution Brainstorming']);
  });

  it('refuses a file with no Title column and writes nothing', async () => {
    const root = await tmpWorkspace();
    const file = path.join(root, 'inbox', 'wrong.csv');
    await writeFile(file, 'Name,Region\nX,AMER\n');
    await expect(importExport(root, file, opts)).rejects.toThrow('has no Title column');
    expect((await listIdeas(root)).ideas).toEqual([]);
  });

  it('refuses a file type it cannot read', async () => {
    const root = await tmpWorkspace();
    const file = path.join(root, 'inbox', 'notes.txt');
    await writeFile(file, 'hello');
    await expect(importExport(root, file, opts)).rejects.toThrow('use a .csv or .xlsx export');
  });
});
```

- [ ] **Step 3: Run the test to see it fail**

Run: `cd cafe-app && npx vitest run tests/import.test.ts`
Expected: FAIL, "Failed to resolve import ../src/import/importRows".

- [ ] **Step 4: Write the implementation**

`cafe-app/src/import/readExport.ts`:
```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';

export interface Table {
  header: string[];
  rows: string[][];
}

export async function readTable(file: string): Promise<Table> {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.csv') {
    const records = parse(await fs.readFile(file), { bom: true, relax_column_count: true, skip_empty_lines: true }) as string[][];
    const [header = [], ...rows] = records;
    return { header: header.map((h) => h.trim()), rows };
  }
  if (ext === '.xlsx') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.worksheets[0];
    if (!ws) return { header: [], rows: [] };
    const all: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) cells.push(row.getCell(c).text ?? '');
      all.push(cells);
    });
    const [header = [], ...rows] = all;
    return { header: header.map((h) => h.trim()), rows };
  }
  throw new Error(`Can't read ${path.basename(file)}: use a .csv or .xlsx export`);
}
```

`cafe-app/src/import/columns.ts`:
```ts
import type { Person, PersonRole } from '../ideas/idea';

export type Field =
  | 'title' | 'submitter' | 'function' | 'region' | 'participation' | 'team'
  | 'challenge' | 'outcomes' | 'current_process' | 'support' | 'experimented';

export const COLUMNS: { prefix: string; field: Field; label: string }[] = [
  { prefix: 'title', field: 'title', label: 'Title' },
  { prefix: 'submitter name', field: 'submitter', label: 'Submitter Name' },
  { prefix: 'cs function', field: 'function', label: 'CS Function' },
  { prefix: 'region', field: 'region', label: 'Region' },
  { prefix: 'participation type', field: 'participation', label: 'Participation Type' },
  { prefix: 'team members', field: 'team', label: 'Team Members and Lead' },
  { prefix: 'business challenge', field: 'challenge', label: 'Business Challenge' },
  { prefix: 'desired outcome', field: 'outcomes', label: 'Desired Outcomes' },
  { prefix: 'current process', field: 'current_process', label: 'Current Process' },
  { prefix: 'support requested', field: 'support', label: 'Support Requested' },
  { prefix: 'have you already experimented', field: 'experimented', label: 'Have you already experimented' },
];

export function mapHeader(header: string[]): { index: Partial<Record<Field, number>>; unknown: string[] } {
  const index: Partial<Record<Field, number>> = {};
  const unknown: string[] = [];
  header.forEach((h, i) => {
    const col = COLUMNS.find((c) => h.trim().toLowerCase().startsWith(c.prefix));
    if (!col) unknown.push(h);
    else if (index[col.field] === undefined) index[col.field] = i;
  });
  return { index, unknown };
}

export function splitMulti(value: string): string[] {
  return value.split(';#').map((s) => s.trim()).filter(Boolean);
}

export function parseSubmitter(value: string): { name?: string; entity?: string } {
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(value.trim());
  if (m) return { ...(m[1].trim() ? { name: m[1].trim() } : {}), entity: m[2].trim() };
  return value.trim() ? { name: value.trim() } : {};
}

export function parseTeam(value: string): Person[] {
  return value
    .split(/[;\n]+/)
    .map((s) => s.replace(/^#/, '').trim())
    .filter(Boolean)
    .map((part) => {
      const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(part) ?? /^(.*?)\s+[-–:]\s+(.+)$/.exec(part);
      const name = (m ? m[1] : part).trim();
      const note = m?.[2]?.trim();
      const role: PersonRole = /sponsor/i.test(note ?? '') ? 'sponsor' : /lead/i.test(note ?? '') ? 'lead' : 'member';
      return note ? { name, role, note } : { name, role };
    });
}
```

`cafe-app/src/import/importRows.ts`:
```ts
import path from 'node:path';
import { readTable } from './readExport';
import { COLUMNS, mapHeader, parseSubmitter, parseTeam, splitMulti, type Field } from './columns';
import { listIdeas, nextId, saveIdea, slugify } from '../ideas/store';
import { normalizeIdea } from '../ideas/idea';
import { currentRoundId } from '../round/store';
import { withTick } from '../checklist/checklist';
import { appendHistory } from '../workspace/files';
import type { StepDef } from '../rules/stages';
import type { Clock } from '../clock';

export interface ImportReport {
  created: { id: string; title: string }[];
  duplicates: { row: number; id: string; title: string }[];
  errors: { row: number; message: string }[];
  flags: { id: string; message: string }[];
  ignoredColumns: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const CUT_OFF = /…|\.{3}/;
const opt = (v: string) => (v ? v : undefined);

export async function importExport(
  root: string, file: string, opts: { clock: Clock; steps: StepDef[] },
): Promise<ImportReport> {
  const name = path.basename(file);
  const table = await readTable(file);
  const { index, unknown } = mapHeader(table.header);
  if (index.title === undefined) {
    throw new Error(`${name} has no Title column, so nothing was imported. Columns found: ${table.header.join(', ') || 'none'}`);
  }
  const round = await currentRoundId(root);
  const { ideas } = await listIdeas(root);
  const byKey = new Map(ideas.map((i) => [i.dedupe_key, i.id]));
  const ids = ideas.map((i) => i.id);
  const year = Number(opts.clock().slice(0, 4));
  const s1d = opts.steps.find((s) => s.id === 's1d');
  const report: ImportReport = { created: [], duplicates: [], errors: [], flags: [], ignoredColumns: unknown };

  for (const [i, row] of table.rows.entries()) {
    const rowNo = i + 2;
    if (row.every((c) => !c?.trim())) continue;
    const get = (f: Field) => {
      const ix = index[f];
      return ix === undefined ? '' : (row[ix] ?? '').trim();
    };
    const title = get('title');
    if (!title) {
      report.errors.push({ row: rowNo, message: 'Title is empty' });
      continue;
    }
    const submitter = parseSubmitter(get('submitter'));
    const key = `${norm(title)}|${norm(submitter.name ?? '')}`;
    const existing = byKey.get(key);
    if (existing) {
      report.duplicates.push({ row: rowNo, id: existing, title });
      continue;
    }

    const id = nextId(ids, year);
    ids.push(id);
    const team = parseTeam(get('team'));
    const participation = get('participation');
    const flags: string[] = [];
    for (const c of COLUMNS) {
      const v = get(c.field);
      if (CUT_OFF.test(v)) flags.push(`Cut off in the export, check the full text: ${c.label} "${v}"`);
    }
    if (/individual/i.test(participation) && team.length > 1) {
      flags.push(`Participation is Individual but ${team.length} people are listed`);
    }

    const source = `${name} row ${rowNo}`;
    const at = opts.clock();
    let idea = normalizeIdea({
      id, slug: slugify(title), title, round, stage: 1,
      entity: submitter.entity,
      function: opt(get('function')),
      region: opt(get('region')),
      participation: opt(participation),
      challenge: opt(get('challenge')),
      outcomes: splitMulti(get('outcomes')),
      current_process: opt(get('current_process')),
      support: splitMulti(get('support')),
      experimented: opt(get('experimented')),
      people: { submitter: submitter.name, team },
      flags,
      source: { file: name, row: rowNo },
      dedupe_key: key,
    });
    if (s1d) idea = withTick(idea, s1d, true, 'app', at, source);
    const dir = await saveIdea(root, idea);
    await appendHistory(dir, { at, action: 'created', by: 'app', source });
    if (s1d) await appendHistory(dir, { at, action: 'tick', by: 'app', step: 's1d', source });

    byKey.set(key, id);
    report.created.push({ id, title });
    for (const message of flags) report.flags.push({ id, message });
  }
  return report;
}
```

- [ ] **Step 5: Run all tests and the type check**

Run: `cd cafe-app && npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add cafe-app/src/import cafe-app/tests/import.test.ts cafe-app/tests/fixtures/sample-export.csv
git commit -m "cafe-app: import SharePoint/Forms exports (.csv, .xlsx) with dedupe and flags" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P3ov37P2fF1cuhtF4wyed3"
```

---

### Task 7: Outbox: draft, approve, mark sent

**Files:**
- Create: `cafe-app/src/comms/outbox.ts`
- Test: `cafe-app/tests/outbox.test.ts`

**Interfaces:**
- Consumes: `loadTemplates`, `render`, `fillText`, `analyse` (Task 3); `loadIdea`, `saveIdea`, `ideaDir` (Task 4); `currentRoundId`, `loadRound`, `loadSettings` (Task 4); `withTick` (Task 5); `plusDays`; `writeFileAtomic`, `readText`, `appendHistory`.
- Produces:
  - `type EmailStatus = 'draft'|'approved'|'sent'`
  - `interface EmailRecord { key; template; idea?; round; status; created; approvedAt?; sentAt?; to; subject; body }`
  - `interface OutboxItem extends EmailRecord { view: {to, subject, body}; missingSettings; contentPlaceholders }`
  - `class MissingSettingsError extends Error { labels: string[] }`, with message "Set first: …"
  - `draftEmail(root, { template, ideaId? }, clock)`: returns the existing unsent draft of the same template instead of making a second one
  - `listOutbox(root)`, `approve(root, key, clock)`, `markSent(root, key, clock, steps)`, `updateDraft(root, key, { subject?, body? })`

Storage: one Markdown file per email, `ideas/<folder>/emails/NNN-<template>.md`, or `rounds/<round>/emails/NNN-<template>.md` for E0 and E0B. Front matter holds the record; the body follows. The `key` is the path relative to the workspace, with `/` separators. Drafts store idea values only. Round dates and settings are filled each time the Outbox is read, and frozen into the file on approval.

- [ ] **Step 1: Write the failing test**

`cafe-app/tests/outbox.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpWorkspace, sampleIdea } from './helpers';
import { saveIdea, loadIdea } from '../src/ideas/store';
import { saveRound, saveSettings } from '../src/round/store';
import { draftEmail, listOutbox, approve, markSent, updateDraft, MissingSettingsError } from '../src/comms/outbox';
import { readHistory } from '../src/workspace/files';
import { DEFAULT_STEPS as steps } from '../src/rules/stages';
import { fixedClock } from '../src/clock';

const clock = fixedClock('2026-10-19');

async function setup() {
  const root = await tmpWorkspace();
  const dir = await saveIdea(root, sampleIdea());
  return { root, dir };
}

describe('outbox', () => {
  it('drafts an email into the idea folder, once', async () => {
    const { root } = await setup();
    const a = await draftEmail(root, { template: 'E1', ideaId: 'CAFE-2026-001' }, clock);
    const b = await draftEmail(root, { template: 'E1', ideaId: 'CAFE-2026-001' }, clock);
    expect(a.key).toBe('ideas/CAFE-2026-001-email-scheduler/emails/001-E1.md');
    expect(b.key).toBe(a.key);
    expect(a).toMatchObject({ status: 'draft', to: 'Person 1', subject: "Creators' Café: we have your idea (CAFE-2026-001)" });
  });

  it('blocks approval until the settings it needs are set', async () => {
    const { root } = await setup();
    const { key } = await draftEmail(root, { template: 'E1', ideaId: 'CAFE-2026-001' }, clock);
    const err = await approve(root, key, clock).catch((e) => e);
    expect(err).toBeInstanceOf(MissingSettingsError);
    expect(err.message).toBe('Set first: Decisions by, Your name (email signature)');
    const [item] = await listOutbox(root);
    expect(item.missingSettings.map((m) => m.label)).toEqual(['Decisions by', 'Your name (email signature)']);
  });

  it('fills settings into drafts, and freezes them on approval', async () => {
    const { root } = await setup();
    const { key } = await draftEmail(root, { template: 'E1', ideaId: 'CAFE-2026-001' }, clock);
    await saveRound(root, { reviewBy: '2026-11-02' });
    await saveSettings(root, { operatorName: 'Café operator' });
    expect((await listOutbox(root))[0].view.body).toContain('by 2 November 2026');
    const approved = await approve(root, key, clock);
    expect(approved.status).toBe('approved');
    await saveRound(root, { reviewBy: '2026-11-09' });
    const [item] = await listOutbox(root);
    expect(item.view.body).toContain('by 2 November 2026');
    expect(await readFile(path.join(root, ...key.split('/')), 'utf8')).toContain('2 November 2026');
  });

  it('shows a new setting in open drafts', async () => {
    const { root } = await setup();
    await draftEmail(root, { template: 'E1', ideaId: 'CAFE-2026-001' }, clock);
    await saveRound(root, { reviewBy: '2026-11-02' });
    expect((await listOutbox(root))[0].view.body).toContain('2 November 2026');
    await saveRound(root, { reviewBy: '2026-11-09' });
    expect((await listOutbox(root))[0].view.body).toContain('9 November 2026');
  });

  it('marks sent only after approval, ticks the step once, and records the date', async () => {
    const { root, dir } = await setup();
    await saveRound(root, { reviewBy: '2026-11-02' });
    await saveSettings(root, { operatorName: 'Café operator' });
    const { key } = await draftEmail(root, { template: 'E1', ideaId: 'CAFE-2026-001' }, clock);
    await expect(markSent(root, key, clock, steps)).rejects.toThrow('Approve the email before marking it as sent');
    await approve(root, key, clock);
    const sent = await markSent(root, key, clock, steps);
    const again = await markSent(root, key, fixedClock('2026-10-25'), steps);
    expect(again.sentAt).toBe(sent.sentAt);
    const idea = await loadIdea(root, 'CAFE-2026-001');
    expect(idea.checklist.s1e).toEqual({ done: true, by: 'app', at: '2026-10-19', source: key });
    expect(idea.sent.E1).toBe('2026-10-19');
    expect((await readHistory(dir)).filter((h) => h.action === 'tick' && h.step === 's1e')).toHaveLength(1);
  });

  it('starts a five-day reply clock when E2 is sent', async () => {
    const { root } = await setup();
    await saveSettings(root, { operatorName: 'Café operator' });
    const { key } = await draftEmail(root, { template: 'E2', ideaId: 'CAFE-2026-001' }, clock);
    await approve(root, key, clock);
    await markSent(root, key, clock, steps);
    const idea = await loadIdea(root, 'CAFE-2026-001');
    expect(idea.due.s2d).toBe('2026-10-24');
    expect(idea.checklist.s2c?.done).toBe(true);
  });

  it('drafts the call for ideas for the round, addressed to the list', async () => {
    const { root } = await setup();
    const e0 = await draftEmail(root, { template: 'E0' }, clock);
    expect(e0.key).toBe('rounds/ROUND-2026-Q4/emails/001-E0.md');
    await saveSettings(root, { distList: 'CS all staff' });
    const item = (await listOutbox(root)).find((m) => m.key === e0.key)!;
    expect(item.view.to).toBe('CS all staff');
    expect(item.missingSettings.map((m) => m.label)).toEqual(['Submission deadline', 'Café form link', 'Your name (email signature)']);
  });

  it('lets the operator edit a draft but not an approved email', async () => {
    const { root } = await setup();
    await saveRound(root, { reviewBy: '2026-11-02' });
    await saveSettings(root, { operatorName: 'Café operator' });
    const { key } = await draftEmail(root, { template: 'E1', ideaId: 'CAFE-2026-001' }, clock);
    expect((await updateDraft(root, key, { subject: 'New subject' })).subject).toBe('New subject');
    await approve(root, key, clock);
    await expect(updateDraft(root, key, { body: 'x' })).rejects.toThrow('Only drafts can be edited');
  });

  it('refuses a key outside the Outbox', async () => {
    const { root } = await setup();
    await expect(approve(root, '../../etc/passwd', clock)).rejects.toThrow('Not an Outbox item');
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `cd cafe-app && npx vitest run tests/outbox.test.ts`
Expected: FAIL, "Failed to resolve import ../src/comms/outbox".

- [ ] **Step 3: Write the implementation**

`cafe-app/src/comms/outbox.ts`:
```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { plusDays, type Clock } from '../clock';
import { paths } from '../workspace/paths';
import { writeFileAtomic, readText, appendHistory } from '../workspace/files';
import { loadTemplates, render, fillText, analyse } from './templates';
import { loadIdea, saveIdea, ideaDir } from '../ideas/store';
import { currentRoundId, loadRound, loadSettings } from '../round/store';
import { withTick } from '../checklist/checklist';
import type { StepDef } from '../rules/stages';

export type EmailStatus = 'draft' | 'approved' | 'sent';

export interface EmailRecord {
  key: string;
  template: string;
  idea?: string;
  round: string;
  status: EmailStatus;
  created: string;
  approvedAt?: string;
  sentAt?: string;
  to: string;
  subject: string;
  body: string;
}

export interface OutboxItem extends EmailRecord {
  view: { to: string; subject: string; body: string };
  missingSettings: { token: string; label: string }[];
  contentPlaceholders: string[];
}

export class MissingSettingsError extends Error {
  constructor(public readonly labels: string[]) {
    super(`Set first: ${labels.join(', ')}`);
  }
}

const KEY_PATTERN = /^(ideas|rounds)\/[A-Za-z0-9._-]+\/emails\/\d{3}-[A-Z0-9]+\.md$/;
const FILE_PATTERN = /^\d{3}-[A-Z0-9]+\.md$/;

function fileOf(root: string, key: string): string {
  if (!KEY_PATTERN.test(key) || key.includes('..')) throw new Error(`Not an Outbox item: ${key}`);
  return path.join(root, ...key.split('/'));
}

const keyOf = (root: string, file: string) => path.relative(root, file).split(path.sep).join('/');

function serialize(r: EmailRecord): string {
  const { key: _key, body, ...meta } = r;
  return `---\n${YAML.stringify(meta)}---\n${body}\n`;
}

function parseRecord(text: string, key: string): EmailRecord {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!m) throw new Error(`${key}: missing front matter`);
  return { ...(YAML.parse(m[1]) as Omit<EmailRecord, 'key' | 'body'>), key, body: m[2].replace(/\n$/, '') };
}

async function load(root: string, key: string): Promise<EmailRecord> {
  const text = await readText(fileOf(root, key));
  if (text === undefined) throw new Error(`No Outbox item ${key}`);
  return parseRecord(text, key);
}

const save = (root: string, r: EmailRecord) => writeFileAtomic(fileOf(root, r.key), serialize(r));

async function recordsIn(root: string, dir: string): Promise<EmailRecord[]> {
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => FILE_PATTERN.test(n)).sort();
  const out: EmailRecord[] = [];
  for (const n of names) out.push(await load(root, keyOf(root, path.join(dir, n))));
  return out;
}

export async function draftEmail(
  root: string, input: { template: string; ideaId?: string }, clock: Clock,
): Promise<EmailRecord> {
  const tpl = (await loadTemplates(root))[input.template];
  if (!tpl) throw new Error(`No template ${input.template}`);
  if (tpl.to !== 'list' && !input.ideaId) throw new Error(`${tpl.id} is about one idea; pick the idea first`);
  const idea = input.ideaId ? await loadIdea(root, input.ideaId) : undefined;
  const round = idea?.round || (await currentRoundId(root));
  const dir = idea ? path.join(await ideaDir(root, idea.id), 'emails') : path.join(paths(root).rounds, round, 'emails');
  const records = await recordsIn(root, dir);
  const existing = records.find((r) => r.template === tpl.id && r.status !== 'sent');
  if (existing) return existing;

  const seq = String(records.length + 1).padStart(3, '0');
  const r = render(tpl, { idea });
  const rec: EmailRecord = {
    key: keyOf(root, path.join(dir, `${seq}-${tpl.id}.md`)),
    template: tpl.id,
    ...(idea ? { idea: idea.id } : {}),
    round,
    status: 'draft',
    created: clock(),
    to: r.to,
    subject: r.subject,
    body: r.body,
  };
  await save(root, rec);
  if (idea) await appendHistory(await ideaDir(root, idea.id), { at: clock(), action: 'draft', by: 'app', detail: tpl.id, source: rec.key });
  return rec;
}

async function viewOf(root: string, r: EmailRecord): Promise<OutboxItem> {
  const ctx = { round: await loadRound(root, r.round), settings: await loadSettings(root) };
  const view = { to: fillText(r.to, ctx), subject: fillText(r.subject, ctx), body: fillText(r.body, ctx) };
  return { ...r, view, ...analyse(view) };
}

export async function listOutbox(root: string): Promise<OutboxItem[]> {
  const p = paths(root);
  const items: OutboxItem[] = [];
  for (const base of [p.ideas, p.rounds]) {
    for (const name of (await fs.readdir(base).catch(() => [] as string[])).sort()) {
      for (const r of await recordsIn(root, path.join(base, name, 'emails'))) items.push(await viewOf(root, r));
    }
  }
  const order: Record<EmailStatus, number> = { draft: 0, approved: 1, sent: 2 };
  return items.sort((a, b) => order[a.status] - order[b.status] || a.created.localeCompare(b.created) || a.key.localeCompare(b.key));
}

export async function approve(root: string, key: string, clock: Clock): Promise<EmailRecord> {
  const r = await load(root, key);
  if (r.status !== 'draft') return r;
  const item = await viewOf(root, r);
  if (item.missingSettings.length) throw new MissingSettingsError(item.missingSettings.map((m) => m.label));
  const next: EmailRecord = { ...r, ...item.view, status: 'approved', approvedAt: clock() };
  await save(root, next);
  return next;
}

export async function markSent(root: string, key: string, clock: Clock, steps: StepDef[]): Promise<EmailRecord> {
  const r = await load(root, key);
  if (r.status === 'sent') return r;
  if (r.status !== 'approved') throw new Error('Approve the email before marking it as sent');
  const today = clock();
  if (r.idea) {
    const tpl = (await loadTemplates(root))[r.template];
    const dir = await ideaDir(root, r.idea);
    let idea = await loadIdea(root, r.idea);
    idea = { ...idea, sent: { ...idea.sent, [r.template]: today } };
    if (r.template === 'E2' || r.template === 'E2R') idea = { ...idea, due: { ...idea.due, s2d: plusDays(today, 5) } };
    const step = tpl?.step ? steps.find((s) => s.id === tpl.step) : undefined;
    if (step && !idea.checklist[step.id]?.done) {
      idea = withTick(idea, step, true, 'app', today, key);
      await appendHistory(dir, { at: today, action: 'tick', by: 'app', step: step.id, source: key });
    }
    await saveIdea(root, idea);
    await appendHistory(dir, { at: today, action: 'sent', by: 'operator', detail: r.template, source: key });
  }
  const next: EmailRecord = { ...r, status: 'sent', sentAt: today };
  await save(root, next);
  return next;
}

export async function updateDraft(
  root: string, key: string, patch: { subject?: unknown; body?: unknown },
): Promise<EmailRecord> {
  const r = await load(root, key);
  if (r.status !== 'draft') throw new Error('Only drafts can be edited');
  const next: EmailRecord = {
    ...r,
    ...(typeof patch.subject === 'string' ? { subject: patch.subject } : {}),
    ...(typeof patch.body === 'string' ? { body: patch.body } : {}),
  };
  await save(root, next);
  return next;
}
```

- [ ] **Step 4: Run all tests and the type check**

Run: `cd cafe-app && npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add cafe-app/src/comms/outbox.ts cafe-app/tests/outbox.test.ts
git commit -m "cafe-app: outbox with settings gating, mark sent ticks and reply clock" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P3ov37P2fF1cuhtF4wyed3"
```

---

### Task 8: Review, CSIC handoff and review pack

**Files:**
- Create: `cafe-app/src/review/review.ts`
- Test: `cafe-app/tests/review.test.ts`

**Interfaces:**
- Consumes: `loadIdea`, `saveIdea`, `ideaDir`, `listIdeas`, `loadSettings`, `currentRoundId`, `withTick`, `progress`, `draftEmail`, `EmailRecord`, `writeFileAtomic`, `appendHistory`, `plusDays`, `formatDate`, `paths`.
- Produces:
  - `CRITERIA: readonly {id, text}[]` (5)
  - `DECISION_EMAIL: Record<Decision, string>` (`select`→E3, `reuse`→E4, `csic`→E5, `notnow`→E6, `ask`→E2)
  - `DECISION_LABELS: Record<Decision, string>`
  - `interface ReviewInput { criteria?; decision?; reason? }` (loose, comes from the browser)
  - `interface ReviewResult { idea; email: EmailRecord; warnings: string[]; handoff?: string }`
  - `saveReview(root, id, input, { clock, steps })`
  - `renderReview(idea, review)`, `renderHandoff(idea, settings)`
  - `writeReviewPack(root, clock, steps)` → file path

Saving a review does the following:

1. Writes `review.md` and stores `idea.review`.
2. Ticks s2a unless the decision is "ask".
3. Closes the idea for reuse, csic or notnow. For csic it also sets `followUp` to today + 28 days, sets `route` to "CSIC Repository" and writes `csic-handoff.md`.
4. Drafts the matching email.
5. Returns a warning when "select" goes over `capacity.ideasPerRound`.

- [ ] **Step 1: Write the failing test**

`cafe-app/tests/review.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { tmpWorkspace, FIXTURE } from './helpers';
import { importExport } from '../src/import/importRows';
import { saveReview, writeReviewPack } from '../src/review/review';
import { loadIdea, ideaDir } from '../src/ideas/store';
import { saveSettings } from '../src/round/store';
import { DEFAULT_STEPS as steps } from '../src/rules/stages';
import { fixedClock } from '../src/clock';

const clock = fixedClock('2026-10-19');
const ctx = { clock, steps };

async function setup() {
  const root = await tmpWorkspace();
  await importExport(root, FIXTURE, ctx);
  return root;
}

describe('saveReview', () => {
  it('needs a reason and writes nothing without one', async () => {
    const root = await setup();
    await expect(saveReview(root, 'CAFE-2026-003', { decision: 'select', reason: '  ' }, ctx)).rejects.toThrow('Give a reason');
    await expect(access(path.join(await ideaDir(root, 'CAFE-2026-003'), 'review.md'))).rejects.toThrow();
  });

  it('selects an idea: review.md, s2a ticked, E3 drafted, still open', async () => {
    const root = await setup();
    const r = await saveReview(root, 'CAFE-2026-003', {
      criteria: { feasible: true, builder: true, data: true, theme: true, reuse: false, bogus: true },
      decision: 'select', reason: 'Feasible on redacted sample invoices.',
    }, ctx);
    expect(r.email.template).toBe('E3');
    expect(r.idea.closed).toBeUndefined();
    expect(r.idea.review?.criteria).toEqual({ feasible: true, builder: true, data: true, theme: true, reuse: false });
    expect((await loadIdea(root, 'CAFE-2026-003')).checklist.s2a?.done).toBe(true);
    const md = await readFile(path.join(await ideaDir(root, 'CAFE-2026-003'), 'review.md'), 'utf8');
    expect(md).toContain('- [x] A builder is named and can attend');
    expect(md).toContain('- [ ] It could be reused beyond the submitting team');
    expect(md).toContain('Feasible on redacted sample invoices.');
  });

  it('asks first: E2 drafted, feasibility not ticked', async () => {
    const root = await setup();
    const r = await saveReview(root, 'CAFE-2026-001', { decision: 'ask', reason: 'Did they try Copilot in Outlook?' }, ctx);
    expect(r.email.template).toBe('E2');
    expect((await loadIdea(root, 'CAFE-2026-001')).checklist.s2a).toBeUndefined();
  });

  it('routes to CSIC: closes with a four-week follow-up and writes the handoff', async () => {
    const root = await setup();
    const r = await saveReview(root, 'CAFE-2026-002', { decision: 'csic', reason: 'Defined, sponsored, serves people beyond the team.' }, ctx);
    expect(r.email.template).toBe('E5');
    expect(r.idea.closed).toEqual({ as: 'csic', at: '2026-10-19', followUp: '2026-11-16' });
    const handoff = await readFile(r.handoff!, 'utf8');
    expect(handoff).toContain('Requests arrive in a shared mailbox');
    expect(handoff).toContain('Source: form, Business Challenge');
    expect(handoff).toContain('Person 3, named as sponsor in Team Members and Lead. MD status: not confirmed.');
    expect(handoff).toContain('## Who would use it\n\nNot in the Café record. Ask the team.\n\nSource: none');
    expect(handoff).toContain('[CSIC REPOSITORY INTAKE LINK]');
    expect(handoff).toContain('On 16 November 2026: did it reach the CSIC Repository?');
  });

  it('warns when a selection goes over capacity', async () => {
    const root = await setup();
    await saveSettings(root, { capacity: { ideasPerRound: 1 } });
    const first = await saveReview(root, 'CAFE-2026-001', { decision: 'select', reason: 'a' }, ctx);
    const second = await saveReview(root, 'CAFE-2026-003', { decision: 'select', reason: 'b' }, ctx);
    expect(first.warnings).toEqual([]);
    expect(second.warnings).toEqual(['This makes 2 ideas selected this round; your limit is 1.']);
  });

  it('will not review a closed idea again', async () => {
    const root = await setup();
    await saveReview(root, 'CAFE-2026-002', { decision: 'csic', reason: 'a' }, ctx);
    await expect(saveReview(root, 'CAFE-2026-002', { decision: 'select', reason: 'b' }, ctx)).rejects.toThrow('already closed');
  });

  it('refuses an unknown decision', async () => {
    const root = await setup();
    await expect(saveReview(root, 'CAFE-2026-001', { decision: 'maybe', reason: 'a' }, ctx)).rejects.toThrow('Pick a decision');
  });
});

describe('writeReviewPack', () => {
  it('lists the open ideas for the TTIA meeting', async () => {
    const root = await setup();
    await saveReview(root, 'CAFE-2026-002', { decision: 'csic', reason: 'a' }, ctx);
    const file = await writeReviewPack(root, clock, steps);
    expect(path.basename(file)).toBe('review-pack-2026-10-19.md');
    const md = await readFile(file, 'utf8');
    expect(md).toContain('2 ideas to decide');
    expect(md).toContain('## CAFE-2026-001 Email scheduler');
    expect(md).toContain('## CAFE-2026-003 Third Party Invoice Assessment');
    expect(md).not.toContain('CAFE-2026-002');
    expect(md).toContain('Participation is Individual but 6 people are listed');
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `cd cafe-app && npx vitest run tests/review.test.ts`
Expected: FAIL, "Failed to resolve import ../src/review/review".

- [ ] **Step 3: Write the implementation**

`cafe-app/src/review/review.ts`:
```ts
import path from 'node:path';
import { plusDays, formatDate, type Clock } from '../clock';
import type { Decision, Idea, ReviewRecord } from '../ideas/idea';
import { loadIdea, saveIdea, ideaDir, listIdeas } from '../ideas/store';
import { writeFileAtomic, appendHistory } from '../workspace/files';
import { paths } from '../workspace/paths';
import { loadSettings, currentRoundId } from '../round/store';
import type { Settings } from '../round/round';
import { withTick, progress } from '../checklist/checklist';
import type { StepDef } from '../rules/stages';
import { draftEmail, type EmailRecord } from '../comms/outbox';

export const CRITERIA = [
  { id: 'feasible', text: 'A proof of concept is feasible with approved tools and no live non-Microsoft system' },
  { id: 'builder', text: 'A builder is named and can attend' },
  { id: 'data', text: 'Synthetic, aggregated or sample data is enough' },
  { id: 'theme', text: 'It fits a theme or cohort' },
  { id: 'reuse', text: 'It could be reused beyond the submitting team' },
] as const;

export const DECISION_EMAIL: Record<Decision, string> = { select: 'E3', reuse: 'E4', csic: 'E5', notnow: 'E6', ask: 'E2' };

export const DECISION_LABELS: Record<Decision, string> = {
  select: 'Select for the design series (E3)',
  reuse: 'Reuse what exists (E4)',
  csic: 'Route to the CSIC Repository (E5)',
  notnow: 'Not this round (E6)',
  ask: 'Ask first (E2)',
};

export interface ReviewInput {
  criteria?: Record<string, unknown>;
  decision?: unknown;
  reason?: unknown;
}

export interface ReviewResult {
  idea: Idea;
  email: EmailRecord;
  warnings: string[];
  handoff?: string;
}

const NOT_IN_RECORD = 'Not in the Café record. Ask the team.';

export function renderReview(idea: Idea, r: ReviewRecord): string {
  return [
    `# Review: ${idea.id} ${idea.title}`, '',
    `Date: ${r.at}`, '',
    '## Criteria', '',
    ...CRITERIA.map((c) => `- [${r.criteria[c.id] ? 'x' : ' '}] ${c.text}`), '',
    '## Decision', '', DECISION_LABELS[r.decision], '',
    '## Reason', '', r.reason, '',
  ].join('\n');
}

export function renderHandoff(idea: Idea, settings: Settings): string {
  const sponsor = idea.people.team.find((p) => p.role === 'sponsor');
  const field = (title: string, value: string | undefined, source: string) => {
    const v = value?.trim();
    return [`## ${title}`, '', v || NOT_IN_RECORD, '', `Source: ${v ? source : 'none'}`, ''];
  };
  return [
    `# CSIC Repository intake draft: ${idea.title}`, '',
    `From Creators' Café record ${idea.id}. Every field says where it came from. Check each one before you paste it into the intake form: ${settings.csicLink?.trim() || '[CSIC REPOSITORY INTAKE LINK]'}`, '',
    ...field('Opportunity description', idea.challenge, 'form, Business Challenge'),
    ...field('Current process', idea.current_process, 'form, Current Process'),
    ...field('Who would use it', undefined, ''),
    ...field(
      'Sponsor',
      sponsor
        ? `${sponsor.name}, named as sponsor in Team Members and Lead. MD status: not confirmed.`
        : 'No sponsor named in the form. The CSIC Repository needs an MD sponsor who has agreed.',
      'form, Team Members and Lead',
    ),
    ...field('Expected change (no figures)', idea.outcomes.join('; '), 'form, Desired Outcomes'),
    ...field('Systems and data', undefined, ''),
    '## Café history', '',
    ...(idea.source ? [`- Submitted: ${idea.source.file}, row ${idea.source.row}`] : []),
    ...(idea.review ? [`- ${idea.review.at}: reviewed and routed to the CSIC Repository. Reason: ${idea.review.reason}`] : []),
    '',
    '## Follow up', '',
    `On ${idea.closed?.followUp ? formatDate(idea.closed.followUp) : '[FOLLOW-UP DATE]'}: did it reach the CSIC Repository?`, '',
  ].join('\n');
}

export async function saveReview(
  root: string, id: string, input: ReviewInput, ctx: { clock: Clock; steps: StepDef[] },
): Promise<ReviewResult> {
  const decision = input.decision as Decision;
  if (typeof decision !== 'string' || !Object.hasOwn(DECISION_EMAIL, decision)) throw new Error('Pick a decision');
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason) throw new Error('Give a reason for the decision');

  let idea = await loadIdea(root, id);
  if (idea.closed) throw new Error(`${id} is already closed`);
  const today = ctx.clock();
  const dir = await ideaDir(root, id);
  const criteria = Object.fromEntries(CRITERIA.map((c) => [c.id, input.criteria?.[c.id] === true]));
  const review: ReviewRecord = { criteria, decision, reason, at: today };
  idea = { ...idea, review };
  const warnings: string[] = [];

  const s2a = ctx.steps.find((s) => s.id === 's2a');
  if (decision !== 'ask' && s2a && !idea.checklist.s2a?.done) {
    idea = withTick(idea, s2a, true, 'operator', today, 'review.md');
    await appendHistory(dir, { at: today, action: 'tick', by: 'operator', step: 's2a', source: 'review.md' });
  }

  if (decision === 'select') {
    const { ideas } = await listIdeas(root);
    const selected = ideas.filter((i) => i.id !== id && i.round === idea.round && i.review?.decision === 'select').length + 1;
    const cap = (await loadSettings(root)).capacity.ideasPerRound;
    if (selected > cap) warnings.push(`This makes ${selected} ideas selected this round; your limit is ${cap}.`);
  }

  let handoff: string | undefined;
  if (decision === 'csic') {
    idea = { ...idea, closed: { as: 'csic', at: today, followUp: plusDays(today, 28) }, route: 'CSIC Repository' };
    handoff = path.join(dir, 'csic-handoff.md');
    await writeFileAtomic(handoff, renderHandoff(idea, await loadSettings(root)));
  } else if (decision === 'reuse' || decision === 'notnow') {
    idea = { ...idea, closed: { as: decision, at: today } };
  }

  await writeFileAtomic(path.join(dir, 'review.md'), renderReview(idea, review));
  await saveIdea(root, idea);
  await appendHistory(dir, { at: today, action: 'review', by: 'operator', detail: `${decision}: ${reason}`, source: 'review.md' });
  const email = await draftEmail(root, { template: DECISION_EMAIL[decision], ideaId: id }, ctx.clock);
  return { idea, email, warnings, ...(handoff ? { handoff } : {}) };
}

export async function writeReviewPack(root: string, clock: Clock, steps: StepDef[]): Promise<string> {
  const round = await currentRoundId(root);
  const today = clock();
  const open = (await listIdeas(root)).ideas.filter((i) => i.round === round && !i.closed && i.stage <= 2);
  const lines = [
    `# Review pack: ${round}`, '',
    `Written ${formatDate(today)} for the TTIA review meeting. ${open.length} idea${open.length === 1 ? '' : 's'} to decide.`, '',
  ];
  for (const i of open) {
    const r = i.review;
    lines.push(
      `## ${i.id} ${i.title}`, '',
      [i.function, i.region, i.participation, i.experimented ? `experimented: ${i.experimented}` : undefined].filter(Boolean).join(' · '), '',
      `- Support requested: ${i.support.join(', ') || 'none given'}`,
      `- Flags: ${i.flags.join('; ') || 'none'}`,
      `- Criteria: ${r ? CRITERIA.map((c) => `${r.criteria[c.id] ? 'yes' : 'no'}: ${c.text}`).join('; ') : 'not reviewed yet'}`,
      `- Decision: ${r ? `${DECISION_LABELS[r.decision]}. ${r.reason}` : 'not decided yet'}`,
      `- Where it is: ${progress(i, steps).label}`, '',
    );
  }
  const file = path.join(paths(root).rounds, round, `review-pack-${today}.md`);
  await writeFileAtomic(file, lines.join('\n'));
  return file;
}
```

- [ ] **Step 4: Run all tests and the type check**

Run: `cd cafe-app && npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add cafe-app/src/review cafe-app/tests/review.test.ts
git commit -m "cafe-app: review criteria, decisions, CSIC handoff and review pack" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P3ov37P2fF1cuhtF4wyed3"
```

---

### Task 9: Overdue replies and status.csv

**Files:**
- Create: `cafe-app/src/reminders/due.ts`, `cafe-app/src/exports/status.ts`
- Test: `cafe-app/tests/due-status.test.ts`

**Interfaces:**
- Consumes: `Idea`, `CLOSURE_LABELS`, `StepDef`, `Round`, `daysBetween`, `formatDate`, `listIdeas`, `loadRound`, `writeFileAtomic`, `paths`, `Clock`.
- Produces:
  - `interface Overdue { step; due; daysLate; text }`
  - `overdue(idea, steps, today): Overdue[]`
  - `needsE2R(list: Overdue[]): boolean`
  - `publicStatus(idea, round): string`
  - `writeStatusCsv(root, clock)` → file path

- [ ] **Step 1: Write the failing test**

`cafe-app/tests/due-status.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { tmpWorkspace, sampleIdea, FIXTURE } from './helpers';
import { overdue, needsE2R } from '../src/reminders/due';
import { publicStatus, writeStatusCsv } from '../src/exports/status';
import { importExport } from '../src/import/importRows';
import { saveIdea } from '../src/ideas/store';
import { DEFAULT_STEPS as steps } from '../src/rules/stages';
import { fixedClock } from '../src/clock';

const waiting = sampleIdea({ stage: 2, sent: { E2: '2026-10-19' }, due: { s2d: '2026-10-24' } });

describe('overdue', () => {
  it('is not overdue on the due date', () => expect(overdue(waiting, steps, '2026-10-24')).toEqual([]));

  it('shows how long the reply has been waiting', () => {
    const o = overdue(waiting, steps, '2026-10-26');
    expect(o).toEqual([{ step: 's2d', due: '2026-10-24', daysLate: 2, text: 'E2 sent 7 days ago · reply due 24 October 2026' }]);
    expect(needsE2R(o)).toBe(true);
  });

  it('stops once the answer is in, or the idea is closed', () => {
    const answered = { ...waiting, checklist: { s2d: { done: true, by: 'operator' as const, at: '2026-10-25' } } };
    expect(overdue(answered, steps, '2026-10-26')).toEqual([]);
    expect(overdue({ ...waiting, closed: { as: 'notnow', at: '2026-10-25' } }, steps, '2026-10-26')).toEqual([]);
  });
});

describe('status', () => {
  const round = { id: 'ROUND-2026-Q4', reviewBy: '2026-11-02' };

  it('says what a submitter may see', () => {
    expect(publicStatus(sampleIdea(), { id: 'ROUND-2026-Q4' })).toBe('Received · decision by date to be confirmed');
    expect(publicStatus(sampleIdea({ stage: 2 }), round)).toBe('Under review · decision by 2 November 2026');
    expect(publicStatus(sampleIdea({ stage: 3 }), round)).toBe('Selected · design series');
    expect(publicStatus(sampleIdea({ stage: 2, closed: { as: 'csic', at: '2026-10-19' } }), round)).toBe('Routed to CSIC');
  });

  it('writes status.csv with no names', async () => {
    const root = await tmpWorkspace();
    await importExport(root, FIXTURE, { clock: fixedClock('2026-10-19'), steps });
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-009', slug: 'x', title: 'Intake, triage and "routing"' }));
    const csv = await readFile(await writeStatusCsv(root, fixedClock('2026-10-19')), 'utf8');
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('Café ID,Title,Status,Updated');
    expect(lines[1]).toBe('CAFE-2026-001,Email scheduler,Received · decision by date to be confirmed,2026-10-19');
    expect(lines[4]).toBe('CAFE-2026-009,"Intake, triage and ""routing""",Received · decision by date to be confirmed,2026-10-19');
    expect(csv).not.toMatch(/Person/);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `cd cafe-app && npx vitest run tests/due-status.test.ts`
Expected: FAIL, "Failed to resolve import ../src/reminders/due".

- [ ] **Step 3: Write the implementation**

`cafe-app/src/reminders/due.ts`:
```ts
import { daysBetween, formatDate } from '../clock';
import type { Idea } from '../ideas/idea';
import type { StepDef } from '../rules/stages';

export interface Overdue {
  step: string;
  due: string;
  daysLate: number;
  text: string;
}

export function overdue(idea: Idea, steps: StepDef[], today: string): Overdue[] {
  if (idea.closed) return [];
  return Object.entries(idea.due).flatMap(([stepId, due]) => {
    if (idea.checklist[stepId]?.done || today <= due) return [];
    const step = steps.find((s) => s.id === stepId);
    const asked = idea.sent.E2R ? ['E2R', idea.sent.E2R] : idea.sent.E2 ? ['E2', idea.sent.E2] : undefined;
    const text = stepId === 's2d' && asked
      ? `${asked[0]} sent ${daysBetween(asked[1], today)} days ago · reply due ${formatDate(due)}`
      : `${step?.text ?? stepId} · due ${formatDate(due)}`;
    return [{ step: stepId, due, daysLate: daysBetween(due, today), text }];
  });
}

export const needsE2R = (list: Overdue[]) => list.some((o) => o.step === 's2d');
```

`cafe-app/src/exports/status.ts`:
```ts
import path from 'node:path';
import { formatDate, type Clock } from '../clock';
import { CLOSURE_LABELS, type Idea } from '../ideas/idea';
import type { Round } from '../round/round';
import { listIdeas } from '../ideas/store';
import { loadRound } from '../round/store';
import { writeFileAtomic } from '../workspace/files';
import { paths } from '../workspace/paths';

export function publicStatus(idea: Idea, round: Round): string {
  if (idea.closed) return CLOSURE_LABELS[idea.closed.as];
  const by = round.reviewBy ? formatDate(round.reviewBy) : 'date to be confirmed';
  switch (idea.stage) {
    case 1: return `Received · decision by ${by}`;
    case 2: return `Under review · decision by ${by}`;
    case 3: return 'Selected · design series';
    case 4: return 'Launch and Learn';
  }
}

const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export async function writeStatusCsv(root: string, clock: Clock): Promise<string> {
  const round = await loadRound(root);
  const { ideas } = await listIdeas(root);
  const today = clock();
  const rows = [['Café ID', 'Title', 'Status', 'Updated'], ...ideas.map((i) => [i.id, i.title, publicStatus(i, round), today])];
  const file = path.join(paths(root).exports, 'status.csv');
  await writeFileAtomic(file, `${rows.map((r) => r.map(cell).join(',')).join('\n')}\n`);
  return file;
}
```

- [ ] **Step 4: Run all tests and the type check**

Run: `cd cafe-app && npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add cafe-app/src/reminders cafe-app/src/exports cafe-app/tests/due-status.test.ts
git commit -m "cafe-app: overdue replies, E2R offer and status.csv without names" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P3ov37P2fF1cuhtF4wyed3"
```

---

### Task 10: Local HTTP API

**Files:**
- Create: `cafe-app/src/server/server.ts`, `cafe-app/src/server/api.ts`
- Create: `cafe-app/web/index.html` (placeholder; Task 11 replaces it)
- Modify: `cafe-app/tests/helpers.ts` (add `startServer`)
- Test: `cafe-app/tests/server.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–9.
- Produces:
  - `createApp({ root, clock }): http.Server`
  - `type Handler`, `type AddRoute`
  - `GET /api/state` → `{ today, round, settings, steps, stageNames, problems, ideas: (Idea & { progress, overdue, offerE2R, status: Record<stepId, StepStatus> })[], outbox: OutboxItem[], criteria, decisions, fields: { round, settings } }`
  - `POST /api/round` (body: date fields), `POST /api/settings` (body: setting fields plus `capacity`)
  - `POST /api/import` (raw file body, header `x-filename`) → `ImportReport`
  - `POST /api/ideas/:id/tick` `{ step, done }`, `POST /api/ideas/:id/advance`, `POST /api/ideas/:id/review` `{ criteria, decision, reason }`, `POST /api/ideas/:id/draft` `{ template }`
  - `POST /api/round/draft` `{ template }` (E0, E0B)
  - `POST /api/outbox/approve` `{ key }`, `POST /api/outbox/sent` `{ key }`, `POST /api/outbox/update` `{ key, subject?, body? }`
  - `POST /api/review-pack` → `{ file }`, `POST /api/status-export` → `{ file }`
  - Errors: `400 { error, missing? }`; a non-local Host gets 403; a POST that is neither JSON nor carries `x-filename` gets 415; an unknown route gets 404.

- [ ] **Step 1: Add the server helper and write the failing test**

Append to `cafe-app/tests/helpers.ts`:
```ts
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server/server';

export async function startServer(today = '2026-10-19') {
  const root = await tmpWorkspace(today);
  const server = createApp({ root, clock: fixedClock(today) });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { root, server, base: `http://127.0.0.1:${port}` };
}
```

Create a placeholder `cafe-app/web/index.html` (Task 11 replaces it):
```html
<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Creators' Café</title></head><body></body></html>
```

`cafe-app/tests/server.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { startServer, FIXTURE } from './helpers';

let close: (() => void) | undefined;
afterEach(() => close?.());

async function boot() {
  const s = await startServer();
  close = () => s.server.close();
  return s;
}

const post = (base: string, url: string, body: unknown) =>
  fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function rawStatus(base: string, pathName: string, host: string): Promise<number> {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: u.hostname, port: u.port, path: pathName, headers: { host } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

describe('api', () => {
  it('reports an empty round', async () => {
    const { base } = await boot();
    const state = await (await fetch(`${base}/api/state`)).json();
    expect(state.round.id).toBe('ROUND-2026-Q4');
    expect(state.ideas).toEqual([]);
    expect(state.steps).toHaveLength(25);
    expect(state.today).toBe('2026-10-19');
  });

  it('imports a dropped export and shows each idea with its progress', async () => {
    const { base } = await boot();
    const res = await fetch(`${base}/api/import`, {
      method: 'POST', headers: { 'x-filename': 'export.csv', 'content-type': 'application/octet-stream' }, body: await readFile(FIXTURE),
    });
    expect((await res.json()).created).toHaveLength(3);
    const state = await (await fetch(`${base}/api/state`)).json();
    expect(state.ideas[0].progress.label).toBe('Submit Idea · 1 of 25');
    expect(state.ideas[0].status.s1d).toBe('done');
  });

  it('turns a missing setting into a 400 that names it', async () => {
    const { base } = await boot();
    await fetch(`${base}/api/import`, { method: 'POST', headers: { 'x-filename': 'export.csv' }, body: await readFile(FIXTURE) });
    const draft = await (await post(base, '/api/ideas/CAFE-2026-001/draft', { template: 'E1' })).json();
    const res = await post(base, '/api/outbox/approve', { key: draft.key });
    expect(res.status).toBe(400);
    expect((await res.json()).missing).toEqual(['Decisions by', 'Your name (email signature)']);
  });

  it('refuses paths and IDs outside the workspace', async () => {
    const { base } = await boot();
    const res = await post(base, '/api/ideas/..%2F..%2Fetc/tick', { step: 's1a', done: true });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Not a Café ID');
    expect((await fetch(`${base}/../package.json`)).status).toBe(404);
    expect((await post(base, '/api/outbox/approve', { key: '../../x.md' })).status).toBe(400);
  });

  it('only accepts JSON posts or a named file upload', async () => {
    const { base } = await boot();
    const res = await fetch(`${base}/api/round`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    expect(res.status).toBe(415);
  });

  it('refuses requests for another host name', async () => {
    const { base } = await boot();
    expect(await rawStatus(base, '/api/state', 'evil.example')).toBe(403);
    expect(await rawStatus(base, '/api/state', 'localhost:4100')).toBe(200);
  });

  it('refuses a file type it cannot import', async () => {
    const { base } = await boot();
    const res = await fetch(`${base}/api/import`, { method: 'POST', headers: { 'x-filename': 'notes.exe' }, body: 'x' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Drop a .csv or .xlsx export');
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `cd cafe-app && npx vitest run tests/server.test.ts`
Expected: FAIL, "Failed to resolve import ../src/server/server".

- [ ] **Step 3: Write the implementation**

`cafe-app/src/server/server.ts`:
```ts
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Clock } from '../clock';
import { APP_DIR } from '../workspace/paths';
import { MissingSettingsError } from '../comms/outbox';
import { registerApi } from './api';

export interface ServerOptions {
  root: string;
  clock: Clock;
}

export interface RequestInfo {
  body: Record<string, unknown>;
  raw: Buffer;
  params: Record<string, string>;
  headers: http.IncomingHttpHeaders;
}

export type Handler = (req: RequestInfo) => Promise<unknown>;
export type AddRoute = (method: 'GET' | 'POST', route: string, handler: Handler) => void;

const STATIC: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const MAX_BODY = 20 * 1024 * 1024;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

function send(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('That file is too large (limit 20 MB)'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function createApp({ root, clock }: ServerOptions): http.Server {
  const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler }[] = [];
  const add: AddRoute = (method, route, handler) => {
    const keys: string[] = [];
    const pattern = new RegExp(`^${route.replace(/:(\w+)/g, (_m, k: string) => { keys.push(k); return '([^/]+)'; })}$`);
    routes.push({ method, pattern, keys, handler });
  };
  registerApi(add, { root, clock });

  return http.createServer(async (req, res) => {
    try {
      if (!LOCAL_HOST.test(req.headers.host ?? '')) return send(res, 403, { error: 'This app only answers on localhost' });
      const url = new URL(req.url ?? '/', 'http://localhost');
      const asset = STATIC[url.pathname];
      if (req.method === 'GET' && asset) {
        res.writeHead(200, { 'content-type': asset[1], 'cache-control': 'no-store' });
        res.end(await fs.readFile(path.join(APP_DIR, 'web', asset[0])));
        return;
      }
      const route = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
      if (!route) return send(res, 404, { error: 'Not found' });
      const type = req.headers['content-type'] ?? '';
      if (req.method === 'POST' && !type.includes('application/json') && !req.headers['x-filename']) {
        return send(res, 415, { error: 'Send JSON' });
      }
      const m = route.pattern.exec(url.pathname)!;
      const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const raw = await readBody(req);
      const body = type.includes('application/json') && raw.length
        ? (JSON.parse(raw.toString('utf8')) as Record<string, unknown>)
        : {};
      return send(res, 200, await route.handler({ body, raw, params, headers: req.headers }));
    } catch (e) {
      const err = e as Error;
      return send(res, 400, { error: err.message, ...(err instanceof MissingSettingsError ? { missing: err.labels } : {}) });
    }
  });
}
```

`cafe-app/src/server/api.ts`:
```ts
import path from 'node:path';
import type { Clock } from '../clock';
import type { AddRoute } from './server';
import { paths } from '../workspace/paths';
import { writeFileAtomic } from '../workspace/files';
import { loadSteps, STAGE_NAMES } from '../rules/stages';
import { ROUND_FIELDS, SETTING_FIELDS } from '../round/round';
import { loadRound, saveRound, loadSettings, saveSettings } from '../round/store';
import { listIdeas } from '../ideas/store';
import { progress, stepStatus, tick, advance } from '../checklist/checklist';
import { importExport } from '../import/importRows';
import { draftEmail, listOutbox, approve, markSent, updateDraft } from '../comms/outbox';
import { saveReview, writeReviewPack, CRITERIA, DECISION_LABELS, type ReviewInput } from '../review/review';
import { overdue, needsE2R } from '../reminders/due';
import { writeStatusCsv } from '../exports/status';

export function registerApi(add: AddRoute, { root, clock }: { root: string; clock: Clock }): void {
  const steps = () => loadSteps(root);

  add('GET', '/api/state', async () => {
    const [round, settings, st, list, outbox] = await Promise.all([
      loadRound(root), loadSettings(root), steps(), listIdeas(root), listOutbox(root),
    ]);
    const today = clock();
    return {
      today, round, settings, steps: st, stageNames: STAGE_NAMES, problems: list.problems,
      ideas: list.ideas.map((i) => {
        const late = overdue(i, st, today);
        return {
          ...i,
          progress: progress(i, st),
          overdue: late,
          offerE2R: needsE2R(late) && !outbox.some((m) => m.idea === i.id && m.template === 'E2R' && m.status !== 'sent'),
          status: Object.fromEntries(st.map((s) => [s.id, stepStatus(i, s)])),
        };
      }),
      outbox,
      criteria: CRITERIA,
      decisions: DECISION_LABELS,
      fields: { round: ROUND_FIELDS, settings: SETTING_FIELDS },
    };
  });

  add('POST', '/api/round', async ({ body }) => saveRound(root, body));
  add('POST', '/api/settings', async ({ body }) => saveSettings(root, body));

  add('POST', '/api/import', async ({ raw, headers }) => {
    const name = path.basename(String(headers['x-filename'] ?? ''));
    if (!/\.(csv|xlsx)$/i.test(name)) throw new Error('Drop a .csv or .xlsx export');
    const file = path.join(paths(root).inbox, `${clock()}-${name}`);
    await writeFileAtomic(file, raw);
    return importExport(root, file, { clock, steps: await steps() });
  });

  add('POST', '/api/ideas/:id/tick', async ({ params, body }) =>
    tick(root, params.id, String(body.step), body.done === true, { by: 'operator', clock, steps: await steps() }));
  add('POST', '/api/ideas/:id/advance', async ({ params }) => advance(root, params.id, await steps(), clock));
  add('POST', '/api/ideas/:id/review', async ({ params, body }) =>
    saveReview(root, params.id, body as ReviewInput, { clock, steps: await steps() }));
  add('POST', '/api/ideas/:id/draft', async ({ params, body }) =>
    draftEmail(root, { template: String(body.template), ideaId: params.id }, clock));
  add('POST', '/api/round/draft', async ({ body }) => draftEmail(root, { template: String(body.template) }, clock));

  add('POST', '/api/outbox/approve', async ({ body }) => approve(root, String(body.key), clock));
  add('POST', '/api/outbox/sent', async ({ body }) => markSent(root, String(body.key), clock, await steps()));
  add('POST', '/api/outbox/update', async ({ body }) => updateDraft(root, String(body.key), body));

  add('POST', '/api/review-pack', async () => ({ file: await writeReviewPack(root, clock, await steps()) }));
  add('POST', '/api/status-export', async () => ({ file: await writeStatusCsv(root, clock) }));
}
```

- [ ] **Step 4: Run all tests and the type check**

Run: `cd cafe-app && npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add cafe-app/src/server cafe-app/web/index.html cafe-app/tests/helpers.ts cafe-app/tests/server.test.ts
git commit -m "cafe-app: localhost JSON API with host, content-type and path guards" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P3ov37P2fF1cuhtF4wyed3"
```

---

### Task 11: The operator page

**Files:**
- Modify (replace): `cafe-app/web/index.html`
- Create: `cafe-app/web/app.js`, `cafe-app/web/style.css`
- Test: `cafe-app/tests/web.test.ts`

**Interfaces:**
- Consumes: the API from Task 10, and nothing else.
- Produces: five tabs (Round, Ideas, Checklist, Review, Outbox) that match the mockup's flow:
  - **Round:** dates, links and capacity, the E0 and E0B drafts, `status.csv` and the review pack.
  - **Ideas:** drop or choose an export, the import report, and a list showing where each idea is, what it is waiting on (amber when late) and its flags.
  - **Checklist:** the 25 steps by stage, with who ticked each one, when and from what source; "Draft E…" buttons; the E2R offer; "Move to …".
  - **Review:** the five criteria, a decision and a reason; Save drafts the email.
  - **Outbox:** each email with its To, Subject and body. Approving is blocked with "Set first: …" and a link to Round. Approve and copy, Mark as sent, and the number of placeholders left to fill.

- [ ] **Step 1: Write the failing test**

`cafe-app/tests/web.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the test to see it fail**

Run: `cd cafe-app && npx vitest run tests/web.test.ts`
Expected: FAIL. The placeholder page has no script tag, and `app.js` does not exist.

- [ ] **Step 3: Write the page**

`cafe-app/web/index.html`:
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Creators' Café</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header class="top">
    <h1>Creators' Café</h1>
    <span id="today"></span>
  </header>
  <nav id="tabs" role="tablist" aria-label="Sections"></nav>
  <p id="notice" role="status" hidden></p>
  <main id="main"><p>Loading…</p></main>
  <script src="/app.js"></script>
</body>
</html>
```

`cafe-app/web/style.css`:
```css
:root {
  --bg: #f7f7f5; --panel: #ffffff; --text: #1d1d1f; --muted: #5f6368; --line: #dcdcd7;
  --accent: #4f46e5; --accent-text: #ffffff; --late: #b45309; --late-bg: #fef3c7; --ok: #15803d;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #151517; --panel: #1f1f23; --text: #ececf1; --muted: #a1a1aa; --line: #34343a;
    --accent: #818cf8; --accent-text: #111114; --late: #fbbf24; --late-bg: #3a2a0a; --ok: #4ade80; }
}
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
.top { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding: 16px 24px 8px; }
.top h1 { font-size: 20px; margin: 0; }
#today { color: var(--muted); }
#tabs { display: flex; gap: 4px; padding: 0 24px; border-bottom: 1px solid var(--line); overflow-x: auto; }
#tabs button { border: 0; background: none; color: var(--muted); padding: 10px 14px; font: inherit; cursor: pointer; border-bottom: 2px solid transparent; }
#tabs button[aria-selected="true"] { color: var(--text); border-bottom-color: var(--accent); }
#notice { margin: 12px 24px 0; padding: 10px 14px; background: var(--late-bg); color: var(--text); border-radius: 8px; }
main { padding: 16px 24px 48px; max-width: 1100px; }
section, article.mail { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
h2 { font-size: 16px; margin: 0 0 12px; } h3 { font-size: 15px; margin: 0 0 8px; }
label { display: block; margin: 8px 0; }
input[type="text"], input[type="date"], input[type="number"], select, textarea {
  display: block; width: 100%; max-width: 480px; margin-top: 4px; padding: 6px 8px; font: inherit;
  color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; }
textarea { min-height: 80px; }
button { font: inherit; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--line); background: var(--panel); color: var(--text); cursor: pointer; }
form > button, button.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
button.link, label.link { border: 0; background: none; padding: 0; color: var(--accent); text-decoration: underline; cursor: pointer; }
label.link { display: inline; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
tr.late td { background: var(--late-bg); }
.drop { border: 2px dashed var(--line); border-radius: 10px; padding: 24px; text-align: center; color: var(--muted); }
.drop.over { border-color: var(--accent); color: var(--text); }
ul.steps { list-style: none; padding: 0; margin: 0; }
ul.steps li { padding: 6px 0; border-bottom: 1px solid var(--line); }
ul.steps li.done label { color: var(--ok); }
ul.steps li.na { opacity: 0.5; }
.owner { display: inline-block; min-width: 44px; font-size: 12px; color: var(--muted); }
small { display: block; color: var(--muted); margin-left: 52px; }
.warn { color: var(--late); }
.badge { font-size: 12px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--line); }
pre { white-space: pre-wrap; font: inherit; background: var(--bg); padding: 12px; border-radius: 8px; }
fieldset { border: 1px solid var(--line); border-radius: 8px; }
@media (max-width: 640px) {
  .top, #tabs, main { padding-left: 16px; padding-right: 16px; }
  th:nth-child(3), td:nth-child(3), th:nth-child(6), td:nth-child(6) { display: none; }
}
```

`cafe-app/web/app.js`:
```js
'use strict';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const TABS = [['round', 'Round'], ['ideas', 'Ideas'], ['checklist', 'Checklist'], ['review', 'Review'], ['outbox', 'Outbox']];

let state = null;
const ui = { tab: 'ideas', sel: null, notice: '', report: '' };
try { ui.tab = localStorage.getItem('cafe-tab') || 'ideas'; } catch (_) { /* storage blocked */ }

function setTab(tab) {
  ui.tab = tab;
  try { localStorage.setItem('cafe-tab', tab); } catch (_) { /* storage blocked */ }
}

async function api(url, body) {
  const init = body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong'), { data });
  return data;
}

async function refresh() {
  state = await api('/api/state');
  if (!state.ideas.some((i) => i.id === ui.sel)) ui.sel = state.ideas[0] ? state.ideas[0].id : null;
  render();
}

async function act(fn, ok) {
  try {
    const r = await fn();
    ui.notice = ok ? ok(r) : '';
  } catch (e) {
    ui.notice = e.message;
    if (e.data && e.data.missing) setTab('round');
  }
  await refresh();
}

async function copyText(m) {
  try {
    await navigator.clipboard.writeText(`Subject: ${m.subject}\n\n${m.body}`);
    return true;
  } catch (_) {
    return false;
  }
}

const current = () => state.ideas.find((i) => i.id === ui.sel);
const ideaUrl = (suffix) => `/api/ideas/${encodeURIComponent(ui.sel)}/${suffix}`;

function ideaPicker() {
  return `<label>Idea <select data-action="pick">${state.ideas.map((i) =>
    `<option value="${esc(i.id)}" ${i.id === ui.sel ? 'selected' : ''}>${esc(i.id)} ${esc(i.title)}</option>`).join('')}</select></label>`;
}

function viewRound() {
  const { round, settings, fields } = state;
  const input = (src, [key, label], type) =>
    `<label>${esc(label)}<input type="${type}" name="${key}" value="${esc(src[key] ?? '')}"></label>`;
  return `
  <section><h2>${esc(round.id)}: dates</h2>
    <p>Emails that need a date or link can't be approved until it's set here.</p>
    <form data-form="round">${fields.round.map((f) => input(round, f, 'date')).join('')}<button>Save dates</button></form></section>
  <section><h2>Links, signature and capacity</h2>
    <form data-form="settings">${fields.settings.map((f) => input(settings, f, 'text')).join('')}
      <label>Ideas you can take into the design series per round<input type="number" min="1" name="ideasPerRound" value="${settings.capacity.ideasPerRound}"></label>
      <label>Sessions per week<input type="number" min="1" name="sessionsPerWeek" value="${settings.capacity.sessionsPerWeek}"></label>
      <button>Save settings</button></form></section>
  <section><h2>Call for ideas</h2>
    <button data-action="round-draft" data-template="E0">Draft the call for ideas (E0)</button>
    <button data-action="round-draft" data-template="E0B">Draft the deadline reminder (E0B)</button></section>
  <section><h2>For submitters and TTIA</h2>
    <button data-action="status-export">Write status.csv (no names)</button>
    <button data-action="review-pack">Make the review pack for TTIA</button></section>`;
}

function viewIdeas() {
  const rows = state.ideas.map((i) => `
    <tr class="${i.overdue.length ? 'late' : ''}">
      <td><button class="link" data-action="open" data-id="${esc(i.id)}">${esc(i.id)}</button></td>
      <td>${esc(i.title)}</td>
      <td>${esc(i.function || '')}</td>
      <td>${esc(i.progress.label)}</td>
      <td>${i.overdue.map((o) => esc(o.text)).join('<br>') || '—'}</td>
      <td>${esc(i.flags.join(' · ')) || '—'}</td>
    </tr>`).join('');
  const table = state.ideas.length
    ? `<table><thead><tr><th>Café ID</th><th>Title</th><th>Team</th><th>Where it is</th><th>Waiting</th><th>Flags</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p>No ideas yet. Import an export above.</p>';
  const problems = state.problems.length
    ? `<p class="warn">Couldn't read: ${state.problems.map((p) => esc(`${p.folder}: ${p.message}`)).join('; ')}</p>` : '';
  return `
  <section><h2>Import submissions</h2>
    <div id="drop" class="drop">Drop a SharePoint or Forms export (.csv or .xlsx) here, or
      <label class="link">choose a file<input type="file" id="file" accept=".csv,.xlsx" hidden></label></div>
    <div id="report">${ui.report}</div></section>
  <section><h2>Ideas (${state.ideas.length})</h2>${table}${problems}</section>`;
}

function viewChecklist() {
  const i = current();
  if (!i) return '<p>No ideas yet.</p>';
  const stages = [1, 2, 3, 4].map((n) => {
    const items = state.steps.filter((s) => s.stage === n).map((s) => {
      const st = i.status[s.id];
      const t = i.checklist[s.id];
      const draft = s.email && /^E\d+$/.test(s.email) && st === 'open'
        ? ` <button data-action="draft" data-template="${s.email}">Draft ${s.email}</button>` : '';
      const reminder = s.id === 's2d' && i.offerE2R
        ? ' <button data-action="draft" data-template="E2R">No reply for 5+ days · draft reminder (E2R)</button>' : '';
      const who = t && t.done ? `<small>${t.by === 'app' ? 'Ticked by the app' : 'Ticked by you'}, ${esc(t.at)}${t.source ? ` · ${esc(t.source)}` : ''}</small>` : '';
      return `<li class="${st === 'n/a' ? 'na' : st}"><label><input type="checkbox" data-action="tick" data-step="${s.id}" ${st === 'done' ? 'checked' : ''} ${st === 'n/a' ? 'disabled' : ''}>
        <span class="owner">${s.owner}</span> ${esc(s.text)}${s.needed ? ' <em>needed</em>' : ''}</label>${who}${st === 'n/a' ? '<small>Not applicable</small>' : ''}${draft}${reminder}</li>`;
    }).join('');
    return `<section><h3>${n} · ${esc(state.stageNames[n])}${i.stage === n && !i.closed ? ' (now)' : ''}</h3><ul class="steps">${items}</ul></section>`;
  }).join('');
  const move = !i.closed && i.stage < 4 ? `<button class="primary" data-action="advance">Move to ${esc(state.stageNames[i.stage + 1])}</button>` : '';
  return `${ideaPicker()}<p>${esc(i.progress.label)}</p>${move}${stages}`;
}

function viewReview() {
  const i = current();
  if (!i) return '<p>No ideas yet.</p>';
  const r = i.review;
  if (i.closed) return `${ideaPicker()}<section><p>${esc(i.progress.label)}.</p>${r ? `<p>${esc(state.decisions[r.decision])}: ${esc(r.reason)}</p>` : ''}</section>`;
  return `${ideaPicker()}
  <section><form data-form="review">
    <fieldset><legend>Criteria</legend>${state.criteria.map((c) =>
      `<label><input type="checkbox" name="c-${c.id}" ${r && r.criteria[c.id] ? 'checked' : ''}> ${esc(c.text)}</label>`).join('')}</fieldset>
    <label>Decision<select name="decision">${Object.entries(state.decisions).map(([k, v]) =>
      `<option value="${k}" ${r && r.decision === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
    <label>Reason<textarea name="reason" required>${esc(r ? r.reason : '')}</textarea></label>
    <button>Save the review and draft the email</button>
  </form></section>`;
}

function viewOutbox() {
  if (!state.outbox.length) return '<p>Nothing in the Outbox yet.</p>';
  return state.outbox.map((m) => {
    const left = m.contentPlaceholders.length;
    const actions = m.status === 'draft'
      ? `<button class="primary" data-action="approve" data-key="${esc(m.key)}">${m.missingSettings.length ? 'Open Round to set them' : 'Approve and copy'}</button>`
      : m.status === 'approved'
        ? `<button data-action="copy" data-key="${esc(m.key)}">Copy again</button> <button class="primary" data-action="sent" data-key="${esc(m.key)}">Mark as sent</button>`
        : `<small>Sent ${esc(m.sentAt)}</small>`;
    return `<article class="mail ${m.status}">
      <header><strong>${esc(m.template)}</strong> · ${esc(m.idea || m.round)} · <span class="badge">${m.status}</span></header>
      <p><b>To:</b> ${esc(m.view.to)}<br><b>Subject:</b> ${esc(m.view.subject)}</p>
      <pre>${esc(m.view.body)}</pre>
      ${m.missingSettings.length ? `<p class="warn">Set first: ${m.missingSettings.map((x) => esc(x.label)).join(', ')}</p>` : ''}
      ${left ? `<p>${left} placeholder${left === 1 ? '' : 's'} to fill in Outlook.</p>` : ''}
      ${actions}</article>`;
  }).join('');
}

function render() {
  const open = state.outbox.filter((m) => m.status !== 'sent').length;
  $('#tabs').innerHTML = TABS.map(([k, label]) =>
    `<button role="tab" aria-selected="${ui.tab === k}" data-action="tab" data-tab="${k}">${label}${k === 'outbox' && open ? ` (${open})` : ''}</button>`).join('');
  $('#today').textContent = `Today: ${state.today} · ${state.round.id}`;
  $('#notice').textContent = ui.notice;
  $('#notice').hidden = !ui.notice;
  const views = { round: viewRound, ideas: viewIdeas, checklist: viewChecklist, review: viewReview, outbox: viewOutbox };
  $('#main').innerHTML = (views[ui.tab] || viewIdeas)();
}

async function upload(file) {
  if (!file) return;
  try {
    const res = await fetch('/api/import', { method: 'POST', headers: { 'x-filename': file.name, 'content-type': 'application/octet-stream' }, body: file });
    const r = await res.json();
    if (!res.ok) throw new Error(r.error);
    const errors = r.errors.length ? `, ${r.errors.length} row${r.errors.length === 1 ? '' : 's'} not read (${r.errors.map((e) => `row ${e.row}: ${esc(e.message)}`).join('; ')})` : '';
    ui.report = `<p>Imported ${r.created.length} new, skipped ${r.duplicates.length} already imported${errors}.</p>`
      + (r.flags.length ? `<ul>${r.flags.map((f) => `<li>${esc(f.id)}: ${esc(f.message)}</li>`).join('')}</ul>` : '');
    ui.notice = '';
  } catch (e) {
    ui.notice = e.message;
  }
  await refresh();
}

document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-action]');
  if (!b || b.matches('input, select')) return;
  const outboxItem = () => state.outbox.find((x) => x.key === b.dataset.key);
  switch (b.dataset.action) {
    case 'tab': setTab(b.dataset.tab); ui.notice = ''; render(); break;
    case 'open': ui.sel = b.dataset.id; setTab('checklist'); render(); break;
    case 'draft': act(() => api(ideaUrl('draft'), { template: b.dataset.template }), (r) => `${r.template} is drafted in the Outbox.`); break;
    case 'round-draft': act(() => api('/api/round/draft', { template: b.dataset.template }), (r) => `${r.template} is drafted in the Outbox.`); break;
    case 'advance': act(() => api(ideaUrl('advance'), {}), (r) => `${r.id} moved to ${state.stageNames[r.stage]}.`); break;
    case 'status-export': act(() => api('/api/status-export', {}), (r) => `Written: ${r.file}`); break;
    case 'review-pack': act(() => api('/api/review-pack', {}), (r) => `Written: ${r.file}`); break;
    case 'approve': {
      const m = outboxItem();
      if (m.missingSettings.length) {
        setTab('round');
        ui.notice = `Set first: ${m.missingSettings.map((x) => x.label).join(', ')}`;
        render();
        break;
      }
      act(async () => copyText(await api('/api/outbox/approve', { key: m.key })),
        (copied) => (copied ? 'Approved and copied. Paste it into Outlook, then mark it as sent.' : 'Approved. Use "Copy again" to copy it for Outlook.'));
      break;
    }
    case 'copy': {
      const m = outboxItem();
      copyText(m.view).then((ok) => { ui.notice = ok ? 'Copied.' : "Copy didn't work here. Select the text and copy it."; render(); });
      break;
    }
    case 'sent': act(() => api('/api/outbox/sent', { key: b.dataset.key }), () => 'Marked as sent. The matching step is ticked.'); break;
  }
});

document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.matches('[data-action="tick"]')) act(() => api(ideaUrl('tick'), { step: t.dataset.step, done: t.checked }));
  else if (t.matches('[data-action="pick"]')) { ui.sel = t.value; render(); }
  else if (t.id === 'file') upload(t.files[0]);
});

document.addEventListener('submit', (ev) => {
  const form = ev.target.closest('form[data-form]');
  if (!form) return;
  ev.preventDefault();
  const fd = new FormData(form);
  if (form.dataset.form === 'round') {
    act(() => api('/api/round', Object.fromEntries(fd)), () => 'Dates saved.');
  } else if (form.dataset.form === 'settings') {
    const body = Object.fromEntries(state.fields.settings.map(([k]) => [k, fd.get(k) || '']));
    body.capacity = { ideasPerRound: Number(fd.get('ideasPerRound')), sessionsPerWeek: Number(fd.get('sessionsPerWeek')) };
    act(() => api('/api/settings', body), () => 'Settings saved.');
  } else if (form.dataset.form === 'review') {
    const criteria = Object.fromEntries(state.criteria.map((c) => [c.id, fd.get(`c-${c.id}`) === 'on']));
    act(() => api(ideaUrl('review'), { criteria, decision: fd.get('decision'), reason: fd.get('reason') }),
      (r) => `Saved. ${r.email.template} is drafted in the Outbox.${r.warnings.length ? ` ${r.warnings.join(' ')}` : ''}`);
  }
});

const dropZone = (ev) => (ev.target.closest ? ev.target.closest('#drop') : null);
document.addEventListener('dragover', (ev) => {
  const d = dropZone(ev);
  if (d) { ev.preventDefault(); d.classList.add('over'); }
});
document.addEventListener('dragleave', (ev) => {
  const d = dropZone(ev);
  if (d) d.classList.remove('over');
});
document.addEventListener('drop', (ev) => {
  const d = dropZone(ev);
  if (!d) return;
  ev.preventDefault();
  upload(ev.dataTransfer.files[0]);
});

refresh().catch((e) => { $('#main').textContent = `Couldn't reach the app: ${e.message}`; });
```

- [ ] **Step 4: Run all tests and the type check**

Run: `cd cafe-app && npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 5: Click through it once**

This step needs the CLI from Task 12, so use a short script instead. Create `/tmp/cafe-ui-check.ts`:
```ts
import { initWorkspace } from '/Users/chongranhao/github/ms-cs-ttia-office-hours/cafe-app/src/workspace/init';
import { createApp } from '/Users/chongranhao/github/ms-cs-ttia-office-hours/cafe-app/src/server/server';

const root = '/tmp/cafe-ui-check';
const clock = () => '2026-10-19';
(async () => {
  await initWorkspace(root, clock);
  createApp({ root, clock }).listen(4100, '127.0.0.1', () => console.log('http://localhost:4100'));
})();
```
Run it from `cafe-app/`: `npx tsx /tmp/cafe-ui-check.ts`

Open http://localhost:4100. If a Playwright browser tool is available, use it. Check each of these:
1. Ideas: choose `tests/fixtures/sample-export.csv`. The report says 3 new and 1 row not read (row 5), and lists 3 flags.
2. Checklist for CAFE-2026-001: s1d is ticked by the app with source "…sample-export.csv row 2". Click "Draft E1".
3. Outbox: E1 shows "Set first: Decisions by, Your name (email signature)". Clicking the button opens Round.
4. Round: set "Decisions by" and "Your name", save. Outbox E1 now shows the date. Approve and copy, then Mark as sent. Checklist s1e is ticked by the app.
5. Review CAFE-2026-002: route to CSIC with a reason. Outbox gets E5; the Ideas list shows "Closed · Routed to CSIC · …".
6. At a phone width (375px) there is no horizontal page scroll.

Stop the server, then delete `/tmp/cafe-ui-check` and `/tmp/cafe-ui-check.ts`. Fix anything that fails, rerun the tests, and repeat the check.

- [ ] **Step 6: Commit**

```bash
git add cafe-app/web cafe-app/tests/web.test.ts
git commit -m "cafe-app: operator page with Round, Ideas, Checklist, Review and Outbox" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P3ov37P2fF1cuhtF4wyed3"
```

---

### Task 12: CLI, end-to-end run and README

**Files:**
- Create: `cafe-app/bin/cafe.ts`, `cafe-app/README.md`
- Test: `cafe-app/tests/e2e.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `cafe init`, `cafe start [--port N]`, `cafe import <file>`, `cafe status`, each with `--workspace DIR`. The default workspace is `$CAFE_WORKSPACE`, or `./cafe-workspace` if that is unset.
  - `npm run cafe -- <command>` runs it without a global install.

- [ ] **Step 1: Write the failing end-to-end test**

`cafe-app/tests/e2e.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { tmpWorkspace, FIXTURE } from './helpers';
import { importExport } from '../src/import/importRows';
import { saveRound, saveSettings } from '../src/round/store';
import { draftEmail, approve, markSent, listOutbox } from '../src/comms/outbox';
import { tick, advance, progress } from '../src/checklist/checklist';
import { saveReview } from '../src/review/review';
import { overdue, needsE2R } from '../src/reminders/due';
import { writeStatusCsv } from '../src/exports/status';
import { listIdeas, loadIdea, ideaDir } from '../src/ideas/store';
import { DEFAULT_STEPS as steps } from '../src/rules/stages';
import { APP_DIR } from '../src/workspace/paths';

describe('a round, end to end', () => {
  it('runs the three real submissions from import to decisions', async () => {
    let today = '2026-10-19';
    const clock = () => today;
    const root = await tmpWorkspace(today);
    const ids = ['CAFE-2026-001', 'CAFE-2026-002', 'CAFE-2026-003'];

    expect((await importExport(root, FIXTURE, { clock, steps })).created).toHaveLength(3);
    await saveSettings(root, { operatorName: 'Café operator', csicLink: 'https://csic.example/intake' });
    await saveRound(root, { reviewBy: '2026-11-02' });

    const send = async (template: string, ideaId: string) => {
      const d = await draftEmail(root, { template, ideaId }, clock);
      await approve(root, d.key, clock);
      return markSent(root, d.key, clock, steps);
    };

    for (const id of ids) {
      await send('E1', id);
      await tick(root, id, 's1a', true, { by: 'operator', clock, steps });
      await tick(root, id, 's1b', true, { by: 'operator', clock, steps });
      expect((await advance(root, id, steps, clock)).stage).toBe(2);
    }

    const ask = await saveReview(root, ids[0], { decision: 'ask', reason: 'Did they try Copilot in Outlook?' }, { clock, steps });
    await approve(root, ask.email.key, clock);
    await markSent(root, ask.email.key, clock, steps);

    const csic = await saveReview(root, ids[1], { decision: 'csic', reason: 'Defined, sponsored, serves people beyond the team.' }, { clock, steps });
    await approve(root, csic.email.key, clock);
    await markSent(root, csic.email.key, clock, steps);
    await access(path.join(await ideaDir(root, ids[1]), 'csic-handoff.md'));

    const sel = await saveReview(root, ids[2], {
      criteria: { feasible: true, builder: true, data: true, theme: true }, decision: 'select', reason: 'Redacted sample invoices are enough.',
    }, { clock, steps });
    await approve(root, sel.email.key, clock);
    await markSent(root, sel.email.key, clock, steps);
    await tick(root, ids[2], 's2e', true, { by: 'operator', clock, steps });
    expect((await advance(root, ids[2], steps, clock)).stage).toBe(3);

    const labels = (await listIdeas(root)).ideas.map((i) => progress(i, steps).label);
    expect(labels).toEqual([
      'Review and Select · 5 of 25',
      'Closed · Routed to CSIC · 6 of 11',
      'Design series · 7 of 25',
    ]);
    expect((await listOutbox(root)).every((m) => m.status === 'sent')).toBe(true);

    today = '2026-10-26';
    const late = overdue(await loadIdea(root, ids[0]), steps, today);
    expect(late[0].text).toBe('E2 sent 7 days ago · reply due 24 October 2026');
    expect(needsE2R(late)).toBe(true);

    const csv = await readFile(await writeStatusCsv(root, clock), 'utf8');
    expect(csv).toContain('CAFE-2026-001,Email scheduler,Under review · decision by 2 November 2026,2026-10-26');
    expect(csv).toContain('CAFE-2026-002,RFx CoE Intelligent Intake & Ticketing Agent,Routed to CSIC,2026-10-26');
    expect(csv).toContain('CAFE-2026-003,Third Party Invoice Assessment,Selected · design series,2026-10-26');
    expect(csv).not.toMatch(/Person/);
  });

  it('the CLI sets up a workspace and imports an export', async () => {
    const root = path.join(await tmpWorkspace(), 'cli-ws');
    const run = (...args: string[]) =>
      execFileSync(process.execPath, ['--import', 'tsx', path.join(APP_DIR, 'bin', 'cafe.ts'), ...args, '--workspace', root], {
        cwd: APP_DIR, encoding: 'utf8', env: { ...process.env, CAFE_TODAY: '2026-10-19' },
      });
    expect(run('init')).toContain('rules/settings.yaml');
    expect(JSON.parse(run('import', FIXTURE)).created).toHaveLength(3);
    expect(run('status').trim()).toBe(path.join(root, 'exports', 'status.csv'));
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `cd cafe-app && npx vitest run tests/e2e.test.ts`
Expected: the first test PASSES, because every module exists. The CLI test FAILS with "Cannot find module …/bin/cafe.ts".

- [ ] **Step 3: Write the CLI**

`cafe-app/bin/cafe.ts`:
```ts
#!/usr/bin/env -S npx tsx
import path from 'node:path';
import { initWorkspace } from '../src/workspace/init';
import { createApp } from '../src/server/server';
import { importExport } from '../src/import/importRows';
import { writeStatusCsv } from '../src/exports/status';
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
      createApp({ root, clock }).listen(port, '127.0.0.1', () => {
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
    case 'status': {
      console.log(await writeStatusCsv(root, clock));
      return;
    }
    default:
      console.log('Usage: cafe <init | start | import <file> | status> [--workspace DIR] [--port N]');
  }
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
```

- [ ] **Step 4: Write the README**

`cafe-app/README.md`:
````markdown
# Creators' Café operator app

A local app for the person who runs the CS TTIA Creators' Café. It imports the submission export, tracks
each idea's 25 steps, drafts the emails, blocks any email that still needs a date or link, shows replies
that are late, and writes `status.csv` for submitters. It never sends anything: you approve, copy, send
from Outlook, then mark the email as sent.

This is plan 1 of 4 (core, no AI). The design is in
`docs/superpowers/specs/2026-10-19-creators-cafe-app-design.md`.

## Run it

```bash
cd cafe-app
npm install
npm run cafe -- start --workspace ~/cafe-workspace
```

Open http://localhost:4100. The workspace folder is plain YAML and Markdown; keep it in git if you want
history.

Other commands:

```bash
npm run cafe -- init   --workspace ~/cafe-workspace     # create the folders, rules and templates
npm run cafe -- import export.csv --workspace ~/cafe-workspace
npm run cafe -- status --workspace ~/cafe-workspace     # write exports/status.csv
```

`CAFE_TODAY=2026-10-26` pretends today is another date, for example to see which replies are late.

## A round, by hand

1. **Round:** set the dates, the links and your name. Draft E0 (call for ideas) and E0B (deadline reminder).
2. **Ideas:** drop the SharePoint or Forms export. Re-dropping it only adds new rows.
3. **Checklist:** draft E1 for each idea, tick what the team has done, then move it to Review and Select.
4. **Review:** tick the five criteria, pick a decision, give a reason. Routing to CSIC also writes
   `csic-handoff.md` with a follow-up date four weeks out.
5. **Outbox:** approve and copy, send from Outlook, mark as sent. The matching step ticks itself and
   E2 starts a five-day reply clock.
6. **Round:** write `status.csv` and the review pack for TTIA.

## Tests

```bash
npm test
npm run typecheck
```
````

- [ ] **Step 5: Run everything**

Run: `cd cafe-app && npx vitest run && npx tsc --noEmit`
Expected: all test files PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add cafe-app/bin cafe-app/README.md cafe-app/tests/e2e.test.ts
git commit -m "cafe-app: CLI, end-to-end round test and README" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P3ov37P2fF1cuhtF4wyed3"
```

---

## Spec coverage (Plan 1)

| Spec | Where |
|---|---|
| 2 No-AI mode, `cafe start`, localhost:4100 | Tasks 10–12 |
| 3 Workspace layout, IDs, re-import, idea.yaml mapping | Tasks 4, 6 |
| 3 Rounds and settings, gating, capacity | Tasks 2, 4, 7, 8 |
| 4 Stages, 25 steps, needed steps gate, operator moves stage, ticks logged | Tasks 2, 5 |
| 4 Self-ticking steps: email sent (s1e, s2c, s2f, s3b, s3h, s3i, s4a, s4e), import (s1d) | Tasks 6, 7 |
| 4 Review criteria, decision → email, review.md, review pack | Task 8 |
| 4 Due dates, overdue in Ideas, E2R offer | Tasks 7, 9, 11 |
| 4 Routing to CSIC, handoff, four-week follow-up; early closures | Task 8 |
| 8 Templates E0–E11, E2R, session reminder, reschedule, data-held; Café ID in subject; placeholders never invented; outbox flow | Tasks 3, 7 |
| 8 status.csv with no names | Task 9 |
| 11 Exports carry no names | Task 9 |
| 12 Malformed export rows, cut-off cells flagged | Task 6 |
| 13 Unit, settings-gating, due-date and end-to-end tests | Tasks 1–12 |

Left for later plans: AI pre-ticks and suggestions, Inbox triage and Undo (Plan 2); the knowledge graph (Plan 3); auto-ticks for tool picks and design approval, cohorts, `.ics` invites, session reminders by date, the roadshow pack, and the Café pattern and stop closures (Plan 4).
