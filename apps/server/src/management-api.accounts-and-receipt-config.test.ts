/**
 * The dashboard's sign-in and staff-administration routes end to end — login, logout, the roster
 * and its gate, invitations, password reset, Google linking, degenerate bodies answering 4xx rather
 * than 500 — and receipt configuration. `management-api.test.ts` holds the venue-layout routes.
 *
 * The two concurrent cases (`lets only one concurrent invitation claim a live display name`,
 * `preserves one active admin when two admins concurrently demote themselves`) stage no race:
 * `withTransaction` serialises writers (`packages/db/src/tenancy.ts`), so they pin the application
 * pre-checks. Nothing here checks that a unique index catches writers a pre-check let through.
 */
import { createHash, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi, type Mock } from "vitest";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { encryptTotpSecret, hashPassword, hashPin, persons } from "@waitron/identity";
import { DEFAULT_RECEIPT } from "@waitron/layouts";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import type { AccountEmailSender } from "./account-email.js";
import type { exchangeGoogleCode } from "./google-oidc.js";
import { mountManagementApi, type ManagementApiDeps } from "./management-api.js";
import { ALL_MODULES } from "./modules.js";
import { createPasswordThrottle, type PasswordThrottle } from "./password-throttle.js";

const LOCALE = "es-ES";
const PASSWORD = "correct horse";
const MANAGER_EMAIL = "manager@x.com";
const STAFF_EMAIL = "clerk@x.com";
const ACCOUNT_ACTION_CODE_KEY = Buffer.alloc(32, 21);

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

function invitationBody(
  displayName: string,
  email: unknown,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    displayName,
    firstNames: displayName,
    lastNames: "Test",
    telephone: null,
    role: "staff",
    email,
    ...overrides,
  };
}

async function setupTenant(): Promise<{ managerId: string; staffId: string }> {
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
  const { managerId, staffId } = await withTransaction(suite.db, async (tx) => {
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
    const [staff] = await tx
      .insert(persons)
      .values({
        displayName: "The Clerk",
        email: STAFF_EMAIL,
        pinHash: hashPin("1234"),
        passwordHash: hashPassword(PASSWORD),
        role: "staff",
      })
      .returning({ id: persons.id });
    return { managerId: manager!.id, staffId: staff!.id };
  });
  return { managerId, staffId };
}

function mountApp(
  sendAccountEmail?: AccountEmailSender,
  passwordThrottle?: PasswordThrottle,
  google?: {
    exchange: Mock<typeof exchangeGoogleCode>;
  },
): Hono {
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.db,
      cfg: { nodeId: "00000000-0000-0000-0000-000000000000" },
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
      sendAccountEmail,
      passwordThrottle,
      accountActionCodeKey: ACCOUNT_ACTION_CODE_KEY,
      ...(google === undefined
        ? {}
        : {
            googleOidc: {
              clientId: "client.apps.googleusercontent.com",
              clientSecret: "secret",
              redirectUri: "http://localhost/management-api/google/callback",
            },
            googleCodeExchange: google.exchange,
          }),
    },
    noopLog,
  );
  return app;
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

async function countPersonsNamed(displayName: string): Promise<number> {
  const rows = await withTransaction(suite.db, async (tx) => {
    const r = await tx.execute<{ display_name: string }>(
      sql`select display_name from persons where display_name = ${displayName}`,
    );
    return r.rows;
  });
  return rows.length;
}

