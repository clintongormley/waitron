import {
  chmod,
  stat as fsStat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backupArchiveKey } from "./backup-keys.js";
import {
  foldersOnDisk,
  listDeletableArchives,
  makeRoom,
  type DeletableArchive,
} from "./backup-room.js";
import type { Statfs } from "./free-bytes.js";
import { LocalFsBackend } from "./local-fs-backend.js";
import type { Logger } from "./logger.js";

let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "backup-room-")));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const T = new Date("2026-10-01T12:00:00.000Z");
const hours = (n: number) => new Date(T.getTime() + n * 3_600_000);

async function folder(name: string): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function archive(dir: string, at: Date, bytes = 10, nonce?: string): Promise<string> {
  const key = backupArchiveKey(at, nonce);
  await writeFile(join(dir, key), Buffer.alloc(bytes));
  return key;
}

describe("listDeletableArchives", () => {
  it("never lists the newest archive in each folder, and each folder keeps its own", async () => {
    const a = await folder("a");
    const b = await folder("b");
    const a1 = await archive(a, hours(1));
    await archive(a, hours(2));
    const b1 = await archive(b, hours(3));
    await archive(b, hours(4));

    const listed = await listDeletableArchives(
      [
        { destination: "da", dir: a },
        { destination: "db", dir: b },
      ],
      T,
    );

    expect(listed.map((e) => e.key)).toEqual([a1, b1]);
  });

  it("never lists an archive taken before the installation began, nor one in its second", async () => {
    const a = await folder("a");
    await archive(a, hours(-2));
    await archive(a, hours(-1));
    await archive(a, T);
    const after = await archive(a, hours(24));
    await archive(a, hours(48));

    const listed = await listDeletableArchives([{ destination: "da", dir: a }], T);

    expect(listed.map((e) => e.key)).toEqual([after]);
  });

  it("never lists an archive stamped in the installation's second when it began part-way through", async () => {
    const a = await folder("a");
    await archive(a, T);
    await archive(a, hours(1));

    const listed = await listDeletableArchives(
      [{ destination: "da", dir: a }],
      new Date(T.getTime() + 500),
    );

    expect(listed).toEqual([]);
  });

  it("lists nothing when the installation start is unknown", async () => {
    const a = await folder("a");
    await archive(a, hours(1));
    await archive(a, hours(2));

    expect(await listDeletableArchives([{ destination: "da", dir: a }], null)).toEqual([]);
  });

  it("never lists a symbolic link, never counts it as the newest, and leaves its target alone", async () => {
    const a = await folder("a");
    const outside = join(root, "outside.bin");
    await writeFile(outside, "keep me");
    const older = await archive(a, hours(1));
    await archive(a, hours(2));
    await symlink(outside, join(a, backupArchiveKey(hours(3))));

    const listed = await listDeletableArchives([{ destination: "da", dir: a }], T);

    expect(listed.map((e) => e.key)).toEqual([older]);
    expect(await readFile(outside, "utf8")).toBe("keep me");
  });

  it("never lists an unreadable name, a .tmp leftover or a folder named like an archive", async () => {
    const a = await folder("a");
    const older = await archive(a, hours(1));
    await archive(a, hours(5));
    await writeFile(join(a, "waitron-not-a-stamp.backup.enc"), "x");
    await writeFile(join(a, `${backupArchiveKey(hours(2))}.tmp`), "x");
    await mkdir(join(a, backupArchiveKey(hours(3))));
    await writeFile(join(a, "notes.txt"), "x");

    const listed = await listDeletableArchives([{ destination: "da", dir: a }], T);

    expect(listed.map((e) => e.key)).toEqual([older]);
  });

  it("does not let a folder named like an archive count as the newest", async () => {
    const a = await folder("a");
    const older = await archive(a, hours(1));
    await archive(a, hours(2));
    await mkdir(join(a, backupArchiveKey(hours(3))));

    const listed = await listDeletableArchives([{ destination: "da", dir: a }], T);

    expect(listed.map((e) => e.key)).toEqual([older]);
  });

  it("lists nothing from a folder that does not exist", async () => {
    expect(
      await listDeletableArchives([{ destination: "da", dir: join(root, "missing") }], T),
    ).toEqual([]);
  });

  it("lists oldest first across folders, ties by key, with each entry's destination, folder, size and time", async () => {
    const a = await folder("a");
    const b = await folder("b");
    const low = "00000000-0000-4000-8000-000000000000";
    const high = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const a1 = await archive(a, hours(3), 30);
    const tieA = await archive(a, hours(2), 21, high);
    await archive(a, hours(9));
    const b1 = await archive(b, hours(1), 11);
    const tieB = await archive(b, hours(2), 22, low);
    await archive(b, hours(9));

    const listed = await listDeletableArchives(
      [
        { destination: "da", dir: a },
        { destination: "db", dir: b },
      ],
      T,
    );

    expect(listed).toEqual([
      { destination: "db", dir: b, key: b1, bytes: 11, takenAt: hours(1) },
      { destination: "db", dir: b, key: tieB, bytes: 22, takenAt: hours(2) },
      { destination: "da", dir: a, key: tieA, bytes: 21, takenAt: hours(2) },
      { destination: "da", dir: a, key: a1, bytes: 30, takenAt: hours(3) },
    ]);
  });

  it("lists the same archive once from each folder that holds it, in folder order", async () => {
    const a = await folder("a");
    const b = await folder("b");
    const nonce = "12345678-1234-4234-8234-123456789abc";
    const shared = await archive(a, hours(1), 10, nonce);
    await archive(b, hours(1), 10, nonce);
    await archive(a, hours(2));
    await archive(b, hours(2));

    const listed = await listDeletableArchives(
      [
        { destination: "da", dir: a },
        { destination: "db", dir: b },
      ],
      T,
    );

    expect(listed.map((e) => [e.destination, e.key])).toEqual([
      ["da", shared],
      ["db", shared],
    ]);
  });

  it("lists nothing from a folder whose entries cannot be looked at", async () => {
    const a = await folder("a");
    await archive(a, hours(1));
    await archive(a, hours(2));
    // Read but not search permission: the names can be listed, each `lstat` is refused.
    await chmod(a, 0o444);
    try {
      expect(await listDeletableArchives([{ destination: "da", dir: a }], T)).toEqual([]);
    } finally {
      await chmod(a, 0o755);
    }
  });
});

