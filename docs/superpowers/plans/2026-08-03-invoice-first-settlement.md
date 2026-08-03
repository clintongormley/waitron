# Invoice-first headless settlement slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an invoice-first (deferred) sale that has been corrected by a rectificativa settleable
at the corrected (net) amount, add a `listOutstandingSales` reader, and a runnable server script that
walks the whole loop.

**Architecture:** The amount a sale is due becomes `total + sum(rectificativas that correct it) +
sum(tips)`. Two enforcers change in lockstep — the `SECURITY DEFINER` coverage function (migration
`0021`) and `settleSale`'s app-level check — so they cannot drift. A read-only `listOutstandingSales`
lists issued-but-unsettled ordinary sales (excluding correctives and F3 canje substitutes) with the
net due. A server script exercises issue → list → correct → list → settle.

**Tech Stack:** TypeScript (NodeNext, `.js` import specifiers), Drizzle ORM, PostgreSQL 18 +
PGlite, Vitest, pnpm workspace. Spec:
[docs/superpowers/specs/2026-08-03-invoice-first-settlement-design.md](../specs/2026-08-03-invoice-first-settlement-design.md).

## Global Constraints

- **Real Postgres for the coverage function** — PGlite makes every connection a superuser and cannot
  show the `sales_coverage_checker` fail-open behaviour. Run container suites with
  `TESTCONTAINERS_RYUK_DISABLED=true` (or they hang at the 180s hookTimeout).
- **Prove every guard by deletion** — remove the check, watch the test fail for the claimed reason,
  restore it.
- **Error codes name the domain concept, never the package**; never rename a shipped code. This slice
  reuses `sale.tender_shortfall` and introduces none. Any file throwing a `sale.*` code does
  `import "./errors.js"`.
- **No backfill** — nothing is deployed; the migration replaces a function body only, touching no
  data.
- **No new table** — so no FORCE-RLS / `inmutabilidad` guard applies.
- **Coverage thresholds** `98/98/98/95` for `@waitron/core` and `@waitron/db`. Run packages
  **unfiltered** with `test:coverage` (not plain `test`) so cross-cutting guard suites load.
- **`.js` import extensions are mandatory** (NodeNext over `.ts` sources). Barrel is re-exports only.
- **Migrations are sequential**; the next is `0021`. Never mix a tracked-schema change into a
  `--custom` migration.

## File map

- Modify: `packages/db/drizzle/0021_sale_settlement_correction_aware.sql` (new, `--custom`) +
  `meta/_journal.json` (idx 21, drizzle-kit-appended) + `meta/0021_snapshot.json` (copied forward by
  drizzle-kit) — the coverage-function replacement.
- Modify: `packages/core/src/settle-sale.ts` — net corrections into `due`.
- Modify: `packages/core/src/settle-sale.test.ts` — direct coverage-trigger tests (Task 1) and
  settleSale corrected-sale tests (Task 2).
- Create: `packages/core/src/list-outstanding-sales.ts` — the reader.
- Create: `packages/core/src/list-outstanding-sales.test.ts` — its tests (PGlite).
- Modify: `packages/core/src/index.ts` — export the reader.
- Create: `apps/server/scripts/settle-invoice-first.ts` — the demo script.
- Modify: `docs/backlog.md` — mark piece 4 done.

---

### Task 1: Migration `0021` — correction-aware coverage function + direct trigger tests

The DB enforcer. Tests insert `tenders` + `sale_settlements` **directly** (bypassing `settleSale`) so
this task proves the trigger nets corrections independently of the app-level check (Task 2).

**Files:**
- Create: `packages/db/drizzle/0021_sale_settlement_correction_aware.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`, `packages/db/drizzle/meta/0021_snapshot.json` (both by drizzle-kit)
- Test: `packages/core/src/settle-sale.test.ts`

**Interfaces:**
- Consumes: `sales_assert_tenders_cover(uuid)` (existing, from `0012_sale_settlement.sql`), fired by
  the `sale_settlements_check_coverage` trigger on `sale_settlements` INSERT.
- Produces: the same function, now computing
  `tendered = sale_total + coalesce(sum(correctives.total), 0) + tipped`.

- [ ] **Step 1: Write the failing tests** (append to `packages/core/src/settle-sale.test.ts`; the
  file already uses `useRealPostgres`, `withTenant`, `asAppUser`, `seedTenant`, `seedSale`,
  `SETTLED_AT`, and imports `sales`, `tenders`, `saleSettlements`, `captureError`).

