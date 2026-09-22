/**
 * RED ON THIS BRANCH, AND NOT BY OVERSIGHT — the `for update` this suite staged its race on is gone, in BOTH places it lived.
 *
 * Two clauses went, and they were the suite's staging mechanism rather than its subject. One was
 * `fakeCore`'s `SELECT … FOR UPDATE` on the dining table (`./testing/fake-core.js`), which is what
 * the seating backend parked on. The other was this file's own `.for("update")` at the top of
 * `connBWork`, which is what held it. Both are deleted, not translated: SQLite has no row locks and
 * drizzle's SQLite query builder has no `.for()`, so each was a compile error
 * (`error TS2339: Property 'for' does not exist`, from `pnpm --filter @waitron/bookings typecheck`
 * on this branch). What serialises writers instead is the venue file's write queue — one write
 * transaction on the file at a time — stated once, with its measurement and its control, on
 * `assertExtraListForWrite` (`packages/catalogue/src/extras.ts`).
 *
 * WHAT THIS SUITE NO LONGER DEMONSTRATES. Its subject was the compare-and-swap in `seatBooking`'s
 * terminal UPDATE: that a cancel COMMITTING between the lock-free `getBooking` read and that write
 * is caught, leaving `booking.invalid_transition` and no orphan tab. Staging that needs two
 * transactions interleaved mid-flight, which is the one thing this engine does not admit — the
 * second `withTransaction` does not begin until the first has committed. The first test cannot be
 * rewritten into something that proves its subject; it can only be rewritten into something that
 * passes, which is what CLAUDE.md §4's "treat 'there is a test' as an unfinished sentence" is
 * about. So it is left.
 *
 * WHAT IT REPORTS TODAY. It does not COLLECT at all: `useTemplateDb` throws
 * `useTemplateDb: no shared container in scope. Wire the package's vitest `globalSetup` to a file
 * that calls `startSharedContainer` and `provide("sharedPg", handle).` — the real-PostgreSQL
 * harness this branch removed. Measured 2026-09-22 on `pnpm --filter @waitron/bookings test`,
 * where it reports `2 tests | 2 skipped` and then fails the FILE. Every `pg_backend_pid()`,
 * `pg_blocking_pids()` and `suite.pg.connect()` below is PostgreSQL-only and goes with that
 * harness, so no assertion in this file has run on this branch.
 *
 * WHY IT IS LEFT RATHER THAN DELETED. The second test's subject survives the engine change
 * untouched — the CAS predicate `status = 'booked'` must still match zero rows against a booking
 * that has left `booked`, and its proof-by-deletion is timing-free, so it is re-runnable the day
 * this package has a database again. And the first test's subject — a concurrent cancel must not
 * be seated — is still a requirement even where a genuine interleave cannot be staged; the CAS is
 * what enforces it, and nothing else in this package asserts it.
 *
 * The recorded proofs-by-deletion below belong to the PostgreSQL shape they were taken against and
 * have not been re-run. CLAUDE.md §4: a proof-by-deletion belongs to the shape of the code it was
 * taken against.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, diningTables, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { CoreServices } from "@waitron/module";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { bookings } from "./schema/bookings.js";
import { fakeCore } from "./testing/fake-core.js";
import {
  cancelBooking,
  createBooking,
  getBooking,
  seatBooking,
  type BookingConfig,
} from "./bookings.js";
import "./errors.js";

/** A venue's booking config plus its tenant, which the core parent rows (locations, dining_tables,
 * tills, working_orders) still carry. */
type VenueCfg = BookingConfig;

// Real PostgreSQL (a shared-container clone of the whole-manifest template), NOT PGlite. `seatBooking`'s terminal
// write is a compare-and-swap — `update … where id = ? and status = 'booked'`, throwing
// `booking.invalid_transition` on an empty match — the concurrency backstop for the window between its
// lock-free `getBooking` read (which sees `booked`) and this write. PGlite serialises every query onto
// ONE backend (CLAUDE.md §4), so it CANNOT stage the read-then-concurrent-cancel interleave that window
// exists for: the committed PGlite regression in `bookings.test.ts` reaches this UPDATE only because the
// PRE-`openTab` `booked` check has already been shadowed, never through a genuine race. This suite
// isolates the CAS branch against the real cluster, as the non-superuser `app_user`, on two
// DISTINCT backends. The shared-container globalSetup THROWS `dockerRequired` rather than skipping, so a
// vanished suite fails loudly instead of reporting a green that proves nothing.
const LOCALE = "es-ES";
const suite = useTemplateDb({ template: "manifest" });
let db: Database;
beforeAll(() => {
  db = suite.admin;
});

