import { coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          globals: true,
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
          include: ["src/dashboard/**/*.test.ts"],
          browser: {
            enabled: true,
            provider: "playwright",
            headless: true,
            fileParallelism: false,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    poolOptions: { forks: { maxForks: 2 } },
    coverage: {
      provider: "v8",
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
