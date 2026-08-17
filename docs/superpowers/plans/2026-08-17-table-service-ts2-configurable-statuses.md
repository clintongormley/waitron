# Table Service TS-2 (Configurable Service Statuses) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Layer a small, venue-configured **manual** service status (e.g. "Bill requested", "Needs cleaning") on top of TS-1's derived table occupancy — a configurable status set, one status per table, a `setTableStatus` verb, reset-on-turnover via a DB trigger, and the status folded into the floor-plan read — headless + a dashboard config editor, SUPERVISED (owner in the loop).

**Architecture:** A new tenant-scoped `table_service_statuses` config table (`packages/db`) plus a single nullable `dining_tables.status_id` (composite-FK) column. Config CRUD (`createStatus`/`listStatuses`/`updateStatus`/`deactivateStatus`) and the operational `setTableStatus` verb live in `apps/server/src/tables.ts` beside TS-1's table CRUD; the config CRUD reuses the `till.configure` permission via `authorizeManager` (dashboard/management session), while `setTableStatus` is gated by the operator **session** (`requireSession`). Reset-on-turnover is two **non-fiscal** writes that leave `payWorkingOrder`/`recordSale` byte-unchanged: an AFTER-UPDATE trigger on `working_orders` that clears `status_id` on every table a settling/abandoning tab covered (keyed on the TS-1 `dining_tables.tab_id` back-pointer), and an `openTab` line that clears a stale status as a new tab opens. The status folds into TS-1's `listTablesWithState` as a LEFT JOIN. A dashboard config editor mirrors the #81 layout/receipt editors.

**Tech Stack:** TypeScript (ESM, Node), Drizzle ORM + drizzle-kit (PostgreSQL 18), Hono HTTP, Vitest, PGlite (hermetic) + Testcontainers (real Postgres for RLS/trigger/authorize), pnpm workspace; the dashboard is a browser TS app (happy-dom + a11y tests).

**Spec:** docs/superpowers/specs/2026-08-17-table-service-ts2-configurable-statuses-design.md

**Depends on:** TS-1 landed (dining_tables incl. tab_id, tables.ts, openTab, listTablesWithState). **TS-2 executes AFTER TS-1 has landed.** Items TS-2 consumes from TS-1 are marked "Consumes (from TS-1)" in each task. In particular TS-1 (per its **revised** design §2b) puts a `tab_id` **back-pointer** on `dining_tables` (a tab is "the table's `tab_id` points at the open order"); TS-2's reset trigger and its `openTab` edit are written against that back-pointer model. See Plan note 1 for the one place the on-disk TS-1 *plan* diverges from the TS-1 *spec*, which the executor must reconcile.

## Global Constraints

