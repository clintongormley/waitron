# Table Service TS-3 (Move, Join & Merge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the three table-service party verbs — `moveTab` (relocate a tab to a free table), `joinTable` (extend a tab's coverage to a free table), and `mergeTabs` (combine two tabs onto one bill; source table freed or kept-joined) — plus the shared `moveTabLines` line-move primitive and their HTTP routes, entirely on TS-1's `dining_tables.tab_id` back-pointer and the existing `working_order_lines`, with **no new schema**.

**Architecture:** All four verbs live in `apps/server/src/working-order.ts` beside TS-1's tab verbs, each taking the caller's `tx` and running under the caller's `withTenant`/`asAppUser` scope (the HTTP layer opens the transaction). `moveTab`/`joinTable`/`mergeTabs` only re-point `dining_tables.tab_id`, move lines between two `open` working orders, and abandon an emptied tab — never touching the immutable fiscal core. Every verb takes the involved `dining_tables` rows (and, for merge, both `working_orders` rows) `FOR UPDATE` in **ascending id order** — one fixed lock order so two concurrent table-service ops cannot deadlock (the P3 lock-order discipline `docs/backlog.md` records for the integrated-card path). A freed table's TS-2 manual `status_id` clears in the same statement that nulls its `tab_id`. Pay is UNCHANGED: a merged tab is still an `open` working order, so `payWorkingOrder` → `recordSale` files exactly one sale, and the abandoned source tab files nothing.

**Tech Stack:** TypeScript (ESM, Node), Drizzle ORM (PostgreSQL 18), Hono HTTP, Vitest, PGlite (hermetic verb logic) + Testcontainers (real Postgres for concurrency/RLS/fiscal), pnpm workspace.

**Spec:** docs/superpowers/specs/2026-08-17-table-service-ts3-move-and-merge-design.md

**Depends on:** TS-1 landed (`dining_tables` incl. the `tab_id` back-pointer, `openTab`, `createTable`, `listTablesWithState`, and the `table.not_found`/`table.inactive`/`tab.not_open` error codes). **TS-3 executes AFTER TS-1 has landed** — TS-1's revised design §2b puts a `tab_id` **back-pointer** on `dining_tables` (a tab is "the table's `tab_id` points at the open order"), and every TS-3 verb re-points that column. Items TS-3 consumes from TS-1 are marked **Consumes (from TS-1)**; the source status-clear additionally consumes TS-2's `dining_tables.status_id` column and reset trigger, marked **Consumes (from TS-2)** — see **Plan note 1** for why TS-3's status behaviour requires TS-2 landed too.

## Global Constraints

