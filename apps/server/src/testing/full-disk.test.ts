import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { openSmallDisk } from "./full-disk.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("a root over a large filesystem is refused, naming the folder", () => {
  const root = mkdtempSync(join(tmpdir(), "env2-full-disk-"));
  try {
    mkdirSync(join(root, "test-only"));
    vi.stubEnv("WAITRON_FULL_DISK_ROOT", root);
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    expect(process.platform).toBe("linux");
    const opened = openSmallDisk("test-only");
    expect(opened.ok).toBe(false);
    expect(!opened.ok && opened.reason).toMatch(/^WAITRON_FULL_DISK_ROOT\/test-only \(/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("with no root on Linux there is no small filesystem", () => {
  vi.stubEnv("WAITRON_FULL_DISK_ROOT", "");
  vi.spyOn(process, "platform", "get").mockReturnValue("linux");
  expect(process.platform).toBe("linux");
  expect(openSmallDisk("test-only")).toEqual({
    ok: false,
    reason:
      "no small filesystem: set WAITRON_FULL_DISK_ROOT to a folder whose test-only folder is a filesystem of 64 MiB or less",
  });
});
