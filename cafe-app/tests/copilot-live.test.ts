import { describe, it, expect } from 'vitest';
import { copilotProvider } from '../src/ai/providers/copilot';
import { pingTask, extractTask } from '../src/ai/tasks';

/** Runs the real Copilot CLI. Skipped unless CAFE_COPILOT_BIN points at the binary. */
const live = process.env.CAFE_COPILOT_BIN ? describe : describe.skip;

live('Copilot CLI (live)', () => {
  const p = copilotProvider();
  it('answers the ping task with checked output', async () => {
    const t = Date.now();
    const out = pingTask.parse(await p.complete(pingTask.prompt({}), { timeoutMs: 90_000 }));
    console.log(`copilot ping ${Date.now() - t} ms`);
    expect(out).toEqual({ ok: true });
  }, 100_000);
  it('answers a small extract task with schema-valid output', async () => {
    const t = Date.now();
    const input = { idea: { id: 'CAFE-2026-001', title: 'Route vendor invoices', challenge: 'Invoices arrive by email and are keyed into SAP by hand.', current_process: 'Staff read the email and retype it.', outcomes: ['Fewer keying errors'] }, existing: { capabilities: [], systems: [], painPoints: [] } };
    const out = extractTask.parse(await p.complete(extractTask.prompt(input), { timeoutMs: 150_000 }));
    console.log(`copilot extract ${Date.now() - t} ms, ${out.nodes.length} nodes`);
    expect(Array.isArray(out.nodes)).toBe(true);
  }, 160_000);
});
