import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStagingTurn } from "./backup-staging-turn.js";
import { deleteLeftovers, surveyLeftovers, type LeftoverDeps } from "./free-space-now.js";
import type { Logger } from "./logger.js";

const NOW = new Date("2026-10-21T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

let root: string;
let stateDir: string;
let logDir: string;
let stagingDir: string;
let lines: { level: string; event: string; fields?: Record<string, unknown> }[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wt-free-space-now-"));
  stateDir = join(root, "state");
  logDir = join(stateDir, "logs");
  stagingDir = join(stateDir, "backup-staging");
  await mkdir(join(stateDir, "venue"), { recursive: true });
  lines = [];
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const log: Logger = (level, event, fields) => {
  lines.push({ level, event, fields });
};

function deps(overrides: Partial<LeftoverDeps> = {}): LeftoverDeps {
  return { logDir, stateDir, now: () => NOW, staging: createStagingTurn(), log, ...overrides };
}

async function file(path: string, bytes: number, ageMs?: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.alloc(bytes));
  if (ageMs !== undefined) {
    const at = new Date(NOW.getTime() - ageMs);
    await utimes(path, at, at);
  }
}

const DUMP = "waitron-20261020T000000Z.dump";

async function stagingFiles(): Promise<string[]> {
  const paths = [
    join(stagingDir, DUMP),
    join(stagingDir, `${DUMP}.partial`),
    join(stagingDir, "backup-encrypt-abc", "artifact"),
  ];
  await file(paths[0]!, 3000);
  await file(paths[1]!, 500);
  await file(paths[2]!, 2000);
  return paths;
}

async function logFiles(): Promise<void> {
  await file(join(logDir, "waitron.log"), 100);
  await file(join(logDir, "waitron.log.1"), 200);
  await file(join(logDir, "waitron.log.2"), 300);
  await file(join(logDir, "waitron.log.5"), 400);
}

async function crashFiles(): Promise<{ old: string; recent: string }> {
  const old = join(logDir, "crash-reports", "holder-frozen-old.json");
  const recent = join(logDir, "crash-reports", "holder-frozen-recent.json");
  await file(old, 50, 8 * DAY_MS);
  await file(recent, 70, 6 * DAY_MS);
  return { old, recent };
}

function errnoError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe("surveyLeftovers and deleteLeftovers", () => {
  it("1. counts and deletes a staged dump, its partial and an encrypt folder", async () => {
    const paths = await stagingFiles();
    expect(await surveyLeftovers(deps())).toEqual({ bytes: 5500, backupRunning: false });
    expect(await deleteLeftovers(deps())).toEqual({
      freedBytes: 5500,
      deleted: 3,
      failed: 0,
      backupRunning: false,
    });
    for (const path of paths) expect(existsSync(path)).toBe(false);
    expect(existsSync(join(stagingDir, "backup-encrypt-abc"))).toBe(false);
  });

  it("2. keeps the current log and the newest rotated one", async () => {
    await logFiles();
    expect((await surveyLeftovers(deps())).bytes).toBe(700);
    await deleteLeftovers(deps());
    expect((await readdir(logDir)).sort()).toEqual(["waitron.log", "waitron.log.1"]);
  });

  it("3. deletes crash reports only once a week old", async () => {
    const { old, recent } = await crashFiles();
    expect((await surveyLeftovers(deps())).bytes).toBe(50);
    expect(await deleteLeftovers(deps())).toMatchObject({ freedBytes: 50, deleted: 1 });
    expect(existsSync(old)).toBe(false);
    expect(existsSync(recent)).toBe(true);
  });

  it("10. the survey's figure is what the deletion frees", async () => {
    await stagingFiles();
    await logFiles();
    await crashFiles();
    const { bytes } = await surveyLeftovers(deps());
    expect(bytes).toBe(5500 + 700 + 50);
    expect((await deleteLeftovers(deps())).freedBytes).toBe(bytes);
  });

  it("11. leaves staging alone while a backup run holds the turn", async () => {
    const paths = await stagingFiles();
    await logFiles();
    const staging = createStagingTurn();
    let release!: () => void;
    const run = staging.runBackup(() => new Promise<void>((resolve) => (release = resolve)));
    await new Promise((resolve) => setImmediate(resolve));
    expect(staging.backupRunning()).toBe(true);

    expect(await surveyLeftovers(deps({ staging }))).toEqual({ bytes: 700, backupRunning: true });
    expect(await deleteLeftovers(deps({ staging }))).toMatchObject({
      freedBytes: 700,
      backupRunning: true,
    });
    for (const path of paths) expect(existsSync(path)).toBe(true);

    release();
    await run;
    expect(await deleteLeftovers(deps({ staging }))).toMatchObject({
      freedBytes: 5500,
      backupRunning: false,
    });
  });

  it("12. a file that cannot be deleted is counted as failed and logged", async () => {
    await file(join(logDir, "waitron.log.2"), 300);
    const refused = join(logDir, "waitron.log.3");
    await file(refused, 400);
    const remove: LeftoverDeps["remove"] = async (path, options) => {
      if (path === refused) throw errnoError("EACCES");
      await rm(path, options);
    };
    expect(await deleteLeftovers(deps({ remove }))).toEqual({
      freedBytes: 300,
      deleted: 1,
      failed: 1,
      backupRunning: false,
    });
    expect(lines).toEqual([
      { level: "warn", event: "storage.free_space_failed", fields: { errno: "EACCES" } },
    ]);
    expect(existsSync(refused)).toBe(true);
  });

  it("13. a file gone before its deletion is neither deleted nor failed", async () => {
    await file(join(logDir, "waitron.log.2"), 300);
    const remove: LeftoverDeps["remove"] = async () => {
      throw errnoError("ENOENT");
    };
    expect(await deleteLeftovers(deps({ remove }))).toEqual({
      freedBytes: 0,
      deleted: 0,
      failed: 0,
      backupRunning: false,
    });
    expect(lines).toEqual([]);
  });

  it("15. a press during a refresh still deletes staging leftovers", async () => {
    const paths = await stagingFiles();
    const staging = createStagingTurn();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    let firstCall!: () => void;
    const reached = new Promise<void>((resolve) => (firstCall = resolve));
    const heldLstat = (async (path: string) => {
      calls += 1;
      if (calls === 1) {
        firstCall();
        await held;
      }
      return lstat(path);
    }) as typeof lstat;

    const survey = surveyLeftovers(deps({ staging, lstat: heldLstat }));
    await reached;
    expect(await deleteLeftovers(deps({ staging }))).toMatchObject({
      freedBytes: 5500,
      backupRunning: false,
    });
    for (const path of paths) expect(existsSync(path)).toBe(false);

    release();
    const result = await survey;
    expect(typeof result.bytes).toBe("number");
  });

  it("17. missing folders count as nothing", async () => {
    expect(await surveyLeftovers(deps())).toEqual({ bytes: 0, backupRunning: false });
    expect(await deleteLeftovers(deps())).toEqual({
      freedBytes: 0,
      deleted: 0,
      failed: 0,
      backupRunning: false,
    });
    expect(lines).toEqual([]);
  });

  it("18. a file that vanishes during the survey counts as gone", async () => {
    const vanished = join(logDir, "waitron.log.2");
    await file(vanished, 300);
    await file(join(logDir, "waitron.log.3"), 400);
    const vanishingLstat = (async (path: string) => {
      if (path === vanished) throw errnoError("ENOENT");
      return lstat(path);
    }) as typeof lstat;
    expect(await surveyLeftovers(deps({ lstat: vanishingLstat }))).toMatchObject({ bytes: 400 });

    const goneFolder: LeftoverDeps["readdir"] = async (path) => {
      if (path === logDir) throw errnoError("ENOENT");
      return readdir(path);
    };
    expect(await surveyLeftovers(deps({ readdir: goneFolder }))).toMatchObject({ bytes: 0 });
    expect(lines).toEqual([]);
  });

  it("19. a folder that cannot be listed is logged by the deletion, not by the survey", async () => {
    await file(join(logDir, "waitron.log.2"), 300);
    await file(join(stagingDir, "backup-encrypt-abc", "artifact"), 2000);
    const refusing: LeftoverDeps["readdir"] = async (path) => {
      if (path === logDir || path === join(stagingDir, "backup-encrypt-abc")) {
        throw errnoError("EACCES");
      }
      return readdir(path);
    };
    expect(await surveyLeftovers(deps({ readdir: refusing }))).toMatchObject({ bytes: 0 });
    expect(lines).toEqual([]);
    expect(await deleteLeftovers(deps({ readdir: refusing }))).toMatchObject({
      freedBytes: 0,
      deleted: 1,
      failed: 0,
    });
    const failure = {
      level: "warn",
      event: "storage.free_space_failed",
      fields: { errno: "EACCES" },
    };
    expect(lines).toEqual([failure, failure]);
    expect(existsSync(join(logDir, "waitron.log.2"))).toBe(true);
  });

  it("20. an encrypt folder's nested files are counted", async () => {
    await file(join(stagingDir, "backup-encrypt-abc", "part", "chunk"), 1200);
    await file(join(stagingDir, "backup-encrypt-abc", "artifact"), 800);
    expect((await surveyLeftovers(deps())).bytes).toBe(2000);
    expect(await deleteLeftovers(deps())).toMatchObject({ freedBytes: 2000, deleted: 1 });
  });
});
