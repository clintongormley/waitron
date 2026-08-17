# Table Service TS-4 (Transfer Items) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move **selected** items — whole lines or **part** of a line — from one open tab to another, reusing TS-3's `moveTabLines` for whole lines and **splitting** a line for a partial quantity, conserving quantity and **never re-pricing** (the destination inherits the source line's locked `unit_price_gross`).

**Architecture:** One new tx-level verb `transferLines(tx, cfg, fromTabId, toTabId, transfers)` in `apps/server/src/working-order.ts`, beside the TS-1/TS-3 tab verbs, plus its HTTP route in `till-api.ts`. It locks BOTH tab rows `FOR UPDATE` in **ascending id order** (the TS-3 deadlock-safe discipline, reusing TS-1's module-private `lockOpenTab`), delegates whole-line moves to TS-3's `moveTabLines`, and for a partial reduces the source line's `quantity` + recomputes its `line_total` and inserts a new destination line at the **same** locked per-unit values. `line_total` is recomputed with the shared money math (`@waitron/shared`), **byte-identical** to what `priceBasket` produces (`packages/catalogue/src/pricing.ts:130`) — a derived re-computation, not a re-price. **No new schema, no migration.**

**Tech Stack:** TypeScript (ESM, Node), Drizzle ORM (PostgreSQL 18), Hono HTTP, Vitest, PGlite (hermetic) + Testcontainers (real Postgres for RLS/concurrency), pnpm workspace, `@waitron/shared` exact-decimal money helpers.

**Spec:** docs/superpowers/specs/2026-08-17-table-service-ts4-transfer-items-design.md

**Depends on:** **TS-3 landed** (`moveTabLines(tx, fromTabId, toTabId, lineNos?)` — the shared line-move primitive TS-4 generalises; and the ascending-id `FOR UPDATE` lock discipline `mergeTabs` established) and **TS-1 landed** (the `dining_tables.tab_id` back-pointer + locked-price `working_order_lines`; the module-private `lockOpenTab(tx, tabId)`; the tab verbs `openTab`/`addTabRound` and `createTable` used by fixtures; the `dining_tables` migrations now in `CORE_MIGRATIONS`; and the error codes `tab.not_open` / `tab.line_not_found`).

**Consumed items (do NOT re-implement — assert they exist, then reuse):**
- `moveTabLines(tx: Transaction, fromTabId: string, toTabId: string, lineNos?: number[]): Promise<void>` — TS-3, in `working-order.ts`. Moves the named lines (default all) intact, keeping each line's locked `unit_price_gross`, re-numbering `line_no` on the destination; both tabs must be `open` (`tab.not_open`). **Task 1 confirms it accepts a `lineNos` subset and extends it if TS-3 did not.**
- `lockOpenTab(tx: Transaction, tabId: string): Promise<void>` — TS-1, **module-private in `working-order.ts`** (so `transferLines`, same module, calls it directly). Locks the tab's `working_orders` row `FOR UPDATE`, confirms it is `open` AND a `dining_tables.tab_id` points at it, else throws `tab.not_open` `{ tabId }`.
- `openTab(tx, cfg, { tableId, lines? })`, `addTabRound(tx, cfg, tabId, lines)`, `createTable(tx, cfg, { label, zone?, capacity? })` — TS-1, for test fixtures only.
- `createOpenOrder` / `priceOrderLines` — the existing line-insert shape TS-4's destination insert mirrors (`working-order.ts:75,252`).
- Error codes (declared by TS-1, mapped in `till-api.ts`'s `STATUS`): `tab.not_open` `{ tabId }` → **409**; `tab.line_not_found` `{ tabId; lineNo }` → **404**.
- Shared money helpers (`@waitron/shared`): `decimal`, `multiplyDecimal`, `toScale`, `MONEY_SCALE`, `subtractDecimal`, `compareDecimal`.
- The catalogue receipt: `priceBasket` computes each line's gross as `toScale(multiplyDecimal(grossUnit, decimal(quantity)), MONEY_SCALE)` — `packages/catalogue/src/pricing.ts:130`. TS-4's `line_total` recompute uses the **identical** expression so a split total equals what a fresh ring of that quantity would have produced.

## Global Constraints

- **Coverage thresholds 98/98/98/95** (statements/lines/functions/branches) for `apps/server`. CI shards run `test:coverage`, not `test` — verify green with `pnpm --filter @waitron/server test:coverage` (unfiltered, so the package's cross-cutting guards load too).
- **NO new migration / NO new schema.** Transfer works entirely on the existing `working_order_lines` across two `open` `working_orders`. If any step reaches for `db:generate`, the step is wrong.
- **English identifiers only.** No new schema tokens; add NO `SPANISH_WORDS` entries.
- **Domain-named error codes, never renamed once shipped.** New: `tab.transfer_self`, `tab.transfer_quantity_invalid`. Reuse `tab.not_open`, `tab.line_not_found`. Declared in `apps/server/src/errors.ts` (the host registry that already declares `working_order.*`/`tab.*`); every throwing file carries `import "./errors.js"`. The root `errors-reachable` guard covers `packages/*` barrels, NOT `apps/*`, so keep the import present.
- **Use the shared money math for `line_total`; NEVER re-price from the catalogue.** `line_total = toScale(multiplyDecimal(decimal(unit_price_gross), decimal(quantity)), MONEY_SCALE)` — half away from zero, matching `pricing.ts:130`. The per-unit `unit_price` / `unit_price_gross` on the destination line is the source line's **locked** value, inherited, never re-fetched.
- **Real Postgres for concurrency/RLS; PGlite is a false pass there.** PGlite runs every connection as a superuser (bypasses FORCE RLS) and serialises every query onto one backend (no race). Put the concurrent-transfer race and the cross-tenant RLS test on Testcontainers; note `TESTCONTAINERS_RYUK_DISABLED=true` locally (CLAUDE.md §4).
- **H2 — pre-fiscal; the immutable core is untouched.** Transfer only moves/splits `working_order_lines` between two `open` (mutable, unfiled) tabs. Each tab files its **own** one sale on pay via the **unchanged** `payWorkingOrder → recordSale` path; no `record-sale.ts` / alta-builder / `registros_facturacion` change (grep-proven in Task 6). No re-price, no double-file (each line lives on exactly one tab after the transfer).
- **Ascending-id `FOR UPDATE` lock order.** Lock BOTH tab rows in ascending id order (`[fromTabId, toTabId].sort()` + `lockOpenTab` each), the same discipline `mergeTabs` uses, so two concurrent transfers on the same pair cannot deadlock.
- **Prove every guard and the lock by deletion.** Remove the guard / the ascending-id sort / the RLS predicate, confirm the test fails, restore it. A test that still passes with the guard removed is not testing the guard.
- **Every commit `git commit -s`.**
- **No backwards-compat / data-migration code.** Pre-production.

---

## File Structure

**Modified:**
- `apps/server/src/working-order.ts` — extend the `@waitron/shared` import with the money helpers; add the private `grossLineTotal` helper and the exported `transferLines` verb (built across Tasks 2–5). Task 1 may extend `moveTabLines` if TS-3 shipped it without the `lineNos` subset.
- `apps/server/src/errors.ts` — declare `tab.transfer_self` (Task 2) and `tab.transfer_quantity_invalid` (Task 5).
- `apps/server/src/till-api.ts` — import `transferLines`; mount `POST /api/tabs/:id/transfer`; add `tab.transfer_self`/`tab.transfer_quantity_invalid` to the `STATUS` map (Task 7).

**Created:**
- `apps/server/src/transfer-lines.test.ts` — PGlite: the verb logic — `moveTabLines` subset (Task 1), whole-line transfer (Task 2), partial split incl. price-lock + weighed (Task 3), full-quantity == whole-line (Task 4), the guards (Task 5).
- `apps/server/src/transfer-lines.rls.test.ts` — real Postgres: concurrent-transfer deadlock-safety, cross-tenant RLS (prove-by-deletion of the tenant predicate), and the H2 per-tab single-`registros` proof.
- `apps/server/src/till-api.transfer.test.ts` — the HTTP route (session guard, `isUuid` 4xx, status mapping, happy path).

---

## Task 1: Confirm/extend `moveTabLines` accepts a `lineNos` subset

TS-3's `moveTabLines(tx, fromTabId, toTabId, lineNos?)` is specified to already take an optional subset ("TS-4 calls it with a subset — building it general now avoids a TS-4 refactor", TS-3 spec §3). This task **proves** the subset path with a dedicated test, and **extends** the function only if TS-3 shipped it without the parameter.

**Files:**
- Modify (only if needed): `apps/server/src/working-order.ts` (`moveTabLines`)
- Test: `apps/server/src/transfer-lines.test.ts` (created here)

**Interfaces:**
- Consumes: `moveTabLines(tx, fromTabId, toTabId, lineNos?)`, `openTab`, `addTabRound`, `createTable` (all TS-1/TS-3).
- Produces: nothing new; a receipt that `moveTabLines` moves ONLY the named lines, leaves the rest on the source, re-numbers on the destination, and preserves each line's locked `unit_price_gross`.

- [ ] **Step 1: Read `moveTabLines`'s current signature.** Open `apps/server/src/working-order.ts`, find `export async function moveTabLines`. Confirm the parameter list ends with an optional `lineNos?: number[]` and that when present it filters the moved lines to that subset (a `WHERE line_no IN (...)`/`inArray` clause). If it is already there, skip Step 5's edit and go straight to the test.

- [ ] **Step 2: Write the failing subset test.** Create `apps/server/src/transfer-lines.test.ts` with the shared PGlite fixture and one `moveTabLines` subset test:

```typescript
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant, workingOrderLines } from "@waitron/db";
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
import {
  addTabRound,
  createTable,
  moveTabLines,
  openTab,
  transferLines,
} from "./working-order.js";
import "./errors.js";

// PGlite, not real Postgres: this suite proves the WRITE behaviour of `transferLines` and
// `moveTabLines` — the split arithmetic, the guards, the line renumbering, the price-lock — all plain
// SQL a single backend proves. The concurrency race and the RLS cross-tenant isolation (which PGlite's
// superuser single-backend connection CANNOT show) are `transfer-lines.rls.test.ts`'s real-Postgres job.
const LOCALE = "es-ES";
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let db: Database;
beforeAll(() => {
  db = suite.db;
});

interface Seeded {
  cfg: TillConfig;
  /** "Café" — each, 1.50 gross, general(21%). */
  cafeId: string;
  /** "Agua" — each, 2.00 gross, general(21%). */
  aguaId: string;
  /** "Jamón" — WEIGHT, 24.90/kg gross, reduced(10%). */
  jamonId: string;
  tableAId: string;
  tableBId: string;
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
    const jamon = await createProduct(tx, {
      catalogueId: cat.id, categoryId: bebidas.id, descriptions: { [LOCALE]: "Jamón" },
      pricingUnit: "weight", unitPrice: "24.90", vatClass: "reduced",
    });
    await assignCatalogueToLocation(tx, locationId, cat.id);
    const a = await createTable(tx, cfg, { label: "A" });
    const b = await createTable(tx, cfg, { label: "B" });
    return { cafeId: cafe.id, aguaId: agua.id, jamonId: jamon.id, tableAId: a.id, tableBId: b.id };
  });
  return { cfg, ...seeded };
}

/** Run `fn` on a fresh app-scoped transaction (RLS in force, `app_user` role), like production. */
function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** The lines on a tab, owner-read (bypasses RLS), by `line_no`. */
async function linesOf(tabId: string): Promise<
  { lineNo: number; productId: string; quantity: string; unitPriceGross: string; lineTotal: string }[]
> {
  return db
    .select({
      lineNo: workingOrderLines.lineNo,
      productId: workingOrderLines.productId,
      quantity: workingOrderLines.quantity,
      unitPriceGross: workingOrderLines.unitPriceGross,
      lineTotal: workingOrderLines.lineTotal,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId))
    .orderBy(workingOrderLines.lineNo);
}

/** Open a tab on `tableId` with an initial round, returning its tab id. */
async function openTabWith(
  cfg: TillConfig,
  tableId: string,
  lines: { productId: string; quantity: string }[],
): Promise<string> {
  const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId, lines }));
  return tabId;
}

describe("moveTabLines — subset", () => {
  it("moves ONLY the named lines, leaves the rest on the source, renumbers on the destination", async () => {
    const { cfg, cafeId, aguaId, tableAId, tableBId } = await setupVenue();
    // Tab A: line 1 = café×2, line 2 = agua×1. Tab B: line 1 = agua×3 (so the moved line lands at 2).
    const tabA = await openTabWith(cfg, tableAId, [
      { productId: cafeId, quantity: "2" },
      { productId: aguaId, quantity: "1" },
    ]);
    const tabB = await openTabWith(cfg, tableBId, [{ productId: aguaId, quantity: "3" }]);

    // Move ONLY line 1 (café) from A to B.
    await asApp(cfg, (tx) => moveTabLines(tx, tabA, tabB, [1]));

    const a = await linesOf(tabA);
    const b = await linesOf(tabB);
    // A keeps only the agua line (its line_no is unchanged — a subset move renumbers the DESTINATION only).
    expect(a.map((l) => l.productId)).toEqual([aguaId]);
    // B gained the café line at the next line_no (2), locked price kept.
    expect(b.map((l) => l.productId)).toEqual([aguaId, cafeId]);
    expect(b[1]).toMatchObject({ lineNo: 2, quantity: "2.000", unitPriceGross: "1.50", lineTotal: "3.00" });
  });
});
```

- [ ] **Step 3: Run it.** `pnpm --filter @waitron/server test transfer-lines` — if `moveTabLines` already accepts the subset, this **passes** (go to Step 6). If it fails because `moveTabLines` ignores/rejects `lineNos`, continue.

- [ ] **Step 4 (only if the test failed): Run to confirm the failure shape.** Expect either a TS error (no `lineNos` param) or a wrong result (all lines moved). Note which.

- [ ] **Step 5 (only if needed): Extend `moveTabLines`.** Add the optional `lineNos?: number[]` parameter and gate the source read/delete with `inArray(workingOrderLines.lineNo, lineNos)` when it is provided, moving all lines when it is absent. Keep the existing behaviour identical for the no-arg case. Re-run Step 3 to green.

- [ ] **Step 6: Commit.**

```bash
git add apps/server/src/transfer-lines.test.ts apps/server/src/working-order.ts
git commit -s -m "test(server): prove moveTabLines subset path for TS-4 transfer"
```

---

## Task 2: `transferLines` — whole-line path (guards `tab.transfer_self`/`tab.not_open`)

**Files:**
- Modify: `apps/server/src/working-order.ts` (add `transferLines`; extend the `@waitron/shared` import), `apps/server/src/errors.ts` (declare `tab.transfer_self`)
- Test: `apps/server/src/transfer-lines.test.ts`

**Interfaces:**
- Consumes: `moveTabLines`, `lockOpenTab` (module-private), `tab.not_open`.
- Produces:
  - `transferLines(tx: Transaction, cfg: TillConfig, fromTabId: string, toTabId: string, transfers: { lineNo: number; quantity?: string }[]): Promise<void>` — throws `tab.transfer_self`, `tab.not_open` (this task); `tab.line_not_found`, `tab.transfer_quantity_invalid` (Task 5).
  - Error code `tab.transfer_self` `{ tabId: string }`.

- [ ] **Step 1: Write the failing whole-line + transfer-self tests.** Append to `transfer-lines.test.ts`:

```typescript
describe("transferLines — whole line", () => {
  it("moves an entire line to the other tab, keeping its locked unit_price_gross, source line gone", async () => {
    const { cfg, cafeId, aguaId, tableAId, tableBId } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ productId: cafeId, quantity: "2" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ productId: aguaId, quantity: "1" }]);

    // Whole line = `quantity` omitted.
    await asApp(cfg, (tx) => transferLines(tx, cfg, tabA, tabB, [{ lineNo: 1 }]));

    const a = await linesOf(tabA);
    const b = await linesOf(tabB);
    expect(a).toEqual([]); // the café line left A entirely
    expect(b.map((l) => l.productId)).toEqual([aguaId, cafeId]);
    // Locked price preserved (café 1.50 gross → 2×1.50 = 3.00), NOT re-priced.
    expect(b[1]).toMatchObject({ lineNo: 2, quantity: "2.000", unitPriceGross: "1.50", lineTotal: "3.00" });
  });

  it("refuses transferring a tab to ITSELF (tab.transfer_self), changing nothing", async () => {
    const { cfg, cafeId, tableAId } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ productId: cafeId, quantity: "2" }]);
    await expect(
      asApp(cfg, (tx) => transferLines(tx, cfg, tabA, tabA, [{ lineNo: 1 }])),
    ).rejects.toMatchObject({ code: "tab.transfer_self", params: { tabId: tabA } });
    expect(await linesOf(tabA)).toHaveLength(1); // untouched
  });

  it("refuses when the destination is not an open tab (tab.not_open)", async () => {
    const { cfg, cafeId, tableAId } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ productId: cafeId, quantity: "2" }]);
    const notATab = randomUUID(); // no working_orders row, no dining_tables back-pointer
    await expect(
      asApp(cfg, (tx) => transferLines(tx, cfg, tabA, notATab, [{ lineNo: 1 }])),
    ).rejects.toMatchObject({ code: "tab.not_open", params: { tabId: notATab } });
    expect(await linesOf(tabA)).toHaveLength(1); // untouched
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `pnpm --filter @waitron/server test transfer-lines`. Expected: FAIL — `transferLines` is not exported yet (TS error / not a function).

- [ ] **Step 3: Declare `tab.transfer_self`.** In `apps/server/src/errors.ts`, inside the `interface ErrorParams` block, beside the other `tab.*` codes:

```typescript
    /**
     * A transfer named the SAME tab as source and destination (`fromTabId === toTabId`). Refused
     * before any lock or line read — moving items from a tab to itself is a no-op the caller did not
     * mean, and letting it through would take the same tab's row `FOR UPDATE` twice. `tabId` is the
     * caller-supplied uuid (both ids are equal here), echoed because it is not a secret. A CLIENT
     * request-shape fault (400), distinct from the state conflict `tab.not_open` (409): the ids are
     * well-formed, they are just equal. `tab.*` names the DOMAIN CONCEPT, not the throwing package
     * (`tenant.not_found`'s note gives the rule); never renamed once shipped.
     */
    "tab.transfer_self": { tabId: string };
```

- [ ] **Step 4: Extend the `@waitron/shared` import in `working-order.ts`.** Change the existing import (currently `import { AppError, type SaleId, workingOrderId as brandWorkingOrderId } from "@waitron/shared";`) to add the money helpers:

```typescript
import {
  AppError,
  MONEY_SCALE,
  compareDecimal,
  decimal,
  multiplyDecimal,
  type SaleId,
  subtractDecimal,
  toScale,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
```

- [ ] **Step 5: Add the `grossLineTotal` helper and the whole-line `transferLines`.** Append to `apps/server/src/working-order.ts` (after the tab verbs added by TS-1/TS-3):

```typescript
/**
 * The GROSS (VAT-inclusive) line total for a locked line: `round(quantity × unit_price_gross)`, half
 * away from zero at money scale. BYTE-IDENTICAL to `priceBasket`'s own per-line gross
 * (`packages/catalogue/src/pricing.ts:130` — `toScale(multiplyDecimal(grossUnit, decimal(quantity)),
 * MONEY_SCALE)`), so a SPLIT line total equals what a fresh ring of that quantity would have produced.
 * This is a DERIVED re-computation of `line_total`, NOT a re-price: `unitPriceGross` is the source
 * line's LOCKED value, passed in, never re-fetched from the catalogue. `unitPriceGross`/`quantity` are
 * plain `string`s off the numeric columns, so each is wrapped with `decimal()` (which validates the
 * literal) before reaching the branded-`Decimal` helpers.
 */
function grossLineTotal(unitPriceGross: string, quantity: string): string {
  return toScale(multiplyDecimal(decimal(unitPriceGross), decimal(quantity)), MONEY_SCALE);
}

/**
 * Move SELECTED items — whole lines or PART of a line — from one open tab to another (design §3).
 * `transfers` names the source `line_no`s; `quantity` omitted (or equal to the line's full quantity,
 * Task 4) is a WHOLE-LINE move, delegated to `moveTabLines` (TS-3, locked price kept, appended at the
 * destination's next `line_no`). A partial (`0 < quantity < line.quantity`) SPLITS the line: the source
 * `quantity` drops and its `line_total` is recomputed from the SAME locked `unit_price_gross`, and a
 * NEW destination line is inserted inheriting every per-unit value (`unit_price`, `unit_price_gross`,
 * `vat_rate`, `descriptions`, `category`, `product_id`) unchanged — NEVER re-fetched from the catalogue.
 * Quantity is conserved (`remaining + transferred = original`); nothing is re-priced.
 *
 * Both tabs are locked `FOR UPDATE` in ASCENDING id order (`[fromTabId, toTabId].sort()` + `lockOpenTab`
 * each) — the TS-3 deadlock-safe discipline `mergeTabs` uses, so two concurrent transfers on the same
 * pair lock in the same order and cannot deadlock. Sorting decouples the lock order from the transfer
 * DIRECTION. `lockOpenTab` (TS-1) confirms each is an OPEN tab (a `dining_tables.tab_id` points at it),
 * else `tab.not_open`. An absent/foreign tab (RLS-hidden) matches no row → the same fail-closed
 * `tab.not_open`.
 *
 * This is a tx-level verb (takes the caller's `tx`, like `moveTabLines`/`mergeTabs`): the HTTP route
 * opens the `withTenant`/`asAppUser` transaction around it. Pre-fiscal — nothing is filed; each tab
 * files its own sale on its own pay (H2, design §4).
 */
export async function transferLines(
  tx: Transaction,
  cfg: TillConfig,
  fromTabId: string,
  toTabId: string,
  transfers: { lineNo: number; quantity?: string }[],
): Promise<void> {
  // A tab cannot transfer to itself — refused before any lock (which would take the row twice).
  if (fromTabId === toTabId) {
    throw new AppError("tab.transfer_self", { tabId: fromTabId });
  }

  // Lock BOTH tab rows FOR UPDATE in ascending id order. `.sort()` is lexicographic, which for the
  // canonical lowercase uuids `randomUUID()`/`gen_random_uuid()` emit matches PostgreSQL's own byte
  // ordering of `uuid` — so this IS ascending id order as the DB sees it. `lockOpenTab` throws
  // `tab.not_open` for a row that is absent, closed, or (RLS) another tenant's.
  for (const tabId of [fromTabId, toTabId].sort()) {
    await lockOpenTab(tx, tabId);
  }

  // Whole-line only in THIS task: move every named line intact (keeps its locked unit_price_gross,
  // renumbers on the destination). The partial-split path is Task 3.
  await moveTabLines(tx, fromTabId, toTabId, transfers.map((t) => t.lineNo));
}
```

- [ ] **Step 6: Run to verify pass.** `pnpm --filter @waitron/server test transfer-lines`. Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 7: Prove the `tab.transfer_self` guard by deletion.** Comment out the `if (fromTabId === toTabId)` throw, rerun — the transfer-self test now fails (the tab locks itself and `moveTabLines` moves the lines within one tab). Restore the guard, rerun green.

- [ ] **Step 8: Commit.**

```bash
git add apps/server/src/working-order.ts apps/server/src/errors.ts apps/server/src/transfer-lines.test.ts
git commit -s -m "feat(server): transferLines whole-line path + tab.transfer_self guard (TS-4)"
```

---

## Task 3: The PARTIAL-split path (conservation, price-lock, weighed)

**Files:**
- Modify: `apps/server/src/working-order.ts` (`transferLines`)
- Test: `apps/server/src/transfer-lines.test.ts`

**Interfaces:**
- Consumes: `grossLineTotal`, `subtractDecimal`, `decimal`, `moveTabLines`, `lockOpenTab`.
- Produces: `transferLines` now splits a line when `quantity` is present (whole-vs-full refinement is Task 4; guards are Task 5).

- [ ] **Step 1: Write the failing partial-split tests** (conservation + price-lock + weighed). Append to `transfer-lines.test.ts`:

```typescript
describe("transferLines — partial split", () => {
  it("splits a line: source quantity drops, a destination line appears at the SAME locked gross, quantity conserved", async () => {
    const { cfg, cafeId, aguaId, tableAId, tableBId } = await setupVenue();
    // Tab A: café×3 (line 1). Tab B: agua×1 (line 1) → the split lands at B line 2.
    const tabA = await openTabWith(cfg, tableAId, [{ productId: cafeId, quantity: "3" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ productId: aguaId, quantity: "1" }]);

    // Move 1 of the 3 coffees.
    await asApp(cfg, (tx) => transferLines(tx, cfg, tabA, tabB, [{ lineNo: 1, quantity: "1" }]));

    const a = await linesOf(tabA);
    const b = await linesOf(tabB);
    // Source: café line still present, quantity 3 → 2, line_total recomputed round(2×1.50)=3.00.
    expect(a).toEqual([
      expect.objectContaining({ lineNo: 1, productId: cafeId, quantity: "2.000", unitPriceGross: "1.50", lineTotal: "3.00" }),
    ]);
    // Destination: NEW café line at B line 2, SAME locked gross 1.50, quantity 1, round(1×1.50)=1.50.
    expect(b).toEqual([
      expect.objectContaining({ lineNo: 1, productId: aguaId }),
      expect.objectContaining({ lineNo: 2, productId: cafeId, quantity: "1.000", unitPriceGross: "1.50", lineTotal: "1.50" }),
    ]);
    // Quantity conserved: 2 + 1 = the original 3. Money conserved for `each`: 3.00 + 1.50 = 4.50.
  });

  it("PRICE LOCK: a catalogue price change between ring and transfer re-prices NEITHER line", async () => {
    const { cfg, cafeId, aguaId, tableAId, tableBId } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ productId: cafeId, quantity: "3" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ productId: aguaId, quantity: "1" }]);

    // Change the catalogue's café price AFTER the ring, BEFORE the transfer (owner write, bypasses RLS).
    // If `transferLines` re-consulted the catalogue, the moved/kept line would jump to 9.99.
    await db.execute(sql`update products set unit_price = '9.99' where id = ${cafeId}`);

    await asApp(cfg, (tx) => transferLines(tx, cfg, tabA, tabB, [{ lineNo: 1, quantity: "1" }]));

    const a = await linesOf(tabA);
    const b = await linesOf(tabB);
    // Both keep the ORIGINAL locked 1.50 — never 9.99. line_totals derived from 1.50, not the catalogue.
    expect(a[0]).toMatchObject({ unitPriceGross: "1.50", quantity: "2.000", lineTotal: "3.00" });
    expect(b[1]).toMatchObject({ unitPriceGross: "1.50", quantity: "1.000", lineTotal: "1.50" });
  });

  it("splits a WEIGHED (decimal-quantity) line the same way, conserving the weight", async () => {
    const { cfg, jamonId, aguaId, tableAId, tableBId } = await setupVenue();
    // Jamón 24.90/kg, 0.320 kg on tab A. Locked gross unit = 24.90; line_total round(0.320×24.90)=7.97.
    const tabA = await openTabWith(cfg, tableAId, [{ productId: jamonId, quantity: "0.320" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ productId: aguaId, quantity: "1" }]);

    // Move 0.120 kg of the jamón.
    await asApp(cfg, (tx) => transferLines(tx, cfg, tabA, tabB, [{ lineNo: 1, quantity: "0.120" }]));

    const a = await linesOf(tabA);
    const b = await linesOf(tabB);
    // Source: 0.320 − 0.120 = 0.200 kg, line_total round(0.200×24.90)=4.98.
    expect(a[0]).toMatchObject({ productId: jamonId, quantity: "0.200", unitPriceGross: "24.90", lineTotal: "4.98" });
    // Destination: 0.120 kg at the SAME 24.90/kg, line_total round(0.120×24.90)=2.99.
    expect(b[1]).toMatchObject({ productId: jamonId, quantity: "0.120", unitPriceGross: "24.90", lineTotal: "2.99" });
    // Weight conserved: 0.200 + 0.120 = 0.320. (Money 4.98+2.99=7.97 == original — exact here; a
    // sub-céntimo split difference would be harmless pre-fiscal, design §3.)
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `pnpm --filter @waitron/server test transfer-lines`. Expected: the three partial tests FAIL — Task 2's `transferLines` moves the WHOLE line (ignores `quantity`), so the source line vanishes and the destination gets quantity 3 (or the whole weighed line), not a split.

- [ ] **Step 3: Add the partial-split path.** Replace the body of `transferLines` in `working-order.ts` (from the `moveTabLines(...)` line onward) so it reads the named source lines, partitions whole-vs-partial, moves the whole ones, and splits the partial ones:

```typescript
export async function transferLines(
  tx: Transaction,
  cfg: TillConfig,
  fromTabId: string,
  toTabId: string,
  transfers: { lineNo: number; quantity?: string }[],
): Promise<void> {
  if (fromTabId === toTabId) {
    throw new AppError("tab.transfer_self", { tabId: fromTabId });
  }
  for (const tabId of [fromTabId, toTabId].sort()) {
    await lockOpenTab(tx, tabId);
  }

  // Read every named source line ONCE, under the lock, into a map. The per-unit locked values a split
  // inherits come from here — never a catalogue re-read.
  const named = transfers.map((t) => t.lineNo);
  const sourceLines = await tx
    .select({
      lineNo: workingOrderLines.lineNo,
      productId: workingOrderLines.productId,
      descriptions: workingOrderLines.descriptions,
      quantity: workingOrderLines.quantity,
      unitPrice: workingOrderLines.unitPrice,
      unitPriceGross: workingOrderLines.unitPriceGross,
      vatRate: workingOrderLines.vatRate,
      category: workingOrderLines.category,
    })
    .from(workingOrderLines)
    .where(and(eq(workingOrderLines.workingOrderId, fromTabId), inArray(workingOrderLines.lineNo, named)));
  const byLineNo = new Map(sourceLines.map((l) => [l.lineNo, l]));

  // Partition: a WHOLE-line move (quantity omitted) vs a PARTIAL split (quantity given). The
  // full-quantity refinement is Task 4; the presence/range guards are Task 5 — here the named line is
  // assumed present and the quantity valid (the tests pass only valid input).
  const wholeLineNos: number[] = [];
  const partials: { line: (typeof sourceLines)[number]; quantity: string }[] = [];
  for (const t of transfers) {
    const line = byLineNo.get(t.lineNo)!;
    if (t.quantity === undefined) {
      wholeLineNos.push(t.lineNo);
    } else {
      partials.push({ line, quantity: t.quantity });
    }
  }

  // Whole lines first: moveTabLines keeps each locked price and appends at the destination's next
  // line_no(s).
  if (wholeLineNos.length > 0) {
    await moveTabLines(tx, fromTabId, toTabId, wholeLineNos);
  }

  // Then the splits. Allocate destination line_nos AFTER the moves (so they don't collide with moved
  // rows): read the current max under the lock and hand out max+1, max+2, ... in order.
  if (partials.length > 0) {
    const [{ maxLineNo }] = await tx
      .select({ maxLineNo: sql<number>`coalesce(max(${workingOrderLines.lineNo}), 0)::int` })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, toTabId));
    for (let i = 0; i < partials.length; i++) {
      const { line, quantity } = partials[i]!;
      const remaining = subtractDecimal(decimal(line.quantity), decimal(quantity));
      // Source line: quantity drops, line_total recomputed from the SAME locked gross (no re-price).
      await tx
        .update(workingOrderLines)
        .set({ quantity: remaining, lineTotal: grossLineTotal(line.unitPriceGross, remaining) })
        .where(and(eq(workingOrderLines.workingOrderId, fromTabId), eq(workingOrderLines.lineNo, line.lineNo)));
      // Destination: a NEW line inheriting every per-unit value, quantity = transferred, line_total =
      // round(transferred × locked gross). NEVER re-fetched from the catalogue.
      await tx.insert(workingOrderLines).values({
        tenantId: cfg.tenantId,
        workingOrderId: toTabId,
        lineNo: maxLineNo! + i + 1,
        productId: line.productId,
        descriptions: line.descriptions,
        quantity,
        unitPrice: line.unitPrice,
        unitPriceGross: line.unitPriceGross,
        vatRate: line.vatRate,
        lineTotal: grossLineTotal(line.unitPriceGross, quantity),
        category: line.category,
      });
    }
  }
}
```

Note: `and`, `eq`, `inArray`, `sql`, `workingOrderLines` are already imported at the top of `working-order.ts`.

- [ ] **Step 4: Run to verify pass.** `pnpm --filter @waitron/server test transfer-lines`. Expected: PASS (Tasks 1–3).

- [ ] **Step 5: Prove the price-lock by mutation.** Temporarily change `grossLineTotal`'s destination call to re-read the catalogue (e.g. hardcode `"9.99"` as the gross) and confirm the price-lock + weighed tests fail; restore. (This confirms the tests actually pin the inherited locked price, not a coincidence.)

- [ ] **Step 6: Commit.**

```bash
git add apps/server/src/working-order.ts apps/server/src/transfer-lines.test.ts
git commit -s -m "feat(server): transferLines partial-split path — conserved, never re-priced (TS-4)"
```

---

## Task 4: Full-quantity partial == whole-line move (no zero remnant)

Transferring a line's FULL quantity must behave as a whole-line move, leaving **no zero-quantity remnant** on the source (which would violate the `working_order_lines_quantity_ck` `quantity <> 0` CHECK, `orders.ts:188`).

**Files:**
- Modify: `apps/server/src/working-order.ts` (`transferLines` partition)
- Test: `apps/server/src/transfer-lines.test.ts`

**Interfaces:**
- Consumes: `compareDecimal`, `decimal`.
- Produces: `transferLines` treats `quantity === line.quantity` as a whole-line move.

- [ ] **Step 1: Write the failing full-quantity test.** Append to `transfer-lines.test.ts`:

```typescript
describe("transferLines — full-quantity partial is a whole-line move", () => {
  it("moving quantity EQUAL to the line's quantity leaves no zero remnant on the source", async () => {
    const { cfg, cafeId, aguaId, tableAId, tableBId } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ productId: cafeId, quantity: "2" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ productId: aguaId, quantity: "1" }]);

    // Explicit quantity "2" == the whole line — must behave exactly like an omitted quantity.
    await asApp(cfg, (tx) => transferLines(tx, cfg, tabA, tabB, [{ lineNo: 1, quantity: "2" }]));

    const a = await linesOf(tabA);
    const b = await linesOf(tabB);
    expect(a).toEqual([]); // NO zero-quantity remnant left behind
    expect(b.map((l) => l.productId)).toEqual([aguaId, cafeId]);
    expect(b[1]).toMatchObject({ lineNo: 2, quantity: "2.000", unitPriceGross: "1.50", lineTotal: "3.00" });
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `pnpm --filter @waitron/server test transfer-lines`. Expected: FAIL — Task 3 splits any quantity-present transfer, so `remaining = 2 − 2 = 0` triggers the `working_order_lines_quantity_ck` CHECK (the source `UPDATE` errors), or leaves a zero-quantity line. The error surfaces as a raw DB error, not the clean whole-line move.

- [ ] **Step 3: Refine the partition to treat full-quantity as whole-line.** In `transferLines`, change the partition loop so a quantity EQUAL to the line's full quantity routes to `wholeLineNos` (decimal-safe comparison, so "2" == "2.000" and a weighed "0.320" == "0.320" both count):

```typescript
  for (const t of transfers) {
    const line = byLineNo.get(t.lineNo)!;
    // Whole line = quantity omitted, OR quantity equal to the line's full quantity (no zero remnant —
    // a zero-quantity source line would violate working_order_lines_quantity_ck). compareDecimal is
    // value-wise across scales, so "2" == "2.000" and a weighed "0.320" == "0.320".
    if (t.quantity === undefined || compareDecimal(decimal(t.quantity), decimal(line.quantity)) === 0) {
      wholeLineNos.push(t.lineNo);
    } else {
      partials.push({ line, quantity: t.quantity });
    }
  }
```

- [ ] **Step 4: Run to verify pass.** `pnpm --filter @waitron/server test transfer-lines`. Expected: PASS (Tasks 1–4).

- [ ] **Step 5: Commit.**

```bash
git add apps/server/src/working-order.ts apps/server/src/transfer-lines.test.ts
git commit -s -m "feat(server): full-quantity transfer is a whole-line move, no zero remnant (TS-4)"
```

---

## Task 5: Guards — `tab.transfer_quantity_invalid`, `tab.line_not_found`

**Files:**
- Modify: `apps/server/src/working-order.ts` (`transferLines` validation), `apps/server/src/errors.ts` (declare `tab.transfer_quantity_invalid`)
- Test: `apps/server/src/transfer-lines.test.ts`

**Interfaces:**
- Consumes: `compareDecimal`, `decimal`, `tab.line_not_found`.
- Produces: error code `tab.transfer_quantity_invalid` `{ tabId: string; lineNo: number; quantity: string }`; `transferLines` throws `tab.line_not_found` for an unknown `line_no` and `tab.transfer_quantity_invalid` for a quantity `≤ 0`, `> line.quantity`, or malformed.

- [ ] **Step 1: Write the failing guard tests.** Append to `transfer-lines.test.ts`:

```typescript
describe("transferLines — guards", () => {
  it("throws tab.line_not_found for a line_no not on the source tab, changing nothing", async () => {
    const { cfg, cafeId, aguaId, tableAId, tableBId } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ productId: cafeId, quantity: "2" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ productId: aguaId, quantity: "1" }]);
    await expect(
      asApp(cfg, (tx) => transferLines(tx, cfg, tabA, tabB, [{ lineNo: 99, quantity: "1" }])),
    ).rejects.toMatchObject({ code: "tab.line_not_found", params: { tabId: tabA, lineNo: 99 } });
    expect(await linesOf(tabA)).toHaveLength(1);
    expect(await linesOf(tabB)).toHaveLength(1);
  });

  it("throws tab.transfer_quantity_invalid for zero, negative, over-quantity, or malformed", async () => {
    const { cfg, cafeId, aguaId, tableAId, tableBId } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ productId: cafeId, quantity: "3" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ productId: aguaId, quantity: "1" }]);
    for (const bad of ["0", "-1", "4", "0.000", "abc"]) {
      await expect(
        asApp(cfg, (tx) => transferLines(tx, cfg, tabA, tabB, [{ lineNo: 1, quantity: bad }])),
      ).rejects.toMatchObject({
        code: "tab.transfer_quantity_invalid",
        params: { tabId: tabA, lineNo: 1, quantity: bad },
      });
    }
    // Nothing moved on any of the rejections.
    expect((await linesOf(tabA))[0]).toMatchObject({ quantity: "3.000" });
    expect(await linesOf(tabB)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `pnpm --filter @waitron/server test transfer-lines`. Expected: FAIL — an unknown `line_no` currently throws on `byLineNo.get(t.lineNo)!` (a raw `TypeError`, not the domain code), and a bad quantity either violates a DB CHECK or produces a wrong split.

- [ ] **Step 3: Declare `tab.transfer_quantity_invalid`.** In `apps/server/src/errors.ts`, beside `tab.transfer_self`:

```typescript
    /**
     * A transfer named a `quantity` outside `0 < quantity ≤ line.quantity` (design §3): zero, negative,
     * more than the line holds, or a malformed decimal literal. Refused before the split — a zero would
     * leave a zero-quantity remnant (violating `working_order_lines_quantity_ck`), an over-quantity would
     * invent stock, and a malformed value cannot be priced. `lineNo` and the offending `quantity` (the
     * caller's own text, not a secret) are echoed so a translator can name what was attempted. A CLIENT
     * request-shape fault (400), distinct from the state conflict `tab.not_open` (409). `tab.*` names the
     * DOMAIN CONCEPT (`tenant.not_found`'s note gives the rule); never renamed once shipped.
     */
    "tab.transfer_quantity_invalid": { tabId: string; lineNo: number; quantity: string };
```

- [ ] **Step 4: Add the validation to the partition loop.** In `transferLines`, replace the partition loop body so it validates presence and range. Malformed quantities are caught by wrapping the `decimal()` parse; a present-but-invalid quantity throws the domain code (never a raw DB CHECK or `shared.invalid_decimal`):

```typescript
  for (const t of transfers) {
    const line = byLineNo.get(t.lineNo);
    if (line === undefined) {
      throw new AppError("tab.line_not_found", { tabId: fromTabId, lineNo: t.lineNo });
    }
    if (t.quantity === undefined) {
      wholeLineNos.push(t.lineNo);
      continue;
    }
    // Validate the requested quantity: a well-formed decimal in `0 < quantity ≤ line.quantity`.
    // A malformed literal makes `decimal()` throw — caught and reported as the SAME domain code, so a
    // bad quantity never surfaces as a raw `shared.invalid_decimal` or a DB CHECK violation.
    let cmpZero: number;
    let cmpFull: number;
    try {
      const q = decimal(t.quantity);
      cmpZero = compareDecimal(q, decimal("0"));
      cmpFull = compareDecimal(q, decimal(line.quantity));
    } catch {
      throw new AppError("tab.transfer_quantity_invalid", { tabId: fromTabId, lineNo: t.lineNo, quantity: t.quantity });
    }
    if (cmpZero <= 0 || cmpFull > 0) {
      throw new AppError("tab.transfer_quantity_invalid", { tabId: fromTabId, lineNo: t.lineNo, quantity: t.quantity });
    }
    if (cmpFull === 0) {
      wholeLineNos.push(t.lineNo); // full quantity — a whole-line move, no zero remnant (Task 4)
    } else {
      partials.push({ line, quantity: t.quantity });
    }
  }
```

(Remove the now-superseded `const line = byLineNo.get(t.lineNo)!;` and the Task 4 `if` from the previous version — this loop replaces both.)

- [ ] **Step 5: Run to verify pass.** `pnpm --filter @waitron/server test transfer-lines`. Expected: PASS (Tasks 1–5).

- [ ] **Step 6: Prove each guard by deletion.** (a) Remove the `line === undefined` throw → the `tab.line_not_found` test fails with a raw `TypeError`. (b) Remove the `cmpZero <= 0 || cmpFull > 0` throw → the over/zero-quantity cases fail (a `0` hits the CHECK, a `4` invents stock). Restore both, rerun green.

- [ ] **Step 7: Commit.**

```bash
git add apps/server/src/working-order.ts apps/server/src/errors.ts apps/server/src/transfer-lines.test.ts
git commit -s -m "feat(server): transferLines quantity + line-not-found guards (TS-4)"
```

---

## Task 6: Real Postgres — concurrent deadlock-safety, cross-tenant RLS, H2 receipt

**Files:**
- Create: `apps/server/src/transfer-lines.rls.test.ts`

**Interfaces:**
- Consumes: `transferLines`, `openTab`/`addTabRound`/`createTable`, `payWorkingOrder` (`till-sale.ts`), the real-PG harness (`useRealPostgres`, `startRealPostgres`), and the `working-order.rls.test.ts` fixture scaffold (copy `systemClock`, `nextNif`, the provisioned-venue `setupVenue`, `suite.pg`/`suite.admin`).
- Produces: nothing new — the concurrency, isolation, and fiscal-safety receipts the spec §6/§4 require.

- [ ] **Step 1: Scaffold the real-PG suite.** Create `apps/server/src/transfer-lines.rls.test.ts` mirroring `working-order.rls.test.ts`'s header verbatim: `const suite = useRealPostgres({ start: startRealPostgres, timeoutMs: 180_000 });`, the `systemClock`/`nextNif` helpers, a provisioned `setupVenue()` (via `applyVenue`/`planVenue`) that also opens two tabs on two `createTable` tables, and a `setupTwoTabs()` returning `{ cfg, tabA, tabB, cafe }`. Import `transferLines`, `openTab`, `createTable` from `./working-order.js` and `payWorkingOrder` from `./till-sale.js`.

```typescript
async function setupTwoTabs(): Promise<{ cfg: TillConfig; tabA: string; tabB: string; cafe: AvailableProduct }> {
  const { cfg, cafe } = await setupVenue(); // provisioned venue + catalogue (café 1.50 gross, general)
  const { tabA, tabB } = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const a = await createTable(tx, cfg, { label: "A" });
    const b = await createTable(tx, cfg, { label: "B" });
    const ta = await openTab(tx, cfg, { tableId: a.id, lines: [{ productId: cafe.id, quantity: "4" }] });
    const tb = await openTab(tx, cfg, { tableId: b.id, lines: [{ productId: cafe.id, quantity: "4" }] });
    return { tabA: ta.tabId, tabB: tb.tabId };
  });
  return { cfg, tabA, tabB, cafe };
}
```

- [ ] **Step 2: Concurrent-transfer deadlock-safety.** Two distinct backends run `transferLines` on the SAME pair of tabs in OPPOSITE directions at once; the ascending-id lock order serialises them with no `40P01`.

```typescript
it("two concurrent transfers on the same pair (opposite directions) serialise — no deadlock", async () => {
  const { cfg, tabA, tabB } = await setupTwoTabs();
  const [connA, connB] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
  try {
    const pids = await Promise.all(
      [connA, connB].map(async (db) => {
        const { rows } = await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        return rows[0]!.pid;
      }),
    );
    expect(new Set(pids).size).toBe(2); // genuinely distinct backends (PGlite could not do this)

    const runOn = (db: typeof suite.admin, from: string, to: string) =>
      withTenant(db, cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await transferLines(tx, cfg, from, to, [{ lineNo: 1, quantity: "1" }]);
      });

    // A→B and B→A racing: because BOTH lock min(id) then max(id), neither can hold one lock while
    // waiting on the other in the reverse order — the classic deadlock cycle cannot form.
    const results = await Promise.allSettled([runOn(connA, tabA, tabB), runOn(connB, tabB, tabA)]);
    for (const r of results) {
      expect(r.status).toBe("fulfilled"); // no 40P01 deadlock; one waited for the other
    }
  } finally {
    await Promise.all([connA.close(), connB.close()]);
  }
});
```

- [ ] **Step 3: Prove the lock order by deletion.** Temporarily change the `[fromTabId, toTabId].sort()` in `transferLines` to the unsorted `[fromTabId, toTabId]` (lock in transfer DIRECTION), rerun Step 2 a few times — the opposite-direction pair now intermittently raises `40P01 deadlock detected` (one settles `rejected`). Restore the `.sort()`, rerun green. Record this as the receipt in the test's comment (do not commit the unsorted version).

- [ ] **Step 4: Cross-tenant RLS — a foreign tab is invisible (prove-by-deletion of the tenant predicate).**

```typescript
it("cannot transfer to another tenant's tab — RLS hides it (tab.not_open); the predicate is the guard", async () => {
  const { cfg: tenantA, tabA } = await setupTwoTabs();
  const { tabA: foreignTab } = await setupTwoTabs(); // a wholly separate venue + tenant (tenant B)

  // Under tenant A's scope, tenant B's tab is RLS-hidden → lockOpenTab finds no row → tab.not_open.
  await expect(
    withTenant(suite.pg, tenantA.tenantId, async (tx) => {
      await asAppUser(tx);
      await transferLines(tx, tenantA, tabA, foreignTab, [{ lineNo: 1 }]);
    }),
  ).rejects.toMatchObject({ code: "tab.not_open", params: { tabId: foreignTab } });

  // Prove the tenant PREDICATE (not mere table access) is what hid it: neutralise the working_orders
  // isolation policy to `true` INSIDE a ROLLED-BACK transaction and confirm the foreign tab is then
  // reachable (the transfer no longer throws tab.not_open before touching lines). Rolled back, so the
  // policy is restored and no rows move (the same idiom append-order-amendment.rls.test.ts uses).
  const conn = await suite.pg.connect();
  try {
    await conn.execute(sql`begin`);
    await conn.execute(sql`set local role app_user`);
    await conn.execute(sql`select set_config('app.tenant_id', ${tenantA.tenantId}, true)`);
    await conn.execute(
      sql`alter policy working_orders_tenant_isolation on working_orders using (true) with check (true)`,
    );
    // The foreign tab's working_orders row is now visible under tenant A — lockOpenTab would find it.
    const { rows } = await conn.execute<{ n: number }>(
      sql`select count(*)::int as n from working_orders where id = ${foreignTab}`,
    );
    expect(rows[0]!.n).toBe(1); // the predicate was the guard: drop it and the foreign row appears
  } finally {
    await conn.execute(sql`rollback`);
    await conn.close();
  }
});
```

(Match the exact `set local role` / `set_config('app.tenant_id', …)` spelling `asAppUser`/`withTenant` use in this repo — read `packages/db/src/testing` and `append-order-amendment.rls.test.ts:328-348` and copy it; the illustration above is the shape, the receipt is the running test.)

- [ ] **Step 5: H2 — each tab files its OWN one sale after a transfer; the fiscal core is untouched.**

```typescript
it("after a partial transfer, paying BOTH tabs files exactly one registro each (no double-file, no re-price)", async () => {
  const { cfg, tabA, tabB, cafe } = await setupTwoTabs(); // A: café×4, B: café×4
  await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    await transferLines(tx, cfg, tabA, tabB, [{ lineNo: 1, quantity: "1" }]); // A→B: 1 café
  });
  // A now holds café×3, B holds café×4 + café×1. Pay each — the UNCHANGED payWorkingOrder path.
  const deps = { db: suite.admin, backend, clock };
  const paidA = await payWorkingOrder(deps, cfg, { id: tabA, lines: [], tender: { method: "cash", amount: "20.00" } });
  const paidB = await payWorkingOrder(deps, cfg, { id: tabB, lines: [], tender: { method: "cash", amount: "20.00" } });
  // Each tab files exactly one sale + one registro; no line double-files (each lives on one tab).
  expect(await registroCount(tabA)).toBe(1);
  expect(await registroCount(tabB)).toBe(1);
  expect(paidA.total).toBe("4.50"); // 3 × 1.50, the locked price — never re-priced
  expect(paidB.total).toBe("7.50"); // (4 + 1) × 1.50
  // (Reuse `registroCount`/`saleCount` from working-order.rls.test.ts's helpers.)
});
```

- [ ] **Step 6: The H2 grep receipt (no fiscal file changed).** Run and paste the output into the PR description / a comment:

```bash
git diff --name-only main...HEAD | grep -E 'record-sale|fiscal-verifactu/src/backend|registros' || echo "NO fiscal-core file touched — H2 holds"
```

Expected: `NO fiscal-core file touched — H2 holds`. Transfer changes only `apps/server/src/{working-order,errors,till-api}.ts` and tests.

- [ ] **Step 7: Run the suite** (Docker required; set `TESTCONTAINERS_RYUK_DISABLED=true` locally).

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test transfer-lines.rls
```

Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add apps/server/src/transfer-lines.rls.test.ts
git commit -s -m "test(server): real-PG deadlock-safety + cross-tenant RLS + H2 for transferLines (TS-4)"
```

---

## Task 7: HTTP route `POST /api/tabs/:id/transfer`

**Files:**
- Modify: `apps/server/src/till-api.ts` (import `transferLines`; mount the route; extend `STATUS`)
- Test: `apps/server/src/till-api.transfer.test.ts` (created here)

**Interfaces:**
- Consumes: `transferLines`, `isUuid`, `requireSession`, `run`, `withTenant`/`asAppUser`, `AppError`, the `STATUS` map.
- Produces: `POST /api/tabs/:id/transfer` — `:id` = `fromTabId`, body `{ toTabId: string; transfers: { lineNo: number; quantity?: string }[] }`. UUID params screened (`tab.not_open` → 4xx); session-gated; 200 empty body on success.

- [ ] **Step 1: Write the failing route tests.** Create `apps/server/src/till-api.transfer.test.ts` modelled on the existing `till-api.test.ts` (build the Hono app via `mountTillApi`, seed a venue + two tabs, log in for a session cookie). Cover: happy-path 200 (a line moves); malformed `:id` → 4xx `tab.not_open`; malformed `toTabId` → 4xx `tab.not_open`; unauthenticated → 401 `session.required`; `tab.transfer_self` → 400; `tab.transfer_quantity_invalid` → 400.

```typescript
it("POST /api/tabs/:id/transfer moves a line and answers 200", async () => {
  const { app, cfg, tabA, tabB, cafeId, cookie } = await setupTabsApp();
  const res = await app.request(`/api/tabs/${tabA}/transfer`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ toTabId: tabB, transfers: [{ lineNo: 1, quantity: "1" }] }),
  });
  expect(res.status).toBe(200);
  // café split: 1 unit now on tabB (owner read helper), source reduced.
});

it("rejects a malformed :id with 4xx (tab.not_open), no 500", async () => {
  const { app, tabB, cookie } = await setupTabsApp();
  const res = await app.request(`/api/tabs/not-a-uuid/transfer`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ toTabId: tabB, transfers: [{ lineNo: 1 }] }),
  });
  expect(res.status).toBe(409); // STATUS["tab.not_open"]
});

it("rejects a malformed toTabId with 4xx (tab.not_open)", async () => {
  const { app, tabA, cookie } = await setupTabsApp();
  const res = await app.request(`/api/tabs/${tabA}/transfer`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ toTabId: "nope", transfers: [{ lineNo: 1 }] }),
  });
  expect(res.status).toBe(409);
});

it("401s an unauthenticated transfer (session.required) before any work", async () => {
  const { app, tabA, tabB } = await setupTabsApp();
  const res = await app.request(`/api/tabs/${tabA}/transfer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ toTabId: tabB, transfers: [{ lineNo: 1 }] }),
  });
  expect(res.status).toBe(401);
});
```

- [ ] **Step 2: Run to verify it fails.** `pnpm --filter @waitron/server test till-api.transfer`. Expected: FAIL — the route 404s (not mounted).

- [ ] **Step 3: Import `transferLines` into `till-api.ts`.** Add it to the existing `./working-order.js` import list (which already imports `parkOrder`, `placeOrder`, etc.).

- [ ] **Step 4: Extend the `STATUS` map.** Add the two new codes (the reused `tab.not_open` → 409 and `tab.line_not_found` → 404 are already there from TS-1/TS-3):

```typescript
  "tab.transfer_self": 400,
  "tab.transfer_quantity_invalid": 400,
