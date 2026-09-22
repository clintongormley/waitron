import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  asAppUser,
  captureError,
  isPgError,
  pgErrorCode,
  POST_SETTLEMENT_REFUSAL,
  sales,
  saleSettlements,
  saleVoids,
  tenders,
  triggerRaised,
  withTransaction,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { AppError, saleId as brandSaleId, decimal, decimalToCents } from "@waitron/shared";
import type { NodeId, SaleId, SeriesId, TillId } from "@waitron/shared";
import { seedTenant } from "../test/fixtures.js";
import { settleSale } from "./settle-sale.js";
import type { SettleSaleInput } from "./settle-sale.js";

/**
 * CORE then IDENTITY — the pair the deleted `core_identity` template this file cloned was built
 * from (`git show origin/main:packages/core/src/testing/global-setup.ts`). Kept as the pair rather
 * than narrowed to CORE, so the fixture is the one the suite always had.
 *
 * This file no longer has "two backends" available to it, and one describe changed subject because
 * of it — see `settleSale — two settlements started together`.
 */
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS], timeoutMs: 60_000 });

const SETTLED_AT = new Date("2026-08-01T12:00:00Z");

/**
 * Inserts one `sales` row on the seeding connection: `total` is the only money column left (the tip moved to `tenders.tip_amount` and
 * `amount_charged` was dropped in migration 0012), and `node_id` is NOT NULL (node-id rekey).
 * `correctsSaleId` defaults to NULL for an ordinary sale; pass it to seed a corrective invoice correcting
 * another sale (its negative/positive total is what `sales_total_ck` permits once it is set).
 *
 * `total` is given as the decimal amount a reader of these cases recognises and converted to the
 * count of whole cents the column stores on the way in, so this fixture is the same edge
 * `recordSale` is.
 */
async function seedSale(
  db: Database,
  seed: { tillId: TillId; nodeId: NodeId; seriesId: SeriesId },
  overrides: { total?: string; invoiceNumber?: number; correctsSaleId?: SaleId } = {},
): Promise<SaleId> {
  const [row] = await db
    .insert(sales)
    .values({
      tillId: seed.tillId,
      nodeId: seed.nodeId,
      seriesId: seed.seriesId,
      invoiceNumber: overrides.invoiceNumber ?? 1,
      issuedAt: new Date("2026-08-01T11:00:00Z").toISOString(),
      issuedOffsetMinutes: 0,
      total: decimalToCents(decimal(overrides.total ?? "65.00")),
      // The filed per-rate breakdown; `[]` — this file exercises settlement, not the
      // breakdown, and the column just needs a valid NOT NULL jsonb array.
      vatBreakdown: [],
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      fiscalBackend: "fake",
      fiscalState: "recorded",
      correctsSaleId: overrides.correctsSaleId,
    })
    .returning({ id: sales.id });
  return brandSaleId(row!.id);
}

/**
 * Runs `settleSale` inside one transaction as the non-superuser app role.
 */
function settle(db: Database, input: SettleSaleInput): Promise<void> {
  return withTransaction(db, async (tx) => {
    await asAppUser(tx);
    await settleSale(tx, input);
  });
}

