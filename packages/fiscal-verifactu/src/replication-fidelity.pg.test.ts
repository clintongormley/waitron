// The owner-signature evidence for the outbox → native-replication swap (spec §11): real fiscal
// records, chained by this package's OWN `appendToChain`, flow A→B over native logical replication
// between two real PostgreSQL nodes, and the fiscal invariants hold at the wire. Nothing here writes
// a registro the app would not — every row is a genuine chained `registros_facturacion` record —
// and nothing touches `computeHuella`; the assertions are about what replication does to those rows.
//
// Each case states its FAILING case, and every case is proven by DELETION (CLAUDE.md §1): the
// property is removed inside the test and the guard is watched to stop biting (Case 2 downgrades the
// subscriber trigger ENABLE ALWAYS → origin-only and the refused UPDATE then applies; Case 3 adds the
// missing column and the stalled row then arrives; Case 4 boots the small WAL bound whose control —
// the fixture default keeping `wal_status=reserved` — is noted in a comment).
//
// Two clusters, never overlapping (sibling describes; a describe's afterAll runs before the next
// sibling's beforeAll): cases 1–3 share ONE cluster at the fixture-default 4 GB slot bound where the
// slot never invalidates; Case 4 boots its OWN cluster with an 8 MB bound, because a `-c` boot flag
// (`PGC_S_ARGV`) outranks `ALTER SYSTEM`, so the default's `max_slot_wal_keep_size=4GB` can only be
// changed at boot (I4). Each node is provisioned the prototype's shape — `waitron_migrator` owns every
// table, the SUPERUSER replication bootstrap has run — by the shared Task-2 helper.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { Database } from "@waitron/db";
import { startTwoNodeCluster, type TwoNodeCluster } from "@waitron/db/testing/two-node.js";
import {
  buildConninfo,
  createPublications,
  createSubscription,
  disableSubscription,
  dropSubscription,
  dropSubscriptionDetached,
  enableSubscription,
  publicationName,
  readSlotDrain,
  readSubscriptionStatus,
} from "@waitron/sync";
import {
  provisionAndBootstrapNode,
  REPLICATION_ROLE,
  type BootstrappedNode,
} from "@waitron/sync/testing/replication-node.js";
import { appendToChain } from "./chain.js";
import { altaFor, seedSale, seedTill, type SeededTill } from "./testing/seed.js";

// The exact per-class table lists (brief). LEDGER is what happened (append-only fiscal + sales);
// STATE is configuration + live service. Small explicit lists of REAL tables, never
// @waitron/composition (that would cycle back into @waitron/sync). Every name exists in the migrated
// manifest and carries a primary key (replica identity), so no per-table work is needed.
const LEDGER = [
  "sales",
  "sale_lines",
  "tenders",
  "registros_facturacion",
  "cadenas",
  "registro_sif",
  "envios",
  "envio_flujo",
  "acks",
];
const STATE = [
  "tenants",
  "locations",
  "nodes",
  "tills",
  "invoice_series",
  "contadores_instalacion",
];

const REPL_PASSWORD = "repl_secret_pw";
const NODE_DB = "waitron_repl_node";
// Node A is a PREPRODUCTION publisher; both publications carry that environment in their name.
const PREPROD_PUBS = [
  publicationName("preproduction", "ledger"),
  publicationName("preproduction", "state"),
];

// The immutability trigger the swap sets ENABLE ALWAYS on the fiscal ledger (0001_fiscal_baseline_sql).
const IMMUTABILITY_TRIGGER = "registros_facturacion_enforce_immutability";

/** A single scalar value from a `select …` — wrapped as a scalar subquery so the caller passes the
 * inner query. */
async function scalar<T>(db: Database, query: SQL): Promise<T | undefined> {
  const { rows } = await db.execute<{ v: T }>(sql`select (${query}) as v`);
  return rows[0]?.v;
}

/** `md5(<row>::text)` for one row — the byte-identity probe (prototype (b)). */
async function rowMd5(
  node: BootstrappedNode,
  table: "registros_facturacion" | "cadenas",
  predicate: SQL,
): Promise<string | undefined> {
  const { rows } = await node.superuserDb.execute<{ m: string }>(
    sql`select md5(t::text) as m from ${sql.raw(table)} t where ${predicate}`,
  );
  return rows[0]?.m;
}

