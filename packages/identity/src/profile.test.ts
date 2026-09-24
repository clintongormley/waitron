import { randomUUID } from "node:crypto";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { quoteLiteral } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { generateSync } from "otplib";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { codeOf, seedManager, seedTill } from "../test/fixtures.js";
import { startManagementSession } from "./management-session.js";
import { hashSessionToken } from "./session-token.js";
import { issueAccountAction, completeAccountAction } from "./account-action.js";
import { loginManager } from "./manager-login.js";
import { encryptTotpSecret } from "./mfa.js";
import {
  readOwnProfile,
  saveOwnProfile,
  confirmOwnEmailChange,
  changeOwnPassword,
  changeOwnPin,
  beginOwnTotpEnrollment,
  finishOwnTotpEnrollment,
  regenerateOwnRecoveryCodes,
  disableOwnTotp,
  unlinkOwnGoogle,
  removeOwnPasskey,
} from "./profile.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });
async function fixture() {
  await seedTenant(suite.db);
  const email = `${randomUUID()}@example.com`;
  const personId = await seedManager(suite.db, { email });
  const session = await withTransaction(suite.db, (tx) => startManagementSession(tx, { personId }));
  return { personId, email, managementSessionId: session.token };
}

describe("your profile", () => {
  it("returns only profile and passkey metadata", async () => {
    const f = await fixture();
    const profile = await withTransaction(suite.db, (tx) => readOwnProfile(tx, f));
    expect(profile).toEqual({
      displayName: expect.any(String),
      firstNames: null,
      lastNames: null,
      telephone: null,
      email: f.email,
      pendingEmail: null,
      locale: null,
      hasPassword: true,
      hasTotp: false,
      hasGoogle: false,
      passkeys: [],
    });
  });

  it("saves details, requires current credentials for email changes, and invalidates old reset links", async () => {
    const f = await fixture();
    const issued = await withTransaction(suite.db, (tx) =>
      issueAccountAction(tx, { ...f, purpose: "password_reset" }),
    );
    const details = {
      displayName: " New Name ",
      firstNames: " Ada Augusta ",
      lastNames: " Lovelace ",
      telephone: " +44 20 7946 0958 ",
      email: f.email,
      locale: "en-GB",
    };
    await withTransaction(suite.db, (tx) => saveOwnProfile(tx, { ...f, ...details }));
    await expect(
      withTransaction(suite.db, (tx) =>
        saveOwnProfile(tx, {
          ...f,
          ...details,
          email: "changed@example.com",
          currentPassword: "wrong",
        }),
      ),
    ).rejects.toMatchObject({ code: "password.invalid" });
    const codeKey = Buffer.alloc(32, 19);
    const emailChange = await withTransaction(suite.db, (tx) =>
      saveOwnProfile(tx, {
        ...f,
        ...details,
        email: " CHANGED@example.com ",
        currentPassword: "correct horse",
        emailCodeKey: codeKey,
      }),
    );
    expect(emailChange).toMatchObject({ email: "changed@example.com", code: expect.any(String) });
    expect(await withTransaction(suite.db, (tx) => readOwnProfile(tx, f))).toMatchObject({
      displayName: "New Name",
      firstNames: "Ada Augusta",
      lastNames: "Lovelace",
      telephone: "+44 20 7946 0958",
      email: f.email,
      pendingEmail: "changed@example.com",
      locale: "en-GB",
    });
    await expect(
      withTransaction(suite.db, (tx) =>
        confirmOwnEmailChange(tx, { ...f, code: "000000", codeKey }),
      ),
    ).resolves.toBeNull();
    await expect(
      withTransaction(suite.db, (tx) =>
        confirmOwnEmailChange(tx, { ...f, code: emailChange!.code!, codeKey }),
      ),
    ).resolves.toBe("changed@example.com");
    expect(await withTransaction(suite.db, (tx) => readOwnProfile(tx, f))).toMatchObject({
      email: "changed@example.com",
      pendingEmail: null,
    });
    await expect(
      withTransaction(suite.db, (tx) =>
        completeAccountAction(tx, {
          ...f,
          token: issued.token,
          purpose: "password_reset",
          password: "replacement password",
        }),
      ),
    ).rejects.toMatchObject({ code: "account_action.invalid" });
  });

  it("validates details and maps duplicate emails without changing the profile", async () => {
    const f = await fixture();
    await seedManager(suite.db, { email: "taken@example.com" });
    const details = {
      ...f,
      displayName: "Name",
      firstNames: "Ada",
      lastNames: "Lovelace",
      telephone: null,
      email: f.email,
      locale: "en-GB",
      currentPassword: "correct horse",
    };
    for (const [patch, code] of [
      [{ displayName: " " }, "profile.invalid"],
      [{ email: "bad" }, "person.email_invalid"],
      [{ telephone: "12345" }, "person.telephone_invalid"],
      [{ locale: "xx" }, "locale.unsupported"],
      [{ email: "taken@example.com" }, "person.email_taken"],
    ] as const) {
      await expect(
        withTransaction(suite.db, (tx) => saveOwnProfile(tx, { ...details, ...patch })),
      ).rejects.toMatchObject({ code });
    }
  });

  it("refuses a profile read whose management session does not exist", async () => {
    await fixture();
    await expect(
      withTransaction(suite.db, (tx) => readOwnProfile(tx, { managementSessionId: randomUUID() })),
    ).rejects.toMatchObject({ code: "management_session.required" });
  });

  it("names the field in a refusal for each name that was supplied but blank", async () => {
    // The profile screen puts the message beside the field the refusal names.
    const f = await fixture();
    const details = {
      ...f,
      displayName: "Name",
      firstNames: "Ada",
      lastNames: "Lovelace",
      telephone: null,
      email: f.email,
      locale: "en-GB",
      currentPassword: "correct horse",
    };
    for (const [patch, field] of [
      [{ displayName: "  " }, "displayName"],
      [{ firstNames: "  " }, "firstNames"],
      [{ lastNames: "  " }, "lastNames"],
    ] as const) {
      await expect(
        withTransaction(suite.db, (tx) => saveOwnProfile(tx, { ...details, ...patch })),
      ).rejects.toMatchObject({ code: "profile.invalid", params: { field } });
    }
  });

  it("accepts a valid telephone stored trimmed and an absent one, rejecting only a malformed value", async () => {
    const f = await fixture();
    const base = {
      ...f,
      displayName: "Name",
      firstNames: "Ada",
      lastNames: "Lovelace",
      email: f.email,
      locale: "en-GB",
      currentPassword: "correct horse",
    };
    await withTransaction(suite.db, (tx) =>
      saveOwnProfile(tx, { ...base, telephone: "  +34 600 000 000  " }),
    );
    expect(await withTransaction(suite.db, (tx) => readOwnProfile(tx, f))).toMatchObject({
      telephone: "+34 600 000 000",
    });
    await withTransaction(suite.db, (tx) => saveOwnProfile(tx, { ...base, telephone: null }));
    expect(await withTransaction(suite.db, (tx) => readOwnProfile(tx, f))).toMatchObject({
      telephone: null,
    });
    await expect(
      withTransaction(suite.db, (tx) => saveOwnProfile(tx, { ...base, telephone: "123" })),
    ).rejects.toMatchObject({ code: "person.telephone_invalid" });
  });

  it("rejects a display name already used by an active person", async () => {
    const f = await fixture();
    const otherId = await seedManager(suite.db, { email: "other@example.com" });
    await suite.db.execute(
      sql`update persons set display_name = 'Already Here' where id = ${otherId}`,
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        saveOwnProfile(tx, {
          ...f,
          displayName: " already here ",
          email: f.email,
          locale: "en-GB",
        }),
      ),
    ).rejects.toMatchObject({ code: "person.display_name_taken" });
  });

  it("changes the password and ends other sessions while preserving this one", async () => {
    const f = await fixture();
    const other = await withTransaction(suite.db, (tx) => startManagementSession(tx, f));
    await expect(
      withTransaction(suite.db, (tx) =>
        changeOwnPassword(tx, { ...f, currentPassword: "wrong", password: "new password" }),
      ),
    ).rejects.toMatchObject({ code: "password.invalid" });
    // Omitting the current password entirely is refused the same way a wrong one is.
    await expect(
      withTransaction(suite.db, (tx) => changeOwnPassword(tx, { ...f, password: "new password" })),
    ).rejects.toMatchObject({ code: "password.invalid" });
    await expect(
      withTransaction(suite.db, (tx) =>
        changeOwnPassword(tx, { ...f, currentPassword: "correct horse", password: "short" }),
      ),
    ).rejects.toMatchObject({ code: "password.too_short" });
    await withTransaction(suite.db, (tx) =>
      changeOwnPassword(tx, { ...f, currentPassword: "correct horse", password: "new password" }),
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        readOwnProfile(tx, { ...f, managementSessionId: other.token }),
      ),
    ).rejects.toMatchObject({ code: "management_session.required" });
    await expect(withTransaction(suite.db, (tx) => readOwnProfile(tx, f))).resolves.toMatchObject({
      hasPassword: true,
    });
    await expect(
      withTransaction(suite.db, (tx) => loginManager(tx, { ...f, password: "new password" })),
    ).resolves.toMatchObject({ personId: f.personId });
  });

  it("changes the PIN and ends open till sessions", async () => {
    const f = await fixture();
    const tillId = await seedTill(suite.db);
    // `id` and `opened_at` are `$defaultFn` generators, not column DEFAULTs, so a raw insert names them.
    const till = await suite.db.execute<{ id: string }>(
      sql`insert into sessions (id, token_hash, person_id, till_id, opened_at) values (${randomUUID()}, ${hashSessionToken(randomUUID())}, ${f.personId}, ${tillId}, ${new Date().toISOString()}) returning id`,
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        changeOwnPin(tx, { ...f, currentPassword: "correct horse", pin: "12" }),
      ),
    ).rejects.toMatchObject({ code: "pin.too_short" });
    await withTransaction(suite.db, (tx) =>
      changeOwnPin(tx, { ...f, currentPassword: "correct horse", pin: "9876" }),
    );
    const rows = await suite.db.execute<{ ended_at: string | null }>(
      sql`select ended_at from sessions where id = ${till.rows[0]!.id}`,
    );
    expect(rows.rows[0]!.ended_at).not.toBeNull();
  });

  it("lists and removes only your own passkeys", async () => {
    const f = await fixture();
    const colleague = await seedManager(suite.db, { email: "colleague@example.com" });
    const credentialId = randomUUID();
    const otherId = randomUUID();
    // `created_at` is a `$defaultFn` generator, not a column DEFAULT, so a raw insert names it.
    const stamp = new Date().toISOString();
    await suite.db.execute(
      sql`insert into webauthn_credentials (id,person_id,credential_id,public_key,name,created_at) values (${credentialId},${f.personId},'own','public','Work laptop',${stamp}),(${otherId},${colleague},'other','public','Colleague laptop',${stamp})`,
    );
    expect((await withTransaction(suite.db, (tx) => readOwnProfile(tx, f))).passkeys).toEqual([
      { id: credentialId, name: "Work laptop", createdAt: expect.any(String) },
    ]);
    await expect(
      withTransaction(suite.db, (tx) =>
        removeOwnPasskey(tx, { ...f, id: otherId, currentPassword: "correct horse" }),
      ),
    ).rejects.toMatchObject({ code: "passkey.not_registered" });
    await withTransaction(suite.db, (tx) =>
      removeOwnPasskey(tx, { ...f, id: credentialId, currentPassword: "correct horse" }),
    );
    expect((await withTransaction(suite.db, (tx) => readOwnProfile(tx, f))).passkeys).toEqual([]);
  });

  it("requires recovery without a password and a TOTP code when enrolled", async () => {
    const f = await fixture();
    await suite.db.execute(sql`update persons set password_hash=null where id=${f.personId}`);
    await expect(
      withTransaction(suite.db, (tx) =>
        changeOwnPassword(tx, { ...f, currentPassword: "", password: "new password" }),
      ),
    ).rejects.toMatchObject({ code: "password.invalid" });
    const g = await fixture();
    const keyRing = { current: { version: 1, key: Buffer.alloc(32, 4) } };
    await suite.db.execute(
      sql`update persons set totp_secret=${encryptTotpSecret("JBSWY3DPEHPK3PXP", keyRing.current)} where id=${g.personId}`,
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        changeOwnPassword(tx, {
          ...g,
          currentPassword: "correct horse",
          password: "new password",
          keyRing,
        }),
      ),
    ).rejects.toMatchObject({ code: "totp.invalid" });
  });

  it("encrypts authenticator secrets and issues single-use recovery codes", async () => {
    const f = await fixture();
    const keyRing = { current: { version: 1, key: Buffer.alloc(32, 9) } };
    const pending = await withTransaction(suite.db, (tx) =>
      beginOwnTotpEnrollment(tx, {
        ...f,
        currentPassword: "correct horse",
        keyRing,
      }),
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        finishOwnTotpEnrollment(tx, {
          ...f,
          enrollmentId: pending.enrollmentId,
          code: "000000",
          keyRing,
        }),
      ),
    ).rejects.toMatchObject({ code: "totp.invalid" });
    expect((await withTransaction(suite.db, (tx) => readOwnProfile(tx, f))).hasTotp).toBe(false);
    const recovery = await withTransaction(suite.db, (tx) =>
      finishOwnTotpEnrollment(tx, {
        ...f,
        enrollmentId: pending.enrollmentId,
        code: generateSync({ secret: pending.secret }),
        keyRing,
      }),
    );
    expect(recovery.codes).toHaveLength(10);
    const stored = await suite.db.execute<{ totp_secret: string }>(
      sql`select totp_secret from persons where id=${f.personId}`,
    );
    expect(stored.rows[0]!.totp_secret).toMatch(/^v1\./);
    expect(stored.rows[0]!.totp_secret).not.toContain(pending.secret);

    await expect(
      withTransaction(suite.db, (tx) =>
        loginManager(tx, {
          ...f,
          password: "correct horse",
          recoveryCode: recovery.codes[0],
          totpKeyRing: keyRing,
        }),
      ),
    ).resolves.toMatchObject({ personId: f.personId });
    await expect(
      withTransaction(suite.db, (tx) =>
        loginManager(tx, {
          ...f,
          password: "correct horse",
          recoveryCode: recovery.codes[0],
          totpKeyRing: keyRing,
        }),
      ),
    ).rejects.toMatchObject({ code: "totp.invalid" });

    const replacement = await withTransaction(suite.db, (tx) =>
      regenerateOwnRecoveryCodes(tx, {
        ...f,
        currentPassword: "correct horse",
        totp: generateSync({ secret: pending.secret }),
        keyRing,
      }),
    );
    expect(replacement.codes).toHaveLength(10);
  });

  it("disables the authenticator and removes its recovery material after reauthentication", async () => {
    const f = await fixture();
    const keyRing = { current: { version: 1, key: Buffer.alloc(32, 7) } };
    const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    await suite.db.execute(
      sql`update persons set totp_secret = ${encryptTotpSecret(secret, keyRing.current)} where id = ${f.personId}`,
    );
    await withTransaction(suite.db, (tx) =>
      disableOwnTotp(tx, {
        ...f,
        currentPassword: "correct horse",
        totp: generateSync({ secret }),
        keyRing,
      }),
    );
    const rows = await suite.db.execute<{ totp_secret: string | null }>(
      sql`select totp_secret from persons where id = ${f.personId}`,
    );
    expect(rows.rows[0]!.totp_secret).toBeNull();
  });

  it("unlinks Google after reauthentication", async () => {
    const f = await fixture();
    await suite.db.execute(
      sql`update persons set google_subject = 'google-subject' where id = ${f.personId}`,
    );
    await withTransaction(suite.db, (tx) =>
      unlinkOwnGoogle(tx, { ...f, currentPassword: "correct horse" }),
    );
    const rows = await suite.db.execute<{ google_subject: string | null }>(
      sql`select google_subject from persons where id = ${f.personId}`,
    );
    expect(rows.rows[0]!.google_subject).toBeNull();
  });

  it("refuses a live session whose person row no longer exists, as it refuses a signed-out caller", async () => {
    // `management_sessions` carries no foreign key to `persons`, so the session can outlive the row.
    const f = await fixture();
    await suite.db.execute(sql`delete from persons where id = ${f.personId}`);
    expect(await codeOf(() => withTransaction(suite.db, (tx) => readOwnProfile(tx, f)))).toBe(
      "management_session.required",
    );
  });

  it("labels the authenticator entry with the display name when the person has no email", async () => {
    const f = await fixture();
    await suite.db.execute(
      sql`update persons set email = null, email_folded = null where id = ${f.personId}`,
    );
    const { displayName } = await withTransaction(suite.db, (tx) => readOwnProfile(tx, f));
    const pending = await withTransaction(suite.db, (tx) =>
      beginOwnTotpEnrollment(tx, {
        ...f,
        currentPassword: "correct horse",
        keyRing: { current: { version: 1, key: Buffer.alloc(32, 3) } },
      }),
    );
    expect(decodeURIComponent(pending.uri)).toContain(displayName);
  });

  it("refuses to finish an authenticator enrolment that does not exist", async () => {
    const f = await fixture();
    expect(
      await codeOf(() =>
        withTransaction(suite.db, (tx) =>
          finishOwnTotpEnrollment(tx, {
            ...f,
            enrollmentId: randomUUID(),
            code: "000000",
            keyRing: { current: { version: 1, key: Buffer.alloc(32, 3) } },
          }),
        ),
      ),
    ).toBe("totp.invalid");
    expect((await withTransaction(suite.db, (tx) => readOwnProfile(tx, f))).hasTotp).toBe(false);
  });

  it("reports an address claimed between the availability check and the write as person.email_taken", async () => {
    // No other request can run in that gap, so a trigger that gives the address to another person
    // just before this person's write stands in for one.
    const f = await fixture();
    const otherId = await seedManager(suite.db, { email: `${randomUUID()}@example.com` });
    const contested = `${randomUUID()}@example.com`;
    await suite.db.execute(
      sql.raw(`create trigger tmp_claim_pending before update on persons for each row
          when old.id = ${quoteLiteral(f.personId)} and new.pending_email is not null
          begin update persons set pending_email = new.pending_email,
            pending_email_folded = new.pending_email_folded where id = ${quoteLiteral(otherId)}; end`),
    );
    try {
      await expect(
        withTransaction(suite.db, (tx) =>
          saveOwnProfile(tx, {
            ...f,
            displayName: "Name",
            email: contested,
            locale: "en-GB",
            currentPassword: "correct horse",
          }),
        ),
      ).rejects.toMatchObject({ code: "person.email_taken", params: { email: contested } });
    } finally {
      await suite.db.execute(sql`drop trigger tmp_claim_pending`);
    }
    expect(await withTransaction(suite.db, (tx) => readOwnProfile(tx, f))).toMatchObject({
      pendingEmail: null,
    });
  });

  it("withdrawing a requested email change invalidates the proof already sent for it", async () => {
    const f = await fixture();
    const details = {
      ...f,
      displayName: "Name",
      locale: "en-GB",
      currentPassword: "correct horse",
    };
    const issued = await withTransaction(suite.db, (tx) =>
      saveOwnProfile(tx, { ...details, email: `${randomUUID()}@example.com` }),
    );
    await expect(
      withTransaction(suite.db, (tx) => saveOwnProfile(tx, { ...details, email: f.email })),
    ).resolves.toBeNull();
    const action = await suite.db.execute<{ used_at: string | null }>(
      sql`select used_at from management_account_actions where id = ${issued!.id}`,
    );
    expect(action.rows[0]!.used_at).not.toBeNull();
    expect(await withTransaction(suite.db, (tx) => readOwnProfile(tx, f))).toMatchObject({
      email: f.email,
      pendingEmail: null,
    });
  });
});