describe("settleSale — the happy path", () => {
  it("writes tenders + a settlement row when tenders cover total + tips", async () => {
    const seed = await seedTenant(suite.db);
    const saleId = await seedSale(suite.db, seed, { total: "65.00" });

    // total 65.00 → 70.00 = 65.00 + 5.00 covers.
    await settle(suite.db, {
      saleId,
      tenders: [
        {
          method: "cash",
          amount: "70.00",
          cashTendered: "100.00",
          tipAmount: "5.00",
          settledAt: SETTLED_AT,
        },
      ],
    });

    const settled = await suite.db
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, saleId));
    expect(settled).toHaveLength(1);
    // The tender's own moment, round-tripped through Postgres. Compared as an instant rather than
    // as a string literal: a `timestamptz` read back through the driver is rendered in the session
    // timezone (`2026-08-01 12:00:00+00`), not as the ISO string it was written from — the same
    // reason `record-sale.test.ts` and `manual.test.ts` both wrap the read in `new Date(...)`.
    // **Deviation from the brief**, whose `toBe("2026-08-01T12:00:00.000Z")` assumes the ISO form.
    expect(new Date(settled[0]!.settledAt).getTime()).toBe(SETTLED_AT.getTime());

    const tenderRows = await suite.db.select().from(tenders).where(eq(tenders.saleId, saleId));
    expect(tenderRows).toHaveLength(1);
    // Read straight off the table, so these are counts of whole cents, not decimal literals.
    expect(tenderRows[0]!.amount).toBe(7000);
    expect(tenderRows[0]!.tipAmount).toBe(500);
    expect(tenderRows[0]!.cashTendered).toBe(10000);
    // `async () =>`, not `() =>`: this adapter's `execute` returns a `RawResult` synchronously
    // rather than a promise, and `captureError` takes a `() => Promise<unknown>` (TS2739).
    const mutation = await captureError(async () =>
      suite.db.execute(sql`update tenders set cash_tendered = 20000 where sale_id = ${saleId}`),
    );
    // Was `pgErrorCode(mutation)).toBe("WT001")`, the append-only trigger's PostgreSQL SQLSTATE.
    // That cannot be kept in any form: `pgErrorCode` answers `ERR_SQLITE_ERROR` for EVERY failure
    // on this engine (`packages/db/src/testing/errors.ts`), so a translated `.toBe(...)` would
    // pass for a NOT NULL, a foreign key or a typo just as readily. `triggerRaised` asks the two
    // questions that together identify one of OUR triggers — the result class AND the exact words
    // it raised (`packages/db/src/constraint-target.ts`) — which is strictly more than the
    // SQLSTATE established. The words come from `installAppendOnlyTriggers`
    // (`packages/store/src/append-only.ts`: `<table> is append-only`).
    expect(triggerRaised(mutation, "tenders is append-only")).toBe(true);
  });

  it.each([
    { method: "cash", cashTendered: "64.99" },
    { method: "card", cashTendered: "100.00" },
  ])("rejects invalid cash handed over for $method and rolls settlement back", async (cash) => {
    const seed = await seedTenant(suite.db);
    const saleId = await seedSale(suite.db, seed);
    const error = await captureError(() =>
      settle(suite.db, {
        saleId,
        tenders: [{ ...cash, amount: "65.00", tipAmount: "0.00", settledAt: SETTLED_AT }],
      }),
    );
    // Was `.toBe("23514")`, PostgreSQL's CHECK SQLSTATE. `isPgError(error, CHECK_VIOLATION)` is
    // the same question on this engine's own numbering (275), and the idiom the already-converted
    // `packages/workforce/src/migrations.test.ts` uses throughout. NOT `pgErrorCode`, which
    // answers the same string for every failure here.
    expect(isPgError(error, CHECK_VIOLATION)).toBe(true);
    expect(await suite.db.select().from(tenders).where(eq(tenders.saleId, saleId))).toEqual([]);
    expect(
      await suite.db.select().from(saleSettlements).where(eq(saleSettlements.saleId, saleId)),
    ).toEqual([]);
  });

  it("settles a €0 comped sale with no tenders, stamped at the settlement instant (no raw TypeError)", async () => {
    // A fully-comped sale is €0 and has NO payment: `tenders_amount_ck` forbids a €0 tender, so a
    // comp is genuinely tenderless. The schema permits the settlement — `sales_total_ck` allows a
    // total of 0, and the coverage trigger's `coalesce(sum(amount),0)` makes `0 = 0 + 0` hold — so
    // `settleSale` must RECORD it, not crash on an empty `reduce`/empty `insert().values([])`. With
    // no tender to time it by, the settlement stamps its OWN instant (`new Date()`, like
    // `record-void.ts`), NOT the sale's `issued_at`: in invoice-first mode settlement runs long
    // after the invoice printed, and backdating an append-only row to issuance cannot be corrected.
    const seed = await seedTenant(suite.db);
    const saleId = await seedSale(suite.db, seed, { total: "0.00" });

    // Window the settle call so the stamped instant is pinned to the actual settlement moment, not
    // the seed's issued_at (11:00Z). `before`/`after` bracket the real `new Date()` inside settleSale.
    const before = new Date();
    await settle(suite.db, {
      saleId,
      tenders: [],
    });
    const after = new Date();

    const [settled] = await suite.db
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, saleId));
    expect(settled).toBeDefined();
    const settledAt = new Date(settled!.settledAt).getTime();
    // The settlement's own instant: within the call window …
    expect(settledAt).toBeGreaterThanOrEqual(before.getTime());
    expect(settledAt).toBeLessThanOrEqual(after.getTime());
    // … and strictly LATER than the seed's issued_at (11:00Z), proving it is the settlement instant
    // rather than the print instant a backdating implementation would have copied.
    expect(settledAt).toBeGreaterThan(new Date("2026-08-01T11:00:00Z").getTime());

    const tenderRows = await suite.db.select().from(tenders).where(eq(tenders.saleId, saleId));
    expect(tenderRows).toHaveLength(0);
  });

  it("stamps the settlement at the LATEST tender's settledAt, across a split payment", async () => {
    // Decision ⑤: settled_at is the moment the last tender landed. Two tenders settling at
    // different times prove the reduce picks the max rather than the first/last positionally.
    const seed = await seedTenant(suite.db);
    const saleId = await seedSale(suite.db, seed, { total: "65.00" });
    const earlier = new Date("2026-08-01T12:00:00Z");
    const later = new Date("2026-08-01T18:30:00Z");

    await settle(suite.db, {
      saleId,
      // 40.00 + 25.00 = 65.00 = total + 0 tips. `later` is supplied on the FIRST tender to prove
      // the max is by value, not by array position.
      tenders: [
        { method: "card", amount: "40.00", tipAmount: "0.00", settledAt: later },
        { method: "cash", amount: "25.00", tipAmount: "0.00", settledAt: earlier },
      ],
    });

    const [settled] = await suite.db
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, saleId));
    expect(new Date(settled!.settledAt).getTime()).toBe(later.getTime());
  });
});

