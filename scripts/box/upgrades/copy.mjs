import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

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
  if (sourceStat.isDirectory()) {
    const child = relative(await fs.realpath(sourcePath), target);
    if (child === "" || (!isAbsolute(child) && child !== ".." && !child.startsWith("../"))) {
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