describe("foldersOnDisk", () => {
  const bucket = { id: "bucket" };

  it("leaves out a destination with no local folder", async () => {
    const staging = await folder("staging");

    expect(await foldersOnDisk([bucket], staging)).toEqual({ folders: [], copies: 0 });
  });

  it("includes a local folder on the staging folder's disk, by its real path", async () => {
    const staging = await folder("staging");
    const a = await folder("a");
    await symlink(a, join(root, "a-link"));

    expect(
      await foldersOnDisk([bucket, new LocalFsBackend("da", join(root, "a-link"))], staging),
    ).toEqual({ folders: [{ destination: "da", dir: a }], copies: 1 });
  });

  it("leaves out a folder on another disk", async () => {
    const staging = await folder("staging");
    const a = await folder("a");
    const b = await folder("b");
    const deviceOf = async (path: string) => (path === b ? -1 : (await fsStat(path)).dev);

    expect(
      await foldersOnDisk(
        [new LocalFsBackend("da", a), new LocalFsBackend("db", b)],
        staging,
        deviceOf,
      ),
    ).toEqual({ folders: [{ destination: "da", dir: a }], copies: 1 });
  });

  it("judges a missing folder by its nearest existing parent", async () => {
    const staging = await folder("staging");
    const parent = await folder("elsewhere");
    const missing = join(root, "a", "b", "c");
    const elsewhere = join(parent, "x", "y");
    const deviceOf = async (path: string) => (path === parent ? -1 : (await fsStat(path)).dev);

    expect(
      await foldersOnDisk(
        [new LocalFsBackend("da", missing), new LocalFsBackend("db", elsewhere)],
        staging,
        deviceOf,
      ),
    ).toEqual({ folders: [{ destination: "da", dir: missing }], copies: 1 });
  });

  it("lists a folder and a link to it once, and counts both copies", async () => {
    const staging = await folder("staging");
    const a = await folder("a");
    await symlink(a, join(root, "a-link"));

    expect(
      await foldersOnDisk(
        [new LocalFsBackend("da", a), new LocalFsBackend("dlink", join(root, "a-link"))],
        staging,
      ),
    ).toEqual({ folders: [{ destination: "da", dir: a }], copies: 2 });
  });

  it("counts, but never lists, a folder whose disk cannot be read", async () => {
    const staging = await folder("staging");
    const a = await folder("a");
    const b = await folder("b");
    const deviceOf = async (path: string) => {
      if (path === b) throw Object.assign(new Error("denied"), { code: "EACCES" });
      return (await fsStat(path)).dev;
    };

    expect(
      await foldersOnDisk(
        [new LocalFsBackend("da", a), new LocalFsBackend("db", b)],
        staging,
        deviceOf,
      ),
    ).toEqual({ folders: [{ destination: "da", dir: a }], copies: 2 });
  });

  it("counts, but never lists, a folder whose real path cannot be found", async () => {
    const staging = await folder("staging");
    const file = join(root, "a-file");
    await writeFile(file, "x");

    expect(await foldersOnDisk([new LocalFsBackend("da", join(file, "backups"))], staging)).toEqual(
      { folders: [], copies: 1 },
    );
  });
});

