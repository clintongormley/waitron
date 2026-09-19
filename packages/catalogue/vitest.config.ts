import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // One shared PostgreSQL template, cloned by every .pg.test.ts suite in this package — all of
    // them, through `useTemplateDb`, not the content-language ones alone.
    globalSetup: ["./src/testing/global-setup.ts"],
    // hookTimeout bounds a hook only when that hook passes no timeout of its own, because an
    // argument REPLACES this setting rather than narrowing it: the config value is only that
    // parameter's default (`beforeAll(fn, timeout = getDefaultHookTimeout())`,
    // @vitest/runner@4.1.11). So it bounds the template clone in the .pg.test.ts suites, which pass
    // none, each suite's own beforeEach/afterEach, and the untimed afterEach reset and afterAll
    // close that `useVenueDb` registers (packages/db/src/testing/lifecycle.ts:148 and :153) — but
    // NOT the PGlite boot, which is given `options.timeoutMs ?? 60s` where it is registered
    // (lifecycle.ts:146). Measured on this package rather than read: under `--hookTimeout=50`
    // src/provisioning.test.ts still passes, while putting `timeoutMs: 50` on its own call fails
    // that same beforeAll. The same run shows the globalSetup container boot is outside hook
    // timeouts too — it completed and the suites ran under that 50ms ceiling.
    // testTimeout covers work inside an individual test.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      // src/index.ts is a pure re-export barrel with no logic of its own, excluded for the same
      // reason packages/reporting's own vitest.config.ts excludes its identical barrel. src/testing
      // and test hold Task 5's harness/integration scaffolding, measured by their own suites.
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts", "src/testing/**", "test/**"],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
