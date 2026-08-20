import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { captureError, pgErrorCode } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { appendToChain, type TimeEntryAppend } from "./chain.js";
import { verifyChain, type VerifiableEntry } from "./chain-hash.js";
import { seedLocation, seedPerson } from "../test/fixtures.js";

const WRITERS = 20;

/**
 * Real PostgreSQL via the shared container — deliberately NOT skipped when Docker is unavailable.
 * The package globalSetup's `dockerRequired` throws rather than degrading to a skip: a concurrency
 * suite that silently vanishes reports a green CI run that proves nothing about the one property this
 * file exists to establish. PGlite serialises every query onto a single backend, so a contention
 * test on it is a FALSE pass, not a weak one — see ./chain.pglite-cannot-test-contention.test.ts for
 * the mechanism. If Docker genuinely is unavailable, globalSetup fails loudly before any test runs,
 * which is the intended, load-bearing behaviour.
 */
const suite = useTemplateDb({ template: "core_identity_workforce" });

let tenantId: string;
let personId: string;
let locationId: string;

// A FRESH tenant per test: time_entries' block-truncate trigger makes the table un-wipeable even by
// its owner, so each test mints new rows in a new tenant rather than cleaning up. Everything below is
// scoped to `locationId`, so a previous test's committed rows are simply out of scope.
beforeEach(async () => {
  tenantId = await seedTenant(suite.admin);
  personId = await seedPerson(suite.admin, tenantId);
  locationId = await seedLocation(suite.admin, tenantId);
});

function inputAt(at: string): TimeEntryAppend {
  return {
    personId,
    entryKind: "in",
    eventAt: at,
    eventOffsetMinutes: 0,
    recordedByPersonId: personId,
  };
}

/** N distinct instants, one per concurrent writer. */
function instant(i: number): string {
  return `2026-01-05T${String(6 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00Z`;
}

async function readChain(location: string): Promise<VerifiableEntry[]> {
  const { rows } = await suite.admin.execute<{
    sequence_no: number;
    person_id: string;
    location_id: string;
    entry_kind: string;
    event_at: string;
    event_offset_minutes: number;
    recorded_by_person_id: string;
    captured_by_till_id: string | null;
    corrects_entry_id: string | null;
    correction_reason: string | null;
    correction_status: string | null;
    correction_actor_id: string | null;
    prev_entry_hash: string | null;
    entry_hash: string;
    is_first_entry: boolean;
  }>(sql`
    select sequence_no, person_id, location_id, entry_kind,
      to_char(event_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as event_at,
      event_offset_minutes, recorded_by_person_id, captured_by_till_id, corrects_entry_id,
      correction_reason, correction_status, correction_actor_id,
      prev_entry_hash, entry_hash, is_first_entry
    from time_entries where location_id = ${location} order by sequence_no`);
  return rows.map((r) => ({
    sequenceNo: r.sequence_no,
    personId: r.person_id,
    locationId: r.location_id,
    entryKind: r.entry_kind,
    eventAt: r.event_at,
    eventOffsetMinutes: r.event_offset_minutes,
    recordedByPersonId: r.recorded_by_person_id,
    capturedByTillId: r.captured_by_till_id,
    correctsEntryId: r.corrects_entry_id,
    correctionReason: r.correction_reason,
    correctionStatus: r.correction_status,
    correctionActorId: r.correction_actor_id,
    prevEntryHash: r.prev_entry_hash,
    entryHash: r.entry_hash,
    isFirstEntry: r.is_first_entry,
  }));
}

