import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { encodeBatch } from "./wire.js";
import { syncPullOnce, type HttpClient } from "./pull.js";
import type { SyncLogRow } from "./apply.js";

// Real Postgres, not PGlite: syncPullOnce drives applyBatch under the non-superuser sync_applier role
// (app_user + sync_tailer member) so FORCE RLS genuinely applies — PGlite (superuser) bypasses it, a
// false pass (CLAUDE.md §4). The http seam is faked: this suite proves the client wiring (cursor read
// → fetch → apply → cursor advance → idempotent redelivery), not the socket (that is Task 10's e2e).
// The apply worker's role sync_applier — a LOGIN member of BOTH app_user (write the enrolled tables)
// and sync_tailer (read sync_cursor) — is now created once in src/testing/global-setup.ts with both
// memberships in its inRole array, shared across the gate suites: a shared cluster is one cluster, so
// a per-file `create role` would collide on the second. Reached below with `connectAs("sync_applier",
// "ap")`.
const postgres = useTemplateDb({ template: "manifest" });

const uuid = (): string => randomUUID();

async function setEnv(environment: "production" | "preproduction"): Promise<void> {
  await postgres.admin.execute(
    sql`insert into deployment (id, environment) values (1, ${environment})
        on conflict (id) do update set environment = excluded.environment`,
  );
}

interface Base {
  tenantId: string;
  tillId: string;
  nodeId: string;
}

async function seedBase(): Promise<Base> {
  const admin = postgres.admin;
  const tenantId = await seedTenant(admin);
  const loc = await admin.execute<{ id: string }>(
    sql`insert into locations (tenant_id, name, invoice_locales, operation_description)
        values (${tenantId}, 'Location', array['en']::text[], 'Hospitality') returning id`,
  );
  const locationId = loc.rows[0]!.id;
  const till = await admin.execute<{ id: string }>(
    sql`insert into tills (tenant_id, location_id, name)
        values (${tenantId}, ${locationId}, 'Till') returning id`,
  );
  const node = await admin.execute<{ id: string }>(
    sql`insert into nodes (tenant_id, location_id, name)
        values (${tenantId}, ${locationId}, 'Node') returning id`,
  );
  return { tenantId, tillId: till.rows[0]!.id, nodeId: node.rows[0]!.id };
}

async function seedSeries(b: Base): Promise<string> {
  const s = await postgres.admin.execute<{ id: string }>(
    sql`insert into invoice_series (tenant_id, node_id, code)
        values (${b.tenantId}, ${b.nodeId}, 'A') returning id`,
  );
  return s.rows[0]!.id;
}

function saleImage(b: Base, seriesId: string, invoiceNumber: number): Record<string, unknown> {
  return {
    id: uuid(),
    tenant_id: b.tenantId,
    till_id: b.tillId,
    series_id: seriesId,
    node_id: b.nodeId,
    invoice_number: invoiceNumber,
    issued_at: "2026-08-11T10:00:00+00:00",
    issued_offset_minutes: 60,
    total: "10.00",
    vat_breakdown: [],
    locale: "en",
    invoice_locales: ["en"],
    fiscal_backend: "fake",
    fiscal_state: "not_applicable",
    corrects_sale_id: null,
    counterparty_tax_id: null,
    counterparty_legal_name: null,
    counterparty_country_code: null,
    authorized_by: null,
    operator_id: null,
    working_order_id: null,
  };
}

