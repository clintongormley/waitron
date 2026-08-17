# Table Service TS-5 (Split-Bill) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spin selected items/quantities off an open tab into a new, **separately-filing check** (`splitOffCheck`), and detach a joined table into its own bill or free it (`unjoinTable`) — each check/tab paid by the **existing, unchanged** `payWorkingOrder → recordSale` path, so one tab becomes N independent legal invoices with no change to the immutable fiscal core.

**Architecture:** A "check" is an ordinary `open` `working_orders` row carrying allocated `working_order_lines` — created lineless via TS-1's `createOpenOrder` (inheriting the origin's `node_id`/`till_id`, and the series at pay via `cfg.seriesId`), then filled by TS-4's whole/partial line-move. A check is **NOT** table-anchored (no `dining_tables.tab_id` points at it — it is a payment unit); an **un-joined** table's new tab **IS** anchored (its `tab_id` repoints to the new order). Both verbs live in `apps/server/src/working-order.ts` beside the TS-1/TS-3/TS-4 tab verbs, take a caller-supplied `tx`, and are wrapped in `withTenant`/`asAppUser` by the HTTP layer (`till-api.ts`). **No new schema or migration.** Paying each check reuses `payWorkingOrder` verbatim; the `UNIQUE (tenant_id, working_order_id)` sale-idempotency key (#61) makes each check file **at most one** sale.

**Tech Stack:** TypeScript (ESM, Node), Drizzle ORM (PostgreSQL 18), Hono HTTP, Vitest, PGlite (hermetic verb logic) + Testcontainers (real Postgres for the fiscal proofs, RLS, and the app-role filing), pnpm workspace. Fiscal filing via `@waitron/core`'s `recordSale` + `@waitron/fiscal-verifactu`'s `VerifactuBackend`.

**Spec:** docs/superpowers/specs/2026-08-17-table-service-ts5-split-bill-design.md

**Depends on:** TS-4 landed (`transferLines`/`moveTabLines` whole-and-partial line-move), TS-3, TS-1 — **and TS-2** (the `dining_tables.status_id` column `unjoinTable` clears). TS-5 is the fifth and final table-service *core* slice and runs SUPERVISED, so those four slices are on `main` before this executes. **Consumed interfaces** (implemented by earlier slices — TS-5 reuses, never redeclares, them; when a reused symbol's exact param/return shape differs from what is shown below, follow the **landed** TS-1/TS-3/TS-4 declaration, which the executor can read directly):

- `createOpenOrder(tx, cfg, id, lines, label) → { orderNumber; priced }` — **TS-1** (`working-order.ts:252`), generalized by TS-1 so an **empty** `lines` array inserts **no** `working_order_lines` (`if (lineRows.length > 0)` guard) — this is what lets TS-5 create a **lineless** check/tab. Allocates the per-node `order_number` and stamps `node_id`/`till_id` from `cfg`.
- `transferLines(tx, cfg, fromTabId, toTabId, transfers) → void` — **TS-4**, `transfers: { lineNo: number; quantity?: string }[]` (omit `quantity` ⇒ whole line; `0 < quantity < line.quantity` ⇒ split). Locks both orders `FOR UPDATE` in ascending id order, keeps each moved unit's **locked** `unit_price_gross` (no catalogue re-look-up), conserves quantity, and appends at the destination's next `line_no`. Whole-line moves delegate to TS-3's `moveTabLines`. Throws `tab.not_open`, `tab.transfer_self`, `tab.transfer_quantity_invalid`, `tab.line_not_found`.
- `openTab(tx, cfg, { tableId, lines? }) → { tabId; orderNumber }` — **TS-1** (test fixtures only).
- `addTabRound(tx, cfg, tabId, lines) → void` — **TS-1** (test fixtures only — append a round without re-pricing).
- `joinTable(tx, cfg, tabId, tableId) → void` — **TS-3** (test fixtures for the `unjoinTable` join case).
- `abandonHeldOrder(deps, cfg, id) → void` — **pre-existing** (`working-order.ts:537`) — abandons an emptied origin tab in the fiscal proof.
- `payWorkingOrder(deps, cfg, req, operatorId?) → TillSaleResult` — **pre-existing** (`till-sale.ts:253`); `req: { id; tender; lines }`. A check is a RETRIEVED order, so `req.lines` is ignored and it files from the stored locked lines. **No new pay verb.**
- `recordSale(...)` — **@waitron/core** (`packages/core/src/record-sale.ts`) — **UNCHANGED** (H2). Reads no tab/table/check membership; writes `sales.working_order_id` = the check id (the idempotency key).
- `diningTables` (incl. `tab_id`) — **TS-1**; `diningTables.status_id` — **TS-2** (cleared on detach).
- Error codes `tab.not_open`, `tab.transfer_quantity_invalid`, `tab.line_not_found` — **TS-1/TS-3/TS-4** (reused, not redeclared).

**New in TS-5:** `splitOffCheck` (Task 1), `unjoinTable` (Task 5), the error code `table.not_joined` (Task 5), and two HTTP routes (Task 8).

## Global Constraints

- **Coverage thresholds 98/98/98/95** (statements/lines/functions/branches) for `apps/server`. CI shards run `test:coverage`, not `test` — verify green with `pnpm --filter @waitron/server test:coverage` (CLAUDE.md §2), and run the package **unfiltered** so its cross-cutting guard suites load (CLAUDE.md §2's filtered-run trap).
- **NO new migration / NO new schema.** A check is an ordinary `working_orders` row; `unjoinTable` only repoints `dining_tables.tab_id`/`status_id` and moves existing `working_order_lines`. If your diff adds a `packages/db/drizzle/*.sql` or a schema column, you have left the spec (design §2).
- **English identifiers.** No new `SPANISH_WORDS` tokens (`packages/db/src/english-only.ts`). `check`, `split`, `unjoin`, `transfers` are English.
- **Domain-named error codes, never renamed once shipped** (CLAUDE.md §3). New: `table.not_joined` (un-join a table that isn't part of the tab), declared in `apps/server/src/errors.ts` with `import "./errors.js"` present in the throwing file. Reuse `tab.not_open`, `tab.transfer_quantity_invalid`, `tab.line_not_found` — do **not** mint `check.*` or `split.*` siblings. Before adding `table.not_joined`, grep the existing `table.*` family for the param convention (`{ tableId, ... }`) and match it. The root `errors-reachable` guard covers `packages/*` barrels, NOT `apps/*` — keep the `import` present.
- **H2 — the immutable core is NEVER edited; pay reuses `recordSale` UNCHANGED; TS-5 only multiplies filings.** `computeHuella`/`buildCadena` (`packages/verifactu/src/huella.ts`), the hash chain (`packages/fiscal-verifactu/src/chain.ts`), invoice numbering (`allocateInvoiceNumber`), the alta builders (`packages/fiscal-verifactu/src/backend.ts`, `registro-row.ts`, `@waitron/verifactu`'s `buildAltaRecord`) and `packages/core/src/record-sale.ts` are **not modified**. Grep-proven in Task 6. Each check files its OWN normal sale; nothing about "this was a split" reaches the filed record.
- **Every fiscal claim is PROVEN on REAL Postgres, never reasoned from** (CLAUDE.md §1/§5). PGlite runs every connection as a superuser (bypasses RLS) and serialises onto one backend, so it **cannot** show the app-role filing or the real chained `registros_facturacion`. The registro-count, per-check desglose, contiguous-invoice-number, conservation and idempotency proofs run under `asAppUser` on Testcontainers (mirror `apps/server/src/till-sale.test.ts`). **This is the one table-service slice that creates fiscal records — an assertion you reasoned rather than ran is exactly the §1 defect class.** Note `TESTCONTAINERS_RYUK_DISABLED=true` locally (CLAUDE.md §4).
- **Do NOT hand-compute the per-check base/tax cents.** The exact difference-method desglose is what `priceLockedLines` computes; the load-bearing assertions are STRUCTURAL (exact registro count, rates present, `Σ(base+tax) == total`, contiguous numbers, quantity conservation). Where a task shows indicative cents, they are marked **[verify on the RED run]** — take the actual values from the failing run's output and lock them in; never trust a cent value printed in this plan (§1).
- **Prove every guard by deletion.** Remove the check (the `tab.not_open` read, the `table.not_joined` read, the RLS predicate, the `working_order_id` idempotency reliance), confirm the test fails, restore it. A test that still passes with the guard removed is not testing the guard (CLAUDE.md §4).
- **`git commit -s`** on every commit (DCO). **No backwards-compat / data-migration code** (pre-production).

---

## File Structure

**Created:**
- `apps/server/src/split-bill.test.ts` — PGlite verb logic. Task 1 creates it with `splitOffCheck` cases (a detached, table-less check with the moved items; whole-and-partial moves; the `tab.not_open` + inherited TS-4 guards); Task 5 appends the `unjoinTable` cases (re-anchored new tab with items vs freed + status-cleared without; `table.not_joined` / `tab.not_open`). One responsibility: the fast hermetic verb behaviour.
- `apps/server/src/split-bill.fiscal.test.ts` — **real Postgres** fiscal proofs (Tasks 2–4): mixed-VAT tab → 3 checks → pay all ⇒ exactly 3 `registros_facturacion`, each desglose = its own items, invoice numbers contiguous; partition + quantity conservation across the 4 working orders; sale-idempotency replay; cross-tenant RLS (prove-by-deletion). Mirrors `till-sale.test.ts`'s `useRealPostgres` + `applyVenue` + `VerifactuBackend` fixture.
- `apps/server/src/till-api.split-bill.test.ts` — the two new HTTP routes (session-guard, `isUuid` 4xx, `STATUS` mapping, happy path).

**Modified:**
- `apps/server/src/working-order.ts` — add `splitOffCheck` (Task 1) and `unjoinTable` (Task 5) beside the TS-1/TS-3/TS-4 tab verbs (`import "./errors.js"` already present from those slices; add `diningTables`/`workingOrders`/`transferLines` to the existing imports if not already imported, and reuse the top-of-file `randomUUID` import TS-1 added).
- `apps/server/src/errors.ts` — declare `table.not_joined` (Task 5).
- `apps/server/src/till-api.ts` — mount `POST /api/tabs/:id/split` and `POST /api/tabs/:id/unjoin`; add `table.not_joined` to the `STATUS` map (the `tab.*` codes are already mapped by TS-1/TS-3/TS-4) (Task 8).

---

## Task 1: `splitOffCheck` — create the detached check + move items (PGlite verb logic)

**Files:**
- Modify: `apps/server/src/working-order.ts` (add `splitOffCheck`)
- Test: `apps/server/src/split-bill.test.ts` (create)

**Interfaces:**
- Consumes: `createOpenOrder`, `transferLines`, `openTab` (all from earlier slices — see **Depends on**); `diningTables`, `workingOrders`, `workingOrderLines` (`@waitron/db`); `randomUUID` (TS-1 added the import); `AppError`, `asAppUser`, `withTenant`, `eq` (already imported in `working-order.ts`).
- Produces: `splitOffCheck(tx: Transaction, cfg: TillConfig, fromTabId: string, transfers: { lineNo: number; quantity?: string }[]) → Promise<{ checkId: string }>` — creates a new `open` working order (a **check**, **no** `dining_tables.tab_id` points at it), moves `transfers` (whole or partial, TS-4) from the origin onto it, returns the minted `checkId`. Throws `tab.not_open` (origin not an open tab) + the inherited TS-4 move errors (`tab.transfer_quantity_invalid`, `tab.line_not_found`).

- [ ] **Step 1: Write the failing `splitOffCheck` tests.** Create `apps/server/src/split-bill.test.ts`. Use PGlite (verb logic only — no filing, no RLS: a check is table-less/detached, all provable on one backend; the fiscal filing is Tasks 2–4's real-PG job, noted in a comment). Mirror the fixture shape of `apps/server/src/tabs.test.ts` (TS-1) — a `setupVenue` seeding two products (an `each` at 21% and a `weight` at 10%) plus dining tables, and an `asApp(cfg, fn)` helper wrapping `withTenant`+`asAppUser`. **If a shared PGlite tab-verb fixture already exists from TS-1/TS-3/TS-4** (e.g. an exported `setupVenue`/`asApp`), import and reuse it rather than copy it (DRY).

```typescript
import { describe, expect, it } from "vitest";
import { diningTables, workingOrders, workingOrderLines } from "@waitron/db";
import { eq } from "drizzle-orm";
// setupVenue seeds: an `each` product `aguaId` (1.50 gross, general/21%) and a `weight` product
// `jamonId` (24.90 €/kg gross, reduced/10%), plus dining tables `tableId`/`tableId2`; returns
// { cfg, aguaId, jamonId, tableId, tableId2 } and an `asApp(cfg, fn)` helper (the TS-1 tabs.test.ts
// shape). Reuse the landed helper if TS-1/TS-3/TS-4 exported one; otherwise build it here.
import { asApp, setupVenue } from "./testing/split-bill-fixture.js";
import { openTab, splitOffCheck } from "./working-order.js";

// PGlite is enough HERE: the check being table-less and the line partition are plain row state a single
// backend proves. The FISCAL filing (exactly-one-registro per check, desglose, contiguity, RLS) is
// split-bill.fiscal.test.ts's real-Postgres job (CLAUDE.md §4).

describe("splitOffCheck", () => {
  it("spins selected items into a NEW open check that no table points at (detached)", async () => {
    const { cfg, aguaId, jamonId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, {
        tableId,
        lines: [{ productId: aguaId, quantity: "3" }, { productId: jamonId, quantity: "0.300" }],
      }),
    );

    // Move 1 of the 3 aguas (partial split of line 1) + the whole jamón (line 2) onto a check.
    const { checkId } = await asApp(cfg, (tx) =>
      splitOffCheck(tx, cfg, tabId, [{ lineNo: 1, quantity: "1" }, { lineNo: 2 }]),
    );

    const state = await asApp(cfg, async (tx) => {
      const [check] = await tx
        .select({ status: workingOrders.status, nodeId: workingOrders.nodeId, tillId: workingOrders.tillId })
        .from(workingOrders)
        .where(eq(workingOrders.id, checkId));
      const checkLines = await tx
        .select({ productId: workingOrderLines.productId, quantity: workingOrderLines.quantity })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, checkId))
        .orderBy(workingOrderLines.lineNo);
      const originLines = await tx
        .select({ lineNo: workingOrderLines.lineNo, productId: workingOrderLines.productId, quantity: workingOrderLines.quantity })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo);
      const anchoring = await tx
        .select({ id: diningTables.id })
        .from(diningTables)
        .where(eq(diningTables.tabId, checkId));
      return { check, checkLines, originLines, anchoring };
    });

    expect(state.check?.status).toBe("open");
    // Inherits the origin's node/till (createOpenOrder stamps them from cfg).
    expect(state.check?.nodeId).toBe(cfg.nodeId);
    expect(state.check?.tillId).toBe(cfg.tillId);
    // A check is a payment unit, NOT a seat: no dining_tables row points at it (design §2).
    expect(state.anchoring).toEqual([]);
    // The check holds the moved items…
    expect(state.checkLines).toEqual([
      { productId: aguaId, quantity: "1.000" },
      { productId: jamonId, quantity: "0.300" },
    ]);
    // …and the origin holds only the remainder (quantity conserved: 3 − 1 = 2 aguas; jamón moved whole).
    expect(state.originLines).toEqual([{ lineNo: 1, productId: aguaId, quantity: "2.000" }]);
  });

  it("refuses to split off a check from a non-open tab (tab.not_open)", async () => {
    const { cfg } = await setupVenue();
    const MISSING = "00000000-0000-0000-0000-000000000000";
    await expect(asApp(cfg, (tx) => splitOffCheck(tx, cfg, MISSING, [{ lineNo: 1 }]))).rejects.toMatchObject({
      code: "tab.not_open",
    });
  });

  it("inherits TS-4's move guards (tab.transfer_quantity_invalid, tab.line_not_found)", async () => {
    const { cfg, aguaId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: aguaId, quantity: "2" }] }),
    );
    await expect(
      asApp(cfg, (tx) => splitOffCheck(tx, cfg, tabId, [{ lineNo: 1, quantity: "5" }])),
    ).rejects.toMatchObject({ code: "tab.transfer_quantity_invalid" });
    await expect(
      asApp(cfg, (tx) => splitOffCheck(tx, cfg, tabId, [{ lineNo: 99 }])),
    ).rejects.toMatchObject({ code: "tab.line_not_found" });
  });
});
```

(`asApp(cfg, fn)` is the fixture's `withTenant(db, cfg.tenantId, tx => { await asAppUser(tx); return fn(tx); })` helper — reuse the landed one; if writing it fresh, obtain `db` from `createPgliteDb`/`runMigrations` per the TS-1 fixture.)

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm --filter @waitron/server test split-bill.test`
Expected: FAIL — `splitOffCheck is not a function`.

- [ ] **Step 3: Implement `splitOffCheck`.** In `apps/server/src/working-order.ts`, add beside the TS-4 `transferLines` verb (import `transferLines` from its module if it lives elsewhere; `randomUUID`, `AppError`, `workingOrders`, `eq` are already in scope from TS-1):

```typescript
/**
 * Spin selected items off an OPEN tab into a NEW, separately-filing CHECK (split-bill, TS-5). A check
 * is an ordinary `open` working order — created lineless via `createOpenOrder` (inheriting the origin's
 * node/till and, at pay, `cfg.seriesId`) — that NO table points at: it is a payment unit, not a seat
 * (design §2), so unlike a tab there is no `dining_tables.tab_id` back-pointer to set. The items are
 * carried over by TS-4's whole/partial line-move, which keeps each unit's LOCKED `unit_price_gross`
 * (no catalogue re-look-up) and CONSERVES quantity, so the check and the origin remainder each stay
 * internally consistent and each files its OWN correct desglose on its own pay (design §4).
 *
 * Pay the check with the EXISTING `payWorkingOrder` (till-sale.ts) — there is NO new pay verb, and the
 * `sales_working_order_id_key` UNIQUE (tenant_id, working_order_id) makes it file AT MOST ONE sale.
 * Called once per check; the origin holds the remainder (emptied ⇒ abandon it with the existing
 * `abandonHeldOrder`, or pay it as the last check — design §3). Runs on the CALLER's tx/tenant scope.
 */
export async function splitOffCheck(
  tx: Transaction,
  cfg: TillConfig,
  fromTabId: string,
  transfers: { lineNo: number; quantity?: string }[],
): Promise<{ checkId: string }> {
  // Lock + validate the origin is an OPEN tab before minting anything (a fresh order number for a
  // check that would roll back is wasteful; and this is the `tab.not_open` guard design §3 names). The
  // FOR UPDATE also serialises a concurrent carve-off of the same tab (TS-3/TS-4 lock discipline).
  const [origin] = await tx
    .select({ status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, fromTabId))
    .for("update");
  if (origin?.status !== "open") {
    throw new AppError("tab.not_open", { tabId: fromTabId });
  }

  // Mint + create the DETACHED check: a lineless `open` working order (createOpenOrder's empty-lines
  // guard, TS-1), with NO `dining_tables.tab_id` pointing at it. It inherits node/till from `cfg`.
  const checkId = randomUUID();
  await createOpenOrder(tx, cfg, checkId, [], null);

  // Move the selected items (whole lines + partial splits) onto the check — TS-4's `transferLines`,
  // which re-locks both orders FOR UPDATE (ascending id; re-entrant on this same tx), keeps the locked
  // gross, conserves quantity, and raises the inherited `tab.transfer_quantity_invalid`/
  // `tab.line_not_found` guards. A failure here rolls back the whole tx, check included — no orphan.
  await transferLines(tx, cfg, fromTabId, checkId, transfers);

  return { checkId };
}
```

(Reused error-code param shapes follow the **landed** declaration: if TS-1 declared `tab.not_open` with `{ workingOrderId }` rather than `{ tabId }`, use that — read `apps/server/src/errors.ts`.)

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `pnpm --filter @waitron/server test split-bill.test`
Expected: PASS.

- [ ] **Step 5: Prove the `tab.not_open` guard by deletion.** Temporarily change the guard to `if (false)`, re-run, and confirm the "refuses … non-open tab" case now FAILS (it proceeds to `createOpenOrder`/`transferLines` on a missing origin and throws something other than `tab.not_open`, or creates a stray check). Restore the guard; confirm green.

- [ ] **Step 6: Commit.**

```bash
git add apps/server/src/working-order.ts apps/server/src/split-bill.test.ts
git commit -s -m "feat(table-service): splitOffCheck — detached separately-filing check (TS-5)"
```

---

## Task 2: Pay each check — the fiscal proof (real Postgres): exactly 3 `registros`, per-check desglose, contiguous invoice numbers

**Purpose:** Paying a check needs **no new code** — it is the existing `payWorkingOrder`. This task PROVES that a three-way split of a mixed-VAT tab, each check paid via `payWorkingOrder`, files **exactly three** independent, correct legal invoices. It is the spec §4 / §6 test bar, on real Postgres under the app role (CLAUDE.md §5).

**Files:**
- Test: `apps/server/src/split-bill.fiscal.test.ts` (create)

**Interfaces:**
- Consumes: `splitOffCheck` (Task 1); `openTab` (TS-1); `payWorkingOrder`, `TillSaleResult` (`till-sale.ts`); `VerifactuBackend`, `registrosFacturacion` (`@waitron/fiscal-verifactu`); `applyVenue`/`planVenue` (`@waitron/provisioning`); `useRealPostgres`, `asAppUser`, `withTenant`, `sales` (`@waitron/db`). Mirror the fixture in `apps/server/src/till-sale.test.ts` in shape (its `systemClock`, `nextNif`, `tillConfigFromVenue`, `setupVenue`, `beforeAll` backend wiring), extended to seed **one dining table** and return an `asApp` helper.
- Produces: nothing consumed downstream — proofs only.

- [ ] **Step 1: Write the failing fiscal proof.** Create `apps/server/src/split-bill.fiscal.test.ts`. Copy the `till-sale.test.ts` fixture scaffolding (real Postgres via `useRealPostgres({ start: startRealPostgres, timeoutMs: 180_000 })`, a fresh chained venue + registered SIF **per test** so the `registros_facturacion` count is that test's alone, the two-product catalogue: `agua` 1.50 gross general/21%, `jamón` 24.90 €/kg gross reduced/10%, plus one dining table). Then:

```typescript
// Real Postgres, NOT PGlite: the whole point is genuine chained fiscal records written by the app
// role under RLS — PGlite bypasses RLS and cannot prove the deployment role files them (CLAUDE.md §4).
// Each test gets its OWN tenant, so the registros_facturacion count is order-independent.

// Small helper: pay a check and return its parsed invoice sequence number (the N in "A/N").
function seqOf(result: TillSaleResult): number {
  const m = /^A\/(\d+)$/.exec(result.invoiceNumber);
  if (m === null) throw new Error(`unexpected invoice number ${result.invoiceNumber}`);
  return Number(m[1]);
}

describe("split-bill: pay each check files its own registro", () => {
  it("splits a mixed-VAT tab into 3 checks; paying all files EXACTLY 3 registros with contiguous numbers", async () => {
    const { cfg, aguaId, jamonId, tableId } = await setupVenue();
    const deps = { db: suite.admin, backend, clock };

    // Origin tab: 3× agua (21%), 0.300 kg jamón (10%) — a mixed-VAT bill on one table.
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, {
        tableId,
        lines: [{ productId: aguaId, quantity: "3" }, { productId: jamonId, quantity: "0.300" }],
      }),
    );

    // Carve into 3 checks (design §3 "the 4 working orders = 3 checks + emptied origin"):
    //   A = 1 agua (partial split of line 1) + the whole jamón (line 2) — MIXED VAT
    //   B = 1 agua ; C = 1 agua (line 1 emptied on the last, whole move)
    const { checkId: a } = await asApp(cfg, (tx) =>
      splitOffCheck(tx, cfg, tabId, [{ lineNo: 1, quantity: "1" }, { lineNo: 2 }]),
    );
    const { checkId: b } = await asApp(cfg, (tx) =>
      splitOffCheck(tx, cfg, tabId, [{ lineNo: 1, quantity: "1" }]),
    );
    const { checkId: c } = await asApp(cfg, (tx) => splitOffCheck(tx, cfg, tabId, [{ lineNo: 1 }]));

    // Pay all three via the EXISTING payWorkingOrder (no new verb). A check is a retrieved order, so
    // req.lines is ignored — it files from its stored locked lines.
    const rA = await payWorkingOrder(deps, cfg, { id: a, tender: { method: "cash", amount: "10.00" }, lines: [] });
    const rB = await payWorkingOrder(deps, cfg, { id: b, tender: { method: "cash", amount: "2.00" }, lines: [] });
    const rC = await payWorkingOrder(deps, cfg, { id: c, tender: { method: "cash", amount: "2.00" }, lines: [] });

    // (1) EXACTLY THREE registros_facturacion for this tenant — one per check, none from the origin.
    const rows = await asApp(cfg, (tx) => tx.select().from(registrosFacturacion));
    expect(rows.length).toBe(3);

    // (2) Contiguous invoice numbers from the tab's series (fresh series ⇒ 1,2,3 in pay order).
    const seqs = [seqOf(rA), seqOf(rB), seqOf(rC)].sort((x, y) => x - y);
    expect(seqs).toEqual([seqs[0], seqs[0]! + 1, seqs[0]! + 2]);
    expect(rA.invoiceNumber).toMatch(/^A\/\d+$/);

    // (3) Per-check TOTALS = the gross sum of that check's OWN items (the retail line totals).
    expect(rA.total).toBe("8.97"); // 1×1.50 + round(0.300×24.90)=7.47
    expect(rB.total).toBe("1.50");
    expect(rC.total).toBe("1.50");

    // (4) Coherent per-check DESGLOSE — each invoice's breakdown corresponds to its OWN items:
    //   - A carries BOTH rates (21% agua + 10% jamón); B and C carry only 21%.
    //   - Each check's Σ(base+tax) == its own total (self-consistent, no aggregate bill to reconcile —
    //     a per-check cent of difference-method rounding is not an error, design §4).
    // The exact base/tax cents are the difference-method figures priceLockedLines computes — do NOT
    // hand-derive them; the values below are INDICATIVE [verify on the RED run] and MUST be replaced by
    // the actual values the failing run prints (CLAUDE.md §1). The load-bearing checks are the RATE SET
    // and the Σ==total identity.
    expect(new Set(rA.vatBreakdown.map((v) => v.rate))).toEqual(new Set(["21.00", "10.00"]));
    expect(new Set(rB.vatBreakdown.map((v) => v.rate))).toEqual(new Set(["21.00"]));
    expect(new Set(rC.vatBreakdown.map((v) => v.rate))).toEqual(new Set(["21.00"]));
    for (const r of [rA, rB, rC]) {
      const sum = r.vatBreakdown.reduce((acc, v) => acc + Number(v.base) + Number(v.tax), 0);
      expect(sum.toFixed(2)).toBe(r.total);
    }
    // Indicative exact desgloses [verify on the RED run — replace with the actual printed values]:
    expect(rA.vatBreakdown).toEqual([
      { rate: "21.00", base: "1.24", tax: "0.26" }, // 1 agua
      { rate: "10.00", base: "6.79", tax: "0.68" }, // 0.300 kg jamón
    ]);
    expect(rB.vatBreakdown).toEqual([{ rate: "21.00", base: "1.24", tax: "0.26" }]);
    expect(rC.vatBreakdown).toEqual([{ rate: "21.00", base: "1.24", tax: "0.26" }]);

    // (5) Each registro is tied to its OWN check via sales.working_order_id (the idempotency key).
    const filedFor = await asApp(cfg, (tx) => tx.select({ workingOrderId: sales.workingOrderId }).from(sales));
    expect(new Set(filedFor.map((s) => s.workingOrderId))).toEqual(new Set([a, b, c]));
  });
});
```

- [ ] **Step 2: Run the proof; read the ACTUAL desglose off the failing run.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test split-bill.fiscal.test`
Expected: the structural assertions (count `=== 3`, rate sets, `Σ==total`, contiguity, `working_order_id` set) PASS on the first green; the indicative `toEqual` desgloses may FAIL. **Read the printed `Received` desgloses**, confirm each is the difference-method split of that check's own gross (each `base+tax` sums to the line's gross), and replace the indicative literals with the actual values. This is the §1 discipline: the desglose is PROVEN by the real filing, never reasoned from this plan.

- [ ] **Step 3: Re-run to green.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test split-bill.fiscal.test`
Expected: PASS.

- [ ] **Step 4: Prove the "exactly 3" count is load-bearing (negative control).** Temporarily add a fourth `payWorkingOrder` for the **emptied origin** `tabId` — it has zero lines. Confirm it either throws (no lines to file) or, if it files, the count becomes 4 and the test FAILS — establishing that the assertion distinguishes "3 checks filed" from "the origin also filed". REMOVE the fourth pay (the origin must file nothing — it is emptied and abandoned, Task 3). Re-run green; record what you saw in a one-line comment.

- [ ] **Step 5: Commit.**

```bash
git add apps/server/src/split-bill.fiscal.test.ts
git commit -s -m "test(table-service): real-PG proof — 3 checks file exactly 3 registros, per-check desglose, contiguous numbers (TS-5)"
```

---

## Task 3: Partition + conservation — no item double-filed, quantities conserved across the 4 working orders (real Postgres)

**Files:**
- Modify: `apps/server/src/split-bill.fiscal.test.ts` (add a test to the same describe/file)

**Interfaces:**
- Consumes: everything Task 2 consumes, plus `saleLines`, `workingOrderLines` (`@waitron/db`).
- Produces: proofs only.

- [ ] **Step 1: Write the failing partition/conservation proof.** Add to `split-bill.fiscal.test.ts`. Re-use the same 3-check split (extract a `splitIntoThreeChecks(cfg, ...)` helper from Task 2 if it reduces duplication — DRY). After paying A, B, C:

```typescript
it("partitions the items — every unit filed on exactly ONE check, quantity conserved, origin emptied", async () => {
  const { cfg, aguaId, jamonId, tableId } = await setupVenue();
  const deps = { db: suite.admin, backend, clock };
  const { tabId } = await asApp(cfg, (tx) =>
    openTab(tx, cfg, {
      tableId,
      lines: [{ productId: aguaId, quantity: "3" }, { productId: jamonId, quantity: "0.300" }],
    }),
  );
  const { checkId: a } = await asApp(cfg, (tx) =>
    splitOffCheck(tx, cfg, tabId, [{ lineNo: 1, quantity: "1" }, { lineNo: 2 }]),
  );
  const { checkId: b } = await asApp(cfg, (tx) => splitOffCheck(tx, cfg, tabId, [{ lineNo: 1, quantity: "1" }]));
  const { checkId: c } = await asApp(cfg, (tx) => splitOffCheck(tx, cfg, tabId, [{ lineNo: 1 }]));
  await payWorkingOrder(deps, cfg, { id: a, tender: { method: "cash", amount: "10.00" }, lines: [] });
  await payWorkingOrder(deps, cfg, { id: b, tender: { method: "cash", amount: "2.00" }, lines: [] });
  await payWorkingOrder(deps, cfg, { id: c, tender: { method: "cash", amount: "2.00" }, lines: [] });

  const { originLines, filed, filedForOrigin } = await asApp(cfg, async (tx) => {
    // The emptied origin: 0 working_order_lines, and it files NOTHING (never paid → no sales row).
    const originLines = await tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId));
    // All filed sale_lines across the 3 checks, joined via sales.working_order_id. NB: sale_lines
    // SNAPSHOTS values and may carry NO product_id — see the note below; group by vat_rate/descriptions
    // if so. Select the real columns of packages/db/src/schema/sales.ts's `saleLines`.
    const filed = await tx
      .select({ workingOrderId: sales.workingOrderId, vatRate: saleLines.vatRate, quantity: saleLines.quantity })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId));
    const filedForOrigin = await tx
      .select({ id: sales.id })
      .from(sales)
      .where(eq(sales.workingOrderId, tabId));
    return { originLines, filed, filedForOrigin };
  });

  // The origin is emptied and files nothing (design §4 "no double-file; the remainder shares no item").
  expect(originLines).toEqual([]);
  expect(filedForOrigin).toEqual([]);

  // CONSERVATION: summing the filed quantities per RATE across the 3 checks == the original basket.
  const filed21 = filed.filter((f) => f.vatRate === "21.00");
  const filed10 = filed.filter((f) => f.vatRate === "10.00");
  const totalAgua = filed21.reduce((n, f) => n + Number(f.quantity), 0);
  const totalJamon = filed10.reduce((n, f) => n + Number(f.quantity), 0);
  expect(totalAgua).toBe(3); // 1 + 1 + 1, no unit created or destroyed
  expect(totalJamon.toFixed(3)).toBe("0.300"); // moved whole to check A

  // PARTITION: the 10%-rate (jamón) quantity appears on EXACTLY ONE check (no double-file).
  const checksWith10 = new Set(filed10.map((f) => f.workingOrderId));
  expect(checksWith10).toEqual(new Set([a]));
});
```

**Note on `sale_lines` columns:** `saleLines` snapshots values (`descriptions`, `vat_rate`, `quantity`, `line_total`, `category`) and does **not** carry `product_id` (`packages/db/src/schema/sales.ts:217`). Partition by `vat_rate` (the single 10% jamón line vs the three 21% agua lines), as above. Read that schema before writing the select and confirm the column names. The invariant is unchanged: filed 10%-rate quantity `= 0.300` on exactly one check, filed 21% quantity `= 3` split across the three.

- [ ] **Step 2: Run to green.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test split-bill.fiscal.test`
Expected: PASS.

