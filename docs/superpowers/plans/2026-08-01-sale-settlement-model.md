# Sale Settlement Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the payment facts — the tip and the amount charged — off the immutable `sales` row and onto `tenders` and a new append-only `sale_settlements` table, so an invoice can be issued **before** payment settles as well as after.

**Architecture:** `sales` drops to one number (`total`, the fiscal figure). The tip moves to `tenders.tip_amount`, attributed to the payer. Settlement becomes an explicit append-only `sale_settlements` row, and the tender-coverage check moves from a pair of deferred constraint triggers onto that row's INSERT (with a `tenders` guard that rejects any tender added after settlement). `recordSale` gains a required `settlement` mode (`immediate` | `deferred`); a new `settleSale` function performs the deferred half, and `immediate` calls it in the same transaction so the two paths cannot drift.

**Tech Stack:** TypeScript, Drizzle ORM (`packages/db`), PostgreSQL (real-Postgres via Testcontainers for RLS/coverage/concurrency behaviour), Vitest, `@waitron/shared` decimal helpers.

**Source design:** [`docs/superpowers/specs/2026-07-31-sale-settlement-model-design.md`](../specs/2026-07-31-sale-settlement-model-design.md). Read it before starting — this plan implements it and cites it by section.

## Global Constraints

- **This is piece 2 of a four-piece fiscal sequence. Build only piece 2.** Rectificativas (piece 4), invoice-first-in-the-till (piece 3) and the working-order amendment log (piece 1) are out of scope. See design §8.
- **One migration, `0012_sale_settlement.sql`.** `packages/db/drizzle` is sequentially numbered (`0011` is current) and `meta/_journal.json` conflicts on every parallel branch. Do not split into two migrations.
- **No backfill.** Nothing is deployed; schema changes drop and recreate. Do not write data-preservation code for an empty database (`CLAUDE.md` §3, design §6).
- **Real Postgres is mandatory for the coverage/RLS/concurrency tests.** PGlite makes every connection a superuser and serialises every query onto one backend, so it cannot show `sales_coverage_checker` behaviour or a settlement race — a PGlite pass there is a false pass (design §7). Use the `packages/db` real-Postgres harness (`useRealPostgres` / `describeEachTarget`), `TESTCONTAINERS_RYUK_DISABLED=true` locally.
- **Gate unfiltered.** `pnpm --filter @waitron/db test:coverage` and `pnpm --filter @waitron/core test:coverage` — a name-filtered run skips `schema-ownership.test.ts` and `errors.reachability.test.ts`, both in play here (design §7). Coverage thresholds stay `98/98/98/95`. Tree-wide guards (`english-only`, guarded-teardowns) now live in the root Vitest project — run `pnpm vitest run --coverage` at the repo root too.
- **Every new SQL guard proved by deletion** (design §7): remove it, watch the test fail for the claimed reason (negative control), restore it.
- **Guarded teardowns.** New suites must not own a raw `beforeAll`/`afterAll` database; use `useRealPostgres` / `usePgliteDb` from `@waitron/db/testing/lifecycle.js`. Where a raw teardown is unavoidable, guard it: `if (db !== undefined) await db.close()`. Enforced by `scripts/guarded-teardowns.test.ts`.
- **Error codes name the domain concept and are never renamed once shipped** (`CLAUDE.md` §3). Every file that throws a code imports its registry (`import "./errors.js"`).
- **`git commit -s` on every commit** (DCO is enforced tree-wide).

---

## Design decisions this plan resolved beyond the spec

The design spec (2026-07-31) left five points underspecified. This plan resolves them as below; each is a reviewer decision — flag any you want changed before implementing the affected task.

1. **New error code `sale.voided`** (Task 3, Task 4). Design §4 says `settleSale` "must additionally refuse … a sale carrying a `sale_voids` row" but names no code. Invoice-first makes an unsettled-then-voided sale reachable. Proposed permanent code `sale.voided` `{ saleId }`, sibling to `sale.already_voided`.
2. **`tender_unsettled` / `tender_shortfall` params become sale-centric** (Task 3). They currently carry `{ tillId, workingOrderId, … }` and are raised by `recordSale`'s `assertAllTendersSettled`. Design §4 moves these raises onto the settlement path, which has a `saleId` but **no `workingOrderId`** (the working order is consumed at `recordSale` time and is never stored on `sales`). Proposed: drop `workingOrderId`, key on `saleId` (+ `tillId`, read from the sale row). Safe pre-production; touches two codes' params and their tests.
3. **`settleSale` pre-checks for an existing settlement** before inserting tenders (Task 4). The design surfaces `sale.already_settled` from the `sale_settlements` UNIQUE violation (concurrent race). But because tenders are inserted **before** the `sale_settlements` row and the `tenders` post-settlement guard rejects a late tender, a *sequential* retry would otherwise fail on the tender insert (guard error `WT002`) rather than as `already_settled`. A `SELECT` pre-check gives clean `already_settled` for the sequential case; the UNIQUE violation still covers the concurrent race; the post-settlement guard remains the pure DB backstop. See Task 4 for why both are needed.
4. **Immediate mode writes the sale, then settles, in one transaction** (Task 5). Design D6 says `immediate` "runs `settleSale`'s code in the same transaction". A declined/short tender therefore aborts the whole transaction (sale, fiscal record, and the allocated invoice number all roll back — no number is burned), which preserves the old "nothing chained on a declined card" property by atomicity rather than by check-ordering. The immediate `settleSale` call is placed after the `sale_lines` insert and **before** `backend.recordSale`, so a shortfall aborts before the fiscal write.
5. **`sale_settlements.settled_at` = the latest tender's `settledAt`** (Task 4). The design gives the column no source. The sale is fully paid when the last tender lands, so `max(tender.settledAt)` is the meaningful value and needs no clock dependency (settlement is not a fiscal event — design §4, "No fiscal involvement").

