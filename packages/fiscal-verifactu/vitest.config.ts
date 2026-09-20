import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    // Keep at most four fork workers alive; scripts/fiscal-test-budget.test.ts pins it.
    maxWorkers: 4,
    // Shared globalSetup requires Docker for the real-Postgres privilege and concurrency suites.
    // It runs once before the workers, including for PGlite-only selections.
    globalSetup: ["./src/testing/global-setup.ts"],
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // `hookTimeout` bounds a hook that passes no timeout of its OWN; a hook given one overrides
    // this config (stated at `packages/db/src/testing/lifecycle.ts:178`, measured at `:182-183`).
    // So it does NOT bound the PGlite boot: `useVenueDb` times its own `beforeAll` (`:146`).
    // **This package is a MIXED one, so the budget that applies there is not one number.** Three
    // `useVenueDb` call sites pass `timeoutMs: 120_000` (`src/aeat-transport.test.ts:34`,
    // `src/provisioning-secret.test.ts:22`, `src/slot.test.ts:72`); the other twenty-four take the
    // helper's own 60s default (`lifecycle.ts:22`). This setting reaches neither.
    //
    // What it DOES bound is every hook that declares no budget — **this list is the expensive ones,
    // not all of them.** Both helpers' bare afterEach reset and afterAll close: the PGlite one at
    // `lifecycle.ts:148` and `:153`, reached through `venue-db.ts:26`, and `useTemplateDb`'s own at
    // `:433` and `:440`. The template clone the seven real-PG suites take without a `timeoutMs` of
    // their own (`useTemplateDb`'s `beforeAll` at `:422`, passing the caller's value at `:431`).
    // And a suite's own hook — three of them open a database per test in an untimed `beforeEach`
    // (`src/registro-sif.test.ts:22`, `src/provisioning.test.ts:25`, `src/restore.test.ts:63`; the
    // hook lines, since the hook is what this setting bounds). Three more suites open one inside an
    // `it` body, where `testTimeout` covers it instead (`src/verify.test.ts:208`,
    // `src/drain.containment.test.ts:46` and `:161`).
    //
    // Measured in one run, which this config takes because it declares no projects —
    // `vitest run src/acks.test.ts src/privileges.test.ts src/provisioning.test.ts
    // --hookTimeout=1`. **FAILED-versus-SKIPPED is the discriminator, not the collected count:** a
    // `beforeAll` that times out SKIPS its suite's tests, and any later hook FAILS them. So
    // `src/privileges.test.ts`, whose template clone is bounded, fails at `lifecycle.ts:422` with
    // all five of its tests SKIPPED, while `src/acks.test.ts` — whose boot survives — has all ten
    // FAILED, in its own `beforeEach` (`:40`) and the helper's reset and close.
    // `src/provisioning.test.ts` is the third shape and dies in its own `beforeEach`.
    // The clean case for "the bodies ran" is `src/provisioning-secret.test.ts`, checked separately
    // and also a `timeoutMs: 120_000` call site. The reason is that NO HOOK PRECEDES A BODY there:
    // it declares none of its own, and the PGlite helper registers only `beforeAll`, `afterEach`
    // and `afterAll`, so with its `beforeAll` surviving on its own 120s budget nothing could have
    // stopped a body. It is NOT that its teardown fired — an untimed `afterEach` runs even for a
    // test whose `beforeEach` failed and whose body never ran, which is what `src/acks.test.ts`
    // does here. Do not read "failed" as "ran".
    //
    // The container boot and image pull are in neither budget — they are globalSetup's, which
    // vitest does not bound by `hookTimeout` at all.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
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
