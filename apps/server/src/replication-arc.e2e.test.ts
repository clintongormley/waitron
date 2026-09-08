// The SECOND owner-signature evidence suite (spec §11): the whole failover ARC end to end with the
// REAL adopt/promote/rejoin code, on two real PostgreSQL nodes over native logical replication. Task 3's
// sibling (`packages/fiscal-verifactu/src/replication-fidelity.pg.test.ts`) proved byte fidelity and
// ENABLE ALWAYS; this proves the mechanism a venue's failover actually runs:
//
//   Case 1 — every PUBLISHED table (the two DERIVED lists) is copyable; no `local` table copies.
//   Case 2 — adopt → fence → drain → promote → return → drain-the-tail → wipe → re-adopt, each step
//            driven by the production function (`adoptFromPrimary`, `runFinishAdoption`,
//            `promoteMirrorToPrimary`, `rejoinAsSecondary`) and the real sync verbs, and each property
//            proven by DELETION (CLAUDE.md §1): a control that FAILS when the property is removed, and a
//            later ledger row used as a fence so a negative ("the rename did NOT arrive") measures the
//            live stream having passed the withheld write rather than measuring nothing.
//
// Nothing here writes a fiscal row the app would not (the sales/registros come through
// `testing/fiscal-fixtures.ts`, the same real write helpers the app uses) and nothing touches
// `computeHuella`. Real Postgres only: PGlite connects every session as a superuser, so it could show
// neither the migrator-owned publication shape nor the `waitron_repl` subscriber (CLAUDE.md §4). Two
// nodes are provisioned by the Task-1 shape helper `provisionAndBootstrapNode` (its pg suite is the
// ownership receipt); no `applyInstance` wiring is exercised here.
//
// Two clusters, never overlapping (sibling describes; a describe's afterAll runs before the next
// describe's beforeAll — the same discipline as the fidelity sibling), so at most two containers live at
// once. Case 2's cluster provisions node A as a FULL primary (venue + node identity + box CA) because
// `adoptFromPrimary` fetches a bundle from the real `assembleMirrorBundle`, which reads those.
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  createPostgresDb,
  readDeploymentEnvironment,
  readDeploymentMode,
  readSingletonRole,
  setFenceLsnTx,
  stampDeployment,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { databaseUrl, roleUrl } from "@waitron/db/testing/postgres.js";
import { startTwoNodeCluster, type TwoNodeCluster } from "@waitron/db/testing/two-node.js";
import {
  provisionAndBootstrapNode,
  REPLICATION_ROLE,
  type BootstrappedNode,
} from "@waitron/sync/testing/replication-node.js";
import {
  buildConninfo,
  createPublications,
  createSubscription,
  disableSubscription,
  dropSubscription,
  dropSubscriptionDetached,
  isDrained,
  publicationName,
  readSlotDrain,
  readSubscriptionStatus,
  setSubscriptionPublications,
  subscriptionName,
} from "@waitron/sync";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyVenue, planVenue, type AdoptResult } from "@waitron/provisioning";
import { loadKeyRing, type KeyRing } from "@waitron/credentials";
import { hashPassword, hashPin } from "@waitron/identity";
import type { MembershipNode, SignedMembershipDocument } from "@waitron/membership";
import { ALL_MODULES, LEDGER_PUBLICATION_TABLES, STATE_PUBLICATION_TABLES } from "./modules.js";
import { adoptFromPrimary, type AdoptDeps } from "./adopt.js";
import { readPendingAdoption, runFinishAdoption } from "./finish-adoption.js";
import { assembleMirrorBundle } from "./mirror-bundle.js";
import { promoteMirrorToPrimary, type MirrorPromoteDeps } from "./promote.js";
import { rejoinAsSecondary, type RejoinDeps } from "./rejoin.js";
import { createDeploymentHolders } from "./deployment-holders.js";
import { establishNodeIdentity } from "./node-identity.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { dropAndCreateDatabase } from "./db-wipe.js";
import type { ReplicationConfig } from "./config.js";
import { insertFiscalSale, seedFiscalParents, type FiscalIds } from "./testing/fiscal-fixtures.js";

