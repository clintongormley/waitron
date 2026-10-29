import { mkdir, mkdtemp, realpath, rm, stat, truncate, writeFile } from "node:fs/promises";
import { lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backupArchiveKey } from "./backup-keys.js";
import type { DeletableArchive } from "./backup-room.js";
import type { BackupRuntimeStatus } from "./backup-supervisor.js";
import { createStagingTurn } from "./backup-staging-turn.js";
import type { Statfs } from "./free-bytes.js";
import { SPACE_LOW_BYTES, SPACE_OK_BYTES } from "./free-space-watch.js";
import type { Logger } from "./logger.js";
import { lowSpaceBackupDeletion, runningLocalBackends } from "./low-space-backups.js";

const GIB = 1024 ** 3;
const T = new Date("2026-10-01T12:00:00.000Z");
const NOW = new Date("2026-10-29T03:00:00.000Z");
const hours = (n: number) => new Date(T.getTime() + n * 3_600_000);

let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "low-space-backups-")));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const gone = (path: string) => !lstatSync(path, { throwIfNoEntry: false })?.isFile();

/** Real archive files in a backup folder, oldest first, each a sparse 1 GiB file, as the fake disk
 * counts it. */
async function fixture(count = 4) {
  const venue = join(root, "venue");
  const dir = join(root, "backups");
  await mkdir(venue, { recursive: true });
  await mkdir(dir, { recursive: true });
  const keys: string[] = [];
  for (let n = 1; n <= count; n += 1) {
    const key = backupArchiveKey(hours(n));
    await writeFile(join(dir, key), "");
    await truncate(join(dir, key), GIB);
    keys.push(key);
  }
  return { venue, dir, keys, paths: keys.map((k) => join(dir, k)) };
}

/** Free space that rises by 1 GiB for each tracked file gone from disk. */
function disk(tracked: readonly string[], startFree: number) {
  let reads = 0;
  const statfs: Statfs = async () => {
    reads += 1;
    const freed = tracked.filter(gone).length * GIB;
    return { bavail: startFree + freed, frsize: 1 };
  };
  return { statfs, reads: () => reads };
}

function deps(
  f: Awaited<ReturnType<typeof fixture>>,
  statfs: Statfs,
  over: Partial<Parameters<typeof lowSpaceBackupDeletion>[0]> = {},
) {
  const log = vi.fn<Logger>();
  const onArchivesDeleted = vi.fn<
    (deleted: readonly DeletableArchive[], at: Date) => Promise<void>
  >(async () => {});
  const installationStartedAt = vi.fn(async (): Promise<Date | null> => T);
  return {
    log,
    onArchivesDeleted,
    installationStartedAt,
    deps: {
      dir: f.venue,
      staging: createStagingTurn(),
      backends: () => [{ id: "local", localDir: f.dir }],
      installationStartedAt,
      onArchivesDeleted,
      now: () => NOW,
      log,
      statfs,
      ...over,
    },
  };
}

const signal = () => new AbortController().signal;
const deletedKeys = (spy: ReturnType<typeof deps>["onArchivesDeleted"]) =>
  spy.mock.calls.map(([deleted]) => deleted.map((a) => a.key));

