import { eq } from "drizzle-orm";
import { generateSync } from "otplib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  beginOwnPasskeyCheck,
  encryptTotpSecret,
  hashSessionToken,
  IDENTITY_MIGRATIONS,
  managementSessions,
  persons,
  regenerateOwnRecoveryCodes,
  webauthnCredentials,
} from "@waitron/identity";
import { codeOf, openManagementSession, refusalOf } from "@waitron/identity/test/fixtures.js";

vi.mock("@simplewebauthn/server", async (orig) => ({
  ...(await orig<typeof import("@simplewebauthn/server")>()),
  verifyAuthenticationResponse: vi.fn(),
}));

import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { confirmFreshSignIn } from "./fresh-sign-in.js";
import { createPasswordThrottle } from "./password-throttle.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";

const mockVerifyAuth = vi.mocked(verifyAuthenticationResponse);

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
});

const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

let throttle = createPasswordThrottle();
beforeEach(async () => {
  throttle = createPasswordThrottle();
  mockVerifyAuth.mockReset();
  await suite.db.delete(webauthnCredentials);
});

const confirm = (token: string, body: unknown) =>
  confirmFreshSignIn(
    {
      db: suite.db,
      throttle,
      keyRing: TOTP_KEY_RING,
      rpId: "localhost",
      origin: "http://localhost",
    },
    token,
    body,
  );

async function enrolTotp(personId: string, token: string): Promise<string[]> {
  await suite.db
    .update(persons)
    .set({ totpSecret: encryptTotpSecret(secret, TOTP_KEY_RING.current) })
    .where(eq(persons.id, personId));
  const { codes } = await withTransaction(suite.db, (tx) =>
    regenerateOwnRecoveryCodes(tx, {
      managementSessionId: token,
      currentPassword: "correct horse",
      totp: generateSync({ secret }),
      keyRing: TOTP_KEY_RING,
    }),
  );
  return codes;
}

async function withPasskey(personId: string, credentialId: string): Promise<void> {
  await suite.db
    .insert(webauthnCredentials)
    .values({ personId, credentialId, publicKey: "AQID", counter: 0 });
}

function authVerified(): Awaited<ReturnType<typeof verifyAuthenticationResponse>> {
  return {
    verified: true,
    authenticationInfo: {
      credentialID: "cred-mine",
      newCounter: 1,
      userVerified: true,
      credentialDeviceType: "singleDevice",
      credentialBackedUp: false,
      origin: "http://localhost",
      rpID: "localhost",
    },
  };
}

const beginCheck = (token: string) =>
  withTransaction(suite.db, (tx) =>
    beginOwnPasskeyCheck(tx, { managementSessionId: token, rpId: "localhost" }),
  );

