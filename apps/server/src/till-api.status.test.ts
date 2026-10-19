import { createZone } from "./testing/service-zone.js";

import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { kitchenTimingDefaults, locations, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { locationId as brandLocationId, nodeId as brandNodeId } from "@waitron/shared";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { createTable } from "./testing/live-table.js";
import type { Logger, LogLevel } from "./logger.js";
import { mountTillApi } from "./till-api.js";
import type { TillApiDeps } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";
import { seedSessionDevice } from "./testing/session-device.js";

// Venue-made table statuses are retired: the till API serves neither the status list nor the
// set-status route, and the floor read carries no manual status.
let cfg: TillConfig;
let ana: { id: string };
let TABLE_ID: string;

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
    await db.insert(kitchenTimingDefaults).values({ locationId: loc!.id });
    const locationId = loc!.id;
    const nodeId = await seedNode(db, brandLocationId(locationId));
    const [person] = await db
      .insert(persons)
      .values({ displayName: "Ana", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    ana = { id: person!.id };
    cfg = makeCfg(locationId, nodeId);
    TABLE_ID = await withTransaction(db, async (tx) => {
      const { id: tableId } = await createTable(tx, cfg, {
        label: "T1",
        zoneId: (await createZone(tx, cfg, { name: "Tables" })).id,
      });
      return tableId;
    });
  },
});

function collect(
  lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[],
): Logger {
  return (level, event, fields) => lines.push({ level, event, fields: fields ?? {} });
}

function makeCfg(locationId: string, nodeId: string): TillConfig {
  return {
    nodeId: brandNodeId(nodeId),
    locationId: brandLocationId(locationId),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
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
      throw new Error("till-api.status.test: anchor() is not used here");
    },
    currentAnchor: () => null,
  };
}

function deps(db: Database): TillApiDeps {
  return {
    db,
    backend: {} as FiscalBackend,
    clock: systemClock(),
    cfg,
    secureCookies: false,
    venueLocale: "es-ES",
  };
}

async function openSession(db: Database): Promise<string> {
  const deviceId = await seedSessionDevice(db, cfg);
  const session = await withTransaction(db, async (tx) => {
    return loginWithPin(tx, {
      deviceId,
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

describe("venue-made statuses are retired (A757 slice 2)", () => {
  it("no longer serves the status list or the set-status route", async () => {
    expect((await request("/api/statuses")).status).toBe(404);
    const res = await request(`/api/tables/${TABLE_ID}/status`, {
      method: "POST",
      body: JSON.stringify({ statusId: null }),
    });
    expect(res.status).toBe(404);
  });

  it("sends no manual status on the floor read", async () => {
    const state = (await (await request("/api/tables/state")).json()) as { id: string }[];
    const row = state.find((t) => t.id === TABLE_ID);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("status");
  });
});
