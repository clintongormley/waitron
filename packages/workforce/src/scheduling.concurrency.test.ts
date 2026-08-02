import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { WorkforceBackend } from "./clocking.js";
import { CONTAINER_SETUP_TIMEOUT_MS, startRealPostgres } from "./testing/postgres.js";
import { insertRosterVersion, seedLocation, seedPerson } from "../test/fixtures.js";

const PUBLISHERS = 6;

/**
 * Real PostgreSQL via Testcontainers — deliberately NOT skipped when Docker is unavailable, the same
 * stance as chain.concurrency.test.ts. `publishRoster`'s `rosterVersionStatus` takes a
 * `SELECT … FOR UPDATE` row lock so concurrent publishes of ONE draft serialise: one flips it to
 * `published`, every other wakes on the released lock, re-reads `published`, and is refused. PGlite
 * serialises every query onto a single backend, so a contention test on it is a FALSE pass — the
 * lock could be deleted and PGlite would still show one winner because it never runs the two
 * publishes at once. Only distinct real backends can prove the lock does the work.
 */
const backend = new WorkforceBackend();
const suite = useRealPostgres({ start: startRealPostgres, timeoutMs: CONTAINER_SETUP_TIMEOUT_MS });

let tenantId: string;
let locationId: string;

beforeEach(async () => {
  tenantId = await seedTenant(suite.admin);
  locationId = await seedLocation(suite.admin, tenantId);
});

describe("publishRoster under real contention", () => {
  it("runs its publishers on distinct backend processes", async () => {
    // THE LOAD-BEARING ASSERTION (chain.concurrency.test.ts's shape). PGlite returns the same pid
    // PUBLISHERS times, and if these ever share one backend there is nothing for FOR UPDATE to block
    // against and the contention test below proves nothing, whatever colour it reports.
    const dbs = await Promise.all(Array.from({ length: PUBLISHERS }, () => suite.pg.connect()));
    try {
      const pids = await Promise.all(
        dbs.map(async (db) => {
          const { rows } = await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
          return rows[0]?.pid;
        }),
      );
      expect(new Set(pids).size).toBe(PUBLISHERS);
    } finally {
      await Promise.all(dbs.map((db) => db.close()));
    }
  });

  it("lets exactly one concurrent publish of a draft win; the rest see roster.already_published", async () => {
    // The FOR UPDATE guarantee: PUBLISHERS publishers race the SAME draft on distinct backends. The
    // head-row lock serialises the check-then-flip, so exactly one commits `published` and every
    // other, waking on the released lock, re-reads `published` and is refused — no double-publish,
    // no lost update. Prove the lock matters by DELETION: drop `for update` from rosterVersionStatus
    // and two or more publishers observe `draft` at once and each flip it, so the fulfilled count
    // climbs above one and both assertions below fail.
    const versionId = await insertRosterVersion(suite.admin, { tenantId, locationId });
    // A distinct publisher person per call, so the surviving `published_by` identifies the ONE winner
    // and proves no refused publisher overwrote it.
    const persons = await Promise.all(
      Array.from({ length: PUBLISHERS }, (_, i) =>
        seedPerson(suite.admin, tenantId, `publisher-${i}`),
      ),
    );
    const dbs = await Promise.all(Array.from({ length: PUBLISHERS }, () => suite.pg.connect()));
    try {
      const results = await Promise.allSettled(
        dbs.map((db, i) =>
          db.transaction((tx) =>
            backend.publishRoster(tx, { tenantId, versionId, publishedByPersonId: persons[i]! }),
          ),
        ),
      );

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(PUBLISHERS - 1);
      // Every refusal is the publish-once guard firing, not some unrelated failure.
      for (const r of rejected) {
        const reason = (r as PromiseRejectedResult).reason;
        expect(reason).toBeInstanceOf(AppError);
        expect((reason as AppError).code).toBe("roster.already_published");
      }

      // The committed row carries the winner's stamp — published exactly once, and no refused
      // publisher's person_id leaked in over it (the lost update the lock prevents).
      const winnerIndex = results.findIndex((r) => r.status === "fulfilled");
      const { rows } = await suite.admin.execute<{
        status: string;
        published_by_person_id: string | null;
        published_at: string | null;
      }>(sql`
        select status, published_by_person_id, published_at
        from roster_versions where id = ${versionId}`);
      expect(rows[0]!.status).toBe("published");
      expect(rows[0]!.published_by_person_id).toBe(persons[winnerIndex]!);
      expect(rows[0]!.published_at).not.toBeNull();
    } finally {
      await Promise.all(dbs.map((db) => db.close()));
    }
  });
});
