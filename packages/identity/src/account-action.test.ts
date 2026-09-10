import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_ACTION_TTL_MS,
  completeAccountAction,
  completeAccountActionByCode,
  inspectAccountAction,
  inspectAccountActionByCode,
  issueAccountAction,
  requestInvitationAction,
  requestPasswordResetAction,
} from "./account-action.js";
import { loginManager } from "./manager-login.js";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { updatePersonDetails } from "./staff.js";
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

async function makePending(personId: string): Promise<void> {
  await suite.db.execute(
    sql`update persons set status = 'pending', password_hash = null, pin_hash = null where id = ${personId}`,
  );
}

describe("management account actions", () => {
  it("inspects an invitation proof without consuming it, then completes the same action", async () => {
    const codeKey = Buffer.alloc(32, 18);
    const personId = await seedManager(suite.db, tenantId, { email: "inspect@x.com" });
    await makePending(personId);
    const issued = await run((tx) =>
      issueAccountAction(tx, { tenantId, personId, purpose: "invitation", codeKey }),
    );
    await expect(
      run((tx) =>
        inspectAccountAction(tx, { tenantId, token: issued.token, purpose: "invitation" }),
      ),
    ).resolves.toEqual({ email: "inspect@x.com", purpose: "invitation" });
    await expect(
      run((tx) =>
        inspectAccountActionByCode(tx, {
          tenantId,
          email: "inspect@x.com",
          code: issued.code!,
          purpose: "invitation",
          codeKey,
        }),
      ),
    ).resolves.toEqual({ email: "inspect@x.com", purpose: "invitation" });
    await expect(
      run((tx) =>
        completeAccountAction(tx, {
          tenantId,
          token: issued.token,
          purpose: "invitation",
          password: "a new secure password",
          pin: "4321",
        }),
      ),
    ).resolves.toMatchObject({ personId });
  });

  it("requests a replacement invitation only for a pending account", async () => {
    const codeKey = Buffer.alloc(32, 19);
    const pending = await seedManager(suite.db, tenantId, { email: "replacement-invite@x.com" });
    await makePending(pending);
    await expect(
      run((tx) =>
        requestInvitationAction(tx, { tenantId, email: " REPLACEMENT-INVITE@X.COM ", codeKey }),
      ),
    ).resolves.toMatchObject({ personId: pending, purpose: "invitation" });
    await seedManager(suite.db, tenantId, { email: "active-resend@x.com" });
    await expect(
      run((tx) => requestInvitationAction(tx, { tenantId, email: "active-resend@x.com", codeKey })),
    ).resolves.toBeNull();
    await expect(
      run((tx) => requestInvitationAction(tx, { tenantId, email: "unknown@x.com", codeKey })),
    ).resolves.toBeNull();
  });
  it("accepts the invitation's short-lived email code once and counts wrong guesses", async () => {
    const codeKey = Buffer.alloc(32, 7);
    const personId = await seedManager(suite.db, tenantId, { email: "code@x.com" });
    await makePending(personId);
    const issued = await run((tx) =>
      issueAccountAction(tx, { tenantId, personId, purpose: "invitation", codeKey }),
    );
    expect(issued.code).toMatch(/^\d{6}$/);

    await expect(
      run((tx) =>
        completeAccountActionByCode(tx, {
          tenantId,
          email: "code@x.com",
          code: "000000",
          purpose: "invitation",
          password: "a new secure password",
          pin: "4321",
          codeKey,
        }),
      ),
    ).resolves.toBeNull();
    const attempts = await suite.db.execute<{ code_attempts: number }>(
      sql`select code_attempts from management_account_actions where id = ${issued.id}`,
    );
    expect(attempts.rows[0]!.code_attempts).toBe(1);

    await expect(
      run((tx) =>
        completeAccountActionByCode(tx, {
          tenantId,
          email: " CODE@X.COM ",
          code: issued.code!,
          purpose: "invitation",
          password: "a new secure password",
          pin: "4321",
          codeKey,
        }),
      ),
    ).resolves.toMatchObject({ personId });
    await expect(
      run((tx) =>
        completeAccountActionByCode(tx, {
          tenantId,
          email: "code@x.com",
          code: issued.code!,
          purpose: "invitation",
          password: "another secure password",
          pin: "9876",
          codeKey,
        }),
      ),
    ).resolves.toBeNull();
  });

  it("requires an invitation PIN and activates a pending account only after complete setup", async () => {
    const personId = await seedManager(suite.db, tenantId, { email: "pending@x.com" });
    await makePending(personId);
    const issued = await run((tx) =>
      issueAccountAction(tx, { tenantId, personId, purpose: "invitation" }),
    );

    await expect(
      run((tx) =>
        completeAccountAction(tx, {
          tenantId,
          token: issued.token,
          purpose: "invitation",
          password: "a new secure password",
        }),
      ),
    ).rejects.toMatchObject({ code: "pin.too_short" });

    const completion = await run((tx) =>
      completeAccountAction(tx, {
        tenantId,
        token: issued.token,
        purpose: "invitation",
        password: "a new secure password",
        pin: "4321",
      }),
    );
    expect(completion.personId).toBe(personId);
    expect(completion.session).not.toBeNull();
    const rows = await suite.db.execute<{ status: string; pin_hash: string | null }>(
      sql`select status, pin_hash from persons where id = ${personId}`,
    );
    expect(rows.rows[0]).toMatchObject({ status: "active", pin_hash: expect.any(String) });
  });

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
    await makePending(personId);
    const issued = await run((tx) =>
      issueAccountAction(tx, { tenantId, personId, purpose: "invitation" }),
    );

    const stored = await suite.db.execute<{ token_hash: string; used_at: string | null }>(
      sql`select token_hash, used_at from management_account_actions where id = ${issued.id}`,
    );
    expect(stored.rows[0]!.token_hash).not.toContain(issued.token);
    expect(stored.rows[0]!.used_at).toBeNull();

    const completion = await run((tx) =>
      completeAccountAction(tx, {
        tenantId,
        token: issued.token,
        purpose: "invitation",
        password: "a new secure password",
        pin: "4321",
      }),
    );
    expect(completion.personId).toBe(personId);
    expect(completion.session).not.toBeNull();
    const session = completion.session!;
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

    const outstanding = await run((tx) =>
      issueAccountAction(tx, { tenantId, personId, purpose: "password_reset" }),
    );
    await run((tx) =>
      updatePersonDetails(tx, {
        managementSessionId: session.id,
        personId,
        displayName: "New person",
        firstNames: "New",
        lastNames: "Person",
        telephone: null,
        email: "replacement@x.com",
        role: "manager",
        status: "active",
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
            token: outstanding.token,
            purpose: "password_reset",
            password: "another secure password",
          }),
        ),
      ),
    ).toBe("account_action.invalid");
  });

  it("invalidates an earlier action of the same purpose", async () => {
    const personId = await seedManager(suite.db, tenantId, { email: "resend@x.com" });
    await makePending(personId);
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
            pin: "4321",
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
          pin: "4321",
        }),
      ),
    ).resolves.toMatchObject({ personId });
  });

  it("finds password-reset accounts by normalized email without revealing unknown addresses", async () => {
    const personId = await seedManager(suite.db, tenantId, { email: "known@x.com" });
    await suite.db.execute(sql`update persons set email = 'Known@X.com' where id = ${personId}`);
    await expect(
      run((tx) => requestPasswordResetAction(tx, { tenantId, email: "  KNOWN@X.COM  " })),
    ).resolves.toMatchObject({ personId, email: "Known@X.com" });
    await expect(
      run((tx) => requestPasswordResetAction(tx, { tenantId, email: "unknown@x.com" })),
    ).resolves.toBeNull();
  });

  it("changes the password without opening a session that bypasses an enrolled authenticator", async () => {
    const personId = await seedManager(suite.db, tenantId, { email: "mfa-reset@x.com" });
    await suite.db.execute(
      sql`update persons set totp_secret = 'sealed-placeholder' where id = ${personId}`,
    );
    const issued = await run((tx) =>
      issueAccountAction(tx, { tenantId, personId, purpose: "password_reset" }),
    );
    await expect(
      run((tx) =>
        completeAccountAction(tx, {
          tenantId,
          token: issued.token,
          purpose: "password_reset",
          password: "a replacement secure password",
        }),
      ),
    ).resolves.toEqual({ personId, session: null });
    const person = await suite.db.execute<{ totp_secret: string | null }>(
      sql`select totp_secret from persons where id = ${personId}`,
    );
    expect(person.rows[0]!.totp_secret).toBe("sealed-placeholder");
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
    await makePending(personId);
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
          pin: "4321",
        }),
      ),
    ).resolves.toMatchObject({ personId });
  });
});
