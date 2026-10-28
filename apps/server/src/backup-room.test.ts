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
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupArchiveKey } from "./backup-keys.js";
import { foldersOnDisk, listDeletableArchives } from "./backup-room.js";
import { LocalFsBackend } from "./local-fs-backend.js";

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
