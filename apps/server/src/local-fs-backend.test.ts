import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalFsBackend } from "./local-fs-backend.js";
import { SMALL_OBJECT_MAX_BYTES } from "./storage-backend.js";

// `list()`'s per-entry `stat` is mocked in exactly one test below, to stage a file that vanishes
// between `readdir` and `stat` (a concurrent prune/delete) deterministically — a real race can't be
// staged without genuine timing flakiness. The other mocked calls delegate to the real ones unless a
// test names their path or sets `hooks.during`, which runs inside the call, as a cancellation landing
// while the file system is busy would.
const VANISHING_KEY = "waitron-vanishes.dump.enc";
const hooks = vi.hoisted(() => ({
  during: undefined as ((call: string, path: string) => void) | undefined,
  failNextWrite: false,
  endless: undefined as Readable | undefined,
}));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const { Readable: R, Writable: W } = await import("node:stream");
  return {
    ...actual,
    createReadStream: (...args: Parameters<typeof actual.createReadStream>) => {
      const path = String(args[0]);
      if (path.endsWith("partial-copy-input")) hooks.failNextWrite = true;
      if (path.endsWith("endless-input")) {
        let first = true;
        hooks.endless = new R({
          read() {
            if (first) {
              first = false;
              hooks.during?.("read", path);
            }
            this.push(Buffer.alloc(64 * 1024, 1));
          },
        });
        return hooks.endless;
      }
      return actual.createReadStream(...args);
    },
    createWriteStream: (...args: Parameters<typeof actual.createWriteStream>) => {
      if (hooks.failNextWrite) {
        hooks.failNextWrite = false;
        actual.writeFileSync(String(args[0]), "partial");
        return new W({
          write(_chunk, _encoding, done) {
            done(Object.assign(new Error("disk full"), { code: "ENOSPC" }));
          },
        });
      }
      return actual.createWriteStream(...args);
    },
  };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const during =
    <A extends unknown[], T>(name: string, real: (...args: A) => Promise<T>) =>
    async (...args: A): Promise<T> => {
      const result = await real(...args);
      hooks.during?.(name, String(args[0]));
      return result;
    };
  return {
    ...actual,
    chmod: during("chmod", actual.chmod),
    readdir: during("readdir", actual.readdir as (path: string) => Promise<string[]>),
    rm: during("rm", actual.rm),
    writeFile: during("writeFile", actual.writeFile),
    stat: vi.fn(async (path: Parameters<typeof actual.stat>[0], ...rest: unknown[]) => {
      if (typeof path === "string" && path.endsWith(VANISHING_KEY)) {
        const err = new Error("ENOENT: no such file or directory, stat") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        return Promise.reject(err);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- forwarding varargs to the real fn
      const info: unknown = await (actual.stat as any)(path, ...rest);
      hooks.during?.("stat", String(path));
      return info;
    }),
  };
});

/** Never cancelled. */
const call = { signal: new AbortController().signal };

afterEach(() => {
  hooks.during = undefined;
  hooks.failNextWrite = false;
  hooks.endless = undefined;
});