describe("syncPullOnce applies a peer's batch and advances the cursor", () => {
  it("reads the cursor, applies the fetched batch, advances the cursor, and is idempotent on redelivery", async () => {
    await setEnv("production");
    const b = await seedBase();
    const seriesId = await seedSeries(b);
    const peerNode = uuid();
    const subscriberId = uuid();
    const sale = saleImage(b, seriesId, 1);
    const saleId = sale.id as string;
    // The batch the peer's /sync-api/log would serve — originId is the PEER's node id (the cursor key).
    const batch: SyncLogRow[] = [
      {
        seq: 1n,
        originId: peerNode,
        table: "sales",
        op: "insert",
        tenantId: b.tenantId,
        rowImage: JSON.stringify(sale),
      },
    ];
    const ndjson = encodeBatch(batch);
    // Fake http seam: /hello advertises production; /log always serves the same batch (a redelivery on
    // the second call, which the seq cursor + ON CONFLICT make an idempotent no-op).
    const http: HttpClient = async (url) => {
      if (url.includes("/sync-api/hello")) {
        return { status: 200, text: async () => JSON.stringify({ environment: "production" }) };
      }
      return { status: 200, text: async () => ndjson };
    };

    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const deps = {
        localDb: applier,
        subscriberId,
        tenantId: b.tenantId,
        localEnvironment: "production",
        http,
        batchLimit: 500,
      };
      const peer = { nodeId: peerNode, url: "http://peer/", token: "tok" };

      const first = await syncPullOnce(deps, peer);
      expect(first.applied).toBe(1);
      const saleCount = await postgres.admin.execute<{ v: string }>(
        sql`select count(*)::int::text as v from sales where id = ${saleId}`,
      );
      expect(saleCount.rows[0]!.v).toBe("1"); // the sale landed on the mirror

      const cursor = await postgres.admin.execute<{ seq: string }>(
        sql`select last_applied_seq::text as seq from sync_cursor
            where subscriber_id = ${subscriberId} and origin_id = ${peerNode}::uuid`,
      );
      expect(cursor.rows[0]!.seq).toBe("1"); // advanced to the batch's max seq

      const second = await syncPullOnce(deps, peer);
      expect(second.applied).toBe(0); // redelivery of the same range is a clean no-op
    } finally {
      await applier.close();
    }
  });

  it("a fast pull requests ?lane=fast and advances ONLY the fast cursor row", async () => {
    await setEnv("production");
    const b = await seedBase();
    const seriesId = await seedSeries(b);
    const peerNode = uuid();
    const subscriberId = uuid();
    const sale = saleImage(b, seriesId, 1);
    // pull.ts is lane-agnostic about which table rides which lane (that mapping is the SERVER's job,
    // Task 7); a `sales` row on the fast lane proves the client threads `lane` end to end.
    const batch: SyncLogRow[] = [
      {
        seq: 1n,
        originId: peerNode,
        table: "sales",
        op: "insert",
        tenantId: b.tenantId,
        rowImage: JSON.stringify(sale),
      },
    ];
    const ndjson = encodeBatch(batch);
    const urls: string[] = [];
    const http: HttpClient = async (url) => {
      urls.push(url);
      if (url.includes("/sync-api/hello")) {
        return { status: 200, text: async () => JSON.stringify({ environment: "production" }) };
      }
      return { status: 200, text: async () => ndjson };
    };
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const deps = {
        localDb: applier,
        subscriberId,
        tenantId: b.tenantId,
        localEnvironment: "production",
        http,
        batchLimit: 500,
        lane: "fast" as const,
      };
      const peer = { nodeId: peerNode, url: "http://peer/", token: "tok" };
      // Seed a COMPETING ordered cursor at a DIFFERENT seq (5) for the SAME (subscriber, origin) BEFORE
      // the fast pull. This deletion-proofs readCursor's `and lane = ${lane}` filter (pull.ts:82) inside
      // this package: without it, readCursor's `before` (fast) would instead read THIS ordered row's seq
      // (5, the only cursor that exists pre-pull), so `advanced` (after=1 > before=5) would read FALSE and
      // the assertion below fails. It also lets the disjointness check assert the ordered cursor is left
      // UNTOUCHED (still 5) rather than merely absent.
      await postgres.admin.execute(
        sql`insert into sync_cursor (subscriber_id, origin_id, lane, last_applied_seq)
            values (${subscriberId}, ${peerNode}::uuid, 'ordered', 5)`,
      );
      const result = await syncPullOnce(deps, peer);
      expect(result.applied).toBe(1);
      expect(result.advanced).toBe(true); // the FAST cursor moved (0 → 1); load-bearing lane filter
      // The wire carried lane=fast (spec §4c/§4d).
      expect(urls.some((u) => u.includes("/sync-api/log") && u.includes("lane=fast"))).toBe(true);
      // The FAST cursor advanced to 1; the pre-seeded ORDERED cursor is UNTOUCHED — the lanes are disjoint.
      const fast = await postgres.admin.execute<{ seq: string }>(
        sql`select last_applied_seq::text as seq from sync_cursor
            where subscriber_id = ${subscriberId} and origin_id = ${peerNode}::uuid and lane = 'fast'`,
      );
      expect(fast.rows[0]!.seq).toBe("1");
      const ordered = await postgres.admin.execute<{ seq: string | null }>(
        sql`select last_applied_seq::text as seq from sync_cursor
            where subscriber_id = ${subscriberId} and origin_id = ${peerNode}::uuid and lane = 'ordered'`,
      );
      expect(ordered.rows[0]!.seq).toBe("5"); // the fast pull did not advance the ordered lane's cursor
    } finally {
      await applier.close();
    }
  });

  it("throws on a non-200 from either endpoint (a transport error the loop backs off on)", async () => {
    await setEnv("production");
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const depsFor = (http: HttpClient) => ({
        localDb: applier,
        subscriberId: uuid(),
        tenantId: uuid(),
        localEnvironment: "production",
        http,
        batchLimit: 500,
      });
      const peer = { nodeId: uuid(), url: "http://peer/", token: "tok" };

      // /hello fails first — the handshake never completes.
      const helloDown: HttpClient = async () => ({ status: 503, text: async () => "" });
      await expect(syncPullOnce(depsFor(helloDown), peer)).rejects.toThrow(/hello responded 503/);

      // /hello ok, but /log fails — the fetch of the batch is the transport error.
      const logDown: HttpClient = async (url) =>
        url.includes("/sync-api/hello")
          ? { status: 200, text: async () => JSON.stringify({ environment: "production" }) }
          : { status: 503, text: async () => "" };
      await expect(syncPullOnce(depsFor(logDown), peer)).rejects.toThrow(/log responded 503/);
    } finally {
      await applier.close();
    }
  });
});
