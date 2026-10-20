import type { Provider } from '../connector';

/**
 * Test hook for the tour and the tests. It exists only when CAFE_AI_FAKE=1 is set
 * in the server's environment (see defaultProviders), and even then refuses to
 * answer if the variable has since been removed. It never reads the submission.
 */
const EXTRACT = {
  nodes: [
    { type: 'Capability', label: 'Document parsing' },
    { type: 'Capability', label: 'Workflow routing' },
    { type: 'System', label: 'Shared mailbox' },
  ],
  links: [
    { from: 'idea', to: 'Document parsing', rel: 'NEEDS', description: 'Reads the incoming requests', confidence: 0.9 },
    { from: 'idea', to: 'Workflow routing', rel: 'NEEDS', description: 'Sends each request to the right team', confidence: 0.9 },
    { from: 'Document parsing', to: 'Shared mailbox', rel: 'USES_DATA', description: 'Requests arrive in a shared mailbox', confidence: 0.6 },
  ],
};
const REVIEW = {
  criteria: { feasible: true, builder: false, data: true, theme: true, reuse: true },
  decision: 'ask',
  reason: 'Looks feasible with sample data and could be reused, but no builder is named yet. Ask the team who will build it.',
};

const enabled = () => process.env.CAFE_AI_FAKE === '1';

export function fakeProvider(): Provider {
  return {
    id: 'fake',
    label: 'Fake (test)',
    available: async () => enabled(),
    async complete(prompt) {
      if (!enabled()) throw new Error('The fake AI is off');
      if (prompt.startsWith('TASK: extract')) return `Here is the JSON:\n${JSON.stringify(EXTRACT)}`;
      if (prompt.startsWith('TASK: review-suggest')) return JSON.stringify(REVIEW);
      return '{}';
    },
  };
}
