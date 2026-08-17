# Table Service TS-1 (Tables + Tabs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the real `dining_tables` primitive and the running **tab** (an `open` working order a table points at via a `tab_id` back-pointer), plus per-line void, pay-closes-the-tab (reusing the existing fiscal path unchanged), a counter "deliver to table N" link, and a derived occupancy read-model — headless, SUPERVISED (owner in the loop).

**Architecture:** Schema (`dining_tables` with a `tab_id` back-pointer + one nullable `working_orders.delivery_table_id` column) lives in `packages/db`; the domain verbs live in `apps/server` beside the existing order logic (`working-order.ts`, `till-sale.ts`, a new `tables.ts`), each taking a caller-supplied `tx` and run under `withTenant`/`asAppUser` by the HTTP layer (`till-api.ts`). The table↔tab link is a **back-pointer on the table** (`dining_tables.tab_id → working_orders`), so one open tab per table is automatic from a single nullable FK — **no partial-unique, no CHECK** — and the per-table `FOR UPDATE` lock in `openTab` is the concurrency guard. A tab is an `open` working order, so pay reuses `payWorkingOrder` → `recordSale` UNCHANGED and **nothing fiscal changes**: the filed `working_orders` row carries no tab-membership at all (only `delivery_table_id`, which `recordSale` does not read).

**Tech Stack:** TypeScript (ESM, Node), Drizzle ORM + drizzle-kit (PostgreSQL 18), Hono HTTP, Vitest, PGlite (hermetic) + Testcontainers (real Postgres for RLS/concurrency), pnpm workspace.

**Spec:** docs/superpowers/specs/2026-08-17-table-service-ts1-tables-and-tabs-design.md

## Global Constraints

- **Coverage thresholds 98/98/98/95** (statements/lines/functions/branches) for both `packages/db` and `apps/server`. CI shards run `test:coverage`, not `test` — verify each package green with `pnpm --filter <pkg> test:coverage`.
- **Migration numbers are INDICATIVE.** Assign every number via `pnpm --filter @waitron/db db:generate` (auto part) and `pnpm --filter @waitron/db db:generate:custom` (custom part) against the LIVE tree — never hardcode a number; the autonomous campaign may consume numbers first. Commit the generated `packages/db/drizzle/meta/_journal.json` + snapshot alongside each `.sql`.
- **FORCE RLS + tenant-isolation policy + grants + any trigger go in a HAND-WRITTEN custom migration.** `.enableRLS()` emits only `ENABLE ROW LEVEL SECURITY`; it is insufficient (CLAUDE.md §3). A new `tenant_id`-bearing table needs `FORCE ROW LEVEL SECURITY`, a `<t>_tenant_isolation` policy (`USING/WITH CHECK (tenant_id = current_tenant_id())`), and grants — pattern in `packages/db/drizzle/0039_recipes_rls.sql`.
- **English identifiers only.** `dining_tables`, `tab_id`, `delivery_table_id`, `zone`, `capacity`, `label`. `mesa`/`mesas` are banned (`packages/db/src/english-only.ts`); the UI renders "Mesa" via i18n. Add NO new `SPANISH_WORDS` tokens.
- **Domain-named error codes, never renamed once shipped.** `table.not_found`, `table.label_taken`, `table.inactive`, `tab.already_open`, `tab.not_open`, `tab.line_not_found` — declared in `apps/server/src/errors.ts` (the host registry that already declares `working_order.*`/`order_prep.*`), and every throwing file carries `import "./errors.js"`. The root `errors-reachable` guard covers `packages/*` barrels, NOT `apps/*`, so keep the import present.
- **Real Postgres for RLS/concurrency; PGlite is a false pass there.** PGlite runs every connection as a superuser (bypasses FORCE RLS) and serialises every query onto one backend (no race). Put RLS isolation, both concurrency races, and the huella-identity test on Testcontainers; note `TESTCONTAINERS_RYUK_DISABLED=true` locally (CLAUDE.md §4).
- **H2 — the fiscal core is untouched.** `computeHuella`, the hash chain, `registros_facturacion`, invoice numbers, and the alta builders are not modified. Pay reuses `recordSale` UNCHANGED; the filed `working_orders` row carries no tab-membership (the link is on the table), only `delivery_table_id`, which `recordSale` MUST NOT read (grep-proven + a huella-identity test).
- **Prove every guard by deletion.** Remove the RLS predicate / FK / lock / gate, confirm the test fails, restore it. A test that still passes with the guard removed is not testing the guard.
- **No backwards-compat / data-migration code.** Pre-production; schema changes drop-and-recreate, CI builds fresh. No backfill.
- **Every commit `git commit -s`.**

---

## File Structure

**Created:**
- `packages/db/src/schema/dining-tables.ts` — the `dining_tables` Drizzle table (tenant + location scoped, `.enableRLS()`), its two uniques, the composite location FK, and a **bare** `tab_id` column (its FK is hand-written in Task 2 — see there). One responsibility: the table definition.
- `packages/db/drizzle/00NN_dining_tables.sql` (auto, Task 1) — `CREATE TABLE dining_tables` + uniques + location FK, plus `ALTER TABLE locations ADD CONSTRAINT locations_tenant_id_key`.
- `packages/db/drizzle/00NN_dining_tables_rls.sql` (custom, Task 1) — FORCE RLS + `dining_tables_tenant_isolation` policy + `GRANT SELECT, INSERT, UPDATE` (no DELETE).
- `packages/db/drizzle/00NN_tab_link.sql` (auto, Task 2) — `ALTER TABLE working_orders ADD COLUMN delivery_table_id uuid`.
- `packages/db/drizzle/00NN_tab_link_fks.sql` (custom, Task 2) — the two mutual composite FKs (`dining_tables_tab_fk`, `working_orders_delivery_table_fk`), hand-written to avoid a schema-module import cycle (see Task 2).
- `packages/db/src/schema/dining-tables.rls.test.ts` — real-PG: cross-tenant RLS isolation (prove-by-deletion), grant shape (SELECT/INSERT/UPDATE, no DELETE).
- `packages/db/src/schema/tab-link.rls.test.ts` — real-PG: `tab_id`/`delivery_table_id` visible to `app_user` under the existing policies (differential), and both mutual FKs bite (prove-by-deletion).
- `apps/server/src/tables.ts` — table CRUD verbs (`createTable`/`listTables`/`updateTable`/`deactivateTable`) + `DiningTable` type.
- `apps/server/src/tables.test.ts` — PGlite: CRUD logic + `table.label_taken`/`table.not_found`.
- `apps/server/src/tabs.test.ts` — PGlite: `openTab` (sets `tab_id`, refuses a 2nd tab, overwrites a stale pointer), `addTabRound` (append without re-price), `voidTabLine`, `listTablesWithState` occupancy.
- `apps/server/src/tabs.rls.test.ts` — real-PG: concurrent `openTab` race (prove-by-deletion of the per-table lock), concurrent `addTabRound` race (prove-by-deletion of the per-tab lock), pay-closes-tab, huella-identity, `deliveryTableId` write.
- `apps/server/src/till-api.tables.test.ts` — the new HTTP routes (session-guard, `isUuid` 4xx, status mapping).