describe("LocalFsBackend", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "lfs-backend-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("puts then gets the same bytes", async () => {
    const be = new LocalFsBackend("d1", dir);
    await be.put("waitron-20260905T000000Z.dump.enc", Buffer.from("cipher-bytes"), call);
    expect((await be.get("waitron-20260905T000000Z.dump.enc", call)).toString()).toBe(
      "cipher-bytes",
    );
  });

  it("get refuses a file over the small-object bound", async () => {
    const be = new LocalFsBackend("d1", dir);
    await writeFile(join(dir, "waitron-big"), Buffer.alloc(SMALL_OBJECT_MAX_BYTES + 1));
    await expect(be.get("waitron-big", call)).rejects.toMatchObject({
      code: "backup.destination_object_too_large",
      params: { maxBytes: SMALL_OBJECT_MAX_BYTES },
    });
  });

  it("get returns a file exactly at the small-object bound", async () => {
    const be = new LocalFsBackend("d1", dir);
    await writeFile(join(dir, "waitron-edge"), Buffer.alloc(SMALL_OBJECT_MAX_BYTES, 7));
    expect((await be.get("waitron-edge", call)).length).toBe(SMALL_OBJECT_MAX_BYTES);
  });

  it("put leaves no .tmp behind, and list never returns a leftover temp as a backup", async () => {
    const be = new LocalFsBackend("d1", dir);
    await be.put("waitron-a.dump.enc", Buffer.from("x"), call);
    // `put` stages `<key>.tmp` with `stageFile`, then renames; a crash between the two can leave that
    // temp behind. It starts with `waitron-` too, so `list()` MUST exclude it — otherwise a
    // half-written temp would read as a finished backup.
    await writeFile(join(dir, "waitron-b.dump.enc.tmp"), Buffer.from("leftover"));
    const listed = await be.list("waitron-", call);
    expect(listed.map((o) => o.key)).toEqual(["waitron-a.dump.enc"]);
  });

  it("lists matching keys newest-first by mtime", async () => {
    const be = new LocalFsBackend("d1", dir);
    await be.put("waitron-1.dump.enc", Buffer.from("1"), call);
    await new Promise((r) => setTimeout(r, 5));
    await be.put("waitron-2.dump.enc", Buffer.from("2"), call);
    const listed = await be.list("waitron-", call);
    expect(listed.map((o) => o.key)).toEqual(["waitron-2.dump.enc", "waitron-1.dump.enc"]);
    expect(listed[0].size).toBe(1);
  });

  it("delete removes a key", async () => {
    const be = new LocalFsBackend("d1", dir);
    await be.put("waitron-1.dump.enc", Buffer.from("1"), call);
    await be.delete("waitron-1.dump.enc", call);
    expect(await be.list("waitron-", call)).toHaveLength(0);
  });

  it("list tolerates a missing dir (returns empty)", async () => {
    const be = new LocalFsBackend("d1", join(dir, "nope"));
    expect(await be.list("waitron-", call)).toEqual([]);
  });

  it("put surfaces a write failure rather than reporting success", async () => {
    const be = new LocalFsBackend("d1", dir);
    // Pre-create `stageFile`'s temp path (`<key>.tmp`) as a directory: the helper's pre-write
    // `rm(tmp, { force: true })` — without `recursive` — then fails on that directory
    // (ERR_FS_EISDIR), so the write never lands. `put` must PROPAGATE that, never swallow it and
    // report a backup that isn't there.
    await mkdir(join(dir, "a.dump.enc.tmp"));
    await expect(be.put("a.dump.enc", Buffer.from("x"), call)).rejects.toMatchObject({
      code: "ERR_FS_EISDIR",
    });
  });

  it("list skips an entry that vanishes between readdir and stat (ENOENT tolerated)", async () => {
    const be = new LocalFsBackend("d1", dir);
    await be.put(VANISHING_KEY, Buffer.from("gone"), call);
    await be.put("waitron-stays.dump.enc", Buffer.from("here"), call);
    const listed = await be.list("waitron-", call);
    expect(listed.map((o) => o.key)).toEqual(["waitron-stays.dump.enc"]);
  });
  it("list surfaces a directory it cannot read, other than a missing one", async () => {
    await writeFile(join(dir, "not-a-dir"), "x");
    const be = new LocalFsBackend("d1", join(dir, "not-a-dir"));
    await expect(be.list("waitron-", call)).rejects.toMatchObject({ code: "ENOTDIR" });
  });

  it("list surfaces an entry it cannot stat, other than one that vanished", async () => {
    await symlink(join(dir, "waitron-loop.dump.enc"), join(dir, "waitron-loop.dump.enc"));
    const be = new LocalFsBackend("d1", dir);
    await expect(be.list("waitron-", call)).rejects.toMatchObject({ code: "ELOOP" });
  });

  it("list leaves out a directory whose name looks like a backup", async () => {
    const be = new LocalFsBackend("d1", dir);
    await mkdir(join(dir, "waitron-folder.dump.enc"));
    await be.put("waitron-real.dump.enc", Buffer.from("here"), call);
    expect((await be.list("waitron-", call)).map((o) => o.key)).toEqual(["waitron-real.dump.enc"]);
  });
});

