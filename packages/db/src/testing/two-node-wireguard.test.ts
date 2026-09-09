import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  execOrThrow,
  startRealWireguardNode,
  startTwoNodeWireguardCluster,
  type NodePlan,
  type StartedNetwork,
  type StartedWireguardNode,
  type TwoNodeWireguardCluster,
  type WireguardContainer,
  type WireguardReplNode,
} from "./two-node-wireguard.js";
import { dockerAvailable } from "./harness.js";
import type { ClusterMutex, Release } from "./cluster-mutex.js";

// A mutex that never locks — keeps the seam tests off the real machine-wide file lock (which the
// real-Docker smoke suite exercises).
const noopMutex: ClusterMutex = { acquire: async () => async () => {} };

const makeSpyMutex = (events: string[]): { mutex: ClusterMutex; held: () => number } => {
  let held = 0;
  const mutex: ClusterMutex = {
    acquire: async () => {
      held += 1;
      events.push("acquire");
      const release: Release = async () => {
        held -= 1;
        events.push("release");
      };
      return release;
    },
  };
  return { mutex, held: () => held };
};

// Setup-path cleanup, driven through the `startNetwork`/`startNode` seams so no daemon is needed —
// the same discipline (and the same class of leak) the sibling two-node fixture pins: a failure
// after some resources came up must tear down exactly those, nodes before the network.
describe("startTwoNodeWireguardCluster setup-failure cleanup", () => {
  const fakeNode = (plan: { tunnelHost: string }): WireguardReplNode => ({
    uri: `postgres://node/db`,
    networkHost: "node",
    tunnelHost: plan.tunnelHost,
    run: async () => {},
    query: async () => [],
    execInContainer: async () => ({ exitCode: 0, output: "" }),
  });
  const fakeNetwork = (stopped: string[]): StartedNetwork =>
    ({
      stop: async () => {
        stopped.push("network");
      },
    }) as unknown as StartedNetwork;
  const startedNode = (
    tunnelHost: string,
    stopped: string[],
    stop?: () => Promise<void>,
  ): StartedWireguardNode => ({
    node: fakeNode({ tunnelHost }),
    publicKey: `pub-${tunnelHost}`,
    configurePeer: async () => {},
    stop:
      stop ??
      (async () => {
        stopped.push(tunnelHost);
      }),
  });

  it("configures peers using their actual network names", async () => {
    const endpoints: string[] = [];
    const cluster = await startTwoNodeWireguardCluster({
      startNetwork: async () => fakeNetwork([]),
      startNode: async (_network, plan) => ({
        ...startedNode(plan.tunnelHost, []),
        node: { ...fakeNode(plan), networkHost: `unique-${plan.alias}` },
        configurePeer: async (peer) => {
          endpoints.push(peer.endpoint);
        },
      }),
      mutex: noopMutex,
    });
    try {
      expect(endpoints).toEqual(["unique-node-b:51820", "unique-node-a:51820"]);
    } finally {
      await cluster.stop();
    }
  });

  it("stops both started nodes and the network when migration throws", async () => {
    const stopped: string[] = [];
    const boom = new Error("migration failed");
    await expect(
      startTwoNodeWireguardCluster({
        migrate: async () => {
          throw boom;
        },
        startNetwork: async () => fakeNetwork(stopped),
        startNode: async (_network, plan) => startedNode(plan.tunnelHost, stopped),
        mutex: noopMutex,
      }),
    ).rejects.toBe(boom);
    // Both nodes were up (and peered) before migration ran — all three torn down, nodes first.
    expect(stopped).toEqual(["10.99.0.2", "10.99.0.1", "network"]);
  });

  it("stops the network and the first node when a later container fails to start", async () => {
    const stopped: string[] = [];
    const boom = new Error("container start failed");
    let calls = 0;
    await expect(
      startTwoNodeWireguardCluster({
        migrate: async () => {},
        startNetwork: async () => fakeNetwork(stopped),
        startNode: async (_network, plan) => {
          calls += 1;
          if (calls === 2) throw boom;
          return startedNode(plan.tunnelHost, stopped);
        },
        mutex: noopMutex,
      }),
    ).rejects.toBe(boom);
    // node-b never started; node-a and the network did, and both are stopped.
    expect(stopped).toEqual(["10.99.0.1", "network"]);
  });

  it("does not let one node's stop() failure strand the rest", async () => {
    const stopped: string[] = [];
    await expect(
      startTwoNodeWireguardCluster({
        migrate: async () => {
          throw new Error("migration failed");
        },
        startNetwork: async () => fakeNetwork(stopped),
        startNode: async (_network, plan) =>
          startedNode(
            plan.tunnelHost,
            stopped,
            plan.tunnelHost === "10.99.0.2"
              ? async () => {
                  throw new Error("wedged stop");
                }
              : undefined,
          ),
        mutex: noopMutex,
      }),
    ).rejects.toThrow("migration failed");
    // node-b's stop() threw; node-a and the network are still torn down.
    expect(stopped).toEqual(["10.99.0.1", "network"]);
  });
});

