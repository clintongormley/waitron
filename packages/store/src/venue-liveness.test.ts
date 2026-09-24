import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { readVenueHolder, VENUE_HOLDER_FILE, VENUE_HOLDER_STALE_MS } from "./venue-holder.js";
import {
  HOLDER_HEARTBEAT_MS,
  runningWatchdog,
  setVenueCrashReportDirectory,
  setVenueHolderKind,
  setVenueLivenessTimings,
  STACK_CAPTURE_MS,
  VENUE_HOLDER_FROZEN_CODE,
  WATCHDOG_TICK_MS,
} from "./venue-liveness.js";
import { lockVenueDirectory, VenueInUseError, type VenueLock } from "./venue-lock.js";

/**
 * Clears a child's worst case with room: Node's startup on a loaded runner (the largest and least
 * predictable part), the child's shortened staleness bound, and its capture deadline. A child that
 * is never killed is ended by {@link CHILD_DEADLINE_MS}, below this.
 */
const CHILD_TIMEOUT_MS = 30_000;
const CHILD_DEADLINE_MS = 20_000;

const locks: VenueLock[] = [];
const children: ChildProcess[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  for (const lock of locks.splice(0)) lock.release();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
  setVenueLivenessTimings({});
  setVenueHolderKind("script");
  setVenueCrashReportDirectory(null, null);
});

const tempDir = () => {
  const directory = mkdtempSync(join(tmpdir(), "waitron-venue-liveness-"));
  directories.push(directory);
  return directory;
};
const lock = async (directory: string) => {
  const held = await lockVenueDirectory(directory);
  locks.push(held);
  return held;
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const holderPath = (directory: string) => join(directory, VENUE_HOLDER_FILE);
/** Catches a half-written copy left beside the file. */
const holderFiles = (directory: string) =>
  readdirSync(directory).filter((name) => name.startsWith("venue.holder"));

async function until<T>(read: () => T, done: (value: T) => boolean, withinMs = 5000): Promise<T> {
  const deadline = Date.now() + withinMs;
  for (;;) {
    const value = read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`not reached within ${withinMs} ms`);
    await sleep(20);
  }
}

describe("the liveness bounds", () => {
  it("are the production values", () => {
    expect(HOLDER_HEARTBEAT_MS).toBe(5000);
    expect(WATCHDOG_TICK_MS).toBe(1000);
    expect(STACK_CAPTURE_MS).toBe(2000);
    expect(VENUE_HOLDER_STALE_MS).toBe(30_000);
    expect(VENUE_HOLDER_FROZEN_CODE).toBe("provisioning.database_holder_frozen");
  });
});