describe("confirmFreshSignIn with a password", () => {
  it("answers the person's id for the right password when no authenticator is set up", async () => {
    const { personId, token } = await openManagementSession(suite.db, "admin");
    expect(await confirm(token, { method: "password", password: "correct horse" })).toBe(personId);
  });

  it("ignores a code sent by a person with no authenticator", async () => {
    const { personId, token } = await openManagementSession(suite.db, "admin");
    expect(
      await confirm(token, { method: "password", password: "correct horse", totp: "000000" }),
    ).toBe(personId);
  });

  it("refuses a wrong password as password.invalid", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    expect(await codeOf(() => confirm(token, { method: "password", password: "wrong" }))).toBe(
      "password.invalid",
    );
    expect(await codeOf(() => confirm(token, { method: "password" }))).toBe("password.invalid");
  });

  it("needs the authenticator code, or an unused recovery code that it spends, once one is set up", async () => {
    const { personId, token } = await openManagementSession(suite.db, "admin");
    const codes = await enrolTotp(personId, token);

    expect(
      await codeOf(() => confirm(token, { method: "password", password: "correct horse" })),
    ).toBe("totp.invalid");
    expect(
      await codeOf(() =>
        confirm(token, { method: "password", password: "correct horse", totp: "000000" }),
      ),
    ).toBe("totp.invalid");
    expect(
      await confirm(token, {
        method: "password",
        password: "correct horse",
        totp: generateSync({ secret }),
      }),
    ).toBe(personId);
    expect(
      await confirm(token, {
        method: "password",
        password: "correct horse",
        recoveryCode: codes[0],
      }),
    ).toBe(personId);
    expect(
      await codeOf(() =>
        confirm(token, { method: "password", password: "correct horse", recoveryCode: codes[0] }),
      ),
    ).toBe("totp.invalid");
  });

  it("throttles repeated wrong passwords per person as password.throttled", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const other = await openManagementSession(suite.db, "admin");
    const answers: string[] = [];
    for (let i = 0; i < 5; i++) {
      answers.push(await codeOf(() => confirm(token, { method: "password", password: "wrong" })));
    }
    expect(answers).toEqual([
      "password.invalid",
      "password.invalid",
      "password.invalid",
      "password.invalid",
      "password.throttled",
    ]);
    expect(
      await codeOf(() => confirm(token, { method: "password", password: "correct horse" })),
    ).toBe("password.throttled");
    expect(await confirm(other.token, { method: "password", password: "correct horse" })).toBe(
      other.personId,
    );
  });

  it("acts as the session's person whatever person the body names", async () => {
    const { personId, token } = await openManagementSession(suite.db, "admin");
    const other = await openManagementSession(suite.db, "admin");
    expect(
      await confirm(token, {
        method: "password",
        password: "correct horse",
        personId: other.personId,
      }),
    ).toBe(personId);
  });

  it("refuses a suspended person and an expired session with the session refusals", async () => {
    const suspended = await openManagementSession(suite.db, "admin");
    await suite.db
      .update(persons)
      .set({ status: "suspended" })
      .where(eq(persons.id, suspended.personId));
    expect(
      await codeOf(() =>
        confirm(suspended.token, { method: "password", password: "correct horse" }),
      ),
    ).toBe("person.suspended");

    const idle = await openManagementSession(suite.db, "admin");
    await suite.db
      .update(managementSessions)
      .set({ lastSeenAt: new Date(Date.now() - 24 * 60 * 60_000).toISOString() })
      .where(eq(managementSessions.tokenHash, hashSessionToken(idle.token)));
    expect(
      await codeOf(() => confirm(idle.token, { method: "password", password: "correct horse" })),
    ).toBe("management_session.expired");
    expect(
      await codeOf(() => confirm("not-a-session", { method: "password", password: "x" })),
    ).toBe("management_session.required");
  });

  it("refuses a present password or code that is not text as management.request_invalid, naming the field, before checking anything", async () => {
    const { personId, token } = await openManagementSession(suite.db, "admin");
    for (const [field, value] of [
      ["password", 42],
      ["password", null],
      ["totp", 123456],
      ["recoveryCode", ["a"]],
    ] as const) {
      const body = { method: "password", password: "wrong", [field]: value };
      expect(await refusalOf(() => confirm(token, body))).toMatchObject({
        code: "management.request_invalid",
        params: { field },
      });
    }
    // None of the four counted as a wrong password.
    expect(await confirm(token, { method: "password", password: "correct horse" })).toBe(personId);
  });

  it("refuses a body that names no known method as management.request_invalid", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    for (const body of [null, "password", {}, { method: "pin", password: "correct horse" }]) {
      expect(await codeOf(() => confirm(token, body))).toBe("management.request_invalid");
    }
  });
});

