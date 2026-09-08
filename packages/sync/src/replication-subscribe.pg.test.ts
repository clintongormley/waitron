// Real PostgreSQL, two networked nodes: the final proof of swap slice S2. Node B (the standby)
// subscribes to node A (the primary) as the real `waitron_repl` role over the Docker network; a
// `state` row copies A→B through the actual publication/subscription verbs; and a subscription that
// names a WRONG-environment publication (the isolation half spec §2.4 carries in the name) copies
// nothing. Each node is provisioned the prototype's way — `waitron_migrator` owns every table and the
// SUPERUSER bootstrap has run — by the Task 6 helper, here run twice on a pre-booted two-node cluster.
//
// Order-dependent by construction and safe under this package's `singleFork` (one file, one worker,
// declaration order = run order): assertion 1 creates the working subscription, copies a row, then
// DROPS it; assertion 2 then attaches the wrong-environment subscription in isolation and shows it
// transfers nothing. The cluster is shared across the file via beforeAll — booting two containers and
// provisioning both is a one-way, ~minute setup, not a per-case fixture.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { sqlStateOf } from "@waitron/shared";
import { createPostgresDb, type Database } from "@waitron/db";
import { roleUrl } from "@waitron/db/testing/postgres.js";
import { startTwoNodeCluster, type TwoNodeCluster } from "@waitron/db/testing/two-node.js";
import { REPLICATION_ROLE, withDatabase } from "@waitron/provisioning";
import { createPublications, ensurePublications } from "./publications.js";
import { isDrained, listSlots, readSlotDrain } from "./drain.js";
import { readSubscriptionStatus } from "./status.js";
import {
  buildConninfo,
  createSubscription,
  disableSubscription,
  dropReplicationSlot,
  dropSubscription,
  dropSubscriptionDetached,
  enableSubscription,
} from "./subscriptions.js";
import { provisionAndBootstrapNode, type BootstrappedNode } from "./testing/replication-node.js";

// The same SMALL hardcoded real-table list Task 6 uses — NOT @waitron/composition (that depends on
// @waitron/sync, a cycle). `sales`/`tenders` are ledger, `tenants`/`locations` are state (S1).
const LEDGER = ["sales", "tenders"];
const STATE = ["tenants", "locations"];

const REPL_PASSWORD = "repl_secret_pw";
const NODE_DB = "waitron_repl_node";

const WORKING_SUB = "waitron_sub_from_a";
const WRONG_ENV_SUB = "waitron_sub_wrong_env";
// A fresh subscription for the S4 drain/status/detached-drop/slot-drop assertions, so it never
// collides with the S2 subscriptions above. Postgres names A's publisher-side slot identically.
const DRAIN_SUB = "waitron_sub_drain";

// The environment each publication name carries. A is a PREPRODUCTION publisher; the wrong-env
// subscriber names PRODUCTION, which A does not have.
const PREPROD_PUBS = ["waitron_preproduction_ledger", "waitron_preproduction_state"];
const PROD_PUBS = ["waitron_production_ledger", "waitron_production_state"];

// A distinctive `tenants` row (a root state table — no FK parents). `tax_id` is the marker we poll
// for on B, so it is unique per assertion. Bound, not interpolated (CLAUDE.md §3): an insert/select
// is a statement PostgreSQL binds, so the marker travels as a parameter.
const insertTenant = (marker: string) =>
  sql`insert into tenants (country, tax_id, legal_name) values ('ES', ${marker}, 'Probe SL')`;
const countTenant = (marker: string) =>
  sql`select count(*)::int as c from tenants where tax_id = ${marker}`;

