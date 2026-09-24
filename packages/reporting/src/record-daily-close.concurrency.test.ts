/**
 * Closes started together leave one row per business day, on one contiguous chain. Every case here
 * starts more than one `recordDailyClose` without awaiting the first; what serialises them is the
 * venue file's write queue (`withTransaction`, `packages/db/src/tenancy.ts`).
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, dailyCloses, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { isAppError } from "@waitron/shared";
import { seedVenue } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { recordDailyClose } from "./record-daily-close.js";
import type { CashCountInput, DailyCloseRecord } from "./close-types.js";

const CLOSED_BY = "cccccccc-0000-4000-8000-000000000001";
const WRITERS = 10;

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

let venue: SeededVenue;
beforeEach(async () => {
  venue = await seedVenue(suite.db);
});

/** Runs `recordDailyClose` inside `withTransaction` — the exact shape the running POS uses, and
 * the thing concurrent callers queue on. */
function record(businessDay: string, cashCounts: CashCountInput[]): Promise<DailyCloseRecord> {
  return withTransaction(suite.db, (tx) =>
    recordDailyClose(tx, {
      nodeId: venue.nodeId,
      businessDay,
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
      closedBy: CLOSED_BY,
      cashCounts,
    }),
  );
}

/** The node's committed closes, in chain order. */
function readChain() {
  return suite.db
    .select({
      sequenceNo: dailyCloses.sequenceNo,
      prevEntryHash: dailyCloses.prevEntryHash,
      entryHash: dailyCloses.entryHash,
    })
    .from(dailyCloses)
    .where(eq(dailyCloses.nodeId, venue.nodeId))
    .orderBy(dailyCloses.sequenceNo);
}

describe("recordDailyClose under concurrent closers", () => {
  it("serialises two concurrent closes of the same day: one wins, one errors, exactly one row", async () => {
    // Started without awaiting each other: nothing but the write queue keeps the second out.
    const results = await Promise.allSettled([record("2026-08-04", []), record("2026-08-04", [])]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The loser fails CLEANLY — a translated domain error naming the day, never a raw driver throw.
    const reason = rejected[0]!.reason;
    expect(isAppError(reason)).toBe(true);
    if (isAppError(reason)) {
      expect(reason.code).toBe("close.already_closed");
      expect(reason.params).toEqual({ businessDay: "2026-08-04" });
    }

    // Exactly one immutable row, at sequence 1.
    const chain = await readChain();
    expect(chain.map((c) => c.sequenceNo)).toEqual([1]);
  });

  it("assigns every one of many concurrent closes a distinct, gap-free sequence and a valid chain", async () => {
    // Closes of DISTINCT business days, so `daily_closes_business_day_key` cannot catch a lost race
    // and only serialisation keeps the sequence numbers distinct.
    await record("2026-08-01", []); // head → sequence 1

    const days = Array.from(
      { length: WRITERS },
      (_, i) => `2026-08-${String(2 + i).padStart(2, "0")}`,
    );
    const results = await Promise.all(days.map((day) => record(day, [])));
    expect(results).toHaveLength(WRITERS);

    const chain = await readChain();
    // The pre-created genesis plus every concurrent close, contiguous 1..N+1 with no gap or repeat.
    expect(chain.map((c) => c.sequenceNo)).toEqual(
      Array.from({ length: WRITERS + 1 }, (_, i) => i + 1),
    );
    expect(chain[0]!.prevEntryHash).toBe(""); // genesis
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i]!.prevEntryHash).toBe(chain[i - 1]!.entryHash); // every link holds
    }
  });
});
