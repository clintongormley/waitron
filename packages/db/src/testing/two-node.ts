import { Network } from "testcontainers";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { dockerAvailable } from "./harness.js";
import { POSTGRES_IMAGE } from "./postgres.js";

/**
 * A two-node PostgreSQL cluster on a shared Docker network for exercising native logical
 * replication end-to-end — the fixture the swap S2 replication suites are built on.
 *
 * Both nodes boot with `wal_level=logical` and `track_commit_timestamp=on`. Neither can be set at
 * runtime (`wal_level` needs a restart, `track_commit_timestamp` too), so they are passed as
 * `postgres -c` command args rather than via `ALTER SYSTEM` after start; the image's entrypoint runs
 * `postgres "$@"` and PostgreSqlContainer's readiness wait is port/`pg_isready`-based, not log-based,
 * so custom `-c` flags cannot break startup. The mechanism this fixture serves is written up in
 * `docs/superpowers/specs/2026-09-05-native-replication-post-rls-prototype-findings.md`.
 *
 * Each node dials the OTHER by its Docker-network alias (`networkHost`, `node-a`/`node-b`) — a
 * subscription's CONNECTION string reaches a peer through the network, never through the
 * host-published `uri`, which only this process can use.
 *
 * Cleanup, both paths. Setup acquires the network, then each node, then migrates each; a failure at
 * ANY of those steps (a container that will not start, `migrate()` throwing) stops whatever has
 * already come up — best-effort, in reverse order, network last — before re-throwing the original
 * error, so a half-built cluster never leaks. `stop()` runs the same teardown. With Ryuk disabled
 * locally (CLAUDE.md §4) an interrupted run leaks the network — but the containers carry
 * `com.waitron.reapable`, so `pnpm reap` removes them, and an orphaned empty network is harmless (it
 * holds nothing and is cheap to prune).
 */
export interface ReplNode {
  /** Reaches this node from the HOST (published port). Used by this process's own pg clients. */
  uri: string;
  /** The Docker-network alias the OTHER node dials, e.g. `host=node-a port=5432`. */
  networkHost: string;
  /** Runs one statement, discarding its rows. */
  run(sql: string): Promise<void>;
  /** Runs one query and returns its rows. */
  query<T>(sql: string): Promise<T[]>;
}

export interface TwoNodeCluster {
  nodeA: ReplNode;
  nodeB: ReplNode;
  stop(): Promise<void>;
}

/** A started Docker network. The real Testcontainers handle or, at the `startNetwork` seam, a test
 * fake — the fixture only calls `stop()`; the real handle also carries the identity a node needs to
 * join it via `.withNetwork()`. */
export type StartedNetwork = Awaited<ReturnType<Network["start"]>>;

/** A started node and the closer that releases it (its pg client, then its container). Returned by
 * the `startNode` seam so a test can inject fakes and drive the failure-cleanup path without Docker. */
export interface StartedReplNode {
  node: ReplNode;
  stop(): Promise<void>;
}

export interface TwoNodeClusterOptions {
  /** Applies every migration set each node needs, core first. */
  migrate(uri: string): Promise<void>;
  /**
   * When Docker is unavailable, a truthy value makes the failure loud rather than letting the raw
   * container-start error surface. The caller normally gates the whole suite on `dockerAvailable()`
   * (as the harness does), so a Docker-absent run reaches this only defensively.
   */
  dockerRequired?: boolean;
  /** Seam — starts the shared Docker network. Defaults to a real Testcontainers network. */
  startNetwork?(): Promise<StartedNetwork>;
  /** Seam — starts one node on the network. Defaults to a real container + connected client. */
  startNode?(network: StartedNetwork, alias: string): Promise<StartedReplNode>;
}

export const LOGICAL_REPLICATION_COMMAND = [
  "postgres",
  "-c",
  "wal_level=logical",
  "-c",
  "track_commit_timestamp=on",
  // The bounded slot the readiness check (spec §6) requires AT BOOT, so an S2 node that provisions on
  // this cluster passes readiness without racing a `pg_reload_conf`. The S1 smoke test asserts only
  // `wal_level`, so it stays green. Set the same way as the two above (a `-c` arg, not `ALTER SYSTEM`)
  // for symmetry; unlike them `max_slot_wal_keep_size` is reloadable, so this is a convenience, not a
  // requirement.
  "-c",
  "max_slot_wal_keep_size=4GB",
];

async function startRealNode(network: StartedNetwork, alias: string): Promise<StartedReplNode> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    // Same reaper marker as startPostgresContainer: an interrupted Ryuk-off run leaves this container
    // for `pnpm reap`, which removes ONLY containers carrying this label.
    .withLabels({ "com.waitron.reapable": "true" })
    .withNetwork(network)
    .withNetworkAliases(alias)
    .withCommand(LOGICAL_REPLICATION_COMMAND)
    .start();
  const uri = container.getConnectionUri();
  const client = new pg.Client({ connectionString: uri });
  await client.connect();
  const node: ReplNode = {
    uri,
    networkHost: alias,
    run: async (sql) => {
      await client.query(sql);
    },
    query: async <T>(sql: string) => (await client.query(sql)).rows as T[],
  };
  return {
    node,
    stop: async () => {
      // Best-effort on the client: a client already closed (or a socket already dead) must not strand
      // the container.stop() that follows, the same reason postgres.ts's helpers swallow their closes.
      await client.end().catch(() => {});
      await container.stop();
    },
  };
}

export async function startTwoNodeCluster(options: TwoNodeClusterOptions): Promise<TwoNodeCluster> {
  const startNetwork = options.startNetwork ?? (() => new Network().start());
  const startNode = options.startNode ?? startRealNode;

  /* v8 ignore start -- Docker-absent branch: unreachable in any Docker-present run, which is every
     CI runner and dev machine this package requires (harness.ts `dockerAvailable` documents the same
     reasoning). It is gated to the REAL primitives — a test injecting the seams drives cleanup
     without a daemon — and callers gate the suite on `dockerAvailable()`, so this is purely
     defensive; the whole `if` is ignored, since none of it runs when Docker is present. */
  if (options.startNetwork === undefined && options.startNode === undefined && !dockerAvailable()) {
    throw new Error(
      options.dockerRequired
        ? "The two-node logical-replication fixture requires a running Docker daemon to start two " +
            "PostgreSQL containers on a shared network; it cannot degrade to a hermetic run."
        : "Docker is not available; the two-node cluster cannot start.",
    );
  }
  /* v8 ignore stop */

  // Every resource that has come up, in acquisition order; teardown reverses it (nodes before the
  // network) and swallows each failure so one wedged stop can never strand the rest. `Promise<unknown>`
  // because a network's `stop()` resolves to a `StoppedNetwork`, not void (TypeScript's void-return
  // relaxation covers `() => T`, never `Promise<T>` against `Promise<void>` — see postgres.ts).
  const started: Array<{ stop(): Promise<unknown> }> = [];
  const teardown = async () => {
    for (const resource of [...started].reverse()) {
      await resource.stop().catch(() => {});
    }
  };

  try {
    const network = await startNetwork();
    started.push(network);
    const a = await startNode(network, "node-a");
    started.push(a);
    const b = await startNode(network, "node-b");
    started.push(b);
    await options.migrate(a.node.uri);
    await options.migrate(b.node.uri);
    return { nodeA: a.node, nodeB: b.node, stop: teardown };
  } catch (error) {
    // Setup failed after some resources came up — stop exactly those, then surface the real cause.
    await teardown();
    throw error;
  }
}
