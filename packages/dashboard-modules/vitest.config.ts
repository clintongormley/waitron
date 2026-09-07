import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Keep singleFork (CLAUDE.md §4): @vitest/coverage-v8 under-merges BRANCH coverage across fork
    // workers under the hook's whole-workspace `pnpm -r test:coverage`, and a package this small has
    // a handful of mis-merged branches sink the ratio under threshold.
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // The registry (src/index.ts) is the package's only shipped source; the honesty test imports it,
      // so it is measured here rather than excluded as a barrel — an exclude would leave the table empty.
      exclude: [...coverageConfigDefaults.exclude],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