// No Docker gate: this package's globalSetup boots a shared container and FAILS the whole package
// when Docker is absent (vitest.config.ts), the same reason the sibling replication-provision suite
// needs none.
describe("two-node native replication subscription (swap S2)", () => {
  let cluster: TwoNodeCluster;
  let nodeA: BootstrappedNode;
  let nodeB: BootstrappedNode;
  // The libpq conninfo B uses to dial A: A's NETWORK ALIAS (not its host-published uri), A's target
  // db, the real `waitron_repl` login and A's replication password.
  let conninfoToA: string;
  // A host-published connection to A authenticated AS `waitron_repl` (a REPLICATION role) — the ONLY
  // connection allowed to drop A's slots (Ruling I3; the migrator gets 42501). Opened lazily.
  let replConnToA: Database | undefined;

  beforeAll(async () => {
    // The fixture boots two `postgres:18-alpine` on one network; we do NOT use its `migrate` hook
    // (that migrates as the superuser). Instead we provision each node AS the migrator afterward, so
    // `waitron_migrator` owns every table — the shape `CREATE PUBLICATION … FOR TABLE` requires.
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
    conninfoToA = buildConninfo({
      host: cluster.nodeA.networkHost,
      port: 5432,
      database: nodeA.dbName,
      user: REPLICATION_ROLE,
      password: nodeA.replPw,
    });

    // A publishes both preproduction publications as the OWNER (migrator).
    await createPublications(nodeA.ownerDb, {
      environment: "preproduction",
      ledgerTables: LEDGER,
      stateTables: STATE,
    });
  }, 300_000);

  afterAll(async () => {
    // Drop any surviving subscriptions on B BEFORE stopping the containers, so each apply worker
    // releases its slot on A cleanly (the smoke test does the same). Best-effort — teardown must not
    // strand the container stop.
    if (nodeB !== undefined) {
      for (const name of [WORKING_SUB, WRONG_ENV_SUB, DRAIN_SUB]) {
        await dropSubscription(nodeB.ownerDb, name).catch(() => {});
      }
    }
    await replConnToA?.close().catch(() => {});
    await nodeA?.close();
    await nodeB?.close();
    await cluster?.stop();
  });

  it("copies a state row A→B via the real roles, then disable/enable/drop execute", async () => {
    const marker = "PREPROD_PROBE";
    // The standby subscribes to A over the network, naming both preproduction publications, enabled
    // and copying. The migrator on B holds `pg_create_subscription` (granted by its own bootstrap).
    await createSubscription(nodeB.ownerDb, {
      name: WORKING_SUB,
      conninfo: conninfoToA,
      publications: PREPROD_PUBS,
      copyData: true,
      enabled: true,
    });

    // One `tenants` row inserted on A must appear on B through native replication.
    await nodeA.ownerDb.execute(insertTenant(marker));
    await expect
      .poll(
        async () =>
          (await nodeB.superuserDb.execute<{ c: number }>(countTenant(marker))).rows[0]?.c,
        { timeout: 30_000 },
      )
      .toBe(1);

    // Exercise the maintenance verbs for real (ALTER … DISABLE / ENABLE) — completes their
    // real-execution coverage. `subenabled` flips in `pg_subscription`.
    const enabledFlag = async () =>
      (
        await nodeB.superuserDb.execute<{ subenabled: boolean }>(
          sql`select subenabled from pg_subscription where subname = ${WORKING_SUB}`,
        )
      ).rows[0]?.subenabled;

    await disableSubscription(nodeB.ownerDb, WORKING_SUB);
    expect(await enabledFlag()).toBe(false);
    await enableSubscription(nodeB.ownerDb, WORKING_SUB);
    expect(await enabledFlag()).toBe(true);

    // Drop it: `pg_subscription` no longer holds it (this also frees A's slot for assertion 2).
    await dropSubscription(nodeB.ownerDb, WORKING_SUB);
    const remaining = await nodeB.superuserDb.execute<{ subname: string }>(
      sql`select subname from pg_subscription where subname = ${WORKING_SUB}`,
    );
    expect(remaining.rows).toHaveLength(0);
  });

  it("a WRONG-environment publication name copies nothing (spec §2.4, name-carried half)", async () => {
    // EMPIRICAL (CLAUDE.md §1): a subscription naming publications the publisher lacks. On
    // PostgreSQL 16+ `check_publications` at CREATE time emits a WARNING and the subscription is still
    // CREATED (the failure is asynchronous), so we assert createSubscription RESOLVES — it does not
    // throw — and then that nothing is transferred. The HARD refusal (the adoption path reading
    // `deployment.environment` and refusing) is step-4 / the live path, not S2: here we prove only
    // that the environment-carrying NAME means a cross-environment attach transfers nothing.
    await expect(
      createSubscription(nodeB.ownerDb, {
        name: WRONG_ENV_SUB,
        conninfo: conninfoToA,
        publications: PROD_PUBS,
        copyData: true,
        enabled: true,
      }),
    ).resolves.toBeUndefined();

    // A marker row on A. With the working subscription dropped (assertion 1) and only this wrong-env
    // subscription present, it must NEVER reach B.
    const marker = "PROD_ONLY_MARKER";
    await nodeA.ownerDb.execute(insertTenant(marker));

    // No table was ever synced under this subscription: `pg_subscription_rel` is empty, because the
    // named publications resolve to no tables on A.
    const relRows = await nodeB.superuserDb.execute<{ srrelid: number }>(
      sql`select srrelid from pg_subscription_rel r
          join pg_subscription s on s.oid = r.srsubid
          where s.subname = ${WRONG_ENV_SUB}`,
    );
    expect(relRows.rows).toHaveLength(0);

    // Give any (non-existent) copy a bounded window, then confirm the marker never arrived on B.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const copied = await nodeB.superuserDb.execute<{ c: number }>(countTenant(marker));
    expect(copied.rows[0]?.c).toBe(0);
  });

  it("ensurePublications is idempotent, and re-adds a table dropped from a publication (S4)", async () => {
    const stateName = "waitron_preproduction_state";
    const tablesOfState = async () =>
      (
        await nodeA.ownerDb.execute<{ tablename: string }>(
          sql`select tablename from pg_publication_tables where pubname = ${stateName} order by tablename`,
        )
      ).rows.map((r) => r.tablename);

    // Already exactly the derived lists (createPublications ran in beforeAll): a no-op.
    expect(
      await ensurePublications(nodeA.ownerDb, {
        environment: "preproduction",
        ledgerTables: LEDGER,
        stateTables: STATE,
      }),
    ).toEqual({ created: [], updated: [] });

    // Drift the state publication by dropping `locations`, then reconcile: exactly `state` updates.
    await nodeA.ownerDb.execute(sql.raw(`ALTER PUBLICATION "${stateName}" SET TABLE "tenants"`));
    expect(await tablesOfState()).toEqual(["tenants"]);
    expect(
      await ensurePublications(nodeA.ownerDb, {
        environment: "preproduction",
        ledgerTables: LEDGER,
        stateTables: STATE,
      }),
    ).toEqual({ created: [], updated: ["state"] });
    expect(await tablesOfState()).toEqual([...STATE].sort());
  });

  it("drains and reads status, then detaches B and drops A's orphaned slot as waitron_repl (S4)", async () => {
    // B subscribes to A afresh (its own slot on A, named DRAIN_SUB). copy_data = FALSE: assertion 1
    // already copied a `tenants` row to B under WORKING_SUB, and dropping a subscription leaves the
    // copied rows behind, so a second initial COPY would conflict on that row's PK and wedge tablesync
    // forever (the C6 "initial copy cannot coexist with pre-existing rows" fact). Without a copy every
    // table reaches `r` at once (tablesReady === tablesTotal === 4) and streaming carries the marker.
    await createSubscription(nodeB.ownerDb, {
      name: DRAIN_SUB,
      conninfo: conninfoToA,
      publications: PREPROD_PUBS,
      copyData: false,
      enabled: true,
    });

    // A marker on A, and A's WAL position just after it — the FENCE LSN the drain watermark compares
    // against (Ruling C2), NOT pg_current_wal_lsn() at read time.
    const marker = "DRAIN_MARKER";
    await nodeA.ownerDb.execute(insertTenant(marker));
    const fenceLsn = (
      await nodeA.ownerDb.execute<{ lsn: string }>(sql`select pg_current_wal_lsn()::text as lsn`)
    ).rows[0]?.lsn;
    expect(fenceLsn).toBeDefined();

    // The slot on A drains past the fence (confirmed_flush advances as B applies and reports back).
    await expect
      .poll(async () => isDrained(await readSlotDrain(nodeA.ownerDb, DRAIN_SUB), fenceLsn ?? ""), {
        timeout: 30_000,
      })
      .toBe(true);

    // B's subscription status: apply worker up, all four published tables copied, no apply errors.
    await expect
      .poll(async () => (await readSubscriptionStatus(nodeB.ownerDb, DRAIN_SUB)).tablesReady, {
        timeout: 30_000,
      })
      .toBe(4);
    const status = await readSubscriptionStatus(nodeB.ownerDb, DRAIN_SUB);
    expect(status.exists).toBe(true);
    expect(status.workerUp).toBe(true);
    expect(status.tablesTotal).toBe(4);
    expect(status.tablesReady).toBe(4);
    expect(status.applyErrorCount).toBe(0);

    // Disable B, bulk-insert on A: the now-inactive slot RETAINS WAL (receipt D).
    await disableSubscription(nodeB.ownerDb, DRAIN_SUB);
    await nodeA.ownerDb.execute(
      sql`insert into tenants (country, tax_id, legal_name)
          select 'ES', 'BULK_' || g, 'Bulk SL' from generate_series(1, 200) g`,
    );
    await expect
      .poll(async () => (await readSlotDrain(nodeA.ownerDb, DRAIN_SUB)).active, { timeout: 30_000 })
      .toBe(false);
    const retained = await readSlotDrain(nodeA.ownerDb, DRAIN_SUB);
    expect(retained.retainedBytes).not.toBeNull();
    expect(retained.retainedBytes ?? 0n).toBeGreaterThan(0n);

    // Detach B (its remote slot stays): DISABLE; SET (slot_name = NONE); DROP. A's slot survives,
    // inactive — an orphan for step-5 reclamation.
    await dropSubscriptionDetached(nodeB.ownerDb, DRAIN_SUB);
    const orphan = (await listSlots(nodeA.ownerDb)).find((s) => s.slotName === DRAIN_SUB);
    expect(orphan).toBeDefined();
    expect(orphan?.active).toBe(false);

    // Control (Ruling I3): the migrator CANNOT drop the slot — `permission denied to use replication
    // slots`, SQLSTATE 42501. RUN, not reasoned (CLAUDE.md §1).
    let migratorDrop: unknown;
    try {
      await dropReplicationSlot(nodeA.ownerDb, DRAIN_SUB);
    } catch (error) {
      migratorDrop = error;
    }
    expect(migratorDrop).toBeDefined();
    expect(sqlStateOf(migratorDrop)).toBe("42501");

    // A `waitron_repl` connection (a REPLICATION role) drops it, and the slot is gone.
    replConnToA = await createPostgresDb(
      roleUrl(withDatabase(cluster.nodeA.uri, nodeA.dbName), REPLICATION_ROLE, nodeA.replPw),
    );
    await expect(dropReplicationSlot(replConnToA, DRAIN_SUB)).resolves.toBeUndefined();
    expect((await listSlots(nodeA.ownerDb)).find((s) => s.slotName === DRAIN_SUB)).toBeUndefined();
  });
});
