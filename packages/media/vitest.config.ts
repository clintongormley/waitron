import { coverageConfigDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import { parkPointerCommands } from "@waitron/ui/src/vitest-park-pointer.js";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          globals: true,
          clearMocks: false,
          include: ["src/**/*.test.ts"],
          exclude: ["src/dashboard/**", "src/**/*.pg.test.ts", "**/node_modules/**"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        test: {
          name: "pg",
          globals: true,
          clearMocks: false,
          include: ["src/**/*.pg.test.ts"],
          globalSetup: ["./src/testing/global-setup.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        test: {
          name: "browser",
          globals: true,
          clearMocks: false,
          include: ["src/dashboard/**/*.test.ts"],
          // The project's own `fileParallelism` is where Vitest 4 reads this: it fills
          // `browser.fileParallelism` from this key when the browser block does not set it.
          fileParallelism: false,
          browser: {
            enabled: true,
            provider: playwright({}),
            headless: true,
            instances: [{ browser: "chromium" }],
            // The dashboard a11y suites import a11y-helpers.ts, whose beforeEach runs this command.
            commands: { ...parkPointerCommands },
          },
        },
      },
    ],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Outer, not per-project: scripts/fiscal-test-budget.test.ts pins it.
    maxWorkers: 2,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "src/index.ts",
        "src/dashboard/test-helpers.ts",
        "src/testing/**",
      ],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
