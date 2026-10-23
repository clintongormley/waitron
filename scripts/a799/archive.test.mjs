import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import * as archive from "./archive.mjs";

const digest = (b) => createHash("sha256").update(b).digest("hex");
const contents = Buffer.from("old state");
const directory = { path: "state", kind: "directory", mode: 448, bytes: 0, sha256: null };
const file = {
  path: "state/venue.db",
  kind: "file",
  mode: 384,
  bytes: 9,
  sha256: digest(contents),
};
const inventory = () => [directory, file].map((x) => ({ ...x }));
const limits = { compressedBytes: 4096, unpackedBytes: 4096, entries: 2, perFileBytes: 9 };
function raw(
  entries = inventory(),
  bodies = [Buffer.alloc(0), contents],
  magic = "a799-state-v1\n",
) {
  return Buffer.concat([
    Buffer.from(magic),
    ...entries.flatMap((e, i) => {
      const header = Buffer.from(typeof e === "string" ? e : JSON.stringify(e));
      const length = Buffer.alloc(4);
      length.writeUInt32BE(header.length);
      return [length, header, bodies[i]];
    }),
  ]);
}
async function* chunks(bytes, size = 7) {
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
}
function ioFor() {
  const placed = new Map();
  const calls = [];
  let inode = 10;
  const identity = (kind, mode) => ({
    kind,
    mode,
    dev: 1,
    ino: ++inode,
    nlink: 1,
    ownerId: "owned",
  });
  const root = identity("directory", 448);
  return {
    root: "/owned/root",
    cleanupMs: 100,
    ownerId: "owned",
    sourceIdentities: [],
    placed,
    calls,
    async inspectEntry(path) {
      calls.push(["inspect", path]);
      return path === "" ? root : placed.get(path)?.identity;
    },
    async createDirectory(entry) {
      calls.push(["mkdir", entry.path]);
      placed.set(entry.path, { identity: identity("directory", entry.mode) });
    },
    async openExclusiveNoFollow(entry) {
      calls.push(["open", entry.path]);
      const handle = {
        identity: identity("file", entry.mode),
        bytes: Buffer.alloc(0),
        path: entry.path,
      };
      placed.set(entry.path, handle);
      return handle;
    },
    async writeChunk(handle, bytes) {
      handle.bytes = Buffer.concat([handle.bytes, bytes]);
    },
    async finishVerifiedFile(handle) {
      calls.push(["finish", handle.path]);
    },
    async removeOwnedPartial() {
      calls.push(["cleanup"]);
      placed.clear();
    },
  };
}
const admit = (bytes = gzipSync(raw()), list = inventory(), caps = limits, io = ioFor()) =>
  archive.admitArchive(chunks(bytes), list, caps, io);

