import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { mountManagementApi } from "./management-api.js";
import { startRealPostgres } from "./testing/postgres.js";

// Real Postgres, not PGlite: the four passkey routes below all run their DB work through `withTenant` +
// `asAppUser`, so RLS scopes each read/write to the dashboard's own tenant — and PGlite connects as a
// superuser that bypasses RLS entirely (CLAUDE.md §4), so it cannot prove the credential actually lands
// under the tenant as the app role (assertion 2), the whole point of an `.rls.test.ts`. The register
// route is also GATED on a management-session cookie, which needs a migrated DB (persons +
// management_sessions) the container provides. The ceremony LOGIC (options issued/stored/consumed,
// credential persisted, counter bumped) is proven at the unit layer in `@waitron/identity`'s
// `passkey.test.ts`; this file proves OUR ROUTE WIRING around it — gating, body screening, the cookie
// the auth-verify login sets, and RLS-scoped persistence — not the crypto.
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

const mockVerifyReg = vi.mocked(verifyRegistrationResponse);
const mockVerifyAuth = vi.mocked(verifyAuthenticationResponse);

/** A fully-typed `verified: true` registration result — our route only persists `credential`, but the
 * discriminated union requires the rest, so building it in full keeps the mock honest against v13's
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
 * `authenticationInfo.newCounter`; v13's `VerifiedAuthenticationResponse` is NOT a discriminated union
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

const suite = useRealPostgres({
  start: startRealPostgres,
  timeoutMs: 180_000,
});

/** A no-op logger: only the HTTP responses and the database state matter here. */
const noopLog: Logger = () => {};

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the same per-suite counter the 1b harness uses.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(70_000_000 + nifCounter).padStart(8, "0")}K`;
}

/**
 * Stand up a fresh provisioned venue (as the owner), then seed — as the app role under the tenant, so
 * RLS is exercised — a MANAGER (role `manager`, which holds `person.manage`) WITH a dashboard password,
 * so a password login yields a management-session cookie that gates the register routes. Each test gets
 * its OWN tenant, so the credential re-reads below are that test's alone and order-independent
 * (CLAUDE.md §4). This person is seeded directly because provisioning creates only the ADMIN, and this
 * test needs a `manager` (which holds `person.manage`); `pin_hash` is NOT NULL, so a value is supplied
 * even though they log in by password.
 * (Mirrors the 1b harness's `setupTenant`, minus the unused STAFF person: these passkey routes resolve
 * the person from the session, so only the logged-in manager is needed.)
 */
async function setupTenant(): Promise<{ tenantId: string; managerId: string }> {
  const venue = await applyVenue(
    planVenue({
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
      },
    }),
    { db: suite.admin },
  );

  const { managerId } = await withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    const manager = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, password_hash, role)
      values (current_tenant_id(), 'The Manager', ${hashPin("1234")}, ${hashPassword(PASSWORD)}, 'manager')
      returning id`);
    return { managerId: manager.rows[0]!.id };
  });
  return { tenantId: venue.tenantId, managerId };
}

function mountApp(tenantId: string): Hono {
  const app = new Hono();
  // `secureCookies: false` so the session cookie rides the non-TLS `app.request`. `deps.db` is the
  // owner connection; the routes drop to `app_user` themselves via `withTenant` + `asAppUser`.
  // `rpId`/`origin` are the loopback passkey Relying Party values Task 4 widened `ManagementApiDeps`
  // to require — the same values the mocked `verify*` calls receive.
  mountManagementApi(
    app,
    {
      db: suite.admin,
      cfg: { tenantId },
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
    },
    noopLog,
  );
  return app;
}

/** Log in over HTTP as `personId` with `password`, returning just the `waitron_management_session=…`
 * cookie pair (the part a browser echoes back). Asserts the 200 so a caller never carries a stale or
 * absent cookie forward silently. */
async function login(app: Hono, personId: string, password = PASSWORD): Promise<string> {
  const res = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ personId, password }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

/** Read every `webauthn_credentials` row for the tenant as the app role under RLS — the proof a genuine
 * tenant-scoped credential landed, not merely that a route returned 200. */
async function readCredentials(
  tenantId: string,
): Promise<{ credential_id: string; person_id: string; counter: string }[]> {
  return withTenant(suite.admin, tenantId, async (tx) => {
    await asAppUser(tx);
    const r = await tx.execute<{ credential_id: string; person_id: string; counter: string }>(
      sql`select credential_id, person_id, counter from webauthn_credentials`,
    );
    return r.rows;
  });
}

