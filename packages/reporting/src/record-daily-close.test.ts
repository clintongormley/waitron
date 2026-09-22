import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  asAppUser,
  captureError,
  constraintTarget,
  withTransaction,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
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
// Those live in `record-daily-close.concurrency.test.ts` on real Postgres: the single-writer `FOR UPDATE`
// lock, the concurrent `close.already_closed`, and the gap-free sequence under ten racing closers.
// This mirrors `daily-close.test.ts`, which computes the same close on PGlite for the
// same reason. The `close.already_closed` catch path is driven by a real unique violation here (the sequential
// second close, and the raw insert that pins the refusal's table and columns) and again on
// node-postgres in `record-daily-close.concurrency.test.ts`, where the two closers actually contend.

const CLOSED_BY = "cccccccc-0000-4000-8000-000000000001";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let venue: SeededVenue;
beforeEach(async () => {
  venue = await seedVenue(suite.db);
});

function closeInput(businessDay: string) {
  return {
    nodeId: venue.nodeId,
    businessDay,
    timeZone: "Europe/Madrid",
    dayCutover: "05:00",
  };
}

function record(businessDay: string, cashCounts: CashCountInput[]): Promise<DailyCloseRecord> {
  return withTransaction(suite.db, async (tx) => {
    await asAppUser(tx);
    return recordDailyClose(tx, { ...closeInput(businessDay), closedBy: CLOSED_BY, cashCounts });
  });
}

function runCompute(businessDay: string) {
  return withTransaction(suite.db, async (tx: Transaction) => {
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
    { tillId: till, nodeId: venue.nodeId, seriesId: venue.seriesId },
    {
      invoiceNumber: invoiceNo,
      issuedAt: at,
      total: amount,
      lines: [{ vatRate: "21.00", lineTotal: amount }],
    },
  );
  await seedTender(
    suite.db,
    { saleId },
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
    const tillB = await seedTill(suite.db, venue.locationId);
    const tillC = await seedTill(suite.db, venue.locationId);
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
      { saleId },
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
       where node_id = ${venue.nodeId}`);

    const error = await captureError(() => record("2026-08-05", []));
    expect(isAppError(error)).toBe(false); // NOT translated to close.already_closed
    // The raw unique violation surfaces, and it is the SEQUENCE key's. This asserted the SQLSTATE
    // `23505`; on this engine `code` is the fixed `"ERR_SQLITE_ERROR"` for every failure alike, so
    // that spelling would pass for a refusal of any kind. The key names which index collided,
    // which is what the case is about — strictly more than the SQLSTATE said.
    expect(constraintTarget(error)).toEqual({
      table: "daily_closes",
      columns: ["node_id", "sequence_no"],
    });
    expect(isBusinessDayConflict(error)).toBe(false);
  });

  it("reports the business-day key as the table and columns insertClose recognises", async () => {
    // The receipt behind the target `insertClose` compares against. Driven through a REAL refusal,
    // because the result code and the key are the DRIVER's: a crafted error would only prove the
    // parser reads the craft. A raw insert-select duplicating the committed row on (node_id,
    // business_day) — with sequence_no moved clear — so the refusal is the business-day key's and
    // not the sequence key's.
    //
    // `id` is named and bound, where it used to be left to the column's default. It has to be: the
    // default is a JavaScript `$defaultFn(newId)` on this engine and a raw INSERT never reaches
    // one, so the row was refused `NOT NULL constraint failed: daily_closes.id` and the case read
    // back the id as the key — passing the result code it then asserted, and proving nothing about
    // the business-day key.
    await record("2026-08-04", []);
    const error = await captureError(() =>
      withTransaction(suite.db, async (tx) => {
        await asAppUser(tx);
        await tx.execute(sql`
          insert into daily_closes (id, node_id, business_day, sequence_no, prev_entry_hash,
                                    entry_hash, closed_at, closed_by, snapshot)
          select ${randomUUID()}, node_id, business_day, sequence_no + 100, prev_entry_hash,
                 entry_hash, closed_at, closed_by, snapshot
            from daily_closes`);
      }),
    );
    expect(constraintTarget(error)).toEqual({
      table: "daily_closes",
      columns: ["node_id", "business_day"],
    });
    // The whole point of the receipt: the predicate `insertClose` gates on says yes to a REAL
    // refusal of this key, not only to the crafted ones below.
    expect(isBusinessDayConflict(error)).toBe(true);
  });
});

describe("isBusinessDayConflict", () => {
  // Crafted errors, no database — the walk's branches are cheap to cover directly, exactly as
  // @waitron/db's own suite does for its (structurally identical) predicate.
  //
  // THE CRAFTED SHAPE IS A QUOTATION, not a guess. It was PostgreSQL's `{ code: "23505", table,
  // detail: "Key (…)=(…) already exists." }`; this engine reports an extended RESULT CODE on
  // `errcode` and names the key in the MESSAGE, with `code` fixed at `"ERR_SQLITE_ERROR"` for every
  // failure alike. Measured 2026-09-22 on Node v26.7.0 against `node:sqlite`, one real refusal per
  // row, on a table with exactly this schema's two unique indexes:
  //
  //   business-day key  errcode 2067  "UNIQUE constraint failed: daily_closes.node_id, daily_closes.business_day"
  //   sequence key      errcode 2067  "UNIQUE constraint failed: daily_closes.node_id, daily_closes.sequence_no"
  //   primary key       errcode 1555  "UNIQUE constraint failed: daily_closes.id"
  //   foreign key       errcode  787  "FOREIGN KEY constraint failed"
  //
  // The two real-refusal cases above pin the same shape through the driver, which is what stops
  // this block proving only that the parser reads the craft.
  const uniqueOn = (columns: readonly string[]) =>
    `UNIQUE constraint failed: ${columns.map((c) => `daily_closes.${c}`).join(", ")}`;
  const conflict = {
    errcode: 2067,
    message: uniqueOn(["node_id", "business_day"]),
  };

  it("recognises a bare business-day unique violation", () => {
    expect(isBusinessDayConflict(conflict)).toBe(true);
  });

  it("recognises one wrapped in a DrizzleQueryError-style cause chain", () => {
    expect(isBusinessDayConflict({ cause: { cause: conflict } })).toBe(true);
  });

  it("does NOT match a sequence-key collision (same code and table, different columns)", () => {
    expect(
      isBusinessDayConflict({ errcode: 2067, message: uniqueOn(["node_id", "sequence_no"]) }),
    ).toBe(false);
  });

  it("does NOT match the same columns on a different table", () => {
    expect(
      isBusinessDayConflict({
        errcode: 2067,
        message:
          "UNIQUE constraint failed: daily_close_chain.node_id, daily_close_chain.business_day",
      }),
    ).toBe(false);
  });

  it("does NOT match a non-unique error on the same table and columns", () => {
    // 787 is a foreign-key refusal. It carries no key at all in its own message, so the message is
    // kept as the unique one's on purpose: what must reject it is the CLASS, not the text.
    expect(isBusinessDayConflict({ ...conflict, errcode: 787 })).toBe(false);
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
    expect(isBusinessDayConflict(uniqueOn(["node_id", "business_day"]))).toBe(false);
  });
});