---

## File structure

| File | Responsibility | Task |
| --- | --- | --- |
| `packages/db/src/schema/sales.ts` | `tenders.tip_amount` + tightened checks; new `saleSettlements` table; `sales` drops `tip_amount`/`amount_charged` + their checks | 1 |
| `packages/db/drizzle/0012_sale_settlement.sql` | The migration (5 ordered steps, design §6) | 1 |
| `packages/db/drizzle/meta/0012_snapshot.json`, `meta/_journal.json` | Drizzle bookkeeping (generated) | 1 |
| `packages/db/src/schema/sale-settlements.test.ts`, `tenders.test.ts` (or additions to `sales.test.ts`) | Real-PG guard tests (deletion matrix, design §7) | 2 |
| `packages/core/src/errors.ts` | `sale.already_settled`, `sale.voided`; sale-centric `tender_unsettled`/`tender_shortfall`; reworded `tender_shortfall` doc | 3 |
| `packages/core/src/settle-sale.ts` | New `settleSale` — the deferred half; the single settlement implementation | 4 |
| `packages/core/src/settle-sale.test.ts` | `settleSale` behaviour, incl. concurrency race (real PG) | 4 |
| `packages/core/src/record-sale.ts` | `settlement` mode arg; `RecordSaleTender.tipAmount`; drop `tipAmount`/`tenders` from input; `sales` insert loses two columns; `immediate` calls `settleSale` | 5 |
| `packages/core/src/record-sale.test.ts` | Mode equivalence + updated write-path tests | 5 |
| `packages/core/src/index.ts` | Export `settleSale`, `SettleSaleInput` | 4 |
| All `recordSale` callers + `amount_charged` fixtures | Migrate to the new API; drop `amount_charged` writes | 6 |

`sale_settlements` may live in `sales.ts` beside `sales`/`tenders`, or in a new `sale-settlements.ts` imported by the barrel. Follow the package's existing convention (schema modules are per-concept and re-exported from `src/schema/index.ts`). If added as a new file, add it to `src/schema/index.ts` so `drizzle.config.ts` (which points at the barrel) sees it.

---

### Task 1: Schema + migration `0012` (the DDL)

**Files:**
- Modify: `packages/db/src/schema/sales.ts`
- Create: `packages/db/drizzle/0012_sale_settlement.sql`
- Generated: `packages/db/drizzle/meta/0012_snapshot.json`, `packages/db/drizzle/meta/_journal.json`
- Test: `packages/db/src/schema/sale-settlements.test.ts` (shape/apply smoke test; the behavioural matrix is Task 2)

**Interfaces:**
- Produces: Drizzle tables `tenders` (now with `tipAmount`), `saleSettlements` (`{ id, tenantId, saleId, settledAt }`), and `sales` (without `tipAmount`/`amountCharged`). SQL objects: function `sales_assert_tenders_cover(uuid)` (new body), triggers `sale_settlements_check_coverage`, `tenders_reject_post_settlement`, `sale_settlements_enforce_immutability`, `sale_settlements_block_truncate`. SQLSTATE `WT002` for the post-settlement guard (`WT001` remains `reject_mutation`).

