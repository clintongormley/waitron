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

// Acquire retry + setup-path cleanup, driven through the `startNetwork`/`startNode` seams so no
// daemon is needed. Two invariants are pinned here. (1) A transiently-starved boot must recover: the
// whole acquire (network → both nodes → migrate) retries up to three attempts, and each failed
// attempt tears down exactly what it brought up before the next tries in a calmer window. (2) A
// half-built attempt never leaks: nodes boot in parallel with `allSettled`, so if one node comes up
// while its partner fails, the survivor is captured and stopped, not abandoned in flight. A Codex
// reviewer originally proved the no-retry setup path leaked on a `migrate()` throw; the retry loop
// keeps that leak-safety per attempt.
describe("startTwoNodeCluster acquire retry and cleanup", () => {
  const fakeNode = (alias: string): ReplNode => ({
    uri: `postgres://${alias}/db`,
    networkHost: alias,
    run: async () => {},
    query: async () => [],
  });

  // A fresh network fake per attempt, recording its own teardown (by tag) into `stopped`.
  const makeNetwork = (stopped: string[], tag: string): StartedNetwork =>
    ({
      stop: async () => {
        stopped.push(tag);
      },
    }) as unknown as StartedNetwork;

  it("retries a failed acquire attempt and succeeds on the next", async () => {
    const stopped: string[] = [];
    let netCalls = 0;
    const startNetwork = async (): Promise<StartedNetwork> => {
      netCalls += 1;
      return makeNetwork(stopped, `network-${netCalls}`);
    };
    // Attempt 1: both nodes reject. Attempt 2 (a calmer window): both come up.
    const startNode = async (_network: StartedNetwork, alias: string): Promise<StartedReplNode> => {
      if (netCalls === 1) throw new Error(`boot ${alias} starved`);
      return { node: fakeNode(alias), stop: async () => {} };
    };

    const cluster = await startTwoNodeCluster({ migrate: async () => {}, startNetwork, startNode });

    // Without the retry loop, attempt 1's rejection would propagate and no cluster would return.
    expect(cluster.nodeA.networkHost).toBe("node-a");
    expect(cluster.nodeB.networkHost).toBe("node-b");
    // Attempt 1's network was torn down; attempt 2's is still live (it backs the cluster).
    expect(stopped).toEqual(["network-1"]);
  });

  it("captures and stops a partial attempt's survivor, then retries to success", async () => {
    const stopped: string[] = [];
    let netCalls = 0;
    const startNetwork = async (): Promise<StartedNetwork> => {
      netCalls += 1;
      return makeNetwork(stopped, `network-${netCalls}`);
    };
    // Attempt 1: node-a comes up, node-b rejects. allSettled must still capture node-a for teardown.
    const startNode = async (_network: StartedNetwork, alias: string): Promise<StartedReplNode> => {
      if (netCalls === 1) {
        if (alias === "node-b") throw new Error("node-b starved");
        return {
          node: fakeNode(alias),
          stop: async () => {
            stopped.push("node-a@1");
          },
        };
      }
      return { node: fakeNode(alias), stop: async () => {} };
    };

    const cluster = await startTwoNodeCluster({ migrate: async () => {}, startNetwork, startNode });

    expect(cluster.nodeA.networkHost).toBe("node-a");
    // The survivor node-a was NOT leaked; attempt-1 teardown is nodes-before-network.
    expect(stopped).toEqual(["node-a@1", "network-1"]);
  });

  it("throws the last attempt's error and tears down every attempt's resources when all fail", async () => {
    const stopped: string[] = [];
    let netCalls = 0;
    const startNetwork = async (): Promise<StartedNetwork> => {
      netCalls += 1;
      return makeNetwork(stopped, `network-${netCalls}`);
    };
    // Every node on every attempt rejects, tagged by the attempt that produced it.
    const startNode = async (): Promise<StartedReplNode> => {
      throw new Error(`boot starved on attempt ${netCalls}`);
    };

    await expect(
      startTwoNodeCluster({ migrate: async () => {}, startNetwork, startNode }),
    ).rejects.toThrow("attempt 3");

    // Three attempts ran; each attempt's network came up and was torn down (nodes never did).
    expect(netCalls).toBe(3);
    expect(stopped).toEqual(["network-1", "network-2", "network-3"]);
  });

  it("starts both nodes concurrently within an attempt", async () => {
    const entered: string[] = [];
    let releaseA!: () => void;
    const aGate = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    // node-a parks on a gate that only node-b's entry opens. If the two booted sequentially
    // (await a fully, then start b), node-a would park forever and this test would time out; reaching
    // the assertions proves both were in flight at once.
    const startNode = async (_network: StartedNetwork, alias: string): Promise<StartedReplNode> => {
      entered.push(alias);
      if (alias === "node-b") releaseA();
      if (alias === "node-a") await aGate;
      return { node: fakeNode(alias), stop: async () => {} };
    };

    const cluster = await startTwoNodeCluster({
      migrate: async () => {},
      startNetwork: async () => makeNetwork([], "network-1"),
      startNode,
    });

    expect(entered).toContain("node-a");
    expect(entered).toContain("node-b");
    await cluster.stop();
  }, 2000);

  it("swallows a wedged stop() during a failed attempt and still retries to success", async () => {
    const stopped: string[] = [];
    let netCalls = 0;
    const startNetwork = async (): Promise<StartedNetwork> => {
      netCalls += 1;
      return makeNetwork(stopped, `network-${netCalls}`);
    };
    // Attempt 1: both nodes come up, migrate throws, and node-b's stop() wedges. Attempt 2: clean.
    const startNode = async (
      _network: StartedNetwork,
      alias: string,
    ): Promise<StartedReplNode> => ({
      node: fakeNode(alias),
      stop: async () => {
        if (netCalls === 1 && alias === "node-b") throw new Error("wedged stop");
        stopped.push(`${alias}@${netCalls}`);
      },
    });

    const cluster = await startTwoNodeCluster({
      migrate: async () => {
        if (netCalls === 1) throw new Error("migration starved");
      },
      startNetwork,
      startNode,
    });

    expect(cluster.nodeA.networkHost).toBe("node-a");
    // node-b's wedged stop did not strand node-a or the network in attempt 1.
    expect(stopped).toEqual(["node-a@1", "network-1"]);
  });

  it("tears down BOTH nodes and the network when a later step throws after both are up", async () => {
    const stopped: string[] = [];
    let netCalls = 0;
    const startNetwork = async (): Promise<StartedNetwork> => {
      netCalls += 1;
      return makeNetwork(stopped, `network-${netCalls}`);
    };
    // Attempt 1: both nodes come up cleanly (neither stop wedges), then migrate throws. Attempt 2: clean.
    const startNode = async (
      _network: StartedNetwork,
      alias: string,
    ): Promise<StartedReplNode> => ({
      node: fakeNode(alias),
      stop: async () => {
        stopped.push(`${alias}@${netCalls}`);
      },
    });

    const cluster = await startTwoNodeCluster({
      migrate: async () => {
        if (netCalls === 1) throw new Error("migration starved");
      },
      startNetwork,
      startNode,
    });

    expect(cluster.nodeA.networkHost).toBe("node-a");
    // BOTH fulfilled nodes were captured and torn down — reverse order, node before network. A
    // regression that dropped the second fulfilled node from teardown (e.g. a `break` after the first
    // fulfilled result) would leak node-b's container and this assertion would miss `node-b@1`.
    expect(stopped).toEqual(["node-b@1", "node-a@1", "network-1"]);
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
