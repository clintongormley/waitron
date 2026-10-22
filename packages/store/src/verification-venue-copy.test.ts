import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  lockVenueDirectory,
  withVerificationVenueCopy,
  VerificationVenueCopyCleanupError,
} from "./index.js";
import { runningWatchdog, setWatchdogWorkerFactory, watchdogStopped } from "./venue-liveness.js";
import type { VenueLock } from "./venue-lock.js";

vi.mock("node:fs/promises", { spy: true });

const roots: string[] = [];
const locks: VenueLock[] = [];
const realRm = fs.rm;
afterEach(async () => {
  vi.restoreAllMocks();
  setWatchdogWorkerFactory(null);
  for (const held of locks.splice(0)) held.release();
  await watchdogStopped();
  for (const root of roots.splice(0)) await realRm(root, { recursive: true, force: true });
});
function root() {
  const directory = mkdtempSync(join(tmpdir(), "verification-copy-"));
  roots.push(directory);
  return directory;
}
async function lock(directory: string) {
  const held = await lockVenueDirectory(directory);
  locks.push(held);
  return held;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
function tryOtherProcess(directory: string) {
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync(process.argv[1]);
    try { db.exec("pragma busy_timeout=0; begin immediate"); process.stdout.write("acquired"); }
    catch(error) { process.stdout.write("refused " + error.errcode); }
    finally { db.close(); }
  `,
      join(directory, "venue.lock"),
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  expect(child.error).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  return child.stdout;
}

it("fresh copy keeps the process lock without liveness", async () => {
  const parent = root();
  const value = await withVerificationVenueCopy(parent, async (directory) => {
    const first = await lock(directory);
    const second = await lock(directory);
    expect(runningWatchdog()).toBeUndefined();
    expect(existsSync(join(directory, "venue.holder.json"))).toBe(false);
    expect(tryOtherProcess(directory)).toBe("refused 5");
    first.release();
    first.release();
    expect(tryOtherProcess(directory)).toBe("refused 5");
    second.release();
    expect(tryOtherProcess(directory)).toBe("acquired");
    return "checked";
  });
  expect(value).toBe("checked");
  expect(await fs.readdir(parent)).toEqual([]);
}, 30_000);

it.each(["verification first", "ordinary first"])(
  "ordinary sharing promotes before returning: %s",
  async (order) => {
    const ready = deferred<string>();
    const ordinaryReady = deferred<void>();
    const releaseVerification = deferred<void>();
    const releaseOrdinary = deferred<void>();
    const verificationReleased = deferred<void>();
    const copy = withVerificationVenueCopy(root(), async (directory) => {
      const held = await lock(directory);
      expect(runningWatchdog()).toBeUndefined();
      ready.resolve(directory);
      await ordinaryReady.promise;
      expect(runningWatchdog()).toBeDefined();
      await releaseVerification.promise;
      held.release();
      verificationReleased.resolve();
      await releaseOrdinary.promise;
    });
    const directory = await ready.promise;
    let ordinary: VenueLock | undefined;
    try {
      ordinary = await lock(directory);
      const worker = runningWatchdog();
      expect(worker).toBeDefined();
      expect(existsSync(join(directory, "venue.holder.json"))).toBe(true);
      ordinaryReady.resolve();
      if (order === "ordinary first") {
        ordinary.release();
        expect(runningWatchdog()).toBe(worker);
      }
      releaseVerification.resolve();
      await verificationReleased.promise;
      if (order === "verification first") {
        expect(runningWatchdog()).toBe(worker);
        expect(tryOtherProcess(directory)).toBe("refused 5");
        ordinary.release();
      }
      expect(runningWatchdog()).toBeUndefined();
    } finally {
      ordinary?.release();
      ordinaryReady.resolve();
      releaseVerification.resolve();
      releaseOrdinary.resolve();
      await copy;
    }
  },
  30_000,
);

it("failed promotion preserves existing shares", async () => {
  const ready = deferred<string>();
  const resume = deferred<void>();
  const copy = withVerificationVenueCopy(root(), async (directory) => {
    const held = await lock(directory);
    ready.resolve(directory);
    await resume.promise;
    expect(tryOtherProcess(directory)).toBe("refused 5");
    held.release();
    expect(tryOtherProcess(directory)).toBe("acquired");
  });
  const directory = await ready.promise;
  try {
    setWatchdogWorkerFactory(() => {
      throw new Error("thread refused");
    });
    await expect(lockVenueDirectory(directory)).rejects.toThrow("thread refused");
    expect(runningWatchdog()).toBeUndefined();
  } finally {
    setWatchdogWorkerFactory(null);
    resume.resolve();
    await copy;
  }
}, 30_000);

it("another directory inside the callback remains monitored", async () => {
  const parent = root();
  await withVerificationVenueCopy(parent, async (directory) => {
    const copyHeld = await lock(directory);
    const other = await lock(join(directory, "child"));
    expect(runningWatchdog()).toBeDefined();
    other.release();
    expect(runningWatchdog()).toBeUndefined();
    copyHeld.release();
  });
});

it("verification release cannot stop another directory's watchdog", async () => {
  const ordinary = await lock(root());
  const worker = runningWatchdog();
  await withVerificationVenueCopy(root(), async (directory) => {
    const held = await lock(directory);
    held.release();
    expect(runningWatchdog()).toBe(worker);
  });
  expect(runningWatchdog()).toBe(worker);
  ordinary.release();
});

it("aliases match only the canonical copy", async () => {
  const parent = root();
  await withVerificationVenueCopy(parent, async (directory) => {
    const alias = join(parent, "alias");
    await fs.symlink(directory, alias);
    const held = await lock(alias);
    expect(runningWatchdog()).toBeUndefined();
    held.release();
    await fs.unlink(alias);
    const other = root();
    await fs.symlink(other, alias);
    const outside = await lock(alias);
    expect(runningWatchdog()).toBeDefined();
    outside.release();
    await fs.unlink(alias);
  });
});

it("nested and parallel copies stay isolated", async () => {
  const parent = root();
  const names = await Promise.all(
    [0, 1].map(async () =>
      withVerificationVenueCopy(parent, async (outer) => {
        const a = await lock(outer);
        await withVerificationVenueCopy(parent, async (inner) => {
          expect(inner).not.toBe(outer);
          const b = await lock(inner);
          expect(runningWatchdog()).toBeUndefined();
          b.release();
        });
        const b = await lock(outer);
        expect(runningWatchdog()).toBeUndefined();
        a.release();
        b.release();
        return outer;
      }),
    ),
  );
  expect(new Set(names).size).toBe(2);
  expect(await fs.readdir(parent)).toEqual([]);
});

it("expired descendants regain ordinary monitoring", async () => {
  const resume = deferred<void>();
  let descendant: Promise<void> | undefined;
  await withVerificationVenueCopy(root(), async (directory) => {
    descendant = (async () => {
      await resume.promise;
      const held = await lock(directory);
      expect(runningWatchdog()).toBeDefined();
      held.release();
    })();
  });
  resume.resolve();
  await descendant;
});

it("cleans its owned directory when the callback throws", async () => {
  const parent = root();
  const failure = new Error("data refused");
  await expect(
    withVerificationVenueCopy(parent, async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(await fs.readdir(parent)).toEqual([]);
});

it("cleans up if canonicalization fails", async () => {
  const parent = root();
  vi.spyOn(fs, "realpath").mockRejectedValueOnce(new Error("canonicalization refused"));
  await expect(withVerificationVenueCopy(parent, async () => undefined)).rejects.toThrow(
    "canonicalization refused",
  );
  expect(await fs.readdir(parent)).toEqual([]);
});

it("reports cleanup uncertainty even after a callback refusal", async () => {
  const parent = root();
  const failure = new Error("removal refused");
  vi.spyOn(fs, "rm").mockRejectedValueOnce(failure);
  await expect(
    withVerificationVenueCopy(parent, async () => {
      throw new Error("data refused");
    }),
  ).rejects.toMatchObject({
    name: VerificationVenueCopyCleanupError.name,
    cause: failure,
  });
});