- [ ] **Step 3: Prove conservation is load-bearing (negative control).** Temporarily change one split to move `quantity: "2"` of the aguas onto check B (over-allocating). Confirm `totalAgua` becomes `4` and the test FAILS — proving the sum would catch a double-file / re-price. Restore; re-run green.

- [ ] **Step 4: Commit.**

```bash
git add apps/server/src/split-bill.fiscal.test.ts
git commit -s -m "test(table-service): real-PG proof — items partitioned, quantities conserved, origin emptied files nothing (TS-5)"
```

---

## Task 4: Sale-idempotency replay + cross-tenant RLS (real Postgres)

**Files:**
- Modify: `apps/server/src/split-bill.fiscal.test.ts` (add two tests)

**Interfaces:**
- Consumes: as Tasks 2–3; the RLS-by-deletion mechanism mirrors the sibling `apps/server/src/working-order.rls.test.ts` / `till-api.rls.test.ts`.
- Produces: proofs only.

- [ ] **Step 1: Write the idempotency-replay proof.** Paying a check TWICE must still leave exactly ONE registro (the `UNIQUE (tenant_id, working_order_id)` key, #61, applies to a check as to any working order). Add:

```typescript
it("paying a check twice files exactly ONE registro (sale-idempotency replay)", async () => {
  const { cfg, aguaId, tableId } = await setupVenue();
  const deps = { db: suite.admin, backend, clock };
  const { tabId } = await asApp(cfg, (tx) =>
    openTab(tx, cfg, { tableId, lines: [{ productId: aguaId, quantity: "2" }] }),
  );
  const { checkId } = await asApp(cfg, (tx) => splitOffCheck(tx, cfg, tabId, [{ lineNo: 1, quantity: "1" }]));

  const first = await payWorkingOrder(deps, cfg, { id: checkId, tender: { method: "cash", amount: "2.00" }, lines: [] });
  const second = await payWorkingOrder(deps, cfg, { id: checkId, tender: { method: "cash", amount: "2.00" }, lines: [] });

  // Replay returns the SAME invoice, not a second filing.
  expect(second.invoiceNumber).toBe(first.invoiceNumber);
  expect(second.total).toBe(first.total);

  // Exactly ONE registro is tied to this check.
  const forCheck = await asApp(cfg, (tx) =>
    tx
      .select({ id: registrosFacturacion.id })
      .from(registrosFacturacion)
      .innerJoin(sales, eq(sales.id, registrosFacturacion.saleId))
      .where(eq(sales.workingOrderId, checkId)),
  );
  expect(forCheck.length).toBe(1);
});
```

- [ ] **Step 2: Write the cross-tenant RLS proof (prove-by-deletion).** A split cannot cross a tenant boundary: operating as tenant Y on tenant X's tab, RLS hides X's `working_orders` row, so `splitOffCheck`'s origin read returns nothing → `tab.not_open` (fail-closed). Prove RLS is the guard by the sibling RLS tests' mechanism (a positive control that succeeds for the OWNER, and — mirroring `working-order.rls.test.ts` — a differential that drops/relaxes the `working_orders` tenant-isolation policy and shows the foreign op then reaches the row). Follow the landed sibling's exact prove-by-deletion shape:

```typescript
it("a cross-tenant split is impossible — RLS hides the other tenant's tab (fail-closed)", async () => {
  const owner = await setupVenue(); // tenant X, with an open tab
  const other = await setupVenue(); // tenant Y (its own venue/cfg)
  const { tabId } = await asApp(owner.cfg, (tx) =>
    openTab(tx, owner.cfg, { tableId: owner.tableId, lines: [{ productId: owner.aguaId, quantity: "2" }] }),
  );

  // As tenant Y, X's tabId is RLS-hidden → the origin read finds nothing → tab.not_open.
  await expect(
    withTenant(suite.admin, other.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return splitOffCheck(tx, other.cfg, tabId, [{ lineNo: 1, quantity: "1" }]);
    }),
  ).rejects.toMatchObject({ code: "tab.not_open" });

  // Positive control: the OWNER can split the same tab.
  const { checkId } = await withTenant(suite.admin, owner.cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return splitOffCheck(tx, owner.cfg, tabId, [{ lineNo: 1, quantity: "1" }]);
  });
  expect(checkId).toBeDefined();
});
```

(For the by-deletion half — drop the `working_orders` tenant-isolation policy, show the foreign op then sees the row, restore — copy the exact `DROP POLICY … / CREATE POLICY …` dance the landed `working-order.rls.test.ts` uses; do not invent a new one.)

- [ ] **Step 3: Run to green.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test split-bill.fiscal.test`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add apps/server/src/split-bill.fiscal.test.ts
git commit -s -m "test(table-service): real-PG proof — check pay is idempotent, cross-tenant split RLS-blocked (TS-5)"
```

---

## Task 5: `unjoinTable` — detach a joined table (PGlite verb logic) + `table.not_joined`

**Files:**
- Modify: `apps/server/src/errors.ts` (declare `table.not_joined`)
- Modify: `apps/server/src/working-order.ts` (add `unjoinTable`)
- Test: `apps/server/src/split-bill.test.ts` (append the `unjoinTable` cases from Task 1's file)

**Interfaces:**
- Consumes: `createOpenOrder`, `transferLines`, `openTab`, `joinTable` (earlier slices); `diningTables`, `workingOrders`, `workingOrderLines` (`@waitron/db`); `randomUUID`, `AppError`, `eq`.
- Produces: `unjoinTable(tx: Transaction, cfg: TillConfig, tabId: string, tableId: string, transfers?: { lineNo: number; quantity?: string }[]) → Promise<{ tabId?: string }>` — detach `tableId` from the joined `tabId`. With `transfers`: create a new `open` tab **anchored to `tableId`** and move those items onto it, returning `{ tabId: newTabId }`. Without: free the table (`tab_id → NULL`, `status_id → NULL`), returning `{}`. Throws `table.not_joined` (`tableId.tab_id ≠ tabId`), `tab.not_open` (shared tab not open).

- [ ] **Step 1: Declare the `table.not_joined` error code.** In `apps/server/src/errors.ts`, add inside the `declare module "@waitron/shared" { interface ErrorParams { … } }` block, beside the other `table.*` codes TS-1/TS-3 added (match their param convention — a caller-supplied uuid, echoed, not a secret; `tableId` qualified like the domain-record family):

```typescript
    /**
     * A table this caller tried to UN-JOIN is not part of the named tab — its `tab_id` points at a
     * different open tab, at a settled/abandoned one, or is NULL (a free table), or the id names none
     * at all (absent, or another tenant's table that RLS hides). All report THIS one code, the same
     * fail-closed shape `tab.not_open`/`table.occupied` use: to an operator un-joining a table, "not
     * joined to this tab" and "no such table here" are the same fact, and a distinct code would confirm
     * a foreign/other-tab table exists. Mapped to 409 in the route layer (the id may be valid, but the
     * table's join state forbids the un-join). `tableId`/`tabId` are caller-supplied uuids the till
     * already holds, not secrets. `table.*`, not `server.*`: it is a fact about a table, not the process
     * (the rule `tenant.not_found`'s note gives); destined for `@waitron/core` once a package other than
     * this host throws it, the note the `working_order.*` family carries.
     */
    "table.not_joined": { tableId: string; tabId: string };
```

- [ ] **Step 2: Write the failing `unjoinTable` tests.** Append to `apps/server/src/split-bill.test.ts` (created in Task 1), adding `joinTable` and `unjoinTable` to the `./working-order.js` import:

```typescript
describe("unjoinTable", () => {
  it("with items: anchors a NEW open tab to the detached table and moves the items onto it", async () => {
    const { cfg, aguaId, tableId, tableId2 } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: aguaId, quantity: "2" }] }),
    );
    await asApp(cfg, (tx) => joinTable(tx, cfg, tabId, tableId2)); // both tables now point at tabId

    const { tabId: newTabId } = await asApp(cfg, (tx) =>
      unjoinTable(tx, cfg, tabId, tableId2, [{ lineNo: 1, quantity: "1" }]),
    );

    const state = await asApp(cfg, async (tx) => {
      const [detached] = await tx.select({ tabId: diningTables.tabId }).from(diningTables).where(eq(diningTables.id, tableId2));
      const [stillJoined] = await tx.select({ tabId: diningTables.tabId }).from(diningTables).where(eq(diningTables.id, tableId));
      const [newTab] = await tx.select({ status: workingOrders.status }).from(workingOrders).where(eq(workingOrders.id, newTabId!));
      const newTabLines = await tx
        .select({ productId: workingOrderLines.productId, quantity: workingOrderLines.quantity })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, newTabId!));
      return { detached, stillJoined, newTab, newTabLines };
    });

    expect(newTabId).toBeDefined();
    expect(state.detached?.tabId).toBe(newTabId); // the table now runs its OWN bill (re-anchored)
    expect(state.stillJoined?.tabId).toBe(tabId); // the origin table is unaffected
    expect(state.newTab?.status).toBe("open");
    expect(state.newTabLines).toEqual([{ productId: aguaId, quantity: "1.000" }]);
  });

  it("without items: frees the table (tab_id → NULL) and clears its TS-2 status", async () => {
    const { cfg, aguaId, tableId, tableId2 } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: aguaId, quantity: "1" }] }),
    );
    await asApp(cfg, (tx) => joinTable(tx, cfg, tabId, tableId2));

    const result = await asApp(cfg, (tx) => unjoinTable(tx, cfg, tabId, tableId2));

    const [row] = await asApp(cfg, (tx) =>
      tx.select({ tabId: diningTables.tabId, statusId: diningTables.statusId }).from(diningTables).where(eq(diningTables.id, tableId2)),
    );
    expect(result).toEqual({});
    expect(row?.tabId).toBeNull();
    expect(row?.statusId).toBeNull(); // turnover: the manual TS-2 status clears (design §3, TS-3 pattern)
  });

  it("refuses to un-join a table that isn't part of the tab (table.not_joined)", async () => {
    const { cfg, aguaId, tableId, tableId2 } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: aguaId, quantity: "1" }] }),
    );
    // tableId2 is FREE (never joined) → not part of tabId.
    await expect(asApp(cfg, (tx) => unjoinTable(tx, cfg, tabId, tableId2))).rejects.toMatchObject({
      code: "table.not_joined",
    });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail.**

Run: `pnpm --filter @waitron/server test split-bill.test`
Expected: FAIL — `unjoinTable is not a function`.

- [ ] **Step 4: Implement `unjoinTable`.** In `apps/server/src/working-order.ts`, add beside `splitOffCheck` (`diningTables` is imported by TS-1's `openTab`):

```typescript
/**
 * Detach a table from a joined tab (TS-5, deferred from TS-3). WITH items: the table keeps running its
 * OWN bill — create a new `open` tab ANCHORED to it (its `tab_id` repointed) and move the items over
 * (TS-4). WITHOUT items: just free it (`tab_id → NULL`) and clear its TS-2 manual `status_id` (a
 * turnover — the same "clear on turnover" TS-3's `moveTab` applies at the move boundary). Unlike a
 * split-off CHECK, an un-joined table's new tab IS table-anchored: it is still a seat, not a payment
 * unit (design §2). Returns the new `tabId` (with items) or `{}` (freed). Runs on the caller's tx scope.
 */
export async function unjoinTable(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  tableId: string,
  transfers?: { lineNo: number; quantity?: string }[],
): Promise<{ tabId?: string }> {
  // Lock the table row; it must currently be joined to THIS tab (else `table.not_joined` — an absent/
  // foreign table reads as tab_id ≠ tabId and fails closed, design §3).
  const [table] = await tx
    .select({ tabId: diningTables.tabId })
    .from(diningTables)
    .where(eq(diningTables.id, tableId))
    .for("update");
  if (table?.tabId !== tabId) {
    throw new AppError("table.not_joined", { tableId, tabId });
  }

  // The shared tab must be open (you cannot re-carve a settled/abandoned bill).
  const [shared] = await tx
    .select({ status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, tabId))
    .for("update");
  if (shared?.status !== "open") {
    throw new AppError("tab.not_open", { tabId });
  }

  if (transfers === undefined || transfers.length === 0) {
    // Free it: null the back-pointer and the TS-2 status in ONE statement (turnover — the tab left this
    // table). Files nothing (pre-fiscal). Other tables joined to the tab keep pointing at it.
    await tx.update(diningTables).set({ tabId: null, statusId: null }).where(eq(diningTables.id, tableId));
    return {};
  }

  // With items: create a new lineless `open` tab, ANCHOR it to this table, and move the items onto it.
  const newTabId = randomUUID();
  await createOpenOrder(tx, cfg, newTabId, [], null);
  await tx.update(diningTables).set({ tabId: newTabId }).where(eq(diningTables.id, tableId));
  await transferLines(tx, cfg, tabId, newTabId, transfers);
  return { tabId: newTabId };
}
```

(If TS-2 named the status column something other than `statusId`/`status_id`, use the landed name — read `packages/db/src/schema/dining-tables.ts`.)

- [ ] **Step 5: Run the tests to verify they pass.**

Run: `pnpm --filter @waitron/server test split-bill.test`
Expected: PASS (both `splitOffCheck` and `unjoinTable` cases).

- [ ] **Step 6: Prove the `table.not_joined` guard by deletion.** Temporarily change the guard to `if (false)`, re-run, and confirm the "refuses … isn't part of the tab" case now FAILS (a free/foreign table is accepted — it either detaches the wrong row or proceeds). Restore; confirm green.

- [ ] **Step 7: Commit.**

```bash
git add apps/server/src/errors.ts apps/server/src/working-order.ts apps/server/src/split-bill.test.ts
git commit -s -m "feat(table-service): unjoinTable + table.not_joined (TS-5)"
```

---

## Task 6: H2 grep receipt — the immutable core is untouched

**Files:**
- No code. A verification step whose output is pasted into the PR description / a comment in `split-bill.fiscal.test.ts`.

**Interfaces:** none.

- [ ] **Step 1: Prove no new migration / no schema change.** Run and confirm EMPTY output:

```bash
git diff --name-only main...HEAD -- 'packages/db/drizzle/**' 'packages/db/src/schema/**'
```

Expected: **empty** (TS-5 adds no migration and no schema column — design §2). If anything prints, you have left the spec.

- [ ] **Step 2: Prove the fiscal core files are untouched by this branch.** Run:

```bash
git diff --name-only main...HEAD -- \
  packages/core/src/record-sale.ts \
  packages/verifactu/src/huella.ts \
  packages/fiscal-verifactu/src/backend.ts \
  packages/fiscal-verifactu/src/registro-row.ts \
  packages/fiscal-verifactu/src/chain.ts \
  packages/fiscal-verifactu/src/schema/registros.ts
```

Expected: **empty**. `computeHuella`/`buildCadena`, the chain, the alta builders, the desglose mapping and the registro schema are all unchanged — TS-5 only causes MORE of the normal filings (H2). Paste the (empty) result into the PR body as the grep receipt.

- [ ] **Step 3: Prove `recordSale` reads no check/tab/table membership.** Confirm the only working-order fact `recordSale` reads is `workingOrderId` (the idempotency key), and it reads no `dining_tables`/`tab`/`check` concept:

```bash
grep -nE 'dining|tab_id|tabId|check|split|unjoin' packages/core/src/record-sale.ts
```

Expected: **no matches** (only `workingOrderId` appears elsewhere, and that is the idempotency key, not a tab concept). Record the result.

- [ ] **Step 4: Commit the receipt.** (No code changed; if you added a comment recording the greps, commit it.)

```bash
git commit -s --allow-empty -m "chore(table-service): H2 grep receipt — fiscal core untouched by TS-5"
```

---

## Task 7: Dedicated fiscal-correctness review (fresh context, BEFORE merge)

**This is the #91 / CLAUDE.md §5 discipline for an unrepairable-record slice.** Before the PR merges, a reviewer who did NOT write the code re-derives the fiscal facts from first principles and confirms them against the real-PG run. This task is a CHECKLIST the reviewer executes; it produces a written sign-off, not code.

**Files:** none (a review artefact — a PR comment / review note).

- [ ] **Step 1: Dispatch a fresh-context fiscal-correctness reviewer** (a subagent or a human with no memory of the implementation) with this exact brief:

> Review `apps/server/src/split-bill.fiscal.test.ts` and `splitOffCheck`/`unjoinTable` in `apps/server/src/working-order.ts` for FISCAL CORRECTNESS only. This slice creates fiscal records that cannot be edited afterward (CLAUDE.md §5). Do NOT trust any figure in the plan or the test comments — re-derive everything from the actual run.
>
> 1. **Run the real-PG proof yourself** (`TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test split-bill.fiscal.test`) and read its output. Confirm it is GREEN.
> 2. **Re-derive each check's desglose by hand** from its allocated items (difference method: base = round(gross / (1 + rate)), tax = gross − base, per VAT rate) and confirm it matches the filed `vatBreakdown` the test asserts. Confirm each check's `Σ(base + tax) == total`.
> 3. **Confirm single-file:** exactly three `registros_facturacion` rows for the three checks; the emptied origin files nothing; paying a check twice still yields one registro (the `UNIQUE (tenant_id, working_order_id)` key).
> 4. **Confirm the partition:** every unit is filed on exactly one check, quantities conserved across the origin + 3 checks, no item double-filed and none on the origin remainder.
> 5. **Confirm contiguous invoice numbers** advance one per filed check from the tab's series, with no gap and no reuse.
> 6. **Confirm the core is untouched:** re-run Task 6's greps yourself; confirm `record-sale.ts`, `huella.ts`, the alta builders and the registro schema show no diff, and that `recordSale` reads no tab/check membership.
> 7. **Prove one guard by deletion yourself** (pick the idempotency or the RLS one): remove it, watch the proof fail, restore it. Reading is not verification (CLAUDE.md §1).
>
> Report each of the seven as CONFIRMED / DISPUTED with the evidence you ran (not reasoned). A DISPUTED item blocks merge.

- [ ] **Step 2: Address any DISPUTED finding** and re-run. Record the reviewer's seven-point sign-off in the PR.

- [ ] **Step 3: Commit any fixes** the review produced (each `-s`); proceed toward merge only once all seven are CONFIRMED.

---

## Task 8: HTTP routes — `POST /api/tabs/:id/split` and `POST /api/tabs/:id/unjoin` + full gate

**Files:**
- Modify: `apps/server/src/till-api.ts` (mount the routes, extend `STATUS`)
- Test: `apps/server/src/till-api.split-bill.test.ts` (create)

**Interfaces:**
- Consumes: `splitOffCheck` (Task 1), `unjoinTable` (Task 5); `run`, `isUuid`, `requireSession`, `withTenant`, `asAppUser` (`till-api.ts` / `@waitron/db`); the `STATUS` map.
- Produces: `POST /api/tabs/:id/split` (`:id` = `fromTabId`, body `{ transfers }`) → `200 { checkId }`; `POST /api/tabs/:id/unjoin` (`:id` = `tabId`, body `{ tableId, transfers? }`) → `200 { tabId? }`.

- [ ] **Step 1: Add `table.not_joined` to the `STATUS` map.** In `apps/server/src/till-api.ts`, add to the `STATUS` object (the `tab.*` codes are already mapped by TS-1/TS-3/TS-4; add only the new one):

```typescript
  "table.not_joined": 409,
```

- [ ] **Step 2: Write the failing route tests.** Create `apps/server/src/till-api.split-bill.test.ts`, mirroring the existing till-api route test that exercises a tab verb (session-guard, `isUuid` 4xx, happy path, error→status). Cases: `POST /api/tabs/:id/split` with a malformed `:id` → 4xx (via `isUuid`); unauthenticated → 401 (`session.required`); happy path returns `{ checkId }`; `POST /api/tabs/:id/unjoin` on a not-joined table → 409 (`table.not_joined`); `unjoin` with items → `{ tabId }`. Follow the shape of the existing `till-api.test.ts` route tests (build the Hono app via the same helper, drive it with `app.request`).

- [ ] **Step 3: Run to verify failure.**

Run: `pnpm --filter @waitron/server test till-api.split-bill.test`
Expected: FAIL — `404` (route not mounted).

- [ ] **Step 4: Mount the routes.** In `apps/server/src/till-api.ts`, inside `mountTillApi` (beside the other `/api/tabs/:id/*` routes TS-3/TS-4 added), add — wrapping each handler in `run` and screening `:id` with `isUuid`, exactly like the sibling routes:

```typescript
  // Split-bill: spin selected items off this open tab (`:id` = fromTabId) into a NEW separately-filing
  // check. SESSION-GUARDED. `isUuid`-screened before any query (a malformed id would 22P02 → opaque
  // 500). Returns the minted checkId; the till then pays it via the existing POST /api/pay|sales path.
  app.post("/api/tabs/:id/split", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("tab.not_open", { tabId: id });
      const { transfers } = await c.req.json<{ transfers: { lineNo: number; quantity?: string }[] }>();
      const result = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return splitOffCheck(tx, deps.cfg, id, transfers);
      });
      return c.json(result);
    }),
  );

  // Un-join: detach a joined table (`:id` = the shared tabId) into its own bill (with items) or free it
  // (without). SESSION-GUARDED; both path and body uuids screened.
  app.post("/api/tabs/:id/unjoin", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const tabId = c.req.param("id");
      if (!isUuid(tabId)) throw new AppError("tab.not_open", { tabId });
      const body = await c.req.json<{ tableId: string; transfers?: { lineNo: number; quantity?: string }[] }>();
      if (!isUuid(body.tableId)) throw new AppError("table.not_joined", { tableId: body.tableId, tabId });
      const result = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return unjoinTable(tx, deps.cfg, tabId, body.tableId, body.transfers);
      });
      return c.json(result);
    }),
  );
```

(Match the exact `isUuid`-screen convention the landed TS-3/TS-4 tab routes use — if they route a malformed id through a shared `requireUuidId(...)` helper, reuse it rather than throwing inline. Import `splitOffCheck`/`unjoinTable` from `./working-order.js` in the `till-api.ts` import block.)

- [ ] **Step 5: Run the route tests to verify they pass.**

Run: `pnpm --filter @waitron/server test till-api.split-bill.test`
Expected: PASS.

- [ ] **Step 6: Run the whole-package suite UNFILTERED + coverage** (so the cross-cutting guard suites load — CLAUDE.md §2):

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`
Expected: PASS, coverage ≥ 98/98/98/95 for `apps/server`.

- [ ] **Step 7: Run the four-command gate + the fiscal guard** (CLAUDE.md §2):

Run: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test` then `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`
Expected: all green (a check is a tenant-scoped working order, not a new table, so `inmutabilidad` is unaffected — but confirm, since TS-5 touches filing multiplicity). Fix `english-only` (no new Spanish tokens), lint and format issues inline.

- [ ] **Step 8: Commit.** Then the branch is ready for the normal finish-branch flow (open the PR after Task 7's fiscal-correctness sign-off).

```bash
git add apps/server/src/till-api.ts apps/server/src/till-api.split-bill.test.ts
git commit -s -m "feat(table-service): HTTP routes for split + unjoin (TS-5)"
```

---

## Plan self-review (done while writing; recorded for the executor)

- **Spec coverage:** `splitOffCheck` (Task 1, proven fiscally Tasks 2–4), pay-via-existing-`payWorkingOrder` / no new verb (Task 2), exactly-one-registro-per-check (Tasks 2 & 4), coherent per-check desglose (Task 2), items partitioned / no double-file / conserved across the 4 working orders (Task 3), independent legal invoices + contiguous numbers (Task 2), sale-idempotency replay + cross-tenant RLS (Task 4), `unjoinTable` with/without items + `table.not_joined` (Task 5), no core change / grep receipt (Task 6), dedicated fiscal-correctness review (Task 7), HTTP routes + coverage 98/98/98/95 (Task 8). Spec §7 "Deferred" items (split-view UX, check-finding read, even-money split, merge-back, `split_from_tab_id` link) are correctly NOT built.
- **Placeholder scan:** every code step carries real code; the only deliberately-unfixed literals are the desglose cents, explicitly marked **[verify on the RED run]** per CLAUDE.md §1 (they MUST be replaced from the real run, never trusted from the plan) — this is the correct fiscal discipline, not a placeholder.
- **Type consistency:** `splitOffCheck(tx, cfg, fromTabId, transfers) → { checkId }` and `unjoinTable(tx, cfg, tabId, tableId, transfers?) → { tabId? }` used identically in Tasks 1/2/3/4/5/8; `transfers: { lineNo: number; quantity?: string }[]` matches TS-4's consumed shape; `payWorkingOrder(deps, cfg, { id, tender, lines })` matches `till-sale.ts`.
- **Dependency caveats the executor MUST honour:** reused error-code param shapes (`tab.not_open`, `tab.transfer_quantity_invalid`, `tab.line_not_found`) and the `dining_tables.status_id` column name follow the **landed** TS-1/TS-2/TS-3/TS-4 declarations — read them, don't trust the indicative shapes here. `sale_lines` snapshots values and carries no `product_id`, so Task 3 partitions filed quantities by `vat_rate` (schema note in Task 3, Step 1). Reuse a landed PGlite tab-verb fixture if one exists rather than duplicating `setupVenue`.
