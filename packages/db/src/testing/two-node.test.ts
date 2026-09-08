import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTwoNodeCluster,
  type ReplNode,
  type StartedNetwork,
  type StartedReplNode,
  type TwoNodeCluster,
} from "./two-node.js";
import { dockerAvailable } from "./harness.js";
import { runMigrationSets } from "./postgres.js";
import { CORE_MIGRATIONS } from "../migrations.js";

// Setup-path cleanup, driven through the `startNetwork`/`startNode` seams so no daemon is needed. A
// Codex reviewer proved that a `migrate()` throw (and, likewise, a container that fails to start)
// used to leak the already-started containers and network: the acquisition ran with no try/finally,
// so only the returned cluster's `stop()` was leak-safe, never the setup path. These pin that a
// failure at either step stops exactly what came up.
describe("startTwoNodeCluster setup-failure cleanup", () => {
  const fakeNode = (alias: string): ReplNode => ({
    uri: `postgres://${alias}/db`,
    networkHost: alias,
    run: async () => {},
    query: async () => [],
  });

  it("stops both started nodes and the network when migration throws", async () => {
    const stopped: string[] = [];
    const fakeNetwork = {
      stop: async () => {
        stopped.push("network");
      },
    } as unknown as StartedNetwork;
    const startNode = async (
      _network: StartedNetwork,
      alias: string,
    ): Promise<StartedReplNode> => ({
      node: fakeNode(alias),
      stop: async () => {
        stopped.push(alias);
      },
    });
    const boom = new Error("migration failed");

    await expect(
      startTwoNodeCluster({
        migrate: async () => {
          throw boom;
        },
        startNetwork: async () => fakeNetwork,
        startNode,
      }),
    ).rejects.toBe(boom);

    // Both nodes were up before migration ran, so all three are torn down — nodes before the network.
    expect(stopped).toEqual(["node-b", "node-a", "network"]);
  });

  it("stops the network and the first node when a later container fails to start", async () => {
    const stopped: string[] = [];
    const fakeNetwork = {
      stop: async () => {
        stopped.push("network");
      },
    } as unknown as StartedNetwork;
    const boom = new Error("container start failed");
    let calls = 0;
    const startNode = async (_network: StartedNetwork, alias: string): Promise<StartedReplNode> => {
      calls += 1;
      if (calls === 2) throw boom;
      return {
        node: fakeNode(alias),
        stop: async () => {
          stopped.push(alias);
        },
      };
    };

    await expect(
      startTwoNodeCluster({
        migrate: async () => {},
        startNetwork: async () => fakeNetwork,
        startNode,
      }),
    ).rejects.toBe(boom);

    // node-b never started; node-a and the network did, and both are stopped.
    expect(stopped).toEqual(["node-a", "network"]);
  });

  it("does not let one node's stop() failure strand the rest", async () => {
    const stopped: string[] = [];
    const fakeNetwork = {
      stop: async () => {
        stopped.push("network");
      },
    } as unknown as StartedNetwork;
    const startNode = async (
      _network: StartedNetwork,
      alias: string,
    ): Promise<StartedReplNode> => ({
      node: fakeNode(alias),
      stop: async () => {
        if (alias === "node-b") throw new Error("wedged stop");
        stopped.push(alias);
      },
    });

    await expect(
      startTwoNodeCluster({
        migrate: async () => {
          throw new Error("migration failed");
        },
        startNetwork: async () => fakeNetwork,
        startNode,
      }),
    ).rejects.toThrow("migration failed");

    // node-b's stop() threw; node-a and the network are still torn down.
    expect(stopped).toEqual(["node-a", "network"]);
  });
});

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

// The `command` override (swap S4, I4): Case 4 of the fiscal fidelity suite needs an 8 MB
// `max_slot_wal_keep_size` so a WAL overflow invalidates the slot — but the fixture's own
// `-c max_slot_wal_keep_size=4GB` boot flag (a `PGC_S_ARGV` setting) outranks any later `ALTER
// SYSTEM`, so the small bound has to be a BOOT flag too. This proves the caller-supplied command
// reaches postgres on both nodes; without threading `options.command` through, `SHOW` returns the
// default `4GB` and this fails.
describe.runIf(dockerAvailable())("two-node fixture — custom postgres command", () => {
  let cluster: TwoNodeCluster;

  beforeAll(async () => {
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
  }, 180_000);

  afterAll(async () => {
    await cluster?.stop();
  });

  it("boots both nodes with the caller's max_slot_wal_keep_size", async () => {
    for (const node of [cluster.nodeA, cluster.nodeB]) {
      const [row] = await node.query<{ max_slot_wal_keep_size: string }>(
        "SHOW max_slot_wal_keep_size",
      );
      expect(row!.max_slot_wal_keep_size).toBe("8MB");
    }
  });
});
