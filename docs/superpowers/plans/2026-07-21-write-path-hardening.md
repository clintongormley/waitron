# Write-Path Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `tenantId` to `FiscalBackend.checkIntegrity`/`pendingCount` (closing the art. 16.4 unsent-count RLS gap), and dedup the per-sale SIF fetch — the prep PR ("deliverable 0") of the submission design.

**Architecture:** Two changes to the already-landed write path, both touching the `FiscalBackend` interface and the chain layer. (1) `tenantId` becomes an explicit interface parameter, so `checkIntegrity` drops its internal `tenantIdForTill` query and `pendingCount` can set the RLS tenant GUC via `withTenant` — which its current bare-`db` query never does, so under real RLS it silently returns 0. (2) The SIF row (`currentSif`), fetched by `recordSale`/`recordVoid` and again inside `attemptAppend`, is threaded through `appendToChain` as an optional pre-fetched value. The cross-interface head/predecessor dedup from handoff follow-up #1 is deliberately NOT done — it would route chain-ordering state through the generic layer, which the layering forbids (see the design doc §2.2).

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Drizzle ORM, PGlite (in-process Postgres) for unit tests, `@testcontainers/postgresql` (real Postgres) for RLS + concurrency, Vitest, pnpm workspaces.

**Design doc:** [`docs/superpowers/specs/2026-07-21-submission-and-reconciliation-design.md`](../specs/2026-07-21-submission-and-reconciliation-design.md) §2. Regulatory source: [`docs/compliance/verifactu-findings.md`](../../compliance/verifactu-findings.md) §2/§5.4.

## Global Constraints

Every task's requirements implicitly include these (from spec §10 and the landed conventions):

- **Per-test red phase.** Observe every NEW test failing *individually* before writing the implementation that makes it pass. A test that passes before its feature exists is a defect in the test. This is why Task 2 (the RLS proof) exists as its own task: on PGlite the fix is invisible.
- **Real database, never mocked.** PGlite (`createPgliteDb`) for unit tests; `startRealPostgres` (Testcontainers) for anything RLS- or lock-dependent. **PGlite runs as superuser and bypasses RLS unconditionally** — an RLS assertion that does not run as `app_user` on real Postgres is measuring nothing.
- **The chain concept never appears in the generic layer.** `packages/fiscal` and `packages/core` must not gain any parameter, return field, or type that names a chain, a huella, a SIF, or a predecessor. (This is what rules out the larger dedup.)
- **Structured error codes crossing a package boundary** are domain-concept dotted codes (`sale.*`, `chain.*`, `sif.*`), never bare prose (spec §9). A programming-error guard for a structurally-unreachable misuse may be a plain `Error` — matching the existing plain `Error`s in `backend.ts`/`chain.ts` for such cases.
- **Never a production NIF.** Fixtures only.
- **Frequent commits** — one per task step group as marked.
- **CI required status checks** (ruleset 19157474): `static-analysis`, `typecheck`, `test`, `mutation-verifactu`, `mutation-shared`. CI runs `pnpm -r test:coverage` with `REQUIRE_DOCKER=1`, which forces the Testcontainers suites to run and enforces coverage thresholds — **a green local `pnpm test` (pre-push hook) does not mean green CI.** Run `REQUIRE_DOCKER=1 pnpm -r test:coverage` before opening the PR.

## File Structure

**Task 1 — `tenantId` on the interface (mechanical ripple):**
- Modify `packages/fiscal/src/backend.ts` — the two interface signatures + their JSDoc.
- Modify `packages/fiscal/src/testing/fake-backend.ts` — the fake's two impls.
- Modify `packages/fiscal/src/testing/fake-backend.test.ts` — the fake's call sites.
- Modify `packages/fiscal-verifactu/src/backend.ts` — `checkIntegrity` (drop `tenantIdForTill`), `pendingCount` (accept `tenantId`, add explicit tenant filter), remove the `tenantIdForTill` method and the now-unused `tills` import.
- Modify `packages/fiscal-verifactu/src/backend.test.ts` — `checkIntegrity`/`pendingCount` call sites.
- Modify `packages/core/src/record-sale.ts` (line 155) and `packages/core/src/record-void.ts` (line 59) — the two production callers.
- Modify `packages/core/src/record-sale.test.ts` and `packages/core/src/record-void.test.ts` — the inline `FiscalBackend` mocks.

