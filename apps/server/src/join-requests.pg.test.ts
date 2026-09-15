import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTransaction, type Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { createJoinRequest, PENDING_CAP } from "./join-requests.js";
import type { TillConfig } from "./till-config.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import "./errors.js";

// Real Postgres on TWO connections, and PGlite cannot stand in: every query on PGlite serialises onto
// one backend, so two "concurrent" creators never overlap and a contention test on it is a false pass
// (CLAUDE.md §4).
//
// What this file pins is the join allocation lock's KEY. `createJoinRequest` sweeps, counts, reads
// every reserved number, picks and inserts, and the only thing making that sequence atomic against
// another creator is one transaction-scoped advisory lock taken first. The two reads it protects are
// database-wide — the cap count filters on `kind` alone, and `pendingNumbers` reads every row — so the
// lock's key has to be database-wide too. Key it to anything narrower and two creators take DIFFERENT
// locks, run at the same time, and both read a count of 9 and insert to 11: the cap stops holding with
// no error anywhere. Measured: keying it to `hashtext(cfg.locationId)` makes the case below report
// eleven pending rows and two fulfilled creators.
const suite = useTemplateDb({ template: "manifest" });

async function knock(db: Database, cfg: TillConfig, label: string): Promise<void> {
  await withTransaction(db, async (tx) => {
    await asAppUser(tx);
    await createJoinRequest(tx, cfg, { kind: "device", label });
  });
}

async function pendingCount(): Promise<number> {
  const { rows } = await suite.admin.execute<{ n: number }>(
    sql`select count(*)::int as n from join_requests`,
  );
  return rows[0]!.n;
}

describe("the join allocation lock", () => {
  it("holds the cap when two creators at different locations knock at the same moment", async () => {
    const venue = await setupVenue(suite.admin);

    // A SECOND location in the same database. This is the shape the key has to survive: nothing in
    // the product creates one today (`provisioning.second_venue` keeps one venue per database), which
    // is exactly why a location-keyed lock would look correct while guarding nothing.
    const { rows } = await suite.admin.execute<{ id: string }>(sql`
      insert into locations (name, invoice_locales, operation_description)
      values ('Terraza', array['es-ES'], 'Hospitality')
      returning id`);
    const otherCfg: TillConfig = { ...venue.cfg, locationId: brandLocationId(rows[0]!.id) };

    // Fill to one below the cap, sequentially — no race here, just the starting state.
    for (let i = 0; i < PENDING_CAP - 1; i++) await knock(suite.admin, venue.cfg, `seed-${i}`);
    expect(await pendingCount()).toBe(PENDING_CAP - 1);

    // Two separate connections, so the two transactions really are on two backends at once.
    const a = await suite.pg.connect();
    const b = await suite.pg.connect();
    try {
      const settled = await Promise.allSettled([
        knock(a, venue.cfg, "race-here"),
        knock(b, otherCfg, "race-there"),
      ]);

      // One got the last slot; the other waited for its commit, re-counted, and was refused BY NAME.
      expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toMatchObject({ code: "device.join_full" });
      expect(await pendingCount()).toBe(PENDING_CAP);
    } finally {
      await a.close();
      await b.close();
    }
  }, 60_000);
});
