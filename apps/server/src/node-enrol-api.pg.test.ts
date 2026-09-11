import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { authenticateAgent } from "@waitron/printing";
import { AppError } from "@waitron/shared";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import { mountNodeEnrolApi } from "./node-enrol-api.js";
import type { EnrolRateLimiter } from "./enrol-rate-limit.js";
import type { TillConfig } from "./till-config.js";
import type { Logger } from "./logger.js";
import "./errors.js";

// Real Postgres (a manifest template clone), NOT PGlite — the enrol WRITES a `print_agents` row as
// `app_user` under `withTenant`, so the table grant is the property under test; PGlite's all-superuser
// connection would false-pass a missing GRANT (CLAUDE.md §4). The sibling `print-api.pg.test.ts` uses
// the same `useTemplateDb`/`seedTenantWithLocation` shape.
const noopLog: Logger = () => {};

const suite = useTemplateDb({ template: "manifest" });

interface Tenant {
  tenantId: string;
  locationId: string;
}

// Tenants accumulate for the life of the shared clone and `tenants_country_tax_id_key` is unique, so
// each needs its own NIF — the per-suite counter the sibling real-Postgres suites use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(78_000_000 + nifCounter).padStart(8, "0")}K`;
}

async function seedTenantWithLocation(): Promise<Tenant> {
  const tenantId = randomUUID();
  await suite.admin.execute(sql`
    insert into tenants (id, country, tax_id, legal_name)
    values (${tenantId}, 'ES', ${nextNif()}, 'Deli Test SL')`);
  const loc = await suite.admin.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array['es-ES'], 'Venta en establecimiento') returning id`);
  return { tenantId, locationId: loc.rows[0]!.id };
}

let tenantA: Tenant;

beforeAll(async () => {
  tenantA = await seedTenantWithLocation();
});

/** The FULL TillConfig for the seeded tenant. Only tenantId/locationId are read by `selfEnrolNodeAgent`
 * and nodeId is what the row is keyed by; the fiscal ids are unused, so branded random uuids stand in.
 * A FRESH nodeId per call keeps each mounted app's enrol row independent across the shared clone. */
function cfgOf(tenant: Tenant): TillConfig {
  return {
    tenantId: brandTenantId(tenant.tenantId),
    tillId: brandTillId(randomUUID()),
    nodeId: brandNodeId(randomUUID()),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(tenant.locationId),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "ticket_then_pay",
  };
}

/** The enrol route mounted over the REAL app-role pool (`suite.admin`), scoped to a fresh cfg. */
function buildApp(opts: { isPrimary?: boolean; limiter?: EnrolRateLimiter } = {}): {
  app: Hono;
  cfg: TillConfig;
} {
  const cfg = cfgOf(tenantA);
  const app = new Hono();
  mountNodeEnrolApi(
    app,
    {
      db: suite.admin,
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
async function authenticate(cfg: TillConfig, token: string): Promise<{ agentId: string }> {
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return authenticateAgent(tx, { tenantId: cfg.tenantId }, token);
  });
}

/** How many print_agents rows this node holds — read as the superuser, so the assertion is about the
 *  table and not about what the route chose to return. */
async function agentRowCount(cfg: TillConfig): Promise<number> {
  const { rows } = await suite.admin.execute<{ n: number }>(
    sql`select count(*)::int as n from print_agents where tenant_id = ${cfg.tenantId} and node_id = ${cfg.nodeId}`,
  );
  return rows[0]!.n;
}

describe("POST /api/node/enrol-self", () => {
  it("enrols the caller as a print agent over loopback on the primary", async () => {
    const { app, cfg } = buildApp();
    const res = await post(app, { name: "box" }, "127.0.0.1");
    expect(res.status).toBe(201);
    const { token } = (await res.json()) as { token: string };
    expect(typeof token).toBe("string");
    // The token authenticates as a real agent — the row was truly written under `app_user`.
    const auth = await authenticate(cfg, token);
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