describe("lowSpaceBackupDeletion", () => {
  it("under 2 GiB, deletes the oldest backups until 2.5 GiB is free, logs why, and reports once", async () => {
    const f = await fixture();
    const d = disk(f.paths, SPACE_LOW_BYTES - 1);
    const { deps: args, log, onArchivesDeleted } = deps(f, d.statfs);

    await lowSpaceBackupDeletion(args)(signal());

    // One deletion takes free space to 3 GiB - 1, past 2.5 GiB.
    expect(f.paths.map(gone)).toEqual([true, false, false, false]);
    expect(log.mock.calls).toEqual([
      [
        "info",
        "backup.archive_deleted",
        { destination: "local", key: f.keys[0], bytes: GIB, reason: "space_low" },
      ],
    ]);
    expect(onArchivesDeleted).toHaveBeenCalledTimes(1);
    expect(deletedKeys(onArchivesDeleted)).toEqual([[f.keys[0]]]);
    expect(onArchivesDeleted.mock.calls[0]![1]).toEqual(NOW);
  });

  it("keeps deleting, oldest first, until 2.5 GiB is reached", async () => {
    const f = await fixture();
    const d = disk(f.paths, SPACE_OK_BYTES - 2 * GIB - 1);
    const { deps: args, onArchivesDeleted } = deps(f, d.statfs);

    await lowSpaceBackupDeletion(args)(signal());

    expect(f.paths.map(gone)).toEqual([true, true, true, false]);
    expect(deletedKeys(onArchivesDeleted)).toEqual([[f.keys[0], f.keys[1], f.keys[2]]]);
  });

  it("at exactly 2 GiB deletes nothing and never reads the installation start", async () => {
    const f = await fixture();
    const d = disk(f.paths, SPACE_LOW_BYTES);
    const { deps: args, installationStartedAt, onArchivesDeleted } = deps(f, d.statfs);

    await lowSpaceBackupDeletion(args)(signal());

    expect(f.paths.some(gone)).toBe(false);
    expect(installationStartedAt).not.toHaveBeenCalled();
    expect(onArchivesDeleted).not.toHaveBeenCalled();
    expect(d.reads()).toBe(1);
  });

  it("deletes nothing while backups are not running", async () => {
    const f = await fixture();
    const d = disk(f.paths, GIB);
    const { deps: args } = deps(f, d.statfs, { backends: () => [] });

    await lowSpaceBackupDeletion(args)(signal());

    expect(f.paths.some(gone)).toBe(false);
  });

  it("deletes nothing on a box whose backups all go to a bucket", async () => {
    const f = await fixture();
    const d = disk(f.paths, GIB);
    const { deps: args } = deps(f, d.statfs, { backends: () => [{ id: "bucket" }] });

    await lowSpaceBackupDeletion(args)(signal());

    expect(f.paths.some(gone)).toBe(false);
  });

  it("deletes nothing while a backup run holds the staging turn, and deletes at the next call after it", async () => {
    const f = await fixture();
    const d = disk(f.paths, GIB);
    const staging = createStagingTurn();
    const { deps: args, onArchivesDeleted } = deps(f, d.statfs, { staging });
    const step = lowSpaceBackupDeletion(args);
    let release!: () => void;
    const run = staging.runBackup(() => new Promise<void>((resolve) => (release = resolve)));
    await vi.waitFor(() => expect(staging.backupRunning()).toBe(true));

    await step(signal());
    expect(f.paths.some(gone)).toBe(false);
    expect(onArchivesDeleted).not.toHaveBeenCalled();

    release();
    await run;
    await step(signal());
    expect(f.paths.map(gone)).toEqual([true, true, false, false]);
  });

  it("deletes nothing while a backup run waits for the staging turn", async () => {
    const f = await fixture();
    const d = disk(f.paths, GIB);
    const staging = createStagingTurn();
    const { deps: args } = deps(f, d.statfs, { staging });
    let release!: () => void;
    const holding = staging.ifNoBackup(() => new Promise<void>((resolve) => (release = resolve)));
    const run = staging.runBackup(async () => {});
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));

    await lowSpaceBackupDeletion(args)(signal());
    expect(f.paths.some(gone)).toBe(false);

    release();
    await Promise.all([holding, run]);
  });

  it("reads which folders backups run to once it holds the turn, so a change while it waited is followed", async () => {
    const f = await fixture();
    const d = disk(f.paths, GIB);
    const staging = createStagingTurn();
    let backends: { id: string; localDir?: string }[] = [{ id: "local", localDir: f.dir }];
    const { deps: args, installationStartedAt } = deps(f, d.statfs, {
      staging,
      backends: () => backends,
    });
    let release!: () => void;
    const holding = staging.ifNoBackup(() => new Promise<void>((resolve) => (release = resolve)));

    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const step = lowSpaceBackupDeletion(args)(signal());
    // Past its first reading, the step is queued behind the holder.
    await vi.waitFor(() => expect(d.reads()).toBe(1));
    await new Promise((resolve) => setImmediate(resolve));
    backends = [];
    release();
    await Promise.all([holding, step]);

    expect(f.paths.some(gone)).toBe(false);
    expect(installationStartedAt).not.toHaveBeenCalled();
  });

  it("does nothing once it holds the turn if it was stopped while it waited", async () => {
    const f = await fixture();
    const d = disk(f.paths, GIB);
    const staging = createStagingTurn();
    const { deps: args, installationStartedAt } = deps(f, d.statfs, { staging });
    let release!: () => void;
    const holding = staging.ifNoBackup(() => new Promise<void>((resolve) => (release = resolve)));
    const controller = new AbortController();

    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const step = lowSpaceBackupDeletion(args)(controller.signal);
    await vi.waitFor(() => expect(d.reads()).toBe(1));
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort(new Error("stopping"));
    release();
    await Promise.all([holding, step]);

    expect(f.paths.some(gone)).toBe(false);
    expect(installationStartedAt).not.toHaveBeenCalled();
  });

  it("deletes every backup it may when they cannot reach 2.5 GiB, keeping the newest, and throws nothing", async () => {
    // Two deletable 1 GiB backups on an empty disk: 2 GiB falls short of 2.5 GiB.
    const f = await fixture(3);
    const d = disk(f.paths, 0);
    const { deps: args, onArchivesDeleted } = deps(f, d.statfs);

    await lowSpaceBackupDeletion(args)(signal());

    expect(f.paths.map(gone)).toEqual([true, true, false]);
    expect(deletedKeys(onArchivesDeleted)).toEqual([[f.keys[0], f.keys[1]]]);
  });

  it("deletes nothing when the folder holds only its newest backup", async () => {
    const f = await fixture(1);
    const d = disk(f.paths, GIB);
    const { deps: args, onArchivesDeleted } = deps(f, d.statfs);

    await lowSpaceBackupDeletion(args)(signal());

    expect(f.paths.some(gone)).toBe(false);
    expect(onArchivesDeleted).not.toHaveBeenCalled();
  });

  it("deletes nothing when the installation start cannot be read, and logs why", async () => {
    const f = await fixture();
    const d = disk(f.paths, GIB);
    const failure = Object.assign(new Error("locked"), { code: "SQLITE_BUSY" });
    const { deps: args, log } = deps(f, d.statfs, {
      installationStartedAt: async () => {
        throw failure;
      },
    });

    await lowSpaceBackupDeletion(args)(signal());

    expect(f.paths.some(gone)).toBe(false);
    expect(log.mock.calls.map(([, event]) => event)).toEqual([
      "backup.installation_start_unreadable",
    ]);
  });

  it("deletes nothing when the installation start is unknown", async () => {
    const f = await fixture();
    const d = disk(f.paths, GIB);
    const { deps: args } = deps(f, d.statfs, { installationStartedAt: async () => null });

    await lowSpaceBackupDeletion(args)(signal());

    expect(f.paths.some(gone)).toBe(false);
  });

  it("deletes nothing in a backup folder on another disk than the venue folder", async () => {
    const f = await fixture();
    const d = disk(f.paths, GIB);
    const { deps: args } = deps(f, d.statfs, {
      deviceOf: async (path: string) => (path === f.dir ? -1 : (await stat(path)).dev),
    });

    await lowSpaceBackupDeletion(args)(signal());

    expect(f.paths.some(gone)).toBe(false);
  });

  it("logs a report that fails and still resolves", async () => {
    const f = await fixture();
    const d = disk(f.paths, GIB);
    const { deps: args, log } = deps(f, d.statfs, {
      onArchivesDeleted: async () => {
        throw new Error("database busy");
      },
    });

    await expect(lowSpaceBackupDeletion(args)(signal())).resolves.toBeUndefined();

    expect(f.paths.map(gone)).toEqual([true, true, false, false]);
    expect(log.mock.calls.at(-1)?.[1]).toBe("backup.archives_deleted_alert_failed");
  });

  it("deletes nothing when free space cannot be read", async () => {
    const f = await fixture();
    const { deps: args, installationStartedAt } = deps(f, async () => {
      throw Object.assign(new Error("gone"), { code: "ENOENT" });
    });

    await lowSpaceBackupDeletion(args)(signal());

    expect(f.paths.some(gone)).toBe(false);
    expect(installationStartedAt).not.toHaveBeenCalled();
  });

  it("stops deleting once its signal is aborted, and rejects with the abort", async () => {
    const f = await fixture();
    const controller = new AbortController();
    let reads = 0;
    const statfs: Statfs = async () => {
      reads += 1;
      // The reading after the first deletion aborts, so the second is never made.
      if (reads === 3) controller.abort(new Error("stopping"));
      return { bavail: f.paths.filter(gone).length * GIB, frsize: 1 };
    };
    const { deps: args, onArchivesDeleted } = deps(f, statfs);

    await expect(lowSpaceBackupDeletion(args)(controller.signal)).rejects.toThrow("stopping");

    expect(f.paths.map(gone)).toEqual([true, false, false, false]);
    expect(deletedKeys(onArchivesDeleted)).toEqual([[f.keys[0]]]);
  });
});

describe("runningLocalBackends", () => {
  const status = (enabled: boolean): Pick<BackupRuntimeStatus, "enabled" | "destinations"> => ({
    enabled,
    destinations: [
      { id: "folder", kind: "local-fs", dir: "/backups" },
      {
        id: "bucket",
        kind: "s3",
        endpoint: null,
        region: "eu-west-1",
        bucket: "b",
        prefix: "p",
        accessKeyId: "AKIA",
        namespace: "p/venue",
        credentialPresent: true,
      },
    ],
  });

  it("names the local folders while backups run", () => {
    expect(runningLocalBackends(status(true))).toEqual([{ id: "folder", localDir: "/backups" }]);
  });

  it("names none while backups do not run", () => {
    expect(runningLocalBackends(status(false))).toEqual([]);
  });
});
