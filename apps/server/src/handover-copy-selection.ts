import { existsSync } from "node:fs";
import { readFile, rm, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { PAIR_COPY_DIR, VENUE_FILE } from "@waitron/store";
import { errnoOf } from "./errno.js";
import { reachDisk } from "./sync-path.js";

export const COPY_READY_FILE = "ready.json";
export const COPY_PLACED_FILE = "placed.json";
/** Where a copy other than this spare's joining copy (`mirror-copy`) came from. */
export const SELECTED_COPY_SOURCES = ["selected-backup", "followed-copy"] as const;
export interface SelectedCopy {
  source: (typeof SELECTED_COPY_SOURCES)[number];
  sourceId: string;
}

async function readSource(stateDir: string, file: string): Promise<SelectedCopy | null> {
  const path = join(stateDir, PAIR_COPY_DIR, file);
  if (!existsSync(path)) return null;
  const value = JSON.parse(await readFile(path, "utf8")) as SelectedCopy;
  return SELECTED_COPY_SOURCES.some((source) => source === value.source) ? value : null;
}

export const readSelectedCopy = (stateDir: string) => readSource(stateDir, COPY_PLACED_FILE);
export const readStagedCopy = (stateDir: string) => readSource(stateDir, COPY_READY_FILE);

export async function clearSelectedCopy(stateDir: string): Promise<void> {
  if ((await readSelectedCopy(stateDir)) === null && (await readStagedCopy(stateDir)) === null)
    return;
  const folder = join(stateDir, PAIR_COPY_DIR);
  // The marker must disappear durably before any file it vouches for is replaced or removed.
  await rm(join(folder, COPY_READY_FILE), { force: true });
  await reachDisk(folder);
  await rm(folder, { recursive: true, force: true });
  await reachDisk(stateDir);
}

/** Discards a staged copy and keeps `placed.json`: the live database is still the copy it names. */
export async function discardStagedCopy(stateDir: string): Promise<void> {
  const folder = join(stateDir, PAIR_COPY_DIR);
  if (!existsSync(folder)) return;
  await rm(join(folder, COPY_READY_FILE), { force: true });
  await reachDisk(folder);
  await rm(join(folder, VENUE_FILE), { force: true });
  await reachDisk(folder);
  await rmdir(folder).then(
    () => reachDisk(stateDir),
    (error: unknown) => {
      if (errnoOf(error) !== "ENOTEMPTY") throw error;
    },
  );
}
