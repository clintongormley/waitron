import { existsSync } from "node:fs";
import {
  lstat,
  lutimes,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupArchiveKey } from "./backup-keys.js";
import { createStagingTurn } from "./backup-staging-turn.js";
import {
  createSpaceFreer,
  deleteLeftovers,
  surveyLeftovers,
  type LeftoverDeps,
} from "./free-space-now.js";
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

async function present(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function expectAllPresent(paths: string[]): Promise<void> {
  const missing: string[] = [];
  for (const path of paths) if (!(await present(path))) missing.push(path);
  expect(missing).toEqual([]);
}

const NOTHING = { freedBytes: 0, deleted: 0, failed: 0, backupRunning: false };

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

  it("18. a file or folder that vanishes during a walk counts as gone, silently", async () => {
    const vanished = join(logDir, "waitron.log.2");
    await file(vanished, 300);
    await file(join(logDir, "waitron.log.3"), 400);
    const vanishingLstat = (async (path: string) => {
      if (path === vanished) throw errnoError("ENOENT");
      return lstat(path);
    }) as typeof lstat;
    const goneFolder: LeftoverDeps["readdir"] = async (path) => {
      if (path === logDir) throw errnoError("ENOENT");
      return readdir(path);
    };
    expect(await surveyLeftovers(deps({ lstat: vanishingLstat }))).toMatchObject({ bytes: 400 });
    expect(await surveyLeftovers(deps({ readdir: goneFolder }))).toMatchObject({ bytes: 0 });

    expect(await deleteLeftovers(deps({ readdir: goneFolder }))).toEqual(NOTHING);
    expect(await deleteLeftovers(deps({ lstat: vanishingLstat }))).toEqual({
      ...NOTHING,
      freedBytes: 400,
      deleted: 1,
    });
    expect(lines).toEqual([]);
    expect(existsSync(vanished)).toBe(true);
  });

  it("19. a folder that cannot be listed is logged by the deletion, not by the survey", async () => {
    await file(join(logDir, "waitron.log.2"), 300);
    const encrypt = join(stagingDir, "backup-encrypt-abc");
    await file(join(encrypt, "artifact"), 2000);
    const refusing: LeftoverDeps["readdir"] = async (path) => {
      if (path === logDir || path === encrypt) throw errnoError("EACCES");
      return readdir(path);
    };
    // A folder that refuses its listing refuses `rm -r` too.
    const remove: LeftoverDeps["remove"] = async (path, options) => {
      if (path === encrypt) throw errnoError("EACCES");
      await rm(path, options);
    };
    expect(await surveyLeftovers(deps({ readdir: refusing }))).toMatchObject({ bytes: 0 });
    expect(lines).toEqual([]);
    expect(await deleteLeftovers(deps({ readdir: refusing, remove }))).toEqual({
      ...NOTHING,
      failed: 1,
    });
    const failure = {
      level: "warn",
      event: "storage.free_space_failed",
      fields: { errno: "EACCES" },
    };
    expect(lines).toEqual([failure, failure, failure]);
    expect(existsSync(join(logDir, "waitron.log.2"))).toBe(true);
    expect(existsSync(join(encrypt, "artifact"))).toBe(true);
  });

  it("20. an encrypt folder's nested files are counted", async () => {
    await file(join(stagingDir, "backup-encrypt-abc", "part", "chunk"), 1200);
    await file(join(stagingDir, "backup-encrypt-abc", "artifact"), 800);
    expect((await surveyLeftovers(deps())).bytes).toBe(2000);
    expect(await deleteLeftovers(deps())).toMatchObject({ freedBytes: 2000, deleted: 1 });
  });

  it("21. an encrypt folder is sized by its regular files alone", async () => {
    const encrypt = join(stagingDir, "backup-encrypt-abc");
    const venueDb = join(stateDir, "venue", "venue.db");
    await file(venueDb, 5000);
    await file(join(encrypt, "artifact"), 800);
    const gone = join(encrypt, "gone");
    await file(gone, 900);
    await symlink(join(stateDir, "venue"), join(encrypt, "to-venue"));
    await symlink(venueDb, join(encrypt, "to-db"));
    await symlink(stagingDir, join(encrypt, "to-parent"));
    const vanishingLstat = (async (path: string) => {
      if (path === gone) throw errnoError("ENOENT");
      return lstat(path);
    }) as typeof lstat;
    expect((await surveyLeftovers(deps({ lstat: vanishingLstat }))).bytes).toBe(800);
    expect(await deleteLeftovers(deps({ lstat: vanishingLstat }))).toEqual({
      ...NOTHING,
      freedBytes: 800,
      deleted: 1,
    });
    expect(existsSync(encrypt)).toBe(false);
    expect((await readFile(venueDb)).length).toBe(5000);
    expect(lines).toEqual([]);
  });

  it("22. a staging entry that vanishes is skipped, silently", async () => {
    const vanished = join(stagingDir, DUMP);
    await file(vanished, 3000);
    await file(join(stagingDir, `${DUMP}.partial`), 500);
    const vanishingLstat = (async (path: string) => {
      if (path === vanished) throw errnoError("ENOENT");
      return lstat(path);
    }) as typeof lstat;
    expect((await surveyLeftovers(deps({ lstat: vanishingLstat }))).bytes).toBe(500);
    expect(await deleteLeftovers(deps({ lstat: vanishingLstat }))).toEqual({
      ...NOTHING,
      freedBytes: 500,
      deleted: 1,
    });
    expect(lines).toEqual([]);
  });

  it("23. a refusal with no error code is logged with a null errno", async () => {
    await file(join(logDir, "waitron.log.2"), 300);
    const remove: LeftoverDeps["remove"] = async () => {
      throw new Error("refused");
    };
    expect(await deleteLeftovers(deps({ remove }))).toEqual({ ...NOTHING, failed: 1 });
    expect(lines).toEqual([
      { level: "warn", event: "storage.free_space_failed", fields: { errno: null } },
    ]);
  });

  it("24. deletes staging first, then logs highest first, then crash reports oldest first", async () => {
    const dump = join(stagingDir, DUMP);
    await file(dump, 10);
    for (const n of [3, 2, 5]) await file(join(logDir, `waitron.log.${n}`), 10);
    const crashDir = join(logDir, "crash-reports");
    await file(join(crashDir, "holder-frozen-newer.json"), 10, 8 * DAY_MS);
    await file(join(crashDir, "holder-frozen-older.json"), 10, 9 * DAY_MS);
    await file(join(crashDir, "holder-frozen-oldest.json"), 10, 10 * DAY_MS);
    const order: string[] = [];
    const remove: LeftoverDeps["remove"] = async (path, options) => {
      order.push(path);
      await rm(path, options);
    };
    await deleteLeftovers(deps({ remove }));
    expect(order).toEqual([
      dump,
      join(logDir, "waitron.log.5"),
      join(logDir, "waitron.log.3"),
      join(logDir, "waitron.log.2"),
      join(crashDir, "holder-frozen-oldest.json"),
      join(crashDir, "holder-frozen-older.json"),
      join(crashDir, "holder-frozen-newer.json"),
    ]);
  });
});