**Modified:**
- `packages/db/src/schema/index.ts` — re-export `dining-tables.js` (widens `Database`'s schema type).
- `packages/db/src/index.ts` — `export { diningTables } from "./schema/dining-tables.js"`.
- `packages/db/src/schema/tenants.ts` — add `locations_tenant_id_key (tenant_id, id)` unique to `locations` (the composite target `dining_tables_location_fk` needs).
- `packages/db/src/schema/orders.ts` — add the bare `deliveryTableId` column (its FK is hand-written in Task 2).
- `apps/server/src/errors.ts` — declare the six new codes (across Tasks 3–6).
- `apps/server/src/working-order.ts` — guard `createOpenOrder`'s line insert (Task 4) + add its `placement` param (Task 8); add `openTab`, `lockOpenTab`, `addTabRound`, `voidTabLine`, `listTablesWithState`.
- `apps/server/src/till-sale.ts` — thread `deliveryTableId` through `TillSaleRequest`/`PayWorkingOrderRequest` → `recordTillSale` → `payWorkingOrder` → `createOpenOrder`.
- `apps/server/src/till-api.ts` — mount the table + tab routes; extend the `STATUS` map.

---

## Task 1: `dining_tables` schema (incl. `tab_id`) + custom RLS migration + inmutabilidad-green

**Files:**
- Create: `packages/db/src/schema/dining-tables.ts`
- Modify: `packages/db/src/schema/index.ts`, `packages/db/src/index.ts`, `packages/db/src/schema/tenants.ts`
- Create (generated): `packages/db/drizzle/00NN_dining_tables.sql` (auto) + `packages/db/drizzle/00NN_dining_tables_rls.sql` (custom) + `meta/_journal.json`/snapshot updates
- Test: `packages/db/src/schema/dining-tables.rls.test.ts`

**Interfaces:**
- Produces: `diningTables` (Drizzle `pgTable`) exported from `@waitron/db`, columns `id`, `tenantId`, `locationId`, `label`, `zone`, `capacity`, `active`, `createdAt`, and a **bare** `tabId` (`tab_id uuid NULL`); uniques `dining_tables_tenant_id_key (tenant_id, id)` and `dining_tables_location_label_key (tenant_id, location_id, label)`; composite FK `(tenant_id, location_id) → locations(tenant_id, id)`. RLS: FORCE + `dining_tables_tenant_isolation` policy + `GRANT SELECT, INSERT, UPDATE` to `app_user`.
- Produces: `locations` gains `locations_tenant_id_key (tenant_id, id)`.

- [ ] **Step 1: Add the composite `(tenant_id, id)` unique to `locations`.** In `packages/db/src/schema/tenants.ts`, add to the `locations` `extraConfig` array (it already imports `unique`), so `dining_tables_location_fk` has a target — the same role `tills_tenant_id_key`/`nodes_tenant_id_key` play for their composite FKs:

```typescript
    // Composite (tenant_id, id) UNIQUE — the target for dining_tables_location_fk's tenant-consistent
    // (tenant_id, location_id) FK (dining-tables.ts), the same role tills_tenant_id_key plays for
    // order_amendments_till_fk. A single-column-PK table takes the extra unique the way tills/nodes do.
    unique("locations_tenant_id_key").on(t.tenantId, t.id),
```

- [ ] **Step 2: Write the `dining_tables` schema.** Mirror `order-prep.ts`/`orders.ts` conventions (composite FK via `foreignKey(...)`, `.enableRLS()`, custom-migration comment). The `tab_id` column is BARE — no `foreignKey()` for it here, because the `dining_tables_tab_fk (tenant_id, tab_id) → working_orders` FK and the reverse `working_orders_delivery_table_fk` form a MUTUAL FK between the two schema modules; declaring both in the Drizzle schemas would make each module import the other and eagerly reference its columns in `foreignKey()` at load time — an import cycle. Both FKs are hand-written in Task 2's custom migration instead (§2c).

`packages/db/src/schema/dining-tables.ts`:

```typescript
import {
  boolean,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { locations, tenants } from "./tenants.js";

/**
 * A dining table — tenant + location scoped, long-lived. Anchored to the venue-wide `location`, NOT to
 * `node` (working orders, the held list, the order-number counter and the prep queue are all
 * node-scoped, but a table must not fragment when a venue runs a second node — design §2a).
 *
 * `tab_id` is the BACK-POINTER to the open tab covering this table (design §2b): set ⇒ this table is
 * covered by that open working order; a single nullable FK gives one-open-tab-per-table automatically
 * (no partial-unique, no CHECK). Several tables pointing at the SAME tab is a join (TS-3); TS-1 only
 * ever sets one table's tab_id per tab. It is a BARE column here — its FK to working_orders is
 * hand-written in the mutual-FK migration (Task 2), because the reverse FK
 * (working_orders.delivery_table_id → dining_tables) would otherwise close a load-time import cycle.
 *
 * Deactivate, never hard-delete (`active`), because a table has order history. `.enableRLS()` emits only
 * ENABLE ROW LEVEL SECURITY; the FORCE ROW LEVEL SECURITY, the `dining_tables_tenant_isolation` policy
 * and the SELECT/INSERT/UPDATE grant (no DELETE — deactivate) are hand-written in the custom migration,
 * exactly as 0039 does for `ingredients`. The `inmutabilidad` guard in packages/fiscal-verifactu scans
 * every tenant_id-bearing table for both RLS flags, so a missing FORCE here fails that suite.
 */
export const diningTables = pgTable(
  "dining_tables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    // Bare column: the FK is the tenant-consistent COMPOSITE (tenant_id, location_id) →
    // locations(tenant_id, id) declared below (mirroring working_orders_node_fk).
    locationId: uuid("location_id").notNull(),
    // The human id shown on the floor ("12", "Terraza 3"). Unique within a venue (see below).
    label: text("label").notNull(),
    // Optional grouping ("terrace" / "bar" / "inside") — a data value, not an identifier.
    zone: text("zone"),
    // Covers. Nullable.
    capacity: integer("capacity"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    // The open tab covering this table (design §2b). Nullable back-pointer; a set value points at an
    // `open` working order. BARE column — its (tenant_id, tab_id) → working_orders(tenant_id, id) FK is
    // hand-written in Task 2's custom migration (the mutual-FK cycle note above).
    tabId: uuid("tab_id"),
  },
  (t) => [
    // Composite (tenant_id, id) UNIQUE — the target for working_orders' tenant-consistent
    // (tenant_id, delivery_table_id) FK (Task 2), the same role nodes_tenant_id_key plays for
    // working_orders_node_fk.
    unique("dining_tables_tenant_id_key").on(t.tenantId, t.id),
    // No duplicate labels within a venue.
    unique("dining_tables_location_label_key").on(t.tenantId, t.locationId, t.label),
    // Tenant-consistent composite FK to the owning location: a table cannot point at a location of
    // another tenant, independently of whether RLS is in force on this connection.
    foreignKey({
      columns: [t.tenantId, t.locationId],
      foreignColumns: [locations.tenantId, locations.id],
      name: "dining_tables_location_fk",
    }),
  ],
).enableRLS();
```

- [ ] **Step 3: Re-export from both barrels.**

`packages/db/src/schema/index.ts` — add after the `order-prep.js` line:

```typescript
export * from "./dining-tables.js";
```

`packages/db/src/index.ts` — add beside the other schema table re-exports (after the `orderPrep` line):

```typescript
export { diningTables } from "./schema/dining-tables.js";
```

- [ ] **Step 4: Typecheck the schema compiles.**

Run: `pnpm --filter @waitron/db typecheck`
Expected: PASS (the new table and its re-exports compile; `Database`'s schema widens for free).

- [ ] **Step 5: Generate the auto migration and read it.**

Run: `pnpm --filter @waitron/db db:generate --name dining_tables`
Expected: a new `packages/db/drizzle/00NN_dining_tables.sql` containing `CREATE TABLE "dining_tables" (...)` with `tab_id uuid` and `active boolean NOT NULL DEFAULT true`, the two uniques, the `dining_tables_location_fk` composite FK, AND `ALTER TABLE "locations" ADD CONSTRAINT "locations_tenant_id_key" UNIQUE("tenant_id","id")`. **Open the file and confirm `locations_tenant_id_key` is added BEFORE `dining_tables_location_fk` references it** (drizzle-kit orders a dependency's unique ahead of the FK; if the order is inverted, move the `ALTER TABLE locations` statement above the FK). The NUMBER is whatever drizzle-kit assigned — do not edit it. Commit `meta/_journal.json` + snapshot.

- [ ] **Step 6: Generate + hand-write the custom RLS migration.**

Run: `pnpm --filter @waitron/db db:generate:custom --name dining_tables_rls`
Then write into the emitted `packages/db/drizzle/00NN_dining_tables_rls.sql` (mirroring `0039_recipes_rls.sql`):

```sql
-- Hand-written (--custom; drizzle-kit has no concept of policies, FORCE, or privileges), same as
-- packages/db/drizzle/0039_recipes_rls.sql. current_tenant_id() already exists (0001_tenancy_rls.sql).
-- dining_tables: no DELETE (deactivate via `active` — the table has order history, design §2a).
--> statement-breakpoint
ALTER TABLE "dining_tables" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "dining_tables_tenant_isolation" ON "dining_tables"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

REVOKE ALL ON "dining_tables" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "dining_tables" TO app_user;
```

- [ ] **Step 7: Run the inmutabilidad guard — it must discover `dining_tables` and require FORCE.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`
Expected: PASS. The tenant_id-scan (`inmutabilidad.test.ts`, keyed on "has a `tenant_id` column") now enumerates `dining_tables`; its `nonCompliant` filter would list `dining_tables: relrowsecurity=... relforcerowsecurity=false` if the custom migration were missing. Green confirms `relforcerowsecurity = true`.

> If this fails with `dining_tables` in the `nonCompliant` list, the custom migration did not run or was misnamed — confirm both `.sql` files are in `packages/db/drizzle/` and `meta/_journal.json` lists both.

- [ ] **Step 8: Write the RLS isolation + grant-shape test (real Postgres, prove-by-deletion).** Mirror `packages/db/src/schema/order-prep.rls.test.ts` (its `useRealPostgres`, `rollBackAfter`, `asApp`/`asAppB`, predicate-deletion idiom).

`packages/db/src/schema/dining-tables.rls.test.ts`:

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
import { locations, tenants } from "./tenants.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";

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

describe("dining_tables schema (RLS + grants)", () => {
  const suite = useRealPostgres({
    start: () =>
      startMigratedPostgres({
        dockerRequired:
          "The dining_tables RLS suite requires a running Docker daemon. It cannot be skipped: PGlite " +
          "runs every connection as a superuser, bypassing the FORCE ROW LEVEL SECURITY and the grant " +
          "shape (SELECT/INSERT/UPDATE, no DELETE) this suite exists to prove.",
        migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
      }),
    timeoutMs: 120_000,
  });

  beforeAll(async () => {
    const admin = suite.admin;
    await admin.insert(tenants).values([
      { id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" },
      { id: TENANT_B, country: "ES", taxId: "B11111111", legalName: "Fixture Tenant B" },
    ]);
    await admin.insert(locations).values([
      { id: LOCATION_A, tenantId: TENANT_A, name: "Loc A", invoiceLocales: ["es"], operationDescription: "Hostelería" },
      { id: LOCATION_B, tenantId: TENANT_B, name: "Loc B", invoiceLocales: ["es"], operationDescription: "Hostelería" },
    ]);
  });

  function asApp<T>(tenant: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(suite.admin, tenant, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  async function seedTable(tenant: string, location: string, label: string): Promise<string> {
    return asApp(tenant, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into dining_tables (tenant_id, location_id, label) values (${tenant}, ${location}, ${label}) returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  it("permits SELECT/INSERT/UPDATE as the non-owner app role (the control)", async () => {
    const id = await seedTable(TENANT_A, LOCATION_A, "T-control");
    await asApp(TENANT_A, (tx) =>
      tx.execute(sql`update dining_tables set zone = 'terrace' where id = ${id}`),
    );
    const [row] = await asApp(TENANT_A, (tx) =>
      tx.execute<{ zone: string }>(sql`select zone from dining_tables where id = ${id}`).then((r) => r.rows),
    );
    expect(row!.zone).toBe("terrace");
  });

  it("app_user has no DELETE on dining_tables (deactivate, never delete)", async () => {
    const id = await seedTable(TENANT_A, LOCATION_A, "T-nodelete");
    const e = await captureError(() =>
      asApp(TENANT_A, (tx) => tx.execute(sql`delete from dining_tables where id = ${id}`)),
    );
    expect(pgErrorCode(e)).toBe("42501");
  });

  it("isolates INSERT between tenants (WITH CHECK rejects a foreign tenant_id)", async () => {
    // Tenant B tries to insert a row tagged tenant A — RLS WITH CHECK rejects it (42501), the write
    // path isolation PGlite's superuser could not show.
    const e = await captureError(() =>
      asApp(TENANT_B, (tx) =>
        tx.execute(
          sql`insert into dining_tables (tenant_id, location_id, label) values (${TENANT_A}, ${LOCATION_A}, 'T-foreign')`,
        ),
      ),
    );
    expect(pgErrorCode(e)).toBe("42501");
  });

  it("tenant isolation is the policy PREDICATE's doing (proof by deletion of the tenant predicate)", async () => {
    // A's row is committed before the policy is weakened, so it is genuinely there to leak. Weakening
    // the predicate to `true` in a ROLLED-BACK tx makes B suddenly see it — so `tenant_id =
    // current_tenant_id()`, not mere table access, is the guard. A full DROP POLICY is the WRONG
    // deletion: FORCE RLS with no policy denies ALL rows, so B would see zero for the opposite reason.
    const id = await seedTable(TENANT_A, LOCATION_A, "T-leak");
    expect(id).toBeDefined();
    await rollBackAfter(suite.admin, TENANT_B, async (tx) => {
      await tx.execute(
        sql`alter policy dining_tables_tenant_isolation on dining_tables using (true) with check (true)`,
      );
      await tx.execute(sql`set local role app_user`);
      const foreign = await tx
        .execute<{ n: number }>(
          sql`select (count(*) filter (where tenant_id = ${TENANT_A}))::int as n from dining_tables`,
        )
        .then((r) => r.rows[0]!.n);
      expect(foreign).toBeGreaterThan(0); // A's rows now leak to B — the predicate was the guard.
    });
  });
});
```

- [ ] **Step 9: Run the RLS test.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test dining-tables.rls`
Expected: PASS (4 tests). To PROVE the isolation test bites, temporarily change the policy in the migration to `using (true) with check (true)`, rerun the isolation test → the "isolates INSERT between tenants" test FAILS (no 42501); restore.

- [ ] **Step 10: Package green + commit.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage`
Expected: PASS at 98/98/98/95.

```bash
git add packages/db/src/schema/dining-tables.ts packages/db/src/schema/tenants.ts packages/db/src/schema/index.ts packages/db/src/index.ts packages/db/drizzle/ packages/db/src/schema/dining-tables.rls.test.ts
git commit -s -m "feat(db): dining_tables entity (incl. tab_id back-pointer) + custom RLS migration (TS-1)"
```

---

## Task 2: `working_orders.delivery_table_id` + the two mutual composite FKs

**Files:**
- Modify: `packages/db/src/schema/orders.ts`
- Create (generated): `packages/db/drizzle/00NN_tab_link.sql` (auto, the column) + `packages/db/drizzle/00NN_tab_link_fks.sql` (custom, both FKs) + `meta/_journal.json`/snapshot
- Test: `packages/db/src/schema/tab-link.rls.test.ts`

**Interfaces:**
- Consumes: `diningTables` (Task 1); `workingOrders` (existing).
- Produces: `workingOrders.deliveryTableId` (`delivery_table_id uuid NULL`) — a bare column; the DB carries two composite FKs added by the custom migration: `dining_tables_tab_fk (tenant_id, tab_id) → working_orders(tenant_id, id)` and `working_orders_delivery_table_fk (tenant_id, delivery_table_id) → dining_tables(tenant_id, id)`. **No partial-unique, no CHECK.**

> **Why both FKs are hand-written (not schema-declared).** `dining_tables.tab_id` → `working_orders` and `working_orders.delivery_table_id` → `dining_tables` are a MUTUAL FK between the two schema modules. To declare both in Drizzle, `dining-tables.ts` would import `orders.ts` AND `orders.ts` would import `dining-tables.ts`, and each `foreignKey({ foreignColumns: [...] })` eagerly reads the other table's column objects when `pgTable()` runs — a load-time import cycle in which one side's columns are still `undefined`. The existing `locations ↔ catalogue` cycle survives only because it uses lazy `.references(() => …)` THUNKS (single-column FKs), which composite FKs have no equivalent of. So both columns stay bare in the schema and both FKs are hand-written in the custom migration below — the same mechanism FORCE/policies/grants already use (drizzle-kit does not manage them, and the bare columns produce no schema/snapshot drift). This is a deliberate deviation from spec §2c's "db:generate emits them as two ALTER statements"; recorded in Plan notes.

- [ ] **Step 1: Add the bare `delivery_table_id` column to `working_orders`.** In `packages/db/src/schema/orders.ts`, add the column after `settledAt` (do NOT add a `foreignKey` for it — the FK is hand-written below; do NOT import `dining-tables.ts`):

```typescript
    // Set ⇒ this (counter) order is DELIVERED TO that table, not a tab (design §2b). Nullable; a tab is
    // the reverse link (`dining_tables.tab_id` points at the order), so `working_orders` carries NO
    // tab-membership column — only this delivery link. BARE column: its tenant-consistent composite FK
    // (tenant_id, delivery_table_id) → dining_tables(tenant_id, id) is hand-written in the mutual-FK
    // migration (the schema-module import cycle a `foreignKey()` here would close — see dining-tables.ts).
    deliveryTableId: uuid("delivery_table_id"),
```

- [ ] **Step 2: Typecheck.**

Run: `pnpm --filter @waitron/db typecheck`
Expected: PASS.

- [ ] **Step 3: Generate the auto migration and read it.**

Run: `pnpm --filter @waitron/db db:generate --name tab_link`
Expected: `packages/db/drizzle/00NN_tab_link.sql` with exactly `ALTER TABLE "working_orders" ADD COLUMN "delivery_table_id" uuid;` — and NO FK, NO CHECK, NO unique index (the FKs are hand-written next; the bare columns carry none). If the file also contains an FK/constraint, a stray `foreignKey()` slipped into the schema — remove it. Commit `meta/_journal.json` + snapshot.

- [ ] **Step 4: Generate + hand-write the mutual-FK custom migration.**

Run: `pnpm --filter @waitron/db db:generate:custom --name tab_link_fks`
Then write into the emitted `packages/db/drizzle/00NN_tab_link_fks.sql`:

```sql
-- Hand-written (--custom): the mutual composite FK between dining_tables and working_orders. Both are
-- declared in Drizzle as BARE columns because a schema-level foreignKey() on each side would make the
-- two schema modules import one another and eagerly reference each other's columns at load time — an
-- import cycle (see packages/db/src/schema/dining-tables.ts). Both tables already exist and both columns
-- are nullable, so the two ALTERs have no create/insert ordering problem (design §2c). No partial-unique
-- and no CHECK: a single nullable tab_id gives one-open-tab-per-table structurally, and openTab's
-- per-table FOR UPDATE lock is the concurrency guard (design §2b, §3a).
--> statement-breakpoint
ALTER TABLE "dining_tables"
  ADD CONSTRAINT "dining_tables_tab_fk"
  FOREIGN KEY ("tenant_id", "tab_id")
  REFERENCES "working_orders" ("tenant_id", "id");--> statement-breakpoint

ALTER TABLE "working_orders"
  ADD CONSTRAINT "working_orders_delivery_table_fk"
  FOREIGN KEY ("tenant_id", "delivery_table_id")
  REFERENCES "dining_tables" ("tenant_id", "id");
```

- [ ] **Step 5: Write the DDL-proof test (real Postgres): column visibility + both FKs prove-by-deletion.** Mirror `order-prep.rls.test.ts`'s scaffolding.

`packages/db/src/schema/tab-link.rls.test.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import type { Database, Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useRealPostgres } from "../testing/lifecycle.js";
import { runMigrationSets, startMigratedPostgres } from "../testing/postgres.js";
import { asAppUser } from "../testing/roles.js";
import { seedNode } from "../testing/seed.js";
import { withTenant } from "../tenancy.js";
import { locations, tenants, tills } from "./tenants.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL_A = "aaaaaaaa-1111-4000-8000-000000000001";

class RollbackSignal extends Error {}
async function rollBackAfter(admin: Database, tenant: string, fn: (tx: Transaction) => Promise<void>): Promise<void> {
  await withTenant(admin, tenant, async (tx) => {
    await fn(tx);
    throw new RollbackSignal();
  }).catch((error: unknown) => {
    if (!(error instanceof RollbackSignal)) throw error;
  });
}

