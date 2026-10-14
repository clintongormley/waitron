import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import { parkPointerCommands } from "@waitron/ui/src/vitest-park-pointer.js";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          // From 1, not 0: Vitest 4 moves a groupOrder-0 project that pins one worker after every
          // other group (CLAUDE.md §4).
          sequence: { groupOrder: 1 },
          globals: true,
          clearMocks: false,
          include: ["src/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "**/.stryker-tmp/**", "src/dashboard/**"],
          // `useVenueDb` times its own beforeAll, so `hookTimeout` bounds its untimed afterEach/afterAll
          // and a suite's own hooks.
          testTimeout: 60_000,
          hookTimeout: 120_000,
          // One worker: v8 under-merges BRANCH coverage across fork workers.
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
            // The a11y suite imports @waitron/ui's a11y-helpers.ts, whose beforeEach runs this command.
            commands: { ...parkPointerCommands },
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
        "src/index.ts",
        "src/schema/index.ts",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