**Task 2 — `pendingCount` RLS proof (real Postgres):**
- Modify `packages/fiscal-verifactu/src/backend.ts` — wrap `pendingCount`'s query in `withTenant`.
- Modify `packages/fiscal-verifactu/src/testing/postgres.ts` — add `connectAs(role, password)` to `RealPostgres`.
- Create `packages/fiscal-verifactu/src/pending-count.rls.test.ts` — the real-Postgres, app_user-role proof.

**Task 3 — within-module SIF dedup:**
- Modify `packages/fiscal-verifactu/src/chain.ts` — optional `sif` param on `appendToChain`/`attemptAppend` + a match guard.
- Modify `packages/fiscal-verifactu/src/backend.ts` — `recordSale`/`recordVoid` pass their already-fetched `sif`.
- Modify `packages/fiscal-verifactu/src/chain.test.ts` — a behavioral test (explicit sif used) + a guard test.
- Re-run `packages/fiscal-verifactu/src/chain.concurrency.test.ts` (unchanged) to re-verify the retry loop.

---

### Task 1: `tenantId` on `FiscalBackend.checkIntegrity` and `pendingCount`

Adds `tenantId` as an explicit parameter to both methods across the interface, both implementations, and every caller and test. `pendingCount` gains an explicit `e.tenant_id` filter here (defense-in-depth, and it makes the new param load-bearing on PGlite); the `withTenant` RLS wrapping is Task 2. `checkIntegrity` drops its internal `tenantIdForTill` round trip.

**Interfaces:**
- Produces: `checkIntegrity(tx: Transaction, tenantId: TenantId, tillId: TillId): Promise<IntegrityReport>` and `pendingCount(tenantId: TenantId, tillId: TillId): Promise<number>` on `FiscalBackend`.
- Consumes: `TenantId`, `TillId` (`@waitron/shared`); `verifyChain(tx, tenantId, tillId)` (`./verify.js`, unchanged).

- [ ] **Step 1: Update the two interface signatures + JSDoc**

In `packages/fiscal/src/backend.ts`, replace the two method declarations (lines 144 and 152). `TenantId` is already imported (line 10).

```typescript
  /**
   * Whatever this backend must check about what it has already recorded, before recording
   * anything more. `tenantId` is passed explicitly — the caller is always inside a tenant-scoped
   * transaction and already holds it, so the backend need not re-derive it. The caller records the
   * report and surfaces it to staff; it must NEVER branch on `ok` to abandon the sale. No fiscal
   * condition blocks a sale (spec §4), and a backend whose regime has nothing to check answers
   * `{ ok: true, checked: 0, issues: [] }`.
   */
  checkIntegrity(tx: Transaction, tenantId: TenantId, tillId: TillId): Promise<IntegrityReport>;

  /**
   * How many records this till has not yet had confirmed. The UI reads this, never the module's
   * own tables. Takes `tenantId` and NO transaction: the unsent-count read happens outside any
   * sale transaction, and the backend needs the tenant to establish the row-level-security scope
   * itself (art. 16.4 — a query with no tenant scope silently counts zero under RLS).
   */
  pendingCount(tenantId: TenantId, tillId: TillId): Promise<number>;
```

- [ ] **Step 2: Update the `FakeFiscalBackend` implementations**

In `packages/fiscal/src/testing/fake-backend.ts`, change `checkIntegrity` (line 183) and `pendingCount` (line 195) to accept `tenantId` and filter on it (the fake tables carry `tenant_id`; this keeps the param load-bearing and the fake honest). Import `TenantId` — the file already imports `SaleId, TillId` from `@waitron/shared` (line 3), so extend that to `import type { SaleId, TenantId, TillId } from "@waitron/shared";`.

