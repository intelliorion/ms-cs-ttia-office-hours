import { describe, it, expect } from 'vitest';
import { stageEmails, unsentFor } from './outlook';

const steps = [
  { id: 's1e', stage: 2, email: 'E1' }, { id: 's2c', stage: 2, email: 'E2' }, { id: 's2f', stage: 2, email: 'decision' },
  { id: 's3b', stage: 3, email: 'E7' }, { id: 's3h', stage: 3, email: 'E8' }, { id: 's4a', stage: 4, email: 'E10' },
];
describe('the idea Emails menu', () => {
  it("lists this stage's emails (not the questions or decision emails, which their own buttons make), plus the reminder when due", () => {
    expect(stageEmails({ stage: 2 }, steps)).toEqual(['E1']);
    expect(stageEmails({ stage: 2, offerE2R: true }, steps)).toEqual(['E1', 'E2R']);
    expect(stageEmails({ stage: 3 }, steps)).toEqual(['E7', 'E8']);
  });
  it("offers whatever this idea has drafted and not sent, and nothing of other ideas'", () => {
    const outbox = [
      { idea: 'CAFE-1', template: 'E2', status: 'draft', key: 'a' }, { idea: 'CAFE-1', template: 'E1', status: 'sent', key: 'b' },
      { idea: 'CAFE-2', template: 'E3', status: 'draft', key: 'c' },
    ];
    expect(unsentFor({ id: 'CAFE-1' }, outbox)).toEqual([{ template: 'E2', key: 'a' }]);
  });
});
