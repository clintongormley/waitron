import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, captureError, pgErrorCode, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { AppError, hasCode, isAppError } from "@waitron/shared";
import type { TillId } from "@waitron/shared";
import { seedSale, seedTender, seedTill, seedVenue } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { computeDailyClose } from "./daily-close.js";
import { computeCloseEntryHash } from "./daily-close-hash.js";
import { isBusinessDayConflict, recordDailyClose } from "./record-daily-close.js";
import type { CashCountInput, DailyCloseRecord } from "./close-types.js";

// PGlite, deliberately — and it is the RIGHT target here, not a shortcut. Everything this suite
// asserts is DETERMINISTIC LOGIC over immutable commercial rows: the snapshot captures exactly what
// `computeDailyClose` returns, the per-till variance arithmetic, the chain-position/`prev_entry_hash`
// bookkeeping, the hash reproduction, and the input validation. None of it turns on the non-superuser
// deployment role or on two writers contending — the two things PGlite cannot show (CLAUDE.md §4).
// Those live in `record-daily-close.pg.test.ts` on real Postgres: the single-writer `FOR UPDATE`
// lock, the concurrent `close.already_closed`, and the gap-free sequence under ten racing closers.
// This mirrors `daily-close.test.ts`, which computes the same close on PGlite for the
// same reason. The `close.already_closed` catch path (a real 23505 from `daily_closes_business_day_key`
// carrying a `constraint` name node-postgres populates) is proven in `record-daily-close.pg.test.ts`,
// not here.

const CLOSED_BY = "cccccccc-0000-4000-8000-000000000001";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let venue: SeededVenue;
beforeEach(async () => {
  venue = await seedVenue(suite.db);
});

function closeInput(businessDay: string) {
  return {
    tenantId: venue.tenantId,
    nodeId: venue.nodeId,
    businessDay,
    timeZone: "Europe/Madrid",
    dayCutover: "05:00",
  };
}

function record(businessDay: string, cashCounts: CashCountInput[]): Promise<DailyCloseRecord> {
  return withTenant(suite.db, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    return recordDailyClose(tx, { ...closeInput(businessDay), closedBy: CLOSED_BY, cashCounts });
  });
}

function runCompute(businessDay: string) {
  return withTenant(suite.db, venue.tenantId, async (tx: Transaction) => {
    await asAppUser(tx);
    return computeDailyClose(tx, closeInput(businessDay));
  });
}

/** A cash sale settled at `till` on the business day, so the close's `cashTakings` for that till
 * equals `amount`. Distinct invoice numbers keep the per-series unique constraint happy. */
let invoiceNo = 0;
async function seedCashSale(till: TillId, amount: string): Promise<void> {
  invoiceNo += 1;
  const at = "2026-08-04T10:00:00Z"; // 12:00 Madrid, after the 05:00 cutover → business day 2026-08-04
  const saleId = await seedSale(
    suite.db,
    { tenantId: venue.tenantId, tillId: till, nodeId: venue.nodeId, seriesId: venue.seriesId },
    {
      invoiceNumber: invoiceNo,
      issuedAt: at,
      total: amount,
      lines: [{ vatRate: "21.00", lineTotal: amount }],
    },
  );
  await seedTender(
    suite.db,
    { tenantId: venue.tenantId, saleId },
    { method: "cash", amount, tipAmount: "0.00", settledAt: at },
  );
}

async function captureCloseError(fn: () => Promise<unknown>): Promise<AppError> {
  const error = await captureError(fn);
  if (!isAppError(error)) throw new Error(`expected an AppError, got ${String(error)}`);
  return error;
}

