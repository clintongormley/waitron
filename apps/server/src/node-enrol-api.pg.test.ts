import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, locations, tenants, withTransaction } from "@waitron/db";
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

/**
 * The loopback self-enrol route, on the engine the box now runs.
 *
 * ## What the conversion took away, and nothing replaces it
 *
 * The old header argued real PostgreSQL rather than PGlite was required here, because the enrol
 * WRITES a `print_agents` row as `app_user` under `withTransaction`, and only a real cluster would
 * refuse a missing table GRANT. **SQLite has no roles and no grants**: one process opens one file
 * and `asAppUser` is an empty function body (`packages/db/src/testing/roles.ts:25`). Whether the
 * deployment role may write `print_agents` is no longer a question this file, or any file, asks.
 *
 * The six cases below are unaffected, because none of them was about the grant: five are gates
 * that refuse BEFORE any database work (loopback, absent address, non-primary, rate limit) and the
 * sixth checks that a minted token authenticates.
 */
const noopLog: Logger = () => {};

// `resetPerTest: false` because the tenant and its location are seeded ONCE in `beforeAll` below
// and every case reads them; a per-test reset would empty both out from under the second case.
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});

interface Tenant {
  locationId: string;
}

// `tenants_country_tax_id_key` is unique, so a NIF is minted per call rather than written out. One
// call is made today, from the `beforeAll` below; the counter is what keeps a second one honest.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(78_000_000 + nifCounter).padStart(8, "0")}K`;
}

async function seedTenantWithLocation(): Promise<Tenant> {
  // Both rows go in through their table definitions, the same change
  // `packages/db/src/testing/seed.ts` took: `tenants.created_at` and `locations.id` are
  // `$defaultFn` values on this engine rather than SQL DEFAULTs, which a raw insert never reaches,
  // and `array['es-ES']` is PostgreSQL array syntax the engine refuses at prepare.
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

/** The FULL TillConfig for the seeded venue. Only locationId is read by `selfEnrolNodeAgent`
 * and nodeId is what the row is keyed by; the fiscal ids are unused, so branded random uuids stand in.
 * A FRESH nodeId per call keeps each mounted app's enrol row independent, which matters because
 * this suite does not reset between tests. */
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

/** The enrol route mounted over the venue handle, scoped to a fresh cfg. */
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

/** Issue the POST, driving the peer address the way `getConnInfo` reads it — `c.env.incoming.socket.
 *  remoteAddress`, set here as the third `app.request` argument (Hono passes it through as `c.env`).
 *  This is the same channel `@hono/node-server` fills from the real socket at boot. */
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

/** Resolve a minted agent token to its row id under the tenant — the production auth path. */
async function authenticate(token: string): Promise<{ agentId: string }> {
  return withTransaction(suite.db, async (tx) => {
    await asAppUser(tx);
    return authenticateAgent(tx, token);
  });
}

/** How many print_agents rows this node holds — read straight off the table, so the assertion is
 *  about what landed and not about what the route chose to return. */
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
    // The token authenticates as a real agent — the row was truly written under `app_user`.
    const auth = await authenticate(token);
    expect(auth.agentId).toBeDefined();
  });

  it("refuses a non-loopback caller with node.enrol_not_local (negative control)", async () => {
    const { app, cfg } = buildApp();
    const res = await post(app, { name: "x" }, "192.168.1.50");
    expect(res.status).toBe(403);
    expect(await errorCodeOf(res)).toBe("node.enrol_not_local");
    // Refused for the RIGHT reason — before any DB work, so no row exists (CLAUDE.md §1 control).
    expect(await agentRowCount(cfg)).toBe(0);
  });

  it("refuses a request with NO remote address with node.enrol_not_local (fails closed)", async () => {
    // `getConnInfo` can hand back an undefined address (no socket, a proxy that dropped it); the gate
    // (`address === undefined || !LOOPBACK.has(address)`) fails CLOSED to the manual path rather than
    // treating an unknown origin as loopback (spec §2). No test pinned this branch before.
    const { app, cfg } = buildApp();
    const res = await post(app, { name: "x" }, undefined);
    expect(res.status).toBe(403);
    expect(await errorCodeOf(res)).toBe("node.enrol_not_local");
    // Refused before any DB work, so no row exists (CLAUDE.md §1 control).
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
    // The primary gate refuses before the write, so a mirror leaves no row behind.
    expect(await agentRowCount(cfg)).toBe(0);
  });

  it("rate-limits a flood BEFORE touching the DB", async () => {
    // A limiter whose window is already full: `check()` throws on the very first call, standing in for
    // the (N+1)th request of a flood. The refusal must precede the loopback gate, the primary gate and
    // the write, so a valid loopback+primary request still draws a 429 and leaves no row.
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