- **Coverage thresholds 98/98/98/95** (statements/lines/functions/branches) for `packages/db` and `apps/server`; **95/95/90/88** for the dashboard editor (`apps/dashboard`, the browser-package thresholds, CLAUDE.md §2). CI shards run `test:coverage`, not `test` — verify each package green with `pnpm --filter <pkg> test:coverage`.
- **Migration numbers are INDICATIVE.** Assign every number via `pnpm --filter @waitron/db db:generate` (auto part) and `pnpm --filter @waitron/db db:generate:custom` (custom part) against the LIVE tree — never hardcode a number; the campaign may consume numbers first. Commit the generated `packages/db/drizzle/meta/_journal.json` + snapshot alongside each `.sql`.
- **FORCE RLS + tenant-isolation policy + grants + the reset trigger go in HAND-WRITTEN `--custom` migrations.** `.enableRLS()` emits only `ENABLE ROW LEVEL SECURITY`; it is insufficient (CLAUDE.md §3). A new `tenant_id`-bearing table needs `FORCE ROW LEVEL SECURITY`, a `<t>_tenant_isolation` policy (`USING/WITH CHECK (tenant_id = current_tenant_id())`), and grants — pattern in `packages/db/drizzle/0036_till_layouts_rls.sql` / `0039_recipes_rls.sql`. drizzle-kit models no triggers, so the reset trigger is hand-written too (idiom: `working_orders_enforce_transition`, `0004_working_orders.sql` / `0030_prepare_collect.sql`).
- **English identifiers only.** `table_service_statuses`, `status_id`, `label`, `color`, `display_order`, `active`. Add NO new `SPANISH_WORDS` tokens (`packages/db/src/english-only.ts`); UI copy is localised en/es via the dashboard i18n layer.
- **Domain-named error codes, never renamed once shipped** (CLAUDE.md §3). `status.not_found`, `status.inactive`, `status.label_taken` — declared in `apps/server/src/errors.ts` (the host registry that already declares `table.*`/`tab.*`/`working_order.*`), and every throwing file carries `import "./errors.js"`. The root `errors-reachable` guard covers `packages/*` barrels, NOT `apps/*`, so keep the import present.
- **Reuse `till.configure` — NO new permission.** Configuring service statuses is the same "the venue configures its POS" bucket as #81's layouts/receipts (`packages/identity/src/permissions.ts`). Gate the config CRUD on `till.configure` via `authorizeManager`, exactly as `@waitron/layouts`'s `putLayout`/`putReceipt` do.
- **Real Postgres for RLS, the trigger, and the authorize gate; PGlite is a false pass there.** PGlite runs every connection as a superuser (bypasses FORCE RLS and the trigger's app-role behaviour) and serialises every query onto one backend. Put the `table_service_statuses` RLS isolation, the reset-trigger prove-by-deletion, and the config-CRUD `authorizeManager` gate on Testcontainers; note `TESTCONTAINERS_RYUK_DISABLED=true` locally (CLAUDE.md §4).
- **H2 — the fiscal core is untouched.** TS-2 adds a non-fiscal config table, a nullable status column, a non-fiscal reset trigger, and a read. `computeHuella`, the hash chain, `registros_facturacion`, invoice numbers and the alta builders are not modified, and **`payWorkingOrder`/`recordSale` are byte-unchanged** — the reset is a trigger, not a pay-path edit. Proven with a grep receipt (Task 5, Step 1).
- **Prove every guard/trigger by deletion.** Remove the RLS predicate / trigger / authorize gate / not-found gate, confirm the test fails, restore it. A test that still passes with the guard removed is not testing the guard.
- **Every commit `git commit -s`.**
- **No backwards-compat / data-migration code.** Pre-production; schema changes drop-and-recreate, CI builds fresh. No backfill.

---

## File Structure

**Created:**
- `packages/db/src/schema/table-service-statuses.ts` — the `table_service_statuses` Drizzle table (tenant-scoped, `.enableRLS()`), its two uniques. One responsibility: the table definition.
- `packages/db/drizzle/00NN_table_service_statuses.sql` (auto, Task 1) — `CREATE TABLE table_service_statuses` + uniques (drizzle-kit generated).
- `packages/db/drizzle/00NN_table_service_statuses_rls.sql` (custom, Task 1) — FORCE RLS + `table_service_statuses_tenant_isolation` policy + `GRANT SELECT, INSERT, UPDATE` (no DELETE — deactivate).
- `packages/db/src/schema/table-service-statuses.rls.test.ts` — real-PG: cross-tenant RLS isolation (prove-by-deletion), grant shape (SELECT/INSERT/UPDATE, no DELETE).
- `packages/db/drizzle/00NN_dining_tables_status_id.sql` (auto, Task 2) — `ALTER TABLE dining_tables ADD COLUMN status_id` + composite FK.
- `packages/db/drizzle/00NN_clear_table_status_trigger.sql` (custom, Task 5) — `working_orders_clear_table_status` AFTER-UPDATE trigger.
- `apps/server/src/service-statuses.rls.test.ts` — real-PG: config CRUD under the app role + a management session (authorize gate prove-by-deletion; `status.label_taken`/`status.not_found`).
- `apps/server/src/set-table-status.test.ts` — PGlite: `setTableStatus` set/clear + its guards (`status.inactive`/`status.not_found`/`table.not_found`); a `needs-cleaning` set on a FREE table.
- `apps/server/src/clear-table-status.rls.test.ts` — real-PG: the reset trigger (settle a joined-two-table tab → both cleared; prove-by-deletion), the `openTab` status-clear, and the "free table keeps its status" control; runs under the non-superuser `app_user`.
- `apps/dashboard/src/screens/service-status-screen.ts` + `.test.ts` + `.a11y.test.ts` — the dashboard config editor (mirrors `layout-screen`/`receipt-screen`). (Exact shape: Task 7.)

**Modified:**
- `packages/db/src/schema/index.ts` — `export * from "./table-service-statuses.js"` (widens `Database`'s schema type).
- `packages/db/src/index.ts` — `export { tableServiceStatuses } from "./schema/table-service-statuses.js"`.
- `packages/db/src/schema/dining-tables.ts` — add the `statusId` column + its composite FK to `table_service_statuses`.
- `apps/server/src/errors.ts` — declare `status.not_found`, `status.inactive`, `status.label_taken`.
- `apps/server/src/tables.ts` — add the config CRUD verbs (`createStatus`/`listStatuses`/`updateStatus`/`deactivateStatus`, `authorizeManager`-gated), `setTableStatus`, `ServiceStatus`, and the `validateStatusColor` helper.
- `apps/server/src/working-order.ts` — extend `listTablesWithState` with the status LEFT JOIN + `status` field; add the `status_id = NULL` clear to `openTab`'s existing `dining_tables` write (Consumes from TS-1).
- `apps/server/src/till-api.ts` — mount `POST /api/tables/:id/status` (setTableStatus); extend the `STATUS` map with `status.not_found`/`status.inactive`.
- `apps/server/src/management-api.ts` — mount the four `/management-api/service-statuses` config routes; extend the `STATUS` map with `status.not_found`/`status.label_taken`.
- `apps/dashboard/src/api/*`, `apps/dashboard/src/i18n/*`, and the dashboard shell — wire the config editor (Task 7).

---

## Task 1: `table_service_statuses` schema + custom RLS migration + inmutabilidad-green

**Files:**
- Create: `packages/db/src/schema/table-service-statuses.ts`
- Modify: `packages/db/src/schema/index.ts`, `packages/db/src/index.ts`
- Create (generated): `packages/db/drizzle/00NN_table_service_statuses.sql` (auto) + `packages/db/drizzle/00NN_table_service_statuses_rls.sql` (custom) + `meta/_journal.json`/snapshot updates
- Test: `packages/db/src/schema/table-service-statuses.rls.test.ts`

**Interfaces:**
- Produces: `tableServiceStatuses` (Drizzle `pgTable`) exported from `@waitron/db`, columns `id`, `tenantId`, `label`, `color`, `displayOrder`, `active`, `createdAt`; uniques `table_service_statuses_tenant_id_key (tenant_id, id)` and `table_service_statuses_tenant_label_key (tenant_id, label)`. RLS: FORCE + `table_service_statuses_tenant_isolation` policy + `GRANT SELECT, INSERT, UPDATE` to `app_user`.

- [ ] **Step 1: Write the `table_service_statuses` schema.** Mirror `layouts.ts`/`dining-tables.ts` conventions (single-column tenant `.references()` with the `/* v8 ignore next */`, composite `(tenant_id, id)` unique, `.enableRLS()`, custom-migration comment).

`packages/db/src/schema/table-service-statuses.ts`:

```typescript
import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * A venue-configured MANUAL service status a table may carry (design §2a) — "Bill requested",
 * "Needs cleaning". Tenant-wide config (per-location deferred, design §8), the same shape family as
 * #81's `till_layouts`. One status is set on a table at a time via `dining_tables.status_id`
 * (a single nullable composite FK, design §2b); this table is the authorable SET.
 *
 * Deactivate, never hard-delete (`active`): a `dining_tables.status_id` may reference a row, so the
 * config CRUD flips `active = false` rather than DELETE — and `app_user` holds no DELETE here (the
 * custom migration grants only SELECT/INSERT/UPDATE). `.enableRLS()` emits only ENABLE ROW LEVEL
 * SECURITY; the FORCE ROW LEVEL SECURITY, the `table_service_statuses_tenant_isolation` policy and the
 * grant are hand-written in the paired --custom migration, exactly as 0036 does for `till_layouts`.
 * The `inmutabilidad` guard in packages/fiscal-verifactu scans every tenant_id-bearing table for both
 * RLS flags, so a missing FORCE here fails that suite.
 */
export const tableServiceStatuses = pgTable(
  "table_service_statuses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      // Two-arg `.references()` so v8 tracks this thunk as its own never-invoked function (drizzle-kit
      // resolves it in a separate CLI process), the reason orders.ts / layouts.ts use this form.
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    // The human label the floor plan shows ("Bill requested", "Needs cleaning"). Unique within a venue.
    label: text("label").notNull(),
    // A floor-plan swatch — a hex ("#ef4444") or a short token ("amber"), app-validated on write
    // (validateStatusColor, apps/server/src/tables.ts). Stored as opaque text; no DB CHECK.
    color: text("color").notNull(),
    // Author-controlled ordering in the editor + the floor-plan picker.
    displayOrder: integer("display_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [
    // Composite (tenant_id, id) UNIQUE — the target for dining_tables' tenant-consistent
    // (tenant_id, status_id) FK (Task 2), the same role nodes_tenant_id_key plays for working_orders.
    unique("table_service_statuses_tenant_id_key").on(t.tenantId, t.id),
    // No two statuses share a label within a venue (design §2a) — the unique `createStatus`/`updateStatus`
    // map to `status.label_taken`.
    unique("table_service_statuses_tenant_label_key").on(t.tenantId, t.label),
  ],
).enableRLS();
```

- [ ] **Step 2: Re-export from both barrels.**

`packages/db/src/schema/index.ts` — add beside the other schema re-exports (e.g. after the `layouts.js` line):

```typescript
export * from "./table-service-statuses.js";
```

`packages/db/src/index.ts` — add beside the other schema table re-exports (e.g. after the `tillLayouts` line):

```typescript
export { tableServiceStatuses } from "./schema/table-service-statuses.js";
```

- [ ] **Step 3: Typecheck the schema compiles.**

Run: `pnpm --filter @waitron/db typecheck`
Expected: PASS (the new table and its re-exports compile; `Database`'s schema widens for free).

- [ ] **Step 4: Generate the auto migration.**

Run: `pnpm --filter @waitron/db db:generate --name table_service_statuses`
Expected: a new `packages/db/drizzle/00NN_table_service_statuses.sql` containing `CREATE TABLE "table_service_statuses" (...)` with `label text NOT NULL`, `color text NOT NULL`, `display_order integer NOT NULL DEFAULT 0`, `active boolean NOT NULL DEFAULT true`, and both uniques; `meta/_journal.json` + a new snapshot updated. Open the file and confirm both uniques and the defaults are present. The NUMBER is whatever drizzle-kit assigned — do not edit it.

- [ ] **Step 5: Generate + hand-write the custom RLS migration.**

Run: `pnpm --filter @waitron/db db:generate:custom --name table_service_statuses_rls`
Then write into the emitted `packages/db/drizzle/00NN_table_service_statuses_rls.sql` (mirroring `0036_till_layouts_rls.sql`):

```sql
-- Hand-written (--custom; drizzle-kit models no policies, FORCE, or privileges), same as
-- packages/db/drizzle/0036_till_layouts_rls.sql. current_tenant_id() and app_user already exist
-- (0001_tenancy_rls.sql). table_service_statuses is MUTABLE config: no DELETE (deactivate via
-- `active` — a dining_tables.status_id may reference a row, design §2a).
--> statement-breakpoint
ALTER TABLE "table_service_statuses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "table_service_statuses_tenant_isolation" ON "table_service_statuses"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

REVOKE ALL ON "table_service_statuses" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "table_service_statuses" TO app_user;
```

- [ ] **Step 6: Run the inmutabilidad guard — it must discover `table_service_statuses` and require FORCE.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`
Expected: PASS. The tenant_id-scan (`inmutabilidad.test.ts`, keyed on "has a `tenant_id` column") now enumerates `table_service_statuses`; its `nonCompliant` filter would list `table_service_statuses: relrowsecurity=... relforcerowsecurity=false` if the custom migration were missing. Green confirms `relforcerowsecurity = true`.

> If this fails with `table_service_statuses` in the `nonCompliant` list, the custom migration did not run or was misnamed — confirm both `.sql` files are in `packages/db/drizzle/` and `meta/_journal.json` lists both.

- [ ] **Step 7: Write the RLS isolation + grant-shape test (real Postgres, prove-by-deletion).** Mirror `packages/db/src/schema/dining-tables.rls.test.ts` (TS-1) — its `useRealPostgres`, `rollBackAfter`, `asApp`, predicate-deletion idiom. NB in `packages/db` fixtures use `operationDescription: "Hostelería"` (not `"Venta en establecimiento"`): `packages/db`'s `english-only` suite scans this package's `src/` incl. test fixtures, and `venta` is a banned Spanish token (CLAUDE.md §4).

`packages/db/src/schema/table-service-statuses.rls.test.ts`:

```typescript
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database, Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useRealPostgres } from "../testing/lifecycle.js";
import { runMigrationSets, startMigratedPostgres } from "../testing/postgres.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { tenants } from "./tenants.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

class RollbackSignal extends Error {}
async function rollBackAfter(
  admin: Database,
  tenant: string,
  fn: (tx: Transaction) => Promise<void>,
): Promise<void> {
  await withTenant(admin, tenant, async (tx) => {
    await fn(tx);
    throw new RollbackSignal();
  }).catch((error: unknown) => {
    if (!(error instanceof RollbackSignal)) throw error;
  });
}

describe("table_service_statuses schema (RLS + grants)", () => {
  const suite = useRealPostgres({
    start: () =>
      startMigratedPostgres({
        dockerRequired:
          "The table_service_statuses RLS suite requires a running Docker daemon. It cannot be " +
          "skipped: PGlite runs every connection as a superuser, bypassing the FORCE ROW LEVEL " +
          "SECURITY and the grant shape (SELECT/INSERT/UPDATE, no DELETE) this suite exists to prove.",
        migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
      }),
    timeoutMs: 120_000,
  });

  beforeAll(async () => {
    await suite.admin.insert(tenants).values([
      { id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" },
      { id: TENANT_B, country: "ES", taxId: "B11111111", legalName: "Fixture Tenant B" },
    ]);
  });

  function asApp<T>(tenant: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(suite.admin, tenant, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  async function seedStatus(tenant: string, label: string): Promise<string> {
    return asApp(tenant, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into table_service_statuses (tenant_id, label, color) values (${tenant}, ${label}, '#ef4444') returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  it("permits SELECT/INSERT/UPDATE as the non-owner app role (the control)", async () => {
    const id = await seedStatus(TENANT_A, "Bill requested");
    await asApp(TENANT_A, (tx) =>
      tx.execute(sql`update table_service_statuses set color = '#22c55e' where id = ${id}`),
    );
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .execute<{ color: string }>(sql`select color from table_service_statuses where id = ${id}`)
        .then((r) => r.rows),
    );
    expect(row!.color).toBe("#22c55e");
  });

  it("app_user has no DELETE on table_service_statuses (deactivate, never delete)", async () => {
    const id = await seedStatus(TENANT_A, "Needs cleaning");
    const e = await captureError(() =>
      asApp(TENANT_A, (tx) => tx.execute(sql`delete from table_service_statuses where id = ${id}`)),
    );
    expect(pgErrorCode(e)).toBe("42501");
  });

  it("isolates INSERT between tenants (WITH CHECK rejects a foreign tenant_id)", async () => {
    const e = await captureError(() =>
      asApp(TENANT_B, (tx) =>
        tx.execute(
          sql`insert into table_service_statuses (tenant_id, label, color) values (${TENANT_A}, 'Foreign', '#000')`,
        ),
      ),
    );
    expect(pgErrorCode(e)).toBe("42501");
  });

  it("tenant isolation is the policy PREDICATE's doing (proof by deletion of the tenant predicate)", async () => {
    // A's row is committed before the policy is weakened, so it is genuinely there to leak. Weakening
    // the predicate to `true` in a ROLLED-BACK tx makes B suddenly see it. A full DROP POLICY is the
    // WRONG deletion: FORCE RLS with no policy denies ALL rows, so B would see zero for the opposite
    // reason.
    const id = await seedStatus(TENANT_A, "Leak-probe");
    expect(id).toBeDefined();
    await rollBackAfter(suite.admin, TENANT_B, async (tx) => {
      await tx.execute(
        sql`alter policy table_service_statuses_tenant_isolation on table_service_statuses using (true) with check (true)`,
      );
      await tx.execute(sql`set local role app_user`);
      const foreign = await tx
        .execute<{ n: number }>(
          sql`select (count(*) filter (where tenant_id = ${TENANT_A}))::int as n from table_service_statuses`,
        )
        .then((r) => r.rows[0]!.n);
      expect(foreign).toBeGreaterThan(0); // A's rows now leak to B — the predicate was the guard.
    });
  });
});
```

- [ ] **Step 8: Run the RLS test.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test table-service-statuses.rls`
Expected: PASS (4 tests). To PROVE the isolation test bites, temporarily change the policy in the migration to `using (true) with check (true)`, rerun the isolation test → "isolates INSERT between tenants" FAILS (no 42501); restore.

- [ ] **Step 9: Package green + commit.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage`
Expected: PASS at 98/98/98/95.

```bash
git add packages/db/src/schema/table-service-statuses.ts packages/db/src/schema/index.ts packages/db/src/index.ts packages/db/drizzle/ packages/db/src/schema/table-service-statuses.rls.test.ts
git commit -s -m "feat(db): table_service_statuses entity + custom RLS migration (TS-2)"
```

---

## Task 2: `dining_tables.status_id` column + composite FK

**Files:**
- Modify: `packages/db/src/schema/dining-tables.ts` (Consumes from TS-1)
- Create (generated): `packages/db/drizzle/00NN_dining_tables_status_id.sql` (auto) + `meta/_journal.json`/snapshot
- Test: `packages/db/src/schema/table-service-statuses.rls.test.ts` (extend — the FK visibility case)

**Interfaces:**
- Consumes (from TS-1): `diningTables` (`packages/db/src/schema/dining-tables.ts`) incl. its `tenantId`, composite `(tenant_id, id)` unique, and the `tab_id` back-pointer.
- Consumes: `tableServiceStatuses` (Task 1).
- Produces: `diningTables.statusId` (`status_id uuid NULL`), composite FK `dining_tables_status_fk (tenant_id, status_id) → table_service_statuses(tenant_id, id)`.

- [ ] **Step 1: Add the `statusId` column + composite FK to the TS-1 schema.** In `packages/db/src/schema/dining-tables.ts`: add `import { tableServiceStatuses } from "./table-service-statuses.js";` at the top; add the column after the TS-1 columns (before `createdAt`); append the FK to the `(t) => [ ... ]` array.

Column:

```typescript
    // The table's single current MANUAL status (design §2b), or NULL for none. Shown ALWAYS — a
    // just-vacated `free` table may still carry a "needs-cleaning" status. Additive nullable column;
    // dining_tables' TS-1 FORCE-RLS policy + app_user grants already cover it (grants table-wide, RLS
    // row-level). The FK is the tenant-consistent COMPOSITE in extraConfig below.
    statusId: uuid("status_id"),
```

extraConfig addition:

```typescript
    // Tenant-consistent composite FK to the venue's configured status set (design §2b): a table cannot
    // point at a status of another tenant, independently of RLS. MATCH SIMPLE satisfies it while the
    // column is NULL, so it stays nullable. `table_service_statuses` deactivates rather than deletes,
    // so this FK never dangles (no ON DELETE path is exercised).
    foreignKey({
      columns: [t.tenantId, t.statusId],
      foreignColumns: [tableServiceStatuses.tenantId, tableServiceStatuses.id],
      name: "dining_tables_status_fk",
    }),
```

> `foreignKey` is already imported in `dining-tables.ts` (TS-1 uses it for `dining_tables_location_fk`). No new pg-core import is needed for this task.

- [ ] **Step 2: Typecheck.**

Run: `pnpm --filter @waitron/db typecheck`
Expected: PASS.

- [ ] **Step 3: Generate the auto migration and read it.**

Run: `pnpm --filter @waitron/db db:generate --name dining_tables_status_id`
Expected: `packages/db/drizzle/00NN_dining_tables_status_id.sql` with `ALTER TABLE "dining_tables" ADD COLUMN "status_id" uuid;` and `ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_status_fk" FOREIGN KEY ("tenant_id","status_id") REFERENCES "public"."table_service_statuses"("tenant_id","id") ...;`. Confirm the column is nullable (no `NOT NULL`) and the FK targets `table_service_statuses(tenant_id, id)`. Commit `meta/_journal.json` + snapshot. The number is whatever drizzle-kit assigned.

- [ ] **Step 4: Add the FK-visibility case to the RLS suite (differential — app_user can write/read status_id).** Append to `packages/db/src/schema/table-service-statuses.rls.test.ts`. It seeds a location + a dining table (TS-1) and a status, then sets `dining_tables.status_id` as `app_user` and reads it back — failing if the composite FK or the column were not visible to the non-owner role under the TS-1 policy.

```typescript
  it("dining_tables.status_id is writable/readable by the non-owner app_user and enforces the tenant-consistent FK", async () => {
    // Seed a location + a dining table (TS-1) as the owner, then set + read status_id as app_user.
    const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
    await suite.admin.execute(sql`
      insert into locations (id, tenant_id, name, invoice_locales, operation_description)
      values (${LOCATION_A}, ${TENANT_A}, 'Loc A', array['es'], 'Hostelería')
      on conflict (id) do nothing`);
    const tableId = await asApp(TENANT_A, async (tx) =>
      tx
        .execute<{ id: string }>(
          sql`insert into dining_tables (tenant_id, location_id, label) values (${TENANT_A}, ${LOCATION_A}, 'T-status') returning id`,
        )
        .then((r) => r.rows[0]!.id),
    );
    const statusId = await seedStatus(TENANT_A, "Bill requested TS2");
    await asApp(TENANT_A, (tx) =>
      tx.execute(sql`update dining_tables set status_id = ${statusId} where id = ${tableId}`),
    );
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .execute<{ status_id: string | null }>(sql`select status_id from dining_tables where id = ${tableId}`)
        .then((r) => r.rows),
    );
    expect(row!.status_id).toBe(statusId);

    // The composite FK rejects a status_id that is not this tenant's (a random uuid) — 23503.
    const e = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(sql`update dining_tables set status_id = '99999999-9999-4999-8999-999999999999' where id = ${tableId}`),
      ),
    );
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation
  });
```

- [ ] **Step 5: Run the test, then the package.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test table-service-statuses.rls`
Expected: PASS. Then `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage` → PASS at 98/98/98/95.

- [ ] **Step 6: Re-run the inmutabilidad guard (the new column must not disturb it) and commit.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`
Expected: PASS (`dining_tables` still compliant; `status_id` is additive).

```bash
git add packages/db/src/schema/dining-tables.ts packages/db/drizzle/ packages/db/src/schema/table-service-statuses.rls.test.ts
git commit -s -m "feat(db): dining_tables.status_id + composite FK to table_service_statuses (TS-2)"
```

---

## Task 3: Config CRUD verbs + error codes + `till.configure` gating

**Files:**
- Modify: `apps/server/src/tables.ts`, `apps/server/src/errors.ts`
- Test: `apps/server/src/service-statuses.rls.test.ts` (real Postgres)

**Interfaces:**
- Consumes: `tableServiceStatuses`, `isUniqueViolation`, `asAppUser`, `withTenant` (`@waitron/db`); `authorizeManager` (`@waitron/identity`); `AppError` (`@waitron/shared`).
- Produces:
  - `interface ServiceStatus { id: string; label: string; color: string; displayOrder: number; active: boolean; createdAt: string }`
  - `createStatus(tx, { managementSessionId, tenantId, label, color, displayOrder? }): Promise<{ id: string }>` — `till.configure`; throws `status.label_taken`, `management.request_invalid` (bad color).
  - `listStatuses(tx, { managementSessionId, tenantId }): Promise<ServiceStatus[]>` — `till.configure`; all statuses (active + inactive) by `display_order`, then `label`.
  - `updateStatus(tx, { managementSessionId, tenantId, id, label?, color?, displayOrder?, active? }): Promise<void>` — `till.configure`; throws `status.not_found`, `status.label_taken`, `management.request_invalid`.
  - `deactivateStatus(tx, { managementSessionId, tenantId, id }): Promise<void>` — `till.configure`; throws `status.not_found`.

- [ ] **Step 1: Declare the three error codes.** In `apps/server/src/errors.ts`, inside the `interface ErrorParams` block (beside the TS-1 `table.*`/`tab.*` codes), add:

```typescript
    /**
     * No such service status for this tenant. `statusId` is a caller-supplied uuid the dashboard/till
     * already holds, not a secret — an id that matches nothing is unactionable if withheld (the rule
     * `tenant.not_found`'s note gives). `status.*` names the DOMAIN CONCEPT (a table's manual service
     * status), never the throwing package; destined for @waitron/tables if that package is extracted.
     * An absent id, or another tenant's status (RLS hides it), both report THIS one code. Mapped to 404.
     */
    "status.not_found": { statusId: string };
    /**
     * A service status exists but is deactivated (`active = false`), so a table may not be set to it —
     * `setTableStatus` refuses it. `statusId` is the caller-supplied uuid (not a secret). Distinct from
     * `status.not_found` (absent/foreign): this says the status is real but retired from service.
     * `status.*`, not `server.*`, for the reason `tenant.not_found`'s note gives. Mapped to 409 (the
     * status's state forbids the assignment).
     */
    "status.inactive": { statusId: string };
    /**
     * A service-status label already exists in this venue — the `(tenant_id, label)` unique
     * (`table_service_statuses_tenant_label_key`) rejected the insert/update. `label` is the
     * operator-supplied human name ("Bill requested"), not a secret, so echoing it is what makes the
     * error actionable. `status.*`, not `server.*`, for the reason `tenant.not_found`'s note gives.
     * Mapped to 409.
     */
    "status.label_taken": { label: string };
```

- [ ] **Step 2: Write the failing config-CRUD test (real Postgres).** Mirror `packages/layouts/src/store.rls.test.ts` — its `useRealPostgres` over `[CORE_MIGRATIONS, IDENTITY_MIGRATIONS]`, its `asApp`, `seedSession(tenantId, role)`, and `codeOf`. Real PG because `authorizeManager` reads `persons` + `management_sessions` under the app role's RLS, and the CRUD upserts under FORCE RLS — both false passes on PGlite (CLAUDE.md §4). `apps/server` is out of the `english-only` scope, so `operationDescription: "Venta en establecimiento"` is fine here.

`apps/server/src/service-statuses.rls.test.ts`:

```typescript
import { asAppUser, captureError, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { runMigrationSets, startMigratedPostgres } from "@waitron/db/testing/postgres.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, startManagementSession } from "@waitron/identity";
import type { PersonRoleValue } from "@waitron/identity";
import { isAppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createStatus, deactivateStatus, listStatuses, updateStatus } from "./tables.js";
import "./errors.js";

const suite = useRealPostgres({
  start: () =>
    startMigratedPostgres({
      dockerRequired:
        "The service-statuses CRUD suite requires Docker: the CRUD both AUTHORIZES (authorizeManager " +
        "reads persons + management_sessions under the app role's RLS) and upserts table_service_" +
        "statuses under FORCE ROW LEVEL SECURITY — both are false passes on PGlite (superuser).",
      migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, IDENTITY_MIGRATIONS]),
    }),
  timeoutMs: 120_000,
});

function asApp<T>(tenantId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(suite.admin, tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** Seed a person of `role` and an open management session; returns the session id. */
async function seedSession(tenantId: string, role: PersonRoleValue): Promise<string> {
  const person = await suite.admin.execute<{ id: string }>(sql`
    insert into persons (tenant_id, display_name, pin_hash, role)
    values (${tenantId}, 'Operator', 'seed-pin-hash', ${role}) returning id`);
  const session = await withTenant(suite.admin, tenantId, (tx) =>
    startManagementSession(tx, { tenantId, personId: person.rows[0]!.id }),
  );
  return session.id;
}

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  const error = await captureError(fn);
  return isAppError(error) ? error.code : `NON-APP-ERROR: ${String(error)}`;
}

describe("service-status config CRUD (till.configure)", () => {
  let tenantId: string;
  let managerSession: string;
  beforeAll(async () => {
    tenantId = await seedTenant(suite.admin);
    managerSession = await seedSession(tenantId, "manager");
  });

  it("creates, lists (by display_order then label), updates, and deactivates a status", async () => {
    const { id } = await asApp(tenantId, (tx) =>
      createStatus(tx, { managementSessionId: managerSession, tenantId, label: "Bill requested", color: "#ef4444", displayOrder: 1 }),
    );
    await asApp(tenantId, (tx) =>
      createStatus(tx, { managementSessionId: managerSession, tenantId, label: "Needs cleaning", color: "amber", displayOrder: 0 }),
    );
    const list = await asApp(tenantId, (tx) => listStatuses(tx, { managementSessionId: managerSession, tenantId }));
    expect(list.map((s) => s.label)).toEqual(["Needs cleaning", "Bill requested"]); // display_order 0, 1

    await asApp(tenantId, (tx) =>
      updateStatus(tx, { managementSessionId: managerSession, tenantId, id, color: "#22c55e", displayOrder: 5 }),
    );
    await asApp(tenantId, (tx) => deactivateStatus(tx, { managementSessionId: managerSession, tenantId, id }));
    const after = await asApp(tenantId, (tx) => listStatuses(tx, { managementSessionId: managerSession, tenantId }));
    expect(after.find((s) => s.id === id)).toMatchObject({ color: "#22c55e", displayOrder: 5, active: false });
  });

  it("refuses a duplicate label (status.label_taken) on create and on update", async () => {
    await asApp(tenantId, (tx) =>
      createStatus(tx, { managementSessionId: managerSession, tenantId, label: "Reserved", color: "#3b82f6" }),
    );
    expect(
      await codeOf(() =>
        asApp(tenantId, (tx) => createStatus(tx, { managementSessionId: managerSession, tenantId, label: "Reserved", color: "#000" })),
      ),
    ).toBe("status.label_taken");
  });

  it("throws status.not_found for update/deactivate of an unknown id", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    expect(
      await codeOf(() => asApp(tenantId, (tx) => updateStatus(tx, { managementSessionId: managerSession, tenantId, id: missing, label: "X" }))),
    ).toBe("status.not_found");
    expect(
      await codeOf(() => asApp(tenantId, (tx) => deactivateStatus(tx, { managementSessionId: managerSession, tenantId, id: missing }))),
    ).toBe("status.not_found");
  });

  it("rejects a malformed color (management.request_invalid, naming the field)", async () => {
    expect(
      await codeOf(() =>
        asApp(tenantId, (tx) => createStatus(tx, { managementSessionId: managerSession, tenantId, label: "Bad", color: "red; drop table x" })),
      ),
    ).toBe("management.request_invalid");
  });

  it("gates every verb on till.configure — a staff-role session is refused (authorization.not_permitted)", async () => {
    const staffSession = await seedSession(tenantId, "staff");
    expect(
      await codeOf(() =>
        asApp(tenantId, (tx) => createStatus(tx, { managementSessionId: staffSession, tenantId, label: "Nope", color: "#000" })),
      ),
    ).toBe("authorization.not_permitted");
    expect(
      await codeOf(() => asApp(tenantId, (tx) => listStatuses(tx, { managementSessionId: staffSession, tenantId }))),
    ).toBe("authorization.not_permitted");
  });
});
```

- [ ] **Step 3: Run — see it fail (verbs not exported).**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test service-statuses.rls`
Expected: FAIL — `createStatus is not a function` / missing exports.

- [ ] **Step 4: Implement the config CRUD verbs + `validateStatusColor`.** In `apps/server/src/tables.ts`, add the imports (`authorizeManager` from `@waitron/identity`; `tableServiceStatuses` added to the existing `@waitron/db` import) and append:

```typescript
/** A configured service status as the CRUD surface returns it. `createdAt` is an ISO string. */
export interface ServiceStatus {
  id: string;
  label: string;
  color: string;
  displayOrder: number;
  active: boolean;
  createdAt: string;
}

// A floor-plan swatch is a hex ("#ef4444") or a short token ("amber", "amber-500"): a bounded,
// charset-restricted string. Validated app-side (design §2a) — the DB stores opaque text. A malformed
// value is a request-payload fault surfaced as `management.request_invalid` naming the FIELD (never the
// value — the no-leak discipline errors.ts states), the same shape the layout PUT route uses; the spec
// enumerates only status.not_found/inactive/label_taken, so no new status.* code is minted (Plan note 3).
const STATUS_COLOR_RE = /^[#A-Za-z0-9_-]{1,32}$/;
function validateStatusColor(color: string): string {
  if (typeof color !== "string" || !STATUS_COLOR_RE.test(color)) {
    throw new AppError("management.request_invalid", { field: "color" });
  }
  return color;
}

/**
 * Create a service status in the tenant's configured set. Manager/admin only (`till.configure`, the
 * #81 venue-config permission — reused, not renamed): the authorize gate runs BEFORE any DB write,
 * proven by-deletion in the suite. A duplicate `(tenant, label)` collides on
 * `table_service_statuses_tenant_label_key` and is surfaced as `status.label_taken`.
 */
export async function createStatus(
  tx: Transaction,
  input: { managementSessionId: string; tenantId: string; label: string; color: string; displayOrder?: number },
): Promise<{ id: string }> {
  await authorizeManager(tx, { managementSessionId: input.managementSessionId, permission: "till.configure" });
  const color = validateStatusColor(input.color);
  try {
    const [row] = await tx
      .insert(tableServiceStatuses)
      .values({
        tenantId: input.tenantId,
        label: input.label,
        color,
        displayOrder: input.displayOrder ?? 0,
      })
      .returning({ id: tableServiceStatuses.id });
    return { id: row!.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("status.label_taken", { label: input.label });
    }
    throw error;
  }
}

/**
 * The tenant's WHOLE status set — active AND inactive, ordered by `display_order` then `label` — so the
 * editor can reactivate a deactivated one. Manager/admin only (`till.configure`), gated here rather than
 * at the route so the verb is safe from any caller. RLS confines the read to the tenant.
 */
export async function listStatuses(
  tx: Transaction,
  input: { managementSessionId: string; tenantId: string },
): Promise<ServiceStatus[]> {
  await authorizeManager(tx, { managementSessionId: input.managementSessionId, permission: "till.configure" });
  return tx
    .select({
      id: tableServiceStatuses.id,
      label: tableServiceStatuses.label,
      color: tableServiceStatuses.color,
      displayOrder: tableServiceStatuses.displayOrder,
      active: tableServiceStatuses.active,
      createdAt: tableServiceStatuses.createdAt,
    })
    .from(tableServiceStatuses)
    .orderBy(tableServiceStatuses.displayOrder, tableServiceStatuses.label);
}

/**
 * Edit a status's `label`/`color`/`displayOrder`/`active` (any subset). Manager/admin only
 * (`till.configure`). An absent id (or another tenant's, RLS-hidden) throws `status.not_found`; a label
 * collision throws `status.label_taken`; a malformed color throws `management.request_invalid`.
 * Reactivation is `updateStatus({ active: true })`.
 */
export async function updateStatus(
  tx: Transaction,
  input: {
    managementSessionId: string;
    tenantId: string;
    id: string;
    label?: string;
    color?: string;
    displayOrder?: number;
    active?: boolean;
  },
): Promise<void> {
  await authorizeManager(tx, { managementSessionId: input.managementSessionId, permission: "till.configure" });
  const patch: { label?: string; color?: string; displayOrder?: number; active?: boolean } = {};
  if (input.label !== undefined) patch.label = input.label;
  if (input.color !== undefined) patch.color = validateStatusColor(input.color);
  if (input.displayOrder !== undefined) patch.displayOrder = input.displayOrder;
  if (input.active !== undefined) patch.active = input.active;

  let updated: { id: string }[];
  try {
    updated = await tx
      .update(tableServiceStatuses)
      .set(patch)
      .where(eq(tableServiceStatuses.id, input.id))
      .returning({ id: tableServiceStatuses.id });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Only `label` participates in the unique, so it was necessarily supplied when this fires.
      throw new AppError("status.label_taken", { label: input.label! });
    }
    throw error;
  }
  if (updated.length === 0) {
    throw new AppError("status.not_found", { statusId: input.id });
  }
}

/** Deactivate a status (`active = false`) — never a hard delete (a table may reference it; app_user
 *  holds no DELETE on `table_service_statuses`). Manager/admin only. Absent id → `status.not_found`. */
export async function deactivateStatus(
  tx: Transaction,
  input: { managementSessionId: string; tenantId: string; id: string },
): Promise<void> {
  await authorizeManager(tx, { managementSessionId: input.managementSessionId, permission: "till.configure" });
  const updated = await tx
    .update(tableServiceStatuses)
    .set({ active: false })
    .where(eq(tableServiceStatuses.id, input.id))
    .returning({ id: tableServiceStatuses.id });
  if (updated.length === 0) {
    throw new AppError("status.not_found", { statusId: input.id });
  }
}
```

> `eq` and `AppError` and `isUniqueViolation` are already imported by TS-1's `tables.ts`. Add `authorizeManager` to the `@waitron/identity` imports (a new import line — TS-1's `tables.ts` did not import from `@waitron/identity`) and `tableServiceStatuses` to the existing `@waitron/db` import.

- [ ] **Step 5: Run — see it pass.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test service-statuses.rls`
Expected: PASS (5 tests).

- [ ] **Step 6: Prove the authorize gate by deletion.** Temporarily comment the `await authorizeManager(...)` line in `createStatus`, rerun → the "a staff-role session is refused" test FAILS (create now succeeds for staff). Restore. Do the same spot-check for `status.label_taken` (comment the `if (isUniqueViolation(error))` branch → the duplicate test fails with a raw 23505). Restore.

- [ ] **Step 7: Commit.**

```bash
git add apps/server/src/tables.ts apps/server/src/errors.ts apps/server/src/service-statuses.rls.test.ts
git commit -s -m "feat(server): service-status config CRUD + status.* error codes, gated on till.configure (TS-2)"
```

---

## Task 4: `setTableStatus` (operator-session gated)

**Files:**
- Modify: `apps/server/src/tables.ts`
- Test: `apps/server/src/set-table-status.test.ts` (PGlite)

**Interfaces:**
- Consumes: `diningTables` (TS-1), `tableServiceStatuses` (Task 1); `TillConfig`.
- Produces: `setTableStatus(tx: Transaction, cfg: TillConfig, tableId: string, statusId: string | null): Promise<void>` — throws `table.not_found` (absent/inactive/foreign table), `status.not_found`, `status.inactive`. (Operator-session gating is at the ROUTE via `requireSession`, Task 8 — the verb itself is unauthenticated like TS-1's table CRUD.)

- [ ] **Step 1: Write the failing verb test (PGlite).** Mirror TS-1's `tables.test.ts` `setupVenue`/`asApp` shape (a fresh tenant/location/till/node per test). PGlite is sufficient (design §7): the verb's correctness does not depend on RLS-as-app-role, only on its own guards. Seed one dining table + one active status + one inactive status.

`apps/server/src/set-table-status.test.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { createTable, setTableStatus } from "./tables.js";
import "./errors.js";

const LOCALE = "es-ES";
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let db: Database;
beforeAll(() => {
  db = suite.db;
});

interface Seeded {
  cfg: TillConfig;
  tableId: string;
  activeStatusId: string;
  inactiveStatusId: string;
}

async function setupVenue(): Promise<Seeded> {
  const tenantId = await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array[${LOCALE}], 'Venta en establecimiento') returning id`);
  const locationId = loc.rows[0]!.id;
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Caja 1') returning id`);
  const nodeId = await seedNode(db, tenantId, brandLocationId(locationId));
  const cfg: TillConfig = {
    tenantId,
    tillId: brandTillId(till.rows[0]!.id),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  const seeded = await withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    const { id: tableId } = await createTable(tx, cfg, { label: "T1" });
    const active = await tx.execute<{ id: string }>(
      sql`insert into table_service_statuses (tenant_id, label, color) values (${tenantId}, 'Bill requested', '#ef4444') returning id`,
    );
    const inactive = await tx.execute<{ id: string }>(
      sql`insert into table_service_statuses (tenant_id, label, color, active) values (${tenantId}, 'Retired', '#000', false) returning id`,
    );
    return { tableId, activeStatusId: active.rows[0]!.id, inactiveStatusId: inactive.rows[0]!.id };
  });
  return { cfg, ...seeded };
}

function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

async function statusOf(tableId: string): Promise<string | null> {
  const { rows } = await db.execute<{ status_id: string | null }>(
    sql`select status_id from dining_tables where id = ${tableId}`,
  );
  return rows[0]!.status_id;
}

describe("setTableStatus", () => {
  it("sets a table's manual status, then clears it with null", async () => {
    const { cfg, tableId, activeStatusId } = await setupVenue();
    await asApp(cfg, (tx) => setTableStatus(tx, cfg, tableId, activeStatusId));
    expect(await statusOf(tableId)).toBe(activeStatusId);
    await asApp(cfg, (tx) => setTableStatus(tx, cfg, tableId, null));
    expect(await statusOf(tableId)).toBeNull();
  });

  it("sets a status on a FREE table (occupancy-independent — the status shows regardless)", async () => {
    const { cfg, tableId, activeStatusId } = await setupVenue();
    // No tab open — the table is free. A needs-cleaning-style status still applies.
    await asApp(cfg, (tx) => setTableStatus(tx, cfg, tableId, activeStatusId));
    expect(await statusOf(tableId)).toBe(activeStatusId);
  });

  it("refuses a deactivated status (status.inactive)", async () => {
    const { cfg, tableId, inactiveStatusId } = await setupVenue();
    await expect(asApp(cfg, (tx) => setTableStatus(tx, cfg, tableId, inactiveStatusId))).rejects.toMatchObject({
      code: "status.inactive",
      params: { statusId: inactiveStatusId },
    });
  });

  it("refuses an unknown status (status.not_found)", async () => {
    const { cfg, tableId } = await setupVenue();
    const missing = randomUUID();
    await expect(asApp(cfg, (tx) => setTableStatus(tx, cfg, tableId, missing))).rejects.toMatchObject({
      code: "status.not_found",
      params: { statusId: missing },
    });
  });

  it("refuses an unknown or deactivated table (table.not_found)", async () => {
    const { cfg, tableId, activeStatusId } = await setupVenue();
    const missing = randomUUID();
    await expect(asApp(cfg, (tx) => setTableStatus(tx, cfg, missing, activeStatusId))).rejects.toMatchObject({
      code: "table.not_found",
      params: { tableId: missing },
    });
    // A deactivated table is not in service — also table.not_found (design §3b lists table.not_found).
    await db.execute(sql`update dining_tables set active = false where id = ${tableId}`);
    await expect(asApp(cfg, (tx) => setTableStatus(tx, cfg, tableId, activeStatusId))).rejects.toMatchObject({
      code: "table.not_found",
      params: { tableId },
    });
  });
});
```

- [ ] **Step 2: Run — see it fail.**

Run: `pnpm --filter @waitron/server test set-table-status.test`
Expected: FAIL — `setTableStatus is not a function`.

- [ ] **Step 3: Implement `setTableStatus`.** In `apps/server/src/tables.ts`, beside the config CRUD:

```typescript
/**
 * Set (or clear, with `null`) a table's single manual status (design §3b) — an OPERATIONAL verb a
 * logged-in operator uses the way they ring a sale, so it is gated by the operator SESSION at the route
 * (`requireSession`, Task 8), NOT by `till.configure`. Validates the table is active (an absent,
 * deactivated, or foreign/RLS-hidden table → `table.not_found`, design §3b) and, when `statusId` is
 * non-null, that the status is real (`status.not_found`) and `active` (`status.inactive`). Runs on the
 * CALLER's transaction under its tenant/app_user scope. The status is occupancy-INDEPENDENT: a `free`
 * table may carry one, so this never consults the tab state.
 */
export async function setTableStatus(
  tx: Transaction,
  cfg: TillConfig,
  tableId: string,
  statusId: string | null,
): Promise<void> {
  const [table] = await tx
    .select({ active: diningTables.active })
    .from(diningTables)
    .where(eq(diningTables.id, tableId));
  if (table === undefined || !table.active) {
    throw new AppError("table.not_found", { tableId });
  }

  if (statusId !== null) {
    const [status] = await tx
      .select({ active: tableServiceStatuses.active })
      .from(tableServiceStatuses)
      .where(eq(tableServiceStatuses.id, statusId));
    if (status === undefined) {
      throw new AppError("status.not_found", { statusId });
    }
    if (!status.active) {
      throw new AppError("status.inactive", { statusId });
    }
  }

  await tx.update(diningTables).set({ statusId }).where(eq(diningTables.id, tableId));
}
```

> `diningTables` is already imported into `tables.ts` by TS-1's CRUD; `tableServiceStatuses` was added to the `@waitron/db` import in Task 3.

- [ ] **Step 4: Run — see it pass.**

Run: `pnpm --filter @waitron/server test set-table-status.test`
Expected: PASS (5 tests).

- [ ] **Step 5: Prove the `status.inactive` and `table.not_found` guards by deletion.** Temporarily comment the `if (!status.active)` block → the "refuses a deactivated status" test FAILS (an inactive status now sets). Restore. Then change the table gate to `if (table === undefined)` only (drop `|| !table.active`) → the "deactivated table" case FAILS. Restore.

- [ ] **Step 6: Package coverage + commit.**

Run: `pnpm --filter @waitron/server test:coverage`
Expected: PASS at 98/98/98/95.

```bash
git add apps/server/src/tables.ts apps/server/src/set-table-status.test.ts
git commit -s -m "feat(server): setTableStatus set/clear a table's manual status (TS-2)"
```

---

## Task 5: Reset-on-turnover — the AFTER-UPDATE trigger + the `openTab` status-clear

**Files:**
- Create (generated): `packages/db/drizzle/00NN_clear_table_status_trigger.sql` (custom) + `meta/_journal.json`/snapshot
- Modify: `apps/server/src/working-order.ts` (the `openTab` edit — Consumes from TS-1)
- Test: `apps/server/src/clear-table-status.rls.test.ts` (real Postgres)

**Interfaces:**
- Consumes (from TS-1): `openTab` (`apps/server/src/working-order.ts`) and the `dining_tables.tab_id` back-pointer it sets; the `working_orders_enforce_transition` state machine (`0030`).
- Consumes: `dining_tables.status_id` (Task 2).
- Produces: the DB trigger `working_orders_clear_table_status` (AFTER UPDATE ON `working_orders`), and `openTab` now clears the table's `status_id` as a new tab opens. No new exported TS symbol.

- [ ] **Step 1: The H2 grep receipt (payWorkingOrder/recordSale byte-unchanged; nothing fiscal reads the status).** Run and record (in the test file's header comment) that the fiscal core and the pay path are untouched by TS-2:

```bash
git diff --stat main -- packages/core/src/record-sale.ts packages/fiscal-verifactu/src/backend.ts packages/verifactu/ apps/server/src/till-sale.ts
grep -nE "status_id|statusId|table_service_statuses|tableServiceStatuses" packages/core/src/record-sale.ts packages/fiscal-verifactu/src/backend.ts apps/server/src/till-sale.ts
```

Expected: the first prints **no changes** to those paths on the TS-2 branch (the reset is a trigger + an `openTab` edit; `payWorkingOrder`/`recordSale` are byte-unchanged — design §3b/§5); the second is **empty**. Paste both commands + their output into the test file's header comment as the H2 receipt.

- [ ] **Step 2: Generate + hand-write the custom trigger migration.** This migration references `dining_tables.status_id` (Task 2) and `dining_tables.tab_id` (TS-1), so it MUST be a later number than both — `db:generate:custom` assigns one at the tip, so this is automatic.

Run: `pnpm --filter @waitron/db db:generate:custom --name clear_table_status_trigger`
Then write into the emitted `packages/db/drizzle/00NN_clear_table_status_trigger.sql` (mirroring the `working_orders_enforce_transition` idiom in `0004_working_orders.sql` / `0030_prepare_collect.sql`):

```sql
-- Hand-written (--custom; drizzle-kit models no triggers), the working_orders_enforce_transition idiom
-- (0004 / 0030). Reset-on-turnover (design §3b): when a tab settles or is abandoned, clear the MANUAL
-- status on EVERY table that tab covered — one normally, several if the tab was joined across tables
-- (TS-3) — since the link is the dining_tables.tab_id back-pointer (TS-1 §2b). So "Bill requested"
-- clears the instant the tab settles, without payWorkingOrder / recordSale changing at all (H2).
--
-- AFTER UPDATE, not BEFORE: the transition is already validated by working_orders_enforce_transition
-- (0030, a BEFORE UPDATE trigger permitting open → settled|abandoned) by the time this fires. WHEN
-- (OLD.status = 'open' AND NEW.status IN ('settled','abandoned')) so it fires ONLY on the open→terminal
-- turnover — never on an open→open label edit, nor a placed→settled counter collect (a counter order
-- carries no tab_id anyway, so even if it fired the UPDATE would match zero rows).
--
-- SECURITY INVOKER (the plpgsql default; not stated): it runs as the CALLER (app_user), and the UPDATE
-- is same-tenant (tenant_id = NEW.tenant_id), so the dining_tables tenant-isolation policy + the TS-1
-- SELECT/INSERT/UPDATE grant permit it (proven under app_user, same-tenant, in
-- apps/server/src/clear-table-status.rls.test.ts). It clears ONLY status_id, never tab_id — TS-1 leaves
-- a settled tab's back-pointer stale on purpose (the occupancy read counts a tab_id only while its order
-- is open).
--
-- NOT gated on app.sync_apply (contrast the THREE BEFORE-triggers 0037 gates): this is an idempotent,
-- data-validity-shaped cascade, not a state-machine gate. A zero-match UPDATE is a no-op and a
-- same-tenant one is RLS-permitted, so it CANNOT raise and cannot wedge the apply path — exactly the
-- class 0037 deliberately leaves ungated. dining_tables sync-enrollment is out of TS-2's scope; a future
-- replication slice revisits this deliberately (Plan note 6).
CREATE FUNCTION working_orders_clear_table_status()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE dining_tables
     SET status_id = NULL
   WHERE tenant_id = NEW.tenant_id
     AND tab_id = NEW.id;
  RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE TRIGGER working_orders_clear_table_status
  AFTER UPDATE ON working_orders
  FOR EACH ROW
  WHEN (OLD.status = 'open' AND NEW.status IN ('settled', 'abandoned'))
  EXECUTE FUNCTION working_orders_clear_table_status();
```

- [ ] **Step 3: Add the `status_id = NULL` clear to `openTab`.** `openTab` (TS-1) already writes `dining_tables` to set the table's `tab_id` back-pointer as a new tab opens (design §2b/§3b). TS-2 adds `statusId: null` to that SAME write, so a "needs-cleaning" set while the table was free clears as the next party sits (design §3b(2)). Locate it:

```bash
grep -n "diningTables\|dining_tables\|tabId\|tab_id" apps/server/src/working-order.ts
```

In `openTab`, find the `dining_tables` update that sets the back-pointer and add `statusId: null` to its `.set({...})`. If TS-1 wrote it as a Drizzle update it becomes:

```typescript
    // TS-1 sets the back-pointer; TS-2 also clears any stale manual status as the new tab opens (§3b(2)).
    await tx
      .update(diningTables)
      .set({ tabId, statusId: null })
      .where(eq(diningTables.id, req.tableId));
```

If TS-1 wrote it as raw SQL, add `, status_id = null` to that statement's `SET` list. Nothing else in `openTab` changes.

> Consumes-from-TS-1 caveat: this edit assumes TS-1's `openTab` performs a `dining_tables` write to set `tab_id` (the revised back-pointer model, TS-1 design §2b). If the on-disk TS-1 landed the older `working_orders.table_id` model instead (Plan note 1), `openTab` sets no `dining_tables` row and this clear must be added as its own `UPDATE dining_tables SET status_id = NULL WHERE id = req.tableId` — and Step 2's trigger must key on that model. Reconcile against the landed TS-1 before implementing.

- [ ] **Step 4: Write the trigger + openTab-clear test (real Postgres, prove-by-deletion).** Real PG because the trigger runs under the non-superuser `app_user` and the same-tenant RLS write is a false pass on PGlite (CLAUDE.md §4). It seeds a location, TWO dining tables, an order, and a status, then simulates a TS-3 join by pointing BOTH tables' `tab_id` at the one order (TS-1 only ever sets one per tab, but the trigger must clear ALL — `WHERE tab_id = NEW.id`, future-proofing the join). Mirror `packages/layouts/src/store.rls.test.ts`'s `useRealPostgres`/`asApp` scaffolding.

`apps/server/src/clear-table-status.rls.test.ts`:

```typescript
// H2 receipt (Step 1): `git diff --stat main -- packages/core/src/record-sale.ts
// packages/fiscal-verifactu/src/backend.ts packages/verifactu/ apps/server/src/till-sale.ts` → no
// changes; `grep -nE 'status_id|statusId|table_service_statuses|tableServiceStatuses'` over those files
// → empty. The reset is a trigger + an openTab edit; the fiscal pay path is byte-unchanged.
import { randomUUID } from "node:crypto";
import { asAppUser, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { runMigrationSets, startMigratedPostgres } from "@waitron/db/testing/postgres.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import "./errors.js";

const suite = useRealPostgres({
  start: () =>
    startMigratedPostgres({
      dockerRequired:
        "The clear-table-status trigger suite requires Docker: the AFTER-UPDATE trigger runs as the " +
        "non-superuser app_user and its same-tenant UPDATE under RLS is a false pass on PGlite.",
      migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
    }),
  timeoutMs: 120_000,
});

function asApp<T>(tenantId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(suite.admin, tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

let tenantId = "";
let tillId = "";
let nodeId = "";
let locationId = "";

async function statusOf(tableId: string): Promise<string | null> {
  const { rows } = await suite.admin.execute<{ status_id: string | null }>(
    sql`select status_id from dining_tables where id = ${tableId}`,
  );
  return rows[0]!.status_id;
}

beforeAll(async () => {
  tenantId = await seedTenant(suite.admin);
  const loc = await suite.admin.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Loc', array['es'], 'Hostelería') returning id`);
  locationId = loc.rows[0]!.id;
  const till = await suite.admin.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'A1') returning id`);
  tillId = till.rows[0]!.id;
  nodeId = await seedNode(suite.admin, tenantId, brandLocationId(locationId));
});

/** Seed a status + an open working order + N tables whose tab_id points at that order, each carrying the
 *  status. Returns { orderId, tableIds }. `orderSeq` keeps order_number unique. */
let orderSeq = 0;
async function seedJoinedTab(tableCount: number): Promise<{ orderId: string; tableIds: string[] }> {
  orderSeq += 1;
  return asApp(tenantId, async (tx) => {
    const statusId = (
      await tx.execute<{ id: string }>(
        sql`insert into table_service_statuses (tenant_id, label, color) values (${tenantId}, ${"Bill " + randomUUID()}, '#ef4444') returning id`,
      )
    ).rows[0]!.id;
    const orderId = (
      await tx.execute<{ id: string }>(sql`
        insert into working_orders (tenant_id, till_id, node_id, order_number, status)
        values (${tenantId}, ${tillId}, ${nodeId}, ${orderSeq}, 'open') returning id`)
    ).rows[0]!.id;
    const tableIds: string[] = [];
    for (let i = 0; i < tableCount; i += 1) {
      const t = (
        await tx.execute<{ id: string }>(sql`
          insert into dining_tables (tenant_id, location_id, label, tab_id, status_id)
          values (${tenantId}, ${locationId}, ${"T-" + randomUUID()}, ${orderId}, ${statusId}) returning id`)
      ).rows[0]!.id;
      tableIds.push(t);
    }
    return { orderId, tableIds };
  });
}

describe("working_orders_clear_table_status (reset-on-turnover)", () => {
  it("settling a tab that covers TWO joined tables clears status_id on BOTH", async () => {
    const { orderId, tableIds } = await seedJoinedTab(2);
    expect(await statusOf(tableIds[0]!)).not.toBeNull();
    expect(await statusOf(tableIds[1]!)).not.toBeNull();

    await asApp(tenantId, (tx) =>
      tx.execute(sql`update working_orders set status = 'settled', settled_at = now() where id = ${orderId}`),
    );
    expect(await statusOf(tableIds[0]!)).toBeNull();
    expect(await statusOf(tableIds[1]!)).toBeNull();
  });

  it("abandoning a tab clears its table's status too", async () => {
    const { orderId, tableIds } = await seedJoinedTab(1);
    await asApp(tenantId, (tx) =>
      tx.execute(sql`update working_orders set status = 'abandoned' where id = ${orderId}`),
    );
    expect(await statusOf(tableIds[0]!)).toBeNull();
  });

  it("a status on a FREE table is NOT cleared when an UNRELATED tab settles (needs-cleaning still shows)", async () => {
    // A free table (no tab) carrying a status.
    const { orderId } = await seedJoinedTab(1); // the tab that will settle
    const freeTable = await asApp(tenantId, async (tx) => {
      const statusId = (
        await tx.execute<{ id: string }>(
          sql`insert into table_service_statuses (tenant_id, label, color) values (${tenantId}, ${"Clean " + randomUUID()}, '#f59e0b') returning id`,
        )
      ).rows[0]!.id;
      return (
        await tx.execute<{ id: string }>(sql`
          insert into dining_tables (tenant_id, location_id, label, status_id)
          values (${tenantId}, ${locationId}, ${"Free-" + randomUUID()}, ${statusId}) returning id`)
      ).rows[0]!.id;
    });
    await asApp(tenantId, (tx) =>
      tx.execute(sql`update working_orders set status = 'settled', settled_at = now() where id = ${orderId}`),
    );
    // The unrelated free table keeps its status — the trigger clears only tables whose tab_id = the order.
    expect(await statusOf(freeTable)).not.toBeNull();
  });
});
```

- [ ] **Step 5: Run the trigger test, then prove it by deletion.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test clear-table-status.rls`
Expected: PASS (3 tests). To PROVE the trigger is the guard: in the migration, temporarily comment out the `CREATE TRIGGER working_orders_clear_table_status ...` statement (leave the function), rebuild the DB, rerun → the "settling a tab ... clears BOTH" and abandon cases FAIL (the statuses linger). Restore. (An equivalent in-test deletion: `await suite.admin.execute(sql\`drop trigger working_orders_clear_table_status on working_orders\`)` inside a case, then settle → the status lingers; but the migration-level deletion is the definitive one.)

- [ ] **Step 6: Prove the `openTab` status-clear (PGlite).** The `openTab` edit (Step 3) is verb-level column logic — no RLS needed (a plain `dining_tables` column write) — so it is proven in the PGlite suite `apps/server/src/set-table-status.test.ts` (Task 4), which already builds a `cfg`, seeds a table + an active status, and has `statusOf`. Add `import { openTab } from "./working-order.js";` there and append:

```typescript
describe("openTab clears a stale status (design §3b(2))", () => {
  it("a status set while the table is free is cleared when the next party opens a tab", async () => {
    const { cfg, tableId, activeStatusId } = await setupVenue();
    await asApp(cfg, (tx) => setTableStatus(tx, cfg, tableId, activeStatusId));
    expect(await statusOf(tableId)).toBe(activeStatusId);
    // Opening an EMPTY tab (no initial round) needs no product — it just anchors the tab to the table
    // and (TS-2's Step 3 edit) clears any stale manual status.
    await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    expect(await statusOf(tableId)).toBeNull();
  });
});
```

Run: `pnpm --filter @waitron/server test set-table-status.test`
Expected: PASS. Prove-by-deletion: revert Step 3's `statusId: null` addition → this case FAILS (the stale status survives the new tab). Restore.

- [ ] **Step 7: Package gates + commit.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage` (the migration is `packages/db`) and `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`, plus `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` (the trigger must not disturb it).
Expected: all PASS.

```bash
git add packages/db/drizzle/ apps/server/src/working-order.ts apps/server/src/clear-table-status.rls.test.ts apps/server/src/set-table-status.test.ts
git commit -s -m "feat(db,server): reset-on-turnover trigger + openTab status-clear (TS-2)"
```

---

## Task 6: Fold the status into `listTablesWithState`

**Files:**
- Modify: `apps/server/src/working-order.ts` (Consumes from TS-1)
- Test: `apps/server/src/set-table-status.test.ts` (extend — the read reflects the status) OR TS-1's `tabs.test.ts`

**Interfaces:**
- Consumes (from TS-1): `listTablesWithState(tx, cfg, locationId?): Promise<TableState[]>` and its `TableState` interface, both in `apps/server/src/working-order.ts`.
- Produces: `TableState` gains `status: { id: string; label: string; color: string } | null`; the query LEFT JOINs `table_service_statuses` on `dining_tables.status_id`.

- [ ] **Step 1: Write the failing read test (PGlite).** Add to `apps/server/src/set-table-status.test.ts` (import `listTablesWithState` from `./working-order.js`). It proves the joined status shows on a FREE table (occupancy and manual status are independent — design §4) and is absent when unset.

```typescript
import { listTablesWithState } from "./working-order.js";

describe("listTablesWithState folds in the manual status", () => {
  it("returns status: { id, label, color } for a table with a status set, null otherwise", async () => {
    const { cfg, tableId, activeStatusId } = await setupVenue();

    const before = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    expect(before.find((t) => t.id === tableId)).toMatchObject({ state: "free", status: null });

    await asApp(cfg, (tx) => setTableStatus(tx, cfg, tableId, activeStatusId));
    const after = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    // A FREE table still shows its manual status — occupancy and status are independent (design §4).
    expect(after.find((t) => t.id === tableId)).toMatchObject({
      state: "free",
      status: { id: activeStatusId, label: "Bill requested", color: "#ef4444" },
    });
  });
});
```

- [ ] **Step 2: Run — see it fail.**

Run: `pnpm --filter @waitron/server test set-table-status.test`
Expected: FAIL — `status` is not a property of `TableState` (typecheck) / the returned rows have no `status`.

- [ ] **Step 3: Extend `TableState` and the query.** In `apps/server/src/working-order.ts`, add the field to the `TableState` interface (from TS-1):

```typescript
  /** The table's MANUAL service status (design §4), or null. Independent of occupancy — a `free` table
   *  may carry one. Joined from `table_service_statuses` on `dining_tables.status_id`. */
  status: { id: string; label: string; color: string } | null;
```

Extend the `listTablesWithState` raw-row type with three columns:

```typescript
    status_id: string | null;
    status_label: string | null;
    status_color: string | null;
```

Add the three columns to the `select` list and a LEFT JOIN on `table_service_statuses` (additive — it does not touch the TS-1 occupancy joins):

```sql
      tss.id as status_id, tss.label as status_label, tss.color as status_color,
```

```sql
    left join table_service_statuses tss
      on tss.tenant_id = dt.tenant_id and tss.id = dt.status_id
```

And add `status` to the mapper's returned object:

```typescript
      status:
        r.status_id !== null
          ? { id: r.status_id, label: r.status_label!, color: r.status_color! }
          : null,
```

> The three `status_*` columns are on `dining_tables`'s own row (one status per table), so the LEFT JOIN adds no row multiplication and needs no `group by` change. Place the join before the existing `where dt.location_id = ...` clause, alongside TS-1's lateral joins.

- [ ] **Step 4: Run — see it pass.**

Run: `pnpm --filter @waitron/server test set-table-status.test`
Expected: PASS. Prove the join is load-bearing: temporarily hardcode `status: null` in the mapper and rerun → the "returns status" case FAILS. Restore.

- [ ] **Step 5: Package coverage + commit.**

Run: `pnpm --filter @waitron/server test:coverage`
Expected: PASS at 98/98/98/95.

```bash
git add apps/server/src/working-order.ts apps/server/src/set-table-status.test.ts
git commit -s -m "feat(server): fold manual status into listTablesWithState (TS-2)"
```

---

## Task 7: Dashboard config editor (mirror the #81 layout/receipt editors)

**Files:**
- Create: `apps/dashboard/src/screens/service-status-screen.ts`, `apps/dashboard/src/screens/service-status-screen.test.ts`, `apps/dashboard/src/screens/service-status-screen.a11y.test.ts`
- Modify: `apps/dashboard/src/api/client.ts` (+ `client.test.ts`), `apps/dashboard/src/i18n/strings.ts`, `apps/dashboard/src/i18n/codes.ts`, `apps/dashboard/src/dashboard-app.ts` (+ `dashboard-app.test.ts`)

**Interfaces:**
- Consumes (server, Task 8): `GET/POST /management-api/service-statuses`, `PATCH/DELETE /management-api/service-statuses/:id`.
- Produces:
  - `DashboardApi.listStatuses()`, `.createStatus({ label, color, displayOrder? })`, `.updateStatus(id, patch)`, `.deactivateStatus(id)`; `interface ServiceStatus` (browser-local copy).
  - `<dashboard-service-status-screen>` Lit element (class `ServiceStatusScreen`), wired into the shell.

> Pattern reference: this editor is a **Lit web component** (like `layout-screen`/`receipt-screen`), NOT React. It follows the per-item-CRUD shape (call one endpoint per mutation, then reload — the `category-manager` idiom), because Task 8's routes are per-item POST/PATCH/DELETE, not a single bulk PUT. The dashboard tests run in a **real browser** (Playwright/Chromium); coverage thresholds are **95/95/90/88** global (not per-file).

- [ ] **Step 1: Add the API client methods + type (and their tests).** In `apps/dashboard/src/api/client.ts`, add the browser-local type (do NOT import from `@waitron/*` — the client keeps local copies) beside the other config types, and the four methods beside `getLayout`/`putLayout`/`putReceipt`:

```typescript
/** A configured service status (mirrors apps/server's ServiceStatus; browser-local copy). */
export interface ServiceStatus {
  id: string;
  label: string;
  color: string;
  displayOrder: number;
  active: boolean;
  createdAt: string;
}
```

```typescript
  listStatuses(): Promise<ServiceStatus[]> {
    return this.#request<ServiceStatus[]>("/management-api/service-statuses", "GET");
  }

  createStatus(input: { label: string; color: string; displayOrder?: number }): Promise<{ id: string }> {
    return this.#request<{ id: string }>("/management-api/service-statuses", "POST", input);
  }

  updateStatus(
    id: string,
    patch: { label?: string; color?: string; displayOrder?: number; active?: boolean },
  ): Promise<void> {
    return this.#request<void>(`/management-api/service-statuses/${id}`, "PATCH", patch);
  }

  deactivateStatus(id: string): Promise<void> {
    return this.#request<void>(`/management-api/service-statuses/${id}`, "DELETE");
  }
```

Add to `apps/dashboard/src/api/client.test.ts` (mock `fetchImpl`, assert URL/method/body/`credentials: "include"` and the `{ code }` rejection path) — mirror the existing `putLayout`/`getLayout` client tests:

```typescript
  it("listStatuses GETs /management-api/service-statuses with credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    await new DashboardApi("", fetchImpl).listStatuses();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/service-statuses", expect.objectContaining({ method: "GET", credentials: "include" }));
  });

  it("createStatus POSTs the body and returns the id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "s1" }), { status: 200 }));
    const res = await new DashboardApi("", fetchImpl).createStatus({ label: "Bill requested", color: "#ef4444", displayOrder: 0 });
    expect(res).toEqual({ id: "s1" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/service-statuses", expect.objectContaining({ method: "POST" }));
  });

  it("rejects with { code } on a non-2xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "status.label_taken" } }), { status: 409 }));
    await expect(new DashboardApi("", fetchImpl).createStatus({ label: "x", color: "#000" })).rejects.toMatchObject({ code: "status.label_taken" });
  });
```

- [ ] **Step 2: Add the i18n strings + error codes.** In `apps/dashboard/src/i18n/strings.ts`, add to BOTH `en` and `es` (a missing `es` key is a compile error):

```typescript
  // en:
  "status.title": "Service statuses",
  "status.label": "Label",
  "status.color": "Colour",
  "status.display_order": "Order",
  "status.active": "Active",
  "status.new_label": "New status",
  "status.new_color": "Colour",
  "nav.statuses": "Statuses",
  "action.deactivate": "Deactivate",
```

```typescript
  // es:
  "status.title": "Estados de servicio",
  "status.label": "Etiqueta",
  "status.color": "Color",
  "status.display_order": "Orden",
  "status.active": "Activo",
  "status.new_label": "Nuevo estado",
  "status.new_color": "Color",
  "nav.statuses": "Estados",
  "action.deactivate": "Desactivar",
```

> `action.save` and `action.create` already exist (per the layout/receipt editors). If `grep -n "action.deactivate" apps/dashboard/src/i18n/strings.ts` finds it already present, skip that pair.

In `apps/dashboard/src/i18n/codes.ts`, add the three server reject codes to `CODE_MESSAGES` (or `codeMessage` degrades them to the generic sentence):

```typescript
  "status.label_taken": { en: "A status with that name already exists", es: "Ya existe un estado con ese nombre" },
  "status.not_found": { en: "That status no longer exists", es: "Ese estado ya no existe" },
  "status.inactive": { en: "That status is deactivated", es: "Ese estado está desactivado" },
```

> Confirm `management.request_invalid` and `authorization.not_permitted` are already in `CODE_MESSAGES` (the layout/receipt/staff editors surface them); if either is missing, add it with both columns.

- [ ] **Step 3: Write the failing screen test.** Mirror `receipt-screen.test.ts`: stub `DashboardApi` as `vi.fn()` spies cast through `unknown`, `mountWidget`, `flush`, select on `data-test`, reach `errorKey` via the private-state cast.

`apps/dashboard/src/screens/service-status-screen.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import type { DashboardApi, ServiceStatus } from "../api/client.js";
import { ServiceStatusScreen } from "./service-status-screen.js";

afterEach(cleanupWidgets);

const SEED: ServiceStatus[] = [
  { id: "s1", label: "Bill requested", color: "#ef4444", displayOrder: 0, active: true, createdAt: "2026-08-17T00:00:00Z" },
];

function stubApi(overrides: Partial<DashboardApi> = {}, list: ServiceStatus[] = SEED): DashboardApi {
  return {
    listStatuses: vi.fn().mockResolvedValue(list.map((s) => ({ ...s }))),
    createStatus: vi.fn().mockResolvedValue({ id: "s2" }),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    deactivateStatus: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: ServiceStatusScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}
const q = (el: ServiceStatusScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);
const errorKey = (el: ServiceStatusScreen) => (el as unknown as { errorKey: string | null }).errorKey;

function type(el: ServiceStatusScreen, sel: string, value: string): void {
  q(el, sel)!.dispatchEvent(new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }));
}

describe("service-status-screen", () => {
  it("loads and lists the configured statuses on connect", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ServiceStatusScreen>("dashboard-service-status-screen", { api });
    await flush(el);
    expect(q(el, "[data-test=row-s1]")).not.toBeNull();
    expect(el.shadowRoot!.querySelectorAll("h1").length).toBe(1);
  });

  it("creates a status from the new-status form, then reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ServiceStatusScreen>("dashboard-service-status-screen", { api });
    await flush(el);
    type(el, "[data-test=new-label]", "Needs cleaning");
    type(el, "[data-test=new-color]", "#f59e0b");
    q(el, "[data-test=add]")!.click();
    await flush(el);
    expect(api.createStatus).toHaveBeenCalledWith({ label: "Needs cleaning", color: "#f59e0b", displayOrder: 1 });
    expect(api.listStatuses).toHaveBeenCalledTimes(2); // initial + reload after create
  });

  it("does not create an empty-label status", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ServiceStatusScreen>("dashboard-service-status-screen", { api });
    await flush(el);
    q(el, "[data-test=add]")!.click();
    await flush(el);
    expect(api.createStatus).not.toHaveBeenCalled();
  });

  it("saves an edited row (updateStatus with the row's values), then reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ServiceStatusScreen>("dashboard-service-status-screen", { api });
    await flush(el);
    type(el, "[data-test=label-s1]", "Bill please");
    q(el, "[data-test=save-s1]")!.click();
    await flush(el);
    expect(api.updateStatus).toHaveBeenCalledWith("s1", expect.objectContaining({ label: "Bill please", active: true }));
  });

  it("deactivates a row", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ServiceStatusScreen>("dashboard-service-status-screen", { api });
    await flush(el);
    q(el, "[data-test=deactivate-s1]")!.click();
    await flush(el);
    expect(api.deactivateStatus).toHaveBeenCalledWith("s1");
  });

  it("surfaces a rejected create as a localised role=alert (never the raw code)", async () => {
    const api = stubApi({ createStatus: vi.fn().mockRejectedValue({ code: "status.label_taken" }) });
    const { el } = await mountWidget<ServiceStatusScreen>("dashboard-service-status-screen", { api });
    await flush(el);
    type(el, "[data-test=new-label]", "Bill requested");
    q(el, "[data-test=add]")!.click();
    await flush(el);
    expect(errorKey(el)).toBe("status.label_taken");
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("status.label_taken", "es-ES"));
    expect(banner).not.toContain("status.label_taken");
  });

  it("a rejected initial load shows the error banner and does not throw", async () => {
    const api = stubApi({ listStatuses: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<ServiceStatusScreen>("dashboard-service-status-screen", { api });
    await flush(el);
    expect(errorKey(el)).toBe("server.internal");
  });

  it("field-change events do not leak past the host (stopPropagation)", async () => {
    const api = stubApi();
    const { el, host } = await mountWidget<ServiceStatusScreen>("dashboard-service-status-screen", { api });
    await flush(el);
    let leaked = false;
    host.addEventListener("wt-change", () => (leaked = true));
    type(el, "[data-test=new-label]", "X");
    expect(leaked).toBe(false);
  });
});
```

- [ ] **Step 4: Run — see it fail (element not defined).**

Run: `pnpm --filter @waitron/dashboard test service-status-screen.test`
Expected: FAIL — `dashboard-service-status-screen` is not a registered element / `ServiceStatusScreen` not found.

- [ ] **Step 5: Implement the screen.**

`apps/dashboard/src/screens/service-status-screen.ts`:

```typescript
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-card.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { DashboardApi, ServiceStatus } from "../api/client.js";

