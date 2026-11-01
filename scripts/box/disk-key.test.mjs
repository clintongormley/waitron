import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { constants } from "node:fs";
import {
  HOST_ROOT,
  createDiskRecoveryStore,
  storeDiskRecovery,
  withDiskRecovery,
} from "./disk-key.mjs";

const DISK_A = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";
const DISK_B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const KEY = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256);
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const recordText = (diskUuid, keyHex = hex(KEY)) =>
  JSON.stringify({ version: 1, diskUuid, key: keyHex }) + "\n";
const refused = (reason) => expect.objectContaining({ code: "disk_recovery.refused", reason });

const parents = [];
afterEach(async () => {
  for (const parent of parents.splice(0)) await fs.rm(parent, { recursive: true, force: true });
});

const rootIdOf = async (path) => {
  const stats = await fs.lstat(path, { bigint: true });
  return { dev: stats.dev, ino: stats.ino, rootId: `${stats.dev}:${stats.ino}` };
};

const syncPath = async (path, flags) => {
  const handle = await fs.open(path, flags);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};
const REAL_IO = {
  lstat: fs.lstat,
  open: fs.open,
  mkdir: fs.mkdir,
  writeFile: fs.writeFile,
  rename: fs.rename,
  unlink: fs.unlink,
  readdir: fs.readdir,
  syncFile: (path) => syncPath(path, constants.O_RDONLY),
  syncDirectory: (path) => syncPath(path, constants.O_RDONLY | constants.O_DIRECTORY),
};

/** A real io that counts every call; `overrides` replace single operations. */
function countingIo(overrides = {}) {
  const calls = [];
  const io = {};
  for (const name of Object.keys(REAL_IO)) {
    const run = overrides[name] ?? REAL_IO[name];
    io[name] = (...args) => {
      calls.push(name);
      return run(...args);
    };
  }
  return { io, calls };
}

/** Stats whose `uid` reads as someone else's, everything else unchanged. */
const foreignOwner = (stats) =>
  new Proxy(stats, {
    get(target, key) {
      if (key === "uid") return typeof target.uid === "bigint" ? target.uid + 1n : target.uid + 1;
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

async function fixture({ record = true, folder: withFolder = true } = {}) {
  const parent = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "b3-disk-key-")));
  parents.push(parent);
  const hostRoot = join(parent, "host");
  await fs.mkdir(hostRoot, { mode: 0o700 });
  await fs.chmod(hostRoot, 0o700);
  const folder = join(hostRoot, "disk-recovery");
  if (withFolder) {
    await fs.mkdir(folder, { mode: 0o700 });
    await fs.chmod(folder, 0o700);
  }
  const writeRecord = async (name, text, dir = folder) => {
    const path = join(dir, name);
    await fs.writeFile(path, text, { mode: 0o600 });
    await fs.chmod(path, 0o600);
    return path;
  };
  if (record) await writeRecord(`${DISK_A}.json`, recordText(DISK_A));
  const { rootId } = await rootIdOf(hostRoot);
  const answer = { hostRoot, diskUuid: DISK_A, rootId };
  const inspectHostState = vi.fn(async () => ({ ...answer }));
  const counting = countingIo();
  const make = (deps = {}) =>
    createDiskRecoveryStore({
      hostRoot,
      ownerUid: process.getuid(),
      inspectHostState,
      io: counting.io,
      ...deps,
    });
  return { parent, hostRoot, folder, writeRecord, answer, inspectHostState, counting, make };
}

/** Calls withKey and returns a copy of what consume saw, plus the array it was handed. */
async function readKey(store, diskUuid = DISK_A) {
  let handed;
  let copy;
  await store.withKey({ diskUuid }, async (key) => {
    handed = key;
    copy = Uint8Array.from(key);
  });
  return { handed, copy };
}

