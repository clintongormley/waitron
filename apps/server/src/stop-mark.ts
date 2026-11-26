import { lockVenueDatabase, readVenueHolder } from "@waitron/db";
import { codeOf } from "@waitron/server-kit";
import { isAppError } from "@waitron/shared";
import { STOP_MARK_FILE } from "@waitron/store";
import { lstat, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { errnoOf } from "./errno.js";
import { syncFolderHolding, writeFileDurable } from "./fs-atomic.js";
import type { Logger } from "./logger.js";

const MARK = { version: 1, mark: "restart" };

export interface PreviousStop {
  restart: boolean;
  heartbeatAt: string | null;
}

export function writeRestartMark(stateDir: string): Promise<void> {
  return writeFileDurable(join(stateDir, STOP_MARK_FILE), JSON.stringify(MARK), 0o600);
}

export async function clearRestartMark(stateDir: string): Promise<void> {
  const file = join(stateDir, STOP_MARK_FILE);
  try {
    await unlink(file);
  } catch (error) {
    if (errnoOf(error) === "ENOENT") return;
    throw error;
  }
  await syncFolderHolding(file);
}

export async function readPreviousStop(
  { stateDir, venueDir }: { stateDir: string; venueDir: string },
  log: Logger,
  lockVenue = lockVenueDatabase,
  readHolder = readVenueHolder,
): Promise<PreviousStop> {
  // Taking the venue lock overwrites the preceding process's heartbeat.
  const holder = readHolder(venueDir);
  const heartbeatAt = holder?.kind === "server" ? holder.heartbeatAt : null;
  const file = join(stateDir, STOP_MARK_FILE);
  let restart = false;
  try {
    await lstat(file);
    const hold = await lockVenue(venueDir);
    try {
      const mark: unknown = JSON.parse(await readFile(file, "utf8"));
      restart =
        typeof mark === "object" &&
        mark !== null &&
        "version" in mark &&
        mark.version === MARK.version &&
        "mark" in mark &&
        mark.mark === MARK.mark;
      if (!restart) log("warn", "server.stop_mark_unreadable");
    } catch (error) {
      if (errnoOf(error) !== "ENOENT") log("warn", "server.stop_mark_unreadable");
    } finally {
      try {
        await clearRestartMark(stateDir);
      } finally {
        hold.release();
      }
    }
  } catch (error) {
    if (isAppError(error) && error.code === "provisioning.database_in_use")
      return { restart: false, heartbeatAt: null };
    if (errnoOf(error) !== "ENOENT")
      log("warn", "server.stop_mark_unreadable", { errorCode: codeOf(error) });
  }
  return { restart, heartbeatAt };
}
