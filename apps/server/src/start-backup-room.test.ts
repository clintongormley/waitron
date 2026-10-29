import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VenueHolder, VenueLock } from "@waitron/db";
import { BACKUP_ROOM_NOTE_FILE, BACKUP_ROOM_START_DELETED_FILE } from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FULL_DISK_BYTES } from "./boot-failure.js";
import { backupArchiveKey } from "./backup-keys.js";
import type { DeletableArchive } from "./backup-room.js";
import { writeBackupRoomNote } from "./backup-room-note.js";
import { RESET_REQUEST_FILE } from "./reset-request.js";
import { RESTORE_REQUEST_FILE } from "./restore-request.js";
import { deleteOldBackupsAtStart, type StartBackupRoomDeps } from "./start-backup-room.js";

vi.mock("node:fs/promises", { spy: true });

const MIB = 1024 * 1024;
const SPARE = 8 * MIB;
const KEY = "a recovery key long enough";
const STARTED = new Date("2026-10-01T09:00:00.000Z");
const NOW = new Date("2026-10-29T12:00:00.000Z");
const days = (n: number) => new Date(STARTED.getTime() + n * 86_400_000);

let root: string;
let stateDir: string;
let venueDir: string;
let usb: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "start-backup-room-")));
  stateDir = join(root, "state");
  venueDir = join(root, "venue");
  usb = join(root, "usb");
  await mkdir(stateDir);
  await mkdir(venueDir);
  await mkdir(usb);
  await writeFile(join(venueDir, "venue.db"), "installation");
});
afterEach(() => rm(root, { recursive: true, force: true }));

/** A sparse archive, so its listed size costs no disk. */
async function archive(dir: string, at: Date, mib: number): Promise<string> {
  const key = backupArchiveKey(at);
  await writeFile(join(dir, key), "");
  await truncate(join(dir, key), mib * MIB);
  return key;
}

async function note(
  over: { managedByEnvironment?: boolean; folders?: { destination: string; dir: string }[] } = {},
) {
  await writeBackupRoomNote({
    stateDir,
    venueDir,
    nodeId: "node-1",
    installationStartedAt: STARTED,
    managedByEnvironment: over.managedByEnvironment ?? false,
    folders: over.folders ?? [{ destination: "usb", dir: usb }],
    now: () => NOW,
    log: () => undefined,
  });
  expect(existsSync(join(stateDir, BACKUP_ROOM_NOTE_FILE))).toBe(true);
}

async function sizeOf(dir: string): Promise<number> {
  let total = 0;
  for (const name of await readdir(dir)) total += (await lstat(join(dir, name))).size;
  return total;
}

/** Free space that grows by what leaves the folders, as a real disk would. */
function disk(freeAtStart: number | Error, folders: string[] = [usb]) {
  let initial: number | null = null;
  const used = async () => {
    let total = 0;
    for (const dir of folders) total += await sizeOf(dir);
    return total;
  };
  return vi.fn(async () => {
    if (freeAtStart instanceof Error) throw freeAtStart;
    const now = await used();
    initial ??= now;
    return { bavail: freeAtStart + (initial - now), frsize: 1 };
  });
}

const dashboardEnv = { WAITRON_TILL_NODE_ID: "node-1", WAITRON_BACKUP_RECOVERY_KEY: KEY };

function setup(over: Partial<StartBackupRoomDeps> = {}) {
  const log = vi.fn();
  const release = vi.fn();
  const lockVenue = vi.fn(async (): Promise<VenueLock> => ({ release }));
  const loadBoxEnv = vi.fn(async (base: NodeJS.ProcessEnv) => ({ ...base, ...dashboardEnv }));
  const deps: StartBackupRoomDeps = {
    stateDir,
    venueDir,
    baseEnv: {},
    loadBoxEnv,
    spareBytes: SPARE,
    floor: 256 * MIB,
    statfs: disk(10 * MIB),
    lockVenue,
    readVenueHolder: () => null,
    now: () => NOW,
    log,
    ...over,
  };
  return { deps, log, release, lockVenue, loadBoxEnv };
}

const codes = (log: ReturnType<typeof vi.fn>) => log.mock.calls.map((call) => call[1] as string);
const skipped = (log: ReturnType<typeof vi.fn>) =>
  log.mock.calls.filter((call) => call[1] === "backup.start_room_skipped").map((call) => call[2]);

type VenueDb = { dev: string; ino: string; birthtimeNs: string };