describe("what the deletion must never delete", () => {
  const venueDir = () => join(stateDir, "venue");

  it("5. the state folder survives", async () => {
    const paths = [
      "recovery.lock",
      "recovery.json",
      "secrets.env",
      "modules.json",
      join("stream", "litestream.yml"),
      join("tls", "ca.crt"),
      join("cloud-snapshots", "staging", "venue.db"),
      join("restore-staging", DUMP),
      DUMP,
    ].map((name) => join(stateDir, name));
    for (const path of paths) await file(path, 100);
    expect(await surveyLeftovers(deps())).toEqual({ bytes: 0, backupRunning: false });
    expect(await deleteLeftovers(deps())).toEqual(NOTHING);
    await expectAllPresent(paths);
  });

  it("6. look-alike names survive", async () => {
    const paths = [
      join(stagingDir, "archive-validate-x", "artifact"),
      join(stagingDir, "restore-admission-x", "artifact"),
      join(stagingDir, `${DUMP}.bak`),
      join(stagingDir, "other.dump"),
      join(stagingDir, "notes.txt"),
      join(logDir, "waitron.log.0"),
      join(logDir, "waitron.log.1"),
      join(logDir, "waitron.log.x"),
      join(logDir, "other.log.3"),
    ];
    for (const path of paths) await file(path, 100);
    const otherReport = join(logDir, "crash-reports", "other.json");
    await file(otherReport, 100, 8 * DAY_MS);
    expect(await surveyLeftovers(deps())).toEqual({ bytes: 0, backupRunning: false });
    expect(await deleteLeftovers(deps())).toEqual(NOTHING);
    await expectAllPresent([...paths, otherReport]);
  });

  it("7. a link is never followed, whatever its name", async () => {
    const venueDb = join(venueDir(), "venue.db");
    await file(venueDb, 5000);
    const links = [
      join(stagingDir, "backup-encrypt-link"),
      join(stagingDir, DUMP),
      join(logDir, "waitron.log.3"),
      join(logDir, "crash-reports", "holder-frozen-a.json"),
    ];
    for (const link of links) await mkdir(dirname(link), { recursive: true });
    await symlink(venueDir(), links[0]!);
    for (const link of links.slice(1)) await symlink(venueDb, link);
    // `utimes` would age the target, and a new-looking link would be kept by age alone.
    const aged = new Date(NOW.getTime() - 8 * DAY_MS);
    await lutimes(links[3]!, aged, aged);

    expect(await surveyLeftovers(deps())).toEqual({ bytes: 0, backupRunning: false });
    expect(await deleteLeftovers(deps())).toEqual(NOTHING);
    await expectAllPresent(links);
    expect((await readFile(venueDb)).length).toBe(5000);
  });

  describe("8. a folder that is a link is skipped and logged", () => {
    it("backup staging", async () => {
      await file(join(venueDir(), DUMP), 100);
      await symlink(venueDir(), stagingDir);
      expect((await surveyLeftovers(deps())).bytes).toBe(0);
      expect(lines).toEqual([]);
      expect(await deleteLeftovers(deps())).toEqual(NOTHING);
      expect(lines).toEqual([
        {
          level: "warn",
          event: "storage.free_space_skipped",
          fields: { folder: "backup-staging" },
        },
      ]);
      await expectAllPresent([join(venueDir(), DUMP)]);
    });

    it("the log folder", async () => {
      await file(join(venueDir(), "waitron.log.4"), 100);
      await symlink(venueDir(), logDir);
      expect((await surveyLeftovers(deps())).bytes).toBe(0);
      expect(lines).toEqual([]);
      expect(await deleteLeftovers(deps())).toEqual(NOTHING);
      expect(lines).toEqual([
        { level: "warn", event: "storage.free_space_skipped", fields: { folder: "logs" } },
      ]);
      await expectAllPresent([join(venueDir(), "waitron.log.4")]);
    });

    it("the log folder, configured with a trailing separator", async () => {
      await file(join(venueDir(), "waitron.log.4"), 100);
      await symlink(venueDir(), logDir);
      const trailing = deps({ logDir: logDir + sep });
      expect((await surveyLeftovers(trailing)).bytes).toBe(0);
      expect(await deleteLeftovers(trailing)).toEqual(NOTHING);
      expect(lines).toEqual([
        { level: "warn", event: "storage.free_space_skipped", fields: { folder: "logs" } },
      ]);
      await expectAllPresent([join(venueDir(), "waitron.log.4")]);
    });

    it("the crash-report folder", async () => {
      const report = join(venueDir(), "holder-frozen-b.json");
      await file(report, 100, 8 * DAY_MS);
      await mkdir(logDir, { recursive: true });
      await symlink(venueDir(), join(logDir, "crash-reports"));
      expect((await surveyLeftovers(deps())).bytes).toBe(0);
      expect(lines).toEqual([]);
      expect(await deleteLeftovers(deps())).toEqual(NOTHING);
      expect(lines).toEqual([
        { level: "warn", event: "storage.free_space_skipped", fields: { folder: "crash-reports" } },
      ]);
      await expectAllPresent([report]);
    });
  });

  // The venue's and state folder's own files are reachable only when the log folder is one of
  // them; each is aged past the crash-report cutoff so no age check can keep it by accident.
  it("4 and 9. a log folder that is the venue or state folder loses only its rotated logs", async () => {
    const venueFiles = [
      "venue.db",
      "venue.db-wal",
      "venue.db-shm",
      "node.db",
      "venue.lock",
      join(".venue.db-litestream", "generations", "x"),
    ];
    const stateFiles = [
      "recovery.lock",
      "recovery.json",
      "secrets.env",
      "modules.json",
      join("stream", "litestream.yml"),
      join("tls", "ca.crt"),
      join("restore-staging", DUMP),
      DUMP,
    ];
    for (const [dir, kept] of [
      [venueDir(), venueFiles],
      [stateDir, stateFiles],
    ] as const) {
      const paths = kept.map((name) => join(dir, name));
      for (const path of paths) await file(path, 100, 8 * DAY_MS);
      await file(join(dir, "waitron.log.2"), 300);
      expect((await surveyLeftovers(deps({ logDir: dir }))).bytes).toBe(300);
      expect(await deleteLeftovers(deps({ logDir: dir }))).toEqual({
        ...NOTHING,
        freedBytes: 300,
        deleted: 1,
      });
      await expectAllPresent(paths);
      expect(await present(join(dir, "waitron.log.2"))).toBe(false);
    }
  });

  it("14. a configured backup folder's archive survives in the log folder or staging", async () => {
    const archive = backupArchiveKey(
      new Date("2026-10-20T00:00:00Z"),
      "8c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
    );
    const paths = [join(logDir, archive), join(stagingDir, archive)];
    for (const path of paths) await file(path, 100);
    expect(await surveyLeftovers(deps())).toEqual({ bytes: 0, backupRunning: false });
    expect(await deleteLeftovers(deps())).toEqual(NOTHING);
    await expectAllPresent(paths);
  });
});

