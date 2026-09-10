import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { encryptTotpSecret, hashPassword, hashPin } from "@waitron/identity";
import { DEFAULT_RECEIPT } from "@waitron/layouts";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import type { AccountEmailSender } from "./account-email.js";
import { mountManagementApi } from "./management-api.js";
import { ALL_MODULES } from "./modules.js";
import { createPasswordThrottle, type PasswordThrottle } from "./password-throttle.js";

// Real Postgres, not PGlite: these routes are the dashboard's management surface, and everything they
// do runs `withTenant` + `asAppUser`, so every read and write is subject to app_user's grants.
// PGlite connects as a superuser holding every privilege (CLAUDE.md §4), so it cannot show that the
// created person actually lands as the app role — the whole point of this file. The
// login path (`loginManager`) also needs a migrated DB (persons + management_sessions), which only the
// container provides. No probe role is needed here (unlike `till-api.pg.test.ts`): the management API
// wires no card provider, so every DB op goes through `withTenant` + `asAppUser` from `suite.admin`.
const LOCALE = "es-ES";
const PASSWORD = "correct horse"; // ≥ MIN_PASSWORD_LENGTH; the manager's & staff's seeded password.
// Dashboard sign-in resolves the person by EMAIL (not a client-supplied id), so each seeded person
// carries a login email. Uniqueness is per-tenant (persons_tenant_email_uq), so the same constants
// serve every tenant these tests provision.
const MANAGER_EMAIL = "manager@x.com";
const STAFF_EMAIL = "clerk@x.com";
const ACCOUNT_ACTION_CODE_KEY = Buffer.alloc(32, 21);

const suite = useTemplateDb({ template: "manifest" });

/** A no-op logger: only the HTTP responses and the database state matter here. */
const noopLog: Logger = () => {};

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the same per-suite counter `till-api.pg.test.ts` uses.
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

/** Provision a venue as owner and seed the people and sessions this route fixture needs. */
async function setupTenant(): Promise<{ tenantId: string; managerId: string; staffId: string }> {
  const venue = await applyVenue(
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
    { db: suite.admin, modules: ALL_MODULES },
  );

  const { managerId, staffId } = await withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    const manager = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, email, pin_hash, password_hash, role)
      values (${venue.tenantId}, 'The Manager', ${MANAGER_EMAIL}, ${hashPin("1234")}, ${hashPassword(PASSWORD)}, 'manager')
      returning id`);
    const staff = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, email, pin_hash, password_hash, role)
      values (${venue.tenantId}, 'The Clerk', ${STAFF_EMAIL}, ${hashPin("1234")}, ${hashPassword(PASSWORD)}, 'staff')
      returning id`);
    return { managerId: manager.rows[0]!.id, staffId: staff.rows[0]!.id };
  });
  return { tenantId: venue.tenantId, managerId, staffId };
}