async function readRecord(): Promise<{ at: Date; venueDb: VenueDb; deleted: DeletableArchive[] }> {
  const raw = JSON.parse(
    await readFile(join(stateDir, BACKUP_ROOM_START_DELETED_FILE), "utf8"),
  ) as {
    at: string;
    venueDb: VenueDb;
    deleted: (Omit<DeletableArchive, "takenAt"> & { takenAt: string })[];
  };
  return {
    at: new Date(raw.at),
    venueDb: raw.venueDb,
    deleted: raw.deleted.map((a) => ({ ...a, takenAt: new Date(a.takenAt) })),
  };
}

/** venue.db's identity as the note holds it. */
async function venueDbNow(): Promise<VenueDb> {
  const info = await lstat(join(venueDir, "venue.db"), { bigint: true });
  return {
    dev: info.dev.toString(),
    ino: info.ino.toString(),
    birthtimeNs: info.birthtimeNs.toString(),
  };
}

/** A record an earlier start left, as the step writes one. */
async function earlierRecord(at: Date, venueDb: VenueDb, deleted: DeletableArchive[]) {
  await writeFile(
    join(stateDir, BACKUP_ROOM_START_DELETED_FILE),
    JSON.stringify({
      version: 1,
      at: at.toISOString(),
      venueDb,
      deleted: deleted.map((a) => ({ ...a, takenAt: a.takenAt.toISOString() })),
    }),
  );
}