function asApp<T>(d: Database, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(d, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** A tenant + location + till + node. `seatBooking` opens a real TS-1 tab via `core.openTab`, so the
 * seat cfg is a plain `BookingConfig` and the till + node the tab row needs are captured by `fakeCore`
 * (whose `SELECT … FOR UPDATE` on the table used to be what made the two-backend race below stage;
 * it is gone — see this file's banner). */
async function setupVenue(): Promise<{
  cfg: VenueCfg;
  core: CoreServices;
  createdBy: string;
}> {
  await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (name, invoice_locales, operation_description) values ('Barra', array[${LOCALE}], 'Venta en establecimiento') returning id`);
  const locationId = loc.rows[0]!.id;
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (location_id, name) values (${locationId}, 'Caja 1') returning id`);
  const nodeId = await seedNode(db, brandLocationId(locationId));
  return {
    cfg: { locationId: brandLocationId(locationId) },
    core: fakeCore({ tillId: till.rows[0]!.id, nodeId }),
    createdBy: randomUUID(),
  };
}

/** Insert an ACTIVE dining table for the venue and return its id (createTable's raw equivalent — the
 * verb lives in apps/server, which a module cannot import). */
async function seedTable(cfg: VenueCfg, label: string): Promise<string> {
  const row = await db.execute<{ id: string }>(sql`
    insert into dining_tables (location_id, label, active) values (${cfg.locationId}, ${label}, true) returning id`);
  return row.rows[0]!.id;
}

/** The backend pid a connection is running on — used to poll for it becoming lock-blocked. */
async function backendPid(d: Database): Promise<number> {
  const { rows } = await d.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
  return rows[0]!.pid;
}

/**
 * Block (via condition polling, NOT a fixed sleep) until `pid` is waiting on a heavyweight lock held by
 * another backend — `pg_blocking_pids(pid)` becomes non-empty. This is the deterministic barrier that
 * makes the race below reproducible: it returns exactly when the seating backend has parked on the
 * table's `FOR UPDATE`, i.e. AFTER its `getBooking` read of `booked` and BEFORE its CAS write.
 */
async function waitUntilLockBlocked(pid: number): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const { rows } = await db.execute<{ blocked: boolean }>(
      sql`select cardinality(pg_blocking_pids(${pid})) > 0 as blocked`,
    );
    if (rows[0]!.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`backend ${pid} never became lock-blocked (the race never staged)`);
}

/** Count of `working_orders`, read as the owner. */
async function workingOrderCount(): Promise<number> {
  const { rows } = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from working_orders`,
  );
  return rows[0]!.n;
}

describe("seatBooking compare-and-swap guard (real Postgres, two backends)", () => {
  it("a GENUINE concurrent cancel between the read and the CAS write is caught → invalid_transition, no orphan tab", async () => {
    // The interleave the CAS exists for, staged deterministically:
    //  1. connB opens a tx and takes the booking's table `FOR UPDATE`, then holds it.
    //  2. connA runs the REAL `seatBooking`: its `getBooking` reads `booked` (passing the pre-check),
    //     then `openTab`'s `SELECT … FOR UPDATE` on that same table BLOCKS on connB's lock — parked
    //     precisely in the window between the read and the CAS.
    //  3. connB waits until connA is lock-blocked, then cancels the booking and COMMITS (releasing the
    //     table lock). The booking is now `cancelled`, committed, while connA is still parked.
    //  4. connA unblocks, `openTab` opens the tab, and the CAS `… where status = 'booked'` matches NO
    //     row → throws `booking.invalid_transition` → connA's whole tx rolls back, undoing the tab.
    // Proven by deletion: dropping `eq(bookings.status, "booked")` from seatBooking's terminal UPDATE
    // makes the CAS match the now-`cancelled` row, so connA SEATS it and this test's rejection fails
    // (and a tab survives). Verified 2026-08-31.
    const { cfg, core, createdBy } = await setupVenue();
    const tableId = await seedTable(cfg, "CAS-1");
    const { id: bookingId } = await asApp(db, (tx) =>
      createBooking(tx, cfg, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Núñez",
        tableId,
        createdBy,
      }),
    );

    const [connA, connB] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
    try {
      const [pidA, pidB] = await Promise.all([backendPid(connA), backendPid(connB)]);
      expect(new Set([pidA, pidB]).size).toBe(2); // distinct backends — on PGlite these collapse.

      // The lock is acquired BEFORE seatBooking is launched, so connA is guaranteed to block on it and
      // cannot win the table first. `lockHeld` fires once connB holds the `FOR UPDATE`.
      let resolveLockHeld!: () => void;
      const lockHeld = new Promise<void>((resolve) => {
        resolveLockHeld = resolve;
      });
      let cancelCommitted = false;

      const connBWork = asApp(connB, async (tx) => {
        // `.for("update")` was here: this is what held the table so the seating backend below
        // parked on it. Deleted with the clause (see this file's banner); nothing replaces it, so
        // the barrier that follows can no longer stage.
        await tx
          .select({ id: diningTables.id })
          .from(diningTables)
          .where(eq(diningTables.id, tableId));
        resolveLockHeld();
        await waitUntilLockBlocked(pidA); // connA is now parked at openTab, past its `booked` read
        await cancelBooking(tx, cfg, bookingId);
        cancelCommitted = true;
        // returning here COMMITs connB's tx → releases the table lock → connA proceeds to its CAS
      });

      await lockHeld;
      const seatA = asApp(connA, (tx) => seatBooking(tx, cfg, bookingId, {}, core));

      const [seatRes] = await Promise.allSettled([seatA, connBWork]);
      await connBWork; // surface any connB failure

      expect(cancelCommitted).toBe(true);
      expect(seatRes.status).toBe("rejected");
      expect((seatRes as PromiseRejectedResult).reason).toMatchObject({
        code: "booking.invalid_transition",
        params: { bookingId },
      });

      // The booking stayed `cancelled`, never linked a tab, and seatBooking's rolled-back tx left NO
      // working order behind — the CAS's throw rolls the whole caller tx back, so no orphan tab survives.
      const after = await asApp(db, (tx) => getBooking(tx, cfg, bookingId));
      expect(after).toMatchObject({ status: "cancelled", tabId: null });
      expect(await workingOrderCount()).toBe(0);
    } finally {
      await Promise.all([connA.close(), connB.close()]);
    }
  });

  it("guard proof by deletion: the CAS's `status = 'booked'` predicate rejects a non-booked row (0 rows)", async () => {
    // A timing-free, direct isolation of the same guard the race above exercises — insurance against the
    // race regressing to a false pass. It runs seatBooking's EXACT terminal WHERE against a booking that
    // is already `cancelled` and asserts it matches 0 rows; then it removes ONLY the `status = 'booked'`
    // predicate and asserts the SAME statement now matches 1 row. That is the compare-and-swap's whole
    // job: without the status predicate the write would seat a booking that had left `booked`.
    //
    // This proves the WHERE clause's SEMANTICS, not the wiring inside `seatBooking` — the genuine-race
    // test above covers that the real verb reaches this WHERE with a stale read. Kept as a second,
    // deterministic witness because a two-backend race, however carefully barriered, is the more fragile
    // of the two.
    const { cfg, createdBy } = await setupVenue();
    const tableId = await seedTable(cfg, "CAS-2");
    const { id: bookingId } = await asApp(db, (tx) =>
      createBooking(tx, cfg, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Ruiz",
        tableId,
        createdBy,
      }),
    );
    await asApp(db, (tx) => cancelBooking(tx, cfg, bookingId));

    await asApp(db, async (tx) => {
      // seatBooking's terminal WHERE verbatim: id AND status = 'booked'. The booking is `cancelled`, so
      // the guarded update matches nothing — the throw path.
      const guarded = await tx
        .update(bookings)
        .set({ status: "seated" })
        .where(and(eq(bookings.id, bookingId), eq(bookings.status, "booked")))
        .returning({ id: bookings.id });
      expect(guarded).toHaveLength(0);

      // The SAME update with the `status = 'booked'` predicate DELETED — the mutation that the guard
      // defends against — matches the cancelled row: 1 row, the wrong write. Rolled back below.
      const unguarded = await tx
        .update(bookings)
        .set({ status: "seated" })
        .where(eq(bookings.id, bookingId))
        .returning({ id: bookings.id });
      expect(unguarded).toHaveLength(1);

      // Undo the unguarded write so the fixture is not left `seated` (belt-and-braces; each test seeds
      // its own tenant anyway). (`tab_id` was never touched, so no FK to reset.)
      await tx.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, bookingId));
    });
  });
});