```typescript
  async checkIntegrity(
    tx: Transaction,
    tenantId: TenantId,
    tillId: TillId,
  ): Promise<IntegrityReport> {
    const rows = await tx.execute<{ count: string }>(sql`
      select count(*)::text as count from fake_fiscal_records
      where tenant_id = ${tenantId} and till_id = ${tillId}
    `);
    const checked = Number(rows.rows[0].count);
    const issues = this.injectedIssues.get(tillId) ?? [];
    return { ok: issues.length === 0, checked, issues };
  }

  async pendingCount(tenantId: TenantId, tillId: TillId): Promise<number> {
    const rows = await this.db.execute<{ count: string }>(sql`
      select count(*)::text as count
      from fake_fiscal_records
      where tenant_id = ${tenantId} and till_id = ${tillId} and state = 'pending'
    `);
    return Number(rows.rows[0].count);
  }
```

- [ ] **Step 3: Update the fake's tests to pass `TENANT`**

In `packages/fiscal/src/testing/fake-backend.test.ts`, every `backend.checkIntegrity(tx, TILL_A)` becomes `backend.checkIntegrity(tx, TENANT, TILL_A)` and every `backend.pendingCount(TILL_x)` becomes `backend.pendingCount(TENANT, TILL_x)`. The `TENANT` constant already exists (line 8). Exact sites:
  - `checkIntegrity`: lines 136, 143, 150, 170 — insert `TENANT,` before the till.
  - `pendingCount`: lines 180 (`TILL_A`), 189 (`TILL_A`), 195 (`TILL_B`), 199 (`TILL_A`) — insert `TENANT,` before the till.

- [ ] **Step 4: Run the fake's tests to verify they pass**

Run: `pnpm --filter @waitron/fiscal test`
Expected: PASS. (This is a pure signature+filter change against superuser PGlite; the counts are unchanged because each till belongs to `TENANT`.)

- [ ] **Step 5: Update the real backend's `checkIntegrity` and `pendingCount`**

In `packages/fiscal-verifactu/src/backend.ts`:

Replace `checkIntegrity` (lines 340-349) — it now receives `tenantId` and no longer calls `tenantIdForTill`:

```typescript
  /**
   * Delegates to `verifyChain` (art. 7.i). `tenantId` is supplied by the caller (always inside a
   * `withTenant`-scoped transaction), so there is no `tenants`/`tills` lookup to recover it.
   */
  async checkIntegrity(
    tx: Transaction,
    tenantId: TenantId,
    tillId: TillId,
  ): Promise<IntegrityReport> {
    return verifyChain(tx, tenantId, tillId);
  }
```

Replace `pendingCount` (lines 351-373) — accept `tenantId`, add the explicit `e.tenant_id` filter. **Do NOT add `withTenant` yet — that is Task 2, driven by its own failing real-Postgres test.**

```typescript
  /**
   * How many of this till's records AEAT has not yet confirmed — the art. 16.4 unsent count.
   *
   * Filters on `tenant_id` explicitly (defense-in-depth alongside the RLS policy). Task 2 wraps
   * this query in `withTenant` so the tenant GUC is set; until then this still counts correctly on
   * PGlite (superuser bypasses RLS), which is exactly why the RLS behaviour needs a real-Postgres
   * test rather than a PGlite one.
   */
  async pendingCount(tenantId: TenantId, tillId: TillId): Promise<number> {
    const rows = await this.db.execute<{ count: string }>(sql`
      select count(*)::text as count
      from envios e
      join registros_facturacion r on r.id = e.registro_id
      where r.till_id = ${tillId} and e.tenant_id = ${tenantId} and e.estado = 'pendiente'
    `);
    return Number(rows.rows[0]!.count);
  }
```

Then delete the now-unused `tenantIdForTill` method (lines 405-419), and remove `tills` from the `@waitron/db` import on line 2 (it was used only by `tenantIdForTill`; `tenants` stays, used by `legalNameFor`):

```typescript
import { eq, sql } from "drizzle-orm";
import { tenants } from "@waitron/db";
```

- [ ] **Step 6: Update the real backend's tests to pass `tenantId`**