const ENV = "preproduction" as const;
const NODE_DB = "waitron_repl_node";
const REPL_PASSWORD = "repl_secret_pw";
const MIGRATOR_PW = "migrator_pw"; // the fixture literal `provisionAndBootstrapNode` uses.
const LEDGER = LEDGER_PUBLICATION_TABLES;
const STATE = STATE_PUBLICATION_TABLES;
const ALL_PUBLISHED = new Set<string>([...LEDGER, ...STATE]);
const PUBS = [publicationName(ENV, "ledger"), publicationName(ENV, "state")];
const LEDGER_ONLY = [publicationName(ENV, "ledger")];

// The box vault key. `establishNodeIdentity` (A) and the finish worker's establish (B) seal under it;
// the promote signer reads B's key back under it — one ring for both boxes is fine in a fixture.
const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const noopLog = () => {};

/** Read the tables `pg_publication_tables` names for the two publications on `db`. */
async function publishedTables(db: Database): Promise<Set<string>> {
  const { rows } = await db.execute<{ tablename: string }>(sql`
    select pt.tablename
    from pg_publication_tables pt
    join pg_publication p on p.pubname = pt.pubname
    where p.pubname = any(${sql.raw(`array[${PUBS.map((n) => `'${n}'`).join(", ")}]`)})
  `);
  return new Set(rows.map((r) => r.tablename));
}

/** A `select count(*)` on `db`, bound predicate. */
async function count(db: Database, table: string, whereId: string): Promise<number> {
  const { rows } = await db.execute<{ c: number }>(
    sql`select count(*)::int as c from ${sql.raw(`"${table}"`)} where id = ${whereId}`,
  );
  return rows[0]?.c ?? 0;
}

/** The fenced org chart the arc runs on: A demoted `sell-only` (still a replication source until it
 * drains), B `serving-primary` (the carrier). Hand-built (signature never verified on a read-back —
 * fence.ts) exactly as `rejoin-e2e.test.ts` does. */
function fenceDoc(term: number, aNodeId: string, bNodeId: string): SignedMembershipDocument {
  const nodes: MembershipNode[] = [
    { nodeId: aNodeId, contactUrl: "https://a", standing: "sell-only" },
    { nodeId: bNodeId, contactUrl: "https://b", standing: "serving-primary" },
  ];
  return { body: { term, nodes }, signerNodeId: bNodeId, signature: "sig", endorsements: [] };
}

/** Create the `app_login` LOGIN fixture that inherits `app_user` — the migrator holds ADMIN OPTION on
 * `app_user` (it created it, probe A) so it can grant the membership; the two-node cluster has no
 * global-setup to create it. Idempotent (roles are cluster-global). */
