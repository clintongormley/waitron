import { defineConfig, configDefaults } from "vitest/config";
export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "test/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "json-summary"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
