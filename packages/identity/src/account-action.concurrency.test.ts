/**
 * Two account-recovery requests for one account leave exactly ONE live action.
 *
 * Weaker than its name: it checks that outcome only. Nothing here shows that the second request
 * waited for the first — a queued caller is indistinguishable here from one that has not started.
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

      const [first, second] = await Promise.all([
        withTransaction(suite.db, (tx) => requestAccountRecoveryAction(tx, { email: EMAIL })),
        withTransaction(suite.db, (tx) => requestAccountRecoveryAction(tx, { email: EMAIL })),
      ]);

      // Both issuers found the account — neither was silently refused, which would make the count
      // below 1 for a reason that has nothing to do with supersession.
      expect(first?.personId).toBe(personId);
      expect(second?.personId).toBe(personId);
      expect(await liveActions(purpose)).toBe(1);
    },
  );
});