```

- [ ] **Step 5: Mount the route.** Add inside `mountTillApi`, beside the other tab routes:

```typescript
  // Move SELECTED items — whole lines or PART of a line — from one open tab to another (TS-4, design
  // §3a). `:id` is the SOURCE tab; the body carries the destination and the line selection. SESSION-
  // GUARDED. Both ids are `isUuid`-screened BEFORE any query — a malformed one passed into
  // `eq(workingOrders.id, …)` would 22P02 → an opaque 500, so it is refused as `tab.not_open` (the SAME
  // fail-closed code an absent/closed/foreign tab gets). `transferLines` is tx-level, so this route
  // opens the `withTenant`/`asAppUser` transaction around it. Returns 200 with an empty body; the till
  // re-reads the two tabs' state.
  app.post("/api/tabs/:id/transfer", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const fromTabId = c.req.param("id");
      if (!isUuid(fromTabId)) {
        throw new AppError("tab.not_open", { tabId: fromTabId });
      }
      const body = await c.req.json<{ toTabId: string; transfers: { lineNo: number; quantity?: string }[] }>();
      if (!isUuid(body.toTabId)) {
        throw new AppError("tab.not_open", { tabId: body.toTabId });
      }
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await transferLines(tx, deps.cfg, fromTabId, body.toTabId, body.transfers);
      });
      return c.body(null, 200);
    }),
  );
