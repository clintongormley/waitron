import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRestoreLeftovers, restoreLeftovers } from "./restore-staging-dirs.js";

let root: string;
let stateDir: string;
let staging: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wt-restore-leftovers-"));
  stateDir = join(root, "state");
  staging = join(stateDir, "restore-staging");
  await mkdir(staging, { recursive: true });
});

afterEach(async () => {
  await chmod(staging, 0o700).catch(() => {});
  await rm(root, { recursive: true, force: true });
});

async function folder(path: string): Promise<string> {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "part"), "x");
  return path;
}

async function everyKind(): Promise<string[]> {
  return [
    await folder(join(stateDir, "stream-restore-a1")),
    await folder(join(stateDir, "restore-entry-b2")),
    await folder(join(staging, "archive-download-c3")),
    await folder(join(staging, "archive-validate-d4")),
    await folder(join(staging, "restore-admission-e5")),
    await folder(join(staging, "staged-recovery")),
  ];
}

describe("restoreLeftovers", () => {
  it("lists a folder of each kind a restore leaves", async () => {
    const kinds = await everyKind();
    expect((await restoreLeftovers(stateDir)).sort()).toEqual(kinds.sort());
  });

  it("lists no file, link, or folder whose name only looks like one", async () => {
    await writeFile(join(stateDir, "stream-restore-x"), "a file");
    const target = await folder(join(root, "elsewhere"));
    await symlink(target, join(staging, "archive-download-x"));
    await folder(join(stateDir, "venue"));
    await folder(join(stateDir, "backup-staging"));
    await folder(join(stateDir, "stream-restore"));
    await folder(join(staging, "archive-download"));
    await folder(join(stateDir, "archive-download-y"));
    expect(await restoreLeftovers(stateDir)).toEqual([]);
  });

  it("lists nothing from a restore staging folder that is a symbolic link", async () => {
    await rm(staging, { recursive: true });
    const elsewhere = join(root, "elsewhere-staging");
    await folder(join(elsewhere, "archive-download-x"));
    await folder(join(elsewhere, "staged-recovery"));
    await symlink(elsewhere, staging);
    expect(await restoreLeftovers(stateDir)).toEqual([]);
  });

  it("lists nothing when the state folder is missing", async () => {
    expect(await restoreLeftovers(join(root, "no-state"))).toEqual([]);
  });

  it("lists the state folder's kinds when restore staging is missing", async () => {
    await rm(staging, { recursive: true });
    const stream = await folder(join(stateDir, "stream-restore-a1"));
    expect(await restoreLeftovers(stateDir)).toEqual([stream]);
  });
});

describe("clearRestoreLeftovers", () => {
  it("removes each leftover and logs each one by its name inside the state folder", async () => {
    const kinds = await everyKind();
    const log = vi.fn();
    await clearRestoreLeftovers(stateDir, log);
    for (const path of kinds) expect(existsSync(path)).toBe(false);
    expect(existsSync(staging)).toBe(true);
    expect(log.mock.calls).toHaveLength(6);
    expect(log.mock.calls).toEqual(
      expect.arrayContaining(
        [
          "restore-entry-b2",
          "restore-staging/archive-download-c3",
          "restore-staging/archive-validate-d4",
          "restore-staging/restore-admission-e5",
          "restore-staging/staged-recovery",
          "stream-restore-a1",
        ].map((name) => ["info", "restore.leftover_removed", { folder: name }]),
      ),
    );
  });

  it("leaves what a linked restore staging folder points at", async () => {
    await rm(staging, { recursive: true });
    const elsewhere = join(root, "elsewhere-staging");
    const download = await folder(join(elsewhere, "archive-download-x"));
    await symlink(elsewhere, staging);
    const log = vi.fn();
    await clearRestoreLeftovers(stateDir, log);
    expect(existsSync(join(download, "part"))).toBe(true);
    expect(log).not.toHaveBeenCalled();
  });

  it("logs a folder it cannot remove, carries on, and does not throw", async () => {
    const download = await folder(join(staging, "archive-download-c3"));
    const stream = await folder(join(stateDir, "stream-restore-a1"));
    await chmod(staging, 0o500);
    const log = vi.fn();
    await expect(clearRestoreLeftovers(stateDir, log)).resolves.toBeUndefined();
    expect(existsSync(download)).toBe(true);
    expect(existsSync(stream)).toBe(false);
    expect(log).toHaveBeenCalledWith("warn", "restore.leftover_kept", {
      folder: "restore-staging/archive-download-c3",
      errno: "EACCES",
    });
    expect(log).toHaveBeenCalledWith("info", "restore.leftover_removed", {
      folder: "stream-restore-a1",
    });
  });
});