In `packages/fiscal-verifactu/src/backend.test.ts`, update the call sites (the `tenantId` variable is already in scope, line 35):
  - line 239: `backend.checkIntegrity(tx, tenantId, tillId)`
  - line 245: `backend.checkIntegrity(tx, tenantId, tillId)`
  - line 253: `backend.pendingCount(tenantId, tillId)`
  - line 259: `backend.pendingCount(other.tenantId, other.tillId)` — `seedTenantWithSif` returns its own `tenantId`; destructure it: `const other = await seedTenantWithSif(db);` already gives `other.tenantId` and `other.tillId`.
  - line 265: `backend.pendingCount(tenantId, tillId)`

- [ ] **Step 7: Update the two production callers**

In `packages/core/src/record-sale.ts` line 155 — `input.tenantId` is in scope:

```typescript
  const verification = await backend.checkIntegrity(tx, input.tenantId, input.tillId);
```

In `packages/core/src/record-void.ts` line 59 — `sale.tenantId` is selected at line 37, and `TenantId` is imported (line 10):

```typescript
  const verification = await backend.checkIntegrity(
    tx,
    sale.tenantId as TenantId,
    sale.tillId as TillId,
  );
```

- [ ] **Step 8: Update the inline `FiscalBackend` mocks in core tests**

In `packages/core/src/record-sale.test.ts`:
  - `wrapBackend` (lines 195-196):
    ```typescript
    checkIntegrity: (tx, tenant, till) => fake.checkIntegrity(tx, tenant, till),
    pendingCount: (tenant, till) => fake.pendingCount(tenant, till),
    ```
  - the inline override (lines 325, 334): change the signature to `async checkIntegrity(tx, tenant, till) {` and the delegation to `return fake.checkIntegrity(tx, tenant, till);`.

In `packages/core/src/record-void.test.ts`:
  - the `wrapBackend`-style literal (lines 148-149): same transform as above.
  - the `pendingCount: () => {...}` override (line 337): change to `pendingCount: (_tenant, _till) => {...}` (the body ignores its args; prefix with `_` so `noUnusedParameters` is satisfied).
  - the inline `async checkIntegrity(tx, till) {...}` override (lines 436-438): change to `async checkIntegrity(tx, tenant, till) {` and `return fake.checkIntegrity(tx, tenant, till);`.

- [ ] **Step 9: Confirm `incidents.test.ts` needs no change**

Run: `grep -n "checkIntegrity\|pendingCount" packages/core/src/incidents.test.ts`
Expected: only comment lines (129, 194), no direct call. If a direct call surfaces, apply the same `tenant,`-insertion transform. (This step is a verification, not an edit.)

- [ ] **Step 10: Typecheck and run the affected suites**

Run: `pnpm --filter @waitron/fiscal --filter @waitron/fiscal-verifactu --filter @waitron/core typecheck && pnpm --filter @waitron/fiscal --filter @waitron/fiscal-verifactu --filter @waitron/core test`
Expected: PASS across all three packages. (No behaviour changed on PGlite; the RLS behaviour is unproven until Task 2.)

- [ ] **Step 11: Commit**

```bash
git add packages/fiscal packages/fiscal-verifactu packages/core
git commit -m "refactor: thread tenantId through FiscalBackend.checkIntegrity/pendingCount"
```

---

### Task 2: Prove and fix `pendingCount` under real row-level security

TDD the actual compliance fix. On real Postgres, a role subject to RLS with **no** `app.tenant_id` GUC counts zero — so `pendingCount` must set the GUC via `withTenant`. This cannot be shown on PGlite (superuser bypasses RLS), so it needs a real-Postgres test running as a non-superuser member of `app_user`. The harness gains a `connectAs` so the test can hold such a connection across `pendingCount`'s own internal transaction.

**Interfaces:**
- Consumes: `withTenant(db, tenantId, fn)` (`@waitron/db`); `startRealPostgres()` → `RealPostgres` (`./testing/postgres.js`); `seedTill` (`./testing/seed.js`); `appendToChain` (`./chain.js`); `envios` (`./schema/envios.js`).
- Produces: `RealPostgres.connectAs(role: string, password: string): Promise<Database>`.