- **Coverage thresholds 98/98/98/95** (statements/lines/functions/branches) for `apps/server`. CI shards run `test:coverage`, not `test` — verify green with `pnpm --filter @waitron/server test:coverage`.
- **NO new migration / no new schema.** TS-3 is pure `apps/server` verb code on the TS-1 `dining_tables.tab_id` back-pointer and the existing `working_order_lines`. Do not run `db:generate`; do not add a column, table, index, FK, CHECK, policy, or trigger.
- **English identifiers only.** `moveTab`, `joinTable`, `mergeTabs`, `moveTabLines`, `freeSourceTable`, `toTableId`, `fromTabId`, `intoTabId`. Add NO new `SPANISH_WORDS` tokens (`packages/db/src/english-only.ts`).
- **Domain-named error codes, never renamed once shipped.** `table.occupied` (a move/join target already has an open tab) and `tab.merge_self` (merge a tab into itself) — new, declared in `apps/server/src/errors.ts`. Reuse `tab.not_open`, `table.not_found`, `table.inactive` (TS-1). Every throwing file carries `import "./errors.js"`.
- **Real Postgres for concurrency/RLS; PGlite is a false pass there.** PGlite runs every connection as a superuser (bypasses FORCE RLS) and serialises every query onto one backend (no race). Put the concurrent `moveTab` race, the concurrent merge/move deadlock-safety test, the cross-tenant RLS check, and the merged/joined-then-paid fiscal tests on Testcontainers; note `TESTCONTAINERS_RYUK_DISABLED=true` locally (CLAUDE.md §4).
- **H2 — the fiscal core is untouched.** `moveTab`/`joinTable` only re-point `tab_id` (a non-fiscal column). `mergeTabs` moves lines between two `open` (mutable, unfiled) working orders and abandons the emptied one; nothing is filed until the merged tab is paid, and it files **one** normal sale via the UNCHANGED `payWorkingOrder → recordSale` path — the abandoned `fromTab` never reaches `settled`, so no double-file (CLAUDE.md §5's unrepairable double-file cannot arise). Proven by (a) a grep receipt that TS-3 changes no `packages/core/src/record-sale.ts` / alta-builder / `registros_facturacion` code, and (b) a real-PG test that a merged-then-paid tab yields exactly **one** `registros_facturacion` row.
- **Ascending-id `FOR UPDATE` lock order.** Every verb locks the involved `dining_tables` rows (ascending id), then — for merge — both `working_orders` rows (ascending id). One fixed order across all verbs, so concurrent ops on the same tables serialise instead of deadlocking.
- **Prove every guard/lock by deletion.** Remove the lock / the guard / the ordering, confirm the test fails, restore it. A test that still passes with the guard removed is not testing the guard.
- **Every commit `git commit -s`.**
- **No backwards-compat / data-migration code.** Pre-production; nothing is deployed.

---

## Plan notes

1. **The source status-clear consumes TS-2, so TS-3 lands after TS-2 as well.** `moveTab` and `mergeTabs{freeSourceTable:true}` null the freed source table's `dining_tables.status_id` in the same statement that nulls its `tab_id` (spec §4). `status_id` and the `working_orders_clear_table_status` reset trigger are introduced by **TS-2** (`docs/superpowers/plans/2026-08-17-table-service-ts2-configurable-statuses.md`, its Task 2 / Task 5). The table-service slices are sequenced TS-1 → TS-2 → TS-3 (TS-1 design §0), so this is the realistic order; the header says "Depends on: TS-1 landed" because TS-1 is the load-bearing dependency (the back-pointer is what makes move/merge possible at all), but the status-clear code references `diningTables.statusId` and will not typecheck unless TS-2 has landed. The status-clear steps are marked **Consumes (from TS-2)**; they consume only TS-2's *schema* (the `table_service_statuses` table + `status_id` column), never its verbs — tests seed a status row and read `status_id` back with raw SQL, so TS-3 is not coupled to `createStatus`/`setTableStatus` signatures.

2. **`mergeTabs` re-points the source table(s) BEFORE abandoning `fromTab` — the corrected order.** Spec §3 lists "abandon `fromTab`" (step 2) before "source table fate" (step 3), and §4 says "the TS-2 settle-trigger only fires on pay". Both are imprecise: the TS-2 trigger fires on `open → settled` **or** `open → abandoned`, and it clears `status_id` on every table where `tab_id = NEW.id`. If the abandon ran first, that trigger would clear the status on a table that stays **joined** (`freeSourceTable:false`), contradicting §4's "a table that stays joined keeps its status". So `mergeTabs` re-points every table away from `fromTabId` first; the subsequent abandon's trigger then matches nothing (a no-op), the consolidate case's explicit `status_id → NULL` is the sole writer, and the join case's status is preserved. This ordering is proven load-bearing by deletion in Task 5 (swap the two steps → the join status-preserved test fails).

3. **`tab.not_open`'s param key is owned by TS-1.** TS-3 reuses `tab.not_open` and throws it as `{ tabId }` (the `tab.*` domain vocabulary). Before implementing, grep the landed TS-1 `apps/server/src/errors.ts` to confirm the exact param field — if TS-1 declared it `{ workingOrderId }`, align every TS-3 throw and the route guard to that key (CLAUDE.md §1/§3: grep the sibling before asserting a convention; codes are never renamed, so match TS-1 exactly).

4. **Real-PG scaffolding is ported verbatim, not re-derived.** The `move-merge.rls.test.ts` suite reuses the exact scaffolding of `apps/server/src/working-order.rls.test.ts` (`useRealPostgres` + `startRealPostgres`, `systemClock`, `nextNif`, `tillConfigFromVenue`, `setupVenue` returning `{ cfg, cafe, agua }`, the `VerifactuBackend` built in `beforeAll`, and the owner-read helpers `saleCount`/`registroCount`/`orderState`). Each real-PG step below shows only the NEW helpers and tests; copy the shared block verbatim from that file (the TS-1 plan established this precedent for its own `tabs.rls.test.ts`).

---

## File Structure

**Created:**
- `apps/server/src/move-merge.test.ts` — PGlite: the verb LOGIC. `moveTabLines` (all + subset + empty-source guard + `tab.not_open`); `moveTab` (relocate, source freed + status cleared, `table.occupied`, stale-pointer target is free); `joinTable` (both tables point at one tab, `table.occupied`); `mergeTabs` consolidate + join branches; `tab.merge_self`/`tab.not_open` guards. One shared PGlite `setupVenue` seeds two `each`/general products and mints tables/tabs on demand.
- `apps/server/src/move-merge.rls.test.ts` — real Postgres: the concurrent `moveTab` race (prove-by-deletion of the target `FOR UPDATE` lock), the concurrent merge/move deadlock-safety serialisation, the merged-then-paid = ONE registro fiscal receipt, and the joined/merged-then-paid = ONE sale checks. Scaffolding ported from `working-order.rls.test.ts` (Plan note 4).
- `apps/server/src/till-api.move-merge.test.ts` — the three routes: session-guard (401), `isUuid` screen (4xx not 500), the `STATUS` mapping (`table.occupied` 409, `tab.merge_self` 400), and a happy-path move that re-points the table.

**Modified:**
- `apps/server/src/working-order.ts` — add `moveTabLines`, `moveTab`, `joinTable`, `mergeTabs`; add `or` to the `drizzle-orm` import (all other symbols — `and`, `eq`, `inArray`, `sql`, `AppError`, `diningTables`, `workingOrders`, `workingOrderLines`, `randomUUID`, `TillConfig`, `Transaction` — are already imported after TS-1).
- `apps/server/src/errors.ts` — declare `table.occupied` and `tab.merge_self` (Task 2 and Task 6).
- `apps/server/src/till-api.ts` — import the three verbs; add the `requireTabParam` UUID guard; mount `POST /api/tabs/:id/{move,join,merge}`; extend the `STATUS` map with the two new codes.

---

## Task 1: `moveTabLines` — the shared all-lines/subset line-move primitive

**Files:**
- Modify: `apps/server/src/working-order.ts`
- Test: `apps/server/src/move-merge.test.ts` (create, with the shared PGlite scaffolding)

**Interfaces:**
- Consumes (from TS-1): `diningTables` (with `tabId`), `createTable`, `openTab`; the `workingOrders`/`workingOrderLines` schema; `usePgliteDb`, `seedNode`, `seedTenant`, `withTenant`, `asAppUser` (`@waitron/db`); `createCatalogue`/`createCategory`/`createProduct`/`assignCatalogueToLocation`/`updateProduct` (`@waitron/catalogue`).
- Produces: `moveTabLines(tx: Transaction, fromTabId: string, toTabId: string, lineNos?: number[]): Promise<void>` — moves the named lines (default **all**) from one open tab to another: reads them (locked price columns kept verbatim), appends them onto `toTab` at the next `line_no`s under the `toTab` `FOR UPDATE` lock, deletes them from `fromTab`. Both tabs must be `open` (`tab.not_open`). TS-4 (transfer) will call it with a subset.

- [ ] **Step 1: Write the shared PGlite scaffolding + the `moveTabLines` failing tests.** Create `apps/server/src/move-merge.test.ts`. The `setupVenue`/`asApp`/`seedTable`/`openTabOn` helpers here are reused by Tasks 2–6.

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
import { moveTabLines, openTab } from "./working-order.js";
import "./errors.js";
```

> **Import discipline:** Task 1 imports only what it uses (`no-unused-vars` flags unused named imports). Each later task WIDENS these two lines as it needs them — Task 2 adds `moveTab`; Task 3 adds `joinTable`; Task 4 adds `mergeTabs` to the `./working-order.js` line and `updateProduct` to the `@waitron/catalogue` line. The steps below name the widening where it is needed.

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
}

/** A fresh tenant/location/till/node + a two-product catalogue (Café 1.50, Agua 2.00, both general). */
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
  const { cafeId, aguaId } = await withTenant(db, tenantId, async (tx) => {
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
    return { cafeId: cafe.id, aguaId: agua.id };
  });
  return { cfg, cafeId, aguaId };
}

function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** Create one active dining table as the app role; returns its id. */
async function seedTable(cfg: TillConfig, label: string): Promise<string> {
  return asApp(cfg, (tx) => createTable(tx, cfg, { label }).then((r) => r.id));
}

/** Open a tab on a table with the given lines; returns the tab (working_order) id. */
async function openTabOn(
  cfg: TillConfig,
  tableId: string,
  lines: { productId: string; quantity: string }[],
): Promise<string> {
  return asApp(cfg, (tx) => openTab(tx, cfg, { tableId, lines }).then((r) => r.tabId));
}

/** The dining table's current tab_id — owner read (bypasses RLS). */
async function tabIdOf(tableId: string): Promise<string | null> {
  const { rows } = await db.execute<{ tab_id: string | null }>(
    sql`select tab_id from dining_tables where id = ${tableId}`,
  );
  return rows[0]!.tab_id;
}

/** The dining table's current status_id — owner read (bypasses RLS). Consumes TS-2's status_id column. */
async function statusIdOf(tableId: string): Promise<string | null> {
  const { rows } = await db.execute<{ status_id: string | null }>(
    sql`select status_id from dining_tables where id = ${tableId}`,
  );
  return rows[0]!.status_id;
}

/** Seed one active table_service_statuses row (TS-2 schema) as the owner; returns its id. */
async function seedStatus(cfg: TillConfig, label: string): Promise<string> {
  const { rows } = await db.execute<{ id: string }>(sql`
    insert into table_service_statuses (tenant_id, label, color)
    values (${cfg.tenantId}, ${label}, '#ff0000') returning id`);
  return rows[0]!.id;
}

/** A tab's lines as { lineNo, productId, unitPriceGross }, in line_no order — owner read. */
async function linesOf(tabId: string): Promise<{ lineNo: number; productId: string; gross: string }[]> {
  const rows = await db
    .select({
      lineNo: workingOrderLines.lineNo,
      productId: workingOrderLines.productId,
      gross: workingOrderLines.unitPriceGross,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId))
    .orderBy(workingOrderLines.lineNo);
  return rows;
}

describe("moveTabLines", () => {
  it("moves ALL lines from one open tab to another, appended at the next line_no, source emptied", async () => {
    const { cfg, cafeId, aguaId } = await setupVenue();
    const t1 = await seedTable(cfg, "M1");
    const t2 = await seedTable(cfg, "M2");
    const from = await openTabOn(cfg, t1, [{ productId: cafeId, quantity: "1" }]);
    const to = await openTabOn(cfg, t2, [{ productId: aguaId, quantity: "1" }]);

    await asApp(cfg, (tx) => moveTabLines(tx, from, to));

    // Destination now carries both lines; the café keeps its own locked gross; source is empty.
    const dest = await linesOf(to);
    expect(dest).toHaveLength(2);
    expect(dest.map((l) => l.lineNo)).toEqual([1, 2]);
    expect(dest.find((l) => l.productId === cafeId)?.gross).toBe("1.50");
    expect(await linesOf(from)).toHaveLength(0);
  });

  it("moves only the NAMED subset (the TS-4 shape), leaving the rest on the source", async () => {
    const { cfg, cafeId, aguaId } = await setupVenue();
    const t1 = await seedTable(cfg, "S1");
    const t2 = await seedTable(cfg, "S2");
    const from = await openTabOn(cfg, t1, [
      { productId: cafeId, quantity: "1" },
      { productId: aguaId, quantity: "1" },
    ]);
    const to = await openTabOn(cfg, t2, []);

    await asApp(cfg, (tx) => moveTabLines(tx, from, to, [2])); // move only line 2 (agua)

    expect(await linesOf(to)).toHaveLength(1);
    expect((await linesOf(to))[0]!.productId).toBe(aguaId);
    const remaining = await linesOf(from);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.productId).toBe(cafeId);
  });

  it("moving from an EMPTY tab is a no-op (the empty-source guard), no error", async () => {
    const { cfg, aguaId } = await setupVenue();
    const t1 = await seedTable(cfg, "E1");
    const t2 = await seedTable(cfg, "E2");
    const from = await openTabOn(cfg, t1, []); // empty tab
    const to = await openTabOn(cfg, t2, [{ productId: aguaId, quantity: "1" }]);

    await asApp(cfg, (tx) => moveTabLines(tx, from, to));
    expect(await linesOf(to)).toHaveLength(1); // unchanged
  });

  it("refuses a non-open source or destination (tab.not_open)", async () => {
    const { cfg, cafeId } = await setupVenue();
    const t1 = await seedTable(cfg, "N1");
    const t2 = await seedTable(cfg, "N2");
    const from = await openTabOn(cfg, t1, [{ productId: cafeId, quantity: "1" }]);
    const to = await openTabOn(cfg, t2, []);
    // Abandon the destination (owner write, RLS bypassed — pure setup).
    await db.execute(sql`update working_orders set status = 'abandoned' where id = ${to}`);
    await expect(asApp(cfg, (tx) => moveTabLines(tx, from, to))).rejects.toMatchObject({
      code: "tab.not_open", params: { tabId: to },
    });
  });
});
```

- [ ] **Step 2: Run — see it fail.**

Run: `pnpm --filter @waitron/server test move-merge.test`
Expected: FAIL — `moveTabLines is not a function` (also `moveTab`/`joinTable`/`mergeTabs` are imported but unused so far; they land in later tasks).

- [ ] **Step 3: Implement `moveTabLines`.** In `apps/server/src/working-order.ts`, add `or` to the `drizzle-orm` import (`import { and, eq, inArray, ne, or, sql } from "drizzle-orm";`) and add the function beside the TS-1 tab verbs:

```typescript
/**
 * Move working-order lines from one OPEN tab to another (design §3) — the shared primitive `mergeTabs`
 * calls with ALL lines and TS-4 (transfer) will call with a subset, so it is written general now to
 * avoid a TS-4 refactor. Reads the named lines (default all), APPENDS them onto `toTab` at the next
 * `line_no`s with every locked price column carried across UNCHANGED (a move NEVER re-prices — the
 * add-time `unit_price_gross` is what the filed sale is later rebuilt from, orders.ts:153), then deletes
 * them from `fromTab`.
 *
 * Both tabs are locked `FOR UPDATE` in ASCENDING id order — deadlock-safe with every other table-service
 * verb — and their status read off the locked copies: a non-`open` parent is refused `tab.not_open`
 * (moving lines under a settled/abandoned order would violate `working_order_lines_require_open_parent`
 * anyway). The lock on `toTab` also serialises `line_no` allocation the way `addTabRound`'s per-tab lock
 * does, so a concurrent append/move cannot collide on the `(working_order_id, line_no)` unique
 * (orders.ts:186). Runs on the CALLER's transaction under its tenant/app_user scope.
 */
export async function moveTabLines(
  tx: Transaction,
  fromTabId: string,
  toTabId: string,
  lineNos?: number[],
): Promise<void> {
  const locked = await tx
    .select({ id: workingOrders.id, status: workingOrders.status })
    .from(workingOrders)
    .where(or(eq(workingOrders.id, fromTabId), eq(workingOrders.id, toTabId)))
    .orderBy(workingOrders.id)
    .for("update");
  const from = locked.find((r) => r.id === fromTabId);
  const to = locked.find((r) => r.id === toTabId);
  if (from === undefined || from.status !== "open") {
    throw new AppError("tab.not_open", { tabId: fromTabId });
  }
  if (to === undefined || to.status !== "open") {
    throw new AppError("tab.not_open", { tabId: toTabId });
  }

  const sourceWhere =
    lineNos === undefined
      ? eq(workingOrderLines.workingOrderId, fromTabId)
      : and(
          eq(workingOrderLines.workingOrderId, fromTabId),
          inArray(workingOrderLines.lineNo, lineNos),
        );

  // Read the lines to move (locked price columns kept verbatim), in line_no order.
  const source = await tx
    .select({
      tenantId: workingOrderLines.tenantId,
      productId: workingOrderLines.productId,
      descriptions: workingOrderLines.descriptions,
      quantity: workingOrderLines.quantity,
      unitPrice: workingOrderLines.unitPrice,
      unitPriceGross: workingOrderLines.unitPriceGross,
      vatRate: workingOrderLines.vatRate,
      lineTotal: workingOrderLines.lineTotal,
      category: workingOrderLines.category,
    })
    .from(workingOrderLines)
    .where(sourceWhere)
    .orderBy(workingOrderLines.lineNo);

  // The next free line_no on the destination, allocated under the toTab lock above (no race).
  const [agg] = await tx
    .select({ next: sql<number>`coalesce(max(${workingOrderLines.lineNo}), 0)::int` })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, toTabId));
  const base = agg!.next;

  // Append onto the destination, then delete from the source. Guarded: an EMPTY source (or empty subset)
  // has nothing to insert and `tx.insert(...).values([])` errors — the same guard createOpenOrder uses.
  if (source.length > 0) {
    await tx.insert(workingOrderLines).values(
      source.map((line, i) => ({
        tenantId: line.tenantId,
        workingOrderId: toTabId,
        lineNo: base + i + 1,
        productId: line.productId,
        descriptions: line.descriptions,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        unitPriceGross: line.unitPriceGross,
        vatRate: line.vatRate,
        lineTotal: line.lineTotal,
        category: line.category,
      })),
    );
  }
  await tx.delete(workingOrderLines).where(sourceWhere);
}
```

- [ ] **Step 4: Run — see it pass.**

Run: `pnpm --filter @waitron/server test move-merge.test`
Expected: PASS (4 `moveTabLines` tests). The import line names only `moveTabLines`/`openTab` (used here), so `pnpm --filter @waitron/server lint` is also clean at this task boundary; later tasks widen it as they add verbs.

- [ ] **Step 5: Prove the `tab.not_open` guard by deletion.** Temporarily change the destination check to `if (false)` (skip it), rerun the `tab.not_open` test → it FAILS (the move proceeds against an abandoned parent, surfacing a raw `require_open_parent` trigger error, not the domain code). Restore.

- [ ] **Step 6: Commit.**

```bash
git add apps/server/src/working-order.ts apps/server/src/move-merge.test.ts
git commit -s -m "feat(server): moveTabLines all/subset line-move primitive (TS-3)"
```

---

## Task 2: `moveTab` — relocate a tab (+ `table.occupied`, source status-clear, concurrent race)

**Files:**
- Modify: `apps/server/src/working-order.ts`, `apps/server/src/errors.ts`
- Test: `apps/server/src/move-merge.test.ts` (PGlite), `apps/server/src/move-merge.rls.test.ts` (create, real-PG)

**Interfaces:**
- Consumes (from TS-1): `diningTables` (incl. `tabId`), `workingOrders`; the `table.not_found`/`table.inactive` codes.
- Consumes (from TS-2): `diningTables.statusId` (schema only — Plan note 1).
- Produces:
  - `moveTab(tx: Transaction, cfg: TillConfig, tabId: string, toTableId: string): Promise<void>` — throws `tab.not_open`, `table.not_found`, `table.inactive`, `table.occupied`.
  - error code `table.occupied` (`{ tableId }`).

- [ ] **Step 1: Declare `table.occupied`.** In `apps/server/src/errors.ts`, inside the `interface ErrorParams` block (beside the TS-1 `table.*` codes), add:

```typescript
    /**
     * A move/join TARGET dining table already has an OPEN tab, so a party may not be relocated or
     * extended onto it — use `mergeTabs` to combine the two bills instead (design §3). A table is "free"
     * when its `tab_id` is null or points at a settled/abandoned order (a stale pointer, TS-1 §2b);
     * `table.occupied` fires only when it points at a STILL-OPEN order. `moveTab`/`joinTable` take the
     * target `dining_tables` row `FOR UPDATE`, so two concurrent moves onto one free table serialise and
     * the loser surfaces THIS code (the lock is the guard — there is no partial-unique). `tableId` — the
     * occupied target — is caller-supplied, not a secret. `table.*` names the DOMAIN CONCEPT (the dining
     * table), never the throwing package (the rule `tenant.not_found`'s note gives). Mapped to 409 (the
     * table's state forbids the move), the sibling of TS-1's `tab.already_open`.
     */
    "table.occupied": { tableId: string };
```

- [ ] **Step 2: Write the failing `moveTab` PGlite tests.** First widen the import: add `moveTab` to the `./working-order.js` import line (now `import { moveTab, moveTabLines, openTab } from "./working-order.js";`). Then append to `apps/server/src/move-merge.test.ts`:

```typescript
describe("moveTab", () => {
  it("relocates a tab to a free table: source freed + its status cleared, target points at the tab", async () => {
    const { cfg, cafeId } = await setupVenue();
    const src = await seedTable(cfg, "Src");
    const dst = await seedTable(cfg, "Dst");
    const tabId = await openTabOn(cfg, src, [{ productId: cafeId, quantity: "1" }]);
    // A manual "bill requested" status on the source (TS-2 schema) must NOT linger onto the next party.
    const status = await seedStatus(cfg, "Bill requested");
    await db.execute(sql`update dining_tables set status_id = ${status} where id = ${src}`);

    await asApp(cfg, (tx) => moveTab(tx, cfg, tabId, dst));

    expect(await tabIdOf(src)).toBeNull();
    expect(await statusIdOf(src)).toBeNull(); // freed → status cleared (design §4)
    expect(await tabIdOf(dst)).toBe(tabId);
    // No line-move, no fiscal effect: the tab still carries its one line and stays open.
    expect(await linesOf(tabId)).toHaveLength(1);
  });

  it("refuses a target that already has an OPEN tab (table.occupied)", async () => {
    const { cfg, cafeId } = await setupVenue();
    const src = await seedTable(cfg, "O-src");
    const dst = await seedTable(cfg, "O-dst");
    const tabId = await openTabOn(cfg, src, [{ productId: cafeId, quantity: "1" }]);
    await openTabOn(cfg, dst, [{ productId: cafeId, quantity: "1" }]); // dst now occupied
    await expect(asApp(cfg, (tx) => moveTab(tx, cfg, tabId, dst))).rejects.toMatchObject({
      code: "table.occupied", params: { tableId: dst },
    });
  });

  it("treats a target with a STALE tab_id (settled order) as free and moves onto it", async () => {
    const { cfg, cafeId } = await setupVenue();
    const src = await seedTable(cfg, "St-src");
    const dst = await seedTable(cfg, "St-dst");
    const oldTab = await openTabOn(cfg, dst, [{ productId: cafeId, quantity: "1" }]);
    // Settle dst's tab (owner write) — tab_id STILL points at it, but it is now stale/free (TS-1 §2b).
    await db.execute(sql`update working_orders set status = 'settled', settled_at = now() where id = ${oldTab}`);
    const tabId = await openTabOn(cfg, src, [{ productId: cafeId, quantity: "1" }]);

    await asApp(cfg, (tx) => moveTab(tx, cfg, tabId, dst));
    expect(await tabIdOf(dst)).toBe(tabId); // stale pointer overwritten
    expect(await tabIdOf(src)).toBeNull();
  });

  it("refuses an unknown/inactive target and a non-open tab", async () => {
    const { cfg, cafeId } = await setupVenue();
    const src = await seedTable(cfg, "G-src");
    const dst = await seedTable(cfg, "G-dst");
    const tabId = await openTabOn(cfg, src, [{ productId: cafeId, quantity: "1" }]);
    const missing = randomUUID();
    await expect(asApp(cfg, (tx) => moveTab(tx, cfg, tabId, missing))).rejects.toMatchObject({
      code: "table.not_found", params: { tableId: missing },
    });
    await db.execute(sql`update dining_tables set active = false where id = ${dst}`);
    await expect(asApp(cfg, (tx) => moveTab(tx, cfg, tabId, dst))).rejects.toMatchObject({
      code: "table.inactive", params: { tableId: dst },
    });
    // A settled tab cannot be moved.
    await db.execute(sql`update working_orders set status = 'settled', settled_at = now() where id = ${tabId}`);
    const dst2 = await seedTable(cfg, "G-dst2");
    await expect(asApp(cfg, (tx) => moveTab(tx, cfg, tabId, dst2))).rejects.toMatchObject({
      code: "tab.not_open", params: { tabId },
    });
  });
});
```

- [ ] **Step 3: Run — see it fail.**

Run: `pnpm --filter @waitron/server test move-merge.test`
Expected: FAIL — `moveTab is not a function`.

- [ ] **Step 4: Implement `moveTab`.** In `apps/server/src/working-order.ts`, add beside `moveTabLines`:

```typescript
/**
 * Relocate a party to a free table (design §3). Validates `tabId` is an `open` working order
 * (`tab.not_open`) and `toTableId` is `active` (`table.not_found`/`table.inactive`) and FREE — its
 * `tab_id` is null or points at a settled/abandoned order (a stale pointer, TS-1 §2b), else
 * `table.occupied` ("use merge"). Then frees the tab's current source table(s) and points the target at
 * the tab. NO line-move, no fiscal effect.
 *
 * Locks the involved `dining_tables` rows (target + the tab's current source table(s)) `FOR UPDATE` in
 * ASCENDING id order — the deadlock-safe lock order every table-service verb shares. Locking the target
 * is the concurrency guard: a second concurrent move onto the same free table blocks, then re-reads its
 * now-set `tab_id` and is refused `table.occupied` (proven by deletion of this lock — §7). The tab's own
 * `working_orders` row is NOT locked (a move neither settles nor abandons it — unlike merge); a race
 * with a concurrent pay leaves at worst a harmless stale pointer, which the occupancy read ignores.
 *
 * The freed source table(s) get `tab_id → NULL` AND `status_id → NULL` in one statement — a move is a
 * turnover for the source, so its TS-2 manual status must not linger onto the next party (design §4).
 * The TS-2 settle-trigger does not fire on a move (the tab stays open), so the clear is EXPLICIT here.
 */
export async function moveTab(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  toTableId: string,
): Promise<void> {
  const [tab] = await tx
    .select({ status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, tabId));
  if (tab === undefined || tab.status !== "open") {
    throw new AppError("tab.not_open", { tabId });
  }

  const involved = await tx
    .select({ id: diningTables.id, tabId: diningTables.tabId, active: diningTables.active })
    .from(diningTables)
    .where(or(eq(diningTables.id, toTableId), eq(diningTables.tabId, tabId)))
    .orderBy(diningTables.id)
    .for("update");

  const target = involved.find((t) => t.id === toTableId);
  if (target === undefined) {
    throw new AppError("table.not_found", { tableId: toTableId });
  }
  if (!target.active) {
    throw new AppError("table.inactive", { tableId: toTableId });
  }
  if (target.tabId !== null) {
    const [pointed] = await tx
      .select({ id: workingOrders.id })
      .from(workingOrders)
      .where(and(eq(workingOrders.id, target.tabId), eq(workingOrders.status, "open")));
    if (pointed !== undefined) {
      throw new AppError("table.occupied", { tableId: toTableId });
    }
  }

  // Free the source table(s) the tab currently covers (tab_id + status_id → NULL), then point the target.
  await tx
    .update(diningTables)
    .set({ tabId: null, statusId: null })
    .where(and(eq(diningTables.tenantId, cfg.tenantId), eq(diningTables.tabId, tabId)));
  await tx.update(diningTables).set({ tabId }).where(eq(diningTables.id, toTableId));
}
```

- [ ] **Step 5: Run — see it pass.**

Run: `pnpm --filter @waitron/server test move-merge.test`
Expected: PASS (4 `moveTab` tests + Task 1's 4).

- [ ] **Step 6: Prove `table.occupied` by deletion.** Temporarily change the occupied check to `if (false)`, rerun the `table.occupied` test → it FAILS (the move overwrites the occupied target's `tab_id`, orphaning its open tab). Restore.

- [ ] **Step 7: Write the concurrent-`moveTab` race (real Postgres).** Create `apps/server/src/move-merge.rls.test.ts` — port the shared scaffolding VERBATIM from `working-order.rls.test.ts` (Plan note 4): the `suite`/`clock`/`backend` (built in `beforeAll`), `systemClock`, `nextNif`, `tillConfigFromVenue`, `setupVenue` (returns `{ cfg, cafe, agua }`), and the owner-read helpers `saleCount`/`registroCount`/`orderState`. Then add the table helpers and the race:

```typescript
// ... shared scaffolding ported verbatim from working-order.rls.test.ts (Plan note 4). Then:
import { createTable } from "./tables.js";
import { joinTable, mergeTabs, moveTab, openTab } from "./working-order.js";
import { payWorkingOrder } from "./till-sale.js";

/** Seed one active dining table in the venue as the app role; returns its id. */
async function seedTable(cfg: TillConfig, label: string): Promise<string> {
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return createTable(tx, cfg, { label }).then((r) => r.id);
  });
}

/** Open a tab on a table as the app role; returns its tab (working_order) id. */
async function openTabOn(
  cfg: TillConfig,
  tableId: string,
  lines: { productId: string; quantity: string }[],
): Promise<string> {
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return openTab(tx, cfg, { tableId, lines }).then((r) => r.tabId);
  });
}

/** The dining table's current tab_id — owner read (bypasses RLS). */
async function tabIdOf(tableId: string): Promise<string | null> {
  const { rows } = await suite.admin.execute<{ tab_id: string | null }>(
    sql`select tab_id from dining_tables where id = ${tableId}`,
  );
  return rows[0]!.tab_id;
}

describe("moveTab concurrency (the target FOR UPDATE lock IS the guard)", () => {
  it("two backends racing to move DIFFERENT tabs onto the SAME free table → one wins, the other gets table.occupied", async () => {
    const { cfg, cafe } = await setupVenue();
    const srcA = await seedTable(cfg, "RA");
    const srcB = await seedTable(cfg, "RB");
    const target = await seedTable(cfg, "RT");
    const tabA = await openTabOn(cfg, srcA, [{ productId: cafe.id, quantity: "1" }]);
    const tabB = await openTabOn(cfg, srcB, [{ productId: cafe.id, quantity: "1" }]);

    const [connA, connB] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
    try {
      const pids = await Promise.all(
        [connA, connB].map((d) =>
          d.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`).then((r) => r.rows[0]!.pid),
        ),
      );
      expect(new Set(pids).size).toBe(2); // distinct backends — on PGlite these collapse (false pass).

      const attempt = (d: Database, tabId: string) =>
        withTenant(d, cfg.tenantId, async (tx) => {
          await asAppUser(tx);
          return moveTab(tx, cfg, tabId, target);
        });

      const results = await Promise.allSettled([attempt(connA, tabA), attempt(connB, tabB)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter((r) => r.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "table.occupied", params: { tableId: target },
      });
      // Exactly one of the two tabs now covers the target; the other's source is untouched.
      expect(await tabIdOf(target)).not.toBeNull();
    } finally {
      await Promise.all([connA.close(), connB.close()]);
    }
  });
});
```

- [ ] **Step 8: Run the race, and prove the lock by deletion.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test move-merge.rls`
Expected: PASS. To PROVE the target `FOR UPDATE` lock is the guard, temporarily remove `.for("update")` from `moveTab`'s `dining_tables` SELECT, rerun → the race now yields `fulfilled = 2` / `rejected = 0` (both read the target as free and both re-point it, one silently overwriting the other). Restore the lock.

