/**
 * RED ON THIS BRANCH, AND NOT BY OVERSIGHT — the `for update` on the `persons` row in `requestAccountRecoveryAction` is gone.
 *
 * The clause this suite was built around is deleted, not translated: SQLite has no row locks and
 * drizzle's SQLite query builder has no `.for()`. What serialises the writers instead is the venue
 * file's write queue — one write transaction on the file at a time — stated once, with its
 * measurement and its control, on `assertExtraListForWrite` (`packages/catalogue/src/extras.ts`).
 *
 * The old proof-by-deletion recorded below cannot be re-run to say whether it still discriminates,
 * because this suite does not COLLECT: `useTemplateDb` throws
 * `useTemplateDb: no shared container in scope. Wire the package's vitest globalSetup to a file
 * that calls startSharedContainer and provide("sharedPg", handle).` — the real-PostgreSQL harness
 * this branch removed. Measured 2026-09-21 on the whole package run. It is left in place rather
 * than deleted because its behavioural subject — two recovery requests for one account leave ONE live action, not
 * two — still has to hold on this engine, and nothing asserts it yet.
 */
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { captureError, pgErrorCode, withTransaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { seedManager } from "../test/fixtures.js";
import { requestAccountRecoveryAction } from "./account-action.js";

// Real PostgreSQL is required: PGlite serialises all queries on one backend, so it cannot prove that
// the person-row lock prevents two concurrent reset issuers from leaving two live successor tokens.
const suite = useTemplateDb({ template: "core_identity" });

let personId: string;

beforeEach(async () => {
  await seedTenant(suite.admin);
  personId = await seedManager(suite.admin, { email: "reset-race@x.com" });
});

describe("account-action issuance under real concurrency", () => {
  it.each([
    ["active", "password_reset"],
    ["pending", "invitation"],
  ] as const)(
    "serialises %s account recovery so only the newest action remains live",
    async (status, purpose) => {
      if (status === "pending") {
        await suite.admin.execute(
          sql`update persons set status = 'pending', password_hash = null, pin_hash = null where id = ${personId}`,
        );
      }
      const c1 = await suite.pg.connect();
      const c2 = await suite.pg.connect();
      let releaseFirst: () => void = () => {};
      const holdFirst = new Promise<void>((resolve) => (releaseFirst = resolve));
      let firstReady: () => void = () => {};
      const firstIssued = new Promise<void>((resolve) => (firstReady = resolve));
      let c1Done: Promise<unknown> | undefined;
      try {
        c1Done = withTransaction(c1, async (tx) => {
          const issued = await requestAccountRecoveryAction(tx, {
            email: "reset-race@x.com",
          });
          expect(issued?.personId).toBe(personId);
          firstReady();
          await holdFirst;
          return issued;
        });
        await firstIssued;

        const blocked = await captureError(() =>
          withTransaction(c2, async (tx) => {
            await tx.execute(sql`set local lock_timeout = '250ms'`);
            return requestAccountRecoveryAction(tx, { email: "reset-race@x.com" });
          }),
        );
        expect(pgErrorCode(blocked)).toBe("55P03");

        releaseFirst();
        await c1Done;
        await withTransaction(c2, (tx) =>
          requestAccountRecoveryAction(tx, { email: "reset-race@x.com" }),
        );
        const live = await suite.admin.execute<{ count: string }>(sql`
        select count(*) as count
        from management_account_actions
        where person_id = ${personId}
          and purpose = ${purpose}
          and used_at is null`);
        expect(live.rows[0]!.count).toBe("1");
      } finally {
        releaseFirst();
        if (c1Done) await c1Done.catch(() => {});
        await c1.close();
        await c2.close();
      }
    },
  );
});
