import { defineConfig } from 'vitest/config';

// parse.test.ts and roundtrip.test.ts self-skip when the native tree-sitter /
// better-sqlite3 bindings are not built; the pure-TS suites always run.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
