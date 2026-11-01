import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { inspect } from "node:util";
import { constants } from "node:fs";
import { clearTimeout, setTimeout } from "node:timers";
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

// The module's default io is not injectable, so reaching it with a staged FIFO goes through the
// module's own `node:fs/promises`; with no hook set this is the real writeFile.
const fsHooks = vi.hoisted(() => ({ writeFile: undefined }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, writeFile: (...args) => (fsHooks.writeFile ?? real.writeFile)(...args) };
});

const parents = [];
afterEach(async () => {
  fsHooks.writeFile = undefined;
  for (const parent of parents.splice(0)) await fs.rm(parent, { recursive: true, force: true });
});

const mkfifo = (path) => execFileSync("mkfifo", ["-m", "600", path]);

/**
 * Settles `promise`, or, if it has not settled within `ms`, reports it hung and keeps opening each
 * FIFO in `fifos` for writing until it does: an open waiting for a writer never times out on its
 * own, and it would hold the test process open.
 */
async function settleOrRelease(promise, fifos, ms = 2000) {
  const outcome = promise.then(
    () => ({ fulfilled: true }),
    (error) => ({ error }),
  );
  let settled = false;
  void outcome.then(() => (settled = true));
  let timer;
  await Promise.race([outcome, new Promise((resolve) => (timer = setTimeout(resolve, ms)))]);
  clearTimeout(timer);
  const hung = !settled;
  while (!settled) {
    for (const fifo of fifos) {
      await fs
        .open(fifo, constants.O_WRONLY | constants.O_NONBLOCK)
        .then((writer) => writer.close())
        .catch(() => {});
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return { hung, ...(await outcome) };
}

/** Wraps `fs.open` so each handle answers `stat` and `readFile` through `handleOverrides`. */
const openWith =
  (handleOverrides) =>
  async (...args) => {
    const handle = await fs.open(...args);
    return new Proxy(handle, {
      get(target, key) {
        if (Object.hasOwn(handleOverrides, key)) return handleOverrides[key](target);
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };

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

/**
 * A real io that counts every call; `overrides` replace single operations. `log` holds each call's
 * name and path (both paths for a rename), never the written text.
 */
function countingIo(overrides = {}) {
  const calls = [];
  const log = [];
  const io = {};
  for (const name of Object.keys(REAL_IO)) {
    const run = overrides[name] ?? REAL_IO[name];
    io[name] = (...args) => {
      calls.push(name);
      log.push([name, ...args.slice(0, name === "rename" ? 2 : 1)]);
      return run(...args);
    };
  }
  return { io, calls, log };
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

  it("the record is a FIFO → path-unsafe without waiting for a writer, and the store's turn is released", async () => {
    const f = await fixture({ record: false });
    const record = join(f.folder, `${DISK_A}.json`);
    mkfifo(record);
    const store = f.make();
    const consume = vi.fn();
    const outcome = await settleOrRelease(store.withKey({ diskUuid: DISK_A }, consume), [record]);
    expect(outcome).toEqual({ hung: false, error: refused("path-unsafe") });
    expect(consume).not.toHaveBeenCalled();
    await fs.rm(record);
    await f.writeRecord(`${DISK_A}.json`, recordText(DISK_A));
    expect((await readKey(store)).copy).toEqual(KEY);
  });

  it("the record has a second hard link → path-unsafe", async () => {
    const f = await fixture();
    await fs.link(join(f.folder, `${DISK_A}.json`), join(f.parent, "second-name.json"));
    const consume = vi.fn();
    await expect(f.make().withKey({ diskUuid: DISK_A }, consume)).rejects.toEqual(
      refused("path-unsafe"),
    );
    expect(consume).not.toHaveBeenCalled();
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

  it.each([
    ["hostRoot", "0750", (f) => f.hostRoot],
    ["disk-recovery", "0750", (f) => f.folder],
    ["the record", "0640", (f) => join(f.folder, `${DISK_A}.json`)],
  ])("%s with group bits only (mode %s) → permissions-unsafe", async (_, mode, pathOf) => {
    const f = await fixture();
    await fs.chmod(pathOf(f), Number.parseInt(mode, 8));
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

  it("a valid record whose handle reports 1025 bytes → record-corrupt, and the record is never read", async () => {
    const f = await fixture();
    const readFile = vi.fn();
    const { io } = countingIo({
      open: openWith({
        stat: (handle) => async (options) => {
          const stats = await handle.stat(options);
          return new Proxy(stats, {
            get(target, key) {
              if (key === "size") return 1025;
              const value = Reflect.get(target, key);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        },
        readFile: () => readFile,
      }),
    });
    await expect(f.make({ io }).withKey({ diskUuid: DISK_A }, vi.fn())).rejects.toEqual(
      refused("record-corrupt"),
    );
    expect(readFile).not.toHaveBeenCalled();
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

  const forged = () =>
    Object.assign(new Error("disk_recovery.refused"), {
      code: "disk_recovery.refused",
      reason: "record-missing",
      detail: "carried along",
    });

  it("a file operation that throws its own error carrying the refusal code → io-failed, not that error", async () => {
    const f = await fixture();
    const thrown = forged();
    const { io } = countingIo({
      lstat: async () => {
        throw thrown;
      },
    });
    const error = await f
      .make({ io })
      .withKey({ diskUuid: DISK_A }, vi.fn())
      .catch((e) => e);
    expect(error).not.toBe(thrown);
    expect(error).toEqual(refused("io-failed"));
    expect(error).not.toHaveProperty("detail");
  });

  it("the same on the store side → io-failed, not that error", async () => {
    const f = await fixture({ record: false });
    const thrown = forged();
    const { io } = countingIo({
      writeFile: async () => {
        throw thrown;
      },
    });
    const error = await f
      .make({ io })
      .store({ diskUuid: DISK_A, key: KEY })
      .catch((e) => e);
    expect(error).not.toBe(thrown);
    expect(error).toEqual(refused("io-failed"));
    expect(error).not.toHaveProperty("detail");
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

  it("the default io flushes hostRoot, then the staged file, then disk-recovery, each through its own handle", async () => {
    const f = await fixture({ record: false, folder: false });
    const probe = await fs.open(f.hostRoot, constants.O_RDONLY);
    const handleProto = Object.getPrototypeOf(probe);
    await probe.close();
    const realSync = handleProto.sync;
    const flushed = [];
    const sync = vi.spyOn(handleProto, "sync").mockImplementation(async function () {
      flushed.push((await this.stat({ bigint: true })).ino);
      return realSync.call(this);
    });
    try {
      await f.make({ io: undefined }).store({ diskUuid: DISK_A, key: KEY });
    } finally {
      sync.mockRestore();
    }
    const inode = async (path) => (await fs.lstat(path, { bigint: true })).ino;
    expect(flushed).toEqual([
      await inode(f.hostRoot),
      await inode(join(f.folder, `${DISK_A}.json`)),
      await inode(f.folder),
    ]);
  });

  it("a first store's file operations, in order", async () => {
    const f = await fixture({ record: false, folder: false });
    await f.make().store({ diskUuid: DISK_A, key: KEY });
    const record = join(f.folder, `${DISK_A}.json`);
    const next = `${record}.next`;
    expect(f.counting.log).toEqual([
      ["lstat", f.hostRoot],
      ["lstat", f.folder],
      ["mkdir", f.folder],
      ["lstat", f.folder],
      ["syncDirectory", f.hostRoot],
      ["lstat", record],
      ["unlink", next],
      ["writeFile", next],
      ["syncFile", next],
      ["rename", next, record],
      ["syncDirectory", f.folder],
      ["lstat", f.hostRoot],
      ["lstat", f.folder],
      ["open", record],
    ]);
  });

  it("a second disk's store, into the folder the first created, flushes hostRoot too", async () => {
    const f = await fixture({ record: false, folder: false });
    await f.make().store({ diskUuid: DISK_A, key: KEY });
    const { io, log } = countingIo();
    const store = f.make({
      io,
      inspectHostState: async () => ({ ...f.answer, diskUuid: DISK_B }),
    });
    await store.store({ diskUuid: DISK_B, key: OTHER_KEY });
    const record = join(f.folder, `${DISK_B}.json`);
    const next = `${record}.next`;
    expect(log).toEqual([
      ["lstat", f.hostRoot],
      ["lstat", f.folder],
      ["syncDirectory", f.hostRoot],
      ["lstat", record],
      ["unlink", next],
      ["writeFile", next],
      ["syncFile", next],
      ["rename", next, record],
      ["syncDirectory", f.folder],
      ["lstat", f.hostRoot],
      ["lstat", f.folder],
      ["open", record],
    ]);
  });

  it("flushing hostRoot fails after the folder was made → io-failed; the retry, finding the folder, still flushes hostRoot", async () => {
    const f = await fixture({ record: false, folder: false });
    const { io } = countingIo({
      syncDirectory: async (path) => {
        if (path === f.hostRoot)
          throw Object.assign(new Error("fake root flush failure"), { code: "EIO" });
        return REAL_IO.syncDirectory(path);
      },
    });
    await expect(f.make({ io }).store({ diskUuid: DISK_A, key: KEY })).rejects.toEqual(
      refused("io-failed"),
    );
    expect(await listing(f.hostRoot)).toEqual(["disk-recovery"]);
    await expect(f.make().withKey({ diskUuid: DISK_A }, vi.fn())).rejects.toEqual(
      refused("record-missing"),
    );
    const retry = countingIo();
    await f.make({ io: retry.io }).store({ diskUuid: DISK_A, key: KEY });
    expect(retry.log).toContainEqual(["syncDirectory", f.hostRoot]);
    expect((await readKey(f.make())).copy).toEqual(KEY);
  });

  it.each([
    ["zeroes", (key) => key.fill(0)],
    ["flips one byte of", (key) => (key[0] ^= 0xff)],
  ])(
    "a caller that %s its array before the store settles → the record holds the key that was checked",
    async (_, change) => {
      const f = await fixture({ record: false, folder: false });
      const key = Uint8Array.from(KEY);
      const stored = f.make().store({ diskUuid: DISK_A, key });
      change(key);
      await stored;
      expect(await fs.readFile(join(f.folder, `${DISK_A}.json`), "utf8")).toBe(recordText(DISK_A));
    },
  );

  it("an awaited store leaves the caller's array as it was", async () => {
    const f = await fixture({ record: false, folder: false });
    const key = Uint8Array.from(KEY);
    await f.make().store({ diskUuid: DISK_A, key });
    expect(key).toEqual(KEY);
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
      syncDirectory: async (path) => {
        if (path === f.folder)
          throw Object.assign(new Error("fake folder flush failure"), { code: "EIO" });
        return REAL_IO.syncDirectory(path);
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

  /** An io whose `open` hands back `wrap(handle)` for every open after the rename. */
  const afterRename = (wrap) => {
    let renamed = false;
    return countingIo({
      rename: async (...args) => {
        await fs.rename(...args);
        renamed = true;
      },
      open: async (...args) => {
        const handle = await fs.open(...args);
        return renamed ? wrap(handle) : handle;
      },
    });
  };
  const withHandle = (handle, overrides) =>
    new Proxy(handle, {
      get(target, key) {
        if (Object.hasOwn(overrides, key)) return overrides[key](target);
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

  it.each([
    [
      "reports a foreign owner",
      { stat: (target) => async (options) => foreignOwner(await target.stat(options)) },
    ],
    ["returns invalid JSON", { readFile: () => async () => "{not json\n" }],
  ])(
    "the read-back handle %s → publication-unverified, not the reader's own refusal",
    async (_, overrides) => {
      const f = await fixture({ record: false });
      const { io } = afterRename((handle) => withHandle(handle, overrides));
      await expect(f.make({ io }).store({ diskUuid: DISK_A, key: KEY })).rejects.toEqual(
        refused("publication-unverified"),
      );
    },
  );

  it("the read-back runs the reader's checks: the mount check failing after the rename → publication-unverified", async () => {
    const f = await fixture({ record: false });
    let renamed = false;
    const { io } = countingIo({
      rename: async (...args) => {
        await fs.rename(...args);
        renamed = true;
      },
    });
    const store = f.make({
      io,
      inspectHostState: async () => {
        if (renamed) throw new Error("mount gone");
        return { ...f.answer };
      },
    });
    await expect(store.store({ diskUuid: DISK_A, key: KEY })).rejects.toEqual(
      refused("publication-unverified"),
    );
  });

  it("the read-back runs the reader's checks: disk-recovery's owner wrong after the rename → publication-unverified", async () => {
    const f = await fixture({ record: false });
    let renamed = false;
    const { io } = countingIo({
      rename: async (...args) => {
        await fs.rename(...args);
        renamed = true;
      },
      lstat: async (target, options) => {
        const stats = await fs.lstat(target, options);
        return renamed && target === f.folder ? foreignOwner(stats) : stats;
      },
    });
    await expect(f.make({ io }).store({ diskUuid: DISK_A, key: KEY })).rejects.toEqual(
      refused("publication-unverified"),
    );
  });

  it("a .next that appears between the unlink and the write → io-failed, and it is not overwritten", async () => {
    const f = await fixture({ record: false });
    const next = join(f.folder, `${DISK_A}.json.next`);
    const planted = recordText(DISK_A, hex(OTHER_KEY));
    const { io } = countingIo({
      unlink: async (path) => {
        await fs.unlink(path).catch(() => {});
        await fs.writeFile(path, planted, { mode: 0o600 });
      },
    });
    await expect(f.make({ io }).store({ diskUuid: DISK_A, key: KEY })).rejects.toEqual(
      refused("io-failed"),
    );
    expect(await fs.readFile(next, "utf8")).toBe(planted);
    expect(await exists(join(f.folder, `${DISK_A}.json`))).toBe(false);
  });

  it("a symlink where the staged file should be → the default io's flush refuses it, and nothing is published", async () => {
    const f = await fixture({ record: false });
    const next = join(f.folder, `${DISK_A}.json.next`);
    const record = join(f.folder, `${DISK_A}.json`);
    const target = await f.writeRecord("target.json", recordText(DISK_A), f.parent);
    fsHooks.writeFile = async (path) => fs.symlink(target, path);
    await expect(f.make({ io: undefined }).store({ diskUuid: DISK_A, key: KEY })).rejects.toEqual(
      refused("io-failed"),
    );
    expect(await exists(record)).toBe(false);
    expect((await fs.lstat(next)).isSymbolicLink()).toBe(true);
  });

  it("a leftover .next that is a symlink → the link is removed, its target untouched, and the store succeeds", async () => {
    const f = await fixture({ record: false });
    const next = join(f.folder, `${DISK_A}.json.next`);
    const target = await f.writeRecord("target.json", "elsewhere\n", f.parent);
    await fs.symlink(target, next);
    await f.make().store({ diskUuid: DISK_A, key: KEY });
    expect(await exists(next)).toBe(false);
    expect(await fs.readFile(target, "utf8")).toBe("elsewhere\n");
    expect((await readKey(f.make())).copy).toEqual(KEY);
  });

  it("a leftover .next that is a folder → io-failed, and the folder stays", async () => {
    const f = await fixture({ record: false });
    const next = join(f.folder, `${DISK_A}.json.next`);
    await fs.mkdir(next, { mode: 0o700 });
    await expect(f.make().store({ diskUuid: DISK_A, key: KEY })).rejects.toEqual(
      refused("io-failed"),
    );
    expect((await fs.lstat(next)).isDirectory()).toBe(true);
    expect(await exists(join(f.folder, `${DISK_A}.json`))).toBe(false);
  });

  it("a FIFO where the staged file should be → the default io's flush refuses it without waiting for a writer", async () => {
    const f = await fixture({ record: false });
    const next = join(f.folder, `${DISK_A}.json.next`);
    const record = join(f.folder, `${DISK_A}.json`);
    fsHooks.writeFile = async (path) => mkfifo(path);
    const outcome = await settleOrRelease(
      f.make({ io: undefined }).store({ diskUuid: DISK_A, key: KEY }),
      [next, record],
    );
    expect(outcome).toEqual({ hung: false, error: refused("io-failed") });
    expect(await exists(record)).toBe(false);
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

describe("key-leak sweep", () => {
  const decimal = (bytes, separator) => Array.from(bytes).join(separator);
  const windows = Array.from({ length: KEY.length - 7 }, (_, i) => KEY.subarray(i, i + 8));
  const FORMS = [
    ["hex", hex(KEY)],
    ["upper hex", hex(KEY).toUpperCase()],
    ["spaced hex", Array.from(KEY, (byte) => byte.toString(16).padStart(2, "0")).join(" ")],
    ["base64", Buffer.from(KEY).toString("base64")],
    ["base64url", Buffer.from(KEY).toString("base64url")],
    ['decimal ", "', decimal(KEY, ", ")],
    ['decimal ","', decimal(KEY, ",")],
    ["array-like JSON", JSON.stringify(KEY)],
    ...windows.flatMap((window, i) => [
      [`hex window ${i}`, hex(window)],
      [`upper hex window ${i}`, hex(window).toUpperCase()],
      [`decimal ", " window ${i}`, decimal(window, ", ")],
      [`decimal "," window ${i}`, decimal(window, ",")],
    ]),
  ];
  /** The names of every form `text` holds, whitespace runs collapsed so wrapped arrays still match. */
  const formsIn = (text) => {
    const collapsed = text.replace(/\s+/g, " ");
    return FORMS.filter(([, form]) => text.includes(form) || collapsed.includes(form)).map(
      ([name]) => name,
    );
  };

  /** Fails like a real file operation, but carries the key, so a pass-through would show it. */
  const leakyFailure = (stage) =>
    Object.assign(new Error(`fake ${stage} failure ${hex(KEY)}`), { code: "EIO", key: KEY });
  const failAt = (stage) => async () => {
    throw leakyFailure(stage);
  };
  const lstatFailingAt = (path, change) => async (target, options) =>
    target === path ? change(await fs.lstat(target, options)) : fs.lstat(target, options);
  const afterRenameIo = (overrides, onRename = () => {}) => {
    let renamed = false;
    return countingIo({
      rename: async (...args) => {
        await fs.rename(...args);
        renamed = true;
        onRename();
      },
      open: async (...args) => {
        const handle = await fs.open(...args);
        if (!renamed) return handle;
        return new Proxy(handle, {
          get(target, key) {
            if (Object.hasOwn(overrides, key)) return overrides[key](target);
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    }).io;
  };
  const read = (setup, options = {}) => ({ side: "read", setup, ...options });
  const write = (setup, options = {}) => ({ side: "write", setup, ...options });
  const answerWith = (change) => (f) => ({ inspectHostState: async () => change({ ...f.answer }) });

  /** Each scenario: what to set up, then which store options to use (from the fixture). */
  const scenarios = {
    "read: success": read(async () => {}),
    "read: throwing consume": read(async () => {}, {
      consume: async () => {
        throw new Error("consumer failed");
      },
    }),
    "read: input-invalid (path)": read(async () => {}, { input: { diskUuid: "../x" } }),
    "read: input-invalid (missing)": read(async () => {}, { input: undefined }),
    "read: mount-unverified (seam throws)": read(async () => {}, {
      deps: () => ({ inspectHostState: failAt("inspectHostState") }),
    }),
    "read: mount-unverified (other hostRoot)": read(async () => {}, {
      deps: answerWith((a) => ({ ...a, hostRoot: "/elsewhere" })),
    }),
    "read: mount-unverified (hostRoot removed)": read(async (f) =>
      fs.rm(f.hostRoot, { recursive: true }),
    ),
    "read: disk-mismatch": read(async () => {}, {
      deps: answerWith((a) => ({ ...a, diskUuid: DISK_B })),
    }),
    "read: root-changed": read(async () => {}, {
      deps: answerWith((a) => ({ ...a, rootId: "1:1" })),
    }),
    "read: path-unsafe (disk-recovery is a file)": read(
      async (f) => {
        await fs.rm(f.folder, { recursive: true });
        await fs.writeFile(f.folder, "");
      },
      { record: false },
    ),
    "read: path-unsafe (record is a symlink)": read(
      async (f) => {
        await fs.writeFile(join(f.parent, "target"), "");
        await fs.symlink(join(f.parent, "target"), join(f.folder, `${DISK_A}.json`));
      },
      { record: false },
    ),
    "read: path-unsafe (record is a folder)": read(
      async (f) => fs.mkdir(join(f.folder, `${DISK_A}.json`)),
      { record: false },
    ),
    "read: path-unsafe (second hard link)": read(async (f) =>
      fs.link(join(f.folder, `${DISK_A}.json`), join(f.folder, `${DISK_B}.json`)),
    ),
    "read: permissions-unsafe (record mode)": read(async (f) =>
      fs.chmod(join(f.folder, `${DISK_A}.json`), 0o644),
    ),
    "read: permissions-unsafe (folder owner)": read(async () => {}, {
      deps: (f) => ({ io: countingIo({ lstat: lstatFailingAt(f.folder, foreignOwner) }).io }),
    }),
    "read: record-missing (no folder)": read(async () => {}, { record: false, folder: false }),
    "read: record-missing (no record)": read(async () => {}, { record: false }),
    "read: record-corrupt (upper-case hex)": read(
      async (f) => f.writeRecord(`${DISK_A}.json`, recordText(DISK_A, hex(KEY).toUpperCase())),
      { record: false },
    ),
    "read: record-corrupt (extra key)": read(
      async (f) =>
        f.writeRecord(
          `${DISK_A}.json`,
          JSON.stringify({ version: 1, diskUuid: DISK_A, key: hex(KEY), note: "x" }) + "\n",
        ),
      { record: false },
    ),
    "read: record-mismatch": read(
      async (f) => f.writeRecord(`${DISK_B}.json`, recordText(DISK_A)),
      { input: { diskUuid: DISK_B }, deps: answerWith((a) => ({ ...a, diskUuid: DISK_B })) },
    ),
    "read: io-failed (lstat)": read(async () => {}, {
      deps: () => ({ io: countingIo({ lstat: failAt("lstat") }).io }),
    }),
    "read: io-failed (open)": read(async () => {}, {
      deps: () => ({ io: countingIo({ open: failAt("open") }).io }),
    }),
    "read: io-failed (readFile)": read(async () => {}, {
      deps: () => ({
        io: countingIo({ open: openWith({ readFile: () => failAt("readFile") }) }).io,
      }),
    }),

    "write: success": write(async () => {}),
    "write: record-exists": write(async () => {}, { record: true }),
    "write: input-invalid (all-zero key)": write(async () => {}, {
      input: { diskUuid: DISK_A, key: new Uint8Array(32) },
    }),
    "write: input-invalid (31 bytes)": write(async () => {}, {
      input: { diskUuid: DISK_A, key: KEY.slice(0, 31) },
    }),
    "write: input-invalid (plain array)": write(async () => {}, {
      input: { diskUuid: DISK_A, key: Array.from(KEY) },
    }),
    "write: input-invalid (upper-case UUID)": write(async () => {}, {
      input: { diskUuid: DISK_A.toUpperCase(), key: KEY },
    }),
    "write: input-invalid (missing)": write(async () => {}, { input: undefined }),
    "write: mount-unverified": write(async () => {}, {
      deps: () => ({ inspectHostState: failAt("inspectHostState") }),
    }),
    "write: disk-mismatch": write(async () => {}, {
      deps: answerWith((a) => ({ ...a, diskUuid: DISK_B })),
    }),
    "write: root-changed": write(async () => {}, {
      deps: answerWith((a) => ({ ...a, rootId: "1:1" })),
    }),
    "write: path-unsafe": write(async (f) => {
      await fs.rm(f.folder, { recursive: true });
      await fs.mkdir(join(f.parent, "elsewhere"), { mode: 0o700 });
      await fs.symlink(join(f.parent, "elsewhere"), f.folder);
    }),
    "write: permissions-unsafe": write(async (f) => fs.chmod(f.hostRoot, 0o755)),
    "write: io-failed (lstat of the folder)": write(async () => {}, {
      deps: (f) => ({
        io: countingIo({
          lstat: lstatFailingAt(f.folder, () => {
            throw leakyFailure("lstat");
          }),
        }).io,
      }),
    }),
    "write: io-failed (mkdir)": write(async () => {}, {
      folder: false,
      deps: () => ({ io: countingIo({ mkdir: failAt("mkdir") }).io }),
    }),
    "write: io-failed (syncDirectory of hostRoot)": write(async () => {}, {
      deps: () => ({ io: countingIo({ syncDirectory: failAt("syncDirectory") }).io }),
    }),
    "write: io-failed (unlink)": write(async () => {}, {
      deps: () => ({ io: countingIo({ unlink: failAt("unlink") }).io }),
    }),
    "write: io-failed (writeFile, half written)": write(async () => {}, {
      deps: () => ({
        io: countingIo({
          writeFile: async (path, data, options) => {
            await fs.writeFile(path, data.slice(0, data.length >> 1), options);
            throw leakyFailure("writeFile");
          },
        }).io,
      }),
    }),
    "write: io-failed (syncFile)": write(async () => {}, {
      deps: () => ({ io: countingIo({ syncFile: failAt("syncFile") }).io }),
    }),
    "write: io-failed (rename)": write(async () => {}, {
      deps: () => ({ io: countingIo({ rename: failAt("rename") }).io }),
    }),
    "write: publication-unverified (folder flush)": write(async () => {}, {
      deps: (f) => ({
        io: countingIo({
          syncDirectory: async (path) =>
            path === f.folder ? failAt("syncDirectory")() : REAL_IO.syncDirectory(path),
        }).io,
      }),
    }),
    "write: publication-unverified (read-back differs)": write(async () => {}, {
      deps: () => ({
        io: afterRenameIo({ readFile: () => async () => recordText(DISK_A, hex(OTHER_KEY)) }),
      }),
    }),
    "write: publication-unverified (read-back stat fails)": write(async () => {}, {
      deps: () => ({ io: afterRenameIo({ stat: () => failAt("stat") }) }),
    }),
    "write: publication-unverified (mount gone after rename)": write(async () => {}, {
      deps: (f) => {
        let renamed = false;
        return {
          io: afterRenameIo({}, () => (renamed = true)),
          inspectHostState: async () => {
            if (renamed) throw leakyFailure("inspectHostState");
            return { ...f.answer };
          },
        };
      },
    }),
  };

  const REASONS = [
    "input-invalid",
    "mount-unverified",
    "disk-mismatch",
    "root-changed",
    "path-unsafe",
    "permissions-unsafe",
    "record-missing",
    "record-corrupt",
    "record-mismatch",
    "record-exists",
    "publication-unverified",
    "io-failed",
  ];
  const RECORD_NAME =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json(\.next)?$/;

  /** What a call returned or threw, as the texts a caller, a logger or a crash report could show. */
  async function outcomeOf(call) {
    try {
      const value = await call;
      const texts = [String(value), JSON.stringify(value) ?? "", inspect(value, { depth: 10 })];
      return { reason: "fulfilled", texts };
    } catch (error) {
      const texts = [
        String(error?.message),
        String(error?.stack),
        JSON.stringify(error) ?? "",
        inspect(error, { depth: 10 }),
      ];
      return { reason: error?.reason ?? error?.message, texts };
    }
  }

  /** Every file, link and name under the fixture; only a record or its staging file may hold the key. */
  async function strayCopies(f, dir = f.parent) {
    const found = [];
    const folder = await fs.lstat(f.folder).catch(() => null);
    const recordFolder = folder?.isDirectory() && (folder.mode & 0o777) === 0o700;
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      for (const form of formsIn(entry.name)) found.push(`${path} (name): ${form}`);
      if (entry.isSymbolicLink()) {
        for (const form of formsIn(await fs.readlink(path))) found.push(`${path} (link): ${form}`);
      } else if (entry.isDirectory()) {
        found.push(...(await strayCopies(f, path)));
      } else if (entry.isFile()) {
        const allowed =
          recordFolder && dirname(path) === f.folder && RECORD_NAME.test(basename(path));
        if (!allowed)
          for (const form of formsIn(await fs.readFile(path, "utf8")))
            found.push(`${path}: ${form}`);
      }
    }
    return found;
  }

  it("no path puts the key in a returned value, an error, a console or stream write, or a stray file", async () => {
    const spies = [
      ...Object.keys(console)
        .filter((name) => typeof console[name] === "function")
        .map((name) => [`console.${name}`, vi.spyOn(console, name).mockImplementation(() => {})]),
      ["process.stdout.write", vi.spyOn(process.stdout, "write").mockImplementation(() => true)],
      ["process.stderr.write", vi.spyOn(process.stderr, "write").mockImplementation(() => true)],
    ];
    const leaks = [];
    const reached = new Set();
    let writes;
    try {
      const check = async (label, call) => {
        const { reason, texts } = await outcomeOf(call);
        reached.add(reason);
        for (const text of texts) for (const form of formsIn(text)) leaks.push(`${label}: ${form}`);
      };
      const fixtures = [];
      for (const [label, scenario] of Object.entries(scenarios)) {
        const f = await fixture({
          record: scenario.record ?? scenario.side === "read",
          folder: scenario.folder ?? true,
        });
        await scenario.setup(f);
        fixtures.push([label, f]);
        const store = f.make(scenario.deps?.(f) ?? {});
        if (scenario.side === "read") {
          const input = "input" in scenario ? scenario.input : { diskUuid: DISK_A };
          await check(label, store.withKey(input, scenario.consume ?? (async () => {})));
        } else {
          const input = "input" in scenario ? scenario.input : { diskUuid: DISK_A, key: KEY };
          await check(label, store.store(input));
        }
      }
      await check("fixed store", storeDiskRecovery({ diskUuid: DISK_A, key: KEY }));
      await check("fixed store, array key", storeDiskRecovery({ diskUuid: DISK_A, key: [...KEY] }));
      await check(
        "fixed withKey",
        withDiskRecovery({ diskUuid: DISK_A }, async () => {}),
      );
      for (const [label, f] of fixtures)
        for (const stray of await strayCopies(f)) leaks.push(`${label}: ${stray}`);
    } finally {
      writes = spies
        .filter(([, spy]) => spy.mock.calls.length > 0)
        .map(([name, spy]) => `${name} x${spy.mock.calls.length}`);
      for (const [, spy] of spies) spy.mockRestore();
    }
    expect(leaks).toEqual([]);
    expect(writes).toEqual([]);
    expect([...reached].sort()).toEqual([...REASONS, "fulfilled", "consumer failed"].sort());
  });
});
