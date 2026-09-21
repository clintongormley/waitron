import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

// Hermetic: every suite here opens its own SQLite file, in memory or under a temp directory. No
// container, no shared database.
export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      // src/index.ts opens the two files; its own suite covers it, so nothing is excluded here
      // beyond Vitest's own defaults.
      exclude: [...coverageConfigDefaults.exclude],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