/** A row the editor holds in local, editable state (a defensive copy of the loaded ServiceStatus). */
interface EditableStatus {
  id: string;
  label: string;
  color: string;
  displayOrder: number;
  active: boolean;
}

/**
 * The dashboard's service-status editor (design §3a), mirroring `receipt-screen`/`layout-screen`. It
 * lists the tenant's configured statuses (active + inactive), lets a manager edit each row
 * (label/colour/order/active) + a "new status" form, and calls the per-item CRUD on the injected
 * `api`, reloading after each mutation (the `category-manager` idiom — Task 8's routes are per-item,
 * not a bulk PUT). Gating is server-side (`till.configure`): the shell hides this nav from a `staff`
 * session, and every route re-checks; a rejected call surfaces as a localised `role=alert`.
 */
@customElement("dashboard-service-status-screen")
export class ServiceStatusScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .title {
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      ol {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--wt-space-2);
      }
      .row {
        display: flex;
        gap: var(--wt-space-2);
        align-items: center;
        flex-wrap: wrap;
      }
      .new {
        display: flex;
        gap: var(--wt-space-2);
        align-items: end;
        margin-top: var(--wt-space-3);
        flex-wrap: wrap;
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];

  /** The HTTP face of the dashboard. The app shell injects a real client; a test injects a stub. */
  @property({ attribute: false }) api!: DashboardApi;

  @state() private statuses: EditableStatus[] = [];
  @state() private newLabel = "";
  @state() private newColor = "#ef4444";
  @state() private errorKey: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      const rows = await this.api.listStatuses();
      this.statuses = rows.map((s: ServiceStatus) => ({
        id: s.id,
        label: s.label,
        color: s.color,
        displayOrder: s.displayOrder,
        active: s.active,
      }));
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  #onNewLabel(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.newLabel = event.detail.value;
  }

  #onNewColor(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.newColor = event.detail.value;
  }

  async #create(): Promise<void> {
    this.errorKey = null;
    const label = this.newLabel.trim();
    if (label === "") return;
    try {
      await this.api.createStatus({ label, color: this.newColor, displayOrder: this.statuses.length });
      this.newLabel = "";
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  #edit(id: string, patch: Partial<EditableStatus>): void {
    this.statuses = this.statuses.map((s) => (s.id === id ? { ...s, ...patch } : s));
  }

  async #saveRow(row: EditableStatus): Promise<void> {
    this.errorKey = null;
    try {
      await this.api.updateStatus(row.id, {
        label: row.label,
        color: row.color,
        displayOrder: row.displayOrder,
        active: row.active,
      });
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  async #deactivate(id: string): Promise<void> {
    this.errorKey = null;
    try {
      await this.api.deactivateStatus(id);
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  override render(): TemplateResult {
    return html`
      <h1 class="title">${t("status.title")}</h1>
      <ol>
        ${this.statuses.map(
          (s) => html`
            <li data-test="row-${s.id}">
              <wt-card>
                <div class="row">
                  <wt-input
                    label=${t("status.label")}
                    data-test="label-${s.id}"
                    .value=${s.label}
                    @wt-change=${(e: CustomEvent<{ value: string }>) => {
                      e.stopPropagation();
                      this.#edit(s.id, { label: e.detail.value });
                    }}
                  ></wt-input>
                  <wt-input
                    type="color"
                    label=${t("status.color")}
                    data-test="color-${s.id}"
                    .value=${s.color}
                    @wt-change=${(e: CustomEvent<{ value: string }>) => {
                      e.stopPropagation();
                      this.#edit(s.id, { color: e.detail.value });
                    }}
                  ></wt-input>
                  <wt-input
                    type="number"
                    label=${t("status.display_order")}
                    data-test="order-${s.id}"
                    .value=${String(s.displayOrder)}
                    @wt-change=${(e: CustomEvent<{ value: string }>) => {
                      e.stopPropagation();
                      this.#edit(s.id, { displayOrder: Number(e.detail.value) || 0 });
                    }}
                  ></wt-input>
                  <wt-switch
                    label=${t("status.active")}
                    data-test="active-${s.id}"
                    .checked=${s.active}
                    @wt-change=${(e: CustomEvent<{ checked: boolean }>) => {
                      e.stopPropagation();
                      this.#edit(s.id, { active: e.detail.checked });
                    }}
                  ></wt-switch>
                  <wt-button
                    variant="primary"
                    size="sm"
                    data-test="save-${s.id}"
                    @click=${() => void this.#saveRow(s)}
                    >${t("action.save")}</wt-button
                  >
                  <wt-button
                    variant="danger"
                    size="sm"
                    data-test="deactivate-${s.id}"
                    ?disabled=${!s.active}
                    @click=${() => void this.#deactivate(s.id)}
                    >${t("action.deactivate")}</wt-button
                  >
                </div>
              </wt-card>
            </li>
          `,
        )}
      </ol>

      <div class="new">
        <wt-input
          label=${t("status.new_label")}
          data-test="new-label"
          .value=${this.newLabel}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onNewLabel(e)}
        ></wt-input>
        <wt-input
          type="color"
          label=${t("status.new_color")}
          data-test="new-color"
          .value=${this.newColor}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onNewColor(e)}
        ></wt-input>
        <wt-button variant="primary" data-test="add" @click=${() => void this.#create()}
          >${t("action.create")}</wt-button
        >
      </div>

      ${this.errorKey ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>` : nothing}
    `;
  }
}

/** The raw wire `code` of a rejected `api` call, defaulting to `server.internal` (mirrors receipt-screen). */
function codeOf(error: unknown): string {
  return (error as { code?: string }).code ?? "server.internal";
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-service-status-screen": ServiceStatusScreen;
  }
}
```

- [ ] **Step 6: Run — see it pass.**

Run: `pnpm --filter @waitron/dashboard test service-status-screen.test`
Expected: PASS (8 tests). Prove the `stopPropagation` guard by deletion: remove one handler's `e.stopPropagation()`, rerun → the leak test FAILS. Restore.

- [ ] **Step 7: Write the a11y test.** Mirror `receipt-screen.a11y.test.ts`: `describe.each(["light","dark"])`, mount by tag (side-effect import + type import), stub API that RESOLVES, scan each visual shape against `host`.

`apps/dashboard/src/screens/service-status-screen.a11y.test.ts`:

```typescript
import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./service-status-screen.js";
import type { ServiceStatusScreen } from "./service-status-screen.js";
import type { DashboardApi, ServiceStatus } from "../api/client.js";

afterEach(cleanupWidgets);

const SEED: ServiceStatus[] = [
  { id: "s1", label: "Bill requested", color: "#ef4444", displayOrder: 0, active: true, createdAt: "2026-08-17T00:00:00Z" },
  { id: "s2", label: "Needs cleaning", color: "#f59e0b", displayOrder: 1, active: false, createdAt: "2026-08-17T00:00:00Z" },
];

function stubApi(list: ServiceStatus[]): DashboardApi {
  return {
    listStatuses: vi.fn().mockResolvedValue(list.map((s) => ({ ...s }))),
    createStatus: vi.fn().mockResolvedValue({ id: "s3" }),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    deactivateStatus: vi.fn().mockResolvedValue(undefined),
  } as unknown as DashboardApi;
}

async function flush(el: ServiceStatusScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

describe.each(["light", "dark"] as const)("service-status-screen a11y (%s theme)", (theme) => {
  it("renders accessibly with a populated list", async () => {
    const { el, host } = await mountWidget<ServiceStatusScreen>(
      "dashboard-service-status-screen",
      { api: stubApi(SEED) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with an empty list", async () => {
    const { el, host } = await mountWidget<ServiceStatusScreen>(
      "dashboard-service-status-screen",
      { api: stubApi([]) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with the error banner shown", async () => {
    const api = { ...stubApi(SEED), createStatus: vi.fn().mockRejectedValue({ code: "status.label_taken" }) } as unknown as DashboardApi;
    const { el, host } = await mountWidget<ServiceStatusScreen>("dashboard-service-status-screen", { api }, theme);
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=new-label]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Bill requested" }, bubbles: true, composed: true }),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
```

- [ ] **Step 8: Run the a11y test.**

Run: `pnpm --filter @waitron/dashboard test service-status-screen.a11y`
Expected: PASS (6 cases — 3 shapes × 2 themes). If axe flags a colour-contrast finding, it means a hardcoded colour slipped in — every colour must be a `--wt-*` token (the native `type="color"` swatch is the browser's own control and is a11y-exempt).

- [ ] **Step 9: Wire the screen into the shell (5 spots) + update the shell test.** In `apps/dashboard/src/dashboard-app.ts`:

1. Side-effect import beside the other screens:

```typescript
import "./screens/service-status-screen.js";
```

2. Add to the `Screen` union type:

```typescript
  | "statuses"
```

3. A nav button in `#nav()` (mirror the receipt button):

```typescript
        <wt-button
          variant=${this.screen === "statuses" ? "primary" : "secondary"}
          data-test="nav-statuses"
          @click=${() => (this.screen = "statuses")}
          >${t("nav.statuses")}</wt-button
        >
```

4. A `case` in `#renderScreen()`:

```typescript
      case "statuses":
        return html`<dashboard-service-status-screen .api=${this.api}></dashboard-service-status-screen>`;
```

5. Update `apps/dashboard/src/dashboard-app.test.ts` — add `nav-statuses` to whatever assertion enumerates the nav buttons / navigates to each screen, so the "exactly one `<h1>` at a time" and nav-wiring invariants still hold. Follow the existing `nav-receipt` assertion as the template.

- [ ] **Step 10: Run the dashboard package green + commit.**

Run: `pnpm --filter @waitron/dashboard test:coverage`
Expected: PASS at 95/95/90/88. If a branch is uncovered (e.g. the empty-label early return, the load-error path), the screen test above already exercises each — confirm the per-file table if the global gate dips.

```bash
git add apps/dashboard/src/screens/service-status-screen.ts apps/dashboard/src/screens/service-status-screen.test.ts apps/dashboard/src/screens/service-status-screen.a11y.test.ts apps/dashboard/src/api/client.ts apps/dashboard/src/api/client.test.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/i18n/codes.ts apps/dashboard/src/dashboard-app.ts apps/dashboard/src/dashboard-app.test.ts
git commit -s -m "feat(dashboard): service-status config editor (TS-2)"
```

---

## Task 8: HTTP routes — till `setTableStatus` + management config CRUD (session + isUuid guards)

**Files:**
- Modify: `apps/server/src/till-api.ts` (the `setTableStatus` route + `STATUS` map)
- Modify: `apps/server/src/management-api.ts` (the four config routes + `STATUS` map)
- Test: `apps/server/src/till-api.status.test.ts`, `apps/server/src/management-api.status.test.ts`

**Interfaces:**
- Consumes: `setTableStatus` (Task 4); `createStatus`/`listStatuses`/`updateStatus`/`deactivateStatus` (Task 3); `isUuid` (`till-session.ts`); `requireSession` (`till-session.ts`); `requireManagementSession` (`management-session.ts`); `AppError`.
- Produces:
  - Till surface: `POST /api/tables/:id/status` (body `{ statusId: string | null }`), SESSION-GUARDED.
  - Management surface: `POST/GET /management-api/service-statuses`, `PATCH/DELETE /management-api/service-statuses/:id`, all `requireManagementSession`-gated (the verbs' own `authorizeManager` enforces `till.configure`).
  - `STATUS` map entries: till `status.not_found`→404, `status.inactive`→409; management `status.not_found`→404, `status.label_taken`→409.

- [ ] **Step 1: Write the failing till-route test.** Mirror TS-1's `till-api.tables.test.ts` harness (a PGlite `mountTillApi` app with a logged-in session cookie + a seeded venue + `request(path, init)` helper). Add a seeded status.

`apps/server/src/till-api.status.test.ts` (structure — reuse TS-1's `till-api.tables.test.ts` harness verbatim):

```typescript
// ... reuse the till-api harness: a PGlite mountTillApi app, a logged-in session cookie, a seeded
// venue + one dining table (TABLE_ID) + one active status (STATUS_ID, seeded via an owner insert into
// table_service_statuses), and a `request(path, init)` helper. Then:

describe("POST /api/tables/:id/status", () => {
  it("sets a table's status (200) and GET /api/tables/state reflects it", async () => {
    const res = await request(`/api/tables/${TABLE_ID}/status`, { method: "POST", body: JSON.stringify({ statusId: STATUS_ID }) });
    expect(res.status).toBe(200);
    const state = await (await request("/api/tables/state")).json();
    expect(state.find((t: { id: string }) => t.id === TABLE_ID).status).toMatchObject({ id: STATUS_ID });
  });

  it("clears a table's status with { statusId: null } (200)", async () => {
    await request(`/api/tables/${TABLE_ID}/status`, { method: "POST", body: JSON.stringify({ statusId: STATUS_ID }) });
    const res = await request(`/api/tables/${TABLE_ID}/status`, { method: "POST", body: JSON.stringify({ statusId: null }) });
    expect(res.status).toBe(200);
    const state = await (await request("/api/tables/state")).json();
    expect(state.find((t: { id: string }) => t.id === TABLE_ID).status).toBeNull();
  });

  it("a deactivated status → 409 status.inactive", async () => {
    // Deactivate STATUS_ID (owner write), then setting it is refused.
    await deactivate(STATUS_ID); // helper: owner update table_service_statuses set active=false
    const res = await request(`/api/tables/${TABLE_ID}/status`, { method: "POST", body: JSON.stringify({ statusId: STATUS_ID }) });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("status.inactive");
  });

  it("a malformed :id → 404 table.not_found (isUuid guard, not a 500)", async () => {
    const res = await request("/api/tables/not-a-uuid/status", { method: "POST", body: JSON.stringify({ statusId: null }) });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("table.not_found");
  });

  it("an unknown status uuid → 404 status.not_found", async () => {
    const res = await request(`/api/tables/${TABLE_ID}/status`, { method: "POST", body: JSON.stringify({ statusId: "00000000-0000-4000-8000-000000000000" }) });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("status.not_found");
  });
});
```

- [ ] **Step 2: Run — see it fail (route unmounted).**

Run: `pnpm --filter @waitron/server test till-api.status`
Expected: FAIL — `POST /api/tables/:id/status` is not mounted.

- [ ] **Step 3: Extend the till `STATUS` map + mount the route.** In `apps/server/src/till-api.ts`, add to the `STATUS` object (`table.not_found` is already present from TS-1):

```typescript
  "status.not_found": 404,
  "status.inactive": 409,
```

Add `setTableStatus` to the `./tables.js` import (TS-1 already imports the table CRUD there), and mount the route inside `mountTillApi` (SESSION-GUARDED; `:id` screened with `isUuid` to `table.not_found` — a malformed table id names no table; the body's `statusId` accepts a uuid or `null`):

```typescript
  // Set (or clear) a table's manual service status (design §3b). SESSION-GUARDED. A malformed :id →
  // table.not_found (a bad table id names no table). `setTableStatus` throws table.not_found /
  // status.not_found / status.inactive. Body: { statusId: string | null }.
  app.post("/api/tables/:id/status", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      const body = await c.req.json<{ statusId: string | null }>();
      const statusId = body.statusId ?? null;
      // A present-but-malformed statusId is screened to status.not_found (it names no status), not a 500.
      if (statusId !== null && !isUuid(statusId)) throw new AppError("status.not_found", { statusId });
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await setTableStatus(tx, deps.cfg, id, statusId);
      });
      return c.body(null, 200);
    }),
  );
```

- [ ] **Step 4: Run — see the till route pass, prove the isUuid guard by deletion.**

Run: `pnpm --filter @waitron/server test till-api.status`
Expected: PASS. Prove the `:id` guard: remove the `if (!isUuid(id))` line, rerun → the malformed-`:id` test FAILS with a 500 (raw `22P02`) instead of 404. Restore.

- [ ] **Step 5: Write the failing management-route test.** Mirror `apps/server/src/management-api.rls.test.ts` (or `management-api`'s existing route test harness): a `mountManagementApi` app with a manager management-session cookie + a seeded tenant. Cover create + list, a duplicate label → 409, an unknown-id PATCH → 404, a malformed `:id` → 404, and a staff-session create → 403.

`apps/server/src/management-api.status.test.ts` (structure — reuse the management-api route harness):

```typescript
// ... reuse the management-api harness: a mountManagementApi app, a manager session cookie
// (managerCookie) and a staff session cookie (staffCookie), and a `request(path, init, cookie)` helper.
// Then:

describe("/management-api/service-statuses", () => {
  it("POST creates + GET lists (manager)", async () => {
    const create = await request("/management-api/service-statuses", { method: "POST", body: JSON.stringify({ label: "Bill requested", color: "#ef4444", displayOrder: 0 }) }, managerCookie);
    expect(create.status).toBe(200);
    const { id } = await create.json();
    const list = await (await request("/management-api/service-statuses", {}, managerCookie)).json();
    expect(list.find((s: { id: string }) => s.id === id)).toMatchObject({ label: "Bill requested", active: true });
  });

  it("POST with a duplicate label → 409 status.label_taken", async () => {
    await request("/management-api/service-statuses", { method: "POST", body: JSON.stringify({ label: "Reserved", color: "#3b82f6" }) }, managerCookie);
    const dup = await request("/management-api/service-statuses", { method: "POST", body: JSON.stringify({ label: "Reserved", color: "#000" }) }, managerCookie);
    expect(dup.status).toBe(409);
    expect((await dup.json()).code).toBe("status.label_taken");
  });

  it("PATCH an unknown id → 404 status.not_found; a malformed :id → 404 too (isUuid)", async () => {
    const unknown = await request("/management-api/service-statuses/00000000-0000-4000-8000-000000000000", { method: "PATCH", body: JSON.stringify({ label: "X" }) }, managerCookie);
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).code).toBe("status.not_found");
    const malformed = await request("/management-api/service-statuses/not-a-uuid", { method: "PATCH", body: JSON.stringify({ label: "X" }) }, managerCookie);
    expect(malformed.status).toBe(404);
    expect((await malformed.json()).code).toBe("status.not_found");
  });

  it("a staff session is refused (403 authorization.not_permitted)", async () => {
    const res = await request("/management-api/service-statuses", { method: "POST", body: JSON.stringify({ label: "Nope", color: "#000" }) }, staffCookie);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("authorization.not_permitted");
  });

  it("no session → 401", async () => {
    const res = await request("/management-api/service-statuses", { method: "POST", body: JSON.stringify({ label: "Nope", color: "#000" }) }, undefined);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 6: Run — see it fail, then mount the management routes.**

Run: `pnpm --filter @waitron/server test management-api.status`
Expected: FAIL — the routes are not mounted.

In `apps/server/src/management-api.ts`, add to the `STATUS` object:

```typescript
  "status.not_found": 404,
  "status.label_taken": 409,
```

Add the verbs to the `./tables.js` import (a new import in `management-api.ts` — it does not currently import from `./tables.js`) and mount the four routes inside `mountManagementApi` (each `requireManagementSession` first → 401 before any DB work; each DB touch under `withTenant` + `asAppUser`; the verb's own `authorizeManager` enforces `till.configure`; `:id` screened with `isUuid` to `status.not_found`; body-shape screened with `management.request_invalid`, the #81 shape):

```typescript
  // ── Service-status configuration (TS-2) ──────────────────────────────────────────────────────────
  // The dashboard's service-status editor surface (design §3a), mirroring the layout/receipt routes
  // above. All four are gated (`requireManagementSession` → 401 before any DB work); each verb's own
  // `authorizeManager(..., "till.configure")` enforces the write gate under RLS.

  // Create a status. Body { label, color, displayOrder? }; a bad shape → management.request_invalid
  // naming the FIELD; a duplicate label → status.label_taken (409); a bad color → request_invalid.
  app.post("/management-api/service-statuses", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = (await c.req.json<{ label?: unknown; color?: unknown; displayOrder?: unknown }>()) ?? {};
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      if (typeof body.label !== "string") throw new AppError("management.request_invalid", { field: "label" });
      if (typeof body.color !== "string") throw new AppError("management.request_invalid", { field: "color" });
      const displayOrder = body.displayOrder === undefined ? undefined : Number(body.displayOrder);
      if (displayOrder !== undefined && !Number.isInteger(displayOrder)) {
        throw new AppError("management.request_invalid", { field: "displayOrder" });
      }
      const result = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return createStatus(tx, {
          managementSessionId: sessionId,
          tenantId: deps.cfg.tenantId,
          label: body.label,
          color: body.color,
          displayOrder,
        });
      });
      return c.json(result);
    }),
  );

  // The whole status set (active + inactive), for the editor. Gated on till.configure via listStatuses.
  app.get("/management-api/service-statuses", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const statuses = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return listStatuses(tx, { managementSessionId: sessionId, tenantId: deps.cfg.tenantId });
      });
      return c.json(statuses);
    }),
  );

  // Edit a status (label/color/displayOrder/active — any subset). Malformed :id → status.not_found (a
  // bad id names no status), not a 500. A present field with the wrong type → management.request_invalid.
  app.patch("/management-api/service-statuses/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("status.not_found", { statusId: id });
      const body = (await c.req.json<{ label?: unknown; color?: unknown; displayOrder?: unknown; active?: unknown }>()) ?? {};
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      const patch: { managementSessionId: string; tenantId: string; id: string; label?: string; color?: string; displayOrder?: number; active?: boolean } = {
        managementSessionId: sessionId,
        tenantId: deps.cfg.tenantId,
        id,
      };
      if (body.label !== undefined) {
        if (typeof body.label !== "string") throw new AppError("management.request_invalid", { field: "label" });
        patch.label = body.label;
      }
      if (body.color !== undefined) {
        if (typeof body.color !== "string") throw new AppError("management.request_invalid", { field: "color" });
        patch.color = body.color;
      }
      if (body.displayOrder !== undefined) {
        const d = Number(body.displayOrder);
        if (!Number.isInteger(d)) throw new AppError("management.request_invalid", { field: "displayOrder" });
        patch.displayOrder = d;
      }
      if (body.active !== undefined) {
        if (typeof body.active !== "boolean") throw new AppError("management.request_invalid", { field: "active" });
        patch.active = body.active;
      }
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await updateStatus(tx, patch);
      });
      return c.body(null, 204);
    }),
  );

  // Deactivate a status (DELETE = deactivate; app_user holds no hard DELETE). Malformed :id →
  // status.not_found.
  app.delete("/management-api/service-statuses/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("status.not_found", { statusId: id });
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await deactivateStatus(tx, { managementSessionId: sessionId, tenantId: deps.cfg.tenantId, id });
      });
      return c.body(null, 204);
    }),
  );
