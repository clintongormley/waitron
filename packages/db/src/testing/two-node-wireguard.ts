import { Network } from "testcontainers";
import pg from "pg";
import { dockerAvailable } from "./harness.js";
import { networkedPostgresContainer, networkNodeName } from "./postgres.js";
import { LOGICAL_REPLICATION_COMMAND, type ReplNode, type StartedNetwork } from "./two-node.js";
import { clusterMutex, type ClusterMutex } from "./cluster-mutex.js";

export type { StartedNetwork } from "./two-node.js";

/**
 * A two-node PostgreSQL cluster whose nodes reach each other ONLY across a WireGuard tunnel — the
 * local stand-in for a box and its cloud twin talking over an untrusted network. The sibling
 * {@link import("./two-node.js")} fixture lets each node dial the other by its Docker DNS name,
 * a trusted, zero-latency LAN; this one puts a real encrypted WireGuard link in the path so the
 * transport a cloud standby actually runs over is exercised, without a cloud. The mechanism the
 * suites on top of it lean on is written up in
 * `docs/superpowers/specs/2026-09-05-native-replication-post-rls-prototype-findings.md`.
 *
 * Each node runs its own `wg0` interface (a kernel WireGuard device — `NET_ADMIN` is the only extra
 * capability, no privileged container and no `/dev/net/tun`, verified on `postgres:18-alpine`). The
 * tunnel addresses (`10.99.0.1`/`10.99.0.2`) live only on those interfaces, so a peer that connects
 * to a node's `tunnelHost` can only have crossed the tunnel — the Docker alias is a different
 * address. Postgres already listens on `*` in the image, so it answers on `wg0` with no reconfig,
 * and its `pg_hba` already admits arbitrary hosts, so the tunnel address needs no rule of its own.
 *
 * Cleanup, both paths, mirrors the sibling fixture: setup acquires the network, then each node, then
 * wires the tunnel and migrates; a failure at any step tears down whatever came up (nodes before the
 * network) before re-throwing, and `stop()` runs the same teardown. Ryuk is off locally (CLAUDE.md
 * §4); containers carry `com.waitron.reapable` for `pnpm reap`.
 */
export interface WireguardReplNode extends ReplNode {
  /** The WireGuard tunnel address a PEER dials this node by — the point of the fixture: a peer
   * reaches it only across the encrypted link, never the trusted Docker network. */
  tunnelHost: string;
  /** Run one command INSIDE this node's container — a container-level escape hatch for a tunnel
   * probe (an in-container `psql`) or `wg show`, distinct from `run`/`query`, which reach the node
   * from THIS process over the published port. */
  execInContainer(command: string[]): Promise<{ exitCode: number; output: string }>;
}

export interface TwoNodeWireguardCluster {
  nodeA: WireguardReplNode;
  nodeB: WireguardReplNode;
  stop(): Promise<void>;
}

/** The other node's tunnel identity, as {@link StartedWireguardNode.configurePeer} needs it. */
export interface WireguardPeer {
  /** The peer's WireGuard public key. */
  publicKey: string;
  /** How this node reaches the peer's WireGuard socket — the peer's Docker name and port. */
  endpoint: string;
  /** The peer's tunnel address, the only address routed down the link (`allowed-ips`). */
  tunnelHost: string;
}

/** A started node and the closer that releases it. The `configurePeer` step finishes the tunnel once
 * BOTH nodes (and so both public keys) exist. Returned by the `startNode` seam so a test can inject
 * fakes and drive cleanup without Docker. */
export interface StartedWireguardNode {
  node: WireguardReplNode;
  /** This node's WireGuard public key, for the peer's `configurePeer`. */
  publicKey: string;
  /** Point this node's tunnel at the peer (`wg set … peer`). Idempotent per the underlying `wg set`. */
  configurePeer(peer: WireguardPeer): Promise<void>;
  stop(): Promise<void>;
}

