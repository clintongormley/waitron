import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  assertOutsideScratch,
  deleteScratchEntries,
  emptyScratch,
  listScratch,
} from "./scratch.js";

vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, rm: vi.fn(fs.rm) };
});

let root: string;
let scratch: string;
const log = vi.fn();

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wt-scratch-"));
  scratch = join(root, "scratch");
  log.mockClear();
});

afterEach(async () => {
  vi.mocked(rm).mockReset();
  await rm(root, { recursive: true, force: true });
});

it("empties every entry and keeps the folder", async () => {
  await mkdir(join(scratch, "nested"), { recursive: true });
  await writeFile(join(scratch, "file"), "x");
  const readonly = join(scratch, "nested", "readonly");
  await writeFile(readonly, "x");
  await chmod(readonly, 0o400);
  expect(await emptyScratch(root, log)).toBe(2);
  expect(await readdir(scratch)).toEqual([]);
  expect((await lstat(scratch)).isDirectory()).toBe(true);
  expect(log).not.toHaveBeenCalled();
});

it("a missing scratch folder is not an error", async () => {
  expect(await listScratch(root, log)).toBeNull();
  expect(await emptyScratch(root, log)).toBe(0);
  expect(log).not.toHaveBeenCalled();
});

it("a scratch that is a symbolic link is skipped", async () => {
  const target = join(root, "target");
  await mkdir(target);
  await writeFile(join(target, "file"), "keep");
  await symlink(target, scratch);
  expect(await emptyScratch(root, log)).toBe(0);
  expect(await readFile(join(target, "file"), "utf8")).toBe("keep");
  expect(log).toHaveBeenCalledWith("warn", "storage.start_cleanup_skipped", { folder: "scratch" });
});

it("an entry that cannot be removed is logged and the rest still go", async () => {
  await mkdir(scratch);
  await writeFile(join(scratch, "kept"), "x");
  await writeFile(join(scratch, "gone"), "x");
  vi.mocked(rm).mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "EACCES" }));
  expect(await deleteScratchEntries(root, ["kept", "gone"], log)).toBe(1);
  expect(await readdir(scratch)).toEqual(["kept"]);
  expect(log).toHaveBeenCalledWith("warn", "storage.start_cleanup_failed", { errno: "EACCES" });
});

it("only the listed entries are deleted", async () => {
  await mkdir(scratch);
  await writeFile(join(scratch, "old"), "x");
  const listed = await listScratch(root, log);
  await mkdir(join(scratch, "new"));
  expect(await deleteScratchEntries(root, listed!, log)).toBe(1);
  expect(await readdir(scratch)).toEqual(["new"]);
});

it("refuses a configured folder whose existing parent links into scratch", async () => {
  await mkdir(scratch);
  await symlink(scratch, join(root, "alias"));
  expect(() =>
    assertOutsideScratch(root, join(root, "alias", "backups"), "WAITRON_BACKUP_DIR"),
  ).toThrow(expect.objectContaining({ code: "server.config_invalid" }));
});
