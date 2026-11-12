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

async function restoreDirectory(source, target, preserve) {
  const stat = source === null ? null : await fs.lstat(source);
  if (stat !== null && !stat.isDirectory())
    throw new Error("retained lock parent is not a directory");
  try {
    if ((await fs.lstat(target)).isSymbolicLink())
      throw new Error("upgrade restore destination is a symlink");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.mkdir(target, { recursive: true });
  const saved = source === null ? [] : await fs.readdir(source);
  const live = await fs.readdir(target);
  const roots = new Set(preserve.map((path) => path.split("/")[0]));
  for (const child of live) {
    if (!roots.has(child)) await fs.rm(join(target, child), { recursive: true, force: true });
  }
  for (const child of roots) {
    if (preserve.includes(child) || (!saved.includes(child) && !live.includes(child))) continue;
    await restoreDirectory(
      saved.includes(child) ? join(source, child) : null,
      join(target, child),
      preserve
        .filter((path) => path.startsWith(child + "/"))
        .map((path) => path.slice(child.length + 1)),
    );
  }
  const children = saved.filter((child) => !roots.has(child));
  if (children.length > 0)
    await run("cp", ["-a", "--", ...children.map((child) => join(source, child)), target]);
  if (stat !== null) {
    await fs.chown(target, stat.uid, stat.gid);
    await fs.chmod(target, stat.mode & 0o7777);
    await fs.utimes(target, stat.atime, stat.mtime);
  }
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
    await restoreDirectory(source, target, preserve);
  } else {
    await fs.rm(target, { force: true });
    await run("cp", ["-a", "--", source, target]);
  }
  await flushTree(target);
  await flush(parent);
}