async function registroCount(node: BootstrappedNode, id: string): Promise<number> {
  const { rows } = await node.superuserDb.execute<{ c: number }>(
    sql`select count(*)::int as c from registros_facturacion where id = ${id}`,
  );
  return rows[0]?.c ?? 0;
}

async function importeTotal(node: BootstrappedNode, id: string): Promise<string | undefined> {
  const { rows } = await node.superuserDb.execute<{ importe_total: string }>(
    sql`select importe_total from registros_facturacion where id = ${id}`,
  );
  return rows[0]?.importe_total;
}

describe("native-replication fiscal fidelity — cases 1–3 (shared cluster, spec §11)", () => {
  let cluster: TwoNodeCluster;
  let nodeA: BootstrappedNode;
  let nodeB: BootstrappedNode;
  let seed: SeededTill;
  const SUB = "waitron_fidelity_sub";

  beforeAll(async () => {
    // The fixture boots two `postgres:18-alpine` on one network with the DEFAULT (4 GB) slot bound;
    // we do NOT use its `migrate` hook (that migrates as the superuser). Each node is provisioned AS
    // the migrator so `waitron_migrator` owns every table — the shape `CREATE PUBLICATION … FOR
    // TABLE` requires.
    cluster = await startTwoNodeCluster({ migrate: async () => {}, dockerRequired: true });
    nodeA = await provisionAndBootstrapNode(cluster.nodeA.uri, {
      alias: cluster.nodeA.networkHost,
      database: NODE_DB,
      replPassword: REPL_PASSWORD,
    });
    nodeB = await provisionAndBootstrapNode(cluster.nodeB.uri, {
      alias: cluster.nodeB.networkHost,
      database: NODE_DB,
      replPassword: REPL_PASSWORD,
    });

    // A publishes both preproduction publications as the OWNER.
    await createPublications(nodeA.ownerDb, {
      environment: "preproduction",
      ledgerTables: LEDGER,
      stateTables: STATE,
    });

    // B subscribes over the network as the real `waitron_repl` role, enabled and copying. The initial
    // COPY copies EMPTY tables (nothing is seeded yet), so EVERY assertion below is about a STREAMED
    // row, not the initial copy.
    const conninfo = buildConninfo({
      host: cluster.nodeA.networkHost,
      port: 5432,
      database: nodeA.dbName,
      user: REPLICATION_ROLE,
      password: nodeA.replPw,
    });
    await createSubscription(nodeB.ownerDb, {
      name: SUB,
      conninfo,
      publications: PREPROD_PUBS,
      copyData: true,
      enabled: true,
    });

    // Seed the chain infrastructure (tenant → location → node → till → node-keyed series → live SIF +
    // fresh cadenas head) on A AFTER the subscription is up. Each case below appends its own registro.
    seed = await seedTill(nodeA.ownerDb);
  }, 300_000);

  afterAll(async () => {
    if (nodeB !== undefined) await dropSubscription(nodeB.ownerDb, SUB).catch(() => {});
    await nodeA?.close();
    await nodeB?.close();
    await cluster?.stop();
  });

  it("Case 1 — a registro and its chain head land byte-identical", async () => {
    const saleId = await seedSale(nodeA.ownerDb, seed, 1);
    const appended = await nodeA.ownerDb.transaction((tx) =>
      appendToChain(
        tx,
        seed.tenantId,
        seed.nodeId,
        altaFor(seed.tillId, saleId, 1, 1, "preproduction"),
      ),
    );

    // The streamed registro arrives on B.
    await expect.poll(() => registroCount(nodeB, appended.id), { timeout: 30_000 }).toBe(1);

    // Byte identity: md5(r::text) equal on both sides. Failing case: the hashes differ.
    const byId = sql`id = ${appended.id}`;
    const aRegMd5 = await rowMd5(nodeA, "registros_facturacion", byId);
    const bRegMd5 = await rowMd5(nodeB, "registros_facturacion", byId);
    expect(bRegMd5).toBe(aRegMd5);
    expect(aRegMd5).toBeDefined();

    // The chain head (cadenas) too — poll until B's head reflects the append, then compare.
    const headPred = sql`tenant_id = ${seed.tenantId} and node_id = ${seed.nodeId}`;
    await expect
      .poll(
        async () =>
          (
            await nodeB.superuserDb.execute<{ h: string | null }>(
              sql`select ultima_huella as h from cadenas where ${headPred}`,
            )
          ).rows[0]?.h,
        { timeout: 30_000 },
      )
      .toBe(appended.huella);
    const aCadMd5 = await rowMd5(nodeA, "cadenas", headPred);
    const bCadMd5 = await rowMd5(nodeB, "cadenas", headPred);
    expect(bCadMd5).toBe(aCadMd5);
    expect(aCadMd5).toBeDefined();
  });

  it("Case 2 — a replicated UPDATE is refused by ENABLE ALWAYS, proven by deletion (prototype (c2))", async () => {
    const saleId = await seedSale(nodeA.ownerDb, seed, 2);
    const appended = await nodeA.ownerDb.transaction((tx) =>
      appendToChain(
        tx,
        seed.tenantId,
        seed.nodeId,
        altaFor(seed.tillId, saleId, 2, 2, "preproduction"),
      ),
    );
    await expect.poll(() => registroCount(nodeB, appended.id), { timeout: 30_000 }).toBe(1);
    const original = await importeTotal(nodeB, appended.id);
    expect(original).toBe("123.45");

    const baselineErrors = (await readSubscriptionStatus(nodeB.ownerDb, SUB)).applyErrorCount;

    // Corrupt the record on A — only the OWNER can, and only by disabling the trigger first; restore
    // it to ENABLE ALWAYS (M1: `ENABLE ALWAYS`, not the default `O`, or A would stop guarding itself).
    await nodeA.ownerDb.execute(
      sql.raw(`ALTER TABLE registros_facturacion DISABLE TRIGGER ${IMMUTABILITY_TRIGGER}`),
    );
    await nodeA.ownerDb.execute(
      sql`update registros_facturacion set importe_total = '0.02' where id = ${appended.id}`,
    );
    await nodeA.ownerDb.execute(
      sql.raw(`ALTER TABLE registros_facturacion ENABLE ALWAYS TRIGGER ${IMMUTABILITY_TRIGGER}`),
    );

    // B refuses the replicated UPDATE (its trigger is ENABLE ALWAYS): the apply error count rises and
    // B's value is UNCHANGED. Failing case: B changes with no error (the trigger was origin-only).
    await expect
      .poll(async () => (await readSubscriptionStatus(nodeB.ownerDb, SUB)).applyErrorCount, {
        timeout: 30_000,
      })
      .toBeGreaterThan(baselineErrors);
    expect(await importeTotal(nodeB, appended.id)).toBe(original);

    // DELETION control: downgrade B's trigger ENABLE ALWAYS → origin-only (plain ENABLE = tgenabled
    // 'O'), and the stalled UPDATE — queued behind the refusal — now applies under the apply worker's
    // replica mode. Failing case of the control: B stays unchanged (the stall was never real).
    await nodeB.ownerDb.execute(
      sql.raw(`ALTER TABLE registros_facturacion ENABLE TRIGGER ${IMMUTABILITY_TRIGGER}`),
    );
    await expect.poll(() => importeTotal(nodeB, appended.id), { timeout: 30_000 }).toBe("0.02");

    // Restore B's guard to ENABLE ALWAYS for the next case.
    await nodeB.ownerDb.execute(
      sql.raw(`ALTER TABLE registros_facturacion ENABLE ALWAYS TRIGGER ${IMMUTABILITY_TRIGGER}`),
    );
  });

  it("Case 3 — a publisher-ahead column add stalls then resumes (prototype (d))", async () => {
    const baselineErrors = (await readSubscriptionStatus(nodeB.ownerDb, SUB)).applyErrorCount;

    // A gains a column B lacks; the next registro carries its DEFAULT on the wire.
    await nodeA.ownerDb.execute(
      sql.raw(`ALTER TABLE registros_facturacion ADD COLUMN probe_extra text DEFAULT 'set-on-A'`),
    );
    const saleId = await seedSale(nodeA.ownerDb, seed, 3);
    const appended = await nodeA.ownerDb.transaction((tx) =>
      appendToChain(
        tx,
        seed.tenantId,
        seed.nodeId,
        altaFor(seed.tillId, saleId, 3, 3, "preproduction"),
      ),
    );

    // B's apply stalls on the missing replicated column: error count rises, the row is ABSENT on B.
    // Failing case: the row lands on B with the column silently absent.
    await expect
      .poll(async () => (await readSubscriptionStatus(nodeB.ownerDb, SUB)).applyErrorCount, {
        timeout: 30_000,
      })
      .toBeGreaterThan(baselineErrors);
    expect(await registroCount(nodeB, appended.id)).toBe(0);

    // DELETION control: give B the column and the stalled row arrives, carrying A's DEFAULT.
    await nodeB.ownerDb.execute(
      sql.raw(`ALTER TABLE registros_facturacion ADD COLUMN probe_extra text`),
    );
    await expect.poll(() => registroCount(nodeB, appended.id), { timeout: 30_000 }).toBe(1);
    expect(
      await scalar<string>(
        nodeB.superuserDb,
        sql`select probe_extra from registros_facturacion where id = ${appended.id}`,
      ),
    ).toBe("set-on-A");

    // Column DROPs are PUBLISHER-FIRST (prototype finding 4): drop on A, then B. A subscriber-only
    // column is harmless (NULL), so this order never stalls — the reverse of the ADD order above.
    await nodeA.ownerDb.execute(
      sql.raw(`ALTER TABLE registros_facturacion DROP COLUMN probe_extra`),
    );
    await nodeB.ownerDb.execute(
      sql.raw(`ALTER TABLE registros_facturacion DROP COLUMN probe_extra`),
    );
  });
});

