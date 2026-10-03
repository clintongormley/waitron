import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { isLocked, openLock } from "./index.js";

it("holds a migration lock until its owner releases it", () => {
  const directory = mkdtempSync(join(tmpdir(), "waitron-migration-lock-"));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "migrations.lock");

  const first = openLock(path, 0);
  try {
    try {
      const second = openLock(path, 0);
      second.release();
      throw new Error("a second holder acquired the same lock");
    } catch (error) {
      expect(isLocked(error)).toBe(true);
    }
  } finally {
    first.release();
  }

  const next = openLock(path, 0);
  next.release();
});

it("closes each refused connection before another attempt", () => {
  const directory = mkdtempSync(join(tmpdir(), "waitron-migration-lock-"));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "migrations.lock");
  const first = openLock(path, 0);
  try {
    const before = readdirSync("/dev/fd").length;
    for (let attempt = 0; attempt < 30; attempt++) {
      expect(() => openLock(path, 0)).toThrow();
    }
    expect(readdirSync("/dev/fd").length - before).toBeLessThan(2);
  } finally {
    first.release();
  }
});
