import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RECOVERY_LOCK_FILE, withRecoveryLock } from "./recovery-lock.js";

const dirs: string[] = [];
async function stateDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "wt-reclock-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A second PROCESS holding the lock the way `withRecoveryLock` takes it, for `holdMs`. */
function holdInAnotherProcess(dir: string, holdMs: number): Promise<{ released: Promise<void> }> {
  const script = `import { DatabaseSync } from "node:sqlite";
const connection = new DatabaseSync(process.argv[1]);
connection.exec("begin immediate");
process.stdout.write("held");
setTimeout(() => connection.close(), ${holdMs});`;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", script, join(dir, RECOVERY_LOCK_FILE)],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const deadline = setTimeout(() => child.kill("SIGKILL"), 15_000);
  const released = new Promise<void>((resolve) =>
    child.on("exit", () => {
      clearTimeout(deadline);
      resolve();
    }),
  );
  return new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("held")) resolve({ released });
    });
    child.on("exit", (code) => reject(new Error(`holder exited before holding (${code})`)));
  });
}

describe("withRecoveryLock", () => {
  it("returns the body's value and leaves the lock file in place", async () => {
    const dir = await stateDir();
    expect(await withRecoveryLock(dir, () => Promise.resolve(42))).toBe(42);
    expect(existsSync(join(dir, RECOVERY_LOCK_FILE))).toBe(true);
  });

  it("runs a second caller in this process after the first, without stopping the event loop", async () => {
    const dir = await stateDir();
    const order: string[] = [];
    let ticks = 0;
    const ticker = setInterval(() => (ticks += 1), 10);
    try {
      await Promise.all([
        withRecoveryLock(dir, async () => {
          order.push("a-start");
          await pause(200);
          order.push("a-end");
        }),
        withRecoveryLock(dir, async () => {
          order.push("b-start");
          order.push("b-end");
        }),
      ]);
    } finally {
      clearInterval(ticker);
    }
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
    // The engine's own busy wait sleeps the thread, so the first body's timer could not fire and
    // both would stall until the wait gave up. A live loop ticks through the 200 ms.
    expect(ticks).toBeGreaterThan(5);
  });

  it("waits for another process to let go, then runs", async () => {
    const dir = await stateDir();
    const holder = await holdInAnotherProcess(dir, 400);
    const started = performance.now();
    let ranAt = 0;
    await withRecoveryLock(dir, () => {
      ranAt = performance.now() - started;
      return Promise.resolve();
    });
    await holder.released;
    expect(ranAt).toBeGreaterThanOrEqual(300);
  });

  it("gives up with the engine's busy error once its wait runs out", async () => {
    const dir = await stateDir();
    const holder = await holdInAnotherProcess(dir, 2_000);
    let ran = false;
    await expect(
      withRecoveryLock(
        dir,
        () => {
          ran = true;
          return Promise.resolve();
        },
        200,
      ),
    ).rejects.toMatchObject({ errcode: 5 });
    expect(ran).toBe(false);
    await holder.released;
  });

  it("lets go when the body throws", async () => {
    const dir = await stateDir();
    await expect(
      withRecoveryLock(dir, () => Promise.reject(new Error("body failed"))),
    ).rejects.toThrow("body failed");
    expect(await withRecoveryLock(dir, () => Promise.resolve("again"), 0)).toBe("again");
  });

  it("rejects when the state directory does not exist", async () => {
    const dir = join(await stateDir(), "missing");
    await expect(withRecoveryLock(dir, () => Promise.resolve())).rejects.toThrow();
  });
});