```typescript
// Local helper: insert a rectificativa (negative or positive total) that corrects `originalId`.
async function seedCorrective(
  db: Database,
  seed: { tenantId: TenantId; tillId: TillId; nodeId: NodeId; seriesId: SeriesId },
  originalId: SaleId,
  overrides: { total: string; invoiceNumber: number },
): Promise<void> {
  await db.insert(sales).values({
    tenantId: seed.tenantId,
    tillId: seed.tillId,
    nodeId: seed.nodeId,
    seriesId: seed.seriesId,
    invoiceNumber: overrides.invoiceNumber,
    issuedAt: new Date("2026-08-01T11:30:00Z").toISOString(),
    issuedOffsetMinutes: 0,
    total: overrides.total, // negative allowed because correctsSaleId is set (sales_total_ck)
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    fiscalBackend: "fake",
    fiscalState: "recorded",
    correctsSaleId: originalId,
  });
}

// Insert tenders then a settlement row directly, as the app role — bypassing settleSale so the
// coverage TRIGGER is what is under test. Tenders first: tenders_reject_post_settlement (WT002)
// rejects a tender once a settlement row exists.
async function settleDirect(
  db: Database,
  tenantId: TenantId,
  saleId: SaleId,
  amount: string,
): Promise<void> {
  await withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    await tx.insert(tenders).values({
      tenantId,
      saleId,
      method: "cash",
      amount,
      tipAmount: "0.00",
      settledAt: SETTLED_AT.toISOString(),
    });
    await tx.insert(saleSettlements).values({ tenantId, saleId, settledAt: SETTLED_AT.toISOString() });
  });
}

describe("coverage trigger nets corrections", () => {
  it("accepts the net: 65 covers a 70 sale corrected by -5", async () => {
    const seed = await seedTenant(postgres.admin);
    const originalId = await seedSale(postgres.admin, seed, { total: "70.00", invoiceNumber: 1 });
    await seedCorrective(postgres.admin, seed, originalId, { total: "-5.00", invoiceNumber: 2 });

    await settleDirect(postgres.admin, seed.tenantId, originalId, "65.00");

    const settled = await postgres.admin
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, originalId));
    expect(settled).toHaveLength(1);
  });

  it("rejects the pre-correction total: 70 against a 70 sale corrected by -5 (net 65)", async () => {
    const seed = await seedTenant(postgres.admin);
    const originalId = await seedSale(postgres.admin, seed, { total: "70.00", invoiceNumber: 1 });
    await seedCorrective(postgres.admin, seed, originalId, { total: "-5.00", invoiceNumber: 2 });

    const error = await captureError(settleDirect(postgres.admin, seed.tenantId, originalId, "70.00"));
    expect(error).toBeDefined();

    const settled = await postgres.admin
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, originalId));
    expect(settled).toHaveLength(0);
  });

  it("negative control: an uncorrected sale still needs its exact total (65 rejected on a 70 sale)", async () => {
    const seed = await seedTenant(postgres.admin);
    const originalId = await seedSale(postgres.admin, seed, { total: "70.00", invoiceNumber: 1 });

    const error = await captureError(settleDirect(postgres.admin, seed.tenantId, originalId, "65.00"));
    expect(error).toBeDefined();

    const settled = await postgres.admin
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, originalId));
    expect(settled).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/core test settle-sale`
Expected: the first test ("accepts the net: 65 covers a 70 sale corrected by -5") FAILS — the current
trigger checks `65 <> 70` and raises, so no settlement row is written. (The other two pass already;
they assert the pre-change behaviour.)

- [ ] **Step 3: Generate the custom migration**

Run: `pnpm --filter @waitron/db db:generate:custom --name sale_settlement_correction_aware`
This writes an empty `packages/db/drizzle/0021_sale_settlement_correction_aware.sql`, appends
`{ "idx": 21, … "tag": "0021_sale_settlement_correction_aware" … }` to `meta/_journal.json`, and
copies `0020_snapshot.json` forward to `0021_snapshot.json` byte-identical (drizzle's snapshot model
has no concept of functions). If the tool prompts for a name instead of taking `--name`, supply
`sale_settlement_correction_aware`; if it auto-names differently, rename the `.sql` file and the
journal `tag` to match. Do NOT run plain `pnpm db:generate` — there is no schema-shape change.

- [ ] **Step 4: Write the migration SQL** into the generated file. Mirror `0012_sale_settlement.sql`'s
  owner-dance exactly (the function stays owned by `sales_coverage_checker`, `SECURITY DEFINER`).

```sql
-- 0021_sale_settlement_correction_aware.sql
-- Invoice-first headless settlement slice: settlement coverage nets rectificativas, so an
-- invoice-first sale corrected downward (a "take a fiver off") settles at the corrected amount.
-- docs/superpowers/specs/2026-08-03-invoice-first-settlement-design.md
--
-- Replaces the sales_assert_tenders_cover body from 0012. The function stays owned by
-- sales_coverage_checker and SECURITY DEFINER, so its SELECTs still see rows through the role-scoped
-- bypass policies regardless of app.tenant_id (the fail-open fix). The added SELECT is on `sales`,
-- which the checker already reads, so no new grant. Apply the body AS the owner via the same dance
-- 0012 used. The genuine non-superuser apply is exercised by
-- packages/provisioning/src/instance-apply.rls.test.ts, which applies this whole directory as
-- prov_admin (login createdb createrole; rolsuper=f, rolbypassrls=f): a wrong privilege fails there.
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
  sale_total  numeric(12, 2);
  corrections numeric(12, 2);
  tendered    numeric(12, 2);
  tipped      numeric(12, 2);
BEGIN
  SELECT total INTO sale_total FROM sales WHERE id = p_sale_id;
  IF sale_total IS NULL THEN
    RETURN;  -- the sale itself was rolled back; nothing left to reconcile
  END IF;

  -- Net in every rectificativa that corrects this sale (signed; usually negative). corrects_sale_id
  -- is a tenant-consistent FK, so this can only sum same-tenant correctives even though the definer
  -- sees every row.
  SELECT coalesce(sum(total), 0) INTO corrections
    FROM sales WHERE corrects_sale_id = p_sale_id;

  SELECT coalesce(sum(amount), 0), coalesce(sum(tip_amount), 0)
    INTO tendered, tipped
    FROM tenders WHERE sale_id = p_sale_id;

  IF tendered <> sale_total + corrections + tipped THEN
    RAISE EXCEPTION 'tenders for sale % total % but sale.total + corrections + tips is %',
      p_sale_id, tendered, sale_total + corrections + tipped;
  END IF;
END;
$$;
--> statement-breakpoint
RESET ROLE;
--> statement-breakpoint
REVOKE sales_coverage_checker FROM CURRENT_USER;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM sales_coverage_checker;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/core test settle-sale`
Expected: all three new tests PASS. The migration is applied by the real-PG harness (it runs the
whole `../db/drizzle` set).