describe("LocalFsBackend file transfers", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });
  async function fresh() {
    const dir = await mkdtemp(join(tmpdir(), "backend-file-"));
    dirs.push(dir);
    return dir;
  }
  it("publishes a protected copy, retains the shared input and gets an independent file", async () => {
    const dir = await fresh();
    const input = join(dir, "input");
    const output = join(dir, "output");
    const stored = join(dir, "store");
    await writeFile(input, Buffer.from([0, 255, 42]), { mode: 0o644 });
    const backend = new LocalFsBackend("file", stored);
    await backend.putFile("waitron-copy.backup.enc", input, call);
    expect(await readFile(input)).toEqual(Buffer.from([0, 255, 42]));
    expect((await stat(join(stored, "waitron-copy.backup.enc"))).mode & 0o777).toBe(0o600);
    expect(await readdir(stored)).toEqual(["waitron-copy.backup.enc"]);
    await backend.getFile("waitron-copy.backup.enc", output, call);
    expect(await readFile(output)).toEqual(Buffer.from([0, 255, 42]));
    expect((await stat(output)).mode & 0o777).toBe(0o600);
    await writeFile(output, "changed");
    expect(await backend.get("waitron-copy.backup.enc", call)).toEqual(Buffer.from([0, 255, 42]));
  });
  it("leaves a previous key intact and removes temporary output when copying fails", async () => {
    const dir = await fresh();
    const backend = new LocalFsBackend("file", dir);
    await backend.put("waitron-copy.backup.enc", Buffer.from("old"), call);
    await expect(
      backend.putFile("waitron-copy.backup.enc", join(dir, "missing"), call),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await backend.get("waitron-copy.backup.enc", call)).toEqual(Buffer.from("old"));
    expect(await readdir(dir)).toEqual(["waitron-copy.backup.enc"]);
    const output = join(dir, "out");
    await writeFile(output, "keep");
    await expect(backend.getFile("missing", output, call)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(output, "utf8")).toBe("keep");
    expect(await readdir(dir)).toEqual(expect.arrayContaining(["out", "waitron-copy.backup.enc"]));
    expect((await readdir(dir)).some((name) => name.endsWith(".tmp"))).toBe(false);
  });
});

