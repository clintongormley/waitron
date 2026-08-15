import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { captureError, createPostgresDb, withTenant, type Database } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { syncPullOnce, type HttpClient } from "@waitron/sync";
import type { Logger } from "./logger.js";
import { mountSyncApi } from "./sync-api.js";
import { roleUrl, startRealPostgres } from "./testing/postgres.js";

// Two-node end-to-end (design §5, §7). ONE postgres:18-alpine container holding TWO migrated
// databases — `source` (the container default) and a second `target` created with CREATE DATABASE +
// runMigrationSets — is the minimum that proves genuine CROSS-DB apply: two independent
// sync_log/sync_cursor states, one container boot. The roles (app_user/sync_tailer members) are
// cluster-global, so one set serves both databases. The HTTP wire is a real Hono `app.request` (a real
// Request/Response carrying the exact NDJSON bytes) — a bound socket is deployment #9's TLS concern;
// byte-identity is a property of the bytes, not the socket. Both sides act as the non-superuser
// sync_reader/sync_applier under FORCE RLS (PGlite would be a false pass, CLAUDE.md §4).
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

const postgres = useRealPostgres({
  start: startRealPostgres,
  setup: async ({ admin }) => {
    await admin.execute(sql.raw(`create role app_login login password 'app_pw' in role app_user`));
    await admin.execute(sql.raw(`create role sync_applier login password 'ap' in role app_user`));
    await admin.execute(sql.raw(`grant sync_tailer to sync_applier`));
    await admin.execute(sql.raw(`create role sync_reader login password 'rp'`));
    await admin.execute(sql.raw(`grant sync_tailer to sync_reader`));
  },
  timeoutMs: 180_000,
});

let targetAdmin: Database;
let targetApplier: Database;
let sourceReader: Database;
let sourceWriter: Database;

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
    { db: sourceReader, tenantId: TENANT, nodeId: NODE_A, environment, nodeToken: "shared" },
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

beforeAll(async () => {
  await seedParents(postgres.admin); // source parents

  const targetUrl = new URL(postgres.pg.uri);
  targetUrl.pathname = "/sync_e2e_target";
  const targetUri = targetUrl.toString();
  await postgres.admin.execute(sql.raw(`create database sync_e2e_target`));
  await runMigrationSets(targetUri, migrationOptionsFor(manifestSets(), null));

  targetAdmin = await createPostgresDb(targetUri);
  await seedParents(targetAdmin); // the SAME parents on the target so the sale's FKs resolve
  targetApplier = await createPostgresDb(roleUrl(targetUri, "sync_applier", "ap"));
  sourceReader = await postgres.pg.connectAs("sync_reader", "rp");
  sourceWriter = await postgres.pg.connectAs("app_login", "app_pw");
}, 180_000);

afterAll(async () => {
  if (sourceWriter !== undefined) await sourceWriter.close();
  if (sourceReader !== undefined) await sourceReader.close();
  if (targetApplier !== undefined) await targetApplier.close();
  if (targetAdmin !== undefined) await targetAdmin.close();
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
    };
    const peer = { nodeId: NODE_A, url: "", token: "shared" };

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
    const sourceMax = await postgres.admin.execute<{ seq: string }>(
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
    };
    const peer = { nodeId: NODE_A, url: "", token: "shared" };
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
});