describe("settleSale — guards", () => {
  it("throws sale.tender_unsettled for a null settledAt", async () => {
    const seed = await seedTenant(suite.db);
    const saleId = await seedSale(suite.db, seed, { total: "65.00" });

    await expect(
      settle(suite.db, {
        saleId,
        tenders: [{ method: "cash", amount: "65.00", tipAmount: "0.00", settledAt: null }],
      }),
    ).rejects.toMatchObject({
      code: "sale.tender_unsettled",
      params: { saleId, unsettledCount: 1 },
    });

    // Refused before any write: the sale stays unsettled and retryable.
    const settled = await suite.db
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, saleId));
    expect(settled).toHaveLength(0);
  });

  it("throws sale.tender_shortfall when sum(amount) != total + sum(tip)", async () => {
    const seed = await seedTenant(suite.db);
    const saleId = await seedSale(suite.db, seed, { total: "65.00" });

    // 60.00 charged against a 65.00 due — under-coverage.
    await expect(
      settle(suite.db, {
        saleId,
        tenders: [{ method: "cash", amount: "60.00", tipAmount: "0.00", settledAt: SETTLED_AT }],
      }),
    ).rejects.toMatchObject({
      code: "sale.tender_shortfall",
      params: { saleId, due: "65.00", charged: "60.00" },
    });

    const tenderRows = await suite.db.select().from(tenders).where(eq(tenders.saleId, saleId));
    expect(tenderRows).toHaveLength(0);
  });

  it("throws sale.not_found for an unknown sale id", async () => {
    await expect(
      settle(suite.db, {
        saleId: brandSaleId("00000000-0000-4000-8000-000000000000"),
        tenders: [{ method: "cash", amount: "65.00", tipAmount: "0.00", settledAt: SETTLED_AT }],
      }),
    ).rejects.toMatchObject({ code: "sale.not_found" });
  });

  it("throws sale.voided when the sale carries a sale_voids row", async () => {
    const seed = await seedTenant(suite.db);
    const saleId = await seedSale(suite.db, seed, { total: "65.00" });
    await suite.db.insert(saleVoids).values({
      saleId,
      reason: "Wrong table",
      voidedAt: new Date("2026-08-01T11:30:00Z").toISOString(),
    });

    await expect(
      settle(suite.db, {
        saleId,
        tenders: [{ method: "cash", amount: "65.00", tipAmount: "0.00", settledAt: SETTLED_AT }],
      }),
    ).rejects.toMatchObject({ code: "sale.voided", params: { saleId } });
  });

  it("throws sale.already_settled on a second (sequential) settle", async () => {
    const seed = await seedTenant(suite.db);
    const saleId = await seedSale(suite.db, seed, { total: "65.00" });
    const input: SettleSaleInput = {
      saleId,
      tenders: [{ method: "cash", amount: "65.00", tipAmount: "0.00", settledAt: SETTLED_AT }],
    };

    await settle(suite.db, input);
    // The second attempt is caught by the pre-check SELECT, not the UNIQUE violation (that is the
    // concurrent path below).
    await expect(settle(suite.db, input)).rejects.toMatchObject({
      code: "sale.already_settled",
      params: { saleId },
    });

    const settled = await suite.db
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, saleId));
    expect(settled).toHaveLength(1);
  });
});