```

> `AppError`, `asAppUser`, `withTenant`, `isUuid`, `requireManagementSession` and `run` are all already imported/defined in `management-api.ts`. Only the `./tables.js` verbs are a new import.

- [ ] **Step 7: Run — see it pass, prove the management `:id` guard by deletion.**

Run: `pnpm --filter @waitron/server test management-api.status`
Expected: PASS. Prove the guard: remove the `if (!isUuid(id))` from the PATCH route, rerun → the malformed-`:id` test FAILS with a 500 instead of 404. Restore.

- [ ] **Step 8: Full package gate + commit.**

Run: `pnpm --filter @waitron/server test:coverage` and the real-PG suites (`TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test service-statuses.rls clear-table-status.rls`).
Expected: PASS at 98/98/98/95.

```bash
git add apps/server/src/till-api.ts apps/server/src/management-api.ts apps/server/src/till-api.status.test.ts apps/server/src/management-api.status.test.ts
git commit -s -m "feat(server): HTTP routes for setTableStatus + service-status config CRUD (TS-2)"
```

---

## Final gate (before opening the PR)

- [ ] Run the four-command gate: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`.
- [ ] Run coverage on every changed package: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage`, `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`, and `pnpm --filter @waitron/dashboard test:coverage` (CI shards run `test:coverage`, not `test`).
- [ ] Re-run the tenant-scoped RLS guard once more after all migrations exist: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` — `table_service_statuses` must report `relforcerowsecurity = true`.
- [ ] `pnpm install` (no dependency moved, but confirm the lockfile is clean).

