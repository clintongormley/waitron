import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant, writeNodeMembership, type Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { decodeBatch, enrolPeer } from "@waitron/sync";
import { generateNodeKeyPair } from "@waitron/membership";
import type { Logger } from "./logger.js";
import { mountSyncApi } from "./sync-api.js";
import { ALL_SYNC_ENROLMENTS } from "./modules.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";

const log: Logger = () => {};
const NODE_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// A signed membership document at `term`, signed by node "A" with a generated identity key — the
// same shape membership-adopt.test.ts uses.
const membershipKeyPair = generateNodeKeyPair();
const membershipDoc = (term: number) => signedMembershipDoc(term, { keyPair: membershipKeyPair });

// A clone of the full-manifest template (`sync` last) for the peer lookups + /log read as a
// non-superuser app_user member; the pre-DB 401 cases are hermetic and never touch the DB.
// `app_login` and `sync_reader` (an app_user member) are created cluster-wide by the package
// globalSetup, in place of this suite's former per-file `setup` role creation. Peers are enrolled
// as `postgres.admin` (setup bypasses grants), then authenticated through a `sync_reader` pool —
// the real deployment shape (`app_user` holds SELECT + UPDATE(last_seen_at) on sync_peers).
const postgres = useTemplateDb({ template: "manifest" });

// A db whose every method throws: `requirePeer` must answer 401 BEFORE any DB work for a missing/blank
// Bearer, so if a pre-DB 401 path ever touched the db this would surface it (the catalogue-api "401
// before any DB work" convention).
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
  enrolments: ALL_SYNC_ENROLMENTS,
  moduleVersions: {},
};

