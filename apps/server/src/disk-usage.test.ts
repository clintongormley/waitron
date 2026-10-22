import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDiskUsage, type DiskStatfs } from "./disk-usage.js";

let root: string;
let venueDir: string;
let logDir: string;

beforeEach(async () => {
  // Its real path: macOS's temporary folder is reached through a link, and the device seams below
  // match the folders by path.
  root = await realpath(await mkdtemp(join(tmpdir(), "wt-disk-usage-")));
  venueDir = join(root, "venue");
  logDir = join(root, "logs");
  await mkdir(venueDir);
  await mkdir(logDir);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function disk(blocks: number, bfree: number, bavail: number): DiskStatfs {
  return async () => ({ blocks, bfree, bavail, frsize: 1 });
}

async function fill(path: string, bytes: number): Promise<void> {
  await writeFile(path, Buffer.alloc(bytes));
}

describe("readDiskUsage", () => {
  it("splits the disk's used space into the database, backups, logs and the rest", async () => {
    await fill(join(venueDir, "venue.db"), 600);
    await mkdir(join(venueDir, "sub"));
    await fill(join(venueDir, "sub", "venue.db-wal"), 400);
    await fill(join(logDir, "waitron.log"), 300);
    const backups = join(root, "backups");
    await mkdir(backups);
    await fill(join(backups, "a.tar"), 5000);

    const usage = await readDiskUsage({
      venueDir,
      logDir,
      backupDirs: [backups],
      statfs: disk(100000, 40000, 30000),
    });

    expect(usage).toEqual({
      freeBytes: 30000,
      totalBytes: 100000,
      databaseBytes: 1000,
      backupsBytes: 5000,
      logBytes: 300,
      otherBytes: 60000 - 6300,
    });
  });

  it("counts a backup folder inside the venue folder once, as the database's", async () => {
    await fill(join(venueDir, "venue.db"), 1000);
    const inside = join(venueDir, "backups");
    await mkdir(inside);
    await fill(join(inside, "a.tar"), 2000);

    const usage = await readDiskUsage({
      venueDir,
      logDir,
      backupDirs: [inside],
      statfs: disk(100000, 40000, 30000),
    });

    expect(usage.databaseBytes).toBe(3000);
    expect(usage.backupsBytes).toBe(0);
    expect(usage.otherBytes).toBe(60000 - 3000);
  });

  it("does not count the venue folder again inside a backup folder that holds it", async () => {
    await fill(join(venueDir, "venue.db"), 1000);
    await fill(join(root, "a.tar"), 2000);

    const usage = await readDiskUsage({
      venueDir,
      logDir,
      backupDirs: [root],
      statfs: disk(100000, 40000, 30000),
    });

    expect(usage.databaseBytes).toBe(1000);
    expect(usage.backupsBytes).toBe(2000);
  });

  it("sums two backup folders and counts a missing one as nothing", async () => {
    const first = join(root, "first");
    const second = join(root, "second");
    await mkdir(first);
    await mkdir(second);
    await fill(join(first, "a.tar"), 1500);
    await fill(join(second, "b.tar"), 2500);

    const usage = await readDiskUsage({
      venueDir,
      logDir,
      backupDirs: [first, second, join(root, "missing")],
      statfs: disk(100000, 40000, 30000),
    });

    expect(usage.backupsBytes).toBe(4000);
  });

  it("does not follow a link inside the venue folder", async () => {
    await fill(join(venueDir, "venue.db"), 1000);
    const elsewhere = join(root, "elsewhere");
    await mkdir(elsewhere);
    await fill(join(elsewhere, "big"), 9000);
    await symlink(join(elsewhere, "big"), join(venueDir, "file-link"));
    await symlink(elsewhere, join(venueDir, "folder-link"));

    const usage = await readDiskUsage({
      venueDir,
      logDir,
      backupDirs: [],
      statfs: disk(100000, 40000, 30000),
    });

    expect(usage.databaseBytes).toBe(1000);
  });

  it("answers null for every field when the disk cannot be read", async () => {
    const usage = await readDiskUsage({
      venueDir,
      logDir,
      backupDirs: [],
      statfs: async () => {
        throw new Error("statfs failed");
      },
    });

    expect(usage).toEqual({
      freeBytes: null,
      totalBytes: null,
      databaseBytes: null,
      backupsBytes: null,
      logBytes: null,
      otherBytes: null,
    });
  });

  it("answers null for every part when the venue folder cannot be read", async () => {
    const usage = await readDiskUsage({
      venueDir,
      logDir,
      backupDirs: [],
      statfs: disk(100000, 40000, 30000),
      deviceOf: async () => {
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      },
    });

    expect(usage).toEqual({
      freeBytes: 30000,
      totalBytes: 100000,
      databaseBytes: null,
      backupsBytes: null,
      logBytes: null,
      otherBytes: null,
    });
  });

  it("never answers less than nothing for the rest of the disk", async () => {
    await fill(join(venueDir, "venue.db"), 1000);

    const usage = await readDiskUsage({
      venueDir,
      logDir,
      backupDirs: [],
      statfs: disk(100000, 100000, 100000),
    });

    expect(usage.databaseBytes).toBe(1000);
    expect(usage.otherBytes).toBe(0);
  });

  it("does not count a folder on another device, nor subtract it", async () => {
    await fill(join(venueDir, "venue.db"), 1000);
    await fill(join(logDir, "waitron.log"), 300);
    const backups = join(root, "backups");
    await mkdir(backups);
    await fill(join(backups, "a.tar"), 5000);
    const venueDev = (await stat(venueDir)).dev;

    const usage = await readDiskUsage({
      venueDir,
      logDir,
      backupDirs: [backups],
      statfs: disk(100000, 40000, 30000),
      deviceOf: async (path) =>
        path === logDir || path === backups ? venueDev + 1 : (await stat(path)).dev,
    });

    expect(usage.logBytes).toBeNull();
    expect(usage.backupsBytes).toBe(0);
    expect(usage.otherBytes).toBe(60000 - 1000);
  });

  it("answers null for a folder it cannot read", async () => {
    const usage = await readDiskUsage({
      venueDir,
      logDir,
      backupDirs: [],
      statfs: disk(100000, 40000, 30000),
      deviceOf: async (path) => {
        if (path === logDir) throw Object.assign(new Error("denied"), { code: "EACCES" });
        return (await stat(path)).dev;
      },
    });

    expect(usage.logBytes).toBeNull();
    expect(usage.databaseBytes).toBe(0);
  });

  it("answers null for a folder it cannot walk", async () => {
    const notAFolder = join(root, "waitron.log");
    await fill(notAFolder, 300);

    const usage = await readDiskUsage({
      venueDir,
      logDir: notAFolder,
      backupDirs: [],
      statfs: disk(100000, 40000, 30000),
    });

    expect(usage.logBytes).toBeNull();
  });

  it("does not count what sits on another device inside a counted folder", async () => {
    await fill(join(venueDir, "venue.db"), 1000);
    const otherDevice = (await stat(venueDir)).dev + 1;

    const usage = await readDiskUsage({
      venueDir,
      logDir,
      backupDirs: [],
      statfs: disk(100000, 40000, 30000),
      deviceOf: async () => otherDevice,
    });

    expect(usage.databaseBytes).toBe(0);
  });

  it("does not subtract an unreadable database from the rest of the disk", async () => {
    const notAFolder = join(root, "venue-file");
    await fill(notAFolder, 1000);
    await fill(join(logDir, "waitron.log"), 300);

    const usage = await readDiskUsage({
      venueDir: notAFolder,
      logDir,
      backupDirs: [],
      statfs: disk(100000, 40000, 30000),
    });

    expect(usage.databaseBytes).toBeNull();
    expect(usage.otherBytes).toBe(60000 - 300);
  });

  it("reads the real disk when no statfs is given", async () => {
    const usage = await readDiskUsage({ venueDir, logDir, backupDirs: [] });

    expect(usage.totalBytes).toBeGreaterThan(0);
    expect(usage.freeBytes).toBeGreaterThan(0);
    expect(usage.freeBytes!).toBeLessThanOrEqual(usage.totalBytes!);
  });

  it("answers null for backups when a backup folder on this disk cannot be read", async () => {
    const readable = join(root, "backups");
    await mkdir(readable);
    await fill(join(readable, "a.tar"), 5000);
    const notAFolder = join(root, "backup-file");
    await fill(notAFolder, 2000);

    const usage = await readDiskUsage({
      venueDir,
      logDir,
      backupDirs: [readable, notAFolder],
      statfs: disk(100000, 40000, 30000),
    });

    expect(usage.backupsBytes).toBeNull();
  });

  it("counts a file or folder that vanishes during the walk as gone", async () => {
    await fill(join(venueDir, "venue.db"), 1000);
    await fill(join(venueDir, "venue.db-shm"), 700);
    await mkdir(join(venueDir, "stream"));
    await fill(join(venueDir, "stream", "segment"), 400);
    const enoent = () => Object.assign(new Error("gone"), { code: "ENOENT" });

    const usage = await readDiskUsage({
      venueDir,
      logDir,
      backupDirs: [],
      statfs: disk(100000, 40000, 30000),
      lstat: async (path) => {
        if (path === join(venueDir, "venue.db-shm")) throw enoent();
        return lstat(path);
      },
      readdir: async (path) => {
        if (path === join(venueDir, "stream")) throw enoent();
        return readdir(path);
      },
    });

    expect(usage.databaseBytes).toBe(1000);
  });

  it("answers null for a part when an entry inside it cannot be read", async () => {
    await fill(join(venueDir, "venue.db"), 1000);

    const usage = await readDiskUsage({
      venueDir,
      logDir,
      backupDirs: [],
      statfs: disk(100000, 40000, 30000),
      lstat: async () => {
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      },
    });

    expect(usage.databaseBytes).toBeNull();
  });

  describe("a folder reached through a link", () => {
    it("counts a backup folder once when a link to it is listed too", async () => {
      const backups = join(root, "backups");
      await mkdir(backups);
      await fill(join(backups, "a.tar"), 1048576);
      const alias = join(root, "backups-alias");
      await symlink(backups, alias);

      const usage = await readDiskUsage({
        venueDir,
        logDir,
        backupDirs: [backups, alias],
        statfs: disk(10_000_000, 4_000_000, 3_000_000),
      });

      expect(usage.backupsBytes).toBe(1048576);
    });

    it("does not count the venue folder again under backups through a link to it", async () => {
      await fill(join(venueDir, "venue.db"), 1000);
      const alias = join(root, "venue-alias");
      await symlink(venueDir, alias);

      const usage = await readDiskUsage({
        venueDir,
        logDir,
        backupDirs: [alias],
        statfs: disk(100000, 40000, 30000),
      });

      expect(usage.databaseBytes).toBe(1000);
      expect(usage.backupsBytes).toBe(0);
      expect(usage.otherBytes).toBe(60000 - 1000);
    });

    it("does not count the venue folder again inside a linked backup folder that holds it", async () => {
      await fill(join(venueDir, "venue.db"), 1000);
      await fill(join(root, "a.tar"), 2000);
      const alias = join(root, "venue-alias");
      await symlink(venueDir, alias);
      const rootAlias = join(root, "root-alias");
      await symlink(root, rootAlias);

      const usage = await readDiskUsage({
        venueDir: alias,
        logDir,
        backupDirs: [rootAlias],
        statfs: disk(100000, 40000, 30000),
      });

      expect(usage.databaseBytes).toBe(1000);
      expect(usage.backupsBytes).toBe(2000);
    });

    it("counts a backup folder named only through a link as backups", async () => {
      const backups = join(root, "backups");
      await mkdir(backups);
      await fill(join(backups, "a.tar"), 5000);
      const alias = join(root, "backups-alias");
      await symlink(backups, alias);

      const usage = await readDiskUsage({
        venueDir,
        logDir,
        backupDirs: [alias],
        statfs: disk(100000, 40000, 30000),
      });

      expect(usage.backupsBytes).toBe(5000);
    });

    it("counts a log folder that is a link to a backup folder once, under backups", async () => {
      const backups = join(root, "backups");
      await mkdir(backups);
      await fill(join(backups, "a.tar"), 5000);
      const alias = join(root, "logs-alias");
      await symlink(backups, alias);

      const usage = await readDiskUsage({
        venueDir,
        logDir: alias,
        backupDirs: [backups],
        statfs: disk(100000, 40000, 30000),
      });

      expect(usage.backupsBytes).toBe(5000);
      expect(usage.logBytes).toBe(0);
    });

    it("answers null for a folder whose real path cannot be read", async () => {
      const usage = await readDiskUsage({
        venueDir,
        logDir,
        backupDirs: [],
        statfs: disk(100000, 40000, 30000),
        realpath: async (path) => {
          if (path === logDir) throw Object.assign(new Error("denied"), { code: "EACCES" });
          return realpath(path);
        },
      });

      expect(usage.logBytes).toBeNull();
      expect(usage.databaseBytes).toBe(0);
    });

    it("answers null for every part when the venue folder's real path cannot be read", async () => {
      const usage = await readDiskUsage({
        venueDir,
        logDir,
        backupDirs: [],
        statfs: disk(100000, 40000, 30000),
        realpath: async () => {
          throw Object.assign(new Error("denied"), { code: "EACCES" });
        },
      });

      expect(usage).toEqual({
        freeBytes: 30000,
        totalBytes: 100000,
        databaseBytes: null,
        backupsBytes: null,
        logBytes: null,
        otherBytes: null,
      });
    });
  });
});