describe("table↔tab link columns (mutual composite FKs)", () => {
  const suite = useRealPostgres({
    start: () =>
      startMigratedPostgres({
        dockerRequired:
          "The tab-link suite requires Docker: PGlite runs every connection as a superuser (bypassing " +
          "the app-role visibility check) and serialises queries; the two composite FKs are proven here " +
          "by deletion within rolled-back transactions.",
        migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
      }),
    timeoutMs: 120_000,
  });

  let nodeA = "";
  let orderSeq = 0;

  function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(suite.admin, TENANT_A, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  beforeAll(async () => {
    const admin = suite.admin;
    await admin.insert(tenants).values({ id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "T A" });
    await admin.insert(locations).values({ id: LOCATION_A, tenantId: TENANT_A, name: "Loc A", invoiceLocales: ["es"], operationDescription: "Hostelería" });
    await admin.insert(tills).values({ id: TILL_A, tenantId: TENANT_A, locationId: LOCATION_A, name: "A1" });
    nodeA = await seedNode(admin, brandTenantId(TENANT_A), brandLocationId(LOCATION_A));
  });

  /** Insert one active table as app_user; returns its id. */
  async function openTable(label: string): Promise<string> {
    return asApp(async (tx) =>
      tx
        .execute<{ id: string }>(sql`insert into dining_tables (tenant_id, location_id, label) values (${TENANT_A}, ${LOCATION_A}, ${label}) returning id`)
        .then((r) => r.rows[0]!.id),
    );
  }

  /** Insert one open working order as app_user; returns its id. */
  async function openWo(): Promise<string> {
    orderSeq += 1;
    return asApp(async (tx) =>
      tx
        .execute<{ id: string }>(sql`
          insert into working_orders (tenant_id, till_id, node_id, order_number, status)
          values (${TENANT_A}, ${TILL_A}, ${nodeA}, ${orderSeq}, 'open') returning id`)
        .then((r) => r.rows[0]!.id),
    );
  }

  it("the new columns are visible/writable to the non-owner app_user under the existing policies", async () => {
    // Differential: setting the tab_id back-pointer AND a delivery_table_id as app_user both succeed and
    // read back. Fails if the tables' existing grants did not already cover the added columns (they are
    // table-wide, so they do — the confirmation §2b calls for). Also proves each FK RESOLVES a valid ref.
    const tableId = await openTable("T-vis");
    const woId = await openWo();
    await asApp((tx) => tx.execute(sql`update dining_tables set tab_id = ${woId} where id = ${tableId}`));
    await asApp((tx) => tx.execute(sql`update working_orders set delivery_table_id = ${tableId} where id = ${woId}`));
    const back = await asApp((tx) =>
      tx
        .execute<{ tab_id: string | null; delivery_table_id: string | null }>(sql`
          select dt.tab_id, wo.delivery_table_id
          from dining_tables dt join working_orders wo on wo.id = ${woId}
          where dt.id = ${tableId}`)
        .then((r) => r.rows[0]!),
    );
    expect(back.tab_id).toBe(woId);
    expect(back.delivery_table_id).toBe(tableId);
  });

  it("dining_tables_tab_fk rejects a tab_id that points at no working order — proven by deletion", async () => {
    const tableId = await openTable("T-tabfk");
    const e = await captureError(() =>
      asApp((tx) => tx.execute(sql`update dining_tables set tab_id = ${randomUUID()} where id = ${tableId}`)),
    );
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation

    // Prove-by-deletion: drop the FK in a rolled-back tx, and the same dangling pointer is accepted.
    await rollBackAfter(suite.admin, TENANT_A, async (tx) => {
      await tx.execute(sql`alter table dining_tables drop constraint dining_tables_tab_fk`);
      await tx.execute(sql`set local role app_user`);
      await tx.execute(sql`update dining_tables set tab_id = ${randomUUID()} where id = ${tableId}`);
      // no throw — the FK was the guard.
    });
  });

  it("working_orders_delivery_table_fk rejects a delivery_table_id that points at no table — proven by deletion", async () => {
    const woId = await openWo();
    const e = await captureError(() =>
      asApp((tx) => tx.execute(sql`update working_orders set delivery_table_id = ${randomUUID()} where id = ${woId}`)),
    );
    expect(pgErrorCode(e)).toBe("23503");

    await rollBackAfter(suite.admin, TENANT_A, async (tx) => {
      await tx.execute(sql`alter table working_orders drop constraint working_orders_delivery_table_fk`);
      await tx.execute(sql`set local role app_user`);
      await tx.execute(sql`update working_orders set delivery_table_id = ${randomUUID()} where id = ${woId}`);
      // no throw — the FK was the guard.
    });
  });
});
```

- [ ] **Step 6: Run the test, then the package.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test tab-link.rls`
Expected: PASS (3 tests). Then `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage` → PASS at 98/98/98/95.

- [ ] **Step 7: Re-run the inmutabilidad guard (the new column must not disturb it) and commit.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`
Expected: PASS (`working_orders` still compliant; the column is additive).

```bash
git add packages/db/src/schema/orders.ts packages/db/drizzle/ packages/db/src/schema/tab-link.rls.test.ts
git commit -s -m "feat(db): working_orders.delivery_table_id + mutual composite FKs (TS-1)"
```

---

## Task 3: Table CRUD verbs + error codes

**Files:**
- Create: `apps/server/src/tables.ts`
- Modify: `apps/server/src/errors.ts`
- Test: `apps/server/src/tables.test.ts`

**Interfaces:**
- Consumes: `diningTables`, `isUniqueViolation`, `asAppUser`, `withTenant` (`@waitron/db`); `TillConfig`.
- Produces:
  - `interface DiningTable { id: string; label: string; zone: string | null; capacity: number | null; active: boolean; createdAt: string }`
  - `createTable(tx: Transaction, cfg: TillConfig, input: { label: string; zone?: string; capacity?: number }): Promise<{ id: string }>` — throws `table.label_taken`
  - `listTables(tx: Transaction, cfg: TillConfig): Promise<DiningTable[]>`
  - `updateTable(tx: Transaction, cfg: TillConfig, id: string, input: { label?: string; zone?: string; capacity?: number }): Promise<void>` — throws `table.not_found`, `table.label_taken`
  - `deactivateTable(tx: Transaction, cfg: TillConfig, id: string): Promise<void>` — throws `table.not_found`

- [ ] **Step 1: Declare the two CRUD error codes.** In `apps/server/src/errors.ts`, inside the `interface ErrorParams` block (beside the `working_order.*` codes), add:

```typescript
    /**
     * No such dining table for this tenant. `tableId` is a caller-supplied uuid the till already holds,
     * not a secret — an id that matches nothing is unactionable if withheld (the rule `tenant.not_found`'s
     * note gives). Qualified `tableId` to match the domain-record not_found family
     * (`working_order.not_found`'s `workingOrderId`). `table.*` names the DOMAIN CONCEPT, never the
     * throwing package (`tenant.not_found`'s note); destined for @waitron/tables if that package is ever
     * extracted. An absent id, or another tenant's table (RLS hides it), both report THIS one code.
     * (A DEACTIVATED table is a different fact — `table.inactive` below — surfaced only where openTab
     * needs it; CRUD operates on a deactivated row by id regardless.)
     */
    "table.not_found": { tableId: string };
    /**
     * A dining table label already exists in this venue — the `(tenant_id, location_id, label)` unique
     * (`dining_tables_location_label_key`) rejected the insert/update. `label` is the operator-supplied
     * human id ("12", "Terraza 3"), not a secret, so echoing it is what makes the error actionable.
     * `table.*`, not `server.*`, for the reason `tenant.not_found`'s note gives.
     */
    "table.label_taken": { label: string };
```

- [ ] **Step 2: Write the failing CRUD test (PGlite).** Mirror `working-order.test.ts`'s `usePgliteDb` + `setupVenue` shape (a fresh tenant/location/till/node per test).

`apps/server/src/tables.test.ts`:

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
import { createTable, deactivateTable, listTables, updateTable } from "./tables.js";
import "./errors.js";

const LOCALE = "es-ES";
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let db: Database;
beforeAll(() => {
  db = suite.db;
});

async function setupVenue(): Promise<TillConfig> {
  const tenantId = await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array[${LOCALE}], 'Venta en establecimiento') returning id`);
  const locationId = loc.rows[0]!.id;
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Caja 1') returning id`);
  const nodeId = await seedNode(db, tenantId, brandLocationId(locationId));
  return {
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
}

function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

describe("table CRUD", () => {
  it("creates a table and lists it (active, by label)", async () => {
    const cfg = await setupVenue();
    const { id } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "12", zone: "terrace", capacity: 4 }));
    const tables = await asApp(cfg, (tx) => listTables(tx, cfg));
    expect(tables).toEqual([
      expect.objectContaining({ id, label: "12", zone: "terrace", capacity: 4, active: true }),
    ]);
  });

  it("refuses a duplicate label in the same venue (table.label_taken)", async () => {
    const cfg = await setupVenue();
    await asApp(cfg, (tx) => createTable(tx, cfg, { label: "7" }));
    await expect(
      asApp(cfg, (tx) => createTable(tx, cfg, { label: "7" })),
    ).rejects.toMatchObject({ code: "table.label_taken", params: { label: "7" } });
  });

  it("updates a table's fields", async () => {
    const cfg = await setupVenue();
    const { id } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "3" }));
    await asApp(cfg, (tx) => updateTable(tx, cfg, id, { label: "3A", capacity: 6 }));
    const [t] = await asApp(cfg, (tx) => listTables(tx, cfg));
    expect(t).toMatchObject({ id, label: "3A", capacity: 6 });
  });

  it("updateTable throws table.not_found for an unknown id", async () => {
    const cfg = await setupVenue();
    const missing = randomUUID();
    await expect(
      asApp(cfg, (tx) => updateTable(tx, cfg, missing, { label: "X" })),
    ).rejects.toMatchObject({ code: "table.not_found", params: { tableId: missing } });
  });

  it("updateTable surfaces a label collision as table.label_taken", async () => {
    const cfg = await setupVenue();
    await asApp(cfg, (tx) => createTable(tx, cfg, { label: "1" }));
    const { id } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "2" }));
    await expect(
      asApp(cfg, (tx) => updateTable(tx, cfg, id, { label: "1" })),
    ).rejects.toMatchObject({ code: "table.label_taken", params: { label: "1" } });
  });

  it("deactivate hides the table from the active list, and throws table.not_found on an unknown id", async () => {
    const cfg = await setupVenue();
    const { id } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "9" }));
    await asApp(cfg, (tx) => deactivateTable(tx, cfg, id));
    expect(await asApp(cfg, (tx) => listTables(tx, cfg))).toEqual([]);
    await expect(
      asApp(cfg, (tx) => deactivateTable(tx, cfg, randomUUID())),
    ).rejects.toMatchObject({ code: "table.not_found" });
  });
});
```

- [ ] **Step 3: Run — see it fail (no `tables.js`).**

Run: `pnpm --filter @waitron/server test tables.test`
Expected: FAIL — `Cannot find module './tables.js'` / `createTable is not a function`.

- [ ] **Step 4: Implement the CRUD verbs.**

`apps/server/src/tables.ts`:

```typescript
// Side-effect only: keeps this host's `table.*` codes (errors.ts) reachable from the file that throws
// them — the reachability convention `till-config.ts`/`till-sale.ts` follow. See errors.ts.
import "./errors.js";
import { and, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { diningTables, isUniqueViolation } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { TillConfig } from "./till-config.js";

/** A dining table as the CRUD surface returns it. `createdAt` is an ISO string. The `tab_id` back-pointer
 *  is an INTERNAL link (design §2b), not part of the CRUD surface — occupancy exposes it, not this. */
export interface DiningTable {
  id: string;
  label: string;
  zone: string | null;
  capacity: number | null;
  active: boolean;
  createdAt: string;
}

/**
 * Create a dining table in the till's venue (its `cfg.locationId`), returning the minted id. Runs on the
 * CALLER's transaction under its tenant/app_user scope. A duplicate `(tenant, location, label)` collides
 * on `dining_tables_location_label_key` (the only unique an INSERT can trip — `id` is fresh) and is
 * surfaced as `table.label_taken` rather than the raw 23505.
 */
export async function createTable(
  tx: Transaction,
  cfg: TillConfig,
  input: { label: string; zone?: string; capacity?: number },
): Promise<{ id: string }> {
  try {
    const [row] = await tx
      .insert(diningTables)
      .values({
        tenantId: cfg.tenantId,
        locationId: cfg.locationId,
        label: input.label,
        zone: input.zone ?? null,
        capacity: input.capacity ?? null,
      })
      .returning({ id: diningTables.id });
    return { id: row!.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("table.label_taken", { label: input.label });
    }
    throw error;
  }
}

/** The venue's ACTIVE tables, by `label`. RLS confines the read to the tenant; the location filter
 *  narrows to this till's venue. */
export async function listTables(tx: Transaction, cfg: TillConfig): Promise<DiningTable[]> {
  return tx
    .select({
      id: diningTables.id,
      label: diningTables.label,
      zone: diningTables.zone,
      capacity: diningTables.capacity,
      active: diningTables.active,
      createdAt: diningTables.createdAt,
    })
    .from(diningTables)
    .where(and(eq(diningTables.locationId, cfg.locationId), eq(diningTables.active, true)))
    .orderBy(diningTables.label);
}

/**
 * Edit a table's `label`/`zone`/`capacity` (any subset). An absent id (or another tenant's, RLS-hidden)
 * throws `table.not_found`; a label collision throws `table.label_taken`. Reactivate is `updateTable`-
 * shaped and kept trivial — this task deactivates via {@link deactivateTable}.
 */
export async function updateTable(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
  input: { label?: string; zone?: string; capacity?: number },
): Promise<void> {
  const patch: { label?: string; zone?: string | null; capacity?: number | null } = {};
  if (input.label !== undefined) patch.label = input.label;
  if (input.zone !== undefined) patch.zone = input.zone;
  if (input.capacity !== undefined) patch.capacity = input.capacity;

  let updated: { id: string }[];
  try {
    updated = await tx
      .update(diningTables)
      .set(patch)
      .where(eq(diningTables.id, id))
      .returning({ id: diningTables.id });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Only `label` participates in the unique, so it was necessarily supplied when this fires.
      throw new AppError("table.label_taken", { label: input.label! });
    }
    throw error;
  }
  if (updated.length === 0) {
    throw new AppError("table.not_found", { tableId: id });
  }
}

/** Deactivate a table (`active = false`) — never a hard delete (the table has order history; app_user
 *  holds no DELETE on `dining_tables`). An absent id throws `table.not_found`. */
