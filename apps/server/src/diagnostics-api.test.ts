import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin, startManagementSession } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import type { LogEvent, LogReader } from "./log-file.js";
import { createVerbosityController } from "./verbosity.js";
import { mountDiagnosticsApi } from "./diagnostics-api.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";
import "./errors.js";

// Real Postgres, not PGlite: this suite proves the diagnostics ROUTE's `diagnostics.view` gate
// DIFFERENTIALLY (a manager session is admitted, a staff/supervisor one refused). That gate runs
// `authorizeManager` as the app role under FORCE RLS, which PGlite cannot exercise — every PGlite
// connection is a superuser that bypasses RLS (CLAUDE.md §4), so a "staff was refused" there could be
// a false pass. The verbosity + limit-clamp mechanics are pure in-process logic proven the same run.
const LOCALE = "es-ES";

const suite = useTemplateDb({ template: "manifest" });

/** A no-op logger: only the HTTP responses matter here. */
const noopLog: Logger = () => {};

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the per-suite counter the sibling RLS suites use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(73_000_000 + nifCounter).padStart(8, "0")}K`;
}

interface Venue {
  tenantId: string;
  /** A live MANAGEMENT session cookie for a `manager` (holds `diagnostics.view`). */
  managerCookie: string;
  /** A live MANAGEMENT session cookie for a `staff` person (holds nothing — the gate refuses it). */
  staffCookie: string;
  /** A live MANAGEMENT session cookie for a `supervisor` (holds no `diagnostics.view` either). */
  supervisorCookie: string;
}

/**
 * Stand up a fresh provisioned venue (as the owner), then — as the app role under the tenant, so RLS
 * is exercised on the write side too — seed a MANAGER (holds `diagnostics.view`), a STAFF and a
 * SUPERVISOR (neither holds it) and mint a live management session for each. Each test gets its OWN
 * tenant, so its reads are that test's alone and order-independent (CLAUDE.md §4).
 */
async function setupVenue(): Promise<Venue> {
  const taxId = nextNif();
  const venue = await applyVenue(
    planVenue({
      country: "ES",
      taxId,
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

  const { managerSid, staffSid, supervisorSid } = await withTenant(
    suite.admin,
    venue.tenantId,
    async (tx) => {
      await asAppUser(tx);
      const seedPerson = async (role: string): Promise<string> => {
        const p = await tx.execute<{ id: string }>(sql`
          insert into persons (tenant_id, display_name, pin_hash, role)
          values (current_tenant_id(), ${`The ${role}`}, ${hashPin("1234")}, ${role}) returning id`);
        const session = await startManagementSession(tx, {
          tenantId: venue.tenantId,
          personId: p.rows[0]!.id,
        });
        return session.id;
      };
      return {
        managerSid: await seedPerson("manager"),
        staffSid: await seedPerson("staff"),
        supervisorSid: await seedPerson("supervisor"),
      };
    },
  );

  return {
    tenantId: venue.tenantId,
    managerCookie: `${MANAGEMENT_COOKIE}=${managerSid}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${staffSid}`,
    supervisorCookie: `${MANAGEMENT_COOKIE}=${supervisorSid}`,
  };
}

const EVENTS: LogEvent[] = [
  { at: "2026-08-31T10:00:00.000Z", level: "info", event: "one", requestId: "r1" },
  { at: "2026-08-31T10:00:01.000Z", level: "warn", event: "two", requestId: "r2" },
];

/** A stub LogReader that records the last `recent` opts so the limit clamp can be asserted. */
function stubReader(): { reader: LogReader; lastRecentOpts: () => { limit?: number } | undefined } {
  let last: { limit?: number } | undefined;
  return {
    reader: {
      recent: (opts) => {
        last = opts;
        return EVENTS;
      },
      byRequestIds: () => [],
    },
    lastRecentOpts: () => last,
  };
}

/** One Hono app for a venue, wiring the diagnostics routes with a real verbosity controller (default
 * `info`) and the given stub reader. `now` is fixed so `revertsAt` is deterministic. */
function mountApp(v: Pick<Venue, "tenantId">, reader: LogReader): { app: Hono } {
  const app = new Hono();
  mountDiagnosticsApi(
    app,
    {
      db: suite.admin,
      cfg: { tenantId: v.tenantId },
      reader,
      verbosity: createVerbosityController({
        defaultLevel: "info",
        now: () => new Date("2026-08-31T12:00:00.000Z"),
      }),
    },
    noopLog,
  );
  return { app };
}

async function get(app: Hono, path: string, cookie?: string): Promise<Response> {
  return app.request(path, {
    method: "GET",
    headers: cookie === undefined ? {} : { cookie },
  });
}

async function post(app: Hono, path: string, cookie: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("mountDiagnosticsApi — diagnostics.view gate + verbosity over real Postgres", () => {
  it("rejects an unauthenticated caller with 401", async () => {
    const v = await setupVenue();
    const { app } = mountApp(v, stubReader().reader);
    const res = await get(app, "/management-api/diagnostics/recent");
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management_session.required" },
    });
  });

  it("rejects a staff session with 403 (gate by deletion)", async () => {
    const v = await setupVenue();
    const { app } = mountApp(v, stubReader().reader);
    const res = await get(app, "/management-api/diagnostics/recent", v.staffCookie);
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
  });

  it("rejects a supervisor session with 403", async () => {
    const v = await setupVenue();
    const { app } = mountApp(v, stubReader().reader);
    const res = await get(app, "/management-api/diagnostics/recent", v.supervisorCookie);
    expect(res.status).toBe(403);
  });

  it("returns recent lines for a manager, clamping the limit", async () => {
    const v = await setupVenue();
    const stub = stubReader();
    const { app } = mountApp(v, stub.reader);

    const res = await get(app, "/management-api/diagnostics/recent?limit=2", v.managerCookie);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { lines: LogEvent[] }).lines).toHaveLength(2);
    expect(stub.lastRecentOpts()).toEqual({ limit: 2 });

    // Default (no query) → 200.
    await get(app, "/management-api/diagnostics/recent", v.managerCookie);
    expect(stub.lastRecentOpts()).toEqual({ limit: 200 });

    // Above the ceiling → clamped to 1000.
    await get(app, "/management-api/diagnostics/recent?limit=99999", v.managerCookie);
    expect(stub.lastRecentOpts()).toEqual({ limit: 1000 });

    // Below the floor → clamped to 1.
    await get(app, "/management-api/diagnostics/recent?limit=0", v.managerCookie);
    expect(stub.lastRecentOpts()).toEqual({ limit: 1 });

    // Non-numeric → falls back to the default.
    await get(app, "/management-api/diagnostics/recent?limit=abc", v.managerCookie);
    expect(stub.lastRecentOpts()).toEqual({ limit: 200 });
  });

  it("reports the default verbosity (no active override) as info with a null revert time", async () => {
    const v = await setupVenue();
    const { app } = mountApp(v, stubReader().reader);
    const res = await get(app, "/management-api/diagnostics/verbosity", v.managerCookie);
    expect(res.status).toBe(200);
    expect((await res.json()) as { level: string; revertsAt: string | null }).toEqual({
      level: "info",
      revertsAt: null,
    });
  });

  it("raises verbosity and reports it back with a revert time", async () => {
    const v = await setupVenue();
    const { app } = mountApp(v, stubReader().reader);

    const raise = await post(app, "/management-api/diagnostics/verbosity", v.managerCookie, {
      level: "debug",
      ttlMinutes: 5,
    });
    expect(raise.status).toBe(204);

    const res = await get(app, "/management-api/diagnostics/verbosity", v.managerCookie);
    const body = (await res.json()) as { level: string; revertsAt: string | null };
    expect(body.level).toBe("debug");
    // now() is fixed at 12:00:00Z; +5 minutes.
    expect(body.revertsAt).toBe("2026-08-31T12:05:00.000Z");
  });

  it("rejects an invalid level with diagnostics.invalid_verbosity", async () => {
    const v = await setupVenue();
    const { app } = mountApp(v, stubReader().reader);
    const res = await post(app, "/management-api/diagnostics/verbosity", v.managerCookie, {
      level: "trace",
      ttlMinutes: 5,
    });
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { reason: string } } },
    ).toMatchObject({
      error: { code: "diagnostics.invalid_verbosity", params: { reason: "level" } },
    });
  });

  it("rejects an out-of-range ttl with diagnostics.invalid_verbosity", async () => {
    const v = await setupVenue();
    const { app } = mountApp(v, stubReader().reader);
    const res = await post(app, "/management-api/diagnostics/verbosity", v.managerCookie, {
      level: "debug",
      ttlMinutes: 0,
    });
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { reason: string } } },
    ).toMatchObject({
      error: { code: "diagnostics.invalid_verbosity", params: { reason: "ttl" } },
    });
  });

  it("rejects a ttl above the ceiling too", async () => {
    const v = await setupVenue();
    const { app } = mountApp(v, stubReader().reader);
    const res = await post(app, "/management-api/diagnostics/verbosity", v.managerCookie, {
      level: "debug",
      ttlMinutes: 121,
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "diagnostics.invalid_verbosity" },
    });
  });
});