describe("Management API staff + session routes", () => {
  it("lets only one concurrent invitation claim a live display name", async () => {
    await setupTenant();
    const app = mountApp();
    const cookie = await login(app, MANAGER_EMAIL);
    const responses = await Promise.all([
      app.request("/management-api/staff", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(invitationBody("Same till name", "first-same@example.test")),
      }),
      app.request("/management-api/staff", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(invitationBody(" same till name ", "second-same@example.test")),
      }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const matching = await suite.db.execute<{ count: number }>(sql`
      select count(*) as count from persons
      where lower(display_name)='same till name'`);
    expect(matching.rows[0]!.count).toBe(1);
  });

  it("preserves one active admin when two admins concurrently demote themselves", async () => {
    const { managerId } = await setupTenant();
    await suite.db.execute(sql`update persons set role='admin' where id=${managerId}`);
    const app = mountApp();
    const ownerCookie = await login(app, "owner@example.test", "dashPass123");
    const managerCookie = await login(app, MANAGER_EMAIL);
    const owner = await suite.db.execute<{ id: string }>(
      sql`select id from persons where email='owner@example.test'`,
    );
    const edit = (id: string, cookie: string, displayName: string, email: string) =>
      app.request(`/management-api/staff/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          displayName,
          firstNames: displayName,
          lastNames: "Admin",
          telephone: null,
          email,
          role: "staff",
          status: "active",
        }),
      });
    const responses = await Promise.all([
      edit(owner.rows[0]!.id, ownerCookie, "Administradora", "owner@example.test"),
      edit(managerId, managerCookie, "The Manager", MANAGER_EMAIL),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([204, 409]);
    const remaining = await suite.db.execute<{ count: number }>(sql`
      select count(*) as count from persons
      where role='admin' and status='active'`);
    expect(remaining.rows[0]!.count).toBe(1);
  });
  it("links and then signs in with a configured Google account", async () => {
    await setupTenant();
    const exchange = vi
      .fn<typeof exchangeGoogleCode>()
      .mockResolvedValue({ subject: "google-subject-1" });
    const app = mountApp(undefined, undefined, {
      exchange,
    });
    const cookie = await login(app, MANAGER_EMAIL);
    const startLink = await app.request("/management-api/session/me/google", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: PASSWORD }),
    });
    expect(startLink.status).toBe(200);
    const linkUrl = new URL(
      ((await startLink.json()) as { authorizationUrl: string }).authorizationUrl,
    );
    const linked = await app.request(
      `/management-api/google/callback?state=${encodeURIComponent(linkUrl.searchParams.get("state")!)}&code=link-code`,
      { headers: { cookie: startLink.headers.get("set-cookie")!.split(";")[0]! } },
    );
    expect(linked.status).toBe(302);
    expect(linked.headers.get("location")).toBe("http://localhost/manage/profile?google=linked");

    const startLogin = await app.request("/management-api/google/login", { method: "POST" });
    const loginUrl = new URL(
      ((await startLogin.json()) as { authorizationUrl: string }).authorizationUrl,
    );
    const signedIn = await app.request(
      `/management-api/google/callback?state=${encodeURIComponent(loginUrl.searchParams.get("state")!)}&code=login-code`,
      { headers: { cookie: startLogin.headers.get("set-cookie")!.split(";")[0]! } },
    );
    expect(signedIn.status).toBe(302);
    expect(signedIn.headers.get("location")).toBe("http://localhost/manage/?login=google");
    expect(signedIn.headers.get("set-cookie")).toContain("waitron_management_session=");
    expect(exchange).toHaveBeenCalledTimes(2);
    expect(exchange.mock.calls[0]![1]).toMatchObject({
      code: "link-code",
      nonce: expect.any(String),
      verifier: expect.any(String),
    });
  });

  it("refuses a Google callback that did not start in the same browser", async () => {
    await setupTenant();
    const app = mountApp(undefined, undefined, {
      exchange: vi.fn<typeof exchangeGoogleCode>().mockResolvedValue({ subject: "google-subject" }),
    });
    const started = await app.request("/management-api/google/login", { method: "POST" });
    const url = new URL(((await started.json()) as { authorizationUrl: string }).authorizationUrl);
    const callback = await app.request(
      `/management-api/google/callback?state=${encodeURIComponent(url.searchParams.get("state")!)}&code=code`,
    );
    expect(callback.status).toBe(401);
    expect(await callback.json()).toEqual({ error: { code: "google.invalid", params: {} } });
  });

  it("backs off identically for wrong passwords and unknown emails, then clears after success", async () => {
    await setupTenant();
    let now = 0;
    const app = mountApp(
      undefined,
      createPasswordThrottle(() => now),
    );
    const attempt = (email: string, password = "wrong") =>
      app.request("/management-api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
    for (const email of [MANAGER_EMAIL, "unknown@example.com"]) {
      for (let i = 0; i < 4; i++) expect((await attempt(email)).status).toBe(401);
      const blocked = await attempt(` ${email.toUpperCase()} `);
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("set-cookie")).toBeNull();
      expect(await blocked.json()).toEqual({
        error: { code: "password.throttled", params: { retryAfterSeconds: 2 } },
      });
    }
    now = 2000;
    expect((await attempt(MANAGER_EMAIL, PASSWORD)).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await attempt(MANAGER_EMAIL)).status).toBe(401);
    expect((await attempt(MANAGER_EMAIL)).status).toBe(429);
  });

  it("does not count the expected authenticator transition as a failed password", async () => {
    await setupTenant();
    await withTransaction(suite.db, async (tx) => {
      await tx.insert(persons).values({
        displayName: "Factor Manager",
        email: "factor@example.com",
        pinHash: hashPin("1234"),
        passwordHash: hashPassword(PASSWORD),
        role: "manager",
        totpSecret: encryptTotpSecret("JBSWY3DPEHPK3PXP", {
          version: 1,
          key: ACCOUNT_ACTION_CODE_KEY,
        }),
      });
    });
    const finish = vi.fn();
    const app = mountApp(undefined, { begin: vi.fn(() => finish) });
    const response = await app.request("/management-api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "factor@example.com", password: PASSWORD }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "totp.required", params: {} } });
    expect(finish).toHaveBeenCalledWith("error");
  });

  it("login → list → create → verify persistence", async () => {
    await setupTenant();
    const app = mountApp();

    const loginRes = await app.request("/management-api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: MANAGER_EMAIL, password: PASSWORD }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie")!.split(";")[0];
    expect(cookie).toMatch(/^waitron_management_session=/);

    const listed = await app.request("/management-api/staff", { headers: { cookie } });
    expect(listed.status).toBe(200);
    const people = (await listed.json()) as { displayName: string }[];
    expect(people.some((p) => p.displayName === "The Manager")).toBe(true);

    const created = await app.request("/management-api/staff", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(invitationBody("Ada", "ada@x.com")),
    });
    expect(created.status).toBe(201);
    expect((await created.json()) as { id: string }).toHaveProperty("id");

    expect(await countPersonsNamed("Ada")).toBe(1);
  });

  it("rejects an unauthenticated staff list with 401", async () => {
    await setupTenant();
    const app = mountApp();

    const res = await app.request("/management-api/staff");
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management_session.required" },
    });
  });

  it("rejects a wrong password with 401 and sets no cookie", async () => {
    await setupTenant();
    const app = mountApp();

    const res = await app.request("/management-api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: MANAGER_EMAIL, password: "wrong password" }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "password.invalid" },
    });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("refuses staff-role creation with 403", async () => {
    await setupTenant();
    const app = mountApp();

    // The staff-role person CAN log in (login checks the credential, not the role)…
    const cookie = await login(app, STAFF_EMAIL);
    // …but holds no `person.manage`, so creating a person is refused before any write.
    const res = await app.request("/management-api/staff", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(invitationBody("Nope", "nope@x.com")),
    });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
    expect(await countPersonsNamed("Nope")).toBe(0);
  });

  it("logs out — ends the session, clears the cookie, and a reused cookie is refused", async () => {
    await setupTenant();
    const app = mountApp();
    const cookie = await login(app, MANAGER_EMAIL);

    expect((await app.request("/management-api/staff", { headers: { cookie } })).status).toBe(200);

    const out = await app.request("/management-api/session", {
      method: "DELETE",
      headers: { cookie },
    });
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toMatch(/waitron_management_session=;/);

    const after = await app.request("/management-api/staff", { headers: { cookie } });
    expect(after.status).toBe(401);
  });

  it("logout with no cookie is idempotent (204)", async () => {
    await setupTenant();
    const app = mountApp();

    const res = await app.request("/management-api/session", { method: "DELETE" });
    expect(res.status).toBe(204);
  });

  it("serves the unauthenticated pre-login roster", async () => {
    await setupTenant();
    const app = mountApp();

    const res = await app.request("/management-api/staff-roster");
    expect(res.status).toBe(200);
    const roster = (await res.json()) as { personId: string; displayName: string }[];
    expect(roster.map((r) => r.displayName)).toEqual(
      expect.arrayContaining(["The Manager", "The Clerk"]),
    );
    for (const entry of roster) {
      expect(Object.keys(entry).sort()).toEqual(["displayName", "personId"]);
    }
  });

  it("requires an email when creating a person", async () => {
    await setupTenant();
    const app = mountApp();
    const cookie = await login(app, MANAGER_EMAIL);
    const res = await app.request("/management-api/staff", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(invitationBody("No email", undefined)),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { params: { field: string } } }).toMatchObject({
      error: { params: { field: "email" } },
    });
    expect(await countPersonsNamed("No email")).toBe(0);
  });

  it("emails a single-use setup link after creating a person", async () => {
    const sent: Parameters<AccountEmailSender>[0][] = [];
    await setupTenant();
    const app = mountApp(async (message) => {
      sent.push(message);
    });
    const cookie = await login(app, MANAGER_EMAIL);
    const res = await app.request("/management-api/staff", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(invitationBody("Invited", "invited@x.com")),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ invitationSent: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      purpose: "invitation",
      email: "invited@x.com",
      displayName: "Invited",
    });
    expect(new URL(sent[0]!.actionUrl).pathname).toBe("/manage/account");
    expect(new URL(sent[0]!.actionUrl).searchParams.get("token")).toBeTruthy();
    expect(new URL(sent[0]!.actionUrl).searchParams.get("purpose")).toBe("invitation");
    expect(new URLSearchParams(new URL(sent[0]!.actionUrl).hash.slice(1)).get("email")).toBe(
      "invited@x.com",
    );
  });

  it("requests and completes a password reset without revealing unknown emails", async () => {
    const sent: Parameters<AccountEmailSender>[0][] = [];
    const { staffId } = await setupTenant();
    const app = mountApp(async (message) => {
      sent.push(message);
    });
    const unknown = await app.request("/management-api/password-reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "unknown@x.com" }),
    });
    expect(unknown.status).toBe(202);
    expect(sent).toHaveLength(0);

    const requested = await app.request("/management-api/password-reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: STAFF_EMAIL }),
    });
    expect(requested.status).toBe(202);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.purpose).toBe("password_reset");
    const repeated = await app.request("/management-api/password-reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `  ${STAFF_EMAIL.toUpperCase()}  ` }),
    });
    expect(repeated.status).toBe(202);
    expect(sent).toHaveLength(1);
    const token = new URL(sent[0]!.actionUrl).searchParams.get("token")!;
    const purpose = new URL(sent[0]!.actionUrl).searchParams.get("purpose")!;

    const completed = await app.request("/management-api/account-actions/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, purpose, password: "a replacement password" }),
    });
    expect(completed.status).toBe(200);
    expect(await completed.json()).toEqual({ personId: staffId, authenticated: false });
    expect(completed.headers.get("set-cookie")).toContain("waitron_management_session=; Max-Age=0");
    await expect(login(app, STAFF_EMAIL, "a replacement password")).resolves.toMatch(
      /^waitron_management_session=/,
    );
  });

  it("uses the same recovery acknowledgement for pending and unknown accounts", async () => {
    const sent: Parameters<AccountEmailSender>[0][] = [];
    const { staffId } = await setupTenant();
    await suite.db.execute(
      sql`update persons set status = 'pending', password_hash = null, pin_hash = null where id = ${staffId}`,
    );
    const app = mountApp(async (message) => {
      sent.push(message);
    });
    const request = (email: string) =>
      app.request("/management-api/password-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
    const unknown = await request("unknown@x.com");
    const pending = await request(STAFF_EMAIL);
    expect(pending.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(await pending.text()).toBe(await unknown.text());
    expect(pending.headers.get("set-cookie")).toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ purpose: "invitation", email: STAFF_EMAIL });
    expect(sent[0]!.code).toBeUndefined();
    expect(new URL(sent[0]!.actionUrl).searchParams.get("purpose")).toBe("invitation");
    const repeated = await request(` ${STAFF_EMAIL.toUpperCase()} `);
    expect(repeated.status).toBe(202);
    expect(sent).toHaveLength(1);
  });

  it("removes public invitation replacement and rejects code-only account actions", async () => {
    const sent: Parameters<AccountEmailSender>[0][] = [];
    await setupTenant();
    const app = mountApp(async (message) => {
      sent.push(message);
    });
    const cookie = await login(app, MANAGER_EMAIL);
    const created = await app.request("/management-api/staff", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(invitationBody("Code retirement", "retired-code@x.com")),
    });
    expect(created.status).toBe(201);
    const codeBody = {
      email: "retired-code@x.com",
      code: sent[0]!.code ?? "123456",
      purpose: "invitation",
      password: "a secure password",
      pin: "1234",
    };
    for (const action of ["inspect", "complete"]) {
      const result = await app.request(`/management-api/account-actions/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(codeBody),
      });
      expect(result.status).toBe(400);
      expect(await result.json()).toEqual({
        error: { code: "account_action.invalid", params: {} },
      });
    }
    const removed = await app.request("/management-api/invitation-resend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "retired-code@x.com" }),
    });
    expect(removed.status).toBe(404);
  });

  it("inspects an invitation token without consuming it and allows manager resends for pending accounts", async () => {
    const sent: Parameters<AccountEmailSender>[0][] = [];
    await setupTenant();
    const app = mountApp(async (message) => {
      sent.push(message);
    });
    const cookie = await login(app, MANAGER_EMAIL);
    const created = await app.request("/management-api/staff", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(invitationBody("Pending", "pending-inspect@x.com")),
    });
    expect(created.status).toBe(201);
    const original = sent[0]!;
    expect(original.code).toBeUndefined();
    expect(original.codeExpiresAt).toBeUndefined();
    const token = new URL(original.actionUrl).searchParams.get("token")!;

    const inspected = await app.request("/management-api/account-actions/inspect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, purpose: "invitation" }),
    });
    expect(inspected.status).toBe(200);
    expect(await inspected.json()).toEqual({
      email: "pending-inspect@x.com",
      purpose: "invitation",
    });
    expect(inspected.headers.get("set-cookie")).toBeNull();

    const completed = await app.request("/management-api/account-actions/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token,
        purpose: "invitation",
        password: "a replacement password",
        pin: "4321",
      }),
    });
    expect(completed.status).toBe(200);
    expect(completed.headers.get("set-cookie")).toContain("waitron_management_session=");

    const secondCreated = await app.request("/management-api/staff", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(invitationBody("Pending Again", "pending-resend@x.com")),
    });
    expect(secondCreated.status).toBe(201);
    const secondId = ((await secondCreated.json()) as { id: string }).id;
    const resent = await app.request(`/management-api/staff/${secondId}/invitation`, {
      method: "POST",
      headers: { cookie },
    });
    expect(resent.status).toBe(200);
    expect(await resent.json()).toEqual({ invitationSent: true });
    expect(sent).toHaveLength(3);
    expect(sent[2]!.email).toBe("pending-resend@x.com");
    expect(sent[2]!.code).toBeUndefined();
    const hiddenCodes = await suite.db.execute<{ count: string }>(
      sql`select cast(count(*) as text) as count from management_account_actions where purpose='invitation' and (code_hash is not null or code_expires_at is not null)`,
    );
    expect(hiddenCodes.rows[0]!.count).toBe("0");
  });

  it("creates a person with an email and lists it back", async () => {
    await setupTenant();
    const app = mountApp();
    const cookie = await login(app, MANAGER_EMAIL);

    const created = await app.request("/management-api/staff", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(invitationBody("Owner", "owner@x.com", { role: "manager" })),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const listed = await app.request("/management-api/staff", { headers: { cookie } });
    const people = (await listed.json()) as { personId: string; email: string | null }[];
    expect(people.find((p) => p.personId === id)?.email).toBe("owner@x.com");
  });

  it("PUT saves a complete administrative edit atomically", async () => {
    const { staffId } = await setupTenant();
    const app = mountApp();
    const cookie = await login(app, MANAGER_EMAIL);
    const details = {
      displayName: "Grace",
      firstNames: "Grace Brewster",
      lastNames: "Hopper",
      telephone: "+1 222 333 4444",
      email: "grace@example.com",
      role: "supervisor",
      status: "active",
    };
    const saved = await app.request(`/management-api/staff/${staffId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(details),
    });
    expect(saved.status).toBe(204);
    const listed = await app.request("/management-api/staff", { headers: { cookie } });
    const people = (await listed.json()) as ({ personId: string } & typeof details)[];
    expect(people.find((person) => person.personId === staffId)).toMatchObject(details);
  });

  it("create with a duplicate email → 409 person.email_taken, no row lands", async () => {
    // The seeded manager already holds MANAGER_EMAIL.
    await setupTenant();
    const app = mountApp();
    const cookie = await login(app, MANAGER_EMAIL);

    const res = await app.request("/management-api/staff", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(invitationBody("Dup", MANAGER_EMAIL)),
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "person.email_taken" },
    });
    expect(await countPersonsNamed("Dup")).toBe(0);
  });

  it("create with a malformed email → 400 person.email_invalid, no row lands", async () => {
    await setupTenant();
    const app = mountApp();
    const cookie = await login(app, MANAGER_EMAIL);

    const res = await app.request("/management-api/staff", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(invitationBody("Bad", "not-an-email")),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "person.email_invalid" },
    });
    expect(await countPersonsNamed("Bad")).toBe(0);
  });

  it("create with a non-string email → 400 management.request_invalid (field email)", async () => {
    await setupTenant();
    const app = mountApp();
    const cookie = await login(app, MANAGER_EMAIL);

    const badCreate = await app.request("/management-api/staff", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(invitationBody("Nope", 123)),
    });
    expect(badCreate.status).toBe(400);
    expect(
      (await badCreate.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "email" } } });
    expect(await countPersonsNamed("Nope")).toBe(0);
  });

  it("resets a PIN without allowing the administrator to choose its replacement", async () => {
    const { staffId } = await setupTenant();
    const app = mountApp();
    const cookie = await login(app, MANAGER_EMAIL);

    const resetPin = await app.request(`/management-api/staff/${staffId}/reset-pin`, {
      method: "POST",
      headers: { cookie },
    });
    expect(resetPin.status).toBe(204);
    const row = await suite.db.execute<{ pin_hash: string | null }>(
      sql`select pin_hash from persons where id = ${staffId}`,
    );
    expect(row.rows[0]!.pin_hash).toBeNull();
  });

  it("reset login clears credentials, moves the user to Pending, and sends a new invitation", async () => {
    const sent: Parameters<AccountEmailSender>[0][] = [];
    const { staffId } = await setupTenant();
    const app = mountApp(async (message) => {
      sent.push(message);
    });
    const cookie = await login(app, MANAGER_EMAIL);
    const reset = await app.request(`/management-api/staff/${staffId}/reset-login`, {
      method: "POST",
      headers: { cookie },
    });
    expect(reset.status).toBe(200);
    expect(await reset.json()).toEqual({ invitationSent: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ purpose: "invitation", email: STAFF_EMAIL });
    const row = await suite.db.execute<{
      status: string;
      pin_hash: string | null;
      password_hash: string | null;
    }>(sql`select status, pin_hash, password_hash from persons
           where id = ${staffId}`);
    expect(row.rows[0]).toEqual({ status: "pending", pin_hash: null, password_hash: null });
    const repeated = await app.request(`/management-api/staff/${staffId}/reset-login`, {
      method: "POST",
      headers: { cookie },
    });
    expect(await repeated.json()).toEqual({ invitationSent: false });
    expect(sent).toHaveLength(1);
  });

  it("screens malformed bodies and ids on the gated write routes", async () => {
    const { staffId } = await setupTenant();
    const app = mountApp();
    const cookie = await login(app, MANAGER_EMAIL);

    const badCreate = await app.request("/management-api/staff", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ displayName: "No role or pin" }),
    });
    expect(badCreate.status).toBe(400);
    expect((await badCreate.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });

    // The retired direct-password route remains unavailable.
    const badPw = await app.request(`/management-api/staff/${staffId}/password`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ password: null }),
    });
    expect(badPw.status).toBe(404);

    // A non-UUID id on the credential routes → person.not_found (404).
    const resetBadId = await app.request("/management-api/staff/not-a-uuid/reset-pin", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ pin: "1111" }),
    });
    expect(resetBadId.status).toBe(404);
    const pwBadId = await app.request("/management-api/staff/not-a-uuid/password", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ password: "some password" }),
    });
    expect(pwBadId.status).toBe(404);
  });

  it("refuses a login with an unknown email as password.invalid (leaking no field)", async () => {
    await setupTenant();
    const app = mountApp();

    // An unknown email gets the same `password.invalid` as a wrong password.
    const res = await app.request("/management-api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ghost@x.com", password: PASSWORD }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "password.invalid" },
    });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  // A literal JSON `null` body is read as `{}` (`readJsonBody`), so each route answers its own 4xx
  // rather than a 500.

  it("login with a null JSON body → 401 password.invalid, no cookie", async () => {
    await setupTenant();
    const app = mountApp();

    const res = await app.request("/management-api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    });
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "password.invalid" },
    });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("login with a non-string totp → 401 password.invalid (screened before loginManager)", async () => {
    await setupTenant();
    const app = mountApp();

    // The manager is not TOTP-enrolled, so without the route's screen `loginManager` would ignore
    // `totp` and sign in.
    const res = await app.request("/management-api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: MANAGER_EMAIL, password: PASSWORD, totp: 123 }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "password.invalid" },
    });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("create with a null JSON body → 400 management.request_invalid", async () => {
    await setupTenant();
    const app = mountApp();
    const cookie = await login(app, MANAGER_EMAIL);

    const res = await app.request("/management-api/staff", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "null",
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("reset-pin accepts no body while the retired password route remains unavailable", async () => {
    const { staffId } = await setupTenant();
    const app = mountApp();
    const cookie = await login(app, MANAGER_EMAIL);

    const resetPin = await app.request(`/management-api/staff/${staffId}/reset-pin`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "null",
    });
    expect(resetPin.status).toBe(204);

    const setPw = await app.request(`/management-api/staff/${staffId}/password`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "null",
    });
    expect(setPw.status).toBe(404);
  });

  it("maps an unparseable request body to the route's own 4xx (guarded parse, never a 500)", async () => {
    const { staffId } = await setupTenant();
    const app = mountApp();

    // `readJsonBody` reads an unparseable body as `{}`, as it does a JSON `null`.
    const malformedHeaders = { "content-type": "application/json" };

    const loginRes = await app.request("/management-api/session", {
      method: "POST",
      headers: malformedHeaders,
      body: "{ not json",
    });
    expect(loginRes.status).toBe(401);
    expect((await loginRes.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "password.invalid" },
    });
    expect(loginRes.headers.get("set-cookie")).toBeNull();

    const cookie = await login(app, MANAGER_EMAIL);
    const create = await app.request("/management-api/staff", {
      method: "POST",
      headers: { ...malformedHeaders, cookie },
      body: "{ not json",
    });
    expect(create.status).toBe(400);
    expect((await create.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });

    // The retired partial-edit route stays unavailable.
    const patch = await app.request(`/management-api/staff/${staffId}`, {
      method: "PATCH",
      headers: { ...malformedHeaders, cookie },
      body: "{ not json",
    });
    expect(patch.status).toBe(404);
  });
});

async function getReceiptOverHttp(app: Hono, cookie: string): Promise<{ receipt: unknown }> {
  const res = await app.request("/management-api/receipt", { headers: { cookie } });
  expect(res.status).toBe(200);
  return (await res.json()) as { receipt: unknown };
}

describe("Management API — receipt routes (Task 7)", () => {
  it("refuses both routes unauthenticated with 401 management_session.required", async () => {
    await setupTenant();
    const app = mountApp();
    const json = { "content-type": "application/json" };

    const cases = [
      app.request("/management-api/receipt"),
      app.request("/management-api/receipt", {
        method: "PUT",
        headers: json,
        body: JSON.stringify({ receipt: { footerMessage: "Gracias" } }),
      }),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(401);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "management_session.required" },
      });
    }
  });

  it("refuses both routes for a STAFF-role session with 403 (the authorizeManager gate — differential)", async () => {
    await setupTenant();
    const app = mountApp();
    // A staff person can log in but holds no `layout.configure`.
    const cookie = await login(app, STAFF_EMAIL);
    const json = { "content-type": "application/json" };

    // GET authorizes at the route; PUT authorizes in putReceipt. Both refuse this session.
    const cases = [
      app.request("/management-api/receipt", { headers: { cookie } }),
      app.request("/management-api/receipt", {
        method: "PUT",
        headers: { ...json, cookie },
        body: JSON.stringify({ receipt: { footerMessage: "Gracias" } }),
      }),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(403);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "authorization.not_permitted" },
      });
    }
  });

  it("GET /management-api/receipt returns DEFAULT_RECEIPT for a tenant that has never authored one", async () => {
    await setupTenant();
    const app = mountApp();
    const cookie = await login(app, MANAGER_EMAIL);

    // A fresh venue has no `tenant_receipts` row, so the built-in default comes back.
    const body = await getReceiptOverHttp(app, cookie);
    expect(body).toEqual({ receipt: DEFAULT_RECEIPT });
  });

  it("manager PUT /management-api/receipt → 204, then GET /management-api/receipt reads it back (round-trip)", async () => {
    await setupTenant();
    const app = mountApp();
    const cookie = await login(app, MANAGER_EMAIL);
    const receipt = { footerMessage: "Gracias por su visita" };

    const put = await app.request("/management-api/receipt", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ receipt }),
    });
    expect(put.status).toBe(204);
    expect(await put.text()).toBe("");

    expect(await getReceiptOverHttp(app, cookie)).toEqual({ receipt });
  });

  it("PUT /management-api/receipt with an unknown field → 400 receipt.invalid", async () => {
    await setupTenant();
    const app = mountApp();
    const cookie = await login(app, MANAGER_EMAIL);

    const res = await app.request("/management-api/receipt", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ receipt: { bogus: "x" } }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "receipt.invalid" },
    });
  });

  it("PUT with a body that is not an object / omits the required key → 400 management.request_invalid", async () => {
    await setupTenant();
    const app = mountApp();
    const cookie = await login(app, MANAGER_EMAIL);
    const json = { "content-type": "application/json" };

    // An object without the `receipt` key, and a JSON `null` read as `{}`.
    const receiptEmpty = await app.request("/management-api/receipt", {
      method: "PUT",
      headers: { ...json, cookie },
      body: JSON.stringify({}),
    });
    expect(receiptEmpty.status).toBe(400);
    expect(
      (await receiptEmpty.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "receipt" } },
    });

    const receiptNull = await app.request("/management-api/receipt", {
      method: "PUT",
      headers: { ...json, cookie },
      body: "null",
    });
    expect(receiptNull.status).toBe(400);
    expect((await receiptNull.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });
});

describe("Management API — Google sign-in edges, credential checks and staff lifecycle", () => {
  const GOOGLE_OIDC = {
    clientId: "client.apps.googleusercontent.com",
    clientSecret: "secret",
    redirectUri: "http://localhost/management-api/google/callback",
  };

  function mountWith(extra: Partial<ManagementApiDeps>, log: Logger = noopLog): Hono {
    const app = new Hono();
    mountManagementApi(
      app,
      {
        db: suite.db,
        cfg: { nodeId: "00000000-0000-0000-0000-000000000000" },
        secureCookies: false,
        rpId: "localhost",
        origin: "http://localhost",
        accountActionCodeKey: ACCOUNT_ACTION_CODE_KEY,
        ...extra,
      },
      log,
    );
    return app;
  }

  const json = { "content-type": "application/json" };

  it("reports whether Google sign-in is configured, with the privacy notice address", async () => {
    const off = await mountWith({}).request("/management-api/google/config");
    expect(await off.json()).toEqual({ configured: false });
    const on = await mountWith({
      googleOidc: GOOGLE_OIDC,
      privacyNoticeUrl: "https://example.test/privacy",
    }).request("/management-api/google/config");
    expect(await on.json()).toEqual({
      configured: true,
      privacyNoticeUrl: "https://example.test/privacy",
    });
  });

  it("refuses every Google route with google.invalid when Google is not configured", async () => {
    await setupTenant();
    const exchange = vi.fn<typeof exchangeGoogleCode>();
    const app = mountWith({ googleCodeExchange: exchange });
    const cookie = await login(app, MANAGER_EMAIL);
    // A live ceremony left over from when Google was configured: the callback must not spend it.
    const state = "state-from-an-earlier-configuration";
    const stateHash = createHash("sha256").update(state, "utf8").digest("hex");
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    await suite.db.execute(sql`
      insert into google_oidc_states (id, person_id, mode, state_hash, nonce, verifier, expires_at)
      values (${randomUUID()}, null, 'login', ${stateHash}, 'nonce', 'verifier', ${expiresAt})`);
    const responses = [
      await app.request("/management-api/google/login", { method: "POST" }),
      await app.request("/management-api/session/me/google", {
        method: "POST",
        headers: { ...json, cookie },
        body: JSON.stringify({ currentPassword: PASSWORD }),
      }),
      await app.request(`/management-api/google/callback?state=${state}&code=c`, {
        headers: { cookie: `waitron_google_flow=${state}` },
      }),
    ];
    for (const res of responses) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { code: "google.invalid", params: {} } });
    }
    expect(exchange).not.toHaveBeenCalled();
    const states = await suite.db.execute<{ state_hash: string }>(
      sql`select state_hash from google_oidc_states`,
    );
    expect(states.rows).toEqual([{ state_hash: stateHash }]);
  });

  it("refuses a Google callback missing its state or its code without spending the ceremony", async () => {
    await setupTenant();
    const exchange = vi
      .fn<typeof exchangeGoogleCode>()
      .mockResolvedValue({ subject: "google-subject-unlinked" });
    const app = mountApp(undefined, undefined, { exchange });
    const started = await app.request("/management-api/google/login", { method: "POST" });
    const flowCookie = started.headers.get("set-cookie")!.split(";")[0]!;
    const state = encodeURIComponent(
      new URL(
        ((await started.json()) as { authorizationUrl: string }).authorizationUrl,
      ).searchParams.get("state")!,
    );
    for (const query of ["code=c", `state=${state}`, "state=&code=c", `state=${state}&code=`]) {
      const res = await app.request(`/management-api/google/callback?${query}`, {
        headers: { cookie: flowCookie },
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { code: "google.invalid", params: {} } });
    }
    expect(exchange).not.toHaveBeenCalled();
    // The state was never claimed, so the same ceremony still reaches the code exchange.
    await app.request(`/management-api/google/callback?state=${state}&code=c`, {
      headers: { cookie: flowCookie },
    });
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it("refuses a Google callback whose code exchange fails, and signs nobody in", async () => {
    await setupTenant();
    const exchange = vi
      .fn<typeof exchangeGoogleCode>()
      .mockRejectedValue(new Error("token endpoint unreachable"));
    const app = mountApp(undefined, undefined, { exchange });
    const started = await app.request("/management-api/google/login", { method: "POST" });
    const url = new URL(((await started.json()) as { authorizationUrl: string }).authorizationUrl);
    const callback = await app.request(
      `/management-api/google/callback?state=${encodeURIComponent(url.searchParams.get("state")!)}&code=code`,
      { headers: { cookie: started.headers.get("set-cookie")!.split(";")[0]! } },
    );
    expect(callback.status).toBe(401);
    expect(await callback.json()).toEqual({ error: { code: "google.invalid", params: {} } });
    expect(callback.headers.get("set-cookie") ?? "").not.toContain("waitron_management_session=");
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it("refuses a link ceremony whose stored state names no person, linking nobody", async () => {
    await setupTenant();
    const exchange = vi
      .fn<typeof exchangeGoogleCode>()
      .mockResolvedValue({ subject: "google-subject-orphan" });
    const app = mountApp(undefined, undefined, { exchange });
    const cookie = await login(app, MANAGER_EMAIL);
    const startLink = await app.request("/management-api/session/me/google", {
      method: "POST",
      headers: { cookie, ...json },
      body: JSON.stringify({ currentPassword: PASSWORD, totp: "000000" }),
    });
    expect(startLink.status).toBe(200);
    await suite.db.execute(sql`update google_oidc_states set person_id = null`);
    const url = new URL(
      ((await startLink.json()) as { authorizationUrl: string }).authorizationUrl,
    );
    const callback = await app.request(
      `/management-api/google/callback?state=${encodeURIComponent(url.searchParams.get("state")!)}&code=link-code`,
      { headers: { cookie: startLink.headers.get("set-cookie")!.split(";")[0]! } },
    );
    expect(callback.status).toBe(401);
    expect(await callback.json()).toEqual({ error: { code: "google.invalid", params: {} } });
    const linked = await suite.db.execute<{ count: number }>(
      sql`select count(*) as count from persons where google_subject is not null`,
    );
    expect(linked.rows[0]!.count).toBe(0);
  });

  it("throttles repeated wrong current passwords on a credential change", async () => {
    await setupTenant();
    const app = mountApp(undefined, undefined, { exchange: vi.fn<typeof exchangeGoogleCode>() });
    const cookie = await login(app, MANAGER_EMAIL);
    const startLink = (currentPassword: unknown) =>
      app.request("/management-api/session/me/google", {
        method: "POST",
        headers: { cookie, ...json },
        body: JSON.stringify({ currentPassword }),
      });
    for (let i = 0; i < 4; i++) {
      const wrong = await startLink("not the password");
      expect(wrong.status).toBe(401);
      expect(await wrong.json()).toEqual({ error: { code: "password.invalid", params: {} } });
    }
    const blocked = await startLink(PASSWORD);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ error: { code: "password.throttled" } });
  });

  it("refuses a Google link whose current password is missing or not text as password.invalid", async () => {
    await setupTenant();
    const app = mountApp(undefined, undefined, { exchange: vi.fn<typeof exchangeGoogleCode>() });
    const cookie = await login(app, MANAGER_EMAIL);
    for (const body of [{}, { currentPassword: 12345 }]) {
      const res = await app.request("/management-api/session/me/google", {
        method: "POST",
        headers: { cookie, ...json },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { code: "password.invalid", params: {} } });
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  it("does not count a credential change that failed for another reason towards the throttle", async () => {
    await setupTenant();
    const app = mountApp(undefined, undefined, { exchange: vi.fn<typeof exchangeGoogleCode>() });
    const cookie = await login(app, MANAGER_EMAIL);
    const startLink = () =>
      app.request("/management-api/session/me/google", {
        method: "POST",
        headers: { cookie, ...json },
        body: JSON.stringify({ currentPassword: PASSWORD }),
      });
    await suite.db.execute(sql`alter table google_oidc_states rename to google_oidc_states_away`);
    try {
      for (let i = 0; i < 5; i++) expect((await startLink()).status).toBe(500);
    } finally {
      await suite.db.execute(sql`alter table google_oidc_states_away rename to google_oidc_states`);
    }
    expect((await startLink()).status).toBe(200);
  });

  it("refuses a login whose recovery code is not a string as password.invalid, with no cookie", async () => {
    await setupTenant();
    const app = mountApp();
    const res = await app.request("/management-api/session", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email: MANAGER_EMAIL, password: PASSWORD, recoveryCode: 12345678 }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "password.invalid", params: {} } });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("acknowledges a password reset with no usable email and sends nothing", async () => {
    await setupTenant();
    const sent: Parameters<AccountEmailSender>[0][] = [];
    const app = mountApp(async (message) => {
      sent.push(message);
    });
    for (const body of [{}, { email: 42 }]) {
      const res = await app.request("/management-api/password-reset", {
        method: "POST",
        headers: json,
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(202);
    }
    expect(sent).toEqual([]);
  });

  it("inspects a password-reset token, and refuses an unknown purpose", async () => {
    await setupTenant();
    const sent: Parameters<AccountEmailSender>[0][] = [];
    const app = mountApp(async (message) => {
      sent.push(message);
    });
    await app.request("/management-api/password-reset", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email: STAFF_EMAIL }),
    });
    const token = new URL(sent[0]!.actionUrl).searchParams.get("token")!;
    const inspect = (purpose: string) =>
      app.request("/management-api/account-actions/inspect", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ token, purpose }),
      });
    const good = await inspect("password_reset");
    expect(good.status).toBe(200);
    expect(await good.json()).toEqual({ email: STAFF_EMAIL, purpose: "password_reset" });
    const bogus = await inspect("promotion");
    expect(bogus.status).toBe(400);
    expect(await bogus.json()).toEqual({ error: { code: "account_action.invalid", params: {} } });
  });

  it("refuses an invitation whose telephone is neither text nor null, creating nobody", async () => {
    await setupTenant();
    const app = mountApp();
    const cookie = await login(app, MANAGER_EMAIL);
    const res = await app.request("/management-api/staff", {
      method: "POST",
      headers: { ...json, cookie },
      body: JSON.stringify(invitationBody("Phoneless", "phoneless@x.com", { telephone: 600 })),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "management.request_invalid",
        params: { field: "displayName|firstNames|lastNames|role|telephone" },
      },
    });
    expect(await countPersonsNamed("Phoneless")).toBe(0);
  });

  it("reports an invitation as not sent, and logs it, when the mailer fails", async () => {
    await setupTenant();
    const log = vi.fn<Logger>();
    const app = mountWith(
      {
        sendAccountEmail: async () => {
          throw new Error("smtp://user:secret@mail.example refused");
        },
      },
      log,
    );
    const cookie = await login(app, MANAGER_EMAIL);
    const res = await app.request("/management-api/staff", {
      method: "POST",
      headers: { ...json, cookie },
      body: JSON.stringify(invitationBody("Unmailed", "unmailed@x.com")),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; invitationSent: boolean };
    expect(created.invitationSent).toBe(false);
    expect(await countPersonsNamed("Unmailed")).toBe(1);
    expect(log).toHaveBeenCalledWith("error", "account_email.send_failed", {
      purpose: "invitation",
      personId: created.id,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });

  it("does not resend an invitation twice within the cooldown", async () => {
    await setupTenant();
    const sent: Parameters<AccountEmailSender>[0][] = [];
    const app = mountApp(async (message) => {
      sent.push(message);
    });
    const cookie = await login(app, MANAGER_EMAIL);
    const created = await app.request("/management-api/staff", {
      method: "POST",
      headers: { ...json, cookie },
      body: JSON.stringify(invitationBody("Resent", "resent@x.com")),
    });
    const { id } = (await created.json()) as { id: string };
    const resend = () =>
      app.request(`/management-api/staff/${id}/invitation`, {
        method: "POST",
        headers: { cookie },
      });
    expect(await (await resend()).json()).toEqual({ invitationSent: true });
    expect(await (await resend()).json()).toEqual({ invitationSent: false });
    expect(sent).toHaveLength(2);
  });

  it("refuses an administrative edit with a non-text field or telephone, changing nothing", async () => {
    const { staffId } = await setupTenant();
    const app = mountApp();
    const cookie = await login(app, MANAGER_EMAIL);
    const details = {
      displayName: "Grace",
      firstNames: "Grace Brewster",
      lastNames: "Hopper",
      telephone: null,
      email: "grace@example.com",
      role: "supervisor",
      status: "active",
    };
    for (const [override, field] of [
      [{ lastNames: 7 }, "lastNames"],
      [{ email: null }, "email"],
      [{ telephone: 600 }, "telephone"],
    ] as const) {
      const res = await app.request(`/management-api/staff/${staffId}`, {
        method: "PUT",
        headers: { ...json, cookie },
        body: JSON.stringify({ ...details, ...override }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: { code: "management.request_invalid", params: { field } },
      });
    }
    expect(await countPersonsNamed("Grace")).toBe(0);
    expect(await countPersonsNamed("The Clerk")).toBe(1);
  });

  it("deactivates a person, then reactivates them as pending with one fresh invitation", async () => {
    const { staffId } = await setupTenant();
    const sent: Parameters<AccountEmailSender>[0][] = [];
    const app = mountApp(async (message) => {
      sent.push(message);
    });
    const cookie = await login(app, MANAGER_EMAIL);
    const status = async () =>
      (
        await suite.db.execute<{ status: string }>(
          sql`select status from persons where id = ${staffId}`,
        )
      ).rows[0]!.status;

    const deactivated = await app.request(`/management-api/staff/${staffId}/deactivate`, {
      method: "POST",
      headers: { cookie },
    });
    expect(deactivated.status).toBe(204);
    expect(await status()).toBe("suspended");

    const reactivate = () =>
      app.request(`/management-api/staff/${staffId}/reactivate`, {
        method: "POST",
        headers: { cookie },
      });
    const first = await reactivate();
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ invitationSent: true });
    expect(await status()).toBe("pending");
    expect(sent.map((m) => [m.purpose, m.email])).toEqual([["invitation", STAFF_EMAIL]]);

    const repeated = await reactivate();
    expect(await repeated.json()).toEqual({ invitationSent: false });
    expect(sent).toHaveLength(1);
  });

  it("refuses deactivation and reactivation to a staff session and for a malformed id", async () => {
    const { managerId } = await setupTenant();
    const app = mountApp();
    const staffCookie = await login(app, STAFF_EMAIL);
    const managerCookie = await login(app, MANAGER_EMAIL);
    for (const action of ["deactivate", "reactivate"]) {
      const forbidden = await app.request(`/management-api/staff/${managerId}/${action}`, {
        method: "POST",
        headers: { cookie: staffCookie },
      });
      expect(forbidden.status).toBe(403);
      expect(await forbidden.json()).toMatchObject({
        error: { code: "authorization.not_permitted" },
      });
      const malformed = await app.request(`/management-api/staff/not-a-uuid/${action}`, {
        method: "POST",
        headers: { cookie: managerCookie },
      });
      expect(malformed.status).toBe(404);
      expect(await malformed.json()).toMatchObject({ error: { code: "person.not_found" } });
    }
  });
});
