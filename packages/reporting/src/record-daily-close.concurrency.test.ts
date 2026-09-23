/**
 * Closes started together leave one row per business day, on one contiguous chain.
 *
 * Named for what separates it from the sibling `record-daily-close.test.ts`: every case here starts
 * more than one `recordDailyClose` without awaiting the first, where that file awaits each close
 * before the next — it contains no `Promise.all`, and its same-day refusal case says `sequential`
 * in its own name.
 *
 * ## What this suite was, and what converting it cost
 *
 * It ran against real PostgreSQL through `useTemplateDb`, opened one backend per closer, and was
 * written around the `select … for update` on the `daily_close_chain` head row that
 * `recordDailyClose` took. That clause is gone — SQLite has no row locks — and what serialises
 * closers now is the venue file's write queue: `withTransaction` (`packages/db/src/tenancy.ts`)
 * runs its body inside `db.withWriteLock`, and `packages/store/src/write-queue.ts` issues
 * `begin immediate` / `commit` around it. The mechanism, its measurement and its control in the
 * other direction are recorded once on `racePair` (`packages/catalogue/test/fixtures.ts`).
 *
 * **Two cases did not survive:**
 *
 * 1. `runs its writers on distinct backend processes` — `pg_backend_pid()` has no counterpart and
 *    there are no backends. Nothing now confirms the closers below are genuinely separate callers;
 *    what they are is separate `withTransaction` calls started without awaiting each other.
 * 2. `blocks a second closer while the chain head is locked (the single-writer lock)` — it held the
 *    head row on one connection and asserted SQLSTATE `55P03` from the other's `lock_timeout`.
 *    There is no lock to hold, no second connection and no `lock_timeout`, so the case is deleted
 *    outright rather than reworded. It was one of this file's two proof-by-deletion targets (remove
 *    `.for("update")` and the second closer sails through); that control cannot be re-run, because
 *    the clause it deleted is already deleted.
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
// A fresh venue per test. On PostgreSQL this had to mint a new TENANT each time, because
// `daily_closes` was append-only and un-truncatable so nothing could clear it; `useVenueDb`'s reset
// drops each append-only trigger, empties the table and recreates the trigger from its own stored
// text (`packages/db/src/testing/venue-db.ts`), so each test starts from an empty database.
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
    // The direction the brief named ("double sequence / duplicate"). Pre-create the head, then
    // start N closes of DISTINCT business days together — so `daily_closes_business_day_key` does
    // NOT catch a lost race, and only serialisation keeps the sequence numbers distinct. On
    // PostgreSQL without the head lock these racers read the same head, computed the same next
    // sequence and collided on `daily_closes_sequence_key`. Here they queue.
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