describe("the holder file", () => {
  it("is written when the folder is first taken, naming this process", async () => {
    const directory = tempDir();
    const before = Date.now();
    await lock(directory);
    const holder = readVenueHolder(directory);
    expect(holder).toEqual({
      kind: "script",
      pid: process.pid,
      host: hostname(),
      lockedAt: expect.any(String),
      heartbeatAt: expect.any(String),
    });
    expect(Date.parse(holder!.lockedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(holder!.lockedAt)).toBeLessThanOrEqual(Date.now());
    expect(holder!.heartbeatAt).toBe(holder!.lockedAt);
    expect(holderFiles(directory)).toEqual(["venue.holder.json"]);
  });

  it("names the kind this process was given", async () => {
    setVenueHolderKind("server");
    const directory = tempDir();
    await lock(directory);
    expect(readVenueHolder(directory)?.kind).toBe("server");
  });

  it("has its heartbeat rewritten while the folder is held, and its lock time kept", async () => {
    setVenueLivenessTimings({ heartbeatMs: 40 });
    const directory = tempDir();
    await lock(directory);
    const first = readVenueHolder(directory)!;
    const later = await until(
      () => readVenueHolder(directory)!,
      (holder) => holder.heartbeatAt > first.heartbeatAt,
    );
    expect(later.lockedAt).toBe(first.lockedAt);
    expect(later.pid).toBe(process.pid);
  });

  it("is kept while another share is held, and removed with the last release", async () => {
    const directory = tempDir();
    const a = await lock(directory);
    const b = await lock(directory);
    a.release();
    expect(readVenueHolder(directory)?.pid).toBe(process.pid);
    b.release();
    expect(existsSync(holderPath(directory))).toBe(false);
    expect(existsSync(join(directory, "venue.lock"))).toBe(true);
  });

  it("is not written again once the folder is released", async () => {
    setVenueLivenessTimings({ heartbeatMs: 20 });
    const directory = tempDir();
    (await lock(directory)).release();
    await sleep(200);
    expect(existsSync(holderPath(directory))).toBe(false);
  });

  it("refuses the lock, and leaves it free, when the file cannot be written", async () => {
    const directory = tempDir();
    mkdirSync(join(holderPath(directory), "occupied"), { recursive: true });
    await expect(lockVenueDirectory(directory)).rejects.toMatchObject({ syscall: "rename" });
    expect(holderFiles(directory)).toEqual(["venue.holder.json"]);
    rmSync(holderPath(directory), { recursive: true });
    await lock(directory);
    expect(readVenueHolder(directory)?.pid).toBe(process.pid);
  });

  it("still gives the lock up when the file cannot be removed", async () => {
    const directory = tempDir();
    const warnings: Error[] = [];
    const onWarning = (warning: Error) => warnings.push(warning);
    process.on("warning", onWarning);
    try {
      const held = await lockVenueDirectory(directory);
      rmSync(holderPath(directory));
      mkdirSync(join(holderPath(directory), "occupied"), { recursive: true });
      held.release();
      await until(
        () => warnings.length,
        (count) => count > 0,
      );
      expect(warnings.map((warning) => warning.name)).toEqual(["VenueHolderRemoveWarning"]);
      rmSync(holderPath(directory), { recursive: true });
      await lock(directory);
    } finally {
      process.off("warning", onWarning);
    }
  });

  it("warns once when a heartbeat cannot be written, and recovers when it can", async () => {
    setVenueLivenessTimings({ heartbeatMs: 20 });
    const directory = tempDir();
    const warnings: Error[] = [];
    const onWarning = (warning: Error) => warnings.push(warning);
    process.on("warning", onWarning);
    try {
      await lock(directory);
      rmSync(holderPath(directory));
      mkdirSync(join(holderPath(directory), "occupied"), { recursive: true });
      await until(
        () => warnings.length,
        (count) => count > 0,
      );
      await sleep(200);
      expect(warnings.map((warning) => warning.name)).toEqual(["VenueHolderHeartbeatWarning"]);
      rmSync(holderPath(directory), { recursive: true });
      await until(
        () => readVenueHolder(directory),
        (holder) => holder !== null,
      );
    } finally {
      process.off("warning", onWarning);
    }
  });
});

describe("the watchdog thread", () => {
  it("runs once per process while any folder is held, and stops with the last", async () => {
    expect(runningWatchdog()).toBeUndefined();
    const a = await lock(tempDir());
    const watchdog = runningWatchdog();
    expect(watchdog).toBeDefined();
    const b = await lock(tempDir());
    expect(runningWatchdog()).toBe(watchdog);
    const exited = new Promise<void>((resolve) => watchdog!.once("exit", () => resolve()));
    a.release();
    expect(runningWatchdog()).toBe(watchdog);
    b.release();
    expect(runningWatchdog()).toBeUndefined();
    await exited;
  });
});

// ---------------------------------------------------------------------------------------------
// Real child processes: each takes the folder through this package's own code, run by Node's type
// stripping, with the `.js` specifiers the sources use resolved to their `.ts` files.

const source = (name: string) =>
  JSON.stringify(pathToFileURL(join(import.meta.dirname, name)).href);

const PRELUDE = `import { registerHooks } from "node:module";
registerHooks({
  resolve(specifier, context, next) {
    if (!specifier.startsWith(".") || !specifier.endsWith(".js")) return next(specifier, context);
    try { return next(specifier, context); } catch { return next(specifier.slice(0, -3) + ".ts", context); }
  },
});
const { lockVenueDirectory } = await import(${source("venue-lock.ts")});
const liveness = await import(${source("venue-liveness.ts")});
const [directory, reports] = process.argv.slice(1);
liveness.setVenueLivenessTimings({ tickMs: 50, staleMs: 600, captureMs: 1000 });
`;

interface Outcome {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

function runChild(body: string, directory: string, reports = ""): Promise<Outcome> {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", PRELUDE + body, directory, reports],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  children.push(child);
  const deadline = setTimeout(() => child.kill("SIGTERM"), CHILD_DEADLINE_MS);
  let stdout = "";
  let stderr = "";
  child.stdout!.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr!.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      clearTimeout(deadline);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

const frozenLine = (stderr: string) => {
  const line = stderr.split("\n").find((text) => text.includes('"venue.holder_frozen"'));
  return line === undefined ? undefined : (JSON.parse(line) as Record<string, unknown>);
};

describe("a second process refused the folder", () => {
  it(
    "leaves the holder's file as it was",
    async () => {
      const directory = tempDir();
      await lock(directory);
      const before = readFileSync(holderPath(directory), "utf8");
      const outcome = await runChild(
        `try { await lockVenueDirectory(directory); process.stdout.write("acquired"); }
catch (error) { process.stdout.write(error.name); }`,
        directory,
      );
      expect(outcome.stdout).toBe(VenueInUseError.name);
      expect(readFileSync(holderPath(directory), "utf8")).toBe(before);
    },
    CHILD_TIMEOUT_MS,
  );
});

describe("a holder whose main thread freezes", () => {
  it(
    "is killed by its watchdog with the frozen function's name, and the folder is free after",
    async () => {
      const directory = tempDir();
      const reports = join(tempDir(), "crash-reports");
      const outcome = await runChild(
        `liveness.setVenueHolderKind("restore");
await lockVenueDirectory(directory);
liveness.setVenueCrashReportDirectory(reports, "test-build-7");
function spinForever() { for (;;) {} }
setTimeout(spinForever, 100);`,
        directory,
        reports,
      );
      expect(outcome.signal).toBe("SIGKILL");
      const line = frozenLine(outcome.stderr);
      expect(line).toMatchObject({
        event: "venue.holder_frozen",
        level: "error",
        code: "provisioning.database_holder_frozen",
        kind: "restore",
        pid: expect.any(Number),
        lockedAt: expect.any(String),
        lastTickAt: expect.any(String),
      });
      const stack = line!.stack as { function: string; file: string; line: number }[];
      expect(stack[0]).toMatchObject({ function: "spinForever", file: "[eval1]" });
      expect(stack[0]!.line).toBeGreaterThan(0);

      const files = readdirSync(reports);
      expect(files).toHaveLength(1);
      const report = JSON.parse(readFileSync(join(reports, files[0]!), "utf8")) as Record<
        string,
        unknown
      >;
      expect(Object.keys(report).sort()).toEqual([
        "code",
        "host",
        "killedAt",
        "kind",
        "lastTickAt",
        "lockedAt",
        "pid",
        "stack",
        "version",
      ]);
      expect(report).toMatchObject({
        code: "provisioning.database_holder_frozen",
        kind: "restore",
        pid: line!.pid,
        host: hostname(),
        lockedAt: line!.lockedAt,
        lastTickAt: line!.lastTickAt,
        version: "test-build-7",
        stack: line!.stack,
      });
      const silentMs =
        Date.parse(report.killedAt as string) - Date.parse(report.lastTickAt as string);
      expect(silentMs).toBeGreaterThanOrEqual(600);

      // The dead holder's file is left behind naming it; the lock itself is free.
      expect(readVenueHolder(directory)).toMatchObject({ kind: "restore", pid: line!.pid });
      await lock(directory);
      expect(readVenueHolder(directory)?.pid).toBe(process.pid);
    },
    CHILD_TIMEOUT_MS,
  );

  it(
    "is killed without a stack when it is stuck inside native code",
    async () => {
      const directory = tempDir();
      const outcome = await runChild(
        `const { DatabaseSync } = await import("node:sqlite");
await lockVenueDirectory(directory);
const db = new DatabaseSync(":memory:");
function longQuery() {
  db.prepare("with recursive c(x) as (select 1 union all select x + 1 from c where x < 3000000000) select count(*) from c").get();
}
setTimeout(longQuery, 100);`,
        directory,
      );
      expect(outcome.signal).toBe("SIGKILL");
      expect(frozenLine(outcome.stderr)).toMatchObject({ kind: "script", stack: null });
      await lock(directory);
    },
    CHILD_TIMEOUT_MS,
  );

  it(
    "is killed when it freezes before its event loop turns again, and writes no report unasked",
    async () => {
      const directory = tempDir();
      const reports = join(tempDir(), "crash-reports");
      const outcome = await runChild(
        `await lockVenueDirectory(directory);
function spinForever() { for (;;) {} }
spinForever();`,
        directory,
        reports,
      );
      expect(outcome.signal).toBe("SIGKILL");
      expect(frozenLine(outcome.stderr)).toBeDefined();
      expect(existsSync(reports)).toBe(false);
    },
    CHILD_TIMEOUT_MS,
  );
});

describe("a holder with nothing left to do", () => {
  it(
    "exits on its own while it still holds the folder",
    async () => {
      const directory = tempDir();
      const outcome = await runChild(
        `await lockVenueDirectory(directory);
process.stdout.write("held");`,
        directory,
      );
      expect(outcome).toMatchObject({ code: 0, signal: null, stdout: "held" });
    },
    CHILD_TIMEOUT_MS,
  );
});

describe("a holder awaiting something slow", () => {
  it(
    "is not killed while its main thread keeps turning",
    async () => {
      const directory = tempDir();
      const outcome = await runChild(
        `const lock = await lockVenueDirectory(directory);
await new Promise((resolve) => setTimeout(resolve, 2000));
lock.release();
process.stdout.write("finished");`,
        directory,
      );
      expect(outcome).toMatchObject({ code: 0, signal: null, stdout: "finished" });
      expect(frozenLine(outcome.stderr)).toBeUndefined();
    },
    CHILD_TIMEOUT_MS,
  );
});