- [ ] **Step 1: Add `connectAs` to the real-Postgres harness**

In `packages/fiscal-verifactu/src/testing/postgres.ts`, extend the interface and the returned object so a test can connect as a role other than the container superuser. The container URI is captured in `startRealPostgres`; swap its credentials with `URL`.

Add to the `RealPostgres` interface (after `connect()`):

```typescript
  /**
   * A fresh Database authenticated as `role` (which the caller must already have created). Used by
   * RLS tests that need queries to run as a non-superuser member of `app_user` — the container's
   * default user is a superuser and bypasses RLS, so `connect()` cannot exercise a policy.
   */
  connectAs(role: string, password: string): Promise<Database>;
```

And in the returned object (alongside `connect`/`stop`):

```typescript
    connectAs: (role, password) => {
      const u = new URL(uri);
      u.username = role;
      u.password = password;
      return createPostgresDb(u.toString());
    },
```

- [ ] **Step 2: Write the failing RLS test**

Create `packages/fiscal-verifactu/src/pending-count.rls.test.ts`. It seeds a pending `envios` row as the superuser, creates a login role that inherits `app_user` (so it is a non-superuser subject to RLS), and asserts `pendingCount` — run through a `VerifactuBackend` whose `db` is that role's connection — returns the seeded count.

```typescript
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@waitron/db";
import { VerifactuBackend } from "./backend.js";
import { appendToChain } from "./chain.js";
import { envios } from "./schema/envios.js";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";
import { altaFor, seedSale, seedTill, type SeededTill } from "./testing/seed.js";
import { steadyClock } from "../test/write-path-fixtures.js";

// A non-superuser LOGIN role that inherits app_user's grants. Being non-superuser is what makes RLS
// apply to it (a superuser bypasses FORCE ROW LEVEL SECURITY); the app_user membership is what lets
// it SELECT envios/registros_facturacion at all. current_tenant_id() then reads app.tenant_id, so
// with no GUC set the tenant-isolation policy matches zero rows.
const PROBE_ROLE = "rls_probe";
const PROBE_PASSWORD = "probe";

let pg: RealPostgres;
let admin: Database;

beforeAll(async () => {
  pg = await startRealPostgres();
  admin = await pg.connect();
  await admin.execute(
    sql.raw(`create role ${PROBE_ROLE} login password '${PROBE_PASSWORD}' in role app_user`),
  );
});

afterAll(async () => {
  await admin.close();
  await pg.stop();
});

describe("pendingCount under real row-level security", () => {
  it("counts the tenant's pending records when run as an RLS-subject role", async () => {
    const till: SeededTill = await seedTill(admin, "A");
    // Seed one pending envios row for this tenant, all as the superuser (which bypasses RLS).
    // seedTill returns { tenantId, tillId, seriesId, sifId } — no saleId, so seedSale mints one.
    const saleId = await seedSale(admin, till, 1);
    const appended = await admin.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.tillId, altaFor(saleId, 1, 1)),
    );
    await admin.insert(envios).values({ registroId: appended.id, tenantId: till.tenantId });

    // Run pendingCount as rls_probe: a non-superuser, so the tenant-isolation policy is enforced.
    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const backend = new VerifactuBackend({ clock: steadyClock, db: probe });
      // Fix under test: withTenant sets app.tenant_id, so current_tenant_id() matches this tenant's
      // rows. Without it the policy sees NULL and returns 0 — the bug this test exists to catch.
      expect(await backend.pendingCount(till.tenantId, till.tillId)).toBe(1);
    } finally {
      await probe.close();
    }
  });
});
```

- [ ] **Step 3: Run the test and watch it FAIL (the teeth check)**

With `pendingCount` still un-wrapped (Task 1 state), run:

Run: `REQUIRE_DOCKER=1 pnpm --filter @waitron/fiscal-verifactu test pending-count.rls`
Expected: **FAIL** — `expected 0 to be 1`. This is the load-bearing red phase: it proves the test can actually detect the missing tenant scope. If it PASSES here, the test has no teeth (the probe role is not subject to RLS — check it is non-superuser and that `FORCE ROW LEVEL SECURITY` is on `envios`) and must be fixed before proceeding.

- [ ] **Step 4: Apply the fix — wrap `pendingCount` in `withTenant`**

In `packages/fiscal-verifactu/src/backend.ts`, add `withTenant` to the `@waitron/db` import:

```typescript
import { tenants, withTenant } from "@waitron/db";
```

and wrap the query (replacing the Task-1 body):

```typescript
  async pendingCount(tenantId: TenantId, tillId: TillId): Promise<number> {
    // withTenant sets app.tenant_id (transaction-local) so current_tenant_id() resolves and the
    // RLS tenant-isolation policy matches this tenant's rows. Without it, a non-superuser
    // deployment role sees NULL and counts zero — the art. 16.4 gap. On PGlite (superuser) the GUC
    // is set but irrelevant; the count is correct either way, which is why only real Postgres
    // proves this.
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.execute<{ count: string }>(sql`
        select count(*)::text as count
        from envios e
        join registros_facturacion r on r.id = e.registro_id
        where r.till_id = ${tillId} and e.tenant_id = ${tenantId} and e.estado = 'pendiente'
      `);
      return Number(rows.rows[0]!.count);
    });
  }
```

- [ ] **Step 5: Run the RLS test and watch it PASS**

Run: `REQUIRE_DOCKER=1 pnpm --filter @waitron/fiscal-verifactu test pending-count.rls`
Expected: **PASS**.

- [ ] **Step 6: Re-run the PGlite backend suite (no regression)**

Run: `pnpm --filter @waitron/fiscal-verifactu test backend`
Expected: PASS — the `pendingCount` tests from Task 1 still pass (the `withTenant` wrapper is transparent on superuser PGlite).

- [ ] **Step 7: Commit**

```bash
git add packages/fiscal-verifactu/src/backend.ts packages/fiscal-verifactu/src/testing/postgres.ts packages/fiscal-verifactu/src/pending-count.rls.test.ts
git commit -m "fix: pendingCount sets the tenant GUC so it counts under RLS (art. 16.4)"
```

---

### Task 3: Dedup the per-sale SIF fetch

`recordSale`/`recordVoid` fetch the SIF via `currentSif` to build the registro input; `attemptAppend` then fetches it again for `sifId`. Thread the already-fetched `SifRegistration` into `appendToChain` as an **optional** parameter so the second fetch is skipped. Optional keeps every existing `appendToChain` test (which passes no sif) working unchanged. A match guard protects the one correctness risk: a caller passing a sif for a different (tenant, till).

**Interfaces:**
- Consumes: `SifRegistration` (`./registro-sif.js`); `currentSif(tx, tenantId, tillId)` (`./registro-sif.js`, still the fallback).
- Produces: `appendToChain(tx, tenantId, tillId, registro, sif?)` and `attemptAppend(tx, tenantId, tillId, registro, sif?)` — the trailing `sif?: SifRegistration` is a pre-fetched hint; omitted, it is fetched under the lock as before.

- [ ] **Step 1: Write the guard test**

In `packages/fiscal-verifactu/src/chain.test.ts`, add a test that a SIF for a different till is rejected — the one genuine correctness risk of the dedup, and the driver for this task. Add `import { currentSif } from "./registro-sif.js";` at the top (the seed helpers `altaFor`/`seedSale`/`seedTill` and `sql` are already imported). The suite binds `db` and `till` (from `seedTill(db)` in `beforeEach`) but no second till, so a fabricated UUID stands in for another till.

```typescript
describe("appendToChain — pre-fetched SIF", () => {
  it("rejects a SIF that belongs to a different till", async () => {
    const saleId = await seedSale(db, till, 1);
    await expect(
      db.transaction(async (tx) => {
        const sif = await currentSif(tx, till.tenantId, till.tillId);
        // A sif whose tillId does not match the (tenant, till) being appended to — a caller bug the
        // dedup must never silently mis-attribute. A fabricated UUID stands in for another till.
        const wrongSif = {
          ...sif,
          tillId: "ffffffff-0000-4000-8000-000000000000" as typeof sif.tillId,
        };
        return appendToChain(tx, till.tenantId, till.tillId, altaFor(saleId, 1, 1), wrongSif);
      }),
    ).rejects.toThrow(/SIF/i);
  });
});
```