describe("native-replication fiscal fidelity — Case 4 WAL overflow + re-adopt (own cluster, spec §6)", () => {
  let cluster: TwoNodeCluster;
  let nodeA: BootstrappedNode;
  let nodeB: BootstrappedNode;
  let conninfo: string;
  const SUB = "waitron_fidelity_sub_wal";
  const READOPT_SUB = "waitron_fidelity_sub_readopt";

  beforeAll(async () => {
    // Boot with an 8 MB slot bound (I4). CONTROL, seen once here: at the fixture DEFAULT
    // (`max_slot_wal_keep_size=4GB`) the slot stays `wal_status=reserved` however much is written —
    // cases 1–3 above run on that cluster and their slot never invalidates. The small bound is what
    // makes a WAL overflow invalidate the slot; a `-c` boot flag outranks `ALTER SYSTEM`, so it MUST
    // be a boot flag.
    cluster = await startTwoNodeCluster({
      migrate: async () => {},
      dockerRequired: true,
      command: [
        "postgres",
        "-c",
        "wal_level=logical",
        "-c",
        "track_commit_timestamp=on",
        "-c",
        "max_slot_wal_keep_size=8MB",
      ],
    });
    nodeA = await provisionAndBootstrapNode(cluster.nodeA.uri, {
      alias: cluster.nodeA.networkHost,
      database: NODE_DB,
      replPassword: REPL_PASSWORD,
    });
    nodeB = await provisionAndBootstrapNode(cluster.nodeB.uri, {
      alias: cluster.nodeB.networkHost,
      database: NODE_DB,
      replPassword: REPL_PASSWORD,
    });
    await createPublications(nodeA.ownerDb, {
      environment: "preproduction",
      ledgerTables: LEDGER,
      stateTables: STATE,
    });
    conninfo = buildConninfo({
      host: cluster.nodeA.networkHost,
      port: 5432,
      database: nodeA.dbName,
      user: REPLICATION_ROLE,
      password: nodeA.replPw,
    });
  }, 300_000);

  afterAll(async () => {
    if (nodeB !== undefined) {
      for (const name of [SUB, READOPT_SUB])
        await dropSubscription(nodeB.ownerDb, name).catch(() => {});
    }
    await nodeA?.close();
    await nodeB?.close();
    await cluster?.stop();
  });

  it("a WAL overflow invalidates the slot, and B re-adopts with a fresh copy", async () => {
    await createSubscription(nodeB.ownerDb, {
      name: SUB,
      conninfo,
      publications: PREPROD_PUBS,
      copyData: true,
      enabled: true,
    });

    // One real chained registro on A, streamed to B.
    const seed = await seedTill(nodeA.ownerDb);
    const saleId = await seedSale(nodeA.ownerDb, seed, 1);
    const appended = await nodeA.ownerDb.transaction((tx) =>
      appendToChain(
        tx,
        seed.tenantId,
        seed.nodeId,
        altaFor(seed.tillId, saleId, 1, 1, "preproduction"),
      ),
    );
    await expect.poll(() => registroCount(nodeB, appended.id), { timeout: 30_000 }).toBe(1);

    // Disable B, then overflow A's WAL past the 8 MB bound while the now-inactive slot must retain it.
    // Write-then-checkpoint in a loop until the slot goes `lost`: only a checkpoint that finds the
    // retained WAL over the bound invalidates the slot, so polling alone (which writes nothing) cannot
    // drive the transition. Failing case: `wal_status` never leaves `reserved`.
    await disableSubscription(nodeB.ownerDb, SUB);
    let walStatus: string | null = null;
    for (let round = 0; round < 8 && walStatus !== "lost"; round++) {
      await nodeA.ownerDb.execute(sql`
        insert into locations (tenant_id, name, invoice_locales, operation_description)
        select ${seed.tenantId}, repeat('x', 1024), array['es'], 'x' from generate_series(1, 20000)
      `);
      await nodeA.superuserDb.execute(sql.raw("CHECKPOINT"));
      walStatus = (await readSlotDrain(nodeA.ownerDb, SUB)).walStatus;
    }
    expect(walStatus).toBe("lost");

    // Trim the overflow rows so the fresh initial copy stays small (locations is not append-only, so
    // the owner may DELETE; the seed's one location — a different name — survives).
    await nodeA.ownerDb.execute(sql`delete from locations where name = repeat('x', 1024)`);

    // Re-enabling cannot recover — the publisher's slot is gone. Re-adopt: detach B (its remote slot
    // stays orphaned), clear B's copied tables, and subscribe afresh under a NEW name so the new slot
    // never collides with the lost one A still holds.
    await enableSubscription(nodeB.ownerDb, SUB);
    await dropSubscriptionDetached(nodeB.ownerDb, SUB);
    await clearForReadopt(nodeB);
    await createSubscription(nodeB.ownerDb, {
      name: READOPT_SUB,
      conninfo,
      publications: PREPROD_PUBS,
      copyData: true,
      enabled: true,
    });

    // The fresh initial copy completes and B's registro count equals A's. Failing case: the counts
    // differ.
    await expect
      .poll(
        async () => {
          const status = await readSubscriptionStatus(nodeB.ownerDb, READOPT_SUB);
          return status.tablesTotal > 0 && status.tablesReady === status.tablesTotal;
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    const aCount = await scalar<number>(
      nodeA.superuserDb,
      sql`select count(*)::int from registros_facturacion`,
    );
    const bCount = await scalar<number>(
      nodeB.superuserDb,
      sql`select count(*)::int from registros_facturacion`,
    );
    expect(bCount).toBe(aCount);
    expect(aCount).toBe(1);
  });
});

/**
 * Clear every published table on the re-adopting node so a fresh `copy_data = true` COPY does not
 * conflict on a pre-existing primary key (the C6 fact). The append-only ledger tables carry ENABLE
 * ALWAYS `reject_mutation` triggers that block TRUNCATE even for the superuser and even in replica
 * mode, so every such trigger is disabled first, then restored to ENABLE ALWAYS. The (table, trigger)
 * names come from `pg_catalog` (trusted), and ALTER TABLE will not bind an identifier — the double
 * quotes are the escape.
 */
async function clearForReadopt(node: BootstrappedNode): Promise<void> {
  const { rows: triggers } = await node.superuserDb.execute<{ tbl: string; trg: string }>(sql`
    select c.relname as tbl, t.tgname as trg
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_proc p on p.oid = t.tgfoid
    where p.proname = 'reject_mutation' and not t.tgisinternal
  `);
  for (const { tbl, trg } of triggers) {
    await node.superuserDb.execute(sql.raw(`ALTER TABLE "${tbl}" DISABLE TRIGGER "${trg}"`));
  }
  const list = [...LEDGER, ...STATE].map((t) => `"${t}"`).join(", ");
  await node.superuserDb.execute(sql.raw(`TRUNCATE ${list} CASCADE`));
  for (const { tbl, trg } of triggers) {
    await node.superuserDb.execute(sql.raw(`ALTER TABLE "${tbl}" ENABLE ALWAYS TRIGGER "${trg}"`));
  }
}