export async function deactivateTable(tx: Transaction, cfg: TillConfig, id: string): Promise<void> {
  const updated = await tx
    .update(diningTables)
    .set({ active: false })
    .where(eq(diningTables.id, id))
    .returning({ id: diningTables.id });
  if (updated.length === 0) {
    throw new AppError("table.not_found", { tableId: id });
  }
}
```

- [ ] **Step 5: Run — see it pass.**

Run: `pnpm --filter @waitron/server test tables.test`
Expected: PASS (6 tests).

- [ ] **Step 6: Prove `table.label_taken` by deletion.** Temporarily comment the `if (isUniqueViolation(error))` branch in `createTable` (re-throw raw), rerun the duplicate-label test → it FAILS (raw 23505, not the domain code). Restore.

- [ ] **Step 7: Commit.**

```bash
git add apps/server/src/tables.ts apps/server/src/errors.ts apps/server/src/tables.test.ts
git commit -s -m "feat(server): dining-table CRUD verbs + table.* error codes (TS-1)"
```

---

## Task 4: `openTab` — the per-table `FOR UPDATE` lock (+ concurrent race)

**Files:**
- Modify: `apps/server/src/working-order.ts`, `apps/server/src/errors.ts`
- Test: `apps/server/src/tabs.test.ts` (PGlite), `apps/server/src/tabs.rls.test.ts` (real-PG)

**Interfaces:**
- Consumes: `createOpenOrder` (guarded here), `diningTables`, `workingOrders`, `allocateOrderNumber`.
- Produces:
  - `createOpenOrder(tx, cfg, id, lines, label)` — line insert now guarded (`if (lineRows.length > 0)`) so an EMPTY tab has no lines to insert; signature UNCHANGED, behaviour-preserving (existing callers always pass ≥1 line).
  - `openTab(tx: Transaction, cfg: TillConfig, req: { tableId: string; lines?: { productId: string; quantity: string }[] }): Promise<{ tabId: string; orderNumber: number }>` — throws `table.not_found`, `table.inactive`, `tab.already_open`.

- [ ] **Step 1: Declare the two new codes.** In `apps/server/src/errors.ts` add:

```typescript
    /**
     * A dining table exists but is deactivated, so no tab may be opened on it. `tableId` is the
     * caller-supplied uuid (not a secret). `table.*`, not `server.*`, for the reason `tenant.not_found`'s
     * note gives. Distinct from `table.not_found` (which covers a foreign/absent table): this one says
     * the table is real but closed for service. Mapped to 409 in the route layer.
     */
    "table.inactive": { tableId: string };
    /**
     * A table's `tab_id` already points at an OPEN working order, so a second tab may not be opened (at
     * most one open tab per table, design §2b). `openTab` takes the `dining_tables` row `FOR UPDATE` and
     * checks its `tab_id`; that per-table lock — there is NO partial-unique now — is the concurrency
     * guard, so two concurrent openTabs serialise and the second surfaces THIS code. A stale `tab_id`
     * (pointing at a settled/abandoned order) reads as free and is overwritten, so it does NOT trigger
     * this. `tab.*` names the DOMAIN CONCEPT (the running tab), never the throwing package. `tableId` —
     * the occupied table — is caller-supplied, not a secret. Mapped to 409 (the table's state forbids a
     * new tab).
     */
    "tab.already_open": { tableId: string };
```

- [ ] **Step 2: Guard `createOpenOrder`'s line insert.** In `apps/server/src/working-order.ts`, change ONLY the line-insert of `createOpenOrder` so an empty basket inserts no lines (openTab may open an EMPTY tab; `tx.insert(...).values([])` is an error). Replace:

```typescript
  // The parent order was inserted just above, so the composite FK and the
  // `require_open_parent`/`check_locales` triggers all resolve it.
  await tx.insert(workingOrderLines).values(lineRows);

  return { orderNumber, priced };
```

with:

```typescript
  // The parent order was inserted just above, so the composite FK and the
  // `require_open_parent`/`check_locales` triggers all resolve it. Guarded: an EMPTY tab (openTab with
  // no initial round) has no lines to insert, and `tx.insert(...).values([])` errors. Existing callers
  // always pass ≥1 line (they guard empty baskets before calling), so this never changes their path.
  if (lineRows.length > 0) {
    await tx.insert(workingOrderLines).values(lineRows);
  }

  return { orderNumber, priced };
```

- [ ] **Step 3: Write the failing PGlite verb test scaffolding + `openTab` cases.** Create `apps/server/src/tabs.test.ts` with a `setupVenue` that seeds two products and one table (reused by Tasks 5, 6, 9).

`apps/server/src/tabs.test.ts` (initial):

```typescript
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant, workingOrderLines, workingOrders } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { createTable } from "./tables.js";
import { openTab } from "./working-order.js";
import "./errors.js";

const LOCALE = "es-ES";
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let db: Database;
beforeAll(() => {
  db = suite.db;
});

interface Seeded {
  cfg: TillConfig;
  cafeId: string;
  aguaId: string;
  tableId: string;
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
  const { cafeId, aguaId, tableId } = await withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "Carta" });
    const bebidas = await createCategory(tx, { name: "Bebidas" });
    const cafe = await createProduct(tx, {
      catalogueId: cat.id, categoryId: bebidas.id, descriptions: { [LOCALE]: "Café" },
      pricingUnit: "each", unitPrice: "1.50", vatClass: "general",
    });
    const agua = await createProduct(tx, {
      catalogueId: cat.id, categoryId: bebidas.id, descriptions: { [LOCALE]: "Agua" },
      pricingUnit: "each", unitPrice: "2.00", vatClass: "general",
    });
    await assignCatalogueToLocation(tx, locationId, cat.id);
    const table = await createTable(tx, cfg, { label: "T1" });
    return { cafeId: cafe.id, aguaId: agua.id, tableId: table.id };
  });
  return { cfg, cafeId, aguaId, tableId };
}

function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** The dining table's current tab_id — owner read (bypasses RLS). */
async function tabIdOf(tableId: string): Promise<string | null> {
  const { rows } = await db.execute<{ tab_id: string | null }>(
    sql`select tab_id from dining_tables where id = ${tableId}`,
  );
  return rows[0]!.tab_id;
}

describe("openTab", () => {
  it("opens a tab, points the table's tab_id at it, with an initial round", async () => {
    const { cfg, cafeId, tableId } = await setupVenue();
    const { tabId, orderNumber } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }),
    );
    expect(orderNumber).toBe(1);
    const [wo] = await db.select().from(workingOrders).where(eq(workingOrders.id, tabId));
    expect(wo).toMatchObject({ status: "open", deliveryTableId: null });
    expect(await tabIdOf(tableId)).toBe(tabId);
    const lines = await db.select().from(workingOrderLines).where(eq(workingOrderLines.workingOrderId, tabId));
    expect(lines).toHaveLength(1);
  });

  it("opens a tab with NO initial round (empty tab)", async () => {
    const { cfg, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    expect(await tabIdOf(tableId)).toBe(tabId);
    const lines = await db.select().from(workingOrderLines).where(eq(workingOrderLines.workingOrderId, tabId));
    expect(lines).toHaveLength(0);
  });

  it("refuses a second tab on a table that already has an OPEN one (tab.already_open)", async () => {
    const { cfg, cafeId, tableId } = await setupVenue();
    await asApp(cfg, (tx) => openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }));
    await expect(
      asApp(cfg, (tx) => openTab(tx, cfg, { tableId })),
    ).rejects.toMatchObject({ code: "tab.already_open", params: { tableId } });
  });

  it("treats a STALE tab_id (pointing at a settled order) as free and overwrites it", async () => {
    const { cfg, cafeId, tableId } = await setupVenue();
    const { tabId: firstTab } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }),
    );
    // Settle the first tab (owner write — RLS bypassed, pure setup). tab_id STILL points at it (no
    // settle-time write, design §2b), but it is now stale.
    await db.execute(sql`update working_orders set status = 'settled', settled_at = now() where id = ${firstTab}`);
    // A fresh tab is fine — the stale pointer reads free and is overwritten to the new order.
    const { tabId: secondTab } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }),
    );
    expect(secondTab).not.toBe(firstTab);
    expect(await tabIdOf(tableId)).toBe(secondTab);
  });

  it("refuses an unknown table (table.not_found) and a deactivated one (table.inactive)", async () => {
    const { cfg, tableId } = await setupVenue();
    const missing = randomUUID();
    await expect(asApp(cfg, (tx) => openTab(tx, cfg, { tableId: missing }))).rejects.toMatchObject({
      code: "table.not_found", params: { tableId: missing },
    });
    // Deactivate the real table (owner write, RLS bypassed — pure setup), then a tab is refused.
    await db.execute(sql`update dining_tables set active = false where id = ${tableId}`);
    await expect(asApp(cfg, (tx) => openTab(tx, cfg, { tableId }))).rejects.toMatchObject({
      code: "table.inactive", params: { tableId },
    });
  });
});
```

- [ ] **Step 4: Run — see it fail.**

Run: `pnpm --filter @waitron/server test tabs.test`
Expected: FAIL — `openTab is not a function`.

- [ ] **Step 5: Implement `openTab`.** In `apps/server/src/working-order.ts`: add `import { randomUUID } from "node:crypto";` at the top, add `diningTables` to the `@waitron/db` import block, and add `openTab` beside `parkOrder`:

```typescript
/**
 * Open the running tab on a table (design §3a). Takes the `dining_tables` row `FOR UPDATE` — THIS
 * per-table lock is the one-open-tab-per-table concurrency guard: there is NO partial-unique now (a
 * single nullable `tab_id` gives one-tab-per-table structurally), so the lock is what serialises the
 * check-then-set. A second concurrent openTab on the same table blocks on this lock until the first
 * commits, then reads the now-set `tab_id`, finds it points at an OPEN order, and is refused
 * `tab.already_open` (proven by deletion of the lock — §7). A STALE `tab_id` (pointing at a
 * settled/abandoned order) reads as free and is OVERWRITTEN, so the fiscal pay path needs no settle-time
 * write (design §2b).
 *
 * Then creates an `open` working order (reusing `createOpenOrder`, incl. the per-node order-number
 * allocation) and points the table's `tab_id` at it. The order carries NO tab column — the link is this
 * back-pointer. `lines?` opens the tab with an initial round; absent, the tab opens empty. Runs on the
 * CALLER's transaction under its tenant/app_user scope. `table.not_found`/`table.inactive` guard the
 * table itself.
 */
export async function openTab(
  tx: Transaction,
  cfg: TillConfig,
  req: { tableId: string; lines?: { productId: string; quantity: string }[] },
): Promise<{ tabId: string; orderNumber: number }> {
  const [table] = await tx
    .select({ active: diningTables.active, tabId: diningTables.tabId })
    .from(diningTables)
    .where(eq(diningTables.id, req.tableId))
    .for("update");
  if (table === undefined) {
    throw new AppError("table.not_found", { tableId: req.tableId });
  }
  if (!table.active) {
    throw new AppError("table.inactive", { tableId: req.tableId });
  }

  // A set tab_id blocks a second tab ONLY while it points at a STILL-OPEN order; the WHERE clause does
  // the filtering, so a stale pointer (at a settled order) simply returns no row and is overwritten below.
  if (table.tabId !== null) {
    const [openTabRow] = await tx
      .select({ id: workingOrders.id })
      .from(workingOrders)
      .where(and(eq(workingOrders.id, table.tabId), eq(workingOrders.status, "open")));
    if (openTabRow !== undefined) {
      throw new AppError("tab.already_open", { tableId: req.tableId });
    }
  }

  const tabId = randomUUID();
  const { orderNumber } = await createOpenOrder(tx, cfg, tabId, req.lines ?? [], null);
  await tx.update(diningTables).set({ tabId }).where(eq(diningTables.id, req.tableId));
  return { tabId, orderNumber };
}
```

- [ ] **Step 6: Run — see it pass.**

Run: `pnpm --filter @waitron/server test tabs.test`
Expected: PASS (5 tests). Also run `pnpm --filter @waitron/server test working-order.test till-sale` to confirm the `createOpenOrder` line-insert guard left `parkOrder`/`payWorkingOrder`'s existing suites green (behaviour-preserving).

- [ ] **Step 7: Write the concurrent-openTab race (real Postgres).** Create `apps/server/src/tabs.rls.test.ts` — port the shared scaffolding from `working-order.rls.test.ts` (`useRealPostgres` `suite`, `systemClock`/`clock`, `backend` via `VerifactuBackend` in a `beforeAll`, `nextNif`, `tillConfigFromVenue`, `setupVenue` returning `{ cfg, cafe, agua }`, and the owner-read helpers `orderState`/`saleCount`/`registroCount` — copy them verbatim; the file is a sibling suite of the same shape). Add a table-seeding helper and the race.

`apps/server/src/tabs.rls.test.ts` (the openTab-race section; the ported scaffolding is added in this step and reused by Tasks 5/7/8):

```typescript
// ... shared scaffolding ported verbatim from working-order.rls.test.ts: `suite` (useRealPostgres),
// `clock`, `backend` (VerifactuBackend, set in beforeAll), `nextNif`, `tillConfigFromVenue`, `setupVenue`
// (returns { cfg, cafe, agua }), and owner-read helpers `orderState`/`saleCount`/`registroCount`. The
// ported scaffolding is verb-agnostic (owner-read SQL + venue setup), so each task adds only the verb
// imports IT uses — this task imports `openTab` + `createTable`; Tasks 5/7/8 extend the imports. Then:

import { createTable } from "./tables.js";
import { openTab } from "./working-order.js";

/** Seed one active dining table in the venue as the app role; returns its id. */
async function seedTable(cfg: TillConfig, label: string): Promise<string> {
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const { id } = await createTable(tx, cfg, { label });
    return id;
  });
}

/** How many OPEN working orders exist for the tenant — owner read (bypasses RLS). With the per-table
 *  FOR UPDATE lock, a race yields exactly ONE (the loser refuses BEFORE creating its order); without the
 *  lock, both create one → 2, and the table's single tab_id points at only one, orphaning the other. */
async function openOrderCount(cfg: TillConfig): Promise<number> {
  const { rows } = await suite.admin.execute<{ n: string }>(
    sql`select count(*)::text as n from working_orders where tenant_id = ${cfg.tenantId} and status = 'open'`,
  );
  return Number(rows[0]!.n);
}

