import {
  chmod,
  copyFile,
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { restoreDatabase } from "./restore.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "waitron-file-placement-"));
  roots.push(root);
  const venueDir = join(root, "venue");
  await mkdir(venueDir);
  const source = join(root, "source.db");
  await writeFile(source, "NEW-DATABASE");
  for (const suffix of ["", "-wal", "-shm"])
    await writeFile(join(venueDir, `venue.db${suffix}`), `OLD${suffix}`);
  await writeFile(join(venueDir, "venue.db.incoming"), "STALE");
  return { root, venueDir, source, target: join(venueDir, "venue.db") };
}
const ioError = (code: string) => Object.assign(new Error(code), { code });
async function oldIntact(venueDir: string) {
  for (const suffix of ["", "-wal", "-shm"])
    expect(await readFile(join(venueDir, `venue.db${suffix}`), "utf8")).toBe(`OLD${suffix}`);
}

describe("restoreDatabase consumes a database file", () => {
  it("places a sparse file over 2 GiB without buffering it, preserves its edges and restricts its mode", async () => {
    const { source, target, venueDir } = await fixture();
    const size = 2 ** 31 + 4096;
    await truncate(source, size);
    const fd = await open(source, "r+");
    try {
      await fd.write(Buffer.from("END"), 0, 3, size - 3);
    } finally {
      await fd.close();
    }
    await chmod(source, 0o644);
    const before = await stat(source);
    const log = vi.fn();
    expect(await restoreDatabase({ databasePath: source, venueDir, log })).toBe(target);
    const placed = await stat(target);
    expect(placed.size).toBe(size);
    expect(placed.ino).toBe(before.ino);
    expect(placed.mode & 0o777).toBe(0o600);
    const out = await open(target, "r");
    try {
      const edge = Buffer.alloc(12);
      await out.read(edge, 0, 12, 0);
      expect(edge.toString()).toBe("NEW-DATABASE");
      const tail = Buffer.alloc(3);
      await out.read(tail, 0, 3, size - 3);
      expect(tail.toString()).toBe("END");
    } finally {
      await out.close();
    }
    await expect(stat(source)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(`${target}-wal`)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(`${target}-shm`)).rejects.toMatchObject({ code: "ENOENT" });
    expect(log).toHaveBeenCalledWith("info", "restore.db.placed", { bytes: size });
  });

  it("copies only on EXDEV and retains the source for its owner to clean", async () => {
    const { source, target, venueDir } = await fixture();
    const fs = {
      rm,
      rmdir,
      rename: async (from: string, to: string) => {
        if (from === source) throw ioError("EXDEV");
        await rename(from, to);
      },
    };
    await restoreDatabase({ databasePath: source, venueDir, log: () => {}, fs });
    expect(await readFile(target, "utf8")).toBe("NEW-DATABASE");
    expect(await readFile(source, "utf8")).toBe("NEW-DATABASE");
    expect((await stat(target)).mode & 0o777).toBe(0o600);
  });

  it.each(["rename", "copy", "source-mode", "incoming-mode"] as const)(
    "a %s failure keeps the old set and removes partial incoming",
    async (step) => {
      const { source, target, venueDir } = await fixture();
      const fs = {
        rm,
        rmdir,
        rename: async (from: string, to: string) => {
          if (from === source && step === "rename") throw ioError("EACCES");
          if (from === source && (step === "copy" || step === "incoming-mode"))
            throw ioError("EXDEV");
          await rename(from, to);
        },
        copyFile: async (from: string, to: string) => {
          if (step === "copy") {
            await writeFile(to, "PARTIAL");
            throw ioError("ENOSPC");
          }
          await copyFile(from, to);
        },
        chmod: async (path: string, mode: number) => {
          if (
            (step === "source-mode" && path === source) ||
            (step === "incoming-mode" && path === `${target}.incoming`)
          )
            throw ioError("EPERM");
          await chmod(path, mode);
        },
      };
      await expect(
        restoreDatabase({ databasePath: source, venueDir, log: () => {}, fs }),
      ).rejects.toMatchObject({
        code: {
          rename: "EACCES",
          copy: "ENOSPC",
          "source-mode": "EPERM",
          "incoming-mode": "EPERM",
        }[step],
      });
      await oldIntact(venueDir);
      await expect(stat(`${target}.incoming`)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(source, "utf8")).toBe("NEW-DATABASE");
    },
  );

  it("puts the old sidecar set back when final placement fails", async () => {
    const { source, target, venueDir } = await fixture();
    await expect(
      restoreDatabase({
        databasePath: source,
        venueDir,
        log: () => {},
        fs: {
          rm,
          rmdir,
          copyFile,
          chmod,
          rename: async (from, to) => {
            if (from === `${target}.incoming`) throw ioError("EIO");
            await rename(from, to);
          },
        },
      }),
    ).rejects.toMatchObject({ code: "restore.placement_failed", params: { kept: "previous" } });
    await oldIntact(venueDir);
    await expect(stat(`${target}.incoming`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    "venue.db",
    "venue.db.incoming",
    "venue.db-wal",
    "venue.db-shm",
    "node.db",
    "venue.lock",
    "migrations.lock",
  ])("refuses a source alias to %s before clearing incoming", async (name) => {
    const { root, source, target, venueDir } = await fixture();
    const protectedPath = join(venueDir, name);
    if (!["venue.db", "venue.db.incoming", "venue.db-wal", "venue.db-shm"].includes(name))
      await writeFile(protectedPath, "KEEP");
    await rm(source);
    await link(protectedPath, source);
    await expect(
      restoreDatabase({ databasePath: source, venueDir, log: () => {} }),
    ).rejects.toMatchObject({ code: "restore.unsafe_entry_path" });
    await oldIntact(venueDir);
    expect(await readFile(`${target}.incoming`, "utf8")).toBe("STALE");
    const alias = join(root, "venue-alias");
    await symlink(venueDir, alias);
    await expect(
      restoreDatabase({ databasePath: join(alias, name), venueDir, log: () => {} }),
    ).rejects.toMatchObject({ code: "restore.unsafe_entry_path" });
  });

  it.each([".venue.db-litestream", ".venue.db-replaced-probe"])(
    "refuses a source under %s before its cleanup",
    async (folder) => {
      const { source, target, venueDir } = await fixture();
      const directory = join(venueDir, folder);
      await mkdir(directory);
      const databasePath = join(directory, "copy.db");
      await copyFile(source, databasePath);
      await expect(
        restoreDatabase({ databasePath, venueDir, log: () => {} }),
      ).rejects.toMatchObject({ code: "restore.unsafe_entry_path" });
      await oldIntact(venueDir);
      expect(await readFile(`${target}.incoming`, "utf8")).toBe("STALE");
      expect(await readFile(databasePath, "utf8")).toBe("NEW-DATABASE");
    },
  );

  it("accepts an unrelated hard link while preserving its other link", async () => {
    const { root, source, target, venueDir } = await fixture();
    const retained = join(root, "retained.db");
    await link(source, retained);
    await restoreDatabase({ databasePath: source, venueDir, log: () => {} });
    expect(await readFile(target, "utf8")).toBe("NEW-DATABASE");
    expect(await readFile(retained, "utf8")).toBe("NEW-DATABASE");
    await expect(stat(source)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["symlink", "directory", "missing"])(
    "refuses a %s source with the old set and incoming intact",
    async (kind) => {
      const { source, target, venueDir } = await fixture();
      await rm(source);
      if (kind === "symlink") await symlink(target, source);
      if (kind === "directory") await mkdir(source);
      await expect(
        restoreDatabase({ databasePath: source, venueDir, log: () => {} }),
      ).rejects.toMatchObject({
        code: kind === "missing" ? "ENOENT" : "restore.unsafe_entry_path",
      });
      await oldIntact(venueDir);
      expect(await readFile(`${target}.incoming`, "utf8")).toBe("STALE");
    },
  );
});