---

## Plan notes (gaps / decisions flagged, not invented scope)

1. **TS-1 back-pointer vs the on-disk TS-1 plan.** TS-2's reset trigger and `openTab` edit are written against the TS-1 **design** §2b, where the table↔tab link is a `dining_tables.tab_id` **back-pointer** (a tab is "the table's `tab_id` points at the open order"; several tables may point at one tab — a TS-3 join). The TS-1 *plan on disk* (`docs/superpowers/plans/2026-08-17-table-service-ts1-tables-and-tabs.md`) predates that revision and still uses a `working_orders.table_id` column + a one-open-tab partial unique. **These disagree.** TS-2 follows the **design/back-pointer** model per this project's brief. Before implementing Task 5, confirm which model TS-1 actually LANDED: if it landed the back-pointer, the trigger (`WHERE tab_id = NEW.id`) and the `openTab` `.set({ statusId: null })` edit are correct as written; if it landed the order-column model, the trigger must key on `working_orders.table_id` (e.g. `UPDATE dining_tables SET status_id = NULL WHERE tenant_id = NEW.tenant_id AND id = NEW.table_id`) and the `openTab` clear becomes a standalone `UPDATE dining_tables SET status_id = NULL WHERE id = req.tableId`. Flagged prominently because it is the one cross-slice assumption TS-2 cannot verify until TS-1 is on disk.

