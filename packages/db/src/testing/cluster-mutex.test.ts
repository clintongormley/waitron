import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileClusterMutex, isProcessAlive, type ClusterMutex } from "./cluster-mutex.js";

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
      await expect(mutex.acquire()).rejects.toThrow(new RegExp(`pid ${process.pid}`));
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
    await expect(mutex.acquire()).rejects.toThrow(/could not acquire/);
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
