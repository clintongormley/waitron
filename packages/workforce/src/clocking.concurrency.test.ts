import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { pgErrorCode, withTenant } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { WorkforceBackend, type ClockEventInput } from "./clocking.js";
import { CONTAINER_SETUP_TIMEOUT_MS, startRealPostgres } from "./testing/postgres.js";
import { insertTimeEntry, seedLocation, seedPerson } from "../test/fixtures.js";

/**
 * Real PostgreSQL via Testcontainers — deliberately NOT skipped when Docker is unavailable, exactly
 * as ./chain.concurrency.test.ts. PGlite serialises every query onto ONE backend (a single-backend
 * mutex, ./chain.pglite-cannot-test-contention.test.ts proves the mechanism), so two "concurrent"
 * clock-ins there never actually overlap and the TOCTOU this suite exists to catch is INVISIBLE — a
 * false pass, not a weak one (CLAUDE.md §4). `startRealPostgres` throws rather than degrading to a
 * skip, so a Docker-less run fails loudly instead of reporting a green that proves nothing.
 *
 * The bug (whole-branch review): each of `clockIn`/`clockOut`/`breakStart`/`breakEnd` reads the
 * worker's current shift state with an UNLOCKED select and then appends. `appendToChain` serialises
 * per LOCATION (the `workforce_chains` head lock) but nothing serialises per PERSON across the
 * read→append, so two concurrent same-person clock-ins can both observe "out" and both append an
 * `in`. `projectWorkSessions` then overwrites the first open shift with the second (projection.ts:287
 * `case "in": open = { start: e }`), so worked time is computed from the SECOND `in` — undercounting
 * paid time in a LEGAL working-time record. The fix takes a per-person row lock before the read.
 */
const PROBE_ROLE = "workforce_clock_probe";
const PROBE_PASSWORD = "probe";

const suite = useRealPostgres({
  start: startRealPostgres,
  probeRole: { name: PROBE_ROLE, password: PROBE_PASSWORD, inRole: "app_user" },
  timeoutMs: CONTAINER_SETUP_TIMEOUT_MS,
});

const backend = new WorkforceBackend();

let tenantId: string;
let personId: string;
let otherPersonId: string;
let locationId: string;

// A FRESH tenant per test: time_entries' block-truncate trigger makes the table un-wipeable even by
// its owner (chain.concurrency.test.ts's reasoning), so each test mints new rows in a new tenant.
beforeEach(async () => {
  tenantId = await seedTenant(suite.admin);
  personId = await seedPerson(suite.admin, tenantId, "Ana");
  otherPersonId = await seedPerson(suite.admin, tenantId, "Ben");
  locationId = await seedLocation(suite.admin, tenantId);
});

function event(at: string): ClockEventInput {
  return { tenantId, personId, locationId, at, offsetMinutes: 0 };
}

/** Classifies a racer's outcome for an `.toEqual` assertion: a domain rejection reports its AppError
 * code (e.g. `attendance.already_open`), a driver error reports its SQLSTATE (e.g. `40P01`,
 * deadlock), anything else is stringified. AppError is checked FIRST because AppError carries its own
 * string `.code` (a domain code, not a SQLSTATE), which `pgErrorCode` would otherwise return verbatim
 * (packages/db/src/testing/errors.ts). */
function classify(error: unknown): string {
  if (error instanceof AppError) return error.code;
  return pgErrorCode(error) ?? `unexpected: ${String(error)}`;
}

/** Runs `clockIn` for `personId` as the non-superuser app role, returning "ok" on success or the
 * classified error otherwise. Running as the probe role (not the superuser admin) is what proves the
 * per-person `FOR NO KEY UPDATE` on `persons` is PERMITTED for the app role, not merely that it
 * serialises. */
async function attemptClockIn(db: Awaited<ReturnType<typeof suite.pg.connectAs>>, at: string) {
  try {
    await withTenant(db, tenantId, (tx) => backend.clockIn(tx, event(at)));
    return "ok";
  } catch (error) {
    return classify(error);
  }
}

/** Runs `requestCorrection` (actor = `otherPersonId`, a supervisor) of `correctsEntryId` as the
 * non-superuser app role, returning "ok" on success or the classified error. The correction path
 * locks the chain head first and takes `FOR KEY SHARE` on `persons` via the time_entries→persons FKs
 * on INSERT — the OPPOSITE lock order to the clock path, which is what makes the deadlock possible. */
async function attemptCorrection(
  db: Awaited<ReturnType<typeof suite.pg.connectAs>>,
  correctsEntryId: string,
) {
  try {
    await withTenant(db, tenantId, (tx) =>
      backend.requestCorrection(tx, {
        tenantId,
        correctsEntryId,
        at: "2026-01-05T07:59:00Z",
        offsetMinutes: 0,
        reason: "clocked in a minute early",
        actorPersonId: otherPersonId,
      }),
    );
    return "ok";
  } catch (error) {
    return classify(error);
  }
}

/** Seeds a COMPLETED shift for `personId` at `locationId` (in then out, so P ends "out" and a racing
 * clock-in is a valid transition) and returns the base `in` entry's id — the row a correction targets.
 * Runs as the superuser owner; this also creates the location chain head the holder locks below. */
async function seedCompletedShift(): Promise<string> {
  await insertTimeEntry(suite.admin, {
    tenantId,
    personId,
    locationId,
    entryKind: "in",
    eventAt: "2026-01-05T08:00:00Z",
  });
  await insertTimeEntry(suite.admin, {
    tenantId,
    personId,
    locationId,
    entryKind: "out",
    eventAt: "2026-01-05T12:00:00Z",
  });
  const { rows } = await suite.admin.execute<{ id: string }>(sql`
    select id from time_entries
    where person_id = ${personId} and entry_kind = 'in'
    order by sequence_no limit 1`);
  return rows[0]!.id;
}

