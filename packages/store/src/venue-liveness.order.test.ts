import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VENUE_HOLDER_FILE } from "./venue-holder.js";
import { lockVenueDirectory } from "./venue-lock.js";

/** Whether `venue.lock` is held at this instant, asked the way a second holder would ask. */
const heldNow = (directory: string): boolean => {
  const probe = new DatabaseSync(join(directory, "venue.lock"));
  try {
    probe.exec("pragma busy_timeout = 0");
    probe.exec("begin immediate");
    probe.exec("rollback");
    return false;
  } catch {
    return true;
  } finally {
    probe.close();
  }
};

const removals: { path: string; lockHeld: boolean }[] = [];

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const rmSync: typeof actual.rmSync = (path, options) => {
    const name = String(path);
    if (name.endsWith(`/${VENUE_HOLDER_FILE}`)) {
      removals.push({ path: name, lockHeld: heldNow(name.slice(0, -VENUE_HOLDER_FILE.length)) });
    }
    actual.rmSync(path, options);
  };
  return { ...actual, rmSync, default: { ...actual, rmSync } };
});

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("releasing the folder", () => {
  it("removes the holder file while the lock is still held, so a successor's file is never ours to remove", async () => {
    const directory = mkdtempSync(join(tmpdir(), "waitron-venue-order-"));
    directories.push(directory);
    const lock = await lockVenueDirectory(directory);
    removals.length = 0;
    lock.release();
    expect(removals).toEqual([
      { path: expect.stringContaining(VENUE_HOLDER_FILE), lockHeld: true },
    ]);
    expect(heldNow(directory)).toBe(false);
  });
});