function mountApp(
  tenantId: string,
  sendAccountEmail?: AccountEmailSender,
  passwordThrottle?: PasswordThrottle,
  google?: {
    exchange: ReturnType<typeof vi.fn>;
  },
): Hono {
  const app = new Hono();
  // `secureCookies: false` so the session cookie rides the non-TLS `app.request` (mirrors
  // `till-api.pg.test.ts`'s `apiDeps`). `deps.db` is the owner connection; the routes drop to
  // `app_user` themselves via `withTenant` + `asAppUser`. `rpId`/`origin` are the loopback passkey
  // Relying Party values (these suites exercise the staff routes, not the passkey ceremonies — those
  // are covered in Task 5 — but the widened `ManagementApiDeps` requires both).
  mountManagementApi(
    app,
    {
      db: suite.admin,
      // These cases do not assert sync attribution, so use the default all-zero origin.
      cfg: { tenantId, nodeId: "00000000-0000-0000-0000-000000000000" },
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

/** Log in over HTTP by `email` with `password`, returning just the `waitron_management_session=…`
 * cookie pair (the part a browser echoes back). Asserts the 200 so a caller never carries a stale
 * or absent cookie forward silently. */
async function login(app: Hono, email: string, password = PASSWORD): Promise<string> {
  const res = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

/** Count the tenant's persons named `displayName`, read back as the app role — the proof a
 * genuine tenant-scoped row landed, not merely that a route returned a success status. */
async function countPersonsNamed(tenantId: string, displayName: string): Promise<number> {
  const rows = await withTenant(suite.admin, tenantId, async (tx) => {
    await asAppUser(tx);
    const r = await tx.execute<{ display_name: string }>(
      sql`select display_name from persons where display_name = ${displayName}`,
    );
    return r.rows;
  });
  return rows.length;
}

describe("Management API staff + session routes over real Postgres", () => {
  it("lets only one concurrent invitation claim a live display name", async () => {
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);
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
    const matching = await suite.admin.execute<{ count: number }>(sql`
      select count(*)::int as count from persons
      where tenant_id=${tenantId} and lower(display_name)='same till name'`);
    expect(matching.rows[0]!.count).toBe(1);
  });

  it("preserves one active admin when two admins concurrently demote themselves", async () => {
    const { tenantId, managerId } = await setupTenant();
    await suite.admin.execute(sql`update persons set role='admin' where id=${managerId}`);
    const app = mountApp(tenantId);
    const ownerCookie = await login(app, "owner@example.test", "dashPass123");
    const managerCookie = await login(app, MANAGER_EMAIL);
    const owner = await suite.admin.execute<{ id: string }>(
      sql`select id from persons where tenant_id=${tenantId} and email='owner@example.test'`,
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
    const remaining = await suite.admin.execute<{ count: number }>(sql`
      select count(*)::int as count from persons
      where tenant_id=${tenantId} and role='admin' and status='active'`);
    expect(remaining.rows[0]!.count).toBe(1);
  });
  it("links and then signs in with a configured Google account", async () => {
    const { tenantId } = await setupTenant();
    const exchange = vi.fn().mockResolvedValue({ subject: "google-subject-1" });
    const app = mountApp(tenantId, undefined, undefined, {
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
    expect(signedIn.headers.get("set-cookie")).toContain("waitron_management_session=");
    expect(exchange).toHaveBeenCalledTimes(2);
    expect(exchange.mock.calls[0]![1]).toMatchObject({
      code: "link-code",
      nonce: expect.any(String),
      verifier: expect.any(String),
    });
  });

  it("refuses a Google callback that did not start in the same browser", async () => {
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId, undefined, undefined, {
      exchange: vi.fn().mockResolvedValue({ subject: "google-subject" }),
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
    const { tenantId } = await setupTenant();
    let now = 0;
    const app = mountApp(
      tenantId,
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
    const { tenantId } = await setupTenant();
    await withTenant(suite.admin, tenantId, async (tx) => {
      await asAppUser(tx);
      await tx.execute(sql`
        insert into persons (tenant_id, display_name, email, pin_hash, password_hash, role, totp_secret)
        values (${tenantId}, 'Factor Manager', 'factor@example.com', ${hashPin("1234")},
          ${hashPassword(PASSWORD)}, 'manager',
          ${encryptTotpSecret("JBSWY3DPEHPK3PXP", { version: 1, key: ACCOUNT_ACTION_CODE_KEY })})
      `);
    });
    const finish = vi.fn();
    const app = mountApp(tenantId, undefined, { begin: vi.fn(() => finish) });
    const response = await app.request("/management-api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "factor@example.com", password: PASSWORD }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "totp.required", params: {} } });
    expect(finish).toHaveBeenCalledWith("error");
  });
  // ── The four required core assertions (task-6 brief) ───────────────────────────────────────────

  it("login → list → create → verify persistence", async () => {
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);

    // Log in through the HTTP surface and capture the session cookie the route sets.
    const loginRes = await app.request("/management-api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: MANAGER_EMAIL, password: PASSWORD }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie")!.split(";")[0];
    expect(cookie).toMatch(/^waitron_management_session=/);

    // The gated admin roster lists the manager we logged in as.
    const listed = await app.request("/management-api/staff", { headers: { cookie } });
    expect(listed.status).toBe(200);
    const people = (await listed.json()) as { displayName: string }[];
    expect(people.some((p) => p.displayName === "The Manager")).toBe(true);

    // Create a new staff member over the gated route.
    const created = await app.request("/management-api/staff", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(invitationBody("Ada", "ada@x.com")),
    });
    expect(created.status).toBe(201);
    expect((await created.json()) as { id: string }).toHaveProperty("id");

    // Re-read as the app role: exactly one 'Ada' row landed under this tenant through the route — proving a
    // genuine tenant-scoped write, not just a 201.
    expect(await countPersonsNamed(tenantId, "Ada")).toBe(1);
  });

  it("rejects an unauthenticated staff list with 401", async () => {
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);

    const res = await app.request("/management-api/staff");
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management_session.required" },
    });
  });

  it("rejects a wrong password with 401 and sets no cookie", async () => {
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);

    const res = await app.request("/management-api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: MANAGER_EMAIL, password: "wrong password" }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "password.invalid" },
    });
    // No session was minted, so the failed login must not have set a cookie.
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("refuses staff-role creation with 403", async () => {
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);

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
    // The refusal was before any write: nobody named 'Nope' landed.
    expect(await countPersonsNamed(tenantId, "Nope")).toBe(0);
  });

  // ── Additional coverage: the remaining routes + guard branches ─────────────────────────────────

  it("logs out — ends the session, clears the cookie, and a reused cookie is refused", async () => {
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, MANAGER_EMAIL);

    // The cookie works before logout.
    expect((await app.request("/management-api/staff", { headers: { cookie } })).status).toBe(200);

    const out = await app.request("/management-api/session", {
      method: "DELETE",
      headers: { cookie },
    });
    expect(out.status).toBe(204);
    // The cookie is cleared (expired) by the response.
    expect(out.headers.get("set-cookie")).toMatch(/waitron_management_session=;/);

    // The now-ended session is refused — resolveManagementSession no longer finds a live row.
    const after = await app.request("/management-api/staff", { headers: { cookie } });
    expect(after.status).toBe(401);
  });

  it("logout with no cookie is idempotent (204)", async () => {
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);

    const res = await app.request("/management-api/session", { method: "DELETE" });
    expect(res.status).toBe(204);
  });

  it("serves the unauthenticated pre-login roster", async () => {
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);

    const res = await app.request("/management-api/staff-roster");
    expect(res.status).toBe(200);
    const roster = (await res.json()) as { personId: string; displayName: string }[];
    // The seeded active persons are present; the payload carries only id + name (no role/secrets).
    expect(roster.map((r) => r.displayName)).toEqual(
      expect.arrayContaining(["The Manager", "The Clerk"]),
    );
    for (const entry of roster) {
      expect(Object.keys(entry).sort()).toEqual(["displayName", "personId"]);
    }
  });

  it("requires an email when creating a person", async () => {
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);
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
    expect(await countPersonsNamed(tenantId, "No email")).toBe(0);
  });

  it("emails a single-use setup link after creating a person", async () => {
    const sent: Parameters<AccountEmailSender>[0][] = [];
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId, async (message) => {
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
    const { tenantId, staffId } = await setupTenant();
    const app = mountApp(tenantId, async (message) => {
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

  it("inspects an invitation without consuming it and resends only for a pending account", async () => {
    const sent: Parameters<AccountEmailSender>[0][] = [];
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId, async (message) => {
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

    const unknown = await app.request("/management-api/invitation-resend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "unknown@x.com" }),
    });
    const active = await app.request("/management-api/invitation-resend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: MANAGER_EMAIL }),
    });
    expect([unknown.status, active.status]).toEqual([202, 202]);
    expect(sent).toHaveLength(1);

    const secondCreated = await app.request("/management-api/staff", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(invitationBody("Pending Again", "pending-resend@x.com")),
    });
    expect(secondCreated.status).toBe(201);
    const resent = await app.request("/management-api/invitation-resend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "  PENDING-RESEND@X.COM  " }),
    });
    expect(resent.status).toBe(202);
    await vi.waitFor(() => expect(sent).toHaveLength(3));
    expect(sent[2]!.email).toBe("pending-resend@x.com");
  });

  it("creates a person with an email and lists it back", async () => {
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, MANAGER_EMAIL);

    const created = await app.request("/management-api/staff", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(invitationBody("Owner", "owner@x.com", { role: "manager" })),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    // The gated admin roster carries the login email straight through `listPersons`'s projection.
    const listed = await app.request("/management-api/staff", { headers: { cookie } });
    const people = (await listed.json()) as { personId: string; email: string | null }[];
    expect(people.find((p) => p.personId === id)?.email).toBe("owner@x.com");
  });

  it("PUT saves a complete administrative edit atomically", async () => {
    const { tenantId, staffId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, MANAGER_EMAIL);
    const details = {
      displayName: "Grace",
      firstNames: "Grace Brewster",
      lastNames: "Hopper",
      telephone: "+1 222",
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
    // The seeded manager already holds MANAGER_EMAIL, so a second person in the SAME tenant claiming
    // it collides on `persons_tenant_email_uq` → `person.email_taken` (409), before the row lands.
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);
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
    expect(await countPersonsNamed(tenantId, "Dup")).toBe(0);
  });

  it("create with a malformed email → 400 person.email_invalid, no row lands", async () => {
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);
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
    expect(await countPersonsNamed(tenantId, "Bad")).toBe(0);
  });

  it("create with a non-string email → 400 management.request_invalid (field email)", async () => {
    // A PRESENT-but-non-string email is refused by the route's typeof screen naming the FIELD (never
    // the value), the same shape as the sibling create/PATCH field screens — it never reaches identity.
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);
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
    expect(await countPersonsNamed(tenantId, "Nope")).toBe(0);
  });

  it("resets a PIN without allowing the administrator to choose its replacement", async () => {
    const { tenantId, staffId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, MANAGER_EMAIL);

    const resetPin = await app.request(`/management-api/staff/${staffId}/reset-pin`, {
      method: "POST",
      headers: { cookie },
    });
    expect(resetPin.status).toBe(204);
    const row = await suite.admin.execute<{ pin_hash: string | null }>(
      sql`select pin_hash from persons where tenant_id = ${tenantId} and id = ${staffId}`,
    );
    expect(row.rows[0]!.pin_hash).toBeNull();
  });

  it("reset login clears credentials, moves the user to Pending, and sends a new invitation", async () => {
    const sent: Parameters<AccountEmailSender>[0][] = [];
    const { tenantId, staffId } = await setupTenant();
    const app = mountApp(tenantId, async (message) => {
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
    const row = await suite.admin.execute<{
      status: string;
      pin_hash: string | null;
      password_hash: string | null;
    }>(sql`select status, pin_hash, password_hash from persons
           where tenant_id = ${tenantId} and id = ${staffId}`);
    expect(row.rows[0]).toEqual({ status: "pending", pin_hash: null, password_hash: null });
    const repeated = await app.request(`/management-api/staff/${staffId}/reset-login`, {
      method: "POST",
      headers: { cookie },
    });
    expect(await repeated.json()).toEqual({ invitationSent: false });
    expect(sent).toHaveLength(1);
  });

  it("screens malformed bodies and ids on the gated write routes", async () => {
    const { tenantId, staffId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, MANAGER_EMAIL);

    // POST /staff missing fields → management.request_invalid (400).
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

    // Non-UUID id on the credential routes → person.not_found (404), screened before any DB work.
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
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);

    // An email that resolves to no person is indistinguishable from a wrong password — both throw
    // `password.invalid`, so nothing in the response reveals whether the address has an account.
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

  // ── null / non-object request bodies map to the route's own 4xx, never a 500 ────────────────────
  // A body of the literal JSON `null` parses (via `c.req.json()`) to `null`, on which a field access
  // or destructure throws a TypeError → `run`'s non-AppError branch → opaque `server.internal` 500.
  // Each route coerces the parsed body with `?? {}` so a degenerate body yields its documented 4xx
  // (or, for PATCH, the empty-body 204) instead. `body: "null"` is 4 bytes of valid JSON — confirmed
  // against Hono here that `c.req.json()` returns `null` for it, the exact shape these guards defend.

  it("login with a null JSON body → 401 password.invalid, no cookie", async () => {
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);

    const res = await app.request("/management-api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    });
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "password.invalid" },
    });
    // A rejected login must mint nothing, so no cookie is set.
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("login with a non-string totp → 401 password.invalid (screened before loginManager)", async () => {
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);

    // The seeded manager has a correct password and is NOT TOTP-enrolled, so `loginManager` would
    // otherwise ignore `totp` entirely and mint a session (200). This proves the new typecheck
    // rejects a non-string `totp` at the API boundary — as `password.invalid`, leaking no field —
    // before it can reach `loginManager`/`verifyTotp`.
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
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);
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
    const { tenantId, staffId } = await setupTenant();
    const app = mountApp(tenantId);
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
    const { tenantId, staffId } = await setupTenant();
    const app = mountApp(tenantId);

    // `c.req.json()` throws a SyntaxError on a malformed body; the shared `readJsonBody` coerces that
    // throw to `{}`, exactly as a literal JSON `null` body is coerced, so each route answers its own
    // documented 4xx (or the PATCH no-op 204) rather than an opaque `server.internal` 500. This is the
    // same three cases as the `null JSON body` tests above, with a malformed body in place of `"null"`.
    const malformedHeaders = { "content-type": "application/json" };

    // Login is unauthenticated → the same `password.invalid` 401 a `{}`/null body yields, and no cookie.
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

    // An authenticated write route → the field-screen 400.
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

// Exercise receipt configuration GET and PUT through PostgreSQL-backed manager authorization.

/** GET the current receipt trim as `cookie` (its own `tenant_receipts`-backed route, SP-B4), asserting
 * the 200 and returning the parsed `{ receipt }` a round-trip test reads back after a PUT. */
async function getReceiptOverHttp(app: Hono, cookie: string): Promise<{ receipt: unknown }> {
  const res = await app.request("/management-api/receipt", { headers: { cookie } });
  expect(res.status).toBe(200);
  return (await res.json()) as { receipt: unknown };
}

describe("Management API — receipt routes (Task 7)", () => {
  it("refuses both routes unauthenticated with 401 management_session.required", async () => {
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);
    const json = { "content-type": "application/json" };

    // requireManagementSession runs FIRST on each route, so an unauthenticated request is refused
    // before any DB work — the same 401 the gated staff routes give.
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
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);
    // A staff person CAN log in (login checks the credential, not the role) but holds no
    // `till.configure`, so each route is refused 403 before any read/write.
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
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, MANAGER_EMAIL);

    // A fresh tenant has no `tenant_receipts` row — getReceipt returns DEFAULT_RECEIPT (`{}`), the
    // built-in trim the till boots against, rather than seeding one (no backfill, SP-B4).
    const body = await getReceiptOverHttp(app, cookie);
    expect(body).toEqual({ receipt: DEFAULT_RECEIPT });
  });

  it("manager PUT /management-api/receipt → 204, then GET /management-api/receipt reads it back (round-trip)", async () => {
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, MANAGER_EMAIL);
    const receipt = { footerMessage: "Gracias por su visita" };

    const put = await app.request("/management-api/receipt", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ receipt }),
    });
    expect(put.status).toBe(204);
    expect(await put.text()).toBe("");

    // The receipt reads back verbatim from its own `tenant_receipts` route (SP-B4).
    expect(await getReceiptOverHttp(app, cookie)).toEqual({ receipt });
  });

  it("PUT /management-api/receipt with an unknown field → 400 receipt.invalid", async () => {
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, MANAGER_EMAIL);

    // An unknown receipt field is rejected fail-closed (design D8) as `receipt.invalid`, 400.
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
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, MANAGER_EMAIL);
    const json = { "content-type": "application/json" };

    // Each degenerate body is refused as `management.request_invalid` naming the FIELD, before the
    // service is called: an object without the required key, and a JSON `null` (coerced to `{}` so it
    // hits the same guard rather than TypeError-ing → 500).
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