- [ ] **Step 9: Coverage + commit.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`
Expected: PASS at 98/98/98/95.

```bash
git add apps/server/src/working-order.ts apps/server/src/errors.ts apps/server/src/move-merge.test.ts apps/server/src/move-merge.rls.test.ts
git commit -s -m "feat(server): moveTab relocate + table.occupied + concurrent race (TS-3)"
```

---

## Task 3: `joinTable` — extend a tab's coverage to a free table

**Files:**
- Modify: `apps/server/src/working-order.ts`
- Test: `apps/server/src/move-merge.test.ts` (PGlite), `apps/server/src/move-merge.rls.test.ts` (real-PG)

**Interfaces:**
- Consumes (from TS-1): `diningTables`, `workingOrders`; `table.not_found`/`table.inactive`; `payWorkingOrder` (`till-sale.ts`).
- Produces: `joinTable(tx: Transaction, cfg: TillConfig, tabId: string, tableId: string): Promise<void>` — throws `tab.not_open`, `table.not_found`, `table.inactive`, `table.occupied`. (`cfg` is accepted for family-signature symmetry and is unused in the body — an `after-used` unused arg, tolerated exactly as TS-1's `deactivateTable(tx, cfg, id)`.)

- [ ] **Step 1: Write the failing `joinTable` PGlite tests.** First widen the import: add `joinTable` to the `./working-order.js` import line. Then append to `apps/server/src/move-merge.test.ts`:

```typescript
describe("joinTable", () => {
  it("extends a tab's coverage to a free table: BOTH tables point at the one tab, no line-move", async () => {
    const { cfg, cafeId } = await setupVenue();
    const t1 = await seedTable(cfg, "J1");
    const t2 = await seedTable(cfg, "J2");
    const tabId = await openTabOn(cfg, t1, [{ productId: cafeId, quantity: "1" }]);

    await asApp(cfg, (tx) => joinTable(tx, cfg, tabId, t2));

    expect(await tabIdOf(t1)).toBe(tabId);
    expect(await tabIdOf(t2)).toBe(tabId); // both point at the one tab — a join
    expect(await linesOf(tabId)).toHaveLength(1); // the free table added no lines
  });

  it("refuses a target that already has an OPEN tab (table.occupied)", async () => {
    const { cfg, cafeId } = await setupVenue();
    const t1 = await seedTable(cfg, "JO1");
    const t2 = await seedTable(cfg, "JO2");
    const tabId = await openTabOn(cfg, t1, [{ productId: cafeId, quantity: "1" }]);
    await openTabOn(cfg, t2, [{ productId: cafeId, quantity: "1" }]);
    await expect(asApp(cfg, (tx) => joinTable(tx, cfg, tabId, t2))).rejects.toMatchObject({
      code: "table.occupied", params: { tableId: t2 },
    });
  });

  it("refuses an unknown/inactive target and a non-open tab", async () => {
    const { cfg, cafeId } = await setupVenue();
    const t1 = await seedTable(cfg, "JG1");
    const t2 = await seedTable(cfg, "JG2");
    const tabId = await openTabOn(cfg, t1, [{ productId: cafeId, quantity: "1" }]);
    const missing = randomUUID();
    await expect(asApp(cfg, (tx) => joinTable(tx, cfg, tabId, missing))).rejects.toMatchObject({
      code: "table.not_found", params: { tableId: missing },
    });
    await db.execute(sql`update dining_tables set active = false where id = ${t2}`);
    await expect(asApp(cfg, (tx) => joinTable(tx, cfg, tabId, t2))).rejects.toMatchObject({
      code: "table.inactive", params: { tableId: t2 },
    });
    await db.execute(sql`update working_orders set status = 'settled', settled_at = now() where id = ${tabId}`);
    const t3 = await seedTable(cfg, "JG3");
    await expect(asApp(cfg, (tx) => joinTable(tx, cfg, tabId, t3))).rejects.toMatchObject({
      code: "tab.not_open", params: { tabId },
    });
  });
});
```

- [ ] **Step 2: Run — see it fail.**

Run: `pnpm --filter @waitron/server test move-merge.test`
Expected: FAIL — `joinTable is not a function`.

- [ ] **Step 3: Implement `joinTable`.** In `apps/server/src/working-order.ts`, add beside `moveTab`:

```typescript
/**
 * Extend a tab's coverage to a free table (design §3): validates `tabId` is an `open` working order
 * (`tab.not_open`) and `tableId` is `active` and FREE (`table.not_found`/`table.inactive`/`table.occupied`),
 * then points the free table's `tab_id` at the tab too — now BOTH the tab's original table(s) and this
 * one point at it, a join. NO line-move (the free table had no tab) and NO status clear (nothing is
 * freed — the table joins, it does not turn over; design §4). On pay the one tab files one sale; on
 * settle the TS-2 trigger clears status on ALL its tables (keyed on `tab_id`).
 *
 * The target table is locked `FOR UPDATE` — the concurrency guard, exactly as `moveTab`'s: a second
 * concurrent join onto the same free table blocks, then reads its set `tab_id` and is refused
 * `table.occupied`. `cfg` is unused (the row is addressed by id and RLS confines it to the tenant); it is
 * kept for signature symmetry with `moveTab`/`mergeTabs`.
 */