describe("sealed archive admission", () => {
  it("streams exact independently inventoried files with a compressed hash", async () => {
    const bytes = gzipSync(raw());
    const io = ioFor();
    expect(await admit(bytes, inventory(), limits, io)).toEqual({
      root: "/owned/root",
      ownerId: "owned",
      inventory: inventory(),
      archiveSha256: digest(bytes),
    });
    expect(io.placed.get("state/venue.db").bytes).toEqual(contents);
    expect(io.calls.filter(([name]) => name === "finish")).toEqual([["finish", "state/venue.db"]]);
  });
  it("keeps empty directories and zero-byte files", async () => {
    const list = [directory, { ...file, bytes: 0, sha256: digest(Buffer.alloc(0)) }];
    const io = ioFor();
    await admit(gzipSync(raw(list, [Buffer.alloc(0), Buffer.alloc(0)])), list, limits, io);
    expect(io.placed.get("state/venue.db").bytes.length).toBe(0);
    expect(io.placed.get("state").identity.kind).toBe("directory");
  });
  it.each([
    "/escape",
    "C:/escape",
    "C:escape",
    "//host/path",
    "state/../escape",
    "state/./x",
    "state//x",
    "state/",
    "state\\x",
    "state/\0x",
    ".",
    "..",
    "state/name.",
    "state/name ",
    "state/\nx",
  ])("refuses unsafe inventory path %j before placement", async (path) => {
    const io = ioFor();
    await expect(admit(undefined, [{ ...directory, path }], limits, io)).rejects.toThrow(
      "archive.path",
    );
    expect(io.calls).toEqual([]);
  });
  it.each(["symlink", "hardlink", "socket", "fifo", "device"])(
    "refuses the unrepresentable %s type",
    async (kind) => {
      const io = ioFor();
      await expect(admit(undefined, [{ ...file, kind }], limits, io)).rejects.toThrow(
        "archive.inventory",
      );
      expect(io.calls).toEqual([]);
    },
  );
  it.each([0, 511, 420, 2541, -1, 1.5])(
    "refuses file mode %s, including nonprivate secrets",
    async (mode) => {
      const io = ioFor();
      await expect(admit(undefined, [directory, { ...file, mode }], limits, io)).rejects.toThrow(
        "archive.inventory",
      );
      expect(io.calls).toEqual([]);
    },
  );
  it.each(
    [
      [directory, directory],
      [directory, { ...directory, path: "STATE" }],
      [
        { ...directory, path: "caf\u00e9" },
        { ...directory, path: "cafe\u0301" },
      ],
      [{ ...file, path: "missing/file" }],
      [file, directory],
      [directory, { ...file, unexpected: true }],
      [{ ...directory, bytes: 1 }],
      [{ ...directory, sha256: digest(contents) }],
      [directory, { ...file, sha256: "z".repeat(64) }],
      [],
    ].map((list) => [list]),
  )("refuses ambiguous or incomplete external inventory %#", async (list) => {
    const io = ioFor();
    await expect(admit(undefined, list, limits, io)).rejects.toThrow("archive.inventory");
    expect(io.calls).toEqual([]);
  });
  it.each([
    ["compressedBytes", (b) => b.length - 1],
    ["unpackedBytes", () => raw().length - 1],
    ["perFileBytes", () => 8],
    ["entries", () => 1],
  ])("enforces %s with an accepting exact-boundary control", async (key, bound) => {
    const bytes = gzipSync(raw());
    await expect(admit(bytes, inventory(), { ...limits, [key]: bound(bytes) })).rejects.toThrow(
      "archive.limit",
    );
    const exact = {
      compressedBytes: bytes.length,
      unpackedBytes: raw().length,
      entries: 2,
      perFileBytes: 9,
    };
    expect((await admit(bytes, inventory(), exact)).archiveSha256).toBe(digest(bytes));
  });
  it("bounds a gzip expansion even when its compressed bytes fit", async () => {
    const bytes = gzipSync(Buffer.alloc(1000000));
    await expect(admit(bytes, inventory(), { ...limits, unpackedBytes: 1024 })).rejects.toThrow(
      "archive.limit",
    );
  });
  it.each([
    ["bad magic", () => raw(inventory(), undefined, "a799-state-v2\n"), "archive.format"],
    ["truncated magic", () => Buffer.from("a799"), "archive.truncated"],
    ["truncated length", () => Buffer.concat([raw(), Buffer.from([0])]), "archive.trailing"],
    ["truncated file", () => raw().subarray(0, -1), "archive.truncated"],
    ["missing entry", () => raw([directory], [Buffer.alloc(0)]), "archive.truncated"],
    [
      "extra entry",
      () =>
        raw(
          [...inventory(), { ...file, path: "state/other" }],
          [Buffer.alloc(0), contents, contents],
        ),
      "archive.trailing",
    ],
    [
      "corrupt body",
      () => raw(inventory(), [Buffer.alloc(0), Buffer.from("new state")]),
      "archive.hash",
    ],
    ["wrong mode", () => raw([directory, { ...file, mode: 420 }]), "archive.entry"],
    ["undeclared file", () => raw([directory, { ...file, path: "state/other" }]), "archive.entry"],
    ["forged length", () => raw([directory, { ...file, bytes: 999999999 }]), "archive.entry"],
    [
      "duplicate key",
      () =>
        raw([
          JSON.stringify(directory).replace('"path":"state"', '"path":"state","path":"state"'),
          file,
        ]),
      "archive.header",
    ],
    [
      "escaped duplicate key",
      () =>
        raw([
          JSON.stringify(directory).replace(
            '"path":"state"',
            '"path":"state","pa\\u0074h":"state"',
          ),
          file,
        ]),
      "archive.header",
    ],
    ["unknown key", () => raw([{ ...directory, extra: 1 }, file]), "archive.header"],
    [
      "invalid utf8",
      () => {
        const b = raw();
        b[20] = 255;
        return b;
      },
      "archive.header",
    ],
    [
      "oversized header",
      () => {
        const b = raw();
        b.writeUInt32BE(0xffffffff, 14);
        return b;
      },
      "archive.header",
    ],
  ])("refuses %s and removes owned partial files", async (_name, bytes, code) => {
    const io = ioFor();
    await expect(admit(gzipSync(bytes()), inventory(), limits, io)).rejects.toThrow(code);
    expect(io.placed.size).toBe(0);
    expect(io.calls.at(-1)).toEqual(["cleanup"]);
  });
  it("refuses a truncated gzip footer", async () => {
    const io = ioFor();
    await expect(admit(gzipSync(raw()).subarray(0, -4), inventory(), limits, io)).rejects.toThrow(
      "archive.gzip",
    );
    expect(io.placed.size).toBe(0);
  });
  it.each([
    "root mode",
    "root owner",
    "parent replaced",
    "shared inode",
    "multiply linked",
    "file replaced",
    "file mode",
  ])("refuses %s reported by the placement adapter", async (fault) => {
    const io = ioFor();
    const inspect = io.inspectEntry;
    io.sourceIdentities = fault === "shared inode" ? [{ dev: 1, ino: 13 }] : [];
    let fileInspections = 0;
    io.inspectEntry = async (path) => {
      const stat = await inspect(path);
      if (path === "" && fault === "root mode") return { ...stat, mode: 493 };
      if (path === "" && fault === "root owner") return { ...stat, ownerId: "other" };
      if (path === "state" && fault === "parent replaced") return { ...stat, kind: "symlink" };
      if (path === "state/venue.db") {
        fileInspections++;
        if (fault === "multiply linked") return { ...stat, nlink: 2 };
        if (fault === "file mode") return { ...stat, mode: 420 };
        if (fault === "file replaced" && fileInspections > 1) return { ...stat, ino: 99 };
      }
      return stat;
    };
    await expect(admit(undefined, inventory(), limits, io)).rejects.toThrow("archive.placement");
    expect(io.placed.size).toBe(0);
  });
  it("reports cleanup failure without returning a verified handle", async () => {
    const io = ioFor();
    io.removeOwnedPartial = async () => {
      throw new Error("secret cleanup error");
    };
    await expect(admit(gzipSync(raw().subarray(0, -1)), inventory(), limits, io)).rejects.toThrow(
      "archive.cleanup",
    );
  });
  it("honours cancellation during a stalled input", async () => {
    const controller = new globalThis.AbortController();
    const io = ioFor();
    io.signal = controller.signal;
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield await new Promise(() => {});
      },
    };
    const pending = archive.admitArchive(stream, inventory(), limits, io);
    controller.abort();
    await expect(pending).rejects.toThrow("archive.cancelled");
    expect(io.placed.size).toBe(0);
  });
});

