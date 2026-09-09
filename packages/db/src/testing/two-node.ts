import { Network } from "testcontainers";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { dockerAvailable } from "./harness.js";
import { POSTGRES_IMAGE } from "./postgres.js";
import { clusterMutex, type ClusterMutex } from "./cluster-mutex.js";

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
 * Resilience. Under the full local workspace run a container boot can be transiently starved; with
 * no bound such a boot hangs the suite's whole `beforeAll` timeout instead of failing and recovering.
 * So the whole acquire (network → both nodes → migrate) retries up to {@link MAX_ACQUIRE_ATTEMPTS}
 * attempts, each real boot is bounded ({@link STARTUP_TIMEOUT_MS} on the container, a connect timeout
 * on the client), and a failed attempt tears itself down before the next tries in a calmer window.
 * The bounds trade a hang for a bounded failure: the retries are for a transient stall that clears by
 * attempt 2, NOT slack to absorb three full-length boots — the consuming suites' 300s `beforeAll`
 * also spends time on the pub/sub steps, so a genuine 3×~60s run leaves little of that budget.
 *
 * Cleanup, both paths, per attempt. An attempt acquires the network, then both nodes IN PARALLEL,
 * then migrates each; a failure at ANY step (a container that will not start, `migrate()` throwing)
 * stops whatever that attempt brought up — best-effort, in reverse order, network last. Nodes boot
 * with `Promise.allSettled`, so a partner that came up while the other failed is captured and
 * stopped, never abandoned in flight. `stop()` on the returned cluster runs the same teardown for the
 * winning attempt. With Ryuk disabled locally (CLAUDE.md §4) an interrupted run leaks the network —
 * but the containers carry `com.waitron.reapable`, so `pnpm reap` removes them, and an orphaned empty
 * network is harmless (it holds nothing and is cheap to prune).
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
  /**
   * The `postgres` command each node boots with, overriding {@link LOGICAL_REPLICATION_COMMAND}. A
   * `-c` boot flag is a `PGC_S_ARGV` setting that OUTRANKS a later `ALTER SYSTEM`, so a bound the
   * default already sets at a different value (`max_slot_wal_keep_size=4GB`) can only be changed
   * here, not at runtime — the swap S4 WAL-overflow case boots its own cluster with an 8 MB bound
   * this way (I4). Keep `wal_level=logical` and `track_commit_timestamp=on`, which every replication
   * node needs.
   */
  command?: string[];
  /**
   * Seam — the cross-process mutex holding "only one two-node cluster alive machine-wide at a time".
   * Acquired before any container boots and released on teardown, so no combination of packages,
   * vitest forks or `pnpm` package processes can oversubscribe Docker with concurrent cluster boots
   * plus their heavy replication setup. Defaults to the shared file-backed {@link clusterMutex}; a
   * test injects a fake to assert the ordering without touching the real machine-wide lock.
   */
  mutex?: ClusterMutex;
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

/** Attempts to acquire the whole cluster before giving up. A transient contention stall on one
 * attempt recovers on the next; three bounds a run of failures to a loud error, not a hung suite. */
export const MAX_ACQUIRE_ATTEMPTS = 3;
/** Bounds one container boot so a starved start FAILS (and the attempt retries) rather than hanging
 * the wait strategy forever. A genuine three-attempt run at this bound eats most of the 300s hook,
 * so it is a ceiling for the pathological case, not headroom the happy path relies on. */
