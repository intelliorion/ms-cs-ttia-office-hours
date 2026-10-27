import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'], testTimeout: 20000,
    // Deep read arms itself when the model is on the machine: the tests point the model folder at a place that never
    // holds it, so a developer's cached model is never loaded by a test (the memory tests use CAFE_EMBED_FAKE=1).
    env: { CAFE_MODEL_DIR: path.join(os.tmpdir(), 'cafe-tests-no-model', 'models') },
  },
});
