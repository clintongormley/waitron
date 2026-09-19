import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import { parkPointerCommands } from "@waitron/ui/src/vitest-park-pointer.js";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          // Numbered from 1, not 0: Vitest 4 lifts a groupOrder-0 project that runs one isolated
          // worker out of its group and appends it after every other group, which puts Chromium ahead
          // of a node project numbered 0. Measured on packages/bookings, against the same run on
          // Vitest 3: with 0/1 the browser project's first test precedes the node project's, with 1/2
          // it follows. bookings, payments-stripe, payments-sumup and venue-service carry this
          // identical shape; packages/media and apps/dashboard split into projects too but pin no
          // project-level worker limit, so the lift never reached them.
          sequence: { groupOrder: 1 },
          globals: true,
          clearMocks: false,
          include: ["src/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "**/.stryker-tmp/**", "src/dashboard/**"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
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
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle.config.ts",
        "drizzle/**",
        "src/index.ts",
        "src/testing/**",
      ],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
