import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { mountManagementApi } from "./management-api.js";
import { mountMeApi } from "./me-api.js";

// This file proves OUR ROUTE WIRING around the passkey ceremonies — gating, body screening, the
// cookie the auth-verify login sets, and that a credential row really lands — not the crypto. The
// ceremony LOGIC (options issued/stored/consumed, credential persisted, counter bumped) is proven at
// the unit layer in `@waitron/identity`'s `passkey.test.ts`. The register route is GATED on a
// management-session cookie, which needs a migrated database (persons + management_sessions).
//
// WHAT WENT WITH POSTGRESQL. SQLite has no roles and no grants, and every call below runs on the
// one connection. Nothing here now says anything about which identity the routes reach the database
// as. One in-case receipt is retired with the column type and is flagged where it sits — the
// `isUuid` screen on `challengeHandle`.
//
// The WebAuthn ceremony is mocked the same way `@waitron/identity`'s `passkey.test.ts` mocks it:
// `generateRegistrationOptions`/`generateAuthenticationOptions` run FOR REAL (they mint a random
// challenge server-side, no browser needed), and only the two VERIFY calls are stubbed, because a
// genuine authenticator response cannot be synthesised in a test. The mock intercepts the imports made
// by `@waitron/identity`'s `passkey.ts` (consumed as source here); `@simplewebauthn/server` is a
// devDependency of this package so the specifier resolves to the same physical module the identity
// source imports, which is what makes `vi.mock` match across the package boundary.
vi.mock("@simplewebauthn/server", async (orig) => ({
  ...(await orig<typeof import("@simplewebauthn/server")>()),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { ALL_MODULES } from "./modules.js";

const mockVerifyReg = vi.mocked(verifyRegistrationResponse);
const mockVerifyAuth = vi.mocked(verifyAuthenticationResponse);

/** A fully-typed `verified: true` registration result — our route only persists `credential`, but the
 * discriminated union requires the rest, so building it in full keeps the mock honest against the library's
 * real `VerifiedRegistrationResponse` shape (Tasks 2/3 confirmed it). */
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

/** A fully-typed `verified: true` authentication result. Our route reads only `verified` and
 * `authenticationInfo.newCounter`; `VerifiedAuthenticationResponse` is NOT a discriminated union
 * (`authenticationInfo` is required even when `verified` is false), so building it in full keeps the
 * mock honest against the real shape. */
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
const PASSWORD = "correct horse"; // ≥ MIN_PASSWORD_LENGTH; the manager's seeded password.
// Dashboard sign-in resolves the person by EMAIL, so the seeded manager carries a login email
// (unique on `lower(email)` across the database — persons_tenant_email_uq).
const MANAGER_EMAIL = "manager@x.com";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

/** A no-op logger: only the HTTP responses and the database state matter here. */
const noopLog: Logger = () => {};

// Every test provisions its own venue and the per-test reset empties `tenants` in between
// (`packages/db/src/testing/venue-db.ts`), so the counter is belt and braces rather than the thing
// keeping the inserts apart.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(70_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** Provision a venue as owner and seed the people and sessions this route fixture needs. */
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

  // Seeded through the table definition, not by raw SQL: `persons.id` and `persons.created_at` are
  // `$defaultFn` generators on this engine, which a raw insert never reaches while the columns are
  // NOT NULL (`apps/server/src/testing/fiscal-fixtures.ts` took the same change).
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
  // `secureCookies: false` so the session cookie rides the non-TLS `app.request`. `rpId`/`origin`
  // are the loopback passkey Relying Party values `ManagementApiDeps` requires — the same values the
  // mocked `verify*` calls receive.
  mountManagementApi(
    app,
    {
      db: suite.db,
      // The all-zero node id (the capture default): this suite exercises the passkey ceremonies, not
      // origin attribution, so the sentinel keeps its enrolled writes' origin exactly as before Task 6.
      cfg: { nodeId: "00000000-0000-0000-0000-000000000000" },
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
    },
    noopLog,
  );
  return app;
}

/** The same app with the me API mounted beside the management API, as `boot.ts` mounts them: the
 * passkey offer is answered by sign-in on one surface and recorded as resolved on the other. */
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

/** Sign in over HTTP as the seeded manager and hand back the whole response, so a caller can read the
 * body as well as the cookie — `login` below returns only the cookie. */
async function signIn(app: Hono, email = MANAGER_EMAIL): Promise<Response> {
  return app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
}

/** Log in over HTTP by `email` with `password`, returning just the `waitron_management_session=…`
 * cookie pair (the part a browser echoes back). Asserts the 200 so a caller never carries a stale or
 * absent cookie forward silently. */
async function login(app: Hono, email: string, password = PASSWORD): Promise<string> {
  const res = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

/** Read every `webauthn_credentials` row — the proof a real credential row landed, not merely that a
 * route returned 200. */
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

/** Register a passkey for the signed-in manager end-to-end over HTTP: begin (real options + stored
 * challenge) then verify (mocked to succeed), persisting a credential with id `credentialId`. Returns
 * nothing — callers assert on `readCredentials`. */
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

    // No cookie → refused before any DB work.
    const anon = await app.request("/management-api/passkey/register/options", { method: "POST" });
    expect(anon.status).toBe(401);
    expect((await anon.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management_session.required" },
    });

    // The manager's cookie → the ceremony's creation options + an opaque challenge handle.
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

    // Begin, then finish with the ceremony mocked to verify.
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

    // Re-read: exactly one credential landed, owned by the manager — a real write, not merely a
    // 200.
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

    // First registration of `cred-dup` succeeds.
    await registerPasskey(app, cookie, "cred-dup");

    // A SECOND ceremony returning the SAME credential id collides on the (credential_id) unique
    // constraint. `finishPasskeyRegistration` runs the refusal through `isUniqueViolation`, which
    // reads this engine's codes (`packages/db/src/unique-violation.ts`), and throws
    // `passkey.already_registered`, which STATUS maps to 409 — a raw driver error would instead reach
    // `run` as an opaque `server.internal` 500, the "every surfaced code is a 4xx" invariant this fix
    // restores.
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

    // Still exactly one credential — the collision landed no second row.
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
    // A discoverable-login ceremony sets no cookie — the person is unknown until the assertion verifies.
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("auth/verify (ungated) logs the credential's owner in and sets the session cookie", async () => {
    const { managerId } = await setupTenant();
    const app = mountApp();

    // Register "cred-abc" for the manager first (the credential auth/verify resolves the person from).
    const cookie = await login(app, MANAGER_EMAIL);
    await registerPasskey(app, cookie, "cred-abc");

    // A fresh, cookieless authentication ceremony: begin (ungated) then verify.
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
    // The verify half IS the login: it returns the credential owner's id and mints a session cookie.
    expect((await verify.json()) as { personId: string }).toEqual({ personId: managerId });
    const setCookie = verify.headers.get("set-cookie");
    expect(setCookie).toMatch(/^waitron_management_session=/);

    // Prove the minted cookie is a live session: it opens the gated staff roster.
    const gated = await app.request("/management-api/staff", {
      headers: { cookie: setCookie!.split(";")[0] },
    });
    expect(gated.status).toBe(200);
  });

  it("auth/verify screens a malformed challengeHandle as 400 before it reaches Postgres", async () => {
    await setupTenant();
    const app = mountApp();

    // The `isUuid` screen turns a non-UUID handle into a clean 400 naming the field, and the verifier
    // is never reached. The receipt that screen was written against is gone: it rested on a
    // PostgreSQL `uuid` primary key raising 22P02 — an opaque 500 on an UNAUTHENTICATED route — and
    // `webauthn_challenges.id` is `text PRIMARY KEY` now
    // (`packages/identity/drizzle/0000_baseline.sql:110-115`), which simply matches nothing. The case
    // pins the 400 and the never-called verifier; it no longer shows what the screen is preventing.
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

    // A `null` JSON body is coerced to `{}` (the `?? {}` guard): `challengeHandle` is then undefined, so
    // the typeof half of the screen fires — the same 400, never a TypeError → 500.
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

    // A `null` JSON body → `?? {}` → undefined handle → the same 400 via the typeof half of the screen.
    const nullBody = await app.request("/management-api/passkey/register/verify", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "null",
    });
    expect(nullBody.status).toBe(400);

    // Neither malformed request reached the verifier or wrote a credential.
    expect(mockVerifyReg).not.toHaveBeenCalled();
    expect(await readCredentials()).toHaveLength(0);
  });

  it("auth/verify screens a missing / non-object response as 400 before it reaches Postgres", async () => {
    await setupTenant();
    const app = mountApp();

    // A well-formed challengeHandle but NO `response`. This route is UNAUTHENTICATED and
    // `finishPasskeyAuthentication` reads `response.id` to resolve the credential, so a missing/non-object
    // response must be a clean 400 naming the field, never an unauthenticated fault reaching the driver.
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

    // A non-object `response` (a JSON string) fails the same screen.
    const nonObject = await app.request("/management-api/passkey/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeHandle: validHandle, response: "not-an-object" }),
    });
    expect(nonObject.status).toBe(400);
    expect((await nonObject.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });

    // The verifier was never reached — the screen fires before any DB work.
    expect(mockVerifyAuth).not.toHaveBeenCalled();
  });

  it("register/verify screens a missing response as 400 (gated route, same guard)", async () => {
    await setupTenant();
    const app = mountApp();
    const cookie = await login(app, MANAGER_EMAIL);

    // A well-formed challengeHandle but NO `response`: the same non-null-object screen the auth route
    // applies, refused as management.request_invalid naming the field.
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
 * The sign-in passkey offer, which the sign-in route reads back out of the database inside its own
 * transaction.
 *
 * The offer's story spans BOTH dashboard surfaces: sign-in answers it (management API) and the route
 * that records it as resolved lives on the me API, so the round-trip test mounts both on one app,
 * exactly as `boot.ts` does.
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