describe("openTab concurrency (one open tab per table; the per-table lock IS the guard)", () => {
  it("two backends racing to open a tab on the SAME table → exactly one wins, the other gets tab.already_open", async () => {
    const { cfg, cafe } = await setupVenue();
    const tableId = await seedTable(cfg, "Race-1");

    const [connA, connB] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
    try {
      const pids = await Promise.all(
        [connA, connB].map((d) => d.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`).then((r) => r.rows[0]!.pid)),
      );
      expect(new Set(pids).size).toBe(2); // distinct backends — on PGlite these collapse (false pass).

      const attempt = (d: Database) =>
        withTenant(d, cfg.tenantId, async (tx) => {
          await asAppUser(tx);
          return openTab(tx, cfg, { tableId, lines: [{ productId: cafe.id, quantity: "1" }] });
        });

      const results = await Promise.allSettled([attempt(connA), attempt(connB)]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "tab.already_open", params: { tableId },
      });
      // The corruption observable: exactly ONE open working order exists. Without the lock both would be
      // created (the loser reads a stale tab_id=null) → 2, one orphaned by the single tab_id column.
      expect(await openOrderCount(cfg)).toBe(1);
    } finally {
      await Promise.all([connA.close(), connB.close()]);
    }
  });
});
```

- [ ] **Step 8: Run the race, and prove-by-deletion of the lock.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test tabs.rls`
Expected: PASS. To PROVE the per-table `FOR UPDATE` lock is the guard (there is no partial-unique to fall back on): temporarily remove `.for("update")` from `openTab`'s `dining_tables` SELECT, rerun → the race now yields `fulfilled = 2` / `rejected = 0` and `openOrderCount = 2` (both created their order; the table's `tab_id` points at only one). Restore the lock.

- [ ] **Step 9: Commit.**

```bash
git add apps/server/src/working-order.ts apps/server/src/errors.ts apps/server/src/tabs.test.ts apps/server/src/tabs.rls.test.ts
git commit -s -m "feat(server): openTab with per-table FOR UPDATE lock (+ concurrent race) (TS-1)"
```

---

## Task 5: `addTabRound` — append-only, concurrency-safe `line_no` (+ concurrent race)

**Files:**
- Modify: `apps/server/src/working-order.ts`, `apps/server/src/errors.ts`
- Test: `apps/server/src/tabs.test.ts` (append-without-reprice), `apps/server/src/tabs.rls.test.ts` (concurrent race)

**Interfaces:**
- Consumes: `priceOrderLines` (same-file private helper), `workingOrderLines`, `workingOrders`, `diningTables`.
- Produces:
  - `lockOpenTab(tx: Transaction, tabId: string): Promise<void>` (private) — locks the tab row `FOR UPDATE`, confirms it is `open` AND a `dining_tables.tab_id` points at it, else throws `tab.not_open`. Shared with `voidTabLine` (Task 6).
  - `addTabRound(tx: Transaction, cfg: TillConfig, tabId: string, lines: { productId: string; quantity: string }[]): Promise<void>` — throws `tab.not_open`, `sale.empty_basket`.

- [ ] **Step 1: Declare `tab.not_open`.** In `apps/server/src/errors.ts`:

```typescript
    /**
     * A working order a tab verb (`addTabRound`, `voidTabLine`) tried to modify is not an OPEN tab — it
     * is not `open` (already settled/abandoned), no `dining_tables.tab_id` points at it (a walk-up or a
     * counter delivery — a tab is an OPEN order a table points at, design §2b), or it names none (absent,
     * or another tenant's, RLS-hidden). All report THIS one code, the fail-closed shape
     * `working_order.not_open` uses for the held-order modify side. `tabId` — the caller-supplied uuid —
     * is echoed and qualified to match the tab-verb vocabulary. `tab.*`, not `server.*`, for the reason
     * `tenant.not_found`'s note gives. Mapped to 409 (the order's state forbids the tab edit).
     */
    "tab.not_open": { tabId: string };
```

- [ ] **Step 2: Write the failing append-without-reprice test (PGlite).** Add to `apps/server/src/tabs.test.ts` (extend the `./working-order.js` import with `addTabRound`, and add the `bareOpenOrder` helper below):

```typescript
/** Insert a bare OPEN working order that NO table points at (a walk-up) — for the "not a tab" case. */
async function bareOpenOrder(cfg: TillConfig, id: string): Promise<void> {
  await db.execute(sql`
    insert into working_orders (id, tenant_id, till_id, node_id, order_number, status)
    values (${id}, ${cfg.tenantId}, ${cfg.tillId}, ${cfg.nodeId}, 999, 'open')`);
}

describe("addTabRound (append-only, no re-price)", () => {
  it("appends a round with the NEXT line_no, without deleting or re-pricing existing lines", async () => {
    const { cfg, cafeId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }));
    // Round 2 at the current 1.50.
    await asApp(cfg, (tx) => addTabRound(tx, cfg, tabId, [{ productId: cafeId, quantity: "1" }]));
    // Change the catalogue price AFTER two rounds are locked.
    await asApp(cfg, (tx) => tx.execute(sql`update products set unit_price = '9.99' where id = ${cafeId}`));
    // Round 3 prices at the NEW 9.99 — but rounds 1 & 2 are UNTOUCHED (the load-bearing behaviour; a
    // full-basket replace like updateHeldOrder would re-price ALL to 9.99).
    await asApp(cfg, (tx) => addTabRound(tx, cfg, tabId, [{ productId: cafeId, quantity: "1" }]));

    const lines = await db
      .select({ lineNo: workingOrderLines.lineNo, gross: workingOrderLines.unitPriceGross })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo);
    expect(lines).toEqual([
      { lineNo: 1, gross: "1.50" },
      { lineNo: 2, gross: "1.50" },
      { lineNo: 3, gross: "9.99" },
    ]);
  });

  it("refuses a round on a settled tab, a walk-up (not a tab), and an absent id (tab.not_open)", async () => {
    const { cfg, cafeId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }));
    // Settled tab → not open.
    await db.execute(sql`update working_orders set status = 'settled', settled_at = now() where id = ${tabId}`);
    await expect(
      asApp(cfg, (tx) => addTabRound(tx, cfg, tabId, [{ productId: cafeId, quantity: "1" }])),
    ).rejects.toMatchObject({ code: "tab.not_open", params: { tabId } });

    // A bare open walk-up (no table points at it) is not a tab.
    const walkUp = randomUUID();
    await bareOpenOrder(cfg, walkUp);
    await expect(
      asApp(cfg, (tx) => addTabRound(tx, cfg, walkUp, [{ productId: cafeId, quantity: "1" }])),
    ).rejects.toMatchObject({ code: "tab.not_open", params: { tabId: walkUp } });

    // An absent id names nothing.
    const missing = randomUUID();
    await expect(
      asApp(cfg, (tx) => addTabRound(tx, cfg, missing, [{ productId: cafeId, quantity: "1" }])),
    ).rejects.toMatchObject({ code: "tab.not_open", params: { tabId: missing } });
  });

  it("refuses an empty round (sale.empty_basket)", async () => {
    const { cfg, cafeId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }));
    await expect(asApp(cfg, (tx) => addTabRound(tx, cfg, tabId, []))).rejects.toMatchObject({
      code: "sale.empty_basket",
    });
  });
});
```

- [ ] **Step 3: Run — see it fail.**

Run: `pnpm --filter @waitron/server test tabs.test`
Expected: FAIL — `addTabRound is not a function`.

- [ ] **Step 4: Implement `lockOpenTab` + `addTabRound`.** In `apps/server/src/working-order.ts`, beside `openTab`:

```typescript
/**
 * Lock an OPEN tab's working-order row `FOR UPDATE` and confirm a dining table points at it — the shared
 * guard `addTabRound` and `voidTabLine` open with. The lock is held on the caller's `tx` until commit,
 * so a `line_no` allocation or a line delete that follows is serialised against a concurrent round/void
 * (load-bearing for QR ordering — several guests appending to one tab at once). A tab is an OPEN working
 * order some `dining_tables.tab_id` points at (design §2b): a non-open order, one no table points at (a
 * walk-up / counter delivery), or an absent id (or another tenant's, RLS-hidden) all throw
 * `tab.not_open` — the fail-closed shape `working_order.not_open` uses for the modify side.
 */
async function lockOpenTab(tx: Transaction, tabId: string): Promise<void> {
  const [tab] = await tx
    .select({ status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, tabId))
    .for("update");
  if (tab === undefined || tab.status !== "open") {
    throw new AppError("tab.not_open", { tabId });
  }
  const [pointer] = await tx
    .select({ id: diningTables.id })
    .from(diningTables)
    .where(eq(diningTables.tabId, tabId));
  if (pointer === undefined) {
    throw new AppError("tab.not_open", { tabId });
  }
}

/**
 * APPEND a priced round to an OPEN tab (design §3b) — the one genuinely new order primitive. It locks
 * each new line's `unit_price_gross` at add-time (via `priceOrderLines`) and assigns the NEXT `line_no`,
 * WITHOUT deleting or re-pricing existing lines. Contrast `updateHeldOrder`, which deletes and re-inserts
 * the whole basket (`:511-513`), re-locking every line at the current catalogue price — wrong for an
 * incremental tab.
 *
 * Concurrency (load-bearing for QR ordering — multiple guests append to one shared tab at once): the tab
 * row is taken `FOR UPDATE` by {@link lockOpenTab}, so `line_no` allocation serialises on it (the locking
 * shape the per-node order-number allocator uses, `working-order.ts:263`). A naïve `max(line_no)+1`
 * without the lock races and collides on the `(working_order_id, line_no)` unique (`orders.ts:186`) — a
 * real-PG concurrent test proves it by deletion of the lock.
 */
export async function addTabRound(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  lines: { productId: string; quantity: string }[],
): Promise<void> {
  await lockOpenTab(tx, tabId);
  if (lines.length === 0) {
    throw new AppError("sale.empty_basket", {});
  }
  // The next line_no, allocated under the per-tab row lock — concurrent rounds serialise on it, so no two
  // reads see the same max.
  const [{ maxLineNo }] = await tx
    .select({ maxLineNo: sql<number>`coalesce(max(${workingOrderLines.lineNo}), 0)::int` })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId));
  // Price the round (locks each new gross unit at add-time), then APPEND: renumber from maxLineNo+1,
  // never touching existing lines. `priceOrderLines` numbers its rows 1..n in `lines` order, so row i
  // maps to maxLineNo + i + 1.
  const { lineRows } = await priceOrderLines(tx, cfg, tabId, lines);
  const appended = lineRows.map((row, i) => ({ ...row, lineNo: maxLineNo + i + 1 }));
  await tx.insert(workingOrderLines).values(appended);
}
```

- [ ] **Step 5: Run — see it pass.**

Run: `pnpm --filter @waitron/server test tabs.test`
Expected: PASS (all `openTab` + `addTabRound` cases).

- [ ] **Step 6: Write the concurrent-addTabRound race (real Postgres).** Add to `apps/server/src/tabs.rls.test.ts` (extend the `./working-order.js` import to add `addTabRound` beside `openTab`):

```typescript
describe("addTabRound concurrency (distinct line_no under load)", () => {
  const ROUNDS = 10;
  it("N backends appending one line each to ONE tab all land with distinct contiguous line_nos", async () => {
    const { cfg, cafe } = await setupVenue();
    const tableId = await seedTable(cfg, "Race-2");
    // Open the tab EMPTY (no initial round) so the appended line_nos are exactly 1..N.
    const { tabId } = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return openTab(tx, cfg, { tableId });
    });

    const dbs = await Promise.all(Array.from({ length: ROUNDS }, () => suite.pg.connect()));
    try {
      const pids = await Promise.all(
        dbs.map((d) => d.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`).then((r) => r.rows[0]!.pid)),
      );
      expect(new Set(pids).size).toBe(ROUNDS); // distinct backends — the race is real.

      await Promise.all(
        dbs.map((d) =>
          withTenant(d, cfg.tenantId, async (tx) => {
            await asAppUser(tx);
            return addTabRound(tx, cfg, tabId, [{ productId: cafe.id, quantity: "1" }]);
          }),
        ),
      );

      const { rows } = await suite.admin.execute<{ line_no: number }>(
        sql`select line_no from working_order_lines where working_order_id = ${tabId} order by line_no`,
      );
      expect(rows.map((r) => r.line_no)).toEqual(Array.from({ length: ROUNDS }, (_, i) => i + 1));
    } finally {
      await Promise.all(dbs.map((d) => d.close()));
    }
  });
});
```

- [ ] **Step 7: Run the race, and prove-by-deletion of the per-tab lock.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test tabs.rls`
Expected: PASS. To PROVE the lock: temporarily remove `.for("update")` from `lockOpenTab`'s tab-row SELECT, rerun → the concurrent test FAILS with a `23505` on `working_order_lines_line_no_key` (two rounds computed the same `line_no`). Restore the lock.

- [ ] **Step 8: Package green + commit.**

Run: `pnpm --filter @waitron/server test:coverage` (and the real-PG suites with `TESTCONTAINERS_RYUK_DISABLED=true`).

```bash
git add apps/server/src/working-order.ts apps/server/src/errors.ts apps/server/src/tabs.test.ts apps/server/src/tabs.rls.test.ts
git commit -s -m "feat(server): addTabRound append-only + concurrency-safe line_no (TS-1)"
```

---

## Task 6: `voidTabLine`

**Files:**
- Modify: `apps/server/src/working-order.ts`, `apps/server/src/errors.ts`
- Test: `apps/server/src/tabs.test.ts`

**Interfaces:**
- Consumes: `lockOpenTab` (Task 5), `workingOrderLines`.
- Produces: `voidTabLine(tx: Transaction, cfg: TillConfig, tabId: string, lineNo: number): Promise<void>` — throws `tab.not_open`, `tab.line_not_found`.

- [ ] **Step 1: Declare `tab.line_not_found`.** In `apps/server/src/errors.ts`:

```typescript
    /**
     * A per-line void named no line on the OPEN tab — the `line_no` matches nothing on it (already
     * voided, or never existed). Pre-fiscal: nothing is filed for an open tab, so a void is a plain
     * delete with no fiscal record or amendment. `tabId` + `lineNo` are caller-supplied and echoed
     * (neither a secret). `tab.*`, not `server.*`, for the reason `tenant.not_found`'s note gives.
     * Mapped to 404 (the line named does not exist).
     */
    "tab.line_not_found": { tabId: string; lineNo: number };
```

- [ ] **Step 2: Write the failing test (PGlite).** Add to `apps/server/src/tabs.test.ts` (extend the `./working-order.js` import with `voidTabLine`):

```typescript
describe("voidTabLine", () => {
  it("deletes one line from an open tab and leaves the rest", async () => {
    const { cfg, cafeId, aguaId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }),
    );
    await asApp(cfg, (tx) => addTabRound(tx, cfg, tabId, [{ productId: aguaId, quantity: "1" }])); // line 2
    await asApp(cfg, (tx) => voidTabLine(tx, cfg, tabId, 1));

    const lines = await db
      .select({ lineNo: workingOrderLines.lineNo })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo);
    expect(lines).toEqual([{ lineNo: 2 }]);
  });

  it("throws tab.line_not_found for a line_no that matches nothing", async () => {
    const { cfg, cafeId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }),
    );
    await expect(asApp(cfg, (tx) => voidTabLine(tx, cfg, tabId, 99))).rejects.toMatchObject({
      code: "tab.line_not_found", params: { tabId, lineNo: 99 },
    });
  });

  it("throws tab.not_open for a settled order", async () => {
    const { cfg, cafeId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }),
    );
    await db.execute(sql`update working_orders set status = 'settled', settled_at = now() where id = ${tabId}`);
    await expect(asApp(cfg, (tx) => voidTabLine(tx, cfg, tabId, 1))).rejects.toMatchObject({
      code: "tab.not_open", params: { tabId },
    });
  });
});
```

- [ ] **Step 3: Run — see it fail.**

Run: `pnpm --filter @waitron/server test tabs.test`
Expected: FAIL — `voidTabLine is not a function`.

- [ ] **Step 4: Implement `voidTabLine`.** In `apps/server/src/working-order.ts`, beside `addTabRound`:

```typescript
/**
 * Void ONE not-yet-paid line from an OPEN tab (design §3b) — pre-fiscal, so nothing is filed and there
 * is no fiscal record or amendment involved; it is a plain delete under the open parent (the
 * `require_open_parent` trigger is the DB backstop). {@link lockOpenTab} locks the tab row `FOR UPDATE`
 * so a concurrent round/pay cannot race the delete, and confirms it is an open tab. `tab.not_open` if the
 * order is not an open tab; `tab.line_not_found` if the `line_no` matches nothing on it. `cfg` is unused
 * (the delete is by tab id + line no, RLS-scoped) but kept for the tab-verb signature shape the route
 * layer calls uniformly.
 */
