import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { asAppUser, captureError, pgErrorCode, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { isAppError } from "@waitron/shared";
import { seedVenue } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { recordDailyClose } from "./record-daily-close.js";
import type { CashCountInput, DailyCloseRecord } from "./close-types.js";

// Real PostgreSQL via Testcontainers — deliberately NOT skipped when Docker is unavailable (the
// package's vitest `globalSetup` throws when Docker is absent rather than degrading to a skip). Every
// assertion below turns on
// something PGlite cannot show: PGlite serialises every query onto ONE backend, so the single-writer
// FOR UPDATE lock reads the same, whether present or removed, and a "concurrency" test on it is a
// FALSE pass. It also runs every connection as a superuser, so the append-only immutability and the
// app-role grant/RLS that let `recordDailyClose` run at all are invisible there. The deterministic
// LOGIC — snapshot, per-till variance, chaining, validation — lives in `record-daily-close.test.ts`
// on PGlite, where it belongs (CLAUDE.md §4). This suite additionally exercises the whole write path
// under the real non-superuser `app_user` role with FORCE ROW LEVEL SECURITY active, which no PGlite
// suite can.

const CLOSED_BY = "cccccccc-0000-4000-8000-000000000001";
const WRITERS = 10;

const suite = useTemplateDb({ template: "core" });

let venue: SeededVenue;
// A FRESH tenant/node/chain per test (seedVenue mints a new tenant): daily_closes is append-only and
// un-truncatable, so each test writes into its own chain rather than cleaning up.
beforeEach(async () => {
  venue = await seedVenue(suite.admin);
});

/** Runs `recordDailyClose` on `db` under the real app role and this tenant's RLS GUC — the exact
 * shape the running POS uses. Each caller passes its own `db` (a distinct backend) so two of them
 * genuinely contend. */
function record(
  db: Database,
  businessDay: string,
  cashCounts: CashCountInput[],
): Promise<DailyCloseRecord> {
  return withTenant(db, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    return recordDailyClose(tx, {
      tenantId: venue.tenantId,
      nodeId: venue.nodeId,
      businessDay,
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
      closedBy: CLOSED_BY,
      cashCounts,
    });
  });
}

async function closeCount(): Promise<number> {
  const { rows } = await suite.admin.execute<{ n: number }>(sql`
    select count(*)::int as n from daily_closes
     where tenant_id = ${venue.tenantId} and node_id = ${venue.nodeId}`);
  return rows[0]!.n;
}

async function readChain(): Promise<
  Array<{ sequenceNo: number; prevEntryHash: string; entryHash: string }>
> {
  const { rows } = await suite.admin.execute<{
    sequence_no: number;
    prev_entry_hash: string;
    entry_hash: string;
  }>(sql`
    select sequence_no, prev_entry_hash, entry_hash from daily_closes
     where tenant_id = ${venue.tenantId} and node_id = ${venue.nodeId}
     order by sequence_no`);
  return rows.map((r) => ({
    sequenceNo: r.sequence_no,
    prevEntryHash: r.prev_entry_hash,
    entryHash: r.entry_hash,
  }));
}

describe("recordDailyClose under real contention", () => {
  it("runs its writers on distinct backend processes", async () => {
    // THE LOAD-BEARING GUARD. PGlite serialises every query onto one backend, so this returns the
    // same pid twice there and everything below would be theatre. Mirrors the fiscal/workforce
    // concurrency suites' first test.
    const dbs = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
    try {
      const pids = await Promise.all(
        dbs.map(async (db) => {
          const { rows } = await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
          return rows[0]?.pid;
        }),
      );
      expect(new Set(pids).size).toBe(2);
    } finally {
      await Promise.all(dbs.map((db) => db.close()));
    }
  });

  it("serialises two concurrent closes of the same day: one wins, one errors, exactly one row", async () => {
    const dbs = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
    try {
      const results = await Promise.allSettled(dbs.map((db) => record(db, "2026-08-04", [])));

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
      expect(await closeCount()).toBe(1);
      expect((await readChain()).map((c) => c.sequenceNo)).toEqual([1]);
    } finally {
      await Promise.all(dbs.map((db) => db.close()));
    }
  });

  it("blocks a second closer while the chain head is locked (the single-writer lock)", async () => {
    // Deterministic rather than timing-based, and the proof-by-deletion target: hold the head-row
    // lock open, then a second closer that must take FOR UPDATE on the same head waits until its
    // lock_timeout. Remove the `.for("update")` from `selectHeadForUpdate` and this closer no longer
    // blocks — it sails through and returns a record — so this test goes red exactly when the lock is
    // gone. Mirrors workforce/fiscal "blocks a second appender".
    await record(suite.admin, "2026-08-01", []); // create + advance the head so there is a row to lock

    const holder = await suite.pg.connect();
    const waiter = await suite.pg.connect();
    let release: () => void = () => {};
    let holding: Promise<unknown> | undefined;
    try {
      const held = new Promise<void>((resolve) => (release = resolve));
      let acquire!: () => void;
      const acquired = new Promise<void>((resolve) => (acquire = resolve));
      holding = holder.transaction(async (tx) => {
        await tx.execute(
          sql`select 1 from daily_close_chain where tenant_id = ${venue.tenantId} and node_id = ${venue.nodeId} for update`,
        );
        acquire();
        await held;
      });
      await acquired;

      const error = await captureError(() =>
        withTenant(waiter, venue.tenantId, async (tx) => {
          await asAppUser(tx);
          await tx.execute(sql`set local lock_timeout = '250ms'`);
          return recordDailyClose(tx, {
            tenantId: venue.tenantId,
            nodeId: venue.nodeId,
            businessDay: "2026-08-02",
            timeZone: "Europe/Madrid",
            dayCutover: "05:00",
            closedBy: CLOSED_BY,
            cashCounts: [],
          });
        }),
      );
      expect(pgErrorCode(error)).toBe("55P03"); // lock_not_available — it was made to wait on the held head lock
    } finally {
      release();
      if (holding) await holding.catch(() => {});
      await holder.close();
      await waiter.close();
    }
  });

  it("assigns every one of many concurrent closes a distinct, gap-free sequence and a valid chain", async () => {
    // The second proof-by-deletion target, in the direction the brief names ("double sequence /
    // duplicate"). Pre-create the head, then race N closes on DISTINCT business days — so the
    // business_day unique key does NOT catch a lost race, and only the FOR UPDATE head lock keeps
    // the sequence numbers distinct. With the lock: sequences 2..N+1, chain intact. WITHOUT it: the
    // racers read the same head, compute the same next sequence, and collide on
    // daily_closes_sequence_key (23505) — Promise.all rejects and this test goes red.
    await record(suite.admin, "2026-08-01", []); // head → sequence 1

    const dbs = await Promise.all(Array.from({ length: WRITERS }, () => suite.pg.connect()));
    try {
      const days = Array.from(
        { length: WRITERS },
        (_, i) => `2026-08-${String(2 + i).padStart(2, "0")}`,
      );
      const results = await Promise.all(dbs.map((db, i) => record(db, days[i]!, [])));
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
    } finally {
      await Promise.all(dbs.map((db) => db.close()));
    }
  });
});
