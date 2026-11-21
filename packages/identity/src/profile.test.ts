import { sealText } from "@waitron/credentials";
import { captureError, restrictRefused, readActivityForPerson } from "@waitron/db";
import { randomUUID, scrypt } from "node:crypto";
import { CORE_MIGRATIONS, outgoingMail, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTaxpayer } from "@waitron/db/testing/seed.js";
import { quoteLiteral } from "@waitron/shared";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { generateSync } from "otplib";
import { codeOf, seedManager, seedSessionDevice, TOTP_KEY_RING } from "../test/fixtures.js";
import { startManagementSession } from "./management-session.js";
import { hashSessionToken } from "./session-token.js";
import {
  issueAccountAction,
  issueQueuedAccountAction,
  completeAccountAction,
} from "./account-action.js";
import { loginManager } from "./manager-login.js";
import { replaceRecoveryCodes } from "./mfa.js";
import { issueCheck } from "./secret-check.js";
import {
  requireEnrolledCode,
  verifyOwnFreshSignIn,
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

vi.mock("node:crypto", async (original) => {
  const actual = await original<typeof import("node:crypto")>();
  return { ...actual, scrypt: vi.fn(actual.scrypt) };
});

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
async function fixture() {
  await seedTaxpayer(suite.db);
  const email = `${randomUUID()}@example.com`;
  const personId = await seedManager(suite.db, { email });
  const session = await withTransaction(suite.db, (tx) =>
    startManagementSession(tx, { method: "password", personId }),
  );
  await suite.db.run(
    sql`update dashboard_sessions set proved_at=${new Date().toISOString()} where token_hash=${hashSessionToken(session.token)}`,
  );
  return { personId, email, managementSessionId: session.token, queueEmailChange: true };
}

async function securityNotices(personId: string) {
  return suite.db
    .select({ personId: outgoingMail.personId, params: outgoingMail.params })
    .from(outgoingMail)
    .where(and(eq(outgoingMail.personId, personId), eq(outgoingMail.kind, "security_change")))
    .orderBy(outgoingMail.seq);
}

describe("your profile", () => {
  it("restarts authenticator setup with only the second pending setup", async () => {
    const f = await fixture();
    const first = await withTransaction(suite.db, (tx) =>
      beginOwnTotpEnrollment(tx, { ...f, keyRing: TOTP_KEY_RING }),
    );
    const second = await withTransaction(suite.db, (tx) =>
      beginOwnTotpEnrollment(tx, { ...f, keyRing: TOTP_KEY_RING }),
    );
    expect(second.enrollmentId).not.toBe(first.enrollmentId);
    expect(
      suite.db.all(
        sql`select id from sign_in_challenges where person_id=${f.personId} and kind='totp_enrolment'`,
      ),
    ).toEqual([{ id: second.enrollmentId }]);
  });

  it("rolls a password change and its notice back together", async () => {
    const f = await fixture();
    const before = suite.db.get(sql`select password_hash from persons where id=${f.personId}`);
    await expect(
      withTransaction(suite.db, async (tx) => {
        await changeOwnPassword(tx, {
          ...f,
          password: "a replacement password",
          keyRing: TOTP_KEY_RING,
        });
        const [mail] = await tx
          .select()
          .from(outgoingMail)
          .where(eq(outgoingMail.kind, "security_change"));
        expect(mail).toMatchObject({
          personId: f.personId,
          params: { change: "password_changed" },
        });
        throw new Error("cancel change");
      }),
    ).rejects.toThrow("cancel change");
    expect(suite.db.get(sql`select password_hash from persons where id=${f.personId}`)).toEqual(
      before,
    );
    expect(await securityNotices(f.personId)).toEqual([]);
  });

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

  it("saves details, requires confirmation for email changes, and invalidates old reset links", async () => {
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
    await withTransaction(suite.db, (tx) =>
      saveOwnProfile(tx, { ...f, ...details, keyRing: TOTP_KEY_RING }),
    );
    await suite.db.run(
      sql`update dashboard_sessions set proved_at=null where token_hash=${hashSessionToken(f.managementSessionId)}`,
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        saveOwnProfile(tx, {
          ...f,
          ...details,
          email: "changed@example.com",
          keyRing: TOTP_KEY_RING,
        }),
      ),
    ).rejects.toMatchObject({ code: "management_session.proof_required" });
    await suite.db.run(
      sql`update dashboard_sessions set proved_at=${new Date().toISOString()} where token_hash=${hashSessionToken(f.managementSessionId)}`,
    );
    const keyRing = { current: { version: 1, key: Buffer.alloc(32, 19) } };
    const queued = await withTransaction(suite.db, (tx) =>
      saveOwnProfile(tx, {
        ...f,
        ...details,
        email: " CHANGED@example.com ",
        keyRing: TOTP_KEY_RING,
      }),
    );
    expect(queued).toEqual({ queued: true });
    expect(
      suite.db.all(
        sql`select id from account_actions where person_id=${f.personId} and purpose='email_change'`,
      ),
    ).toEqual([]);
    expect(
      suite.db.all(sql`select params from outgoing_mail where person_id=${f.personId}`),
    ).toEqual([{ params: JSON.stringify({ purpose: "email_change" }) }]);
    const emailChange = await withTransaction(suite.db, (tx) =>
      issueQueuedAccountAction(
        tx,
        { personId: f.personId, params: { purpose: "email_change" } },
        { keyRing, now: new Date() },
      ),
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
        confirmOwnEmailChange(tx, {
          ...f,
          code: emailChange!.code === "000000" ? "111111" : "000000",
          keyRing,
        }),
      ),
    ).resolves.toBeNull();
    expect(await securityNotices(f.personId)).toEqual([]);
    await expect(
      withTransaction(suite.db, (tx) =>
        confirmOwnEmailChange(tx, { ...f, code: emailChange!.code!, keyRing }),
      ),
    ).resolves.toBe("changed@example.com");
    expect(await securityNotices(f.personId)).toEqual([
      { personId: f.personId, params: { change: "email_changed" } },
    ]);
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

  it.each([true, false])(
    "saves a pending address with queueEmailChange=%s without issuing a code",
    async (queueEmailChange) => {
      const f = await fixture();
      const result = await withTransaction(suite.db, (tx) =>
        saveOwnProfile(tx, {
          ...f,
          displayName: "Queued profile",
          email: "new@example.com",
          locale: "en-GB",
          keyRing: TOTP_KEY_RING,
          queueEmailChange,
        }),
      );
      expect(result).toEqual({ queued: queueEmailChange });
      expect(suite.db.all(sql`select pending_email from persons where id=${f.personId}`)).toEqual([
        { pending_email: "new@example.com" },
      ]);
      expect(suite.db.all(sql`select id from outgoing_mail`)).toHaveLength(
        queueEmailChange ? 1 : 0,
      );
      expect(suite.db.all(sql`select id from account_actions`)).toEqual([]);
    },
  );

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
    };
    for (const [patch, code] of [
      [{ displayName: " " }, "profile.invalid"],
      [{ email: "bad" }, "person.email_invalid"],
      [{ telephone: "12345" }, "person.telephone_invalid"],
      [{ locale: "xx" }, "locale.unsupported"],
      [{ email: "taken@example.com" }, "person.email_taken"],
    ] as const) {
      await expect(
        withTransaction(suite.db, (tx) =>
          saveOwnProfile(tx, { ...details, ...patch, keyRing: TOTP_KEY_RING }),
        ),
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
    };
    for (const [patch, field] of [
      [{ displayName: "  " }, "displayName"],
      [{ firstNames: "  " }, "firstNames"],
      [{ lastNames: "  " }, "lastNames"],
    ] as const) {
      await expect(
        withTransaction(suite.db, (tx) =>
          saveOwnProfile(tx, { ...details, ...patch, keyRing: TOTP_KEY_RING }),
        ),
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
    };
    await withTransaction(suite.db, (tx) =>
      saveOwnProfile(tx, { ...base, telephone: "  +34 600 000 000  ", keyRing: TOTP_KEY_RING }),
    );
    expect(await withTransaction(suite.db, (tx) => readOwnProfile(tx, f))).toMatchObject({
      telephone: "+34 600 000 000",
    });
    await withTransaction(suite.db, (tx) =>
      saveOwnProfile(tx, { ...base, telephone: null, keyRing: TOTP_KEY_RING }),
    );
    expect(await withTransaction(suite.db, (tx) => readOwnProfile(tx, f))).toMatchObject({
      telephone: null,
    });
    const oldPhone = "512 345 678";
    await expect(
      withTransaction(suite.db, (tx) =>
        saveOwnProfile(tx, { ...base, telephone: oldPhone, keyRing: TOTP_KEY_RING }),
      ),
    ).rejects.toMatchObject({ code: "person.telephone_invalid" });
    await suite.db.run(sql`update persons set telephone = ${oldPhone} where id = ${f.personId}`);
    await withTransaction(suite.db, (tx) =>
      saveOwnProfile(tx, { ...base, telephone: oldPhone, keyRing: TOTP_KEY_RING }),
    );
    expect(await withTransaction(suite.db, (tx) => readOwnProfile(tx, f))).toMatchObject({
      telephone: oldPhone,
    });
  });

  it("rejects a display name already used by an active person", async () => {
    const f = await fixture();
    const otherId = await seedManager(suite.db, { email: "other@example.com" });
    await suite.db.execute(
      sql`update persons set display_name = 'Already Here', display_name_folded = 'already here' where id = ${otherId}`,
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        saveOwnProfile(tx, {
          ...f,
          displayName: " already here ",
          email: f.email,
          locale: "en-GB",
          keyRing: TOTP_KEY_RING,
        }),
      ),
    ).rejects.toMatchObject({ code: "person.display_name_taken" });
  });

  it("changes the password and ends other sessions while preserving this one", async () => {
    const f = await fixture();
    const other = await withTransaction(suite.db, (tx) =>
      startManagementSession(tx, { personId: f.personId, method: "password" }),
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        changeOwnPassword(tx, {
          ...f,
          password: "short",
          keyRing: TOTP_KEY_RING,
        }),
      ),
    ).rejects.toMatchObject({ code: "password.too_short" });
    expect(await securityNotices(f.personId)).toEqual([]);
    vi.mocked(scrypt).mockClear();
    await withTransaction(suite.db, (tx) =>
      changeOwnPassword(tx, {
        ...f,
        password: "new password",
        keyRing: TOTP_KEY_RING,
      }),
    );
    expect(vi.mocked(scrypt).mock.calls.map(([secret]) => secret)).toContain("new password");
    expect(
      suite.db.all(sql`select token_hash from dashboard_sessions where person_id=${f.personId}`),
    ).toEqual([{ token_hash: hashSessionToken(f.managementSessionId) }]);
    expect(
      await readActivityForPerson(suite.db, f.personId, { kinds: ["dashboard.signed_out"] }),
    ).toEqual([
      expect.objectContaining({
        personId: f.personId,
        subjectId: f.personId,
        data: { reason: "password_changed" },
      }),
    ]);

    expect(await securityNotices(f.personId)).toEqual([
      { personId: f.personId, params: { change: "password_changed" } },
    ]);
    await expect(
      withTransaction(suite.db, (tx) =>
        readOwnProfile(tx, { ...f, managementSessionId: other.token }),
      ),
    ).rejects.toMatchObject({ code: "management_session.required" });
    await expect(withTransaction(suite.db, (tx) => readOwnProfile(tx, f))).resolves.toMatchObject({
      hasPassword: true,
    });
    await expect(
      withTransaction(suite.db, (tx) =>
        loginManager(tx, { ...f, password: "new password", totpKeyRing: TOTP_KEY_RING }),
      ),
    ).resolves.toMatchObject({ personId: f.personId });
  });

  it("changes the PIN and ends open till sessions", async () => {
    const f = await fixture();
    const deviceId = await seedSessionDevice(suite.db);
    // `id` and `opened_at` are `$defaultFn` generators, not column DEFAULTs, so a raw insert names them.
    const till = await suite.db.execute<{ id: string }>(
      sql`insert into till_sessions (id, token_hash, person_id, device_id, opened_at) values (${randomUUID()}, ${hashSessionToken(randomUUID())}, ${f.personId}, ${deviceId}, ${new Date().toISOString()}) returning id`,
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        changeOwnPin(tx, {
          ...f,
          pin: "12",
          keyRing: TOTP_KEY_RING,
        }),
      ),
    ).rejects.toMatchObject({ code: "pin.too_short" });
    vi.mocked(scrypt).mockClear();
    await withTransaction(suite.db, (tx) =>
      changeOwnPin(tx, {
        ...f,
        pin: "9876",
        keyRing: TOTP_KEY_RING,
      }),
    );
    expect(vi.mocked(scrypt).mock.calls.map(([secret]) => secret)).toContain("9876");
    const rows = await suite.db.execute<{ ended_at: string | null }>(
      sql`select ended_at from till_sessions where id = ${till.rows[0]!.id}`,
    );
    expect(rows.rows[0]!.ended_at).not.toBeNull();
    expect(await securityNotices(f.personId)).toEqual([]);
  });

  it("lists and removes only your own passkeys", async () => {
    const f = await fixture();
    await seedManager(suite.db, { email: "admin@example.test", role: "admin" });
    const colleague = await seedManager(suite.db, { email: "colleague@example.com" });
    const credentialId = randomUUID();
    const otherId = randomUUID();
    // `created_at` is a `$defaultFn` generator, not a column DEFAULT, so a raw insert names it.
    const stamp = new Date().toISOString();
    await suite.db.execute(
      sql`insert into webauthn_credentials (id,person_id,credential_id,public_key,created_at) values (${credentialId},${f.personId},'own','public',${stamp}),(${otherId},${colleague},'other','public',${stamp})`,
    );
    expect((await withTransaction(suite.db, (tx) => readOwnProfile(tx, f))).passkeys).toEqual([
      {
        id: credentialId,
        createdAt: expect.any(String),
        lastUsedAt: null,
        provider: null,
      },
    ]);
    await expect(
      withTransaction(suite.db, (tx) =>
        removeOwnPasskey(tx, {
          ...f,
          id: otherId,
          keyRing: TOTP_KEY_RING,
        }),
      ),
    ).rejects.toMatchObject({ code: "passkey.not_registered" });
    expect(await securityNotices(f.personId)).toEqual([]);
    await withTransaction(suite.db, (tx) =>
      removeOwnPasskey(tx, {
        ...f,
        id: credentialId,
        keyRing: TOTP_KEY_RING,
      }),
    );
    expect((await withTransaction(suite.db, (tx) => readOwnProfile(tx, f))).passkeys).toEqual([]);
    expect(await securityNotices(f.personId)).toEqual([
      { personId: f.personId, params: { change: "passkey_removed" } },
    ]);
  });

  it("says which password manager holds each passkey and when it last signed in", async () => {
    const f = await fixture();
    const used = randomUUID();
    const neverUsed = randomUUID();
    const created = "2026-09-01T10:00:00.000Z";
    const lastUsed = "2026-09-29T08:30:00.000Z";
    await suite.db.execute(
      sql`insert into webauthn_credentials (id,person_id,credential_id,public_key,aaguid,created_at,last_used_at) values (${used},${f.personId},'used','public','ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4',${created},${lastUsed}),(${neverUsed},${f.personId},'never','public','00000000-0000-0000-0000-000000000000',${created},null)`,
    );
    const { passkeys } = await withTransaction(suite.db, (tx) => readOwnProfile(tx, f));
    expect(passkeys.find((p) => p.id === used)).toEqual({
      id: used,
      createdAt: created,
      lastUsedAt: lastUsed,
      provider: "Google Password Manager",
    });
    expect(passkeys.find((p) => p.id === neverUsed)).toEqual({
      id: neverUsed,
      createdAt: created,
      lastUsedAt: null,
      provider: null,
    });
  });

  it("allows a confirmed passwordless account and still requires an enrolled TOTP code", async () => {
    const f = await fixture();
    await suite.db.execute(sql`update persons set password_hash=null where id=${f.personId}`);
    await expect(
      withTransaction(suite.db, (tx) =>
        changeOwnPassword(tx, {
          ...f,
          password: "new password",
          keyRing: TOTP_KEY_RING,
        }),
      ),
    ).resolves.toBeUndefined();
    const g = await fixture();
    const keyRing = { current: { version: 1, key: Buffer.alloc(32, 4) } };
    await suite.db.execute(
      sql`update persons set totp_secret=${sealText({ current: keyRing.current }, "totp", "JBSWY3DPEHPK3PXP")} where id=${g.personId}`,
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        changeOwnPassword(tx, {
          ...g,
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
        keyRing,
      }),
    );
    // Any fixed code is valid for some secret; pick one no step the verifier accepts produces.
    const now = Math.floor(Date.now() / 1000);
    const accepted = new Set(
      [-60, -30, 0, 30, 60].map((offset) =>
        generateSync({ secret: pending.secret, epoch: now + offset }),
      ),
    );
    const wrong = ["000000", "111111", "222222", "333333", "444444", "555555"].find(
      (code) => !accepted.has(code),
    )!;
    await expect(
      withTransaction(suite.db, (tx) =>
        finishOwnTotpEnrollment(tx, {
          ...f,
          enrollmentId: pending.enrollmentId,
          code: wrong,
          keyRing,
        }),
      ),
    ).rejects.toMatchObject({ code: "totp.invalid" });
    expect((await withTransaction(suite.db, (tx) => readOwnProfile(tx, f))).hasTotp).toBe(false);
    expect(await securityNotices(f.personId)).toEqual([]);
    const recovery = await withTransaction(suite.db, (tx) =>
      finishOwnTotpEnrollment(tx, {
        ...f,
        enrollmentId: pending.enrollmentId,
        code: generateSync({ secret: pending.secret }),
        keyRing,
      }),
    );
    expect(recovery.codes).toHaveLength(10);
    expect(await securityNotices(f.personId)).toEqual([
      { personId: f.personId, params: { change: "authenticator_set_up" } },
    ]);
    const stored = await suite.db.execute<{ totp_secret: string }>(
      sql`select totp_secret from persons where id=${f.personId}`,
    );
    expect(stored.rows[0]!.totp_secret).toMatch(/^v2\./);
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
    ).rejects.toMatchObject({ code: "password.invalid" });

    const replacement = await withTransaction(suite.db, (tx) =>
      regenerateOwnRecoveryCodes(tx, {
        ...f,
        totp: generateSync({ secret: pending.secret }),
        keyRing,
      }),
    );
    expect(replacement.codes).toHaveLength(10);
    expect(await securityNotices(f.personId)).toEqual([
      { personId: f.personId, params: { change: "authenticator_set_up" } },
      { personId: f.personId, params: { change: "recovery_codes_regenerated" } },
    ]);
  });

  it("disables the authenticator and removes its recovery material after reauthentication", async () => {
    const f = await fixture();
    const keyRing = { current: { version: 1, key: Buffer.alloc(32, 7) } };
    const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    await suite.db.execute(
      sql`update persons set totp_secret = ${sealText({ current: keyRing.current }, "totp", secret)} where id = ${f.personId}`,
    );
    await withTransaction(suite.db, (tx) =>
      disableOwnTotp(tx, {
        ...f,
        totp: generateSync({ secret }),
        keyRing,
      }),
    );
    const rows = await suite.db.execute<{ totp_secret: string | null }>(
      sql`select totp_secret from persons where id = ${f.personId}`,
    );
    expect(rows.rows[0]!.totp_secret).toBeNull();
    await withTransaction(suite.db, (tx) => disableOwnTotp(tx, { ...f, keyRing }));
    expect(await securityNotices(f.personId)).toEqual([
      { personId: f.personId, params: { change: "authenticator_removed" } },
    ]);
  });

  it("unlinks Google after reauthentication", async () => {
    const f = await fixture();
    await seedManager(suite.db, { email: "admin@example.test", role: "admin" });
    await suite.db.execute(
      sql`update persons set google_subject = 'google-subject' where id = ${f.personId}`,
    );
    await withTransaction(suite.db, (tx) => unlinkOwnGoogle(tx, { ...f, keyRing: TOTP_KEY_RING }));
    const rows = await suite.db.execute<{ google_subject: string | null }>(
      sql`select google_subject from persons where id = ${f.personId}`,
    );
    expect(rows.rows[0]!.google_subject).toBeNull();
    await withTransaction(suite.db, (tx) => unlinkOwnGoogle(tx, { ...f, keyRing: TOTP_KEY_RING }));
    expect(await securityNotices(f.personId)).toEqual([
      { personId: f.personId, params: { change: "google_disconnected" } },
    ]);
  });

  it("refuses deleting the person behind a live dashboard session", async () => {
    const f = await fixture();
    const before = await withTransaction(suite.db, (tx) => readOwnProfile(tx, f));
    const error = await captureError(() =>
      withTransaction(suite.db, (tx) =>
        tx.execute(sql`delete from persons where id = ${f.personId}`),
      ),
    );
    expect(restrictRefused(error)).toBe(true);
    expect(await withTransaction(suite.db, (tx) => readOwnProfile(tx, f))).toEqual(before);
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
            keyRing: TOTP_KEY_RING,
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
    };
    await withTransaction(suite.db, (tx) =>
      saveOwnProfile(tx, {
        ...details,
        email: `${randomUUID()}@example.com`,
        keyRing: TOTP_KEY_RING,
      }),
    );
    const issued = await withTransaction(suite.db, (tx) =>
      issueQueuedAccountAction(
        tx,
        { personId: f.personId, params: { purpose: "email_change" } },
        { now: new Date() },
      ),
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        saveOwnProfile(tx, { ...details, email: f.email, keyRing: TOTP_KEY_RING }),
      ),
    ).resolves.toBeNull();
    const action = await suite.db.execute<{ used_at: string | null }>(
      sql`select used_at from account_actions where id = ${issued!.id}`,
    );
    expect(action.rows[0]!.used_at).not.toBeNull();
    expect(await withTransaction(suite.db, (tx) => readOwnProfile(tx, f))).toMatchObject({
      email: f.email,
      pendingEmail: null,
    });
  });
});

