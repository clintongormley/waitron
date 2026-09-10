import { randomUUID } from "node:crypto";
import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { generateSync } from "otplib";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { seedManager, seedTill } from "../test/fixtures.js";
import { startManagementSession } from "./management-session.js";
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

// PGlite covers profile behavior; the me API's real-PG suite exercises deployment-role writes.
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });
async function fixture() {
  const tenantId = await seedTenant(suite.db);
  const email = `${randomUUID()}@example.com`;
  const personId = await seedManager(suite.db, tenantId, { email });
  const session = await withTenant(suite.db, tenantId, (tx) =>
    startManagementSession(tx, { tenantId, personId }),
  );
  return { tenantId, personId, email, managementSessionId: session.id };
}

describe("your profile", () => {
  it("returns only profile and passkey metadata, and refuses a session from another tenant", async () => {
    const f = await fixture();
    const profile = await withTenant(suite.db, f.tenantId, (tx) => readOwnProfile(tx, f));
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
    await expect(
      withTenant(suite.db, f.tenantId, (tx) =>
        readOwnProfile(tx, { ...f, tenantId: randomUUID() }),
      ),
    ).rejects.toMatchObject({ code: "management_session.required" });
  });

  it("saves details, requires current credentials for email changes, and invalidates old reset links", async () => {
    const f = await fixture();
    const issued = await withTenant(suite.db, f.tenantId, (tx) =>
      issueAccountAction(tx, { ...f, purpose: "password_reset" }),
    );
    const details = {
      displayName: " New Name ",
      firstNames: " Ada Augusta ",
      lastNames: " Lovelace ",
      telephone: " +44 20 ",
      email: f.email,
      locale: "en-GB",
    };
    await withTenant(suite.db, f.tenantId, (tx) => saveOwnProfile(tx, { ...f, ...details }));
    await expect(
      withTenant(suite.db, f.tenantId, (tx) =>
        saveOwnProfile(tx, {
          ...f,
          ...details,
          email: "changed@example.com",
          currentPassword: "wrong",
        }),
      ),
    ).rejects.toMatchObject({ code: "password.invalid" });
    const codeKey = Buffer.alloc(32, 19);
    const emailChange = await withTenant(suite.db, f.tenantId, (tx) =>
      saveOwnProfile(tx, {
        ...f,
        ...details,
        email: " CHANGED@example.com ",
        currentPassword: "correct horse",
        emailCodeKey: codeKey,
      }),
    );
    expect(emailChange).toMatchObject({ email: "changed@example.com", code: expect.any(String) });
    expect(await withTenant(suite.db, f.tenantId, (tx) => readOwnProfile(tx, f))).toMatchObject({
      displayName: "New Name",
      firstNames: "Ada Augusta",
      lastNames: "Lovelace",
      telephone: "+44 20",
      email: f.email,
      pendingEmail: "changed@example.com",
      locale: "en-GB",
    });
    await expect(
      withTenant(suite.db, f.tenantId, (tx) =>
        confirmOwnEmailChange(tx, { ...f, code: "000000", codeKey }),
      ),
    ).resolves.toBeNull();
    await expect(
      withTenant(suite.db, f.tenantId, (tx) =>
        confirmOwnEmailChange(tx, { ...f, code: emailChange!.code!, codeKey }),
      ),
    ).resolves.toBe("changed@example.com");
    expect(await withTenant(suite.db, f.tenantId, (tx) => readOwnProfile(tx, f))).toMatchObject({
      email: "changed@example.com",
      pendingEmail: null,
    });
    await expect(
      withTenant(suite.db, f.tenantId, (tx) =>
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
    await seedManager(suite.db, f.tenantId, { email: "taken@example.com" });
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
      [{ locale: "xx" }, "locale.unsupported"],
      [{ email: "taken@example.com" }, "person.email_taken"],
    ] as const) {
      await expect(
        withTenant(suite.db, f.tenantId, (tx) => saveOwnProfile(tx, { ...details, ...patch })),
      ).rejects.toMatchObject({ code });
    }
  });

  it("rejects a display name already used by an active person", async () => {
    const f = await fixture();
    const otherId = await seedManager(suite.db, f.tenantId, { email: "other@example.com" });
    await suite.db.execute(
      sql`update persons set display_name = 'Already Here' where id = ${otherId}`,
    );
    await expect(
      withTenant(suite.db, f.tenantId, (tx) =>
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
    const other = await withTenant(suite.db, f.tenantId, (tx) => startManagementSession(tx, f));
    await expect(
      withTenant(suite.db, f.tenantId, (tx) =>
        changeOwnPassword(tx, { ...f, currentPassword: "wrong", password: "new password" }),
      ),
    ).rejects.toMatchObject({ code: "password.invalid" });
    await expect(
      withTenant(suite.db, f.tenantId, (tx) =>
        changeOwnPassword(tx, { ...f, currentPassword: "correct horse", password: "short" }),
      ),
    ).rejects.toMatchObject({ code: "password.too_short" });
    await withTenant(suite.db, f.tenantId, (tx) =>
      changeOwnPassword(tx, { ...f, currentPassword: "correct horse", password: "new password" }),
    );
    await expect(
      withTenant(suite.db, f.tenantId, (tx) =>
        readOwnProfile(tx, { ...f, managementSessionId: other.id }),
      ),
    ).rejects.toMatchObject({ code: "management_session.required" });
    await expect(
      withTenant(suite.db, f.tenantId, (tx) => readOwnProfile(tx, f)),
    ).resolves.toMatchObject({ hasPassword: true });
    await expect(
      withTenant(suite.db, f.tenantId, (tx) =>
        loginManager(tx, { ...f, password: "new password" }),
      ),
    ).resolves.toMatchObject({ personId: f.personId });
  });

  it("changes the PIN and ends open till sessions", async () => {
    const f = await fixture();
    const tillId = await seedTill(suite.db, f.tenantId);
    const till = await suite.db.execute<{ id: string }>(
      sql`insert into sessions (tenant_id, person_id, till_id) values (${f.tenantId}, ${f.personId}, ${tillId}) returning id`,
    );
    await expect(
      withTenant(suite.db, f.tenantId, (tx) =>
        changeOwnPin(tx, { ...f, currentPassword: "correct horse", pin: "12" }),
      ),
    ).rejects.toMatchObject({ code: "pin.too_short" });
    await withTenant(suite.db, f.tenantId, (tx) =>
      changeOwnPin(tx, { ...f, currentPassword: "correct horse", pin: "9876" }),
    );
    const rows = await suite.db.execute<{ ended_at: string | null }>(
      sql`select ended_at from sessions where id = ${till.rows[0]!.id}`,
    );
    expect(rows.rows[0]!.ended_at).not.toBeNull();
  });

  it("lists and removes only your own passkeys", async () => {
    const f = await fixture();
    const colleague = await seedManager(suite.db, f.tenantId, { email: "colleague@example.com" });
    const credentialId = randomUUID();
    const otherId = randomUUID();
    await suite.db.execute(
      sql`insert into webauthn_credentials (id,tenant_id,person_id,credential_id,public_key) values (${credentialId},${f.tenantId},${f.personId},'own','public'),(${otherId},${f.tenantId},${colleague},'other','public')`,
    );
    expect(
      (await withTenant(suite.db, f.tenantId, (tx) => readOwnProfile(tx, f))).passkeys,
    ).toEqual([{ id: credentialId, createdAt: expect.any(String) }]);
    await expect(
      withTenant(suite.db, f.tenantId, (tx) =>
        removeOwnPasskey(tx, { ...f, id: otherId, currentPassword: "correct horse" }),
      ),
    ).rejects.toMatchObject({ code: "passkey.not_registered" });
    await withTenant(suite.db, f.tenantId, (tx) =>
      removeOwnPasskey(tx, { ...f, id: credentialId, currentPassword: "correct horse" }),
    );
    expect(
      (await withTenant(suite.db, f.tenantId, (tx) => readOwnProfile(tx, f))).passkeys,
    ).toEqual([]);
  });

  it("requires recovery without a password and a TOTP code when enrolled", async () => {
    const f = await fixture();
    await suite.db.execute(sql`update persons set password_hash=null where id=${f.personId}`);
    await expect(
      withTenant(suite.db, f.tenantId, (tx) =>
        changeOwnPassword(tx, { ...f, currentPassword: "", password: "new password" }),
      ),
    ).rejects.toMatchObject({ code: "password.invalid" });
    const g = await fixture();
    const keyRing = { current: { version: 1, key: Buffer.alloc(32, 4) } };
    await suite.db.execute(
      sql`update persons set totp_secret=${encryptTotpSecret("JBSWY3DPEHPK3PXP", keyRing.current)} where id=${g.personId}`,
    );
    await expect(
      withTenant(suite.db, g.tenantId, (tx) =>
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
    const pending = await withTenant(suite.db, f.tenantId, (tx) =>
      beginOwnTotpEnrollment(tx, {
        ...f,
        currentPassword: "correct horse",
        keyRing,
      }),
    );
    await expect(
      withTenant(suite.db, f.tenantId, (tx) =>
        finishOwnTotpEnrollment(tx, {
          ...f,
          enrollmentId: pending.enrollmentId,
          code: "000000",
          keyRing,
        }),
      ),
    ).rejects.toMatchObject({ code: "totp.invalid" });
    const recovery = await withTenant(suite.db, f.tenantId, (tx) =>
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
      withTenant(suite.db, f.tenantId, (tx) =>
        loginManager(tx, {
          ...f,
          password: "correct horse",
          recoveryCode: recovery.codes[0],
          totpKeyRing: keyRing,
        }),
      ),
    ).resolves.toMatchObject({ personId: f.personId });
    await expect(
      withTenant(suite.db, f.tenantId, (tx) =>
        loginManager(tx, {
          ...f,
          password: "correct horse",
          recoveryCode: recovery.codes[0],
          totpKeyRing: keyRing,
        }),
      ),
    ).rejects.toMatchObject({ code: "totp.invalid" });

    const replacement = await withTenant(suite.db, f.tenantId, (tx) =>
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
    await withTenant(suite.db, f.tenantId, (tx) =>
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
    await withTenant(suite.db, f.tenantId, (tx) =>
      unlinkOwnGoogle(tx, { ...f, currentPassword: "correct horse" }),
    );
    const rows = await suite.db.execute<{ google_subject: string | null }>(
      sql`select google_subject from persons where id = ${f.personId}`,
    );
    expect(rows.rows[0]!.google_subject).toBeNull();
  });
});