describe("deleteOldBackupsAtStart", () => {
  it("deletes the oldest backups until the floor is free, logs each and writes the record", async () => {
    await note();
    const oldest = await archive(usb, days(1), 15);
    const second = await archive(usb, days(2), 15);
    const newest = await archive(usb, days(3), 15);
    const { deps, log, release } = setup();

    await deleteOldBackupsAtStart(deps);

    // 10 MiB free, the floor 8 + 16 MiB: one 15 MiB archive reaches it, and the aim is out of reach.
    expect(await readdir(usb)).toEqual([second, newest].sort());
    expect(log).toHaveBeenCalledWith("info", "backup.archive_deleted", {
      destination: "usb",
      key: oldest,
      bytes: 15 * MIB,
      reason: "start_room",
    });
    expect(await readRecord()).toEqual({
      at: NOW,
      venueDb: await venueDbNow(),
      deleted: [{ destination: "usb", dir: usb, key: oldest, bytes: 15 * MIB, takenAt: days(1) }],
    });
    expect(skipped(log)).toEqual([]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("deletes on a dashboard box whose recovery key is only in backup.env: management is judged on the raw environment", async () => {
    await note({ managedByEnvironment: false });
    await archive(usb, days(1), 15);
    await archive(usb, days(2), 15);
    // The raw environment sets no backup variable; the key arrives only through the loaded env.
    const { deps, log, loadBoxEnv } = setup({ baseEnv: { PATH: "/usr/bin" } });

    await deleteOldBackupsAtStart(deps);

    expect(loadBoxEnv).toHaveBeenCalledWith({ PATH: "/usr/bin" }, stateDir);
    expect(codes(log)).toContain("backup.archive_deleted");
    expect((await readdir(usb)).length).toBe(1);
  });

  it("never deletes a backup taken before or exactly at the installation start, nor the newest", async () => {
    await note();
    const before = await archive(usb, days(-1), 10);
    const at = await archive(usb, STARTED, 10);
    await archive(usb, days(1), 13);
    await archive(usb, days(2), 13);
    const newest = await archive(usb, days(3), 15);
    // Nothing free, the aim at the floor (24 MiB): only the two taken after the start may go.
    const { deps } = setup({ statfs: disk(0), floor: 0 });

    await deleteOldBackupsAtStart(deps);

    expect(await readdir(usb)).toEqual([before, at, newest].sort());
  });

  it("on an environment-managed box deletes only in the environment's own local folders, never a bucket", async () => {
    const envFolder = join(root, "env-backups");
    await mkdir(envFolder);
    await note({ managedByEnvironment: true, folders: [{ destination: "usb", dir: usb }] });
    await archive(usb, days(1), 15);
    await archive(usb, days(2), 15);
    const envOldest = await archive(envFolder, days(1), 15);
    const envNewest = await archive(envFolder, days(2), 15);
    const baseEnv = {
      WAITRON_BACKUP_DIR: envFolder,
      WAITRON_BACKUP_RECOVERY_KEY: KEY,
      WAITRON_BACKUP_DESTINATIONS: JSON.stringify([
        {
          kind: "s3",
          id: "cloud",
          endpoint: "https://s3.example.invalid",
          region: "eu-west-1",
          bucket: "backups",
          prefix: "box",
          accessKeyId: "id",
          secretAccessKey: "secret",
        },
      ]),
    };
    const { deps, log } = setup({
      baseEnv,
      loadBoxEnv: async (base) => ({
        ...base,
        WAITRON_TILL_NODE_ID: "node-1",
        WAITRON_TILL_LOCATION_ID: "venue-1",
      }),
      statfs: disk(10 * MIB, [usb, envFolder]),
    });

    await deleteOldBackupsAtStart(deps);

    expect(await readdir(envFolder)).toEqual([envNewest]);
    expect((await readdir(usb)).length).toBe(2);
    expect(log).toHaveBeenCalledWith("info", "backup.archive_deleted", {
      destination: "primary",
      key: envOldest,
      bytes: 15 * MIB,
      reason: "start_room",
    });
  });

  it("does nothing at or above the full-disk line, without reading the note, the env or the lock", async () => {
    await note();
    await archive(usb, days(1), 15);
    await archive(usb, days(2), 15);
    const { deps, log, lockVenue, loadBoxEnv } = setup({ statfs: disk(FULL_DISK_BYTES) });

    await deleteOldBackupsAtStart(deps);

    expect((await readdir(usb)).length).toBe(2);
    expect(lockVenue).not.toHaveBeenCalled();
    expect(loadBoxEnv).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("does nothing when free space cannot be read", async () => {
    await note();
    await archive(usb, days(1), 15);
    await archive(usb, days(2), 15);
    const { deps, lockVenue } = setup({ statfs: disk(new Error("EIO")) });

    await deleteOldBackupsAtStart(deps);

    expect((await readdir(usb)).length).toBe(2);
    expect(lockVenue).not.toHaveBeenCalled();
  });

  it("with no note returns without taking the lock or loading the env", async () => {
    await archive(usb, days(1), 15);
    await archive(usb, days(2), 15);
    const { deps, log, lockVenue, loadBoxEnv } = setup();

    await deleteOldBackupsAtStart(deps);

    expect(lockVenue).not.toHaveBeenCalled();
    expect(loadBoxEnv).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect((await readdir(usb)).length).toBe(2);
  });

  describe("deletes nothing and logs why", () => {
    async function expectSkip(
      reason: string,
      over: Partial<StartBackupRoomDeps> = {},
      arrange: () => Promise<void> = async () => undefined,
    ) {
      await note();
      await archive(usb, days(1), 15);
      await archive(usb, days(2), 15);
      await arrange();
      const { deps, log, release, lockVenue } = setup(over);

      await expect(deleteOldBackupsAtStart(deps)).resolves.toBeUndefined();

      expect((await readdir(usb)).length).toBe(2);
      expect(skipped(log)).toEqual([{ reason }]);
      expect(codes(log)).not.toContain("backup.archive_deleted");
      expect(existsSync(join(stateDir, BACKUP_ROOM_START_DELETED_FILE))).toBe(false);
      if (lockVenue.mock.calls.length > 0) expect(release).toHaveBeenCalledOnce();
    }

    it("the note does not parse", () =>
      expectSkip("malformed", {}, () => writeFile(join(stateDir, BACKUP_ROOM_NOTE_FILE), "{")));

    it("the note names another node", () =>
      expectSkip("node_mismatch", {
        loadBoxEnv: async () => ({ ...dashboardEnv, WAITRON_TILL_NODE_ID: "node-2" }),
      }));

    it("the box env names no node", () =>
      expectSkip("node_mismatch", {
        loadBoxEnv: async () => ({ ...dashboardEnv, WAITRON_TILL_NODE_ID: "" }),
      }));

    it("venue.db was replaced after the note was written", () =>
      expectSkip("identity_mismatch", {}, async () => {
        await writeFile(join(venueDir, "venue.db.new"), "restored");
        await rename(join(venueDir, "venue.db.new"), join(venueDir, "venue.db"));
      }));

    it("the box env sets no node id", () =>
      expectSkip("node_mismatch", {
        loadBoxEnv: async () => ({ WAITRON_BACKUP_RECOVERY_KEY: KEY }),
      }));

    it("the venue folder is gone, which taking the lock would create", async () => {
      await note();
      await rm(venueDir, { recursive: true });
      const { deps, log, lockVenue } = setup();
      await deleteOldBackupsAtStart(deps);
      expect(skipped(log)).toEqual([{ reason: "venue_db_missing" }]);
      expect(lockVenue).not.toHaveBeenCalled();
      expect(existsSync(venueDir)).toBe(false);
    });

    it("venue.db is gone", () =>
      expectSkip("venue_db_missing", {}, () => rm(join(venueDir, "venue.db"))));

    it("a staged restore is waiting", () =>
      expectSkip("restore_waiting", {}, () =>
        writeFile(join(stateDir, RESTORE_REQUEST_FILE), "{}"),
      ));

    it("a staged reset is waiting", () =>
      expectSkip("reset_waiting", {}, () => writeFile(join(stateDir, RESET_REQUEST_FILE), "{}")));

    it("the recovery key is missing", () =>
      expectSkip("recovery_key_missing", {
        loadBoxEnv: async () => ({ WAITRON_TILL_NODE_ID: "node-1" }),
      }));

    it("the recovery key cannot be used", () =>
      expectSkip("recovery_key_unusable", {
        loadBoxEnv: async () => ({
          WAITRON_TILL_NODE_ID: "node-1",
          WAITRON_BACKUP_RECOVERY_KEY: "short",
        }),
      }));

    it("the environment manages backups now but the note says the dashboard did", () =>
      expectSkip("management_changed", {
        baseEnv: { WAITRON_BACKUP_DIR: usb, WAITRON_BACKUP_RECOVERY_KEY: KEY },
      }));

    it("the dashboard manages backups now but the note says the environment did", async () => {
      await note({ managedByEnvironment: true });
      const { deps, log } = setup();
      await deleteOldBackupsAtStart(deps);
      expect(skipped(log)).toEqual([{ reason: "management_changed" }]);
    });

    it("the environment's destinations do not parse", async () => {
      await note({ managedByEnvironment: true });
      await archive(usb, days(1), 15);
      await archive(usb, days(2), 15);
      const { deps, log } = setup({
        baseEnv: {
          WAITRON_BACKUP_DIR: usb,
          WAITRON_BACKUP_RECOVERY_KEY: KEY,
          WAITRON_BACKUP_DESTINATIONS: "[",
        },
      });
      await deleteOldBackupsAtStart(deps);
      expect(skipped(log)).toEqual([{ reason: "destinations_invalid" }]);
      expect((await readdir(usb)).length).toBe(2);
    });

    it("the box env cannot be loaded", () =>
      expectSkip("env_unreadable", {
        loadBoxEnv: async () => {
          throw new Error("EIO");
        },
      }));

    it("every backup folder is on another disk", () =>
      expectSkip("no_folders", {
        deviceOf: async (path: string) => (path.startsWith(usb) ? 2 : 1),
      }));

    it("the venue folder's disk cannot be read", () =>
      expectSkip("venue_disk_unreadable", {
        deviceOf: async () => {
          throw new Error("EIO");
        },
      }));

    it("another process holds the venue folder", () =>
      expectSkip("venue_in_use", {
        lockVenue: async () => {
          throw new AppError("provisioning.database_in_use", { database: "venue.db" });
        },
      }));

    it("the lock fails and the holder heartbeat is fresh", () =>
      expectSkip("venue_held", {
        lockVenue: async () => {
          throw new Error("EIO");
        },
        readVenueHolder: (): VenueHolder => ({
          kind: "server",
          pid: 1,
          host: "box",
          lockedAt: NOW.toISOString(),
          heartbeatAt: NOW.toISOString(),
        }),
      }));

    it("every deletable backup is short of the floor", () =>
      expectSkip("out_of_reach", { statfs: disk(0) }));
  });

  it("goes on without the lock when it fails for another reason and no holder is fresh", async () => {
    await note();
    await archive(usb, days(1), 15);
    await archive(usb, days(2), 15);
    const { deps, log } = setup({
      lockVenue: async () => {
        throw new Error("EIO");
      },
      readVenueHolder: () => ({
        kind: "server",
        pid: 1,
        host: "box",
        lockedAt: "2026-10-01T00:00:00.000Z",
        heartbeatAt: "2026-10-01T00:00:00.000Z",
      }),
    });

    await deleteOldBackupsAtStart(deps);

    expect(codes(log)).toContain("backup.start_room_lock_failed");
    expect((await readdir(usb)).length).toBe(1);
  });

  it("logs the free space when deletions still leave it under the floor, and keeps the record", async () => {
    await note();
    const oldest = await archive(usb, days(1), 15);
    await archive(usb, days(2), 15);
    // A deletion that frees nothing: free space stays at 10 MiB.
    const statfs = vi.fn(async () => ({ bavail: 10 * MIB, frsize: 1 }));
    const { deps, log } = setup({ statfs });

    await deleteOldBackupsAtStart(deps);

    expect(log).toHaveBeenCalledWith("warn", "backup.start_room_short", {
      freeBytes: 10 * MIB,
      floorBytes: SPARE + FULL_DISK_BYTES,
    });
    expect(skipped(log)).toEqual([]);
    expect((await readRecord()).deleted.map((a) => a.key)).toEqual([oldest]);
  });

  it("logs the free space, not out_of_reach, when the first deletion fails and nothing is deleted", async () => {
    await note();
    const oldest = await archive(usb, days(1), 15);
    const newest = await archive(usb, days(2), 15);
    // 10 MiB free plus the 15 MiB archive reaches the floor (24 MiB), but the folder refuses the
    // deletion.
    await chmod(usb, 0o555);
    try {
      const { deps, log } = setup();

      await deleteOldBackupsAtStart(deps);

      expect(await readdir(usb)).toEqual([oldest, newest].sort());
      expect(codes(log)).toContain("backup.archive_delete_failed");
      expect(log).toHaveBeenCalledWith("warn", "backup.start_room_short", {
        freeBytes: 10 * MIB,
        floorBytes: SPARE + FULL_DISK_BYTES,
      });
      expect(skipped(log)).toEqual([]);
      expect(existsSync(join(stateDir, BACKUP_ROOM_START_DELETED_FILE))).toBe(false);
    } finally {
      await chmod(usb, 0o755);
    }
  });

  describe("a record an earlier start left", () => {
    const EARLIER = new Date("2026-10-29T11:00:00.000Z");
    const gone = (key: string, takenAt: Date): DeletableArchive => ({
      destination: "usb",
      dir: usb,
      key,
      bytes: 5 * MIB,
      takenAt,
    });

    it("for the same venue.db is added to, without duplicates, keeping the earlier time", async () => {
      await note();
      const oldest = await archive(usb, days(1), 15);
      await archive(usb, days(2), 15);
      const before = gone(backupArchiveKey(days(0.5)), days(0.5));
      // The same destination and key as the archive this start deletes.
      const again = { ...gone(oldest, days(1)), bytes: 15 * MIB };
      await earlierRecord(EARLIER, await venueDbNow(), [before, again]);
      const { deps } = setup();

      await deleteOldBackupsAtStart(deps);

      expect(await readRecord()).toEqual({
        at: EARLIER,
        venueDb: await venueDbNow(),
        deleted: [before, again],
      });
    });

    it("for the same venue.db keeps the earlier of the two times", async () => {
      await note();
      const oldest = await archive(usb, days(1), 15);
      await archive(usb, days(2), 15);
      const later = new Date(NOW.getTime() + 60_000);
      await earlierRecord(later, await venueDbNow(), []);
      const { deps } = setup();

      await deleteOldBackupsAtStart(deps);

      const record = await readRecord();
      expect(record.at).toEqual(NOW);
      expect(record.deleted.map((a) => a.key)).toEqual([oldest]);
    });

    it("for another venue.db is replaced", async () => {
      await note();
      const oldest = await archive(usb, days(1), 15);
      await archive(usb, days(2), 15);
      const other = { ...(await venueDbNow()), ino: "1" };
      await earlierRecord(EARLIER, other, [gone(backupArchiveKey(days(0.5)), days(0.5))]);
      const { deps } = setup();

      await deleteOldBackupsAtStart(deps);

      expect(await readRecord()).toEqual({
        at: NOW,
        venueDb: await venueDbNow(),
        deleted: [{ destination: "usb", dir: usb, key: oldest, bytes: 15 * MIB, takenAt: days(1) }],
      });
    });

    type Stored = Record<string, unknown> & { deleted: Record<string, unknown>[] };
    const entry = (over: Record<string, unknown>) => (record: Stored) => ({
      ...record,
      deleted: [{ ...record.deleted[0], ...over }],
    });
    it.each<[string, (record: Stored) => unknown]>([
      ["not JSON", () => "{"],
      ["another version", (record) => ({ ...record, version: 2 })],
      ["with no venue.db identity", (record) => ({ ...record, venueDb: undefined })],
      [
        "with a venue.db file number that is not digits",
        (r) => ({ ...r, venueDb: { ...(r.venueDb as object), ino: "x" } }),
      ],
      ["with no list of deletions", (record) => ({ ...record, deleted: {} })],
      ["with a deletion of negative size", entry({ bytes: -1 })],
      [
        "with a deletion whose time is not written by toISOString",
        entry({ takenAt: "2026-10-01" }),
      ],
    ])("that is %s is replaced", async (_label, spoil) => {
      await note();
      const oldest = await archive(usb, days(1), 15);
      await archive(usb, days(2), 15);
      const valid: Stored = {
        version: 1,
        at: EARLIER.toISOString(),
        venueDb: await venueDbNow(),
        deleted: [{ ...gone("k", days(0.5)), takenAt: days(0.5).toISOString() }],
      };
      const spoilt = spoil(valid);
      await writeFile(
        join(stateDir, BACKUP_ROOM_START_DELETED_FILE),
        typeof spoilt === "string" ? spoilt : JSON.stringify(spoilt),
      );
      const { deps } = setup();

      await deleteOldBackupsAtStart(deps);

      const record = await readRecord();
      expect(record.at).toEqual(NOW);
      expect(record.deleted.map((a) => a.key)).toEqual([oldest]);
    });
  });

  it("syncs the record before its rename and the state folder after, so a power cut cannot empty it", async () => {
    await note();
    await archive(usb, days(1), 15);
    await archive(usb, days(2), 15);
    const { deps } = setup();
    const record = join(stateDir, BACKUP_ROOM_START_DELETED_FILE);
    const events: string[] = [];
    const real = await vi.importActual<typeof fs>("node:fs/promises");
    vi.mocked(fs.open).mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await real.open(...args);
      const realSync = handle.sync.bind(handle);
      handle.sync = async () => {
        events.push(`sync ${String(args[0])}`);
        return realSync();
      };
      return handle;
    });
    vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      events.push(`rename ${String(from)} ${String(to)}`);
      return real.rename(from, to);
    });
    try {
      await deleteOldBackupsAtStart(deps);
    } finally {
      vi.mocked(fs.open).mockReset();
      vi.mocked(fs.rename).mockReset();
    }

    expect(events).toEqual([
      `sync ${record}.tmp`,
      `rename ${record}.tmp ${record}`,
      `sync ${stateDir}`,
    ]);
    expect((await readRecord()).deleted).toHaveLength(1);
  });

  it("a record that cannot be written is logged and the deletions stand", async () => {
    await note();
    await archive(usb, days(1), 15);
    await archive(usb, days(2), 15);
    await mkdir(join(stateDir, BACKUP_ROOM_START_DELETED_FILE, "occupied"), { recursive: true });
    const { deps, log } = setup();

    await deleteOldBackupsAtStart(deps);

    expect((await readdir(usb)).length).toBe(1);
    expect(log).toHaveBeenCalledWith("warn", "backup.start_room_record_failed", {
      errno: "EISDIR",
      stage: "write",
    });
  });

  it("a record written whose folder sync fails is logged as such, and the record stands", async () => {
    await note();
    await archive(usb, days(1), 15);
    await archive(usb, days(2), 15);
    const { deps, log } = setup();
    const real = await vi.importActual<typeof fs>("node:fs/promises");
    vi.mocked(fs.open).mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      if (String(args[0]) === stateDir) throw Object.assign(new Error("no"), { code: "EIO" });
      return real.open(...args);
    });
    try {
      await deleteOldBackupsAtStart(deps);
    } finally {
      vi.mocked(fs.open).mockReset();
    }

    expect(log).toHaveBeenCalledWith("warn", "backup.start_room_record_failed", {
      errno: "EIO",
      stage: "folder_sync",
    });
    expect((await readRecord()).deleted).toHaveLength(1);
  });

  it("logs any other failure of the step and never throws, releasing the lock", async () => {
    await note();
    await archive(usb, days(1), 15);
    await archive(usb, days(2), 15);
    const { deps, log, release } = setup({ floor: Number.NaN });

    await expect(deleteOldBackupsAtStart(deps)).resolves.toBeUndefined();

    expect(codes(log)).toContain("backup.start_room_failed");
    expect(release).toHaveBeenCalledOnce();
  });
});
