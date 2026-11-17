import { defineConfig } from "vitest/config";
import { rootGuardWorkers } from "./scripts/root-test-budget.mjs";

// Root guard suites are outside the workspace packages and are not typechecked.
export default defineConfig({
  test: {
    globals: true,
    maxWorkers: process.env.CI ? undefined : rootGuardWorkers(),
    clearMocks: false,
    // The default discovery would also run package suites from this root project.
    include: ["scripts/**/*.test.mjs", "scripts/**/*.test.ts"],
    // These guards spawn child processes, whose startup slows under shared machine load.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // scripts/**/*.ts stays unmeasured: ci-and-gates.md → "What the storage switch did to the bars".
      include: ["scripts/**/*.mjs", "packages/db/src/english-only.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
