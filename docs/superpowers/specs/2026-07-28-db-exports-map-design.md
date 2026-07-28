# `@waitron/db`'s exports map, and the six copies it was blamed for (design)

**Date:** 2026-07-28 · **Main at design time:** `4819f83` (the degraded pass landed, PR #36)

Six packages each carry their own `startRealPostgres`, and three carry their own 22-line
`seedTenant`/`freshNif`. Both duplications have been recorded as deferred since PR #33 with the same
stated cause: `@waitron/db` has no `exports` map, so there is no way to publish a test-only subpath
without either breaking existing deep imports or making `@testcontainers/postgresql` a transitive
dependency of every consumer of the production barrel.

**Half of that cause is not real.** The other half is, and this design resolves it.

The cycle adds one `exports` map, one shared container helper and one shared tenant seed. All 23
`startRealPostgres` call sites keep their exact import line; the 13 seed imports are re-pointed.

---

## 1. Four recorded claims, checked against the code

The [`apps/server` degraded-pass handoff](../../handoffs/2026-07-28-degraded-pass-landed.md) §6 and
the standing follow-up note both priced this work from claims written from memory of a branch rather
than from a re-read of it. Checking them first changed the shape of the cycle — the third cycle
running in which it did.

| Claim | Actual |
| --- | --- |
| An `exports` map "*would break every existing deep import*" of `@waitron/db` | There are **none**. 202 imports, every one `from "@waitron/db"` |
| `startRealPostgres` is duplicated **five** times | **Six** — `apps/server` arrived in PR #35, after the note |
| `test/seed.ts`'s `seedTenant`/`freshNif` is duplicated **three** times | `seedTenant` yes, **three**. `freshNif` is **seven** |
| The barrel is the right home for the seed half, needing no `exports` map | True, but no longer the best one — see §4 |

**The deep-import population is real, just not here.** It lives in three *other* packages:
`@waitron/payments/test/seed.js` (17 importers), `@waitron/fiscal/src/testing/fake-backend.js` (12),
`@waitron/verifactu/src/testing/fake-aeat.js` (7), and
`@waitron/fiscal-verifactu/test/drain-fixtures.js` (1). Adding an `exports` map to any of *those*
would need every importer enumerated. Adding one to `@waitron/db` enumerates nothing, because
nothing reaches past its barrel today. The in-code note at
[`apps/server/src/boot.test.ts`](../../../apps/server/src/boot.test.ts) — "*no `exports` map
restricts either package, so the deep import resolves the same way a same-package one would*" —
stays true for the three packages it is actually about.

**The other four `freshNif` copies** are in
[`packages/core/test/fixtures.ts`](../../../packages/core/test/fixtures.ts),
[`packages/fiscal-verifactu/test/fixtures.ts`](../../../packages/fiscal-verifactu/test/fixtures.ts),
[`packages/fiscal-verifactu/src/testing/seed.ts`](../../../packages/fiscal-verifactu/src/testing/seed.ts)
and [`packages/payments/test/seed.ts`](../../../packages/payments/test/seed.ts). They are entangled
with package-specific fixture graphs (`seedTenantWithSif`, `seedWorkingOrder`) and are **out of
scope** (§7) — but the count matters, because it is what makes §4's NIF base a real decision rather
than a formality.

**What genuinely blocked the container half is the second half of the recorded cause**, and it still
holds: `@waitron/db`'s barrel refuses to re-export anything that pulls
`@testcontainers/postgresql` into the production surface, and
[`src/index.ts`](../../../packages/db/src/index.ts) says so in a comment. A subpath is the only
route. That needs an `exports` map. So the map is the enabler — the note was right about the
mechanism and wrong about the obstacle.

## 2. The exports map

```json
"main": "./src/index.ts",
"exports": {
  ".": "./src/index.ts",
  "./testing/postgres.js": "./src/testing/postgres.ts",
  "./testing/seed.js": "./src/testing/seed.ts"
}
```

`moduleResolution` is `"bundler"` repo-wide ([`tsconfig.base.json`](../../../tsconfig.base.json)),
which honours `exports`; so does Vite, and therefore Vitest. `main` stays for any tool that ignores
`exports` — it costs one line and removes a class of surprise.

**Enumerated, not `"./testing/*"`.** A wildcard would also publish
[`harness.ts`](../../../packages/db/src/testing/harness.ts) — `describeEachTarget` and its Docker
probe, which is `db`-internal and is the very thing the barrel comment refuses to export — and would
give `asAppUser`/`captureError` a second import path alongside the barrel they already ship from.
Two ways to reach one helper is how a convention rots. The cost is one `package.json` line per
future shared helper, which is a deliberate speed bump.

**What the map does not affect.** `CORE_MIGRATIONS` resolves its folder from `import.meta.url`, and
`drizzle-kit` loads `drizzle.config.ts` by filesystem path. Neither goes through module resolution.
The `drizzle/` folder is read as files, never imported.

**Verify the map against all four resolvers in the first task, not the last.** TypeScript and Vite
are the ones the design leans on, but `eslint-import-resolver-typescript` (via
`eslint-plugin-import-x`) and Stryker resolve these specifiers too. All four are expected to honour
`exports`; a resolver that does not would surface as a lint or mutation failure hours after the code
is written, which is the expensive way to find out.

## 3. The shared container helper

New file, [`packages/db/src/testing/postgres.ts`](../../../packages/db/src/testing/postgres.ts):

```ts
export const POSTGRES_IMAGE = "postgres:18-alpine";

/** The subset of StartedPostgreSqlContainer this helper uses — the seam a test fakes. */
export interface StartedContainer {
  getConnectionUri(): string;
  stop(): Promise<void>;
}

export interface RealPostgres {
  /** The container's own URI, owner credentials. */
  uri: string;
  connect(): Promise<Database>;
  connectAs(role: string, password: string): Promise<Database>;
  stop(): Promise<void>;
}

export interface MigratedPostgresOptions {
  /** Why this suite cannot degrade to a skip. Required. */
  dockerRequired: string;
  /** Applies every migration set the suite needs, core first. */
  migrate(uri: string): Promise<void>;
  /** Seam. Defaults to a real Testcontainers Postgres on POSTGRES_IMAGE. */
  start?(): Promise<StartedContainer>;
}

export function roleUrl(uri: string, role: string, password: string): string;
export function runMigrationSets(uri: string, sets: readonly MigrationOptions[]): Promise<void>;
export function startMigratedPostgres(options: MigratedPostgresOptions): Promise<RealPostgres>;
```

`StartedPostgreSqlContainer` does **not** structurally satisfy `StartedContainer`: its
`stop(options?)` returns `Promise<StoppedTestContainer>`, and TypeScript's void-return relaxation
covers `() => T` against `() => void`, not `Promise<T>` against `Promise<void>`. The default `start`
therefore adapts the real container rather than returning it — start it, then return
`{ getConnectionUri: () => c.getConnectionUri(), stop: async () => { await c.stop(); } }`. Stated
here so the plan does not rediscover it as a typecheck failure.

**Migration arrives as a function, not a descriptor list.** Five of the six copies run
`[CORE_MIGRATIONS, OWN_MIGRATIONS]` over one throwaway connection, which is what `runMigrationSets`
is for. `apps/server`'s copy does something categorically different and must keep doing it: it
migrates through the host's **own production path** —
`applyMigrations(uri, migrationOptionsFor(manifestSets(), null))`, advisory lock and manifest
included ([`apps/server/src/migrations.ts`](../../../apps/server/src/migrations.ts)) — so that its
capstone suite exercises the composition the shipped artefact uses. A data-shaped parameter could
not express that; a second parameter shape for the same job would be the smell. One callback covers
both.

**`dockerRequired` is required, not defaulted.** Each of the six messages explains why *that* suite
cannot be skipped, and three of them cite the specific file that documents the reason. A default
would produce a generic message at exactly the moment someone needs the specific one. No test
asserts these strings today; they survive verbatim regardless.

### 3.1 Each package keeps a wrapper

`packages/credentials/src/testing/postgres.ts` becomes:

```ts
import { CORE_MIGRATIONS } from "@waitron/db";
import { runMigrationSets, startMigratedPostgres } from "@waitron/db/testing/postgres.js";
import type { RealPostgres } from "@waitron/db/testing/postgres.js";
import { CREDENTIALS_MIGRATIONS } from "../migrations.js";

export type { RealPostgres };

export function startRealPostgres(): Promise<RealPostgres> {
  return startMigratedPostgres({
    dockerRequired: "The credentials RLS suite requires …",   // verbatim
    migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS]),
  });
}
```

Six wrappers, ~10 lines each, holding the two things that genuinely differ per package. **All 23
call sites across 22 test files keep their exact import line** — `startRealPostgres` and the
`RealPostgres` type still come from `./testing/postgres.js`, and `apps/server`'s `roleUrl` is
re-exported from the wrapper for the same reason. Zero test-file edits is the point: a mechanical
sweep of 22 files is where a behavioural change hides.

The distinct name (`startMigratedPostgres` for the primitive, `startRealPostgres` for each
package's configured entry point) avoids `startRealPostgres as start` aliasing inside every wrapper,
and reads as what it is.

### 3.2 Two latent leaks close on the way

`apps/server`'s copy guards its migration step; the other five do not:

```ts
const migrator = await createPostgresDb(uri);
await runMigrations(migrator, CORE_MIGRATIONS);
await runMigrations(migrator, CREDENTIALS_MIGRATIONS);   // throws →
await migrator.close();                                  // never runs
```

A throw here leaks the migrator's pool **and** leaves the container running with nothing left to
stop it — `startRealPostgres` either returns a complete `RealPostgres` or throws, so the caller's
`afterAll` guard cannot help, and `TESTCONTAINERS_RYUK_DISABLED=true` is mandatory locally, so
there is no reaper backstop either. `runMigrationSets` closes in `finally`; `startMigratedPostgres`
stops the container when `migrate` rejects. Five packages inherit a guard that one of them had.

## 4. The shared tenant seed

New file, `packages/db/src/testing/seed.ts` — `freshNif()` and `seedTenant()`, the 22 lines verbatim
but for the NIF base, which changes deliberately (below). The three copies (`apps/server/test/seed.ts` and `packages/scheduler/test/seed.ts` are
byte-identical; `packages/credentials/test/seed.ts` differs only in its NIF base) are **deleted**,
and their 13 import lines re-pointed to `@waitron/db/testing/seed.js`. No wrapper: unlike the
container helper this takes no per-package configuration, so an indirection would carry nothing.

**Subpath, not the barrel.** The standing note recommends the barrel, on the grounds that
`seedTenant` needs only `drizzle-orm` and `@waitron/shared` — both already dependencies — and would
sit beside `asAppUser`/`captureError`. That reasoning was sound when no subpath existed. It no
longer is: with `./testing/*` published, the honest rule is *the barrel is the production surface,
`./testing/*` is the test surface*, and `seedTenant` is test-only by construction (it writes a row
and bypasses RLS as the connection owner). `asAppUser`/`captureError` stay in the barrel — not for
consistency, but because `pgErrorCode`/`pgErrorMessage` are imported by **production** files
([`packages/core/src/errors.ts`](../../../packages/core/src/errors.ts),
[`packages/fiscal-verifactu/src/chain.ts`](../../../packages/fiscal-verifactu/src/chain.ts)), so the
barrel is where they belong on the same rule.

**New NIF base: `40_000_000`.** The three copies use 20M (`apps/server`, `scheduler`) and 30M
(`credentials`); the four generators that survive this cycle use 10M
(`core`, `payments`, `fiscal-verifactu/src/testing`) and 20M (`fiscal-verifactu/test/fixtures`). 40M
overlaps none of them.

This closes a **latent** collision, and the distinction matters: `apps/server`'s `boot.test.ts`
already imports `seedPendingEnvios` from `@waitron/fiscal-verifactu/test/drain-fixtures.js`, whose
`seedTenantWithSif` mints NIFs from an independent 20M counter, into the same database
`apps/server`'s own 20M `seedTenant` writes to. Both counters start at `20000001K`. Nothing collides
today only because `boot.test.ts` never calls `seedTenant` — the next test that does would fail on
`tenants_nif_key` with no hint as to why. Keeping the shared base off 20M removes the trap for
`apps/server`, `scheduler` and `credentials`; the four out-of-scope generators keep theirs.

## 5. Testing, and the coverage asymmetry nobody recorded

All six consumers exclude `src/testing/**` from coverage. **`@waitron/db` deliberately does not** —
98/98/98/95 across the whole package, and
[`vitest.config.ts`](../../../packages/db/vitest.config.ts) records why: excluding `src/testing`
wholesale once hid the fact that `describeEachTarget`, `postgresTarget` and `migrated` were executed
by no test at all. So moving this helper into `db` puts branches under thresholds that are covered
**nowhere in the repo today** — the Docker-failure `catch` in all six copies, and `apps/server`'s
container-stop-on-migration-failure.

That is a feature, and it is what the `start` seam buys:

| Test | Target | Docker |
| --- | --- | --- |
| Docker-failure path throws `dockerRequired`, `cause` preserved | fake `start` that rejects | no |
| `migrate` rejects → container stopped, error propagates | fake `start`, rejecting `migrate` | no |
| `runMigrationSets` rejects on a bad set, having closed its connection in `finally` | real container, `runIf` | yes |
| `roleUrl` swaps user and password, leaves the rest | pure | no |
| happy path: container → migrated → `connect`/`connectAs` | real container, `describe.runIf(dockerAvailable())` | yes |
| `seedTenant` inserts one tenant, `freshNif` never repeats | `describeEachTarget` | no (PGlite) |

`describe.runIf(dockerAvailable())` is the pattern
[`client.test.ts`](../../../packages/db/src/client.test.ts) and
[`migrate.test.ts`](../../../packages/db/src/migrate.test.ts) already use for their own postgres
blocks, so `db`'s posture is unchanged: a Docker-absent run still completes, loudly. Coverage
thresholds are met in CI, where Docker is present.

The seam mirrors `resolveTargets`, which
[`harness.ts`](../../../packages/db/src/testing/harness.ts) keeps pure "*precisely so the skip
decision is testable without controlling the machine's Docker daemon*". Same idea, one level down.

## 6. Four adjacent cleanups, in scope

**`POSTGRES_IMAGE`.** The image tag is written out in 11 places. Ten are in scope — `db`'s three
(`harness.ts`, `client.test.ts`, `migrate.test.ts`), the six copies (which become the one default in
`startMigratedPostgres`), and `apps/server/src/migrations.concurrency.test.ts`, which starts its own
container directly. `bench/pglite-throughput` keeps its literal: it is a standalone benchmark
harness, not a test suite, and pulling a dependency into it to share a string is a bad trade.

**`CORE_MIGRATIONS` has two definitions.** The barrel exports one (folder via
`fileURLToPath(new URL("../drizzle", …))`); `harness.ts` carries a private second one (folder via
`join(import.meta.dirname, "..", "..", "drizzle")`) under a comment saying it is "*Not exported*"
— which stopped being true when Task 12 added the barrel export. Same folder, same table, two
sources of truth, one stale justification. Extract it to `packages/db/src/migrations.ts`; the barrel
re-exports it and `harness.ts` imports it directly, rather than importing the whole barrel from a
leaf module. Five lines, and it is adjacent code this cycle is already reading.

**Five devDependencies stop being used.** After the sweep, `@testcontainers/postgresql` is imported
by no file in `credentials`, `scheduler`, `payments`, `payments-stripe` or `fiscal-verifactu` — each
one's only importer was the wrapper, which now delegates. It resolves from `@waitron/db`'s own
`node_modules` for the shared helper, so the declaration is dead weight and a false statement about
what the package needs. Drop it from those five. `apps/server` **keeps** it:
`migrations.concurrency.test.ts` starts a container directly. `@waitron/db` keeps it, obviously —
it now owns the only shared use.

**A comment that is already false, and would stay false.**
[`packages/fiscal-verifactu/src/registro-sif.ts`](../../../packages/fiscal-verifactu/src/registro-sif.ts)
says "*This package has no real-Postgres test target — unlike packages/db, it does not depend on
`@testcontainers/postgresql`*". That package has **five** real-Postgres suites and does declare the
dependency; the comment inverted both facts at some point and no test can catch it. Dropping the
declaration above would make one clause accidentally true while the other stayed wrong, which is
worse. Correct the comment in the same commit that touches the declaration — a stale comment
asserting the opposite of the code is this repo's most frequently caught defect, and this cycle
would otherwise walk past one.

## 7. Out of scope

- **The four surviving `freshNif` copies** and the fixture graphs around them.
- **An `exports` map for `@waitron/payments`, `@waitron/fiscal`, `@waitron/verifactu`,
  `@waitron/fiscal-verifactu`** — those have 37 deep importers between them, every one of which
  would need enumerating. A separate decision, on its own evidence.
- **Moving `asAppUser`/`captureError`/`pgErrorCode`/`pgErrorMessage`** out of the barrel — §4.
- **`withAeatTransport`**, the other small item on the standing list. Unrelated; still one call site.

## 8. How we will know it landed

- `pnpm -r typecheck`, `pnpm -r lint`, **`pnpm -r format:check`** (not covered by `lint`; it has
  broken the branch in each of the last two cycles), `pnpm -r test:coverage` all green.
- **`git grep -l "PostgreSqlContainer"` drops from 11 files to 6** — `db`'s new helper, `db`'s
  `harness.ts`, `db`'s `client.test.ts` and `migrate.test.ts` (each starts its own container for its
  own reasons, untouched here), `apps/server`'s `migrations.concurrency.test.ts`, and `bench/`. The
  mechanical check that six copies are gone rather than merely thinned.
- **Every one of the 22 test files that call `startRealPostgres` has an unchanged import line.** A
  diff that touches one of them is a design violation, not a detail.
- The six `dockerRequired` messages appear verbatim in the six wrappers.
- `@waitron/db`'s coverage stays at its thresholds **with the new file included**, and the two
  previously-uncovered failure paths have named tests.