describe("recordDailyClose — snapshot, reconciliation, chain", () => {
  it("snapshots the exact computeDailyClose figures and per-till variance (over, short, exact)", async () => {
    // Three tills at one node, each with cash takings, crafted so the reconciliation exercises all
    // three signs: A over, B short, C exact.
    const tillA = venue.tillId;
    const tillB = await seedTill(suite.db, venue.tenantId, venue.locationId);
    const tillC = await seedTill(suite.db, venue.tenantId, venue.locationId);
    await seedCashSale(tillA, "123.45");
    await seedCashSale(tillB, "48.00");
    await seedCashSale(tillC, "20.00");

    const rec = await record("2026-08-04", [
      // expected drawer = openingFloat + cashTakings − payouts
      { tillId: tillA, openingFloat: "50.00", payouts: "0.00", countedCash: "175.00" }, // 50+123.45−0 = 173.45 → +1.55 over
      { tillId: tillB, openingFloat: "50.00", payouts: "10.00", countedCash: "85.00" }, // 50+48−10 = 88.00 → −3.00 short
      { tillId: tillC, openingFloat: "30.00", payouts: "0.00", countedCash: "50.00" }, //  30+20−0 = 50.00 → 0.00 exact
    ]);

    // The frozen `close` is byte-for-byte the independent computeDailyClose (8a), not a re-derivation.
    expect(rec.snapshot.close).toEqual(await runCompute("2026-08-04"));

    const byTill = rec.snapshot.cashReconciliation.byTill;
    const a = byTill.find((t) => t.tillId === tillA)!;
    const b = byTill.find((t) => t.tillId === tillB)!;
    const c = byTill.find((t) => t.tillId === tillC)!;
    expect(a).toMatchObject({ cashTakings: "123.45", cashVariance: "1.55" });
    expect(b).toMatchObject({ cashTakings: "48.00", cashVariance: "-3.00" });
    expect(c).toMatchObject({ cashTakings: "20.00", cashVariance: "0.00" });
    // Every supplied figure is preserved verbatim in the frozen document.
    expect(a).toMatchObject({ openingFloat: "50.00", payouts: "0.00", countedCash: "175.00" });
    // Σ per-till variance = 1.55 − 3.00 + 0.00.
    expect(rec.snapshot.cashReconciliation.nodeVariance).toBe("-1.45");
  });

  it("assigns sequence 1 then 2 across two business days and chains prev_entry_hash", async () => {
    // Empty days — no sales — so cashCounts is empty and the close is a valid genesis/second link.
    const first = await record("2026-08-04", []);
    const second = await record("2026-08-05", []);

    expect(first.sequenceNo).toBe(1);
    expect(first.prevEntryHash).toBe(""); // genesis
    expect(second.sequenceNo).toBe(2);
    expect(second.prevEntryHash).toBe(first.entryHash); // the chain link

    // Each record self-verifies: its stored entry_hash is exactly what re-hashing its own frozen
    // content against its predecessor produces (the property Task 4's verifier will re-walk).
    for (const rec of [first, second]) {
      expect(rec.closedAt.getTime() % 1000).toBe(0); // truncated to whole seconds before hashing + storing
      expect(rec.entryHash).toBe(
        computeCloseEntryHash(
          {
            tenantId: rec.tenantId,
            nodeId: rec.nodeId,
            businessDay: rec.businessDay,
            sequenceNo: rec.sequenceNo,
            closedAt: rec.closedAt,
            closedBy: rec.closedBy,
            snapshot: rec.snapshot,
          },
          rec.prevEntryHash,
        ),
      );
    }
  });

  it("rejects a second close of the same day (sequential) with close.already_closed", async () => {
    await record("2026-08-04", []);
    const error = await captureCloseError(() => record("2026-08-04", []));
    expect(hasCode(error, "close.already_closed")).toBe(true);
    if (hasCode(error, "close.already_closed")) expect(error.params.businessDay).toBe("2026-08-04");
  });

  describe("rejects invalid cash input with close.invalid_cash_input", () => {
    const A = () => venue.tillId;

    it("a negative opening float", async () => {
      const error = await captureCloseError(() =>
        record("2026-08-04", [
          { tillId: A(), openingFloat: "-1.00", payouts: "0.00", countedCash: "0.00" },
        ]),
      );
      expect(error.code).toBe("close.invalid_cash_input");
      if (hasCode(error, "close.invalid_cash_input")) {
        expect(error.params.reason).toBe("opening_float_negative");
        expect(error.params.tillId).toBe(A());
      }
    });

    it("a negative payout", async () => {
      const error = await captureCloseError(() =>
        record("2026-08-04", [
          { tillId: A(), openingFloat: "0.00", payouts: "-5.00", countedCash: "0.00" },
        ]),
      );
      if (hasCode(error, "close.invalid_cash_input"))
        expect(error.params.reason).toBe("payouts_negative");
    });

    it("a negative counted cash", async () => {
      const error = await captureCloseError(() =>
        record("2026-08-04", [
          { tillId: A(), openingFloat: "0.00", payouts: "0.00", countedCash: "-0.01" },
        ]),
      );
      if (hasCode(error, "close.invalid_cash_input"))
        expect(error.params.reason).toBe("counted_cash_negative");
    });

    it("a non-numeric figure", async () => {
      const error = await captureCloseError(() =>
        record("2026-08-04", [
          { tillId: A(), openingFloat: "not-a-number", payouts: "0.00", countedCash: "0.00" },
        ]),
      );
      if (hasCode(error, "close.invalid_cash_input"))
        expect(error.params.reason).toBe("opening_float_not_a_number");
    });

    it("the same till counted twice", async () => {
      const error = await captureCloseError(() =>
        record("2026-08-04", [
          { tillId: A(), openingFloat: "0.00", payouts: "0.00", countedCash: "0.00" },
          { tillId: A(), openingFloat: "0.00", payouts: "0.00", countedCash: "0.00" },
        ]),
      );
      if (hasCode(error, "close.invalid_cash_input"))
        expect(error.params.reason).toBe("duplicate_till");
    });

    it("a cash-taking till left uncounted", async () => {
      await seedCashSale(venue.tillId, "40.00"); // the till has cash takings…
      const error = await captureCloseError(() => record("2026-08-04", [])); // …but is not counted
      if (hasCode(error, "close.invalid_cash_input")) {
        expect(error.params.reason).toBe("uncounted_cash_till");
        expect(error.params.tillId).toBe(venue.tillId);
      }
    });

    it("a count for a till with no activity in the close", async () => {
      // No sales at all → the close has no tills, so counting one is an unknown-till fault.
      const error = await captureCloseError(() =>
        record("2026-08-04", [
          { tillId: A(), openingFloat: "10.00", payouts: "0.00", countedCash: "10.00" },
        ]),
      );
      if (hasCode(error, "close.invalid_cash_input")) {
        expect(error.params.reason).toBe("unknown_till");
        expect(error.params.tillId).toBe(A());
      }
    });
  });

  it("treats a card-only till as known: not required to be counted, but countable against 0.00 takings", async () => {
    // A till present in the close only through CARD sales carries cashTakings 0.00. It is a KNOWN
    // till (counting it is allowed, its variance then measured against 0.00) but is NOT one the
    // uncounted-cash-till rule forces (that rule fires only for cashTakings > 0).
    invoiceNo += 1;
    const at = "2026-08-04T10:00:00Z";
    const saleId = await seedSale(
      suite.db,
      {
        tenantId: venue.tenantId,
        tillId: venue.tillId,
        nodeId: venue.nodeId,
        seriesId: venue.seriesId,
      },
      {
        invoiceNumber: invoiceNo,
        issuedAt: at,
        total: "60.50",
        lines: [{ vatRate: "21.00", lineTotal: "60.50" }],
      },
    );
    await seedTender(
      suite.db,
      { tenantId: venue.tenantId, saleId },
      { method: "card", amount: "60.50", tipAmount: "0.00", settledAt: at },
    );

    // Counting it succeeds even though its cash takings are zero:
    //   expected drawer = 100.00 + 0.00 − 5.00 = 95.00; variance = 96.00 − 95.00 = 1.00.
    const rec = await record("2026-08-04", [
      { tillId: venue.tillId, openingFloat: "100.00", payouts: "5.00", countedCash: "96.00" },
    ]);
    const row = rec.snapshot.cashReconciliation.byTill.find((t) => t.tillId === venue.tillId)!;
    expect(row.cashTakings).toBe("0.00");
    expect(row.cashVariance).toBe("1.00");
  });

  it("surfaces a sequence-key collision RAW, not masked as close.already_closed", async () => {
    // A daily_closes_sequence_key collision cannot happen under the FOR UPDATE lock, so if one ever
    // does it is a genuine single-writer bug for a day that is NOT closed — it must propagate, never
    // be reported as "already closed". Provoke it deterministically: close day 4, rewind the head's
    // sequence_no by hand, then close a DIFFERENT day 5. That recomputes sequence 1 and collides with
    // day 4's row on the sequence key (not the business_day key), exercising insertClose's re-throw.
    const first = await record("2026-08-04", []);
    expect(first.sequenceNo).toBe(1);
    await suite.db.execute(sql`
      update daily_close_chain set sequence_no = 0
       where tenant_id = ${venue.tenantId} and node_id = ${venue.nodeId}`);

    const error = await captureError(() => record("2026-08-05", []));
    expect(isAppError(error)).toBe(false); // NOT translated to close.already_closed
    expect(pgErrorCode(error)).toBe("23505"); // the raw unique violation surfaces
  });
});

