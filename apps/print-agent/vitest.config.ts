import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

// Tests use temporary state and local listeners, with no container or hardware.
export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      // Process entries are exercised by a manual boot; their helpers are tested directly.
      exclude: [...coverageConfigDefaults.exclude, "src/bin.ts", "src/dev-bin.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
