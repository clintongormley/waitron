import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  execOrThrow,
  startTwoNodeWireguardCluster,
  type StartedNetwork,
  type StartedWireguardNode,
  type TwoNodeWireguardCluster,
  type WireguardReplNode,
} from "./two-node-wireguard.js";
import { dockerAvailable } from "./harness.js";

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
    exec: async () => ({ exitCode: 0, output: "" }),
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
      }),
    ).rejects.toThrow("migration failed");
    // node-b's stop() threw; node-a and the network are still torn down.
    expect(stopped).toEqual(["10.99.0.1", "network"]);
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

// Real-Docker smoke test for the WireGuard two-node fixture: two `postgres:18-alpine` nodes joined
// by an encrypted WireGuard tunnel, standing in for a box and its cloud twin across an untrusted
// network. The tunnel addresses (10.99.0.x) live ONLY on each node's `wg0` interface, so a
// connection that lands on a peer's `tunnelHost` proves the traffic crossed the tunnel — the Docker
// network alias would be a different address entirely. The mechanism is written up in
// `docs/superpowers/specs/2026-09-05-native-replication-post-rls-prototype-findings.md`; this fixture
// is the local stand-in for the box↔cloud link the cloud standby runs over.
describe.runIf(dockerAvailable())("two-node WireGuard fixture", () => {
  let cluster: TwoNodeWireguardCluster;

  beforeAll(async () => {
    cluster = await startTwoNodeWireguardCluster({ dockerRequired: true });
  }, 180_000);

  afterAll(async () => {
    await cluster?.stop();
  });

  it("boots both nodes with wal_level=logical", async () => {
    for (const node of [cluster.nodeA, cluster.nodeB]) {
      await node.run("SELECT 1");
      const [row] = await node.query<{ wal_level: string }>("SHOW wal_level");
      expect(row!.wal_level).toBe("logical");
    }
  });

  it("carries Postgres traffic from B to A over the WireGuard tunnel", async () => {
    // node B dials node A by A's TUNNEL address (only reachable across wg0), as A's default
    // superuser. A success here can only mean the packet crossed the encrypted link.
    const a = new URL(cluster.nodeA.uri);
    const conninfo =
      `host=${cluster.nodeA.tunnelHost} port=5432 user=${a.username} ` +
      `password=${a.password} dbname=${a.pathname.slice(1)} connect_timeout=5`;
    const { exitCode, output } = await cluster.nodeB.exec([
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
    const { exitCode, output } = await cluster.nodeA.exec([
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
