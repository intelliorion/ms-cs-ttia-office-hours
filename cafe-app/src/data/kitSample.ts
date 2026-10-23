/**
 * The kit's synthetic sample, held to the confirmed data: when the team gave a sample input, sample-data.csv has ITS
 * columns (real names, in order, kinds from the profile), never the columns the kit AI thought of. Values stay made
 * up: the AI's value for a column of the same name when it is not one seen in the dropped file (a category's codes
 * may repeat, nothing else), else a value made here from the profile. Masked columns get obviously fake values.
 */
import { KIT_COLUMNS_MAX, type KitColumnKind, type KitSample } from '../ai/tasks';
import { columnName, nthId } from '../design/sampleData';
import { isUsable, meaningOf, type ColumnProfile, type DataFile, type DataState } from './model';

const KIND: Record<ColumnProfile['type'], KitColumnKind> = {
  id: 'id', number: 'number', money: 'money', date: 'date', datetime: 'date', 'yes-no': 'yes-no', category: 'category', text: 'text', empty: 'text', masked: 'text',
};

/** The sample input the kit is held to: the first confirmed, usable sample input with a table. */
export function sampleInputOf(data: DataState | undefined): DataFile | undefined {
  if (!data?.confirmedAt) return undefined;
  return data.files.find((f) => f.kind === 'input' && isUsable(f) && f.tables?.length);
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${/^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : '2026-10-05'}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '2026-10-05';
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** A made-up value for row n of a column, from its profile. */
export function syntheticValue(c: ColumnProfile, n: number): string {
  if (c.type === 'masked') {
    return c.masked === 'email' ? 'someone@example.com' : c.masked === 'phone' ? `07700 900${String(n % 1000).padStart(3, '0')}` : c.masked === 'name' ? `Person ${((n - 1) % 5) + 1}` : c.masked === 'id' ? `ID-****${n}` : '(masked)';
  }
  const top = c.top?.map((t) => t.value).filter((v) => !/^<\w+>$/.test(v)) ?? [];
  switch (c.type) {
    case 'id': return c.pattern ? nthId(c.pattern.replace(/A/g, 'S').replace(/9+$/, (m) => '0'.repeat(m.length)), n) : `R-${String(n).padStart(3, '0')}`;
    case 'number': case 'money': {
      const lo = Number(c.min ?? 0); const hi = Number(c.max ?? 100);
      const v = (Number.isFinite(lo) ? lo : 0) + (((Number.isFinite(hi) ? hi : 100) - (Number.isFinite(lo) ? lo : 0)) * ((n * 37) % 100)) / 100;
      return c.type === 'money' ? v.toFixed(2) : String(Math.round(v));
    }
    case 'date': case 'datetime': return addDays(c.min ?? '2026-10-05', n % 28);
    case 'yes-no': case 'category': return top.length ? top[(n - 1) % top.length] : `${columnName(c.name)}_${n}`;
    default: return `Made-up ${c.name.replace(/_/g, ' ')} ${n}`;
  }
}

/**
 * The kit sample with the sample input's columns. Returns the AI's sample as it is when there is no confirmed sample
 * input; `fitted` says whether it was changed.
 */
export function fitSampleToData(sample: KitSample, data: DataState | undefined): { sample: KitSample; fitted: boolean } {
  const file = sampleInputOf(data);
  if (!file) return { sample, fitted: false };
  const table = file.tables![0];
  const cols = table.columns.filter((c) => c.type !== 'empty').slice(0, KIT_COLUMNS_MAX);
  const key = (s: string) => columnName(s).toLowerCase();
  const at = new Map(sample.columns.map((c, i) => [key(c.name), i]));
  // What the AI saw of the file: the example rows and the commonest values. Only a category may repeat them.
  const seen = new Set(table.examples.flat().map((v) => v.trim().toLowerCase()).filter(Boolean));
  const free = (c: ColumnProfile) => c.type === 'category' || c.type === 'yes-no';
  const cell = (row: string[], c: ColumnProfile, n: number) => {
    const i = at.get(key(c.name));
    const v = i === undefined ? '' : String(row[i] ?? '').trim();
    if (!v || c.type === 'masked' || (!free(c) && seen.has(v.toLowerCase()))) return syntheticValue(c, n);
    return v;
  };
  const kind = (c: ColumnProfile): KitColumnKind => (c.type === 'masked' && c.masked === 'name' ? 'person' : KIND[c.type]);
  const about = (c: ColumnProfile) => (meaningOf(file, c.name) ?? `${c.type}${c.pattern ? `, like ${c.pattern}` : ''}`).slice(0, 160);
  return {
    fitted: true,
    sample: {
      name: sample.name || `Made-up rows shaped like ${file.name}`,
      columns: cols.map((c) => ({ name: c.name, kind: kind(c), about: about(c) })),
      rows: (sample.rows.length ? sample.rows : [[]]).map((r, k) => cols.map((c) => cell(r, c, k + 1))),
      seeded: sample.seeded.map((g, k) => ({ ...g, row: cols.map((c) => cell(g.row, c, 900 + k)) })),
    },
  };
}
