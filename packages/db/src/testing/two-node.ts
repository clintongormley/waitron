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
 * Cleanup: `stop()` closes both nodes' clients, stops both containers, then stops the network. With
 * Ryuk disabled locally (CLAUDE.md §4) an interrupted run leaks the network — but the containers
 * carry `com.waitron.reapable`, so `pnpm reap` removes them, and an orphaned empty network is
 * harmless (it holds nothing and is cheap to prune).
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

export interface TwoNodeClusterOptions {
  /** Applies every migration set each node needs, core first. */
  migrate(uri: string): Promise<void>;
  /**
   * When Docker is unavailable, a truthy value makes the failure loud rather than letting the raw
   * container-start error surface. The caller normally gates the whole suite on `dockerAvailable()`
   * (as the harness does), so a Docker-absent run reaches this only defensively.
   */
  dockerRequired?: boolean;
}

const LOGICAL_REPLICATION_COMMAND = [
  "postgres",
  "-c",
  "wal_level=logical",
  "-c",
  "track_commit_timestamp=on",
];

async function startNode(
  network: Awaited<ReturnType<Network["start"]>>,
  alias: string,
): Promise<{
  node: ReplNode;
  container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
  client: pg.Client;
}> {
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
  return { node, container, client };
}

export async function startTwoNodeCluster(options: TwoNodeClusterOptions): Promise<TwoNodeCluster> {
  /* v8 ignore start -- Docker-absent branch: unreachable in any Docker-present run, which is every
     CI runner and dev machine this package requires (harness.ts `dockerAvailable` documents the same
     reasoning). Callers gate the suite on `dockerAvailable()`, so this is purely defensive; the
     whole `if` — condition, branch and both message arms — is ignored, since none of it runs when
     Docker is present. */
  if (!dockerAvailable()) {
    throw new Error(
      options.dockerRequired
        ? "The two-node logical-replication fixture requires a running Docker daemon to start two " +
            "PostgreSQL containers on a shared network; it cannot degrade to a hermetic run."
        : "Docker is not available; the two-node cluster cannot start.",
    );
  }
  /* v8 ignore stop */

  const network = await new Network().start();
  const a = await startNode(network, "node-a");
  const b = await startNode(network, "node-b");
  await options.migrate(a.node.uri);
  await options.migrate(b.node.uri);

  return {
    nodeA: a.node,
    nodeB: b.node,
    stop: async () => {
      // Best-effort, isolated teardown in the sensible order (clients, then containers, then the
      // network): one step rejecting — a client already closed, a Docker hiccup — must never strand
      // the later stops and leak them (the same reason postgres.ts's helpers swallow their close
      // failures). `allSettled` runs every step and never rejects, so it adds no error-handling
      // branch of its own to cover; the network is last, so it has nothing left to strand.
      await Promise.allSettled([a.client.end(), b.client.end()]);
      await Promise.allSettled([a.container.stop(), b.container.stop()]);
      await network.stop();
    },
  };
}
