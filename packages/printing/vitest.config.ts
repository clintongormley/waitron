import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    // `testTimeout` covers work inside an individual test, including this package's seeding, which
    // every test does for itself rather than in a hook. `hookTimeout` bounds only a hook that passes
    // no timeout of its OWN — the database helper's per-test reset and its close, plus any untimed
    // hook a suite writes. It does NOT bound `useVenueDb`'s `beforeAll`, which passes its own
    // (60s unless the suite overrides it; `packages/db/src/testing/venue-db.ts`).
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Run the whole suite in ONE fork. Single-fork guards the @vitest/coverage-v8 cross-fork branch
    // under-merge: a branch covered only in one worker can read as uncovered after merging profiles.
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      // src/index.ts is a pure re-export barrel (excluded like packages/layouts/purchasing exclude
      // theirs). errors.ts IS measured — it erases to a single `import "@waitron/shared"` that
      // executes when the barrel is imported, so it covers trivially; agent.ts is the real subject
      // of this package's suites.
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts"],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
