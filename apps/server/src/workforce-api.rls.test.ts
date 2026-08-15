import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin, startManagementSession } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { mountWorkforceApi } from "./workforce-api.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";
import { startRealPostgres } from "./testing/postgres.js";

// Real Postgres, not PGlite: this suite proves the workforce write group's RLS isolation and its
// schedule.manage gate DIFFERENTIALLY, which PGlite cannot do — every PGlite connection is a superuser
// that bypasses FORCE RLS (CLAUDE.md §4), so a "cross-tenant read returned nothing" on PGlite would be
// a FALSE pass. The route mechanics are already proven in-process on PGlite (`workforce-api.test.ts`);
// here every DB touch goes through `withTenant` + `asAppUser` from `suite.admin`, and the assertions
// are written so that dropping `asAppUser` (isolation) or `authorizeManager` (the gate) from
// `workforce-api.ts` turns a green test red.
const LOCALE = "es-ES";
const suite = useRealPostgres({ start: startRealPostgres, timeoutMs: 180_000 });
const noopLog: Logger = () => {};

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(72_000_000 + nifCounter).padStart(8, "0")}K`;
}

interface Venue { tenantId: string; locationId: string; personId: string; managerCookie: string; staffCookie: string; }

async function setupVenue(): Promise<Venue> {
  const venue = await applyVenue(
    planVenue({
      country: "ES", taxId: nextNif(), legalName: "Deli Test SL",
      location: {
        name: "Sala principal", fiscalTerritory: "ES-common", invoiceLocales: [LOCALE],
        operationDescription: "Venta en establecimiento", addressLine1: "Calle Mayor 1",
        addressLine2: null, postalCode: "28013", city: "Madrid", province: "Madrid",
        timeZone: "Europe/Madrid", dayCutover: "05:00",
      },
      tillName: "Caja 1", seriesCode: "A", rectificativeSeriesCode: "R",
      admin: { displayName: "Administradora", pinHash: hashPin("1234"), passwordHash: hashPassword("dashPass123") },
    }),
    { db: suite.admin },
  );
  const seeded = await withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    const loc = await tx.execute<{ id: string }>(sql`select id from locations where tenant_id = current_tenant_id() limit 1`);
    const mgr = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (current_tenant_id(), 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
    const stf = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (current_tenant_id(), 'The Clerk', ${hashPin("1234")}, 'staff') returning id`);
    const mSes = await startManagementSession(tx, { tenantId: venue.tenantId, personId: mgr.rows[0]!.id });
    const sSes = await startManagementSession(tx, { tenantId: venue.tenantId, personId: stf.rows[0]!.id });
    return { locationId: loc.rows[0]!.id, personId: mgr.rows[0]!.id, mSid: mSes.id, sSid: sSes.id };
  });
  return {
    tenantId: venue.tenantId, locationId: seeded.locationId, personId: seeded.personId,
    managerCookie: `${MANAGEMENT_COOKIE}=${seeded.mSid}`, staffCookie: `${MANAGEMENT_COOKIE}=${seeded.sSid}`,
  };
}

function mountApp(tenantId: string): Hono {
  const app = new Hono();
  mountWorkforceApi(app, { db: suite.admin, cfg: { tenantId } }, noopLog);
  return app;
}

