import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    // A crashed Stryker run leaves mutated copies of the source, tests included, in .stryker-tmp,
    // and Vitest would collect them.
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // One file at a time in one worker: @vitest/coverage-v8's merge across workers has
    // intermittently under-counted this package's branches, flipping the gate on unchanged code.
    fileParallelism: false,
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      // src/index.ts is a re-export barrel, excluded here rather than in-file (see its header).
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
