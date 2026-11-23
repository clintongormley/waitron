import { coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: coverageConfigDefaults.exclude,
      reporter: ["text", "html", "json-summary"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