- [ ] **Step 6: Prove the guard by deletion**

Temporarily delete the `corrections` term from the migration body — remove the
`SELECT coalesce(sum(total), 0) INTO corrections …` statement and change the check back to
`IF tendered <> sale_total + tipped THEN`. Re-run the suite: the "accepts the net" test must FAIL
(the trigger rejects 65 against 70) while the two controls still pass. Restore the term and re-run;
all green. (Because the real-PG harness re-applies migrations per run, editing the `.sql` file is
enough — no cache to clear.)

- [ ] **Step 7: Confirm the non-superuser apply still holds**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/provisioning test instance-apply.rls`
Expected: PASS — this applies `0021` as `prov_admin` (non-superuser, non-BYPASSRLS), so the
owner-dance is proven under the real deployment-role shape.

- [ ] **Step 8: Commit**

```bash
git add packages/db/drizzle/0021_sale_settlement_correction_aware.sql \
        packages/db/drizzle/meta/_journal.json packages/db/drizzle/meta/0021_snapshot.json \
        packages/core/src/settle-sale.test.ts
git commit -s -m "feat(db): settlement coverage nets rectificativas (migration 0021)"
```

---

### Task 2: `settleSale` — net corrections in the app-level check

The app enforcer, matching the trigger's identity so the two cannot drift.

**Files:**
- Modify: `packages/core/src/settle-sale.ts`
- Test: `packages/core/src/settle-sale.test.ts`

**Interfaces:**
- Consumes: `sales` (drizzle table, already imported), `and`/`eq` (drizzle-orm), `decimal`,
  `addDecimal`, `sumDecimals`, `compareDecimal` (`@waitron/shared`, already imported).
- Produces: `settleSale`'s `due` = `total + sum(correctives.total) + sum(tips)`;
  `sale.tender_shortfall`'s `due` param carries the net.

- [ ] **Step 1: Write the failing tests** (append to `packages/core/src/settle-sale.test.ts`; reuse
  the `seedCorrective` helper added in Task 1).

```typescript
describe("settleSale nets corrections into the due", () => {
  it("settles a corrected sale at the net (70 corrected by -5, pay 65)", async () => {
    const seed = await seedTenant(postgres.admin);
    const originalId = await seedSale(postgres.admin, seed, { total: "70.00", invoiceNumber: 1 });
    await seedCorrective(postgres.admin, seed, originalId, { total: "-5.00", invoiceNumber: 2 });

    await settle(postgres.admin, seed.tenantId, {
      tenantId: seed.tenantId,
      saleId: originalId,
      tenders: [{ method: "cash", amount: "65.00", tipAmount: "0.00", settledAt: SETTLED_AT }],
    });

    const settled = await postgres.admin
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, originalId));
    expect(settled).toHaveLength(1);
  });

  it("shortfall's due is the net: paying the pre-correction 70 on a -5-corrected sale is rejected", async () => {
    const seed = await seedTenant(postgres.admin);
    const originalId = await seedSale(postgres.admin, seed, { total: "70.00", invoiceNumber: 1 });
    await seedCorrective(postgres.admin, seed, originalId, { total: "-5.00", invoiceNumber: 2 });

    await expect(
      settle(postgres.admin, seed.tenantId, {
        tenantId: seed.tenantId,
        saleId: originalId,
        tenders: [{ method: "cash", amount: "70.00", tipAmount: "0.00", settledAt: SETTLED_AT }],
      }),
    ).rejects.toMatchObject({
      code: "sale.tender_shortfall",
      params: { saleId: originalId, due: "65.00", charged: "70.00" },
    });
  });

  it("nets a correcting-up rectificativa (70 corrected by +5, pay 75)", async () => {
    const seed = await seedTenant(postgres.admin);
    const originalId = await seedSale(postgres.admin, seed, { total: "70.00", invoiceNumber: 1 });
    await seedCorrective(postgres.admin, seed, originalId, { total: "5.00", invoiceNumber: 2 });

    await settle(postgres.admin, seed.tenantId, {
      tenantId: seed.tenantId,
      saleId: originalId,
      tenders: [{ method: "cash", amount: "75.00", tipAmount: "0.00", settledAt: SETTLED_AT }],
    });

    const settled = await postgres.admin
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, originalId));
    expect(settled).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/core test settle-sale`
Expected: "settles a corrected sale at the net" and "nets a correcting-up rectificativa" FAIL —
`settleSale` computes `due = 70` (ignores corrections), so 65/75 are shortfalls it throws before the
trigger. ("shortfall's due is the net" also fails: current `due` param is `"70.00"`, not `"65.00"`.)

- [ ] **Step 3: Implement — net corrections into `due`.** In `packages/core/src/settle-sale.ts`:
  add `and` to the drizzle-orm import (currently `import { eq } from "drizzle-orm";` →
  `import { and, eq } from "drizzle-orm";`), then insert the corrective sum immediately before the
  `const due = …` block at lines 66-69.

```typescript
  // Net in every rectificativa correcting this sale (design §2). Read RLS-scoped under the app role;
  // the explicit tenant predicate is redundant under RLS but guards a non-scoped connection too,
  // mirroring recordCorrection. sumDecimals over the fetched signed totals avoids the numeric-sum
  // string-render caveat.
  const correctives = await tx
    .select({ total: sales.total })
    .from(sales)
    .where(and(eq(sales.correctsSaleId, input.saleId), eq(sales.tenantId, input.tenantId)));
  const corrections = sumDecimals(correctives.map((c) => decimal(c.total)));

  const due = addDecimal(
    addDecimal(decimal(sale.total), corrections),
    sumDecimals(input.tenders.map((t) => decimal(t.tipAmount))),
  );