export async function voidTabLine(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  lineNo: number,
): Promise<void> {
  await lockOpenTab(tx, tabId);
  const deleted = await tx
    .delete(workingOrderLines)
    .where(and(eq(workingOrderLines.workingOrderId, tabId), eq(workingOrderLines.lineNo, lineNo)))
    .returning({ lineNo: workingOrderLines.lineNo });
  if (deleted.length === 0) {
    throw new AppError("tab.line_not_found", { tabId, lineNo });
  }
}
```

- [ ] **Step 5: Run — see it pass, then prove-by-deletion.**

Run: `pnpm --filter @waitron/server test tabs.test`
Expected: PASS. Prove the `deleted.length === 0` gate: comment it out, rerun the `tab.line_not_found` test → it FAILS (a delete matching nothing resolves silently). Restore.

- [ ] **Step 6: Commit.**

```bash
git add apps/server/src/working-order.ts apps/server/src/errors.ts apps/server/src/tabs.test.ts
git commit -s -m "feat(server): voidTabLine per-line void on an open tab (TS-1)"
```

---

## Task 7: Pay closes the tab + the H2 huella-independence proof

**Files:**
- Test: `apps/server/src/tabs.rls.test.ts` (pay-closes-tab, huella-identity)
- (No production code — pay reuses `payWorkingOrder`/`recordSale` UNCHANGED. This task proves it and records the H2 grep receipt.)

**Interfaces:**
- Consumes: `openTab`, `addTabRound` (Tasks 4/5); `payWorkingOrder` (`till-sale.ts`, UNCHANGED); `VerifactuBackend`.

- [ ] **Step 1: The H2 grep receipt.** Run and record (in the test file's header comment) that neither the fiscal core nor the alta builder reads the delivery-table column (in the revised model, the ONLY table column on `working_orders` — the tab link is a back-pointer on the TABLE, so nothing about a tab reaches the filed order at all):

Run:
```bash
grep -nE "table_id|delivery_table_id|tableId|deliveryTableId" packages/core/src/record-sale.ts packages/fiscal-verifactu/src/backend.ts
```
Expected: **zero matches** (verified 2026-08-17: the command exits non-zero with no output). `recordSale`'s input (`RecordSaleInput`) carries `workingOrderId` but no table column, and the huella hashes only the AEAT-mandated invoice fields (issuer NIF, series+number, expedition date, invoice type, tax + grand totals, the previous huella, the generation timestamp) — none of which is a table column. Paste this command + its empty output into the huella-identity test's doc comment as the receipt.

- [ ] **Step 1b: Re-verify the "a tab lives in `open`" boundary (§5/§10).** The fiscal-boundary claim is that a tab must stay `open` because `placed` under Mode I (`invoice_first`) already files a deferred invoice — so a tab never enters `placed`; it settles straight from `open` via `payWorkingOrder`. Confirm no tab verb transitions to `placed` or calls `placeOrder`:

Run:
```bash
grep -n "invoice_first" apps/server/src/working-order.ts        # placeOrder's Mode-I deferred file (~:646)
grep -nE "placeOrder|status.*placed" apps/server/src/working-order.ts | grep -iE "openTab|addTabRound|voidTabLine"
```
Expected: the first names `placeOrder` (the deferred-invoice branch); the second is **empty** — `openTab`/`addTabRound`/`voidTabLine` never transition to `placed` or call `placeOrder`. A tab is created `open` (`createOpenOrder` sets `status: "open"`) and pay settles it `open → settled` (`payWorkingOrder`), so it is never at `placed` and files nothing until pay. Record this in the test file's header comment.

- [ ] **Step 2: Write the pay-closes-tab test (real Postgres).** Add to `apps/server/src/tabs.rls.test.ts` (import `payWorkingOrder` from `./till-sale.js` in the ported scaffolding):

```typescript
describe("pay closes the tab (reuses payWorkingOrder → recordSale UNCHANGED)", () => {
  it("openTab + addTabRound → payWorkingOrder settles it, files one sale + registro, table reads free", async () => {
    const { cfg, cafe, agua } = await setupVenue();
    const tableId = await seedTable(cfg, "Pay-1");
    const deps = { db: suite.admin, backend, clock };

    const { tabId } = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return openTab(tx, cfg, { tableId, lines: [{ productId: cafe.id, quantity: "1" }] });
    });
    await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return addTabRound(tx, cfg, tabId, [{ productId: agua.id, quantity: "1" }]);
    });

    // Pay the tab by its id — the retrieved-order path (files the STORED lines; req.lines ignored).
    const res = await payWorkingOrder(deps, cfg, { id: tabId, lines: [], tender: { method: "cash", amount: "5.00" } });
    expect(res.total).toBe("3.50"); // 1.50 café + 2.00 agua
    expect(res.invoiceNumber).toBe("A/1");
    expect(await orderState(tabId)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(tabId)).toBe(1);
    expect(await registroCount(tabId)).toBe(1);

    // The table now reads free: its tab_id STILL points at the order (no settle-time write), but the
    // order is settled, so the "open tab" join finds nothing (occupancy — Task 9).
    const { rows } = await suite.admin.execute<{ n: string }>(sql`
      select count(*)::text as n
      from dining_tables dt join working_orders wo on wo.id = dt.tab_id and wo.tenant_id = dt.tenant_id
      where dt.id = ${tableId} and wo.status = 'open'`);
    expect(Number(rows[0]!.n)).toBe(0);
  });
});
```

- [ ] **Step 3: Write the huella-identity test (real Postgres).** Two nodes under ONE tenant (one NIF), each with its own series coded "A" (`invoice_series_node_code_key` is `(tenant, node, code)`, so both may be "A"), a FIXED clock so the timestamps match, then file the SAME basket as a walk-up (no table) on node 1 and as a TAB (a `dining_tables` row points at the order) on node 2 → each is `A/1` primer_registro under the same NIF, so the huellas are identical iff no table field is hashed (and in the revised model the filed order carries no tab field at all).

Add to `apps/server/src/tabs.rls.test.ts` a fixed clock and a second-node/series seeder, then the test (import `TrustedClock` from `@waitron/fiscal`; `brandNodeId`/`brandSeriesId` are already in the ported scaffolding):

```typescript
/** A trusted clock pinned to ONE instant, so two independent filings hash the same
 *  FechaHoraHusoGenRegistro / FechaExpedicionFactura — the control that isolates the tab-ness. */
function fixedClock(instant: Date): TrustedClock {
  return {
    now: () => ({ instant, offsetMinutes: 60, confident: true, confidence: "anchored", anchorAgeSeconds: 0 }),
    anchor: () => { throw new Error("tabs.rls.test: anchor() unused"); },
    currentAnchor: () => null,
  };
}

/** Seed a SECOND node + a standard series coded "A" under the SAME tenant/location as `cfg`, returning a
 *  cfg pointed at them. Inserted as the owner under withTenant (an explicit tenant_id satisfies WITH
 *  CHECK). The series↔node guard requires the series to belong to this node — hence a real seeded node. */
async function secondNodeSeriesA(cfg: TillConfig): Promise<TillConfig> {
  const nodeId = randomUUID();
  const seriesId = randomUUID();
  await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await tx.execute(sql`
      insert into nodes (id, tenant_id, location_id, name) values (${nodeId}, ${cfg.tenantId}, ${cfg.locationId}, 'Servidor 2')`);
    await tx.execute(sql`
      insert into invoice_series (id, tenant_id, node_id, code, purpose, next_number)
      values (${seriesId}, ${cfg.tenantId}, ${nodeId}, 'A', 'standard', 1)`);
  });
  return { ...cfg, nodeId: brandNodeId(nodeId), seriesId: brandSeriesId(seriesId) };
}

/** The filed huella for a working order's sale — owner read (bypasses RLS). */
async function filedHuella(workingOrderId: string): Promise<string> {
  const { rows } = await suite.admin.execute<{ huella: string }>(sql`
    select r.huella from registros_facturacion r
    join sales s on s.id = r.sale_id
    where s.working_order_id = ${workingOrderId}`);
  return rows[0]!.huella;
}

describe("H2: the huella is independent of whether the order was a tab", () => {
  // Receipt (Step 1): `grep -nE 'table_id|delivery_table_id|tableId|deliveryTableId'
  // packages/core/src/record-sale.ts packages/fiscal-verifactu/src/backend.ts` → zero matches. The filed
  // working_orders row carries NO tab-membership (the tab link is a back-pointer on dining_tables), and
  // delivery_table_id is not read; the huella hashes only the AEAT invoice fields.
  it("the SAME basket filed walk-up and from a tab yields the identical huella", async () => {
    const at = new Date("2026-08-17T19:20:30+01:00");
    const clockFixed = fixedClock(at);
    const deps = { db: suite.admin, backend, clock: clockFixed };

    // Node 1 (from setupVenue) — walk-up, no table → A/1, primer_registro.
    const { cfg, cafe } = await setupVenue();
    const walkUpId = randomUUID();
    await payWorkingOrder(deps, cfg, {
      id: walkUpId,
      lines: [{ productId: cafe.id, quantity: "1" }],
      tender: { method: "cash", amount: "5.00" },
    });

    // Node 2 (same tenant/NIF, series "A") — a TAB on a table (dining_tables.tab_id → the order) →
    // also A/1, primer_registro.
    const cfg2 = await secondNodeSeriesA(cfg);
    const tableId = await seedTable(cfg2, "H2-tab");
    const { tabId } = await withTenant(suite.admin, cfg2.tenantId, async (tx) => {
      await asAppUser(tx);
      return openTab(tx, cfg2, { tableId, lines: [{ productId: cafe.id, quantity: "1" }] });
    });
    await payWorkingOrder(deps, cfg2, { id: tabId, lines: [], tender: { method: "cash", amount: "5.00" } });

    // Same NIF + same "A/1" + same fixed timestamp + same amounts + both primer_registro ⇒ identical
    // huella (nothing about the tab reaches the filed record).
    expect(await filedHuella(tabId)).toBe(await filedHuella(walkUpId));
  });
});
```

- [ ] **Step 4: Run — see it pass, then prove the huella-identity test bites.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test tabs.rls`
Expected: PASS. To confirm the identity assertion is not vacuously true, temporarily change one filing's basket (e.g. `quantity: "2"` on the tab) and rerun → the assertion FAILS (different `ImporteTotal` ⇒ different huella), proving it discriminates. Restore.

- [ ] **Step 5: Commit.**

```bash
git add apps/server/src/tabs.rls.test.ts
git commit -s -m "test(server): pay-closes-tab + H2 huella-independence proof (TS-1)"
```

---

## Task 8: Counter delivery — thread `deliveryTableId`

**Files:**
- Modify: `apps/server/src/working-order.ts` (`createOpenOrder` gains `placement`), `apps/server/src/till-sale.ts`
- Test: `apps/server/src/tabs.rls.test.ts`

**Interfaces:**
- Produces:
  - `createOpenOrder(tx, cfg, id, lines, label, placement?: { deliveryTableId?: string | null }): Promise<{ orderNumber: number; priced: PricedBasket }>` — signature gains an OPTIONAL trailing `placement` (existing callers omit it → a plain walk-up).
  - `TillSaleRequest` gains `deliveryTableId?: string`; `PayWorkingOrderRequest` gains `deliveryTableId?: string`.
  - `recordTillSale` / `payWorkingOrder` thread it to the WALK-UP create path only (a delivery is a fresh immediate sale that records where to carry it; a retrieved order ignores it).

- [ ] **Step 1: Write the failing test (real Postgres).** Add to `apps/server/src/tabs.rls.test.ts` (import `recordTillSale` from `./till-sale.js` beside `payWorkingOrder`):

```typescript
/** The delivery_table_id stamped on a working order — owner read. */
async function deliveryTableOf(workingOrderId: string): Promise<string | null> {
  const { rows } = await suite.admin.execute<{ d: string | null }>(
    sql`select delivery_table_id as d from working_orders where id = ${workingOrderId}`,
  );
  return rows[0]!.d;
}

describe("counter delivery (deliveryTableId on a walk-up sale)", () => {
  it("records delivery_table_id on the walk-up order and files one sale (it is NOT a tab)", async () => {
    const { cfg, cafe } = await setupVenue();
    const tableId = await seedTable(cfg, "Del-1");
    const deps = { db: suite.admin, backend, clock };

    const id = randomUUID();
    const res = await recordTillSale(deps, cfg, {
      workingOrderId: id,
      lines: [{ productId: cafe.id, quantity: "1" }],
      tender: { method: "cash", amount: "5.00" },
      deliveryTableId: tableId,
    });
    expect(res.invoiceNumber).toBe("A/1");
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await deliveryTableOf(id)).toBe(tableId);
    // A delivery is NOT a tab — no dining_tables row points at it.
    const { rows } = await suite.admin.execute<{ n: string }>(
      sql`select count(*)::text as n from dining_tables where tab_id = ${id}`,
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });
});
```

