import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { captureError, pgErrorCode, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { seedManager } from "../test/fixtures.js";
import { requestInvitationAction, requestAccountRecoveryAction } from "./account-action.js";

// Real PostgreSQL is required: PGlite serialises all queries on one backend, so it cannot prove that
// the person-row lock prevents two concurrent reset issuers from leaving two live successor tokens.
const suite = useTemplateDb({ template: "core_identity" });

let tenantId: string;
let personId: string;

beforeEach(async () => {
  tenantId = await seedTenant(suite.admin);
  personId = await seedManager(suite.admin, tenantId, { email: "reset-race@x.com" });
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
        c1Done = withTenant(c1, tenantId, async (tx) => {
          const issued = await requestAccountRecoveryAction(tx, {
            tenantId,
            email: "reset-race@x.com",
          });
          expect(issued?.personId).toBe(personId);
          firstReady();
          await holdFirst;
          return issued;
        });
        await firstIssued;

        const blocked = await captureError(() =>
          withTenant(c2, tenantId, async (tx) => {
            await tx.execute(sql`set local lock_timeout = '250ms'`);
            return requestAccountRecoveryAction(tx, { tenantId, email: "reset-race@x.com" });
          }),
        );
        expect(pgErrorCode(blocked)).toBe("55P03");

        releaseFirst();
        await c1Done;
        await withTenant(c2, tenantId, (tx) =>
          requestAccountRecoveryAction(tx, { tenantId, email: "reset-race@x.com" }),
        );
        const live = await suite.admin.execute<{ count: string }>(sql`
        select count(*) as count
        from management_account_actions
        where tenant_id = ${tenantId}
          and person_id = ${personId}
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

  it("serialises invitation replacement on the person row so only the newest action remains live", async () => {
    await suite.admin.execute(
      sql`update persons set status = 'pending', password_hash = null, pin_hash = null where id = ${personId}`,
    );
    const codeKey = Buffer.alloc(32, 23);
    const c1 = await suite.pg.connect();
    const c2 = await suite.pg.connect();
    let releaseFirst: () => void = () => {};
    const holdFirst = new Promise<void>((resolve) => (releaseFirst = resolve));
    let firstReady: () => void = () => {};
    const firstIssued = new Promise<void>((resolve) => (firstReady = resolve));
    let c1Done: Promise<unknown> | undefined;
    try {
      c1Done = withTenant(c1, tenantId, async (tx) => {
        const issued = await requestInvitationAction(tx, {
          tenantId,
          email: "reset-race@x.com",
          codeKey,
        });
        expect(issued?.personId).toBe(personId);
        firstReady();
        await holdFirst;
        return issued;
      });
      await firstIssued;

      const blocked = await captureError(() =>
        withTenant(c2, tenantId, async (tx) => {
          await tx.execute(sql`set local lock_timeout = '250ms'`);
          return requestInvitationAction(tx, {
            tenantId,
            email: "reset-race@x.com",
            codeKey,
          });
        }),
      );
      expect(pgErrorCode(blocked)).toBe("55P03");

      releaseFirst();
      await c1Done;
      await withTenant(c2, tenantId, (tx) =>
        requestInvitationAction(tx, { tenantId, email: "reset-race@x.com", codeKey }),
      );
      const live = await suite.admin.execute<{ count: string }>(sql`
        select count(*) as count
        from management_account_actions
        where tenant_id = ${tenantId}
          and person_id = ${personId}
          and purpose = 'invitation'
          and used_at is null`);
      expect(live.rows[0]!.count).toBe("1");
    } finally {
      releaseFirst();
      if (c1Done) await c1Done.catch(() => {});
      await c1.close();
      await c2.close();
    }
  });
});