describe("confirmFreshSignIn with a passkey", () => {
  it("answers the person's id for their own passkey", async () => {
    const { personId, token } = await openManagementSession(suite.db, "admin");
    await withPasskey(personId, "cred-mine");
    mockVerifyAuth.mockResolvedValue(authVerified());
    const { challengeHandle } = await beginCheck(token);
    expect(
      await confirm(token, { method: "passkey", challengeHandle, response: { id: "cred-mine" } }),
    ).toBe(personId);
  });

  it("accepts the passkey with the authenticator code once one is set up", async () => {
    const { personId, token } = await openManagementSession(suite.db, "admin");
    await withPasskey(personId, "cred-mine");
    await enrolTotp(personId, token);
    mockVerifyAuth.mockResolvedValue(authVerified());
    const { challengeHandle } = await beginCheck(token);
    expect(
      await confirm(token, {
        method: "passkey",
        challengeHandle,
        response: { id: "cred-mine" },
        totp: generateSync({ secret }),
      }),
    ).toBe(personId);
  });

  it("throttles wrong codes resent behind one valid passkey response as password.throttled", async () => {
    const { personId, token } = await openManagementSession(suite.db, "admin");
    await withPasskey(personId, "cred-mine");
    await enrolTotp(personId, token);
    mockVerifyAuth.mockResolvedValue(authVerified());
    const { challengeHandle } = await beginCheck(token);
    const body = { method: "passkey", challengeHandle, response: { id: "cred-mine" } };
    const answers: string[] = [];
    for (let i = 0; i < 5; i++) {
      answers.push(await codeOf(() => confirm(token, { ...body, totp: `00000${i}` })));
    }
    expect(answers).toEqual([
      "totp.invalid",
      "totp.invalid",
      "totp.invalid",
      "totp.invalid",
      "password.throttled",
    ]);
  });

  it("shares the throttle with the password form, per person", async () => {
    const { personId, token } = await openManagementSession(suite.db, "admin");
    await withPasskey(personId, "cred-mine");
    for (let i = 0; i < 4; i++) {
      await codeOf(() => confirm(token, { method: "password", password: "wrong" }));
    }
    mockVerifyAuth.mockResolvedValue(authVerified());
    const { challengeHandle } = await beginCheck(token);
    expect(
      await codeOf(() =>
        confirm(token, { method: "passkey", challengeHandle, response: { id: "cred-mine" } }),
      ),
    ).toBe("password.throttled");
  });

  it("refuses a malformed challenge handle or a missing response as management.request_invalid", async () => {
    const { personId, token } = await openManagementSession(suite.db, "admin");
    await withPasskey(personId, "cred-mine");
    const { challengeHandle } = await beginCheck(token);
    for (const body of [
      { method: "passkey", challengeHandle: "nope", response: { id: "cred-mine" } },
      { method: "passkey", response: { id: "cred-mine" } },
      { method: "passkey", challengeHandle },
      { method: "passkey", challengeHandle, response: null },
      { method: "passkey", challengeHandle, response: "cred-mine" },
    ]) {
      expect(await codeOf(() => confirm(token, body))).toBe("management.request_invalid");
    }
  });

  it("refuses a present code that is not text as management.request_invalid, naming the field, before checking the passkey", async () => {
    const { personId, token } = await openManagementSession(suite.db, "admin");
    await withPasskey(personId, "cred-mine");
    mockVerifyAuth.mockResolvedValue(authVerified());
    const { challengeHandle } = await beginCheck(token);
    for (const [field, value] of [
      ["totp", 123456],
      ["recoveryCode", null],
    ] as const) {
      const body = { method: "passkey", challengeHandle, response: { id: "cred-mine" } };
      expect(await refusalOf(() => confirm(token, { ...body, [field]: value }))).toMatchObject({
        code: "management.request_invalid",
        params: { field },
      });
    }
    expect(mockVerifyAuth).not.toHaveBeenCalled();
  });

  it("refuses a suspended person with the session refusal", async () => {
    const { personId, token } = await openManagementSession(suite.db, "admin");
    await withPasskey(personId, "cred-mine");
    const { challengeHandle } = await beginCheck(token);
    await suite.db.update(persons).set({ status: "suspended" }).where(eq(persons.id, personId));
    expect(
      await codeOf(() =>
        confirm(token, { method: "passkey", challengeHandle, response: { id: "cred-mine" } }),
      ),
    ).toBe("person.suspended");
  });
});