export async function joinTable(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  tableId: string,
): Promise<void> {
  const [tab] = await tx
    .select({ status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, tabId));
  if (tab === undefined || tab.status !== "open") {
    throw new AppError("tab.not_open", { tabId });
  }

  const [table] = await tx
    .select({ id: diningTables.id, tabId: diningTables.tabId, active: diningTables.active })
    .from(diningTables)
    .where(eq(diningTables.id, tableId))
    .for("update");
  if (table === undefined) {
    throw new AppError("table.not_found", { tableId });
  }
  if (!table.active) {
    throw new AppError("table.inactive", { tableId });
  }
  if (table.tabId !== null) {
    const [pointed] = await tx
      .select({ id: workingOrders.id })
      .from(workingOrders)
      .where(and(eq(workingOrders.id, table.tabId), eq(workingOrders.status, "open")));
    if (pointed !== undefined) {
      throw new AppError("table.occupied", { tableId });
    }
  }

  await tx.update(diningTables).set({ tabId }).where(eq(diningTables.id, tableId));
}
```

- [ ] **Step 4: Run — see it pass.**

Run: `pnpm --filter @waitron/server test move-merge.test`
Expected: PASS (3 `joinTable` tests + earlier tasks').

- [ ] **Step 5: Write the joined-then-paid = ONE sale test (real Postgres).** Append to `apps/server/src/move-merge.rls.test.ts`:

```typescript
describe("joinTable → one bill", () => {
  it("a joined tab files ONE sale covering both tables on pay", async () => {
    const { cfg, cafe } = await setupVenue();
    const t1 = await seedTable(cfg, "JP1");
    const t2 = await seedTable(cfg, "JP2");
    const tabId = await openTabOn(cfg, t1, [{ productId: cafe.id, quantity: "1" }]);
    await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await joinTable(tx, cfg, tabId, t2);
    });

    // Pay the one tab (a retrieved open order files from its stored locked lines).
    await payWorkingOrder({ db: suite.admin, backend, clock }, cfg, {
      id: tabId,
      lines: [],
      tender: { method: "cash", amount: "5.00" },
    });

    expect(await saleCount(tabId)).toBe(1); // exactly one bill for both tables
    expect(await orderState(tabId)).toMatchObject({ status: "settled" });
  });
});
```

- [ ] **Step 6: Run + commit.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test move-merge.rls`
Expected: PASS.

