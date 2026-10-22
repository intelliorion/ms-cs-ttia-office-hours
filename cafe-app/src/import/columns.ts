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

/** "Doe, Jane" (the directory's order) → "Jane Doe", so greetings and sender matching use the first name. */
export function naturalName(name: string): string {
  const m = /^([^,]+),\s*([^,]+)$/.exec(name.trim());
  return m ? `${m[2].trim()} ${m[1].trim()}` : name.trim();
}

export function parseSubmitter(value: string): { name?: string; entity?: string } {
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(value.trim());
  if (m) return { ...(m[1].trim() ? { name: naturalName(m[1]) } : {}), entity: m[2].trim() };
  return value.trim() ? { name: naturalName(value) } : {};
}

const PRONOUNS = /^(he|she|they|ze|xe)\s*\/\s*\w+$/i;
const ROLE_PREFIX = /^(lead|co-?lead|sponsor|team\s*member|member)\s*:\s*(.+)$/i;

/**
 * The form's "Team Members and Lead" cell, in any of the styles people type: one per line or split by ";",
 * "Name (Lead)", "Name - Sponsor", or "Lead: Name" / "Sponsor: Name" / "Team Member: Name". Pronouns such as
 * "(he/him)" are dropped from the name and are not a role.
 */
export function parseTeam(value: string): Person[] {
  return value
    .split(/[;\n]+/)
    .map((s) => s.replace(/^#/, '').trim())
    .filter(Boolean)
    .map((part) => {
      let text = part; let prefix: string | undefined;
      const pre = ROLE_PREFIX.exec(text);
      if (pre) { prefix = pre[1]; text = pre[2].trim(); }
      // Pronouns in brackets go, wherever they sit: "Name(he/him)" or "Name (she/her) (Lead)".
      text = text.replace(/\s*\(([^)]*)\)/g, (all, inner: string) => (PRONOUNS.test(inner.trim()) ? '' : all)).trim();
      const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(text) ?? /^(.*?)\s+[-–]\s+(.+)$/.exec(text);
      const name = naturalName((m ? m[1] : text).trim());
      const note = m?.[2]?.trim() ?? prefix;
      const role: PersonRole = /sponsor/i.test(note ?? '') ? 'sponsor' : /lead/i.test(note ?? '') ? 'lead' : 'member';
      return note && !/^(team\s*)?member$/i.test(note) ? { name, role, note } : { name, role };
    })
    .filter((p) => p.name);
}
