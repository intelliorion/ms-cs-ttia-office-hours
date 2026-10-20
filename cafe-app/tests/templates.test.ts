import { describe, it, expect } from 'vitest';
import { loadTemplatesFrom, render, SIGNATURE } from '../src/comms/templates';
import { BUNDLED_TEMPLATES } from '../src/workspace/paths';
import { normalizeIdea } from '../src/ideas/idea';
import { DEFAULT_SETTINGS, TOKENS } from '../src/round/round';
import unblock from '../ui/src/popouts/unblock.json';

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

  it('keeps $ sequences in user values literal', async () => {
    const { E1 } = await loadTemplatesFrom(BUNDLED_TEMPLATES);
    const dollarIdea = normalizeIdea({ ...idea, title: 'Cost $& savings $$' });
    expect(render(E1, { idea: dollarIdea }).body).toContain('"Cost $& savings $$"');
    const dollarSettings = { ...settings, operatorName: "Ann $' O'Neil" };
    expect(render(E1, { idea, round, settings: dollarSettings }).body).toContain("Ann $' O'Neil");
  });

  it('counts the content placeholders left for Outlook', async () => {
    const { E2 } = await loadTemplatesFrom(BUNDLED_TEMPLATES);
    expect(render(E2, { idea, round, settings }).contentPlaceholders).toHaveLength(4);
  });
});

describe('what each Round field is needed for', () => {
  it('matches the templates that really contain each token', async () => {
    const t = await loadTemplatesFrom(BUNDLED_TEMPLATES);
    const ids = Object.keys(t).sort();
    const table = unblock as Record<string, { emails: string[] | 'all' }>;
    const used = new Map<string, string[]>();
    for (const [token, def] of Object.entries(TOKENS)) {
      const has = ids.filter((id) => `${t[id].to === 'list' ? '[DISTRIBUTION LIST]' : ''}\n${t[id].subject}\n${t[id].body}${SIGNATURE}`.includes(token));
      used.set(def.key, has);
    }
    for (const [field, row] of Object.entries(table)) {
      const found = used.get(field) ?? [];
      expect(row.emails === 'all' ? ids : [...row.emails].sort(), field).toEqual(found);
    }
    // Every field that some template uses is in the table.
    for (const [key, has] of used) if (has.length) expect(table[key], key).toBeDefined();
  });
});