export const STARTUP_TIMEOUT_MS = 60_000;
/** Bounds `client.connect()` so a container that is up but not yet answering fails fast, not hangs. */
const CONNECT_TIMEOUT_MS = 15_000;
/** Short pause before a retry so the next attempt lands in a calmer window, not back-to-back. */
const RETRY_BACKOFF_MS = 500;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function startRealNode(
  network: StartedNetwork,
  alias: string,
  command: string[],
): Promise<StartedReplNode> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    // Same reaper marker as startPostgresContainer: an interrupted Ryuk-off run leaves this container
    // for `pnpm reap`, which removes ONLY containers carrying this label.
    .withLabels({ "com.waitron.reapable": "true" })
    .withNetwork(network)
    .withNetworkAliases(alias)
    .withCommand(command)
    // Bound the boot so a starved start fails at the bound and the acquire retries, rather than the
    // wait strategy hanging the whole suite `beforeAll` (this fixture's original flake).
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start();
  const uri = container.getConnectionUri();
  const client = new pg.Client({
    connectionString: uri,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
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
  const command = options.command ?? LOGICAL_REPLICATION_COMMAND;
  const startNode =
    options.startNode ?? ((network, alias) => startRealNode(network, alias, command));

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

  // Hold the machine-wide mutex for the WHOLE cluster lifetime — boot AND the caller's heavy
  // post-boot replication setup, which is where the starvation lives — not just across the boot. It
  // is acquired before the first `startNetwork()/startNode()` and released on the success `stop()`
  // path and on total-failure cleanup alike (both in a `finally`, so a teardown error can't strand
  // the lock).
  const mutex = options.mutex ?? clusterMutex;
  const release = await mutex.acquire();
  try {
    return await acquireWithRetries(options, startNetwork, startNode, release);
  } catch (error) {
    await release();
    throw error;
  }
}

async function acquireWithRetries(
  options: TwoNodeClusterOptions,
  startNetwork: () => Promise<StartedNetwork>,
  startNode: (network: StartedNetwork, alias: string) => Promise<StartedReplNode>,
  release: () => Promise<void>,
): Promise<TwoNodeCluster> {
  // The acquire retries: a transiently-starved boot fails its attempt, tears that attempt down, and
  // the next tries in a calmer window. Only the LAST attempt's error surfaces.
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ACQUIRE_ATTEMPTS; attempt += 1) {
    // Everything THIS attempt brought up, in acquisition order; teardown reverses it (nodes before
    // the network) and swallows each failure so one wedged stop can never strand the rest.
    // `Promise<unknown>` because a network's `stop()` resolves to a `StoppedNetwork`, not void
    // (TypeScript's void-return relaxation covers `() => T`, never `Promise<T>` against
    // `Promise<void>` — see postgres.ts).
    const started: Array<{ stop(): Promise<unknown> }> = [];
    const teardown = async () => {
      for (const resource of [...started].reverse()) {
        await resource.stop().catch(() => {});
      }
    };

    try {
      const network = await startNetwork();
      started.push(network);
      // Boot both nodes concurrently. `allSettled` waits for BOTH to settle, so a node that comes up
      // while its partner fails is captured for teardown here — never left as an in-flight promise
      // whose container leaks. Results keep input order, so [0] is node-a, [1] is node-b.
      const settled = await Promise.allSettled([
        startNode(network, "node-a"),
        startNode(network, "node-b"),
      ]);
      for (const result of settled) {
        if (result.status === "fulfilled") started.push(result.value);
      }
      const rejected = settled.find((result) => result.status === "rejected");
      if (rejected) throw rejected.reason;
      const [a, b] = settled as [
        PromiseFulfilledResult<StartedReplNode>,
        PromiseFulfilledResult<StartedReplNode>,
      ];
      await options.migrate(a.value.node.uri);
      await options.migrate(b.value.node.uri);
      return {
        nodeA: a.value.node,
        nodeB: b.value.node,
        stop: async () => {
          try {
            await teardown();
          } finally {
            await release();
          }
        },
      };
    } catch (error) {
      // This attempt failed after some resources came up — stop exactly those, remember the cause,
      // and retry unless this was the last attempt.
      lastError = error;
      await teardown();
      if (attempt < MAX_ACQUIRE_ATTEMPTS) await delay(RETRY_BACKOFF_MS);
    }
  }
  throw lastError;
}