2. **The spec's single migration is split across Tasks 1/2/5.** Design §2c envisions "one migration" (create `table_service_statuses` + add `status_id` + FK + custom RLS + trigger). This plan splits it into three self-contained, independently-committable migrations — the config table + its RLS (Task 1), the `dining_tables.status_id` column + FK (Task 2), and the reset trigger (Task 5) — because the trigger references `status_id` (so it must follow Task 2) and each task ends in an independently-testable deliverable (the writing-plans task-boundary rule). The net DDL is identical; migration numbers are indicative (`db:generate` assigns them at the tip, preserving order). No behavioural difference.

3. **Color validation surfaces as `management.request_invalid`, not a new `status.*` code.** Design §2a says `color` is "app-validated"; §6 enumerates exactly three `status.*` codes (`not_found`/`inactive`/`label_taken`). Minting a fourth (`status.color_invalid`) would invent scope beyond the spec and add a permanent, never-renamed code (CLAUDE.md §3). Instead a malformed color is treated as a request-payload fault and surfaced via the existing `management.request_invalid` naming the FIELD (never the value) — the same request-shape discipline the layout/receipt PUT routes use for a bad body. The validation is deliberately light (`/^[#A-Za-z0-9_-]{1,32}$/` — a hex like `#ef4444` or a token like `amber-500`), matching "a hex/token string".