- [ ] **Step 2: Run — see it fail.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test tabs.rls`
Expected: FAIL — `deliveryTableId` is not a known property of `TillSaleRequest` (typecheck) / `deliveryTableOf` returns null.

- [ ] **Step 3: Add the `placement` param to `createOpenOrder`.** In `apps/server/src/working-order.ts`, extend the signature and the insert (the empty-lines guard from Task 4 stays):

```typescript
export async function createOpenOrder(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
  lines: { productId: string; quantity: string }[],
  label: string | null,
  // A counter delivery sets `deliveryTableId` (design §2b/§3c). Defaults to {}, so parkOrder and
  // payWorkingOrder's walk-up path are unchanged (they omit it → a plain walk-up). A TAB does NOT flow
  // through here — its link is the `dining_tables.tab_id` back-pointer openTab sets, not an order column.
  placement: { deliveryTableId?: string | null } = {},
): Promise<{ orderNumber: number; priced: PricedBasket }> {
  const { lineRows, priced } = await priceOrderLines(tx, cfg, id, lines);
  const orderNumber = await allocateOrderNumber(tx, cfg.tenantId, cfg.nodeId);

  await tx.insert(workingOrders).values({
    id,
    tenantId: cfg.tenantId,
    tillId: cfg.tillId,
    nodeId: cfg.nodeId,
    orderNumber,
    label,
    status: "open",
    deliveryTableId: placement.deliveryTableId ?? null,
  });

  if (lineRows.length > 0) {
    await tx.insert(workingOrderLines).values(lineRows);
  }

  return { orderNumber, priced };
}
```

- [ ] **Step 4: Thread `deliveryTableId` through the pay chain.** In `apps/server/src/till-sale.ts`:

Add to `TillSaleRequest` (after `workingOrderId?: string;`):

```typescript
  /**
   * Deliver this counter sale to a dining table (design §3c) — written to
   * `working_orders.delivery_table_id`. Optional: a plain walk-up omits it. A counter delivery is a
   * normal immediate sale that simply records WHERE to carry it; it is NOT a tab (a tab is the reverse
   * link, `dining_tables.tab_id`). Only the WALK-UP create path writes it — a retrieved order ignores it
   * (you do not "deliver" a parked order).
   */
  deliveryTableId?: string;
```

Add the same field to `PayWorkingOrderRequest` (after `tender`):

```typescript
  /** Deliver a WALK-UP sale to a dining table (design §3c) — passed to `createOpenOrder` as the order's
   *  `delivery_table_id`. Ignored for a retrieved order (a delivery is always a fresh walk-up). */
  deliveryTableId?: string;
```

In `payWorkingOrder`, the WALK-UP branch (`if (locked === undefined) { … createOpenOrder(…) }`) passes the placement — replace the `createOpenOrder` call there:

```typescript
          ({ priced } = await createOpenOrder(tx, cfg, req.id, req.lines, null, {
            deliveryTableId: req.deliveryTableId,
          }));
```

In `recordTillSale`, thread it into the `PayWorkingOrderRequest`:

```typescript
  return payWorkingOrder(
    deps,
    cfg,
    {
      id: req.workingOrderId ?? randomUUID(),
      lines: req.lines,
      tender: req.tender,
      deliveryTableId: req.deliveryTableId,
    },
    operatorId,
  );
```

- [ ] **Step 5: Run — see it pass.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test tabs.rls`
Expected: PASS. Confirm the existing `till-sale`/`working-order` suites are still green (`pnpm --filter @waitron/server test till-sale working-order`), since `createOpenOrder`'s new optional `placement` defaults to a plain walk-up and the other two callers (`parkOrder`, `payWorkingOrderIntegrated`) omit it.

- [ ] **Step 6: Package green + commit.**

Run: `pnpm --filter @waitron/server test:coverage` (real-PG suites with `TESTCONTAINERS_RYUK_DISABLED=true`).

```bash
git add apps/server/src/till-sale.ts apps/server/src/working-order.ts apps/server/src/tabs.rls.test.ts
git commit -s -m "feat(server): counter delivery-to-table link (deliveryTableId) (TS-1)"
```

---

## Task 9: `listTablesWithState` occupancy read-model

**Files:**
- Modify: `apps/server/src/working-order.ts`
- Test: `apps/server/src/tabs.test.ts`

**Interfaces:**
- Produces:
  - `interface TableState { id: string; label: string; zone: string | null; capacity: number | null; state: "free" | "open-tab" | "delivery-pending"; hasOpenTab: boolean; tabId?: string; tabLineCount?: number; tabTotal?: string; pendingDeliveries: number }`
  - `listTablesWithState(tx: Transaction, cfg: TillConfig, locationId?: string): Promise<TableState[]>`

- [ ] **Step 1: Write the failing occupancy test (PGlite).** Add to `apps/server/src/tabs.test.ts` (extend the `./working-order.js` import with `listTablesWithState`). For a hermetic PGlite delivery, seed the settled delivery order + its prep row directly.

```typescript
describe("listTablesWithState (occupancy)", () => {
  it("reflects free → open-tab → free as a tab opens and pays", async () => {
    const { cfg, cafeId, tableId } = await setupVenue();

    const free = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    expect(free).toEqual([
      expect.objectContaining({ id: tableId, state: "free", hasOpenTab: false, pendingDeliveries: 0 }),
    ]);

    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "2" }] }));
    const busy = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    expect(busy[0]).toMatchObject({
      state: "open-tab", hasOpenTab: true, tabId, tabLineCount: 1, tabTotal: "3.00", pendingDeliveries: 0,
    });

    // Settle the tab (tab_id still points at it, now stale); the table frees.
    await db.execute(sql`update working_orders set status = 'settled', settled_at = now() where id = ${tabId}`);
    const freed = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    expect(freed[0]).toMatchObject({ state: "free", hasOpenTab: false });
  });

  it("shows delivery-pending while a delivery's prep is uncollected, and free once collected", async () => {
    const { cfg, tableId } = await setupVenue();
    // A settled counter delivery to the table, with an uncollected prep row (queued).
    const orderId = randomUUID();
    await db.execute(sql`
      insert into working_orders (id, tenant_id, till_id, node_id, order_number, status, settled_at, delivery_table_id)
      values (${orderId}, ${cfg.tenantId}, ${cfg.tillId}, ${cfg.nodeId}, 500, 'settled', now(), ${tableId})`);
    await asApp(cfg, (tx) =>
      tx.execute(sql`insert into order_prep (tenant_id, working_order_id, node_id, state)
        values (${cfg.tenantId}, ${orderId}, ${cfg.nodeId}, 'queued')`),
    );

    const pending = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    expect(pending[0]).toMatchObject({ state: "delivery-pending", hasOpenTab: false, pendingDeliveries: 1 });

    // Collected → no lingering occupancy.
    await asApp(cfg, (tx) =>
      tx.execute(sql`update order_prep set state = 'collected', collected_at = now() where working_order_id = ${orderId}`),
    );
    const cleared = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    expect(cleared[0]).toMatchObject({ state: "free", pendingDeliveries: 0 });
  });

  it("open-tab dominates delivery-pending in the rolled-up state", async () => {
    const { cfg, cafeId, tableId } = await setupVenue();
    await asApp(cfg, (tx) => openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }));
    const orderId = randomUUID();
    await db.execute(sql`
      insert into working_orders (id, tenant_id, till_id, node_id, order_number, status, settled_at, delivery_table_id)
      values (${orderId}, ${cfg.tenantId}, ${cfg.tillId}, ${cfg.nodeId}, 501, 'settled', now(), ${tableId})`);
    await asApp(cfg, (tx) =>
      tx.execute(sql`insert into order_prep (tenant_id, working_order_id, node_id, state)
        values (${cfg.tenantId}, ${orderId}, ${cfg.nodeId}, 'preparing')`),
    );
    const rows = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    expect(rows[0]).toMatchObject({ state: "open-tab", hasOpenTab: true, pendingDeliveries: 1 });
  });
});
```

- [ ] **Step 2: Run — see it fail.**

Run: `pnpm --filter @waitron/server test tabs.test`
Expected: FAIL — `listTablesWithState is not a function`.

- [ ] **Step 3: Implement `listTablesWithState`.** In `apps/server/src/working-order.ts` (`diningTables` already imported in Task 4):

```typescript
/** One row of the occupancy read-model (design §4). The raw signals (`hasOpenTab`, `pendingDeliveries`)
 *  are exposed alongside the rolled-up `state` so the floor plan can render a richer badge. */
export interface TableState {
  id: string;
  label: string;
  zone: string | null;
  capacity: number | null;
  state: "free" | "open-tab" | "delivery-pending";
  hasOpenTab: boolean;
  tabId?: string;
  tabLineCount?: number;
  /** The open tab's gross draft total (sum of `line_total`), numeric(12,2) as text — present iff a tab. */
  tabTotal?: string;
  pendingDeliveries: number;
}

/**
 * The venue's ACTIVE tables with their DERIVED occupancy (design §4). ONE location-scoped query: each
 * table LEFT JOINs its at-most-one OPEN tab — the order its own `tab_id` back-pointer names, filtered to
 * `status = 'open'` (a `tab_id` pointing at a settled/abandoned order finds nothing here and reads free,
 * design §2b) — with a line count + gross total, plus a count of pending deliveries (orders with
 * `delivery_table_id` = this table whose `order_prep` state is not yet `collected` and whose order is not
 * `abandoned`). A non-prepped instant handover (no prep row, or collected) leaves no lingering occupancy.
 *
 * Precedence for the rolled-up `state`: open-tab dominates delivery-pending dominates free. Runs as the
 * app role under the caller's tenant scope (RLS), so it gathers orders across NODES by construction (a
 * table lives at the venue, not the register). `locationId` defaults to the till's own.
 */
export async function listTablesWithState(
  tx: Transaction,
  cfg: TillConfig,
  locationId?: string,
): Promise<TableState[]> {
  const loc = locationId ?? cfg.locationId;
  const result = await tx.execute<{
    id: string;
    label: string;
    zone: string | null;
    capacity: number | null;
    tab_id: string | null;
    tab_line_count: number;
    tab_total: string | null;
    pending_deliveries: number;
  }>(sql`
    select
      dt.id, dt.label, dt.zone, dt.capacity,
      tab.id as tab_id,
      coalesce(tab.line_count, 0)::int as tab_line_count,
      tab.tab_total,
      coalesce(del.pending, 0)::int as pending_deliveries
    from dining_tables dt
    left join lateral (
      select wo.id,
             count(wol.id)::int as line_count,
             coalesce(sum(wol.line_total), 0)::numeric(12, 2)::text as tab_total
      from working_orders wo
      left join working_order_lines wol
        on wol.working_order_id = wo.id and wol.tenant_id = wo.tenant_id
      where wo.tenant_id = dt.tenant_id and wo.id = dt.tab_id and wo.status = 'open'
      group by wo.id
    ) tab on true
    left join lateral (
      select count(*)::int as pending
      from working_orders d
      join order_prep op on op.tenant_id = d.tenant_id and op.working_order_id = d.id
      where d.tenant_id = dt.tenant_id and d.delivery_table_id = dt.id
        and d.status <> 'abandoned' and op.state <> 'collected'
    ) del on true
    where dt.location_id = ${loc} and dt.active = true
    order by dt.label
  `);

  return result.rows.map((r) => {
    const hasOpenTab = r.tab_id !== null;
    const pendingDeliveries = Number(r.pending_deliveries);
    const state: TableState["state"] = hasOpenTab
      ? "open-tab"
      : pendingDeliveries > 0
        ? "delivery-pending"
        : "free";
    return {
      id: r.id,
      label: r.label,
      zone: r.zone,
      capacity: r.capacity,
      state,
      hasOpenTab,
      pendingDeliveries,
      ...(hasOpenTab
        ? { tabId: r.tab_id!, tabLineCount: Number(r.tab_line_count), tabTotal: r.tab_total! }
        : {}),
    };
  });
}
```

- [ ] **Step 4: Run — see it pass.**

Run: `pnpm --filter @waitron/server test tabs.test`
Expected: PASS (all occupancy cases). Prove the state derivation by deletion: temporarily force `state` to `"free"` unconditionally and rerun → the open-tab / delivery-pending cases FAIL. Restore.

- [ ] **Step 5: Package coverage + commit.**

Run: `pnpm --filter @waitron/server test:coverage`
Expected: PASS at 98/98/98/95.

```bash
git add apps/server/src/working-order.ts apps/server/src/tabs.test.ts
git commit -s -m "feat(server): listTablesWithState derived occupancy read-model (TS-1)"
```

---

## Task 10: HTTP routes with `isUuid` guards

**Files:**
- Modify: `apps/server/src/till-api.ts`
- Test: `apps/server/src/till-api.tables.test.ts`

**Interfaces:**
- Consumes: `createTable`/`listTables`/`updateTable`/`deactivateTable` (`tables.ts`); `openTab`/`addTabRound`/`voidTabLine`/`listTablesWithState` (`working-order.ts`); `isUuid` (`till-session.ts`).
- Produces: `POST/GET /api/tables`, `PATCH/DELETE /api/tables/:id`, `GET /api/tables/state`, `POST /api/tables/:id/tab`, `POST /api/working-orders/:id/round`, `DELETE /api/working-orders/:id/lines/:lineNo`; plus the six new `STATUS` map entries. (`deliveryTableId` on `POST /api/sales` flows through Task 8 with no route change — that handler already passes the whole `TillSaleRequest` body to `recordTillSale`.)

- [ ] **Step 1: Write the failing route tests.** Mirror `apps/server/src/till-api.test.ts`'s app/harness shape (it stands up `mountTillApi` over a PGlite db + a fake logged-in session, with a seeded venue + catalogue product `PRODUCT_ID` and a `request(path, init)` helper). Cover: create + list, a duplicate label → 409, a malformed `:id` → the route's fail-closed code, open a tab, add a round, void a line, and `GET /api/tables/state`.

