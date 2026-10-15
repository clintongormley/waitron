import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { AppError } from "@waitron/shared";
import "./errors.js";

type Handle = Pick<fs.FileHandle, "sync" | "close"> & {
  writeFile(data: string): Promise<void>;
};
export type DurableJsonIo = Pick<typeof fs, "mkdir" | "lstat" | "chmod" | "unlink"> & {
  rename(from: string, to: string): Promise<void>;
  open(path: string, flags: number, mode?: number): Promise<Handle>;
};
const invalid = () => new AppError("setup.attempt_invalid", {});
const missing = (error: unknown) =>
  error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";

export async function readDurableHostJson(path: string, limit: number): Promise<unknown> {
  let handle: fs.FileHandle;
  try {
    const parent = await fs.lstat(dirname(path));
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw invalid();
    handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (missing(error)) return null;
    throw invalid();
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw invalid();
    const bytes = await handle.readFile();
    if (bytes.length > limit) throw invalid();
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid();
    return value;
  } catch {
    throw invalid();
  } finally {
    await handle.close();
  }
}

export async function writeDurableHostJson(
  path: string,
  value: unknown,
  limit: number,
  io: DurableJsonIo = fs,
): Promise<void> {
  const parent = dirname(path);
  const temporary = join(parent, `.first-setup-${randomUUID()}.tmp`);
  try {
    const data = JSON.stringify(value);
    if (Buffer.byteLength(data) > limit) throw invalid();
    await io.mkdir(parent, { recursive: true, mode: 0o700 });
    const directory = await io.lstat(parent);
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw invalid();
    await io.chmod(parent, 0o700);
    try {
      const current = await io.lstat(path);
      if (!current.isFile() || current.isSymbolicLink()) throw invalid();
    } catch (error) {
      if (!missing(error)) throw error;
    }
    const handle = await io.open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await io.rename(temporary, path);
    const folder = await io.open(
      parent,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY,
    );
    try {
      await folder.sync();
    } finally {
      await folder.close();
    }
  } catch {
    throw invalid();
  } finally {
    await io.unlink(temporary).catch(() => undefined);
  }
}
