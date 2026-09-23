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
      // src/index.ts is a pure re-export barrel (excluded like the sibling packages exclude theirs).
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
