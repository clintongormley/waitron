import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { openWalInPlace } from "./read-only-database.js";

let live: string;
let dir: string;
let path: string;
beforeEach(async () => {
  live = await mkdtemp(join(tmpdir(), "wal-in-place-live-"));
  dir = await mkdtemp(join(tmpdir(), "wal-in-place-"));
  path = join(dir, "venue.db");
});
afterEach(async () => {
  await rm(live, { recursive: true, force: true });
  await rm(dir, { recursive: true, force: true });
});

const fill = (n: number, from = 0) =>
  `insert into t (n, b) select x + ${from}, randomblob(3000) from
    (with recursive c(x) as (select 1 union all select x + 1 from c where x < ${n}) select x from c)`;

/** Runs `write` on a WAL database in `live`, then copies its files into `dir` while it is still open. */
async function crashed(
  write: (db: DatabaseSync) => void,
  names = ["venue.db", "venue.db-wal", "venue.db-shm"],
) {
  const db = new DatabaseSync(join(live, "venue.db"));
  try {
    db.exec("pragma journal_mode = wal; pragma wal_autocheckpoint = 0");
    db.exec("create table t (n integer, b blob); insert into t (n) values (0)");
    db.exec("pragma wal_checkpoint(truncate)");
    write(db);
    for (const name of names) await copyFile(join(live, name), join(dir, name));
  } finally {
    db.close();
  }
}

async function hashes(folder: string) {
  return Promise.all(
    (await readdir(folder)).sort().map(async (name) => {
      const bytes = await readFile(join(folder, name));
      return [name, bytes.length, createHash("sha256").update(bytes).digest("hex")] as const;
    }),
  );
}

const rowsOf = (db: DatabaseSync) =>
  db.prepare("select n, hex(b) as b from t order by rowid").all() as { n: number; b: string }[];

