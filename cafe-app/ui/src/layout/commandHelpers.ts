export interface ChatActionView {
  id: string; label: string; status: 'proposed' | 'done' | 'cancelled' | 'undone' | 'failed'; note?: string; inverse?: unknown;
}
export interface ChatEntryView {
  id: string; at: string; text: string; reply: string; actions: ChatActionView[]; problems: string[]; error?: string;
}

export const STATUS_WORD: Record<ChatActionView['status'], string> = {
  proposed: 'Waiting for you', done: 'Done', cancelled: 'Cancelled', undone: 'Undone', failed: 'Failed',
};
export const canUndo = (a: ChatActionView) => a.status === 'done' && !!a.inverse;
export const waitingCount = (entries: ChatEntryView[]) => entries.reduce((n, e) => n + e.actions.filter((a) => a.status === 'proposed').length, 0);

/** Ideas for the empty panel: what the command bar can do today. */
export const EXAMPLES = [
  'Link Avery Chen to BSI',
  'Make Zainab Okafor sponsor of the procurement FAQ bot',
  'Put the travel and procurement bots in round 2026 Q4',
  'Add a capability Contract clause finding to the vendor contract summariser',
  'Remove the star Shared mailbox',
];
