import { mkdir, mkdtemp, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as disk from "./sync-path.js";
import * as atomic from "./fs-atomic.js";
import { restoreDatabase } from "./restore.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "restore-durability-"));
  roots.push(root);
  const venueDir = join(root, "venue");
  await mkdir(venueDir);
  const databasePath = join(root, "source");
  await writeFile(databasePath, "new venue");
  await writeFile(join(venueDir, "venue.db"), "old venue");
  await writeFile(join(venueDir, "node.db"), "old node");
  return {
    databasePath,
    venueDir,
    stateDir: root,
    nodeDump: Buffer.from("new node"),
    log: vi.fn(),
  };
}

it.each([false, true])(
  "flushes both incoming files before publication, cross-device=%s",
  async (crossDevice) => {
    const f = await fixture();
    const events: string[] = [];
    const flush = disk.reachDisk;
    vi.spyOn(disk, "reachDisk").mockImplementation(async (path) => {
      await flush(path);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      events.push(`sync:${basename(path)}`);
    });
    const syncFolder = atomic.syncFolderHolding;
    vi.spyOn(atomic, "syncFolderHolding").mockImplementation(async (path) => {
      await syncFolder(path);
      events.push("folder");
    });
    await restoreDatabase({
      ...f,
      fs: {
        rename: async (from, to) => {
          if (from === f.databasePath && crossDevice)
            throw Object.assign(new Error("cross device"), { code: "EXDEV" });
          await rename(from, to);
          if (from !== f.databasePath)
            events.push(`${from.endsWith(".incoming") ? "place" : "move"}:${basename(to)}`);
        },
        rm: async (path, options) => {
          if (basename(path).startsWith(".venue.db-replaced-")) events.push("discard");
          await rm(path, options);
        },
        rmdir,
      },
    });
    expect(events).toEqual([
      "sync:venue.db.incoming",
      "sync:node.db.incoming",
      "move:venue.db",
      "move:node.db",
      "place:node.db",
      "place:venue.db",
      "folder",
      "discard",
    ]);
    expect(await readFile(join(f.venueDir, "venue.db"), "utf8")).toBe("new venue");
    expect(await readFile(join(f.venueDir, "node.db"), "utf8")).toBe("new node");
  },
);

it("leaves the old pair intact when an incoming file cannot be flushed", async () => {
  const f = await fixture();
  const refused = Object.assign(new Error("file flush refused"), { code: "EIO" });
  vi.spyOn(disk, "reachDisk").mockRejectedValue(refused);
  await expect(restoreDatabase(f)).rejects.toBe(refused);
  expect(await readFile(join(f.venueDir, "venue.db"), "utf8")).toBe("old venue");
  expect(await readFile(join(f.venueDir, "node.db"), "utf8")).toBe("old node");
});

it("finishes with the new pair and logs unconfirmed durability when the publication folder flush fails", async () => {
  const f = await fixture();
  vi.spyOn(atomic, "syncFolderHolding").mockRejectedValue(
    Object.assign(new Error("folder flush refused"), { code: "EIO" }),
  );
  await expect(restoreDatabase(f)).resolves.toBe(join(f.venueDir, "venue.db"));
  expect(await readFile(join(f.venueDir, "venue.db"), "utf8")).toBe("new venue");
  expect(await readFile(join(f.venueDir, "node.db"), "utf8")).toBe("new node");
  expect(f.log).toHaveBeenCalledWith("error", "restore.db.folder_sync_failed", {
    folder: f.venueDir,
    errno: "EIO",
  });
});