// The cross-process mutex wiring for the WireGuard fixture — same invariant as the sibling fixture:
// acquire before the first boot, release on stop() and on setup-failure cleanup, so the two fixtures
// never run a cluster concurrently.
describe("startTwoNodeWireguardCluster cluster mutex", () => {
  const spyNode = (events: string[], plan: NodePlan): StartedWireguardNode => ({
    node: {
      uri: "postgres://node/db",
      networkHost: plan.alias,
      tunnelHost: plan.tunnelHost,
      run: async () => {},
      query: async () => [],
      execInContainer: async () => ({ exitCode: 0, output: "" }),
    },
    publicKey: `pub-${plan.tunnelHost}`,
    configurePeer: async () => {},
    stop: async () => {
      events.push(`stop:${plan.tunnelHost}`);
    },
  });

  it("acquires the mutex before the first boot and releases it on stop()", async () => {
    const events: string[] = [];
    const { mutex, held } = makeSpyMutex(events);
    const cluster = await startTwoNodeWireguardCluster({
      migrate: async () => {},
      startNetwork: async () => {
        events.push("network");
        return { stop: async () => {} } as unknown as StartedNetwork;
      },
      startNode: async (_network, plan) => {
        events.push(`node:${plan.tunnelHost}`);
        return spyNode(events, plan);
      },
      mutex,
    });

    expect(events[0]).toBe("acquire");
    expect(events.indexOf("acquire")).toBeLessThan(events.indexOf("network"));
    expect(held()).toBe(1);
    expect(events).not.toContain("release");

    await cluster.stop();
    expect(events.at(-1)).toBe("release");
    expect(held()).toBe(0);
  });

  it("releases the mutex when setup fails", async () => {
    const events: string[] = [];
    const { mutex, held } = makeSpyMutex(events);
    await expect(
      startTwoNodeWireguardCluster({
        migrate: async () => {
          throw new Error("migration failed");
        },
        startNetwork: async () => ({ stop: async () => {} }) as unknown as StartedNetwork,
        startNode: async (_network, plan) => spyNode(events, plan),
        mutex,
      }),
    ).rejects.toThrow("migration failed");
    expect(held()).toBe(0);
    expect(events).toContain("release");
  });

  it("defaults to the real machine-wide mutex, which the escape hatch can disable", async () => {
    const prev = process.env.WAITRON_TWO_NODE_MUTEX;
    process.env.WAITRON_TWO_NODE_MUTEX = "0";
    try {
      const cluster = await startTwoNodeWireguardCluster({
        migrate: async () => {},
        startNetwork: async () => ({ stop: async () => {} }) as unknown as StartedNetwork,
        startNode: async (_network, plan) => spyNode([], plan),
      });
      await cluster.stop();
    } finally {
      if (prev === undefined) delete process.env.WAITRON_TWO_NODE_MUTEX;
      else process.env.WAITRON_TWO_NODE_MUTEX = prev;
    }
  });
});

describe("execOrThrow", () => {
  it("throws with the command and output when the exit code is non-zero", async () => {
    const container = { exec: async () => ({ exitCode: 2, output: "no such package" }) };
    await expect(execOrThrow(container, ["apk", "add", "nope"])).rejects.toThrow(
      "command `apk add nope` failed (exit 2): no such package",
    );
  });
});