/** What SQLite itself reads from a copy of `dir`'s database and -wal. */
async function sqliteReads() {
  const scratch = await mkdtemp(join(tmpdir(), "wal-in-place-oracle-"));
  try {
    for (const name of ["venue.db", "venue.db-wal"])
      await copyFile(join(dir, name), join(scratch, name));
    const db = new DatabaseSync(join(scratch, "venue.db"));
    try {
      return rowsOf(db);
    } finally {
      db.close();
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** The rows read in place; every file in `dir` is byte-identical afterwards. */
async function inPlace() {
  const before = await hashes(dir);
  const opened = await openWalInPlace(path);
  if (opened.kind !== "open") throw new Error(opened.kind);
  try {
    return rowsOf(opened.connection);
  } finally {
    opened.connection.close();
    expect(await hashes(dir)).toEqual(before);
  }
}

it("reads a row committed only in the -wal, and leaves every file beside it byte-identical", async () => {
  await crashed((db) => db.exec("insert into t (n) values (1)"));
  expect((await hashes(dir)).map(([name]) => name)).toEqual([
    "venue.db",
    "venue.db-shm",
    "venue.db-wal",
  ]);
  expect((await inPlace()).map(({ n }) => n)).toEqual([0, 1]);
});

it("reads the -wal's rows beside a zeroed or an empty -shm", async () => {
  await crashed((db) => db.exec("insert into t (n) values (1)"));
  await writeFile(`${path}-shm`, Buffer.alloc(32768));
  expect((await inPlace()).map(({ n }) => n)).toEqual([0, 1]);
  await writeFile(`${path}-shm`, "");
  expect((await inPlace()).map(({ n }) => n)).toEqual([0, 1]);
});

it("answers no-shm, and opens nothing, when no -shm is beside the database", async () => {
  await crashed((db) => db.exec("insert into t (n) values (1)"), ["venue.db", "venue.db-wal"]);
  const before = await hashes(dir);
  expect(await openWalInPlace(path)).toEqual({ kind: "no-shm" });
  expect(await hashes(dir)).toEqual(before);
});

// Each shape compares the read in place with what SQLite reads from a copy of the same files.
it.each([
  [
    "several committed transactions",
    async () =>
      crashed((db) => {
        db.exec(fill(5, 1));
        db.exec(fill(5, 6));
        db.exec("update t set n = n + 100 where n < 3");
      }),
    11,
  ],
  [
    "a transaction left open with its pages spilled into the -wal",
    async () =>
      crashed((db) => {
        db.exec(fill(5, 1));
        db.exec("pragma cache_size = 2; begin");
        db.exec("update t set n = n + 1000, b = randomblob(3000)");
        db.exec(fill(60, 100));
      }),
    6,
  ],
  [
    "a -wal restarted after a checkpoint, older frames left past the new ones",
    async () =>
      crashed((db) => {
        db.exec(fill(40, 1));
        db.exec("pragma wal_checkpoint(passive)");
        db.exec("insert into t (n) values (999)");
      }),
    42,
  ],
  [
    "a last frame cut short",
    async () => {
      await crashed((db) => {
        db.exec(fill(5, 1));
        db.exec(fill(5, 6));
      });
      const wal = join(dir, "venue.db-wal");
      await truncate(wal, (await readFile(wal)).length - 100);
    },
    6,
  ],
  [
    "a damaged frame in the second transaction, a third after it",
    async () => {
      await crashed((db) => {
        db.exec(fill(5, 1));
        db.exec(fill(5, 6));
        db.exec(fill(5, 11));
      });
      const wal = join(dir, "venue.db-wal");
      const bytes = await readFile(wal);
      const pageSize = bytes.readUInt32BE(8);
      const commits: number[] = [];
      for (let at = 32; at + 24 + pageSize <= bytes.length; at += 24 + pageSize)
        if (bytes.readUInt32BE(at + 4) !== 0) commits.push(at);
      expect(commits.length).toBe(3);
      bytes[commits[1]! + 24 + 100] ^= 0xff;
      await writeFile(wal, bytes);
    },
    6,
  ],
  [
    "a last commit that shrinks the database below pages earlier frames wrote",
    async () =>
      crashed((db) => {
        db.exec(fill(20, 1));
        db.exec("pragma wal_checkpoint(truncate)");
        db.exec(fill(5, 21));
        db.exec("delete from t where n > 2; vacuum");
      }),
    2,
  ],
  [
    "a frame naming page 0",
    async () => {
      await crashed((db) => db.exec("insert into t (n) values (1)"));
      const wal = join(dir, "venue.db-wal");
      const bytes = await readFile(wal);
      bytes.writeUInt32BE(0, 32);
      await writeFile(wal, bytes);
    },
    1,
  ],
] as const)("matches SQLite's own read for %s", async (_label, make, expected) => {
  await make();
  const sqlite = await sqliteReads();
  expect(sqlite).toHaveLength(expected);
  expect(await inPlace()).toEqual(sqlite);
});

it("reads a -wal whose checksums are big-endian, as SQLite does", async () => {
  await crashed((db) => db.exec(fill(5, 1)));
  const wal = join(dir, "venue.db-wal");
  await writeFile(wal, bigEndian(await readFile(wal)));
  const sqlite = await sqliteReads();
  expect(sqlite).toHaveLength(6);
  expect(await inPlace()).toEqual(sqlite);
});

/** The same -wal written by a big-endian machine: magic ...83, checksums over big-endian words. */
function bigEndian(wal: Buffer): Buffer {
  const out = Buffer.from(wal);
  expect(out.readUInt32BE(0)).toBe(0x377f0682);
  out.writeUInt32BE(0x377f0683, 0);
  const sum = (from: number, to: number, s: [number, number]): [number, number] => {
    let [a, b] = s;
    for (let i = from; i < to; i += 8) {
      a = (a + out.readUInt32BE(i) + b) >>> 0;
      b = (b + out.readUInt32BE(i + 4) + a) >>> 0;
    }
    return [a, b];
  };
  let s = sum(0, 24, [0, 0]);
  out.writeUInt32BE(s[0], 24);
  out.writeUInt32BE(s[1], 28);
  const pageSize = out.readUInt32BE(8);
  for (let at = 32; at + 24 + pageSize <= out.length; at += 24 + pageSize) {
    s = sum(at, at + 8, s);
    s = sum(at + 24, at + 24 + pageSize, s);
    out.writeUInt32BE(s[0], at + 16);
    out.writeUInt32BE(s[1], at + 20);
  }
  return out;
}

it("refuses a write through the connection", async () => {
  await crashed((db) => db.exec("insert into t (n) values (1)"));
  const opened = await openWalInPlace(path);
  if (opened.kind !== "open") throw new Error(opened.kind);
  try {
    expect(() => opened.connection.exec("insert into t (n) values (2)")).toThrow(/readonly/);
  } finally {
    opened.connection.close();
  }
});

it("answers missing without a database, and not-a-file for a link to the database, -wal or -shm", async () => {
  expect(await openWalInPlace(path)).toEqual({ kind: "missing" });
  await crashed((db) => db.exec("insert into t (n) values (1)"));
  for (const name of ["venue.db", "venue.db-wal", "venue.db-shm"]) {
    const target = join(live, name);
    await copyFile(join(dir, name), target);
    await rm(join(dir, name));
    await symlink(target, join(dir, name));
    expect(await openWalInPlace(path), name).toEqual({ kind: "not-a-file" });
    await rm(join(dir, name));
    await copyFile(target, join(dir, name));
  }
});

/** Opens `path` in place and, if it opened, tries a read and closes it. */
async function openAndRead() {
  const opened = await openWalInPlace(path);
  if (opened.kind !== "open") return opened;
  try {
    return { kind: "open", rows: rowsOf(opened.connection) };
  } catch (error) {
    return { kind: "open", error };
  } finally {
    opened.connection.close();
  }
}

// Opened in place, a 0- or 1-byte main file deleted the -wal beside it and a 99-byte one read as malformed.
it.each([0, 1, 99])(
  "answers short for a %i-byte database file beside a -wal, and changes no file",
  async (size) => {
    await crashed((db) => db.exec("insert into t (n) values (1)"));
    await truncate(path, size);
    const before = await hashes(dir);
    const opened = await openAndRead();
    expect(await hashes(dir)).toEqual(before);
    expect(opened).toEqual({ kind: "short" });
  },
);

it("opens a database file of exactly its 100-byte header beside a -wal, and changes no file", async () => {
  await crashed((db) => db.exec("insert into t (n) values (1)"));
  await truncate(path, 100);
  const before = await hashes(dir);
  expect(await openAndRead()).toMatchObject({ kind: "open" });
  expect(await hashes(dir)).toEqual(before);
});

it("ignores a -wal whose header checksum is damaged, as SQLite does", async () => {
  await crashed((db) => db.exec("insert into t (n) values (1)"));
  const wal = join(dir, "venue.db-wal");
  const bytes = await readFile(wal);
  bytes[24] ^= 0xff;
  await writeFile(wal, bytes);
  const sqlite = await sqliteReads();
  expect(sqlite.map(({ n }) => n)).toEqual([0]);
  expect(await inPlace()).toEqual(sqlite);
});

// Read in place, each of these retries for several seconds (14 to 20 measured) and fails; SQLite reading a copy ignores it.
it.each([
  ["a page size SQLite does not allow", (wal: Buffer) => (wal.writeUInt32BE(1000, 8), wal)],
  ["a wrong magic number", (wal: Buffer) => (wal.writeUInt32BE(0x377f0680, 0), wal)],
  ["only its header", (wal: Buffer) => wal.subarray(0, 32)],
  ["less than its header", (wal: Buffer) => wal.subarray(0, 20)],
] as const)("answers wal-header, opening nothing, for a -wal with %s", async (_label, damage) => {
  await crashed((db) => db.exec("insert into t (n) values (1)"));
  const wal = join(dir, "venue.db-wal");
  const bytes = await readFile(wal);
  await writeFile(wal, damage(bytes));
  expect((await sqliteReads()).map(({ n }) => n)).toEqual([0]);
  const before = await hashes(dir);
  expect(await openWalInPlace(path)).toEqual({ kind: "wal-header" });
  expect(await hashes(dir)).toEqual(before);
});

it("refuses a -wal of another format version, as SQLite does", async () => {
  await crashed((db) => db.exec("insert into t (n) values (1)"));
  const wal = join(dir, "venue.db-wal");
  const bytes = await readFile(wal);
  bytes.writeUInt32BE(3007001, 4);
  // Rewritten with checksums that hold, so only the version differs.
  await writeFile(wal, bigEndian(bytes));
  await expect(sqliteReads()).rejects.toMatchObject({ errcode: 14 });
  const before = await hashes(dir);
  await expect(inPlace()).rejects.toMatchObject({ errcode: 14 });
  expect(await hashes(dir)).toEqual(before);
});

it("answers not-a-file for a -wal that is a folder, and passes on any other failure to look", async () => {
  await crashed((db) => db.exec("insert into t (n) values (1)"), ["venue.db", "venue.db-shm"]);
  await mkdir(`${path}-wal`);
  expect(await openWalInPlace(path)).toEqual({ kind: "not-a-file" });
  await chmod(dir, 0o000);
  try {
    await expect(openWalInPlace(path)).rejects.toMatchObject({ code: "EACCES" });
  } finally {
    await chmod(dir, 0o700);
  }
});
