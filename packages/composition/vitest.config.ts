import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      // src/index.ts is a re-export barrel; src/role-parity.ts is a compile-time type assertion with
      // no runtime code — both carry nothing v8 can meaningfully cover.
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts", "src/role-parity.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
