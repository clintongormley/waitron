import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  captureError,
  isRefusal,
  driverErrorCode,
  POST_SETTLEMENT_REFUSAL,
  refusalError,
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
import { AppError, saleId as brandSaleId, stringToCents } from "@waitron/shared";
import type { NodeId, SaleId, SeriesId, TillId } from "@waitron/shared";
import { seedTenant } from "../test/fixtures.js";
import { settleSale } from "./settle-sale.js";
import type { SettleSaleInput } from "./settle-sale.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS], timeoutMs: 60_000 });

const SETTLED_AT = new Date("2026-08-01T12:00:00Z");

/**
 * Inserts one `sales` row directly. `total` is a decimal, converted to whole cents as `recordSale`
 * does. Pass `correctsSaleId` to seed a corrective invoice.
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
      total: stringToCents(overrides.total ?? "65.00"),
      // Empty: this file exercises settlement, not the breakdown.
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
 * Runs `settleSale` inside one transaction, the shape a request takes.
 */
function settle(db: Database, input: SettleSaleInput): Promise<void> {
  return withTransaction(db, async (tx) => {
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
    expect(new Date(settled[0]!.settledAt).getTime()).toBe(SETTLED_AT.getTime());

    const tenderRows = await suite.db.select().from(tenders).where(eq(tenders.saleId, saleId));
    expect(tenderRows).toHaveLength(1);
    // Read straight off the table, so these are counts of whole cents, not decimal literals.
    expect(tenderRows[0]!.amount).toBe(7000);
    expect(tenderRows[0]!.tipAmount).toBe(500);
    expect(tenderRows[0]!.cashTendered).toBe(10000);
    const mutation = await captureError(async () =>
      suite.db.execute(sql`update tenders set cash_tendered = 20000 where sale_id = ${saleId}`),
    );
    // `triggerRaised` checks the result class and the trigger's exact words (`<table> is
    // append-only`, from `installAppendOnlyTriggers`); `driverErrorCode` answers
    // `ERR_SQLITE_ERROR` for every failure alike.
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
    // The CHECK class; `driverErrorCode` would answer the same string for every failure.
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(await suite.db.select().from(tenders).where(eq(tenders.saleId, saleId))).toEqual([]);
    expect(
      await suite.db.select().from(saleSettlements).where(eq(saleSettlements.saleId, saleId)),
    ).toEqual([]);
  });

  it("settles a €0 comped sale with no tenders, stamped at the settlement instant (no raw TypeError)", async () => {
    // A comped sale has no tender (`tenders_amount_ck` refuses a zero one), so `settleSale` must
    // record the settlement with none, stamped at its own instant rather than the sale's
    // `issued_at`.
    const seed = await seedTenant(suite.db);
    const saleId = await seedSale(suite.db, seed, { total: "0.00" });

    // `before`/`after` bracket the `new Date()` inside settleSale; the seed's issued_at is 11:00Z.
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
    // … and later than the seed's issued_at (11:00Z), so not a copy of the print instant.
    expect(settledAt).toBeGreaterThan(new Date("2026-08-01T11:00:00Z").getTime());

    const tenderRows = await suite.db.select().from(tenders).where(eq(tenders.saleId, saleId));
    expect(tenderRows).toHaveLength(0);
  });

  it("stamps the settlement at the LATEST tender's settledAt, across a split payment", async () => {
    // The last tender to land sets settled_at: the maximum by value, not by position.
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
    // Caught by the read of `sale_settlements` before writing.
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
    // Two callers started together end with one settlement and one tender, and the loser gets
    // `sale.already_settled` rather than a raw driver error. Weaker than its name: the write queue
    // runs the two in turn, so the loser is refused by the read before writing, never by the
    // `sale_settlements` unique key.
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

    // Exactly one settlement, and exactly the winner's single tender.
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
    // Any other failure of the settlement insert must reach the caller as it arrived, not as
    // `sale.already_settled`. A stub drives `settleSale`'s catch directly; the sale is tenderless,
    // so the settlement insert is the only insert reached.
    let selects = 0;
    const fakeTx = {
      select: () => ({
        from: () => ({
          // 1: the sale row — `total` as the typed column hands it back (a count of whole cents)
          // and `corrections` as the raw `cast(… as text)` subquery does (that count as a STRING);
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
    expect(driverErrorCode(error)).toBe("53100");
  });

  it("translates the tenders post-settlement guard to sale.already_settled", async () => {
    // The loser whose tender insert trips `tenders_reject_post_settlement` because the winner has
    // committed, driven with a stub. Tenders are present so the tender insert is reached. The
    // refusal comes from `refusalError`, whose own suite holds it equal to the engine's.
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
            refusalError({ trigger: POST_SETTLEMENT_REFUSAL }),
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
    // Errcode 1811 is also what SQLite raises for its own `ON DELETE RESTRICT`, so only the wording
    // separates the two: this fails unless the translation reads the message, not just the code.
    // Tenders are present so the tender insert is reached.
    let selects = 0;
    const refused = refusalError({ restrict: true });
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

// Insert tenders then a settlement row directly, bypassing settleSale so the coverage TRIGGER is
// what is under test. Tenders first: tenders_reject_post_settlement rejects a tender once a
// settlement row exists.
async function settleDirect(db: Database, saleId: SaleId, amount: string): Promise<void> {
  await withTransaction(db, async (tx) => {
    await tx.insert(tenders).values({
      saleId,
      method: "cash",
      // Money columns hold whole cents; `amount` arrives as the decimal amount the case reads as.
      amount: stringToCents(amount),
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