async function send(app: Hono, method: string, path: string, cookie: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { cookie };
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

describe("Workforce API over real Postgres (RLS end-to-end)", () => {
  it("isolates rosters across tenants — a manager sees only their OWN tenant's draft", async () => {
    // Differential cross-tenant isolation. The load-bearing differential is the LOCATIONS read below:
    // GET /management-api/locations is a bare `select ... from locations` with NO explicit tenant
    // filter, so its cross-tenant scoping is entirely `withTenant` + `asAppUser` RLS. Were `asAppUser`
    // dropped from `gated`, that read would run on the `suite.admin` superuser connection (which
    // BYPASSES FORCE RLS) and leak every tenant's locations — failing the `not.toContain` below.
    // (The roster reads/writes are ALSO explicitly `tenant_id`-filtered by the engine, so they are
    // isolated by cfg.tenantId regardless of RLS — belt-and-suspenders, not the differential.)
    // GUARD-BY-DELETION (asAppUser), run 2026-08-15 against postgres:18 via Testcontainers
    // (TESTCONTAINERS_RYUK_DISABLED=true): removing `await asAppUser(tx);` from workforce-api.ts's
    // `gated` helper made B's GET /locations contain A's location id (`bLocIds` did contain
    // `a.locationId`), exactly the RLS leak predicted; the roster assertions stayed green (explicit
    // filter). Restored the line and the suite passed again.
    const a = await setupVenue();
    const b = await setupVenue();
    const appA = mountApp(a.tenantId);
    const appB = mountApp(b.tenantId);

    // The load-bearing differential: B's location list is B's alone — A's location is RLS-hidden.
    const bLocs = await send(appB, "GET", "/management-api/locations", b.managerCookie);
    expect(bLocs.status).toBe(200);
    const bLocIds = ((await bLocs.json()) as { id: string }[]).map((r) => r.id);
    expect(bLocIds).toContain(b.locationId);
    expect(bLocIds).not.toContain(a.locationId);

    // A authors a draft for its own location + week.
    const createA = await send(appA, "POST", "/management-api/roster", a.managerCookie, { locationId: a.locationId, period: "2026-03-02" });
    expect(createA.status).toBe(201);
    const versionA = ((await createA.json()) as { versionId: string }).versionId;
    await send(appA, "POST", `/management-api/roster/${versionA}/shifts`, a.managerCookie, {
      personId: a.personId, locationId: a.locationId,
      startsAt: "2026-03-02T09:00:00Z", startsOffsetMinutes: 0, endsAt: "2026-03-02T13:00:00Z", endsOffsetMinutes: 0, role: null,
    });

    // A sees its own draft + shift.
    const readA = await send(appA, "GET", `/management-api/roster?locationId=${a.locationId}&period=2026-03-02`, a.managerCookie);
    const snapA = (await readA.json()) as { version: { id: string } | null; shifts: unknown[] };
    expect(snapA.version?.id).toBe(versionA);
    expect(snapA.shifts).toHaveLength(1);

    // B reading A's location id sees NOTHING — RLS row-hides A's version + shifts (the load-bearing
    // differential; if asAppUser were dropped this would return A's draft).
    const bReadsA = await send(appB, "GET", `/management-api/roster?locationId=${a.locationId}&period=2026-03-02`, b.managerCookie);
    expect(bReadsA.status).toBe(200);
    expect(await bReadsA.json()).toEqual({ version: null, shifts: [] });

    // B cannot mutate A's shift either — RLS hides it, so the id is roster.not_found from B's side.
    const bAddsToAsVersion = await send(appB, "POST", `/management-api/roster/${versionA}/shifts`, b.managerCookie, {
      personId: b.personId, locationId: b.locationId,
      startsAt: "2026-03-02T09:00:00Z", startsOffsetMinutes: 0, endsAt: "2026-03-02T13:00:00Z", endsOffsetMinutes: 0, role: null,
    });
    expect(bAddsToAsVersion.status).toBe(404); // roster.not_found — A's version is invisible to B
  });

  it("refuses every roster write route to a staff-role session — 403 authorization.not_permitted", async () => {
    // GUARD-BY-DELETION (authorizeManager): remove the authorizeManager call from workforce-api.ts's
    // `gated` (and the inline one in the publish route) and these 403s flip to success.
    const { tenantId, locationId, staffCookie } = await setupVenue();
    const app = mountApp(tenantId);
    const missing = "00000000-0000-0000-0000-000000000000";
    const expect403 = async (res: Response) => {
      expect(res.status).toBe(403);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({ error: { code: "authorization.not_permitted" } });
    };
    await expect403(await send(app, "GET", `/management-api/roster?locationId=${locationId}&period=2026-03-02`, staffCookie));
    await expect403(await send(app, "POST", "/management-api/roster", staffCookie, { locationId, period: "2026-03-02" }));
    await expect403(await send(app, "POST", `/management-api/roster/${missing}/shifts`, staffCookie, {
      personId: missing, locationId, startsAt: "2026-03-02T09:00:00Z", startsOffsetMinutes: 0, endsAt: "2026-03-02T13:00:00Z", endsOffsetMinutes: 0, role: null,
    }));
    await expect403(await send(app, "DELETE", `/management-api/roster/shifts/${missing}`, staffCookie));
    await expect403(await send(app, "POST", `/management-api/roster/${missing}/publish`, staffCookie));
  });

  it("publishes end-to-end under RLS and returns the breaches array", async () => {
    const v = await setupVenue();
    // Seed the location's convenio_config (as admin — superuser bypasses RLS; tenant_id set explicitly).
    await suite.admin.execute(sql`insert into convenio_config (tenant_id, location_id) values (${v.tenantId}, ${v.locationId})`);
    const app = mountApp(v.tenantId);
    const create = await send(app, "POST", "/management-api/roster", v.managerCookie, { locationId: v.locationId, period: "2026-06-01" });
    const versionId = ((await create.json()) as { versionId: string }).versionId;
    const res = await send(app, "POST", `/management-api/roster/${versionId}/publish`, v.managerCookie);
    expect(res.status).toBe(200);
    expect((await res.json()) as { breaches: unknown[] }).toEqual({ breaches: [] });
  });
});