describe("archive boundary controls", () => {
  it("binds the opened handle to the first observed directory entry", async () => {
    const io = ioFor();
    const open = io.openExclusiveNoFollow;
    io.openExclusiveNoFollow = async (entry) => {
      const handle = await open(entry);
      const original = { ...handle.identity };
      handle.identity.ino = 999;
      return { ...handle, identity: original };
    };
    await expect(admit(undefined, inventory(), limits, io)).rejects.toThrow("archive.placement");
  });
  it("does not accept non-JSON header whitespace", async () => {
    const header = JSON.stringify(directory).replace(":", ":\v");
    await expect(admit(gzipSync(raw([header, file])))).rejects.toThrow("archive.header");
  });
  it("bounds cleanup after an admission refusal", async () => {
    const io = ioFor();
    io.cleanupMs = 10;
    io.removeOwnedPartial = () => new Promise(() => {});
    await expect(admit(gzipSync(raw().subarray(0, -1)), inventory(), limits, io)).rejects.toThrow(
      "archive.cleanup",
    );
  });
  it("checks a public header against its independent inventory", () => {
    expect(archive.validateEntry(file, inventory(), limits)).toBeUndefined();
    expect(() => archive.validateEntry({ ...file, bytes: 8 }, inventory(), limits)).toThrow(
      "archive.entry",
    );
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, undefined])(
    "refuses an invalid resource cap %s before opening an input",
    async (cap) => {
      const io = ioFor();
      await expect(admit(undefined, inventory(), { ...limits, entries: cap }, io)).rejects.toThrow(
        "archive.limit",
      );
      expect(io.calls).toEqual([]);
    },
  );
  it.each([
    null,
    [],
    { ...directory, path: 12 },
    { ...file, bytes: -1 },
    { ...file, bytes: 1.5 },
    { ...file, sha256: null },
  ])("refuses malformed inventory entry %#", async (entry) => {
    const io = ioFor();
    await expect(admit(undefined, [entry], limits, io)).rejects.toThrow(
      /^archive\.(inventory|path)/,
    );
    expect(io.calls).toEqual([]);
  });
  it("bounds the inventoried body sum before placement", async () => {
    const list = [directory, { ...file, bytes: 9 }, { ...file, path: "state/other", bytes: 9 }];
    const io = ioFor();
    await expect(
      admit(undefined, list, { ...limits, entries: 3, unpackedBytes: 17 }, io),
    ).rejects.toThrow("archive.limit");
    expect(io.calls).toEqual([]);
  });
  it.each(["bytes", "stream error", "I/O error", "root path", "root id"])(
    "refuses %s without exposing adapter messages",
    async (fault) => {
      const io = ioFor();
      let stream = chunks(gzipSync(raw()));
      if (fault === "bytes")
        stream = (async function* () {
          yield "not bytes";
        })();
      if (fault === "stream error")
        stream = {
          [Symbol.asyncIterator]() {
            return {
              next() {
                return Promise.reject(new Error("SENTINEL"));
              },
            };
          },
        };
      if (fault === "I/O error")
        io.openExclusiveNoFollow = async () => {
          throw new Error("SENTINEL");
        };
      if (fault === "root path") io.root = "relative";
      if (fault === "root id") io.ownerId = "";
      let error;
      try {
        await archive.admitArchive(stream, inventory(), limits, io);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(Error);
      expect(error?.message).toMatch(/^archive\.(format|placement):/);
      expect(error.message).not.toContain("SENTINEL");
      expect(io.placed.size).toBe(0);
    },
  );
  it.each([
    "[]",
    "{}",
    '{"path" "state"}',
    '{"path":"state";}',
    '{"path":false}',
    '{"path":[]}',
    '{"path":"unterminated}',
    JSON.stringify(directory) + " extra",
    JSON.stringify(directory).replace('"state"', '"st\\u0061te"'),
  ])("reads only exact scalar header JSON %#", (header) => {
    if (header.includes("st\\u0061te"))
      expect(archive.parseHeader(Buffer.from(header))).toEqual(directory);
    else expect(() => archive.parseHeader(Buffer.from(header))).toThrow("archive.header");
  });
});

describe("remaining archive placement boundaries", () => {
  it("checks every ancestor of a nested private directory", async () => {
    const list = [
      directory,
      { ...directory, path: "state/empty" },
      { ...file, path: "state/empty/venue.db" },
    ];
    const io = ioFor();
    await admit(
      gzipSync(raw(list, [Buffer.alloc(0), Buffer.alloc(0), contents])),
      list,
      { ...limits, entries: 3 },
      io,
    );
    expect(io.placed.get("state/empty/venue.db").bytes).toEqual(contents);
    expect(
      io.calls.filter(([name, path]) => name === "inspect" && path === "state/empty").length,
    ).toBeGreaterThan(1);
  });
  it("reports missing cleanup budget instead of leaving a verified result", async () => {
    const io = ioFor();
    delete io.cleanupMs;
    await expect(admit(gzipSync(raw().subarray(0, -1)), inventory(), limits, io)).rejects.toThrow(
      "archive.cleanup",
    );
  });
});