describe("settleSale — two settlements started together", () => {
  it("lets exactly one settlement win; the loser surfaces sale.already_settled", async () => {
    // ## What this case used to be, and the ONE thing it no longer establishes
    //
    // It opened two PostgreSQL backends, had the holder run `settleSale` fully and pause BEFORE
    // commit — so its `sale_settlements` UNIQUE key was held but invisible — then let the waiter
    // through. The waiter's pre-check SELECT saw nothing, it inserted its tenders, and it collided
    // on that UNIQUE key. The point was design decision ③: **the UNIQUE constraint, not the
    // pre-check SELECT, is the real control.**
    //
    // **LOST: exactly that.** There is one connection and one write transaction at a time, so a
    // second caller can never observe the state the first has written but not committed. Whichever
    // order the queue picks, the loser's pre-check now SEES the committed settlement and throws
    // `sale.already_settled` from there — the UNIQUE path is unreachable through the public verb.
    // This case can no longer tell "the pre-check arbitrated" from "the UNIQUE arbitrated", and
    // nothing else in the tree can either. The constraint is still in the schema and still the
    // backstop for any writer that does not go through `settleSale`; what is gone is the test that
    // proved it load-bearing. (Same shape as the two working-order cases the storage swap's
    // disposition ledger records under "exist to reach the unique-violation CATCH".)
    //
    // ## What it still proves, and why it was not deleted
    //
    // Two callers starting together end with exactly ONE settlement and ONE tender, and the loser
    // gets the structured `sale.already_settled` rather than a raw driver error. That is the
    // outcome a till's retry depends on, and it is NOT the sequential case above: this one starts
    // both before either has finished, which is the arrangement the venue file's write queue has
    // to flatten (`packages/store/src/write-queue.ts`).
    const seed = await seedTenant(suite.db);
    const saleId = await seedSale(suite.db, seed, { total: "65.00" });
    const input: SettleSaleInput = {
      saleId,
      tenders: [{ method: "cash", amount: "65.00", tipAmount: "0.00", settledAt: SETTLED_AT }],
    };

    // Started together and NOT awaited in turn.
    const [a, b] = await Promise.allSettled([settle(suite.db, input), settle(suite.db, input)]);
    const outcomes = [a, b];
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === "rejected");
    const loser = (rejected as PromiseRejectedResult).reason as unknown;
    expect(loser).toBeInstanceOf(AppError);
    expect((loser as AppError).code).toBe("sale.already_settled");
    expect((loser as AppError).params).toMatchObject({ saleId });

    // Exactly one settlement, and exactly the winner's single tender — the loser's tender rolled
    // back with its whole transaction.
    const settled = await suite.db
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, saleId));
    expect(settled).toHaveLength(1);
    const tenderRows = await suite.db.select().from(tenders).where(eq(tenders.saleId, saleId));
    expect(tenderRows).toHaveLength(1);
  });
});

