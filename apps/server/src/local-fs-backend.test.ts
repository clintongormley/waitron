import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
});
