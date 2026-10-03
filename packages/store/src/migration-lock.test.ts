import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { openLock } from "./index.js";

it("holds a migration lock until its owner releases it", () => {
  const directory = mkdtempSync(join(tmpdir(), "waitron-migration-lock-"));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "migrations.lock");

  const first = openLock(path, 0);
  try {
    expect(() => openLock(path, 0)).toThrow("database is locked");
  } finally {
    first.release();
  }

  const next = openLock(path, 0);
  next.release();
});