describe("mountSyncApi peer auth + handshake", () => {
  it("refuses a missing, blank or non-Bearer token with 401 before any DB work", async () => {
    // A missing/blank Bearer (or a header that is not a Bearer scheme at all) parses to an empty token,
    // which `requirePeer` rejects BEFORE calling authenticatePeer — so the throwing db is never reached.
    // The wrong-but-present token case moved to a DB-backed test below (it now needs a lookup).
    const app = new Hono();
    mountSyncApi(app, deps, log); // deps.db is throwingDb
    const cases: Record<string, string>[] = [
      {}, // no Authorization header
      { Authorization: "Bearer " }, // blank Bearer
      { Authorization: "s3cret" }, // present but not a Bearer scheme
    ];
    for (const headers of cases) {
      const res = await app.request("/sync-api/log?after=0&limit=10", { headers });
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe("sync.node_unauthorized");
    }
  });

  it("refuses a well-formed but unknown Bearer token with 401 (the DB-backed rejection)", async () => {
    // A wrong-but-present token parses as a Bearer, so `requirePeer` calls authenticatePeer, which
    // finds no matching enrolled row and folds the miss into the SAME uniform sync.node_unauthorized
    // (oracle-free — the 401 confirms neither a peer's existence nor its revocation state). Enrol a real
    // peer so the table is non-empty, then present a syntactically valid `${uuid}.${secret}` bearer
    // whose selector matches no row.
    const reader = await postgres.pg.connectAs("sync_reader", "rp");
    try {
      await enrolPeer(postgres.admin, { subscriberId: "peerReal", name: "real" });
      const app = new Hono();
      mountSyncApi(
        app,
        {
          db: reader,
          tenantId: "t",
          nodeId: NODE_A,
          environment: "production",
          enrolments: ALL_SYNC_ENROLMENTS,
          moduleVersions: {},
        },
        log,
      );
      const garbage = "00000000-0000-4000-8000-000000000000.deadbeef";
      const res = await app.request("/sync-api/hello", {
        headers: { Authorization: `Bearer ${garbage}` },
      });
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe("sync.node_unauthorized");
    } finally {
      await reader.close();
    }
  });

  it("/sync-api/hello returns this node's id and environment behind a valid peer token", async () => {
    // /hello reads the held membership document through sync_applier, an app_user member with
    // SELECT on node_membership and sync_peers. With nothing adopted, membership is null; the
    // seeded case is the sibling test below.
    const pool = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const peer = await enrolPeer(postgres.admin, { subscriberId: "helloPeer", name: "hello" });
      const app = new Hono();
      // SP-2b: /hello advertises this node's per-module applied schema versions so a subscriber can
      // park a row whose owning module the source has migrated ahead of it. The handshake echoes the
      // injected map verbatim.
      const moduleVersions = { core: 3, payments: 1 };
      mountSyncApi(
        app,
        {
          db: pool,
          tenantId: "t",
          nodeId: "n",
          environment: "production",
          enrolments: ALL_SYNC_ENROLMENTS,
          moduleVersions,
        },
        log,
      );
      const missing = await app.request("/sync-api/hello", {});
      expect(missing.status).toBe(401); // /hello is behind the peer token too
      const res = await app.request("/sync-api/hello", {
        headers: { Authorization: `Bearer ${peer.token}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        nodeId: "n",
        environment: "production",
        membership: null,
        moduleVersions: { core: 3, payments: 1 },
      });
    } finally {
      await pool.close();
    }
  });

  it("/sync-api/hello serves the held membership document (seeded, not null)", async () => {
    // The handshake carries the held membership document (design §5), which the puller uses for
    // its accept check. Mount on sync_applier, an app_user member with SELECT on node_membership
    // and sync_peers. The sibling test
    //
    // already asserts membership: null, so this case starts from a seeded document.
    const pool = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const peer = await enrolPeer(postgres.admin, { subscriberId: "memPeer", name: "mem" });
      const app = new Hono();
      mountSyncApi(
        app,
        {
          db: pool,
          tenantId: "t",
          nodeId: "n",
          environment: "production",
          enrolments: ALL_SYNC_ENROLMENTS,
          moduleVersions: {},
        },
        log,
      );

      // Seeded via the owner/admin pool (writeNodeMembership is owner-role capable) → /hello serves
      // the WHOLE document, and { nodeId, environment } is still carried alongside.
      const document = membershipDoc(4);
      await writeNodeMembership(postgres.admin, document);
      const after = await app.request("/sync-api/hello", {
        headers: { Authorization: `Bearer ${peer.token}` },
      });
      expect(after.status).toBe(200);
      const afterBody = await after.json();
      expect(afterBody).toMatchObject({ nodeId: "n", environment: "production" });
      expect(afterBody.membership).toEqual(document);
    } finally {
      await postgres.admin.execute(sql`delete from node_membership`);
      await pool.close();
    }
  });

  it("/sync-api/log streams the tenant's captured rows as NDJSON with row_image as raw jsonb text", async () => {
    // Seed a tenant + a captured products write (numeric 1.50 as a jsonb number) under app_login, then
    // read it back through the mounted source as a sync_reader pool authenticated by an enrolled peer's
    // token. The bytes on the wire are the raw jsonb text — decodeBatch recovers "1.50" verbatim
    // (design §4b).
    const tenantId = await seedTenant(postgres.admin);
    const cat = await postgres.admin.execute<{ id: string }>(
      sql`insert into catalogues (tenant_id, name) values (${tenantId}, 'Deli') returning id`,
    );
    const catalogueId = cat.rows[0]!.id;
    // A genuine FAST-lane row to prove lane routing. The fast lane is exactly {payments,
    // payment_refunds} (registry.ts:153, pinned by registry.test.ts:164); `payment_policy` —
    // which the task brief mislabelled "fast" — is an ORDERED-lane table (registry.ts:162), so it
    // would prove nothing here. `payments` points at a working_order (payments_working_order_fk),
    // so seed the tenant→location→till→working_order chain as admin (pure setup, as
    // seedWorkingOrder does); the FK is satisfied cross-transaction by a committed working_orders
    // row.
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
      // (0001_payments_baseline_sql.sql:3) and the payments_capture AFTER-INSERT trigger writes it to sync_log
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
      // An enrolled peer's token authenticates the source group (the real deployment shape).
      const peer = await enrolPeer(postgres.admin, { subscriberId: "logPeer", name: "log" });
      const auth = { Authorization: `Bearer ${peer.token}` };
      const app = new Hono();
      mountSyncApi(
        app,
        {
          db: reader,
          tenantId,
          nodeId: NODE_A,
          environment: "production",
          enrolments: ALL_SYNC_ENROLMENTS,
          moduleVersions: {},
        },
        log,
      );
      const res = await app.request("/sync-api/log?after=0&limit=10", { headers: auth });
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
      const defaults = await app.request("/sync-api/log", { headers: auth });
      expect(defaults.status).toBe(200);
      expect(decodeBatch(await defaults.text()).some((r) => r.table === "products")).toBe(true);

      const filtered = await app.request(`/sync-api/log?originId=${NODE_A}&after=0&limit=10`, {
        headers: auth,
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
        const clamped = await app.request(`/sync-api/log?after=0&limit=${bad}`, { headers: auth });
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
          headers: auth,
        });
        expect(screened.status).toBe(200);
        expect(decodeBatch(await screened.text()).some((r) => r.table === "products")).toBe(true);
      }
      // A well-formed positive `?after=` is PRESERVED as the cursor (the afterSeq > 0 branch), never
      // clamped to 0: a value past every captured seq returns 200 with the products row filtered OUT —
      // proof the screen keeps a good cursor rather than collapsing everything to the start.
      const highCursor = await app.request(`/sync-api/log?after=999999999&limit=10`, {
        headers: auth,
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
        headers: auth,
      });
      expect(fast.status).toBe(200);
      const fastRows = decodeBatch(await fast.text());
      expect(fastRows.some((r) => r.table === "payments")).toBe(true);
      expect(fastRows.some((r) => r.table === "products")).toBe(false);

      // ?lane=ordered returns the ordered set: products present, payments absent. (Decode once — a
      // Response body is single-use.)
      const ordered = await app.request("/sync-api/log?after=0&limit=100&lane=ordered", {
        headers: auth,
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
          headers: auth,
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

  it("ownOriginOnly restricts /sync-api/log to this node's own origin, ignoring a foreign ?originId", async () => {
    // Seed one own-origin (NODE_A) products row and one FOREIGN-origin products row into sync_log via
    // the capture trigger — same seeding as the "/sync-api/log streams …" test above, but under two
    // different app.node_id GUCs so the two rows carry different origin_id. NODE_A is deps.nodeId; the
    // node happens to also hold a FOREIGN-origin row (a relayed row it must NOT re-serve when fenced).
    const FOREIGN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const tenantId = await seedTenant(postgres.admin);
    const cat = await postgres.admin.execute<{ id: string }>(
      sql`insert into catalogues (tenant_id, name) values (${tenantId}, 'Deli') returning id`,
    );
    const catalogueId = cat.rows[0]!.id;
    const app_ = await postgres.pg.connectAs("app_login", "app_pw");
    try {
      for (const origin of [NODE_A, FOREIGN]) {
        await withTenant(
          app_,
          tenantId,
          (tx) =>
            tx.execute(
              sql`insert into products (tenant_id, catalogue_id, descriptions, pricing_unit, unit_price, vat_class)
                  values (${tenantId}, ${catalogueId}, '{"en":"Coffee"}'::jsonb, 'each', 1.50::numeric(12,2), 'general')`,
            ),
          { nodeId: origin },
        );
      }
    } finally {
      await app_.close();
    }

    const reader = await postgres.pg.connectAs("sync_reader", "rp");
    try {
      const peer = await enrolPeer(postgres.admin, { subscriberId: "drainPeer", name: "drain" });
      const app = new Hono();
      mountSyncApi(
        app,
        {
          db: reader,
          tenantId,
          nodeId: NODE_A,
          environment: "production",
          enrolments: ALL_SYNC_ENROLMENTS,
          moduleVersions: {},
          ownOriginOnly: true,
        },
        log,
      );
      const auth = { Authorization: `Bearer ${peer.token}` };
      // Even explicitly asking for the FOREIGN origin, an own-origin-only source serves only NODE_A rows.
      const res = await app.request(`/sync-api/log?originId=${FOREIGN}&after=0&limit=100`, {
        headers: auth,
      });
      expect(res.status).toBe(200);
      const rows = decodeBatch(await res.text());
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.originId === NODE_A)).toBe(true);
    } finally {
      await reader.close();
    }
  });
});

describe("POST /sync-api/cursor — subscribers report their cursor to the source (spec §3.1)", () => {
  it("POST /sync-api/cursor is fail-closed on a missing token and never touches the DB", async () => {
    const app = new Hono();
    mountSyncApi(app, deps, log); // deps.db is throwingDb, no Authorization header
    const res = await app.request("/sync-api/cursor", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lane: "ordered", lastAppliedSeq: "5" }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("sync.node_unauthorized");
  });

  it("a peer can advance ONLY its own cursor — the body cannot name another subscriber (forge gap closed)", async () => {
    const tenantId = await seedTenant(postgres.admin);
    // Enrol two peers as admin (setup bypasses grants).
    const x = await enrolPeer(postgres.admin, { subscriberId: "peerX", name: "X" });
    await enrolPeer(postgres.admin, { subscriberId: "peerY", name: "Y" });

    const pool = await postgres.pg.connectAs("sync_reader", "rp"); // an app_user member
    try {
      const app = new Hono();
      mountSyncApi(
        app,
        {
          db: pool,
          tenantId,
          nodeId: NODE_A,
          environment: "production",
          enrolments: ALL_SYNC_ENROLMENTS,
          moduleVersions: {},
        },
        log,
      );

      // peerX presents its token but tries to move peerY's cursor via the (removed) body field.
      const res = await app.request("/sync-api/cursor", {
        method: "POST",
        headers: { Authorization: `Bearer ${x.token}`, "content-type": "application/json" },
        body: JSON.stringify({ subscriberId: "peerY", lane: "ordered", lastAppliedSeq: "999" }),
      });
      expect(res.status).toBe(200);

      // peerY's cursor was NEVER created; peerX's advanced to 999.
      const y = await postgres.admin.execute(
        sql`select 1 from sync_cursor where subscriber_id = 'peerY' and origin_id = ${NODE_A}::uuid and lane = 'ordered'`,
      );
      expect(y.rows.length).toBe(0);
      const xc = await postgres.admin.execute<{ s: string }>(
        sql`select last_applied_seq::text as s from sync_cursor where subscriber_id = 'peerX' and origin_id = ${NODE_A}::uuid and lane = 'ordered'`,
      );
      expect(xc.rows[0]!.s).toBe("999");
    } finally {
      await postgres.admin.execute(
        sql`delete from sync_cursor where subscriber_id in ('peerX', 'peerY')`,
      );
      await pool.close();
    }
  });

  it("POST /sync-api/cursor records against origin=self and the peer's own subscriberId (ignoring a peer-supplied origin)", async () => {
    const reader = await postgres.pg.connectAs("sync_reader", "rp");
    try {
      const peer = await enrolPeer(postgres.admin, { subscriberId: "peerB", name: "B" });
      const app = new Hono();
      mountSyncApi(
        app,
        {
          db: reader,
          tenantId: "t",
          nodeId: NODE_A,
          environment: "production",
          enrolments: ALL_SYNC_ENROLMENTS,
          moduleVersions: {},
        },
        log,
      );
      const res = await app.request("/sync-api/cursor", {
        method: "POST",
        headers: { Authorization: `Bearer ${peer.token}`, "content-type": "application/json" },
        // a hostile originId in the body must be IGNORED — the source stamps NODE_A; the subscriberId
        // comes from the token (peerB), never any body field.
        body: JSON.stringify({ originId: "deadbeef", lane: "fast", lastAppliedSeq: "7" }),
      });
      expect(res.status).toBe(200);
      const row = await postgres.admin.execute<{ origin: string; lane: string; seq: string }>(
        sql`select origin_id::text as origin, lane, last_applied_seq::text as seq
            from sync_cursor where subscriber_id = 'peerB'`,
      );
      expect(row.rows[0]).toMatchObject({ origin: NODE_A, lane: "fast", seq: "7" });
    } finally {
      await postgres.admin.execute(sql`delete from sync_cursor where subscriber_id = 'peerB'`);
      await reader.close();
    }
  });

  it("a non-JSON or empty body still records the peer's cursor at lane=ordered, seq=0 (the defensive parse)", async () => {
    // The body no longer carries subscriberId (it is derived from the authenticated token), so there is
    // no blank-subscriberId no-op branch any more. What remains to cover is the defensive
    // `c.req.json().catch(() => ({}))`: a non-JSON or empty body yields {}, so lane clamps to ordered
    // and seq screens to 0, and the cursor IS recorded under the authenticated peer.
    const reader = await postgres.pg.connectAs("sync_reader", "rp");
    try {
      const peer = await enrolPeer(postgres.admin, { subscriberId: "peerD", name: "D" });
      const app = new Hono();
      mountSyncApi(
        app,
        {
          db: reader,
          tenantId: "t",
          nodeId: NODE_A,
          environment: "production",
          enrolments: ALL_SYNC_ENROLMENTS,
          moduleVersions: {},
        },
        log,
      );
      const cases: (BodyInit | undefined)[] = [
        "not json at all", // body that is not JSON → catch → {}
        undefined, // empty body → catch → {}
      ];
      for (const body of cases) {
        const res = await app.request("/sync-api/cursor", {
          method: "POST",
          headers: { Authorization: `Bearer ${peer.token}`, "content-type": "application/json" },
          ...(body === undefined ? {} : { body }),
        });
        expect(res.status).toBe(200);
      }
      const row = await postgres.admin.execute<{ lane: string; seq: string }>(
        sql`select lane, last_applied_seq::text as seq from sync_cursor where subscriber_id = 'peerD'`,
      );
      expect(row.rows[0]).toMatchObject({ lane: "ordered", seq: "0" }); // clamped to defaults
    } finally {
      await postgres.admin.execute(sql`delete from sync_cursor where subscriber_id = 'peerD'`);
      await reader.close();
    }
  });

  it("clamps a non-string lane to ordered and a non-string seq to 0 (same fail-safe as /log)", async () => {
    // The defensive `typeof … === "string"` guards feed laneParam/afterSeq a value or undefined, so a
    // numeric `lane`/`lastAppliedSeq` (a malformed peer) clamps to the safe default rather than 500ing:
    // lane → "ordered", seq → 0. Same no-400 posture the /log route takes for its query params.
    const reader = await postgres.pg.connectAs("sync_reader", "rp");
    try {
      const peer = await enrolPeer(postgres.admin, { subscriberId: "peerC", name: "C" });
      const app = new Hono();
      mountSyncApi(
        app,
        {
          db: reader,
          tenantId: "t",
          nodeId: NODE_A,
          environment: "production",
          enrolments: ALL_SYNC_ENROLMENTS,
          moduleVersions: {},
        },
        log,
      );
      const res = await app.request("/sync-api/cursor", {
        method: "POST",
        headers: { Authorization: `Bearer ${peer.token}`, "content-type": "application/json" },
        body: JSON.stringify({ lane: 123, lastAppliedSeq: 456 }),
      });
      expect(res.status).toBe(200);
      const row = await postgres.admin.execute<{ lane: string; seq: string }>(
        sql`select lane, last_applied_seq::text as seq from sync_cursor where subscriber_id = 'peerC'`,
      );
      expect(row.rows[0]).toMatchObject({ lane: "ordered", seq: "0" }); // both clamped to their defaults
    } finally {
      await postgres.admin.execute(sql`delete from sync_cursor where subscriber_id = 'peerC'`);
      await reader.close();
    }
  });
});
