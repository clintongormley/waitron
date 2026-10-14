import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { Database } from "@waitron/db";
import type { BackupOutcomeHolder } from "./alert-sources.js";
import { runBackupSweep, type BackupSweepDeps } from "./backup-sweep.js";
import { LocalFsBackend } from "./local-fs-backend.js";
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
      free = 10_000_000;
      nowMs += chunk;
    },
  });

  await runBackupSweep(deps);

  expect(seen).toEqual([{ code: "backup.staging_space_low", at: STAMP.toISOString() }]);
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
