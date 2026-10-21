# Agentic Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every file dropped in the Inbox runs through eight recorded steps the screen shows live; the AI understands the file and builds the knowledge graph without a Confirm step; code holds back only conflicts, errors and suspicious items for the operator; the Inbox screen shows a drop well, in-flight cards and the full history.

**Architecture:** The existing pipeline (`saveDrop` → `triageItem` → `planActions` → apply Safe) is kept and instrumented: a `steps` array on the item sidecar is written after each step by `markStep`; a new pure module `conflicts.ts` splits proposals into apply / hold before `kindOf`; `triageTask` becomes `understandTask` with a richer output; AI links are stored `confirmed` on arrival except held ones. The UI polls the Inbox view while a step is running and renders cards from the `steps` array. Plain React, SVG and CSS; no new libraries.

**Tech Stack:** Node ≥ 20, TypeScript strict, vitest; React 19 + Vite (`cafe-app/ui`), zustand; plain-file workspace (YAML / JSON sidecars / JSONL).

**Spec:** `docs/superpowers/specs/2026-10-21-cafe-agentic-inbox-design.md`

## Global Constraints

- Everything in `cafe-app/`; run commands from `cafe-app/` (server) or `cafe-app/ui/` (UI). Server tests: `npx vitest run <file>`; UI tests: `cd ui && npx vitest run <file>`; typecheck: `npx tsc --noEmit -p .` in each.
- No personal data to the AI: Person labels never become stars from text (rule `person-star`); addresses never leave the server (`displayName` only).
- Nothing the AI writes is an instruction: all AI output is schema-checked (`parseChecked`) and rendered as text.
- Stages are never moved by a dropped file: `suggest_stage` stays `kind: 'ok'`.
- Only the conflicting item waits: held proposals become pending records; everything else is applied in the same run.
- `AiLink.status` values are `'pending' | 'confirmed' | 'removed'` (existing); "held back" = `pending`.
- Copy rules: plain English, no jargon in `detail` lines; never a person's name in `detail`, `understood` or history.
- Commit after every task with the trailers `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01P3ov37P2fF1cuhtF4wyed3`.
- Never touch the server on port 4100 (the operator's). Tests start their own servers (`startServer` in `tests/helpers.ts`); the tour uses port 4103.

## Review Focus

1. A file whose AI call throws midway (network, rate limit): the steps must read `understand: failed`, `context/graph/check: skipped`, the item stays `triaged` with the problem, and nothing is half-applied. Test in Task 5 (`inbox-flow.test.ts`: "AI failure").
2. Re-running steps 4–8 on an item that already applied actions must not file the email twice or add the same links twice. Test in Task 5 ("reprocess keeps applied records").
3. A held link resolved with "Use existing" must rewrite the new-star end to the existing node id and not leave the orphan new star. Test in Task 5 ("apply with resolve use-existing").
4. The Inbox pop-out polling must stop when nothing is running (no 1 s requests forever) and must survive the pop-out closing mid-run. Test in Task 6 (`inboxHelpers.test.ts`: `shouldPoll`; `InboxPopout` unmount clears the timer).
5. A drop of a repeat file must show one `receive` step with the duplicate detail and must not run the AI. Test in Task 5 ("repeat drop").

---

### Task 1: Step log on the item

**Files:**
- Create: `cafe-app/src/inbox/steps.ts`
- Modify: `cafe-app/src/inbox/store.ts` (`InboxItem.steps`)
- Test: `cafe-app/tests/inbox-steps.test.ts`

**Interfaces:**
- Produces: `StepId`, `StepStatus`, `Step`, `STEP_ORDER: StepId[]`, `STEP_WORDS`, `markStep(root, id, step: Omit<Step,'at'> & { at?: string }): Promise<InboxItem>`, `resetStepsFrom(root, id, from: StepId): Promise<InboxItem>`, `skipRest(root, id, after: StepId, detail: string): Promise<InboxItem>`, `stepOf(item, id): Step | undefined`, `isRunning(item): boolean`, `timed(root, id, step, running, fn)`.

- [ ] **Step 1: Write the failing test**

```ts
// cafe-app/tests/inbox-steps.test.ts
import { describe, it, expect } from 'vitest';
import { tmpWorkspace } from './helpers';
import { saveDrop, getItem } from '../src/inbox/store';
import { markStep, resetStepsFrom, skipRest, STEP_ORDER, isRunning, stepOf } from '../src/inbox/steps';

const ws = () => tmpWorkspace('2026-10-21');
const drop = async (root: string) => saveDrop(root, 'reply.eml', 'Subject: x\n\nhello', () => '2026-10-21');

describe('inbox steps', () => {
  it('appends steps in order and replaces a running step with its result', async () => {
    const root = await ws(); const item = await drop(root);
    await markStep(root, item.id, { id: 'receive', status: 'done', detail: 'reply.eml, 1 KB' });
    await markStep(root, item.id, { id: 'read', status: 'running', detail: 'Reading…' });
    expect(isRunning((await getItem(root, item.id))!)).toBe(true);
    const after = await markStep(root, item.id, { id: 'read', status: 'done', detail: 'Email, 1 paragraph', ms: 12 });
    expect(after.steps!.map((s) => `${s.id}:${s.status}`)).toEqual(['receive:done', 'read:done']);
    expect(stepOf(after, 'read')!.ms).toBe(12);
    expect(after.steps![1].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(isRunning(after)).toBe(false);
  });
  it('skipRest marks every later step skipped with the given detail', async () => {
    const root = await ws(); const item = await drop(root);
    await markStep(root, item.id, { id: 'receive', status: 'done', detail: 'x' });
    await markStep(root, item.id, { id: 'read', status: 'done', detail: 'x' });
    await markStep(root, item.id, { id: 'screen', status: 'needs-you', detail: 'Looks like a list of people' });
    const after = await skipRest(root, item.id, 'screen', 'held at the screen');
    expect(after.steps!.map((s) => s.status)).toEqual(['done', 'done', 'needs-you', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped']);
    expect(after.steps!.at(-1)).toMatchObject({ id: 'check', detail: 'held at the screen' });
  });
  it('resetStepsFrom drops the step and everything after it, keeping earlier ones', async () => {
    const root = await ws(); const item = await drop(root);
    for (const id of STEP_ORDER) await markStep(root, item.id, { id, status: 'done', detail: id });
    const after = await resetStepsFrom(root, item.id, 'match');
    expect(after.steps!.map((s) => s.id)).toEqual(['receive', 'read', 'screen']);
  });
  it('STEP_ORDER is the eight steps of the spec', () => {
    expect(STEP_ORDER).toEqual(['receive', 'read', 'screen', 'match', 'understand', 'context', 'graph', 'check']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd cafe-app && npx vitest run tests/inbox-steps.test.ts`
Expected: FAIL, "Cannot find module '../src/inbox/steps'".

- [ ] **Step 3: Implement**

```ts
// cafe-app/src/inbox/steps.ts
import { getItem, updateItem, type InboxItem } from './store';

/**
 * The step log of one dropped file: eight fixed steps, each written to the sidecar the moment it ends,
 * so the Inbox screen can show the run live. A step is appended once; writing the same id again replaces it
 * (running → done / failed / needs-you).
 */
export type StepId = 'receive' | 'read' | 'screen' | 'match' | 'understand' | 'context' | 'graph' | 'check';
export type StepStatus = 'running' | 'done' | 'skipped' | 'needs-you' | 'failed';
export interface Step { id: StepId; status: StepStatus; at: string; detail: string; ms?: number }

export const STEP_ORDER: StepId[] = ['receive', 'read', 'screen', 'match', 'understand', 'context', 'graph', 'check'];
export const STEP_WORDS: Record<StepId, string> = {
  receive: 'Receive', read: 'Read', screen: 'Screen', match: 'Match', understand: 'Understand', context: 'Update context', graph: 'Build the graph', check: 'Check',
};

const now = () => new Date().toISOString();

async function load(root: string, id: string): Promise<InboxItem> {
  const item = await getItem(root, id);
  if (!item) throw new Error(`No inbox item ${id}`);
  return item;
}

export async function markStep(root: string, id: string, step: Omit<Step, 'at'> & { at?: string }): Promise<InboxItem> {
  const item = await load(root, id);
  const steps = [...(item.steps ?? [])];
  const full: Step = { ...step, at: step.at ?? now() };
  const i = steps.findIndex((s) => s.id === step.id);
  if (i >= 0) steps[i] = full; else steps.push(full);
  return updateItem(root, id, { steps });
}

/** Every step after `after` becomes skipped with `detail` (a failure or a hold ended the run). */
export async function skipRest(root: string, id: string, after: StepId, detail: string): Promise<InboxItem> {
  const item = await load(root, id);
  const steps = [...(item.steps ?? [])];
  const at = now();
  for (const sid of STEP_ORDER.slice(STEP_ORDER.indexOf(after) + 1)) {
    const i = steps.findIndex((s) => s.id === sid);
    const s: Step = { id: sid, status: 'skipped', at, detail };
    if (i >= 0) steps[i] = s; else steps.push(s);
  }
  return updateItem(root, id, { steps });
}

/** Drop `from` and everything after it (a re-run of steps 4–8 starts here). */
export async function resetStepsFrom(root: string, id: string, from: StepId): Promise<InboxItem> {
  const item = await load(root, id);
  const keep = new Set(STEP_ORDER.slice(0, STEP_ORDER.indexOf(from)));
  return updateItem(root, id, { steps: (item.steps ?? []).filter((s) => keep.has(s.id)) });
}

export const stepOf = (item: Pick<InboxItem, 'steps'>, id: StepId): Step | undefined => item.steps?.find((s) => s.id === id);
export const isRunning = (item: Pick<InboxItem, 'steps'>): boolean => (item.steps ?? []).some((s) => s.status === 'running');

/** Measures one step: marks it running, runs `fn`, marks done with ms (or failed with the error) and rethrows. */
export async function timed<T>(
  root: string, id: string, step: StepId, running: string,
  fn: () => Promise<{ value: T; detail: string; status?: StepStatus }>,
): Promise<T> {
  await markStep(root, id, { id: step, status: 'running', detail: running });
  const t0 = Date.now();
  try {
    const r = await fn();
    await markStep(root, id, { id: step, status: r.status ?? 'done', detail: r.detail, ms: Date.now() - t0 });
    return r.value;
  } catch (e) {
    await markStep(root, id, { id: step, status: 'failed', detail: (e as Error).message || 'failed', ms: Date.now() - t0 });
    throw e;
  }
}
```

In `cafe-app/src/inbox/store.ts`, add to `InboxItem` after `problems?: string[];`:

```ts
  /** The run, step by step (src/inbox/steps.ts). */
  steps?: import('./steps').Step[];
```

`viewOf` in `flow.ts` is `({ text, meta, ...rest })`, so `steps` is already returned to the UI; nothing to change there.

- [ ] **Step 4: Run the tests**

Run: `cd cafe-app && npx vitest run tests/inbox-steps.test.ts && npx tsc --noEmit -p .`
Expected: 4 passed; no type errors.

- [ ] **Step 5: Commit**

```bash
git add cafe-app/src/inbox/steps.ts cafe-app/src/inbox/store.ts cafe-app/tests/inbox-steps.test.ts
git commit -m "Inbox: a step log on each dropped item (eight steps, written as they end)"
```

---

### Task 2: Conflict rules

**Files:**
- Create: `cafe-app/src/inbox/conflicts.ts`
- Test: `cafe-app/tests/inbox-conflicts.test.ts`

**Interfaces:**
- Consumes: `Action` from `./actions`, `AiLink`, `GNode` from `../graph/ontology`, `Idea` from `../ideas/idea`, `DesignState` from `../design/store`.
- Produces: `HeldRule`, `Held { action; rule; why; existing? }`, `ConflictContext`, `LOW_CONFIDENCE = 0.5`, `NEAR_DUPLICATE = 0.8`, `normaliseLabel(s): string`, `wordOverlap(a, b): number`, `isPersonLabel(label, ctx): boolean`, `checkProposals(ctx, actions: Action[]): { apply: Action[]; hold: Held[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// cafe-app/tests/inbox-conflicts.test.ts
import { describe, it, expect } from 'vitest';
import { checkProposals, normaliseLabel, wordOverlap, type ConflictContext } from '../src/inbox/conflicts';
import type { Action } from '../src/inbox/actions';
import type { AiLink } from '../src/graph/ontology';
import { sampleIdea } from './helpers';

const link = (over: Partial<AiLink> = {}): AiLink => ({
  from: 'idea:CAFE-2026-001', to: 'capability:slot-finding', rel: 'NEEDS', description: 'd', source: 'ai:fake:reply.eml', confidence: 0.9, status: 'pending', ...over,
});
const ctx = (over: Partial<ConflictContext> = {}): ConflictContext => ({
  idea: sampleIdea({ id: 'CAFE-2026-001', people: { team: [{ name: 'Person 1', role: 'lead' }], builder: 'Person 1' } as any }),
  ideas: [sampleIdea({ id: 'CAFE-2026-001' }), sampleIdea({ id: 'CAFE-2026-003', title: 'Invoice checker' })],
  nodes: [{ id: 'capability:slot-finding', type: 'Capability', label: 'Slot finding' }, { id: 'tool:power-apps', type: 'Tool', label: 'Power Apps' }],
  peoplePresent: ['Person 2'],
  design: null,
  match: { ideaId: 'CAFE-2026-001', confidence: 1, candidates: ['CAFE-2026-001'] },
  aiIdeaId: 'CAFE-2026-001',
  screened: [],
  ...over,
});

describe('normaliseLabel and wordOverlap', () => {
  it('lower-cases, strips punctuation and stop words, singularises', () => {
    expect(normaliseLabel('The Shared Mailboxes!')).toBe('shared mailbox');
    expect(normaliseLabel('Slot-finding')).toBe('slot finding');
  });
  it('overlap is the share of words in common over the shorter label', () => {
    expect(wordOverlap('Request intake form', 'Request intake')).toBe(1);
    expect(wordOverlap('Manual request triage', 'Request sorting by hand')).toBeCloseTo(1 / 3);
  });
});

describe('checkProposals', () => {
  it('applies a plain link between known stars', () => {
    const a: Action = { t: 'graph_links', ideaId: 'CAFE-2026-001', links: [link()] };
    expect(checkProposals(ctx(), [a])).toEqual({ apply: [a], hold: [] });
  });
  it('low-confidence: holds a link under 0.5, keeps the rest of the same action', () => {
    const a: Action = { t: 'graph_links', ideaId: 'CAFE-2026-001', links: [link(), link({ to: 'tool:power-apps', rel: 'BUILT_WITH', confidence: 0.42 })] };
    const r = checkProposals(ctx(), [a]);
    expect((r.apply[0] as any).links).toHaveLength(1);
    expect(r.hold).toHaveLength(1);
    expect(r.hold[0]).toMatchObject({ rule: 'low-confidence', why: 'The AI was not sure (42%)' });
    expect((r.hold[0].action as any).links).toHaveLength(1);
  });
  it('person-star: holds a new Person node, or a label naming someone present', () => {
    const a: Action = { t: 'graph_links', ideaId: 'CAFE-2026-001', links: [
      link({ to: 'person:person-2', newNodes: [{ id: 'person:person-2', type: 'Person', label: 'Person 2' }] }),
      link({ to: 'capability:person-2-s-desk', newNodes: [{ id: 'capability:person-2-s-desk', type: 'Capability', label: 'Person 2' }] }),
    ] };
    const r = checkProposals(ctx(), [a]);
    expect(r.apply).toEqual([]);
    expect(r.hold.map((h) => h.rule)).toEqual(['person-star', 'person-star']);
    expect(r.hold[0].why).toBe('People come from the form only, never from text');
  });
  it('near-duplicate-star: holds a new node whose label normalises to an existing one and names it', () => {
    const a: Action = { t: 'graph_links', ideaId: 'CAFE-2026-001', links: [
      link({ to: 'capability:slot-findings', newNodes: [{ id: 'capability:slot-findings', type: 'Capability', label: 'Slot findings' }] }),
    ] };
    const r = checkProposals(ctx(), [a]);
    expect(r.hold[0]).toMatchObject({ rule: 'near-duplicate-star', why: 'Looks like Slot finding: merge or keep both?', existing: 'capability:slot-finding' });
  });
  it('contradicts-fact: a different builder waits; the same builder does not', () => {
    const other: Action = { t: 'name_builder', ideaId: 'CAFE-2026-001', name: 'Person 2' };
    const same: Action = { t: 'name_builder', ideaId: 'CAFE-2026-001', name: 'Person 1' };
    const r = checkProposals(ctx(), [other, same]);
    expect(r.apply).toEqual([same]);
    expect(r.hold[0]).toMatchObject({ rule: 'contradicts-fact', why: 'A second builder is named: the form names one already' });
  });
  it('contradicts-fact: a stage hint behind the idea or into a closure waits; forward does not', () => {
    const c = ctx({ idea: sampleIdea({ id: 'CAFE-2026-001', stage: 3 }) });
    const back: Action = { t: 'suggest_stage', ideaId: 'CAFE-2026-001', stage: 2 };
    const close: Action = { t: 'suggest_stage', ideaId: 'CAFE-2026-001', closeAs: 'csic' };
    const fwd: Action = { t: 'suggest_stage', ideaId: 'CAFE-2026-001', stage: 4 };
    const r = checkProposals(c, [back, close, fwd]);
    expect(r.apply).toEqual([fwd]);
    expect(r.hold.map((h) => h.rule)).toEqual(['contradicts-fact', 'contradicts-fact']);
  });
  it('two-ideas: holds everything but the filing when the match is split', () => {
    const c = ctx({ match: { ideaId: 'CAFE-2026-001', confidence: 0.9, candidates: ['CAFE-2026-001', 'CAFE-2026-003'] }, aiIdeaId: 'CAFE-2026-003' });
    const file: Action = { t: 'file_email', ideaId: 'CAFE-2026-001', direction: 'in' };
    const ans: Action = { t: 'record_answers', ideaId: 'CAFE-2026-001', answers: [{ question: 'q', answer: 'a' }] };
    const r = checkProposals(c, [file, ans]);
    expect(r.apply).toEqual([file]);
    expect(r.hold[0]).toMatchObject({ rule: 'two-ideas', why: 'This could belong to CAFE-2026-001 or CAFE-2026-003' });
  });
  it('duplicate-idea: a created idea whose title matches an existing one waits', () => {
    const a: Action = { t: 'create_idea', fields: { title: 'Invoice Checker' } };
    const r = checkProposals(ctx(), [a]);
    expect(r.hold[0]).toMatchObject({ rule: 'duplicate-idea', why: 'Looks like CAFE-2026-003 (same title)', existing: 'CAFE-2026-003' });
  });
  it('screened: when the screen flagged the file, every graph and fact action waits with the screen reason', () => {
    const c = ctx({ screened: ['Mentions a phone number'] });
    const a: Action = { t: 'graph_links', ideaId: 'CAFE-2026-001', links: [link()] };
    const r = checkProposals(c, [a, { t: 'file_email', ideaId: 'CAFE-2026-001', direction: 'in' }]);
    expect(r.apply.map((x) => x.t)).toEqual(['file_email']);
    expect(r.hold[0]).toMatchObject({ rule: 'screened', why: 'Mentions a phone number' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd cafe-app && npx vitest run tests/inbox-conflicts.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// cafe-app/src/inbox/conflicts.ts
import type { Action } from './actions';
import type { AiLink, GNode } from '../graph/ontology';
import type { Idea } from '../ideas/idea';
import type { DesignState } from '../design/store';

/**
 * The conflict rules: code, not AI, decides what waits for the operator. Everything else is applied at once
 * (ruling: only the conflicting item waits). One proposal → apply, or hold with the rule and a plain reason.
 */
export type HeldRule = 'contradicts-fact' | 'person-star' | 'near-duplicate-star' | 'low-confidence' | 'two-ideas' | 'duplicate-idea' | 'screened';
export interface Held {
  action: Action; rule: HeldRule; why: string;
  /** The existing node or idea this clashes with, when there is one. */
  existing?: string;
}
export interface ConflictContext {
  idea: Idea | null;
  ideas: Idea[];
  nodes: GNode[];
  /** Display names present in the file (To, Cc, From, speakers). */
  peoplePresent: string[];
  design: DesignState | null;
  match: { ideaId: string | null; confidence: number; candidates: string[] };
  aiIdeaId: string | null;
  /** The screen's reasons, when it flagged anything (the file was still read). */
  screened: string[];
}

export const LOW_CONFIDENCE = 0.5;
export const NEAR_DUPLICATE = 0.8;
const STOP = new Set(['the', 'a', 'an', 'of', 'for', 'to', 'in', 'on', 'and', 'or', 'by', 'with', 'into', 's']);

const singular = (w: string) => (w.length > 3 && w.endsWith('es') && !w.endsWith('ses') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

export function normaliseLabel(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w && !STOP.has(w)).map(singular).join(' ').trim();
}

export function wordOverlap(a: string, b: string): number {
  const x = new Set(normaliseLabel(a).split(' ').filter(Boolean)); const y = new Set(normaliseLabel(b).split(' ').filter(Boolean));
  if (!x.size || !y.size) return 0;
  let n = 0; for (const w of x) if (y.has(w)) n++;
  return n / Math.min(x.size, y.size);
}

export function isPersonLabel(label: string, ctx: ConflictContext): boolean {
  const k = normaliseLabel(label);
  const people = [
    ...ctx.peoplePresent, ...(ctx.idea?.people.team.map((p) => p.name) ?? []),
    ctx.idea?.people.submitter ?? '', (ctx.idea?.people as { builder?: string } | undefined)?.builder ?? '',
  ];
  return people.some((p) => p && normaliseLabel(p) === k);
}

const pct = (c: number) => `${Math.round(c * 100)}%`;

/** One link → null (fine) or the held reason. */
function checkLink(l: AiLink, ctx: ConflictContext): Omit<Held, 'action'> | null {
  for (const n of l.newNodes ?? []) {
    if (n.type === 'Person' || isPersonLabel(n.label, ctx)) return { rule: 'person-star', why: 'People come from the form only, never from text' };
    const k = normaliseLabel(n.label);
    const twin = ctx.nodes.find((x) => x.type === n.type && x.id !== n.id && (normaliseLabel(x.label) === k || wordOverlap(x.label, n.label) >= NEAR_DUPLICATE));
    if (twin) return { rule: 'near-duplicate-star', why: `Looks like ${twin.label}: merge or keep both?`, existing: twin.id };
  }
  if (l.confidence < LOW_CONFIDENCE) return { rule: 'low-confidence', why: `The AI was not sure (${pct(l.confidence)})` };
  return null;
}

function stageBack(idea: Idea, a: Extract<Action, { t: 'suggest_stage' }>): boolean {
  if (a.closeAs) return true;
  return a.stage !== undefined && a.stage <= idea.stage;
}

export function checkProposals(ctx: ConflictContext, actions: Action[]): { apply: Action[]; hold: Held[] } {
  const apply: Action[] = []; const hold: Held[] = [];
  const split = ctx.match.candidates.length > 1 && ctx.match.confidence >= 0.7 && ctx.match.confidence < 1
    && ctx.aiIdeaId !== null && ctx.aiIdeaId !== ctx.match.ideaId;
  const twoIdeas = split ? `This could belong to ${ctx.match.candidates.slice(0, 2).join(' or ')}` : null;
  for (const a of actions) {
    if (a.t === 'ask_idea' || a.t === 'import_export' || a.t === 'file_email') { apply.push(a); continue; }
    if (ctx.screened.length) { hold.push({ action: a, rule: 'screened', why: ctx.screened[0] }); continue; }
    if (twoIdeas) { hold.push({ action: a, rule: 'two-ideas', why: twoIdeas }); continue; }
    switch (a.t) {
      case 'graph_links': {
        const ok: AiLink[] = [];
        for (const l of a.links) {
          const h = checkLink(l, ctx);
          if (h) hold.push({ action: { ...a, links: [l] }, ...h }); else ok.push(l);
        }
        if (ok.length) apply.push({ ...a, links: ok });
        break;
      }
      case 'name_builder': {
        const have = (ctx.idea?.people as { builder?: string } | undefined)?.builder;
        if (have && normaliseLabel(have) !== normaliseLabel(a.name)) hold.push({ action: a, rule: 'contradicts-fact', why: 'A second builder is named: the form names one already' });
        else apply.push(a);
        break;
      }
      case 'suggest_stage': {
        if (ctx.idea && stageBack(ctx.idea, a)) {
          hold.push({ action: a, rule: 'contradicts-fact', why: a.closeAs ? 'The file points at closing the idea' : 'The file points at an earlier stage than the idea is in' });
        } else apply.push(a);
        break;
      }
      case 'create_idea': {
        const k = normaliseLabel(a.fields.title);
        const twin = ctx.ideas.find((i) => normaliseLabel(i.title) === k);
        if (twin) hold.push({ action: a, rule: 'duplicate-idea', why: `Looks like ${twin.id} (same title)`, existing: twin.id });
        else apply.push(a);
        break;
      }
      default:
        apply.push(a);
    }
  }
  return { apply, hold };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd cafe-app && npx vitest run tests/inbox-conflicts.test.ts && npx tsc --noEmit -p .`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add cafe-app/src/inbox/conflicts.ts cafe-app/tests/inbox-conflicts.test.ts
git commit -m "Inbox: conflict rules decide what waits for the operator"
```

---

### Task 3: The understand task (AI pass)

**Files:**
- Modify: `cafe-app/src/ai/tasks.ts` (add `Understanding`, `UNDERSTAND_SCHEMA`, `understandTask`; `export const triageTask = understandTask` keeps every import working)
- Modify: `cafe-app/src/ai/providers/fake.ts` (scripted `understand`)
- Modify: `cafe-app/src/inbox/triage.ts` (`TriageInput` gains `knownStars`, `teamAnswers`; calls `understandTask`; `TriageRecord.ai?: Understanding`)
- Test: `cafe-app/tests/inbox-understand.test.ts`

**Interfaces:**
- Produces: `interface Understanding { what: string; understood: string[]; kind: Triage['kind']; ideaId: string | null; matchConfidence: number; facts: Triage['facts']; uncertain: string[] }`; `understandTask: Task<Understanding>` (name `'understand'`); `TriageInput.knownStars?: { type: string; label: string }[]`; `TriageInput.teamAnswers?: { question: string; answer: string }[]`.
- The fake, by prompt text: `/second builder/i` → the conflicting-reply fixture (`builderNamed: 'Person 9'`, new star `Capability: Slot findings`); `/"type":"transcript"|-->/` → the transcript fixture (`attendanceConfirmed: true`, one PainPoint); otherwise the reply fixture (today's `TRIAGE.facts` with `what`, `understood`, `uncertain` added).

- [ ] **Step 1: Write the failing test**

```ts
// cafe-app/tests/inbox-understand.test.ts
import { describe, it, expect } from 'vitest';
import { understandTask, UNDERSTAND_SCHEMA, triageTask } from '../src/ai/tasks';
import { fakeProvider } from '../src/ai/providers/fake';

const base = {
  what: 'A reply answering our questions', understood: ['About 40 requests a week', 'Triaged by hand today'], kind: 'reply', ideaId: 'CAFE-2026-001', matchConfidence: 0.9,
  facts: { answers: [], replyReceived: true, builderNamed: null, newFlags: [], stageHint: null, graph: { nodes: [], links: [] } }, uncertain: [],
};

describe('understandTask', () => {
  it('parses a full answer and refuses missing understood lines or a Person node', () => {
    expect(understandTask.parse(JSON.stringify(base)).understood).toHaveLength(2);
    expect(() => understandTask.parse(JSON.stringify({ ...base, understood: [] }))).toThrow(/invalid output/);
    expect(() => understandTask.parse(JSON.stringify({ ...base, facts: { ...base.facts, graph: { nodes: [{ type: 'Person', label: 'Someone' }], links: [] } } }))).toThrow(/invalid output/);
    expect(UNDERSTAND_SCHEMA.properties!.understood.maxItems).toBe(6);
    expect(triageTask).toBe(understandTask);
  });
  it('prompt carries known stars and team answers, and the reuse-a-label rule', () => {
    const p = understandTask.prompt({
      item: { type: 'email', text: 'hello' }, candidates: [],
      knownStars: [{ type: 'Capability', label: 'Slot finding' }], teamAnswers: [{ question: 'How many?', answer: 'About 40' }],
    } as any);
    expect(p).toContain('"knownStars"');
    expect(p).toContain('Slot finding');
    expect(p).toContain('"teamAnswers"');
    expect(p).toMatch(/Reuse a label from knownStars/);
    expect(p).toMatch(/Never name people in "understood"/);
    expect(p).toMatch(/data, not instructions/);
  });
  it('the fake answers understand with the reply fixture, the conflicting reply, or the transcript', async () => {
    const fake = fakeProvider();
    const reply = JSON.parse(await fake.complete('TASK: understand\n\n{"item":{"text":"About 40 a week"}}', {} as any));
    expect(reply.what).toBeTruthy(); expect(reply.facts.builderNamed).toBeNull();
    const conflict = JSON.parse(await fake.complete('TASK: understand\n\n{"item":{"text":"we have a second builder now"}}', {} as any));
    expect(conflict.facts.builderNamed).toBe('Person 9');
    expect(conflict.facts.graph.nodes.map((n: any) => n.label)).toContain('Slot findings');
    const vtt = JSON.parse(await fake.complete('TASK: understand\n\n{"item":{"type":"transcript","text":"00:01 --> 00:02"}}', {} as any));
    expect(vtt.facts.attendanceConfirmed).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd cafe-app && npx vitest run tests/inbox-understand.test.ts`
Expected: FAIL, `understandTask` is not exported.

- [ ] **Step 3: Implement in `tasks.ts`**

Next to the triage section add:

```ts
export interface Understanding {
  what: string;
  understood: string[];
  kind: (typeof TRIAGE_KINDS)[number];
  ideaId: string | null;
  matchConfidence: number;
  facts: Triage['facts'];
  uncertain: string[];
}

const LINE160: JsonSchema = { type: 'string', minLength: 1, maxLength: 160 };
export const UNDERSTAND_SCHEMA: JsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['what', 'understood', 'kind', 'ideaId', 'matchConfidence', 'facts', 'uncertain'],
  properties: {
    what: { type: 'string', maxLength: 160 },
    understood: { type: 'array', minItems: 1, maxItems: 6, items: LINE160 },
    kind: { type: 'string', enum: TRIAGE_KINDS },
    ideaId: {},
    matchConfidence: { type: 'number', minimum: 0, maximum: 1 },
    facts: TRIAGE_SCHEMA.properties!.facts,
    uncertain: { type: 'array', maxItems: 4, items: LINE160 },
  },
};
```

(`ideaId: {}` is "any", checked by hand as `TRIAGE_SCHEMA` does today for `ideaId` and `builderNamed`.)

Then `understandTask`: copy `triageTask`'s `prompt` body, change `build('triage', …)` to `build('understand', …)`, and add to the instruction list:

```ts
      '"what": one line on what this file is. "understood": 1 to 6 plain lines on what it says that matters for the idea. "uncertain": up to 4 lines on what you could not tell. Never name people in "understood" or "uncertain"; say "the team" or a role.',
      ...(data.knownStars ? ['"knownStars" are stars already in the universe. Reuse a label from knownStars when the same thing is meant; a new label only for a new thing.'] : []),
      ...(data.teamAnswers ? ['"teamAnswers" were already recorded from earlier replies: do not extract them again.'] : []),
```

and include `knownStars` (cap 60 entries, labels capped at 60 chars) and `teamAnswers` (cap 12; question 200, answer 500) in the DATA object when present. `parse`: `parseChecked<Understanding>(raw, UNDERSTAND_SCHEMA, trimUnderstanding)` where `trimUnderstanding` trims `what` to 160 and each `understood` / `uncertain` line to 160, runs today's by-hand checks for `ideaId` / `facts.builderNamed` (string or null; throw `AiError('invalid output: …')` otherwise), and throws `AiError('invalid output: a Person is never a star')` when any `facts.graph.nodes[].type === 'Person'`. Then `export const triageTask = understandTask;` and delete the old `triageTask` body (keep `Triage`, `TriageInput`, `TRIAGE_SCHEMA`, `parseTriage` if other code imports it; grep first).

Add to `TriageInput`: `knownStars?: { type: string; label: string }[]; teamAnswers?: { question: string; answer: string }[];`.

- [ ] **Step 4: Implement in `fake.ts`**

Replace the `TRIAGE` fixture with three fixtures and a chooser:

```ts
const REPLY_FACTS = { /* exactly today's TRIAGE.facts object, moved here */ };
const UNDERSTAND_REPLY = {
  what: 'A reply from the team answering our two questions about the email scheduler',
  understood: ['About 40 requests a week, mostly from one desk, peaking at month end', 'Two people triage them by hand in a shared mailbox today'],
  kind: 'reply', ideaId: 'CAFE-2026-001', matchConfidence: 0.95, facts: REPLY_FACTS,
  uncertain: ['Whether the month-end peak needs a different flow'],
};
const UNDERSTAND_CONFLICT = {
  what: 'A reply naming a different builder and describing slot finding',
  understood: ['The team wants a different person to build it', 'Finding a free slot across time zones is the hard part'],
  kind: 'reply', ideaId: 'CAFE-2026-001', matchConfidence: 0.9,
  facts: {
    answers: [], replyReceived: true, builderNamed: 'Person 9', newFlags: [], stageHint: null,
    graph: { nodes: [{ type: 'Capability', label: 'Slot findings' }], links: [{ from: 'idea', to: 'Slot findings', rel: 'NEEDS', description: 'Needs to find a slot', confidence: 0.85 }] },
  },
  uncertain: [],
};
const UNDERSTAND_TRANSCRIPT = {
  what: 'A session transcript: the team attended and walked through the current process',
  understood: ['The team attended the session', 'Requests are re-keyed into a tracker by hand'],
  kind: 'transcript', ideaId: 'CAFE-2026-001', matchConfidence: 0.8,
  facts: {
    answers: [], replyReceived: false, builderNamed: null, attendanceConfirmed: true, newFlags: [], stageHint: null,
    graph: { nodes: [{ type: 'PainPoint', label: 'Re-keying into a tracker' }], links: [{ from: 'idea', to: 'Re-keying into a tracker', rel: 'REPLACES', description: 'Removes the re-keying', confidence: 0.75 }] },
  },
  uncertain: [],
};
function understandFor(prompt: string) {
  if (/second builder/i.test(prompt)) return UNDERSTAND_CONFLICT;
  if (/"type":"transcript"|-->/.test(prompt)) return UNDERSTAND_TRANSCRIPT;
  return UNDERSTAND_REPLY;
}
```

and in `complete`: `if (prompt.startsWith('TASK: understand') || prompt.startsWith('TASK: triage')) return JSON.stringify(understandFor(prompt));`. Check `REPLY_FACTS.graph.links[].rel` against `ALLOWED` in `src/graph/ontology.ts` so the fixture's links still resolve (today's `REPLACES` from idea to PainPoint is allowed).

- [ ] **Step 5: Wire `triage.ts`**

In `triageItem`, build `knownStars` from `(await rebuildGraph(root)).nodes` (exclude `Idea` and `Person`; the matched idea's `neighbourhood` first, then the rest; cap 60), `teamAnswers` from `((idea as Idea & { answers?: { question: string; answer: string }[] })?.answers ?? []).slice(0, 12)`; pass both in `input`; call `connector.runWith(understandTask, input)`. `TriageRecord.ai?: Understanding`. `combine` reads `ideaId` and `matchConfidence`, which `Understanding` has; no change there.

- [ ] **Step 6: Run the tests**

Run: `cd cafe-app && npx vitest run tests/inbox-understand.test.ts tests/inbox-triage.test.ts tests/inbox-routes.test.ts tests/inbox-actions.test.ts && npx tsc --noEmit -p .`
Expected: all pass (existing tests see the same facts through the alias). Where an existing test reads `triage.ai.summary`, change it to `triage.ai.what`.

- [ ] **Step 7: Commit**

```bash
git add cafe-app/src/ai/tasks.ts cafe-app/src/ai/providers/fake.ts cafe-app/src/inbox/triage.ts cafe-app/tests
git commit -m "Inbox: the AI pass becomes understand (what, understood, uncertain, known stars, team answers)"
```

---

### Task 4: The graph rule: applied and confirmed on arrival, held links pending

**Files:**
- Modify: `cafe-app/src/ai/apply.ts` (`planAiLinks(…, opts: { status?: AiLink['status'] } = {})`, default `'pending'`)
- Modify: `cafe-app/src/inbox/actions.ts` (`planGraph` returns one list with status `confirmed`; `kindOf('graph_links')` → `'safe'`; `ActionRecord.held?: { rule: string; why: string; existing?: string }`)
- Modify: `cafe-app/src/server/api.ts` (`/api/ai/extract` runs `checkProposals`; stores applied links `confirmed`, held links `pending`; returns `{ added, held, links, suggestions }`)
- Modify: `cafe-app/ui/src/popouts/LinkTable.tsx` (Confirm only when `!r.confirmed`; label "Add it anyway"; tag "Waiting on you"), `cafe-app/ui/src/popouts/aiUi.ts` (`extractNotice` reads `held.length`)
- Test: `cafe-app/tests/server-graph.test.ts` (extend), `cafe-app/tests/inbox-actions.test.ts` (extend), `cafe-app/ui/src/popouts/LinkTable.test.tsx` (extend)

**Interfaces:**
- Consumes: Task 2 `checkProposals`, `ConflictContext`, `Held`.
- Produces: `planAiLinks(ideaId, out, graph, previous, provider, opts?)`; `ActionRecord.held`; extract response `{ added: number; held: Omit<Held,'action'>[]; links: GEdge[]; suggestions: { newNodes: GNode[] } }`.

- [ ] **Step 1: Write the failing tests**

In `tests/server-graph.test.ts` add:

```ts
  it('extract applies links confirmed on arrival and returns what the conflict rules held', async () => {
    const s = await startServer('2026-10-21', { ai: fakeProvider() });
    const r = await (await s.post('/api/ai/extract', { id: ID })).json();
    expect(r.added).toBeGreaterThan(0);
    expect(Array.isArray(r.held)).toBe(true);
    const g = await s.get('/api/graph');
    const ai = g.edges.filter((e: any) => String(e.source).startsWith('ai:'));
    expect(ai.length).toBeGreaterThan(0);
    expect(ai.every((e: any) => e.confirmed)).toBe(true);
  });
```

In `tests/inbox-actions.test.ts` add:

```ts
  it('graph_links is Safe even with new stars, and a held record carries its rule', () => {
    const a: Action = { t: 'graph_links', ideaId: ID, links: [{ from: `idea:${ID}`, to: 'capability:x', rel: 'NEEDS', description: 'd', source: 's', confidence: 0.9, status: 'confirmed', newNodes: [{ id: 'capability:x', type: 'Capability', label: 'X' }] }] };
    expect(kindOf(a)).toBe('safe');
    const rec: ActionRecord = { id: 'a1', action: a, kind: 'ok', status: 'pending', label: 'x', held: { rule: 'low-confidence', why: 'The AI was not sure (42%)' } };
    expect(rec.held!.rule).toBe('low-confidence');
  });
```

In `ui/src/popouts/LinkTable.test.tsx` add: a row with `confirmed: true, source: 'ai:fake:x'` renders Remove and no `[data-action="confirm-link"]`; a row with `confirmed: false` renders `[data-action="confirm-link"]` with text "Add it anyway" and the tag "Waiting on you".

- [ ] **Step 2: Run to verify they fail**

Run: `cd cafe-app && npx vitest run tests/server-graph.test.ts tests/inbox-actions.test.ts; cd ui && npx vitest run src/popouts/LinkTable.test.tsx`
Expected: FAIL (confirmed false; `held` not on the type; Confirm label).

- [ ] **Step 3: Implement**

`apply.ts`: add a 6th parameter `opts: { status?: AiLink['status'] } = {}` and push `status: opts.status ?? 'pending'`.

`actions.ts`:
- `kindOf`: `case 'graph_links': return 'safe';` (replace the two-line comment and expression).
- `ActionRecord`: add `held?: { rule: string; why: string; existing?: string };`.
- `planGraph`: call `planAiLinks(idea.id, filtered, buildGraph(ideas, previous), previous, provider, { status: 'confirmed' })` and return `{ links: sourced }`. In `planActions`: `const { links } = await planGraph(...); if (links.length) actions.push({ t: 'graph_links', ideaId, links });`. Keep the people filter (a cheap first pass; the conflict rules are the second).

`api.ts` extract route body:

```ts
    const idea = await loadIdea(root, String(body.id));
    const before = await rebuildGraph(root);
    const { provider, output } = await ai.runWith(extractTask, extractInput(idea, before.nodes));
    const planned = planAiLinks(idea.id, output, before, (await readAiLinks(root)).links, provider, { status: 'confirmed' });
    const { ideas } = await listIdeas(root);
    const ctx: ConflictContext = {
      idea, ideas, nodes: before.nodes, peoplePresent: [], design: await readDesign(root, idea.id).catch(() => null),
      match: { ideaId: idea.id, confidence: 1, candidates: [idea.id] }, aiIdeaId: idea.id, screened: [],
    };
    const { apply, hold } = checkProposals(ctx, [{ t: 'graph_links', ideaId: idea.id, links: planned.links }]);
    for (const a of apply) if (a.t === 'graph_links') for (const l of a.links) await appendAiLink(root, l);
    for (const h of hold) if (h.action.t === 'graph_links') for (const l of h.action.links) await appendAiLink(root, { ...l, status: 'pending' });
    const after = await rebuildGraph(root);
    const ids = new Set(planned.links.map((l) => edgeId(l.from, l.rel, l.to)));
    const added = after.edges.filter((e) => ids.has(e.id));
    return { added: added.filter((e) => e.confirmed).length, held: hold.map(({ action: _a, ...h }) => h), links: added, suggestions: { newNodes: planned.newNodes } };
```

`LinkTable.tsx`: the Confirm button renders only when `!r.confirmed`, text "Add it anyway", `data-action="confirm-link"` kept; the tag text "Unconfirmed" becomes "Waiting on you". `aiUi.ts` `extractNotice(r)`: "`N` links added to the universe" plus ", `M` waiting on you" when `r.held?.length`.

- [ ] **Step 4: Run the tests**

Run: `cd cafe-app && npm test; cd ui && npx vitest run && npx tsc --noEmit -p .`
Expected: all green. An existing test that asserts an Inbox AI link with new stars is `kind: 'ok'`, or that extract returns `unconfirmed`, changes to the new rule; name each changed assertion in the commit body.

- [ ] **Step 5: Commit**

```bash
git add -A cafe-app/src cafe-app/tests cafe-app/ui/src
git commit -m "Graph rule: AI links apply confirmed on arrival; only conflict-held links wait"
```

---

### Task 5: The pipeline around the steps, reprocess and resolve

**Files:**
- Modify: `cafe-app/src/inbox/triage.ts` (split `triageItem` into `readAndScreen(root, id)`, `matchStep(root, item, parsed, opts)`, `understandStep(root, item, parsed, m, connector)`; keep `triageItem` as their composition so existing tests pass)
- Modify: `cafe-app/src/inbox/flow.ts` (`processItem` rewritten around steps; `processDrop` records `receive`; `reprocessItem`; `applyRecords(..., resolve)`; `dropRecord`)
- Modify: `cafe-app/src/inbox/actions.ts` (`applyAction` honours `resolve` for `graph_links`)
- Modify: `cafe-app/src/server/api.ts` (routes `POST /api/inbox/:id/process`, `apply` body `resolve`, `POST /api/inbox/:id/dismiss-action`)
- Test: `cafe-app/tests/inbox-flow.test.ts`

**Interfaces:**
- Consumes: Task 1 `markStep`, `timed`, `skipRest`, `resetStepsFrom`, `stepOf`; Task 2 `checkProposals`, `ConflictContext`; Task 3 `understandTask` through `triage.ts`; Task 4 `planGraph` statuses, `ActionRecord.held`.
- Produces: `processItem(root, id, connector, clock, opts: { ideaId?: string; from?: 'match' })`; `reprocessItem(root, id, connector, clock, opts)`; `applyRecords(root, id, actionIds, clock, resolve?: Record<string, 'use-existing' | 'take-file'>)`; `dropRecord(root, id, actionId)`.

- [ ] **Step 1: Write the failing tests**

```ts
// cafe-app/tests/inbox-flow.test.ts
import { describe, it, expect } from 'vitest';
import { startServer } from './helpers';
import { fakeProvider } from '../src/ai/providers/fake';
import { readAiLinks, appendAiLink } from '../src/graph/store';

const ID = 'CAFE-2026-001';
const drop = (s: any, name: string, text: string) => s.post('/api/inbox/drop', text, { 'x-filename': encodeURIComponent(name), 'content-type': 'text/plain' });
const reply = `From: team@example.test\nSubject: Re: ${ID} Email scheduler\n\nAbout 40 a week. Two people triage by hand.\n`;
const statuses = (item: any) => item.steps.map((s: any) => `${s.id}:${s.status}`);
const slotFinding = { from: `idea:${ID}`, to: 'capability:slot-finding', rel: 'NEEDS' as const, description: 'd', source: 'ai:fake:earlier', confidence: 1, status: 'confirmed' as const, newNodes: [{ id: 'capability:slot-finding', type: 'Capability' as const, label: 'Slot finding' }] };

describe('the pipeline', () => {
  it('records the eight steps in order for a clean reply and applies answers and links in one run', async () => {
    const s = await startServer('2026-10-21', { ai: fakeProvider() });
    const { item } = await (await drop(s, 'reply.eml', reply)).json();
    expect(statuses(item)).toEqual(['receive:done', 'read:done', 'screen:done', 'match:done', 'understand:done', 'context:done', 'graph:done', 'check:done']);
    expect(item.steps[4].ms).toBeGreaterThanOrEqual(0);
    expect(item.steps[7].detail).toBe('Done');
    expect(item.status).toBe('applied');
    const links = (await readAiLinks(s.root)).links;
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((l) => l.status === 'confirmed')).toBe(true);
  });
  it('a conflicting reply applies the rest and holds the second builder and the near-duplicate star (needs-you at check)', async () => {
    const s = await startServer('2026-10-21', { ai: fakeProvider() });
    await appendAiLink(s.root, slotFinding);
    const { item } = await (await drop(s, 'reply2.eml', reply.replace('About 40', 'We have a second builder now. About 40'))).json();
    expect(item.steps.at(-1)).toMatchObject({ id: 'check', status: 'needs-you' });
    expect(item.steps.at(-1).detail).toMatch(/2 items wait/);
    const held = item.actions.filter((a: any) => a.held);
    expect(held.map((a: any) => a.held.rule).sort()).toEqual(['contradicts-fact', 'near-duplicate-star']);
    expect(item.actions.find((a: any) => a.action.t === 'reply_received').status).toBe('applied');
    expect(item.status).toBe('triaged');
  });
  it('AI failure: understand failed, the rest skipped, only the filing applied', async () => {
    const fake = fakeProvider();
    const s = await startServer('2026-10-21', { ai: { ...fake, complete: async () => { throw new Error('rate limited'); } } });
    const { item } = await (await drop(s, 'reply.eml', reply)).json();
    expect(statuses(item).slice(4)).toEqual(['understand:failed', 'context:skipped', 'graph:skipped', 'check:skipped']);
    expect(item.steps[4].detail).toMatch(/rate limited/);
    expect(item.problems.join(' ')).toMatch(/by hand/);
  });
  it('held at the screen: steps stop at screen with needs-you', async () => {
    const s = await startServer('2026-10-21', { ai: fakeProvider() });
    const { item } = await (await drop(s, 'people.csv', 'Name,Email,Phone\nA B,a@x.test,+1 555 0100\nC D,c@x.test,+1 555 0101\nE F,e@x.test,+1 555 0102\n')).json();
    expect(item.status).toBe('held');
    expect(statuses(item).slice(0, 3)).toEqual(['receive:done', 'read:done', 'screen:needs-you']);
    expect(item.steps.slice(3).every((x: any) => x.status === 'skipped')).toBe(true);
  });
  it('repeat drop: receive only, says it is the same file, no AI call', async () => {
    const fake = fakeProvider(); let calls = 0;
    const s = await startServer('2026-10-21', { ai: { ...fake, complete: async (p: string, o: any) => { calls++; return fake.complete(p, o); } } });
    await drop(s, 'reply.eml', reply);
    const n = calls;
    const r = await (await drop(s, 'reply.eml', reply)).json();
    expect(r.duplicate).toBe(true);
    expect(calls).toBe(n);
    expect(r.item.steps[0].detail).toMatch(/Same file/);
  });
  it('reprocess re-runs 4–8 and keeps applied records (no double filing, no double links)', async () => {
    const s = await startServer('2026-10-21', { ai: fakeProvider() });
    const { item } = await (await drop(s, 'reply.eml', reply)).json();
    const links = (await readAiLinks(s.root)).links.length;
    const again = await (await s.post(`/api/inbox/${item.id}/process`, {})).json();
    expect(again.item.actions.filter((a: any) => a.action.t === 'file_email')).toHaveLength(1);
    expect((await readAiLinks(s.root)).links.length).toBe(links);
    expect(statuses(again.item).slice(3)).toEqual(['match:done', 'understand:done', 'context:done', 'graph:done', 'check:done']);
  });
  it('apply with resolve use-existing rewrites the held link to the existing star', async () => {
    const s = await startServer('2026-10-21', { ai: fakeProvider() });
    await appendAiLink(s.root, slotFinding);
    const { item } = await (await drop(s, 'reply2.eml', reply.replace('About 40', 'second builder. About 40'))).json();
    const dup = item.actions.find((a: any) => a.held?.rule === 'near-duplicate-star');
    const r = await (await s.post(`/api/inbox/${item.id}/apply`, { actionIds: [dup.id], resolve: { [dup.id]: 'use-existing' } })).json();
    expect(r.item.actions.find((a: any) => a.id === dup.id).status).toBe('applied');
    const links = (await readAiLinks(s.root)).links.filter((l) => l.source.includes('reply2'));
    expect(links.some((l) => l.to === 'capability:slot-finding' && l.status === 'confirmed')).toBe(true);
    expect(links.some((l) => l.to === 'capability:slot-findings')).toBe(false);
  });
  it('dismiss-action drops a held record', async () => {
    const s = await startServer('2026-10-21', { ai: fakeProvider() });
    const { item } = await (await drop(s, 'reply2.eml', reply.replace('About 40', 'second builder. About 40'))).json();
    const h = item.actions.find((a: any) => a.held?.rule === 'contradicts-fact');
    const r = await (await s.post(`/api/inbox/${item.id}/dismiss-action`, { actionId: h.id })).json();
    expect(r.item.actions.find((a: any) => a.id === h.id)).toMatchObject({ status: 'undone', note: 'Dropped by you' });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd cafe-app && npx vitest run tests/inbox-flow.test.ts`
Expected: FAIL (no `steps`, no process route).

- [ ] **Step 3: Split `triageItem`**

In `triage.ts`:

```ts
export async function readAndScreen(root: string, id: string) {
  const item = await getItem(root, id); if (!item) throw new Error(`No inbox item ${id}`);
  const bytes = new Uint8Array(await fs.readFile(path.join(root, ...item.file.split('/'))));
  const parsed = parseDrop(path.basename(item.file), bytes);
  const screened = screenDrop(item.name, parsed, await knownParticipants(root));
  if (!screened.hold && parsed.type === 'export' && parsed.screenText === undefined && TRACKER_NAME.test(item.name)) {
    screened.hold = true; screened.reasons.push("Looks like a tracker and this kind of file can't be checked yet, so it's held for you to check by hand");
  }
  return { item, parsed, screened };
}
export async function matchStep(root: string, item: InboxItem, parsed: Parsed, opts: { ideaId?: string }) {
  const { ideas } = await listIdeas(root); const byId = new Map(ideas.map((i) => [i.id, i]));
  const fresh: InboxItem = { ...item, type: parsed.type, text: parsed.text, meta: parsed.meta };
  const chosen = opts.ideaId && byId.has(opts.ideaId) ? opts.ideaId : undefined;
  const match: MatchResult = chosen ? { ideaId: chosen, confidence: 1, how: 'chosen', candidates: [chosen] } : matchIdea(fresh, ideas);
  return { match, ideas, byId };
}
export async function understandStep(root, item, parsed, m, connector): Promise<TriageRecord> { /* today's steps 2 and 4 of triageItem, returning the TriageRecord and writing `read` fields + triage with updateItem as today */ }
export async function triageItem(root, id, connector, opts = {}) {
  const { item, parsed, screened } = await readAndScreen(root, id);
  if (item.status === 'held') return item;
  if (screened.hold) return holdItem(root, id, screened.reasons, parsed.meta);
  const m = await matchStep(root, item, parsed, opts);
  await understandStep(root, item, parsed, m, connector);
  return (await getItem(root, id))!;
}
```

Export `readDetail(parsed): string` ("Email, 2 paragraphs, our earlier email quoted" / "Form export, 7 rows" / "Transcript, 12 minutes" / "Note, 3 lines"), and `HOW_WORDS: Record<MatchHow, string>` (`cafe-id: 'Café ID'`, `title: 'title'`, `sender: 'sender'`, `chosen: 'your pick'`, `none: 'nothing'`).

- [ ] **Step 4: Rewrite `processItem` in `flow.ts`**

```ts
export async function processItem(
  root: string, id: string, connector: Connector | null | undefined, clock: Clock, opts: { ideaId?: string; from?: 'match' } = {},
): Promise<InboxItem> {
  const first = await load(root, id);
  if (first.status === 'held') return first;
  if (!stepOf(first, 'receive')) await markStep(root, id, { id: 'receive', status: 'done', detail: `${first.name}, ${Math.max(1, Math.round((first.meta?.bytes ?? first.text?.length ?? 0) / 1024))} KB` });
  const fail = async (after: StepId, msg: string) => { await skipRest(root, id, after, 'after a failure'); return updateItem(root, id, { status: 'triaged', problems: [...((await load(root, id)).problems ?? []), msg] }); };

  // 2 read, 3 screen (skipped on a re-run from match)
  let rs: Awaited<ReturnType<typeof readAndScreen>>;
  try {
    rs = opts.from === 'match'
      ? await readAndScreen(root, id)
      : await timed(root, id, 'read', 'Reading the file…', async () => { const r = await readAndScreen(root, id); return { value: r, detail: readDetail(r.parsed) }; });
  } catch (e) { return fail('read', `Couldn't read this one (${(e as Error).message}), so do it by hand`); }
  if (opts.from !== 'match') {
    if (rs.screened.hold) {
      await markStep(root, id, { id: 'screen', status: 'needs-you', detail: rs.screened.reasons[0] });
      await skipRest(root, id, 'screen', 'held at the screen');
      return holdItem(root, id, rs.screened.reasons, rs.parsed.meta);
    }
    await markStep(root, id, { id: 'screen', status: 'done', detail: rs.screened.reasons.length ? `Flagged: ${rs.screened.reasons[0]}` : 'No personal data' });
  }
  const item = rs.item;

  // 4 match
  const m = await matchStep(root, item, rs.parsed, opts);
  const isExport = rs.parsed.type === 'export';
  await markStep(root, id, { id: 'match', status: 'done', detail: isExport ? `A form export: ${rs.parsed.meta?.rows ?? 'some'} rows` : m.match.ideaId ? `${m.match.ideaId} by ${HOW_WORDS[m.match.how]}` : 'No idea matched yet' });

  // 5 understand
  let tr: TriageRecord;
  try {
    tr = await timed(root, id, 'understand', 'Asking the AI…', async () => {
      const t = await understandStep(root, item, rs.parsed, m, connector);
      const status: StepStatus = t.export ? 'skipped' : t.ai ? 'done' : t.aiError ? 'failed' : 'skipped';
      const detail = t.export ? 'A form export: no AI needed' : t.ai ? t.ai.what : t.aiError ? `The AI couldn't help (${t.aiError})` : 'No AI connected: facts by hand';
      return { value: t, detail, status };
    });
  } catch (e) { return fail('understand', `Couldn't sort this one (${(e as Error).message}), so do it by hand`); }
  if (tr.aiError) return fail('understand', `The AI couldn't help (${tr.aiError}), so do this one by hand`);
  if (tr.ask) {
    await markStep(root, id, { id: 'match', status: 'needs-you', detail: `Could be ${tr.candidates.slice(0, 2).map((c) => c.id).join(' or ') || 'any idea'}: pick one` });
    await skipRest(root, id, 'match', 'waiting for your pick');
  }

  // plan → conflicts → 6 context, 7 graph, 8 check
  let plan: Awaited<ReturnType<typeof planActions>>;
  try { plan = await planActions(root, item); } catch (e) { return fail('understand', `Couldn't plan what to do (${(e as Error).message}), so do it by hand`); }
  if (plan.hold) {
    await markStep(root, id, { id: 'context', status: 'needs-you', detail: plan.hold[0] });
    await skipRest(root, id, 'context', 'held');
    return holdItem(root, id, plan.hold);
  }
  const ctx = await conflictContext(root, item, tr, m, rs.screened.reasons);
  const { apply, hold } = checkProposals(ctx, plan.actions);
  const kept = recordsOf(item).filter((r) => r.status !== 'pending' && r.action.t !== 'ask_idea');
  const seen = new Set(kept.map((r) => JSON.stringify(r.action)));
  let n = kept.reduce((mx, r) => Math.max(mx, Number(r.id.slice(1)) || 0), 0);
  const needsHand = !!tr.needsHand;
  const fresh: ActionRecord[] = [
    ...apply.filter((a) => !seen.has(JSON.stringify(a))).map((action) => ({ id: `a${++n}`, action, kind: kindOf(action, { needsHand }), status: 'pending' as const, label: labelOf(action) })),
    ...hold.filter((h) => !seen.has(JSON.stringify(h.action))).map((h) => ({ id: `a${++n}`, action: h.action, kind: 'ok' as const, status: 'pending' as const, label: labelOf(h.action), held: { rule: h.rule, why: h.why, ...(h.existing ? { existing: h.existing } : {}) } })),
  ];
  const records = [...kept, ...fresh];
  await updateItem(root, id, { actions: [...records] });
  if (tr.ask) return save(root, item, records);
  for (let i = kept.length; i < records.length; i++) if (records[i].kind === 'safe') await applyOne(root, item, records, i, clock);
  const applied = records.slice(kept.length).filter((r) => r.status === 'applied');
  const ctxApplied = applied.filter((r) => r.action.t !== 'graph_links');
  const graphApplied = applied.filter((r) => r.action.t === 'graph_links');
  await markStep(root, id, { id: 'context', status: ctxApplied.length ? 'done' : 'skipped', detail: ctxApplied.length ? contextDetail(ctxApplied) : 'Nothing to update' });
  await markStep(root, id, { id: 'graph', status: graphApplied.length ? 'done' : 'skipped', detail: graphApplied.length ? graphDetail(graphApplied) : 'No graph facts' });
  const waiting = records.filter((r) => r.status === 'pending' && r.kind === 'ok');
  await markStep(root, id, { id: 'check', status: waiting.length ? 'needs-you' : 'done', detail: waiting.length ? `${waiting.length} item${waiting.length === 1 ? '' : 's'} wait${waiting.length === 1 ? 's' : ''}: ${waiting[0].held?.why ?? waiting[0].label}` : 'Done' });
  if (tr.ai?.understood?.length && tr.ideaId) await appendHistory(await ideaDir(root, tr.ideaId), { at: clock(), action: 'inbox', by: 'app', detail: `Understood: ${tr.ai.understood.join(' · ')}`, source: item.file });
  return save(root, item, records);
}
```

`contextDetail(records)`: joins, in this order and only when present: "N answer(s) recorded", "reply received", "builder named", "N flag(s) added", "step <id> ticked", "imported N idea(s)" (from `result.created.length`), "email filed" / "note filed". `graphDetail(records)`: "N link(s) added" plus ", M new star(s) (Type: Label, …)" from `links[].newNodes` (first two labels, then "…").

`conflictContext(root, item, tr, m, screened)`:

```ts
async function conflictContext(root: string, item: InboxItem, tr: TriageRecord, m: { match: MatchResult; ideas: Idea[]; byId: Map<string, Idea> }, screened: string[]): Promise<ConflictContext> {
  const idea = tr.ideaId ? m.byId.get(tr.ideaId) ?? null : null;
  const meta = item.meta ?? {};
  const peoplePresent = [...new Set([...(meta.to ?? []), ...(meta.cc ?? []), ...(meta.speakers ?? []), ...(meta.from ? [meta.from] : [])].map(displayName).filter(Boolean))];
  return {
    idea, ideas: m.ideas, nodes: (await rebuildGraph(root)).nodes, peoplePresent,
    design: idea ? await readDesign(root, idea.id).catch(() => null) : null,
    match: { ideaId: m.match.ideaId, confidence: m.match.confidence, candidates: m.match.candidates },
    aiIdeaId: tr.ai?.ideaId ?? null, screened,
  };
}
```

`processDrop`: for a fresh item, `processItem` writes `receive`. For a repeat (`saved.duplicate && saved.status !== 'new'`), return `{ item: { ...viewOf(item), steps: [{ id: 'receive', status: 'done', at: new Date().toISOString(), detail: `Same file as ${item.name} (dropped ${item.receivedAt.slice(0, 10)})` }] }, duplicate: true }` without writing to the first item.

`reprocessItem(root, id, connector, clock, opts)`: `const item = await load(root, id); if (item.status === 'held') throw new Error('A held item is not read: delete it or draft a reply'); await resetStepsFrom(root, id, 'match'); return processItem(root, id, connector, clock, { ...opts, from: 'match' });`. `chooseIdea` calls `reprocessItem(..., { ideaId })`.

`applyRecords(root, id, actionIds, clock, resolve = {})`: before `applyOne` for each `aid`, when `resolve[aid]` is set and the record is `graph_links`: for `use-existing` with `held.existing`, map each link: if `l.to` is a `newNodes[].id` → `to = existing`, likewise `from`; delete `newNodes`; `status: 'confirmed'`. For `take-file`, set `status: 'confirmed'` on each link. Write the rewritten record back into `records[i]` before `applyOne`. Plain apply of a held `graph_links` also sets `status: 'confirmed'`.

`dropRecord(root, id, actionId)`: mark the pending record `status: 'undone'`, `note: 'Dropped by you'`, `undoneAt: now`; `save`.

Routes in `api.ts`:

```ts
  add('POST', '/api/inbox/:id/process', async ({ params, body }) => ({ item: viewOf(await reprocessItem(root, params.id, ai, clock, body.ideaId ? { ideaId: String(body.ideaId) } : {})) }));
  add('POST', '/api/inbox/:id/dismiss-action', async ({ params, body }) => ({ item: viewOf(await dropRecord(root, params.id, String(body.actionId ?? ''))) }));
```

and `apply` passes `body.resolve ?? {}` (validate: an object whose values are `'use-existing' | 'take-file'`; anything else → 400 "Unknown resolve").

- [ ] **Step 5: Run the tests**

Run: `cd cafe-app && npx vitest run tests/inbox-flow.test.ts && npm test && npx tsc --noEmit -p .`
Expected: 8 new passed; the whole suite green. Existing Inbox tests that asserted "Needs your OK" for new-star links change to the new rule; list each in the commit body.

- [ ] **Step 6: Commit**

```bash
git add -A cafe-app/src cafe-app/tests
git commit -m "Inbox pipeline: eight recorded steps, conflicts held per item, reprocess and resolve"
```

---

### Task 6: The Inbox screen

**Files:**
- Create: `cafe-app/ui/src/popouts/InboxCard.tsx`
- Modify: `cafe-app/ui/src/popouts/InboxPopout.tsx` (three zones; polling)
- Modify: `cafe-app/ui/src/popouts/inboxHelpers.ts` (`Step` types mirrored, `STEP_ORDER`, `STEP_WORDS`, `shouldPoll`, `needsYou`, `Chip`, `filterItems`, `groupByDay`, `resultLine`, `HeldChoice`, `heldChoices`, `stepGlyph`)
- Modify: `cafe-app/ui/src/api.ts` (`inboxPost` route union gains `'process' | 'dismiss-action'`)
- Modify: `cafe-app/ui/src/theme.css`
- Test: `cafe-app/ui/src/popouts/inboxHelpers.test.ts` (extend), `cafe-app/ui/src/popouts/InboxCard.test.tsx` (new)

**Interfaces:**
- Consumes: item fields `steps`, `actions[].held`, `triage.ai.{what, understood, uncertain}` (Tasks 3, 5); routes `process`, `apply` with `resolve`, `dismiss-action` (Task 5).
- Produces: `InboxCard({ item, busy, ideaTitle, openIdea, run, expanded })`.

- [ ] **Step 1: Write the failing helper tests**

```ts
// append to ui/src/popouts/inboxHelpers.test.ts
import { shouldPoll, groupByDay, filterItems, resultLine, heldChoices } from './inboxHelpers';

describe('agentic inbox helpers', () => {
  const step = (id: string, status: string) => ({ id, status, at: '2026-10-21T10:00:00Z', detail: id });
  it('shouldPoll only while a step is running', () => {
    expect(shouldPoll({ items: [{ steps: [step('read', 'running')] }] } as any)).toBe(true);
    expect(shouldPoll({ items: [{ steps: [step('check', 'done')] }] } as any)).toBe(false);
    expect(shouldPoll(null)).toBe(false);
  });
  it('groupByDay labels today and yesterday, then dates, newest first', () => {
    const g = groupByDay([{ receivedAt: '2026-10-21T09:00:00Z' }, { receivedAt: '2026-10-20T09:00:00Z' }, { receivedAt: '2026-10-01T09:00:00Z' }] as any, new Date('2026-10-21T12:00:00Z'));
    expect(g.map((x) => x.label)).toEqual(['Today', 'Yesterday', '1 Oct 2026']);
  });
  it('filterItems by chip and by text over name and idea', () => {
    const items = [
      { name: 'reply.eml', status: 'applied', steps: [step('check', 'done')], triage: { ideaId: 'CAFE-2026-001' } },
      { name: 'people.csv', status: 'held', steps: [step('screen', 'needs-you')] },
      { name: 'reply2.eml', status: 'triaged', steps: [step('check', 'needs-you')], actions: [{ status: 'pending', held: { rule: 'low-confidence', why: 'x' } }] },
    ] as any;
    expect(filterItems(items, 'needs-you', '').map((i: any) => i.name)).toEqual(['reply2.eml']);
    expect(filterItems(items, 'held', '').map((i: any) => i.name)).toEqual(['people.csv']);
    expect(filterItems(items, 'all', '001').map((i: any) => i.name)).toEqual(['reply.eml']);
  });
  it('resultLine is the check detail, else the hold reason, else the last step detail', () => {
    expect(resultLine({ steps: [step('check', 'done')] } as any)).toBe('check');
    expect(resultLine({ status: 'held', hold: { reasons: ['Looks like a list of people'] }, steps: [] } as any)).toBe('Looks like a list of people');
  });
  it('heldChoices per rule', () => {
    expect(heldChoices({ rule: 'near-duplicate-star', why: 'x', existing: 'capability:slot-finding' }).map((c) => c.label)).toEqual(['Use the existing star', 'Keep both', 'No']);
    expect(heldChoices({ rule: 'contradicts-fact', why: 'x' }).map((c) => c.label)).toEqual(["Keep the form's value", "Take the file's value"]);
    expect(heldChoices({ rule: 'low-confidence', why: 'x' }).map((c) => c.label)).toEqual(['Yes', 'No']);
  });
});
```

- [ ] **Step 2: Implement the helpers**

```ts
export type StepId = 'receive' | 'read' | 'screen' | 'match' | 'understand' | 'context' | 'graph' | 'check';
export type StepStatus = 'running' | 'done' | 'skipped' | 'needs-you' | 'failed';
export interface Step { id: StepId; status: StepStatus; at: string; detail: string; ms?: number }
export const STEP_ORDER: StepId[] = ['receive', 'read', 'screen', 'match', 'understand', 'context', 'graph', 'check'];
export const STEP_WORDS: Record<StepId, string> = { receive: 'Receive', read: 'Read', screen: 'Screen', match: 'Match', understand: 'Understand', context: 'Update context', graph: 'Build the graph', check: 'Check' };
export const stepGlyph = (s: StepStatus | 'todo') => ({ running: 'run', done: 'ok', skipped: 'skip', 'needs-you': 'you', failed: 'bad', todo: 'todo' } as const)[s];

export const shouldPoll = (v: { items: { steps?: Step[] }[] } | null | undefined) => !!v?.items.some((i) => i.steps?.some((s) => s.status === 'running'));

export const needsYou = (i: Pick<InboxItemView, 'steps' | 'actions' | 'status'>) =>
  i.status !== 'dismissed' && i.status !== 'held'
  && (!!i.steps?.some((s) => s.status === 'needs-you') || (i.actions ?? []).some((a) => a.status === 'pending' && !!(a as any).held));

export type Chip = 'all' | 'needs-you' | 'held' | 'done' | 'failed' | 'dismissed';
export function filterItems(items: InboxItemView[], chip: Chip, q: string): InboxItemView[] {
  const byChip = items.filter((i) => chip === 'all' ? true
    : chip === 'needs-you' ? needsYou(i)
    : chip === 'held' ? i.status === 'held'
    : chip === 'done' ? i.status === 'applied'
    : chip === 'failed' ? !!i.steps?.some((s) => s.status === 'failed') || (i.actions ?? []).some((a) => a.status === 'failed')
    : i.status === 'dismissed');
  const k = q.trim().toLowerCase();
  return k ? byChip.filter((i) => `${i.name} ${i.triage?.ideaId ?? ''} ${itemHeadline(i)}`.toLowerCase().includes(k)) : byChip;
}

export function groupByDay(items: InboxItemView[], now = new Date()): { label: string; items: InboxItemView[] }[] {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const today = day(now); const yesterday = day(new Date(now.getTime() - 86_400_000));
  const label = (iso: string) => { const d = iso.slice(0, 10); return d === today ? 'Today' : d === yesterday ? 'Yesterday' : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
  const out: { label: string; items: InboxItemView[] }[] = [];
  for (const i of [...items].sort((a, b) => (b.receivedAt ?? '').localeCompare(a.receivedAt ?? ''))) {
    const l = label(i.receivedAt ?? '');
    const g = out.at(-1); if (g && g.label === l) g.items.push(i); else out.push({ label: l, items: [i] });
  }
  return out;
}

export function resultLine(i: Pick<InboxItemView, 'steps' | 'status' | 'hold'>): string {
  const check = i.steps?.find((s) => s.id === 'check');
  if (check?.status === 'done' || check?.status === 'needs-you') return check.detail;
  if (i.status === 'held' && i.hold?.reasons?.length) return i.hold.reasons[0];
  return i.steps?.at(-1)?.detail ?? '';
}

export interface HeldChoice { label: string; kind: 'apply' | 'drop'; resolve?: 'use-existing' | 'take-file' }
export function heldChoices(h: { rule: string; why: string; existing?: string }): HeldChoice[] {
  switch (h.rule) {
    case 'near-duplicate-star': return [{ label: 'Use the existing star', kind: 'apply', resolve: 'use-existing' }, { label: 'Keep both', kind: 'apply', resolve: 'take-file' }, { label: 'No', kind: 'drop' }];
    case 'contradicts-fact': return [{ label: "Keep the form's value", kind: 'drop' }, { label: "Take the file's value", kind: 'apply', resolve: 'take-file' }];
    default: return [{ label: 'Yes', kind: 'apply' }, { label: 'No', kind: 'drop' }];
  }
}
```

Add to `InboxItemView`: `steps?: Step[]; hold?: { reasons: string[] }` (if not already), and to `ActionRecord`: `held?: { rule: string; why: string; existing?: string }`.

- [ ] **Step 3: Write `InboxCard.tsx`**

```tsx
import { useState } from 'react';
import { inboxPost } from '../api';
import {
  STEP_ORDER, STEP_WORDS, stepGlyph, heldChoices, groupActions, canUndo, askCandidates, isAsking, typeWord, dayOf,
  type InboxItemView, type Step,
} from './inboxHelpers';

const TYPE_ICON: Record<string, string> = { export: '▦', email: '✉', transcript: '☰', document: '▤', note: '✎', unknown: '◇' };
type Note = { text: string; kind?: 'ok' | 'error' };
export type Run = <T>(label: string, fn: () => Promise<T>, ok?: (r: T) => string | null, say?: (n: Note | null) => void) => Promise<void>;

/** One dropped file: its eight steps, what the AI understood, what waits for the operator, and what was applied. */
export function InboxCard({ item, busy, ideaTitle, openIdea, run, expanded = false }: {
  item: InboxItemView; busy: boolean; ideaTitle: (id: string) => string; openIdea: (id: string) => void; run: Run; expanded?: boolean;
}) {
  const [msg, setMsg] = useState<Note | null>(null);
  const go = <T,>(label: string, fn: () => Promise<T>, ok?: (r: T) => string | null) => run(label, fn, ok, setMsg);
  const steps = item.steps ?? [];
  const current: Step | undefined = steps.find((s) => s.status === 'running') ?? [...steps].reverse().find((s) => s.status !== 'skipped') ?? steps.at(-1);
  const g = groupActions(item.actions);
  const held = (item.actions ?? []).filter((a) => a.status === 'pending' && (a as any).held);
  const ai = item.triage?.ai as { what?: string; understood?: string[]; uncertain?: string[] } | undefined;
  const matched = item.status !== 'held' && !isAsking(item) && item.triage?.ideaId ? item.triage.ideaId : null;
  const apply = (id: string, resolve?: 'use-existing' | 'take-file') =>
    go('Applying…', () => inboxPost(item.id, 'apply', { actionIds: [id], ...(resolve ? { resolve: { [id]: resolve } } : {}) }), () => 'Applied.');
  const drop = (id: string) => go('Dropping…', () => inboxPost(item.id, 'dismiss-action', { actionId: id }), () => 'Dropped.');
  return (
    <li className={`ib-card st-${item.status}`} data-item={item.id} data-status={item.status}>
      <div className="ib-r1">
        <span className="ib-type" title={item.name}><span aria-hidden="true">{TYPE_ICON[item.type] ?? '◇'}</span> {typeWord(item.type)}</span>
        <span className="ib-file">{item.name}</span>
        {matched && <button className="ib-idea" data-action="open-idea" onClick={() => openIdea(matched)}><span className="iid">{matched}</span>{ideaTitle(matched)}</button>}
        <span className="ib-when">{dayOf(item.receivedAt)}</span>
      </div>
      <ol className="ib-steps" aria-label="Steps">
        {STEP_ORDER.map((id) => {
          const s = steps.find((x) => x.id === id);
          const st = s?.status ?? 'todo';
          return <li key={id} className={`ib-step st-${stepGlyph(st)}`} data-step={id} data-status={st} title={s ? `${STEP_WORDS[id]}: ${s.detail}` : STEP_WORDS[id]}><i className="dot" /><span className="w">{STEP_WORDS[id]}</span></li>;
        })}
      </ol>
      {current && <div className="ib-detail" data-testid="step-detail">{current.detail}{current.id === 'understand' && current.ms ? ` · ${(current.ms / 1000).toFixed(1)} s` : ''}</div>}
      {msg && <div className={`pop-notice ${msg.kind ?? 'ok'}`} role="status" data-testid="item-notice">{msg.text}</div>}
      {ai?.understood?.length ? (
        <details className="ib-understood" open={expanded}>
          <summary>What the AI understood</summary>
          <ul>{ai.understood.map((l, i) => <li key={i}>{l}</li>)}</ul>
          {ai.uncertain?.length ? <><div className="ib-g-k">Not sure about</div><ul>{ai.uncertain.map((l, i) => <li key={i}>{l}</li>)}</ul></> : null}
        </details>
      ) : null}
      {held.length > 0 && (
        <section className="ib-group g-held-items" data-group="needs-you">
          <div className="ib-g-h"><span className="ib-g-k">Needs you</span><span className="sec-n">{held.length}</span></div>
          <ul>
            {held.map((r) => (
              <li key={r.id} data-record={r.id} data-testid="held" data-rule={(r as any).held.rule}>
                <div className="ib-act"><span className="ib-rule">{RULE_WORDS[(r as any).held.rule] ?? 'Check'}</span><span className="ib-lbl">{r.label}</span></div>
                <div className="ib-why">{(r as any).held.why}</div>
                <div className="ib-choices">
                  {heldChoices((r as any).held).map((c) => (
                    <button key={c.label} className={`btn sm${c.kind === 'apply' ? ' primary' : ''}`} data-action={c.kind === 'apply' ? 'apply' : 'drop-action'} data-resolve={c.resolve ?? ''} disabled={busy}
                      onClick={() => void (c.kind === 'apply' ? apply(r.id, c.resolve) : drop(r.id))}>{c.label}</button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {/* Which idea? (today's block), Applied list with Undo (today's block), Held block (today's block) go here unchanged, moved from InboxPopout.tsx */}
      {expanded && item.status !== 'held' && (
        <div className="ib-again"><button className="btn sm" data-action="run-again" disabled={busy} onClick={() => void go('Running again…', () => inboxPost(item.id, 'process'), () => 'Run again.')}>Run again</button></div>
      )}
    </li>
  );
}
const RULE_WORDS: Record<string, string> = { 'contradicts-fact': 'Contradiction', 'person-star': 'A person', 'near-duplicate-star': 'Looks the same', 'low-confidence': 'Not sure', 'two-ideas': 'Two ideas', 'duplicate-idea': 'Duplicate idea', screened: 'Screened' };
```

Move the Which-idea, Applied and Held blocks from today's `InboxItem` into the card (same markup, same `data-action`s so the existing tour keeps working).

- [ ] **Step 4: Rebuild `InboxPopout.tsx`**

Three zones per spec §6, `width={1120} height={940}`. Zone 1: the drop well `.ib-well` (`data-testid="inbox-drop"`, keep `input[data-testid="inbox-file"]`, the paste `data-testid="inbox-paste"`, `data-action="add-note"`, the link `data-action="import"`, counts `data-testid="inbox-counts"`: "`N` processed · `M` need you · `K` held"). Zone 2: `items.filter((i) => isRunning(i) || needsYou(i))` as `InboxCard`s under the heading "In flight". Zone 3: chips (`<button className="chip" data-chip="all">All</button>` …), the search `<input aria-label="Search the history">`, then `groupByDay(filterItems(...))` with a `<div className="ib-day">` per group and a `<button className="ib-row" data-row={id}>` per item showing icon, name, time, idea or "export", `resultLine`, status chip; clicking toggles `open === id` and renders `<InboxCard expanded …/>` under the row. Dismissed items show in the list with the chip (no "Show dismissed" toggle).

Polling:

```ts
const polling = shouldPoll(inbox);
useEffect(() => {
  if (!polling) return;
  const t = setInterval(() => { void refreshInbox(); }, 1000);
  return () => clearInterval(t);
}, [polling, refreshInbox]);
const wasPolling = useRef(false);
useEffect(() => { if (wasPolling.current && !polling) void refresh(); wasPolling.current = polling; }, [polling, refresh]);
```

Drops stay as today (`dropFiles` → `inboxDropFile`), but call `refreshInbox()` right after the request is sent (not only after it returns) so the card appears while the server runs the steps: `const p = inboxDropFile(f); setTimeout(() => void refreshInbox(), 300); const out = await p;`.

CSS (append to `theme.css`):

```css
/* The Inbox: the drop well, step cards and history, in the universe's language. */
@property --ib-a { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
.ib-well{position:relative;height:160px;border-radius:10px;border:1px solid transparent;background:linear-gradient(#0e1313,#0e1313) padding-box,conic-gradient(from var(--ib-a),transparent 0 70%,rgba(125,211,207,.9) 85%,transparent 100%) border-box;animation:ib-rim 6s linear infinite;display:grid;grid-template-columns:1fr 300px;align-items:center;padding:0 24px;gap:20px}
@keyframes ib-rim{to{--ib-a:360deg}}
.ib-well.over{background:linear-gradient(#141c1c,#141c1c) padding-box,conic-gradient(from var(--ib-a),transparent 0 40%,rgba(245,179,107,.95) 70%,transparent 100%) border-box;box-shadow:0 0 30px rgba(245,179,107,.25)}
.ib-well .dz-t{font-size:22px;font-weight:700;color:#fff}
.ib-progress{position:absolute;left:12px;right:12px;top:-1px;height:2px;background:linear-gradient(90deg,transparent,var(--teal),transparent);background-size:40% 100%;animation:ib-run 1.4s linear infinite}
@keyframes ib-run{from{background-position:-40% 0}to{background-position:140% 0}}
.ib-steps{list-style:none;margin:8px 0 4px;padding:0;display:grid;grid-template-columns:repeat(8,1fr);position:relative}
.ib-steps::before{content:"";position:absolute;left:6%;right:6%;top:6px;height:1px;background:rgba(160,190,185,.2)}
.ib-step{display:flex;flex-direction:column;align-items:center;gap:6px;position:relative}
.ib-step .dot{width:12px;height:12px;border-radius:50%;border:1.5px solid rgba(160,190,185,.35);background:transparent;display:block}
.ib-step.st-ok .dot{background:var(--teal);border-color:var(--teal);box-shadow:0 0 8px rgba(125,211,207,.6)}
.ib-step.st-run .dot{background:var(--teal);border-color:var(--teal);animation:halo-breathe 1.2s ease-in-out infinite;box-shadow:0 0 0 6px rgba(125,211,207,.18),0 0 14px var(--teal)}
.ib-step.st-skip .dot{border-color:rgba(160,190,185,.3);border-style:dashed}
.ib-step.st-you .dot{background:var(--amber);border-color:var(--amber);box-shadow:0 0 10px rgba(245,179,107,.7)}
.ib-step.st-bad .dot{background:var(--danger);border-color:var(--danger)}
.ib-step .w{font-size:11px;color:var(--muted);letter-spacing:.02em}
.ib-step.st-ok .w,.ib-step.st-run .w{color:var(--text)}
.ib-detail{font-size:13px;color:var(--text);margin:4px 0 6px}
.ib-card{padding:12px 14px;border:1px solid rgba(160,190,185,.16);border-radius:6px;background:rgba(10,14,14,.35);margin-bottom:10px}
.ib-rule{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--amber);margin-right:8px}
.ib-why{font-size:13px;color:var(--muted);margin:2px 0 6px}
.ib-choices{display:flex;gap:8px;flex-wrap:wrap}
.chip{border:1px solid var(--panel-border);background:transparent;color:var(--muted);border-radius:999px;padding:4px 12px;font:inherit;font-size:12.5px;cursor:pointer}
.chip.on{border-color:var(--teal);color:#fff;background:rgba(125,211,207,.1)}
.ib-day{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:14px 0 6px}
.ib-row{display:grid;grid-template-columns:28px 1fr 160px 1fr 110px;gap:10px;align-items:center;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid rgba(160,190,185,.12);color:var(--text);font:inherit;padding:8px 4px;cursor:pointer}
.ib-row:hover{background:rgba(125,211,207,.05)}
[data-quality="lite"] .ib-well{animation:none;background:#0e1313;border-color:var(--panel-border)}
[data-quality="lite"] .ib-progress,[data-quality="lite"] .ib-step.st-run .dot{animation:none;box-shadow:none}
```

- [ ] **Step 5: Card test**

```tsx
// ui/src/popouts/InboxCard.test.tsx
// Mock '../api' (inboxPost). Render InboxCard with: steps done×4 + understand running → expect 4 `.ib-step.st-ok`, 1 `.st-run`, 3 `.st-todo`, and the detail text "Asking the AI…".
// Render with a pending action { held: { rule: 'near-duplicate-star', existing: 'capability:x', why } } → three buttons; click "Use the existing star" → inboxPost called with (id, 'apply', { actionIds: [aid], resolve: { [aid]: 'use-existing' } }).
// Render with rule 'contradicts-fact' → clicking "Keep the form's value" calls inboxPost(id, 'dismiss-action', { actionId }).
```

Also test in `InboxPopout`: with `inbox.items` holding a running step, a fake timer shows `refreshInbox` called after 1 s; unmounting stops it.

- [ ] **Step 6: Run, build**

Run: `cd cafe-app/ui && npx vitest run && npx tsc --noEmit -p . && cd .. && npm run build:ui`
Expected: green; build ok. Then run the existing Inbox tour flows: `CAFE_AI_FAKE=1 node scripts/ui-tour.mjs --workspace <scratch> --out <shots> --only=inbox` and `--only=inboxhand`; fix selectors the rebuild moved (keep `data-action`s and `data-testid`s named above).

- [ ] **Step 7: Commit**

```bash
git add -A cafe-app/ui cafe-app/web
git commit -m "Inbox screen: drop well, live step cards with held choices, full history"
```

---

### Task 7: Acceptance, tour, docs

**Files:**
- Modify: `cafe-app/src/ai/providers/fake.ts` (`CAFE_AI_FAKE_DELAY` ms sleep at the start of `complete` when set)
- Modify: `cafe-app/scripts/make-test-data.mjs` (add `13-conflicting-reply.eml`: a reply to CAFE-2026-001, from `team@example.test`, body "We have a second builder now … slot findings across time zones"; add the row to the table in `test-data/README.md`)
- Modify: `cafe-app/scripts/acceptance.mjs` (`agenticPass()` after `designPass()`)
- Modify: `cafe-app/scripts/ui-tour.mjs` (`--only=agentic`)
- Modify: `cafe-app/README.md` (Inbox section: the eight steps, the graph rule, the conflict rules table, the Needs-you choices, the history; remove "Confirm" wording), `cafe-app/test-data/README.md`

- [ ] **Step 1: Acceptance rows**

`agenticPass()` drops, in order, asserting with `check(...)` per row: `02-reply-with-id.eml` → eight steps `done`, check detail `Done`, every `ai:` link in `/api/graph` confirmed; `13-conflicting-reply.eml` → check `needs-you`, held rules `contradicts-fact` and `near-duplicate-star` (seed the near-duplicate by first dropping a reply that creates "Slot finding", or assert `near-duplicate-star` only when such a star exists and otherwise assert the new star was added confirmed; print which); `08-transcript.vtt` → `graph: done` with one PainPoint star, `context` records `s3a` ticked or OK depending on E3 sent; `07-our-own-sent.eml` → `understand: done`, `context: skipped` or filing only; `11-held-tracker.csv` → `screen: needs-you`; re-drop `02-reply-with-id.eml` → `duplicate: true`, `steps` has one `receive`.

- [ ] **Step 2: Tour**

`agenticShots(p)`: open the Inbox → `60-drop-well.png`; set `CAFE_AI_FAKE_DELAY=2500` (the tour starts its server, so pass it in the env of the spawned server for this flow), drop `02-reply-with-id.eml` through `inbox-file`, wait for `.ib-step.st-run`, → `61-card-running.png`; wait for `[data-testid="held"]` after dropping `13-conflicting-reply.eml` → `62-needs-you.png`; click chip `all`, scroll the history → `63-history.png`; close, open CAFE-2026-001 in the panel, scroll to Graph → `64-link-waiting.png` (a "Waiting on you" link from the held star, if any; else the confirmed AI links). Register `only === 'agentic'` in `main`.

- [ ] **Step 3: Docs**, then run everything:

```bash
cd cafe-app && npm test && (cd ui && npx vitest run) && npm run build:ui \
 && CAFE_AI_FAKE=1 npx tsx scripts/acceptance.mjs --fake --workspace /tmp/acc-ws \
 && CAFE_AI_FAKE=1 node scripts/ui-tour.mjs --workspace /tmp/tour-ws --out /tmp/shots --only=agentic
```

Expected: all green, every agentic row PASS, five shots, "No console errors."

- [ ] **Step 4: Commit**

```bash
git add -A cafe-app
git commit -m "Agentic Inbox: acceptance pass, tour shots and docs"
```

---

## Self-review notes

- Spec §3 (steps) → Tasks 1, 5. §4.1 (graph rule) → Task 4. §4.2 (conflicts) → Task 2, with the `screened`, `two-ideas`, `duplicate-idea` contexts built in Task 5. §5 (understand) → Task 3. §6 (screen) → Task 6. §7 (routes) → Tasks 4, 5 (`process`, `apply` with `resolve`, `dismiss-action`), 6. §8 files all named. §9 testing → each task's tests plus Task 7. §10 Café check: `person-star` (Task 2); stage hints stay suggestions (`suggest_stage` is held or applied as `kind: 'ok'`; `kindOf` is unchanged for it).
- Names used across tasks: `Step`, `StepId`, `StepStatus`, `STEP_ORDER`, `STEP_WORDS`, `markStep`, `skipRest`, `resetStepsFrom`, `stepOf`, `isRunning`, `timed` (Task 1 → Task 5; mirrored types in Task 6 helpers); `Held`, `HeldRule`, `ConflictContext`, `checkProposals` (Task 2 → Tasks 4, 5); `Understanding`, `understandTask`, `TriageInput.knownStars/teamAnswers` (Task 3 → Task 5 via `triage.ts`); `planAiLinks(..., opts)`, `ActionRecord.held` (Task 4 → Tasks 5, 6); `reprocessItem`, `applyRecords(..., resolve)`, `dropRecord`, routes `process`, `dismiss-action` (Task 5 → Task 6).
- Review Focus 1, 2, 3, 5 are tests in Task 5; 4 is tests in Task 6.
