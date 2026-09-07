import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTwoNodeCluster, type TwoNodeCluster } from "./two-node.js";
import { dockerAvailable } from "./harness.js";
import { runMigrationSets } from "./postgres.js";
import { CORE_MIGRATIONS } from "../migrations.js";

// Real-Docker smoke test for the two-node logical-replication fixture (swap S1). It proves exactly
// the two capabilities the S2 replication suites lean on: both nodes run with `wal_level=logical`,
// and a row published on one node reaches the other over the Docker network. The mechanism check
// uses a throwaway table so it stays uncoupled from any real schema; the real waitron_repl /
// waitron_migrator roles are S2's concern, so the subscription connects as the container's default
// superuser (which carries REPLICATION).

describe.runIf(dockerAvailable())("two-node fixture", () => {
  let cluster: TwoNodeCluster;

  beforeAll(async () => {
    cluster = await startTwoNodeCluster({
      migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
      dockerRequired: true,
    });
  }, 180_000);

  afterAll(async () => {
    await cluster?.stop();
  });

  it("runs postgres with wal_level=logical on both nodes", async () => {
    for (const node of [cluster.nodeA, cluster.nodeB]) {
      const [row] = await node.query<{ wal_level: string }>("SHOW wal_level");
      expect(row!.wal_level).toBe("logical");
    }
  });

  it("copies a row A→B over the network via a raw publication/subscription", async () => {
    for (const node of [cluster.nodeA, cluster.nodeB]) {
      await node.run(`CREATE TABLE repl_smoke (id int primary key, v text)`);
    }
    await cluster.nodeA.run(`INSERT INTO repl_smoke (id, v) VALUES (1, 'hello')`);
    await cluster.nodeA.run(`CREATE PUBLICATION smoke_pub FOR TABLE repl_smoke`);

    // The subscriber dials node A by its network alias, as the container's default superuser.
    const a = new URL(cluster.nodeA.uri);
    const conn = `host=${cluster.nodeA.networkHost} port=5432 user=${a.username} password=${a.password} dbname=${a.pathname.slice(1)}`;
    await cluster.nodeB.run(
      `CREATE SUBSCRIPTION smoke_sub CONNECTION '${conn}' PUBLICATION smoke_pub WITH (copy_data = true, origin = none)`,
    );

    await expect
      .poll(
        async () =>
          (
            await cluster.nodeB.query<{ c: number }>(`SELECT count(*)::int AS c FROM repl_smoke`)
          )[0]!.c,
        { timeout: 30_000 },
      )
      .toBe(1);

    // Prove the actual row copied, not merely a row count.
    const [row] = await cluster.nodeB.query<{ v: string }>(`SELECT v FROM repl_smoke WHERE id = 1`);
    expect(row!.v).toBe("hello");

    // Drop the subscription before teardown so its walsender/apply worker releases node A's
    // replication slot cleanly.
    await cluster.nodeB.run(`DROP SUBSCRIPTION smoke_sub`);
  });
});
