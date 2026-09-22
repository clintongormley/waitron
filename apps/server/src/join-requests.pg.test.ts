/**
 * RED ON THIS BRANCH, AND NOT BY OVERSIGHT — the advisory lock this suite staged its race on is
 * gone from the code it tests.
 *
 * WHAT WENT. `createJoinRequest` opened with a transaction-scoped advisory lock on a CONSTANT key,
 * and this file's subject was that key's SCOPE: keyed to anything narrower than the whole database,
 * two creators take different locks, both read a count of nine and both insert, so the cap stops
 * holding with no error anywhere. The lock was removed in `cd2838e4`; what arranges the same thing
 * now is the venue file's write queue, which admits ONE write transaction on the file at a time,
 * stated with its measurement and its control on `assertExtraListForWrite`
 * (`packages/catalogue/src/extras.ts`) and pointed at from `createJoinRequest`'s own header
 * (`apps/server/src/join-requests.ts`).
 *
 * WHAT THIS SUITE NO LONGER DEMONSTRATES. Its subject was a property of a lock KEY, and there is no
 * key any more: the queue's scope is the FILE, by construction, so a narrower-scope mutant is not
 * expressible. The case below cannot be rewritten into something that proves its subject — only
 * into something that passes — so it is left (CLAUDE.md §4, "treat 'there is a test' as an
 * unfinished sentence").
 *
 * THE RECEIPT IT USED TO CARRY, kept because it names what was proven and against what shape: with
 * the advisory lock keyed to `hashtext(cfg.locationId)` instead of a constant, the case below
 * reported eleven pending rows and two fulfilled creators. That proof belongs to the PostgreSQL
 * shape it was taken against and has NOT been re-run (CLAUDE.md §4). The suite also required real
 * PostgreSQL on TWO connections rather than PGlite, because every query on PGlite serialises onto
 * one backend and a contention test there is a false pass.
 *
 * WHAT STILL HAS TO HOLD, and is what a reader should look for elsewhere: two creators knocking at
 * the same moment must not both pass a count of `PENDING_CAP - 1`, and the loser must be refused by
 * name with `device.join_full`.
 *
 * WHAT IT REPORTS TODAY. It does not COLLECT: `useTemplateDb` throws `useTemplateDb: no shared
 * container in scope. Wire the package's vitest globalSetup to a file that calls
 * `startSharedContainer` and `provide("sharedPg", handle).` — the real-PostgreSQL harness this
 * branch removed. Measured 2026-09-22 on `npx vitest run src/join-requests.pg.test.ts` in
 * `apps/server`, which reports `1 test | 1 skipped` and then fails the FILE. `suite.pg.connect()`
 * below is PostgreSQL-only and goes with that harness, so no assertion here has run on this branch.
 * The SQL it writes is converted anyway, so that nothing has to be untangled twice the day this
 * package has two connections again.
 */
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, locations, withTransaction, type Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { createJoinRequest, PENDING_CAP } from "./join-requests.js";
import type { TillConfig } from "./till-config.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import "./errors.js";

const suite = useTemplateDb({ template: "manifest" });

async function knock(db: Database, cfg: TillConfig, label: string): Promise<void> {
  await withTransaction(db, async (tx) => {
    await asAppUser(tx);
    await createJoinRequest(tx, cfg, { kind: "device", label });
  });
}

async function pendingCount(): Promise<number> {
  const { rows } = await suite.admin.execute<{ n: number }>(
    // No `::int`: `count(*)` already comes back as a JavaScript number, and the cast operator is
    // a syntax error to this parser (`unrecognized token: ":"`).
    sql`select count(*) as n from join_requests`,
  );
  return rows[0]!.n;
}

describe("the join allocation lock", () => {
  it("holds the cap when two creators at different locations knock at the same moment", async () => {
    const venue = await setupVenue(suite.admin);

    // A SECOND location in the same database. This is the shape the key has to survive: nothing in
    // the product creates one today (`provisioning.second_venue` keeps one venue per database), which
    // is exactly why a location-keyed lock would look correct while guarding nothing.
    // Through the table definition, as `apps/server/src/testing/fiscal-fixtures.ts` is:
    // `locations.id` is a `$defaultFn` generator a raw insert never reaches, and `invoice_locales`
    // is a JSON array in a text column rather than a PostgreSQL `text[]`.
    const [other] = await suite.admin
      .insert(locations)
      .values({
        name: "Terraza",
        invoiceLocales: ["es-ES"],
        operationDescription: "Hospitality",
      })
      .returning({ id: locations.id });
    const otherCfg: TillConfig = { ...venue.cfg, locationId: brandLocationId(other!.id) };

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
