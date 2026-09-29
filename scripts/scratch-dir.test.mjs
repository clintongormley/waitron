import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { scratchParent } from "./scratch-dir.mjs";

describe("scratchParent", () => {
  it("chooses /dev/shm when it is a directory", () => {
    expect(scratchParent({ isDirectory: (path) => path === "/dev/shm" })).toBe("/dev/shm");
  });

  it("falls back to the system temporary directory without /dev/shm", () => {
    expect(scratchParent({ isDirectory: () => false })).toBe(tmpdir());
  });

  it("chooses /dev/shm exactly when the real filesystem has it as a directory", () => {
    const hasShm = statSync("/dev/shm", { throwIfNoEntry: false })?.isDirectory() ?? false;
    expect(scratchParent()).toBe(hasShm ? "/dev/shm" : tmpdir());
  });
});
