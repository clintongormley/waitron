import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { DEFAULT_LAYOUT, DEFAULT_RECEIPT } from "@waitron/layouts";
import type { LayoutDef } from "@waitron/layouts";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { mountManagementApi } from "./management-api.js";
import { startRealPostgres } from "./testing/postgres.js";

// Real Postgres, not PGlite: these routes are the dashboard's management surface, and everything they
// do runs `withTenant` + `asAppUser` so RLS scopes each read/write to the dashboard's own tenant.
// PGlite connects as a superuser and bypasses RLS entirely (CLAUDE.md §4), so it cannot prove that the
// created person actually lands under the tenant as the app role — the whole point of this file. The
// login path (`loginManager`) also needs a migrated DB (persons + management_sessions), which only the
// container provides. No probe role is needed here (unlike `till-api.rls.test.ts`): the management API
// wires no card provider, so every DB op goes through `withTenant` + `asAppUser` from `suite.admin`.
const LOCALE = "es-ES";
const PASSWORD = "correct horse"; // ≥ MIN_PASSWORD_LENGTH; the manager's & staff's seeded password.

const suite = useRealPostgres({
  start: startRealPostgres,
  timeoutMs: 180_000,
});

/** A no-op logger: only the HTTP responses and the database state matter here. */
const noopLog: Logger = () => {};

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the same per-suite counter `till-api.rls.test.ts` uses.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(70_000_000 + nifCounter).padStart(8, "0")}K`;
}

/**
 * Stand up a fresh provisioned venue (as the owner), then seed — as the app role under the tenant, so
 * RLS is exercised — a MANAGER (role `manager`, which holds `person.manage`) and a STAFF person (role
 * `staff`, which holds nothing), each WITH a dashboard password so both can log in. Each test gets its
 * OWN tenant, so the `persons` re-reads below are that test's alone and order-independent (CLAUDE.md
 * §4). These persons are seeded directly because provisioning creates only the ADMIN, and these tests
 * need a `manager` and a `staff` person to exercise permission gating; `pin_hash` is NOT NULL, so a
 * value is supplied even though they log in by password.
 */
async function setupTenant(): Promise<{ tenantId: string; managerId: string; staffId: string }> {
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

  const { managerId, staffId } = await withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    const manager = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, password_hash, role)
      values (current_tenant_id(), 'The Manager', ${hashPin("1234")}, ${hashPassword(PASSWORD)}, 'manager')
      returning id`);
    const staff = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, password_hash, role)
      values (current_tenant_id(), 'The Clerk', ${hashPin("1234")}, ${hashPassword(PASSWORD)}, 'staff')
      returning id`);
    return { managerId: manager.rows[0]!.id, staffId: staff.rows[0]!.id };
  });
  return { tenantId: venue.tenantId, managerId, staffId };
}

function mountApp(tenantId: string): Hono {
  const app = new Hono();
  // `secureCookies: false` so the session cookie rides the non-TLS `app.request` (mirrors
  // `till-api.rls.test.ts`'s `apiDeps`). `deps.db` is the owner connection; the routes drop to
  // `app_user` themselves via `withTenant` + `asAppUser`. `rpId`/`origin` are the loopback passkey
  // Relying Party values (these suites exercise the staff routes, not the passkey ceremonies — those
  // are covered in Task 5 — but the widened `ManagementApiDeps` requires both).
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
 * cookie pair (the part a browser echoes back). Asserts the 200 so a caller never carries a stale
 * or absent cookie forward silently. */
async function login(app: Hono, personId: string, password = PASSWORD): Promise<string> {
  const res = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ personId, password }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

/** Count the tenant's persons named `displayName`, read back as the app role under RLS — the proof a
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

describe("Management API over real Postgres (RLS end-to-end)", () => {
  // ── The four required core assertions (task-6 brief) ───────────────────────────────────────────

  it("login → list → create → verify persistence", async () => {
    const { tenantId, managerId } = await setupTenant();
    const app = mountApp(tenantId);

    // Log in through the HTTP surface and capture the session cookie the route sets.
    const loginRes = await app.request("/management-api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personId: managerId, password: PASSWORD }),
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

    // Re-read as the app role: exactly one 'Ada' row landed under this tenant via RLS — proving a
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
    const { tenantId, managerId } = await setupTenant();
    const app = mountApp(tenantId);

    const res = await app.request("/management-api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personId: managerId, password: "wrong password" }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "password.invalid" },
    });
    // No session was minted, so the failed login must not have set a cookie.
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("refuses staff-role creation with 403", async () => {
    const { tenantId, staffId } = await setupTenant();
    const app = mountApp(tenantId);

    // The staff-role person CAN log in (login checks the credential, not the role)…
    const cookie = await login(app, staffId);
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

  it("isolates staff across tenants — a manager's roster shows only their OWN tenant's persons", async () => {
    // Cross-tenant staff isolation (spec §2/§3/§9). Two independent provisioned venues, each with its
    // own manager + staff. Every person across both tenants shares the same seeded display names, so
    // the assertions key on personId — the one field that differs — rather than on displayName.
    const a = await setupTenant();
    const b = await setupTenant();
    // Each `mountManagementApi` binds ONE tenant via `cfg.tenantId`, so each tenant needs its own app.
    const appA = mountApp(a.tenantId);
    const appB = mountApp(b.tenantId);

    // Tenant A's manager lists staff: exactly A's own persons, and NEITHER of B's. This is the
    // load-bearing differential — `listPersons` has no explicit tenant filter and relies entirely on
    // `withTenant` + `asAppUser` RLS, so were `asAppUser` ever dropped from the handler the list would
    // run as the superuser `suite.admin` connection (which bypasses FORCE RLS) and would leak B's rows,
    // failing the `not.toContain` assertions below.
    const cookieA = await login(appA, a.managerId);
    const listedA = await appA.request("/management-api/staff", { headers: { cookie: cookieA } });
    expect(listedA.status).toBe(200);
    const idsA = ((await listedA.json()) as { personId: string }[]).map((p) => p.personId);
    expect(idsA).toEqual(expect.arrayContaining([a.managerId, a.staffId]));
    expect(idsA).not.toContain(b.managerId);
    expect(idsA).not.toContain(b.staffId);

    // The reverse direction: tenant B's manager sees only B's persons, never A's — proving the
    // isolation is symmetric and not an artefact of which tenant was provisioned first.
    const cookieB = await login(appB, b.managerId);
    const listedB = await appB.request("/management-api/staff", { headers: { cookie: cookieB } });
    expect(listedB.status).toBe(200);
    const idsB = ((await listedB.json()) as { personId: string }[]).map((p) => p.personId);
    expect(idsB).toEqual(expect.arrayContaining([b.managerId, b.staffId]));
    expect(idsB).not.toContain(a.managerId);
    expect(idsB).not.toContain(a.staffId);
  });

  // ── Additional coverage: the remaining routes + guard branches ─────────────────────────────────

  it("logs out — ends the session, clears the cookie, and a reused cookie is refused", async () => {
    const { tenantId, managerId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, managerId);

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
    const { tenantId, managerId, staffId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, managerId);

    // Promote the staff person to supervisor and suspend them.
    const patched = await app.request(`/management-api/staff/${staffId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ role: "supervisor", status: "suspended" }),
    });
    expect(patched.status).toBe(204);

    // Re-read as the app role: both fields changed under RLS.
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
    const { tenantId, managerId, staffId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, managerId);

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
    const { tenantId, managerId, staffId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, managerId);

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

  it("resets a PIN and sets a password, then the new password logs in", async () => {
    const { tenantId, managerId, staffId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, managerId);

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
      body: JSON.stringify({ personId: staffId, password: NEW_PASSWORD }),
    });
    expect(relogin.status).toBe(200);
  });

  it("screens malformed bodies and ids on the gated write routes", async () => {
    const { tenantId, managerId, staffId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, managerId);

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

  it("refuses a login with a non-UUID personId as password.invalid (leaking no field)", async () => {
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);

    const res = await app.request("/management-api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personId: "not-a-uuid", password: PASSWORD }),
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
    const { tenantId, managerId } = await setupTenant();
    const app = mountApp(tenantId);

    // The seeded manager has a correct password and is NOT TOTP-enrolled, so `loginManager` would
    // otherwise ignore `totp` entirely and mint a session (200). This proves the new typecheck
    // rejects a non-string `totp` at the API boundary — as `password.invalid`, leaking no field —
    // before it can reach `loginManager`/`verifyTotp`.
    const res = await app.request("/management-api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personId: managerId, password: PASSWORD, totp: 123 }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "password.invalid" },
    });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("create with a null JSON body → 400 management.request_invalid", async () => {
    const { tenantId, managerId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, managerId);

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
    const { tenantId, managerId, staffId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, managerId);

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
    const { tenantId, managerId, staffId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, managerId);

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

  it("maps an unparseable request body to an opaque 500 (run's server-fault branch)", async () => {
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);

    // Invalid JSON: `c.req.json()` throws a non-AppError, which `run` documents as a server fault →
    // opaque `server.internal` 500 (management-api.ts's `run` doc comment). Asserting the documented
    // behaviour, not forcing it.
    const res = await app.request("/management-api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    expect(res.status).toBe(500);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "server.internal" },
    });
  });
});

// ── Task 7: layout + receipt write routes ─────────────────────────────────────────────────────────
// The dashboard's till-configuration surface: GET the current layout/receipt, PUT a new one of each.
// Same real-Postgres justification as the staff routes above — every touch runs `withTenant` +
// `asAppUser`, so RLS scopes the read/write and the authorize gate (persons + management_sessions) to
// the dashboard's own tenant, which PGlite's superuser connection cannot prove (CLAUDE.md §4).

/** A sale-critical-complete layout (validateLayout requires product-grid + basket + total +
 * tender-pay, design D4) with `columns` on the product grid — the one wired config key (D6). Mirrors
 * `packages/layouts/src/store.rls.test.ts`'s helper. */
function saleLayout(columns: number): LayoutDef {
  return [
    { type: "product-grid", region: "main", config: { columns } },
    { type: "basket", region: "aside", config: {} },
    { type: "total", region: "aside", config: {} },
    { type: "tender-pay", region: "aside", config: {} },
  ];
}

/** GET the current layout as `cookie`, asserting the 200 and returning the parsed `{ definition,
 * receipt }` so a round-trip test reads back exactly what a PUT stored. */
async function getLayoutOverHttp(
  app: Hono,
  cookie: string,
): Promise<{ definition: LayoutDef; receipt: unknown }> {
  const res = await app.request("/management-api/layout", { headers: { cookie } });
  expect(res.status).toBe(200);
  return (await res.json()) as { definition: LayoutDef; receipt: unknown };
}

describe("Management API — layout + receipt routes (Task 7)", () => {
  it("refuses all three routes unauthenticated with 401 management_session.required", async () => {
    const { tenantId } = await setupTenant();
    const app = mountApp(tenantId);
    const json = { "content-type": "application/json" };

    // requireManagementSession runs FIRST on each route, so an unauthenticated request is refused
    // before any DB work — the same 401 the gated staff routes give.
    const cases = [
      app.request("/management-api/layout"),
      app.request("/management-api/layout", {
        method: "PUT",
        headers: json,
        body: JSON.stringify({ definition: saleLayout(3) }),
      }),
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

  it("refuses all three routes for a STAFF-role session with 403 (the authorizeManager gate — differential)", async () => {
    const { tenantId, staffId } = await setupTenant();
    const app = mountApp(tenantId);
    // A staff person CAN log in (login checks the credential, not the role) but holds no
    // `till.configure`, so each route is refused 403 before any read/write.
    const cookie = await login(app, staffId);
    const json = { "content-type": "application/json" };

    // GET is gated by the ROUTE's own explicit `authorizeManager` call (getLayout does not authorize,
    // being shared with the unauthenticated till boot read) — deleting that call flips this GET from
    // 403 to 200 (the by-deletion proof for the route-level gate, demonstrated in this task's report).
    // The two PUTs are gated INSIDE putLayout/putReceipt (proven by deletion in store.rls.test.ts);
    // here the same 403 is exercised end-to-end through the HTTP surface.
    const cases = [
      app.request("/management-api/layout", { headers: { cookie } }),
      app.request("/management-api/layout", {
        method: "PUT",
        headers: { ...json, cookie },
        body: JSON.stringify({ definition: saleLayout(3) }),
      }),
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

  it("GET returns the built-in defaults for a tenant that has never authored a layout", async () => {
    const { tenantId, managerId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, managerId);

    const body = await getLayoutOverHttp(app, cookie);
    expect(body).toEqual({ definition: DEFAULT_LAYOUT, receipt: DEFAULT_RECEIPT });
  });

  it("manager PUT /management-api/layout → 204, then GET reads it back (round-trip)", async () => {
    const { tenantId, managerId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, managerId);
    const definition = saleLayout(4);

    const put = await app.request("/management-api/layout", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ definition }),
    });
    expect(put.status).toBe(204);
    expect(await put.text()).toBe("");

    // The stored definition reads back verbatim; the receipt half stays at its default (putLayout
    // never touches it).
    const body = await getLayoutOverHttp(app, cookie);
    expect(body.definition).toEqual(definition);
    expect(body.receipt).toEqual(DEFAULT_RECEIPT);
  });

  it("manager PUT /management-api/receipt → 204, then GET reads the receipt back (round-trip)", async () => {
    const { tenantId, managerId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, managerId);
    const receipt = { footerMessage: "Gracias por su visita" };

    const put = await app.request("/management-api/receipt", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ receipt }),
    });
    expect(put.status).toBe(204);
    expect(await put.text()).toBe("");

    // The receipt reads back verbatim; the definition half stays at its default (putReceipt never
    // touches it).
    const body = await getLayoutOverHttp(app, cookie);
    expect(body.receipt).toEqual(receipt);
    expect(body.definition).toEqual(DEFAULT_LAYOUT);
  });

  it("PUT /management-api/layout with an invalid definition → 400 layout.invalid", async () => {
    const { tenantId, managerId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, managerId);

    // An array missing the sale-critical `total` widget — putLayout's validateLayout refuses it as
    // `layout.invalid` (missing_required), which STATUS maps to 400. This proves the layouts error
    // code both reaches `run` and is mapped (not the ?? 400 default masking a mismatch).
    const invalid = [
      { type: "product-grid", region: "main", config: {} },
      { type: "basket", region: "aside", config: {} },
      { type: "tender-pay", region: "aside", config: {} },
    ];
    const res = await app.request("/management-api/layout", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ definition: invalid }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "layout.invalid" },
    });
  });

  it("PUT /management-api/receipt with an unknown field → 400 receipt.invalid", async () => {
    const { tenantId, managerId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, managerId);

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
    const { tenantId, managerId } = await setupTenant();
    const app = mountApp(tenantId);
    const cookie = await login(app, managerId);
    const json = { "content-type": "application/json" };

    // Each degenerate body is refused as `management.request_invalid` naming the FIELD, before the
    // service is called: an object without the required key, a JSON `null` (coerced to `{}` so it
    // hits the same guard rather than TypeError-ing → 500), and a bare JSON array (the raw layout
    // sent at the top level instead of under `{ definition }`).
    const layoutEmpty = await app.request("/management-api/layout", {
      method: "PUT",
      headers: { ...json, cookie },
      body: JSON.stringify({}),
    });
    expect(layoutEmpty.status).toBe(400);
    expect(
      (await layoutEmpty.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "definition" } } });

    const layoutNull = await app.request("/management-api/layout", {
      method: "PUT",
      headers: { ...json, cookie },
      body: "null",
    });
    expect(layoutNull.status).toBe(400);
    expect((await layoutNull.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });

    const layoutArray = await app.request("/management-api/layout", {
      method: "PUT",
      headers: { ...json, cookie },
      body: JSON.stringify(saleLayout(3)),
    });
    expect(layoutArray.status).toBe(400);
    expect((await layoutArray.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });

    const receiptEmpty = await app.request("/management-api/receipt", {
      method: "PUT",
      headers: { ...json, cookie },
      body: JSON.stringify({}),
    });
    expect(receiptEmpty.status).toBe(400);
    expect(
      (await receiptEmpty.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "receipt" } } });
  });

  it("isolates layout across tenants, and refuses a cross-tenant session under RLS (asAppUser differential)", async () => {
    // Two independent provisioned venues, each with its own manager. Each app binds ONE tenant via
    // `cfg.tenantId`.
    const a = await setupTenant();
    const b = await setupTenant();
    const appA = mountApp(a.tenantId);
    const appB = mountApp(b.tenantId);
    const cookieA = await login(appA, a.managerId);
    const cookieB = await login(appB, b.managerId);

    // Each manager authors a DISTINCT layout through the full HTTP surface.
    const putA = await appA.request("/management-api/layout", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: cookieA },
      body: JSON.stringify({ definition: saleLayout(3) }),
    });
    expect(putA.status).toBe(204);
    const putB = await appB.request("/management-api/layout", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: cookieB },
      body: JSON.stringify({ definition: saleLayout(7) }),
    });
    expect(putB.status).toBe(204);

    // Each GET returns only its OWN tenant's authored layout — end-to-end per-tenant scoping.
    expect((await getLayoutOverHttp(appA, cookieA)).definition).toEqual(saleLayout(3));
    expect((await getLayoutOverHttp(appB, cookieB)).definition).toEqual(saleLayout(7));

    // The load-bearing differential: tenant A's session cookie sent to tenant B's app is refused 401.
    // `resolveManagementSession` (inside authorizeManager) looks up the session by id with NO explicit
    // tenant filter, relying entirely on `withTenant` + `asAppUser` RLS to scope it — so A's session
    // row is invisible under B's GUC and the gate throws `management_session.required`. Drop `asAppUser`
    // from the GET route and B's app runs as the superuser owner (RLS bypassed), resolves A's session,
    // authorizes A's manager and answers 200 — flipping this assertion. That is the by-deletion proof
    // the route's `withTenant` + `asAppUser` is doing the tenant scoping, not an explicit filter.
    const crossed = await appB.request("/management-api/layout", { headers: { cookie: cookieA } });
    expect(crossed.status).toBe(401);
    expect((await crossed.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management_session.required" },
    });
  });
});