The threaded-sif *happy* path (a matching sif produces a correct record) is not a new test: `write-path.e2e.test.ts` and `void-path.e2e.test.ts` already drive `recordSale`/`recordVoid` end to end, and Step 5 routes both through the new `sif` argument — so those suites, plus the concurrency suite (Step 7), verify the threaded path produces correct chained records. The saved fetch itself is structural (the diff skips `currentSif` when a sif is supplied), the same way `registro-sif.ts` documents a property a test cannot cheaply assert.

- [ ] **Step 2: Run the guard test and watch it FAIL**

Run: `pnpm --filter @waitron/fiscal-verifactu test chain.test`
Expected: FAIL — the `sif` argument is ignored (the parameter does not exist yet), so `appendToChain` fetches the correct SIF internally, the append SUCCEEDS, and `rejects.toThrow(/SIF/i)` fails because nothing threw. That failing assertion is the genuine red phase. (`tsc` additionally flags the 5th argument until Step 3; vitest/esbuild runs the test regardless.)

- [ ] **Step 3: Add the optional `sif` parameter + guard to `chain.ts`**

In `packages/fiscal-verifactu/src/chain.ts`, import the type:

```typescript
import { currentSif } from "./registro-sif.js";
import type { SifRegistration } from "./registro-sif.js";
```

Change `attemptAppend` (line 137) to accept and prefer a passed sif, with the match guard:

```typescript
async function attemptAppend(
  tx: Transaction,
  tenantId: TenantId,
  tillId: TillId,
  registro: PendingRegistro,
  sif?: SifRegistration,
): Promise<{ id: string; secuencia: number; huella: string }> {
  const head = await lockChainHead(tx, tenantId, tillId);
  // A caller that already fetched the SIF (recordSale/recordVoid) threads it in to avoid a second
  // currentSif round trip. It is stable across the append retry loop — SIF identity does not change
  // mid-append — so it is reused on every attempt. Guarded because a sif for a different (tenant,
  // till) would silently mis-attribute the record's sif_id: a programming error, so a plain Error.
  let resolvedSif: SifRegistration;
  if (sif !== undefined) {
    if (sif.tenantId !== tenantId || sif.tillId !== tillId) {
      throw new Error(
        `appendToChain: supplied SIF is for (${sif.tenantId}, ${sif.tillId}), not (${tenantId}, ${tillId})`,
      );
    }
    resolvedSif = sif;
  } else {
    resolvedSif = await currentSif(tx, tenantId, tillId);
  }
  const secuencia = head.secuencia + 1;
```

Then replace the later `sif` references: the line `const sif = await currentSif(tx, tenantId, tillId);` (line 148) is now removed (folded into the block above), and `sifId: sif.id` (line 185) becomes `sifId: resolvedSif.id`.

Change `appendToChain` (line 230) to accept and forward the optional sif:

```typescript
export async function appendToChain(
  tx: Transaction,
  tenantId: TenantId,
  tillId: TillId,
  registro: PendingRegistro,
  sif?: SifRegistration,
): Promise<{ id: string; secuencia: number; huella: string }> {
  for (let attempt = 1; attempt <= MAX_APPEND_ATTEMPTS; attempt++) {
    try {
      return await tx.transaction((nested) =>
        attemptAppend(nested, tenantId, tillId, registro, sif),
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new AppError("chain.append_contention", {
    tenantId,
    tillId,
    attempts: MAX_APPEND_ATTEMPTS,
  });
}
```

- [ ] **Step 4: Run the guard test and watch it PASS**

Run: `pnpm --filter @waitron/fiscal-verifactu test chain.test`
Expected: PASS — the mismatched sif now throws; typecheck is clean.

