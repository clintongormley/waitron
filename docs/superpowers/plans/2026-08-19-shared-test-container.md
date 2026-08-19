# Shared test container + template-DB clones — plan

**Goal.** Cut the real-PostgreSQL test tier's wall-clock. Today every real-PG test **file** boots its own
container and migrates it: measured 2026-08-19 on `postgres:18-alpine`, that is **1118ms boot + 387ms
migration ≈ 1.5s of fixed setup per file**, ~130 files across 19 packages. On CI's Docker-in-VM the
boot is far slower, which is why apps/server is 458s of test-light's 509s (run 32177773446), and why
`packages/db` is ~406s. Replace per-file boot+migrate with **one shared container + a migrated template
per migration-set, then `CREATE DATABASE … TEMPLATE` per suite** (measured **~26ms/clone**).

This does NOT drop `singleFork`: the coverage-v8 cross-fork branch-merge bug is NOT fixed on 3.2.7 — it
reproduces under `pnpm -r` oversubscription (payments 82% branches in the whole-workspace run, 100%
isolated; the pre-push hook caught it 2026-08-19). Keeping the container work off the hot path is the
speedup; fork count stays 1.

## Why this is delicate (from the 2026-08-19 consumer survey)

- **5 consumption patterns**, ~130 files: `useRealPostgres`+wrapper (most), `useRealPostgres`+inline
  `startMigratedPostgres` (db 12, sync 7, apps/server 3, layouts 1), `describeEachTarget` (db 16, dual
  PGlite+real, **fresh DB per test**), raw `new PostgreSqlContainer` (db `client`/`migrate`, migrations
  `apply.concurrency`), and provisioning's own hooks (3).
- **11 distinct migration-set templates** — and the two full-manifest paths are NOT interchangeable
  (apps/server's advisory-lock `applyMigrations` vs sync's bare `runMigrationSets`).
- **Two isolation contracts**: `useRealPostgres` shares one DB per file and self-isolates via fresh
  tenant IDs (append-only / TRUNCATE-blocking triggers make reset impossible — do NOT try to wipe);
  `describeEachTarget` + provisioning need a fresh **database per test**.
- **Role collisions are the crux.** A shared container = one cluster. Migrations already create
  cluster-global roles (`app_user`) idempotently — `describeEachTarget` requires it (harness.ts:26-42).
  But the harness's `probeRole` (fixed name `app_user_probe`, ~35 files) and the `setup` callbacks (sync
  roles, ~9 files) create roles NON-idempotently → `role already exists` on the 2nd file. Fix: create
  those cluster roles idempotently / once.
- **6 special cases stay per-container** (must NOT be converted): db `client.test.ts`, `migrate.test.ts`,
  `testing/postgres.test.ts`, migrations `apply.concurrency.test.ts` (test the primitives themselves);
  the 3 provisioning `*.rls.test.ts` and apps/server `scripts/dev-setup.test.ts` (the code under test IS
  the migrator — a pre-migrated template defeats the suite; keep bare/per-container).

## Mechanism

Cross-file container sharing REQUIRES `globalSetup` — vitest's default `isolate: true` gives each file a
fresh module context, so a module-level singleton is re-created per file (no sharing).

1. **`setupSharedContainer(options)`** (new, in `@waitron/db/testing`), used from a per-package
   `globalSetup`: boot ONE container; migrate a **named template per distinct migration-set** the package
   uses; create the package's extra cluster roles **idempotently** (`DO $$ … EXCEPTION WHEN
   duplicate_object`); `provide('sharedPg', { uri, templates })`. Return the teardown (globalSetup's
   return value = globalTeardown) that stops the container.
2. **`useTemplateDb(options)`** (new): the shared-container analogue of `useRealPostgres`, SAME returned
   shape `{ pg, admin }`. `beforeAll`: read injected `{ uri, templates }`; `CREATE DATABASE
   clone_<unique> TEMPLATE <template[name]>`; connect admin; `setup`. `afterAll`: close, `DROP DATABASE`
   the clone. `probeRole` handled once at container setup (idempotent), not per file. Clone name unique
   per worker+counter (multi-fork safe).
3. **`describeEachTarget`**: its postgres `create()` becomes `CREATE DATABASE … TEMPLATE` instead of
   `create database` + migrate — keeps fresh-DB-per-test, drops the per-test migration.

`RealPostgres` interface unchanged (`uri`/`connect`/`connectAs`/`stop`), so `asAppUser` (297 calls) and
`connectAs` (~90 calls) are untouched; `stop()` drops the clone instead of the container.

## Phases (one PR each)

- **P1 — foundation + apps/server (this PR).** Build `setupSharedContainer` + `useTemplateDb` +
  idempotent role creation (TDD, against a real container). Convert apps/server's 24 real-PG files (21
  wrapper + 3 inline; NOT `dev-setup.test.ts`). apps/server needs 3 templates (full-manifest, CORE+
  IDENTITY, CORE) + roles (`app_user_probe`, RUNTIME role, sync roles). Verify every suite + the RLS /
  concurrency / cross-till guards pass, coverage clears 98/95, and **measure test-server's CI drop**.
- **P2..Pn — roll out per package** against the proven pattern: db (`describeEachTarget` + 12 inline),
  then fiscal-verifactu, payments, workforce, sync, identity, reporting, payments-stripe, core,
  scheduler, recipes, catalogue, credentials, purchasing, layouts, workforce-es. Each PR: add
  globalSetup with its template set(s), convert its files, verify its suites + guards + coverage.

## Verification per phase

- Every converted suite passes unfiltered (`pnpm --filter <pkg> test:coverage`).
- The cross-package guards still hold: `fiscal-verifactu` inmutabilidad (FORCE RLS scan), tenant
  isolation, concurrency suites (distinct backends — `connectAs` must still give separate backend
  processes so the `app.tenant_id` GUC cannot leak between seed and probe).
- Coverage thresholds unchanged.
- Measure: read the package's shard duration off a real CI run before declaring the win.

## Rollback

Each phase is independent; a package can stay on `useRealPostgres` (per-file boot) while others move.
The special-case files never move.
