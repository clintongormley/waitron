import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
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

/** Runs `clockIn` for `personId` as the non-superuser app role, returning "ok" on success or the
 * AppError code on refusal — so a test can assert one of two racers was correctly refused. Running as
 * the probe role (not the superuser admin) is what proves the per-person `FOR UPDATE` on `persons` is
 * PERMITTED for the app role, not merely that it serialises. */
async function attemptClockIn(db: Awaited<ReturnType<typeof suite.pg.connectAs>>, at: string) {
  try {
    await withTenant(db, tenantId, (tx) => backend.clockIn(tx, event(at)));
    return "ok";
  } catch (error) {
    return error instanceof AppError ? error.code : `unexpected: ${String(error)}`;
  }
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