describe("startRealWireguardNode", () => {
  it("stops its container when WireGuard bring-up fails, so it does not leak", async () => {
    // The container has come up, but a bring-up step fails (here the first `apk add`). It must be
    // stopped before the error propagates — otherwise it survives until `pnpm reap`. Reproduces the
    // gap the run-it review found: the seam tests above cover the CLUSTER's teardown, not this.
    let stops = 0;
    const container: WireguardContainer = {
      getConnectionUri: () => "postgres://unused/db",
      exec: async () => ({ exitCode: 1, output: "temporary failure resolving" }),
      stop: async () => {
        stops += 1;
      },
    };
    const plan: NodePlan = { alias: "node-a", tunnelHost: "10.99.0.1" };
    await expect(
      startRealWireguardNode({} as StartedNetwork, plan, async () => container),
    ).rejects.toThrow("apk add");
    expect(stops).toBe(1);
  });
});

// Real-Docker smoke test for the WireGuard two-node fixture: two `postgres:18-alpine` nodes joined
// by an encrypted WireGuard tunnel, standing in for a box and its cloud twin across an untrusted
// network. The tunnel addresses (10.99.0.x) live ONLY on each node's `wg0` interface, so a
// connection that lands on a peer's `tunnelHost` proves the traffic crossed the tunnel — the Docker
// network alias would be a different address entirely. This fixture is the local stand-in for the
// box↔cloud link the cloud standby runs over (the replication that rides it is written up in
// `docs/superpowers/specs/2026-09-05-native-replication-post-rls-prototype-findings.md`, which used
// plain TCP; the encrypted WireGuard transport is what this fixture adds).
describe.runIf(dockerAvailable())("two-node WireGuard fixture", () => {
  let cluster: TwoNodeWireguardCluster;

  beforeAll(async () => {
    cluster = await startTwoNodeWireguardCluster({ dockerRequired: true });
  }, 180_000);

  afterAll(async () => {
    await cluster?.stop();
  });

  it("boots with wal_level=logical, and run() executes statements query() reads back", async () => {
    for (const node of [cluster.nodeA, cluster.nodeB]) {
      const [wal] = await node.query<{ wal_level: string }>("SHOW wal_level");
      expect(wal!.wal_level).toBe("logical");
      // run() must have an observable effect: if it were a no-op the SELECT below would find no
      // table and throw (the gap the run-it review found — a no-op run() had passed every test).
      await node.run("CREATE TABLE run_probe (v int)");
      await node.run("INSERT INTO run_probe VALUES (42)");
      const [row] = await node.query<{ v: number }>("SELECT v FROM run_probe");
      expect(row!.v).toBe(42);
    }
  });

  it("carries Postgres traffic from B to A over the WireGuard tunnel", async () => {
    // node B dials node A by A's TUNNEL address (only reachable across wg0), as A's default
    // superuser. A success here can only mean the packet crossed the encrypted link.
    const a = new URL(cluster.nodeA.uri);
    const conninfo =
      `host=${cluster.nodeA.tunnelHost} port=5432 user=${a.username} ` +
      `password=${a.password} dbname=${a.pathname.slice(1)} connect_timeout=5`;
    const { exitCode, output } = await cluster.nodeB.execInContainer([
      "psql",
      conninfo,
      "-tAc",
      "select 'tunnel-ok'",
    ]);
    expect(exitCode).toBe(0);
    expect(output).toContain("tunnel-ok");
  });

  it("establishes a real WireGuard handshake between the nodes", async () => {
    // After the query above crossed the tunnel, node A must show a completed handshake with B — the
    // proof it is genuinely WireGuard (an encrypted session), not a leak through the Docker network.
    const { exitCode, output } = await cluster.nodeA.execInContainer([
      "wg",
      "show",
      "wg0",
      "latest-handshakes",
    ]);
    expect(exitCode).toBe(0);
    // Format: "<peer-public-key>\t<unix-timestamp>"; a fresh, non-zero timestamp means a handshake
    // completed.
    const timestamp = Number(output.trim().split(/\s+/).at(-1));
    expect(timestamp).toBeGreaterThan(0);
  });
});