```bash
git add apps/server/src/working-order.ts apps/server/src/move-merge.test.ts apps/server/src/move-merge.rls.test.ts
git commit -s -m "feat(server): joinTable extends tab coverage to a free table (TS-3)"
```

---

## Task 4: `mergeTabs` — consolidate (`freeSourceTable:true`) + one-registro fiscal receipt

**Files:**
- Modify: `apps/server/src/working-order.ts`
- Test: `apps/server/src/move-merge.test.ts` (PGlite), `apps/server/src/move-merge.rls.test.ts` (real-PG)

**Interfaces:**
- Consumes (from TS-1): `diningTables`, `workingOrders`; `moveTabLines` (Task 1); `payWorkingOrder`.
- Consumes (from TS-2): `diningTables.statusId` + the `working_orders_clear_table_status` reset trigger (Plan notes 1 & 2).
- Produces: `mergeTabs(tx: Transaction, cfg: TillConfig, intoTabId: string, fromTabId: string, options: { freeSourceTable: boolean }): Promise<void>` — throws `tab.merge_self`, `tab.not_open`. This task implements the WHOLE function (both branches, both covered here); Task 5 adds the join-outcome depth, Task 6 the guard-by-deletion for `tab.merge_self`/`tab.not_open`.

- [ ] **Step 1: Write the failing `mergeTabs` consolidate PGlite tests (both branches covered).** First widen the imports: add `mergeTabs` to the `./working-order.js` import line and `updateProduct` to the `@waitron/catalogue` import block. Then append to `apps/server/src/move-merge.test.ts`:

```typescript
describe("mergeTabs consolidate (freeSourceTable: true)", () => {
  it("combines fromTab's lines onto intoTab with LOCKED prices preserved, abandons+empties fromTab, frees the source", async () => {
    const { cfg, cafeId } = await setupVenue();
    const tInto = await seedTable(cfg, "C-into");
    const tFrom = await seedTable(cfg, "C-from");
    // intoTab: café at 1.50. Then raise the catalogue price and open fromTab: café at 9.99. A re-price
    // would make both 9.99; the move must keep each line's OWN locked gross (the load-bearing check).
    const intoTab = await openTabOn(cfg, tInto, [{ productId: cafeId, quantity: "1" }]);
    await asApp(cfg, (tx) => updateProduct(tx, cafeId, { unitPrice: "9.99" }));
    const fromTab = await openTabOn(cfg, tFrom, [{ productId: cafeId, quantity: "1" }]);
    // A manual status on the source (TS-2 schema) must clear when it is freed.
    const status = await seedStatus(cfg, "Needs cleaning");
    await db.execute(sql`update dining_tables set status_id = ${status} where id = ${tFrom}`);

    await asApp(cfg, (tx) => mergeTabs(tx, cfg, intoTab, fromTab, { freeSourceTable: true }));

    // intoTab holds both café lines, EACH at its own locked gross (1.50 and 9.99).
    const dest = await linesOf(intoTab);
    expect(dest.map((l) => l.gross).sort()).toEqual(["1.50", "9.99"]);
    // fromTab is abandoned and empty; the source table is freed and its status cleared.
    const [{ status: fromStatus }] = await db
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, fromTab));
    expect(fromStatus).toBe("abandoned");
    expect(await linesOf(fromTab)).toHaveLength(0);
    expect(await tabIdOf(tFrom)).toBeNull();
    expect(await statusIdOf(tFrom)).toBeNull();
    expect(await tabIdOf(tInto)).toBe(intoTab); // intoTab's own table unchanged
  });

  it("the join branch (freeSourceTable: false) re-points the source table at intoTab (covered for branch)", async () => {
    const { cfg, cafeId } = await setupVenue();
    const tInto = await seedTable(cfg, "CB-into");
    const tFrom = await seedTable(cfg, "CB-from");
    const intoTab = await openTabOn(cfg, tInto, [{ productId: cafeId, quantity: "1" }]);
    const fromTab = await openTabOn(cfg, tFrom, [{ productId: cafeId, quantity: "1" }]);

    await asApp(cfg, (tx) => mergeTabs(tx, cfg, intoTab, fromTab, { freeSourceTable: false }));

    expect(await tabIdOf(tFrom)).toBe(intoTab); // source table now covered by intoTab (a join)
    expect(await tabIdOf(tInto)).toBe(intoTab);
  });
});
```

- [ ] **Step 2: Run — see it fail.**

Run: `pnpm --filter @waitron/server test move-merge.test`
Expected: FAIL — `mergeTabs is not a function`.

- [ ] **Step 3: Implement `mergeTabs`.** In `apps/server/src/working-order.ts`, add beside `joinTable`:

