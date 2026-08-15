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
    // A genuine FAST-lane row to prove lane routing. The fast lane is exactly {payments,
    // payment_refunds} (registry.ts:153, pinned by registry.test.ts:164); `payment_policy` — which the
    // task brief mislabelled "fast" — is an ORDERED-lane table (registry.ts:162), so it would prove
    // nothing here. `payments` points at a working_order (payments_working_order_fk), so seed the
    // tenant→location→till→working_order chain as admin (RLS bypassed, pure setup, as seedWorkingOrder
    // does); the FK is satisfied cross-transaction by a committed working_orders row.
    const loc = await postgres.admin.execute<{ id: string }>(
      sql`insert into locations (tenant_id, name, invoice_locales, operation_description)
          values (${tenantId}, 'Counter', array['es'], 'Retail') returning id`,
    );
    const locationId = loc.rows[0]!.id;
    const till = await postgres.admin.execute<{ id: string }>(
      sql`insert into tills (tenant_id, location_id, name)
          values (${tenantId}, ${locationId}, 'Till 1') returning id`,
    );
    const tillId = till.rows[0]!.id;
    const wo = await postgres.admin.execute<{ id: string }>(
      sql`insert into working_orders (tenant_id, till_id, order_number)
          values (${tenantId}, ${tillId}, 1) returning id`,
    );
    const workingOrderId = wo.rows[0]!.id;
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
      // A captured FAST-lane payments row (same origin NODE_A). app_user holds INSERT on payments
      // (0001_payments_rls.sql:30) and the payments_capture AFTER-INSERT trigger writes it to sync_log
      // with origin_id = the app.node_id GUC withTenant set.
      await withTenant(
        app_,
        tenantId,
        (tx) =>
          tx.execute(
            sql`insert into payments (tenant_id, working_order_id, provider, payment_ref, amount, state)
                values (${tenantId}, ${workingOrderId}, 'stripe', 'ref-fast', '5.00', 'captured')`,
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

      // A malformed `?after=` screens to seq 0 (serve from the start) instead of reaching `BigInt(...)`
      // as a throw -> an opaque 500 (fix: afterSeq, the sibling of logLimit). Same two-direction shape
      // as the limit clamp above (CLAUDE.md §1): `abc`/`1.5` throw inside `BigInt(...)` and are a 500
      // without the screen, `-5` is a valid-but-negative cursor, and `""`/absent already mean 0
      // (`BigInt("")` is 0n) — every one now serves the products row with 200 from seq 0.
      for (const bad of ["abc", "1.5", "-5", ""]) {
        const screened = await app.request(`/sync-api/log?after=${bad}&limit=10`, {
          headers: { Authorization: "Bearer s3cret" },
        });
        expect(screened.status).toBe(200);
        expect(decodeBatch(await screened.text()).some((r) => r.table === "products")).toBe(true);
      }
      // A well-formed positive `?after=` is PRESERVED as the cursor (the afterSeq > 0 branch), never
      // clamped to 0: a value past every captured seq returns 200 with the products row filtered OUT —
      // proof the screen keeps a good cursor rather than collapsing everything to the start.
      const highCursor = await app.request(`/sync-api/log?after=999999999&limit=10`, {
        headers: { Authorization: "Bearer s3cret" },
      });
      expect(highCursor.status).toBe(200);
      expect(decodeBatch(await highCursor.text()).some((r) => r.table === "products")).toBe(false);

      // ── Lane routing (Task 7) ────────────────────────────────────────────────────────────────
      // The server maps ?lane= → tablesForLane(lane) SERVER-SIDE; the client never supplies a table
      // list (spec §4c). `payments` is the fast lane, `products` the ordered lane (see the seed
      // comment above for why `payments`, not the brief's `payment_policy`).
      //
      // ?lane=fast returns ONLY the fast-lane tables: the payments row is present, products is NOT.
      const fast = await app.request("/sync-api/log?after=0&limit=100&lane=fast", {
        headers: { Authorization: "Bearer s3cret" },
      });
      expect(fast.status).toBe(200);
      const fastRows = decodeBatch(await fast.text());
      expect(fastRows.some((r) => r.table === "payments")).toBe(true);
      expect(fastRows.some((r) => r.table === "products")).toBe(false);

      // ?lane=ordered returns the ordered set: products present, payments absent. (Decode once — a
      // Response body is single-use.)
      const ordered = await app.request("/sync-api/log?after=0&limit=100&lane=ordered", {
        headers: { Authorization: "Bearer s3cret" },
      });
      expect(ordered.status).toBe(200);
      const orderedRows = decodeBatch(await ordered.text());
      expect(orderedRows.some((r) => r.table === "products")).toBe(true);
      expect(orderedRows.some((r) => r.table === "payments")).toBe(false);

      // An unknown or MISSING lane CLAMPS to ordered (fail-safe, spec §4c): garbage returns the
      // ordered set, never the fast one, and never a 400 (no param-invalid convention, as with
      // after/limit). The two directions differ visibly (CLAUDE.md §1): a fast lane shows payments and
      // hides products; every clamp case shows the reverse.
      for (const bad of ["lane=weird", "lane=", ""]) {
        const clamped = await app.request(`/sync-api/log?after=0&limit=100&${bad}`, {
          headers: { Authorization: "Bearer s3cret" },
        });
        expect(clamped.status).toBe(200);
        const rows = decodeBatch(await clamped.text());
        expect(rows.some((r) => r.table === "products")).toBe(true); // ordered tables never vanish
        expect(rows.some((r) => r.table === "payments")).toBe(false);
      }
    } finally {
      await reader.close();
    }
  });
});