**Migration authoring note (how the repo does it):** `packages/db/package.json` has `db:generate` (`drizzle-kit generate`) which diffs the barrel schema and writes the SQL + snapshot + journal. Drizzle only tracks tables/columns/constraints/indexes/enums/RLS-enable — it does **not** generate policies, roles, functions, triggers, or grants. The established pattern (see `0005_sales.sql`) is: edit the schema TS, run `db:generate` to get the base DDL + snapshot + journal entry, then **replace the generated `.sql` body** with the hand-authored, correctly-ordered version below (the snapshot/journal from `db:generate` stay as-is — they reflect the final schema state regardless of the SQL's internal statement order).

- [ ] **Step 1: Write the failing apply/shape test**

`packages/db/src/schema/sale-settlements.test.ts`, using the real-Postgres lifecycle helper (mirror an existing real-PG suite in this package for the exact `useRealPostgres` import and `describeEachTarget`/real-only wrapper). Assert the end-state shape after migrations run:

```ts
// pseudocode-level assertions — write them against the package's real-PG accessor
// (a Drizzle db bound to the deployment role after runMigrations)
it("tenders carries tip_amount and rejects tip > amount / amount <= 0", async () => {
  // information_schema / pg_constraint checks, OR behavioural inserts (Task 2 does behaviour in full)
  const cols = await db.execute(sql`
    select column_name from information_schema.columns
    where table_name = 'tenders' and column_name = 'tip_amount'`);
  expect(cols.rows).toHaveLength(1);
});

it("sale_settlements exists, is append-only, and sales lost tip_amount/amount_charged", async () => {
  const settlements = await db.execute(sql`
    select 1 from information_schema.tables where table_name = 'sale_settlements'`);
  expect(settlements.rows).toHaveLength(1);
  const dropped = await db.execute(sql`
    select column_name from information_schema.columns
    where table_name = 'sales' and column_name in ('tip_amount','amount_charged')`);
  expect(dropped.rows).toEqual([]);
});

it("the deferred coverage triggers are gone and the new ones exist", async () => {
  const trigs = await db.execute(sql`
    select tgname from pg_trigger
    where tgname in ('sales_check_tender_coverage','tenders_check_tender_coverage',
                     'sale_settlements_check_coverage','tenders_reject_post_settlement')
    order by tgname`);
  expect(trigs.rows.map((r) => r.tgname)).toEqual([
    "sale_settlements_check_coverage", "tenders_reject_post_settlement",
  ]);
});
```

- [ ] **Step 2: Run it to verify it fails**

`cd packages/db && TESTCONTAINERS_RYUK_DISABLED=true pnpm test sale-settlements` → FAIL (migration `0012` absent; `sale_settlements` does not exist).

- [ ] **Step 3: Edit the schema TS**

In `packages/db/src/schema/sales.ts`:

`tenders` — add `tipAmount`, tighten the amount check, add the tip check:
```ts
export const tenders = pgTable(
  "tenders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    saleId: uuid("sale_id").notNull(),
    method: tenderMethod("method").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    tipAmount: numeric("tip_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
    settledAt: timestamp("settled_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.saleId],
      foreignColumns: [sales.tenantId, sales.id],
      name: "tenders_sale_fk",
    }).onDelete("restrict"),
    index("tenders_sale_idx").on(t.saleId),
    check("tenders_amount_ck", sql`${t.amount} > 0`),
    check("tenders_tip_amount_ck", sql`${t.tipAmount} >= 0 and ${t.tipAmount} <= ${t.amount}`),
  ],
).enableRLS();
```

`saleSettlements` — new table (put it after `tenders`):
```ts
/**
 * One row per fully-settled sale — appended when settlement is *declared* complete.
 * Append-only (REVOKE UPDATE/DELETE + reject_mutation triggers) like `tenders`.
 * Its existence is the answer to "is this sale paid?"; under invoice-first an
 * unsettled sale is a legitimate steady state, not an anomaly (design §3).
 */
export const saleSettlements = pgTable(
  "sale_settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    saleId: uuid("sale_id").notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.saleId],
      foreignColumns: [sales.tenantId, sales.id],
      name: "sale_settlements_sale_fk",
    }).onDelete("restrict"),
    unique("sale_settlements_sale_key").on(t.tenantId, t.saleId),
  ],
).enableRLS();
```

`sales` — remove `tipAmount` and `amountCharged` columns and the `sales_amount_charged_ck` / `sales_tip_amount_ck` checks. Keep `total`, `sales_total_ck`, and every other constraint. Update the table doc comment: the "Three distinct numbers, held together by CHECK" paragraph becomes one number — `total`, the figure the fiscal record reports; note that the tip now lives on `tenders` and `amount_charged` is derived (design §3).

Export `saleSettlements` from `src/schema/index.ts` (and `@waitron/db`'s public barrel) if the package re-exports schema symbols there — check how `tenders` is exported and mirror it, so `settleSale` can `import { saleSettlements } from "@waitron/db"`.

- [ ] **Step 4: Generate, then hand-author the migration**

```bash
cd packages/db && pnpm db:generate    # writes base 0012 SQL + meta/0012_snapshot.json + _journal.json
```

Confirm `meta/_journal.json` gained an `idx: 12` entry tagged `0012_sale_settlement` (rename the generated file to `0012_sale_settlement.sql` and the journal `tag` to match if drizzle chose a different suffix). Then **replace the generated `.sql` body** with this, in exactly this order (design §6):

```sql
-- 0012_sale_settlement.sql
-- Piece 2 of the fiscal sequence: payment facts move off the immutable sale so an
-- invoice can be issued before payment settles.
-- docs/superpowers/specs/2026-07-31-sale-settlement-model-design.md

-- Step 1: tenders gains the tip; the sign check tightens from `<> 0` to `> 0`.
-- Retightening validates existing rows, so a stray negative tender in a dev DB fails
-- the migration loudly rather than being silently dropped (design §3). No prod data.
ALTER TABLE "tenders" ADD COLUMN "tip_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenders" DROP CONSTRAINT "tenders_amount_ck";
--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_amount_ck" CHECK ("tenders"."amount" > 0);
--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_tip_amount_ck" CHECK ("tenders"."tip_amount" >= 0 and "tenders"."tip_amount" <= "tenders"."amount");
--> statement-breakpoint

-- Step 2: sale_settlements — append-only, one row per sale, RLS forced, grants,
-- immutability + TRUNCATE triggers. Mirrors tenders' protections in 0005_sales.sql.
CREATE TABLE "sale_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"settled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sale_settlements_sale_key" UNIQUE("tenant_id","sale_id")
);
--> statement-breakpoint
ALTER TABLE "sale_settlements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sale_settlements" ADD CONSTRAINT "sale_settlements_sale_fk" FOREIGN KEY ("tenant_id","sale_id") REFERENCES "public"."sales"("tenant_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE sale_settlements FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sale_settlements_tenant_isolation ON sale_settlements
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
REVOKE ALL ON sale_settlements FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON sale_settlements TO app_user;
--> statement-breakpoint
CREATE TRIGGER sale_settlements_enforce_immutability
  BEFORE UPDATE OR DELETE ON sale_settlements
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER sale_settlements_block_truncate
  BEFORE TRUNCATE ON sale_settlements
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint

-- Step 3: replace the coverage function body — compare against the new shape,
--   sum(tenders.amount) = sales.total + sum(tenders.tip_amount)
-- The function stays owned by sales_coverage_checker and SECURITY DEFINER (0005),
-- so its SELECTs still see rows through the role-scoped bypass policies regardless
-- of app.tenant_id — the fail-open fix. Replace the body AS the owner: grant
-- membership + schema CREATE to CURRENT_USER's role, SET ROLE, CREATE OR REPLACE,
-- then revoke. Mirrors the ownership dance 0005 used for ALTER FUNCTION OWNER.
-- (This dance is exactly what the real-PG "migration applies as the deployment
--  role" test verifies — if the privileges are wrong, that test fails loudly.)
GRANT CREATE ON SCHEMA public TO sales_coverage_checker;
--> statement-breakpoint
GRANT sales_coverage_checker TO CURRENT_USER WITH INHERIT FALSE;
--> statement-breakpoint
SET ROLE sales_coverage_checker;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sales_assert_tenders_cover(p_sale_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  sale_total numeric(12, 2);
  tendered   numeric(12, 2);
  tipped     numeric(12, 2);
BEGIN
  SELECT total INTO sale_total FROM sales WHERE id = p_sale_id;
  IF sale_total IS NULL THEN
    RETURN;  -- the sale itself was rolled back; nothing left to reconcile
  END IF;

  SELECT coalesce(sum(amount), 0), coalesce(sum(tip_amount), 0)
    INTO tendered, tipped
    FROM tenders WHERE sale_id = p_sale_id;

  IF tendered <> sale_total + tipped THEN
    RAISE EXCEPTION 'tenders for sale % total % but sale.total + tips is %',
      p_sale_id, tendered, sale_total + tipped;
  END IF;
END;
$$;
--> statement-breakpoint
RESET ROLE;
--> statement-breakpoint
REVOKE sales_coverage_checker FROM CURRENT_USER;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM sales_coverage_checker;
--> statement-breakpoint

-- Step 4: retire the two deferred constraint triggers and their functions; add the
-- coverage trigger on sale_settlements (checks at the moment completeness is DECLARED)
-- and the tenders post-settlement guard (rejects any tender after settlement).
DROP TRIGGER sales_check_tender_coverage ON sales;
--> statement-breakpoint
DROP TRIGGER tenders_check_tender_coverage ON tenders;
--> statement-breakpoint
DROP FUNCTION sales_check_tender_coverage();
--> statement-breakpoint
DROP FUNCTION tenders_check_tender_coverage();
--> statement-breakpoint
CREATE FUNCTION sale_settlements_check_coverage()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM sales_assert_tenders_cover(NEW.sale_id);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sale_settlements_check_coverage
  BEFORE INSERT ON sale_settlements
  FOR EACH ROW EXECUTE FUNCTION sale_settlements_check_coverage();
--> statement-breakpoint
-- Invoker rights (not SECURITY DEFINER): this fires DURING a tender INSERT, when
-- app.tenant_id is necessarily set (the tender's own RLS WITH CHECK requires it), so
-- the same-tenant sale_settlements row is visible. Keeping it invoker-rights is why
-- sale_settlements needs no coverage-checker bypass policy (design §5). WT002 so
-- tests assert on the code, not the wording (WT001 is reject_mutation).
CREATE FUNCTION tenders_reject_post_settlement()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM sale_settlements WHERE sale_id = NEW.sale_id) THEN
    RAISE EXCEPTION 'tender for sale % rejected: the sale is already settled', NEW.sale_id
      USING ERRCODE = 'WT002';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tenders_reject_post_settlement
  BEFORE INSERT ON tenders
  FOR EACH ROW EXECUTE FUNCTION tenders_reject_post_settlement();
--> statement-breakpoint

-- Step 5: sales drops to one number. Last, so the function body above no longer
-- references amount_charged before the column is removed.
ALTER TABLE "sales" DROP CONSTRAINT "sales_amount_charged_ck";
--> statement-breakpoint
ALTER TABLE "sales" DROP CONSTRAINT "sales_tip_amount_ck";
--> statement-breakpoint
ALTER TABLE "sales" DROP COLUMN "tip_amount";
--> statement-breakpoint
ALTER TABLE "sales" DROP COLUMN "amount_charged";
```

- [ ] **Step 5: Run the shape test to verify it passes**

`cd packages/db && TESTCONTAINERS_RYUK_DISABLED=true pnpm test sale-settlements` → PASS. If the migration fails to apply as the deployment role (e.g. the `SET ROLE` dance), fix the role mechanics here — the failing apply IS the receipt (design §7), do not reason around it.

- [ ] **Step 6: Typecheck + commit**

```bash
cd packages/db && pnpm typecheck
git add packages/db/src/schema/sales.ts packages/db/drizzle/0012_sale_settlement.sql packages/db/drizzle/meta packages/db/src/schema/sale-settlements.test.ts
git commit -s -m "feat(db): sale-settlement schema + migration 0012"
```

---

### Task 2: `packages/db` behavioural guards (the deletion matrix)

**Files:**
- Test: `packages/db/src/schema/sale-settlements.test.ts` (extend), and tender-constraint cases beside the existing `tenders` coverage in `packages/db/src/schema/sales.test.ts`

**Interfaces:**
- Consumes: the migration and tables from Task 1. Real-PG accessor bound to the deployment (`app_user`) role, with `app.tenant_id` settable/clearable per test.

Each guard below is proven by deletion: comment the guard out of `0012`, run the case, confirm it fails for the claimed reason, restore. Design §7 table.

- [ ] **Step 1: `tenders_amount_ck` — zero and negative both rejected**

Two cases (this constraint had *no* test at all before — design §3). Insert a tender with `amount = '0.00'` → rejected; `amount = '-10.00'` → rejected; `amount = '10.00'` → accepted. Assert on the check-constraint violation (SQLSTATE `23514`).

- [ ] **Step 2: `tenders_tip_amount_ck` — more tip than money is rejected**

`amount = '10.00', tip_amount = '15.00'` → rejected (`23514`); `tip_amount = '10.00'` (equal) → accepted; `tip_amount = '-1.00'` → rejected.

- [ ] **Step 3: `sale_settlements` immutability + TRUNCATE**

Insert a settlement row, then `UPDATE` it → `WT001`; `DELETE` it → `WT001`; `TRUNCATE sale_settlements` → `WT001`. (Mirror the existing `tenders`/`sales` immutability tests in this package.)

- [ ] **Step 4: `sale_settlements_check_coverage` — a mis-summed settlement is refused**

Set up a sale (`total = '70.00'`) with tenders summing to something ≠ `total + sum(tip)`, then INSERT the `sale_settlements` row directly and assert it raises. Then the fail-open re-verification (design §7): **clear `app.tenant_id` before the settlement INSERT** and assert the coverage check *still* fires — this is the whole reason `sales_assert_tenders_cover` is SECURITY DEFINER as `sales_coverage_checker`. A PGlite run here is a false pass; real-PG as a non-superuser is mandatory.

- [ ] **Step 5: `tenders_reject_post_settlement` — no tender after settlement**

Sale settled (a `sale_settlements` row exists), then INSERT another tender for that sale → rejected with `WT002`.

- [ ] **Step 6: Run, prove each by deletion, commit**

```bash
cd packages/db && TESTCONTAINERS_RYUK_DISABLED=true pnpm test:coverage   # unfiltered — loads schema-ownership + reachability suites
git add -A && git commit -s -m "test(db): sale-settlement guard matrix, proved by deletion"
```

---

### Task 3: Error codes

**Files:**
- Modify: `packages/core/src/errors.ts`

**Interfaces:**
- Produces: `AppError` codes `sale.already_settled` `{ saleId: string }` and `sale.voided` `{ saleId: string }`; `sale.tender_unsettled` / `sale.tender_shortfall` re-shaped to sale-centric params.

- [ ] **Step 1: Read the sibling and every place it is declared**

`rg 'sale\.already_voided' packages/core` — replicate that code's pattern for the two new codes in **every** place it appears (the `ErrorParams` registry entry, and any message-template/locale catalog it feeds). Error codes are structured; never store English (`CLAUDE.md`, currency+localisation memory).

- [ ] **Step 2: Add the two new codes + re-shape the two existing ones**

In the `ErrorParams` declaration-merge block:
```ts
"sale.already_settled": { saleId: string };
"sale.voided": { saleId: string };
```
Change (design §4, and decision 2 above):
```ts
// was: { tillId: string; workingOrderId: string; unsettledCount: number }
"sale.tender_unsettled": { tillId: string; saleId: string; unsettledCount: number };
// was: { tillId: string; workingOrderId: string; due: Decimal; charged: Decimal }
// doc: sum(amount) = total + sum(tip_amount); still fires in BOTH directions despite the name
"sale.tender_shortfall": { tillId: string; saleId: string; due: Decimal; charged: Decimal };
```
Reword the `tender_shortfall` doc comment to `sum(amount) = total + sum(tip_amount)` and keep the note that it fires in both directions (codes are never renamed once shipped — design §4).

- [ ] **Step 3: Typecheck (expect downstream breaks) + commit**

`pnpm --filter @waitron/core typecheck` will now flag the old `record-sale.ts` raise sites (fixed in Task 5) — that is expected. Commit the error definitions:
```bash
git commit -s -am "feat(core): sale.already_settled + sale.voided; sale-centric tender errors"
```

---

### Task 4: `settleSale` — the single settlement implementation

**Files:**
- Create: `packages/core/src/settle-sale.ts`
- Create: `packages/core/src/settle-sale.test.ts`
- Modify: `packages/core/src/index.ts` (export `settleSale`, `SettleSaleInput`)

**Interfaces:**
- Consumes: `saleSettlements`, `saleVoids`, `sales`, `tenders`, `isUniqueViolation` from `@waitron/db`; `RecordSaleTender` (with `tipAmount`) from `./record-sale.js`; `AppError`, decimal helpers from `@waitron/shared`.
- Produces: `settleSale(tx: Transaction, input: SettleSaleInput): Promise<void>` and `interface SettleSaleInput { tenantId: TenantId; saleId: SaleId; tenders: RecordSaleTender[] }`. Called by Task 5's `recordSale` for `immediate` mode.

> **Note on `RecordSaleTender`:** it currently lives in `record-sale.ts` and does **not** yet have `tipAmount` — Task 5 adds it. To keep tasks independently testable, either add the `tipAmount` field to `RecordSaleTender` here in Task 4 (it is a pure interface widening; Task 5 populates it), or define `SettleSaleInput.tenders` against a local `{ method; amount; tipAmount; settledAt }` shape and have Task 5 reconcile. Prefer adding `tipAmount` to `RecordSaleTender` now.

- [ ] **Step 1: Write failing tests (real PG)**

`packages/core/src/settle-sale.test.ts` — use the real-PG lifecycle helper. Seed a `sales` row (via the package's existing sale fixture, updated to the new schema) and exercise:

```ts
it("writes tenders + a settlement row when tenders cover total + tips", async () => {
  await settleSale(tx, { tenantId, saleId, tenders: [
    { method: "cash", amount: "70.00", tipAmount: "5.00", settledAt: new Date("2026-08-01T12:00:00Z") },
  ]});
  // total is 65.00 in this fixture → 70.00 = 65.00 + 5.00 covers
  const settled = await tx.select().from(saleSettlements).where(eq(saleSettlements.saleId, saleId));
  expect(settled).toHaveLength(1);
  expect(settled[0].settledAt).toBe("2026-08-01T12:00:00.000Z"); // latest tender settledAt
});

it("throws sale.tender_unsettled for a null settledAt", async () => { /* expect AppError code */ });
it("throws sale.tender_shortfall when sum(amount) != total + sum(tip)", async () => { /* … */ });
it("throws sale.not_found for an unknown or cross-tenant sale", async () => { /* RLS-hidden → not_found */ });
it("throws sale.voided when the sale carries a sale_voids row", async () => { /* void then settle */ });
it("throws sale.already_settled on a second (sequential) settle", async () => { /* settle twice */ });
```

- [ ] **Step 2: Run to verify failure**

`cd packages/core && TESTCONTAINERS_RYUK_DISABLED=true pnpm test settle-sale` → FAIL (`settleSale` not defined).

- [ ] **Step 3: Implement `settleSale`**

```ts
// Side-effect import registers this package's sale.* codes (mirrors record-sale.ts).
import "./errors.js";
import { eq } from "drizzle-orm";
import { isUniqueViolation, saleSettlements, saleVoids, sales, tenders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, addDecimal, compareDecimal, decimal, sumDecimals } from "@waitron/shared";
import type { SaleId, TenantId } from "@waitron/shared";
import type { RecordSaleTender } from "./record-sale.js";

export interface SettleSaleInput {
  tenantId: TenantId;
  saleId: SaleId;
  tenders: RecordSaleTender[];
}

/**
 * The deferred half of the sale write path, and the single implementation of
 * settlement (recordSale's `immediate` mode calls this in the same transaction,
 * so the two cannot drift — design D6). Payment is not a fiscal event: this
 * touches no chain, takes no chain-head lock, and submits nothing (design §4).
 */
export async function settleSale(tx: Transaction, input: SettleSaleInput): Promise<void> {
  // The sale's fiscal total, and fail-closed on cross-tenant: RLS hides another
  // tenant's row, so it is genuinely not-found rather than forbidden (as record-void).
  const [sale] = await tx
    .select({ tillId: sales.tillId, total: sales.total })
    .from(sales)
    .where(eq(sales.id, input.saleId));
  if (sale === undefined) {
    throw new AppError("sale.not_found", { saleId: input.saleId });
  }

  // A voided sale cannot be settled. Reachable only now that invoice-first lets a
  // sale exist unsettled and therefore be voided before any payment lands.
  const [voided] = await tx
    .select({ saleId: saleVoids.saleId })
    .from(saleVoids)
    .where(eq(saleVoids.saleId, input.saleId));
  if (voided !== undefined) {
    throw new AppError("sale.voided", { saleId: input.saleId });
  }

  // Clean `already_settled` for the sequential retry. The concurrent race is caught
  // by the UNIQUE violation below (two callers both pass this SELECT, both insert
  // tenders — the other's uncommitted settlement is invisible — and the sale_settlements
  // UNIQUE arbitrates; the loser's whole transaction, tenders included, rolls back).
  const [existing] = await tx
    .select({ saleId: saleSettlements.saleId })
    .from(saleSettlements)
    .where(eq(saleSettlements.saleId, input.saleId));
  if (existing !== undefined) {
    throw new AppError("sale.already_settled", { saleId: input.saleId });
  }

  const unsettled = input.tenders.filter((t) => t.settledAt === null);
  if (unsettled.length > 0) {
    throw new AppError("sale.tender_unsettled", {
      tillId: sale.tillId,
      saleId: input.saleId,
      unsettledCount: unsettled.length,
    });
  }

  const due = addDecimal(
    decimal(sale.total),
    sumDecimals(input.tenders.map((t) => decimal(t.tipAmount))),
  );
  const charged = sumDecimals(input.tenders.map((t) => decimal(t.amount)));
  if (compareDecimal(charged, due) !== 0) {
    throw new AppError("sale.tender_shortfall", {
      tillId: sale.tillId,
      saleId: input.saleId,
      due,
      charged,
    });
  }

  // settled_at = the moment the LAST tender landed (design decision 5). settledAt is
  // guaranteed non-null by the guard above; `!` reflects that rather than asserting blind.
  const settledAt = input.tenders
    .map((t) => t.settledAt!)
    .reduce((a, b) => (b > a ? b : a));

  await tx.insert(tenders).values(
    input.tenders.map((tender) => ({
      tenantId: input.tenantId,
      saleId: input.saleId,
      method: tender.method as (typeof tenders.$inferInsert)["method"],
      amount: tender.amount,
      tipAmount: tender.tipAmount,
      settledAt: tender.settledAt!.toISOString(),
    })),
  );

  try {
    await tx.insert(saleSettlements).values({
      tenantId: input.tenantId,
      saleId: input.saleId,
      settledAt: settledAt.toISOString(),
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("sale.already_settled", { saleId: input.saleId });
    }
    throw error;
  }
}
```

- [ ] **Step 4: Run to verify pass**

`cd packages/core && TESTCONTAINERS_RYUK_DISABLED=true pnpm test settle-sale` → PASS.

- [ ] **Step 5: Concurrency test (real PG only)**

Add a test that runs two `settleSale` calls on one sale on **distinct connections** (a genuine race — needs its own connections, so this is one of the few suites that legitimately builds its own resources rather than using the shared accessor; guard any raw teardown). Assert exactly one `sale_settlements` row survives and the loser surfaces `sale.already_settled`. On PGlite this is a false pass (single backend) — real-PG mandatory (design §7).

- [ ] **Step 6: Export + commit**

Add to `packages/core/src/index.ts`: `export { settleSale, type SettleSaleInput } from "./settle-sale.js";`. Then:
```bash
cd packages/core && pnpm typecheck   # record-sale.ts still broken until Task 5
git add packages/core/src/settle-sale.ts packages/core/src/settle-sale.test.ts packages/core/src/index.ts
git commit -s -m "feat(core): settleSale — deferred settlement + concurrency-safe already_settled"
```

---

### Task 5: `recordSale` — settlement mode

**Files:**
- Modify: `packages/core/src/record-sale.ts`
- Modify: `packages/core/src/record-sale.test.ts`

**Interfaces:**
- Consumes: `settleSale`, `SettleSaleInput` (Task 4).
- Produces: `RecordSaleTender` with `tipAmount: string`; `RecordSaleInput` with `settlement: { kind: "immediate"; tenders: RecordSaleTender[] } | { kind: "deferred" }` and **without** `tipAmount` / `tenders`.

- [ ] **Step 1: Write/adjust the mode-equivalence test first**

In `record-sale.test.ts`, the assertion that keeps D6 true: the same sale settled `{ kind: "immediate", tenders }` and (via `recordSale` deferred + a later `settleSale`) must produce **identical** `tenders` and `sale_settlements` rows (design §7). Plus a deferred-mode test: `recordSale({ …, settlement: { kind: "deferred" } })` writes the `sales` row and fiscal record with **no** tender and **no** settlement, and the sale is a legitimate unsettled steady state.

```ts
it("immediate and deferred produce identical tenders + settlement rows", async () => {
  const a = await recordSale(txA, backend, { ...base, settlement: { kind: "immediate", tenders } });
  const b = await recordSale(txB, backend, { ...base, settlement: { kind: "deferred" } });
  await settleSale(txB, { tenantId, saleId: b.saleId, tenders });
  // compare tenders(a.saleId) vs tenders(b.saleId) and settlements — identical but for ids/sale_id
});
```

- [ ] **Step 2: Run to verify failure**

`pnpm --filter @waitron/core test record-sale` → FAIL (compile error: `settlement` not on `RecordSaleInput`; `tipAmount` still required).

- [ ] **Step 3: Edit the interfaces**

```ts
export interface RecordSaleTender {
  method: string;
  amount: string;
  /** The affirmed tip on this tender — non-taxable, on no fiscal record (design §9.2). */
  tipAmount: string;
  /** `null` means the payment has not completed. */
  settledAt: Date | null;
}

export interface RecordSaleInput {
  tenantId: TenantId;
  tillId: TillId;
  seriesId: SeriesId;
  workingOrderId: WorkingOrderId;
  locale: string;
  invoiceLocales: string[];
  /** The taxable total — base plus VAT — EXCLUDING the tip. */
  total: string;
  lines: RecordSaleLine[];
  fiscalBackend: string;
  clock: TrustedClock;
  /**
   * Pay-first vs invoice-first, per sale. Whether staff are OFFERED the choice is
   * till-UI policy (sub-project 7), never a tenants column (design D5).
   */
  settlement:
    | { kind: "immediate"; tenders: RecordSaleTender[] }
    | { kind: "deferred" };
}
```
Remove the old top-level `tipAmount: string` and `tenders: RecordSaleTender[]`.

- [ ] **Step 4: Edit `recordSale`'s body**

- Delete the `assertAllTendersSettled(input)` call and the `assertAllTendersSettled` function itself (the settled + shortfall checks now live in `settleSale`, Task 4).
- Delete `const amountCharged = addDecimal(...)`.
- In the `sales` insert `.values({...})`, remove `tipAmount: input.tipAmount` and `amountCharged`.
- Delete the `await tx.insert(tenders).values(...)` block.
- After the `saleLines` insert and **before** `backend.recordSale` (decision 4), add:
```ts
if (input.settlement.kind === "immediate") {
  // Same code both modes take (design D6). A shortfall/unsettled tender throws here,
  // aborting the whole transaction — the allocated invoice number and everything
  // written so far roll back, so a declined card leaves nothing chained (as before),
  // by atomicity rather than by an early pre-check.
  await settleSale(tx, {
    tenantId: input.tenantId,
    saleId,
    tenders: input.settlement.tenders,
  });
}
```
- Add `import { settleSale } from "./settle-sale.js";`.

- [ ] **Step 5: Run to verify pass**

`cd packages/core && TESTCONTAINERS_RYUK_DISABLED=true pnpm test record-sale` → PASS (after the test fixtures in this file are updated to the new input shape — do that as part of this step).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/record-sale.ts packages/core/src/record-sale.test.ts
git commit -s -m "feat(core): recordSale settlement mode (immediate|deferred); tip on tenders"
```

---

### Task 6: Migrate every caller + fixture

**Files (find them first — do not trust this list to be complete):**
```bash
rg -l 'recordSale|RecordSaleInput|RecordSaleTender' packages apps --include='*.ts' | grep -v node_modules
rg -l 'amount_charged|amountCharged' packages apps --include='*.ts' | grep -v node_modules
```
Known hits from 2026-08-01: `packages/payments/**` (several `*.wiring.test.ts`, `test/seed.ts`, `async-settle.concurrency.test.ts`), `packages/payments-stripe/**`, `packages/fiscal-verifactu/test/*` + `src/testing/seed.ts` + `backend.test.ts`, `packages/core/src/incidents.test.ts`, `apps/server/scripts/record-one-sale.ts`, and the five raw-SQL fixtures writing `amount_charged` (three are duplicated `seed.ts` copies — a reasonable moment to collapse them, design §6). The stale `sale.amountCharged` string literal has already moved out of `packages/db` into `scripts/english-only.test.ts` (design §7 dated note) — check whether it still needs removing there.

**Interfaces:**
- Consumes: the Task 5 `RecordSaleInput`/`RecordSaleTender` shapes and Task 4 `settleSale`.

- [ ] **Step 1: Update every `recordSale` caller**

Each call passing top-level `tipAmount` + `tenders` becomes `settlement: { kind: "immediate", tenders: [...] }`, with `tipAmount` moved onto each tender (default `"0.00"` where there was none). Remove top-level `tipAmount`. A caller that wants invoice-first uses `settlement: { kind: "deferred" }` and a later `settleSale`.

- [ ] **Step 2: Drop `amount_charged` from raw-SQL sale fixtures**

The five fixtures inserting `amount_charged` (and any inserting `tip_amount` on `sales`) must drop those columns — they no longer exist. Collapse the three duplicated `seed.ts` copies if practical.

- [ ] **Step 3: Run each affected package's suite**

Per package: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter <pkg> test:coverage` (unfiltered). Fix fallout until green.

- [ ] **Step 4: Commit**

```bash
git commit -s -am "refactor: migrate recordSale callers + fixtures to settlement model"
```

---

### Task 7: Full gate

**Files:** none — verification only.

- [ ] **Step 1: Whole-workspace gate**

```bash
pnpm install --frozen-lockfile
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/core test:coverage
pnpm vitest run --coverage            # repo-level project: english-only, guarded-teardowns, classifiers
pnpm lint && pnpm typecheck && pnpm format:check
pnpm test                             # four-command gate, whole-workspace breadth
```

- [ ] **Step 2: Confirm no unguarded teardown was added**

`scripts/guarded-teardowns.test.ts` must be green (the `settleSale` concurrency suite is the risk — it builds its own connections).

- [ ] **Step 3: Push + open PR**

Run the pre-push hook (it narrows to changed packages and their dependents, runs `test:coverage` + `--frozen-lockfile` + sign-off). Then `gh pr create`. CI's unfiltered `main`-merge run is the safety net for anything the package scope missed.

---

## Self-review

**Spec coverage** (design §-by-§): §3 schema — Task 1 (tenders tip + checks, `sale_settlements`, `sales` drops). §3 `tenders_amount_ck` tightening + both boundaries tested — Task 1 + Task 2 step 1. §4 API (`recordSale` mode, `settleSale`, `RecordSaleTender.tipAmount`, the three errors) — Tasks 3–5. §5 coverage machinery kept/moved + the tenders post-settlement guard + fail-open re-verification — Task 1 step 4 + Task 2 steps 4–5. §6 migration order + no backfill + fixture cleanup — Task 1 + Task 6. §7 testing (real-PG mandatory, deletion matrix, concurrency, mode equivalence, unfiltered gate) — Tasks 2, 4, 5, 7. §9 findings are context, not code (except the tip-on-tenders attribution, done in Task 1). **Gap check:** the `sale.voided` refusal and the `tender_unsettled`/`tender_shortfall` param reshape are additions the spec implied but did not spell out — surfaced as decisions 1–2 above.

**Placeholder scan:** every SQL and TS artifact is given in full; test steps carry concrete assertions or the exact behaviour to assert. The one deliberate deferral is the message-template/locale entries for the new codes (Task 3 step 1), because their catalog location is discovered by grepping the `already_voided` sibling rather than guessed — that is an instruction, not a placeholder.

**Type consistency:** `RecordSaleTender` gains `tipAmount: string` in Task 4/5 and is consumed by `settleSale` and `recordSale` identically. `settleSale(tx, SettleSaleInput)` signature matches its Task 5 call site. `saleSettlements` columns (`tenantId`, `saleId`, `settledAt`) match between the schema (Task 1), `settleSale` inserts (Task 4), and the tests. SQLSTATE `WT001` (reject_mutation) vs `WT002` (post-settlement guard) are distinct and used consistently.
