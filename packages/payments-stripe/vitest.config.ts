import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

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
          exclude: [
            ...configDefaults.exclude,
            "**/.stryker-tmp/**",
            "src/**/*.sandbox.test.ts",
            "src/dashboard/**",
          ],
          testTimeout: 120_000,
          hookTimeout: 180_000,
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
          // Vitest 4 fills `browser.fileParallelism` from this key when the browser block does not.
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
        "src/index.ts",
        "src/dashboard/index.ts",
        "src/dashboard/test-helpers.ts",
        // The real Stripe SDK wrappers, which the nightly sandbox suites run against Stripe's test
        // mode.
        "src/stripe-client.ts",
        "src/stripe-device-client.ts",
        "src/stripe-hosted-client.ts",
        "src/stripe-report-client.ts",
        "src/testing/**",
        "src/**/*.sandbox.test.ts",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
