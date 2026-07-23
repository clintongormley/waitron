import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**", "src/**/*.sandbox.test.ts"],
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "src/index.ts",
        // The real Stripe SDK boundary — a thin call-mapping wrapper exercised only by the nightly
        // sandbox suite (real test-mode), never the hermetic run. Its logic is the SDK's; excluding
        // it keeps the branch metric on our own logic (the provider, client.ts's `toMinorUnits`,
        // errors) rather than the SDK boundary; the `FakeStripe` test double lives under
        // `src/testing/**` and is excluded like all test infra.
        "src/stripe-client.ts",
        "src/testing/**",
        "src/**/*.sandbox.test.ts",
        // The nightly sandbox suite's OWN vitest config (a `defineConfig()` call, no logic) — v8's
        // `all`-file scan otherwise picks up this package-root file since it doesn't match the
        // default excludes' `vitest.config.*` token (it's `vitest.sandbox.config.ts`, a distinct
        // file from `vitest.config.ts`).
        "vitest.sandbox.config.ts",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
