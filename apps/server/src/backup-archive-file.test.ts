import { createHash } from "node:crypto";
import { mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as fileIo from "./artifact-file-io.js";
import { packArchive, unpackArchive } from "./backup-archive.js";
import { packArchiveStream, unpackArchiveFile } from "./backup-archive-file.js";

const dirs: string[] = [];
async function scratch() {
  const dir = await mkdtemp(join(tmpdir(), "archive-file-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function collect(input: AsyncIterable<Uint8Array>) {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    expect(chunk.length).toBeLessThanOrEqual(65536);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
const invalid = (reason: string) =>
  expect.objectContaining({ code: "backup.archive_invalid", params: { reason } });

describe("file archive", () => {
  it("writes the byte codec's exact framing and reads its binary, non-ASCII and empty entries", async () => {
    const dir = await scratch();
    const database = Buffer.from([0, 255, 1, 254]);
    await writeFile(join(dir, "input"), database);
    const bytes = [
      { name: "manifest.json", bytes: Buffer.from("{}") },
      { name: "db.dump", bytes: database },
      { name: "menú/☕", bytes: Buffer.alloc(0) },
    ];
    const framed = await collect(
      packArchiveStream([
        { kind: "bytes", entry: bytes[0] },
        { kind: "file", name: "db.dump", path: join(dir, "input") },
        { kind: "bytes", entry: bytes[2] },
      ]),
    );
    expect(framed.equals(packArchive(bytes))).toBe(true);
    expect(unpackArchive(framed)).toEqual(bytes);
    await writeFile(join(dir, "archive"), Buffer.concat([framed, Buffer.from("trailing")]));
    const entries = await unpackArchiveFile(join(dir, "archive"), dir);
    expect(entries).toEqual([
      { kind: "bytes", entry: bytes[0] },
      { kind: "file", name: "db.dump", path: join(dir, "venue.db") },
      { kind: "bytes", entry: bytes[2] },
    ]);
    expect((await readFile(join(dir, "venue.db"))).equals(database)).toBe(true);
    expect((await stat(join(dir, "venue.db"))).mode & 0o777).toBe(0o600);
    expect(await collect(packArchiveStream([]))).toEqual(packArchive([]));
  });
  it("keeps duplicate database names without overwriting the first extracted database", async () => {
    const dir = await scratch();
    const path = join(dir, "archive");
    await writeFile(
      path,
      packArchive([
        { name: "db.dump", bytes: Buffer.from("first") },
        { name: "db.dump", bytes: Buffer.from("second") },
      ]),
    );
    const entries = await unpackArchiveFile(path, dir);
    expect(entries.map((e) => (e.kind === "file" ? e.name : e.entry.name))).toEqual([
      "db.dump",
      "db.dump",
    ]);
    expect((await readFile(join(dir, "venue.db"))).toString()).toBe("first");
  });
  it.each([
    [Buffer.alloc(2), "too_short"],
    [Buffer.alloc(9), "bad_magic"],
    [Buffer.from("574241316300000000", "hex"), "bad_version"],
    [Buffer.from("5742413101ffffffff", "hex"), "entry_count_too_large"],
  ])("rejects invalid header %s", async (bytes, reason) => {
    const dir = await scratch();
    const path = join(dir, "archive");
    await writeFile(path, bytes);
    await expect(unpackArchiveFile(path, dir)).rejects.toEqual(invalid(reason));
    expect(await readdir(dir)).toEqual(["archive"]);
  });
  it.each([
    [54, "name_len_truncated"],
    [58, "name_truncated"],
    [60, "data_len_truncated"],
  ])("rejects truncated fields at %i", async (length, reason) => {
    const dir = await scratch();
    const path = join(dir, "archive");
    const good = packArchive([
      { name: "a".repeat(30), bytes: Buffer.from("y") },
      { name: reason === "data_len_truncated" ? "x" : "hello", bytes: Buffer.from("y") },
    ]);
    await writeFile(path, good.subarray(0, length));
    await expect(unpackArchiveFile(path, dir)).rejects.toEqual(invalid(reason));
  });
  it("rejects a huge u64 before allocation and removes its extracted database on later refusal", async () => {
    const dir = await scratch();
    const path = join(dir, "archive");
    const bytes = packArchive([
      { name: "db.dump", bytes: Buffer.from("first") },
      { name: "x", bytes: Buffer.from("y") },
    ]);
    bytes.writeBigUInt64LE(0xffffffffffffffffn, bytes.length - 9);
    await writeFile(path, bytes);
    await expect(unpackArchiveFile(path, dir)).rejects.toEqual(invalid("data_truncated"));
    expect(await readdir(dir)).toEqual(["archive"]);
  });
  it("bounds name bytes, entry count and aggregate metadata in both directions", async () => {
    const dir = await scratch();
    const path = join(dir, "archive");
    for (const [entries, reason] of [
      [[{ name: "☕".repeat(1366), bytes: Buffer.alloc(0) }], "name_too_large"],
      [
        Array.from({ length: 4097 }, () => ({ name: "", bytes: Buffer.alloc(0) })),
        "entry_count_too_large",
      ],
      [
        [
          { name: "a", bytes: Buffer.alloc(8 * 1024 * 1024) },
          { name: "b", bytes: Buffer.alloc(8 * 1024 * 1024 + 1) },
        ],
        "metadata_too_large",
      ],
    ] as const) {
      await writeFile(path, packArchive([...entries]));
      await expect(unpackArchiveFile(path, dir)).rejects.toEqual(invalid(reason));
      await expect(
        collect(packArchiveStream(entries.map((entry) => ({ kind: "bytes" as const, entry })))),
      ).rejects.toEqual(invalid(reason));
    }
  });
  it("streams several chunks with the same content hash", async () => {
    const dir = await scratch();
    const payload = Buffer.alloc(65536 * 3 + 17, 173);
    await writeFile(join(dir, "input"), payload);
    const reads = vi.spyOn(fileIo, "readExactly");
    const framed = await collect(
      packArchiveStream([{ kind: "file", name: "db.dump", path: join(dir, "input") }]),
    );
    expect(createHash("sha256").update(unpackArchive(framed)[0].bytes).digest("hex")).toBe(
      createHash("sha256").update(payload).digest("hex"),
    );
    await writeFile(join(dir, "archive"), framed);
    await unpackArchiveFile(join(dir, "archive"), dir);
    expect((await readFile(join(dir, "venue.db"))).equals(payload)).toBe(true);
    expect(Math.max(...reads.mock.calls.map((call) => call[1]))).toBe(65536);
  });
  it("skips a sparse duplicate segment beyond 2 GiB without allocating or replacing the first database", async () => {
    const dir = await scratch();
    const path = join(dir, "archive");
    const header = packArchive([
      { name: "db.dump", bytes: Buffer.from("first") },
      { name: "db.dump", bytes: Buffer.alloc(0) },
    ]);
    header.writeUInt32LE(3, 5);
    header.writeBigUInt64LE(2147487744n, header.length - 8);
    const tail = packArchive([{ name: "after", bytes: Buffer.from("LAST") }]).subarray(9);
    const file = await open(path, "wx");
    try {
      await file.write(header);
      await file.truncate(header.length + 2147487744);
      await file.write(Buffer.from("END"), 0, 3, header.length + 2147487744 - 3);
      await file.write(tail, 0, tail.length, header.length + 2147487744);
    } finally {
      await file.close();
    }
    const reads = vi.spyOn(fileIo, "readExactly");
    const entries = await unpackArchiveFile(path, dir);
    expect(Math.max(...reads.mock.calls.map((call) => call[1]))).toBeLessThanOrEqual(65536);
    expect(reads.mock.calls.some((call) => call[2] > 2147487744)).toBe(true);
    expect(entries[2]).toEqual({
      kind: "bytes",
      entry: { name: "after", bytes: Buffer.from("LAST") },
    });
    expect(entries).toHaveLength(3);
    expect((await readFile(join(dir, "venue.db"))).toString()).toBe("first");
  });
  it("does not overwrite a pre-existing output and leaves it on refusal", async () => {
    const dir = await scratch();
    const path = join(dir, "archive");
    await writeFile(path, packArchive([{ name: "db.dump", bytes: Buffer.from("new") }]));
    await writeFile(join(dir, "venue.db"), "old");
    await expect(unpackArchiveFile(path, dir)).rejects.toMatchObject({ code: "EEXIST" });
    expect((await readFile(join(dir, "venue.db"))).toString()).toBe("old");
  });
  it("removes partial extraction after read or write failure and preserves the archive", async () => {
    const dir = await scratch();
    const path = join(dir, "archive");
    const framed = packArchive([{ name: "db.dump", bytes: Buffer.alloc(150000, 97) }]);
    await writeFile(path, framed);
    for (const side of ["read", "write"] as const) {
      const failure = new Error(side + " failed");
      if (side === "write") vi.spyOn(fileIo, "writeAll").mockRejectedValueOnce(failure);
      else {
        const real = fileIo.readExactly;
        vi.spyOn(fileIo, "readExactly").mockImplementation(async (...args) => {
          if (args[1] === 65536) throw failure;
          return real(...args);
        });
      }
      await expect(unpackArchiveFile(path, dir)).rejects.toBe(failure);
      expect(await readdir(dir)).toEqual(["archive"]);
      expect((await readFile(path)).equals(framed)).toBe(true);
      vi.restoreAllMocks();
    }
  });
  it("propagates a missing file and refuses non-database file entries", async () => {
    const dir = await scratch();
    await expect(
      collect(packArchiveStream([{ kind: "file", name: "db.dump", path: join(dir, "missing") }])),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      collect(packArchiveStream([{ kind: "file", name: "secret", path: join(dir, "missing") }])),
    ).rejects.toEqual(invalid("unexpected_file_entry"));
  });
});

it("requires exact framing only when requested and cleans a refused extraction", async () => {
  const dir = await scratch();
  const path = join(dir, "archive");
  const framed = packArchive([{ name: "db.dump", bytes: Buffer.from("database") }]);
  await writeFile(path, Buffer.concat([framed, Buffer.from("tail")]));
  await expect(unpackArchiveFile(path, dir, { requireExactEnd: true })).rejects.toEqual(
    invalid("trailing_data"),
  );
  expect(await readdir(dir)).toEqual(["archive"]);
  await writeFile(path, framed);
  const entries = await unpackArchiveFile(path, dir, { requireExactEnd: true });
  expect(entries).toEqual([{ kind: "file", name: "db.dump", path: join(dir, "venue.db") }]);
  expect((await readFile(join(dir, "venue.db"))).toString()).toBe("database");
});