```

- [ ] **Step 6: Run to verify pass.** `pnpm --filter @waitron/server test till-api.transfer`. Expected: PASS.

- [ ] **Step 7: Full package gate (coverage + cross-cutting guards).**

```bash
pnpm --filter @waitron/server test:coverage
```

Expected: PASS at 98/98/98/95. If `transferLines`/`grossLineTotal` show uncovered branches, the PGlite guard tests (Task 5) cover the guards and the route tests cover the `isUuid` screens — add the missing case rather than lowering the threshold.

- [ ] **Step 8: Commit.**

```bash
git add apps/server/src/till-api.ts apps/server/src/till-api.transfer.test.ts
git commit -s -m "feat(server): POST /api/tabs/:id/transfer route (TS-4)"
```

---

## Self-Review (run against the spec)

**1. Spec coverage:**
- §1 scope — `transferLines(fromTabId, toTabId, transfers)` + HTTP route → Tasks 2–5, 7. ✅
- §3 whole-line via `moveTabLines` → Task 2 (subset confirmed in Task 1). ✅
- §3 partial split (source qty − transferred, `line_total` recomputed; new destination line at the same locked `unit_price`/`unit_price_gross`, `quantity = transferred`) → Task 3. ✅
- §3 invariants: quantity conserved (Task 3 assertions), never re-priced (Task 3 price-lock), `line_total` derived via the shared money math (`grossLineTotal`, `pricing.ts:130`), weighed lines split identically (Task 3 weighed) → Task 3. ✅
- §3 full quantity == whole-line move, no zero remnant → Task 4. ✅
- §3 guards `tab.transfer_self`/`tab.transfer_quantity_invalid`/`tab.line_not_found`/`tab.not_open` → Tasks 2, 5. ✅
- §3 ascending-id `FOR UPDATE` lock order → Task 2 (`.sort()` + `lockOpenTab`), proven by deletion in Task 6. ✅
- §3 emptying a tab leaves it `open` — inherent: transfer never changes `working_orders.status`; the whole-line move of every line leaves the (empty) source tab `open`. *Coverage note: add a one-line assertion to Task 2/3 that the source tab's `status` stays `open` after moving all its lines, if a reviewer wants it pinned explicitly.*
- §3a HTTP route, `isUuid`, `requireSession` → Task 7. ✅
- §4 fiscal safety (per-tab single sale, grep receipt, conservation + price-lock tests) → Tasks 3, 6. ✅
- §6 testing (PGlite verb logic; real-PG concurrent + cross-tenant RLS prove-by-deletion) → Tasks 1–6. ✅
- §5 conventions (English identifiers; domain codes; no bwc) → Global Constraints + Tasks 2, 5. ✅

**2. Placeholder scan:** No `TBD`/`TODO`/"handle edge cases"; every code step carries actual code. The two real-PG steps (RLS `set local role` spelling; the `registroCount`/`saleCount` helpers) point at the exact existing file+lines to copy rather than inventing a divergent shape — deliberate, since the repo's harness owns that spelling and re-inventing it is the §1 defect class.

**3. Type consistency:** `transferLines(tx, cfg, fromTabId, toTabId, transfers)` — signature identical across Tasks 2–7. `grossLineTotal(unitPriceGross, quantity)` — same two args everywhere. Error params consistent: `tab.transfer_self { tabId }`, `tab.transfer_quantity_invalid { tabId, lineNo, quantity }`, reused `tab.not_open { tabId }` / `tab.line_not_found { tabId, lineNo }`. `moveTabLines(tx, fromTabId, toTabId, lineNos?)` used exactly as TS-3 exposes it. Money helpers imported once (Task 2) and reused.

Fixes applied inline: Task 5's partition loop is stated to REPLACE Task 3/4's loop (not stack on it), so `byLineNo.get(t.lineNo)!` is not left beside the `=== undefined` guard.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-17-table-service-ts4-transfer-items.md`. It **assumes TS-3 and TS-1 have landed** (the consumed items at the top) — confirm `moveTabLines` and `lockOpenTab` exist in `apps/server/src/working-order.ts` before starting Task 2. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks.
2. **Inline Execution** — execute tasks in this session with checkpoints.