```

(The existing `const charged = …` and the `compareDecimal(charged, due)` shortfall throw below are
unchanged; `due` now carries the net.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/core test settle-sale`
Expected: all pass, including the pre-existing uncorrected and €0-comp tests (no corrections → the
new term is `"0"`, so `due` is unchanged).

- [ ] **Step 5: Prove the guard by deletion**

Temporarily revert `due` to `addDecimal(decimal(sale.total), sumDecimals(input.tenders.map((t) =>
decimal(t.tipAmount))))` (dropping `corrections`). The "settles a corrected sale at the net" test must
FAIL with `sale.tender_shortfall` (app computes `due = 70`, `charged = 65`) — proving the app-layer
netting, and that its failure is at the app layer (not the trigger). Restore.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/settle-sale.ts packages/core/src/settle-sale.test.ts
git commit -s -m "feat(core): settleSale nets rectificativas into the coverage check"
```

---

### Task 3: `listOutstandingSales` reader

Read-only, so PGlite is the default harness (mirroring `record-correction.test.ts`); no `SECURITY
DEFINER`, tenant-scoped by RLS plus an explicit predicate.

**Files:**
- Create: `packages/core/src/list-outstanding-sales.ts`
- Create: `packages/core/src/list-outstanding-sales.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `sales`, `saleSettlements`, `saleVoids`, `saleSubstitutions` (`@waitron/db`);
  `decimal`/`addDecimal`, `saleId as brandSaleId`, `tillId as brandTillId` (`@waitron/shared`).
- Produces:
  - `listOutstandingSales(tx: Transaction, tenantId: TenantId): Promise<OutstandingSale[]>`
  - `interface OutstandingSale { saleId: SaleId; invoiceNumber: number; issuedAt: string; tillId: TillId; total: Decimal; correctionTotal: Decimal; amountDue: Decimal }`

- [ ] **Step 1: Write the failing tests** — create `packages/core/src/list-outstanding-sales.test.ts`.