describe("settleSale — error propagation", () => {
  it("rethrows a non-unique error from the settlement insert, untranslated", async () => {
    // The settlement insert's OTHER failure path. `settleSale` catches the `sale_settlements` UNIQUE
    // violation and maps it to `sale.already_settled`; ANY other database failure (a future
    // constraint, a transport error) must reach the caller as-is rather than be mislabelled as
    // already-settled. Mirrors record-void.test.ts's identical "propagates a database error that is
    // not a unique violation" stub for recordVoid's analogous catch/rethrow. A hand-built
    // Transaction stub, not the real PGlite/PG one: there is no second schema-level constraint on
    // `sale_settlements` to provoke a genuinely different SQLSTATE, so this drives settleSale's own
    // catch/rethrow branch directly. A tenderless (€0) settlement so the ONLY insert reached is the
    // `sale_settlements` one that rejects — no tender insert runs before it.
    let selects = 0;
    const fakeTx = {
      select: () => ({
        from: () => ({
          // 1: the sale row — `total` as the typed column hands it back (a count of whole cents)
          // and `corrections` as the raw `::text` subquery does (that count as a STRING);
          // 2: sale_voids (none); 3: settlement (none).
          where: () => {
            selects += 1;
            return selects === 1
              ? Promise.resolve([{ tillId: "t", total: 0, corrections: "0" }])
              : Promise.resolve([]);
          },
        }),
      }),
      insert: () => ({
        values: () => Promise.reject(Object.assign(new Error("disk full"), { code: "53100" })),
      }),
    } as unknown as Transaction;

    const error = await captureError(() =>
      settleSale(fakeTx, {
        saleId: brandSaleId("11111111-1111-4111-8111-111111111111"),
        tenders: [],
      }),
    );
    expect(error).not.toBeInstanceOf(AppError);
    expect(pgErrorCode(error)).toBe("53100");
  });

  it("translates the tenders post-settlement guard to sale.already_settled", async () => {
    // The OTHER concurrent-loser interleaving, driven directly. The real-PG race above forces the
    // loser onto the `sale_settlements` UNIQUE; here the winner has already COMMITTED, so the
    // loser's tender INSERT trips the `tenders_reject_post_settlement` trigger instead. That
    // trigger fires iff a settlement row already exists for the sale, so its refusal on the tender
    // insert always means "already settled" and must surface as `sale.already_settled` — the same
    // code the UNIQUE path maps to — rather than a raw driver error a retry/idempotency caller
    // would not recognise. A hand-built Transaction stub (like the rethrow test above): the
    // deterministic post-commit interleaving is awkward to force on a live DB, and this drives
    // settleSale's own tenders-insert catch/translate branch directly. Tenders are PRESENT (unlike
    // the €0 rethrow test) so the tenders INSERT — the one the trigger fires on — is reached.
    //
    // The refused error carries what a `RAISE(ABORT, …)` really arrives with on this engine: the
    // raise text as the message, and `errcode` 1811. Measured 2026-09-22 against `node:sqlite` on
    // Node v26.7.0; the refusal is driven for real in
    // `packages/db/src/constraint-target.sqlite.test.ts`.
    let selects = 0;
    const fakeTx = {
      select: () => ({
        from: () => ({
          // 1: the sale row (6500 cents = 65.00, no corrections); 2: sale_voids (none);
          // 3: settlement (none).
          where: () => {
            selects += 1;
            return selects === 1
              ? Promise.resolve([{ tillId: "t", total: 6500, corrections: "0" }])
              : Promise.resolve([]);
          },
        }),
      }),
      insert: () => ({
        values: () =>
          Promise.reject(
            // The trigger's own words, read from the one place that declares them, so this case
            // cannot pass against a wording the migration no longer raises.
            Object.assign(new Error(POST_SETTLEMENT_REFUSAL), {
              errcode: 1811,
            }),
          ),
      }),
    } as unknown as Transaction;

    const error = await captureError(() =>
      settleSale(fakeTx, {
        saleId: brandSaleId("11111111-1111-4111-8111-111111111111"),
        tenders: [{ method: "cash", amount: "65.00", tipAmount: "0.00", settledAt: SETTLED_AT }],
      }),
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("sale.already_settled");
    expect((error as AppError).params).toMatchObject({
      saleId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("rethrows a refusal the post-settlement predicate declines, untranslated", async () => {
    // The tenders insert's OTHER failure path, mirroring the settlement-insert rethrow above. Only
    // the post-settlement guard's own raise means "already settled"; ANY other failure on the
    // tenders insert (a transport error, another constraint) must reach the caller as-is rather
    // than be mislabelled `sale.already_settled`.
    //
    // The refusal below is the sharp version of that, not an arbitrary error: `errcode` 1811 is the
    // SAME result code the post-settlement trigger's raise arrives under, because SQLite implements
    // `ON DELETE RESTRICT` with an internal trigger of its own. Only the wording separates the two,
    // so this case fails unless the translation reads the message and not just the code. Control
    // run 2026-09-22: with the message replaced by the trigger's exact words and nothing else
    // changed, it fails on `expected AppError: sale.already_settled to not be an instance of
    // AppError`. Tenders are present so the tenders INSERT is the one reached.
    let selects = 0;
    const refused = Object.assign(new Error("FOREIGN KEY constraint failed"), { errcode: 1811 });
    const fakeTx = {
      select: () => ({
        from: () => ({
          where: () => {
            selects += 1;
            return selects === 1
              ? Promise.resolve([{ tillId: "t", total: 6500, corrections: "0" }])
              : Promise.resolve([]);
          },
        }),
      }),
      insert: () => ({
        values: () => Promise.reject(refused),
      }),
    } as unknown as Transaction;

    const error = await captureError(() =>
      settleSale(fakeTx, {
        saleId: brandSaleId("11111111-1111-4111-8111-111111111111"),
        tenders: [{ method: "cash", amount: "65.00", tipAmount: "0.00", settledAt: SETTLED_AT }],
      }),
    );
    expect(error).not.toBeInstanceOf(AppError);
    // The very object the insert rejected with, unwrapped and unreplaced.
    expect(error).toBe(refused);
    expect((error as { errcode?: number }).errcode).toBe(1811);
  });
});

// Insert tenders then a settlement row directly, as the app role — bypassing settleSale so the
// coverage TRIGGER is what is under test. Tenders first: tenders_reject_post_settlement
// rejects a tender once a settlement row exists.
async function settleDirect(db: Database, saleId: SaleId, amount: string): Promise<void> {
  await withTransaction(db, async (tx) => {
    await asAppUser(tx);
    await tx.insert(tenders).values({
      saleId,
      method: "cash",
      // Money columns hold whole cents; `amount` arrives as the decimal amount the case reads as.
      amount: decimalToCents(decimal(amount)),
      tipAmount: 0,
      settledAt: SETTLED_AT.toISOString(),
    });
    await tx.insert(saleSettlements).values({ saleId, settledAt: SETTLED_AT.toISOString() });
  });
}

describe("coverage trigger nets corrections", () => {
  it("accepts the net: 65 covers a 70 sale corrected by -5", async () => {
    const seed = await seedTenant(suite.db);
    const originalId = await seedSale(suite.db, seed, { total: "70.00", invoiceNumber: 1 });
    await seedSale(suite.db, seed, {
      total: "-5.00",
      invoiceNumber: 2,
      correctsSaleId: originalId,
    });

    await settleDirect(suite.db, originalId, "65.00");

    const settled = await suite.db
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, originalId));
    expect(settled).toHaveLength(1);
  });

  it("rejects the pre-correction total: 70 against a 70 sale corrected by -5 (net 65)", async () => {
    const seed = await seedTenant(suite.db);
    const originalId = await seedSale(suite.db, seed, { total: "70.00", invoiceNumber: 1 });
    await seedSale(suite.db, seed, {
      total: "-5.00",
      invoiceNumber: 2,
      correctsSaleId: originalId,
    });

    const error = await captureError(() => settleDirect(suite.db, originalId, "70.00"));
    expect(error).toBeDefined();

    const settled = await suite.db
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, originalId));
    expect(settled).toHaveLength(0);
  });

  it("negative control: an uncorrected sale still needs its exact total (65 rejected on a 70 sale)", async () => {
    const seed = await seedTenant(suite.db);
    const originalId = await seedSale(suite.db, seed, { total: "70.00", invoiceNumber: 1 });

    const error = await captureError(() => settleDirect(suite.db, originalId, "65.00"));
    expect(error).toBeDefined();

    const settled = await suite.db
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, originalId));
    expect(settled).toHaveLength(0);
  });
});

