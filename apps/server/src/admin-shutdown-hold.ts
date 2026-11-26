import { lstat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { SHUTDOWN_MARK_FILE } from "@waitron/store";
import { errnoOf } from "./errno.js";
import { syncFolderHolding, writeFileDurable } from "./fs-atomic.js";

export function writeShutdownMark(stateDir: string): Promise<void> {
  return writeFileDurable(join(stateDir, SHUTDOWN_MARK_FILE), '{"version":1}', 0o600);
}

export async function hasShutdownMark(stateDir: string): Promise<boolean> {
  try {
    await lstat(join(stateDir, SHUTDOWN_MARK_FILE));
    return true;
  } catch (error) {
    if (errnoOf(error) === "ENOENT") return false;
    throw error;
  }
}

export async function clearShutdownMark(stateDir: string): Promise<void> {
  const file = join(stateDir, SHUTDOWN_MARK_FILE);
  try {
    await unlink(file);
  } catch (error) {
    if (errnoOf(error) === "ENOENT") return;
    throw error;
  }
  await syncFolderHolding(file);
}
