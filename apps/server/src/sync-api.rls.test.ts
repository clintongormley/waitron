import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant, type Database } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { decodeBatch } from "@waitron/sync";
import type { Logger } from "./logger.js";
import { mountSyncApi } from "./sync-api.js";
import { startRealPostgres } from "./testing/postgres.js";

const log: Logger = () => {};
const NODE_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// Real Postgres (full manifest, `sync` last) for the /log read as a non-superuser sync_tailer member;
// the auth + /hello tests are hermetic and never touch the DB, but the container is needed for /log.
const postgres = useRealPostgres({
  start: startRealPostgres,
  setup: async ({ admin }) => {
    await admin.execute(sql.raw(`create role app_login login password 'app_pw' in role app_user`));
    await admin.execute(sql.raw(`create role sync_reader login password 'rp'`));
    await admin.execute(sql.raw(`grant sync_tailer to sync_reader`));
  },
  timeoutMs: 180_000,
});

// A db whose every method throws: the auth guard must answer 401 BEFORE any DB work, so if a 401 path
// ever touched the db this would surface it (the catalogue-api "401 before any DB work" convention).
const throwingDb = {
  transaction: () => {
    throw new Error("db reached");
  },
  execute: () => {
    throw new Error("db reached");
  },
} as unknown as Database;
const deps = {
  db: throwingDb,
  tenantId: "t",
  nodeId: "n",
  environment: "production",
  nodeToken: "s3cret",
};

describe("mountSyncApi node-token auth + handshake", () => {
  it("refuses a missing, blank or wrong Bearer token with 401 (fail-closed), never touching the DB", async () => {
    const app = new Hono();
    mountSyncApi(app, deps, log);
    const cases: Record<string, string>[] = [
      {},
      { Authorization: "Bearer " },
      { Authorization: "Bearer wrong" },
      { Authorization: "s3cret" }, // present but not a Bearer scheme
    ];
    for (const headers of cases) {
      const res = await app.request("/sync-api/log?after=0&limit=10", { headers });
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe("sync.node_unauthorized");
    }
  });

  it("/sync-api/hello returns this node's id and environment (still behind the token)", async () => {
    const app = new Hono();
    mountSyncApi(app, deps, log);
    const missing = await app.request("/sync-api/hello", {});
    expect(missing.status).toBe(401); // /hello is behind the token too
    const res = await app.request("/sync-api/hello", {
      headers: { Authorization: "Bearer s3cret" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ nodeId: "n", environment: "production" });
  });

  it("/sync-api/log streams the tenant's captured rows as NDJSON with row_image as raw jsonb text", async () => {
    // Seed a tenant + a captured products write (numeric 1.50 as a jsonb number) under app_login, then
    // read it back through the mounted source as a sync_reader pool with a good token. The bytes on the
    // wire are the raw jsonb text — decodeBatch recovers "1.50" verbatim (design §4b).
    const tenantId = await seedTenant(postgres.admin);
    const cat = await postgres.admin.execute<{ id: string }>(
      sql`insert into catalogues (tenant_id, name) values (${tenantId}, 'Deli') returning id`,
    );
    const catalogueId = cat.rows[0]!.id;
    const app_ = await postgres.pg.connectAs("app_login", "app_pw");
    try {
      await withTenant(
        app_,
        tenantId,
        (tx) =>
          tx.execute(
            sql`insert into products (tenant_id, catalogue_id, descriptions, pricing_unit, unit_price, vat_class)
                values (${tenantId}, ${catalogueId}, '{"en":"Coffee"}'::jsonb, 'each', 1.50::numeric(12,2), 'general')`,
          ),
        { nodeId: NODE_A },
      );
    } finally {
      await app_.close();
    }

    const reader = await postgres.pg.connectAs("sync_reader", "rp");
    try {
      const app = new Hono();
      mountSyncApi(
        app,
        { db: reader, tenantId, nodeId: NODE_A, environment: "production", nodeToken: "s3cret" },
        log,
      );
      const res = await app.request("/sync-api/log?after=0&limit=10", {
        headers: { Authorization: "Bearer s3cret" },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/x-ndjson");
      const rows = decodeBatch(await res.text());
      const product = rows.find((r) => r.table === "products")!;
      expect(product).toBeDefined();
      expect(typeof product.rowImage).toBe("string");
      expect(product.rowImage).toContain("1.50"); // raw jsonb text, never re-quoted to 1.5
      expect(product.originId).toBe(NODE_A);

      // No after/limit params → the route's own defaults (after=0, limit=500) apply and still return
      // the row; and an originId filter for NODE_A returns the products row (its origin), exercising
      // the query-parameter branches.
      const defaults = await app.request("/sync-api/log", {
        headers: { Authorization: "Bearer s3cret" },
      });
      expect(defaults.status).toBe(200);
      expect(decodeBatch(await defaults.text()).some((r) => r.table === "products")).toBe(true);

      const filtered = await app.request(`/sync-api/log?originId=${NODE_A}&after=0&limit=10`, {
        headers: { Authorization: "Bearer s3cret" },
      });
      const filteredRows = decodeBatch(await filtered.text());
      expect(filteredRows.length).toBeGreaterThanOrEqual(1);
      expect(filteredRows.every((r) => r.originId === NODE_A)).toBe(true); // the origin filter bit

      // A malformed `?limit=` clamps to the default instead of reaching Postgres as `LIMIT NaN` (a
      // non-numeric limit), `LIMIT 0`, or a negative/fractional limit — each of which the plain
      // `Number(...)` would have passed straight through to a query error -> an opaque 500 (fix:
      // logLimit). The two directions differ visibly (CLAUDE.md §1): every bad value still serves the
      // row with 200; without the clamp `?limit=abc` is a 500.
      for (const bad of ["abc", "0", "-5", "1.5", ""]) {
        const clamped = await app.request(`/sync-api/log?after=0&limit=${bad}`, {
          headers: { Authorization: "Bearer s3cret" },
        });
        expect(clamped.status).toBe(200);
        expect(decodeBatch(await clamped.text()).some((r) => r.table === "products")).toBe(true);
      }
    } finally {
      await reader.close();
    }
  });
});
