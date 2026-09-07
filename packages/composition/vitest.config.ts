import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // src/index.ts is a re-export barrel; src/role-parity.ts is a compile-time type assertion with
      // no runtime code — both carry nothing v8 can meaningfully cover.
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts", "src/role-parity.ts"],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
