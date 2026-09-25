import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { generateSync } from "otplib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { encryptTotpSecret, hashPassword, hashPin, persons } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { mountManagementApi } from "./management-api.js";
import { mountMeApi } from "./me-api.js";

// Pins the route wiring around the passkey ceremonies — gating, body screening, the login cookie and
// the credential row — not the crypto, which `@waitron/identity`'s `passkey.test.ts` covers.
//
// Only the two verify calls are stubbed: a genuine authenticator response cannot be synthesised in a
// test. `@simplewebauthn/server` is a devDependency here so the specifier resolves to the same module
// the identity source imports, which is what lets `vi.mock` match across the package boundary.
vi.mock("@simplewebauthn/server", async (orig) => ({
  ...(await orig<typeof import("@simplewebauthn/server")>()),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { ALL_MODULES } from "./modules.js";

const mockVerifyReg = vi.mocked(verifyRegistrationResponse);
const mockVerifyAuth = vi.mocked(verifyAuthenticationResponse);

/** Built in full so the mock stays honest against the library's `VerifiedRegistrationResponse`. */
function regVerified(id: string): Awaited<ReturnType<typeof verifyRegistrationResponse>> {
  return {
    verified: true,
    registrationInfo: {
      fmt: "none",
      aaguid: "00000000-0000-0000-0000-000000000000",
      credential: { id, publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
      credentialType: "public-key",
      attestationObject: new Uint8Array(),
      userVerified: true,
      credentialDeviceType: "singleDevice",
      credentialBackedUp: false,
      origin: "http://localhost",
    },
  };
}

/** Built in full so the mock stays honest against the library's `VerifiedAuthenticationResponse`. */
function authVerified(
  newCounter: number,
): Awaited<ReturnType<typeof verifyAuthenticationResponse>> {
  return {
    verified: true,
    authenticationInfo: {
      credentialID: "cred-abc",
      newCounter,
      userVerified: true,
      credentialDeviceType: "singleDevice",
      credentialBackedUp: false,
      origin: "http://localhost",
      rpID: "localhost",
    },
  };
}

const LOCALE = "es-ES";
const PASSWORD = "correct horse";
const MANAGER_EMAIL = "manager@x.com";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const noopLog: Logger = () => {};

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(70_000_000 + nifCounter).padStart(8, "0")}K`;
}

async function setupTenant(): Promise<{ managerId: string }> {
  await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Deli Test SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        tillName: "Caja 1",
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );

  // Through the table definition: `persons.id` and `persons.created_at` are `$defaultFn`
  // generators, which a raw SQL insert never reaches.
  const { managerId } = await withTransaction(suite.db, async (tx) => {
    const [manager] = await tx
      .insert(persons)
      .values({
        displayName: "The Manager",
        email: MANAGER_EMAIL,
        pinHash: hashPin("1234"),
        passwordHash: hashPassword(PASSWORD),
        role: "manager",
      })
      .returning({ id: persons.id });
    return { managerId: manager!.id };
  });
  return { managerId };
}

function mountApp(): Hono {
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.db,
      cfg: { nodeId: "00000000-0000-0000-0000-000000000000" },
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
    },
    noopLog,
  );
  return app;
}

/** The me API beside the management API, as `boot.ts` mounts them. */
function mountAppWithMe(): Hono {
  const app = mountApp();
  mountMeApi(
    app,
    {
      db: suite.db,
      cfg: { nodeId: "00000000-0000-0000-0000-000000000000" },
      venueLocale: LOCALE,
      modules: [],
    },
    noopLog,
  );
  return app;
}

async function signIn(app: Hono, email = MANAGER_EMAIL): Promise<Response> {
  return app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
}

/** Returns only the session cookie pair; asserts the 200 so no caller carries an absent cookie. */
async function login(app: Hono, email: string, password = PASSWORD): Promise<string> {
  const res = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

function readCredentials(): Promise<
  { credential_id: string; person_id: string; name: string | null }[]
> {
  return withTransaction(suite.db, (tx) =>
    Promise.resolve(
      tx.all<{ credential_id: string; person_id: string; name: string | null }>(
        sql`select credential_id, person_id, name from webauthn_credentials`,
      ),
    ),
  );
}

async function registerPasskey(app: Hono, cookie: string, credentialId: string): Promise<void> {
  const options = await app.request("/management-api/passkey/register/options", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ currentPassword: PASSWORD }),
  });
  expect(options.status).toBe(200);
  const { challengeHandle } = (await options.json()) as { challengeHandle: string };

  mockVerifyReg.mockResolvedValue(regVerified(credentialId));
  const verify = await app.request("/management-api/passkey/register/verify", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ challengeHandle, response: {} }),
  });
  expect(verify.status).toBe(200);
}

beforeEach(() => {
  mockVerifyReg.mockReset();
  mockVerifyAuth.mockReset();
});

describe("Management API passkey routes (mocked ceremony)", () => {
  it("register/options is gated: 401 without a cookie, 200 with the manager's", async () => {
    await setupTenant();
    const app = mountApp();

    const anon = await app.request("/management-api/passkey/register/options", { method: "POST" });
    expect(anon.status).toBe(401);
    expect((await anon.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management_session.required" },
    });

    const cookie = await login(app, MANAGER_EMAIL);
    const res = await app.request("/management-api/passkey/register/options", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: PASSWORD }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { challengeHandle: string; options: { challenge: string } };
    expect(body.challengeHandle).toBeTruthy();
    expect(body.options.challenge).toBeTruthy();
  });

  it("register/verify (gated) persists a credential row", async () => {
    const { managerId } = await setupTenant();
    const app = mountApp();
    const cookie = await login(app, MANAGER_EMAIL);

    const options = await app.request("/management-api/passkey/register/options", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: PASSWORD }),
    });
    expect(options.status).toBe(200);
    const { challengeHandle } = (await options.json()) as { challengeHandle: string };

    mockVerifyReg.mockResolvedValue(regVerified("cred-abc"));
    const verify = await app.request("/management-api/passkey/register/verify", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ challengeHandle, response: {}, name: "  Work laptop  " }),
    });
    expect(verify.status).toBe(200);
    expect((await verify.json()) as { credentialId: string }).toEqual({ credentialId: "cred-abc" });

    const creds = await readCredentials();
    expect(creds).toHaveLength(1);
    expect(creds[0]).toMatchObject({
      credential_id: "cred-abc",
      person_id: managerId,
      name: "Work laptop",
    });
  });

  it("register/verify surfaces a duplicate credential as 409, not an opaque 500", async () => {
    const { managerId } = await setupTenant();
    const app = mountApp();
    const cookie = await login(app, MANAGER_EMAIL);

    await registerPasskey(app, cookie, "cred-dup");

    // The same credential id again collides on the `credential_id` unique constraint.
    const options = await app.request("/management-api/passkey/register/options", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: PASSWORD }),
    });
    expect(options.status).toBe(200);
    const { challengeHandle } = (await options.json()) as { challengeHandle: string };

    mockVerifyReg.mockResolvedValue(regVerified("cred-dup"));
    const dup = await app.request("/management-api/passkey/register/verify", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ challengeHandle, response: {} }),
    });
    expect(dup.status).toBe(409);
    expect((await dup.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "passkey.already_registered" },
    });

    const creds = await readCredentials();
    expect(creds).toHaveLength(1);
    expect(creds[0]).toMatchObject({ credential_id: "cred-dup", person_id: managerId });
  });

  it("auth/options is ungated: 200 with a challenge handle and no cookie", async () => {
    await setupTenant();
    const app = mountApp();

    const res = await app.request("/management-api/passkey/auth/options", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { challengeHandle: string; options: { challenge: string } };
    expect(body.challengeHandle).toBeTruthy();
    expect(body.options.challenge).toBeTruthy();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("auth/verify (ungated) logs the credential's owner in and sets the session cookie", async () => {
    const { managerId } = await setupTenant();
    const app = mountApp();

    const cookie = await login(app, MANAGER_EMAIL);
    await registerPasskey(app, cookie, "cred-abc");

    const options = await app.request("/management-api/passkey/auth/options", { method: "POST" });
    expect(options.status).toBe(200);
    const { challengeHandle } = (await options.json()) as { challengeHandle: string };

    mockVerifyAuth.mockResolvedValue(authVerified(1));
    const verify = await app.request("/management-api/passkey/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeHandle, response: { id: "cred-abc" } }),
    });
    expect(verify.status).toBe(200);
    expect((await verify.json()) as { personId: string }).toEqual({ personId: managerId });
    const setCookie = verify.headers.get("set-cookie");
    expect(setCookie).toMatch(/^waitron_management_session=/);

    // The minted cookie is a live session: it opens the gated staff roster.
    const gated = await app.request("/management-api/staff", {
      headers: { cookie: setCookie!.split(";")[0] },
    });
    expect(gated.status).toBe(200);
  });

  it("auth/verify screens a malformed challengeHandle as 400 before it reaches Postgres", async () => {
    await setupTenant();
    const app = mountApp();

    // Pins the 400 naming the field and the never-called verifier.
    const badUuid = await app.request("/management-api/passkey/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeHandle: "not-a-uuid", response: {} }),
    });
    expect(badUuid.status).toBe(400);
    expect(
      (await badUuid.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "challengeHandle" } },
    });

    // A `null` body is read as `{}`, so the handle is undefined: the same 400, never a 500.
    const nullBody = await app.request("/management-api/passkey/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    });
    expect(nullBody.status).toBe(400);
    expect((await nullBody.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });

    expect(mockVerifyAuth).not.toHaveBeenCalled();
  });

  it("register/verify screens a malformed challengeHandle as 400 (gated route, same guard)", async () => {
    await setupTenant();
    const app = mountApp();
    const cookie = await login(app, MANAGER_EMAIL);

    const badUuid = await app.request("/management-api/passkey/register/verify", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ challengeHandle: "not-a-uuid", response: {} }),
    });
    expect(badUuid.status).toBe(400);
    expect(
      (await badUuid.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "challengeHandle" } },
    });

    const nullBody = await app.request("/management-api/passkey/register/verify", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "null",
    });
    expect(nullBody.status).toBe(400);

    expect(mockVerifyReg).not.toHaveBeenCalled();
    expect(await readCredentials()).toHaveLength(0);
  });

  it("auth/verify screens a missing / non-object response as 400 before it reaches Postgres", async () => {
    await setupTenant();
    const app = mountApp();

    const validHandle = "00000000-0000-4000-8000-000000000000";
    const missing = await app.request("/management-api/passkey/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeHandle: validHandle }),
    });
    expect(missing.status).toBe(400);
    expect(
      (await missing.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "response" } },
    });

    const nonObject = await app.request("/management-api/passkey/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeHandle: validHandle, response: "not-an-object" }),
    });
    expect(nonObject.status).toBe(400);
    expect((await nonObject.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });

    expect(mockVerifyAuth).not.toHaveBeenCalled();
  });

  it("register/verify screens a missing response as 400 (gated route, same guard)", async () => {
    await setupTenant();
    const app = mountApp();
    const cookie = await login(app, MANAGER_EMAIL);

    const missing = await app.request("/management-api/passkey/register/verify", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ challengeHandle: "00000000-0000-4000-8000-000000000000" }),
    });
    expect(missing.status).toBe(400);
    expect(
      (await missing.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "response" } },
    });

    expect(mockVerifyReg).not.toHaveBeenCalled();
    expect(await readCredentials()).toHaveLength(0);
  });
});

/**
 * Sign-in answers the passkey offer on the management API and the me API records it as resolved, so
 * the round-trip test mounts both.
 */
describe("the sign-in passkey offer", () => {
  it("tells a first-time signer-in to offer a passkey", async () => {
    await setupTenant();
    const response = await signIn(mountApp());
    expect(response.status).toBe(200);
    expect((await response.json()) as { offerPasskey: boolean }).toMatchObject({
      offerPasskey: true,
    });
  });

  it("does not offer a passkey to someone who already holds one", async () => {
    await setupTenant();
    const app = mountApp();
    await registerPasskey(app, await login(app, MANAGER_EMAIL), "cred-already-held");
    expect(await readCredentials()).toHaveLength(1);

    const response = await signIn(app);
    expect(response.status).toBe(200);
    expect((await response.json()) as { offerPasskey: boolean }).toMatchObject({
      offerPasskey: false,
    });
  });

  it("does not offer again once the offer was resolved", async () => {
    await setupTenant();
    const app = mountAppWithMe();
    const cookie = await login(app, MANAGER_EMAIL);

    const resolved = await app.request("/management-api/session/me/passkey-offer", {
      method: "POST",
      headers: { cookie },
    });
    expect(resolved.status).toBe(204);

    const again = await signIn(app);
    expect(again.status).toBe(200);
    expect((await again.json()) as { offerPasskey: boolean }).toMatchObject({
      offerPasskey: false,
    });
  });
});

describe("passkey registration's own-credential check", () => {
  const TOTP_KEY = Buffer.alloc(32, 5);
  const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

  function mountWithKeyRing(): Hono {
    const app = new Hono();
    mountManagementApi(
      app,
      {
        db: suite.db,
        cfg: { nodeId: "00000000-0000-0000-0000-000000000000" },
        secureCookies: false,
        rpId: "localhost",
        origin: "http://localhost",
        credentialKeyRing: { current: { version: 1, key: TOTP_KEY } },
      },
      noopLog,
    );
    return app;
  }

  it("refuses options without a current password, naming the field", async () => {
    await setupTenant();
    const app = mountApp();
    const cookie = await login(app, MANAGER_EMAIL);
    const res = await app.request("/management-api/passkey/register/options", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: 1234 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "currentPassword" } },
    });
  });

  it("passes the authenticator code through for a person with two-factor sign-in", async () => {
    const { managerId } = await setupTenant();
    const app = mountWithKeyRing();
    const cookie = await login(app, MANAGER_EMAIL);
    await suite.db
      .update(persons)
      .set({ totpSecret: encryptTotpSecret(SECRET, { version: 1, key: TOTP_KEY }) })
      .where(eq(persons.id, managerId));
    const options = (body: Record<string, unknown>) =>
      app.request("/management-api/passkey/register/options", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const withoutCode = await options({ currentPassword: PASSWORD });
    expect(withoutCode.status).toBe(401);
    expect(await withoutCode.json()).toEqual({ error: { code: "totp.invalid", params: {} } });
    const withCode = await options({
      currentPassword: PASSWORD,
      totp: generateSync({ secret: SECRET }),
    });
    expect(withCode.status).toBe(200);
    expect(((await withCode.json()) as { challengeHandle: string }).challengeHandle).toBeTruthy();
  });
});
