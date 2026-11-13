import { defineConfig } from 'vitest/config';

// parse.test.ts and roundtrip.test.ts self-skip when the native tree-sitter /
// better-sqlite3 bindings are not built; the pure-TS suites always run.
// Several suites read whole pinned sources and take 2 to 4 s alone, close to
// vitest's 5 s default, so they timed out under the full suite's load (#17).
// The beforeAll hooks that build an in-memory corpus passed the 10 s hook
// default the same way (#51).
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'], testTimeout: 30_000, hookTimeout: 30_000 },
});
