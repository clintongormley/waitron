import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, loginWithPin } from "@waitron/identity";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { TenantId } from "@waitron/shared";
import { createTable } from "./tables.js";
import type { Logger, LogLevel } from "./logger.js";
import { mountTillApi } from "./till-api.js";
import type { TillApiDeps } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

// PGlite, not real Postgres: the `POST /api/tables/:id/status` route is wiring — session guard +
// isUuid screen + STATUS mapping over the operator `setTableStatus` verb, which is LOGIC (no privilege
// or concurrency behaviour to prove here). The verb's own real-PG proofs (RLS, the reset trigger) live
// in `set-table-status.test.ts` / the `*.rls.test.ts` suites; they are not re-proven at the HTTP layer.
let cfg: TillConfig;
let ana: { id: string };
// A persistent dining table and two statuses (one active, one inactive) seeded once. The inactive one
// is seeded inactive (rather than deactivated at runtime) so the `status.inactive` case is
// order-independent (CLAUDE.md §4): no test mutates the active status out from under another.
let TABLE_ID: string;
let STATUS_ID: string;
let INACTIVE_STATUS_ID: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    const tenantId = await seedTenant(db);
    const loc = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Barra', array['es-ES'], 'Venta en establecimiento') returning id`);
    const locationId = loc.rows[0]!.id;
    const till = await db.execute<{ id: string }>(sql`
      insert into tills (tenant_id, location_id, name)
      values (${tenantId}, ${locationId}, 'Caja 1') returning id`);
    const nodeId = await seedNode(db, tenantId, brandLocationId(locationId));
    // Ana logs in with PIN "5555"; the session cookie the route requires names her shift.
    const person = await db.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${tenantId}, 'Ana', ${hashPin("5555")}, 'staff') returning id`);
    ana = { id: person.rows[0]!.id };
    cfg = makeCfg(tenantId, till.rows[0]!.id, locationId, nodeId);
    // One dining table + one active and one inactive status, seeded on the APP role under the tenant so
    // the writes go through the same RLS-scoped path the routes use (not a superuser bypass insert).
    const seeded = await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      const { id: tableId } = await createTable(tx, cfg, { label: "T1" });
      const active = await tx.execute<{ id: string }>(
        sql`insert into table_service_statuses (tenant_id, label, color) values (${tenantId}, 'Bill requested', '#ef4444') returning id`,
      );
      const inactive = await tx.execute<{ id: string }>(
        sql`insert into table_service_statuses (tenant_id, label, color, active) values (${tenantId}, 'Retired', '#000', false) returning id`,
      );
      return {
        tableId,
        activeStatusId: active.rows[0]!.id,
        inactiveStatusId: inactive.rows[0]!.id,
      };
    });
    TABLE_ID = seeded.tableId;
    STATUS_ID = seeded.activeStatusId;
    INACTIVE_STATUS_ID = seeded.inactiveStatusId;
  },
});

/** A collecting logger — the route's structured lines are not asserted here, only that a code maps. */
function collect(
  lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[],
): Logger {
  return (level, event, fields) => lines.push({ level, event, fields: fields ?? {} });
}

/** The till's config for the seeded tenant. `seriesId` is unused by this route (no fiscal write on the
 *  status path) so it carries a fresh uuid; `nodeId`/`locationId` are the seeded rows the reads scope by. */
function makeCfg(
  tenantId: TenantId,
  tillId: string,
  locationId: string,
  nodeId: string,
): TillConfig {
  return {
    tenantId,
    tillId: brandTillId(tillId),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

/** The system wall clock — this route never files a fiscal doc, but `TillApiDeps` demands a clock, so
 *  the same stub shape the sibling suites use is supplied. */
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
  };
}

/** Opens a real shift session for Ana on the app role — the same `withTenant` + `asAppUser` +
 *  `loginWithPin` path the login route runs — and returns its id. */
async function openSession(db: Database): Promise<string> {
  const session = await withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return loginWithPin(tx, {
      tenantId: cfg.tenantId,
      tillId: cfg.tillId,
      personId: ana.id,
      pin: "5555",
    });
  });
  return session.id;
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
    // Dropping the `if (!isUuid(id))` line makes this a 500 (raw `22P02`) instead of 404 — the
    // prove-by-deletion for the `:id` guard.
    const res = await request("/api/tables/not-a-uuid/status", {
      method: "POST",
      body: JSON.stringify({ statusId: null }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "table.not_found" } });
  });

  it("a malformed statusId → 404 status.not_found (isUuid guard on the body, not a 500)", async () => {
    // A present-but-malformed `statusId` names no status; screened to status.not_found BEFORE it can
    // reach `eq(tableServiceStatuses.id, statusId)` and `22P02` → an opaque 500.
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
    // A fresh app driven WITHOUT the session cookie: `requireSession` runs first (before the isUuid
    // screen, the body read, or any DB touch), so an unauthenticated request 401s. Deleting the
    // `requireSession` call flips this to a 200 — the deletion proof of the guard.
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