describe("a fresh sign-in by the signed-in person", () => {
  const keyRing = { current: { version: 1, key: Buffer.alloc(32, 11) } };
  const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

  /** A code no step the verifier accepts produces for `secret`. */
  function wrongCode(): string {
    const now = Math.floor(Date.now() / 1000);
    const accepted = new Set(
      [-60, -30, 0, 30, 60].map((offset) => generateSync({ secret, epoch: now + offset })),
    );
    return ["000000", "111111", "222222", "333333", "444444", "555555"].find(
      (code) => !accepted.has(code),
    )!;
  }

  async function enrolled() {
    const f = await fixture();
    await suite.db.execute(
      sql`update persons set totp_secret = ${sealText({ current: keyRing.current }, "totp", secret)} where id = ${f.personId}`,
    );
    const codes = await withTransaction(suite.db, (tx) => replaceRecoveryCodes(tx, f.personId));
    return { ...f, codes };
  }

  const fresh = (input: Parameters<typeof verifyOwnFreshSignIn>[1]) =>
    withTransaction(suite.db, (tx) => verifyOwnFreshSignIn(tx, input));

  it("accepts the person's own password when no authenticator is set up, asking no code", async () => {
    const f = await fixture();
    const person = await fresh({ ...f, currentPassword: "correct horse", keyRing });
    expect(person.id).toBe(f.personId);
  });

  it("refuses a wrong password as password.invalid", async () => {
    const f = await fixture();
    expect(await codeOf(() => fresh({ ...f, currentPassword: "wrong", keyRing }))).toBe(
      "password.invalid",
    );
  });

  it("refuses a person with no password as password.invalid", async () => {
    const f = await fixture();
    await suite.db.execute(sql`update persons set password_hash = null where id = ${f.personId}`);
    expect(await codeOf(() => fresh({ ...f, currentPassword: "", keyRing }))).toBe(
      "password.invalid",
    );
  });

  it("takes a password check made before the transaction instead of checking the password again", async () => {
    const f = await fixture();
    const stored = await suite.db.execute<{ password_hash: string }>(
      sql`select password_hash from persons where id = ${f.personId}`,
    );
    const row = stored.rows[0];
    // A verdict saying "matched" for a wrong password: accepted only if the verdict is used.
    const checked = issueCheck({
      personId: f.personId,
      secret: "wrong",
      derivedAgainst: row!.password_hash,
      matches: true,
    });
    expect(await codeOf(() => fresh({ ...f, currentPassword: "wrong", keyRing }))).toBe(
      "password.invalid",
    );
    const person = await fresh({ ...f, currentPassword: "wrong", checked, keyRing });
    expect(person.id).toBe(f.personId);
  });

  it("asks an enrolled person for their authenticator code", async () => {
    const f = await enrolled();
    expect(await codeOf(() => fresh({ ...f, currentPassword: "correct horse", keyRing }))).toBe(
      "totp.invalid",
    );
    expect(
      await codeOf(() =>
        fresh({ ...f, currentPassword: "correct horse", totp: wrongCode(), keyRing }),
      ),
    ).toBe("totp.invalid");
    const person = await fresh({
      ...f,
      currentPassword: "correct horse",
      totp: generateSync({ secret }),
      keyRing,
    });
    expect(person.id).toBe(f.personId);
  });

  it("accepts a recovery code once, then refuses the same code", async () => {
    const f = await enrolled();
    const input = { ...f, currentPassword: "correct horse", recoveryCode: f.codes[0], keyRing };
    expect((await fresh(input)).id).toBe(f.personId);
    expect(await codeOf(() => fresh(input))).toBe("totp.invalid");
  });

  it("refuses a recovery code that is not one of the person's", async () => {
    const f = await enrolled();
    const other = await enrolled();
    expect(
      await codeOf(() =>
        fresh({ ...f, currentPassword: "correct horse", recoveryCode: other.codes[0], keyRing }),
      ),
    ).toBe("totp.invalid");
  });

  it("tries the authenticator code first, leaving a recovery code sent beside a valid one unspent", async () => {
    const f = await enrolled();
    await fresh({
      ...f,
      currentPassword: "correct horse",
      totp: generateSync({ secret }),
      recoveryCode: f.codes[0],
      keyRing,
    });
    expect(
      (await fresh({ ...f, currentPassword: "correct horse", recoveryCode: f.codes[0], keyRing }))
        .id,
    ).toBe(f.personId);
  });

  it("falls back to a recovery code when the authenticator code is wrong", async () => {
    const f = await enrolled();
    const person = await fresh({
      ...f,
      currentPassword: "correct horse",
      totp: wrongCode(),
      recoveryCode: f.codes[1],
      keyRing,
    });
    expect(person.id).toBe(f.personId);
  });

  it("asks nothing of a person with no authenticator, whatever codes are sent", async () => {
    const f = await fixture();
    await expect(
      withTransaction(suite.db, (tx) =>
        requireEnrolledCode(
          tx,
          { id: f.personId, totpSecret: null },
          { totp: "not a code", recoveryCode: "not a recovery code" },
          keyRing,
        ),
      ),
    ).resolves.toBeUndefined();
  });

  it("leaves the other account changes needing an authenticator code: a recovery code does not stand in", async () => {
    const f = await enrolled();
    const withRecovery = {
      ...f,
      recoveryCode: f.codes[2],
      keyRing,
    };
    expect(
      await codeOf(() =>
        withTransaction(suite.db, (tx) => regenerateOwnRecoveryCodes(tx, withRecovery)),
      ),
    ).toBe("totp.invalid");
    // The recovery code was not spent by the refused change.
    expect(
      (await fresh({ ...f, currentPassword: "correct horse", recoveryCode: f.codes[2], keyRing }))
        .id,
    ).toBe(f.personId);
  });
});