async function createAppLogin(owner: Database): Promise<void> {
  await owner.execute(
    sql.raw(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_login') THEN
           CREATE ROLE app_login LOGIN PASSWORD 'app_pw' IN ROLE app_user;
         END IF;
       END $$;`,
    ),
  );
}

/** An `app_login` connection to a node's database on the given host URI. */
async function connectApp(hostUri: string): Promise<Database> {
  return createPostgresDb(roleUrl(databaseUrl(hostUri, NODE_DB), "app_login", "app_pw"));
}

// ---------------------------------------------------------------------------------------------------
// Case 1 — every published table is copyable; no `local` table copies.
// ---------------------------------------------------------------------------------------------------
describe("native-replication arc — Case 1: the every-table copy matrix (spec §11)", () => {
  let cluster: TwoNodeCluster;
  let nodeA: BootstrappedNode; // publisher
  let nodeB: BootstrappedNode; // subscriber
  const SUB = subscriptionName(ENV, "11111111-1111-4111-8111-111111111111");

  beforeAll(async () => {
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
    // A publishes BOTH publications from the DERIVED composition-root lists (this file is under
    // apps/server, the composition root, so importing them is not a cycle).
    await createPublications(nodeA.ownerDb, {
      environment: ENV,
      ledgerTables: LEDGER,
      stateTables: STATE,
    });
  }, 300_000);

  afterAll(async () => {
    if (nodeB !== undefined) await dropSubscription(nodeB.ownerDb, SUB).catch(() => {});
    await nodeA?.close();
    await nodeB?.close();
    await cluster?.stop();
  });

  it("publishes exactly the union of the two derived lists, and no local table", async () => {
    const published = await publishedTables(nodeA.ownerDb);

    // The published set is EXACTLY the union of the two derived lists. DELETION control: a list missing
    // one ledger table (`sales`) does NOT equal the published set — so the equality above is pinning the
    // real membership, not a subset. (Failing case: `published` is missing a table and the first
    // assertion throws; or it carries an extra one and the second passes trivially — both caught here.)
    expect(published).toEqual(ALL_PUBLISHED);
    const missingOneLedger = new Set<string>([...LEDGER.slice(1), ...STATE]);
    expect(published).not.toEqual(missingOneLedger);

    // No `local` table is published — the three that must never travel (each other node holds its own).
    for (const local of ["deployment", "node_membership", "tenant_credentials"]) {
      expect(published.has(local)).toBe(false);
    }
  });

  it("B copies every published table to r and every seeded row lands by id; a local table does not copy", async () => {
    const conninfo = buildConninfo({
      host: cluster.nodeA.networkHost,
      port: 5432,
      database: NODE_DB,
      user: REPLICATION_ROLE,
      password: nodeA.replPw,
    });
    await createSubscription(nodeB.ownerDb, {
      name: SUB,
      conninfo,
      publications: PUBS,
      copyData: true,
      enabled: true,
    });

    // Every `pg_subscription_rel` reaches `r` and the total equals the two lists' combined length — so
    // EVERY published table is copyable, not just the ones a later row happens to touch. (Failing case: a
    // table with no replica identity, or absent on the publisher, would leave tablesTotal short or a row
    // stuck below `r`.)
    await expect
      .poll(
        async () => {
          const s = await readSubscriptionStatus(nodeB.ownerDb, SUB);
          return { total: s.tablesTotal, ready: s.tablesReady };
        },
        { timeout: 60_000 },
      )
      .toEqual({ total: LEDGER.length + STATE.length, ready: LEDGER.length + STATE.length });

    // Seed A AFTER the copy is settled, through the REAL write helpers, so every assertion below is about
    // a STREAMED row (the initial copy copied empty tables). `seedFiscalParents` inserts the whole FK
    // closure INCLUDING its `sales` row (a ledger row); reusing its parents gives a `state` working_orders
    // + persons row — one class each side of the divide.
    const ids = await seedFiscalParents(nodeA.ownerDb);
    const woId = randomUUID();
    await nodeA.ownerDb.execute(sql`
      insert into working_orders (id, tenant_id, till_id, node_id, order_number)
      values (${woId}, ${ids.tenantId}, ${ids.tillId}, ${ids.nodeId}, 1)`);
    const personId = randomUUID();
    await nodeA.ownerDb.execute(sql`
      insert into persons (id, tenant_id, display_name, pin_hash, role, status)
      values (${personId}, ${ids.tenantId}, 'Case1 person', 'unusable', 'admin', 'active')`);

    // Each row lands on B by id — ledger (`sales`) and state (`working_orders`, `persons`), plus their
    // state parents (`tenants`/`tills`/`nodes`/`invoice_series`). Poll the last-written class, then read
    // the rest (all arrive in commit order behind it).
    await expect
      .poll(() => count(nodeB.superuserDb, "persons", personId), { timeout: 30_000 })
      .toBe(1);
    expect(await count(nodeB.superuserDb, "sales", ids.saleId)).toBe(1);
    expect(await count(nodeB.superuserDb, "working_orders", woId)).toBe(1);
    expect(await count(nodeB.superuserDb, "tenants", ids.tenantId)).toBe(1);
    expect(await count(nodeB.superuserDb, "invoice_series", ids.seriesId)).toBe(1);

    // A `local` table does NOT copy: stamp A's `deployment` (its own record of what it is) — B, never
    // stamped, has no environment however long we wait, because `deployment` is in neither publication.
    // The `persons` fence above proves the stream is live and has advanced, so B's empty deployment is a
    // real "did-not-copy", not an un-arrived write. (Failing case: `deployment` published → B reads the
    // stamped environment.)
    await stampDeployment(nodeA.ownerDb, ENV);
    expect(await readDeploymentEnvironment(nodeA.superuserDb)).toBe(ENV);
    expect(await readDeploymentEnvironment(nodeB.superuserDb)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------
// Case 2 — the arc: adopt → fence → drain → promote → return → drain-the-tail → wipe → re-adopt.
// ---------------------------------------------------------------------------------------------------
describe("native-replication arc — Case 2: the fence→promote→return→wipe→re-adopt arc (spec §4.2)", () => {
  let cluster: TwoNodeCluster;
  let nodeA: BootstrappedNode; // the venue's original primary, later fenced + wiped
  let nodeB: BootstrappedNode; // the cloud standby, adopts then promotes to primary (the carrier)
  let appA: Database; // app_login on A — assembleMirrorBundle reads the venue rows as app_user
  let appB: Database; // app_login on B — promoteMirrorToPrimary's reads run as app_user
  let stateDirA: string;
  let stateDirB: string;
  let designated: AdoptResult; // A's venue ids
  let standbyNodeId: string; // B's own reserved node id (minted inside adopt)
  let fenceLsn: string;

  const openHandles: Database[] = [];

  beforeAll(async () => {
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
    await createAppLogin(nodeA.ownerDb);
    await createAppLogin(nodeB.ownerDb);
    appA = await connectApp(cluster.nodeA.uri);
    appB = await connectApp(cluster.nodeB.uri);

    // A becomes a FULL primary: a provisioned venue, a stamped `preproduction` deployment, an
    // established node identity key, the box CA on disk, and both publications — everything
    // `assembleMirrorBundle` reads. Stamped primary so its deployment row is what a real primary holds.
    stateDirA = await mkdtemp(join(tmpdir(), "arc-a-"));
    stateDirB = await mkdtemp(join(tmpdir(), "arc-b-"));
    await mkdir(join(stateDirA, "tls"), { recursive: true });
    const caPem = mintSelfSignedServerCert({
      hostnames: ["waitron.local"],
      ipAddresses: [],
      now: new Date(),
    }).caCertPem;
    await writeFile(join(stateDirA, "tls", "ca.crt"), caPem);

    designated = await provisionPrimaryVenue(nodeA.ownerDb);
    await stampDeployment(nodeA.ownerDb, ENV); // (primary, primary) by column default
    await establishNodeIdentity(
      { ownerDb: nodeA.ownerDb, ring: RING },
      designated.tenantId,
      designated.nodeId,
    );
    await createPublications(nodeA.ownerDb, {
      environment: ENV,
      ledgerTables: LEDGER,
      stateTables: STATE,
    });
  }, 300_000);

  afterAll(async () => {
    for (const h of openHandles) await h?.close().catch(() => {});
    await appA?.close().catch(() => {});
    await appB?.close().catch(() => {});
    await nodeA?.close().catch(() => {});
    await nodeB?.close().catch(() => {});
    await cluster?.stop().catch(() => {});
    for (const d of [stateDirA, stateDirB])
      if (d !== undefined) await rm(d, { recursive: true, force: true });
  });

  it("(1) B adopts natively via adoptFromPrimary and the finish worker establishes its reserved identity", async () => {
    const replication: ReplicationConfig = {
      password: nodeA.replPw,
      advertiseHost: cluster.nodeA.networkHost, // the docker-network alias B dials
      advertisePort: 5432,
    };
    const deps: AdoptDeps = {
      ownerDb: nodeB.ownerDb,
      replicationDb: nodeB.ownerDb,
      // fetchBundle runs the REAL assembleMirrorBundle on A in-process, carrying B's minted standby id.
      fetchBundle: (_url, _cred, standby) =>
        assembleMirrorBundle({
          appDb: appA,
          ring: RING,
          stateDir: stateDirA,
          relayUrl: "https://relay.test/",
          boxHostname: "waitron.local",
          designated,
          standby,
          replication,
          database: NODE_DB,
        }),
      advertisedOrigin: "https://b.local",
      environment: ENV,
      persistTrading: async () => {},
      persistModuleConfig: async () => {},
      stateDir: stateDirB,
      databaseUrl: roleUrl(databaseUrl(cluster.nodeB.uri, NODE_DB), "app_login", "app_pw"),
      migrationsDatabaseUrl: roleUrl(
        databaseUrl(cluster.nodeB.uri, NODE_DB),
        "waitron_migrator",
        MIGRATOR_PW,
      ),
      database: NODE_DB,
    };

    const result = await adoptFromPrimary(deps, {
      primaryUrl: "https://a.local",
      credential: { personId: "admin", password: "x" },
    });
    expect(result.tenantId).toBe(designated.tenantId);
    expect(result.breakGlassSecret.length).toBeGreaterThan(0);

    // The pending-adoption latch was written; it carries B's own minted standby identity.
    const pending = await readPendingAdoption(stateDirB);
    expect(pending).not.toBeNull();
    standbyNodeId = pending!.standby.nodeId;
    const SUB_B = subscriptionName(ENV, standbyNodeId);

    // A now holds B's publisher-side slot, named after the SUBSCRIBER (C1). (Failing case: the enable
    // never connected, so no slot appears.)
    await expect
      .poll(
        async () => {
          const { rows } = await nodeA.superuserDb.execute<{ n: string }>(
            sql`select slot_name as n from pg_replication_slots where slot_name = ${SUB_B}`,
          );
          return rows.length;
        },
        { timeout: 30_000 },
      )
      .toBe(1);

    // The boot finish worker: poll until every table reaches `r`, then establish the reserved identity
    // and clear the latch. `sleep` is a short real delay (not `realSleep`'s 2 s), aborted by a timeout so
    // a copy that never settles fails loudly rather than hanging.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      await runFinishAdoption({
        replicationDb: nodeB.ownerDb,
        ring: RING,
        stateDir: stateDirB,
        environment: ENV,
        modules: ALL_MODULES,
        log: noopLog,
        signal: controller.signal,
        sleep: (_ms, signal) =>
          new Promise<void>((resolve) => {
            const t = setTimeout(resolve, 150);
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(t);
                resolve();
              },
              { once: true },
            );
          }),
      });
    } finally {
      clearTimeout(timer);
    }

    // The latch is gone, B holds its OWN reserved node row (a fresh id, distinct from A's designated
    // node) and its reserved disjoint series. (Failing case: the copy never reached `r`, so establish
    // never ran and the file remains / the node row is absent.)
    expect(existsSync(join(stateDirB, "pending-adoption.json"))).toBe(false);
    expect(await count(nodeB.superuserDb, "nodes", standbyNodeId)).toBe(1);
    const { rows: series } = await nodeB.superuserDb.execute<{ c: number }>(
      sql`select count(*)::int as c from invoice_series where node_id = ${standbyNodeId}`,
    );
    expect(series[0]!.c).toBeGreaterThan(0);
    // B is a read-only mirror (adopt stamped it), the precondition promote flips.
    expect(await readDeploymentMode(appB)).toBe("mirror");
  });

  it("(2) A is fenced: its pre-fence sale + rename drain to B, and the slot passes the fence LSN", async () => {
    const SUB_B = subscriptionName(ENV, standbyNodeId);

    // Persist the fenced org chart on BOTH nodes (node_membership is `local`, so no replication
    // conflict): A `sell-only`, B `serving-primary`. B's held chart is what promote flips from; A's is
    // what rejoin later reads.
    const doc = fenceDoc(3, designated.nodeId, standbyNodeId);
    await writeNodeMembership(nodeA.ownerDb, doc);
    await writeNodeMembership(nodeB.ownerDb, doc);

    // One ledger sale + one state rename on A BEFORE fencing, while B still names BOTH publications — so
    // both classes are streaming at this point (the contrast the narrowing later creates). The sale is a
    // self-contained fresh closure (`seedFiscalParents` inserts its `sales` row too, and its state parents
    // stream); the rename is on the ALREADY-COPIED designated location.
    const preFence = await seedFiscalParents(nodeA.ownerDb);
    await nodeA.ownerDb.execute(
      sql`update locations set name = 'Renamed pre-fence' where id = ${designated.locationId}`,
    );
    await expect
      .poll(() => count(nodeB.superuserDb, "sales", preFence.saleId), { timeout: 30_000 })
      .toBe(1);
    // The state rename also arrived (both publications live). Failing case: it did not — but this is the
    // baseline, so it must.
    await expect
      .poll(
        async () =>
          (
            await nodeB.superuserDb.execute<{ name: string }>(
              sql`select name from locations where id = ${designated.locationId}`,
            )
          ).rows[0]?.name,
        { timeout: 30_000 },
      )
      .toBe("Renamed pre-fence");

    // Record A's fence LSN = its current WAL head, then poll the drain watermark (Ruling C2): B has
    // caught up when the slot's confirmed_flush has passed the fence LSN. (Failing case: `isDrained`
    // never turns true because B is not applying.)
    const { rows } = await nodeA.superuserDb.execute<{ lsn: string }>(
      sql`select pg_current_wal_lsn()::text as lsn`,
    );
    fenceLsn = rows[0]!.lsn;
    await nodeA.ownerDb.transaction((tx) => setFenceLsnTx(tx, fenceLsn));
    await expect
      .poll(async () => isDrained(await readSlotDrain(nodeA.ownerDb, SUB_B), fenceLsn), {
        timeout: 30_000,
      })
      .toBe(true);
  });

  it("(3) B promotes to primary via promoteMirrorToPrimary and narrows its subscription to ledger", async () => {
    const SUB_B = subscriptionName(ENV, standbyNodeId);
    let persistedSeries: string | null = null;
    const deps: MirrorPromoteDeps = {
      appDb: appB,
      ownerDb: nodeB.ownerDb,
      holders: createDeploymentHolders("mirror", "secondary"),
      log: noopLog,
      ring: RING,
      tenantId: designated.tenantId,
      nodeId: standbyNodeId,
      persistTradingEnv: async (seriesId) => {
        persistedSeries = seriesId;
      },
      // The REAL narrow: SET PUBLICATION to ledger only (spec §4.2 step 3).
      narrowSubscription: () => setSubscriptionPublications(nodeB.ownerDb, SUB_B, LEDGER_ONLY),
    };

    const result = await promoteMirrorToPrimary(deps, { oldNodeNeutralised: true });
    expect(result.alreadyPrimary).toBe(false);
    expect(persistedSeries).not.toBeNull();

    // B is now the venue's primary on its own identity.
    expect(await readDeploymentMode(appB)).toBe("primary");
    expect(await readSingletonRole(appB)).toBe("primary");

    // Its subscription now names ONLY the ledger publication — the drain window re-copies no state.
    // (Failing case: `narrowSubscription` was a no-op and both publications remain.)
    const status = await readSubscriptionStatus(nodeB.ownerDb, SUB_B);
    expect([...status.publications].sort()).toEqual([...LEDGER_ONLY].sort());
  });

  it("(4) return: A's tail sale ARRIVES on the narrowed B; its state rename does NOT — until B widens", async () => {
    const SUB_B = subscriptionName(ENV, standbyNodeId);

    // As A's owner (A is fenced sell-only but still a replication source until drained), rename the
    // designated location (state) THEN insert a sale on the designated venue (ledger). Order matters: the
    // ledger sale is the FENCE — once it arrives on B, the stream has passed the rename's commit, so a
    // still-old name on B is a real "withheld by the narrow", not an un-arrived write (CLAUDE.md §1).
    await nodeA.ownerDb.execute(
      sql`update locations set name = 'Renamed post-narrow' where id = ${designated.locationId}`,
    );
    const tailSaleId = randomUUID();
    await insertFiscalSale(nodeA.ownerDb, {
      saleId: tailSaleId,
      tenantId: designated.tenantId,
      tillId: designated.tillId,
      nodeId: designated.nodeId,
      seriesId: designated.seriesId,
      locationId: designated.locationId,
      sifId: randomUUID(),
    } as FiscalIds);

    // The ledger sale arrives (the narrowed subscription still carries ledger).
    await expect
      .poll(() => count(nodeB.superuserDb, "sales", tailSaleId), { timeout: 30_000 })
      .toBe(1);
    // The state rename did NOT arrive: with the sale (later in the WAL) already applied, B still holds the
    // pre-narrow name. (Failing case: state still subscribed → B reads 'Renamed post-narrow'.)
    const nameOnB = (
      await nodeB.superuserDb.execute<{ name: string }>(
        sql`select name from locations where id = ${designated.locationId}`,
      )
    ).rows[0]?.name;
    expect(nameOnB).toBe("Renamed pre-fence");

    // DELETION control: widen B's subscription back to BOTH publications. The withheld post-narrow rename
    // is NOT back-filled by a refresh=false widen — the table was never dropped from pg_subscription_rel,
    // so nothing re-copies it (probe C); it returns only on a full re-copy (the re-adopt in step 6). So
    // prove state FLOWS AGAIN with a fresh streamed rename: with state subscribed, it reaches B. This
    // shows the narrowing was what withheld the state change, not some other block. (Failing case of the
    // control: even a fresh rename stays withheld — the widen changed nothing.)
    await setSubscriptionPublications(nodeB.ownerDb, SUB_B, PUBS);
    await nodeA.ownerDb.execute(
      sql`update locations set name = 'Renamed after widen' where id = ${designated.locationId}`,
    );
    await expect
      .poll(
        async () =>
          (
            await nodeB.superuserDb.execute<{ name: string }>(
              sql`select name from locations where id = ${designated.locationId}`,
            )
          ).rows[0]?.name,
        { timeout: 45_000 },
      )
      .toBe("Renamed after widen");
  });

  it("(5) B disables its subscription, A drains + detaches, and rejoinAsSecondary wipes A reclaiming the slot", async () => {
    const SUB_B = subscriptionName(ENV, standbyNodeId);

    // B disables its subscription — the carrier detaches only after it has read drained (the `!active`
    // half of Ruling C2). A's slot goes inactive and stays past the fence LSN.
    await disableSubscription(nodeB.ownerDb, SUB_B);
    await expect
      .poll(
        async () => {
          const d = await readSlotDrain(nodeA.ownerDb, SUB_B);
          return isDrained(d, fenceLsn) && !d.active;
        },
        { timeout: 30_000 },
      )
      .toBe(true);

    // A slot-drain connection on A, closed by closePreWipe before the FORCE drop terminates it.
    const drainConn = await createPostgresDb(
      roleUrl(databaseUrl(cluster.nodeA.uri, NODE_DB), "waitron_migrator", MIGRATOR_PW),
    );

    const deps: RejoinDeps = {
      held: fenceDoc(3, designated.nodeId, standbyNodeId), // A sell-only, B carrier
      nodeId: designated.nodeId,
      readSlotDrain: () => readSlotDrain(drainConn, SUB_B),
      fenceLsn,
      acceptLoss: false,
      closePreWipe: async () => {
        // Every one of OUR connections to A's database must be gone before DROP DATABASE … WITH (FORCE).
        await drainConn.close().catch(() => {});
        await appA.close().catch(() => {});
        await nodeA.close().catch(() => {});
      },
      wipeDatabase: async () => {
        // DROP as the migrator-owner from a maintenance db (reclaims the inactive slot with the db,
        // probe F); CREATE as the superuser holding CREATEDB (the migrator lacks it, probe A). Both
        // handles connect to the container default db — Postgres refuses to drop the db a session is on.
        const dropAsOwner = await createPostgresDb(
          withRoleOption(cluster.nodeA.uri, "waitron_migrator"),
        );
        const createAs = await createPostgresDb(cluster.nodeA.uri);
        try {
          await dropAndCreateDatabase({
            dropAs: dropAsOwner,
            createAs,
            database: NODE_DB,
            owner: "waitron_migrator",
          });
        } finally {
          await dropAsOwner.close().catch(() => {});
          await createAs.close().catch(() => {});
        }
        // Re-migrate the fresh db migrator-owned, so the re-adopt (step 6) copies into existing tables.
        await applyMigrations(
          roleUrl(databaseUrl(cluster.nodeA.uri, NODE_DB), "waitron_migrator", MIGRATOR_PW),
          migrationOptionsFor(manifestSets(), null),
        );
      },
      log: noopLog,
    };

    const rejoin = await rejoinAsSecondary(deps);
    expect(rejoin).toEqual({ wiped: true, carrierNodeId: standbyNodeId });

    // A's slot is gone (the DROP DATABASE FORCE reclaimed it — no slot drop of rejoin's own, Ruling I3),
    // and A's db is empty (re-migrated: tables exist, no venue rows) and migrator-owned.
    const maint = await createPostgresDb(cluster.nodeA.uri);
    const freshA = await createPostgresDb(databaseUrl(cluster.nodeA.uri, NODE_DB));
    openHandles.push(maint, freshA);
    const slots = await maint.execute<{ n: string }>(
      sql`select slot_name as n from pg_replication_slots where slot_name = ${SUB_B}`,
    );
    expect(slots.rows).toEqual([]);
    const owner = await maint.execute<{ owner: string }>(
      sql`select pg_get_userbyid(datdba) as owner from pg_database where datname = ${NODE_DB}`,
    );
    expect(owner.rows[0]?.owner).toBe("waitron_migrator");
    const tenants = await freshA.execute<{ c: number }>(
      sql`select count(*)::int as c from tenants`,
    );
    expect(tenants.rows[0]?.c).toBe(0);

    await drainConn.close().catch(() => {});
  });

  it("(6) B GCs its orphaned subscription, publishes, and A re-adopts — copying B's post-promotion sale", async () => {
    const SUB_B = subscriptionName(ENV, standbyNodeId);

    // B still holds the subscription to the now-wiped A, whose publisher-side slot vanished with A's db.
    // The cloud-side GC Task 7 deferred to here: dropSubscriptionDetached clears the dead slot reference
    // (SET slot_name=NONE) then drops — a plain DROP would hang trying to drop the gone remote slot.
    await dropSubscriptionDetached(nodeB.ownerDb, SUB_B);
    const remaining = await nodeB.superuserDb.execute<{ n: string }>(
      sql`select subname as n from pg_subscription where subname = ${SUB_B}`,
    );
    expect(remaining.rows).toEqual([]);

    // B, now the primary, writes a genuinely B-authored fiscal sale (its post-promotion ledger — the
    // `sales` row `seedFiscalParents` inserts), and publishes so a returning secondary can adopt from it.
    const bSale = await seedFiscalParents(nodeB.ownerDb);
    await createPublications(nodeB.ownerDb, {
      environment: ENV,
      ledgerTables: LEDGER,
      stateTables: STATE,
    });

    // A re-adopts from B under a FRESH identity: a fresh subscriber node id, a fresh initial copy of
    // every published table. (The wiped A re-adopts natively; a full assembleMirrorBundle round-trip is
    // Task 1/5's ground — here the copy fidelity is the property.)
    const reAdoptId = randomUUID();
    const READOPT_SUB = subscriptionName(ENV, reAdoptId);
    const aReadopt = await createPostgresDb(
      roleUrl(databaseUrl(cluster.nodeA.uri, NODE_DB), "waitron_migrator", MIGRATOR_PW),
    );
    openHandles.push(aReadopt);
    await createSubscription(aReadopt, {
      name: READOPT_SUB,
      conninfo: buildConninfo({
        host: cluster.nodeB.networkHost,
        port: 5432,
        database: NODE_DB,
        user: REPLICATION_ROLE,
        password: nodeB.replPw,
      }),
      publications: PUBS,
      copyData: true,
      enabled: true,
    });

    // Every table reaches `r` on A's fresh copy, and A holds B's post-promotion sale. (Failing case: the
    // copy stalls, so tablesReady stays short or the sale is absent on A.)
    await expect
      .poll(
        async () => {
          const s = await readSubscriptionStatus(aReadopt, READOPT_SUB);
          return s.tablesTotal > 0 && s.tablesReady === s.tablesTotal
            ? { total: s.tablesTotal, ready: s.tablesReady }
            : null;
        },
        { timeout: 90_000 },
      )
      .toEqual({ total: LEDGER.length + STATE.length, ready: LEDGER.length + STATE.length });
    expect(await count(aReadopt, "sales", bSale.saleId)).toBe(1);

    await dropSubscription(aReadopt, READOPT_SUB).catch(() => {});
  });
});

/** Provision a fresh venue on the OWNER connection (`applyVenue`), returning the five designated ids in
 * `AdoptResult` shape — the same setup `mirror-bundle.test.ts` uses, so `assembleMirrorBundle` has a
 * real tenant + node to read. */
async function provisionPrimaryVenue(ownerDb: Database): Promise<AdoptResult> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: "89123456K",
        legalName: "Arc Venue SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: ["es-ES"],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        tillName: "Caja 1",
        seriesCode: "FA",
        rectificativeSeriesCode: "RF",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
        },
      },
      ALL_MODULES,
    ),
    { db: ownerDb, modules: ALL_MODULES },
  );
  return {
    tenantId: venue.tenantId,
    locationId: venue.locationId,
    tillId: venue.tillId,
    nodeId: venue.nodeId,
    seriesId: venue.seriesIds[0]!,
  };
}

/** `uri` with an `options=-c role=<role>` parameter so a superuser session runs AS that role (probe A/F).
 * Local to this file — `withRole` lives in `@waitron/provisioning` but importing it here for one wipe is
 * heavier than the two lines. */
function withRoleOption(uri: string, role: string): string {
  const u = new URL(uri);
  u.searchParams.set("options", `-c role=${role}`);
  return u.toString();
}
