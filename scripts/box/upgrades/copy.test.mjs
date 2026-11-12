import * as fs from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { expect, it, onTestFinished, vi } from "vitest";
import { copyStoppedTree } from "./copy.mjs";

const gnuCopy =
  process.platform === "darwin"
    ? execFileSync("which", ["gcp"], { encoding: "utf8" }).trim()
    : null;

async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "waitron-upgrade-copy-"));
  onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  if (gnuCopy !== null) {
    const bin = join(root, "bin");
    await fs.mkdir(bin);
    await fs.symlink(gnuCopy, join(bin, "cp"));
    vi.stubEnv("PATH", `${bin}${delimiter}${process.env.PATH}`);
    onTestFinished(() => vi.unstubAllEnvs());
  }
  const source = join(root, "state");
  const destination = join(root, "saved-state");
  await fs.mkdir(source, { mode: 0o700 });
  await fs.writeFile(join(source, "venue.db"), "original venue bytes", { mode: 0o600 });
  return { root, source, destination };
}

it("keeps an independent stopped copy with its permissions, timestamps and links", async () => {
  const { source, destination } = await fixture();
  const file = join(source, "venue.db");
  const saved = join(destination, "venue.db");
  const time = new Date("2026-11-01T12:00:00Z");
  await fs.utimes(file, time, time);
  await fs.link(file, join(source, "hard-link"));
  await fs.symlink("venue.db", join(source, "current"));

  await copyStoppedTree(source, destination);
  await fs.writeFile(file, "changed candidate bytes");

  expect(await fs.readFile(saved, "utf8")).toBe("original venue bytes");
  const originalStat = await fs.stat(file);
  const savedStat = await fs.stat(saved);
  expect(savedStat.ino).not.toBe(originalStat.ino);
  expect(savedStat.mode & 0o777).toBe(0o600);
  expect([savedStat.uid, savedStat.gid]).toEqual([originalStat.uid, originalStat.gid]);
  expect(savedStat.mtime.toISOString()).toBe("2026-11-01T12:00:00.000Z");
  expect((await fs.stat(destination)).mode & 0o777).toBe(0o700);
  expect(await fs.readlink(join(destination, "current"))).toBe("venue.db");
  expect((await fs.stat(join(destination, "hard-link"))).ino).toBe(savedStat.ino);
});

it("flushes copied files before their directories and the destination's parent", async () => {
  const { root, source, destination } = await fixture();
  await fs.mkdir(join(source, "nested"));
  await fs.writeFile(join(source, "nested", "node.db"), "node bytes");
  const handle = await fs.open(join(source, "venue.db"), "r");
  const prototype = Object.getPrototypeOf(handle);
  const sync = prototype.sync;
  await handle.close();
  const flushed = [];
  const spy = vi.spyOn(prototype, "sync").mockImplementation(async function () {
    flushed.push((await this.stat()).ino);
    return sync.call(this);
  });
  onTestFinished(() => spy.mockRestore());

  await copyStoppedTree(source, destination);

  const inode = async (path) => (await fs.stat(path)).ino;
  expect(new Set(flushed)).toEqual(
    new Set(
      await Promise.all(
        [
          join(destination, "nested", "node.db"),
          join(destination, "nested"),
          join(destination, "venue.db"),
          destination,
          root,
        ].map(inode),
      ),
    ),
  );
  expect(flushed.indexOf(await inode(join(destination, "nested", "node.db")))).toBeLessThan(
    flushed.indexOf(await inode(join(destination, "nested"))),
  );
  expect(flushed.indexOf(await inode(join(destination, "venue.db")))).toBeLessThan(
    flushed.indexOf(await inode(destination)),
  );
  expect(flushed.at(-1)).toBe(await inode(root));
});

it("copies a stopped configuration file and surfaces a refused flush", async () => {
  const { root, source, destination } = await fixture();
  const config = join(root, ".env");
  await fs.writeFile(config, "WAITRON_IMAGE=old\n", { mode: 0o600 });
  await copyStoppedTree(config, join(root, "saved.env"));
  expect(await fs.readFile(join(root, "saved.env"), "utf8")).toBe("WAITRON_IMAGE=old\n");
  const handle = await fs.open(config, "r");
  const prototype = Object.getPrototypeOf(handle);
  await handle.close();
  const refused = Object.assign(new Error("flush refused"), { code: "EIO" });
  const spy = vi.spyOn(prototype, "sync").mockRejectedValue(refused);
  onTestFinished(() => spy.mockRestore());

  await expect(copyStoppedTree(source, destination)).rejects.toBe(refused);
});

