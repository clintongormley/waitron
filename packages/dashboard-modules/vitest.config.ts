import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Keep one worker: @vitest/coverage-v8 under-merges BRANCH coverage across fork
    // workers under a whole-workspace `pnpm -r test:coverage`, and a package this small has a
    // handful of mis-merged branches sink the ratio under threshold.
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      // The registry (src/index.ts) is the package's only shipped source; the honesty test imports it,
      // so it is measured here rather than excluded as a barrel — an exclude would leave the table empty.
      exclude: [...coverageConfigDefaults.exclude],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