```typescript
/**
 * Combine two tabs onto one bill (design §3). Validates both are DISTINCT (`tab.merge_self`) `open`
 * working orders (`tab.not_open`), then moves ALL of `fromTab`'s lines onto `intoTab`, re-points
 * `fromTab`'s table(s), and abandons the now-empty `fromTab`. The merged `intoTab` (holding every line)
 * files ONE sale on pay; `fromTab`, abandoned and empty, files nothing — no double-file (H2, §5).
 *
 * `freeSourceTable = true` frees the source table (`tab_id` + `status_id → NULL` — the 2+2 CONSOLIDATE
 * case, the source turns over); `false` re-points it at `intoTab` (both tables now covered by the one
 * bill — the 4+4 JOIN case, and the joined table KEEPS its status, design §4).
 *
 * Locks the involved `dining_tables` rows (those covered by either tab) `FOR UPDATE` ASCENDING id, then
 * both `working_orders` rows `FOR UPDATE` ASCENDING id — the fixed lock order that makes two concurrent
 * table-service ops on the same tables serialise instead of deadlocking (proven §7).
 *
 * ORDER MATTERS (Plan note 2): the re-point (step 2) precedes the abandon (step 3). The TS-2
 * `working_orders_clear_table_status` trigger fires on the `open → abandoned` transition and clears
 * `status_id` WHERE `tab_id = fromTabId`; because step 2 has already re-pointed every such table away
 * from `fromTabId`, that trigger matches nothing. Were the abandon first, it would clear the status on a
 * table that stays JOINED (`freeSourceTable:false`) — contradicting design §4.
 */
export async function mergeTabs(
  tx: Transaction,
  cfg: TillConfig,
  intoTabId: string,
  fromTabId: string,
  options: { freeSourceTable: boolean },
): Promise<void> {
  if (intoTabId === fromTabId) {
    throw new AppError("tab.merge_self", { tabId: intoTabId });
  }

  // Lock order: involved dining_tables rows (ascending id), then both working_orders rows (ascending id).
  await tx
    .select({ id: diningTables.id })
    .from(diningTables)
    .where(or(eq(diningTables.tabId, intoTabId), eq(diningTables.tabId, fromTabId)))
    .orderBy(diningTables.id)
    .for("update");
  const tabs = await tx
    .select({ id: workingOrders.id, status: workingOrders.status })
    .from(workingOrders)
    .where(or(eq(workingOrders.id, intoTabId), eq(workingOrders.id, fromTabId)))
    .orderBy(workingOrders.id)
    .for("update");
  const into = tabs.find((t) => t.id === intoTabId);
  const from = tabs.find((t) => t.id === fromTabId);
  if (into === undefined || into.status !== "open") {
    throw new AppError("tab.not_open", { tabId: intoTabId });
  }
  if (from === undefined || from.status !== "open") {
    throw new AppError("tab.not_open", { tabId: fromTabId });
  }

  // 1. Move ALL of fromTab's lines onto intoTab (locked prices preserved), both still open.
  await moveTabLines(tx, fromTabId, intoTabId);

  // 2. Re-point fromTab's table(s) BEFORE the abandon (Plan note 2).
  if (options.freeSourceTable) {
    await tx
      .update(diningTables)
      .set({ tabId: null, statusId: null })
      .where(and(eq(diningTables.tenantId, cfg.tenantId), eq(diningTables.tabId, fromTabId)));
  } else {
    await tx
      .update(diningTables)
      .set({ tabId: intoTabId })
      .where(and(eq(diningTables.tenantId, cfg.tenantId), eq(diningTables.tabId, fromTabId)));
  }

  // 3. Abandon the now-empty fromTab (open → abandoned; the transition trigger permits it, orders.ts:36-48).
  await tx.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, fromTabId));
}
```

- [ ] **Step 4: Run — see it pass.**

Run: `pnpm --filter @waitron/server test move-merge.test`
Expected: PASS (2 `mergeTabs` tests + earlier). Both branches of `freeSourceTable` are exercised, so coverage stays green.

- [ ] **Step 5: Prove the merged-then-paid tab files exactly ONE registro (real Postgres).** Append to `apps/server/src/move-merge.rls.test.ts`:

```typescript
describe("mergeTabs → one registro (H2)", () => {
  it("a merged-then-paid tab yields exactly ONE registros_facturacion row; the source tab files nothing", async () => {
    const { cfg, cafe, agua } = await setupVenue();
    const tInto = await seedTable(cfg, "MR-into");
    const tFrom = await seedTable(cfg, "MR-from");
    const intoTab = await openTabOn(cfg, tInto, [{ productId: cafe.id, quantity: "1" }]);
    const fromTab = await openTabOn(cfg, tFrom, [{ productId: agua.id, quantity: "1" }]);

    await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await mergeTabs(tx, cfg, intoTab, fromTab, { freeSourceTable: true });
    });

    // fromTab is abandoned and files nothing — never reaches settled, so no double-file (CLAUDE.md §5).
    expect(await orderState(fromTab)).toMatchObject({ status: "abandoned" });
    expect(await saleCount(fromTab)).toBe(0);

    // Pay the merged intoTab → exactly one sale + one chained registro for the combined bill.
    await payWorkingOrder({ db: suite.admin, backend, clock }, cfg, {
      id: intoTab,
      lines: [],
      tender: { method: "cash", amount: "5.00" },
    });
    expect(await saleCount(intoTab)).toBe(1);
    expect(await registroCount(intoTab)).toBe(1);
    expect(await registroCount(fromTab)).toBe(0);
  });
});
```

- [ ] **Step 6: The H2 grep receipt — TS-3 changed no fiscal code.**

Run: `git diff --stat main -- packages/core/src/record-sale.ts packages/fiscal-verifactu/src/backend.ts packages/db/src/schema/registros.ts`
Expected: **no output** (TS-3 touches none of the alta builders, `recordSale`, or the `registros_facturacion` schema). Confirm the whole diff stays within `apps/server/src/` (verbs + tests + routes) with `git diff --stat main | grep -v '^ apps/server/src/'` printing only the summary line — no `packages/` file.

- [ ] **Step 7: Coverage + commit.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`
Expected: PASS at 98/98/98/95.

```bash
git add apps/server/src/working-order.ts apps/server/src/move-merge.test.ts apps/server/src/move-merge.rls.test.ts
git commit -s -m "feat(server): mergeTabs consolidate + one-registro H2 receipt (TS-3)"
```

---

## Task 5: `mergeTabs` join outcome — both tables covered, status preserved, one sale

**Files:**
- Test: `apps/server/src/move-merge.test.ts` (PGlite), `apps/server/src/move-merge.rls.test.ts` (real-PG)

**Interfaces:**
- Consumes: `mergeTabs` (Task 4). No new implementation — this task verifies the join (`freeSourceTable:false`) OUTCOME end-to-end and proves the re-point-before-abandon ORDERING is load-bearing (Plan note 2).

- [ ] **Step 1: Write the join-outcome PGlite test (status preserved on the joined table).** Append to `apps/server/src/move-merge.test.ts`:

```typescript
describe("mergeTabs join (freeSourceTable: false)", () => {
  it("keeps BOTH tables pointing at intoTab and PRESERVES a manual status on the joined table", async () => {
    const { cfg, cafeId, aguaId } = await setupVenue();
    const tInto = await seedTable(cfg, "JN-into");
    const tFrom = await seedTable(cfg, "JN-from");
    const intoTab = await openTabOn(cfg, tInto, [{ productId: cafeId, quantity: "1" }]);
    const fromTab = await openTabOn(cfg, tFrom, [{ productId: aguaId, quantity: "1" }]);
    // A status on the source table (TS-2 schema): a JOINED table keeps its status (design §4).
    const status = await seedStatus(cfg, "VIP");
    await db.execute(sql`update dining_tables set status_id = ${status} where id = ${tFrom}`);

    await asApp(cfg, (tx) => mergeTabs(tx, cfg, intoTab, fromTab, { freeSourceTable: false }));

    expect(await tabIdOf(tInto)).toBe(intoTab);
    expect(await tabIdOf(tFrom)).toBe(intoTab); // both covered by the one bill
    expect(await statusIdOf(tFrom)).toBe(status); // joined table KEEPS its status
    expect(await linesOf(intoTab)).toHaveLength(2); // café + agua combined onto intoTab
  });
});
```

- [ ] **Step 2: Run — it passes (Task 4 implemented the branch correctly).**

Run: `pnpm --filter @waitron/server test move-merge.test`
Expected: PASS.

- [ ] **Step 3: Prove the re-point-before-abandon ordering is load-bearing (Plan note 2).** In `mergeTabs`, temporarily move step 3 (the abandon `UPDATE`) ABOVE step 2 (the re-point `if/else`). Rerun the join-outcome test → it FAILS: the TS-2 `working_orders_clear_table_status` trigger fires on the abandon while `tFrom` still points at `fromTabId`, clearing its `status_id`, so `statusIdOf(tFrom)` is `null` instead of `status`. Restore the original order. (This is the guard-by-deletion for the ordering decision — a test that still passed with the steps swapped would not be testing it.)

- [ ] **Step 4: Write the join-merge-then-paid = ONE sale test (real Postgres).** Append to `apps/server/src/move-merge.rls.test.ts`:

```typescript
describe("mergeTabs join → one bill covering both tables", () => {
  it("a join-merged tab files ONE sale covering the combined lines; both tables still point at intoTab", async () => {
    const { cfg, cafe, agua } = await setupVenue();
    const tInto = await seedTable(cfg, "JMP-into");
    const tFrom = await seedTable(cfg, "JMP-from");
    const intoTab = await openTabOn(cfg, tInto, [{ productId: cafe.id, quantity: "1" }]);
    const fromTab = await openTabOn(cfg, tFrom, [{ productId: agua.id, quantity: "1" }]);

    await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await mergeTabs(tx, cfg, intoTab, fromTab, { freeSourceTable: false });
    });
    expect(await tabIdOf(tFrom)).toBe(intoTab);

    await payWorkingOrder({ db: suite.admin, backend, clock }, cfg, {
      id: intoTab,
      lines: [],
      tender: { method: "cash", amount: "5.00" },
    });
    expect(await saleCount(intoTab)).toBe(1); // one bill for both tables
    expect(await saleCount(fromTab)).toBe(0); // the abandoned source files nothing
  });
});
```

- [ ] **Step 5: Run + commit.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test move-merge.rls`
Expected: PASS.

```bash
git add apps/server/src/move-merge.test.ts apps/server/src/move-merge.rls.test.ts
git commit -s -m "test(server): mergeTabs join outcome + ordering guard-by-deletion (TS-3)"
```

---

## Task 6: `tab.merge_self`/`tab.not_open` guards + concurrent merge/move deadlock-safety