```typescript
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  asAppUser,
  sales,
  saleSettlements,
  saleSubstitutions,
  saleVoids,
  tenders,
  withTenant,
} from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import type { NodeId, SaleId, SeriesId, TenantId, TillId } from "@waitron/shared";
import { seedBareSale, seedTenant } from "../test/fixtures.js";
import { listOutstandingSales } from "./list-outstanding-sales.js";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

let tenantId: TenantId;
let tillId: TillId;
let nodeId: NodeId;
let seriesId: SeriesId;

beforeEach(async () => {
  ({ tenantId, tillId, nodeId, seriesId } = await seedTenant(suite.db));
});

function list() {
  return withTenant(suite.db, tenantId, async (tx) => {
    await asAppUser(tx);
    return listOutstandingSales(tx, tenantId);
  });
}

async function seedCorrective(originalId: SaleId, total: string, invoiceNumber: number): Promise<void> {
  await suite.db.insert(sales).values({
    tenantId,
    tillId,
    nodeId,
    seriesId,
    invoiceNumber,
    issuedAt: new Date("2026-08-01T11:30:00Z").toISOString(),
    issuedOffsetMinutes: 0,
    total,
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    fiscalBackend: "fake",
    fiscalState: "recorded",
    correctsSaleId: originalId,
  });
}

describe("listOutstandingSales", () => {
  it("lists an unsettled ordinary sale with amountDue = total", async () => {
    const saleId = await seedBareSale(suite.db, { tenantId, tillId, nodeId, seriesId }, { total: "70.00", invoiceNumber: 1 });
    const out = await list();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ saleId, total: "70.00", correctionTotal: "0.00", amountDue: "70.00" });
  });

  it("nets a rectificativa into amountDue and hides the corrective itself", async () => {
    const originalId = await seedBareSale(suite.db, { tenantId, tillId, nodeId, seriesId }, { total: "70.00", invoiceNumber: 1 });
    await seedCorrective(originalId, "-5.00", 2);
    const out = await list();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ saleId: originalId, total: "70.00", correctionTotal: "-5.00", amountDue: "65.00" });
  });

  it("hides a settled sale", async () => {
    const saleId = await seedBareSale(suite.db, { tenantId, tillId, nodeId, seriesId }, { total: "70.00", invoiceNumber: 1 });
    await withTenant(suite.db, tenantId, async (tx) => {
      await asAppUser(tx);
      await tx.insert(tenders).values({ tenantId, saleId, method: "cash", amount: "70.00", tipAmount: "0.00", settledAt: new Date("2026-08-01T12:00:00Z").toISOString() });
      await tx.insert(saleSettlements).values({ tenantId, saleId, settledAt: new Date("2026-08-01T12:00:00Z").toISOString() });
    });
    expect(await list()).toHaveLength(0);
  });

  it("hides a voided sale", async () => {
    const saleId = await seedBareSale(suite.db, { tenantId, tillId, nodeId, seriesId }, { total: "70.00", invoiceNumber: 1 });
    await suite.db.insert(saleVoids).values({ tenantId, saleId, reason: "test void", voidedAt: new Date("2026-08-01T12:00:00Z").toISOString() });
    expect(await list()).toHaveLength(0);
  });

  it("hides an F3 canje sale (the substitute), showing neither it nor its settled ticket", async () => {
    // A settled simplified ticket, then an F3 that substitutes it.
    const ticketId = await seedBareSale(suite.db, { tenantId, tillId, nodeId, seriesId }, { total: "70.00", invoiceNumber: 1 });
    await withTenant(suite.db, tenantId, async (tx) => {
      await asAppUser(tx);
      await tx.insert(tenders).values({ tenantId, saleId: ticketId, method: "cash", amount: "70.00", tipAmount: "0.00", settledAt: new Date("2026-08-01T12:00:00Z").toISOString() });
      await tx.insert(saleSettlements).values({ tenantId, saleId: ticketId, settledAt: new Date("2026-08-01T12:00:00Z").toISOString() });
    });
    const f3Id = await seedBareSale(suite.db, { tenantId, tillId, nodeId, seriesId }, { total: "70.00", invoiceNumber: 2 });
    await suite.db.insert(saleSubstitutions).values({ tenantId, substitutionSaleId: f3Id, substitutedSaleId: ticketId });

    const out = await list();
    expect(out.map((o) => o.saleId)).not.toContain(f3Id);
    expect(out).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @waitron/core test list-outstanding-sales`
Expected: FAIL — `listOutstandingSales` is not defined / module not found.

- [ ] **Step 3: Implement the reader** — create `packages/core/src/list-outstanding-sales.ts`.

```typescript
import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { addDecimal, decimal, saleId as brandSaleId, tillId as brandTillId } from "@waitron/shared";
import type { Decimal, SaleId, TenantId, TillId } from "@waitron/shared";

/**
 * A sale issued (invoice printed, chained, filed) but not yet paid — the answer to "what is owed?"
 * under invoice-first. `amountDue` is the printed `total` net of every rectificativa that corrects
 * it; a "take a fiver off" shows here as 65.00 against a 70.00 total (design §3).
 */
export interface OutstandingSale {
  saleId: SaleId;
  invoiceNumber: number;
  issuedAt: string;
  tillId: TillId;
  /** The printed invoice total. */
  total: Decimal;
  /** Signed sum of correctives; "0.00" when none. */
  correctionTotal: Decimal;
  /** total + correctionTotal — what a consumer would collect. */
  amountDue: Decimal;
}

/**
 * Lists a tenant's outstanding sales: ordinary altas (corrects_sale_id NULL) that are neither an F3
 * canje substitute (already paid via their tickets — AEAT "no cobrar dos veces"), settled, nor
 * voided. RLS scopes every table reference to the tenant; the explicit tenant predicate is redundant
 * under RLS but guards a non-scoped connection too (mirrors recordCorrection). No SECURITY DEFINER —
 * a plain read.
 */
export async function listOutstandingSales(
  tx: Transaction,
  tenantId: TenantId,
): Promise<OutstandingSale[]> {
  const result = await tx.execute<{
    sale_id: string;
    invoice_number: number;
    issued_at: string;
    till_id: string;
    total: string;
    correction_total: string;
  }>(sql`
    select
      s.id             as sale_id,
      s.invoice_number as invoice_number,
      s.issued_at      as issued_at,
      s.till_id        as till_id,
      s.total::text    as total,
      coalesce((select sum(c.total) from sales c where c.corrects_sale_id = s.id), 0)::numeric(12, 2)::text
        as correction_total
    from sales s
    where s.tenant_id = ${tenantId}
      and s.corrects_sale_id is null
      and not exists (select 1 from sale_settlements ss where ss.sale_id = s.id)
      and not exists (select 1 from sale_voids sv where sv.sale_id = s.id)
      and not exists (select 1 from sale_substitutions sub where sub.substitution_sale_id = s.id)
    order by s.issued_at
  `);

  return result.rows.map((r) => {
    const total = decimal(r.total);
    const correctionTotal = decimal(r.correction_total);
    return {
      saleId: brandSaleId(r.sale_id),
      invoiceNumber: r.invoice_number,
      issuedAt: r.issued_at,
      tillId: brandTillId(r.till_id),
      total,
      correctionTotal,
      amountDue: addDecimal(total, correctionTotal),
    };
  });
}
```

