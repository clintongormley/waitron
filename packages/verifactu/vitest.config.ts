import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // A crashed Stryker run leaves .stryker-tmp holding mutated copies of the
    // source. Without this exclude Vitest discovers them as real test files, so
    // one interrupted mutation run makes every later test run fail confusingly.
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [...coverageConfigDefaults.exclude, "test/vectors.ts"],
      // Higher floors than packages/ui: this is pure functions over plain data
      // with no rendering, no async and no DOM, so there is no legitimate
      // reason for a branch here to go unexercised.
      thresholds: {
        statements: 98,
        lines: 98,
        functions: 98,
        branches: 95,
      },
    },
  },
});
