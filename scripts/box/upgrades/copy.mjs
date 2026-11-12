import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

function contains(root, path) {
  const child = relative(root, path);
  return child === "" || (child !== ".." && !child.startsWith("../"));
}

async function flush(path) {
  const handle = await fs.open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function flushTree(path) {
  const stat = await fs.lstat(path);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    for (const child of await fs.readdir(path)) await flushTree(join(path, child));
  }
  await flush(path);
}

/** The caller holds the upgrade lock and has stopped every writer before copying. */
export async function copyStoppedTree(source, destination) {
  const sourcePath = resolve(source);
  const parent = await fs.realpath(dirname(resolve(destination)));
  const target = join(parent, basename(destination));
  const sourceStat = await fs.lstat(sourcePath);
  if (sourceStat.isSymbolicLink()) throw new Error("upgrade copy source is a symlink");
  if (sourceStat.isDirectory()) {
    if (contains(await fs.realpath(sourcePath), target)) {
      throw new Error("upgrade copy destination is inside source");
    }
  }
  try {
    await fs.lstat(target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await run("cp", ["-a", "--", sourcePath, target]);
    await flushTree(target);
    await flush(parent);
    return;
  }
  throw new Error("upgrade copy destination exists");
}

/** Keep the snapshot intact so a restore interrupted before completion can repeat. */
export async function restoreStoppedTree(snapshot, destination, preserve = []) {
  const source = resolve(snapshot);
  const sourceStat = await fs.lstat(source);
  if (sourceStat.isSymbolicLink()) throw new Error("upgrade recovery copy is a symlink");
  const parent = await fs.realpath(dirname(resolve(destination)));
  const target = join(parent, basename(destination));
  const sourceRoot = await fs.realpath(source);
  if (contains(sourceRoot, target) || contains(target, sourceRoot)) {
    throw new Error("upgrade recovery copy and destination overlap");
  }
  try {
    if ((await fs.lstat(target)).isSymbolicLink()) {
      throw new Error("upgrade restore destination is a symlink");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (sourceStat.isDirectory()) {
    await fs.mkdir(target, { recursive: true });
    for (const child of await fs.readdir(target)) {
      if (!preserve.includes(child))
        await fs.rm(join(target, child), { recursive: true, force: true });
    }
    if (preserve.length === 0) {
      await run("cp", ["-a", "--", source + "/.", target]);
    } else {
      const children = (await fs.readdir(source)).filter((child) => !preserve.includes(child));
      if (children.length > 0)
        await run("cp", ["-a", "--", ...children.map((child) => join(source, child)), target]);
      await fs.chown(target, sourceStat.uid, sourceStat.gid);
      await fs.chmod(target, sourceStat.mode & 0o7777);
      await fs.utimes(target, sourceStat.atime, sourceStat.mtime);
    }
  } else {
    await fs.rm(target, { force: true });
    await run("cp", ["-a", "--", source, target]);
  }
  await flushTree(target);
  await flush(parent);
}