- [ ] **Step 4: Export from the barrel** — add to `packages/core/src/index.ts`, after the
  `recordSubstitution` exports:

```typescript
export { listOutstandingSales } from "./list-outstanding-sales.js";
export type { OutstandingSale } from "./list-outstanding-sales.js";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @waitron/core test list-outstanding-sales`
Expected: all five PASS.

- [ ] **Step 6: Prove the guards by deletion**

- Remove `and s.corrects_sale_id is null` → the "nets a rectificativa … hides the corrective" test
  must FAIL (the −5.00 corrective now appears; length 2). Restore.
- Remove the `sale_substitutions` `not exists` clause → the "hides an F3 canje sale" test must FAIL
  (the F3 appears; length 1). Restore.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/list-outstanding-sales.ts packages/core/src/list-outstanding-sales.test.ts packages/core/src/index.ts
git commit -s -m "feat(core): add listOutstandingSales, netting corrections and excluding F3 canje"
```

---

### Task 4: Server demo script

The human-runnable artifact. Not unit-tested (matches `record-one-sale.ts`, which has none and sits on
the coverage-excluded scripts side); verified by build + a documented manual run. All the logic it
wires — deferred `recordSale`, `recordCorrection`, `settleSale`, `listOutstandingSales` — is covered
by Tasks 1-3.

**Files:**
- Create: `apps/server/scripts/settle-invoice-first.ts`

**Interfaces:**
- Consumes: `recordSale`, `recordCorrection`, `settleSale`, `listOutstandingSales` (`@waitron/core`);
  `VerifactuBackend` (`@waitron/fiscal-verifactu`); `createPostgresDb`, `withTenant` (`@waitron/db`);
  the decimal + brand helpers (`@waitron/shared`); `deploymentEnvironment` (`../src/config.js`).

- [ ] **Step 1: Write the script.** Model it on
  [`apps/server/scripts/record-one-sale.ts`](../../../apps/server/scripts/record-one-sale.ts): same
  `DATABASE_URL`-only connection string, required `WAITRON_ENV`, same `VerifactuBackend` construction
  and `systemClock`, no `asAppUser` (the DB role comes from `DATABASE_URL`, exactly as
  `record-one-sale`). Prerequisite (as `record-one-sale`): the tenant/till/node/**standard** series
  and a **rectificative** series must already be provisioned and the node's SIF registered.

  The demo scenario is hardcoded for clean arithmetic at 10% VAT: sale base `100.00` → total
  `110.00`; a −`10.00` base correction → corrective total `−11.00`; net `99.00`. Totals are computed
  with the same `tax = (base × rate) / 100` formula `record-one-sale` uses, so they agree with the
  VAT breakdown `recordSale`/`recordCorrection` derive from the lines.

```typescript
// Walks the invoice-first + correction + settle loop end to end, then exits. Issues an invoice-first
// (deferred) sale, prints it as outstanding, corrects it with a rectificativa, prints the reduced
// amount outstanding, settles at the net, prints an empty outstanding list. There is no till app yet
// — this is the only way to see the deferred/settle path run against the real backend.
//
// Prerequisites, same as record-one-sale.ts plus a rectificative series: the tenant/till/node/
// standard-series/rectificative-series must already exist and the node's SIF be registered.
//
// Usage — build first (this repo's .js-suffixed relative imports resolve through esbuild's bundler,
// not plain `node <file>.ts`):
//   pnpm --filter @waitron/server build
//   DATABASE_URL=postgres://... WAITRON_ENV=production|preproduction \
//     node apps/server/dist/settle-invoice-first.js \
//     <tenantId> <tillId> <nodeId> <standardSeriesId> <rectificativeSeriesId>
//
// The connection string is read ONLY from DATABASE_URL. WAITRON_ENV is REQUIRED (it stamps the
// unrecoverable `entorno` onto the chain) — see record-one-sale.ts's header for why no default.
import { listOutstandingSales, recordCorrection, recordSale, settleSale } from "@waitron/core";
import type { RecordCorrectionInput, RecordSaleInput } from "@waitron/core";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { TrustedClock } from "@waitron/fiscal";
import { createPostgresDb, withTenant } from "@waitron/db";
import { deploymentEnvironment } from "../src/config.js";
import {
  addDecimal,
  decimal,
  divideDecimal,
  multiplyDecimal,
  MONEY_SCALE,
  negateDecimal,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { randomUUID } from "node:crypto";

const LOCALE = "es-ES";

function usageError(message: string): never {
  console.error(`settle-invoice-first: ${message}`);
  console.error(
    "usage: DATABASE_URL=<...> WAITRON_ENV=<production|preproduction> " +
      "node apps/server/dist/settle-invoice-first.js " +
      "<tenantId> <tillId> <nodeId> <standardSeriesId> <rectificativeSeriesId>",
  );
  process.exit(1);
}

// Same one-shot host clock as record-one-sale.ts (anchor/currentAnchor are never called by these
// write paths).
function systemClock(): TrustedClock {
  return {
    now: () => {
      const instant = new Date();
      return { instant, offsetMinutes: -instant.getTimezoneOffset(), confident: true, confidence: "anchored", anchorAgeSeconds: 0 };
    },
    anchor: () => {
      throw new Error("settle-invoice-first: anchor() is not used");
    },
    currentAnchor: () => null,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 5) {
    usageError(`expected 5 arguments, got ${args.length}`);
  }
  const [tenantArg, tillArg, nodeArg, stdSeriesArg, rectSeriesArg] = args;

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    usageError("DATABASE_URL must be set in the environment");
  }
  const rawEnv = process.env.WAITRON_ENV;
  if (rawEnv === undefined || rawEnv === "") {
    usageError("WAITRON_ENV must be set in the environment (production or preproduction)");
  }

  const tenant = brandTenantId(tenantArg);
  const till = brandTillId(tillArg);
  const node = brandNodeId(nodeArg);
  const stdSeries = brandSeriesId(stdSeriesArg);
  const rectSeries = brandSeriesId(rectSeriesArg);

  const rate = decimal("10.00");
  const saleBase = decimal("100.00");
  const saleTax = divideDecimal(multiplyDecimal(saleBase, rate), decimal("100"), MONEY_SCALE);
  const saleTotal = addDecimal(saleBase, saleTax); // 110.00

  const reduceBase = decimal("10.00");
  const corrBase = negateDecimal(reduceBase); // -10.00
  const corrTax = divideDecimal(multiplyDecimal(corrBase, rate), decimal("100"), MONEY_SCALE);
  const corrTotal = addDecimal(corrBase, corrTax); // -11.00
  const net = addDecimal(saleTotal, corrTotal); // 99.00

  const db = await createPostgresDb(databaseUrl);
  try {
    const clock = systemClock();
    const backend = new VerifactuBackend({
      clock,
      db,
      environment: deploymentEnvironment(process.env),
      deploymentEnvironment: deploymentEnvironment(process.env),
      resolveClient: () => Promise.reject(new Error("settle-invoice-first: resolveClient must never be called")),
    });

    // 1. Issue invoice-first (deferred): the invoice is chained + filed, unpaid.
    const saleInput: RecordSaleInput = {
      tenantId: tenant,
      tillId: till,
      nodeId: node,
      seriesId: stdSeries,
      workingOrderId: brandWorkingOrderId(randomUUID()),
      locale: LOCALE,
      invoiceLocales: [LOCALE],
      total: saleTotal,
      lines: [{ lineNo: 1, descriptions: { [LOCALE]: "Comida" }, quantity: "1", unitPrice: saleBase, vatRate: rate, lineTotal: saleBase }],
      settlement: { kind: "deferred" },
      fiscalBackend: "verifactu",
      clock,
    };
    const sale = await withTenant(db, tenant, (tx) => recordSale(tx, backend, saleInput));
    console.log(`1. issued invoice-first sale ${sale.saleId} (total ${saleTotal}), fiscal ${sale.fiscal.recordId}`);

    // 2. Outstanding: the full total.
    const before = await withTenant(db, tenant, (tx) => listOutstandingSales(tx, tenant));
    console.log(`2. outstanding: ${before.map((o) => `${o.saleId}=${o.amountDue}`).join(", ")}`);

    // 3. Correct it down by 5.00 (net) via a rectificativa on the rectificative series.
    const corrInput: RecordCorrectionInput = {
      tenantId: tenant,
      tillId: till,
      nodeId: node,
      seriesId: rectSeries,
      correctsSaleId: sale.saleId,
      total: corrTotal,
      lines: [{ lineNo: 1, descriptions: { [LOCALE]: "Descuento" }, quantity: "1", unitPrice: corrBase, vatRate: rate, lineTotal: corrBase }],
      fiscalBackend: "verifactu",
      clock,
    };
    const corr = await withTenant(db, tenant, (tx) => recordCorrection(tx, backend, corrInput));
    console.log(`3. issued rectificativa ${corr.saleId} (total ${corrTotal}), fiscal ${corr.fiscal.recordId}`);

    // 4. Outstanding: now the net.
    const afterCorrection = await withTenant(db, tenant, (tx) => listOutstandingSales(tx, tenant));
    console.log(`4. outstanding: ${afterCorrection.map((o) => `${o.saleId}=${o.amountDue}`).join(", ")}`);

    // 5. Settle at the net.
    await withTenant(db, tenant, (tx) =>
      settleSale(tx, {
        tenantId: tenant,
        saleId: sale.saleId,
        tenders: [{ method: "cash", amount: net, tipAmount: "0.00", settledAt: clock.now().instant }],
      }),
    );
    console.log(`5. settled ${sale.saleId} at ${net}`);

    // 6. Outstanding: empty.
    const afterSettle = await withTenant(db, tenant, (tx) => listOutstandingSales(tx, tenant));
    console.log(`6. outstanding: ${afterSettle.length === 0 ? "(none)" : afterSettle.map((o) => `${o.saleId}=${o.amountDue}`).join(", ")}`);
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error("settle-invoice-first: failed");
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it typechecks and builds**

Run: `pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/server build`
Expected: PASS. If `apps/server/vitest.config.ts` excludes `scripts/**` from coverage (as it must for
`record-one-sale.ts`), the new script inherits that exclusion — confirm the pattern covers
`scripts/settle-invoice-first.ts`; if it names files individually, add this one.

- [ ] **Step 3: Commit**

```bash
git add apps/server/scripts/settle-invoice-first.ts
git commit -s -m "feat(server): settle-invoice-first demo script (issue -> correct -> settle at net)"
```

---

### Task 5: Backlog update + full gate

**Files:**
- Modify: `docs/backlog.md`

- [ ] **Step 1: Update `docs/backlog.md`.** In the fiscal-sequence table (§"Next — the fiscal
  sequence"), change piece 4's row to **done** and note what shipped: the fiscal/DB half was already
  #39, and this slice added correction-aware settlement (migration 0021 + `settleSale`),
  `listOutstandingSales`, and the `settle-invoice-first` script. Add a one-line pointer to the spec
  ([2026-08-03-invoice-first-settlement-design.md](superpowers/specs/2026-08-03-invoice-first-settlement-design.md))
  and this plan. Note the "then reassess" point (fiscal reporting vs the till) is now live. Record any
  follow-up under *Debt and odd jobs* if one surfaced during the build (e.g. the alta-builder
  triplication in `backend.ts` is unaffected; nothing new is expected).

- [ ] **Step 2: Run the full gate**

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/core test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/provisioning test instance-apply.rls
pnpm lint && pnpm typecheck && pnpm format:check
```

Expected: all green. `@waitron/core` and `@waitron/db` run **unfiltered** so their cross-cutting
guard suites (english-only tokens, schema-ownership, reachability) load. If `format:check` flags the
script or SQL, run `pnpm format` and re-check.

- [ ] **Step 3: Commit the backlog update**

```bash
git add docs/backlog.md
git commit -s -m "docs(backlog): invoice-first headless settlement slice landed (piece 4)"
```

- [ ] **Step 4: Finish the branch.** Use `/finish-branch` (simplify → review → rebase → PR → CI +
  Copilot). Address findings, then land with `/land-branch` on the user's approval. This is a code PR
  (not the docs carve-out), so it runs the full CI.

---

## Self-review

**Spec coverage** (against [the spec](../specs/2026-08-03-invoice-first-settlement-design.md)):
- §1/D1 correction-aware `due` → Tasks 1 (trigger) + 2 (app). ✓
- §1/D2 both enforcers in lockstep → Task 1 SQL + Task 2 `settleSale`, identical identity. ✓
- §1/D3 no new error code → Task 2 reuses `sale.tender_shortfall`. ✓
- §1/D4 correctives never settled → covered by the reader excluding them (Task 3) and the negative
  `due` being uncoverable; not separately built. ✓
- §1/D5 `listOutstandingSales` → Task 3. ✓
- §1/D6 server script → Task 4. ✓
- §1/D7 no new table / no fiscal-chain change / no backfill → nothing in any task adds these. ✓
- §2 migration owner-dance + non-superuser apply → Task 1 Steps 4, 7. ✓
- §2 concurrency boundary (trigger is arbiter) → asserted in the design; the trigger test (Task 1)
  and app test (Task 2) each exercise their own enforcer. No dedicated race test — matches the spec,
  which treats the trigger re-read as the fail-closed backstop rather than adding locking. ✓
- §3 reader exclusions (corrective, F3, settled, voided) + net → Task 3, all four proven. ✓
- §5 real-PG for the coverage function, proven by deletion → Task 1 Steps 5-7. ✓
- §6 out of scope (partial payment, till UI, amendment log, precuenta, backfill) → nothing builds
  them. ✓

**Placeholder scan:** none — every step has the actual SQL/TS/commands. The one deferred item (the
script's coverage-exclusion pattern) is a concrete conditional check, not a TODO.

**Type consistency:** `listOutstandingSales(tx, tenantId)` and `OutstandingSale` match between Task 3's
Produces block, the implementation, the barrel export, and Task 4's consumption. `seedCorrective` is
defined once in `settle-sale.test.ts` (Task 1) and reused in Task 2; the reader test defines its own
(different signature, PGlite `suite.db`) deliberately. `sale.tender_shortfall` params
(`{ tillId, saleId, due, charged }`) are unchanged. Migration function signature
`sales_assert_tenders_cover(uuid)` is unchanged.