describe("appendToChain under real contention", () => {
  it("runs its writers on distinct backend processes", async () => {
    // THE LOAD-BEARING ASSERTION. PGlite serialises every query onto one backend, so this returns
    // the same pid WRITERS times there and the rest of this suite would be theatre. If this ever
    // fails, nothing below it means anything, whatever colour it reports.
    const dbs = await Promise.all(Array.from({ length: WRITERS }, () => suite.pg.connect()));
    try {
      const pids = await Promise.all(
        dbs.map(async (db) => {
          const { rows } = await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
          return rows[0]?.pid;
        }),
      );
      expect(new Set(pids).size).toBe(WRITERS);
    } finally {
      await Promise.all(dbs.map((db) => db.close()));
    }
  });

  it("commits all 20 concurrent appends to one location chain", async () => {
    const dbs = await Promise.all(Array.from({ length: WRITERS }, () => suite.pg.connect()));
    try {
      const results = await Promise.all(
        dbs.map((db, i) =>
          db.transaction((tx) => appendToChain(tx, tenantId, locationId, inputAt(instant(i)))),
        ),
      );
      // A naive read-then-write loses this race (fiscal measured 3 of 20 surviving). Anything below
      // 20 is that failure, not a flake.
      expect(results).toHaveLength(WRITERS);
      const { rows } = await suite.admin.execute<{ count: number }>(sql`
        select count(*)::int as count from time_entries where location_id = ${locationId}`);
      expect(rows[0]?.count).toBe(WRITERS);
    } finally {
      await Promise.all(dbs.map((db) => db.close()));
    }
  });

  it("assigns every concurrent append a distinct position with no gaps", async () => {
    const dbs = await Promise.all(Array.from({ length: WRITERS }, () => suite.pg.connect()));
    try {
      await Promise.all(
        dbs.map((db, i) =>
          db.transaction((tx) => appendToChain(tx, tenantId, locationId, inputAt(instant(i)))),
        ),
      );
      const chain = await readChain(locationId);
      expect(chain.map((e) => e.sequenceNo)).toEqual(
        Array.from({ length: WRITERS }, (_, i) => i + 1),
      );
    } finally {
      await Promise.all(dbs.map((db) => db.close()));
    }
  });

  it("leaves every entry correctly chained into one gap-free, verifiable chain", async () => {
    const dbs = await Promise.all(Array.from({ length: WRITERS }, () => suite.pg.connect()));
    try {
      await Promise.all(
        dbs.map((db, i) =>
          db.transaction((tx) => appendToChain(tx, tenantId, locationId, inputAt(instant(i)))),
        ),
      );
      const chain = await readChain(locationId);
      expect(chain[0]?.isFirstEntry).toBe(true);
      // Walk the WHOLE chain, not just the ends — a single crossed pair in the middle is exactly
      // what a lost race produces.
      for (let i = 1; i < chain.length; i++) {
        expect(chain[i]?.prevEntryHash).toBe(chain[i - 1]?.entryHash);
      }
      // And the whole thing re-verifies: hashes recompute, links hold, positions are contiguous.
      expect(verifyChain(chain)).toEqual({ ok: true });
    } finally {
      await Promise.all(dbs.map((db) => db.close()));
    }
  });

  it("blocks a second appender on the same location chain", async () => {
    // Deterministic rather than timing-based: hold the head-row lock open, then prove a second writer
    // on that chain waits until lock_timeout.
    const holder = await suite.pg.connect();
    const waiter = await suite.pg.connect();
    let release: () => void = () => {};
    let holding: Promise<unknown> | undefined;
    try {
      // Create the head first — there must be a row to lock.
      await suite.admin.transaction((tx) =>
        appendToChain(tx, tenantId, locationId, inputAt("2026-01-05T06:00:00Z")),
      );

      const held = new Promise<void>((resolve) => (release = resolve));
      let acquire!: () => void;
      const acquired = new Promise<void>((resolve) => (acquire = resolve));
      holding = holder.transaction(async (tx) => {
        await tx.execute(
          sql`select 1 from workforce_chains where tenant_id = ${tenantId} and location_id = ${locationId} for update`,
        );
        acquire();
        await held;
      });
      await acquired;

      const error = await captureError(() =>
        waiter.transaction(async (tx) => {
          await tx.execute(sql`set local lock_timeout = '250ms'`);
          return appendToChain(tx, tenantId, locationId, inputAt("2026-01-05T07:00:00Z"));
        }),
      );
      expect(pgErrorCode(error)).toBe("55P03"); // lock_not_available
    } finally {
      release();
      if (holding) await holding.catch(() => {});
      await holder.close();
      await waiter.close();
    }
  });

  it("does not block an appender on a different location", async () => {
    // Per-location parallelism is the reason the lock is on a row rather than a global key: a busy
    // location must never stall a quiet one.
    const otherLocation = await seedLocation(suite.admin, tenantId);
    const holder = await suite.pg.connect();
    const writer = await suite.pg.connect();
    let release: () => void = () => {};
    let holding: Promise<unknown> | undefined;
    try {
      await suite.admin.transaction((tx) =>
        appendToChain(tx, tenantId, locationId, inputAt("2026-01-05T06:00:00Z")),
      );

      const held = new Promise<void>((resolve) => (release = resolve));
      let acquire!: () => void;
      const acquired = new Promise<void>((resolve) => (acquire = resolve));
      holding = holder.transaction(async (tx) => {
        await tx.execute(
          sql`select 1 from workforce_chains where tenant_id = ${tenantId} and location_id = ${locationId} for update`,
        );
        acquire();
        await held;
      });
      await acquired;

      const result = await writer.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '250ms'`);
        return appendToChain(tx, tenantId, otherLocation, inputAt("2026-01-05T06:00:00Z"));
      });
      expect(result.sequenceNo).toBe(1);
    } finally {
      release();
      if (holding) await holding.catch(() => {});
      await holder.close();
      await writer.close();
    }
  });
});
