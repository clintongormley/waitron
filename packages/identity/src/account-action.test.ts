import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_ACTION_TTL_MS,
  completeAccountAction,
  issueAccountAction,
  requestPasswordResetAction,
} from "./account-action.js";
import { loginManager } from "./manager-login.js";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { setEmail } from "./staff.js";
import { codeOf, seedManager } from "../test/fixtures.js";

let tenantId: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  setup: async (db) => {
    tenantId = await seedTenant(db);
  },
});

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(suite.db, tenantId, fn);
}

describe("management account actions", () => {
  it("stores only a token hash and consumes an invitation into a fresh session", async () => {
    const personId = await seedManager(suite.db, tenantId, {
      email: "new-person@x.com",
    });
    const oldSession = await run((tx) =>
      loginManager(tx, {
        tenantId,
        email: "new-person@x.com",
        password: "correct horse",
      }),
    );
    const issued = await run((tx) =>
      issueAccountAction(tx, { tenantId, personId, purpose: "invitation" }),
    );

    const stored = await suite.db.execute<{ token_hash: string; used_at: string | null }>(
      sql`select token_hash, used_at from management_account_actions where id = ${issued.id}`,
    );
    expect(stored.rows[0]!.token_hash).not.toContain(issued.token);
    expect(stored.rows[0]!.used_at).toBeNull();

    const session = await run((tx) =>
      completeAccountAction(tx, {
        tenantId,
        token: issued.token,
        purpose: "invitation",
        password: "a new secure password",
      }),
    );
    expect(session.personId).toBe(personId);
    await expect(
      run((tx) =>
        loginManager(tx, {
          tenantId,
          email: "new-person@x.com",
          password: "a new secure password",
        }),
      ),
    ).resolves.toMatchObject({ personId });
    const verified = await suite.db.execute<{ email_verified_at: string | null }>(
      sql`select email_verified_at from persons where id = ${personId}`,
    );
    expect(verified.rows[0]!.email_verified_at).not.toBeNull();
    const sessions = await suite.db.execute<{ id: string; ended_at: string | null }>(
      sql`select id, ended_at from management_sessions
          where person_id = ${personId} order by created_at`,
    );
    expect(sessions.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: oldSession.id, ended_at: expect.any(String) }),
        expect.objectContaining({ id: session.id, ended_at: null }),
      ]),
    );

    await run((tx) =>
      setEmail(tx, {
        managementSessionId: session.id,
        personId,
        email: "replacement@x.com",
      }),
    );
    const changed = await suite.db.execute<{ email_verified_at: string | null }>(
      sql`select email_verified_at from persons where id = ${personId}`,
    );
    expect(changed.rows[0]!.email_verified_at).toBeNull();
    expect(
      await codeOf(() =>
        run((tx) =>
          completeAccountAction(tx, {
            tenantId,
            token: issued.token,
            purpose: "invitation",
            password: "another secure password",
          }),
        ),
      ),
    ).toBe("account_action.invalid");
  });

  it("invalidates an earlier action of the same purpose", async () => {
    const personId = await seedManager(suite.db, tenantId, { email: "resend@x.com" });
    const first = await run((tx) =>
      issueAccountAction(tx, { tenantId, personId, purpose: "invitation" }),
    );
    const second = await run((tx) =>
      issueAccountAction(tx, { tenantId, personId, purpose: "invitation" }),
    );
    expect(
      await codeOf(() =>
        run((tx) =>
          completeAccountAction(tx, {
            tenantId,
            token: first.token,
            purpose: "invitation",
            password: "a new secure password",
          }),
        ),
      ),
    ).toBe("account_action.invalid");
    await expect(
      run((tx) =>
        completeAccountAction(tx, {
          tenantId,
          token: second.token,
          purpose: "invitation",
          password: "a new secure password",
        }),
      ),
    ).resolves.toMatchObject({ personId });
  });

  it("finds password-reset accounts by normalized email without revealing unknown addresses", async () => {
    const personId = await seedManager(suite.db, tenantId, { email: "known@x.com" });
    await expect(
      run((tx) => requestPasswordResetAction(tx, { tenantId, email: "  KNOWN@X.COM  " })),
    ).resolves.toMatchObject({ personId, email: "known@x.com" });
    await expect(
      run((tx) => requestPasswordResetAction(tx, { tenantId, email: "unknown@x.com" })),
    ).resolves.toBeNull();
  });

  it("refuses an expired token", async () => {
    const personId = await seedManager(suite.db, tenantId, { email: "expired@x.com" });
    const now = new Date("2026-09-08T12:00:00.000Z");
    const issued = await run((tx) =>
      issueAccountAction(tx, {
        tenantId,
        personId,
        purpose: "password_reset",
        now,
      }),
    );
    expect(Date.parse(issued.expiresAt) - now.getTime()).toBe(ACCOUNT_ACTION_TTL_MS.password_reset);
    expect(
      await codeOf(() =>
        run((tx) =>
          completeAccountAction(tx, {
            tenantId,
            token: issued.token,
            purpose: "password_reset",
            password: "a new secure password",
            now: new Date(Date.parse(issued.expiresAt) + 1),
          }),
        ),
      ),
    ).toBe("account_action.invalid");
  });

  it("refuses a valid token presented for the wrong purpose without consuming it", async () => {
    const personId = await seedManager(suite.db, tenantId, { email: "purpose@x.com" });
    const issued = await run((tx) =>
      issueAccountAction(tx, { tenantId, personId, purpose: "invitation" }),
    );
    expect(
      await codeOf(() =>
        run((tx) =>
          completeAccountAction(tx, {
            tenantId,
            token: issued.token,
            purpose: "password_reset",
            password: "a new secure password",
          }),
        ),
      ),
    ).toBe("account_action.invalid");
    await expect(
      run((tx) =>
        completeAccountAction(tx, {
          tenantId,
          token: issued.token,
          purpose: "invitation",
          password: "a new secure password",
        }),
      ),
    ).resolves.toMatchObject({ personId });
  });
});