describe("isBusinessDayConflict", () => {
  // Crafted errors, no database — the walk's branches are cheap to cover directly, exactly as
  // @waitron/db's own isUniqueViolation suite does for its (structurally identical) predicate.
  const conflict = { code: "23505", constraint: "daily_closes_business_day_key" };

  it("recognises a bare business-day unique violation", () => {
    expect(isBusinessDayConflict(conflict)).toBe(true);
  });

  it("recognises one wrapped in a DrizzleQueryError-style cause chain", () => {
    expect(isBusinessDayConflict({ cause: { cause: conflict } })).toBe(true);
  });

  it("does NOT match a sequence-key collision (same code, different constraint)", () => {
    expect(isBusinessDayConflict({ code: "23505", constraint: "daily_closes_sequence_key" })).toBe(
      false,
    );
  });

  it("does NOT match a non-unique error on the same constraint name", () => {
    expect(
      isBusinessDayConflict({ code: "23503", constraint: "daily_closes_business_day_key" }),
    ).toBe(false);
  });

  it("terminates on a self-referential cause chain", () => {
    const looped: { cause?: unknown } = {};
    looped.cause = looped;
    expect(isBusinessDayConflict(looped)).toBe(false);
  });

  it("gives up past a fixed depth rather than walking forever", () => {
    // Six wrappers deep — beyond the depth-5 cutoff — so a real violation buried that far reads as
    // absent, which is the deliberate bound, not a bug.
    let nested: unknown = conflict;
    for (let i = 0; i < 6; i++) nested = { cause: nested };
    expect(isBusinessDayConflict(nested)).toBe(false);
  });

  it("returns false for null and non-object values", () => {
    expect(isBusinessDayConflict(null)).toBe(false);
    expect(isBusinessDayConflict(undefined)).toBe(false);
    expect(isBusinessDayConflict("23505")).toBe(false);
  });
});