`apps/server/src/till-api.tables.test.ts` (structure — reuse `till-api.test.ts`'s `buildApp`/session helpers verbatim; add the table/tab assertions):

```typescript
// ... reuse till-api.test.ts's harness: a PGlite `mountTillApi` app with a logged-in session cookie,
// a seeded venue (tenant/location/till/node) + catalogue product `PRODUCT_ID`, and a `request(path, init)`
// helper (JSON body, cookie attached). Then:

describe("table + tab routes", () => {
  it("POST /api/tables creates and GET /api/tables lists it", async () => {
    const create = await request("/api/tables", { method: "POST", body: JSON.stringify({ label: "12", zone: "terrace", capacity: 4 }) });
    expect(create.status).toBe(200);
    const { id } = await create.json();
    const list = await request("/api/tables");
    expect(await list.json()).toEqual([expect.objectContaining({ id, label: "12", active: true })]);
  });

  it("POST /api/tables with a duplicate label → 409 table.label_taken", async () => {
    await request("/api/tables", { method: "POST", body: JSON.stringify({ label: "7" }) });
    const dup = await request("/api/tables", { method: "POST", body: JSON.stringify({ label: "7" }) });
    expect(dup.status).toBe(409);
    expect((await dup.json()).code).toBe("table.label_taken");
  });

  it("PATCH /api/tables/:id with a malformed id → 404 table.not_found (isUuid guard, not a 500)", async () => {
    const res = await request("/api/tables/not-a-uuid", { method: "PATCH", body: JSON.stringify({ label: "X" }) });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("table.not_found");
  });

  it("POST /api/tables/:id/tab opens a tab; a second → 409 tab.already_open", async () => {
    const { id } = await (await request("/api/tables", { method: "POST", body: JSON.stringify({ label: "3" }) })).json();
    const open = await request(`/api/tables/${id}/tab`, { method: "POST", body: JSON.stringify({ lines: [{ productId: PRODUCT_ID, quantity: "1" }] }) });
    expect(open.status).toBe(200);
    const { tabId } = await open.json();
    expect(tabId).toBeDefined();
    const again = await request(`/api/tables/${id}/tab`, { method: "POST", body: JSON.stringify({}) });
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe("tab.already_open");
  });

  it("POST /api/working-orders/:id/round appends; DELETE .../lines/:lineNo voids; GET /api/tables/state reflects it", async () => {
    const { id } = await (await request("/api/tables", { method: "POST", body: JSON.stringify({ label: "5" }) })).json();
    const { tabId } = await (await request(`/api/tables/${id}/tab`, { method: "POST", body: JSON.stringify({ lines: [{ productId: PRODUCT_ID, quantity: "1" }] }) })).json();
    expect((await request(`/api/working-orders/${tabId}/round`, { method: "POST", body: JSON.stringify({ lines: [{ productId: PRODUCT_ID, quantity: "1" }] }) })).status).toBe(200);
    expect((await request(`/api/working-orders/${tabId}/lines/1`, { method: "DELETE" })).status).toBe(200);
    const state = await (await request("/api/tables/state")).json();
    expect(state.find((t: { id: string }) => t.id === id)).toMatchObject({ state: "open-tab", tabLineCount: 1 });
  });

  it("a malformed :id on the round route → 409 tab.not_open (not a 500)", async () => {
    const res = await request("/api/working-orders/not-a-uuid/round", { method: "POST", body: JSON.stringify({ lines: [] }) });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("tab.not_open");
  });
});
```

- [ ] **Step 2: Run — see it fail (routes 404 / unknown).**

Run: `pnpm --filter @waitron/server test till-api.tables`
Expected: FAIL — the new paths are not mounted.

- [ ] **Step 3: Extend the `STATUS` map.** In `apps/server/src/till-api.ts`'s `STATUS` object, add the six entries:

```typescript
  "table.not_found": 404,
  "table.label_taken": 409,
  "table.inactive": 409,
  "tab.already_open": 409,
  "tab.not_open": 409,
  "tab.line_not_found": 404,
```

- [ ] **Step 4: Import the verbs and mount the routes.** Add to the imports in `till-api.ts`:

```typescript
import { createTable, deactivateTable, listTables, updateTable } from "./tables.js";
```
and extend the existing `./working-order.js` import with `addTabRound, listTablesWithState, openTab, voidTabLine`.

Add the routes inside `mountTillApi` (all SESSION-GUARDED; each opens its own `withTenant`/`asAppUser` transaction; `:id` params screened with `isUuid` to the route's fail-closed code — a malformed id names nothing, exactly as an absent id):

```typescript
  // Create a dining table. SESSION-GUARDED. `createTable` throws table.label_taken (→ 409) on a
  // duplicate label. The client sends { label, zone?, capacity? }.
  app.post("/api/tables", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const body = await c.req.json<{ label: string; zone?: string; capacity?: number }>();
      const result = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return createTable(tx, deps.cfg, body);
      });
      return c.json(result);
    }),
  );

  // The venue's active tables. SESSION-GUARDED; RLS + the location filter scope it.
  app.get("/api/tables", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const tables = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return listTables(tx, deps.cfg);
      });
      return c.json(tables);
    }),
  );

  // The occupancy read-model (design §4). SESSION-GUARDED.
  app.get("/api/tables/state", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const state = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return listTablesWithState(tx, deps.cfg);
      });
      return c.json(state);
    }),
  );

  // Edit a table (label/zone/capacity). SESSION-GUARDED. A malformed :id is screened to
  // table.not_found (→ 404) rather than a 500; `updateTable` throws table.not_found / table.label_taken.
  app.patch("/api/tables/:id", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      const body = await c.req.json<{ label?: string; zone?: string; capacity?: number }>();
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await updateTable(tx, deps.cfg, id, body);
      });
      return c.body(null, 200);
    }),
  );

  // Deactivate a table (DELETE = deactivate; app_user holds no hard DELETE). SESSION-GUARDED.
  app.delete("/api/tables/:id", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await deactivateTable(tx, deps.cfg, id);
      });
      return c.body(null, 200);
    }),
  );

  // Open the table's running tab. SESSION-GUARDED. Malformed :id → table.not_found (a bad table id names
  // no table). `openTab` throws table.not_found / table.inactive / tab.already_open.
  app.post("/api/tables/:id/tab", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      const body = await c.req.json<{ lines?: { productId: string; quantity: string }[] }>();
      const result = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return openTab(tx, deps.cfg, { tableId: id, lines: body.lines });
      });
      return c.json(result);
    }),
  );

  // Append a round to an open tab. SESSION-GUARDED. Malformed :id → tab.not_open (a bad id names no open
  // tab). `addTabRound` throws tab.not_open / sale.empty_basket.
  app.post("/api/working-orders/:id/round", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("tab.not_open", { tabId: id });
      const body = await c.req.json<{ lines: { productId: string; quantity: string }[] }>();
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await addTabRound(tx, deps.cfg, id, body.lines);
      });
      return c.body(null, 200);
    }),
  );

  // Void one line from an open tab. SESSION-GUARDED. Malformed :id → tab.not_open; a non-integer
  // :lineNo → tab.line_not_found (it names no line). `voidTabLine` throws tab.not_open / tab.line_not_found.
  app.delete("/api/working-orders/:id/lines/:lineNo", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("tab.not_open", { tabId: id });
      const lineNo = Number(c.req.param("lineNo"));
      if (!Number.isInteger(lineNo)) throw new AppError("tab.line_not_found", { tabId: id, lineNo });
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await voidTabLine(tx, deps.cfg, id, lineNo);
      });
      return c.body(null, 200);
    }),
  );
```

> `deliveryTableId` on `POST /api/sales` (Task 8) needs NO route change: that handler already does `c.req.json<TillSaleRequest>()` and passes the whole `body` to `recordTillSale`, so once `TillSaleRequest` carries `deliveryTableId` the field flows through. Add one assertion to `till-api.tables.test.ts` posting `/api/sales` with `deliveryTableId` and reading the stamped column back, if the harness has a fiscal backend wired; otherwise leave that path to Task 8's real-PG test.

- [ ] **Step 5: Run — see it pass.**

Run: `pnpm --filter @waitron/server test till-api.tables`
Expected: PASS. Prove an `isUuid` guard by deletion: remove the `if (!isUuid(id))` line from the PATCH route, rerun → the malformed-id test FAILS with a 500 (raw `22P02`) instead of 404. Restore.

- [ ] **Step 6: Full package gate + commit.**

Run: `pnpm --filter @waitron/server test:coverage` and the real-PG suites (`TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test tabs.rls`), plus `pnpm lint && pnpm typecheck && pnpm format:check` at the workspace root.

```bash
git add apps/server/src/till-api.ts apps/server/src/till-api.tables.test.ts
git commit -s -m "feat(server): HTTP routes for tables + tabs with isUuid guards (TS-1)"
```

---

## Final gate (before opening the PR)

- [ ] Run the four-command gate: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`.
- [ ] Run coverage on both changed packages: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage` and `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage` (CI shards run `test:coverage`, not `test`).
- [ ] Re-run the tenant-scoped RLS guard once more after all migrations exist: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` — `dining_tables` must report `relforcerowsecurity = true`.
- [ ] `pnpm install` (no dependency moved, but confirm the lockfile is clean).

---

## Plan notes (gaps / decisions flagged, not invented scope)

1. **`locations` needs a `(tenant_id, id)` unique for `dining_tables_location_fk` (Task 1).** Confirmed by reading `packages/db/src/schema/tenants.ts`: `locations` carries only its single-column PK (`id`) plus a plain `locations_tenant_id_idx` — it has NO composite `(tenant_id, id)` unique. The spec's DDL (§2a) says `dining_tables.location_id` is a composite FK `(tenant_id, location_id) → locations`, and Postgres requires a unique on the referenced columns, so Task 1 adds `unique("locations_tenant_id_key").on(t.tenantId, t.id)` to `locations` — a one-line additive change consistent with `tills_tenant_id_key`/`nodes_tenant_id_key`, which exist for exactly this reason. Flagged because it is a schema addition the spec's DDL implies but does not name.

2. **Both mutual composite FKs are HAND-WRITTEN in the custom migration, not emitted by `db:generate` (Task 2).** Spec §2c says `db:generate` "emits them as two `ALTER TABLE … ADD CONSTRAINT` statements." That is unsafe here: `dining_tables.tab_id → working_orders` and `working_orders.delivery_table_id → dining_tables` are a mutual FK between two schema MODULES, and a Drizzle `foreignKey({ foreignColumns: [otherTable.col, …] })` reads the other table's column objects EAGERLY when `pgTable()` runs. Declaring both in the schemas makes `dining-tables.ts` and `orders.ts` import each other, and one side's columns are still `undefined` mid-cycle — the existing `locations ↔ catalogue` cycle survives only because it uses lazy `.references(() => …)` THUNKS (single-column), which composite FKs have no equivalent of. So both columns stay bare in the schema and both FKs are hand-written in the custom migration (drizzle-kit does not manage them, exactly as it does not manage FORCE/policies/grants; the bare columns produce no snapshot drift). This is the one deviation from the spec, and Task 2's real-PG test proves both FKs bite (prove-by-deletion). Note: this is a NEW pattern for the repo (existing FKs are all schema-declared) — the implementer should verify `db:generate` emits ONLY the `delivery_table_id` column ADD (no stray FK) and that the migration applies. If a future maintainer wants both FKs schema-declared, the only cycle-safe option is a one-way import (`dining-tables.ts → orders.ts` for `tab_fk`, `delivery_table_fk` still hand-written).

3. **`createOpenOrder` changes twice, both additive and behaviour-preserving.** Task 4 adds the `if (lineRows.length > 0)` line-insert guard (so `openTab` can open an EMPTY tab — `tx.insert(...).values([])` errors); Task 8 adds the optional trailing `placement: { deliveryTableId? }` param (so a counter delivery can stamp `delivery_table_id`). Existing callers (`parkOrder`, `payWorkingOrder` walk-up, `payWorkingOrderIntegrated` walk-up) always pass ≥1 line and omit `placement` → a plain walk-up, unchanged. A TAB does NOT flow its link through `createOpenOrder` at all — the link is the `dining_tables.tab_id` back-pointer `openTab` sets separately. Flagged as the one signature change the spec implies but does not spell out.

4. **The H2 huella-identity test needs two nodes under one tenant, each with a series coded "A" (Task 7).** For two filings to yield the IDENTICAL huella they must share issuer (NIF), series string ("A/1"), timestamp, amounts, and both be `primer_registro` — and a single chain would make the second `A/2` with the first's huella as its prev (different by design). Two separate tenants can't share a NIF (`tenants_country_tax_id_key`), so the test seeds a second node + a standard series "A" under the same tenant (`invoice_series_node_code_key` is `(tenant, node, code)`, so two "A"s on different nodes are legal) and files with a FIXED clock. In the revised model the filed `working_orders` row carries no tab field at all (the tab link is on the table), so the identity is even more direct than the old model's. The grep receipt (Step 1) is the primary, unambiguous proof; the huella test is the behavioural confirmation. Verify the seeded `invoice_series` columns (`purpose`, `next_number`) against `packages/db/src/schema/series.ts` before relying on the insert.

5. **`delivery-pending` "(and not abandoned)" (§4) is read as the ORDER's status, not a prep state.** `order_prep`'s enum is `queued→preparing→ready→collected` — there is no `abandoned` prep state. `listTablesWithState` therefore excludes a delivery whose ORDER is `abandoned` (`working_orders.status <> 'abandoned'`) in addition to `op.state <> 'collected'`. Flagged as an interpretation of the spec's parenthetical; matches "food still being made / carried."

6. **Paying a tab uses the existing `/api/sales` (no new route/verb).** The spec (§3b) is explicit that pay reuses `payWorkingOrder` with the tab's id; the retrieved-order branch files the stored lines and settles `open → settled`, after which the table's `tab_id` (unchanged, now stale) reads free by the occupancy join. Task 7 proves this at the verb level (real-PG). Note the existing `recordTillSale` guards `lines.length === 0`, so a till paying a tab via `/api/sales` sends the tab's current basket (non-empty) — `payWorkingOrder` ignores it and files the stored lines. No change is needed; flagged so an implementer does not add a redundant "pay tab" route.

7. **`voidTabLine`'s `cfg` param is unused** (the delete is by tab id + line no, RLS-scoped). It is kept for the uniform tab-verb signature the route layer calls, and lint's `no-unused-vars` `after-used` default does not flag an unused arg that precedes a used one (`tabId`/`lineNo`). Flagged so a reviewer does not "clean it up" and desync the call shape.