/** Register a passkey for the signed-in manager end-to-end over HTTP: begin (real options + stored
 * challenge) then verify (mocked to succeed), persisting a credential with id `credentialId`. Returns
 * nothing — callers assert on `readCredentials`. */
async function registerPasskey(app: Hono, cookie: string, credentialId: string): Promise<void> {
  const options = await app.request("/management-api/passkey/register/options", {
    method: "POST",
    headers: { cookie },
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

describe("Management API passkey routes over real Postgres (RLS end-to-end, mocked ceremony)", () => {
  it("register/options is gated: 401 without a cookie, 200 with the manager's", async () => {
    const { tenantId, managerId } = await setupTenant();
    const app = mountApp(tenantId);

    // No cookie → refused before any DB work.
    const anon = await app.request("/management-api/passkey/register/options", { method: "POST" });
    expect(anon.status).toBe(401);
    expect((await anon.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management_session.required" },
    });

    // The manager's cookie → the ceremony's creation options + an opaque challenge handle.
    const cookie = await login(app, managerId);
    const res = await app.request("/management-api/passkey/register/options", {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { challengeHandle: string; options: { challenge: string } };
    expect(body.challengeHandle).toBeTruthy();
    expect(body.options.challenge).toBeTruthy();
  });

  it("register/verify (gated) persists a tenant-scoped credential", async () => {
    const { tenantId, managerId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, managerId);

    // Begin, then finish with the ceremony mocked to verify.
    const options = await app.request("/management-api/passkey/register/options", {
      method: "POST",
      headers: { cookie },
    });
    expect(options.status).toBe(200);
    const { challengeHandle } = (await options.json()) as { challengeHandle: string };

    mockVerifyReg.mockResolvedValue(regVerified("cred-abc"));
    const verify = await app.request("/management-api/passkey/register/verify", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ challengeHandle, response: {} }),
    });
    expect(verify.status).toBe(200);
    expect((await verify.json()) as { credentialId: string }).toEqual({ credentialId: "cred-abc" });

    // Re-read as the app role under RLS: exactly one credential landed, owned by the manager, under
    // this tenant — a genuine tenant-scoped write, not merely a 200.
    const creds = await readCredentials(tenantId);
    expect(creds).toHaveLength(1);
    expect(creds[0]).toMatchObject({ credential_id: "cred-abc", person_id: managerId });
  });

  it("register/verify surfaces a duplicate credential as 409, not an opaque 500", async () => {
    const { tenantId, managerId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, managerId);

    // First registration of `cred-dup` succeeds.
    await registerPasskey(app, cookie, "cred-dup");

    // A SECOND ceremony returning the SAME credential id collides on the (tenant_id, credential_id)
    // unique constraint. `finishPasskeyRegistration` translates the 23505 into
    // `passkey.already_registered`, which STATUS maps to 409 — a raw driver error would instead reach
    // `run` as an opaque `server.internal` 500, the "every surfaced code is a 4xx" invariant this fix
    // restores.
    const options = await app.request("/management-api/passkey/register/options", {
      method: "POST",
      headers: { cookie },
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

    // Under RLS still exactly one credential — the collision landed no second row.
    const creds = await readCredentials(tenantId);
    expect(creds).toHaveLength(1);
    expect(creds[0]).toMatchObject({ credential_id: "cred-dup", person_id: managerId });
  });

  it("auth/options is ungated: 200 with a challenge handle and no cookie", async () => {
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);

    const res = await app.request("/management-api/passkey/auth/options", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { challengeHandle: string; options: { challenge: string } };
    expect(body.challengeHandle).toBeTruthy();
    expect(body.options.challenge).toBeTruthy();
    // A discoverable-login ceremony sets no cookie — the person is unknown until the assertion verifies.
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("auth/verify (ungated) logs the credential's owner in and sets the session cookie", async () => {
    const { tenantId, managerId } = await setupTenant();
    const app = mountApp(tenantId);

    // Register "cred-abc" for the manager first (the credential auth/verify resolves the person from).
    const cookie = await login(app, managerId);
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
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);

    // A well-formed-but-non-UUID handle would `22P02` on the `uuid` PK column → opaque 500 (and this
    // route is UNAUTHENTICATED, so that would be an unauthenticated 500); the `isUuid` screen turns it
    // into a clean 400 naming the field. The verifier is never reached.
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
    const { tenantId, managerId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, managerId);

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
    expect(await readCredentials(tenantId)).toHaveLength(0);
  });

  it("auth/verify screens a missing / non-object response as 400 before it reaches Postgres", async () => {
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);

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
    const { tenantId, managerId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, managerId);

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
    expect(await readCredentials(tenantId)).toHaveLength(0);
  });
});
