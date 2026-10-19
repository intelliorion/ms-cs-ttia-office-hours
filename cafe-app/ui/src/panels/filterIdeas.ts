export const stageKey = (i: any): string => (i.closed ? 'closed' : String(i.stage));

export function filterIdeas(ideas: any[], q: string, stages: string[]): any[] {
  const needle = q.trim().toLowerCase();
  return ideas.filter((i) => {
    if (stages.length && !stages.includes(stageKey(i))) return false;
    if (!needle) return true;
    return [i.id, i.title, i.function].some((v) => String(v ?? '').toLowerCase().includes(needle));
  });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDate = (iso: string): string => {
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  return m ? `${d} ${MONTHS[m - 1]}` : iso;
};

/** "E1 ✓ 19 Oct" for sent mails, "E5 draft" / "E5 approved" for ones waiting. */
export function emailChips(idea: any, outbox: any[]): string[] {
  const sent = Object.entries((idea.sent ?? {}) as Record<string, string>).map(([t, d]) => `${t} ✓ ${shortDate(d)}`);
  const waiting = outbox.filter((m) => m.idea === idea.id && m.status !== 'sent' && !(idea.sent ?? {})[m.template]).map((m) => `${m.template} ${m.status}`);
  return [...sent, ...waiting];
}
