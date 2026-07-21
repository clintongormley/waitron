import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // PGlite boots a WASM PostgreSQL and then applies two migration sets, and
    // chain.concurrency.test.ts additionally pulls and starts a real Postgres container via
    // Testcontainers. Vitest's default 5s testTimeout is a live risk for both reasons. Both costs
    // are one-off, paid in a beforeAll, so hookTimeout — raised further than testTimeout, to a
    // container cold pull on a slow CI runner — is the one that has to be generous; testTimeout
    // covers the ordinary risk of a migration suite booting a second database inside a single
    // `it`.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle.config.ts",
        "drizzle/**",
        "src/testing/**",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
