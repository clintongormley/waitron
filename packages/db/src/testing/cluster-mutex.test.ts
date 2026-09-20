import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFileClusterMutex,
  DEFAULT_LOCK_DIR,
  isProcessAlive,
  type ClusterMutex,
} from "./cluster-mutex.js";

// The cross-process mutex is pure fs/pid logic — no Docker. It backs BOTH two-node fixtures so only
// ONE cluster of either kind is alive machine-wide at a time; these tests pin the properties a
// concurrency bug would break: mutual exclusion, stale-lock recovery (dead pid OR age past STALE_MS),
// idempotent release that never frees a later acquirer's lock, and a LOUD acquire timeout instead of
// a silent hang. Each test owns its own lock dir under a throwaway temp base so nothing here touches
// the real machine-wide lock.

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("createFileClusterMutex", () => {
  const bases: string[] = [];
  const freshLockDir = (): string => {
    const base = mkdtempSync(join(tmpdir(), "cluster-mutex-test-"));
    bases.push(base);
    return join(base, "lock"); // the lock dir itself must NOT pre-exist; its parent does.
  };
  const writeHolder = (lockDir: string, holder: object): void => {
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, "holder.json"), JSON.stringify(holder));
  };

  afterEach(() => {
    for (const base of bases.splice(0)) rmSync(base, { recursive: true, force: true });
  });

  it("holds mutual exclusion — a second acquire stays pending until the first releases", async () => {
    const lockDir = freshLockDir();
    const mutex = createFileClusterMutex({ lockDir, pollIntervalMs: 10, acquireTimeoutMs: 5_000 });

    const release1 = await mutex.acquire();
    let resolved2 = false;
    const acquire2 = mutex.acquire().then((r) => {
      resolved2 = true;
      return r;
    });

    // While the first holds the lock, the second must NOT resolve. A no-op mutex would resolve at once.
    await delay(120);
    expect(resolved2).toBe(false);

    await release1();
    const release2 = await acquire2;
    expect(resolved2).toBe(true);
    await release2();
  });

  it("steals a stale lock whose holder pid is dead", async () => {
    const lockDir = freshLockDir();
    // A pid far above any real one is dead: process.kill throws ESRCH, so the holder is reclaimable.
    writeHolder(lockDir, { pid: 999_999_999, startedAt: Date.now(), token: "ghost" });
    const mutex = createFileClusterMutex({ lockDir, pollIntervalMs: 10, acquireTimeoutMs: 2_000 });

    // Without the pid-liveness steal this would time out on a lock no living process holds.
    const release = await mutex.acquire();
    await release();
  });

  it("steals a lock older than STALE_MS even when its pid looks alive", async () => {
    const lockDir = freshLockDir();
    // A living pid, but the hold is ancient. A fake clock puts "now" well past staleMs from startedAt.
    writeHolder(lockDir, { pid: process.pid, startedAt: 0, token: "old" });
    const staleMs = 1_000;
    const mutex = createFileClusterMutex({
      lockDir,
      staleMs,
      pollIntervalMs: 10,
      acquireTimeoutMs: 2_000,
      now: () => staleMs + 5, // past the stale bound relative to startedAt=0
      isAlive: () => true, // prove the AGE path, not the pid path
    });

    const release = await mutex.acquire();
    await release();
  });

  it("is idempotent on release and never frees a LATER acquirer's lock", async () => {
    const lockDir = freshLockDir();
    const mutex = createFileClusterMutex({ lockDir, pollIntervalMs: 10, acquireTimeoutMs: 5_000 });

    const release1 = await mutex.acquire();
    await release1();
    await release1(); // second release must not throw

    // A new holder now owns the lock; the stale first releaser must not free it.
    const release2 = await mutex.acquire();
    await release1(); // called yet again — must be a no-op, not a steal of release2's lock

    let resolved3 = false;
    const acquire3 = mutex.acquire().then((r) => {
      resolved3 = true;
      return r;
    });
    await delay(100);
    expect(resolved3).toBe(false); // release2 still holds it

    await release2();
    await (
      await acquire3
    )();
  });

  it("release does NOT free a lock that was stolen and re-acquired by another holder", async () => {
    const lockDir = freshLockDir();
    const mutex = createFileClusterMutex({ lockDir, pollIntervalMs: 10, acquireTimeoutMs: 2_000 });
    const release = await mutex.acquire();
    // Simulate another holder stealing (we hung past STALE_MS) and re-acquiring: same dir, DIFFERENT
    // token. Our release must see the token mismatch and leave the new holder's lock alone.
    writeFileSync(
      join(lockDir, "holder.json"),
      JSON.stringify({ pid: process.pid, startedAt: Date.now(), token: "someone-else" }),
    );
    await release();
    expect(existsSync(lockDir)).toBe(true); // the new holder still owns it
  });

  it("times out with a LOUD throw naming the holder, rather than hanging forever", async () => {
    const lockDir = freshLockDir();
    const mutex = createFileClusterMutex({
      lockDir,
      pollIntervalMs: 15,
      acquireTimeoutMs: 150, // tiny injected bound
      staleMs: 10 * 60_000, // huge, so the held lock is never judged stale
    });

    const release1 = await mutex.acquire();
    try {
      const error = await mutex.acquire().then(
        () => undefined,
        (reason: unknown) => reason as Error,
      );
      expect(error?.message).toMatch(new RegExp(`pid ${process.pid}`));
      // The rest of what the message is for. Whoever reads it is a person looking at a suite that
      // will not start, so it has to say which lock, how long it has been held, and what to delete.
      expect(error?.message).toContain(lockDir);
      // And what to DO about it. A person reading this is looking at a suite that will not start;
      // without this sentence the message says a lock is held and not that it can be deleted.
      expect(error?.message).toContain(`this is a leaked lock — remove ${lockDir}.`);
      const age = Number(/for (\d+)ms/.exec(error?.message ?? "")?.[1]);
      expect(age).toBeGreaterThanOrEqual(0);
      expect(age).toBeLessThan(60_000); // an age, not a clock reading
      // And the errno behind it, so a caller sees the raw lock-held signal rather than only the
      // timeout that wraps it.
      expect((error?.cause as NodeJS.ErrnoException | undefined)?.code).toBe("EEXIST");
    } finally {
      await release1();
    }
  });

  it("does not steal a lock dir with no readable holder that is younger than STALE_MS", async () => {
    const lockDir = freshLockDir();
    mkdirSync(lockDir); // dir exists but holder.json was never written (a holder mid-write)
    const mutex = createFileClusterMutex({
      lockDir,
      pollIntervalMs: 15,
      acquireTimeoutMs: 120,
      staleMs: 10 * 60_000,
    });
    // No pid to read, but the dir is fresh — must poll and time out, not steal a write-in-progress lock.
    // And with no holder to name, the message has to say so rather than print an empty gap where
    // the pid and the age belong.
    await expect(mutex.acquire()).rejects.toThrow(/pid unknown for unknownms/);
  });

  it("steals a lock dir with no readable holder once it is older than STALE_MS", async () => {
    const lockDir = freshLockDir();
    mkdirSync(lockDir); // holderless dir (a holder that crashed after mkdir, before writing metadata)
    const staleMs = 500;
    const mutex = createFileClusterMutex({
      lockDir,
      staleMs,
      pollIntervalMs: 10,
      acquireTimeoutMs: 2_000,
      now: () => Date.now() + staleMs + 1_000, // push "now" past the dir's mtime + staleMs
    });
    const release = await mutex.acquire();
    await release();
  });

  it("treats a corrupt (wrong-typed) holder as unreadable and reclaims it by age", async () => {
    const lockDir = freshLockDir();
    // A holder.json that parses but whose fields are the wrong type — a torn or garbage write. It must
    // be treated as unreadable (not trusted as {pid,startedAt}) and reclaimed by the dir's age.
    writeHolder(lockDir, { pid: "not-a-number", startedAt: "nope" });
    const staleMs = 500;
    const mutex = createFileClusterMutex({
      lockDir,
      staleMs,
      pollIntervalMs: 10,
      acquireTimeoutMs: 2_000,
      now: () => Date.now() + staleMs + 1_000,
    });
    const release = await mutex.acquire();
    await release();
  });

  it("reads the escape hatch from the environment when the caller injects no seam", async () => {
    // Every other case here injects `disabled`, so the default — the one a developer actually uses
    // from a shell — was never exercised. WAITRON_TWO_NODE_MUTEX=0 has to turn the mutex off, and
    // no other value may.
    const lockDir = freshLockDir();
    writeHolder(lockDir, { pid: process.pid, startedAt: Date.now(), token: "held" });
    const previous = process.env.WAITRON_TWO_NODE_MUTEX;
    try {
      process.env.WAITRON_TWO_NODE_MUTEX = "0";
      const off = createFileClusterMutex({ lockDir, pollIntervalMs: 10, acquireTimeoutMs: 100 });
      await (
        await off.acquire()
      )();
      expect(existsSync(lockDir)).toBe(true); // a no-op release left the other holder alone

      process.env.WAITRON_TWO_NODE_MUTEX = "1";
      const on = createFileClusterMutex({
        lockDir,
        pollIntervalMs: 10,
        acquireTimeoutMs: 100,
        staleMs: 10 * 60_000,
      });
      await expect(on.acquire()).rejects.toThrow(/could not acquire/);
    } finally {
      if (previous === undefined) delete process.env.WAITRON_TWO_NODE_MUTEX;
      else process.env.WAITRON_TWO_NODE_MUTEX = previous;
    }
  });

  it("does not trust a holder whose pid or startedAt is the wrong type", async () => {
    // The corrupt-holder case above is reclaimed by age either way, so it passes whether the types
    // are checked or not. Here the dir is FRESH: read as unreadable, the lock is not stale and the
    // waiter has to wait. Trust the torn record instead and the dead-pid path steals a lock a live
    // holder is still writing into.
    const lockDir = freshLockDir();
    writeHolder(lockDir, { pid: process.pid, startedAt: "a moment ago", token: "torn" });
    const mutex = createFileClusterMutex({
      lockDir,
      pollIntervalMs: 10,
      acquireTimeoutMs: 120,
      staleMs: 10 * 60_000,
      isAlive: () => false, // if the torn record were trusted, this alone would make it stealable
    });
    await expect(mutex.acquire()).rejects.toThrow(/could not acquire/);
  });

  it("does not steal a hold that is exactly as old as the stale bound", async () => {
    // The bound is "older than", not "as old as". One millisecond either side of it decides whether
    // a slow-but-alive holder keeps its lock or has a second cluster booted on top of it.
    const lockDir = freshLockDir();
    writeHolder(lockDir, { pid: process.pid, startedAt: 0, token: "borderline" });
    const staleMs = 1_000;
    const mutex = createFileClusterMutex({
      lockDir,
      staleMs,
      pollIntervalMs: 10,
      // The clock is frozen at the boundary, and the acquire deadline is computed from that same
      // clock — so the bound has to be zero for the attempt to give up at all. Staleness is judged
      // before the deadline is, which is the comparison this case is about.
      acquireTimeoutMs: 0,
      now: () => staleMs, // exactly staleMs since startedAt=0
      isAlive: () => true,
    });
    await expect(mutex.acquire()).rejects.toThrow(/could not acquire/);
  });

  it("does not steal a holderless dir that is exactly as old as the stale bound", async () => {
    // The same boundary on the other path, where the dir's own timestamp stands in for a holder
    // that has not written itself down yet.
    const lockDir = freshLockDir();
    mkdirSync(lockDir);
    const staleMs = 1_000;
    const mtimeMs = statSync(lockDir).mtimeMs;
    const mutex = createFileClusterMutex({
      lockDir,
      staleMs,
      pollIntervalMs: 10,
      acquireTimeoutMs: 0, // frozen clock, as above
      now: () => mtimeMs + staleMs,
    });
    await expect(mutex.acquire()).rejects.toThrow(/could not acquire/);
  });

  it("fails loudly when the lock cannot be created for a reason that is not contention", async () => {
    // EEXIST means somebody holds it and waiting is right. Anything else — a missing parent
    // directory here, a permissions problem on a real machine — is not a held lock, and treating it
    // as one turns a broken path into four minutes of polling and a message blaming a holder that
    // does not exist.
    const lockDir = join(freshLockDir(), "under", "a", "missing", "parent");
    const mutex = createFileClusterMutex({ lockDir, pollIntervalMs: 10, acquireTimeoutMs: 200 });
    await expect(mutex.acquire()).rejects.toThrow(/ENOENT/);
  });

  it("is a no-op when disabled via the escape hatch", async () => {
    const lockDir = freshLockDir();
    writeHolder(lockDir, { pid: process.pid, startedAt: Date.now(), token: "held" });
    // Disabled: acquire must resolve immediately even though the lock dir is held (no polling, no throw).
    const mutex = createFileClusterMutex({
      lockDir,
      acquireTimeoutMs: 50,
      disabled: () => true,
    });
    const release = await mutex.acquire();
    await release(); // release is also a no-op — it must NOT remove the held lock
  });
});

describe("DEFAULT_LOCK_DIR", () => {
  // Compared as a value rather than by making two default mutexes contend: contending would take
  // the REAL machine-wide lock, and every other case in this file deliberately works in a
  // throwaway directory so that nothing here can collide with a two-node suite running beside it.
  it("is one named path in the OS temp dir, so every process on the box picks the same lock", () => {
    expect(DEFAULT_LOCK_DIR).toBe(join(tmpdir(), "waitron-two-node-cluster.lock"));
  });
});

describe("isProcessAlive", () => {
  it("reports this process alive and a far-out pid dead", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(999_999_999)).toBe(false);
  });

  it("treats a pid it cannot signal (EPERM) as alive", () => {
    // pid 1 (init/launchd) exists but a non-root process cannot signal it -> EPERM, which means ALIVE,
    // not dead. If this run is root, process.kill(1,0) succeeds and the answer is still `true`.
    expect(isProcessAlive(1)).toBe(true);
  });
});

// Type-only: the exported ClusterMutex shape is what the fixtures depend on.
void (0 as unknown as ClusterMutex);
