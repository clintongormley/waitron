import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A cross-process mutex so only ONE two-node PostgreSQL replication cluster (of either kind — plain
 * or WireGuard) is alive machine-wide at a time. Both `startTwoNodeCluster` and
 * `startTwoNodeWireguardCluster` acquire it BEFORE booting any container and release it on teardown,
 * so no combination of packages, vitest forks or separate `pnpm` package processes can oversubscribe
 * Docker with concurrent cluster boots plus their heavy post-boot replication setup — the starvation
 * that hangs a `beforeAll` under the full local/CI run (Parts 1 and 2 bound retries and within-package
 * ordering; only this bounds CROSS-process concurrency).
 *
 * The lock is a DIRECTORY at a stable OS-temp path — `fs.mkdir` is atomic and fails `EEXIST` if it
 * already exists, so exactly one waiter wins the create. The winner writes `holder.json`
 * (`{ pid, startedAt, token }`) inside it for the staleness and ownership checks below.
 *
 * Stale recovery (a crashed holder must NEVER deadlock the suite): a waiter steals the lock when the
 * holder's pid is no longer alive (`process.kill(pid, 0)` throws ESRCH) OR the hold is older than
 * {@link STALE_MS} — set WELL above the 300s `beforeAll` budget so a slow-but-alive holder is never
 * stolen from, only a dead or hung-past-timeout one. A holder that crashed AFTER `mkdir` but BEFORE
 * writing metadata leaves a holderless dir; that is reclaimed by the dir's own age past STALE_MS, and
 * never in the microsecond write window. The steal is race-safe: remove then re-attempt the atomic
 * create, and a lost race just keeps polling.
 *
 * Fail loud, never hang: if acquire cannot win within {@link ACQUIRE_TIMEOUT_MS} it THROWS naming the
 * current holder's pid and age, so a genuine deadlock surfaces as a loud error rather than a silent
 * 300s hook timeout.
 *
 * Escape hatch: `WAITRON_TWO_NODE_MUTEX=0` disables the mutex (acquire is a no-op) for debugging or
 * CI-shard tuning; the mutex is ON by default.
 */

export type Release = () => Promise<void>;

export interface ClusterMutex {
  /** Blocks (polling) until it holds the machine-wide lock, then resolves a `release()` that is
   * idempotent and best-effort. Throws if it cannot acquire within the timeout. */
  acquire(): Promise<Release>;
}

export interface FileClusterMutexOptions {
  /** The lock directory (a stable path). Defaults to {@link DEFAULT_LOCK_DIR}. */
  lockDir?: string;
  /** A hold older than this is stolen even from a live pid. Defaults to {@link STALE_MS}. */
  staleMs?: number;
  /** Acquire throws past this bound rather than hanging. Defaults to {@link ACQUIRE_TIMEOUT_MS}. */
  acquireTimeoutMs?: number;
  /** Base poll interval between attempts; a little jitter is added. Defaults to {@link POLL_INTERVAL_MS}. */
  pollIntervalMs?: number;
  /** Clock seam (tests inject a fake). Defaults to `Date.now`. */
  now?: () => number;
  /** Pid-liveness seam (tests inject). Defaults to {@link isProcessAlive}. */
  isAlive?: (pid: number) => boolean;
  /** Escape-hatch seam. Defaults to reading `WAITRON_TWO_NODE_MUTEX === "0"` at each acquire. */
  disabled?: () => boolean;
}

interface Holder {
  pid: number;
  startedAt: number;
  token: string;
}

/** The machine-wide lock path — one per OS temp dir, shared by every process on the box. */
export const DEFAULT_LOCK_DIR = join(tmpdir(), "waitron-two-node-cluster.lock");
/** Generous stale bound — must EXCEED the longest legitimate hold (the 300s `beforeAll` budget) so a
 * slow-but-alive holder is never stolen, only a dead/hung-past-timeout one. */