**Files:**
- Modify: `apps/server/src/errors.ts`
- Test: `apps/server/src/move-merge.test.ts` (PGlite), `apps/server/src/move-merge.rls.test.ts` (real-PG)

**Interfaces:**
- Consumes: `mergeTabs`/`moveTab` (Tasks 2/4); `diningTables`/`workingOrders`.
- Produces: error code `tab.merge_self` (`{ tabId }`).

- [ ] **Step 1: Declare `tab.merge_self`.** In `apps/server/src/errors.ts`, add beside `table.occupied`:

```typescript
    /**
     * A merge named the SAME tab as both source and destination — `mergeTabs(intoTabId === fromTabId)`.
     * Refused before any line move or lock, because merging a tab into itself would move its own lines
     * onto itself and then abandon it. `tabId` is the caller-supplied uuid (not a secret). `tab.*` names
     * the DOMAIN CONCEPT (the running tab), never the throwing package (the rule `tenant.not_found`'s note
     * gives). A request-shape error — the two arguments are equal regardless of any tab's STATE — so it
     * is mapped to 400 (a bad request), distinct from the state-conflict `tab.not_open` (409).
     */
    "tab.merge_self": { tabId: string };
```

- [ ] **Step 2: Write the guard PGlite tests + prove them by deletion.** Append to `apps/server/src/move-merge.test.ts`:

```typescript
describe("mergeTabs guards", () => {
  it("refuses merging a tab into itself (tab.merge_self)", async () => {
    const { cfg, cafeId } = await setupVenue();
    const t = await seedTable(cfg, "MS");
    const tab = await openTabOn(cfg, t, [{ productId: cafeId, quantity: "1" }]);
    await expect(
      asApp(cfg, (tx) => mergeTabs(tx, cfg, tab, tab, { freeSourceTable: true })),
    ).rejects.toMatchObject({ code: "tab.merge_self", params: { tabId: tab } });
  });

  it("refuses when either tab is not open (tab.not_open)", async () => {
    const { cfg, cafeId } = await setupVenue();
    const tInto = await seedTable(cfg, "NO-into");
    const tFrom = await seedTable(cfg, "NO-from");
    const intoTab = await openTabOn(cfg, tInto, [{ productId: cafeId, quantity: "1" }]);
    const fromTab = await openTabOn(cfg, tFrom, [{ productId: cafeId, quantity: "1" }]);
    // Abandon fromTab (owner write) → merge is refused, naming fromTab.
    await db.execute(sql`update working_orders set status = 'abandoned' where id = ${fromTab}`);
    await expect(
      asApp(cfg, (tx) => mergeTabs(tx, cfg, intoTab, fromTab, { freeSourceTable: true })),
    ).rejects.toMatchObject({ code: "tab.not_open", params: { tabId: fromTab } });
  });
});
```

- [ ] **Step 3: Run + prove both guards by deletion.**

Run: `pnpm --filter @waitron/server test move-merge.test`
Expected: PASS. Then: (a) comment the `if (intoTabId === fromTabId)` guard in `mergeTabs`, rerun → the `tab.merge_self` test FAILS (a self-merge now proceeds and abandons the tab); restore. (b) Change the `from`/`into` open-checks to `if (false)`, rerun → the `tab.not_open` test FAILS (the merge proceeds against an abandoned parent, surfacing a raw trigger error); restore.

- [ ] **Step 4: Write the concurrent merge/move deadlock-safety test (real Postgres).** Append to `apps/server/src/move-merge.rls.test.ts`. Two backends run REVERSE merges over the same two tabs; the ascending-id lock order makes them SERIALISE (one commits, the other finds its source already abandoned — a clean `tab.not_open`) rather than deadlock (`40P01`).

```typescript
/** True if `e` (or its cause) is a PostgreSQL deadlock (40P01). */
function isDeadlock(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } })?.code
    ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "40P01";
}

describe("concurrent merge/move deadlock-safety (ascending-id FOR UPDATE lock order)", () => {
  it("two reverse merges over the same two tabs serialise with NO 40P01 — one wins, the other gets tab.not_open", async () => {
    const { cfg, cafe } = await setupVenue();
    const tA = await seedTable(cfg, "DL-A");
    const tB = await seedTable(cfg, "DL-B");
    const tabA = await openTabOn(cfg, tA, [{ productId: cafe.id, quantity: "1" }]);
    const tabB = await openTabOn(cfg, tB, [{ productId: cafe.id, quantity: "1" }]);

    const [connA, connB] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
    try {
      const merge = (d: Database, into: string, from: string) =>
        withTenant(d, cfg.tenantId, async (tx) => {
          await asAppUser(tx);
          await mergeTabs(tx, cfg, into, from, { freeSourceTable: true });
        });

      // Reverse orientations: A←B on one backend, B←A on the other. Both touch the SAME two dining_tables
      // rows and the SAME two working_orders rows; the ascending-id lock order both acquire keeps them
      // from cross-locking, so neither deadlocks.
      const results = await Promise.allSettled([
        merge(connA, tabA, tabB),
        merge(connB, tabB, tabA),
      ]);

      // No 40P01 in either outcome — the discipline held.
      for (const r of results) {
        if (r.status === "rejected") expect(isDeadlock(r.reason)).toBe(false);
      }
      // Exactly one merge committed; the loser found its source already abandoned → tab.not_open.
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
      expect(loser?.reason).toMatchObject({ code: "tab.not_open" });
    } finally {
      await Promise.all([connA.close(), connB.close()]);
    }
  });

  it("PROVES the hazard is real: cross-locking the two tables in OPPOSITE order deadlocks (40P01)", async () => {
    // A deterministic control — raw locks in inverted order — showing the ascending-id discipline the
    // verbs follow is what the positive test above relies on. connA locks A then B; connB locks B then
    // A; both first locks succeed, then each second lock closes the cycle → Postgres kills one (40P01).
    const { cfg } = await setupVenue();
    const tA = await seedTable(cfg, "HZ-A");
    const tB = await seedTable(cfg, "HZ-B");
    const [lo, hi] = [tA, tB].sort(); // ascending by id, so the verbs would always lock `lo` first
    const [connA, connB] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
    try {
      const begin = (d: Database) => d.execute(sql`begin`);
      const lock = (d: Database, id: string) =>
        d.execute(sql`select 1 from dining_tables where id = ${id} for update`);
      await Promise.all([begin(connA), begin(connB)]);
      await Promise.all([lock(connA, lo), lock(connB, hi)]); // first locks: no contention
      const settled = await Promise.allSettled([lock(connA, hi), lock(connB, lo)]); // cross → deadlock
      expect(settled.some((r) => r.status === "rejected" && isDeadlock(r.reason))).toBe(true);
    } finally {
      await Promise.all([connA.execute(sql`rollback`).catch(() => {}), connB.execute(sql`rollback`).catch(() => {})]);
      await Promise.all([connA.close(), connB.close()]);
    }
  });
});
```

- [ ] **Step 5: Run + prove the lock order by deletion.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test move-merge.rls`
Expected: PASS. To PROVE the ascending-id ORDER is what prevents the deadlock in the verb, temporarily remove `.orderBy(diningTables.id)` (and `.orderBy(workingOrders.id)`) from `mergeTabs`'s locking selects and run the reverse-merge test in a loop (`for i in $(seq 20); do ...; done`) — a `40P01` surfaces because the two backends now lock in scan-dependent, divergent orders. Restore the `orderBy`s. (The second test is the deterministic hazard control; the first is the guard the ordering provides.)

- [ ] **Step 6: Coverage + commit.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`
Expected: PASS at 98/98/98/95.

```bash
git add apps/server/src/errors.ts apps/server/src/move-merge.test.ts apps/server/src/move-merge.rls.test.ts
git commit -s -m "feat(server): tab.merge_self/tab.not_open guards + deadlock-safety proof (TS-3)"
```

---

## Task 7: HTTP routes — `POST /api/tabs/:id/{move,join,merge}`

**Files:**
- Modify: `apps/server/src/till-api.ts`
- Test: `apps/server/src/till-api.move-merge.test.ts` (create)

**Interfaces:**
- Consumes (from TS-1): `run`, `requireSession`, `isUuid`, `STATUS`, `mountTillApi`, `TillApiDeps` (`till-api.ts`/`till-session.ts`); `moveTab`/`joinTable`/`mergeTabs` (`working-order.ts`).
- Produces: three session-gated routes. `:id` is the tab (working_order) id; a malformed `:id` (or body id) is screened with `isUuid` and refused with the route's fail-closed domain code (never a 500). Bodies: move `{ toTableId }`, join `{ tableId }`, merge `{ fromTabId, freeSourceTable }`.

- [ ] **Step 1: Extend the `STATUS` map + import the verbs.** In `apps/server/src/till-api.ts`:
  - Add the two new codes to the `STATUS` map (beside the TS-1 `table.*`/`tab.*` entries):

```typescript
  "table.occupied": 409,
  "tab.merge_self": 400,
```

  Confirm the TS-1 entries `table.not_found` (404), `table.inactive` (409) and `tab.not_open` (409) are already present in `STATUS` (grep the map). If `tab.not_open` is absent (left at the 400 default by TS-1), add `"tab.not_open": 409,` here — the move/join/merge routes report it as a state conflict.
  - Add the verbs to the `./working-order.js` import block: `joinTable`, `mergeTabs`, `moveTab`.

- [ ] **Step 2: Add the `requireTabParam` guard + the three routes.** In `mountTillApi`, add the guard near `requireUuidId` and the routes beside the other tab routes:

```typescript
/**
 * Screen a tab `:id` path param as a UUID before it reaches a query — a malformed id passed into
 * `eq(workingOrders.id, id)` would `22P02` → an opaque 500 (the fail-closed shape the working-order
 * routes' `requireUuidId` uses). A non-UUID names no open tab exactly as legitimately as an absent one,
 * so it is refused with `tab.not_open` (409). See Plan note 3 on the param key.
 */
function requireTabParam(id: string): string {
  if (!isUuid(id)) {
    throw new AppError("tab.not_open", { tabId: id });
  }
  return id;
}
```

