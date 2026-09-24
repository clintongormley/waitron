import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

// Hermetic: every suite here runs against fakes (a loopback TCP listener, a temp file). No database,
// no container, no hardware.
export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