describe("an authenticator enrolment begun before a backward clock step", () => {
  const TEN_MINUTES_MS = 10 * 60 * 1000;
  const keyRing = { current: { version: 1, key: Buffer.alloc(32, 5) } };

  async function finishWithExpiry(aheadOfClockMs: number): Promise<string> {
    const f = await fixture();
    const pending = await withTransaction(suite.db, (tx) =>
      beginOwnTotpEnrollment(tx, { ...f, keyRing }),
    );
    const expiresAt = new Date(Date.now() + aheadOfClockMs).toISOString();
    await suite.db.execute(
      sql`update sign_in_challenges set expires_at = ${expiresAt} where id = ${pending.enrollmentId}`,
    );
    try {
      await withTransaction(suite.db, (tx) =>
        finishOwnTotpEnrollment(tx, {
          ...f,
          enrollmentId: pending.enrollmentId,
          code: generateSync({ secret: pending.secret }),
          keyRing,
        }),
      );
      return "accepted";
    } catch (error) {
      return (error as { code?: string }).code ?? String(error);
    }
  }

  it("refuses an enrolment whose expiry lies more than its ten minutes ahead of the clock", async () => {
    expect(await finishWithExpiry(400 * 24 * 60 * 60 * 1000)).toBe("totp.invalid");
    expect(await finishWithExpiry(TEN_MINUTES_MS + 60_000)).toBe("totp.invalid");
  });

  it("finishes an enrolment whose expiry lies just inside its ten minutes", async () => {
    expect(await finishWithExpiry(TEN_MINUTES_MS - 5_000)).toBe("accepted");
  });
});
