import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

// Node runs before the browser project so Chromium does not compete with the database suites.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          // Numbered from 1, not 0: Vitest 4 lifts a groupOrder-0 project that runs one isolated
          // worker out of its group and appends it after every other group, so a node project
          // numbered 0 would run after Chromium.
          sequence: { groupOrder: 1 },
          globals: true,
          clearMocks: false,
          include: ["src/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "**/.stryker-tmp/**", "src/dashboard/**"],
          // `useVenueDb` times its own beforeAll, so `hookTimeout` bounds only its afterEach/afterAll
          // and hooks a suite writes itself.
          testTimeout: 120_000,
          hookTimeout: 180_000,
          // One worker: @vitest/coverage-v8 under-merges branch coverage across fork workers, and a
          // package this size has few enough branches that a few mis-merged ones sink the ratio.
          maxWorkers: 1,
        },
      },
      {
        test: {
          name: "browser",
          sequence: { groupOrder: 2 },
          globals: true,
          clearMocks: false,
          include: ["src/dashboard/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
          // Vitest 4 fills `browser.fileParallelism` from this project-level key.
          fileParallelism: false,
          browser: {
            enabled: true,
            provider: playwright({}),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle.config.ts",
        "drizzle/**",
        "src/testing/**",
        // A re-export barrel, on which v8 reports phantom uncovered branches.
        "src/index.ts",
        "src/dashboard/test-helpers.ts",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