```typescript
  // Relocate a tab to a free table (TS-3, design §3a). SESSION-GUARDED. The tab `:id` and the body
  // `toTableId` are both isUuid-screened before any query — a malformed tab id → `tab.not_open` (409),
  // a malformed target → `table.not_found` (404), never a 500. The verb runs on a fresh
  // withTenant/asAppUser transaction (RLS scopes it to this till's tenant). Returns 200 empty.
  app.post("/api/tabs/:id/move", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const tabId = requireTabParam(c.req.param("id"));
      const body = await c.req.json<{ toTableId: string }>();
      if (!isUuid(body.toTableId)) throw new AppError("table.not_found", { tableId: body.toTableId });
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await moveTab(tx, deps.cfg, tabId, body.toTableId);
      });
      return c.body(null, 200);
    }),
  );

  // Extend a tab's coverage to a free table (TS-3, a join). SESSION-GUARDED; same isUuid screening as
  // move. Returns 200 empty.
  app.post("/api/tabs/:id/join", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const tabId = requireTabParam(c.req.param("id"));
      const body = await c.req.json<{ tableId: string }>();
      if (!isUuid(body.tableId)) throw new AppError("table.not_found", { tableId: body.tableId });
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await joinTable(tx, deps.cfg, tabId, body.tableId);
      });
      return c.body(null, 200);
    }),
  );

  // Combine two tabs onto one bill (TS-3). SESSION-GUARDED. The destination tab `:id` and the body
  // `fromTabId` are both isUuid-screened → `tab.not_open` on a malformed id; a self-merge is
  // `tab.merge_self` (400), a non-open tab `tab.not_open` (409), both from `mergeTabs`. Returns 200 empty.
  app.post("/api/tabs/:id/merge", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const intoTabId = requireTabParam(c.req.param("id"));
      const body = await c.req.json<{ fromTabId: string; freeSourceTable: boolean }>();
      if (!isUuid(body.fromTabId)) throw new AppError("tab.not_open", { tabId: body.fromTabId });
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await mergeTabs(tx, deps.cfg, intoTabId, body.fromTabId, {
          freeSourceTable: body.freeSourceTable,
        });
      });
      return c.body(null, 200);
    }),
  );
```

- [ ] **Step 3: Write the route tests.** Create `apps/server/src/till-api.move-merge.test.ts`, mirroring `till-api.test.ts`'s harness VERBATIM: its `usePgliteDb` `suite` (migrations incl. `IDENTITY_MIGRATIONS` + `CORE_MIGRATIONS`), the `deps(db)` builder, the `collect([])` logger, and the `openSession(db)` helper that logs a real operator in and returns the cookie. Copy that scaffolding, then add the venue/table/tab seeding and the route assertions:

```typescript
// ... harness ported verbatim from till-api.test.ts: `suite`, `deps`, `collect`, `openSession`,
// and the venue the session cookie references (its tenant/location/till). Then:
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { asAppUser, withTenant } from "@waitron/db";
import { mountTillApi } from "./till-api.js";
import { createTable } from "./tables.js";
import { openTab } from "./working-order.js";

describe("POST /api/tabs/:id/{move,join,merge}", () => {
  it("401s without a session (session.required)", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const res = await app.request("/api/tabs/00000000-0000-4000-8000-000000000000/move", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toTableId: "00000000-0000-4000-8000-000000000001" }),
    });
    expect(res.status).toBe(401);
  });

  it("4xx (not 500) on a malformed tab :id", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = await openSession(suite.db);
    const res = await app.request("/api/tabs/not-a-uuid/move", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ toTableId: "00000000-0000-4000-8000-000000000001" }),
    });
    expect(res.status).toBe(409); // tab.not_open, not an opaque 500
  });

  it("moves a tab to a free table (200) and re-points the target", async () => {
    const app = new Hono();
    const d = deps(suite.db);
    mountTillApi(app, d, collect([]));
    const cookie = await openSession(suite.db);
    // Seed two tables + a tab in the session's tenant/location (d.cfg).
    const { src, dst, tabId } = await withTenant(suite.db, d.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const s = await createTable(tx, d.cfg, { label: "R-src" });
      const t = await createTable(tx, d.cfg, { label: "R-dst" });
      const tab = await openTab(tx, d.cfg, { tableId: s.id });
      return { src: s.id, dst: t.id, tabId: tab.tabId };
    });

    const res = await app.request(`/api/tabs/${tabId}/move`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ toTableId: dst }),
    });
    expect(res.status).toBe(200);
    const { rows } = await suite.db.execute<{ tab_id: string | null }>(
      sql`select tab_id from dining_tables where id = ${dst}`,
    );
    expect(rows[0]!.tab_id).toBe(tabId);
    const back = await suite.db.execute<{ tab_id: string | null }>(
      sql`select tab_id from dining_tables where id = ${src}`,
    );
    expect(back.rows[0]!.tab_id).toBeNull();
  });

  it("409 table.occupied when moving onto an occupied target", async () => {
    const app = new Hono();
    const d = deps(suite.db);
    mountTillApi(app, d, collect([]));
    const cookie = await openSession(suite.db);
    const { dst, tabId } = await withTenant(suite.db, d.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const s = await createTable(tx, d.cfg, { label: "O-src" });
      const t = await createTable(tx, d.cfg, { label: "O-dst" });
      const tab = await openTab(tx, d.cfg, { tableId: s.id });
      await openTab(tx, d.cfg, { tableId: t.id }); // occupy dst
      return { dst: t.id, tabId: tab.tabId };
    });
    const res = await app.request(`/api/tabs/${tabId}/move`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ toTableId: dst }),
    });
    expect(res.status).toBe(409);
  });

  it("400 tab.merge_self when merging a tab into itself", async () => {
    const app = new Hono();
    const d = deps(suite.db);
    mountTillApi(app, d, collect([]));
    const cookie = await openSession(suite.db);
    const tabId = await withTenant(suite.db, d.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const s = await createTable(tx, d.cfg, { label: "MS-src" });
      const tab = await openTab(tx, d.cfg, { tableId: s.id });
      return tab.tabId;
    });
    const res = await app.request(`/api/tabs/${tabId}/merge`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ fromTabId: tabId, freeSourceTable: true }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 4: Run — see it pass.**

Run: `pnpm --filter @waitron/server test till-api.move-merge`
Expected: PASS. If the malformed-`:id` test returns 500 instead of 409, the `requireTabParam` screen is missing or `tab.not_open` is absent from `STATUS` — fix Step 1/2.

- [ ] **Step 5: Full gate + commit.**

Run: `pnpm --filter @waitron/server lint && pnpm --filter @waitron/server typecheck && TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`
Expected: PASS at 98/98/98/95. Then the whole-workspace format check: `pnpm format:check`.

```bash
git add apps/server/src/till-api.ts apps/server/src/till-api.move-merge.test.ts
git commit -s -m "feat(server): /api/tabs/:id/{move,join,merge} routes (TS-3)"
```

---

## Self-review (run against the spec, fixed inline)

**1. Spec coverage.**
- §1/§3 `moveTab` → Task 2. `joinTable` → Task 3. `mergeTabs` (both `freeSourceTable` outcomes) → Tasks 4 (consolidate) + 5 (join). `moveTabLines` (all + subset) → Task 1. HTTP routes → Task 7. ✓
- §2 "no new schema" → Global Constraints + Task-4 grep receipt (whole diff stays in `apps/server/src/`). ✓
- §3 ascending-id `FOR UPDATE` lock order → implemented in every verb; deadlock-safety proven in Task 6. ✓
- §4 TS-2 status interaction: source status cleared on `moveTab`/`mergeTabs{true}` (Tasks 2, 4), preserved on join (Task 5) — with the re-point-before-abandon ordering (Plan note 2) proven by deletion. ✓
- §5 H2 (one sale, no double-file) → Task 4 real-PG one-registro + grep; `mergeTabs` abandons `fromTab` so it never reaches `settled`. ✓
- §6 codes: `table.occupied` (Task 2), `tab.merge_self` (Task 6); reuse `tab.not_open`/`table.not_found`/`table.inactive` (TS-1). ✓
- §7 tests: PGlite verb logic (Tasks 1–6), real-PG concurrent race + deadlock-safety + fiscal (Tasks 2, 3, 4, 5, 6). The cross-tenant RLS impossibility is covered by the verbs running under `asAppUser`+RLS in every real-PG test (a foreign tab is RLS-hidden, so its `working_orders`/`dining_tables` rows never resolve); if a dedicated cross-tenant prove-by-deletion is wanted, add it to Task 6's real-PG suite mirroring TS-1's `dining-tables.rls.test.ts` tenant-predicate deletion. ✓

**2. Placeholder scan.** No `TBD`/`add validation`/`similar to Task N`; every code step carries real code. The two large real-PG/route scaffolding blocks are explicitly ported verbatim from named existing files (Plan note 4) — the same precedent the TS-1 plan set for its `tabs.rls.test.ts`, not a placeholder. ✓

**3. Type consistency.** `moveTabLines(tx, fromTabId, toTabId, lineNos?)`, `moveTab(tx, cfg, tabId, toTableId)`, `joinTable(tx, cfg, tabId, tableId)`, `mergeTabs(tx, cfg, intoTabId, fromTabId, { freeSourceTable })` are used identically in impl, tests, and routes. Error params: `table.occupied {tableId}`, `tab.merge_self {tabId}`, `tab.not_open {tabId}` (Plan note 3 flags the TS-1 param-key reconciliation). `diningTables.statusId`/`.tabId`/`.tenantId`/`.active` match the TS-1+TS-2 schema. ✓
