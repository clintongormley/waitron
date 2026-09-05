import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { captureError, withTenant, type Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { enrolPeer, syncPullOnce, type HttpClient } from "@waitron/sync";
import type { Logger } from "./logger.js";
import { mountSyncApi } from "./sync-api.js";
import { ALL_MODULES } from "./modules.js";
// The assembled module sync-enrolment set, injected into mountSyncApi/runSyncPull the way boot does
// (SP-2a inversion): @waitron/sync no longer owns it.
const SYNC_ENROLMENT = ALL_MODULES.flatMap((m) => m.sync ?? []);

// Two-node end-to-end (design §5, §7). TWO manifest-migrated databases in the shared container, each
// a `useTemplateDb` clone of the `manifest` template — `source` and `target` — are the minimum that
// proves genuine CROSS-DB apply: two independent sync_log/sync_cursor states. Calling `useTemplateDb`
// twice is how the harness gives a suite two managed databases; each clone is created and dropped by
// its own hooks. The roles (app_user/sync_tailer members) are cluster-global (created once by the
// package globalSetup), so one set serves both databases. The HTTP wire is a real Hono `app.request`
// (a real Request/Response carrying the exact NDJSON bytes) — a bound socket is deployment #9's TLS
// concern; byte-identity is a property of the bytes, not the socket. Both sides act as the
// non-superuser sync_reader/sync_applier under FORCE RLS (PGlite would be a false pass, CLAUDE.md §4).
const log: Logger = () => {};

// Sync node ids (the origin markers + cursor keys), distinct from the nodes-table FK below.
const NODE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // the source (producer)
const SUB_MAIN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // target subscriber (main test)
const SUB_MISMATCH = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; // target subscriber (env-mismatch test)

// Fixed FK-parent ids seeded identically on BOTH databases so a source sale applies against real
// parents on the target (in real active-active these rows sync too; here they are seeded directly).
const TENANT = "11111111-1111-4111-8111-111111111111";
const LOCATION = "22222222-2222-4222-8222-222222222222";
const TILL = "33333333-3333-4333-8333-333333333333";
const NODE = "44444444-4444-4444-8444-444444444444";
const SERIES = "55555555-5555-4555-8555-555555555555";
// The ordered-lane FK parent a fast-lane payment references (payments.working_order_id NOT NULL →
// working_orders). Seeded directly on BOTH DBs so the source can capture a payment referencing it and
// the target's FK resolves without a cross-lane 23503 park (that park is proven in the apply/pull
// suites; this e2e is the two-lane composition proof, spec §8/§4e).
const WORKING_ORDER = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";

const source = useTemplateDb({ template: "manifest" });
const target = useTemplateDb({ template: "manifest" });

let targetAdmin: Database;
let targetApplier: Database;
let sourceReader: Database;
let sourceWriter: Database;
// The Bearer token a subscriber presents to the source. It must be one an `enrolPeer` minted on the
// SOURCE (spec §9): the mounted source authenticates every /hello + /log request against source's
// `sync_peers` through `sourceReader` (a sync_tailer + app_user member — the production source serve
// pool, boot.ts:1053; app_user is needed for the /hello node_membership read). The peer's own subscriber_id is
// irrelevant to /hello + /log — they need only a valid peer — so one enrolment serves every pull below.
let sourcePeerToken: string;

/** Seed the FK parents (tenant, location, till, node, series) with the fixed ids on one database.
 * None of these tables is enrolled, so this captures no sync_log rows. */
async function seedParents(admin: Database): Promise<void> {
  await admin.execute(sql`insert into tenants (id, country, tax_id, legal_name)
    values (${TENANT}, 'ES', '90111111K', 'E2E SL') on conflict do nothing`);
  await admin.execute(sql`insert into locations (id, tenant_id, name, invoice_locales, operation_description)
    values (${LOCATION}, ${TENANT}, 'Loc', array['en']::text[], 'Hospitality') on conflict do nothing`);
  await admin.execute(sql`insert into tills (id, tenant_id, location_id, name)
    values (${TILL}, ${TENANT}, ${LOCATION}, 'Till') on conflict do nothing`);
  await admin.execute(sql`insert into nodes (id, tenant_id, location_id, name)
    values (${NODE}, ${TENANT}, ${LOCATION}, 'Node') on conflict do nothing`);
  await admin.execute(sql`insert into invoice_series (id, tenant_id, node_id, code)
    values (${SERIES}, ${TENANT}, ${NODE}, 'A') on conflict do nothing`);
  // working_orders IS enrolled (ordered lane), but this admin insert runs with no app.node_id GUC, so
  // sync_capture stamps origin_id = the all-zero uuid — excluded from every ?originId=NODE_A pull, so
  // it never rides either lane under test. It exists only as the FK parent a captured payment needs.
  await admin.execute(sql`insert into working_orders (id, tenant_id, till_id, order_number)
    values (${WORKING_ORDER}, ${TENANT}, ${TILL}, 1) on conflict do nothing`);
}

/** Stamp a database's singleton deployment.environment. */
async function stampEnv(db: Database, environment: "production" | "preproduction"): Promise<void> {
  await db.execute(sql`insert into deployment (id, environment) values (1, ${environment})
    on conflict (id) do update set environment = excluded.environment`);
}

/** Capture a sale on the SOURCE under withTenant{nodeId: NODE_A} — sync_capture writes it to
 * source.sync_log with origin_id = NODE_A. vat_breakdown carries a jsonb NUMBER 1.50 (scale preserved)
 * so the byte-identity property is observable end-to-end (a JS re-parse would collapse it to 1.5). */
async function captureSaleOnSource(saleId: string, invoiceNumber: number): Promise<void> {
  await withTenant(
    sourceWriter,
    TENANT,
    (tx) =>
      tx.execute(sql`insert into sales
        (id, tenant_id, till_id, series_id, node_id, invoice_number, issued_at,
         issued_offset_minutes, total, vat_breakdown, locale, invoice_locales,
         fiscal_backend, fiscal_state)
        values (${saleId}, ${TENANT}, ${TILL}, ${SERIES}, ${NODE}, ${invoiceNumber},
                '2026-08-11T10:00:00+00:00', 60, '10.00', '[1.50]'::jsonb, 'en', array['en']::text[],
                'fake', 'not_applicable')`),
    { nodeId: NODE_A },
  );
}

/** The HTTP seam: a real Hono app.request against a mounted source, advertising `environment` on /hello. */
function sourceHttp(environment: "production" | "preproduction"): HttpClient {
  const app = new Hono();
  mountSyncApi(
    app,
    { db: sourceReader, tenantId: TENANT, nodeId: NODE_A, environment, enrolments: SYNC_ENROLMENT },
    log,
  );
  return (url, init) => Promise.resolve(app.request(url, { headers: init.headers }));
}

const targetSaleCount = async (id: string): Promise<string> => {
  const r = await targetAdmin.execute<{ v: string }>(
    sql`select count(*)::int::text as v from sales where id = ${id}`,
  );
  return r.rows[0]!.v;
};

/** Capture a payment on the SOURCE under withTenant{nodeId: NODE_A} — sync_capture writes it to
 * source.sync_log with origin_id = NODE_A on the FAST lane (payments/payment_refunds, spec §4b). Only
 * the NOT-NULL columns are supplied: created_at/updated_at default, and sale_id/node_id/external_ref/…
 * are nullable (payments.ts). working_order_id points at the directly-seeded parent so the source FK
 * (and the target's, on apply) resolves. */
async function capturePaymentOnSource(paymentId: string): Promise<void> {
  await withTenant(
    sourceWriter,
    TENANT,
    (tx) =>
      tx.execute(sql`insert into payments
        (id, tenant_id, working_order_id, provider, payment_ref, amount, state)
        values (${paymentId}, ${TENANT}, ${WORKING_ORDER}, 'stripe', ${paymentId}, '10.00', 'captured')`),
    { nodeId: NODE_A },
  );
}

const targetPaymentCount = async (id: string): Promise<string> => {
  const r = await targetAdmin.execute<{ v: string }>(
    sql`select count(*)::int::text as v from payments where id = ${id}`,
  );
  return r.rows[0]!.v;
};

beforeAll(async () => {
  await seedParents(source.admin); // source parents
  targetAdmin = target.admin;
  await seedParents(targetAdmin); // the SAME parents on the target so the sale's FKs resolve
  targetApplier = await target.pg.connectAs("sync_applier", "ap");
  sourceReader = await source.pg.connectAs("sync_applier", "ap");
  sourceWriter = await source.pg.connectAs("app_login", "app_pw");
  // Mint the subscriber's Bearer token on the SOURCE (enrolPeer runs as the superuser admin — setup
  // bypasses grants). Every `peer` below presents this token; the mounted source resolves it to this
  // enrolled row via sourceReader on each /hello + /log call.
  sourcePeerToken = (await enrolPeer(source.admin, { subscriberId: "e2e-mirror", name: "e2e" }))
    .token;
});

afterAll(async () => {
  // Only the `connectAs` handles this suite opened need closing here; the two admin connections and
  // both clone databases are owned and torn down by the two `useTemplateDb` calls. `targetAdmin` is
  // `target.admin`, so it must NOT be closed here — that would double-close.
  if (sourceWriter !== undefined) await sourceWriter.close();
  if (sourceReader !== undefined) await sourceReader.close();
  if (targetApplier !== undefined) await targetApplier.close();
});

describe("two-node sync end-to-end over a real HTTP wire", () => {
  it("captures on the source, pulls over HTTP into the target, advances the cursor, and redelivers idempotently", async () => {
    await stampEnv(targetAdmin, "production");
    const saleId = "66666666-6666-4666-8666-666666666666";
    await captureSaleOnSource(saleId, 1);

    const deps = {
      localDb: targetApplier,
      subscriberId: SUB_MAIN,
      tenantId: TENANT,
      localEnvironment: "production",
      http: sourceHttp("production"),
      batchLimit: 500,
      enrolments: SYNC_ENROLMENT,
    };
    const peer = { nodeId: NODE_A, url: "", token: sourcePeerToken };

    const first = await syncPullOnce(deps, peer);
    expect(first.applied).toBeGreaterThanOrEqual(1);

    // Byte-identity across the HTTP wire: the numeric survives verbatim. total is numeric(12,2) (a
    // fixed scale), but vat_breakdown is jsonb (stored verbatim) — 1.50, never re-quoted to 1.5.
    const landed = await targetAdmin.execute<{ total: string; vat0: string }>(
      sql`select total::text as total, vat_breakdown->>0 as vat0 from sales where id = ${saleId}`,
    );
    expect(landed.rows[0]!.total).toBe("10.00");
    expect(landed.rows[0]!.vat0).toBe("1.50");

    // The cursor advanced to the source's max seq for this origin.
    const sourceMax = await source.admin.execute<{ seq: string }>(
      sql`select max(seq)::text as seq from sync_log where origin_id = ${NODE_A}::uuid`,
    );
    const cursor = await targetAdmin.execute<{ seq: string }>(
      sql`select last_applied_seq::text as seq from sync_cursor
          where subscriber_id = ${SUB_MAIN} and origin_id = ${NODE_A}::uuid`,
    );
    expect(cursor.rows[0]!.seq).toBe(sourceMax.rows[0]!.seq);

    // Redeliver the same range: a clean idempotent no-op.
    const second = await syncPullOnce(deps, peer);
    expect(second.applied).toBe(0);
  });

  it("refuses a peer in a different environment before applying anything, and applies once they match", async () => {
    const saleId = "77777777-7777-4777-8777-777777777777";
    await captureSaleOnSource(saleId, 2);

    // Target stamped preproduction, source advertises production → applyBatch throws before applying.
    await stampEnv(targetAdmin, "preproduction");
    const mismatched = {
      localDb: targetApplier,
      subscriberId: SUB_MISMATCH,
      tenantId: TENANT,
      localEnvironment: "preproduction",
      http: sourceHttp("production"),
      batchLimit: 500,
      enrolments: SYNC_ENROLMENT,
    };
    const peer = { nodeId: NODE_A, url: "", token: sourcePeerToken };
    const err = await captureError(() => syncPullOnce(mismatched, peer));
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("sync.peer_environment_mismatch");
    expect(await targetSaleCount(saleId)).toBe("0"); // nothing applied under the mismatch

    // Control (both directions, CLAUDE.md §1): with matching environments the SAME pull lands the row.
    await stampEnv(targetAdmin, "production");
    const matched = {
      ...mismatched,
      localEnvironment: "production",
      http: sourceHttp("production"),
    };
    const applied = await syncPullOnce(matched, peer);
    expect(applied.applied).toBeGreaterThanOrEqual(1);
    expect(await targetSaleCount(saleId)).toBe("1"); // now it is on the target
  });

  it("two lanes land their own tables on independent cursors over the HTTP wire (spec §8)", async () => {
    // The fast lane (?lane=fast) carries ONLY payments/payment_refunds; the ordered lane (?lane=ordered)
    // carries the rest. Capture a sale AND a payment on the source, then pull each lane: the payment
    // lands on the fast cursor, the sale on the ordered cursor, and the two (subscriber, origin) cursor
    // rows advance INDEPENDENTLY. This is the full composition — sync-api ?lane= (Task 7) → source table
    // filter (Task 4) → pull lane (Task 6) → apply lane cursor (Task 5) — over a real Hono app.request.
    await stampEnv(targetAdmin, "production");
    const saleId = "88888888-8888-4888-8888-888888888888";
    const paymentId = "99999999-9999-4999-8999-999999999999";
    await captureSaleOnSource(saleId, 3);
    await capturePaymentOnSource(paymentId);

    const base = {
      localDb: targetApplier,
      subscriberId: SUB_MAIN,
      tenantId: TENANT,
      localEnvironment: "production",
      http: sourceHttp("production"),
      batchLimit: 500,
      enrolments: SYNC_ENROLMENT,
    };
    const peer = { nodeId: NODE_A, url: "", token: sourcePeerToken };

    // FAST lane → the payment lands; the sale is not carried on this lane.
    const fast = await syncPullOnce({ ...base, lane: "fast" as const }, peer);
    expect(fast.applied).toBeGreaterThanOrEqual(1);
    expect(await targetPaymentCount(paymentId)).toBe("1");
    expect(await targetSaleCount(saleId)).toBe("0"); // the fast lane EXCLUDES the sale at composition level

    // ORDERED lane → the sale lands on its own cursor.
    const ordered = await syncPullOnce({ ...base, lane: "ordered" as const }, peer);
    expect(ordered.applied).toBeGreaterThanOrEqual(1);
    expect(await targetSaleCount(saleId)).toBe("1");

    // Two distinct lane cursor rows for one (subscriber, origin), each advanced past 0 — independent.
    const cursors = await targetAdmin.execute<{ lane: string; seq: string }>(
      sql`select lane, last_applied_seq::text as seq from sync_cursor
          where subscriber_id = ${SUB_MAIN} and origin_id = ${NODE_A}::uuid order by lane`,
    );
    expect(cursors.rows.map((r) => r.lane)).toEqual(["fast", "ordered"]);
    expect(cursors.rows.every((r) => BigInt(r.seq) > 0n)).toBe(true);
  });
});
