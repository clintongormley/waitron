/**
 * Two account-recovery requests for one account leave exactly ONE live action.
 *
 * ## What this suite was, and what converting it cost
 *
 * It ran against real PostgreSQL through `useTemplateDb`, took two backends, held the first
 * transaction open and asserted that the second was BLOCKED — SQLSTATE `55P03` from a
 * `set local lock_timeout = '250ms'` — on the `for update` that `requestAccountRecoveryAction`
 * took on the `persons` row. That clause is deleted: SQLite has no row locks and drizzle's SQLite
 * query builder has no `.for()`. What keeps the two requests apart is the venue file's write
 * queue — `withTransaction` (`packages/db/src/tenancy.ts`) runs its body inside `db.withWriteLock`,
 * and `packages/store/src/write-queue.ts` issues `begin immediate` / `commit` around it, so the
 * second request's `begin` does not run until the first has committed. The mechanism, its
 * measurement and its control in the other direction are recorded once on `racePair`
 * (`packages/catalogue/test/fixtures.ts`).
 *
 * **What stopped being checked:** that a second issuer is made to WAIT. The `55P03` assertion is
 * gone and there is nothing on this engine that says the same thing — `lock_timeout` has no
 * counterpart, and a caller that is queued is indistinguishable here from one that has not started.
 * The two connections are gone with it: a venue file has one writer.
 *
 * What is asserted instead is the OUTCOME the lock existed for, which is unchanged: after two
 * requests for the same account, exactly one action of that purpose is live. That is a claim the
 * old suite also made, at the end, after releasing the lock.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { managementAccountActions } from "./schema/management-account-actions.js";
import { seedManager } from "../test/fixtures.js";
import { requestAccountRecoveryAction } from "./account-action.js";

const EMAIL = "reset-race@x.com";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });

let personId: string;

beforeEach(async () => {
  await seedTenant(suite.db);
  personId = await seedManager(suite.db, { email: EMAIL });
});

/** Live actions of `purpose` for the seeded person — the thing two issuers must not each leave. */
async function liveActions(purpose: string): Promise<number> {
  const rows = await suite.db
    .select({ id: managementAccountActions.id })
    .from(managementAccountActions)
    .where(
      and(
        eq(managementAccountActions.personId, personId),
        eq(managementAccountActions.purpose, purpose),
        isNull(managementAccountActions.usedAt),
      ),
    );
  return rows.length;
}

describe("account-action issuance under concurrent requests", () => {
  it.each([
    ["active", "password_reset"],
    ["pending", "invitation"],
  ] as const)(
    "serialises %s account recovery so only the newest action remains live",
    async (status, purpose) => {
      if (status === "pending") {
        await suite.db.run(
          sql`update persons set status = 'pending', password_hash = null, pin_hash = null
              where id = ${personId}`,
        );
      }

      // Started without awaiting each other: nothing but the write queue keeps the second out.
      const [first, second] = await Promise.all([
        withTransaction(suite.db, (tx) => requestAccountRecoveryAction(tx, { email: EMAIL })),
        withTransaction(suite.db, (tx) => requestAccountRecoveryAction(tx, { email: EMAIL })),
      ]);

      // Both issuers found the account — neither was silently refused, which would make the count
      // below 1 for a reason that has nothing to do with supersession.
      expect(first?.personId).toBe(personId);
      expect(second?.personId).toBe(personId);
      // Not vacuous: measured 2026-09-22, both requests DO write a row and the first is stamped
      // `used_at` by the second — printing every row from this point gave two ids, one with a
      // timestamp and one null. A second request that silently did nothing would also read 1 here.
      expect(await liveActions(purpose)).toBe(1);
    },
  );
});
