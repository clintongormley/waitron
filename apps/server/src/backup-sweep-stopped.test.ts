import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { BackupOutcomeHolder } from "./alert-sources.js";
import { BACKUP_ENCRYPT_DIR_PREFIX } from "./backup-keys.js";
import { runBackupSweep, type BackupSweepDeps } from "./backup-sweep.js";
import { LocalFsBackend } from "./local-fs-backend.js";
import { START_FREE_SPACE_FLOOR } from "./start-space.js";
import { RECOVERY_FILES } from "./state-secrets.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const STAMP = new Date("2026-10-06T00:00:00Z");

/** A filesystem reporting `free` bytes available, whatever the real disk holds. */
const freeSpace = (free: number) => async () => ({ bavail: free / 4, frsize: 4 });

async function loopDeps(
  overrides: Partial<BackupSweepDeps> & Pick<BackupSweepDeps, "signal" | "sleep">,
): Promise<{ deps: BackupSweepDeps; outcomes: BackupOutcomeHolder; backend: LocalFsBackend }> {
  const root = await mkdtemp(join(tmpdir(), "sweep-stopped-"));
  dirs.push(root);
  const stateDir = join(root, "state");
  await mkdir(join(stateDir, "tls"), { recursive: true });
  for (const rel of RECOVERY_FILES) await writeFile(join(stateDir, rel), `${rel}-contents`);
  const outcomes: BackupOutcomeHolder = { failed: new Map() };
  const backend = new LocalFsBackend("a", join(root, "a"));
  const deps: BackupSweepDeps = {
    backends: [backend],
    db: {} as Database,
    modules: [],
    environment: "preproduction",
    resolvers: {},
    stateDir,
    stagingDir: join(root, "staging"),
    recoveryKey: "key",
    schedule: { kind: "interval", ms: 10 },
    retain: 3,
    retainDays: 30,
    jitterSeed: "node",
    readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00", cutoverChanges: [] }),
    destinationTimeoutMs: 60_000,
    outcomes,
    log: vi.fn(),
    now: () => STAMP,
    buildManifest: async () => ({
      manifestVersion: 1 as const,
      createdAt: STAMP.toISOString(),
      environment: "preproduction" as const,
      modules: { core: 3 },
    }),
    archive: async (path: string) => writeFile(path, "D".repeat(1000)),
    ...overrides,
  };
  return { deps, outcomes, backend };
}

it("records the code a run stopped on before reaching any destination, with the run's time", async () => {
  const controller = new AbortController();
  const { deps, outcomes } = await loopDeps({
    signal: controller.signal,
    sleep: async () => controller.abort(),
    stagingEstimateBytes: async () => 1000,
    statfs: freeSpace(1999),
  });

  await runBackupSweep(deps);

  expect(outcomes.runStopped).toEqual({
    code: "backup.staging_space_low",
    at: STAMP.toISOString(),
    sizes: { neededBytes: 3000 + START_FREE_SPACE_FLOOR, availableBytes: 1999 },
  });
  expect(outcomes.failed.size).toBe(0);
});

it("clears the stopped run once a later run reaches its destinations", async () => {
  const controller = new AbortController();
  let free = 1999;
  let nowMs = STAMP.getTime();
  const seen: unknown[] = [];
  const { deps, outcomes, backend } = await loopDeps({
    signal: controller.signal,
    now: () => new Date(nowMs),
    stagingEstimateBytes: async () => 1000,
    statfs: async () => freeSpace(free)(),
    sleep: async (chunk) => {
      if (seen.length > 0) {
        controller.abort();
        return;
      }
      seen.push(outcomes.runStopped);
      free = 3000 + START_FREE_SPACE_FLOOR + 1000;
      nowMs += chunk;
    },
  });

  await runBackupSweep(deps);

  expect(seen).toEqual([
    {
      code: "backup.staging_space_low",
      at: STAMP.toISOString(),
      sizes: { neededBytes: 3000 + START_FREE_SPACE_FLOOR, availableBytes: 1999 },
    },
  ]);
  expect(await backend.list("", { signal: new AbortController().signal })).toHaveLength(1);
  expect(outcomes.runStopped).toBeUndefined();
});

it("records nothing for a run that throws because it was cancelled", async () => {
  const controller = new AbortController();
  const { deps, outcomes } = await loopDeps({
    signal: controller.signal,
    sleep: vi.fn(),
    archive: async () => {
      controller.abort();
      throw new Error("interrupted by shutdown");
    },
  });

  await runBackupSweep(deps);

  expect(outcomes.runStopped).toBeUndefined();
});

