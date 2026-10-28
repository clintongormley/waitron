import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SPARE_SPACE_FILE } from "@waitron/provisioning";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { releaseSpare } from "./spare-space.js";

let root: string;
let stateDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wt-spare-space-"));
  stateDir = join(root, "state");
  await mkdir(stateDir);
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("releaseSpare", () => {
  it("deletes the spare, logs storage.spare_released and answers the bytes it held", async () => {
    await writeFile(join(stateDir, SPARE_SPACE_FILE), Buffer.alloc(4096, 1));
    const log = vi.fn();
    expect(await releaseSpare(stateDir, log)).toBe(4096);
    expect(existsSync(join(stateDir, SPARE_SPACE_FILE))).toBe(false);
    expect(log.mock.calls).toEqual([["warn", "storage.spare_released", { bytes: 4096 }]]);
  });

  it("answers 0 and logs nothing when there is no spare", async () => {
    const log = vi.fn();
    expect(await releaseSpare(stateDir, log)).toBe(0);
    expect(log).not.toHaveBeenCalled();
  });

  it("leaves a symbolic link at the spare's path, and its target, alone and logs storage.spare_unusable", async () => {
    const outside = join(root, "outside");
    await writeFile(outside, "kept");
    await symlink(outside, join(stateDir, SPARE_SPACE_FILE));
    const log = vi.fn();
    expect(await releaseSpare(stateDir, log)).toBe(0);
    expect(existsSync(join(stateDir, SPARE_SPACE_FILE))).toBe(true);
    expect(await readFile(outside, "utf8")).toBe("kept");
    expect(log.mock.calls).toEqual([["warn", "storage.spare_unusable", { kind: "other" }]]);
  });

  it("leaves a folder at the spare's path alone and logs storage.spare_unusable", async () => {
    await mkdir(join(stateDir, SPARE_SPACE_FILE));
    await writeFile(join(stateDir, SPARE_SPACE_FILE, "inside"), "kept");
    const log = vi.fn();
    expect(await releaseSpare(stateDir, log)).toBe(0);
    expect(existsSync(join(stateDir, SPARE_SPACE_FILE, "inside"))).toBe(true);
    expect(log.mock.calls).toEqual([["warn", "storage.spare_unusable", { kind: "other" }]]);
  });

  it("logs storage.spare_release_failed with the errno when the spare cannot be deleted, and answers 0", async () => {
    await writeFile(join(stateDir, SPARE_SPACE_FILE), Buffer.alloc(16, 1));
    const log = vi.fn();
    const refused = Object.assign(new Error("denied"), { code: "EACCES" });
    expect(await releaseSpare(stateDir, log, { unlink: () => Promise.reject(refused) })).toBe(0);
    expect(log.mock.calls).toEqual([["warn", "storage.spare_release_failed", { errno: "EACCES" }]]);
  });
});