/** Polls until `count` backends in this database are waiting on a heavyweight lock, or throws. This
 * is the deterministic barrier that makes the RED reproducible: the two racers are launched while a
 * holder pins the location chain head, so both progress PAST their state read and park on a lock
 * before the holder releases — guaranteeing, in the buggy code, that both read "out" first. Without
 * it the winner could commit before the loser's read and the double-`in` would appear only
 * sometimes. */
async function waitForBlockedBackends(count: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const { rows } = await suite.admin.execute<{ n: number }>(sql`
      select count(*)::int as n from pg_stat_activity
      where wait_event_type = 'Lock' and datname = current_database()`);
    if ((rows[0]?.n ?? 0) >= count) return;
    if (Date.now() > deadline) {
      throw new Error(`only ${rows[0]?.n ?? 0} backend(s) blocked on a lock, expected ${count}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function countInEntries(): Promise<number> {
  const { rows } = await suite.admin.execute<{ count: number }>(sql`
    select count(*)::int as count from time_entries
    where person_id = ${personId} and entry_kind = 'in'`);
  return rows[0]?.count ?? 0;
}

describe("clockIn serialises per person under real contention", () => {
  it("runs its two writers on distinct backend processes", async () => {
    // THE LOAD-BEARING ASSERTION (chain.concurrency.test.ts's pattern). If these share a pid there is
    // no real concurrency and everything below is theatre, whatever colour it reports.
    const a = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    const b = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const pidA = (await a.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0]
        ?.pid;
      const pidB = (await b.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0]
        ?.pid;
      expect(typeof pidA).toBe("number");
      expect(pidA).not.toBe(pidB);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it("admits exactly one of two concurrent same-person clock-ins and refuses the other", async () => {
    // Pre-create the location chain head via a DIFFERENT person, so there is a row for the holder to
    // lock while `personId`'s own live state stays "out" (currentState filters by person_id).
    await insertTimeEntry(suite.admin, {
      tenantId,
      personId: otherPersonId,
      locationId,
      eventAt: "2026-01-05T05:00:00Z",
    });

    const holder = await suite.pg.connect();
    const connA = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    const connB = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    let release: () => void = () => {};
    let holding: Promise<unknown> | undefined;
    try {
      // Hold the location chain-head lock so BOTH racers block on the append and neither can commit
      // until we release — the barrier that forces both to read state first.
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

      // Launch both clock-ins; they progress past the state read and park on a lock (buggy: both on
      // the chain head; fixed: one on the chain head, the other on the per-person `persons` lock).
      const both = Promise.all([
        attemptClockIn(connA, "2026-01-05T09:00:00Z"),
        attemptClockIn(connB, "2026-01-05T09:00:05Z"),
      ]);
      await waitForBlockedBackends(2);
      release();
      const results = await both;

      // Fixed: exactly one commits its `in`, the other is refused `attendance.already_open`, and the
      // legal record holds ONE open shift — not the double-`in` the projection undercounts.
      // Buggy: results are ["ok", "ok"] and countInEntries() is 2, and this fails.
      expect(results.filter((r) => r === "ok")).toHaveLength(1);
      expect(results).toContain("attendance.already_open");
      expect(await countInEntries()).toBe(1);
    } finally {
      release();
      if (holding) await holding.catch(() => {});
      await holder.close();
      await connA.close();
      await connB.close();
    }
  });
});

describe("clockIn does not deadlock against a concurrent same-person correction", () => {
  it("commits both a clock-in and a correction of that person at the same location", async () => {
    // The ABBA the per-person lock introduced (whole-branch re-review, reproduced on postgres:18):
    // the clock path locks P's `persons` row THEN the location `workforce_chains` head; the correction
    // path (requestCorrection → appendCorrection → appendToChain) locks the head FIRST, then takes
    // `FOR KEY SHARE` on P via the time_entries→persons FKs (time_entries_person_fk /
    // _recorded_by_person_fk / _correction_actor_fk) on INSERT — the OPPOSITE order. `FOR UPDATE`
    // conflicts with `FOR KEY SHARE`, so those two orders cross into a cycle → `deadlock detected`
    // (40P01), which appendToChain does NOT retry (only 23505). `FOR NO KEY UPDATE` does not conflict
    // with `FOR KEY SHARE`, so both commit. With `FOR UPDATE` this test is RED (one racer dies 40P01);
    // with `FOR NO KEY UPDATE` it is GREEN.
    const baseEntryId = await seedCompletedShift();

    const holder = await suite.pg.connect();
    const clockConn = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    const correctionConn = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    let release: () => void = () => {};
    let holding: Promise<unknown> | undefined;
    try {
      // Hold the location chain head so both racers queue on it in a KNOWN order.
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

      // The correction enters the head wait queue FIRST (confirmed blocked). When the head is later
      // released it is granted the head and then needs FOR KEY SHARE on P.
      const correctionResult = attemptCorrection(correctionConn, baseEntryId);
      await waitForBlockedBackends(1);
      // The clock-in takes P's persons row, then queues on the head BEHIND the correction — so at
      // release, P is already held while the correction is about to demand it: the ABBA setup.
      const clockResult = attemptClockIn(clockConn, "2026-01-05T13:00:00Z");
      await waitForBlockedBackends(2);

      release();
      const [correction, clock] = await Promise.all([correctionResult, clockResult]);

      // Both must land. With `FOR UPDATE` one is "40P01" (deadlock) and this fails.
      expect({ correction, clock }).toEqual({ correction: "ok", clock: "ok" });
    } finally {
      release();
      if (holding) await holding.catch(() => {});
      await holder.close();
      await clockConn.close();
      await correctionConn.close();
    }
  });
});
