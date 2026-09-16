// Real PostgreSQL, two nodes joined by a WireGuard tunnel: proof that native logical replication
// runs over the encrypted box↔cloud link, not just over a trusted LAN. This is the local stand-in
// for the cloud standby's transport — the same publication/subscription verbs and the same real
// `waitron_repl` role as replication-subscribe.pg.test.ts, but node B dials node A by A's TUNNEL
// address (`tunnelHost`), which lives only on `wg0`. A row that reaches B can only have crossed the
// tunnel. The sibling suite proves the verbs and the name-carried environment isolation over the
// Docker network; this suite adds the one thing it cannot — that the encrypted link carries the copy.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  startTwoNodeWireguardCluster,
  type TwoNodeWireguardCluster,
} from "@waitron/db/testing/two-node-wireguard.js";
import { REPLICATION_ROLE } from "@waitron/provisioning";
import {
  buildConninfo,
  createPublications,
  createSubscription,
  dropSubscription,
} from "@waitron/sync";
import {
  provisionAndBootstrapNode,
  type BootstrappedNode,
} from "@waitron/provisioning/testing/replication-node.js";

// The same small hardcoded real-table list the sibling suites use. `tenants`/`locations` are state
// (S1).
const LEDGER = ["sales", "tenders"];
const STATE = ["tenants", "locations"];

const REPL_PASSWORD = "repl_secret_pw";
const NODE_DB = "waitron_repl_node";
const SUB = "waitron_sub_over_tunnel";
const PREPROD_PUBS = ["waitron_preproduction_ledger", "waitron_preproduction_state"];

// A root state table with no FK parents. The taxpayer row cannot serve as the probe any more:
// there is exactly one of it per database.
const insertProbe = (marker: string) =>
  sql`insert into locations (name, invoice_locales, operation_description)
      values (${marker}, array['es-ES'], 'Hospitality')`;
const countProbe = (marker: string) =>
  sql`select count(*)::int as c from locations where name = ${marker}`;

// No Docker gate: without Docker, `startTwoNodeWireguardCluster` throws before starting anything
// (packages/db/src/testing/two-node-wireguard.ts:236), so this describe's `beforeAll` throws and the run fails.
describe("native replication over a WireGuard tunnel", () => {
  let cluster: TwoNodeWireguardCluster;
  let nodeA: BootstrappedNode;
  let nodeB: BootstrappedNode;
  // B's libpq conninfo to A over the TUNNEL: A's `wg0` address (not its Docker alias), A's target
  // db, the real `waitron_repl` login and A's replication password.
  let conninfoToA: string;

  beforeAll(async () => {
    // Two `postgres:18-alpine` nodes joined by WireGuard. We do not use the fixture's `migrate` hook
    // (it would migrate as the superuser); each node is provisioned AS the migrator afterward so
    // `waitron_migrator` owns every table — the shape `CREATE PUBLICATION … FOR TABLE` requires.
    cluster = await startTwoNodeWireguardCluster({ dockerRequired: true });
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
      host: cluster.nodeA.tunnelHost,
      port: 5432,
      database: nodeA.dbName,
      user: REPLICATION_ROLE,
      password: nodeA.replPw,
    });
    await createPublications(nodeA.ownerDb, {
      environment: "preproduction",
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

  it("copies a state row A→B through the encrypted link", async () => {
    // B subscribes to A over the tunnel, naming both preproduction publications, enabled and copying.
    await createSubscription(nodeB.ownerDb, {
      name: SUB,
      conninfo: conninfoToA,
      publications: PREPROD_PUBS,
      copyData: true,
      enabled: true,
    });

    const marker = "TUNNEL_PROBE";
    await nodeA.ownerDb.execute(insertProbe(marker));
    await expect
      .poll(
        async () => (await nodeB.superuserDb.execute<{ c: number }>(countProbe(marker))).rows[0]?.c,
        { timeout: 30_000 },
      )
      .toBe(1);
  });
});
