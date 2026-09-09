import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

// Hermetic: temp dirs and `app.request`, no listener, no container, no hardware.
export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // `src/bin.ts` is the process entry — wired by hand, exercised by a manual boot; everything it
      // calls is tested directly.
      exclude: [...coverageConfigDefaults.exclude, "src/bin.ts"],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