it("refuses an existing destination without overwriting it", async () => {
  const { source, destination } = await fixture();
  await fs.mkdir(destination);
  await fs.writeFile(join(destination, "venue.db"), "earlier recovery copy");

  await expect(copyStoppedTree(source, destination)).rejects.toThrow("destination exists");
  expect(await fs.readFile(join(destination, "venue.db"), "utf8")).toBe("earlier recovery copy");
});

it("refuses a destination inside the source, including through a parent link", async () => {
  const { root, source } = await fixture();
  await fs.symlink(source, join(root, "linked-state"));

  await expect(copyStoppedTree(source, join(source, "copy"))).rejects.toThrow("inside source");
  await expect(copyStoppedTree(source, join(root, "linked-state", "copy"))).rejects.toThrow(
    "inside source",
  );
  expect(await fs.readdir(source)).toEqual(["venue.db"]);
});

it("restores a stopped volume in place, removes candidate-only files and can repeat", async () => {
  const { root, source, destination } = await fixture();
  await copyStoppedTree(source, destination);
  const volumeInode = (await fs.stat(source)).ino;
  await fs.writeFile(join(source, "venue.db"), "partly upgraded bytes");
  await fs.writeFile(join(source, "new-file"), "candidate only");
  const outside = join(root, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(join(outside, "kept"), "outside volume");
  await fs.symlink(outside, join(source, "new-link"));
  const { restoreStoppedTree } = await import("./copy.mjs");

  await restoreStoppedTree(destination, source);

  expect((await fs.stat(source)).ino).toBe(volumeInode);
  expect(await fs.readdir(source)).toEqual(["venue.db"]);
  expect(await fs.readFile(join(source, "venue.db"), "utf8")).toBe("original venue bytes");
  expect(await fs.readFile(join(outside, "kept"), "utf8")).toBe("outside volume");
  await fs.writeFile(join(source, "venue.db"), "interrupted restore bytes");
  await restoreStoppedTree(destination, source);
  expect(await fs.readFile(join(source, "venue.db"), "utf8")).toBe("original venue bytes");
  expect(await fs.readFile(join(destination, "venue.db"), "utf8")).toBe("original venue bytes");
});

it("restores a stopped configuration file with its private permissions", async () => {
  const { root } = await fixture();
  const saved = join(root, "saved.env");
  const live = join(root, ".env");
  await fs.writeFile(saved, "WAITRON_IMAGE=old\n", { mode: 0o600 });
  await fs.writeFile(live, "WAITRON_IMAGE=candidate\n", { mode: 0o644 });
  const { restoreStoppedTree } = await import("./copy.mjs");

  await restoreStoppedTree(saved, live);

  expect(await fs.readFile(live, "utf8")).toBe("WAITRON_IMAGE=old\n");
  expect((await fs.stat(live)).mode & 0o777).toBe(0o600);
  expect(await fs.readFile(saved, "utf8")).toBe("WAITRON_IMAGE=old\n");
});

it("refuses to clear a volume that holds its only recovery copy", async () => {
  const { source } = await fixture();
  const savedInside = join(source, "saved");
  await fs.mkdir(savedInside);
  await fs.writeFile(join(savedInside, "venue.db"), "only recovery copy");
  const { restoreStoppedTree } = await import("./copy.mjs");

  await expect(restoreStoppedTree(savedInside, source)).rejects.toThrow("overlap");
  expect(await fs.readFile(join(savedInside, "venue.db"), "utf8")).toBe("only recovery copy");
  expect(await fs.readFile(join(source, "venue.db"), "utf8")).toBe("original venue bytes");
});

it("leaves the live volume intact when the recovery copy cannot be read", async () => {
  const { root, source } = await fixture();
  const { restoreStoppedTree } = await import("./copy.mjs");

  await expect(restoreStoppedTree(join(root, "missing"), source)).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await fs.readFile(join(source, "venue.db"), "utf8")).toBe("original venue bytes");
});
