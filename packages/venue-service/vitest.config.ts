import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";
import { parkPointerCommands } from "@waitron/ui/src/vitest-park-pointer.js";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          sequence: { groupOrder: 0 },
          globals: true,
          include: ["src/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "**/.stryker-tmp/**", "src/dashboard/**"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          poolOptions: { forks: { singleFork: true } },
        },
      },
      {
        test: {
          name: "browser",
          sequence: { groupOrder: 1 },
          globals: true,
          include: ["src/dashboard/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
          browser: {
            enabled: true,
            provider: "playwright",
            headless: true,
            fileParallelism: false,
            instances: [{ browser: "chromium" }],
            // The dashboard a11y suites import a11y-helpers.ts, whose beforeEach runs this command.
            commands: { ...parkPointerCommands },
          },
        },
      },
    ],
    coverage: {
      provider: "v8",
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