describe("settleSale nets corrections into the due", () => {
  it("settles a corrected sale at the net (70 corrected by -5, pay 65)", async () => {
    const seed = await seedTenant(suite.db);
    const originalId = await seedSale(suite.db, seed, { total: "70.00", invoiceNumber: 1 });
    await seedSale(suite.db, seed, {
      total: "-5.00",
      invoiceNumber: 2,
      correctsSaleId: originalId,
    });

    await settle(suite.db, {
      saleId: originalId,
      tenders: [{ method: "cash", amount: "65.00", tipAmount: "0.00", settledAt: SETTLED_AT }],
    });

    const settled = await suite.db
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, originalId));
    expect(settled).toHaveLength(1);
  });

  it("shortfall's due is the net: paying the pre-correction 70 on a -5-corrected sale is rejected", async () => {
    const seed = await seedTenant(suite.db);
    const originalId = await seedSale(suite.db, seed, { total: "70.00", invoiceNumber: 1 });
    await seedSale(suite.db, seed, {
      total: "-5.00",
      invoiceNumber: 2,
      correctsSaleId: originalId,
    });

    await expect(
      settle(suite.db, {
        saleId: originalId,
        tenders: [{ method: "cash", amount: "70.00", tipAmount: "0.00", settledAt: SETTLED_AT }],
      }),
    ).rejects.toMatchObject({
      code: "sale.tender_shortfall",
      params: { saleId: originalId, due: "65.00", charged: "70.00" },
    });
  });

  it("nets a correcting-up corrective (70 corrected by +5, pay 75)", async () => {
    const seed = await seedTenant(suite.db);
    const originalId = await seedSale(suite.db, seed, { total: "70.00", invoiceNumber: 1 });
    await seedSale(suite.db, seed, {
      total: "5.00",
      invoiceNumber: 2,
      correctsSaleId: originalId,
    });

    await settle(suite.db, {
      saleId: originalId,
      tenders: [{ method: "cash", amount: "75.00", tipAmount: "0.00", settledAt: SETTLED_AT }],
    });

    const settled = await suite.db
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, originalId));
    expect(settled).toHaveLength(1);
  });
});