4. **Config CRUD takes `{ managementSessionId, tenantId }`; `setTableStatus` takes `(cfg, ...)`.** The two surfaces have different gates: config CRUD is manager-authored from the dashboard (a management session + `till.configure`, exactly the `@waitron/layouts` `putLayout`/`putReceipt` shape), so those verbs take a `managementSessionId` + `tenantId` and embed `authorizeManager`. `setTableStatus` is an operator action from the POS (the operator session at the route), so it takes `(tx, cfg, ...)` like TS-1's table CRUD and is unauthenticated at the verb level. Both live in `tables.ts` (design §3), with different shapes — documented on each.

5. **`listStatuses` returns active AND inactive.** The editor must be able to reactivate a deactivated status, so `listStatuses` returns the whole set ordered by `display_order` then `label`; the till never calls it (the floor plan reads statuses via `listTablesWithState`'s join, which shows only the one status actually SET on a table). If a future floor-plan status picker needs only the ACTIVE set, add an `activeOnly` option rather than changing this default.

6. **The reset trigger is deliberately NOT gated on `app.sync_apply`.** `0037_gate_triggers_on_sync_apply.sql` gates three *state-machine* BEFORE-triggers (they reject a redelivered write valid in the source's order but not against the mirror's later state, wedging the apply stream). The reset trigger is the opposite class — an idempotent, data-validity-shaped cascade: a zero-match `UPDATE dining_tables` is a no-op and a same-tenant one is RLS-permitted, so it **cannot raise** and cannot wedge the apply path (the exact class 0037 leaves ungated). `dining_tables` sync-enrollment is out of TS-2's scope; when a replication slice enrolls it, revisit this deliberately. Flagged so the decision is a decision, not an omission (the memory note "Replication is shared infra" applies).

7. **H2 receipt is a `git diff --stat` + grep, not a huella-identity test.** Unlike TS-1 (whose two new columns rode a filed working order, needing a huella-independence proof), TS-2 touches no filed record and does not modify `till-sale.ts`'s pay path at all — the reset is a trigger. So the H2 proof is the receipt in Task 5 Step 1 (no diff to `record-sale.ts` / the alta builders / `verifactu` / the pay path; `status_id`/`table_service_statuses` referenced by none of them), pasted into the trigger test's header, rather than a fresh hash test.
