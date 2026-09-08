import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

// Hermetic: every suite here runs against fakes (a loopback TCP listener, a temp file). No database,
// no container, no hardware.
export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts", "src/testing/**"],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
