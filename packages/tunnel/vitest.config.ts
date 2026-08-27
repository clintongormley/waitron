import { coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Single fork: @vitest/coverage-v8 under-merges branch coverage across forks under the
    // whole-workspace `pnpm -r test:coverage` the pre-push hook runs. The suite is tiny, so one
    // fork costs nothing and makes the gate deterministic (the packages/shared precedent).
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // src/index.ts is a pure re-export barrel with no logic (packages/shared precedent).
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
