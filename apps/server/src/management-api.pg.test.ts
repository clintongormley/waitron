import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { DEFAULT_RECEIPT } from "@waitron/layouts";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { mountManagementApi } from "./management-api.js";
import { ALL_MODULES } from "./modules.js";

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

function mountApp(tenantId: string): Hono {
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
      body: JSON.stringify({ displayName: "Ada", role: "staff", pin: "4321" }),
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
      body: JSON.stringify({ displayName: "Nope", role: "staff", pin: "4321" }),
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

  it("updates a person's role and status via PATCH", async () => {
    const { tenantId, staffId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, MANAGER_EMAIL);

    // Promote the staff person to supervisor and suspend them.
    const patched = await app.request(`/management-api/staff/${staffId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ role: "supervisor", status: "suspended" }),
    });
    expect(patched.status).toBe(204);

    // Re-read as the app role: both fields changed as app_user.
    const row = await withTenant(suite.admin, tenantId, async (tx) => {
      await asAppUser(tx);
      const r = await tx.execute<{ role: string; status: string }>(
        sql`select role, status from persons where id = ${staffId}`,
      );
      return r.rows[0]!;
    });
    expect(row).toMatchObject({ role: "supervisor", status: "suspended" });

    // Reactivate them again (the `status === "active"` branch).
    const reactivated = await app.request(`/management-api/staff/${staffId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ status: "active" }),
    });
    expect(reactivated.status).toBe(204);

    // A non-UUID id names no row: person.not_found (404), not a request-shape error.
    const badId = await app.request("/management-api/staff/not-a-uuid", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ role: "manager" }),
    });
    expect(badId.status).toBe(404);
    expect((await badId.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "person.not_found" },
    });
  });

  it("PATCH with a non-string role → 400 management.request_invalid, person unchanged", async () => {
    const { tenantId, staffId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, MANAGER_EMAIL);

    const readRow = async () =>
      withTenant(suite.admin, tenantId, async (tx) => {
        await asAppUser(tx);
        const r = await tx.execute<{ role: string; status: string }>(
          sql`select role, status from persons where id = ${staffId}`,
        );
        return r.rows[0]!;
      });

    // The typeof screen refuses a PRESENT-but-non-string `role` before any DB work, so it never
    // reaches `setRole` → the `person_role` pgEnum (a `22P02` → opaque 500). The staff person starts
    // at the schema defaults; the row must be untouched.
    const before = await readRow();
    expect(before).toMatchObject({ role: "staff", status: "active" });

    const res = await app.request(`/management-api/staff/${staffId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ role: 123 }),
    });
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "role" } } });
    // No write happened: the role is still 'staff'.
    expect(await readRow()).toEqual(before);
  });

  it("PATCH with a non-string status → 400 management.request_invalid, person unchanged", async () => {
    const { tenantId, staffId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, MANAGER_EMAIL);

    const readRow = async () =>
      withTenant(suite.admin, tenantId, async (tx) => {
        await asAppUser(tx);
        const r = await tx.execute<{ role: string; status: string }>(
          sql`select role, status from persons where id = ${staffId}`,
        );
        return r.rows[0]!;
      });

    // A non-string `status` would otherwise silently no-op (matching neither the suspend nor the
    // reactivate branch); the typeof screen turns it into an explicit 400 naming the field.
    const before = await readRow();
    expect(before).toMatchObject({ role: "staff", status: "active" });

    const res = await app.request(`/management-api/staff/${staffId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ status: 123 }),
    });
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "status" } } });
    expect(await readRow()).toEqual(before);
  });

  // ── Email (dashboard sign-in identifier) on create + edit + listing (Task 6) ────────────────────

  it("creates a person with an email and lists it back", async () => {
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, MANAGER_EMAIL);

    const created = await app.request("/management-api/staff", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        displayName: "Owner",
        role: "manager",
        pin: "1234",
        email: "owner@x.com",
      }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    // The gated admin roster carries the login email straight through `listPersons`'s projection.
    const listed = await app.request("/management-api/staff", { headers: { cookie } });
    const people = (await listed.json()) as { personId: string; email: string | null }[];
    expect(people.find((p) => p.personId === id)?.email).toBe("owner@x.com");
  });

  it("PATCH sets a person's email", async () => {
    const { tenantId, staffId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, MANAGER_EMAIL);

    const res = await app.request(`/management-api/staff/${staffId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ email: "newclerk@x.com" }),
    });
    expect(res.status).toBe(204);

    const listed = await app.request("/management-api/staff", { headers: { cookie } });
    const people = (await listed.json()) as { personId: string; email: string | null }[];
    expect(people.find((p) => p.personId === staffId)?.email).toBe("newclerk@x.com");
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
      body: JSON.stringify({
        displayName: "Dup",
        role: "staff",
        pin: "1234",
        email: MANAGER_EMAIL,
      }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "person.email_taken" },
    });
    expect(await countPersonsNamed(tenantId, "Dup")).toBe(0);
  });

  it("PATCH to a duplicate email → 409 person.email_taken", async () => {
    const { tenantId, staffId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, MANAGER_EMAIL);

    const res = await app.request(`/management-api/staff/${staffId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ email: MANAGER_EMAIL }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "person.email_taken" },
    });
  });

  it("create with a malformed email → 400 person.email_invalid, no row lands", async () => {
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, MANAGER_EMAIL);

    const res = await app.request("/management-api/staff", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        displayName: "Bad",
        role: "staff",
        pin: "1234",
        email: "not-an-email",
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "person.email_invalid" },
    });
    expect(await countPersonsNamed(tenantId, "Bad")).toBe(0);
  });

  it("PATCH with a malformed email → 400 person.email_invalid", async () => {
    const { tenantId, staffId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, MANAGER_EMAIL);

    const res = await app.request(`/management-api/staff/${staffId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ email: "nope" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "person.email_invalid" },
    });
  });

  it("create/PATCH with a non-string email → 400 management.request_invalid (field email)", async () => {
    // A PRESENT-but-non-string email is refused by the route's typeof screen naming the FIELD (never
    // the value), the same shape as the sibling create/PATCH field screens — it never reaches identity.
    const { tenantId, staffId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, MANAGER_EMAIL);

    const badCreate = await app.request("/management-api/staff", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ displayName: "Nope", role: "staff", pin: "1234", email: 123 }),
    });
    expect(badCreate.status).toBe(400);
    expect(
      (await badCreate.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "email" } } });
    expect(await countPersonsNamed(tenantId, "Nope")).toBe(0);

    const badPatch = await app.request(`/management-api/staff/${staffId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ email: 123 }),
    });
    expect(badPatch.status).toBe(400);
    expect(
      (await badPatch.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "email" } } });
  });

  it("resets a PIN and sets a password, then the new password logs in", async () => {
    const { tenantId, staffId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, MANAGER_EMAIL);

    const resetPin = await app.request(`/management-api/staff/${staffId}/reset-pin`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ pin: "9876" }),
    });
    expect(resetPin.status).toBe(204);

    const NEW_PASSWORD = "a different password";
    const setPw = await app.request(`/management-api/staff/${staffId}/password`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ password: NEW_PASSWORD }),
    });
    expect(setPw.status).toBe(204);

    // Prove the password actually landed: the staff person logs in with the NEW password.
    const relogin = await app.request("/management-api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: STAFF_EMAIL, password: NEW_PASSWORD }),
    });
    expect(relogin.status).toBe(200);
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

    // reset-pin with a non-string pin → management.request_invalid (400).
    const badPin = await app.request(`/management-api/staff/${staffId}/reset-pin`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ pin: 9876 }),
    });
    expect(badPin.status).toBe(400);

    // password with a non-string password → management.request_invalid (400).
    const badPw = await app.request(`/management-api/staff/${staffId}/password`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ password: null }),
    });
    expect(badPw.status).toBe(400);

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

  it("reset-pin and password with a null JSON body → 400 each", async () => {
    const { tenantId, staffId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, MANAGER_EMAIL);

    const resetPin = await app.request(`/management-api/staff/${staffId}/reset-pin`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "null",
    });
    expect(resetPin.status).toBe(400);
    expect((await resetPin.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });

    const setPw = await app.request(`/management-api/staff/${staffId}/password`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "null",
    });
    expect(setPw.status).toBe(400);
    expect((await setPw.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("PATCH with a null JSON body → 204 no-op, person unchanged", async () => {
    const { tenantId, staffId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, MANAGER_EMAIL);

    const readRow = async () =>
      withTenant(suite.admin, tenantId, async (tx) => {
        await asAppUser(tx);
        const r = await tx.execute<{ role: string; status: string }>(
          sql`select role, status from persons where id = ${staffId}`,
        );
        return r.rows[0]!;
      });

    // The seeded staff person starts at the schema defaults (role 'staff', status 'active').
    const before = await readRow();
    expect(before).toMatchObject({ role: "staff", status: "active" });

    const res = await app.request(`/management-api/staff/${staffId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: "null",
    });
    // A null body is coerced to `{}`, so both `role` and `status` are undefined: nothing is written
    // and the route answers the empty-body 204 — never a 400 and never a 500.
    expect(res.status).toBe(204);
    expect(await readRow()).toEqual(before);
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

    // A PATCH carries no field to change from a `{}` body → the empty-body 204 no-op.
    const patch = await app.request(`/management-api/staff/${staffId}`, {
      method: "PATCH",
      headers: { ...malformedHeaders, cookie },
      body: "{ not json",
    });
    expect(patch.status).toBe(204);
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