it("records a failure that is not an AppError as unknown", async () => {
  const controller = new AbortController();
  const { deps, outcomes } = await loopDeps({
    signal: controller.signal,
    sleep: async () => controller.abort(),
    archive: async () => {
      throw new Error("plain error");
    },
  });

  await runBackupSweep(deps);

  expect(outcomes.runStopped).toEqual({ code: "unknown", at: STAMP.toISOString() });
});

it("records no sizes for a run that stops on an AppError other than staging_space_low", async () => {
  const controller = new AbortController();
  const { deps, outcomes } = await loopDeps({
    signal: controller.signal,
    sleep: async () => controller.abort(),
    buildManifest: async () => {
      throw new AppError("backup.archive_invalid", { reason: "test" });
    },
  });

  await runBackupSweep(deps);

  expect(outcomes.runStopped).toStrictEqual({
    code: "backup.archive_invalid",
    at: STAMP.toISOString(),
  });
});

it("clears the stopped run once a later run stores, even when that run's clean-up then fails", async () => {
  const controller = new AbortController();
  let free = 1999;
  let nowMs = STAMP.getTime();
  const seen: unknown[] = [];
  let stagingDir = "";
  const { deps, outcomes, backend } = await loopDeps({
    signal: controller.signal,
    now: () => new Date(nowMs),
    stagingEstimateBytes: async () => 1000,
    statfs: async () => freeSpace(free)(),
    sleep: async (chunk) => {
      if (seen.length > 0) {
        controller.abort();
        return;
      }
      seen.push(outcomes.runStopped);
      free = 3000 + START_FREE_SPACE_FLOOR + 1000;
      nowMs += chunk;
    },
    // An empty directory in place of the staged copy makes the clean-up's non-recursive `rm`
    // reject (`ERR_FS_EISDIR`) without changing any permission.
    onUploaded: () => {
      const staged = readdirSync(stagingDir).find((name) => !name.startsWith("backup-encrypt-"));
      if (!staged) throw new Error("no staged copy beside the ciphertext");
      rmSync(join(stagingDir, staged));
      mkdirSync(join(stagingDir, staged));
    },
  });
  stagingDir = deps.stagingDir;

  await runBackupSweep(deps);

  expect(seen).toEqual([
    {
      code: "backup.staging_space_low",
      at: STAMP.toISOString(),
      sizes: { neededBytes: 3000 + START_FREE_SPACE_FLOOR, availableBytes: 1999 },
    },
  ]);
  expect(await backend.list("", { signal: new AbortController().signal })).toHaveLength(1);
  expect(outcomes.failed.size).toBe(0);
  expect(outcomes.runStopped).toBeUndefined();
  expect(deps.log).toHaveBeenCalledWith("warn", "backup.failed", { errorCode: "unknown" });
});

it("a run keeps the earlier runStopped while its second check runs; a refusal there replaces it, and a pass clears it", async () => {
  const controller = new AbortController();
  let run = 0;
  let calls = 0;
  let nowMs = STAMP.getTime();
  const atSecondCheck: unknown[] = [];
  const after: unknown[] = [];
  let stagingDir = "";
  const { deps, outcomes, backend } = await loopDeps({
    signal: controller.signal,
    now: () => new Date(nowMs),
    stagingEstimateBytes: async () => 10,
    spaceFloorBytes: 10,
    spaceAimBytes: 0,
    // Run 1 is refused at the first check; run 2 passes the first check and the after-copy check
    // and is refused at the second; run 3 passes all three.
    statfs: async () => {
      calls += 1;
      if (run === 0) return { bavail: 0, frsize: 1 };
      if (calls < 3) return { bavail: 10_000, frsize: 1 };
      atSecondCheck.push(outcomes.runStopped);
      const dir = readdirSync(stagingDir).find((n) => n.startsWith(BACKUP_ENCRYPT_DIR_PREFIX));
      const encrypted = (await stat(join(stagingDir, dir!, "artifact"))).size;
      return { bavail: run === 1 ? encrypted + 9 : encrypted + 10, frsize: 1 };
    },
    sleep: async (chunk) => {
      after.push(outcomes.runStopped);
      if (run === 2) {
        controller.abort();
        return;
      }
      run += 1;
      calls = 0;
      nowMs += chunk;
    },
  });
  stagingDir = deps.stagingDir;

  await runBackupSweep(deps);

  const first = {
    code: "backup.staging_space_low",
    at: STAMP.toISOString(),
    sizes: { neededBytes: 40, availableBytes: 0 },
  };
  expect(atSecondCheck).toEqual([first, after[1]]);
  expect(after[0]).toEqual(first);
  expect(after[1]).toMatchObject({ code: "backup.staging_space_low" });
  expect(after[1]).not.toEqual(first);
  expect(after[2]).toBeUndefined();
  expect(await backend.list("", { signal: new AbortController().signal })).toHaveLength(1);
  expect(readdirSync(stagingDir)).toEqual([]);
});