describe("makeRoom", () => {
  const NEED = 1000;
  const FLOOR = 100;
  const AIM = 500;
  const SIZE = 200;

  interface Disk {
    statfs: Statfs;
    reads: () => number;
  }

  /** Free space that rises by each tracked file's size once it is gone from disk (unless `rises` is
   * false); `onRead` runs before the reading, with the 1-based read number. */
  function disk(
    tracked: readonly string[],
    startFree: number,
    opts: { rises?: boolean; onRead?: (n: number) => Promise<void> } = {},
  ): Disk {
    let reads = 0;
    return {
      statfs: async () => {
        reads += 1;
        await opts.onRead?.(reads);
        let freed = 0;
        for (const p of tracked)
          if (!lstatSync(p, { throwIfNoEntry: false })?.isFile()) freed += SIZE;
        return { bavail: startFree + (opts.rises === false ? 0 : freed), frsize: 1 };
      },
      reads: () => reads,
    };
  }

  /** One backup folder: three deletable archives (oldest first) and the newest, which is kept. */
  async function backups(name = "backups") {
    const dir = await folder(name);
    const staging = await folder("staging");
    const keys = [];
    for (const n of [1, 2, 3, 4]) keys.push(await archive(dir, hours(n), SIZE));
    const paths = keys.map((k) => join(dir, k));
    return { dir, staging, keys, paths };
  }

  function exists(path: string): boolean {
    return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
  }

  function base(f: Awaited<ReturnType<typeof backups>>, d: Disk) {
    const log = vi.fn<Logger>();
    const onDeleted = vi.fn<(deleted: readonly DeletableArchive[]) => Promise<void>>(
      async () => {},
    );
    return {
      log,
      onDeleted,
      args: {
        neededBytes: NEED,
        floorBytes: FLOOR,
        aimBytes: AIM,
        stagingDir: f.staging,
        statfs: d.statfs,
        folders: [{ destination: "da", dir: f.dir }],
        installationStartedAt: T,
        signal: new AbortController().signal,
        log,
        onDeleted,
      },
    };
  }

  const deletedKeys = (onDeleted: ReturnType<typeof base>["onDeleted"]) =>
    onDeleted.mock.calls.map(([deleted]) => deleted.map((a) => a.key));

  it("refuses, deleting nothing, when even every deletable archive cannot reach the need and the floor", async () => {
    const f = await backups();
    const d = disk(f.paths, NEED + FLOOR - 3 * SIZE - 1);
    const { args, onDeleted } = base(f, d);

    await expect(makeRoom(args)).rejects.toMatchObject({
      code: "backup.staging_space_low",
      params: { neededBytes: NEED + FLOOR, availableBytes: NEED + FLOOR - 3 * SIZE - 1 },
    });
    expect(f.paths.every(exists)).toBe(true);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("deletes oldest first toward the aim, re-reading free space after each deletion, and stops there", async () => {
    const f = await backups();
    const d = disk(f.paths, NEED + AIM - 350);
    const { args, log, onDeleted } = base(f, d);

    await makeRoom(args);

    expect(f.paths.map(exists)).toEqual([false, false, true, true]);
    expect(d.reads()).toBe(3);
    expect(log.mock.calls).toEqual([
      [
        "info",
        "backup.archive_deleted",
        { destination: "da", key: f.keys[0], bytes: SIZE, reason: "backup_room" },
      ],
      [
        "info",
        "backup.archive_deleted",
        { destination: "da", key: f.keys[1], bytes: SIZE, reason: "backup_room" },
      ],
    ]);
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(onDeleted.mock.calls[0]![0]).toEqual([
      { destination: "da", dir: f.dir, key: f.keys[0], bytes: SIZE, takenAt: hours(1) },
      { destination: "da", dir: f.dir, key: f.keys[1], bytes: SIZE, takenAt: hours(2) },
    ]);
  });

  it("deletes only toward the floor when the aim cannot be reached", async () => {
    const f = await backups();
    // 850 + 600 falls short of the aim (1500); the floor (1100) is met after two deletions.
    const d = disk(f.paths, 850);
    const { args, onDeleted } = base(f, d);

    await makeRoom(args);

    expect(f.paths.map(exists)).toEqual([false, false, true, true]);
    expect(deletedKeys(onDeleted)).toEqual([[f.keys[0], f.keys[1]]]);
  });

  it("does nothing, with one reading, when free space already reaches the aim", async () => {
    const f = await backups();
    const d = disk(f.paths, NEED + AIM);
    const { args, log, onDeleted } = base(f, d);

    await makeRoom(args);

    expect(f.paths.every(exists)).toBe(true);
    expect(d.reads()).toBe(1);
    expect(log).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("deletes nothing and refuses nothing when free space cannot be read", async () => {
    const f = await backups();
    const { args, onDeleted } = base(f, disk(f.paths, 0));

    await makeRoom({
      ...args,
      statfs: async () => {
        throw Object.assign(new Error("no"), { code: "ENOSYS" });
      },
    });

    expect(f.paths.every(exists)).toBe(true);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("stops without refusing when free space cannot be read after a deletion, and reports it", async () => {
    const f = await backups();
    const d = disk(f.paths, 850, {
      onRead: async (n) => {
        if (n === 2) throw new Error("gone");
      },
    });
    const { args, onDeleted } = base(f, d);

    await makeRoom(args);

    expect(f.paths.map(exists)).toEqual([false, true, true, true]);
    expect(deletedKeys(onDeleted)).toEqual([[f.keys[0]]]);
  });

  it("skips a file gone between listing and deletion and goes on", async () => {
    const f = await backups();
    // 900 needs all three for the aim; the second vanishes after the first deletion.
    const d = disk(f.paths, 900, {
      onRead: async (n) => {
        if (n === 2) await rm(f.paths[1]!);
      },
    });
    const { args, onDeleted } = base(f, d);

    await makeRoom(args);

    expect(f.paths.map(exists)).toEqual([false, false, false, true]);
    expect(deletedKeys(onDeleted)).toEqual([[f.keys[0], f.keys[2]]]);
  });

  it("skips a file whose unlink finds it already gone and goes on", async () => {
    const f = await backups();
    const d = disk(f.paths, 850);
    const { args, onDeleted } = base(f, d);
    let calls = 0;

    await makeRoom({
      ...args,
      unlink: async (path) => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error("gone"), { code: "ENOENT" });
        await rm(path);
      },
    });

    expect(f.paths.map(exists)).toEqual([true, false, false, true]);
    expect(deletedKeys(onDeleted)).toEqual([[f.keys[1], f.keys[2]]]);
  });

  it("skips an entry that is no longer a regular file at deletion, never touching a link's target", async () => {
    const f = await backups();
    const outside = join(root, "outside");
    await writeFile(outside, "keep");
    const d = disk(f.paths, 900, {
      onRead: async (n) => {
        if (n !== 2) return;
        await rm(f.paths[1]!);
        await symlink(outside, f.paths[1]!);
      },
    });
    const { args, onDeleted } = base(f, d);

    await makeRoom(args);

    expect(f.paths.map(exists)).toEqual([false, true, false, true]);
    expect(await readFile(outside, "utf8")).toBe("keep");
    expect(deletedKeys(onDeleted)).toEqual([[f.keys[0], f.keys[2]]]);
  });

  it("refuses after deleting what the sum promised when free space does not rise, and reports first", async () => {
    const f = await backups();
    const free = NEED + FLOOR - 3 * SIZE;
    const d = disk(f.paths, free, { rises: false });
    const { args, onDeleted } = base(f, d);

    await expect(makeRoom(args)).rejects.toMatchObject({
      code: "backup.staging_space_low",
      params: { neededBytes: NEED + FLOOR, availableBytes: free },
    });
    expect(f.paths.map(exists)).toEqual([false, false, false, true]);
    expect(d.reads()).toBe(4);
    expect(deletedKeys(onDeleted)).toEqual([[f.keys[0], f.keys[1], f.keys[2]]]);
  });

  it("stops deleting when the signal is aborted between deletions, reports, and throws the abort", async () => {
    const f = await backups();
    const controller = new AbortController();
    const reason = new Error("stopped");
    const d = disk(f.paths, 900, {
      onRead: async (n) => {
        if (n === 2) controller.abort(reason);
      },
    });
    const { args, onDeleted } = base(f, d);

    await expect(makeRoom({ ...args, signal: controller.signal })).rejects.toBe(reason);
    expect(f.paths.map(exists)).toEqual([false, true, true, true]);
    expect(deletedKeys(onDeleted)).toEqual([[f.keys[0]]]);
  });

  function failingSecondUnlink() {
    let calls = 0;
    return async (path: string) => {
      calls += 1;
      if (calls === 2) throw Object.assign(new Error("denied"), { code: "EACCES", errno: -13 });
      await rm(path);
    };
  }

  it("on a failed unlink logs it, deletes nothing more, re-reads free space and refuses if short", async () => {
    const f = await backups();
    const d = disk(f.paths, 850);
    const { args, log, onDeleted } = base(f, d);

    await expect(makeRoom({ ...args, unlink: failingSecondUnlink() })).rejects.toMatchObject({
      code: "backup.staging_space_low",
      params: { neededBytes: NEED + FLOOR, availableBytes: 850 + SIZE },
    });
    expect(f.paths.map(exists)).toEqual([false, true, true, true]);
    expect(d.reads()).toBe(3);
    expect(log).toHaveBeenCalledWith("warn", "backup.archive_delete_failed", {
      destination: "da",
      key: f.keys[1],
      errorCode: "unknown",
      errno: "EACCES",
    });
    expect(deletedKeys(onDeleted)).toEqual([[f.keys[0]]]);
  });

  it("on a failed unlink that leaves enough room, deletes nothing more and goes on", async () => {
    const f = await backups();
    // After the first deletion 1100 meets the floor though not the aim.
    const d = disk(f.paths, 900);
    const { args, onDeleted } = base(f, d);

    await makeRoom({ ...args, unlink: failingSecondUnlink() });

    expect(f.paths.map(exists)).toEqual([false, true, true, true]);
    expect(deletedKeys(onDeleted)).toEqual([[f.keys[0]]]);
  });

  it("reports nothing when the first unlink fails, logging an error that carries no code", async () => {
    const f = await backups();
    const d = disk(f.paths, 850);
    const { args, log, onDeleted } = base(f, d);

    await expect(
      makeRoom({
        ...args,
        unlink: async () => {
          throw new Error("odd");
        },
      }),
    ).rejects.toMatchObject({
      code: "backup.staging_space_low",
      params: { neededBytes: NEED + FLOOR, availableBytes: 850 },
    });
    expect(f.paths.every(exists)).toBe(true);
    expect(log.mock.calls).toEqual([
      [
        "warn",
        "backup.archive_delete_failed",
        { destination: "da", key: f.keys[0], errorCode: "unknown", errno: null },
      ],
    ]);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("keeps the step's own outcome when the report throws", async () => {
    const f = await backups();
    const failing = async () => {
      throw new Error("report failed");
    };
    const ok = base(f, disk(f.paths, NEED + AIM - 350));
    await expect(makeRoom({ ...ok.args, onDeleted: failing })).resolves.toBeUndefined();

    const g = await backups("backups2");
    const short = base(g, disk(g.paths, NEED + FLOOR - 3 * SIZE, { rises: false }));
    await expect(makeRoom({ ...short.args, onDeleted: failing })).rejects.toMatchObject({
      code: "backup.staging_space_low",
    });
  });
});
