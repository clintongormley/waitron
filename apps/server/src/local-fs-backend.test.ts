import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalFsBackend } from "./local-fs-backend.js";

// `list()`'s per-entry `stat` is mocked in exactly one test below, to stage a file that vanishes
// between `readdir` and `stat` (a concurrent prune/delete) deterministically — a real race can't be
// staged without genuine timing flakiness. Every other call delegates to the real implementation, so
// every other test in this file exercises the real filesystem.
const VANISHING_KEY = "waitron-vanishes.dump.enc";
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    copyFile: async (...args: Parameters<typeof actual.copyFile>) => {
      if (String(args[0]).endsWith("partial-copy-input")) {
        await actual.writeFile(args[1], "partial");
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      }
      return actual.copyFile(...args);
    },
    stat: vi.fn((path: Parameters<typeof actual.stat>[0], ...rest: unknown[]) => {
      if (typeof path === "string" && path.endsWith(VANISHING_KEY)) {
        const err = new Error("ENOENT: no such file or directory, stat") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        return Promise.reject(err);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- forwarding varargs to the real fn
      return (actual.stat as any)(path, ...rest);
    }),
  };
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
    await be.put("waitron-20260905T000000Z.dump.enc", Buffer.from("cipher-bytes"));
    expect((await be.get("waitron-20260905T000000Z.dump.enc")).toString()).toBe("cipher-bytes");
  });

  it("put leaves no .tmp behind, and list never returns a leftover temp as a backup", async () => {
    const be = new LocalFsBackend("d1", dir);
    await be.put("waitron-a.dump.enc", Buffer.from("x"));
    // `writeFileAtomic` writes to `<key>.tmp` then renames; a crash between the two can leave that
    // temp behind. It starts with `waitron-` too, so `list()` MUST exclude it — otherwise a
    // half-written temp would read as a finished backup.
    await writeFile(join(dir, "waitron-b.dump.enc.tmp"), Buffer.from("leftover"));
    const listed = await be.list("waitron-");
    expect(listed.map((o) => o.key)).toEqual(["waitron-a.dump.enc"]);
  });

  it("lists matching keys newest-first by mtime", async () => {
    const be = new LocalFsBackend("d1", dir);
    await be.put("waitron-1.dump.enc", Buffer.from("1"));
    await new Promise((r) => setTimeout(r, 5));
    await be.put("waitron-2.dump.enc", Buffer.from("2"));
    const listed = await be.list("waitron-");
    expect(listed.map((o) => o.key)).toEqual(["waitron-2.dump.enc", "waitron-1.dump.enc"]);
    expect(listed[0].size).toBe(1);
  });

  it("delete removes a key", async () => {
    const be = new LocalFsBackend("d1", dir);
    await be.put("waitron-1.dump.enc", Buffer.from("1"));
    await be.delete("waitron-1.dump.enc");
    expect(await be.list("waitron-")).toHaveLength(0);
  });

  it("list tolerates a missing dir (returns empty)", async () => {
    const be = new LocalFsBackend("d1", join(dir, "nope"));
    expect(await be.list("waitron-")).toEqual([]);
  });

  it("put surfaces a write failure rather than reporting success", async () => {
    const be = new LocalFsBackend("d1", dir);
    // Pre-create `writeFileAtomic`'s temp path (`<key>.tmp`) as a directory: the helper's pre-write
    // `rm(tmp, { force: true })` — without `recursive` — then fails on that directory
    // (ERR_FS_EISDIR), so the write never lands. `put` must PROPAGATE that, never swallow it and
    // report a backup that isn't there.
    await mkdir(join(dir, "a.dump.enc.tmp"));
    await expect(be.put("a.dump.enc", Buffer.from("x"))).rejects.toMatchObject({
      code: "ERR_FS_EISDIR",
    });
  });

  it("list skips an entry that vanishes between readdir and stat (ENOENT tolerated)", async () => {
    const be = new LocalFsBackend("d1", dir);
    await be.put(VANISHING_KEY, Buffer.from("gone"));
    await be.put("waitron-stays.dump.enc", Buffer.from("here"));
    const listed = await be.list("waitron-");
    expect(listed.map((o) => o.key)).toEqual(["waitron-stays.dump.enc"]);
  });
  it("list surfaces a directory it cannot read, other than a missing one", async () => {
    await writeFile(join(dir, "not-a-dir"), "x");
    const be = new LocalFsBackend("d1", join(dir, "not-a-dir"));
    await expect(be.list("waitron-")).rejects.toMatchObject({ code: "ENOTDIR" });
  });

  it("list surfaces an entry it cannot stat, other than one that vanished", async () => {
    await symlink(join(dir, "waitron-loop.dump.enc"), join(dir, "waitron-loop.dump.enc"));
    const be = new LocalFsBackend("d1", dir);
    await expect(be.list("waitron-")).rejects.toMatchObject({ code: "ELOOP" });
  });

  it("list leaves out a directory whose name looks like a backup", async () => {
    const be = new LocalFsBackend("d1", dir);
    await mkdir(join(dir, "waitron-folder.dump.enc"));
    await be.put("waitron-real.dump.enc", Buffer.from("here"));
    expect((await be.list("waitron-")).map((o) => o.key)).toEqual(["waitron-real.dump.enc"]);
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
    await backend.putFile("waitron-copy.backup.enc", input);
    expect(await readFile(input)).toEqual(Buffer.from([0, 255, 42]));
    expect((await stat(join(stored, "waitron-copy.backup.enc"))).mode & 0o777).toBe(0o600);
    expect(await readdir(stored)).toEqual(["waitron-copy.backup.enc"]);
    await backend.getFile("waitron-copy.backup.enc", output);
    expect(await readFile(output)).toEqual(Buffer.from([0, 255, 42]));
    expect((await stat(output)).mode & 0o777).toBe(0o600);
    await writeFile(output, "changed");
    expect(await backend.get("waitron-copy.backup.enc")).toEqual(Buffer.from([0, 255, 42]));
  });
  it("leaves a previous key intact and removes temporary output when copying fails", async () => {
    const dir = await fresh();
    const backend = new LocalFsBackend("file", dir);
    await backend.put("waitron-copy.backup.enc", Buffer.from("old"));
    await expect(
      backend.putFile("waitron-copy.backup.enc", join(dir, "missing")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await backend.get("waitron-copy.backup.enc")).toEqual(Buffer.from("old"));
    expect(await readdir(dir)).toEqual(["waitron-copy.backup.enc"]);
    const output = join(dir, "out");
    await writeFile(output, "keep");
    await expect(backend.getFile("missing", output)).rejects.toMatchObject({ code: "ENOENT" });
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
    await backend.put("waitron-old.backup.enc", Buffer.from("old"));
    await expect(backend.putFile("waitron-old.backup.enc", input)).rejects.toMatchObject({
      code: "ENOSPC",
    });
    expect(await backend.get("waitron-old.backup.enc")).toEqual(Buffer.from("old"));
    expect(await readFile(input, "utf8")).toBe("new");
    expect(await readdir(store)).toEqual(["waitron-old.backup.enc"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
