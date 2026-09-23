import { randomUUID } from "node:crypto";
import { CORE_MIGRATIONS, captureError, triggerRaised, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { isAppError, quoteLiteral } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_ACTION_TTL_MS,
  completeAccountAction,
  confirmEmailChangeByCode,
  inspectAccountAction,
  issueAccountAction,
  requestAccountRecoveryAction,
} from "./account-action.js";
import { loginManager } from "./manager-login.js";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { updatePersonDetails } from "./staff.js";
import { codeOf, seedManager, seedPerson } from "../test/fixtures.js";

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  setup: async (db) => {
    await seedTenant(db);
  },
});

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

async function makePending(personId: string): Promise<void> {
  await suite.db.execute(
    sql`update persons set status = 'pending', password_hash = null, pin_hash = null where id = ${personId}`,
  );
}

describe("management account actions", () => {
  it("does not mint a hidden invitation code even when a code key is supplied", async () => {
    const personId = await seedManager(suite.db, { email: "no-hidden-code@x.com" });
    await makePending(personId);
    const issued = await run((tx) =>
      issueAccountAction(tx, {
        personId,
        purpose: "invitation",
        codeKey: Buffer.alloc(32, 19),
      }),
    );
    expect(issued.code).toBeUndefined();
    expect(issued.codeExpiresAt).toBeUndefined();
    const row = await suite.db.execute<{
      code_hash: string | null;
      code_expires_at: string | null;
    }>(sql`select code_hash,code_expires_at from management_account_actions where id=${issued.id}`);
    expect(row.rows).toEqual([{ code_hash: null, code_expires_at: null }]);
  });

  it("inspects an invitation proof without consuming it, then completes the same action", async () => {
    const personId = await seedManager(suite.db, { email: "inspect@x.com" });
    await makePending(personId);
    const issued = await run((tx) => issueAccountAction(tx, { personId, purpose: "invitation" }));
    await expect(
      run((tx) => inspectAccountAction(tx, { token: issued.token, purpose: "invitation" })),
    ).resolves.toEqual({ email: "inspect@x.com", purpose: "invitation" });
    await expect(
      run((tx) =>
        completeAccountAction(tx, {
          token: issued.token,
          purpose: "invitation",
          password: "a new secure password",
          pin: "4321",
        }),
      ),
    ).resolves.toMatchObject({ personId });
  });

  it("accepts the email-change code once and counts wrong guesses", async () => {
    const codeKey = Buffer.alloc(32, 7);
    const personId = await seedManager(suite.db, { email: "code@x.com" });
    await suite.db.execute(
      sql`update persons set pending_email = 'changed@x.com' where id = ${personId}`,
    );
    const issued = await run((tx) =>
      issueAccountAction(tx, {
        personId,
        purpose: "email_change",
        codeKey,
        targetEmail: "changed@x.com",
      }),
    );
    expect(issued.code).toMatch(/^\d{6}$/);

    await expect(
      run((tx) =>
        confirmEmailChangeByCode(tx, {
          personId,
          code: issued.code === "000000" ? "111111" : "000000",
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
        confirmEmailChangeByCode(tx, {
          personId,
          code: issued.code!,
          codeKey,
        }),
      ),
    ).resolves.toBe("changed@x.com");
    await expect(
      run((tx) =>
        confirmEmailChangeByCode(tx, {
          personId,
          code: issued.code!,
          codeKey,
        }),
      ),
    ).resolves.toBeNull();
  });

  it("requires an invitation PIN and activates a pending account only after complete setup", async () => {
    const personId = await seedManager(suite.db, { email: "pending@x.com" });
    await makePending(personId);
    const issued = await run((tx) => issueAccountAction(tx, { personId, purpose: "invitation" }));

    await expect(
      run((tx) =>
        completeAccountAction(tx, {
          token: issued.token,
          purpose: "invitation",
          password: "a new secure password",
        }),
      ),
    ).rejects.toMatchObject({ code: "pin.too_short" });

    const completion = await run((tx) =>
      completeAccountAction(tx, {
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
    const personId = await seedManager(suite.db, {
      email: "new-person@x.com",
    });
    const oldSession = await run((tx) =>
      loginManager(tx, {
        email: "new-person@x.com",
        password: "correct horse",
      }),
    );
    await makePending(personId);
    const issued = await run((tx) => issueAccountAction(tx, { personId, purpose: "invitation" }));

    const stored = await suite.db.execute<{ token_hash: string; used_at: string | null }>(
      sql`select token_hash, used_at from management_account_actions where id = ${issued.id}`,
    );
    expect(stored.rows[0]!.token_hash).not.toContain(issued.token);
    expect(stored.rows[0]!.used_at).toBeNull();

    const completion = await run((tx) =>
      completeAccountAction(tx, {
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
      issueAccountAction(tx, { personId, purpose: "password_reset" }),
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
            token: outstanding.token,
            purpose: "password_reset",
            password: "another secure password",
          }),
        ),
      ),
    ).toBe("account_action.invalid");
  });

  it("invalidates an earlier action of the same purpose", async () => {
    const personId = await seedManager(suite.db, { email: "resend@x.com" });
    await makePending(personId);
    const first = await run((tx) => issueAccountAction(tx, { personId, purpose: "invitation" }));
    const second = await run((tx) => issueAccountAction(tx, { personId, purpose: "invitation" }));
    expect(
      await codeOf(() =>
        run((tx) =>
          completeAccountAction(tx, {
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
          token: second.token,
          purpose: "invitation",
          password: "a new secure password",
          pin: "4321",
        }),
      ),
    ).resolves.toMatchObject({ personId });
  });

  it("finds password-reset accounts by normalized email without revealing unknown addresses", async () => {
    const personId = await seedManager(suite.db, { email: "known@x.com" });
    await suite.db.execute(sql`update persons set email = 'Known@X.com' where id = ${personId}`);
    await expect(
      run((tx) => requestAccountRecoveryAction(tx, { email: "  KNOWN@X.COM  " })),
    ).resolves.toMatchObject({ personId, email: "Known@X.com", purpose: "password_reset" });
    await expect(
      run((tx) => requestAccountRecoveryAction(tx, { email: "unknown@x.com" })),
    ).resolves.toBeNull();
  });

  it("uses the recovery entry to issue a setup link for a pending account", async () => {
    const personId = await seedManager(suite.db, { email: "recovery-pending@x.com" });
    await makePending(personId);
    const now = new Date("2026-09-11T12:00:00Z");
    const issued = await run((tx) =>
      requestAccountRecoveryAction(tx, { email: " RECOVERY-PENDING@X.COM ", now }),
    );
    expect(issued).toMatchObject({ personId, purpose: "invitation" });
    expect(issued?.code).toBeUndefined();
    expect(Date.parse(issued!.expiresAt) - now.getTime()).toBe(ACCOUNT_ACTION_TTL_MS.invitation);
    await expect(
      run((tx) =>
        completeAccountAction(tx, {
          token: issued!.token,
          purpose: "password_reset",
          password: "a replacement password",
          now,
        }),
      ),
    ).rejects.toMatchObject({ code: "account_action.invalid" });
    await expect(
      run((tx) =>
        completeAccountAction(tx, {
          token: issued!.token,
          purpose: "invitation",
          password: "a replacement password",
          pin: "1234",
          now,
        }),
      ),
    ).resolves.toMatchObject({ personId, session: { personId } });
  });

  it("does not issue recovery actions for suspended or malformed accounts", async () => {
    const personId = await seedManager(suite.db, { email: "recovery-suspended@x.com" });
    await suite.db.execute(sql`update persons set status = 'suspended' where id = ${personId}`);
    for (const email of ["recovery-suspended@x.com", "malformed"]) {
      await expect(run((tx) => requestAccountRecoveryAction(tx, { email }))).resolves.toBeNull();
    }
  });

  it("changes the password without opening a session that bypasses an enrolled authenticator", async () => {
    const personId = await seedManager(suite.db, { email: "mfa-reset@x.com" });
    await suite.db.execute(
      sql`update persons set totp_secret = 'sealed-placeholder' where id = ${personId}`,
    );
    const issued = await run((tx) =>
      issueAccountAction(tx, { personId, purpose: "password_reset" }),
    );
    await expect(
      run((tx) =>
        completeAccountAction(tx, {
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
    const personId = await seedManager(suite.db, { email: "expired@x.com" });
    const now = new Date("2026-09-08T12:00:00.000Z");
    const issued = await run((tx) =>
      issueAccountAction(tx, {
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
    const personId = await seedManager(suite.db, { email: "purpose@x.com" });
    await makePending(personId);
    const issued = await run((tx) => issueAccountAction(tx, { personId, purpose: "invitation" }));
    expect(
      await codeOf(() =>
        run((tx) =>
          completeAccountAction(tx, {
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
          token: issued.token,
          purpose: "invitation",
          password: "a new secure password",
          pin: "4321",
        }),
      ),
    ).resolves.toMatchObject({ personId });
  });
});

describe("issuing an account action refuses an account that cannot receive one", () => {
  it("refuses a person id that matches nobody", async () => {
    const personId = randomUUID();
    await expect(
      run((tx) => issueAccountAction(tx, { personId, purpose: "password_reset" })),
    ).rejects.toMatchObject({ code: "person.not_found", params: { personId } });
  });

  it("refuses every purpose for a suspended person", async () => {
    const personId = await seedManager(suite.db, {
      email: "issue-suspended@x.com",
      status: "suspended",
    });
    for (const purpose of ["password_reset", "invitation", "email_change"] as const) {
      await expect(
        run((tx) => issueAccountAction(tx, { personId, purpose, targetEmail: "elsewhere@x.com" })),
      ).rejects.toMatchObject({ code: "person.suspended", params: { personId } });
    }
  });

  it("issues an invitation only to a pending person and an email change only to an active one", async () => {
    const activeId = await seedManager(suite.db, { email: "issue-active@x.com" });
    expect(
      await codeOf(() =>
        run((tx) => issueAccountAction(tx, { personId: activeId, purpose: "invitation" })),
      ),
    ).toBe("person.transition_invalid");
    const pendingId = await seedManager(suite.db, { email: "issue-pending@x.com" });
    await makePending(pendingId);
    expect(
      await codeOf(() =>
        run((tx) =>
          issueAccountAction(tx, {
            personId: pendingId,
            purpose: "email_change",
            targetEmail: "issue-pending-next@x.com",
          }),
        ),
      ),
    ).toBe("person.transition_invalid");
  });

  it("refuses a person with no login email", async () => {
    const personId = await seedPerson(suite.db, "manager");
    expect(
      await codeOf(() =>
        run((tx) => issueAccountAction(tx, { personId, purpose: "password_reset" })),
      ),
    ).toBe("person.email_invalid");
  });

  it("refuses an email change whose target address is missing or malformed", async () => {
    const personId = await seedManager(suite.db, { email: "issue-target@x.com" });
    for (const targetEmail of [undefined, "not-an-address"]) {
      expect(
        await codeOf(() =>
          run((tx) => issueAccountAction(tx, { personId, purpose: "email_change", targetEmail })),
        ),
      ).toBe("person.email_invalid");
    }
    const rows = await suite.db.execute<{ id: string }>(
      sql`select id from management_account_actions where person_id = ${personId}`,
    );
    expect(rows.rows).toEqual([]);
  });
});

describe("inspecting an account action", () => {
  it("accepts a password-reset proof for an active person without consuming it", async () => {
    const personId = await seedManager(suite.db, { email: "inspect-reset@x.com" });
    const issued = await run((tx) =>
      issueAccountAction(tx, { personId, purpose: "password_reset" }),
    );
    await expect(
      run((tx) => inspectAccountAction(tx, { token: issued.token, purpose: "password_reset" })),
    ).resolves.toEqual({ email: "inspect-reset@x.com", purpose: "password_reset" });
    const row = await suite.db.execute<{ used_at: string | null }>(
      sql`select used_at from management_account_actions where id = ${issued.id}`,
    );
    expect(row.rows).toEqual([{ used_at: null }]);
  });

  it("refuses an unknown token", async () => {
    expect(
      await codeOf(() =>
        run((tx) =>
          inspectAccountAction(tx, { token: "no-such-token", purpose: "password_reset" }),
        ),
      ),
    ).toBe("account_action.invalid");
  });

  it("refuses a live proof whose person has since lost their login email", async () => {
    const personId = await seedManager(suite.db, { email: "inspect-no-email@x.com" });
    const issued = await run((tx) =>
      issueAccountAction(tx, { personId, purpose: "password_reset" }),
    );
    await suite.db.execute(
      sql`update persons set email = null, email_folded = null where id = ${personId}`,
    );
    expect(
      await codeOf(() =>
        run((tx) => inspectAccountAction(tx, { token: issued.token, purpose: "password_reset" })),
      ),
    ).toBe("account_action.invalid");
  });

  it("refuses a live invitation whose person is no longer pending", async () => {
    const personId = await seedManager(suite.db, { email: "inspect-activated@x.com" });
    await makePending(personId);
    const issued = await run((tx) => issueAccountAction(tx, { personId, purpose: "invitation" }));
    await suite.db.execute(sql`update persons set status = 'active' where id = ${personId}`);
    expect(
      await codeOf(() =>
        run((tx) => inspectAccountAction(tx, { token: issued.token, purpose: "invitation" })),
      ),
    ).toBe("account_action.invalid");
  });
});

describe("completing an account action whose person changed after it was issued", () => {
  it("refuses a password reset for a person suspended since, leaving the password and the proof untouched", async () => {
    const personId = await seedManager(suite.db, { email: "complete-suspended@x.com" });
    const issued = await run((tx) =>
      issueAccountAction(tx, { personId, purpose: "password_reset" }),
    );
    const before = await suite.db.execute<{ password_hash: string }>(
      sql`select password_hash from persons where id = ${personId}`,
    );
    await suite.db.execute(sql`update persons set status = 'suspended' where id = ${personId}`);
    expect(
      await codeOf(() =>
        run((tx) =>
          completeAccountAction(tx, {
            token: issued.token,
            purpose: "password_reset",
            password: "a replacement secure password",
          }),
        ),
      ),
    ).toBe("account_action.invalid");
    const after = await suite.db.execute<{ password_hash: string }>(
      sql`select password_hash from persons where id = ${personId}`,
    );
    expect(after.rows).toEqual(before.rows);
    const action = await suite.db.execute<{ used_at: string | null }>(
      sql`select used_at from management_account_actions where id = ${issued.id}`,
    );
    expect(action.rows).toEqual([{ used_at: null }]);
  });

  it("refuses an invitation whose person was activated since", async () => {
    const personId = await seedManager(suite.db, { email: "complete-activated@x.com" });
    await makePending(personId);
    const issued = await run((tx) => issueAccountAction(tx, { personId, purpose: "invitation" }));
    await suite.db.execute(sql`update persons set status = 'active' where id = ${personId}`);
    expect(
      await codeOf(() =>
        run((tx) =>
          completeAccountAction(tx, {
            token: issued.token,
            purpose: "invitation",
            password: "a new secure password",
            pin: "4321",
          }),
        ),
      ),
    ).toBe("account_action.invalid");
  });

  it("refuses a claimed proof whose person row does not exist", async () => {
    // The foreign key refuses this state, so it is built inside ONE transaction with
    // `defer_foreign_keys` moving the check to commit: the proof is pointed at an id no person has,
    // completion refuses first, and the rollback means the check never runs.
    const personId = await seedManager(suite.db, { email: "complete-ghost@x.com" });
    const issued = await run((tx) =>
      issueAccountAction(tx, { personId, purpose: "password_reset" }),
    );
    const ghost = randomUUID();
    expect(
      await codeOf(() =>
        run(async (tx) => {
          await tx.run(sql`pragma defer_foreign_keys = on`);
          await tx.run(
            sql`update management_account_actions set person_id = ${ghost} where id = ${issued.id}`,
          );
          return completeAccountAction(tx, {
            token: issued.token,
            purpose: "password_reset",
            password: "a replacement secure password",
          });
        }),
      ),
    ).toBe("account_action.invalid");
  });

  it("refuses when the person's credential write touches no row", async () => {
    // Nothing between the status read and the write can remove the row inside one transaction, so
    // a trigger that silently skips the write stands in for it. Dropped in the `finally`.
    const personId = await seedManager(suite.db, { email: "complete-no-write@x.com" });
    const issued = await run((tx) =>
      issueAccountAction(tx, { personId, purpose: "password_reset" }),
    );
    await suite.db.execute(
      sql.raw(`create trigger tmp_skip_person_write before update on persons for each row
          when old.id = ${quoteLiteral(personId)} begin select raise(ignore); end`),
    );
    try {
      expect(
        await codeOf(() =>
          run((tx) =>
            completeAccountAction(tx, {
              token: issued.token,
              purpose: "password_reset",
              password: "a replacement secure password",
            }),
          ),
        ),
      ).toBe("account_action.invalid");
    } finally {
      await suite.db.execute(sql`drop trigger tmp_skip_person_write`);
    }
    const action = await suite.db.execute<{ used_at: string | null }>(
      sql`select used_at from management_account_actions where id = ${issued.id}`,
    );
    expect(action.rows).toEqual([{ used_at: null }]);
  });
});

describe("confirming an email change by code when the account moved on", () => {
  const codeKey = Buffer.alloc(32, 23);

  async function requestChange(email: string, target: string) {
    const personId = await seedManager(suite.db, { email });
    await suite.db.execute(
      sql`update persons set pending_email = ${target}, pending_email_folded = ${target} where id = ${personId}`,
    );
    const issued = await run((tx) =>
      issueAccountAction(tx, { personId, purpose: "email_change", codeKey, targetEmail: target }),
    );
    return { personId, issued };
  }

  async function emailsOf(personId: string) {
    const rows = await suite.db.execute<{ email: string | null; pending_email: string | null }>(
      sql`select email, pending_email from persons where id = ${personId}`,
    );
    return rows.rows[0];
  }

  it("returns null and changes nothing when the claim on the proof writes no row", async () => {
    // One write transaction runs at a time, so no other writer can consume the proof between the
    // read and the claim; a trigger that silently skips the claim stands in for one. Dropped in the
    // `finally`.
    const { personId, issued } = await requestChange("claim-lost@x.com", "claim-lost-next@x.com");
    await suite.db.execute(
      sql.raw(`create trigger tmp_skip_claim before update of used_at on management_account_actions
          for each row when old.id = ${quoteLiteral(issued.id)} begin select raise(ignore); end`),
    );
    try {
      await expect(
        run((tx) => confirmEmailChangeByCode(tx, { personId, code: issued.code!, codeKey })),
      ).resolves.toBeNull();
    } finally {
      await suite.db.execute(sql`drop trigger tmp_skip_claim`);
    }
    expect(await emailsOf(personId)).toEqual({
      email: "claim-lost@x.com",
      pending_email: "claim-lost-next@x.com",
    });
  });

  it("consumes the proof but changes nothing when the requested address is no longer pending", async () => {
    const { personId, issued } = await requestChange("withdrawn@x.com", "withdrawn-next@x.com");
    await suite.db.execute(
      sql`update persons set pending_email = null, pending_email_folded = null where id = ${personId}`,
    );
    await expect(
      run((tx) => confirmEmailChangeByCode(tx, { personId, code: issued.code!, codeKey })),
    ).resolves.toBeNull();
    expect(await emailsOf(personId)).toEqual({ email: "withdrawn@x.com", pending_email: null });
    const action = await suite.db.execute<{ used_at: string | null }>(
      sql`select used_at from management_account_actions where id = ${issued.id}`,
    );
    expect(action.rows[0]!.used_at).not.toBeNull();
  });

  it("refuses with person.email_taken when another person now holds the address", async () => {
    const { personId, issued } = await requestChange("race-a@x.com", "race-target@x.com");
    await seedManager(suite.db, { email: "race-target@x.com" });
    await expect(
      run((tx) => confirmEmailChangeByCode(tx, { personId, code: issued.code!, codeKey })),
    ).rejects.toMatchObject({
      code: "person.email_taken",
      params: { email: "race-target@x.com" },
    });
    expect(await emailsOf(personId)).toEqual({
      email: "race-a@x.com",
      pending_email: "race-target@x.com",
    });
    const action = await suite.db.execute<{ used_at: string | null }>(
      sql`select used_at from management_account_actions where id = ${issued.id}`,
    );
    expect(action.rows).toEqual([{ used_at: null }]);
  });

  it("passes any other refusal of the email write through untranslated", async () => {
    const { personId, issued } = await requestChange("other-refusal@x.com", "other-next@x.com");
    await suite.db.execute(
      sql.raw(`create trigger tmp_refuse_email before update of email on persons for each row
          when old.id = ${quoteLiteral(personId)} begin select raise(abort, 'refused by test trigger'); end`),
    );
    try {
      const error = await captureError(() =>
        run((tx) => confirmEmailChangeByCode(tx, { personId, code: issued.code!, codeKey })),
      );
      expect(isAppError(error)).toBe(false);
      expect(triggerRaised(error, "refused by test trigger")).toBe(true);
    } finally {
      await suite.db.execute(sql`drop trigger tmp_refuse_email`);
    }
  });
});