- [ ] **Step 5: Thread the pre-fetched SIF from the backend**

In `packages/fiscal-verifactu/src/backend.ts`, pass the already-fetched `sif` as the 5th argument at both call sites.

`recordSale` (line 206) — `sif` is fetched at line 171:

```typescript
    const appended = await appendToChain(
      tx,
      sale.tenantId,
      sale.tillId,
      { tipo: "alta", saleId: sale.saleId, input },
      sif,
    );
```

`recordVoid` (line 323) — `sif` is fetched at line 283:

```typescript
    const appended = await appendToChain(
      tx,
      tenantId,
      tillId,
      { tipo: "anulacion", saleId, input },
      sif,
    );
```

- [ ] **Step 6: Run the full fiscal-verifactu PGlite suite**

Run: `pnpm --filter @waitron/fiscal-verifactu test`
Expected: PASS (excluding the Docker-gated suites, which run in Step 7). The write-path and void-path e2e tests exercise the threaded-sif path end to end.

- [ ] **Step 7: Re-verify the concurrency suite on real Postgres**

The dedup changes `attemptAppend`'s signature, which the retry/savepoint loop drives — the whole reason this is a concurrency-sensitive change. Run the real-Postgres contention suite unchanged:

Run: `REQUIRE_DOCKER=1 pnpm --filter @waitron/fiscal-verifactu test chain.concurrency`
Expected: PASS — including the load-bearing "runs its writers on distinct backend processes" assertion. If Docker is unavailable it throws loudly (by design); it must not be skipped.

- [ ] **Step 8: Commit**

```bash
git add packages/fiscal-verifactu/src/chain.ts packages/fiscal-verifactu/src/backend.ts packages/fiscal-verifactu/src/chain.test.ts
git commit -m "perf: thread the pre-fetched SIF into appendToChain, skipping a duplicate fetch"
```

---

### Final verification (before opening the PR)

- [ ] **Run the full gate as CI runs it**

Run: `REQUIRE_DOCKER=1 pnpm -r test:coverage && pnpm -r typecheck && pnpm lint`
Expected: PASS everywhere, coverage thresholds met. A green pre-push hook (`pnpm test`) is NOT sufficient — CI forces the Testcontainers suites and coverage.

- [ ] **Confirm the layering guard still holds**

Run: `pnpm --filter @waitron/fiscal test no-regime-vocabulary`
Expected: PASS — no chain/SIF vocabulary leaked into the generic layer (the interface gained only `tenantId`, a generic concept).

## Self-Review

Checked against design doc §2 (the two prep-PR changes) and §5 (the interface-change table):

- **Spec coverage:** §2.1 `tenantId` on `checkIntegrity`+`pendingCount` → Task 1 (signatures/callers/tests) + Task 2 (the RLS fix `withTenant` gives it teeth). §2.2 within-module SIF dedup + concurrency re-verify → Task 3. §2.3 `formatAmountExact` is explicitly its own PR (out of scope here). The interface-table deltas in §5 (`checkIntegrity(tx, tenantId, tillId)`, `pendingCount(tenantId, tillId)`) match Task 1 Step 1.
- **Placeholders:** none. Fixture shapes were verified against `seed.ts`/schema and inlined — `SeededTill = { tenantId, tillId, seriesId, sifId }` (no `saleId`, so `seedSale(db, till, n)` mints one), `altaFor(saleId, invoiceNumber, index)`, `registros_facturacion.sif_id` — with no "confirm against X" notes left.
- **Type consistency:** `checkIntegrity(tx, tenantId, tillId)` / `pendingCount(tenantId, tillId)` used identically in interface, fake, real backend, and every caller. `appendToChain(..., sif?)` / `attemptAppend(..., sif?)` with `SifRegistration` used consistently; `resolvedSif` replaces the removed local `sif` in `attemptAppend`. `withTenant`/`connectAs`/`SifRegistration`/`TenantId` imports named at each use site.
- **Layering:** no chain/SIF concept added to `packages/fiscal` or `packages/core` — only `tenantId`. Guarded by the final verification step.
