import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // No globalSetup and no DB harness yet: Task 2 ships only the permission + error-code layer, whose
    // one suite (errors.test.ts) is a hermetic unit test. Later tasks (T3 enrol/auth, T4 enqueue,
    // T5 runtime) that add real-Postgres suites will add the shared-container globalSetup + timeouts
    // the sibling packages carry.
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // src/index.ts is a side-effect-only barrel (it will become a pure re-export barrel as later
      // tasks add exports), excluded for the same reason packages/layouts/packages/purchasing exclude
      // their identical barrels. errors.ts IS measured: it erases to a single `import "@waitron/shared"`
      // that executes when errors.test.ts imports the barrel, so it covers trivially.
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
