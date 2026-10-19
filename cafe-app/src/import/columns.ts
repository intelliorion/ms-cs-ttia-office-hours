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
