import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { locations, tableServiceStatuses, tills, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { createTable } from "./tables.js";
import type { Logger, LogLevel } from "./logger.js";
import { mountTillApi } from "./till-api.js";
import type { TillApiDeps } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

// The HTTP wiring of `POST /api/tables/:id/status`: session guard, isUuid screen and STATUS mapping.
// The `setTableStatus` verb is pinned in `set-table-status.test.ts` and `clear-table-status.test.ts`.
let cfg: TillConfig;
let ana: { id: string };
// The inactive status is seeded inactive (rather than deactivated at runtime) so no test mutates a
// status out from under another.
let TABLE_ID: string;
let STATUS_ID: string;
let INACTIVE_STATUS_ID: string;

const suite = useVenueDb({
  resetPerTest: false,
  // The whole manifest: the tables here span modules that FK into core, so the shared ordered set is
  // the fixture.
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedTenant(db);
    const [loc] = await db
      .insert(locations)
      .values({
        name: "Barra",
        invoiceLocales: ["es-ES"],
        operationDescription: "Venta en establecimiento",
      })
      .returning({ id: locations.id });
    const locationId = loc!.id;
    const [till] = await db
      .insert(tills)
      .values({ locationId: locationId, name: "Caja 1" })
      .returning({ id: tills.id });
    const nodeId = await seedNode(db, brandLocationId(locationId));
    const [person] = await db
      .insert(persons)
      .values({ displayName: "Ana", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    ana = { id: person!.id };
    cfg = makeCfg(till!.id, locationId, nodeId);
    const seeded = await withTransaction(db, async (tx) => {
      const { id: tableId } = await createTable(tx, cfg, { label: "T1" });
      const [active] = await tx
        .insert(tableServiceStatuses)
        .values({ label: "Bill requested", color: "#ef4444" })
        .returning({ id: tableServiceStatuses.id });
      const [inactive] = await tx
        .insert(tableServiceStatuses)
        .values({ label: "Retired", color: "#000", active: false })
        .returning({ id: tableServiceStatuses.id });
      return {
        tableId,
        activeStatusId: active!.id,
        inactiveStatusId: inactive!.id,
      };
    });
    TABLE_ID = seeded.tableId;
    STATUS_ID = seeded.activeStatusId;
    INACTIVE_STATUS_ID = seeded.inactiveStatusId;
  },
});

function collect(
  lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[],
): Logger {
  return (level, event, fields) => lines.push({ level, event, fields: fields ?? {} });
}

/** `seriesId` is unused by this route (no fiscal write on the status path), so it carries a fresh uuid. */
function makeCfg(tillId: string, locationId: string, nodeId: string): TillConfig {
  return {
    tillId: brandTillId(tillId),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

function systemClock(): TrustedClock {
  return {
    now: () => {
      const instant = new Date();
      return {
        instant,
        offsetMinutes: -instant.getTimezoneOffset(),
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      };
    },
    anchor: () => {
      throw new Error("till-api.status.test: anchor() is not used by the status route");
    },
    currentAnchor: () => null,
  };
}

function deps(db: Database): TillApiDeps {
  return {
    db,
    // Never called by the status route — it files no fiscal doc.
    backend: {} as FiscalBackend,
    clock: systemClock(),
    cfg,
    secureCookies: false,
    venueLocale: "es-ES",
  };
}

async function openSession(db: Database): Promise<string> {
  const session = await withTransaction(db, async (tx) => {
    return loginWithPin(tx, {
      tillId: cfg.tillId,
      personId: ana.id,
      pin: "5555",
    });
  });
  return session.token;
}

let app: Hono;
let cookie: string;

beforeAll(async () => {
  app = new Hono();
  mountTillApi(app, deps(suite.db), collect([]));
  cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
});

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return app.request(path, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...init.headers },
  });
}

describe("POST /api/tables/:id/status", () => {
  it("sets a table's status (200) and GET /api/tables/state reflects it", async () => {
    const res = await request(`/api/tables/${TABLE_ID}/status`, {
      method: "POST",
      body: JSON.stringify({ statusId: STATUS_ID }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    const state = (await (await request("/api/tables/state")).json()) as {
      id: string;
      status: { id: string } | null;
    }[];
    expect(state.find((t) => t.id === TABLE_ID)!.status).toMatchObject({ id: STATUS_ID });
  });

  it("clears a table's status with { statusId: null } (200)", async () => {
    await request(`/api/tables/${TABLE_ID}/status`, {
      method: "POST",
      body: JSON.stringify({ statusId: STATUS_ID }),
    });
    const res = await request(`/api/tables/${TABLE_ID}/status`, {
      method: "POST",
      body: JSON.stringify({ statusId: null }),
    });
    expect(res.status).toBe(200);
    const state = (await (await request("/api/tables/state")).json()) as {
      id: string;
      status: unknown;
    }[];
    expect(state.find((t) => t.id === TABLE_ID)!.status).toBeNull();
  });

  it("a deactivated status → 409 status.inactive", async () => {
    const res = await request(`/api/tables/${TABLE_ID}/status`, {
      method: "POST",
      body: JSON.stringify({ statusId: INACTIVE_STATUS_ID }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "status.inactive" } });
  });

  it("a malformed :id → 404 table.not_found (isUuid guard, not a 500)", async () => {
    const res = await request("/api/tables/not-a-uuid/status", {
      method: "POST",
      body: JSON.stringify({ statusId: null }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "table.not_found" } });
  });

  it("a malformed statusId → 404 status.not_found (isUuid guard on the body, not a 500)", async () => {
    // A present-but-malformed `statusId` is screened to status.not_found before any query.
    const res = await request(`/api/tables/${TABLE_ID}/status`, {
      method: "POST",
      body: JSON.stringify({ statusId: "not-a-uuid" }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "status.not_found" } });
  });

  it("an unknown status uuid → 404 status.not_found", async () => {
    const res = await request(`/api/tables/${TABLE_ID}/status`, {
      method: "POST",
      body: JSON.stringify({ statusId: "00000000-0000-4000-8000-000000000000" }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "status.not_found" } });
  });

  it("REJECTS the status route with 401 session.required when no cookie is present", async () => {
    // A fresh app driven WITHOUT the session cookie.
    const noAuth = new Hono();
    mountTillApi(noAuth, deps(suite.db), collect([]));
    const res = await noAuth.request(`/api/tables/${TABLE_ID}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ statusId: null }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });
});

describe("GET /api/statuses", () => {
  it("returns the tenant's ACTIVE statuses as pickable options, excluding a deactivated one", async () => {
    const res = await request("/api/statuses");
    expect(res.status).toBe(200);
    const options = (await res.json()) as { id: string; label: string; color: string }[];
    // The active status is offered with exactly { id, label, color }; the inactive "Retired" is not —
    // a status you cannot apply must not be offered.
    expect(options).toContainEqual({ id: STATUS_ID, label: "Bill requested", color: "#ef4444" });
    expect(options.some((o) => o.id === INACTIVE_STATUS_ID)).toBe(false);
  });

  it("REJECTS with 401 session.required when no cookie is present", async () => {
    const noAuth = new Hono();
    mountTillApi(noAuth, deps(suite.db), collect([]));
    const res = await noAuth.request("/api/statuses");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });
});