describe("createSpaceFreer", () => {
  const FREE = 4096 * 1000;
  const statfs = async () => ({ bavail: 1000, frsize: 4096 });

  function freer(
    options: {
      noted?: boolean;
      statfs?: () => Promise<{ bavail: number; frsize: number }>;
      remove?: LeftoverDeps["remove"];
    } = {},
  ) {
    const order: string[] = [];
    const records: { free: number | null; at: Date }[] = [];
    let fullCalls = 0;
    let freedCalls = 0;
    const remove: LeftoverDeps["remove"] = async (path, opts) => {
      order.push("remove");
      await (options.remove ?? ((p, o) => rm(p, o)))(path, opts);
    };
    const free = createSpaceFreer({
      ...deps({ remove }),
      venueDir: join(stateDir, "venue"),
      space: {
        record(value, at) {
          order.push("record");
          records.push({ free: value, at });
        },
      },
      disk: {
        noted: () => options.noted ?? false,
        async full() {
          order.push("full");
          fullCalls += 1;
          return false;
        },
      },
      statfs: options.statfs ?? statfs,
      onFreed() {
        order.push("freed");
        freedCalls += 1;
      },
    });
    return {
      free,
      order,
      records,
      fullCalls: () => fullCalls,
      freedCalls: () => freedCalls,
    };
  }

  it("deletes, records the fresh reading and answers both", async () => {
    await stagingFiles();
    const f = freer();
    expect(await f.free("person-1")).toEqual({
      freedBytes: 5500,
      deleted: 3,
      failed: 0,
      backupRunning: false,
      freeBytes: FREE,
    });
    expect(f.records).toEqual([{ free: FREE, at: NOW }]);
  });

  it("asks a noted stop to re-check once, after the deletion; an unnoted one never", async () => {
    await stagingFiles();
    const noted = freer({ noted: true });
    await noted.free("person-1");
    expect(noted.fullCalls()).toBe(1);
    expect(noted.order.filter((step) => step !== "remove")).toEqual(["record", "full", "freed"]);
    expect(noted.order.lastIndexOf("remove")).toBeLessThan(noted.order.indexOf("full"));

    await stagingFiles();
    const quiet = freer({ noted: false });
    await quiet.free("person-1");
    expect(quiet.fullCalls()).toBe(0);
  });

  it("two calls during one deletion share it; a later call runs a new one", async () => {
    await stagingFiles();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let removes = 0;
    const f = freer({
      remove: async (path, opts) => {
        removes += 1;
        await held;
        await rm(path, opts);
      },
    });
    const first = f.free("person-1");
    const second = f.free("person-2");
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(b).toBe(a);
    expect(removes).toBe(3);
    expect(f.freedCalls()).toBe(1);

    await file(join(stagingDir, DUMP), 10);
    const c = await f.free("person-3");
    expect(c).not.toBe(a);
    expect(c.freedBytes).toBe(10);
    expect(removes).toBe(4);
    expect(f.freedCalls()).toBe(2);
  });

  it("logs one storage.space_freed line naming the first caller", async () => {
    await stagingFiles();
    const f = freer();
    await Promise.all([f.free("person-1"), f.free("person-2")]);
    expect(lines.filter((line) => line.event === "storage.space_freed")).toEqual([
      {
        level: "info",
        event: "storage.space_freed",
        fields: {
          freedBytes: 5500,
          deleted: 3,
          failed: 0,
          backupRunning: false,
          personId: "person-1",
        },
      },
    ]);
  });

  it("an unreadable reading answers null, is recorded, and a noted stop still re-checks", async () => {
    await stagingFiles();
    const f = freer({
      noted: true,
      statfs: async () => {
        throw errnoError("EIO");
      },
    });
    expect((await f.free("person-1")).freeBytes).toBeNull();
    expect(f.records).toEqual([{ free: null, at: NOW }]);
    expect(f.fullCalls()).toBe(1);
  });

  it("calls onFreed once per deletion, after it settles", async () => {
    await stagingFiles();
    const f = freer();
    const pending = f.free("person-1");
    expect(f.freedCalls()).toBe(0);
    await pending;
    expect(f.freedCalls()).toBe(1);
    expect(f.order.at(-1)).toBe("freed");
    await f.free("person-1");
    expect(f.freedCalls()).toBe(2);
  });

  it("works without onFreed and with the real statfs", async () => {
    const records: (number | null)[] = [];
    const free = createSpaceFreer({
      ...deps(),
      venueDir: join(stateDir, "venue"),
      space: { record: (value) => records.push(value) },
      disk: { noted: () => false, full: async () => false },
    });
    const answer = await free("person-1");
    expect(answer).toEqual({ ...NOTHING, freeBytes: records[0] });
    expect(typeof records[0]).toBe("number");
  });
});