it("cleans a partially copied backend file without replacing an existing object", async () => {
  const dir = await mkdtemp(join(tmpdir(), "backend-partial-"));
  try {
    const input = join(dir, "partial-copy-input");
    const store = join(dir, "store");
    await writeFile(input, "new");
    const backend = new LocalFsBackend("file", store);
    await backend.put("waitron-old.backup.enc", Buffer.from("old"), call);
    await expect(backend.putFile("waitron-old.backup.enc", input, call)).rejects.toMatchObject({
      code: "ENOSPC",
    });
    expect(await backend.get("waitron-old.backup.enc", call)).toEqual(Buffer.from("old"));
    expect(await readFile(input, "utf8")).toBe("new");
    expect(await readdir(store)).toEqual(["waitron-old.backup.enc"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("LocalFsBackend keys and cancellation", () => {
  let dir: string;
  let store: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "lfs-cancel-"));
    store = join(dir, "store");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const exists = (path: string) =>
    access(path).then(
      () => true,
      () => false,
    );
  const cancelled = () => {
    const controller = new AbortController();
    controller.abort();
    return { signal: controller.signal };
  };
  /** A call cancelled by `hooks.during` when the named file-system call returns. */
  function cancelledDuring(name: string) {
    const controller = new AbortController();
    hooks.during = (seen) => {
      if (seen === name) controller.abort();
    };
    return { signal: controller.signal };
  }
  const everyMethod = (
    backend: LocalFsBackend,
    key: string,
    input: string,
    output: string,
    c: { signal: AbortSignal },
  ): (() => Promise<unknown>)[] => [
    () => backend.put(key, Buffer.from("x"), c),
    () => backend.putFile(key, input, c),
    () => backend.getFile(key, output, c),
    () => backend.get(key, c),
    () => backend.delete(key, c),
    () => backend.deleteMany([key], c),
  ];

  it.each(["", ".", "..", "../escape", "a/b", "/abs", "a\\b", "x\u0000y", "x\u007fy"])(
    "refuses the key %j before touching the file system",
    async (key) => {
      const input = join(dir, "input");
      const output = join(dir, "output");
      await writeFile(input, "new");
      await writeFile(join(dir, "escape"), "outside");
      const backend = new LocalFsBackend("d", store);
      for (const attempt of everyMethod(backend, key, input, output, call)) {
        await expect(attempt()).rejects.toMatchObject({
          code: "backup.destination_key_invalid",
          params: { field: "key" },
        });
      }
      expect(await exists(store)).toBe(false);
      expect(await exists(output)).toBe(false);
      expect(await readFile(join(dir, "escape"), "utf8")).toBe("outside");
    },
  );

  it("deleteMany refuses a batch holding one bad key, deleting none of it", async () => {
    const backend = new LocalFsBackend("d", store);
    await backend.put("waitron-a.backup.enc", Buffer.from("a"), call);
    await expect(backend.deleteMany(["waitron-a.backup.enc", "../a"], call)).rejects.toMatchObject({
      code: "backup.destination_key_invalid",
    });
    expect(await readdir(store)).toEqual(["waitron-a.backup.enc"]);
  });

  it("deleteMany removes every key named, and a missing one is not a failure", async () => {
    const backend = new LocalFsBackend("d", store);
    await backend.put("waitron-a.backup.enc", Buffer.from("a"), call);
    await backend.put("waitron-b.backup.enc", Buffer.from("b"), call);
    await backend.put("waitron-c.backup.enc", Buffer.from("c"), call);
    await backend.deleteMany(
      ["waitron-a.backup.enc", "waitron-c.backup.enc", "waitron-gone"],
      call,
    );
    expect(await readdir(store)).toEqual(["waitron-b.backup.enc"]);
  });

  it("does nothing once the call is already cancelled", async () => {
    const input = join(dir, "input");
    const output = join(dir, "output");
    await writeFile(input, "new");
    const backend = new LocalFsBackend("d", store);
    for (const attempt of [
      ...everyMethod(backend, "waitron-a.backup.enc", input, output, cancelled()),
      () => backend.list("waitron-", cancelled()),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ name: "AbortError" });
    }
    expect(await exists(store)).toBe(false);
    expect(await exists(output)).toBe(false);
  });

  it("stops a copy while it streams, leaving the existing object and no partial file", async () => {
    const backend = new LocalFsBackend("d", store);
    await backend.put("waitron-a.backup.enc", Buffer.from("old"), call);
    const c = cancelledDuring("read");
    await expect(
      backend.putFile("waitron-a.backup.enc", join(dir, "endless-input"), c),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(hooks.endless?.destroyed).toBe(true);
    expect(await readFile(join(store, "waitron-a.backup.enc"), "utf8")).toBe("old");
    expect(await readdir(store)).toEqual(["waitron-a.backup.enc"]);
  });

  it("an upload cancelled during a step it cannot interrupt does not replace the object", async () => {
    const input = join(dir, "input");
    await writeFile(input, "new");
    const backend = new LocalFsBackend("d", store);
    await backend.put("waitron-a.backup.enc", Buffer.from("old"), call);
    await expect(
      backend.putFile("waitron-a.backup.enc", input, cancelledDuring("chmod")),
    ).rejects.toMatchObject({ name: "AbortError" });
    hooks.during = undefined;
    expect(await readFile(join(store, "waitron-a.backup.enc"), "utf8")).toBe("old");
    expect(await readdir(store)).toEqual(["waitron-a.backup.enc"]);
  });

  it("a download cancelled during a step it cannot interrupt leaves the target unchanged", async () => {
    const output = join(dir, "out", "output");
    const backend = new LocalFsBackend("d", store);
    await backend.put("waitron-a.backup.enc", Buffer.from("new"), call);
    await mkdir(join(dir, "out"));
    await writeFile(output, "keep");
    await expect(
      backend.getFile("waitron-a.backup.enc", output, cancelledDuring("chmod")),
    ).rejects.toMatchObject({ name: "AbortError" });
    hooks.during = undefined;
    expect(await readFile(output, "utf8")).toBe("keep");
    expect(await readdir(join(dir, "out"))).toEqual(["output"]);
  });

  it("a put cancelled while its bytes are written does not replace the object", async () => {
    const backend = new LocalFsBackend("d", store);
    await backend.put("waitron-a.backup.enc", Buffer.from("old"), call);
    await expect(
      backend.put("waitron-a.backup.enc", Buffer.from("new"), cancelledDuring("writeFile")),
    ).rejects.toMatchObject({ name: "AbortError" });
    hooks.during = undefined;
    expect(await readFile(join(store, "waitron-a.backup.enc"), "utf8")).toBe("old");
    expect(await readdir(store)).toEqual(["waitron-a.backup.enc"]);
  });

  it("a listing cancelled while the directory is read reports the cancellation", async () => {
    const backend = new LocalFsBackend("d", store);
    await backend.put("other-a.backup.enc", Buffer.from("a"), call);
    await expect(backend.list("waitron-", cancelledDuring("readdir"))).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("a listing cancelled while an entry is examined reports the cancellation", async () => {
    const backend = new LocalFsBackend("d", store);
    await backend.put("waitron-a.backup.enc", Buffer.from("a"), call);
    await expect(backend.list("waitron-", cancelledDuring("stat"))).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("deleteMany cancelled during one removal starts no further removal", async () => {
    const backend = new LocalFsBackend("d", store);
    await backend.put("waitron-a.backup.enc", Buffer.from("a"), call);
    await backend.put("waitron-b.backup.enc", Buffer.from("b"), call);
    await expect(
      backend.deleteMany(["waitron-a.backup.enc", "waitron-b.backup.enc"], cancelledDuring("rm")),
    ).rejects.toMatchObject({ name: "AbortError" });
    hooks.during = undefined;
    expect(await readdir(store)).toEqual(["waitron-b.backup.enc"]);
  });
});