export interface TwoNodeWireguardOptions {
  /** Applies every migration set each node needs. Defaults to a no-op — consumers that need a schema
   * (the replication suites) provision each node themselves AS the migrator afterward. */
  migrate?(uri: string): Promise<void>;
  /** When Docker is unavailable, a truthy value makes the failure loud rather than letting the raw
   * container-start error surface. The caller normally gates the suite on `dockerAvailable()`. */
  dockerRequired?: boolean;
  /** Seam — starts the shared Docker network. Defaults to a real Testcontainers network. */
  startNetwork?(): Promise<StartedNetwork>;
  /** Seam — starts one node on the network at a tunnel address. Defaults to a real container. */
  startNode?(network: StartedNetwork, node: NodePlan): Promise<StartedWireguardNode>;
  /**
   * Seam — the cross-process mutex holding "only one two-node cluster alive machine-wide at a time",
   * shared with the sibling {@link import("./two-node.js")} fixture: whichever kind boots, no other
   * two-node cluster runs concurrently, so Docker is never oversubscribed. Acquired before any
   * container boots, released on teardown. Defaults to the shared file-backed {@link clusterMutex}.
   */
  mutex?: ClusterMutex;
}

/** Where a node sits on the network and the tunnel: its Docker alias and its `wg0` address. */
export interface NodePlan {
  alias: string;
  tunnelHost: string;
}

const WG_PORT = 51820;
const NODE_A: NodePlan = { alias: "node-a", tunnelHost: "10.99.0.1" };
const NODE_B: NodePlan = { alias: "node-b", tunnelHost: "10.99.0.2" };
const TUNNEL_PREFIX = 24;

/** The methods the fixture drives a node's container through. The real `StartedPostgreSqlContainer`
 * satisfies it; a test supplies a fake to drive the setup-failure branch without Docker. */
export interface WireguardContainer {
  getConnectionUri(): string;
  exec(command: string[]): Promise<{ exitCode: number; output: string }>;
  stop(): Promise<unknown>;
}

/** Exec a command in the container and return `{ exitCode, output }`; throw loudly on a non-zero
 * exit, so a setup step that failed (a missing package, an `ip`/`wg` error) surfaces here rather
 * than as a mysterious connection failure later. */
export async function execOrThrow(
  container: Pick<WireguardContainer, "exec">,
  command: string[],
): Promise<{ exitCode: number; output: string }> {
  const result = await container.exec(command);
  if (result.exitCode !== 0) {
    throw new Error(
      `command \`${command.join(" ")}\` failed (exit ${result.exitCode}): ${result.output}`,
    );
  }
  return { exitCode: result.exitCode, output: result.output };
}

/** Boot a `postgres:18-alpine` container with the one extra capability kernel WireGuard needs
 * (NET_ADMIN — no privileged container, no `/dev/net/tun`, verified on this image) and logical WAL.
 * The default the `startContainer` seam uses; a test injects a fake in its place. */
async function startPostgresWireguardContainer(
  network: StartedNetwork,
  plan: NodePlan,
): Promise<WireguardContainer> {
  return networkedPostgresContainer(network, plan.alias)
    .withAddedCapabilities("NET_ADMIN")
    .withCommand(LOGICAL_REPLICATION_COMMAND)
    .start();
}

export async function startRealWireguardNode(
  network: StartedNetwork,
  plan: NodePlan,
  startContainer: (
    network: StartedNetwork,
    plan: NodePlan,
  ) => Promise<WireguardContainer> = startPostgresWireguardContainer,
): Promise<StartedWireguardNode> {
  const container = await startContainer(network, plan);
  // The container is up; any failure below (a failed `apk`/`wg`/`ip`, a client that will not connect)
  // must stop it, or it leaks until `pnpm reap` — so the whole bring-up is guarded.
  try {
    // Bring up wg0 so the node is tunnel-ready the moment both keys exist and the peer step runs. The
    // private key is generated straight INTO a file and never read back into an argv — `wg pubkey`
    // and `wg set private-key` both read it from the file. The image is Alpine, so `apk add` installs
    // the tools at runtime.
    await execOrThrow(container, ["apk", "add", "--no-cache", "wireguard-tools", "iproute2"]);
    await execOrThrow(container, ["sh", "-c", "wg genkey > /etc/wg.key && chmod 600 /etc/wg.key"]);
    const publicKey = (
      await execOrThrow(container, ["sh", "-c", "wg pubkey < /etc/wg.key"])
    ).output.trim();
    await execOrThrow(container, ["ip", "link", "add", "wg0", "type", "wireguard"]);
    await execOrThrow(container, [
      "wg",
      "set",
      "wg0",
      "private-key",
      "/etc/wg.key",
      "listen-port",
      String(WG_PORT),
    ]);
    await execOrThrow(container, [
      "ip",
      "address",
      "add",
      `${plan.tunnelHost}/${TUNNEL_PREFIX}`,
      "dev",
      "wg0",
    ]);
    await execOrThrow(container, ["ip", "link", "set", "wg0", "up"]);

    const uri = container.getConnectionUri();
    const client = new pg.Client({ connectionString: uri });
    await client.connect();
    const node: WireguardReplNode = {
      uri,
      networkHost: networkNodeName(network, plan.alias),
      tunnelHost: plan.tunnelHost,
      run: async (sql) => {
        await client.query(sql);
      },
      query: async <T>(sql: string) => (await client.query(sql)).rows as T[],
      execInContainer: (command) =>
        container.exec(command).then((r) => ({ exitCode: r.exitCode, output: r.output })),
    };
    return {
      node,
      publicKey,
      configurePeer: async (peer) => {
        await execOrThrow(container, [
          "wg",
          "set",
          "wg0",
          "peer",
          peer.publicKey,
          "allowed-ips",
          `${peer.tunnelHost}/32`,
          "endpoint",
          peer.endpoint,
          "persistent-keepalive",
          "25",
        ]);
      },
      stop: async () => {
        // Best-effort on the client, the same reason the sibling fixture swallows its close: a client
        // already dead must not strand the container.stop() that follows.
        await client.end().catch(() => {});
        await container.stop();
      },
    };
  } catch (error) {
    // Bring-up failed after the container came up — stop it so it does not leak, then surface the
    // real cause.
    await container.stop().catch(() => {});
    throw error;
  }
}

