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

// A leading = + - @ tab or CR would run as a formula in Excel, so it gets a quote mark in front.
const cell = (raw: string) => {
  const v = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

export async function writeStatusCsv(root: string, clock: Clock): Promise<string> {
  const round = await loadRound(root);
  const { ideas } = await listIdeas(root);
  const today = clock();
  const rows = [['Café ID', 'Title', 'Status', 'Updated'], ...ideas.map((i) => [i.id, i.title, publicStatus(i, round), today])];
  const file = path.join(paths(root).exports, 'status.csv');
  await writeFileAtomic(file, `${rows.map((r) => r.map(cell).join(',')).join('\n')}\n`);
  return file;
}