describe("withKey: reading", () => {
  it("withKey hands consume exactly the stored 32 bytes, then the array is all zeros", async () => {
    const f = await fixture();
    const { handed, copy } = await readKey(f.make());
    expect(copy).toEqual(KEY);
    expect(handed).toBeInstanceOf(Uint8Array);
    expect(handed.length).toBe(32);
    expect(handed.every((byte) => byte === 0)).toBe(true);
  });

  it("a throwing consume → the same error rethrown, and the array still zeroed", async () => {
    const f = await fixture();
    const failure = new Error("consumer failed");
    let handed;
    await expect(
      f.make().withKey({ diskUuid: DISK_A }, async (key) => {
        handed = key;
        expect(Uint8Array.from(key)).toEqual(KEY);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(handed.every((byte) => byte === 0)).toBe(true);
  });

  it("withKey returns undefined even when consume returns a value", async () => {
    const f = await fixture();
    await expect(f.make().withKey({ diskUuid: DISK_A }, async () => "value")).resolves.toBe(
      undefined,
    );
  });

  it("releases the turn before consume, so a consume that reads again does not wait on itself", async () => {
    const f = await fixture();
    const store = f.make();
    let inner;
    await store.withKey({ diskUuid: DISK_A }, async () => {
      inner = await readKey(store);
    });
    expect(inner.copy).toEqual(KEY);
  });
});

describe("withKey: the mount check (Review Focus 4)", () => {
  it("inspectHostState throws → mount-unverified; consume not called; the counting io saw zero calls", async () => {
    const f = await fixture();
    const consume = vi.fn();
    const store = f.make({
      inspectHostState: async () => {
        throw new Error("no mount");
      },
    });
    await expect(store.withKey({ diskUuid: DISK_A }, consume)).rejects.toEqual(
      refused("mount-unverified"),
    );
    expect(consume).not.toHaveBeenCalled();
    expect(f.counting.calls).toEqual([]);
  });

  it.each([
    ["an extra key", (a) => ({ ...a, layoutDigest: "x" })],
    [
      "a missing rootId",
      (a) => {
        delete a.rootId;
        return a;
      },
    ],
    ['rootId "x"', (a) => ({ ...a, rootId: "x" })],
    ["an upper-case UUID", (a) => ({ ...a, diskUuid: a.diskUuid.toUpperCase() })],
    ["a non-object answer", () => null],
    ["a numeric hostRoot", (a) => ({ ...a, hostRoot: 1 })],
  ])("the seam answers with %s → mount-unverified, zero io calls", async (_, change) => {
    const f = await fixture();
    const consume = vi.fn();
    const store = f.make({ inspectHostState: async () => change({ ...f.answer }) });
    await expect(store.withKey({ diskUuid: DISK_A }, consume)).rejects.toEqual(
      refused("mount-unverified"),
    );
    expect(consume).not.toHaveBeenCalled();
    expect(f.counting.calls).toEqual([]);
  });

  it("the seam reports another hostRoot → mount-unverified", async () => {
    const f = await fixture();
    const store = f.make({ inspectHostState: async () => ({ ...f.answer, hostRoot: f.parent }) });
    await expect(store.withKey({ diskUuid: DISK_A }, vi.fn())).rejects.toEqual(
      refused("mount-unverified"),
    );
    expect(f.counting.calls).toEqual([]);
  });

  it("the seam reports disk B → disk-mismatch", async () => {
    const f = await fixture();
    const store = f.make({ inspectHostState: async () => ({ ...f.answer, diskUuid: DISK_B }) });
    await expect(store.withKey({ diskUuid: DISK_A }, vi.fn())).rejects.toEqual(
      refused("disk-mismatch"),
    );
    expect(f.counting.calls).toEqual([]);
  });

  it("the seam's rootId has the real inode but a different device → root-changed", async () => {
    const f = await fixture();
    const { dev, ino } = await rootIdOf(f.hostRoot);
    const store = f.make({
      inspectHostState: async () => ({ ...f.answer, rootId: `${dev + 1n}:${ino}` }),
    });
    await expect(store.withKey({ diskUuid: DISK_A }, vi.fn())).rejects.toEqual(
      refused("root-changed"),
    );
  });

  it("the seam's rootId has the same device but a different inode → root-changed", async () => {
    const f = await fixture();
    const { dev, ino } = await rootIdOf(f.hostRoot);
    const store = f.make({
      inspectHostState: async () => ({ ...f.answer, rootId: `${dev}:${ino + 1n}` }),
    });
    await expect(store.withKey({ diskUuid: DISK_A }, vi.fn())).rejects.toEqual(
      refused("root-changed"),
    );
  });

  it("the fixed storeDiskRecovery → mount-unverified", async () => {
    await expect(storeDiskRecovery({ diskUuid: DISK_A, key: KEY })).rejects.toEqual(
      refused("mount-unverified"),
    );
  });

  it("the fixed withDiskRecovery → mount-unverified", async () => {
    expect(HOST_ROOT).toBe("/var/lib/waitron-host");
    const consume = vi.fn();
    await expect(withDiskRecovery({ diskUuid: DISK_A }, consume)).rejects.toEqual(
      refused("mount-unverified"),
    );
    expect(consume).not.toHaveBeenCalled();
  });
});

describe("withKey: folder replaced or missing", () => {
  async function replaceWithLink(f) {
    const copy = join(f.parent, "copy");
    await fs.rename(f.hostRoot, copy);
    await fs.symlink(copy, f.hostRoot);
  }

  it("hostRoot replaced by a symlink to a copy holding a valid record → root-changed", async () => {
    const f = await fixture();
    await replaceWithLink(f);
    const consume = vi.fn();
    await expect(f.make().withKey({ diskUuid: DISK_A }, consume)).rejects.toEqual(
      refused("root-changed"),
    );
    expect(consume).not.toHaveBeenCalled();
  });

  it("the same, but the stand-in reports the link's own lstat identity → path-unsafe", async () => {
    const f = await fixture();
    await replaceWithLink(f);
    const { rootId } = await rootIdOf(f.hostRoot);
    const store = f.make({ inspectHostState: async () => ({ ...f.answer, rootId }) });
    await expect(store.withKey({ diskUuid: DISK_A }, vi.fn())).rejects.toEqual(
      refused("path-unsafe"),
    );
  });

  it("hostRoot is a regular file with the reported identity → path-unsafe", async () => {
    const f = await fixture();
    await fs.rm(f.hostRoot, { recursive: true });
    await fs.writeFile(f.hostRoot, "", { mode: 0o600 });
    const { rootId } = await rootIdOf(f.hostRoot);
    const store = f.make({ inspectHostState: async () => ({ ...f.answer, rootId }) });
    await expect(store.withKey({ diskUuid: DISK_A }, vi.fn())).rejects.toEqual(
      refused("path-unsafe"),
    );
  });

  it("hostRoot removed → mount-unverified", async () => {
    const f = await fixture();
    await fs.rm(f.hostRoot, { recursive: true });
    await expect(f.make().withKey({ diskUuid: DISK_A }, vi.fn())).rejects.toEqual(
      refused("mount-unverified"),
    );
    expect(f.counting.calls).toEqual(["lstat"]);
  });

  it("no disk-recovery folder → record-missing", async () => {
    const f = await fixture();
    await fs.rm(f.folder, { recursive: true });
    await expect(f.make().withKey({ diskUuid: DISK_A }, vi.fn())).rejects.toEqual(
      refused("record-missing"),
    );
  });
});

describe("withKey: another disk's key (Review Focus 5)", () => {
  it("record for disk A, request for disk B (stand-in also reports B) → record-missing, consume not called", async () => {
    const f = await fixture();
    const consume = vi.fn();
    const store = f.make({ inspectHostState: async () => ({ ...f.answer, diskUuid: DISK_B }) });
    await expect(store.withKey({ diskUuid: DISK_B }, consume)).rejects.toEqual(
      refused("record-missing"),
    );
    expect(consume).not.toHaveBeenCalled();
  });

  it("disk A's record copied under B's file name → record-mismatch", async () => {
    const f = await fixture();
    await f.writeRecord(`${DISK_B}.json`, recordText(DISK_A));
    const consume = vi.fn();
    const store = f.make({ inspectHostState: async () => ({ ...f.answer, diskUuid: DISK_B }) });
    await expect(store.withKey({ diskUuid: DISK_B }, consume)).rejects.toEqual(
      refused("record-mismatch"),
    );
    expect(consume).not.toHaveBeenCalled();
  });
});

describe("withKey: symlinks inside the root", () => {
  it("disk-recovery is a symlink to a folder holding a valid record → path-unsafe", async () => {
    const f = await fixture();
    const elsewhere = join(f.parent, "elsewhere");
    await fs.rename(f.folder, elsewhere);
    await fs.symlink(elsewhere, f.folder);
    await expect(f.make().withKey({ diskUuid: DISK_A }, vi.fn())).rejects.toEqual(
      refused("path-unsafe"),
    );
  });

  it("disk-recovery is a regular file → path-unsafe", async () => {
    const f = await fixture();
    await fs.rm(f.folder, { recursive: true });
    await fs.writeFile(f.folder, "", { mode: 0o600 });
    await expect(f.make().withKey({ diskUuid: DISK_A }, vi.fn())).rejects.toEqual(
      refused("path-unsafe"),
    );
  });

  it("the record is a symlink → path-unsafe", async () => {
    const f = await fixture();
    const target = await f.writeRecord("target.json", recordText(DISK_A), f.parent);
    await fs.rm(join(f.folder, `${DISK_A}.json`));
    await fs.symlink(target, join(f.folder, `${DISK_A}.json`));
    await expect(f.make().withKey({ diskUuid: DISK_A }, vi.fn())).rejects.toEqual(
      refused("path-unsafe"),
    );
  });

  it("the record is a folder → path-unsafe", async () => {
    const f = await fixture();
    await fs.rm(join(f.folder, `${DISK_A}.json`));
    await fs.mkdir(join(f.folder, `${DISK_A}.json`), { mode: 0o700 });
    await expect(f.make().withKey({ diskUuid: DISK_A }, vi.fn())).rejects.toEqual(
      refused("path-unsafe"),
    );
  });
});

describe("withKey: permissions, one level at a time", () => {
  it("hostRoot mode 0755 → permissions-unsafe", async () => {
    const f = await fixture();
    await fs.chmod(f.hostRoot, 0o755);
    await expect(f.make().withKey({ diskUuid: DISK_A }, vi.fn())).rejects.toEqual(
      refused("permissions-unsafe"),
    );
  });

  it("disk-recovery mode 0755 → permissions-unsafe", async () => {
    const f = await fixture();
    await fs.chmod(f.folder, 0o755);
    await expect(f.make().withKey({ diskUuid: DISK_A }, vi.fn())).rejects.toEqual(
      refused("permissions-unsafe"),
    );
  });

  it("record mode 0644 → permissions-unsafe", async () => {
    const f = await fixture();
    await fs.chmod(join(f.folder, `${DISK_A}.json`), 0o644);
    await expect(f.make().withKey({ diskUuid: DISK_A }, vi.fn())).rejects.toEqual(
      refused("permissions-unsafe"),
    );
  });

  const lstatForeignAt = (path) => async (target, options) => {
    const stats = await fs.lstat(target, options);
    return target === path ? foreignOwner(stats) : stats;
  };

  it("hostRoot owner wrong → permissions-unsafe", async () => {
    const f = await fixture();
    const { io } = countingIo({ lstat: lstatForeignAt(f.hostRoot) });
    await expect(f.make({ io }).withKey({ diskUuid: DISK_A }, vi.fn())).rejects.toEqual(
      refused("permissions-unsafe"),
    );
  });

  it("disk-recovery owner wrong → permissions-unsafe", async () => {
    const f = await fixture();
    const { io } = countingIo({ lstat: lstatForeignAt(f.folder) });
    await expect(f.make({ io }).withKey({ diskUuid: DISK_A }, vi.fn())).rejects.toEqual(
      refused("permissions-unsafe"),
    );
  });

  it("record owner wrong → permissions-unsafe", async () => {
    const f = await fixture();
    const { io } = countingIo({
      open: async (...args) => {
        const handle = await fs.open(...args);
        return new Proxy(handle, {
          get(target, key) {
            if (key === "stat") return async (options) => foreignOwner(await target.stat(options));
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    });
    await expect(f.make({ io }).withKey({ diskUuid: DISK_A }, vi.fn())).rejects.toEqual(
      refused("permissions-unsafe"),
    );
  });

  it("all three owners equal to ownerUid → the read succeeds", async () => {
    const f = await fixture();
    const { copy } = await readKey(f.make());
    expect(copy).toEqual(KEY);
  });
});

describe("withKey: corrupt records", () => {
  const keyHex = hex(KEY);
  it.each([
    ["invalid JSON", "{not json\n"],
    [
      "non-canonical spacing",
      JSON.stringify({ version: 1, diskUuid: DISK_A, key: keyHex }, null, 1) + "\n",
    ],
    [
      "an extra key",
      JSON.stringify({ version: 1, diskUuid: DISK_A, key: keyHex, note: "x" }) + "\n",
    ],
    ["version: 2", JSON.stringify({ version: 2, diskUuid: DISK_A, key: keyHex }) + "\n"],
    ["a 63-character key", recordText(DISK_A, keyHex.slice(1))],
    ["an upper-case-hex key", recordText(DISK_A, keyHex.toUpperCase())],
    ["an all-zero key", recordText(DISK_A, "0".repeat(64))],
    ["a 2048-byte file", recordText(DISK_A).padEnd(2048, " ")],
    ["an array", "[]\n"],
    ["a malformed diskUuid", recordText("not-a-uuid")],
  ])("%s → record-corrupt", async (_, text) => {
    const f = await fixture({ record: false });
    await f.writeRecord(`${DISK_A}.json`, text);
    const consume = vi.fn();
    await expect(f.make().withKey({ diskUuid: DISK_A }, consume)).rejects.toEqual(
      refused("record-corrupt"),
    );
    expect(consume).not.toHaveBeenCalled();
  });
});

describe("withKey: bad input", () => {
  it.each(["../x", DISK_A.toUpperCase(), "", "a/b"])(
    "%j → input-invalid with zero io calls",
    async (diskUuid) => {
      const f = await fixture();
      await expect(f.make().withKey({ diskUuid }, vi.fn())).rejects.toEqual(
        refused("input-invalid"),
      );
      expect(f.counting.calls).toEqual([]);
      expect(f.inspectHostState).not.toHaveBeenCalled();
    },
  );

  it("a missing input object → input-invalid", async () => {
    const f = await fixture();
    await expect(f.make().withKey(undefined, vi.fn())).rejects.toEqual(refused("input-invalid"));
  });
});

describe("withKey: other file errors", () => {
  const failing = (code) => async () => {
    throw Object.assign(new Error(`fake ${code}`), { code });
  };

  it("lstat of hostRoot fails other than ENOENT → io-failed", async () => {
    const f = await fixture();
    const { io } = countingIo({ lstat: failing("EIO") });
    await expect(f.make({ io }).withKey({ diskUuid: DISK_A }, vi.fn())).rejects.toEqual(
      refused("io-failed"),
    );
  });

  it("lstat of disk-recovery fails other than ENOENT → io-failed", async () => {
    const f = await fixture();
    const { io } = countingIo({
      lstat: async (target, options) =>
        target === f.folder ? failing("EIO")() : fs.lstat(target, options),
    });
    await expect(f.make({ io }).withKey({ diskUuid: DISK_A }, vi.fn())).rejects.toEqual(
      refused("io-failed"),
    );
  });

  it("opening the record fails with EIO → io-failed", async () => {
    const f = await fixture();
    const { io } = countingIo({ open: failing("EIO") });
    await expect(f.make({ io }).withKey({ diskUuid: DISK_A }, vi.fn())).rejects.toEqual(
      refused("io-failed"),
    );
  });

  it("a refusal's message is the code alone", async () => {
    const f = await fixture();
    const { io } = countingIo({ open: failing("EIO") });
    const error = await f
      .make({ io })
      .withKey({ diskUuid: DISK_A }, vi.fn())
      .catch((e) => e);
    expect(error.message).toBe("disk_recovery.refused");
  });
});

/** Every path under `root`, relative to it; empty when `root` is an empty folder. */
const listing = async (root) => (await fs.readdir(root, { recursive: true })).sort();
const exists = (path) =>
  fs.lstat(path).then(
    () => true,
    () => false,
  );
const OTHER_KEY = Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 5) % 256);

// The injected failures below stop a store at one stage, as a power cut would. They are not one: no
// page cache is lost, so they show what each stage leaves behind, not what a disk keeps.
describe("store: writing once per disk", () => {
  it("store then withKey round-trips the bytes", async () => {
    const f = await fixture({ record: false, folder: false });
    const store = f.make({ io: undefined });
    await store.store({ diskUuid: DISK_A, key: KEY });
    const record = join(f.folder, `${DISK_A}.json`);
    expect(await fs.readFile(record, "utf8")).toBe(recordText(DISK_A));
    expect((await fs.lstat(record)).mode & 0o777).toBe(0o600);
    expect((await fs.lstat(f.folder)).mode & 0o777).toBe(0o700);
    expect(await listing(f.hostRoot)).toEqual([
      "disk-recovery",
      join("disk-recovery", `${DISK_A}.json`),
    ]);
    const { copy } = await readKey(store);
    expect(copy).toEqual(KEY);
  });

  it("the default io flushes the staged file and the folder through their handles", async () => {
    const f = await fixture({ record: false, folder: false });
    const probe = await fs.open(f.hostRoot, constants.O_RDONLY);
    const handleProto = Object.getPrototypeOf(probe);
    await probe.close();
    const sync = vi.spyOn(handleProto, "sync");
    try {
      await f.make({ io: undefined }).store({ diskUuid: DISK_A, key: KEY });
      expect(sync).toHaveBeenCalledTimes(2);
    } finally {
      sync.mockRestore();
    }
  });

  it("store into an existing disk-recovery folder", async () => {
    const f = await fixture({ record: false });
    await f.make().store({ diskUuid: DISK_A, key: KEY });
    expect((await readKey(f.make())).copy).toEqual(KEY);
  });

  it("store over an existing valid record → record-exists, with the file bytes unchanged", async () => {
    const f = await fixture();
    const before = await fs.readFile(join(f.folder, `${DISK_A}.json`));
    await expect(f.make().store({ diskUuid: DISK_A, key: OTHER_KEY })).rejects.toEqual(
      refused("record-exists"),
    );
    expect(await fs.readFile(join(f.folder, `${DISK_A}.json`))).toEqual(before);
    expect(await exists(join(f.folder, `${DISK_A}.json.next`))).toBe(false);
  });

  it("store over a corrupt record → record-exists, with the file unchanged", async () => {
    const f = await fixture({ record: false });
    await f.writeRecord(`${DISK_A}.json`, "{not json\n");
    await expect(f.make().store({ diskUuid: DISK_A, key: KEY })).rejects.toEqual(
      refused("record-exists"),
    );
    expect(await fs.readFile(join(f.folder, `${DISK_A}.json`), "utf8")).toBe("{not json\n");
  });

  it("two concurrent stores for one disk → exactly one fulfilled, the other record-exists", async () => {
    const f = await fixture({ record: false, folder: false });
    const store = f.make();
    const results = await Promise.allSettled([
      store.store({ diskUuid: DISK_A, key: KEY }),
      store.store({ diskUuid: DISK_A, key: OTHER_KEY }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(results.find((r) => r.status === "rejected").reason).toEqual(refused("record-exists"));
    expect((await readKey(store)).copy).toEqual(KEY);
  });

  it("withKey started straight after store, on the same instance → receives the new key", async () => {
    const f = await fixture({ record: false, folder: false });
    const store = f.make();
    const stored = store.store({ diskUuid: DISK_A, key: KEY });
    const read = readKey(store);
    await stored;
    expect((await read).copy).toEqual(KEY);
  });

  it("a non-refusal failure while checking the folder → io-failed", async () => {
    const f = await fixture({ record: false });
    const { io } = countingIo({
      lstat: async (target, options) => {
        if (target === join(f.folder, `${DISK_A}.json`))
          throw Object.assign(new Error("fake EIO"), { code: "EIO" });
        return fs.lstat(target, options);
      },
    });
    await expect(f.make({ io }).store({ diskUuid: DISK_A, key: KEY })).rejects.toEqual(
      refused("io-failed"),
    );
  });

  it("an unlink failure other than a missing file → io-failed", async () => {
    const f = await fixture({ record: false });
    const { io } = countingIo({
      unlink: async () => {
        throw Object.assign(new Error("fake EIO"), { code: "EIO" });
      },
    });
    await expect(f.make({ io }).store({ diskUuid: DISK_A, key: KEY })).rejects.toEqual(
      refused("io-failed"),
    );
  });

  it("a disk-recovery folder that is a symlink → path-unsafe, nothing written", async () => {
    const f = await fixture({ record: false });
    const elsewhere = join(f.parent, "elsewhere");
    await fs.rename(f.folder, elsewhere);
    await fs.symlink(elsewhere, f.folder);
    await expect(f.make().store({ diskUuid: DISK_A, key: KEY })).rejects.toEqual(
      refused("path-unsafe"),
    );
    expect(await listing(elsewhere)).toEqual([]);
  });
});

describe("store: interrupted writes", () => {
  const halfRecord = recordText(DISK_A).slice(0, recordText(DISK_A).length >> 1);

  it.each(["writeFile", "syncFile", "rename"])(
    "%s fails → io-failed, then withKey gives record-missing, then a fresh store succeeds and removes the leftover .next",
    async (stage) => {
      const f = await fixture({ record: false });
      const next = join(f.folder, `${DISK_A}.json.next`);
      const { io } = countingIo({
        [stage]: async (path, data, options) => {
          if (stage === "writeFile") await fs.writeFile(path, halfRecord, options);
          throw Object.assign(new Error(`fake ${stage} failure`), { code: "EIO" });
        },
      });
      await expect(f.make({ io }).store({ diskUuid: DISK_A, key: KEY })).rejects.toEqual(
        refused("io-failed"),
      );
      expect(await exists(next)).toBe(true);
      await expect(f.make().withKey({ diskUuid: DISK_A }, vi.fn())).rejects.toEqual(
        refused("record-missing"),
      );
      await f.make().store({ diskUuid: DISK_A, key: KEY });
      expect(await exists(next)).toBe(false);
      expect((await readKey(f.make())).copy).toEqual(KEY);
    },
  );

  it("syncDirectory fails after the rename → publication-unverified; withKey gives the whole new key; a second store gives record-exists", async () => {
    const f = await fixture({ record: false });
    const { io } = countingIo({
      syncDirectory: async () => {
        throw Object.assign(new Error("fake folder flush failure"), { code: "EIO" });
      },
    });
    await expect(f.make({ io }).store({ diskUuid: DISK_A, key: KEY })).rejects.toEqual(
      refused("publication-unverified"),
    );
    expect((await readKey(f.make())).copy).toEqual(KEY);
    await expect(f.make().store({ diskUuid: DISK_A, key: KEY })).rejects.toEqual(
      refused("record-exists"),
    );
  });

  it("the read-back returns different bytes → publication-unverified", async () => {
    const f = await fixture({ record: false });
    let renamed = false;
    const { io } = countingIo({
      rename: async (...args) => {
        await fs.rename(...args);
        renamed = true;
      },
      open: async (...args) => {
        const handle = await fs.open(...args);
        if (!renamed) return handle;
        return new Proxy(handle, {
          get(target, key) {
            if (key === "readFile") return async () => recordText(DISK_A, hex(OTHER_KEY));
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    });
    await expect(f.make({ io }).store({ diskUuid: DISK_A, key: KEY })).rejects.toEqual(
      refused("publication-unverified"),
    );
  });

  it("a truncated leftover .next (half the bytes) is ignored by withKey and removed by the next store", async () => {
    const f = await fixture({ record: false });
    const next = await f.writeRecord(`${DISK_A}.json.next`, halfRecord);
    await expect(f.make().withKey({ diskUuid: DISK_A }, vi.fn())).rejects.toEqual(
      refused("record-missing"),
    );
    await f.make().store({ diskUuid: DISK_A, key: KEY });
    expect(await exists(next)).toBe(false);
    expect((await readKey(f.make())).copy).toEqual(KEY);
  });
});

describe("store: the mount check (Review Focus 4)", () => {
  it("hostRoot removed (stand-in still answers) → mount-unverified, nothing created", async () => {
    const f = await fixture({ record: false, folder: false });
    await fs.rm(f.hostRoot, { recursive: true });
    await expect(f.make().store({ diskUuid: DISK_A, key: KEY })).rejects.toEqual(
      refused("mount-unverified"),
    );
    expect(await listing(f.parent)).toEqual([]);
  });

  it("stand-in throws → mount-unverified, zero io calls, and hostRoot stays empty", async () => {
    const f = await fixture({ record: false, folder: false });
    const store = f.make({
      inspectHostState: async () => {
        throw new Error("no mount");
      },
    });
    await expect(store.store({ diskUuid: DISK_A, key: KEY })).rejects.toEqual(
      refused("mount-unverified"),
    );
    expect(f.counting.calls).toEqual([]);
    expect(await listing(f.hostRoot)).toEqual([]);
  });

  it("stand-in rootId names another folder → root-changed, and no disk-recovery folder is created", async () => {
    const f = await fixture({ record: false, folder: false });
    const { rootId } = await rootIdOf(f.parent);
    const store = f.make({ inspectHostState: async () => ({ ...f.answer, rootId }) });
    await expect(store.store({ diskUuid: DISK_A, key: KEY })).rejects.toEqual(
      refused("root-changed"),
    );
    expect(await exists(f.folder)).toBe(false);
    expect(await listing(f.hostRoot)).toEqual([]);
  });

  it("the seam reports disk B → disk-mismatch, zero io calls", async () => {
    const f = await fixture({ record: false, folder: false });
    const store = f.make({ inspectHostState: async () => ({ ...f.answer, diskUuid: DISK_B }) });
    await expect(store.store({ diskUuid: DISK_A, key: KEY })).rejects.toEqual(
      refused("disk-mismatch"),
    );
    expect(f.counting.calls).toEqual([]);
  });
});

describe("store: bad input", () => {
  it.each([
    ["an all-zero key", { diskUuid: DISK_A, key: new Uint8Array(32) }],
    ["a 31-byte key", { diskUuid: DISK_A, key: KEY.slice(0, 31) }],
    ["a key that is a plain array", { diskUuid: DISK_A, key: Array.from(KEY) }],
    ["an upper-case UUID", { diskUuid: DISK_A.toUpperCase(), key: KEY }],
    ["a missing input", undefined],
  ])("%s → input-invalid with zero io calls", async (_, input) => {
    const f = await fixture({ record: false, folder: false });
    await expect(f.make().store(input)).rejects.toEqual(refused("input-invalid"));
    expect(f.counting.calls).toEqual([]);
    expect(f.inspectHostState).not.toHaveBeenCalled();
  });
});