export async function startTwoNodeWireguardCluster(
  options: TwoNodeWireguardOptions = {},
): Promise<TwoNodeWireguardCluster> {
  const startNetwork = options.startNetwork ?? (() => new Network().start());
  const startNode = options.startNode ?? startRealWireguardNode;
  const migrate = options.migrate ?? (async () => {});
  const mutex = options.mutex ?? clusterMutex;

  /* v8 ignore start -- Docker-absent branch: unreachable in any Docker-present run (every CI runner
     and dev machine this package requires), gated to the REAL primitives so a seam-injecting test
     drives cleanup without a daemon, and callers gate the suite on `dockerAvailable()`. */
  if (options.startNetwork === undefined && options.startNode === undefined && !dockerAvailable()) {
    throw new Error(
      options.dockerRequired
        ? "The two-node WireGuard fixture requires a running Docker daemon to start two PostgreSQL " +
            "containers on a shared network; it cannot degrade to a hermetic run."
        : "Docker is not available; the two-node WireGuard cluster cannot start.",
    );
  }
  /* v8 ignore stop */

  // Every resource that has come up, in acquisition order; teardown reverses it (nodes before the
  // network) and swallows each failure so one wedged stop can never strand the rest.
  const started: Array<{ stop(): Promise<unknown> }> = [];
  const teardown = async () => {
    for (const resource of [...started].reverse()) {
      await resource.stop().catch(() => {});
    }
  };

  // Hold the machine-wide mutex for the whole cluster lifetime (boot → stop), acquired before the
  // first `startNetwork()/startNode()` and released on BOTH the success `stop()` path and the
  // setup-failure cleanup path — each in a `finally`, so a teardown error can't strand the lock.
  const release = await mutex.acquire();
  try {
    const network = await startNetwork();
    started.push(network);
    const a = await startNode(network, NODE_A);
    started.push(a);
    const b = await startNode(network, NODE_B);
    started.push(b);

    // Wire the tunnel now that both public keys exist. Each node routes the OTHER's tunnel address
    // down the link and dials the other by its Docker alias (WireGuard resolves the endpoint host).
    await a.configurePeer({
      publicKey: b.publicKey,
      endpoint: `${b.node.networkHost}:${WG_PORT}`,
      tunnelHost: NODE_B.tunnelHost,
    });
    await b.configurePeer({
      publicKey: a.publicKey,
      endpoint: `${a.node.networkHost}:${WG_PORT}`,
      tunnelHost: NODE_A.tunnelHost,
    });

    await migrate(a.node.uri);
    await migrate(b.node.uri);
    return {
      nodeA: a.node,
      nodeB: b.node,
      stop: async () => {
        try {
          await teardown();
        } finally {
          await release();
        }
      },
    };
  } catch (error) {
    // Setup failed after some resources came up — stop exactly those and release the lock, then
    // surface the real cause.
    try {
      await teardown();
    } finally {
      await release();
    }
    throw error;
  }
}
