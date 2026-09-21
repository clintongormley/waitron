// PGlite, deliberately: every case here is about what ONE claim statement selects, stamps and
// returns, and none of them needs a second backend. The claim's whole reason for existing — that a
// second claimer never receives a row a first claimer holds — cannot be shown on PGlite at all,
// because it serialises every query onto one backend (CLAUDE.md §4), so it lives in the sibling
// `job-claim.pg.test.ts` against a real server.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { claimLock, claimRows } from "./job-claim.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { count, label, table, ts } from "./schema/columns.js";
import { withTransaction } from "./tenancy.js";
import { useVenueDb } from "./testing/venue-db.js";

const probeJobs = table("probe_jobs", {
  position: count("position").primaryKey(),
  status: label("status").notNull(),
  printerId: count("printer_id"),
  claimedAt: ts("claimed_at"),
});

type ClaimedProbe = { position: number; status: string };

describe("claiming job rows", () => {
  const suite = useVenueDb({
    migrations: [CORE_MIGRATIONS],
    setup: async (db) => {
      await db.execute(sql`create table probe_jobs (
        position integer primary key,
        status text not null,
        printer_id integer,
        claimed_at timestamptz)`);
      await db.execute(sql`create table probe_printers (
        id integer primary key,
        host text not null,
        active boolean not null)`);
    },
  });

  const seed = async () => {
    await suite.db.execute(sql`delete from probe_jobs`);
    await suite.db.execute(sql`delete from probe_printers`);
    await suite.db.execute(sql`insert into probe_printers (id, host, active)
      values (1, 'front-of-house', true), (2, 'kitchen', false)`);
    await suite.db.execute(sql`insert into probe_jobs (position, status, printer_id)
      select n, 'pending', 1 + (n % 2) from generate_series(1, 4) as n`);
  };

  const statuses = async () => {
    const read = await suite.db.execute<{ position: number; status: string }>(
      sql`select position, status from probe_jobs order by position`,
    );
    return read.rows.map((row) => `${String(row.position)}:${row.status}`);
  };

  it("claims up to the limit, stamps them, and returns what it claimed", async () => {
    await seed();

    const claimed = await withTransaction(suite.db, (tx) =>
      claimRows<ClaimedProbe>(tx, {
        table: "probe_jobs",
        claimable: sql`j.status = 'pending'`,
        order: sql`j.position`,
        limit: 2,
        set: sql`status = 'running', claimed_at = now()`,
        returning: sql`probe_jobs.position, probe_jobs.status`,
      }),
    );

    expect(claimed.map((row) => row.position).sort()).toEqual([1, 2]);
    expect(claimed.map((row) => row.status)).toEqual(["running", "running"]);
    expect(await statuses()).toEqual(["1:running", "2:running", "3:pending", "4:pending"]);
  });

  it("claims in the order the caller asks for, not the order the rows are stored in", async () => {
    await seed();

    const claimed = await withTransaction(suite.db, (tx) =>
      claimRows<ClaimedProbe>(tx, {
        table: "probe_jobs",
        claimable: sql`j.status = 'pending'`,
        order: sql`j.position desc`,
        limit: 2,
        set: sql`status = 'running'`,
        returning: sql`probe_jobs.position, probe_jobs.status`,
      }),
    );

    expect(claimed.map((row) => row.position).sort()).toEqual([3, 4]);
    expect(await statuses()).toEqual(["1:pending", "2:pending", "3:running", "4:running"]);
  });

  it("claims nothing, and changes nothing, when no row is claimable", async () => {
    await seed();

    const claimed = await withTransaction(suite.db, (tx) =>
      claimRows<ClaimedProbe>(tx, {
        table: "probe_jobs",
        claimable: sql`j.status = 'gone'`,
        order: sql`j.position`,
        limit: 2,
        set: sql`status = 'running'`,
        returning: sql`probe_jobs.position, probe_jobs.status`,
      }),
    );

    expect(claimed).toEqual([]);
    expect(await statuses()).toEqual(["1:pending", "2:pending", "3:pending", "4:pending"]);
  });

  it("selects through a table the predicate joins, and returns columns from a table the stamp joins", async () => {
    await seed();

    const claimed = await withTransaction(suite.db, (tx) =>
      claimRows<{ position: number; host: string }>(tx, {
        table: "probe_jobs",
        claimableFrom: sql`probe_jobs j join probe_printers p on p.id = j.printer_id`,
        claimable: sql`j.status = 'pending' and p.active = true`,
        order: sql`j.position`,
        limit: 4,
        set: sql`status = 'running'`,
        join: { from: sql`probe_printers p`, on: sql`probe_jobs.printer_id = p.id` },
        returning: sql`probe_jobs.position, p.host`,
      }),
    );

    // A job's printer is `1 + (n % 2)`, so the ODD positions hang off printer 2, which is the
    // inactive one. The predicate's join is what leaves them behind.
    expect(claimed.map((row) => row.position).sort()).toEqual([2, 4]);
    expect(claimed.map((row) => row.host)).toEqual(["front-of-house", "front-of-house"]);
    expect(await statuses()).toEqual(["1:pending", "2:running", "3:pending", "4:running"]);
  });

  it("hands back the claimable rows, unchanged, when the claim is the lock alone", async () => {
    await seed();

    const locked = await withTransaction(suite.db, (tx) =>
      claimLock(
        tx
          .select({ position: probeJobs.position, status: probeJobs.status })
          .from(probeJobs)
          .where(sql`${probeJobs.status} = 'pending'`)
          .orderBy(probeJobs.position),
      ),
    );

    expect(locked.map((row) => row.position)).toEqual([1, 2, 3, 4]);
    expect(await statuses()).toEqual(["1:pending", "2:pending", "3:pending", "4:pending"]);
  });
});