export const STALE_MS = 360_000;
/** Acquire fails loud past this — longer than any real hold plus a full queue of waiters. */
export const ACQUIRE_TIMEOUT_MS = 600_000;
/** Modest base poll; jitter is added to avoid a thundering herd. */
export const POLL_INTERVAL_MS = 150;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** True if `pid` names a live process. `process.kill(pid, 0)` sends no signal but validates the pid:
 * it throws ESRCH for a dead pid (=> not alive) and EPERM for a live pid we may not signal (=> alive). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function createFileClusterMutex(options: FileClusterMutexOptions = {}): ClusterMutex {
  const lockDir = options.lockDir ?? DEFAULT_LOCK_DIR;
  const holderFile = join(lockDir, "holder.json");
  const staleMs = options.staleMs ?? STALE_MS;
  const acquireTimeoutMs = options.acquireTimeoutMs ?? ACQUIRE_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const isAlive = options.isAlive ?? isProcessAlive;
  const disabled = options.disabled ?? (() => process.env.WAITRON_TWO_NODE_MUTEX === "0");

  const readHolder = async (): Promise<Holder | undefined> => {
    try {
      const parsed = JSON.parse(await readFile(holderFile, "utf8")) as Holder;
      if (typeof parsed.pid === "number" && typeof parsed.startedAt === "number") return parsed;
      return undefined;
    } catch {
      // Missing, partially written, or corrupt — the caller falls back to the dir's own age.
      return undefined;
    }
  };

  const isStale = async (): Promise<boolean> => {
    const holder = await readHolder();
    if (holder === undefined) {
      // No readable metadata (a holder mid-write, or one that crashed before writing it). Judge by the
      // lock dir's own age so a crashed-pre-write holder is still reclaimable — but only once past
      // STALE_MS, never in the tiny mkdir→writeFile window.
      try {
        const dirStat = await stat(lockDir);
        return now() - dirStat.mtimeMs > staleMs;
      } catch {
        // The dir vanished between our EEXIST and this stat — not stale; the next mkdir will win.
        return false;
      }
    }
    return now() - holder.startedAt > staleMs || !isAlive(holder.pid);
  };

  const acquire = async (): Promise<Release> => {
    if (disabled()) return async () => {};
    const deadline = now() + acquireTimeoutMs;
    const token = randomUUID();

    for (;;) {
      try {
        await mkdir(lockDir); // atomic exclusive create — fails EEXIST if another holder has it
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        // The lock is held. Steal it if stale; otherwise poll until the deadline, then fail loud.
        if (await isStale()) {
          await rm(lockDir, { recursive: true, force: true }).catch(() => {});
          continue; // re-attempt the atomic create; a lost steal race just loops again
        }
        if (now() >= deadline) {
          const holder = await readHolder();
          const age = holder ? now() - holder.startedAt : undefined;
          throw new Error(
            `cluster-mutex: could not acquire ${lockDir} within ${acquireTimeoutMs}ms; held by ` +
              `pid ${holder?.pid ?? "unknown"} for ${age ?? "unknown"}ms. If no two-node cluster is ` +
              `running, this is a leaked lock — remove ${lockDir}.`,
            // The proximate reason we are here is the mkdir EEXIST that keeps failing — carry its
            // errno so a caller sees the raw lock-held signal behind the timeout.
            { cause: error },
          );
        }
        await delay(pollIntervalMs + Math.random() * pollIntervalMs);
        continue;
      }

      // Won the lock. Record our identity for the staleness and ownership checks.
      await writeFile(holderFile, JSON.stringify({ pid: process.pid, startedAt: now(), token }));
      let released = false;
      return async () => {
        if (released) return; // idempotent — a second release does nothing
        released = true;
        try {
          // Only remove the lock while it is still OURS. A lock stolen from us (we hung past STALE_MS)
          // and re-acquired by another holder carries a different token and must NOT be freed here.
          const holder = await readHolder();
          if (holder?.token === token) await rm(lockDir, { recursive: true, force: true });
        } catch {
          // Best-effort: a teardown error must never strand the caller, and stale recovery reclaims a
          // lock we somehow failed to remove.
        }
      };
    }
  };

  return { acquire };
}

/** The shared machine-wide instance both two-node fixtures use by default. */
export const clusterMutex: ClusterMutex = createFileClusterMutex();
