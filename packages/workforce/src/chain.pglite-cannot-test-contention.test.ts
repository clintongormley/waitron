import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { appendToChain, type TimeEntryAppend } from "./chain.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { seedLocation, seedPerson } from "../test/fixtures.js";

const WRITERS = 20;

const pg = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});

let tenantId: string;
let personId: string;
let locationId: string;

beforeEach(async () => {
  tenantId = await seedTenant(pg.db);
  personId = await seedPerson(pg.db, tenantId);
  locationId = await seedLocation(pg.db, tenantId);
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

/**
 * A permanent, executable demonstration that the workforce chain's concurrency suite
 * (./chain.concurrency.test.ts) CANNOT live on PGlite. It is not a duplicate of that suite; it is the
 * counter-example that stops someone "simplifying" the Testcontainers dependency away later.
 *
 * THE MECHANISM, PRECISELY: PGlite serialises every `.query()`/`.transaction()` call through one
 * per-instance, weight-1 mutex — a SINGLE-BACKEND MUTEX, not "concurrent transactions merging into
 * one". With the mutex there is never a SECOND backend process for `FOR UPDATE` to block against, so
 * `appendToChain`'s head lock never actually contends: nothing runs at the same time as anything
 * else. A green run here therefore proves nothing about serialisation, which is why the real proof
 * needs distinct backends (real Postgres).
 */
describe("PGlite cannot test lock contention", () => {
  it("reports a green 20-writer contention run — while proving nothing", async () => {
    await Promise.all(
      Array.from({ length: WRITERS }, (_, i) =>
        pg.db.transaction((tx) =>
          appendToChain(
            tx,
            tenantId,
            locationId,
            inputAt(`2026-01-05T06:${String(i).padStart(2, "0")}:00Z`),
          ),
        ),
      ),
    );
    const { rows } = await pg.db.execute<{ sequence_no: number }>(sql`
      select sequence_no from time_entries where location_id = ${locationId} order by sequence_no`);
    // Green — identical to the real-Postgres suite's "distinct position with no gaps". Worthless: the
    // next test shows there was never any contention to survive.
    expect(rows.map((r) => r.sequence_no)).toEqual(
      Array.from({ length: WRITERS }, (_, i) => i + 1),
    );
  });

  it("serialises every 'concurrent' query onto one backend process (a single-backend mutex)", async () => {
    // Here is WHY the run above is worthless. Twenty queries, ONE pid. There was never contention, so
    // FOR UPDATE never blocked and the unique index was never approached. If this ever FAILS because
    // the pids differ, PGlite has gained real concurrency and the Testcontainers decision may be
    // revisited — deliberately, on evidence.
    const pids = await Promise.all(
      Array.from({ length: WRITERS }, async () => {
        const { rows } = await pg.db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        return rows[0]?.pid;
      }),
    );
    expect(new Set(pids).size).toBe(1);
  });
});
