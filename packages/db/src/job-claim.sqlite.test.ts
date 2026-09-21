import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { openVenueDatabase, type Database } from "./client.js";
import { claimLock, claimLockedRows, claimRows } from "./job-claim.js";
import { count, label, table, ts } from "./schema/columns.js";

/**
 * The three claim helpers on SQLite. `job-claim.test.ts` beside this file is PGlite's and
 * `job-claim.pg.test.ts` a real server's; both are the storage swap's step 25 (step group 7).
 *
 * What a case here can and cannot show: with one writer per file there is no second claimer to
 * partition a queue against, so every case is about what ONE claim selects, stamps and returns.
 * The property the deleted `for update … skip locked` bought — that a second claimer skips a row
 * the first holds — has nothing to hold it open on this engine.
 */
const probeJobs = table("probe_jobs", {
  position: count("position").primaryKey(),
  status: label("status").notNull(),
  printerId: count("printer_id"),
  claimedAt: ts("claimed_at"),
});

type ClaimedProbe = { position: number; status: string };

const opened: { close: () => Promise<void> }[] = [];

afterEach(async () => {
  while (opened.length > 0) await opened.pop()!.close();
});

const open = async (): Promise<Database> => {
  const store = await openVenueDatabase(mkdtempSync(join(tmpdir(), "waitron-claim-")));
  opened.push(store);
  const db = store.venue;
  db.run(sql`create table probe_jobs (
    position integer primary key,
    status text not null,
    printer_id integer,
    claimed_at text)`);
  db.run(sql`create table probe_printers (
    id integer primary key,
    host text not null,
    active integer not null)`);
  return db;
};

const seed = (db: Database, statuses: [number, string][]) => {
  for (const [position, status] of statuses) {
    db.run(sql`insert into probe_jobs (position, status) values (${position}, ${status})`);
  }
};

const statuses = (db: Database) =>
  db.all<{ position: number; status: string }>(
    sql`select position, status from probe_jobs order by position`,
  );

const CLAIM = {
  table: "probe_jobs",
  key: "position",
  claimable: sql`j.status = 'pending'`,
  order: sql`j.position`,
  set: sql`status = 'claimed'`,
  returning: sql`probe_jobs.position, probe_jobs.status`,
};

describe("claiming job rows on SQLite", () => {
  it("claims up to the limit, stamps them, and returns what it claimed", async () => {
    const db = await open();
    seed(db, [
      [1, "pending"],
      [2, "pending"],
      [3, "pending"],
    ]);

    const claimed = await claimRows<ClaimedProbe>(db, { ...CLAIM, limit: 2 });

    expect(claimed).toEqual([
      { position: 1, status: "claimed" },
      { position: 2, status: "claimed" },
    ]);
    expect(statuses(db)).toEqual([
      { position: 1, status: "claimed" },
      { position: 2, status: "claimed" },
      { position: 3, status: "pending" },
    ]);
  });

  it("claims in the order the caller asks for, not the order the rows are stored in", async () => {
    const db = await open();
    seed(db, [
      [1, "pending"],
      [2, "pending"],
      [3, "pending"],
    ]);

    const claimed = await claimRows<ClaimedProbe>(db, {
      ...CLAIM,
      order: sql`j.position desc`,
      limit: 1,
    });

    expect(claimed).toEqual([{ position: 3, status: "claimed" }]);
  });

  it("claims nothing, and changes nothing, when no row is claimable", async () => {
    const db = await open();
    seed(db, [[1, "done"]]);

    expect(await claimRows<ClaimedProbe>(db, { ...CLAIM, limit: 5 })).toEqual([]);
    expect(statuses(db)).toEqual([{ position: 1, status: "done" }]);
  });

  it("selects through a table the predicate joins, and reads a neighbour through a subquery", async () => {
    const db = await open();
    seed(db, [
      [1, "pending"],
      [2, "pending"],
    ]);
    db.run(sql`update probe_jobs set printer_id = 10 where position = 1`);
    db.run(sql`update probe_jobs set printer_id = 20 where position = 2`);
    db.run(sql`insert into probe_printers (id, host, active) values (10, 'kitchen', 1)`);
    db.run(sql`insert into probe_printers (id, host, active) values (20, 'bar', 0)`);

    const claimed = await claimRows<{ position: number; host: string }>(db, {
      ...CLAIM,
      claimableJoin: sql`join probe_printers p on p.id = j.printer_id`,
      claimable: sql`j.status = 'pending' and p.active = 1`,
      // A correlated subquery, not a joined table: SQLite's `UPDATE … FROM` refuses a RETURNING
      // clause that names the FROM table's columns — `no such column: p.host`, measured on
      // SQLite 3.53.4. A subquery in the same position reads the neighbour normally.
      returning: sql`probe_jobs.position,
        (select host from probe_printers where probe_printers.id = probe_jobs.printer_id) as host`,
      limit: 5,
    });

    expect(claimed).toEqual([{ position: 1, host: "kitchen" }]);
    expect(statuses(db)).toEqual([
      { position: 1, status: "claimed" },
      { position: 2, status: "pending" },
    ]);
  });

  it("hands back the claimable rows, unchanged, when the claim is the selection alone", async () => {
    const db = await open();
    seed(db, [
      [1, "pending"],
      [2, "done"],
    ]);

    const rows = await claimLock(
      db
        .select({ position: probeJobs.position })
        .from(probeJobs)
        .where(sql`${probeJobs.status} = 'pending'`)
        .orderBy(probeJobs.position)
        .limit(5),
    );

    expect(rows).toEqual([{ position: 1 }]);
    expect(statuses(db)).toEqual([
      { position: 1, status: "pending" },
      { position: 2, status: "done" },
    ]);
  });

  it("hands back the claimable rows, unchanged, when the selection is raw SQL", async () => {
    const db = await open();
    seed(db, [
      [1, "pending"],
      [2, "done"],
    ]);

    const rows = await claimLockedRows<{ position: number }>(db, {
      selection: sql`select position from probe_jobs j where j.status = 'pending' order by j.position`,
    });

    expect(rows).toEqual([{ position: 1 }]);
    expect(statuses(db)).toEqual([
      { position: 1, status: "pending" },
      { position: 2, status: "done" },
    ]);
  });
});
