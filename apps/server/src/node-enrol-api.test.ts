import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { locations, tenants, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { authenticateAgent } from "@waitron/printing";
import { AppError } from "@waitron/shared";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { mountNodeEnrolApi } from "./node-enrol-api.js";
import type { EnrolRateLimiter } from "./enrol-rate-limit.js";
import type { TillConfig } from "./till-config.js";
import type { Logger } from "./logger.js";
import "./errors.js";

const noopLog: Logger = () => {};

// The tenant and its location are seeded once in `beforeAll` and every case reads them.
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});

interface Tenant {
  locationId: string;
}

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(78_000_000 + nifCounter).padStart(8, "0")}K`;
}

async function seedTenantWithLocation(): Promise<Tenant> {
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: nextNif(), legalName: "Deli Test SL" });
  const [loc] = await suite.db
    .insert(locations)
    .values({
      name: "Barra",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  return { locationId: loc!.id };
}

let tenantA: Tenant;

beforeAll(async () => {
  tenantA = await seedTenantWithLocation();
});

/** A fresh nodeId per call keeps each mounted app's enrol row independent, because this suite does
 * not reset between tests. */
function cfgOf(tenant: Tenant): TillConfig {
  return {
    tillId: brandTillId(randomUUID()),
    nodeId: brandNodeId(randomUUID()),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(tenant.locationId),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    tipsEnabled: false,
    orderFlow: "ticket_then_pay",
  };
}

function buildApp(opts: { isPrimary?: boolean; limiter?: EnrolRateLimiter } = {}): {
  app: Hono;
  cfg: TillConfig;
} {
  const cfg = cfgOf(tenantA);
  const app = new Hono();
  mountNodeEnrolApi(
    app,
    {
      db: suite.db,
      cfg,
      nodeId: cfg.nodeId,
      isPrimary: opts.isPrimary ?? true,
      enrolRateLimiter: opts.limiter,
    },
    noopLog,
  );
  return { app, cfg };
}

/** `getConnInfo` reads the peer address from `c.env.incoming.socket.remoteAddress`; the third
 *  `app.request` argument becomes `c.env`. */
async function post(
  app: Hono,
  body: unknown,
  remoteAddress: string | undefined,
): Promise<Response> {
  return app.request(
    "/api/node/enrol-self",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    { incoming: { socket: { remoteAddress } } },
  );
}

async function errorCodeOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

/** Resolve a minted agent token through the production auth path. */
async function authenticate(token: string): Promise<{ agentId: string }> {
  return withTransaction(suite.db, async (tx) => {
    return authenticateAgent(tx, token);
  });
}

/** Read straight off the table, so the assertion is about what landed, not what the route
 *  returned. */
async function agentRowCount(cfg: TillConfig): Promise<number> {
  const { rows } = await suite.db.execute<{ n: number }>(
    sql`select cast(count(*) as int) as n from print_agents where node_id = ${cfg.nodeId}`,
  );
  return rows[0]!.n;
}

describe("POST /api/node/enrol-self", () => {
  it("enrols the caller as a print agent over loopback on the primary", async () => {
    const { app } = buildApp();
    const res = await post(app, { name: "box" }, "127.0.0.1");
    expect(res.status).toBe(201);
    const { token } = (await res.json()) as { token: string };
    expect(typeof token).toBe("string");
    // The token authenticates as a real agent, so the row was written.
    const auth = await authenticate(token);
    expect(auth.agentId).toBeDefined();
  });

  it("refuses a non-loopback caller with node.enrol_not_local (negative control)", async () => {
    const { app, cfg } = buildApp();
    const res = await post(app, { name: "x" }, "192.168.1.50");
    expect(res.status).toBe(403);
    expect(await errorCodeOf(res)).toBe("node.enrol_not_local");
    // Refused before any database work, so no row exists.
    expect(await agentRowCount(cfg)).toBe(0);
  });

  it("refuses a request with NO remote address with node.enrol_not_local (fails closed)", async () => {
    // An unknown origin fails closed rather than being treated as loopback.
    const { app, cfg } = buildApp();
    const res = await post(app, { name: "x" }, undefined);
    expect(res.status).toBe(403);
    expect(await errorCodeOf(res)).toBe("node.enrol_not_local");
    // Refused before any database work, so no row exists.
    expect(await agentRowCount(cfg)).toBe(0);
  });

  it("accepts the IPv6 loopback forms", async () => {
    for (const addr of ["::1", "::ffff:127.0.0.1"]) {
      const { app } = buildApp();
      const res = await post(app, { name: "box" }, addr);
      expect(res.status).toBe(201);
    }
  });

  it("refuses on a non-primary node with node.enrol_unavailable", async () => {
    const { app, cfg } = buildApp({ isPrimary: false });
    const res = await post(app, { name: "x" }, "127.0.0.1");
    expect(res.status).toBe(409);
    expect(await errorCodeOf(res)).toBe("node.enrol_unavailable");
    expect(await agentRowCount(cfg)).toBe(0);
  });

  it("rate-limits a flood BEFORE touching the DB", async () => {
    // A limiter whose window is already full stands in for the request after a flood; a valid
    // loopback request on the primary must still draw a 429 and leave no row.
    const limiter: EnrolRateLimiter = {
      check() {
        throw new AppError("device.join_rate_limited", {});
      },
    };
    const { app, cfg } = buildApp({ limiter });
    const res = await post(app, { name: "box" }, "127.0.0.1");
    expect(res.status).toBe(429);
    expect(await errorCodeOf(res)).toBe("device.join_rate_limited");
    expect(await agentRowCount(cfg)).toBe(0);
  });
});
